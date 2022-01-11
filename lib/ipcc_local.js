//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

var util = require("util");
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
    if (/^local:/.test(url)) return new IpcLocalClient(url, options);
}

function IpcLocalClient(url, options)
{
    Client.call(this, url, options);
    this.applyOptions();
    this.emit("ready");
}

util.inherits(IpcLocalClient, Client);

IpcLocalClient.prototype.applyOptions = function()
{
    this.options.interval = lib.toNumber(this.options.interval, { dflt: 1000, min: 50 });
}

IpcLocalClient.prototype.stats = function(options, callback)
{
    ipc.sendMsg("cache:stats", function(m) {
        callback(null, m.value);
    });
}

IpcLocalClient.prototype.clear = function(pattern, options, callback)
{
    ipc.sendMsg("cache:clear", { name: pattern }, callback ? function(m) { callback(null, m.value) } : null);
}

IpcLocalClient.prototype.get = function(key, options, callback)
{
    var ttl = lib.toNumber(options.ttl) || lib.toNumber(this.options.ttl);
    var opts = { name: key, now: ttl ? Date.now() : 0, expire: ttl ? Date.now() + ttl : 0, set: options.set, map: options.mapName, list: options.listName };
    ipc.sendMsg("cache:get", opts, options, callback ? function(m) { callback(null, m.value) } : null);
}

IpcLocalClient.prototype.put = function(key, val, options, callback)
{
    var ttl = lib.toNumber(options.ttl) || lib.toNumber(this.options.ttl);
    var opts = { name: key, value: val, now: ttl ? Date.now() : 0, expire: ttl ? Date.now() + ttl : 0, map: options.mapName, list: options.listName, setmax: options.setmax };
    ipc.sendMsg("cache:put", opts, options, callback ? function(m) { callback(null, m.value) } : null);
}

IpcLocalClient.prototype.incr = function(key, val, options, callback)
{
    var ttl = lib.toNumber(options.ttl) || lib.toNumber(this.options.ttl);
    var opts = { name: key, value: val, now: ttl ? Date.now() : 0, expire: ttl ? Date.now() + ttl : 0, map: options.mapName, list: options.listName };
    ipc.sendMsg("cache:incr", opts, options, callback ? function(m) { callback(null, m.value) } : null);
}

IpcLocalClient.prototype.del = function(key, options, callback)
{
    var opts = { name: key, map: options.mapName, list: options.listName };
    ipc.sendMsg("cache:del", opts, options, callback ? function(m) { callback(null, m.value) } : null);
}

IpcLocalClient.prototype.pollQueue = function(options)
{
    var chan = this.channel(options);
    ipc.sendMsg("queue:pop", {}, this.options, (msg) => {
        if (!msg.value) {
            this.schedulePollQueue(options, this.options.interval);
        } else {
            if (typeof msg.value == "string") msg.value = lib.jsonParse(msg.value, { logger: "info" });
            if (!this.emit(chan, msg.value, (err) => {
                this.schedulePollQueue(options);
            })) {
                this.schedulePollQueue(options);
            }
        }
    });
}

IpcLocalClient.prototype.publishQueue = function(job, options, callback)
{
    ipc.sendMsg("queue:push", job, options, function(msg) {
        if (callback) callback(null, msg.value);
    });
}

IpcLocalClient.prototype.limiter = function(options, callback)
{
    var opts = { name: options.name, rate: options.rate, max: options.max, interval: options.interval, expire: options.ttl > 0 ? Date.now() + options.ttl : 0, reset: options.reset };
    ipc.sendMsg("ipc:limiter", opts, (msg) => {
        callback(msg.consumed ? 0 : msg.delay, { queueName: this.queueName, delay: msg.delay, count: msg.count, total: msg.total, elapsed: msg.elapsed });
    });
}

IpcLocalClient.prototype.lock = function(name, options, callback)
{
    var ttl = lib.toNumber(options.ttl);
    var set = lib.toBool(options.set);
    ipc.sendMsg("queue:lock", { name: name, expire: ttl ? Date.now() + ttl : 0, set: set ? 1 : 0 }, options, function(msg) {
        if (callback) callback(null, msg.value);
    });
}

IpcLocalClient.prototype.unlock = function(name, options)
{
    ipc.sendMsg("queue:unlock", { name: name }, options);
}
