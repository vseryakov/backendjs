/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2024
 */

const modules = require(__dirname + '/../modules');
const CacheClient = require(__dirname + "/client");

const workerClient = {
    name: "worker",

    create: function(options) {
        if (/^worker:/.test(options?.url)) return new WorkerClient(options);
    }
};
module.exports = workerClient;

/**
 * Client that uses master process rate limiter and workers for jobs.
 * @memberOf module:cache
 */

class WorkerClient extends CacheClient {

    constructor(options) {
        super(options);
        this.name = workerClient.name;
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
        modules.ipc.sendMsg("ipc:limiter", opts, (msg) => {
            callback(msg.consumed ? 0 : msg.delay, msg);
        });
    }

}

