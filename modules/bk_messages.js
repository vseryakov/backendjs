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

// Messages management
var mod = {
    name: "bk_message",
    tables: {
        // New messages, the inbox
        bk_message: {
            id: { primary: 1 },                           // my account_id
            mtime: {
                primary: 1,                               // mtime:sender
                join: ["mtime","sender"],
                unjoin: 1,
            },
            sender: { type: "text" },                      // sender id
            name: {},                                      // sender name
            msg: {},                                       // Text of the message
            icon: { type: "int" },                         // 1 - icon present, 0 - no icon
            read: { type: "int" },                         // 1 - read, 0 - unread
        },
        // Archived messages
        bk_archive: {
            id: { primary: 1 },                            // my account_id
            mtime: {
                primary: 1,                                // mtime:sender
                join: ["mtime","sender"],
                unjoin: 1,
            },
            sender: { type: "text" },                      // sender id
            name: {},                                      // sender name
            msg: {},                                       // text of the message
            icon: { type: "int" },                         // 1 - icon present, 0 - no icon
        },
        // Messages sent
        bk_sent: {
            id: { primary: 1 },                            // my account
            mtime: {
                primary: 1,                                // mtime:recipient
                join: ["mtime","recipient"],
                unjoin: 1,
            },
            recipient: { type: "text" },                  // recipient id
            name: {},                                     // recipient name if known
            msg: {},                                      // text of the message
            icon: { type: "int" },                        // 1 - icon present, 0 - no icon
        },
        // Metrics
        bk_collect: {
            url_image_message_rmean: { type: "real" },
            url_image_message_hmean: { type: "real" },
            url_image_message_0: { type: "real" },
            url_image_message_bad_0: { type: "real" },
            url_image_message_err_0: { type: "real" },
            url_message_get_rmean: { type: "real" },
            url_message_get_hmean: { type: "real" },
            url_message_get_0: { type: "real" },
            url_message_get_bad_0: { type: "real" },
            url_message_get_err_0: { type: "real" },
            url_message_add_rmean: { type: "real" },
            url_message_add_hmean: { type: "real" },
            url_message_add_0: { type: "real" },
            url_message_add_bad_0: { type: "real" },
            url_message_add_err_0: { type: "real" },
        },
    },
    controls: {
        archive: { type: "bool" },
        trash: { type: "bool" },
        nosent: { type: "bool" },
    },
    cacheOptions: { cacheName: "messages", ttl: 86400000 },
};
module.exports = mod;

mod.init = function(options)
{
    core.describeArgs(mod.name, [
         { name: "cache-name", obj: "cacheOptions", descr: "Cache name for keeping unread messages counter" },
         { name: "cache-ttl", type: "number", obj: "cacheOptions", nocamel: 1, key: "ttl", min: 0, descr: "How long in ms to keep unread messages counter" },
    ]);
}

mod.configureMiddleware = function(options, callback)
{
    api.registerControlParams(mod.controls);
    callback();
}

mod.configureModule = function(options, callback)
{
    db.setProcessRow("post", "bk_message", function(req, row, options) {
        if (row.icon) row.icon = api.iconUrl({ prefix: 'message', id: row.id, type: row.mtime + ":" + row.sender }); else delete row.icon;
    });

    db.setProcessRow("post", "bk_archive", function(req, row, options) {
        if (row.icon) row.icon = api.iconUrl({ prefix: 'message', id: row.id, type: row.mtime + ":" + row.sender }); else delete row.icon;
    });

    db.setProcessRow("post", "bk_sent", function(req, row, options) {
        if (row.icon) row.icon = api.iconUrl({ prefix: 'message', id: row.sender, type: row.mtime + ":" + row.id }); else delete row.icon;
    });

    callback();
}

// Create API endpoints and routes
mod.configureWeb = function(options, callback)
{
    this.configureMessagesAPI();
    callback()
}

