/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2024
 */

const modules = require(__dirname + '/../modules');
const Client = require(__dirname + "/client");

// Client that uses the local process or master process for jobs.

const client = {
    name: "local",

    create: function(options) {
        if (/^local:/.test(options?.url)) return new LocalClient(options);
    }
};
module.exports = client;

class LocalClient extends Client {

    constructor(options) {
        super(options);
        this.name = client.name;
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

