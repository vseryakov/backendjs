//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//
 
const lib = require(__dirname + '/../lib');
const db = require(__dirname + '/../db');
const logger = require(__dirname + '/../logger');
const QueueClient = require(__dirname + "/client");

/**
 * Queue client using a database for persistence, this driver uses naive content
 * resolution method by SELECT first and then UPDATE received record with new status, this relies on
 * the database to atomically perform conditional UPDATE, if no record updated it is ignored and performs SELECT again.
 *
 * Active jobs can stuck if a worker crashes, in this case active=1 for such record and there is no automatic
 * processing such records, the simple case would be to poll on the server and update active=0 after some timeout
 *
 *          db.updateAll("bk_queue", { active: 1, mtime: Date.now() - 300000 },
 *                                   { active: 0 },
 *                                   { sort: "active_mtime", ops: { mtime: "lt" }, expected: { active: 1 } },
 *                                   lib.log)
 *
 */

class DBClient extends QueueClient {

    tables = {
        bk_queue: {
            id: { primary: 1 },
            status: { index: 1, value: "new" },                // new, running, error
            name: {},                                          // queue name
            job: { type: "obj" },                              // job definition object
            options: { type: "obj" },                          // submit options
            ctime: { type: "now", readonly: 1 },
            mtime: { type: "now" }
        },
    }

    constructor(options) {
        super(options);
        this.name = "db";
        this.applyOptions();
        this.emit("ready");
    }

    monitor(options) {
        var visibilityTimeout = lib.validPositive(options.visibilityTimeout, this.options.visibilityTimeout);
        if (!this._monitorTimer && visibilityTimeout) {
            this._monitorTimer = setInterval(this._monitor.bind(this, options), visibilityTimeout);
            this._monitor(options);
        }
    }

    submit(job, options, callback) {
        logger.dev("submit:", this.url, events, options);
        db.put("bk_queue", { id: lib.uuid(), job }, options, callback);
    }

}
 
DBClient.prototype.monitorQueue = function()
{
    var options = { pool: this.options.pool, updateCollect: 1, sort: "active_mtime", ops: { mtime: "lt" }, expected: { active: 1 } };
    var query = { active: 1, mtime: Date.now() - this.options.visibilityTimeout * 1000 };
 
    db.updateAll("bk_queue", query, { active: 0 }, options, function(err, rows) {
        for (var i in rows) logger.error("ipc.monitor:", lib.toAge(rows[i].mtime), rows[i]);
    });
}
 
DBClient.prototype.monitor = function()
{
    if (!this._monitor && this.options.visibilityTimeout) {
        this._monitor = setInterval(this.monitorQueue.bind(this), this.options.visibilityTimeout * 1.1 * 1000);
        this.monitorQueue();
    }
}
 
DBClient.prototype.poller = function()
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
                if (!self.emit(row.channel || "message", row.data, function(err) {
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
 