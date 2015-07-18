//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  May 2015
//

var util = require("util");
var core = require(__dirname + "/../core");
var ipc = require(__dirname + "/../ipc");
var Client = require(__dirname + "/ipc_client");

// Cache client that uses the master process for storing cache items, only works inside one instance but supports
// multiple web and job workers, uses internal LRU cache out of V8 heap.
module.exports = client;

var client = {
    name: "local",
};

ipc.modules.push(client);

client.createClient = function(host, options)
{
    if (!host) return new IpcLocalClient(host, options);
}

function IpcLocalClient(host, options)
{
    Client.call(this, host, options);
    this.emit("ready");
}

util.inherits(IpcLocalClient, Client);

IpcLocalClient.prototype.stats = function(options, callback)
{
    core.modules.ipc.sendMsg("cache:stats", function(m) {
        callback(m.value);
    });
}

IpcLocalClient.prototype.keys = function(options, callback)
{
    core.modules.ipc.sendMsg("cache:keys", { name: options && options.name }, function(m) {
        callback(m.value);
    });
}

IpcLocalClient.prototype.clear = function(options)
{
    core.modules.ipc.sendMsg("cache:clear");
}

IpcLocalClient.prototype.get = function(key, options, callback)
{
    core.modules.ipc.sendMsg("cache:get", { name: key, value: options && options.set }, options, function(m) {
        callback(m.value);
    });
}

IpcLocalClient.prototype.put = function(key, val, options)
{
    core.modules.ipc.sendMsg("cache:put", key, val, options);
}

IpcLocalClient.prototype.incr = function(key, val, options, callback)
{
    core.modules.ipc.sendMsg("cache:incr", key, val, options, function(m) {
        if (typeof callback == "function") callback(m.value);
    });
}

IpcLocalClient.prototype.del = function(key, options)
{
    core.modules.ipc.sendMsg("cache:del", key, options);
}

