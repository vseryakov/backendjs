//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var util = require('util');
var path = require('path');
var logger = require(__dirname + '/../logger');
var core = require(__dirname + '/../core');
var lib = require(__dirname + '/../lib');
var ipc = require(__dirname + "/../ipc");
var Client = require(__dirname + "/ipc_client");
var Memcached = require("memcached");

// Cache/queue client using Redis server
module.exports = client;

var client = {
    name: "memcache",
};

ipc.modules.push(client);

client.createClient = function(host, options)
{
    if (host.match(/^memcache:/)) return new IpcMemcacheClient(host, options);
}

function IpcMemcacheClient(host, options)
{
    var self = this;
    Client.call(this, host, options);
    this.host = this.host.replace(/^[a-z]+:\/\//gi,"").split(",");
    this.client = new Memcached(this.host, this.options);
    this.client.on("error", function(err) {
        logger.error("memcache:", self.host, err);
    });
    this.client.on("ready", function() {
        self.emit("ready");
    });
}
util.inherits(IpcMemcacheClient, Client);

IpcMemcacheClient.prototype.close = function()
{
    Client.prototype.close.call(this);
    this.client.end();
}

IpcMemcacheClient.prototype.stats = function(callback)
{
    this.client.stats(function(e,v) { callback(v) });
}

IpcMemcacheClient.prototype.clear = function()
{
    this.client.flush();
}

IpcMemcacheClient.prototype.keys = function(callback)
{
    this.client.items(function(err, items) {
        if (err || !items || !items.length) return callback([]);
        var item = items[0], keys = [];
        var keys = Object.keys(item);
        keys.pop();
        lib.forEachSeries(keys, function(stats, next) {
            memcached.cachedump(item.server, stats, item[stats].number, function(err, response) {
                if (response) keys.push(response.key);
                next(err);
            });
        }, function() {
            callback(keys);
        });
    });
}

IpcMemcacheClient.prototype.get = function(key, options, callback)
{
    this.client.get(key, function(e, v) { callback(v) });
}

IpcMemcacheClient.prototype.put = function(key, val, options)
{
    this.client.set(key, val, options && options.ttl ? Math.ceil(options.ttl/1000) : 0);
}

IpcMemcacheClient.prototype.incr = function(key, val, options, callback)
{
    this.client.incr(key, val, options && options.ttl ? Math.ceil(options.ttl/1000) : 0, function(e, v) {
        if (typeof callback == "function") callback(v);
    });
}

IpcMemcacheClient.prototype.del = function(key, options)
{
    this.client.del(key);
}

