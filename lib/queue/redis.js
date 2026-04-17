/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const logger = require(__dirname + '/../logger');
const lib = require(__dirname + '/../lib');
const QueueClient = require(__dirname + "/client");
const redis = require("redis");

const scripts = {

    poller: [
        "local time = tonumber(KEYS[2]);",
        "local timeout = tonumber(KEYS[3]) + time;",
        "local val = redis.call('zrange', KEYS[1], 0, time, 'byscore', 'limit', 0, 1)[1];",
        "if val then redis.call('zadd', KEYS[1], timeout, val); end;",
        "return val;"
    ].join(""),

    stats: [
        "local time = tonumber(KEYS[2]);",
        "local count1 = redis.call('zcount', KEYS[1], '-inf', '+inf');",
        "local count2 = redis.call('zcount', KEYS[1], 0, time);",
        "return {count1,count2};"
    ].join(""),

};

/**
 * Queue client using Redis server
 *
 * @param {boolean|int|object} [options.tls] can be true or 1 to just enable default TLS properties
 *
 * @example
 * -queue-default=redis://host1
 * -queue-default-options-interval=1000
 * -queue-redis=redis://host1?bk-visibilityTimeout=30000&bk-count=2
 * -queue-default=redis://host1?bk-tls=1
 *
 * @memberOf module:queue
 */

class RedisQueueClient extends QueueClient {

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
    }

    applyOptions(options) {
        super.applyOptions(options);
        this.options.threshold = lib.toNumber(this.options.threshold, { min: 0 });
        this.options.enable_offline_queue = lib.toBool(this.options.enable_offline_queue);
        this.options.retry_max_delay = lib.toNumber(this.options.retry_max_delay, { min: 1000, dflt: 30000 });
        this.options.max_attempts = lib.toNumber(this.options.max_attempts, { min: 0 });
    }

    connect(hostname, port) {
        var host = String(hostname).split(":");
        var client = new redis.createClient(host[1] || port || this.options.port || 6379, host[0] || "127.0.0.1", this.options);
        client.on("error", (err) => { logger.error("redis:", this.queueName, this.url, err) });
        client.on("ready", this.emit.bind(this, "ready"));
        client.on("message", this.onMessage.bind(this));
        logger.debug("connect:", this.url, host, port, this.options);
        return client;
    }

    onMessage(subject, msg) {
        logger.dev("onMessage:", this.url, subject, msg);
        this.emit(subject, msg);
    }

    subscribe(subject, options, callback) {
        if (!this.subclient) {
            this.subclient = this.connect(this.hostname, this.port);
        }
        super.subscribe(subject, options, callback);
        if (!this.subclient.enable_offline_queue) this.subclient.enable_offline_queue = true;
        this.subclient.subscribe(subject);
    }

    unsubscribe(subject, options, callback) {
        super.unsubscribe(subject, options, callback);
        if (this.subclient) {
            if (!this.subclient.enable_offline_queue) this.subclient.enable_offline_queue = true;
            this.subclient.unsubscribe(subject);
        }
    }

    publish(subject, msg, options, callback) {
        if (!this.client.enable_offline_queue) this.client.enable_offline_queue = true;
        this.client.publish(subject, msg, callback);
    }

    stats(options, callback) {
        var rc = {};
        var subject = this.subject(options);
        this.client.eval(scripts.stats, 2, subject, Date.now(), (err, count) => {
            if (!err) {
                rc.queueCount = lib.toNumber(count[0]);
                rc.queueRunning = lib.toNumber(count[1]);
            }
            lib.tryCall(callback, err, rc);
        });
    }

    submit(job, options, callback) {
        var subject = this.subject(options);
        if (typeof job != "string") job = lib.stringify(job);
        this.client.zadd(subject, Date.now(), job, callback);
    }

    purge(options, callback) {
        var subject = this.subject(options);
        this.client.del(subject, callback);
    }

    poll(options) {
        this._poll_run(options);
    }

    _poll_get(options, callback) {
        const subject = this.subject(options);

        this.client.eval(scripts.poller, 3, subject, Date.now(), this.options.visibilityTimeout, (err, data) => {
            if (!err && data) {
                data = [ { data } ];
            }
            callback(err, data);
        });
    }

    _poll_update(options, item, visibilityTimeout, callback) {
        const subject = this.subject(options);
        this.client.zadd(subject, Date.now() + visibilityTimeout, item.data, callback);
    }

    _poll_del(options, item, callback) {
        const subject = this.subject(options);
        this.client.zrem(subject, item.data, callback);
    }

}

module.exports = RedisQueueClient;
