//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  May 2015
//

var util = require("util");
var core = require(__dirname + "/core");
var ipc = require(__dirname + "/ipc");
var lib = require(__dirname + "/lib");
var Client = require(__dirname + "/ipc_client");

// Cache/queue client that uses the master process for storing cache items, only works inside one instance but supports
// multiple web and job workers, uses internal LRU cache out of V8 heap. The queue uses an array to store messages
// so it is for testing purposes only.
module.exports = client;

var client = {
    name: "local",
};

ipc.modules.push(client);

client.createClient = function(url, options)
{
    if (!url || url.match(/^local:/)) return new IpcLocalClient(url, options);
}

function IpcLocalClient(url, options)
{
    Client.call(this, url, options);
    this.options.interval = lib.toNumber(this.options.interval, { dflt: 1000, min: 50 });
    this.emit("ready");
}

util.inherits(IpcLocalClient, Client);

IpcLocalClient.prototype.stats = function(options, callback)
{
    ipc.sendMsg("cache:stats", function(m) {
        callback(m.value);
    });
}

IpcLocalClient.prototype.keys = function(pattern, callback)
{
    ipc.sendMsg("cache:keys", { name: pattern }, function(msg) {
        callback(msg.value);
    });
}

IpcLocalClient.prototype.clear = function(pattern)
{
    ipc.sendMsg("cache:clear", { name: pattern });
}

IpcLocalClient.prototype.get = function(key, options, callback)
{
    var ttl = (options && lib.toNumber(options.ttl)) || lib.toNumber(this.options.ttl);
    ipc.sendMsg("cache:get", { name: key, expire: ttl ? Date.now() + ttl : 0, set: options && options.set }, options, function(msg) {
        callback(msg.value);
    });
}

IpcLocalClient.prototype.put = function(key, val, options)
{
    var ttl = (options && lib.toNumber(options.ttl)) || lib.toNumber(this.options.ttl);
    ipc.sendMsg("cache:put", { name: key, value: val, expire: ttl ? Date.now() + ttl : 0  }, options);
}

IpcLocalClient.prototype.incr = function(key, val, options, callback)
{
    var ttl = (options && lib.toNumber(options.ttl)) || lib.toNumber(this.options.ttl);
    ipc.sendMsg("cache:incr", { name: key, value: val, expire: ttl ? Date.now() + ttl : 0 }, options, function(msg) {
        if (typeof callback == "function") callback(msg.value);
    });
}

IpcLocalClient.prototype.del = function(key, options)
{
    ipc.sendMsg("cache:del", key, options);
}

IpcLocalClient.prototype.poller = function()
{
    var self = this;
    this._worker++;
    ipc.sendMsg("queue:pop", {}, this.options, function(msg) {
        if (!msg.data) {
            self.schedulePoller(self.options.interval);
        } else {
            if (!self.emit(msg.channel || "message", msg.data, function(err) {
                self.schedulePoller();
            })) {
                self.schedulePoller();
            }
        }
        self._working--;
    });
}

IpcLocalClient.prototype.publish = function(channel, msg, options, callback)
{
    ipc.sendMsg("queue:push", { channel: channel, data: msg }, options, function(msg) {
        if (typeof callback == "function") callback(msg.value);
    });
}


IpcLocalClient.prototype.limiter = function(options, callback)
{
    ipc.sendMsg("ipc:limiter", options, function(msg) {
        callback(msg.consumed ? 0 : msg.delay);
    });
}

