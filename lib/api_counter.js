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
var msg = require(__dirname + '/../msg');
var api = require(__dirname + '/../api');
var logger = require(__dirname + '/../logger');
var utils = require(__dirname + '/../build/Release/backend');

api.endpoints["counter"] = "initCounterAPI";

// Counters management
api.initCounterAPI = function()
{
    var self = this;
    var db = core.modules.db;

    this.app.all(/^\/counter\/([a-z]+)$/, function(req, res) {
        var options = self.getOptions(req);

        switch (req.params[0]) {
        case "put":
        case "update":
            req.query.id = req.account.id;

        case "incr":
            options.op = req.params[0];
            self.incrCounter(req, options, function(err, data) {
                self.sendJSON(req, err, data);
            });
            break;

        case "get":
            var id = req.query.id || req.account.id;
            db.get("bk_counter", { id: id }, options, function(err, row) {
                self.sendJSON(req, err, row);
            });
            break;

        default:
            self.sendReply(res, 400, "Invalid command");
        }
    });
}

// Increase a counter, used in /counter/incr API call, options.op can be set to 'put'
api.incrCounter = function(req, options, callback)
{
    var self = this;
    var db = core.modules.db;
    var now = Date.now();
    var op = options.op || "incr";

    // Remove non public columns when updating other account
    if (req.query.id && req.query.id != req.account.id) {
        var obj = { id: req.query.id };
        this.getPublicColumns("bk_counter").forEach(function(x) { if (req.query[x]) obj[x] = req.query[x]; });
    } else {
        var obj = req.query;
        obj.id = req.account.id;
    }

    db[op]("bk_counter", obj, options, function(err, rows) {
        if (err) return callback(err);

        // Notify only the other account
        if (obj.id != req.account.id && options.publish) {
            self.publish(obj.id, { path: req.path, mtime: now, alias: (options.account ||{}).alias, type: Object.keys(obj).join(",") }, options);
        }

        callback(null, rows);
    });
}

// Update auto counter for account and type
api.incrAutoCounter = function(id, type, num, options, callback)
{
    var self = this;
    var db = core.modules.db;

    if (!id || !type || !num) return callback(null, []);
    var col = db.getColumn("bk_counter", type, options);
    if (!col || col.autoincr) return callback(null, []);
    db.incr("bk_counter", core.newObj('id', id, type, num), options, callback);
}

