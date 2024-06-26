//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const util = require('util');
const logger = require(__dirname + '/../logger');
const core = require(__dirname + '/../core');
const lib = require(__dirname + '/../lib');
const ipc = require(__dirname + "/../ipc");
const Client = require(__dirname + "/client");

// Cache/queue client based on Redis server using https://github.com/NodeRedis/node_redis3
//
// The queue client implements reliable queue using sorted sets, one for the new messages and one for the
// messages that are being processed if timeout is provided. With the timeout this queue works similar to AWS SQS.
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
// Protocol rediss: will use TLS to connect to Redis servers, this is required for RedisCche Serverless
//
// The `threshold` property defines the upper limit of how many active messages can be in the queue when to show an error message, this is
// for monitoring queue performance
//
// The rate limiter implementes Tocken Bucket algorithm using Lua script inside Redis, the only requirement is that
// all workers to use NTP for time synchronization
//
// Examples:
//
//      ipc-client=redis://host1
//      ipc-client-options-interval=1000
//      ipc-client=redis://host1?bk-visibilityTimeout=30000&bk-count=2
//

const client = {
    name: "redis",
    scripts: {
        sget: [
            "redis.replicate_commands()",
            "local val = redis.call(KEYS[2], KEYS[1]);",
            "local size = redis.call('scard', KEYS[1]);",
            "local ttl = tonumber(KEYS[3]);",
            "if KEYS[2] == 'spop' and ttl > 0 then",
            "  while (val) do",
            "    if redis.call('exists', val .. '#') == 0 then break; end;",
            "    val = redis.call('spop', KEYS[1]);",
            "  end;",
            "  if val then redis.call('psetex', val .. '#', ttl, ''); end;",
            "end;",
            "return {val,size};",
        ].join("\n"),

        monitor: [
            "local time = tonumber(KEYS[2]);",
            "local vals = redis.call('zrangebyscore', KEYS[1] .. '#', 0, time);",
            "redis.call('zremrangebyscore', KEYS[1] .. '#', 0, time);",
            "for i, val in ipairs(vals) do redis.call('zadd', KEYS[1], time+i, (val)); end;",
            "return redis.call('zcount', KEYS[1], '-inf', '+inf');"
        ].join("\n"),

        vpoller: [
            "local val = redis.call('zrange', KEYS[1], 0, 0)[1];",
            "if val then ",
            "  redis.call('zremrangebyrank', KEYS[1], 0, 0);",
            "  redis.call('zadd', KEYS[1] .. '#', tonumber(KEYS[2]), val);",
            "end;",
            "local count1 = redis.call('zcount', KEYS[1], '-inf', '+inf');",
            "local count2 = redis.call('zcount', KEYS[1] .. '#', '-inf', '+inf');",
            "return {val,count1,count2};"
        ].join(""),

        poller: [
            "local val = redis.call('zrange', KEYS[1], 0, 0)[1];",
            "if val then redis.call('zremrangebyrank', KEYS[1], 0, 0); end;",
            "local count = redis.call('zcount', KEYS[1], '-inf', '+inf');",
            "return {val,count};"
        ].join(""),

        stats: [
            "local count1 = redis.call('zcount', KEYS[1], '-inf', '+inf');",
            "local count2 = redis.call('zcount', KEYS[1] .. '#', '-inf', '+inf');",
            "return {count1,count2};"
        ].join(""),

        limiter: [
            "local name = KEYS[1];",
            "local rate = tonumber(KEYS[2]);",
            "local max = tonumber(KEYS[3]);",
            "local interval = tonumber(KEYS[4]);",
            "local now = tonumber(KEYS[5]);",
            "local ttl = tonumber(KEYS[6]);",
            "local reset = tonumber(KEYS[7]);",
            "local multi = tonumber(KEYS[8]);",
            "local count = tonumber(redis.call('HGET', name, 'c'));",
            "local mtime = tonumber(redis.call('HGET', name, 'm'));",
            "local lastint = tonumber(redis.call('HGET', name, 'i'));",
            "if multi and lastint then",
            "   interval = lastint;",
            "end;",
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
            "   redis.call('HSET', name, 'c', count);",
            "end;",
            "redis.call('HSET', name, 'm', now);",
            "local total = redis.call('HINCRBY', name, 't', 1);",
            "if ttl > 0 then",
            "   redis.call('EXPIRE', name, ttl);",
            "end;",
            "if count < 1 then",
            "   if multi and multi ~= 0 then",
            "      interval = math.min(30000000000, interval * math.abs(multi));",
            "      redis.call('HSET', name, 'i', interval);",
            "   end;",
            "   if reset > 0 then",
            "      redis.call('DEL', name);",
            "   end;",
            "   return {interval - elapsed,count,total,elapsed,interval};",
            "else",
            "   if reset > 1 and total >= reset then",
            "      redis.call('DEL', name);",
            "   else",
            "      redis.call('HSET', name, 'c', count - 1);",
            "      if multi and multi < 0 then",
            "          redis.call('HDEL', name, 'i');",
            "      end;",
            "   end;",
            "   return {0,count,total,elapsed,interval};",
            "end"
        ].join(""),

        getset: [
            "local v = redis.call('get', KEYS[1]);",
            "if not v then",
            "   redis.call('set', KEYS[1], KEYS[3]);",
            "   local ttl = tonumber(KEYS[2]);",
            "   if ttl > 0 then",
            "      redis.call('pexpire', KEYS[1], ttl);",
            "   end;",
            "end;",
            "return v;",
        ].join(""),

        setmax: [
            "local v = tonumber(redis.call('get', KEYS[1]));",
            "if not v or v < tonumber(KEYS[2]) then",
            "   redis.call('set', KEYS[1], KEYS[2]);",
            "   local ttl = tonumber(KEYS[3]);",
            "   if ttl > 0 then",
            "      redis.call('pexpire', KEYS[1], ttl);",
            "   end;",
            "end;",
            "return v;",
        ].join(""),

        hmsetmax: [
            "local v = tonumber(redis.call('hget', KEYS[1], KEYS[2]));",
            "if not v or v < tonumber(KEYS[3]) then",
            "   redis.call('hmset', KEYS[1], KEYS[2], KEYS[3]);",
            "   local ttl = tonumber(KEYS[4]);",
            "   if ttl > 0 then",
            "      redis.call('pexpire', KEYS[1], ttl);",
            "   end;",
            "end;",
            "return v;",
        ].join(""),

        lock: [
            "local ttl = tonumber(KEYS[2]);",
            "if tonumber(KEYS[4]) == 1 then",
            "   redis.call('set', KEYS[1], KEYS[3]);",
            "   if ttl > 0 then",
            "      redis.call('pexpire', KEYS[1], ttl);",
            "   end;",
            "end;",
            "local v = redis.call('setnx', KEYS[1], KEYS[3]);",
            "if v == 1 and ttl > 0 then",
            "   redis.call('pexpire', KEYS[1], ttl);",
            "end;",
            "return v;",
        ].join(""),

    },
};
module.exports = client;

