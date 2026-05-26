/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const stream = require('stream');
const fs = require('fs');
const http = require('http');
const https = require('https');
const app = require(__dirname + '/app');
const lib = require(__dirname + '/lib');
const ipc = require(__dirname + '/ipc');
const metrics = require(__dirname + '/metrics');
const logger = require(__dirname + '/logger');

/**
 * @module api
 */

const api =

/**
 * HTTP API to the server from the clients, this module implements the basic HTTP(S) API functionality with some common features.
 *
 * The API module incorporates the middleware app via __api.app__ function.
 *
 * The server spawns Web workers to perform actual operations, monitors
 * the worker processes if they die and restart them automatically.
 *
 * How many processes to spawn can be configured via __-app-workers__ config parameter.
 *
 */

module.exports = {
    name: "api",

    /**
     * @var {ConfigOptions[]} args
     */
    args: [
        { name: "version", descr: "Custom Server: header to return for all requests" },
        { name: "port", type: "number", min: 0, descr: "port to listen for the HTTP server, this is global default" },
        { name: "bind", descr: "Bind to this address only, if not specified listen on all interfaces" },
        { name: "backlog", type: "int", descr: "The maximum length of the queue of pending connections, used by HTTP server in listen." },
        { name: "ssl", type: "map", obj: 'ssl', merge: 1, descr: "SSL params: port, bind, key, cert, pfx, ca, passphrase, crl, ciphers" },
        { name: "allow-middleware", type: "regexp", descr: "Modules allowed to call configureMiddleware, i.e. only allowed endpoints" },
        { name: "accesslog-disabled", obj: "accesslog", type: "bool", descr: "Disable access logging in both file or syslog" },
        { name: "accesslog-file", obj: "accesslog", descr: "File for access logging" },
        { name: "accesslog-level", obj: "accesslog", type: "int", descr: "Syslog level priority, default is local5.info, 21 * 8 + 6" },
        { name: "accesslog-fields", obj: "accesslog", array: 1, type: "list", descr: "Additional fields from the request or user to put in the access log, prefix defines where the field is lcoated: q: - query, b: - body, o: - options, h: - headers, u: - user otherwise from the request", example: "api-log-fields = h:Referer,u:name,q:action,b:id" },
        { name: "max-requests", type: "number", min: 0, descr: "Max number of requests in the processing queue, if exceeds this value server returns 503 too busy error" },
        { name: "requests-per-socket", type: "int", min: 0, descr: "The maximum number of requests a socket can handle before closing keep alive connection" },
        { name: "idle-timeout", type: "number", min: 0, max: 3600000, descr: "HTTP request idle timeout for servers in ms, how long to keep the connection socket open, this does not affect Long Poll requests" },
        { name: "keep-alive-timeout", type: "int", descr: "Number of milliseconds to keep the HTTP conection alive" },
        { name: "request-timeout", type: "int", min: 0, descr: "Number of milliseconds to receive the entire request from the client" },
        { name: "reuse-port", type: "bool", descr: "Allow multiple sockets on the same host to bind to the same port" },
        { name: "exit-on-error", type: "bool", descr: "Exit on uncaught exception in the route handler, shutdown the worker process gracefully" },
        { name: "use-domain", type: "bool", descr: "Wrap request inside node:domain" },
        { name: "trust-proxy", type: "bool", descr: "Trust proxy headers for IP/Host" },
        { name: "defaults-([a-z0-9_]+)-(.+)", obj: "defaults.$2", make: "$1", autotype: 1, descr: "Global body limits for api.validate, format is: api-defaults-LIMIT-NAME, where LIMIT is an property that performs limiting like max, maxlist, min, required.., NAME is a schema property, it can be path specific", example: "# Limit all names length up to 128 chars\napi-defaults-max-name = 128\n# Limit groups list size for /endpoint to 255\napi-defaults-maxlist-/endpoint-groups = 255" },
        { name: "restart-hours", type: "list", datatype: "int", descr: "List of hours when to restart api workers, only done once for each hour" },
        { name: "restart-process", descr: "On address in use error condition restart the specified servers, this assumes an external monitor like monit to handle restarts" },
    ],

    version: "api/1.0",

    /** @var {int} port - HTTP port to listen to for Express app,
      * @default 8000
      */
    port: process.env.BKJS_PORT || 8000,

    /** @var {string} bind - listen on the specified local interfcae,
      * @default 0.0.0.0
      */
    bind: '0.0.0.0',

    backlog: 5000,

    exitOnError: true,

    trustProxy: true,

    ssl: {
        port: 443,
        bind: '0.0.0.0'
    },

    // All listening servers
    servers: [],

    headerSize: 64000,
    idleTimeout: 30000,
    keepAliveTimeout: 61000,
    requestTimeout: 0,

    restartProcess: "server,web",

    // Metrics and stats
    metrics: {
        req: new metrics.Timer(),
        que: new metrics.Histogram(),
        running: 0,
        busy_count: 0,
        bad_count: 0,
        err_count: 0,
    },

    accesslog: {
        fields: [],
        level: 174,
    },

    /** @var {object} defaults - used by {@link module:api.validate} global defaults, passed as data */
    defaults: {
        "*": {
            maxlist: 512,
        },
        "*.json": {
            max: 4000,
        },
        "*.token": {
            max: 2000,
        },
        "*.string": {
            max: 512,
        },
        "*.text": {
            max: 512,
        },
        "*.obj": {
            max: 32000
        },
        "*.object": {
            max: 32000
        },
        "*.array": {
            max: 32000
        },
    },
};

