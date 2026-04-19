/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2024
 */

const lib = require(__dirname + '/../lib');
const modules = require(__dirname + '/../modules');
const CacheClient = require(__dirname + "/client");

/**
 * Client that uses the local process or server process for jobs.
 * @memberOf module:cache
 */

class LocalCacheClient extends CacheClient {

    constructor(options) {
        super(options);
        this.name = "local";
        this.applyOptions();
        this.emit("ready");
    }

    limiter(options, callback) {
        var msg = {
            name: options.name,
            rate: options.rate,
            max: options.max,
            interval: options.interval,
            expire: options.ttl > 0 ? Date.now() + options.ttl : 0,
            reset: options.reset,
            multiplier: options.multiplier,
            cacheName: this.cacheName,
        };
        msg = modules.cache.localLimiter(msg);
        callback(msg.delay, msg);
    }

    lock(name, options, callback) {
        callback(null, modules.cache.localLock(name, options))
    }

    unlock(name, options, callback) {
        modules.cache.localUnlock(name, options);
        lib.tryCall(callback);
    }
}

module.exports = LocalCacheClient;
