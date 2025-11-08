/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2024
 */

const modules = require(__dirname + '/../modules');
const CacheClient = require(__dirname + "/client");

const localClient = {
    name: "local",

    create: function(options) {
        if (/^local:/.test(options?.url)) return new LocalClient(options);
    }
};
module.exports = localClient;

/**
 * Client that uses the local process or master process for jobs.
 * @memberOf module:cache
 */

class LocalClient extends CacheClient {

    constructor(options) {
        super(options);
        this.name = localClient.name;
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
}

