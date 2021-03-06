//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
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

        case "init":
            if (req.query.name) {
                ["master","server","web","worker"].forEach(function(x) {
                    ipc.broadcast(core.name + ":" + x, req.query.name + ":init", { queueName: ipc.systemQueue });
                });
            }
            res.json({});
            break;

        case "check":
            if (req.query.name) {
                ["master","server","web","worker"].forEach(function(x) {
                    ipc.broadcast(core.name + ":" + x, req.query.name + ":check", { queueName: ipc.systemQueue });
                });
            }
            res.json({});
            break;

        case "queue":
            switch (req.params[1]) {
            case "publish":
                ipc.broadcast(req.query.key, req.query.value, { queueName: req.query.queue }, function(err) { api.sendReply(res, err) });
                break;
            }
            break;

        case "jobs":
            switch (req.params[1]) {
            case 'submit':
                jobs.submitJob(req.query, function(err) { api.sendReply(res, err) });
                break;

            case 'cancel':
                ipc.broadcast(core.name + ":master", ipc.newMsg("jobs:cancel", req.query), { queueName: ipc.systemQueue }, function(err) {
                    api.sendReply(res, err)
                });
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
                msg.send(req.query.device_id, req.query, function(err) { api.sendReply(res, err) });
                break;
            }
            break;

        case "params":
            var args = [ [ '', core.args ] ];
            Object.keys(core.modules).forEach(function(n) {
                if (core.modules[n].args) args.push([n, core.modules[n].args]);
            });
            switch (req.params[1]) {
            case 'get':
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
            case "info":
                var data = {};
                args.forEach(function(x) {
                    x[1].forEach(function(y) {
                        data[(x[0] ? x[0] + "-" : "") + y.name] = y;
                    });
                });
                res.json(data);
                break;
            default:
                api.sendReply(res, 400, "Invalid command:" + req.params[1]);
            }
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
            case 'stats':
                ipc.stats({ cacheName: req.query.cache }, function(data) {
                    res.json(data || {})
                });
                break;
            case "get":
                ipc.get(req.query.name, { cacheName: req.query.cache }, function(err, data) {
                    res.json({ value: data });
                });
                break;
            case "clear":
                ipc.clear({ cacheName: req.query.cache });
                res.json({});
                break;
            case "del":
                ipc.del(req.query.name, { cacheName: req.query.cache });
                res.json({});
                break;
            case "incr":
                ipc.incr(req.query.name, lib.toNumber(req.query.value), { cacheName: req.query.cache }, function(err, val) {
                    res.json({ value: val });
                });
                break;
            case "put":
                ipc.put(req.query.name, req.query.value, { cacheName: req.query.cache });
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

