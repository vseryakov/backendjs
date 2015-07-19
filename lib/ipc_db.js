//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var util = require('util');
var path = require('path');
var logger = require(__dirname + '/../logger');
var core = require(__dirname + '/../core');
var lib = require(__dirname + '/../lib');
var db = require(__dirname + "/../db");
var ipc = require(__dirname + "/../ipc");
var Client = require(__dirname + "/ipc_client");

// Queue client using a database for persistence, this driver uses naive content resolution method by using SELECT first and then UPDATE received
// record with new status, this relies on the database to atomically perform UPDATE, if no record updated it is ignored and polls for another.
module.exports = client;

var client = {
    name: "db",
};

ipc.modules.push(client);

db.describeTables({
     bk_queue: { id: { primary: 1 },
                 status: {},                                       // job status
                 channel: { value: "jobs" },                       // subscription key
                 data: { type: "json" },                           // job definition object
                 mtime: { type: "bigint", now: 1 } },
});

client.createClient = function(host, options)
{
    if (host.match(/^db:/)) return new IpcDbClient(host, options);
}

function IpcDbClient(host, options)
{
    Client.call(this);
    if (!this.options.interval) this.options.interval = 30;
    this.emit("ready");
}
util.inherits(IpcDbClient, Client);

IpcDbClient.prototype.startListening = function(channel)
{
    var self = this;
    db.select("bk_queue", { status: null }, { ops: { status: "null" }, count: this.options.count || 1 }, function(err, rows) {
        if (!self._listening) return;
        var now = Date.now();
        lib.forEach(rows || [], function(row, next) {
            // If we failed to update it means some other worker just did it before us so we just ignore this message
            db.update("bk_queue", { id: row.id, status: "hidden" }, { expected: { status: null } }, function(err, data, info) {
                if (err || !info.affected_rows) return next();

                var rc = self.emit(row.channel || channel, row.data, function(err) {
                    // Retain the message only in case of known fatal errors, otherwise delete it after processing, any other error
                    // is considered as undeliverable due to corruption or invalid message format...
                    if (err && err.status >= 500) {
                        db.update("bk_queue", { id: row.id, status: null });
                    } else {
                        db.del("bk_queue", { id: row.id });
                    }
                    next();
                });
                // Keep messages in the queue until deleted or processed
                if (!rc) db.update("bk_queue", { id: row.id, status: null }, function() { next() });
            });
        }, function() {
            var timeout = self.options.interval * 1000, elapsed = Date.now() - now;
            if (elapsed >= timeout) timeout = 0; else timeout -= elapsed;
            setTimeout(self.startListening.bind(self, channel), timeout);
        });
    });
}

IpcDbClient.prototype.publish = function(channel, msg, options, callback)
{
    db.put("bk_queue", { id: (options && options.id) || lib.uuid(), tag: options && options.tag, channel: channel, data: msg }, callback);
}

