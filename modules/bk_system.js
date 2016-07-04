//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var path = require('path');
var util = require('util');
var fs = require('fs');
var http = require('http');
var url = require('url');
var bkjs = require('backendjs');
var db = bkjs.db;
var api = bkjs.api;
var app = bkjs.app;
var ipc = bkjs.ipc;
var msg = bkjs.msg;
var core = bkjs.core;
var lib = bkjs.lib;
var jobs = bkjs.jobs;
var logger = bkjs.logger;
var bkcache = require('bkjs-cache');

// System management
var system = {
    name: "bk_system"
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
            ipc.sendMsg("api:restart");
            res.json({});
            break;

        case "config":
            switch (req.params[1]) {
            case 'init':
                ipc.sendMsg(req.params[0] + ":init");
                res.json({});
                break;
            }
            break;

        case "columns":
            switch (req.params[1]) {
            case 'init':
                ipc.sendMsg(req.params[0] + ":init");
                res.json({});
                break;
            }
            break;

        case "queue":
            switch (req.params[1]) {
            case 'init':
                ipc.sendMsg(req.params[0] + ":init");
                res.json({});
                break;

            case "publish":
                ipc.publish(req.query.key, req.query.value, function(err) { api.sendReply(res, err) });
                break;
            }
            break;

        case "jobs":
            switch (req.params[1]) {
            case 'submit':
                jobs.submitJob(req.query, function(err) { api.sendReply(res, err) });
                break;
            }
            break;

        case "msg":
            switch (req.params[1]) {
            case 'init':
                ipc.sendMsg(req.params[0] + ":init");
                res.json({});
                break;

            case 'send':
                msg.send(req.query, function(err) { api.sendReply(res, err) });
                break;
            }
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
                    if (val == null && !options.total) return;
                    data[y._key] = typeof val == "undefined" ? null : val;
                });
            });
            res.json(data);
            break;

        case "log":
            logger.log(req.query);
            res.json({});
            break;

        case "lru":
            switch (req.params[1]) {
            case 'init':
                res.json({});
                break;
            case 'stats':
                res.json(bkcache.lruStats());
                break;
            case "keys":
                res.json(bkcache.lruKeys());
                break;
            case "get":
                res.json({ value: bkcache.get(req.query.name, Date.now()) });
                break;
            case "clear":
                bkcache.lruClear();
                res.json({});
                break;
            case "del":
                bkcache.lruDel(req.query.name);
                res.json({});
                break;
            case "incr":
                bkcache.lruIncr(req.query.name, lib.toNumber(req.query.value), lib.toNumber(req.query.expire));
                res.json({});
                break;
            case "put":
                bkcache.lruPut(req.query.name, lib.toNumber(req.query.value), lib.toNumber(req.query.expire));
                res.json({});
                break;
            default:
                api.sendReply(res, 400, "Invalid command:" + req.params[1]);
            }
            break;

        case "cache":
            switch (req.params[1]) {
            case 'init':
                ipc.sendMsg('cache:init');
                res.json({});
                break;
            case 'stats':
                ipc.stats(function(data) { res.json(data || {}) });
                break;
            case "keys":
                ipc.keys(function(data) { res.json(data || {}) });
                break;
            case "get":
                ipc.get(req.query.name, function(err, data) { res.json({ value: data }); });
                break;
            case "clear":
                ipc.clear();
                res.json({});
                break;
            case "del":
                ipc.del(req.query.name);
                res.json({});
                break;
            case "incr":
                ipc.incr(req.query.name, lib.toNumber(req.query.value));
                res.json({});
                break;
            case "put":
                ipc.put(req.query.name, req.query.value);
                res.json({});
                break;
            case "command":
                if (!req.query.reply) {
                    ipc.sendMsg(req.query.op, req.query);
                    res.json({});
                } else {
                    ipc.sendMsg(req.query.op, req.query, function(m) { res.json(m); });
                }
                break;
            default:
                api.sendReply(res, 400, "Invalid command:" + req.params[1]);
            }
            break;

        default:
            api.sendReply(res, 400, "Invalid command:" + req.params[0]);
        }
    });
}

