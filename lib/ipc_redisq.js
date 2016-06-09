//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var util = require('util');
var logger = require(__dirname + '/logger');
var core = require(__dirname + '/core');
var lib = require(__dirname + '/lib');
var ipc = require(__dirname + "/ipc");
var Client = require(__dirname + "/ipc_redisclient");

// Queue client using Redis server, implements reliable queue using sorted sets, one for the new messages and one for the
// messages that are being processed if timeout is provided. With the timeout this queue works similar to AWS SQS.
//
// The `queue` config property specifies the name for the queue, if not given `queue` is used
//
// The `interval` config property defines in ms how often to check for new messages after processing a message, i.e. after a messages processed
// it can poll immediately or after this amount of time
//
// The `retryInterval` config property defines in ms how often to check for new messages after an error or no data, i.e. on empty
// pool when no messages are processed it can poll immediately or after this amount of time
//
// The `visibilityTimeout` property specifies to use a shadow queue where all messages that are being processed are stored,
// while the message is processed the timestamp will be updated so the message stays in the queue, if a worker exists or crashes without
// confirming the message finished it will be put back into the work queue after `visibilityTimeout` milliseconds. The queue name that
// keeps active messages is appended with #.
//
//
// The `threshold` property defines the upper limit of how many active messages can be in the queue when to show an error message, this is
// for monitoring queue performance
//
// The rate limiter implementes Tocken Bucker algorithm using Lua script inside Redis, the only requirement is that
// all workers to use NTP for time synchronization
//
// Examples:
//
//      ipc-cache=redis://host1
//      ipc-cache-options-interval=1000
//      ipc-cache=redis://host1?bk-visibilityTimeout=30000&bk-count=2
//
module.exports = client;

var client = {
    name: "redisq",
    scripts: {
        monitor: [
            "local time = tonumber(KEYS[2]);",
            "local vals = redis.call('zrangebyscore', KEYS[1] .. '#', 0, time);",
            "redis.call('zremrangebyscore', KEYS[1] .. '#', 0, time);",
            "for i, val in ipairs(vals) do redis.call('zadd', KEYS[1], time+i, (val)); end;",
            "return redis.call('zcount', KEYS[1], '-inf', '+inf');"
        ].join("\n"),

        vpoller1: [
            "local val = redis.call('zrange', KEYS[1], 0, 0)[1];",
            "if val then ",
            "  redis.call('zremrangebyrank', KEYS[1], 0, 0);",
            "  redis.call('zadd', KEYS[1] .. '#', tonumber(KEYS[2]), val);",
            "end;",
            "return val"
        ].join(""),

        vpoller2: [
            "redis.call('zrem', KEYS[1] .. '#', KEYS[3]);",
            "redis.call('zadd', KEYS[1], tonumber(KEYS[2]), KEYS[3])"
        ].join(""),

        poller1: [
            "local val = redis.call('zrange', KEYS[1], 0, 0)[1];",
            "if val then redis.call('zremrangebyrank', KEYS[1], 0, 0); end;",
            "return val"
        ].join(""),

        poler2: [
            "redis.call('zadd', KEYS[1], tonumber(KEYS[2]), KEYS[3])"
        ].join(""),

        limiter: [
            "local name = KEYS[1];",
            "local rate = tonumber(KEYS[2]);",
            "local max = tonumber(KEYS[3]);",
            "local interval = tonumber(KEYS[4]);",
            "local now = tonumber(KEYS[5]);",
            "local count = tonumber(redis.call('HGET', name, 'count'));",
            "local mtime = tonumber(redis.call('HGET', name, 'mtime'));",
            "if not mtime then",
            "   count = max;",
            "   mtime = now;",
            "end;",
            "if now < mtime then",
            "   mtime = now - interval;",
            "end;",
            "local elapsed = now - mtime;",
            "if count < max then",
            "   count = math.min(max, count + rate * (elapsed / interval));",
            "   redis.call('HSET', name, 'count', count);",
            "end;",
            "redis.call('HSET', name, 'mtime', now);",
            "if count < 1 then",
            "   return interval - elapsed;",
            "else",
            "   redis.call('HSET', name, 'count', count - 1);",
            "   return 0;",
            "end"
        ].join(""),
    },
};

ipc.modules.push(client);

client.createClient = function(url, options)
{
    if (url.match(/^redisq:/)) return new IpcRedisClient(url, options);
}

function IpcRedisClient(url, options)
{
    Client.call(this, url, options);
    if (!this.options.queue) this.options.queue = "queue";
    this.options.interval = lib.toNumber(this.options.interval, { dflt: 500, min: 50 });
    this.options.retryInterval = lib.toNumber(this.options.retryInterval, { dflt: 5000, min: 50 });
    this.options.monitorInterval = lib.toNumber(this.options.monitorInterval, { min: 0 });
    this.options.visibilityTimeout = lib.toNumber(this.options.visibilityTimeout, { min: 0 });
    this.options.threshold = lib.toNumber(this.options.threshold, { min: 0 });
    this.options.maxTimeout = lib.toNumber(this.options.maxTimeout, { dflt: 3600000, min: 60000 });
}
util.inherits(IpcRedisClient, Client);

