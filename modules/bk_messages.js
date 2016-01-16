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
    name: "messages",
    tables: {
        // New messages
        bk_message: {
            id: { primary: 1 },                           // my account_id
            mtime: {
                primary: 1,                               // mtime:sender
                join: ["mtime","sender"],
                unjoin: ["mtime","sender"],
                ops: { select: "ge" }
            },
            sender: { type: "text" },                      // sender id
            alias: {},                                     // sender alias
            msg: {},                                       // Text of the message
            icon: { type: "int" },                         // 1 - icon present, 0 - no icon
        },
        // Archived messages
        bk_archive: {
            id: { primary: 1 },                            // my account_id
            mtime: {
                primary: 1,                                // mtime:sender
                join: ["mtime","sender"],
                unjoin: ["mtime","sender"],
                ops: { select: "ge" }
            },
            sender: { type: "text" },                      // sender id
            alias: {},                                     // sender alias
            msg: {},                                       // text of the message
            icon: { type: "int" },                         // 1 - icon present, 0 - no icon
        },
        // Messages sent
        bk_sent: {
            id: { primary: 1 },                            // my account
            mtime: {
                primary: 1,                                // mtime:recipient
                join: ["mtime","recipient"],
                unjoin: ["mtime","recipient"],
                ops: { select: "ge" }
            },
            recipient: { type: "text" },                  // recipient id
            alias: {},                                    // recipient alias if known
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
    cacheOptions: { cacheName: "messages", ttl: 0 },
};
module.exports = mod;

mod.init = function(options)
{
    core.describeArgs("messages", [
         { name: "cache-name", obj: "cacheOptions", descr: "Cache name for keeping unread messages counter" },
         { name: "cache-ttl", type: "number", obj: "cacheOptions", nocamel: 1, strip: "cache-", min: 0, descr: "How long in ms to keep unread messages counter" },
    ]);
}

mod.configureModule = function(options, callback)
{
    db.setProcessRow("post", "bk_message", function(req, row, options) {
        if (row.icon) row.icon = api.iconUrl({ prefix: 'message', id: row.id, type: row.mtime + ":" + row.sender }); else delete row.icon;
        switch (req.op) {
        case "add":
            ipc.incr("bk_message|unread|" + req.obj.id, 1, mod.cacheOptions);
            break;
        case "put":
        case "del":
        case "update":
            ipc.del("bk_message|unread|" + req.obj.id, mod.cacheOptions);
            break;
        }
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
        var options = api.getOptions(req, mod.controls);

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
            options.cleanup = "";
            self.addMessage(req, options, function(err, data) {
                if (!err) api.metrics.Counter('msg_add_0').inc();
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
    api.sendIcon(req, res, req.account.id, { prefix: 'message', type: req.query.mtime + ":" + req.query.sender});
}

mod.getUnread = function(req, options, callback)
{
    ipc.get("bk_message|unread|" + req.account.id, mod.cacheOptions, function(count) {
        if (count) return callback(null, { count: Math.max(lib.toNumber(count), 0) });

        db.select("bk_message", { id: req.account.id }, { total: 1 }, function(err, rows) {
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
    db.select("bk_archive", req.query, options, callback);
}

// Return sent messages to the specified account, used in /message/get/sent API call
mod.getSentMessage = function(req, options, callback)
{
    req.query.id = req.account.id;
    db.select("bk_sent", req.query, options, callback);
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

    db.select("bk_message", req.query, options, function(err, rows, info) {
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
                db.checkCapacity(archive ? cap2 : cap1, next);
            });
        }, function(err) {
            if (total) rows = [{ count: rows.length }];
            options.total = total;
            callback(err, rows, info);
        });
    });
}

// Mark a message as archived, used in /message/archive API call
mod.archiveMessage = function(req, options, callback)
{
    if (!req.query.sender || !req.query.mtime) return callback({ status: 400, message: "sender and mtime are required" });

    req.query.id = req.account.id;
    db.get("bk_message", req.query, options, function(err, row, info) {
        if (err) return callback(err, []);
        if (!row) return callback({ status: 404, message: "not found" }, []);

        // Merge properties for the archive record
        for (var p in req.query) row[p] = req.query[p];

        lib.series([
          function(next) {
              db.put("bk_archive", row, next);
          },
          function(next) {
              db.del("bk_message", row, next);
          },
        ], callback);
    });
}

// Add new message, used in /message/add API call
//
// The following options properties can be used:
// - nosent - do not create a record in the bk_sent table
mod.addMessage = function(req, options, callback)
{
    if (!req.query.id) return callback({ status: 400, message: "recipient id is required" });
    if (!req.query.msg && !req.query.icon) return callback({ status: 400, message: "msg or icon is required" });

    var cap = db.getCapacity("bk_message", { useCapacity: "write", factorCapacity: options.factorCapacity || 0.25 });
    var ids = lib.strSplitUnique(req.query.id), rows = [];
    options.mtime = Date.now();

    lib.forEachSeries(ids, function(id, next) {
        req.query.id = id;
        mod.putMessage(req, options, function(err) {
            if (err) return next(err);
            rows.push({ id: req.query.id, mtime: req.query.mtime, sender: req.query.sender });
            db.checkCapacity(cap, next);
        });
    }, function(err) {
        callback(err, rows);
    });
}

mod.putMessage = function(req, options, callback)
{
    var sent = options.nosent ? null : lib.cloneObj(req.query);

    req.query.sender = req.account.id;
    req.query.alias = req.account.alias;
    req.query.mtime = options.mtime || Date.now();

    lib.series([
      function(next) {
          api.putIcon(req, req.query.id, { prefix: 'message', type: req.query.mtime + ":" + req.query.sender }, function(err, icon) {
              req.query.icon = icon ? 1 : 0;
              next(err);
          });
      },
      function(next) {
          db.add("bk_message", req.query, next);
      },
      function(next) {
          if (options.nosent) return next();
          sent.recipient = sent.id;
          sent.id = req.account.id;
          sent.mtime = req.query.mtime;
          db.add("bk_sent", sent, function(err, rows) {
              if (err) return db.del("bk_message", req.query, function() { next(err); });
              next();
          });
      },
    ], callback);
}

// Delete a message or all messages for the given account from the given sender, used in /message/del` API call
mod.delMessage = function(req, options, callback)
{
    var table = options.table || "bk_message";
    var sender = options.sender || "sender";
    req.query.id = req.account.id;

    var cap = db.getCapacity(table, { useCapacity: "write", factorCapacity: options.factorCapacity || 0.25 });

    db.select(table, { id: req.account.id, mtime: req.query.mtime, sender: req.query[sender] }, options, function(err, rows) {
        if (err) return callback(err);

        lib.forEachSeries(rows, function(row, next) {
            if (req.query[sender] && row[sender] != req.query[sender]) return next();
            lib.series([
              function(next2) {
                  db.del(table, row, next2);
              },
              function(next2) {
                  if (!row.icon) return next2();
                  api.delIcon(req.account.id, { prefix: "message", type: row.mtime + ":" + row[sender] }, next2);
              },
            ], function() {
                db.checkCapacity(cap, next);
            });
        }, callback);
    });
}

// Delete the messages in the archive, used in /message/del/archive` API call
mod.delArchiveMessage = function(req, options, callback)
{
    options.table = "bk_archive";
    options.sender = "sender";
    this.delMessage(req, options, callback);
}

// Delete the messages i sent, used in /message/del/sent` API call
mod.delSentMessage = function(req, options, callback)
{
    options.table = "bk_sent";
    options.sender = "recipient";
    this.delMessage(req, options, callback);
}

// Update a message or all messages for the given account from the given sender, used in /message/del` API call
mod.updateMessage = function(req, options, callback)
{
    var table = options.table || "bk_message";
    var sender = options.sender || "sender";
    req.query.id = req.account.id;
    db.update(table, req.query, options, callback);
}

// Update a messages in the archive, used in /message/update/archive` API call
mod.updateArchiveMessage = function(req, options, callback)
{
    options.table = "bk_archive";
    options.sender = "sender";
    this.updateMessage(req, options, callback);
}

mod.bkDeleteAccount = function(req, callback)
{
    lib.series([
     function(next) {
         if (req.options.keep_message) return next();
         db.delAll("bk_message", { id: req.account.id }, function() { next() });
     },
     function(next) {
         if (req.options.keep_archive) return next();
         db.delAll("bk_archive", { id: req.account.id }, function() { next() });
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
