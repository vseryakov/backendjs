//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var path = require('path');
var util = require('util');
var fs = require('fs');
var http = require('http');
var url = require('url');
var core = require(__dirname + '/../core');
var bkjs = require('backendjs');
var db = bkjs.db;
var api = bkjs.api;
var app = bkjs.app;
var ipc = bkjs.ipc;
var msg = bkjs.msg;
var core = bkjs.core;
var lib = bkjs.lib;
var logger = bkjs.logger;

// System management
var system = {
    name: "system"
};
module.exports = system;

// Initialize the module
system.init = function(options)
{
}

// Create API endpoints and routes
system.configureWeb = function(options, callback)
{
    this.configureSystemAPI();
    callback()
}

// API for internal provisioning and configuration
system.configureSystemAPI = function()
{
    // Return current statistics
    api.app.all(/^\/system\/([^\/]+)\/?(.+)?/, function(req, res) {
        var options = api.getOptions(req);
        switch (req.params[0]) {
        case "restart":
            ipc.send("api:restart");
            break;

        case "config":
            switch (req.params[1]) {
            case 'init':
                ipc.send('init:' + req.params[0]);
                break;
            }
            break;

        case "msg":
            switch (req.params[1]) {
            case 'init':
                ipc.send('init:' + req.params[0]);
                break;
            }
            break;

        case "columns":
            switch (req.params[1]) {
            case 'init':
                ipc.send('init:' + req.params[0]);
                break;
            }
            break;

        case "publish":
            ipc.publish(req.query.key, req.query.value);
            break;

        case "stats":
            switch (req.params[1]) {
            case 'get':
                res.json(api.getStatistics());
                break;

            case "send":
                res.json(api.sendStatistics());
                break;

            case 'put':
                api.saveStatistics(api.getStatistics({ clear: true }), function(err) {
                    api.sendReply(res, err);
                });
                break;

            case 'collect':
                if (!req.query.id || !req.query.ip || !req.query.pid || !req.query.mtime) return api.sendReply(res, 400, "invalid format: " + req.query.id +","+ req.query.ip +"," + req.query.pid + ","+ req.query.mtime);
                api.saveStatistics(req.query, function(err) {
                    api.sendReply(res, err);
                });
                break;

            case 'calc':
                api.calcStatistics(req.query, options, function(err, data) {
                    if (err) return api.sendReply(res, err);
                    res.json(data);
                });
                break;

            default:
                api.sendReply(res, 400, "Invalid command:" + req.params[1]);
            }
            break;

        case "profiler":
            switch(req.params[1]) {
            case 'start':
            case 'stop':
                core.profiler("cpu", req.params[1]);
                break;

            case 'get':
                // Sent profiler data to the master
                if (core.cpuProfile) {
                    res.json(core.cpuProfile);
                    core.cpuProfile = null;
                }
                break;
            }
            break;

        case "params":
            var args = [ [ '', core.args ] ];
            Object.keys(core.modules).forEach(function(n) {
                if (core.modules[n].args) args.push([n, core.modules[n].args]);
            });
            var data = { "-home": core.home, "-log": logger.level };
            args.forEach(function(x) {
                x[1].forEach(function(y) {
                    if (!y._name) return;
                    var val = lib.objGet(x[0] ? core.modules[x[0]] : core, y._name);
                    if (val == null) return;
                    data[y._key] = val;
                });
            });
            res.json(data);
            break;

        case "log":
            logger.log(req.query);
            break;

        case "cache":
            switch (req.params[1]) {
            case 'init':
                ipc.send('init:cache');
                break;
            case 'stats':
                ipc.stats(function(data) { res.json(data || {}) });
                break;
            case "keys":
                ipc.keys(function(data) { res.json(data || {}) });
                break;
            case "get":
                ipc.get(req.query.name, function(data) { res.json({ value: data }); });
                break;
            case "clear":
                ipc.clear();
                res.json({});
                break;
            case "del":
                ipc.del(req.query.name);
                break;
            case "incr":
                ipc.incr(req.query.name, lib.toNumber(req.query.value));
                break;
            case "put":
                ipc.put(req.query.name, req.query.value);
                break;
            case "command":
                if (!req.query.reply) {
                    ipc.command(req.query);
                    res.json({});
                } else {
                    ipc.command(req.query, function(data) { res.json({ value: data }); });
                }
                break;
            default:
                api.sendReply(res, 400, "Invalid command:" + req.params[1]);
            }
            break;

        default:
            api.sendReply(res, 400, "Invalid command:" + req.params[0]);
        }
        // Return empty response if not send already
        if (!res.headersSent) res.json({});
    });
}

