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
var logger = bkjs.logger;

// Counters management
var mod = {
    name: "counters",
    tables: {
        // All accumulated counters for accounts
        bk_counter: {
           id: { primary: 1, pub: 1 },                               // account id
           ping: { type: "counter", value: 0, pub: 1 },              // public column to ping the buddy with notification
           like0: { type: "counter", value: 0, autoincr: 1 },        // who i like
           like1: { type: "counter", value: 0, autoincr: 1 },        // reversed, who likes me
           follow0: { type: "counter", value: 0, autoincr: 1 },      // who i follow
           follow1: { type: "counter", value: 0, autoincr: 1 },      // reversed, who follows me
        },
        // Metrics
        bk_collect: {
           url_counter_incr_rmean: { type: "real" },
           url_counter_incr_hmean: { type: "real" },
           url_counter_incr_0: { type: "real" },
           url_counter_incr_bad_0: { type: "real" },
           url_counter_incr_err_0: { type: "real" },
        },
    },
};
module.exports = mod;

// Create API endpoints and routes
mod.configureWeb = function(options, callback)
{
    this.configureCountersAPI();
    callback()
}

// Counters management
mod.configureCountersAPI = function()
{
    var self = this;

    api.app.all(/^\/counter\/([a-z]+)$/, function(req, res) {
        var options = api.getOptions(req);

        switch (req.params[0]) {
        case "put":
        case "update":
            req.query.id = req.account.id;

        case "incr":
            options.op = req.params[0];
            self.incrCounter(req, options, function(err, data) {
                api.sendJSON(req, err, data);
            });
            break;

        case "get":
            var id = req.query.id || req.account.id;
            db.get("bk_counter", { id: id }, options, function(err, row) {
                api.sendJSON(req, err, row);
            });
            break;

        default:
            api.sendReply(res, 400, "Invalid command");
        }
    });
}

// Increase a counter, used in /counter/incr API call, options.op can be set to 'put'
mod.incrCounter = function(req, options, callback)
{
    var self = this;
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
mod.incrAutoCounter = function(id, type, num, options, callback)
{
    var self = this;

    if (!id || !type || !num) return callback(null, []);
    var col = db.getColumn("bk_counter", type, options);
    if (!col || !col.autoincr) return callback(null, []);
    db.incr("bk_counter", lib.newObj('id', id, type, num), options, callback);
}

mod.bkAddAccount = function(req, callback)
{
    // Some dbs require the record to exist, just make one with default values
    db.put("bk_counter", { id: req.account.id }, callback);
}

mod.bkDeleteAccount = function(req, callback)
{
    if (req.options.keep_counter) return callback();
    db.del("bk_counter", { id: req.account.id }, callback);
}
