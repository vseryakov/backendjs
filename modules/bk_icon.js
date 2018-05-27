//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

var path = require('path');
var util = require('util');
var fs = require('fs');
var url = require('url');
var qs = require('qs');
var http = require('http');
var bkjs = require('backendjs');
var db = bkjs.db;
var api = bkjs.api;
var app = bkjs.app;
var ipc = bkjs.ipc;
var msg = bkjs.msg;
var core = bkjs.core;
var lib = bkjs.lib;
var logger = bkjs.logger;

// Icons management
var mod = {
    name: "bk_icon",
    tables: {
        bk_icon: {
            id: { primary: 1 },                         // account id
            type: {                                     // prefix:type
                primary: 1,
                pub: 1,
                join: [ "prefix", "type" ],
                unjoin: 1,
                separator: ":",
                ops: { select: "begins_with" }
            },
            prefix: {},                                 // icon prefix/namespace
            descr: { pub: 1 },                          // user provided caption
            acl_allow: {},                              // who can see it: all, auth, id:id...
            tags: { type: "list" },                     // detected or attached tags
            width: { type: "int" },
            height: { type: "int" },
            rotation: { type: "int" },                  // rotation angle
            ext: {},                                    // saved image extension
            latitude: { type: "real" },
            longitude: { type: "real" },
            mtime: { type: "now" },
        },

        // Metrics
        bk_collect: {
            url_icon_get_rmean: { type: "real" },
            url_icon_get_hmean: { type: "real" },
            url_icon_get_0: { type: "real" },
            url_icon_get_bad_0: { type: "real" },
            url_icon_get_err_0: { type: "real" },
        },
    },
    limit: { "*": 0 },
    controls: {
        width: { type: "number" },
        height: { type: "number" },
        rotate: { type: "number" },
        quality: { type: "number" },
        brightness: { type: "number" },
        contrast: { type: "number" },
        bgcolor: { type: "string" },
        verify: { type: "bool" },
        extkeep: { type: "regexp" },
        autodel: { type: "bool" },
    }
};
module.exports = mod;

// Initialize the module
mod.init = function(options)
{
    core.describeArgs("icons", [
         { name: "limit", type: "map", datatype: "int", descr: "Set the limit of how many icons by type can be uploaded by an account, type:N,type:N..., type * means global limit for any icon type" },
    ]);
}

mod.configureMiddleware = function(options, callback)
{
    api.registerControlParams(mod.controls);
    callback();
}

// Create API endpoints and routes
mod.configureWeb = function(options, callback)
{
    this.configureIconsAPI();
    callback()
}

// Generic icon management
mod.configureIconsAPI = function()
{
    api.app.all(/^\/icon\/([a-z]+)$/, function(req, res) {
        var options = api.getOptions(req);

        if (!req.query.prefix) return api.sendReply(res, 400, "prefix is required");
        if (!req.query.id) req.query.id = req.account.id;
        if (!req.query.type) req.query.type = "";
        switch (req.params[0]) {
        case "get":
            mod.send(req, options);
            break;

        case "select":
            mod.select(req.query, function(err, rows) {
                api.sendJSON(req, err, rows);
            });
            break;

        case "put":
            mod.upload(req, options, function(err, rows) {
                api.sendJSON(req, err, rows);
            });
            break;

        case "del":
            mod.del(req.query, function(err) {
                api.sendJSON(req, err);
            });
            break;

        case "upload":
            options.type = req.query.type;
            options.prefix = req.query.prefix;
            options.name = req.query.name;
            options.autodel = 1;
            api.putIcon(req, req.account.id, options, function(err, icon, info) {
                if (info) {
                    info.id = req.account.id;
                    info.prefix = req.query.prefix;
                    info.type = req.query.type;
                    info.url = api.iconUrl(info, options);
                }
                api.sendJSON(req, err, info);
            });
            break;

        default:
            api.sendReply(res, 400, "Invalid command");
        }
    });

    db.setProcessRow("post", "bk_icon", api.checkIcon);

}

// Process icon request, put or del, update table and deal with the actual image data, always overwrite the icon file
// Verify icon limits before adding new icons
mod.upload = function(req, options, callback)
{
    req.query.type = req.query.type || "";
    req.query.prefix = req.query.prefix || "account";
    req.query.id = req.query.id || req.account.id;
    if (typeof options.autodel == "undefined") options.autodel = 1;
    var icons = [], meta;

    lib.series([
      function(next) {
          // All icons with the prefix given
          db.select("bk_icon", { id: req.query.id, type: req.query.prefix }, options, function(err, rows) {
              icons = rows;
              next(err);
          });
      },
      function(next) {
          // Max number of allowed icons per type or globally
          var limit = mod.limit[req.query.type] || mod.limit['*'];
          // We can override existing icon but not add a new one
          if (limit > 0 && icons.length >= limit && !icons.some(function(x) { return x.type == options.type })) {
              return next({ status: 403, message: "No more icons allowed" });
          }
          next();
      },
      function(next) {
          options.type = req.query.type;
          options.prefix = req.query.prefix;
          api.putIcon(req, options.name || "icon", req.query.id, options, function(err, icon, info) {
              if (err || !icon) return next(err || { status: 400, message: "Upload error" });
              meta = info;
              for (var p in info) req.query[p] = info[p];
              // Add new icons to the list which will be returned back to the client
              if (!icons.some(function(x) { return x.type == options.type })) {
                  req.query.url = api.iconUrl(req.query, options);
                  icons.push(req.query);
              }
              next();
          });
      },
      function(next) {
          db.put("bk_icon", req.query, options, next);
      },
    ], function(err) {
        lib.tryCall(callback, err, icons, meta);
    });
}

mod.get = function(query, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    db.get("bk_icon", { id: query.id, type: query.type, prefix: query.prefix }, options, callback);
}

mod.put = function(query, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    db.put("bk_icon", query, options, callback);
}

// Return list of icons for the account, used in /icon/get API call
mod.select = function(query, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!query.id) return callback({ status: 400, message: "no id provided" })
    db.select("bk_icon", { id: query.id, type: query.type, prefix: query.prefix }, options || query, callback);
}

// Delete an icon, only one icon at a time, options must profile id, prefix. It will try to delete
// an icon file even if there is no record in the bk_icon table.
mod.del = function(options, callback)
{
    if (!options.id) return lib.tryCall(callback, { status: 400, message: "no id provided" })
    if (!options.prefix) return lib.tryCall(callback, { status: 400, message: "no prefix provided" })
    db.del("bk_icon", options, { returning: "*" }, function(err, rows) {
        if (err) return lib.tryCall(callback, err);
        if (rows.length) options = rows[0];
        api.delIcon(options.id, options, callback);
    });
}

// Return icon to the client, checks the bk_icon table for existence and permissions
mod.send = function(req, options)
{
    db.get("bk_icon", { id: req.query.id, type: req.query.type, prefix: req.query.prefix }, function(err, row) {
        if (err) return api.sendReply(req.res, err);
        if (!row) return api.sendReply(req.res, 404, "Not found or not allowed");
        api.sendIcon(req, row.id, row);
    });
}

mod.bkDeleteAccount = function(req, callback)
{
    if (lib.isFlag(req.options.keep, ["all","bk_icon"])) return callback();
    db.delAll("bk_icon", { id: req.account.id }, { delCollect: 1 }, function(err, rows) {
        if (lib.isFlag(req.options.keep, ["all","images"])) return callback();
        // Delete all image files
        lib.forEachSeries(rows, function(row, next) {
            api.delIcon(req.account.id, row, function() { next() });
        }, callback);
    });
}