ipc.modules.push(client);

client.createClient = function(url, options)
{
    if (/^rediss?:/.test(url)) return new IpcRedisClient(url, options);
}

function IpcRedisClient(url, options)
{
    Client.call(this, url, options);
    this.applyOptions();
    this.client = this.initClient(this.hostname, this.port);
}
util.inherits(IpcRedisClient, Client);

IpcRedisClient.prototype.close = function()
{
    Client.prototype.close.call(this);
    if (this.client) this.client.quit();
    if (this.subclient) this.subclient.quit();
    this._monitorTimer = clearInterval(this._monitorTimer);
}

IpcRedisClient.prototype.applyOptions = function(options)
{
    Client.prototype.applyOptions.call(this, options);
    this.options.interval = lib.toNumber(this.options.interval, { dflt: 500, min: 50 });
    this.options.retryInterval = lib.toNumber(this.options.retryInterval, { dflt: 5000, min: 50 });
    this.options.visibilityTimeout = lib.toNumber(this.options.visibilityTimeout, { min: 0 });
    this.options.threshold = lib.toNumber(this.options.threshold, { min: 0 });
    this.options.maxTimeout = lib.toNumber(this.options.maxTimeout, { dflt: 3600000, min: 60000 });
    this.options.enable_offline_queue = lib.toBool(this.options.enable_offline_queue);
    this.options.retry_max_delay = lib.toNumber(this.options.retry_max_delay, { min: 1000, dflt: 30000 });
    this.options.max_attempts = lib.toNumber(this.options.max_attempts, { min: 0 });
}

IpcRedisClient.prototype.initClient = function(host, port)
{
    host = String(host).split(":");
    // For reconnect or failover to work need retry policy
    this.options.retry_strategy = (options) => {
        logger.logger(options.attempt == 2 ? "error": "dev", "initClient:", this.url, options);
        if (this.options.max_attempts > 0 && options.attempt > this.options.max_attempts) undefined;
        return Math.min(options.attempt * 200, this.options.retry_max_delay);
    }
    if (this.protocol == "rediss:" && !this.options.tls) {
        this.options.tls = {};
    }
    var Redis = require("redis");
    var client = new Redis.createClient(host[1] || port || this.options.port || 6379, host[0] || "127.0.0.1", this.options);
    client.on("error", (err) => { logger.error(core.role, this.queueName, this.url, err) });
    client.on("ready", this.emit.bind(this, "ready"));
    client.on("message", this.onMessage.bind(this));
    logger.debug("initClient:", this.url, "connecting:", host, port, this.options);
    return client;
}

