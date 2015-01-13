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

api.endpoints["message"] = "initMessagesAPI";

// Messaging management
api.initMessagesAPI = function()
{
    var self = this;
    var db = core.modules.db;

    this.app.all(/^\/message\/([a-z\/]+)$/, function(req, res) {
        var options = self.getOptions(req);

        switch (req.params[0]) {
        case "image":
            if (!req.query.sender || !req.query.mtime) return self.sendReply(res, 400, "sender and mtime are required");
            self.sendIcon(req, res, req.account.id, { prefix: 'message', type: req.query.mtime + ":" + req.query.sender});
            break;

        case "get":
            options.cleanup = "";
            self.getMessage(req, options, function(err, rows, info) {
                self.sendJSON(req, err, self.getResultPage(req, options, rows, info));
            });
            break;

        case "get/sent":
            options.cleanup = "";
            self.getSentMessage(req, options, function(err, rows, info) {
                self.sendJSON(req, err, self.getResultPage(req, options, rows, info));
            });
            break;

        case "get/archive":
            options.cleanup = "";
            self.getArchiveMessage(req, options, function(err, rows, info) {
                self.sendJSON(req, err, self.getResultPage(req, options, rows, info));
            });
            break;

        case "archive":
            self.archiveMessage(req, options, function(err, data) {
                self.sendJSON(req, err, data);
            });
            break;

        case "add":
            self.addMessage(req, options, function(err, data) {
                self.sendJSON(req, err, data);
            });
            break;

        case "del":
            self.delMessage(req, options, function(err, data) {
                self.sendJSON(req, err, data);
            });
            break;

        case "del/archive":
            self.delArchiveMessage(req, options, function(err, data) {
                self.sendJSON(req, err, data);
            });
            break;

        case "del/sent":
            self.delSentMessage(req, options, function(err, data) {
                self.sendJSON(req, err, data);
            });
            break;

        default:
            self.sendReply(res, 400, "Invalid command");
        }
    });
}

// Return archived messages, used in /message/get API call
api.getArchiveMessage = function(req, options, callback)
{
    var self = this;
    var db = core.modules.db;

    req.query.id = req.account.id;
    if (!options.ops) options.ops = {};
    if (!options.ops.mtime) options.ops.mtime = "gt";

    db.select("bk_archive", req.query, options, callback);
}

// Return sent messages to the specified account, used in /message/get/sent API call
api.getSentMessage = function(req, options, callback)
{
    var self = this;
    var db = core.modules.db;

    req.query.id = req.account.id;
    if (!options.ops) options.ops = {};
    if (!options.ops.mtime) options.ops.mtime = "gt";

    db.select("bk_sent", req.query, options, callback);
}

// Return new/unread messages, used in /message/get API call
api.getMessage = function(req, options, callback)
{
    var self = this;
    var db = core.modules.db;

    req.query.id = req.account.id;
    if (!options.ops) options.ops = {};
    if (!options.ops.mtime) options.ops.mtime = "gt";
    options.noprocessrows = 1;

    // If asked for a total with _archive/_trash we have to retrieve all messages but return only the count
    var total = corelib.toBool(options.total);
    if (total && corelib.toBool(options.archive) || corelib.toBool(options.trash)) {
        options.total = 0;
    }
    function del(rows, next) {
        corelib.forEachLimit(rows, options.concurrency || 1, function(row, next2) {
            db.del("bk_message", row, options, function() { next2() });
        }, next);
    }

    function details(rows, info, next) {
        if (options.total) return next(null, rows, info);
        if (total) return next(null, [{ count: rows.count }], info);
        if (!corelib.toNumber(options.details)) return next(null, rows, info);
        self.listAccount(rows, { key: 'sender', select: options.select }, function(err, rows) { next(err, rows, info); });
    }

    db.select("bk_message", req.query, options, function(err, rows, info) {
        if (err) return callback(err, []);

        options.ops = null;
        // Move to archive
        if (corelib.toBool(options.archive)) {
            corelib.forEachSeries(rows, function(row, next) {
                db.put("bk_archive", row, options, next);
            }, function(err) {
                if (err) return callback(err, []);

                // Delete from the new after we archived it
                del(rows, function() {
                    if (!options.noprocessrows) db.processRows(null, "bk_message", rows, options);
                    details(rows, info, callback);
                });
            });
        } else

        // Delete after read, if we crash now new messages will never be delivered
        if (corelib.toBool(options.trash)) {
            del(rows, function() {
                db.processRows(null, "bk_message", rows, options);
                details(rows, info, callback);
            });
        } else {
            db.processRows(null, "bk_message", rows, options);
            details(rows, info, callback);
        }
    });
}