// Messaging management
mod.configureMessagesAPI = function()
{
    var self = this;

    api.app.all(/^\/message\/([a-z\/]+)$/, function(req, res) {
        var options = api.getOptions(req);

        switch (req.params[0]) {
        case "image":
            mod.sendImage(req, options);
            break;

        case "get/unread":
            options.cleanup = "";
            self.getUnread(req, options, function(err, data) {
                api.sendJSON(req, err, data);
            });
            break;

        case "get":
            self.getMessage(req, options, function(err, rows, info) {
                api.sendJSON(req, err, api.getResultPage(req, options, rows, info));
            });
            break;

        case "get/sent":
            self.getSentMessage(req, options, function(err, rows, info) {
                api.sendJSON(req, err, api.getResultPage(req, options, rows, info));
            });
            break;

        case "get/archive":
            self.getArchiveMessage(req, options, function(err, rows, info) {
                api.sendJSON(req, err, api.getResultPage(req, options, rows, info));
            });
            break;

        case "archive":
            self.archiveMessage(req, options, function(err, data) {
                api.sendJSON(req, err, data);
            });
            break;

        case "add":
            // Return full message with new properties
            options.cleanup = "";
            self.addMessage(req, options, function(err, data) {
                if (!err) api.metrics.Counter('msg_add_0').inc();
                api.sendJSON(req, err, data);
            });
            break;

        case "read":
            self.readMessage(req, options, function(err, data) {
                api.sendJSON(req, err, data);
            });
            break;

        case "update":
            self.updateMessage(req, options, function(err, data) {
                api.sendJSON(req, err, data);
            });
            break;

        case "update/archive":
            self.updateArchiveMessage(req, options, function(err, data) {
                api.sendJSON(req, err, data);
            });
            break;

        case "del":
            self.delMessage(req, options, function(err, data) {
                api.sendJSON(req, err, data);
            });
            break;

        case "del/archive":
            self.delArchiveMessage(req, options, function(err, data) {
                api.sendJSON(req, err, data);
            });
            break;

        case "del/sent":
            self.delSentMessage(req, options, function(err, data) {
                api.sendJSON(req, err, data);
            });
            break;

        default:
            api.sendReply(res, 400, "Invalid command");
        }
    });
}

mod.sendImage = function(req, options)
{
    if (!req.query.sender || !req.query.mtime) return api.sendReply(res, 400, "sender and mtime are required");
    api.sendIcon(req, req.res, req.account.id, { prefix: 'message', type: req.query.mtime + ":" + req.query.sender});
}

mod.getUnread = function(req, options, callback)
{
    ipc.get("bk_message|unread|" + req.account.id, mod.cacheOptions, function(err, count) {
        count = lib.toNumber(count);
        if (count > 0) return callback(null, { count: count });

        db.select("bk_message", { id: req.account.id, read: 1 }, { total: 1, ops: { read: "ne" } }, function(err, rows) {
            if (err) return callback(err);

            ipc.put("bk_message|unread|" + req.account.id, rows[0].count, mod.cacheOptions);
            callback(null, { count: rows[0].count });
        });
    });
}

// Return archived messages, used in /message/get API call
mod.getArchiveMessage = function(req, options, callback)
{
    req.query.id = req.account.id;
    var query = lib.toParams(req.query, { id: {}, mtime: { type: "int" }, sender: {}, read: { type: "int" } });
    db.select("bk_archive", query, options, callback);
}

// Return sent messages to the specified account, used in /message/get/sent API call
mod.getSentMessage = function(req, options, callback)
{
    req.query.id = req.account.id;
    var query = lib.toParams(req.query, { id: {}, mtime: { type: "int" }, recipient: {} });
    db.select("bk_sent", query, options, callback);
}

// Return new/unread messages, used in /message/get API call
mod.getMessage = function(req, options, callback)
{
    req.query.id = req.account.id;

    // If asked for a total with _archive/_trash we have to retrieve all messages but return only the count
    var total = lib.toBool(options.total);
    var archive = lib.toBool(options.archive);
    var trash = lib.toBool(options.trash);
    if (total && (archive || trash)) options.total = 0;

    var cap1 = db.getCapacity("bk_message", { useCapacity: "write", factorCapacity: options.factorCapacity || 0.25 });
    var cap2 = db.getCapacity("bk_archive", { useCapacity: "write", factorCapacity: options.factorCapacity || 0.25 });

    var query = lib.toParams(req.query, { id: {}, mtime: { type: "int" }, sender: {}, read: { type: "int" } });
    db.select("bk_message", query, options, function(err, rows, info) {
        if (err) return callback(err);

        if (!archive && !trash) return callback(err, rows, info);

        // Move to archive or delete
        lib.forEachLimit(rows, options.concurrency || 1, function(row, next) {
            lib.series([
              function(next2) {
                  if (!archive) return next2();
                  db.put("bk_archive", row, next2);
              },
              function(next2) {
                  db.del("bk_message", row, next2);
              },
            ], function() {
                if (!err && !row.read) ipc.incr("bk_message|unread|" + row.id, -1, mod.cacheOptions);
                db.checkCapacity(archive ? cap2 : cap1, next);
            });
        }, function(err) {
            if (total) rows = [{ count: rows.length }];
            options.total = total;
            callback(err, rows, info);
        });
    });
}

