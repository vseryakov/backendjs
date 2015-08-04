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

// Queue client using Redis server, implements reliable queue using sorted sets, one for the new messages and one for the
// messages that are being processed if timeout is provided. With the timeout this queue works similar to AWS SQS.
//
// The `queue` config property specifies the name for the queue, if not given `queue` is used
//
// The `interval` config property defines how often to check for new messages, it does polling
//
// The `visibilityTimeout` property specifies to use a shadow queue where all messages that are being processed are stored,
// while the message is processed the timestamp will be updated so the message stays in the queue, if a worker exists or crashes without
// confirming the message finished it will be put back into the work queue after `visibilityTimeout` milliseconds. The queue name that
// keeps active messages is appended with #.
//
//
module.exports = client;

var client = {
    name: "redisq",
};

ipc.modules.push(client);

client.createClient = function(host, options)
{
    if (host.match(/^redisq:/)) return new IpcRedisClient(host, options);
}

function IpcRedisClient(host, options)
{
    var self = this;
    Client.call(this, host, options);
    if (!this.options.queue) this.options.queue = "queue";
    this.options.interval = lib.toNumber(this.options.interval, { dflt: 5000, min: 50 });
    this.options.visibilityTimeout = lib.toNumber(this.options.visibilityTimeout, { min: 0, dflt: this.options.interval });

    this.client = redis.createClient(this.port || 6379, this.hostname || "127.0.0.1", this.options);
    this.client.on("error", function(err) {
        logger.error("redis:", self.host, err);
    });
    this.client.on("ready", function() {
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

IpcRedisClient.prototype.monitorQueue = function()
{
    var now = Date.now() - this.options.visibilityTimeout;

    var script = "local time = tonumber(KEYS[2]);" +
            "local vals = redis.call('zrangebyscore', KEYS[1], 0, time);" +
            "redis.call('zremrangebyscore', KEYS[1], 0, time);" +
            "for i, val in ipairs(vals) do redis.call('zadd', KEYS[1] .. '#', time+i, (val)); end;" +
            "return #vals;";

    this.client.eval(script, 2, this.queue + ":active", now, function(err) {
        if (err) logger.error("monitorQueue:", err);
    });
}

IpcRedisClient.prototype.monitor = function()
{
    if (this.options.queue && !this._monitor && this.options.visibilityTimeout) {
        this._monitor = setInterval(this.monitorQueue.bind(this), this.options.visibilityTimeout * 1.1);
        this.monitorQueue();
    }
}

IpcRedisClient.prototype.poller = function()
{
    var self = this;
    if (!this.options.queue) return;

    if (this.options.visibilityTimeout) {
        var script = "local val = redis.call('zrange', KEYS[1], 0, 0)[1];"+
                "if val then redis.call('zremrangebyrank', KEYS[1], 0, 0);redis.call('zadd', KEYS[1] .. '#', tonumber(KEYS[2]), val);end;" +
                "return val";
        var script2 = "redis.call('zrem', KEYS[1] .. '#', KEYS[3]);redis.call('zadd', KEYS[1], tonumber(KEYS[2]), KEYS[3])";
    } else {
        var script = "local val = redis.call('zrange', KEYS[1], 0, 0)[1];"+
                "if val then redis.call('zremrangebyrank', KEYS[1], 0, 0); end;" +
                "return val";
        var script2 = "redis.call('zadd', KEYS[1], tonumber(KEYS[2]), KEYS[3])";
    }

    this.client.eval(script, 2, this.options.queue, Date.now(), function(err, data) {
        if (err) logger.error("poller:", err.stack);
        if (!data) {
            if (self._polling) setTimeout(self.poller.bind(self), self.options.interval);
            return;
        }
        var now = Date.now(), timer;
        var msg = lib.jsonParse(data, { obj: 1, error: 1 });

        // Keep updating timestamp to prevent the job being placed back to the active queue
        if (self.options.visibilityTimeout) {
            timer = setInterval(function() {
                self.client.zadd(self.options.queue + "#", now, data, function(err) {
                    if (err) logger.error("ipc.poller:", err.stack);
                    if (err) clearInterval(timer);
                });
            }, self.options.visibilityTimeout * 0.9);
        }

        if (!self.emit(msg.channel || "message", msg.data, function(err, next) {
            clearInterval(timer);
            if (err && err.status >= 500) {
                this.client.eval(script2, 3, this.options.queue, now, data, function(err) {
                    if (err) logger.error("ipc.poller:", err.stack);
                    if (self._polling) setImmediate(self.poller.bind(self));
                });
            } else {
                if (self.options.visibilityTimeout) {
                    self.client.zrem(self.options.queue + "#", data, function(err) {
                        if (err) logger.error("ipc.poller:", err.stack);
                        if (self._polling) setImmediate(self.poller.bind(self));
                    });
                } else {
                    if (self._polling) setImmediate(self.poller.bind(self));
                }
            }
        })) {
            if (self.options.visibilityTimeout) {
                clearInterval(timer);
                self.client.eval(script2, 3, self.options.queue, now, data, function(err) {
                    if (err) logger.error("ipc.poller:", err.stack);
                    if (self._polling) setImmediate(self.poller.bind(self));
                });
            } else {
                if (self._polling) setImmediate(self.poller.bind(self));
            }
        }
    });
}

IpcRedisClient.prototype.publish = function(channel, msg, options, callback)
{
    this.client.zadd(this.options.queue, Date.now(), JSON.stringify({ channel: channel, data: msg }), callback);
}