IpcRedisClient.prototype.onMessage = function(channel, msg)
{
    logger.dev("onMessage:", channel, msg);
    this.emit(channel, msg);
}

IpcRedisClient.prototype.limiter = function(options, callback)
{
    this.client.eval(client.scripts.limiter, 8,
                     options.name,
                     options.rate,
                     options.max,
                     options.interval,
                     Date.now(),
                     Math.ceil(options.ttl/1000),
                     options.reset,
                     options.multiplier,
                     (err, rc) => {
        rc = rc || lib.empty;
        if (err) logger.error("limiter:", core.role, this.url, lib.traceError(err));
        callback(lib.toNumber(rc[0]), {
            queueName: this.queueName,
            delay: lib.toNumber(rc[0]),
            count: lib.toNumber(rc[1]),
            total: lib.toNumber(rc[2]),
            elapsed: lib.toNumber(rc[3]),
            interval: lib.toNumber(rc[4]),
        });
    });
}

IpcRedisClient.prototype.subscribe = function(channel, options, callback)
{
    if (!this.subclient) {
        this.subclient = this.initClient(this.hostname, this.port);
    }
    Client.prototype.subscribe.call(this, channel, options, callback);
    if (!this.subclient.enable_offline_queue) this.subclient.enable_offline_queue = true;
    this.subclient.subscribe(channel);
}

IpcRedisClient.prototype.unsubscribe = function(channel, options, callback)
{
    Client.prototype.unsubscribe.call(this, channel, options, callback);
    if (this.subclient) {
        if (!this.subclient.enable_offline_queue) this.subclient.enable_offline_queue = true;
        this.subclient.unsubscribe(channel);
    }
}

IpcRedisClient.prototype.publish = function(channel, msg, options, callback)
{
    if (!this.client.enable_offline_queue) this.client.enable_offline_queue = true;
    this.client.publish(channel, msg, callback);
}

IpcRedisClient.prototype.stats = function(options, callback)
{
    var rc = {};
    lib.parallel([
        (next) => {
            var chan = this.channel(options);
            this.client.eval(client.scripts.stats, 1, chan, (err, count) => {
                if (!err) {
                    rc.queueCount = lib.toNumber(count[0]);
                    rc.queueRunning = lib.toNumber(count[1]);
                }
                next(err);
            });
        },
        (next) => {
            this.client.info(function(err, str) {
                lib.strSplit(str, "\n").filter((x) => (x.indexOf(":") > -1)).forEach((x) => {
                    x = x.split(":");
                    rc[x[0]] = x[1];
                });
                next(err);
            });
        },
    ], (err) => {
        lib.tryCall(callback, err, rc);
    }, true);
}

IpcRedisClient.prototype.clear = function(pattern, callback)
{
    if (pattern) {
        this.client.keys(pattern, (e, keys) => {
            for (var i in keys) {
                this.client.del(keys[i], lib.noop);
            }
            lib.tryCall(callback, e);
        });
    } else {
        this.client.flushall(callback);
    }
}

IpcRedisClient.prototype.get = function(key, options, callback)
{
    if (options.listName) {
        if (key == "*") {
            if (options.del) {
                this.client.spop(options.listName, 9999999999, callback);
            } else {
                this.client.smembers(options.listName, callback);
            }
        } else
        if (!key) {
            this.client.eval(client.scripts.sget, 3, options.listName, options.del ? "spop" : "srandmember", lib.toNumber(options.ttl), callback);
        } else {
            this.client.sismember(options.listName, key, callback);
        }
    } else
    if (options.mapName) {
        if (key == "*") {
            this.client.hgetall(options.mapName, callback);
        } else
        if (Array.isArray(key)) {
            this.client.hmget(options.mapName, key, callback);
        } else {
            this.client.hget(options.mapName, key, callback);
        }
    } else
    if (Array.isArray(key)) {
        this.client.mget(key, callback);
    } else
    if (options.set) {
        var ttl = lib.toNumber(options.ttl) || lib.toNumber(this.options.ttl);
        this.client.eval(client.scripts.getset, 3, key, ttl, options.set, callback);
    } else {
        this.client[options.del ? "getdel" : "get"](key, callback);
    }
}

