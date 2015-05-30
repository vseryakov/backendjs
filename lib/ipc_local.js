//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  May 2015
//

var util = require("util");
var core = require(__dirname + "/../core");
var ipc = require(__dirname + "/../ipc");
var Client = require(__dirname + "/ipc_client");

// Cache client that uses the master process for storing cache items, only works inside one instance but supports
// multiple web and job workers
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
}

util.inherits(IpcLocalClient, Client);

IpcLocalClient.prototype.stats = function(callback)
{
    core.modules.ipc.send("stats", "", "", callback);
}

IpcLocalClient.prototype.clear = function()
{
    core.modules.ipc.send("clear");
}

IpcLocalClient.prototype.keys = function(callback)
{
    core.modules.ipc.send("keys", "", "", callback);
}

IpcLocalClient.prototype.get = function(key, options, callback)
{
    core.modules.ipc.send("get", key, options && options.set, options, callback);
}

IpcLocalClient.prototype.put = function(key, val, options)
{
    core.modules.ipc.send("put", key, val, options);
}

IpcLocalClient.prototype.incr = function(key, val, options)
{
    core.modules.ipc.send("incr", key, val, options);
}

IpcLocalClient.prototype.del = function(key, options)
{
    core.modules.ipc.send("del", key, "", options);
}

