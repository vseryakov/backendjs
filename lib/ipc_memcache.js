//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var util = require('util');
var path = require('path');
var logger = require(__dirname + '/logger');
var core = require(__dirname + '/core');
var lib = require(__dirname + '/lib');
var ipc = require(__dirname + "/ipc");
var Client = require(__dirname + "/ipc_client");

// Cache client based on Memcached server using https://github.com/3rd-Eden/node-memcached
//
// To support more than one server used either one:
//
//     ipc-cache=memcache://host1?bk-servers=host2,host3`
//
//     ipc-cache-memcache=memcache://host1
//     ipc-cache-memcache-options-servers=host1,host2
//
// To pass memcache specific options:
//
//     ipc-cache-options-failures=5
//     ipc-cache-options-maxValue=1024
//

var client = {
    name: "memcache",
};
module.exports = client;

ipc.modules.push(client);

client.createClient = function(url, options)
{
    if (url.match(/^memcache:/)) return new IpcMemcacheClient(url, options);
}

function IpcMemcacheClient(url, options)
{
    var self = this;
    Client.call(this, url, options);
    this.options.servers = lib.strSplitUnique(this.options.servers);
    var h = (this.hostname || "127.0.0.1") + ":" + (this.port || this.options.port || 11211);
    if (this.options.servers.indexOf(h) == -1) this.options.servers.unshift(h);

    var Memcached = require("memcached");
    this.client = new Memcached(this.options.servers, this.options);
    this.client.on("error", function(err) {
        logger.error("memcache:", self.url, err);
        self.emit("error");
    });
    this.client.on("ready", this.emit.bind(this, "ready"));
}
util.inherits(IpcMemcacheClient, Client);

IpcMemcacheClient.prototype.close = function()
{
    Client.prototype.close.call(this);
    this.client.end();
}

IpcMemcacheClient.prototype.stats = function(options, callback)
{
    this.client.stats(callback);
}

IpcMemcacheClient.prototype.clear = function(pattern, callback)
{
    this.client.flush(callback);
}

IpcMemcacheClient.prototype.keys = function(pattern, callback)
{
    this.client.items(function(err, items) {
        if (err || !items || !items.length) return callback(err);
        var item = items[0], keys = [];
        var keys = Object.keys(item);
        keys.pop();
        lib.forEachSeries(keys, function(stats, next) {
            memcached.cachedump(item.server, stats, item[stats].number, function(err, response) {
                if (response) keys.push(response.key);
                next(err);
            });
        }, function(err) {
            callback(err, keys);
        });
    });
}

IpcMemcacheClient.prototype.get = function(key, options, callback)
{
    this.client.get(key, callback);
}

IpcMemcacheClient.prototype.put = function(key, val, options, callback)
{
    var ttl = options && lib.isNumber(options.ttl) ? options.ttl : lib.isNumber(this.options.ttl) ? this.options.ttl : 0;
    this.client.set(key, val, ttl > 0 ? Math.ceil(ttl/1000) : 0, callback);
}

IpcMemcacheClient.prototype.incr = function(key, val, options, callback)
{
    var ttl = options && lib.isNumber(options.ttl) ? options.ttl : lib.isNumber(this.options.ttl) ? this.options.ttl : 0;
    this.client.incr(key, val, ttl > 0 ? Math.ceil(ttl/1000) : 0, callback);
}

IpcMemcacheClient.prototype.del = function(key, options, callback)
{
    this.client.del(key, callback);
}