IpcRedisClient.prototype.put = function(key, val, options, callback)
{
    var ttl = lib.toNumber(options.ttl) || lib.toNumber(this.options.ttl);
    switch (typeof val) {
    case "boolean":
    case "number":
    case "string":
        break;
    default:
        if (!(options.mapName && key == "*") &&
            !(options.listName && Array.isArray(val))) val = lib.stringify(val);
    }
    if (options.listName) {
        if (lib.isEmpty(val)) return lib.tryCall(callback);
        const multi = this.client.multi();
        multi.sadd(options.listName, val);
        if (ttl > 0) multi.pexpire(options.listName, ttl);
        multi.exec(callback);
    } else
    if (options.mapName) {
        if (options.setmax) {
            this.client.eval(client.scripts.hmsetmax, 4, options.mapName, key, val, ttl, callback);
        } else {
            const multi = this.client.multi();
            if (key == "*") {
                multi.hmset(options.mapName, val);
            } else {
                multi.hmset(options.mapName, key, val);
            }
            if (ttl > 0) multi.pexpire(options.mapName, ttl);
            multi.exec(callback);
        }
    } else {
        if (options.setmax) {
            this.client.eval(client.scripts.setmax, 3, key, val, ttl, callback);
        } else
        if (ttl > 0) {
            this.client.psetex([key, ttl, val], callback || lib.noop);
        } else {
            this.client.set([key, val], callback || lib.noop);
        }
    }
}

IpcRedisClient.prototype.incr = function(key, val, options, callback)
{
    var ttl = lib.toNumber(options.ttl) || lib.toNumber(this.options.ttl);
    var map = options.mapName || lib.isObject(val) && key;
    if (map) {
        var multi = this.client.multi();
        if (options.returning == "old") multi.hgetall(map);
        if (typeof val == "number") {
            multi.hincrby(map, key, val);
        } else {
            for (const p in val) {
                if (typeof val[p] == "number") {
                    multi.hincrby(map, p, val[p]);
                } else {
                    multi.hset(map, p, val[p]);
                }
            }
        }
        if (ttl > 0) multi.pexpire(map, ttl);
        if (["new", "*"].includes(options.returning)) multi.hgetall(map);
        multi.exec(callback);
    } else {
        if (ttl > 0) {
            this.client.multi().
                 incrby(key, lib.toNumber(val)).
                 pexpire(key, ttl).
                 exec((e, v) => {
                if (callback) callback(e, v && v[0]);
            });
        } else {
            this.client.incrby(key, lib.toNumber(val), callback);
        }
    }
}

IpcRedisClient.prototype.del = function(key, options, callback)
{
    if (options.listName) {
        this.client.srem(options.listName, key, callback || lib.noop)
    } else
    if (options.mapName) {
        if (key == "*") {
            this.client.del(options.mapName, callback || lib.noop)
        } else {
            this.client.hdel(options.mapName, key, callback || lib.noop)
        }
    } else {
        this.client.del(key, callback || lib.noop);
    }
}

IpcRedisClient.prototype.lock = function(name, options, callback)
{
    var ttl = lib.toNumber(options.ttl);
    var set = lib.toBool(options.set);
    this.client.eval(client.scripts.lock, 4, name, ttl, process.pid, set ? 1 : 0, callback);
}

IpcRedisClient.prototype.unlock = function(name, options, callback)
{
    this.client.del(name, callback || lib.noop);
}

IpcRedisClient.prototype.publishQueue = function(job, options, callback)
{
    var chan = this.channel(options);
    this.client.zadd(chan, Date.now(), job, callback);
}

IpcRedisClient.prototype._monitorQueue = function(options)
{
    if (!this.client.ready) return;
    var chan = this.channel(options);
    var now = Date.now() - lib.validPositive(options.visibilityTimeout, this.options.visibilityTimeout);
    this.client.eval(client.scripts.monitor, 2, chan, now, (err, count) => {
        if (err) logger.error("monitorQueue:", this.url, err);
        // Report when queue size reaches configured threshold
        if (!count || !this.options.threshold) return;
        count = lib.toNumber(count);
        if (count >= this.options.threshold) logger.error("monitorQueue:", core.role, this.url, this.options, "queue size:", count);
    });
}

IpcRedisClient.prototype.monitorQueue = function(options)
{
    var visibilityTimeout = lib.validPositive(options.visibilityTimeout, this.options.visibilityTimeout);
    if (!this._monitorTimer && visibilityTimeout) {
        this._monitorTimer = setInterval(this._monitorQueue.bind(this, options), visibilityTimeout);
        this._monitorQueue(options);
    }
}

