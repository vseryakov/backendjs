/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const logger = require(__dirname + '/../logger');
const lib = require(__dirname + '/../lib');
const QueueClient = require(__dirname + "/client");

const scripts = {

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

};

/**
 * Queue client based on Redis server using https://github.com/NodeRedis/node_redis3
 *
 * The queue client implements reliable queue using sorted sets, one for the new messages and one for the
 * messages that are being processed if timeout is provided. With the timeout this queue works similar to AWS SQS.
 *
 * @param {int} [options.interval] config property defines in ms how often to check for new messages after processing a message, i.e. after a messages processed
 * it can poll immediately or after this amount of time
 *
 * @param {int} [options.retryInterval] config property defines in ms how often to check for new messages after an error or no data, i.e. on empty
 * pool when no messages are processed it can poll immediately or after this amount of time
 *
 * @param {int} [options.visibilityTimeout] property specifies to use a shadow queue where all messages that are being processed are stored,
 * while the message is processed the timestamp will be updated so the message stays in the queue, if a worker exists or crashes without
 * confirming the message finished it will be put back into the work queue after `visibilityTimeout` milliseconds. The queue name that
 * keeps active messages is appended with #.
 *
 * @param {int} [options.threshold] property defines the upper limit of how many active messages can be in the queue when to show an error message, this is
 * for monitoring queue performance
 *
 * @param {boolean|int|object} [options.tls] can be true or 1 to just enable default TLS properties
 *
 * @example
 *  -queue-default=redis://host1
 *  -queue-default-options-interval=1000
 *  -queue-redis=redis://host1?bk-visibilityTimeout=30000&bk-count=2
 *  -queue-default=redis://host1?bk-tls=1
 *
 * @memberOf module:queue
 */

var redis;

class RedisClient extends QueueClient {

    constructor(options) {
        super(options);
        this.name = "redis";
        this.applyOptions();

        if (this.options.tls === true || this.options.tls === 1) {
            this.options.tls = {};
        }

        // For reconnect or failover to work need retry policy
        this.options.retry_strategy = (options) => {
            logger.logger(options.attempt == 2 ? "error": "dev", "connect:", this.url, options);
            if (this.options.max_attempts > 0 && options.attempt > this.options.max_attempts) undefined;
            return Math.min(options.attempt * 200, this.options.retry_max_delay);
        }
        this.client = this.connect(this.hostname, this.port);
    }

    close() {
        super.close();
        if (this.client) this.client.quit();
        if (this.subclient) this.subclient.quit();
        delete this.client;
        delete this.subclient;
        delete this.options.retry_strategy;
        clearInterval(this._monitorTimer);
    }

    applyOptions(options) {
        super.applyOptions(options);
        this.options.interval = lib.toNumber(this.options.interval, { dflt: 1000, min: 50 });
        this.options.retryInterval = lib.toNumber(this.options.retryInterval, { dflt: 3000, min: 50 });
        this.options.visibilityTimeout = lib.toNumber(this.options.visibilityTimeout, { min: 0 });
        this.options.threshold = lib.toNumber(this.options.threshold, { min: 0 });
        this.options.maxTimeout = lib.toNumber(this.options.maxTimeout, { dflt: 3600000, min: 60000 });
        this.options.enable_offline_queue = lib.toBool(this.options.enable_offline_queue);
        this.options.retry_max_delay = lib.toNumber(this.options.retry_max_delay, { min: 1000, dflt: 30000 });
        this.options.max_attempts = lib.toNumber(this.options.max_attempts, { min: 0 });
    }

    connect(hostname, port) {
        if (!redis) redis = require("redis");
        var host = String(hostname).split(":");
        var client = new redis.createClient(host[1] || port || this.options.port || 6379, host[0] || "127.0.0.1", this.options);
        client.on("error", (err) => { logger.error("redis:", this.queueName, this.url, err) });
        client.on("ready", this.emit.bind(this, "ready"));
        client.on("message", this.onMessage.bind(this));
        logger.debug("connect:", this.url, host, port, this.options);
        return client;
    }

    onMessage(channel, msg) {
        logger.dev("onMessage:", this.url, channel, msg);
        this.emit(channel, msg);
    }

    subscribe(channel, options, callback) {
        if (!this.subclient) {
            this.subclient = this.connect(this.hostname, this.port);
        }
        super.subscribe(channel, options, callback);
        if (!this.subclient.enable_offline_queue) this.subclient.enable_offline_queue = true;
        this.subclient.subscribe(channel);
    }

    unsubscribe(channel, options, callback) {
        super.unsubscribe(channel, options, callback);
        if (this.subclient) {
            if (!this.subclient.enable_offline_queue) this.subclient.enable_offline_queue = true;
            this.subclient.unsubscribe(channel);
        }
    }

    publish(channel, msg, options, callback) {
        if (!this.client.enable_offline_queue) this.client.enable_offline_queue = true;
        this.client.publish(channel, msg, callback);
    }

    stats(options, callback) {
        var rc = {};
        var chan = this.channel(options);
        this.client.eval(scripts.stats, 1, chan, (err, count) => {
            if (!err) {
                rc.queueCount = lib.toNumber(count[0]);
                rc.queueRunning = lib.toNumber(count[1]);
            }
            lib.tryCall(callback, err, rc);
        });
    }

