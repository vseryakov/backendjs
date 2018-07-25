//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

var url = require('url');
var util = require('util');
var path = require('path');
var logger = require(__dirname + '/logger');
var core = require(__dirname + '/core');
var lib = require(__dirname + '/lib');
var db = require(__dirname + "/db");
var ipc = require(__dirname + "/ipc");
var Client = require(__dirname + "/ipc_client");

// Queue client using a database for persistence, this driver uses naive content
// resolution method by SELECT first and then UPDATE received record with new status, this relies on
// the database to atomically perform conditional UPDATE, if no record updated it is ignored and performs SELECT again.
//
// Active jobs can stuck if a worker crashes, in this case active=1 for such record and there is no automatic
// processing such records, the simple case would be to poll on the server and update active=0 after some timeout
//
//          db.updateAll("bk_queue", { active: 1, mtime: Date.now() - 300000 },
//                                   { active: 0 },
//                                   { sort: "active_mtime", ops: { mtime: "lt" }, expected: { active: 1 } },
//                                   lib.log)
//
module.exports = client;

var client = {
    name: "db",
    tables: {
        bk_queue: {
            id: { primary: 1 },
            active: { type: "int", index: 1, value: 0 },      // job status, new, running
            data: { type: "json", projections: 1 },            // job definition object
            mtime: { type: "now", index: 1 }
        },
    },
};

ipc.modules.push(client);

client.createClient = function(url, options)
{
    if (url.match(/^db:/)) return new IpcDbClient(url, options);
}

function IpcDbClient(url, options)
{
    Client.call(this, url, options);
    this.options.interval = lib.toNumber(this.options.interval, { dflt: 30, min: 1 });
    this.options.count = lib.toNumber(this.options.count, { dflt: 1, min: 1 });
    this.options.visibilityTimeout = lib.toNumber(this.options.visibilityTimeout, { min: 0, dflt: this.options.interval });
    this.emit("ready");
}
util.inherits(IpcDbClient, Client);

IpcDbClient.prototype.monitorQueue = function()
{
    var options = { pool: this.options.pool, updateCollect: 1, sort: "active_mtime", ops: { mtime: "lt" }, expected: { active: 1 } };
    var query = { active: 1, mtime: Date.now() - this.options.visibilityTimeout * 1000 };

    db.updateAll("bk_queue", query, { active: 0 }, options, function(err, rows) {
        for (var i in rows) logger.error("ipc.monitor:", lib.toAge(rows[i].mtime), rows[i]);
    });
}

IpcDbClient.prototype.monitor = function()
{
    if (!this._monitor && this.options.visibilityTimeout) {
        this._monitor = setInterval(this.monitorQueue.bind(this), this.options.visibilityTimeout * 1.1 * 1000);
        this.monitorQueue();
    }
}

IpcDbClient.prototype.poller = function()
{
    var self = this;
    db.select("bk_queue", { active: 0 }, { sort: "active_mtime", count: this.options.count, pool: this.options.pool }, function(err, rows) {
        var now = Date.now(), jobs = 0;
        if (!rows) rows = [];
        lib.forEach(rows, function(row, next) {
            // If we failed to update it means some other worker just did it before us so we just ignore this message
            db.update("bk_queue", { id: row.id, active: 1 }, { expected: { active: 0 } }, function(err, data, info) {
                if (err || !info.affected_rows) return next();
                jobs++;
                var timer;
                if (self.options.visibilityTimeout) {
                    timer = setInterval(function() {
                        db.update("bk_queue", { id: row.id, active: 1 }, { pool: this.options.pool }, function(err, data, info) {
                            logger.info("ipc.keepAlive:", row.channel, lib.objDescr(row.data));
                            if (err || !info.affected_rows) clearInterval(timer);
                        });
                    }, self.options.visibilityTimeout * 1000 * 0.9);
                }
                if (!self.emit("message", row, function(err) {
                    clearInterval(timer);
                    // Retain the message only in case of known fatal errors, otherwise delete it after processing, any other error
                    // is considered as undeliverable due to corruption or invalid message format...
                    if (err && err.status >= 500) {
                        db.update("bk_queue", { id: row.id, active: 0 }, { pool: this.options.pool });
                    } else {
                        db.del("bk_queue", { id: row.id }, { pool: this.options.pool });
                    }
                    next();
                })) {
                    clearInterval(timer);
                    db.update("bk_queue", { id: row.id, active: 0 }, { pool: this.options.pool }, function() { next(); });
                }
            });
        }, function(err) {
            if (!self.isPolling()) return;
            var interval = self.options.interval * 1000, elapsed = Date.now() - now;
            // After the job finish keep polling immediately
            if (jobs || elapsed >= interval) interval = 0; else interval -= elapsed;
            self.schedulePoller(self.options.interval);
        });
    });
}

IpcDbClient.prototype.submit = function(msg, options, callback)
{
    db.put("bk_queue", { id: lib.uuid(), data: msg }, options, callback);
}