IpcRedisClient.prototype.pollQueue = function(options)
{
    var visibilityTimeout = lib.validPositive(options.visibilityTimeout, this.options.visibilityTimeout);
    var retryInterval = lib.validPositive(options.retryInterval, this.options.retryInterval);
    var interval = lib.validPositive(options.interval, this.options.interval);
    var script = visibilityTimeout ? client.scripts.vpoller : client.scripts.poller;
    var chan = this.channel(options), self = this;

    this.client.eval(script, 2, chan, Date.now(), (err, rc) => {
        if (err) logger.error("pollQueue:", self.name, chan, core.role, lib.traceError(err));
        if (!rc || !rc[0] || err) {
            self.schedulePollQueue(options, retryInterval);
            return;
        }
        var vtimer, done, data = rc[0];
        var msg = lib.jsonParse(data, { datatype: "obj", logger: "error" }) || data;
        if (rc[1]) msg.queueAvailableCount = rc[1];
        if (rc[2]) msg.queueInvisibleCount = rc[2];
        // Check message timestamps if not ready yet then keep it hidden
        if (visibilityTimeout) {
            var now = Date.now();
            if (msg.endTime > 0 && msg.endTime < now) {
                self.client.zrem(chan + "#", data, (err) => {
                    if (err) logger.error("pollQueue:", self.name, chan, core.role, lib.traceError(err));
                    self.schedulePollQueue(options, retryInterval);
                });
                return;
            }
            if (msg.startTime > 0 && msg.startTime - now > self.options.interval) {
                let timeout = msg.startTime - now;
                if (timeout > self.options.maxTimeout) timeout = self.options.maxTimeout;
                self.client.zadd(chan + "#", now + timeout, data, (err) => {
                    if (err) logger.error("pollQueue:", self.name, chan, core.role, lib.traceError(err));
                    self.schedulePollQueue(options, retryInterval);
                });
                return;
            }
            // Delete immediately, this is a one-off message not to be handled or repeated
            if (msg.noWait) {
                self.client.zrem(chan + "#", data);
            } else
            // Delay deletion in case checks need to be done for uniqueness or something else
            if (msg.noWaitTimeout > 0) {
                setTimeout(() => {
                    if (done) return;
                    msg.noWait = 1;
                    self.client.zrem(chan + "#", data);
                }, msg.noWaitTimeout * 1000);
            }
        }
        // Keep updating timestamp to prevent the job being placed back to the active queue
        var vtimeout = msg.visibilityTimeout > 0 ? msg.visibilityTimeout : visibilityTimeout;
        if (vtimeout && !msg.noWait) {
            Object.defineProperty(msg, "__msgid", { enumerable: false, value: data });
            if (msg.visibilityTimeout > 0) self.client.zadd(chan + "#", Date.now(), data);
            vtimer = setInterval(() => {
                if (done) return;
                self.client.zadd(chan + "#", Date.now(), data, (err) => {
                    if (err) logger.error("pollQueue:", self.name, chan, core.role, lib.traceError(err));
                    if (err) clearInterval(vtimer);
                });
            }, vtimeout * 0.8);
        }

        if (!self.emit(chan, msg, (err, next) => {
            if (done) return;
            done = 1;
            clearInterval(vtimer);

            if (!msg.noVisibility && (err && err.status >= 500 || msg.noWait)) {
                setTimeout(() => {
                    const timeout = Date.now() + lib.toNumber(msg.retryVisibilityTimeout && msg.retryVisibilityTimeout[err.status]);
                    self.client.zadd(chan + (visibilityTimeout ? "#" : ""), timeout, data, (err) => {
                        if (err) logger.error("pollQueue:", self.name, chan, core.role, lib.traceError(err));
                        self.schedulePollQueue(options, interval);
                    });
                }, self.options.visibilityTimeout ? 0 : retryInterval);
            } else {
                if (visibilityTimeout) {
                    self.client.zrem(chan + "#", data, (err) => {
                        if (err) logger.error("pollQueue:", self.name, chan, core.role, lib.traceError(err));
                        self.schedulePollQueue(options, interval);
                    });
                } else {
                    self.schedulePollQueue(options, interval);
                }
            }
        })) {
            done = 1;
            clearInterval(vtimer);
            self.schedulePollQueue(options, interval);
        }
    });
}

IpcRedisClient.prototype.unpublishQueue = function(msg, options, callback)
{
    if (!msg.__msgid) return lib.tryCall(callback);
    var chan = this.channel(options);
    this.client.zrem(chan + "#", msg.__msgid, callback);
}
