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
        var opts = {
            name: options.name,
            rate: options.rate,
            max: options.max,
            interval: options.interval,
            expire: options.ttl > 0 ? Date.now() + options.ttl : 0,
            reset: options.reset,
            multiplier: options.multiplier,
            cacheName: this.cacheName,
        };
        const msg = modules.cache.localLimiter(opts);
        callback(msg.consumed ? 0 : msg.delay, msg);
    }

    lock(name, options, callback) {
        const now = Date.now();
        if (this._lock > 1 && this._lock <= now) delete this._lock;
        if (options.set || !this._lock) {
            this._lock = options.ttl > 0 ? now + options.ttl : 1;
            lib.tryCall(callback, null, true);
        } else {
            lib.tryCall(callback, null, false);
        }
    }

    unlock(name, options, callback) {
        delete this._lock;
        lib.tryCall(callback);
    }
}

module.exports = LocalCacheClient;