    submit(job, options, callback) {
        var chan = this.channel(options);
        if (typeof job != "string") job = lib.stringify(job);
        this.client.zadd(chan, Date.now(), job, callback);
    }

    _monitor(options) {
        if (!this.client.ready) return;
        var chan = this.channel(options);
        var now = Date.now() - lib.validPositive(options.visibilityTimeout, this.options.visibilityTimeout);
        this.client.eval(scripts.monitor, 2, chan, now, (err, count) => {
            if (err) logger.error("monitor:", this.url, err);
            // Report when queue size reaches configured threshold
            if (!count || !this.options.threshold) return;
            count = lib.toNumber(count);
            if (count >= this.options.threshold) logger.error("monitor:", this.url, this.options, "queue size:", count);
        });
    }

    monitor(options) {
        var visibilityTimeout = lib.validPositive(options.visibilityTimeout, this.options.visibilityTimeout);
        if (!this._monitorTimer && visibilityTimeout) {
            this._monitorTimer = setInterval(this._monitor.bind(this, options), visibilityTimeout);
            this._monitor(options);
        }
    }

    poll(options) {
        if (!this.client) return;
        var visibilityTimeout = lib.validPositive(options.visibilityTimeout, this.options.visibilityTimeout);
        var retryInterval = lib.validPositive(options.retryInterval, this.options.retryInterval);
        var interval = lib.validPositive(options.interval, this.options.interval);
        var script = visibilityTimeout ? scripts.vpoller : scripts.poller;
        var chan = this.channel(options);

        this.client.eval(script, 2, chan, Date.now(), (err, rc) => {
            if (err) logger.error("poll:", this.name, chan, lib.traceError(err));
            if (!rc || !rc[0] || err) {
                this.schedule(options, retryInterval);
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
                    this.client.zrem(chan + "#", data, (err) => {
                        if (err) logger.error("poll:", this.name, chan, lib.traceError(err));
                        this.schedule(options, retryInterval);
                    });
                    return;
                }
                if (msg.startTime > 0 && msg.startTime - now > this.options.interval) {
                    let timeout = msg.startTime - now;
                    if (timeout > this.options.maxTimeout) timeout = this.options.maxTimeout;
                    this.client.zadd(chan + "#", now + timeout, data, (err) => {
                        if (err) logger.error("poll:", this.name, chan, lib.traceError(err));
                        this.schedule(options, retryInterval);
                    });
                    return;
                }
                // Delete immediately, this is a one-off message not to be handled or repeated
                if (msg.noWait) {
                    this.client.zrem(chan + "#", data);
                } else
                // Delay deletion in case checks need to be done for uniqueness or something else
                if (msg.noWaitTimeout > 0) {
                    setTimeout(() => {
                        if (done || !this.client) return;
                        msg.noWait = 1;
                        this.client.zrem(chan + "#", data);
                    }, msg.noWaitTimeout * 1000);
                }
            }
            // Keep updating timestamp to prevent the job being placed back to the active queue
            var vtimeout = msg.visibilityTimeout > 0 ? msg.visibilityTimeout : visibilityTimeout;
            if (vtimeout && !msg.noWait) {
                Object.defineProperty(msg, "__msgid", { enumerable: false, value: data });
                if (msg.visibilityTimeout > 0) this.client.zadd(chan + "#", Date.now(), data);
                vtimer = setInterval(() => {
                    if (done || !this.client) {
                        clearInterval(vtimer);
                        return;
                    }
                    this.client.zadd(chan + "#", Date.now(), data, (err) => {
                        if (err) logger.error("poll:", this.name, chan, lib.traceError(err));
                        if (err) clearInterval(vtimer);
                    });
                }, vtimeout * 0.8);
            }

            if (!this.emit(chan, msg, (err, next) => {
                if (done) return;
                done = 1;
                clearInterval(vtimer);

                if (!msg.noVisibility && (err && err.status >= 500 || msg.noWait)) {
                    setTimeout(() => {
                        if (!this.client) return;
                        const timeout = Date.now() + lib.toNumber(msg.retryVisibilityTimeout && msg.retryVisibilityTimeout[err.status]);
                        this.client.zadd(chan + (visibilityTimeout ? "#" : ""), timeout, data, (err) => {
                            if (err) logger.error("poll:", this.name, chan, lib.traceError(err));
                            this.schedule(options, interval);
                        });
                    }, this.options.visibilityTimeout ? 0 : retryInterval);
                } else {
                    if (visibilityTimeout) {
                        this.client?.zrem(chan + "#", data, (err) => {
                            if (err) logger.error("poll:", this.name, chan, lib.traceError(err));
                            this.schedule(options, interval);
                        });
                    } else {
                        this.schedule(options, interval);
                    }
                }
            })) {
                done = 1;
                clearInterval(vtimer);
                this.schedule(options, interval);
            }
        });
    }

    drop(msg, options, callback) {
        if (!msg.__msgid) return lib.tryCall(callback);
        var chan = this.channel(options);
        this.client.zrem(chan + "#", msg.__msgid, callback);
    }

}

module.exports = RedisClient;
