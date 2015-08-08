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
    if (typeof this.options.enable_offline_queue == "undefined") this.options.enable_offline_queue = false;

    this.client = redis.createClient(this.port || 6379, this.hostname || "127.0.0.1", this.options);
    this.client.on("error", function(err) {
        logger.error("redis:", self.host, err);
    });
    this.client.on("ready", function() {
        this.on("message", function(channel, message) {
            self.emit(channel, message);
        });
        self.emit("ready");
    })
}
util.inherits(IpcRedisClient, Client);

IpcRedisClient.prototype.close = function()
{
    Client.prototype.close.call(this);
    this.client.quit();
    delete this.client;
}

IpcRedisClient.prototype.stats = function(options, callback)
{
    this.client.info(function(e,v) {
        v = lib.strSplit(v, "\n").filter(function(x) { return x.indexOf(":") > -1 }).map(function(x) { return x.split(":") }).reduce(function(x,y) { x[y[0]] = y[1]; return x }, {});
        callback(v);
    });
}

IpcRedisClient.prototype.keys = function(pattern, callback)
{
    this.client.keys(pattern || "*", function(e, keys) {
        callback(keys);
    });
}

IpcRedisClient.prototype.clear = function(pattern)
{
    var self = this;
    if (pattern) {
        this.client.keys(pattern, function(e, keys) {
            if (e) return;
            for (var i in keys) {
                self.client.del(keys[i], lib.noop);
            }
        });
    } else {
        this.client.flushall();
    }
}

IpcRedisClient.prototype.get = function(key, options, callback)
{
    this.client.get(key, function(e, v) {
        callback(v);
    });
}

IpcRedisClient.prototype.put = function(key, val, options)
{
    var ttl = (options && lib.toNumber(options.ttl)) || lib.toNumber(this.options.ttl);
    if (ttl > 0) {
        this.client.setex([key, Math.ceil(ttl/1000), val], lib.noop);
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

IpcRedisClient.prototype.subscribe = function(channel, options, callback)
{
    Client.prototype.subscribe.call(this, channel, options, callback);
    this.client.subscribe(channel);
}

IpcRedisClient.prototype.unsubscribe = function(channel, options, callback)
{
    Client.prototype.unsubscribe.call(this, channel, options, callback);
    this.client.unsubscribe(channel);
}

IpcRedisClient.prototype.publish = function(channel, msg, options, callback)
{
    this.client.publish(channel, msg, callback);
}

