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

// Status management
var mod = {
    name: "bk_status",
    tables: {
        bk_status: {
            id: { primary: 1, pub: 1 },                        // account id
            status: { pub: 1 },                                // status, online, offline, away
            name: { pub: 1 },
            atime: { type: "bigint", pub: 1 },                // last access time
            mtime: { type: "now", pub: 1 },                   // last update time
        },
    },
    // Intervals between updating presence status table
    args: [
        { name: "interval", type: "number", min: 60000, max: 86400000, descr: "Number of milliseconds between status record updates, presence is considered offline if last access was more than this interval ago" },
    ],
    interval: 900000,
};
module.exports = mod;

// Returns status record for given account, used in /status/get API call.
// It always returns status object even if it was never set before, on return the record contains
// a property `online` set to true of false according to the idle period and actual status.
//
// If id is an array, then return all status records for specified list of account ids.
//
// If status was explicitely set to `offline` then it is considered offline until changed to other value,
// for other cases `status` property is not used, it is supposed for the application extention.
//
mod.get = function(id, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    var now = Date.now();

    if (Array.isArray(id)) {
        db.list("bk_status", id, options, function(err, rows) {
            if (err) return callback(err);
            rows = rows.filter(function(row) {
                row.online = now - row.atime < mod.statusInterval && row.status != "offline" ? true : false;
            });
            callback(err, rows);
        });
    } else {
        db.get("bk_status", { id: id }, options, function(err, status, info) {
            if (err) return callback(err);
            if (!status) status = { id: id, status: "", online: false, atime: 0, mtime: 0 };
            status.online = now - status.atime < mod.statusInterval && status.status != "offline" ? true : false;
            status._cached = info.cached;
            callback(err, status);
        });
    }
}

// Maintain online status, update to db every status-interval seconds, only update the db if last update happened
// longer than `status-interval` milliseconds ago, keep atime up-to-date in the cache on every status update.
//
// On return and if it was flushed to db the `atime` will be equal to `mtime`.
//
// *NOTE: All properties from the `obj` will be saved in the bk_status record, existing properties will be overriden*
mod.update = function(status, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (status.online && status.atime - status.mtime < mod.statusInterval && status._cached) {
        status.atime = Date.now();
        db.putCache("bk_status", status, options);
        lib.tryCall(callback, null, status);
    } else {
        status.atime = Date.now();
        db.put("bk_status", status, { info_obj: 1 }, function(err, data, info)  {
            lib.tryCall(callback, err, info.obj);
        });
    }
}

mod.del = function(status, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    db.del("bk_status", status, callback);
}

// This methods is suitable for background jobs
mod.bkDeleteAccount = function(req, callback)
{
    if (req.options.keep_all || req.options.keep_status) return callback();
    db.del("bk_status", { id: req.account.id }, req.options, callback);
}