/**
 * Initialize API layer, this must be called before the `api` module can be used but it is called by the server module automatically so `api.init` is
 * rearely need to called directly, only for new server implementation or if using in the shell for testing.
 *
 * Calls `configureMiddleware` methods to allow other modules to setup request processing.
 *
 * @memberof module:api
 * @method init
 */
api.init = function(options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    // Shutdown signal from the server process
    if (app.isWorker) {
        ipc.on("api:restart", () => {
            api.shutdown(() => { process.exit(0) });
        });
    } else {
        // Performs graceful web worker restart
        api._restartInterval = setInterval(() => {
            if (!lib.isFlag(api.restartHours, new Date().getHours())) return;
            logger.info('restarting web workers:', api.restartHours);
            ipc.sendMsg("api:restart");
        }, 3600000);
    }

    api.configureLogging();

    // Add custom middleware
    app.runMethods("configureMiddleware", options, { allow: api.allowMiddleware }, () => {

        api.configureWebServers();

        // Notify the server about new worker server
        ipc.sendMsg("api:ready", { id: app.workerId || process.pid, port: api.port, ready: true });

        lib.tryCall(callback);
    });
}

/**
 * Gracefully close all connections, call the callback after that
 * @memberof module:api
 * @method shutdown
 */
var _exiting;

api.shutdown = function(options, callback)
{
    if (_exiting) return lib.tryCall(callback);

    _exiting = true;
    logger.debug("shutdown:", app.name, app.role);

    clearInterval(api._restartInterval);
    delete api._restartInterval;
    api.metrics.req.end();

    // Make workers not ready during the shutdown
    ipc.sendMsg("api:shutdown", { id: app.workerId || process.pid, pid: process.pid, port: api.port });

    app.runMethods("shutdownServer", { direct: 1, parallel: 1 }, () => {
        delete api.app;
        _exiting = false;
        lib.tryCall(callback);
    });
}

api.shutdownServer = function(options, callback)
{
    lib.forEvery([ "server", "sslServer" ], (name, next) => {
        if (!api[name]) return next();
        var err, server = api[name];
        delete api[name];
        try {
            server.close();

            if (options?.force) {
                server.closeAllConnections();
                server.closeIdleConnections();
            }
        } catch (e) {
            err = e
        }
        logger.log("shutdownServer:", api.name, app.role, name, "closed", err);
        next();
    }, callback, true);
}

api.configureWebServers = function(options, callback)
{
    // Start http server
    if (api.port) {
        api.server = api.createWebServer({
            name: "http",
            port: api.port,
            bind: api.bind,
            restart: api.restart,
            timeout: api.idleTimeout,
            keepAliveTimeout: api.keepAliveTimeout,
            requestTimeout: api.requestTimeout,
            maxRequestsPerSocket: api.requestsPerSocket,
            maxHeaderSize: api.headerSize,
            reusePort: api.reusePort,
        }, api.handleServerRequest);
    }

    // Start SSL server
    if (api.ssl?.port && (api.ssl.key || api.ssl.pfx)) {
        api.sslServer = api.createWebServer({
            name: "https",
            ssl: api.ssl,
            port: api.ssl.port,
            bind: api.ssl.bind,
            restart: api.restart,
            timeout: api.idleTimeout,
            keepAliveTimeout: api.keepAliveTimeout,
            requestTimeout: api.requestTimeout,
            maxRequestsPerSocket: api.requestsPerSocket,
            maxHeaderSize: api.headerSize,
            reusePort: api.reusePort,
        }, api.handleServerRequest);
    }

    app.runMethods("configureWebServer", options, { direct: 1 }, callback);
}