IpcRedisClient.prototype.close = function()
{
    Client.prototype.close.call(this);
    this._monitorTimer = clearInterval(this._monitorTimer);
}

IpcRedisClient.prototype.monitorQueue = function()
{
    var self = this;
    if (!this.client.ready) return;
    var now = Date.now() - this.options.visibilityTimeout;
    this.client.eval(client.scripts.monitor, 2, this.options.queue, now, function(err, count) {
        if (err) logger.error("monitorQueue:", self.url, err);
        // Report when queue size reaches configured threshold
        if (!count || !self.options.threshold) return;
        count = lib.toNumber(count);
        if (count >= self.options.threshold) logger.error("monitorQueue:", self.url, self.options, "queue size:", count);
    });
}

IpcRedisClient.prototype.monitor = function()
{
    if (this.options.queue && !this._monitorTimer && this.options.visibilityTimeout) {
        this._monitorTimer = setInterval(this.monitorQueue.bind(this), this.options.monitorInterval || this.options.visibilityTimeout);
        this.monitorQueue();
    }
}

IpcRedisClient.prototype.poller = function()
{
    var self = this;
    if (!this.options.queue) return;
    if (!this.client.ready) return self.schedulePoller(self.options.retryInterval);

    if (this.options.visibilityTimeout) {
        var script = client.scripts.vpoller1;
        var script2 = client.scripts.vpoller2;
    } else {
        var script = client.scripts.poller1;
        var script2 = client.scripts.poller2;
    }
    this.client.eval(script, 2, this.options.queue, Date.now(), function(err, data) {
        if (err) logger.error("poller:", self.url, lib.traceError(err));
        if (!data || err) {
            self.schedulePoller(self.options.retryInterval);
            return;
        }
        var timer;
        var msg = lib.jsonParse(data, { datatype: "obj", logger: "error" });
        // Check message timestamps if not ready yet then keep it hidden
        if (self.options.visibilityTimeout) {
            var now = Date.now();
            if (msg.etime > 0 && msg.etime < now) {
                self.client.zrem(self.options.queue + "#", data, function(err) {
                    if (err) logger.error("ipc.poller:", self.url, lib.traceError(err));
                    self.schedulePoller(self.options.retryInterval);
                });
                return;
            }
            if (msg.stime > 0 && msg.stime - now > self.options.interval) {
                var timeout = msg.stime - now;
                if (timeout > self.options.maxTimeout) timeout = self.options.maxTimeout;
                self.client.zadd(self.options.queue + "#", now + timeout, data, function(err) {
                    if (err) logger.error("ipc.poller:", self.url, lib.traceError(err));
                    self.schedulePoller(self.options.retryInterval);
                });
                return;
            }
        }
        // Keep updating timestamp to prevent the job being placed back to the active queue
        if (self.options.visibilityTimeout) {
            timer = setInterval(function() {
                self.client.zadd(self.options.queue + "#", Date.now(), data, function(err) {
                    if (err) logger.error("ipc.poller:", self.url, lib.traceError(err));
                    if (err) clearInterval(timer);
                });
            }, self.options.visibilityTimeout * 0.9);
        }

        if (!self.emit(msg.channel || "message", msg.data, function(err, next) {
            clearInterval(timer);
            if (err && err.status >= 500) {
                this.client.eval(script2, 3, this.options.queue, Date.now(), data, function(err) {
                    if (err) logger.error("ipc.poller:", self.url, lib.traceError(err));
                    self.schedulePoller(self.options.interval);
                });
            } else {
                if (self.options.visibilityTimeout) {
                    self.client.zrem(self.options.queue + "#", data, function(err) {
                        if (err) logger.error("ipc.poller:", self.url, lib.traceError(err));
                        self.schedulePoller(self.options.interval);
                    });
                } else {
                    self.schedulePoller(self.options.interval);
                }
            }
        })) {
            if (self.options.visibilityTimeout) {
                clearInterval(timer);
                self.client.eval(script2, 3, self.options.queue, Date.now(), data, function(err) {
                    if (err) logger.error("ipc.poller:", self.url, lib.traceError(err));
                    self.schedulePoller(self.options.interval);
                });
            } else {
                self.schedulePoller(self.options.interval);
            }
        }
    });
}

IpcRedisClient.prototype.publish = function(channel, msg, options, callback)
{
    var obj = { channel: channel, data: msg };
    if (options && options.stime) obj.stime = lib.toDate(options.stime).getTime();
    if (options && options.etime) obj.etime = lib.toDate(options.etime).getTime();
    this.client.zadd(this.options.queue, Date.now(), JSON.stringify(obj), callback);
}

IpcRedisClient.prototype.limiter = function(options, callback)
{
    var self = this;
    this.client.eval(client.scripts.limiter, 5, options.name, options.rate, options.max, options.interval, Date.now(), function(err, delay) {
        if (err) logger.error("limiter:", self.url, lib.traceError(err));
        callback(lib.toNumber(delay));
    });

}
