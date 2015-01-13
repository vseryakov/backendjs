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
var logger = require(__dirname + '/../logger');
var utils = require(__dirname + '/../build/Release/backend');

api.endpoints["status"] = "initStatusAPI";

// Status/presence
api.initStatusAPI = function()
{
    var self = this;
    var db = core.modules.db;

    this.app.all(/^\/status\/([a-z\/]+)$/, function(req, res) {
        var options = self.getOptions(req);

        switch (req.params[0]) {
        case "get":
            self.getStatus(!req.query.id ? req.account.id : corelib.strSplit(req.query.id), options, function(err, rows) {
                self.sendJSON(req, err, rows);
            });
            break;

        case "put":
            req.query.id = req.account.id;
            req.query.alias = req.account.alias;
            self.putStatus(req.query, options, function(err, rows) {
                self.sendJSON(req, err, rows);
            });
            break;

        case "del":
            db.del("bk_status", { id: req.account.id }, options, function(err, rows) {
                self.sendJSON(req, err, rows);
            });
            break;

        default:
            self.sendReply(res, 400, "Invalid command");
        }
    });
}


// Returns status record for given account, used in /status/get API call.
// It always returns status object even if it was never set before, on return the record contains
// a property `online` set to true of false according to the idle period and actual status.
//
// If id is an array, then return all status records for specified list of account ids.
//
// If status was explicitely set to `offline` then it is considered offline until changed to to other value,
// for other cases `status` property is not used, it is supposed for the application extention.
//
api.getStatus = function(id, options, callback)
{
    var self = this;
    var now = Date.now();
    var db = core.modules.db;

    if (Array.isArray(id)) {
        db.list("bk_status", id, options, function(err, rows) {
            if (err) return callback(err);
            rows = rows.filter(function(x) {
                row.online = now - row.atime < self.statusInterval && row.status != "offline" ? true : false;
            });
            callback(err, rows);
        });
    } else {
        db.get("bk_status", { id: id }, options, function(err, row) {
            if (err) return callback(err);
            if (!row) row = { id: id, status: "", online: false, mtime: 0 };
            row.online = now - row.atime < self.statusInterval && row.status != "offline" ? true : false;
            callback(err, row);
        });
    }
}

// Maintain online status, update to db every status-interval seconds, if options.check is given only update db if last update happened
// longer than status-interval seconds ago, keep atime up-to-date in the cache on every status update.
// On return the row will have a property `saved` if it was flushed to db.
api.putStatus = function(obj, options, callback)
{
    var self = this;
    var now = Date.now();
    var db = core.modules.db;

    // Read the current record, check is handled differently in put
    self.getStatus(obj.id, options, function(err, row) {
        if (err) return callback(err);
        // Force db flush if last update was long time ago, otherwise just update the cache with the latest access time
        if (options.check && row.online && now - row.mtime < self.statusInterval * 1.5) {
            row.atime = now;
            db.putCache("bk_status", row, options);
            return callback(err, row);
        }
        for (var p in obj) row[p] = obj[p];
        row.atime = row.mtime = now;
        row.saved = true;
        db.put("bk_status", row, function(err) {
            callback(err, row);
        });
    });
}

