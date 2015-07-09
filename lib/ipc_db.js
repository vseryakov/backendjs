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

// Queue client using AWS SQS
module.exports = client;

var client = {
    name: "db",
};

ipc.modules.push(client);

db.describeTables({
   bk_queue: { id: { primary: 1 },
               tag: {},
               status: {},                                       // job status
               key: {},                                          // subscription key
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
    if (!this.options.timeout) this.options.timeout = 30000;
    this.emit("ready");
    this.processQueue();
}
util.inherits(IpcDbClient, Client);


IpcDbClient.prototype.processQueue = function(callback)
{
    var self = this;
    db.select("bk_queue", { tag: this.options.tag, status: null }, { ops: { status: "null" }, count: this.options.count || 1 }, function(err, rows) {
        if (!self.host) return;
        (rows || []).forEach(function(row) {
            var cb = self.callbacks[row.key || self.options.key || ""];
            // Keep the message in case of no callback for the given key, this is persistent queue by explicit keys
            if (!cb) return;
            db.update("bk_queue", { id: row.id, status: "running" }, function(err) {
                if (err) return;

                cb[0](cb[1], row.key, row.data, function(err) {
                    // Retain the message only in case of known fatal errors, otherwise delete it after processing, any other error
                    // is considered as undeliverable due to corruption or invalid message format...
                    if (err && err.status >= 500) {
                        db.update("bk_queue", { id: row.id, status: null });
                    } else {
                        db.del("bk_queue", { id: row.id }, callback);
                    }
                });
            });
        });
        setTimeout(self.processQueue.bind(self), self.options.timeout);
    });
}

IpcDbClient.prototype.publish = function(key, data, options, callback)
{
    db.put("bk_queue", { id: (options && options.id) || lib.uuid(), tag: options && options.tag, key: key, data: data }, callback);
}
