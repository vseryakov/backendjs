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
var logger = bkjs.logger;

// Status management
var mod = {
    name: "bk_status",
    tables: {
        bk_status: {
            id: { primary: 1, pub: 1 },                       // account id
            name: { pub: 1 },                                 // account name
            status: { pub: 1 },                               // status, online, offline, away
            atime: { type: "bigint", pub: 1 },                // last access time
            mtime: { type: "now", pub: 1 },                   // last update time
        },
    },
    // Intervals between updating presence status table
    args: [
        { name: "interval", type: "number", min: 60000, max: 86400000, descr: "Max idle period in milliseconds after which the status will be considered offline" },
        { name: "update-interval", type: "number", min: 60000, max: 86400000, descr: "Period in milliseconds between database flushing updates in the case when bk_status is cached" },
    ],
    interval: 60000,
    updateInterval: 180000,
};
module.exports = mod;

// Returns status record for given account, used in /status/get API call.
// It always returns status object even if it was never set before, on return the record contains
// a property `online` set to true of false according to the idle period and actual status.
//
// If status was explicitely set to `offline` then it is considered offline until changed to other value,
// for other cases `status` property is not used, it is supposed for the application extention.
//
mod.get = function(id, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    var now = Date.now();
    db.get("bk_status", { id: id }, options, function(err, status, info) {
        if (err) return callback(err);
        if (!status) status = { id: id, status: "", online: false, atime: 0, mtime: 0 };
        status.online = now - status.atime < mod.interval && status.status != "offline" ? true : false;
        status._cached = info.cached;
        callback(err, status);
    });
}

// Return status records for specified list of account ids.
mod.select = function(ids, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    var now = Date.now();
    if (!Array.isArray(ids)) ids = [ ids ];
    db.list("bk_status", ids, options, function(err, rows) {
        if (err) return callback(err);
        rows = rows.filter(function(row) {
            row.online = now - row.atime < mod.interval && row.status != "offline" ? true : false;
        });
        callback(err, rows);
    });
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
    if (status.atime - status.mtime < mod.updateInterval && status._cached) {
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
    if (lib.isFlag(req.options.keep, ["all","account","bk_status"])) return callback();
    db.del("bk_status", { id: req.account.id }, req.options, callback);
}

