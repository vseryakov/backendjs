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
var corelib = require(__dirname + '/../corelib');
var msg = require(__dirname + '/../msg');
var api = require(__dirname + '/../api');
var ipc = require(__dirname + '/../ipc');
var logger = require(__dirname + '/../logger');
var utils = require(__dirname + '/../build/Release/backend');

api.endpoints["system"] = "initSystemAPI";

// API for internal provisioning and configuration
api.initSystemAPI = function()
{
    var self = this;

    // Return current statistics
    this.app.all(/^\/system\/([^\/]+)\/?(.+)?/, function(req, res) {
        var options = self.getOptions(req);
        switch (req.params[0]) {
        case "restart":
            ipc.send("api:restart");
            res.json({});
            break;

        case "config":
            ipc.send('init:' + req.params[1]);
            break;

        case "msg":
            switch (req.params[1]) {
            case 'init':
                ipc.send('init:msg');
                break;
            }
            break;

        case "stats":
            switch (req.params[1]) {
            case 'get':
                res.json(self.getStatistics());
                break;

            case "send":
                res.json(self.sendStatistics());
                break;

            case 'put':
                self.saveStatistics(self.getStatistics({ clear: true }), function(err) {
                    self.sendReply(res, err);
                });
                break;

            case 'collect':
                if (!req.query.id || !req.query.ip || !req.query.pid || !req.query.mtime) return self.sendReply(res, 400, "invalid format: " + req.query.id +","+ req.query.ip +"," + req.query.pid + ","+ req.query.mtime);
                self.saveStatistics(req.query, function(err) {
                    self.sendReply(res, err);
                });
                break;

            case 'calc':
                self.calcStatistics(req.query, options, function(err, data) {
                    if (err) return self.sendReply(res, err);
                    res.json(data);
                });
                break;

            default:
                self.sendReply(res, 400, "Invalid command:" + req.params[1]);
            }
            break;

        case "profiler":
            switch(req.params[1]) {
            case 'start':
            case 'stop':
                core.profiler("cpu", req.params[1]);
                res.json({});
                break;

            case 'get':
                // Sent profiler data to the master
                if (core.cpuProfile) {
                    res.json(core.cpuProfile);
                    core.cpuProfile = null;
                } else {
                    res.json({});
                }
                break;
            }
            break;

        case "log":
            logger.log(req.query);
            res.json({});

        case "cache":
            switch (req.params[1]) {
            case 'init':
                ipc.send('init:cache');
                break;
            case 'stats':
                ipc.stats(function(data) { res.json(data) });
                break;
            case "keys":
                ipc.keys(function(data) { res.json(data) });
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
                res.json({});
                break;
            case "incr":
                ipc.incr(req.query.name, corelib.toNumber(req.query.value));
                res.json({});
                break;
            case "put":
                ipc.put(req.query.name, req.query.value);
                res.json({});
                break;
            default:
                self.sendReply(res, 400, "Invalid command:" + req.params[1]);
            }
            break;

        default:
            self.sendReply(res, 400, "Invalid command:" + req.params[0]);
        }
    });
}

