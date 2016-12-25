//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var util = require('util');
var path = require('path');
var logger = require(__dirname + '/../lib/logger');
var core = require(__dirname + '/../lib/core');
var lib = require(__dirname + '/../lib/lib');
var ipc = require(__dirname + "/../lib/ipc");
var Client = require(__dirname + "/../lib/ipc_client");

// Cache client based on Memcached server using https://github.com/3rd-Eden/node-memcached
//
// To support more than one server use either one:
//
//     ipc-cache=memcache://host1?bk-servers=host2,host3
//
//     ipc-cache-memcache=memcache://host1
//     ipc-cache-memcache-options-servers=host1,host2
//
// To pass memcached module specific options:
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
    if (typeof this.options.idle != "number") this.options.idle = 900000;

    var Memcached = require("memcached");
    this.client = new Memcached(this.options.servers, this.options);
    this.client.on("error", function(err) {
        logger.error("memcache:", self.url, err);
        self.emit("error", err);
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
    this.client.flush(callback || lib.noop);
}

IpcMemcacheClient.prototype.get = function(key, options, callback)
{
    if (Array.isArray(key)) {
        this.client.getMulti(key, function(err, data) {
            if (!err) data = key.map(function(x) { return data[x] });
            lib.tryCall(callback, err, data);
        });
    } else {
        var self = this;
        this.client.get(key, function(err, data) {
            if (typeof data == "undefined" && options && options.set) {
                var ttl = options && lib.isNumber(options.ttl) ? options.ttl : lib.isNumber(this.options.ttl) ? this.options.ttl : 0;
                self.client.add(key, options.set, ttl > 0 ? Math.ceil(ttl/1000) : 0);
            }
            lib.tryCall(callback, err, data);
        })
    }
}

IpcMemcacheClient.prototype.put = function(key, val, options, callback)
{
    var ttl = options && lib.isNumber(options.ttl) ? options.ttl : lib.isNumber(this.options.ttl) ? this.options.ttl : 0;
    this.client.set(key, val, ttl > 0 ? Math.ceil(ttl/1000) : 0, callback || lib.noop);
}

IpcMemcacheClient.prototype.incr = function(key, val, options, callback)
{
    var self = this;
    var ttl = options && lib.isNumber(options.ttl) ? options.ttl : lib.isNumber(this.options.ttl) ? this.options.ttl : 0;
    this.client.incr(key, val, function(err, data) {
        if (!err && ttl > 0) self.client.touch(key, Math.ceil(ttl/1000));
        lib.tryCall(callback, err, data);
    })
}

IpcMemcacheClient.prototype.del = function(key, options, callback)
{
    this.client.del(key, callback || lib.noop);
}