// Mark a message as archived, used in /message/archive API call
api.archiveMessage = function(req, options, callback)
{
    var self = this;
    var db = core.modules.db;
    if (!req.query.sender || !req.query.mtime) return callback({ status: 400, message: "sender and mtime are required" });

    req.query.id = req.account.id;
    req.query.mtime = req.query.mtime + ":" + req.query.sender;
    db.get("bk_message", req.query, options, function(err, row, info) {
        if (err) return callback(err, []);
        if (!row) return callback({ status: 404, message: "not found" }, []);

        options.ops = null;
        row.mtime += ":" + row.sender;
        db.put("bk_archive", row, options, function(err) {
            if (err) return callback(err, []);

            db.del("bk_message", row, options, function(err) {
                callback(err, row, info);
            });
        });
    });
}

// Add new message, used in /message/add API call
api.addMessage = function(req, options, callback)
{
    var self = this;
    var db = core.modules.db;
    var now = Date.now();
    var info = {};
    var op = options.op || "add";
    var sent = corelib.cloneObj(req.query);
    var obj = corelib.cloneObj(req.query);

    if (!req.query.id) return callback({ status: 400, message: "recipient id is required" });
    if (!req.query.msg && !req.query.icon) return callback({ status: 400, message: "msg or icon is required" });

    corelib.series([
        function(next) {
            obj.sender = req.account.id;
            obj.alias = req.account.alias;
            obj.mtime = now + ":" + pbj.sender;
            self.putIcon(req, obj.id, { prefix: 'message', type: obj.mtime }, function(err, icon) {
                obj.icon = icon ? 1 : 0;
                next(err);
            });
        },
        function(next) {
            db[op]("bk_message", obj, options, function(err, rows, info2) {
                info = info2;
                next(err);
            });
        },
        function(next) {
            if (options.nocounter) return next();
            self.incrAutoCounter(req.account.id, 'msg0', 1, options, function() { next(); });
        },
        function(next) {
            if (options.nocounter) return next();
            self.incrAutoCounter(req.query.id, 'msg1', 1, options, function() { next(); });
        },
        function(next) {
            sent.id = req.account.id;
            sent.recipient = req.query.id;
            sent.mtime = now + ':' + sent.recipient;
            if (options.nosent) return next();
            db[op]("bk_sent", sent, options, function(err, rows) {
                if (err) return db.del("bk_message", req.query, function() { next(err); });
                next();
            });
        },
        function(next) {
            if (!options.publish || req.query.id == req.account.id) return next();
            self.publish(req.query.id, { path: req.path, mtime: now, alias: req.account.alias, msg: (req.query.msg || "").substr(0, 128) }, options);
            next();
        },
        ], function(err) {
            if (err) return callback(err);
            self.metrics.Counter('msg_add_0').inc();
            if (options.nosent) {
                db.processRows("", "bk_message", obj, options);
                callback(null, obj, info);
            } else {
                db.processRows("", "bk_sent", sent, options);
                callback(null, sent, info);
            }
    });
}

// Delete a message or all messages for the given account from the given sender, used in /message/del` API call
api.delMessage = function(req, options, callback)
{
    var self = this;
    var db = core.modules.db;

    var table = options.table || "bk_message";
    var sender = options.sender || "sender";

    req.query.id = req.account.id;
    if (!options.ops) options.ops = {};
    if (!options.ops.mtime) options.ops.mtime = "gt";

    // Single deletion
    if (req.query.mtime && req.query[sender]) {
        return db.del(table, { id: req.account.id, mtime: req.query.mtime + ":" + req.query[sender] }, options, function(err) {
            if (err || !req.query.icon) return callback(err, []);
            self.delIcon(req.account.id, { prefix: "message", type: req.query.mtime + ":" + req.query[sender] }, callback);
        });
    }

    // Delete by query
    db.select(table, { id: req.account.id, mtime: (req.query.mtime ? (req.query.mtime + ":") + (req.query[sender] || "") : "") }, options, function(err, rows) {
        if (err) return callback(err, []);

        options.ops = null;
        corelib.forEachSeries(rows, function(row, next) {
            if (req.query[sender] && row[sender] != req.query[sender]) return next();
            row.mtime += ":" + row[sender];
            db.del(table, row, function(err) {
                if (err || !row.icon) return next(err);
                self.delIcon(req.account.id, { prefix: "message", type: row.mtime }, next);
            });
        }, callback);
    });
}

// Delete the messages in the archive, used in /message/del/archive` API call
api.delArchiveMessage = function(req, options, callback)
{
    options.table = "bk_archive";
    options.sender = "sender";
    this.delMessage(req, options, callback);
}

// Delete the messages i sent, used in /message/del/sent` API call
api.delSentMessage = function(req, options, callback)
{
    options.table = "bk_sent";
    options.sender = "recipient";
    this.delMessage(req, options, callback);
}

