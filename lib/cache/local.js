/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2024
 */
'use strict';

const lib = require(__dirname + '/../lib');
const modules = require(__dirname + '/../modules');
const CacheClient = require(__dirname + "/client");

/**
 * Client that uses the local process for cache or limiter or locking.
 *
 * @memberOf module:cache
 * @example
 * cache-local=local://?bk-lru-max=10000
 */

class LocalCacheClient extends CacheClient {
    lru = new lib.LRUCache();

    constructor(options) {
        super(options);
        this.name = "local";
        if (this.options.lruMax > 0) {
            this.lru.max = this.options.lruMax;
        }
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

    stats(_options, callback) {
        lib.tryCall(callback, null, { size: this.lru.map.size });
    }

    clear(_pattern, callback) {
        this.lru.map.clear();
        lib.tryCall(callback);
    }

    get(key, options, callback) {
        if (Array.isArray(key)) {
            return lib.tryCall(callback, null, key.map(x => this.lru.get(x)));
        }
        const val = this.lru.get(key);
        if (options?.set) {
            if (val === undefined) {
                this.lru.put(key, options.set, options?.ttl ? Date.now() + options.ttl : 0);
            }
        }
        lib.tryCall(callback, null, val);
    }

    put(key, val, options, callback) {
        if (options?.setmax) {
            const old = lib.toNumber(this.lru.get(key));
            if (!old || old < options.setmax) {
                this.lru.put(key, options.setmax, options?.ttl ? Date.now() + options.ttl : 0);
            }
        } else {
            this.lru.put(key, val, options?.ttl ? Date.now() + options.ttl : 0);
        }
        lib.tryCall(callback);
    }

    incr(key, val, options, callback) {
        var n = lib.toNumber(this.lru.get(key)) + lib.toNumber(val);
        this.lru.put(key, n, options?.ttl ? Date.now() + options.ttl : 0);
        lib.tryCall(callback, null, n);
    }

    del(key, _options, callback) {
        if (Array.isArray(key)) {
            for (const k of key) this.lru.del(k);
        } else {
            this.lru.del(key);
        }
        lib.tryCall(callback);
    }

}

module.exports = LocalCacheClient;
