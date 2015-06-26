//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var url = require('url');
var util = require('util');
var logger = require(__dirname + '/../logger');
var core = require(__dirname + '/../core');
var lib = require(__dirname + '/../lib');
var ipc = require(__dirname + "/../ipc");
var Client = require(__dirname + "/ipc_client");
var redis = require("redis");

// Cache/queue client using Redis server
module.exports = client;

var client = {
    name: "redis",
};

ipc.modules.push(client);

client.createClient = function(host, options)
{
    if (host.match(/^redis:/)) return new IpcRedisClient(host, options);
}

function IpcRedisClient(host, options)
{
    var self = this;
    Client.call(this, host, options);
    this.callbacks = {};
    if (typeof this.options.enable_offline_queue == "undefined") this.options.enable_offline_queue = false;

    var h = url.parse(this.host);
    this.port = h.port || 6379;
    this.host = h.hostname || "127.0.0.1";
    this.client = redis.createClient(this.port, this.host, this.options);
    this.client.on("error", function(err) {
        logger.error("redis:", self.host, err);
    });
    this.client.on("ready", function() {
        this.on("pmessage", function(channel, message) {
            var cb = self.callbacks[channel];
            if (cb) cb[0](cb[1], channel, message);
        });
        self.emit("ready");
    })
}
util.inherits(IpcRedisClient, Client);

IpcRedisClient.prototype.close = function()
{
    this.client.quit();
}

IpcRedisClient.prototype.stats = function(callback)
{
    this.client.info(function(e,v) {
        v = lib.strSplit(v, "\n").filter(function(x) { return x.indexOf(":") > -1 }).map(function(x) { return x.split(":") }).reduce(function(x,y) { x[y[0]] = y[1]; return x }, {});
        callback(v);
    });
}

IpcRedisClient.prototype.clear = function()
{
    this.client.flushall();
}

IpcRedisClient.prototype.keys = function(callback)
{
    this.client.keys("*", function(e,v) { cb(v) });
}

IpcRedisClient.prototype.get = function(key, options, callback)
{
    this.client.get(key, function(e, v) { callback(v); });
}

IpcRedisClient.prototype.put = function(key, val, options)
{
    if (options && options.ttl > 0) {
        this.client.setex([key, Math.ceil(options.ttl/1000), val], lib.noop);
    } else {
        this.client.set([key, val], lib.noop);
    }
}

IpcRedisClient.prototype.incr = function(key, val, options, callback)
{
    this.client.incrby(key, val, function(e, v) {
        if (typeof callback == "function") callback(v);
    });
}

IpcRedisClient.prototype.del = function(key, options)
{
    this.client.del(key, lib.noop);
}

IpcRedisClient.prototype.subscribe = function(key, callback, data)
{
    this.callbacks[key] = [ callback, data ];
    this.client.psubscribe(key);
}

IpcRedisClient.prototype.unsubscribe = function(key)
{
    delete this.callbacks[key];
    this.client.punsubscribe(key);
}

IpcRedisClient.prototype.publish = function(key, data, callback)
{
    this.client.publish(key, data, callback);
}

