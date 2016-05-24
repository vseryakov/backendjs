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
            atime: { type: "now", pub: 1 },         // last access time
            mtime: { type: "bigint", pub: 1 },                 // last update time
        },
    },
    // Intervals between updating presence status table
    statusInterval: 1800000,
};
module.exports = mod;

// Initialize the module
mod.init = function(options)
{
    core.describeArgs("accounts", [
         { name: "status-interval", type: "number", min: 0, max: 86400000, descr: "Number of milliseconds between status record updates, presence is considered offline if last access was more than this interval ago" },
    ]);

    db.describeTables();
}

// Returns status record for given account, used in /status/get API call.
// It always returns status object even if it was never set before, on return the record contains
// a property `online` set to true of false according to the idle period and actual status.
//
// If id is an array, then return all status records for specified list of account ids.
//
// If status was explicitely set to `offline` then it is considered offline until changed to other value,
// for other cases `status` property is not used, it is supposed for the application extention.
//
// `options.nostatus` can be set to 1 in order to skip the actual status record retrieval, returns immediately online status record
mod.getStatus = function(id, options, callback)
{
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
        // Status feature is disabled, return immediately
        if (options.nostatus) return callback(null, { id: id, status: "", online: true, atime: 0, mtime: 0 });

        db.get("bk_status", { id: id }, options, function(err, row, info) {
            if (err) return callback(err);
            if (!row) row = { id: id, status: "", online: false, atime: 0, mtime: 0 };
            row.online = now - row.atime < mod.statusInterval && row.status != "offline" ? true : false;
            row.cached = info.cached;
            callback(err, row);
        });
    }
}

// Maintain online status, update to db every status-interval seconds, if `options.check` is given only update db if last update happened
// longer than `status-interval` milliseconds ago, keep atime up-to-date in the cache on every status update.
//
// On return and if it was flushed to db the `atime` will be equal to `mtime`.
//
// `otime` will be set to the previous old value of `atime`.
//
// *NOTE: All properties from the `obj` will be saved in the bk_status record, existing properties will be overriden*
mod.putStatus = function(obj, options, callback)
{
    if (options.nostatus) obj = null;
    lib.series([
      function(next) {
          if (!obj) return next();

          // If it is already a status record just use it
          if (obj.online && obj.id && obj.atime) return next();

          mod.getStatus(obj.id, options, function(err, row) {
              if (err) return next(err);
              // Override properties except times
              for (var p in obj) {
                  if (!p.match(/^(online|mtime|atime|cached)$/)) row[p] = obj[p];
              }
              obj = row;
              next();
          });
      },
      function(next) {
          if (options.nostatus) return next();
          obj.otime = obj.atime;
          obj.atime = Date.now();

          if (options.check && obj.online && obj.atime - obj.mtime < mod.statusInterval) {
              // To keep the cache hot
              if (obj.cached) db.putCache("bk_status", obj, options);
              obj = null;
          }
          next();
      },
      function(next) {
          if (!obj) return next();
          obj.mtime = obj.atime;
          db.put("bk_status", obj, next);
      },
    ], callback);
}

mod.delStatus = function(obj, options, callback)
{
    db.del("bk_status", obj, callback);
}

// This methods is suitable for background jobs
mod.deleteAccount = function(req, callback)
{
    if (!req.account || !req.account.id) return callback({ status: 400, message: "no id provided" });
    if (req.options && req.options.keep_status) return callback();
    db.del("bk_status", { id: req.account.id }, req.options, callback);
}

