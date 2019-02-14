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
            icon_type: {},                                 // png, gif, jpg
            read: { type: "int" },                         // 1 - read, 0 - unread
            flags: { type: "list" },
            ctime: { type: "now", readonly: 1 },
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
            icon_type: {},                                 // png, gif, jpg
            flags: { type: "list" },
            ctime: { type: "now", readonly: 1 },
        },
        // Messages sent
        bk_sent: {
            id: { primary: 1 },                            // my account
            mtime: {
                primary: 1,                                // mtime:recipient
                join: ["mtime","recipient"],
                unjoin: 1,
            },
            recipient: { type: "text" },                   // recipient id
            name: {},                                      // recipient name if known
            msg: {},                                       // text of the message
            icon: { type: "int" },                         // 1 - icon present, 0 - no icon
            icon_type: {},                                 // png, gif, jpg
            flags: { type: "list" },
            ctime: { type: "now", readonly: 1 },
        },
    },
    controls: {
        archive: { type: "bool" },
        trash: { type: "bool" },
        nosent: { type: "bool" },
    },
    cacheOptions: { cacheName: "messages", ttl: 3600000 },
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
    db.setProcessRow("post", "bk_message", function(req, row) {
        if (row.icon) row.icon = api.iconUrl({ prefix: 'message', id: row.id, type: row.mtime + ":" + row.sender, ext: row.icon_type }); else delete row.icon;
    });

    db.setProcessRow("post", "bk_archive", function(req, row) {
        if (row.icon) row.icon = api.iconUrl({ prefix: 'message', id: row.id, type: row.mtime + ":" + row.sender, ext: row.icon_type  }); else delete row.icon;
    });

    db.setProcessRow("post", "bk_sent", function(req, row) {
        if (row.icon) row.icon = api.iconUrl({ prefix: 'message', id: row.sender, type: row.mtime + ":" + row.id, ext: row.icon_type  }); else delete row.icon;
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
        var options = api.getOptions(req, mod.controls);
        options.cleanup = "bk_message";

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
    api.sendIcon(req, req.account.id, { prefix: 'message', type: req.query.mtime + ":" + req.query.sender});
}

mod.getUnread = function(req, options, callback)
{
    ipc.get("bk_message|unread|" + req.account.id, mod.cacheOptions, function(err, data) {
        var count = lib.toNumber(data);
        if (count > 0 || data === "0") return callback(null, { count: count });

        db.select("bk_message", { id: req.account.id, read: 1 }, { total: 1, ops: { read: "ne" } }, function(err, rows) {
            if (err) return callback(err);

            ipc.put("bk_message|unread|" + req.account.id, rows[0].count, mod.cacheOptions);
            callback(null, { count: rows[0].count });
        });
    });
}

mod.resetUnread = function(req, callback)
{
    ipc.del("bk_message|unread|" + req.account.id, mod.cacheOptions, callback);
}

// Return archived messages, used in /message/get API call
mod.getArchiveMessage = function(req, options, callback)
{
    var query = lib.toParams(req.query, { q: {}, id: { value: req.account.id }, mtime: { type: "int" }, sender: {}, read: { type: "int" } });
    db.search("bk_archive", query, options, callback);
}

// Return sent messages to the specified account, used in /message/get/sent API call
mod.getSentMessage = function(req, options, callback)
{
    var query = lib.toParams(req.query, { q: {}, id: { value: req.account.id }, mtime: { type: "int" }, recipient: {} });
    db.search("bk_sent", query, options, callback);
}

// Return new/unread messages, used in /message/get API call
mod.getMessage = function(req, options, callback)
{
    // If asked for a total with _archive/_trash we have to retrieve all messages but return only the count
    var total = lib.toBool(options.total);
    var archive = lib.toBool(options.archive);
    var trash = lib.toBool(options.trash);
    if (total && (archive || trash)) options.total = 0;

    var cap1 = db.getCapacity("bk_message", { useCapacity: "write", factorCapacity: options.factorCapacity || 0.25 });
    var cap2 = db.getCapacity("bk_archive", { useCapacity: "write", factorCapacity: options.factorCapacity || 0.25 });

    var query = lib.toParams(req.query, { q: {}, id: { value: req.account.id }, mtime: { type: "int" }, sender: {}, read: { type: "int" } });
    db.search("bk_message", query, options, function(err, rows, info) {
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
    var query = lib.objClone(req.query, "sender", req.account.id, "name", req.account.name, "mtime", Date.now())

    lib.forEachSeries(ids, function(id, next) {
        query.id = id;
        mod._putMessage(req, query, options, function(err) {
            if (err) {
                rows.push({ id: query.id, error: err.message || err });
            } else {
                ipc.incr("bk_message|unread|" + query.id, 1, mod.cacheOptions);
                rows.push({ id: query.id, mtime: query.mtime, sender: query.sender });
            }
            db.checkCapacity(cap, next);
        });
    }, function(err) {
        callback(err, rows);
    });
}

mod._putMessage = function(req, query, options, callback)
{
    api.putIcon(req, "icon", query.id, { prefix: 'message', type: query.mtime + ":" + query.sender }, function(err, icon, info) {
        query.icon = icon ? 1 : 0;
        query.icon_type = icon && info && info.format;
        db.add("bk_message", query, function(err) {
            if (err || options.nosent) return callback(err);

            var sent = lib.objClone(query, "id", query.sender, "recipient", query.id);
            db.add("bk_sent", sent, function(err) {
                callback();
            });
        });
    });
}

// Move matched messages to the archive, used in /message/archive API call
mod.archiveMessage = function(req, options, callback)
{
    var cap = db.getCapacity("bk_message", { useCapacity: "write", factorCapacity: options.factorCapacity || 0.25 });
    var query = lib.toParams(req.query, { id: { value: req.account.id }, mtime: { type: "int" }, sender: {}, read: { type: "int" } });
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
    options.select = ["id","mtime","sender","recipient","read","flags"];
    var table = options.table || "bk_message";
    var cap = db.getCapacity(table, { useCapacity: "write", factorCapacity: options.factorCapacity || 0.25 });
    var query = lib.toParams(req.query, { id: { value: req.account.id }, mtime: { type: "int" }, sender: {}, read: { type: "int" }, recipient: {} });
    db.scan(table, query, options, function(row, next) {
        db.del(table, row, function(err) {
            if (!row.read) ipc.incr("bk_message|unread|" + row.id, -1, mod.cacheOptions);
            if (row.icon && row.sender && !lib.isFlag(row.flags, "keepicon")) {
                api.delIcon(row.id, { prefix: "message", type: row.mtime + ":" + row.sender, ext: row.icon_type });
            }
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
    var query = lib.objClone(req.query, "id", req.account.id);
    db.update(table, query, options, callback);
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
    options.ops.read = "ne";
    options.select = lib.strSplit(options.select);
    ["id","mtime","sender","read","flags"].forEach(function(x) { if (options.select.indexOf(x) == -1) options.select.push(x) });
    options.updateProcess = function(row) { if (!row.read) ipc.incr("bk_message|unread|" + row.id, -1, mod.cacheOptions); }
    var query = lib.toParams(req.query, { id: { value: req.account.id }, mtime: { type: "int" }, sender: {}, read: { type: "int", value: 1 } });
    db.updateAll("bk_message", query, { read: 1 }, options, callback)
}

mod.bkDeleteAccount = function(req, callback)
{
    lib.parallel([
        function(next) {
            if (lib.isFlag(req.options.keep, ["all","account","bk_message"])) return next();
            db.delAll("bk_message", { id: req.account.id }, req.options, function() { next() });
        },
        function(next) {
            if (lib.isFlag(req.options.keep, ["all","account","bk_archive"])) return next();
            db.delAll("bk_archive", { id: req.account.id }, req.options, function() { next() });
        },
        function(next) {
            if (lib.isFlag(req.options.keep, ["all","account","bk_sent"])) return next();
            db.delAll("bk_sent", { id: req.account.id }, req.options, function() { next() });
        },
        function(next) {
            mod.resetUnread(req, function() { next() });
        }
    ], callback);
}