// Add new message(s), used in /message/add API call
//
// The following options properties can be used:
// - nosent - do not create a record in the bk_sent table
mod.addMessage = function(req, options, callback)
{
    if (!req.query.id) return callback({ status: 400, message: "recipient id is required" });
    if (!req.query.msg && !req.query.icon) return callback({ status: 400, message: "msg or icon is required" });

    var cap = db.getCapacity("bk_message", { useCapacity: "write", factorCapacity: options.factorCapacity || 0.25 });
    var ids = lib.strSplitUnique(req.query.id), rows = [];
    req.query.sender = req.account.id;
    req.query.name = req.account.name;
    req.query.mtime = Date.now();

    lib.forEachSeries(ids, function(id, next) {
        req.query.id = id;
        mod._putMessage(req, options, function(err) {
            if (err) {
                rows.push({ id: req.query.id, error: err.message || err });
            } else {
                ipc.incr("bk_message|unread|" + req.query.id, 1, mod.cacheOptions);
                rows.push({ id: req.query.id, mtime: req.query.mtime, sender: req.query.sender });
            }
            db.checkCapacity(cap, next);
        });
    }, function(err) {
        callback(err, rows);
    });
}

mod._putMessage = function(req, options, callback)
{
    api.putIcon(req, req.query.id, { prefix: 'message', type: req.query.mtime + ":" + req.query.sender }, function(err, icon) {
        req.query.icon = icon ? 1 : 0;
        db.add("bk_message", req.query, function(err) {
            if (err || options.nosent) return callback(err);

            var sent = lib.cloneObj(req.query, "id", req.query.sender, "recipient", req.query.id);
            db.add("bk_sent", sent, function(err) {
                callback();
            });
        });
    });
}

// Move matched messages to the archive, used in /message/archive API call
mod.archiveMessage = function(req, options, callback)
{
    req.query.id = req.account.id;
    var cap = db.getCapacity("bk_message", { useCapacity: "write", factorCapacity: options.factorCapacity || 0.25 });
    var query = lib.toParams(req.query, { id: {}, mtime: { type: "int" }, sender: {}, read: { type: "int" } });
    db.scan("bk_message", query, options, function(row, next) {
        db.put("bk_archive", row, function(err) {
            if (err) return next(err);

            db.del("bk_message", row, function(err) {
                if (err) return next(err);

                if (!row.read) ipc.incr("bk_message|unread|" + row.id, -1, mod.cacheOptions);
                db.checkCapacity(cap, next);
            });
        });
    }, callback);
}

// Delete matched messages, used in /message/del` API call
mod.delMessage = function(req, options, callback)
{
    req.query.id = req.account.id;
    options.select = ["id","mtime","sender","recipient","read"];
    var table = options.table || "bk_message";
    var cap = db.getCapacity(table, { useCapacity: "write", factorCapacity: options.factorCapacity || 0.25 });
    var query = lib.toParams(req.query, { id: {}, mtime: { type: "int" }, sender: {}, read: { type: "int" }, recipient: {} });
    db.scan(table, query, options, function(row, next) {
        db.del(table, row, function(err) {
            if (!row.read) ipc.incr("bk_message|unread|" + row.id, -1, mod.cacheOptions);
            if (row.icon && row.sender) api.delIcon(row.id, { prefix: "message", type: row.mtime + ":" + row.sender });
            db.checkCapacity(cap, next);
        });
    }, callback);
}

// Delete matched messages in the archive, used in /message/del/archive` API call
mod.delArchiveMessage = function(req, options, callback)
{
    options.table = "bk_archive";
    this.delMessage(req, options, callback);
}

// Delete matched messages i sent, used in /message/del/sent` API call
mod.delSentMessage = function(req, options, callback)
{
    options.table = "bk_sent";
    this.delMessage(req, options, callback);
}

// Update a message or all messages for the given account from the given sender, used in /message/del` API call
mod.updateMessage = function(req, options, callback)
{
    var table = options.table || "bk_message";
    req.query.id = req.account.id;
    db.update(table, req.query, options, callback);
}

// Update a messages in the archive, used in /message/update/archive` API call
mod.updateArchiveMessage = function(req, options, callback)
{
    options.table = "bk_archive";
    this.updateMessage(req, options, callback);
}

// Mark matched messages as read, used in /message/read` API call
mod.readMessage = function(req, options, callback)
{
    req.query.id = req.account.id;
    req.query.read = 1;
    options.ops.read = "ne";
    options.select = ["id","mtime","sender","read"];
    options.process = function(row) { if (!row.read) ipc.incr("bk_message|unread|" + row.id, -1, mod.cacheOptions); }
    var query = lib.toParams(req.query, { id: {}, mtime: { type: "int" }, sender: {}, read: { type: "int" } });
    db.updateAll("bk_message", query, { read: 1 }, options, callback)
}

mod.bkDeleteAccount = function(req, callback)
{
    lib.series([
     function(next) {
         if (req.options.keep_message) return next();
         mod.delMessage(req, {}, function() { next() });
     },
     function(next) {
         if (req.options.keep_archive) return next();
         mod.delMessage(req, { table: "bk_archive" },function() { next() });
     },
     function(next) {
         if (req.options.keep_sent) return next();
         db.delAll("bk_sent", { id: req.account.id }, function() { next() });
     },
     function(next) {
         ipc.del("bk_message|unread" + req.account.id, mod.cacheOptions);
         next();
     }
    ], callback);
}