// Setup access log stream
api.configureLogging = function()
{
    if (logger.syslog) {
        this.accesslog.stream = new stream.Stream();
        this.accesslog.stream.writable = true;
        this.accesslog.stream.write = (data) => { logger.syslog.log(api.accesslog.level, data); return true; };
    } else

    if (this.accesslog.file) {
        this.accesslog.stream = fs.createWriteStream(this.accesslog.file, { flags: 'a' });
        this.accesslog.stream.on('error', (err) => { logger.error('accessLog:', err); api.accessLog = null; });
    } else {
        this.accesslog.stream = logger;
    }
}

/**
 * Create a Web server with options and request handler, returns a server object.
 *
 * Options can have the following properties:
 * @param {int} port - port number is required
 * @param {string} [bind] - address to bind
 * @param {string} [restart] - name of the processes to restart on address in use error, usually "web"
 * @param {objext} [ssl] - an object with SSL options for TLS createServer call
 * @param {int} [timeout] - number of idle milliseconds for the request to close
 * @param {int} [keepAliveTimeout] - number of milliseconds to keep the HTTP connecton alive
 * @param {int} [requestTimeout] - number of milliseconds to receive the entire request from the client
 * @param {int} [maxRequestsPerSocket] - number of requests a socket can handle before closing keep alive connection
 * @param {int} [maxHeaderSize] - maximum length of request headers in bytes
 * @param {boolean} [reusePort] - allows multiple sockets on the same host to bind to the same port
 * @param {string} [name] - server name to be assigned
 * @memberof module:api
 * @method createWebServer
 */
api.createWebServer = function(options, callback)
{
    if (!options?.port) {
        logger.error("createWebServer:", "api", "invalid options:", options);
        return null;
    }
    var server;
    if (options.ssl) {
        var opts = lib.clone(options.ssl);
        for (const p in options) if (p != "ssl") opts[p] = options[p];
        server = https.createServer(opts, callback);
    } else {
        server = http.createServer(options, callback);
    }
    if (options.timeout) {
        server.timeout = options.timeout;
    }
    server.serverPort = options.port;
    if (options.name) {
        server.serverName = options.name;
    }
    if (options.keepAliveTimeout) {
        server.keepAliveTimeout = options.keepAliveTimeout;
        server.headersTimeout = Math.round(options.keepAliveTimeout * 1.25);
    }
    server.requestTimeout = options.requestTimeout || 0;
    server.maxRequestsPerSocket = options.maxRequestsPerSocket || 0;
    server.on('error', (err) => {
        logger.error("createWebServer:", "api", app.role, 'port:', options.port, lib.traceError(err));
        // Restart backend processes on address in use
        if (err.code == 'EADDRINUSE' && options.restartProcess) {
            app.killBackend(options.restartProcess, "SIGKILL", () => { process.exit(0) });
        }
    });

    try {
        server.listen({
            port: options.port,
            host: options.bind,
            backlog: options.backlog,
            reusePort: options.reusePort,
        });
    } catch (e) {
        logger.error("createWebServer:", "api", options, e);
        server = null;
    }
    logger.log("createWebServer:", "api", options);
    return server;
}

// API stats if running
api.configureCollectStats = function(options)
{
    if (!api.app) return;
    var m = metrics.toJSON(api.metrics, { reset: 1, take: /_count$/ });
    options.stats.api_req_count = m.req.meter.count;
    options.stats.api_req_rate = m.req.meter.rate;
    options.stats.api_res_time = m.req.histogram.med;
    options.stats.api_que_size = m.que.med;
    for (const p in m) {
        if (p.endsWith("_count")) options.stats["api_" + p] = m[p];
    }
}

require(__dirname + "/api/util");
require(__dirname + "/api/router");
