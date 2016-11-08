//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var path = require('path');
var util = require('util');
var fs = require('fs');
var http = require('http');
var url = require('url');
var cluster = require('cluster');
var domain = require('domain');
var core = require(__dirname + '/core');
var lib = require(__dirname + '/lib');
var db = require(__dirname + '/db');
var api = require(__dirname + '/api');
var ipc = require(__dirname + '/ipc');
var logger = require(__dirname + '/logger');

// Process incoming proxy request, can be overriden for custom logic with frontend proxy server. If any
// response is sent or an error returned in the calback
// then the request will be aborted and will not be forwarded to the web processes
api.handleProxyRequest = function(req, res, callback)
{
    callback(null, req, res);
}

// Create a proxy server to handle incoming requests and distribute them to the workers
api.createProxyServer = function()
{
    var self = this;

    ipc.on('api:ready', function(msg, worker) {
        logger.info("api:ready:", msg, self.proxyWorkers);
        for (var i = 0; i < self.proxyWorkers.length; i++) {
            if (self.proxyWorkers[i].id == msg.id) return self.proxyWorkers[i] = msg;
        }
        logger.error("api:ready:", msg, self.proxyWorkers);
    });

    ipc.on('api:shutdown', function(msg, worker) {
        logger.info("api:shutdown:", msg, self.proxyWorkers);
        for (var i = 0; i < self.proxyWorkers.length; i++) {
            if (self.proxyWorkers[i].id == msg.id) self.proxyWorkers[i].ready = false;
        }
    });

    ipc.on("cluster:exit", function(msg) {
        logger.info("cluster:exit:", msg, self.proxyWorkers);
        for (var i = 0; i < self.proxyWorkers.length; i++) {
            if (self.proxyWorkers[i].id == msg.id) return self.proxyWorkers.splice(i, 1);
        }
        logger.error("cluster:exit:", msg, self.proxyWorkers);
    });

    var proxy = require('http-proxy');
    this.proxyServer = proxy.createServer();
    this.proxyServer.on("error", function(err, req) { if (err.code != "ECONNRESET") logger.error("proxy:", req.target || '', req.url, lib.traceError(err)) })
    this.server = core.createServer({ name: "http", port: core.port, bind: core.bind, restart: "web" }, function(req, res) {
        self.runProxyRequest(req, res, 0);
    });

    if (core.proxy.ssl && (core.ssl.key || core.ssl.pfx)) {
        this.sslServer = core.createServer({ name: "https", ssl: core.ssl, port: core.ssl.port, bind: core.ssl.bind, restart: "web" }, function(req, res) {
            self.runProxyRequest(req, res, 1);
        });
    }

    if (core.ws.port) {
        this.server.on('upgrade', function(req, socket, head) {
            var target = self.getProxyTarget(req);
            if (target) return self.proxyServer.ws(req, socket, head, target);
            req.close();
        });
        if (this.sslServer) {
            this.sslServer.on('upgrade', function(req, socket, head) {
                var target = self.getProxyTarget(req);
                if (target) return self.proxyServer.ws(req, socket, head, target);
                req.close();
            });
        }
    }
}

// Create/fork a worker to handle API requests, register a new port for load balancing between web workers
api.createProxyWorker = function()
{
    var port = api.getProxyPort();
    var worker = cluster.fork({ BKJS_PORT: port });
    this.proxyWorkers.push({ id: worker.id, port: port });
}

// Return a target port for proxy requests, rotates between all web workers
api.getProxyPort = function()
{
    var ports = this.proxyWorkers.map(function(x) { return x.port }).sort();
    if (ports.length && ports[0] != core.proxy.port) return core.proxy.port;
    for (var i = 1; i < ports.length; i++) {
        if (ports[i] - ports[i - 1] != 1) return ports[i - 1] + 1;
    }
    return ports.length ? ports[ports.length-1] + 1 : core.proxy.port;
}

// Return a target for proxy requests
api.getProxyTarget = function(req)
{
    // Virtual host proxy
    var host = (req.headers.host || "").toLowerCase().trim();
    if (host) {
        for (var p in this.proxyHost) {
            if (this.proxyHost[p].rx && this.proxyHost[p].rx.test(host)) return { target: p, xfwd: true };
        }
    }
    // Proxy by url patterns
    var url = req.url;
    for (var p in this.proxyUrl) {
        if (this.proxyUrl[p].rx && this.proxyUrl[p].rx.test(url)) return { target: p, xfwd: true };
    }
    // In reverse mode proxy all not matched to the host
    if (this.proxyReverse) return { target: this.proxyReverse, xfwd: true };

    // Forward api requests to the workers
    for (var i = 0; i < this.proxyWorkers.length; i++) {
        var target = this.proxyWorkers.shift();
        if (!target) break;
        this.proxyWorkers.push(target);
        if (!target.ready) continue;
        // In case when the request is originated by the load balancer we send its address
        return { target: { host: core.proxy.bind, port: target.port }, xfwd: req.headers['x-forwarded-for'] ? false: true };
    }
    return null;
}

// Process a proxy request, perform all filtering or redirects
api.runProxyRequest = function(req, res, ssl)
{
    var self = this;
    var d = domain.create();
    d.on('error', function(err) {
        logger.error('handleProxyRequest:', req.target || '', req.url, lib.traceError(err));
        if (res.headersSent) return;
        try {
            res.writeHead(500, "Internal Error");
            res.end(err.message);
        } catch(e) {}
    });
    d.add(req);
    d.add(res);

    d.run(function() {
        // Possibly overriden handler with aditiional logic
        self.handleProxyRequest(req, res, function(err) {
            if (res.headersSent) return;
            if (err) {
                res.writeHead(500, "Internal Error");
                return res.end(err.message);
            }
            req.target = self.getProxyTarget(req);
            logger.debug("handleProxyRequest:", req.headers.host, req.url, req.target);
            if (req.target) return self.proxyServer.web(req, res, req.target);
            res.writeHead(500, "Not ready yet");
            res.end();
        });
    });
}
