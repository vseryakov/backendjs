/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2024
 */

const modules = require(__dirname + '/../modules');
const CacheClient = require(__dirname + "/client");

/**
 * Client that uses server process rate limiter, locking.
 * @memberOf module:cache
 */

class WorkerCacheClient extends CacheClient {

    constructor(options) {
        super(options);
        this.name = "worker";
        this.applyOptions();
        this.emit("ready");
    }

    limiter(options, callback) {
        const opts = {
            name: options.name,
            rate: options.rate,
            max: options.max,
            interval: options.interval,
            expire: options.ttl > 0 ? Date.now() + options.ttl : 0,
            reset: options.reset,
            multiplier: options.multiplier,
            cacheName: this.cacheName,
        };
        modules.ipc.sendMsg("ipc:limiter", opts, (msg) => {
            callback(msg.consumed ? 0 : msg.delay, msg);
        });
    }

    lock(name, options, callback) {
        modules.ipc.sendMsg("ipc:lock", { name, options }, (msg) => {
            callback(null, msg.locked);
        });
    }

    unlock(name, options, callback) {
        modules.ipc.sendMsg("ipc:unlock", { name, options }, callback);
    }

}

module.exports = WorkerCacheClient;
