//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

var bkjs = require('backendjs');
var api = bkjs.api;
var ipc = bkjs.ipc;
var msg = bkjs.msg;
var core = bkjs.core;
var lib = bkjs.lib;
var jobs = bkjs.jobs;
var logger = bkjs.logger;

// System management
const mod = {
    name: "bk_system",
    args: [
        { name: "perms", type: "map", maptype: "list", descr: "Allowed operations, ex: -bk_system-perms restart:api,init:queue;config;db" },
    ],
};
module.exports = mod;

// Create API endpoints and routes
mod.configureWeb = function(options, callback)
{
    this.configureSystemAPI();
    callback()
}

// API for internal provisioning and configuration
mod.configureSystemAPI = function()
{
    // Return current statistics
    api.app.post(/^\/system\/([^/]+)\/?(.+)?/, function(req, res) {
        if (mod.perms && !lib.isFlag(mod.perms[req.params[0]], req.params[1] || "*")) return res.status(403).send("not allowed");
        var options = api.getOptions(req);
        switch (req.params[0]) {
        case "restart":
            ipc.sendMsg(`${req.params[1] || "api"}:restart`);
            res.json({});
            break;

        case "init":
            if (req.params[1]) {
                ipc.sendBroadcast(req.params[1] + ":init");
            }
            res.json({});
            break;

        case "check":
            if (req.params[1]) {
                ipc.sendBroadcast(req.params[1] + ":check");
            }
            res.json({});
            break;

        case "queue":
            switch (req.params[1]) {
            case "publish":
                ipc.broadcast(req.query.key, req.query.value, { queueName: req.query.queue }, (err) => { api.sendReply(res, err) });
                break;
            }
            break;

        case "jobs":
            switch (req.params[1]) {
            case 'submit':
                jobs.submitJob(req.query, (err) => { api.sendReply(res, err) });
                break;

            case 'cancel':
                ipc.broadcast(core.name + ":master", ipc.newMsg("jobs:cancel", req.query), (err) => {
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
                msg.send(req.query.device_id, req.query, (err) => { api.sendReply(res, err) });
                break;
            }
            break;

        case "params":
            var args = [ [ '', core.args ] ];
            Object.keys(core.modules).forEach((n) => {
                if (core.modules[n].args) args.push([n, core.modules[n].args]);
            });
            switch (req.params[1]) {
            case 'get':
                res.json(args.reduce((data, x) => {
                    x[1].forEach((y) => {
                        if (!y._name) return;
                        var val = lib.objGet(x[0] ? core.modules[x[0]] : core, y._name);
                        if (val == null && !options.total) return;
                        data[y._key] = typeof val == "undefined" ? null : val;
                    });
                    return data;
                }, { "-home": core.home, "-log": logger.level }));
                break;
            case "info":
                res.json(args.reduce((data, x) => {
                    x[1].forEach((y) => {
                        data[(x[0] ? x[0] + "-" : "") + y.name] = y;
                    });
                    return data;
                }, {}));
                break;
            default:
                api.sendReply(res, 400, "Invalid command");
            }
            break;

        case "log":
            logger.log(req.query);
            res.json({});
            break;

        case "cache":
            switch (req.params[1]) {
            case 'stats':
                ipc.stats({ queueName: req.query.cache }, (data) => {
                    res.json(data || {})
                });
                break;
            case "get":
                ipc.get(req.query.name, { queueName: req.query.cache }, (err, data) => {
                    res.json({ value: data });
                });
                break;
            case "clear":
                ipc.clear({ queueName: req.query.cache });
                res.json({});
                break;
            case "del":
                ipc.del(req.query.name, { queueName: req.query.cache });
                res.json({});
                break;
            case "incr":
                ipc.incr(req.query.name, lib.toNumber(req.query.value), { queueName: req.query.cache }, (err, val) => {
                    res.json({ value: val });
                });
                break;
            case "put":
                ipc.put(req.query.name, req.query.value, { queueName: req.query.cache });
                res.json({});
                break;
            case "command":
                if (!req.query.reply) {
                    ipc.sendMsg(req.query.op, req.query);
                    res.json({});
                } else {
                    ipc.sendMsg(req.query.op, req.query, (m) => { res.json(m); });
                }
                break;
            default:
                api.sendReply(res, 400, "Invalid command");
            }
            break;

        default:
            api.sendReply(res, 400, "Invalid command");
        }
    });
}

