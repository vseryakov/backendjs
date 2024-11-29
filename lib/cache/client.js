//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const url = require('url');
const { EventEmitter } = require("events");
const logger = require(__dirname + '/../logger');
const lib = require(__dirname + '/../lib');
const metrics = require(__dirname + '/../metrics');

// Base class for the cache clients, implements cache protocol in the same class,
// not supported methods just do nothing without raising any errors

class Client extends EventEmitter {

    constructor(options) {
        super();
        this.setMaxListeners(0);
        this.cacheName = "";
        this.url = String(options?.url || "");
        this.options = {};
        this.metrics = new metrics.Timer();
        this.applyOptions(options);
        this.on("ready", () => { this.ready = true });
        logger.debug("client:", this.url, this.options);
    }

    // Close current connection, ports.... not valid after this call
    close() {
        this.url = "";
        this.options = {};
        this.metrics.end();
        this.removeAllListeners();
    }

    // Prepare options to be used safely, parse the reserved params from the url
    applyOptions(options) {
        for (const p in options) {
            if (p[0] != "_" && p != "url") this.options[p] = options[p];
        }
        const h = url.parse(this.url, true);
        this.port = h.port || 0;
        this.protocol = h.protocol;
        this.hostname = h.hostname || "";
        this.pathname = h.pathname || "";
        for (const p in h.query) {
            var d = p.match(/^bk-(.+)/);
            if (!d) continue;
            this.options[d[1]] = lib.isNumeric(h.query[p]) ? lib.toNumber(h.query[p]) : h.query[p];
            delete h.query[p];
        }
        h.search = null;
        h.path = null;
        this.url = url.format(h);
    }

    // Handle reserved options
    applyReservedOptions(options) {}

    // Returns the cache statistics to the callback as the forst argument, the object tructure is specific to each implementstion
    stats(options, callback) {
        lib.tryCall(callback);
    }

    // CACHE MANAGEMENT

    // Clear all or only matched keys from the cache
    clear(pattern, callback) {
        lib.tryCall(callback);
    }

    // Returns an item from the cache by a key, callback is required and it acceptes only the item,
    // on any error null or undefined will be returned
    get(key, options, callback) {
        lib.tryCall(callback);
    }

    // Store an item in the cache, `options.ttl` can be used to specify TTL in milliseconds
    put(key, val, options, callback) {
        lib.tryCall(callback);
    }

    // Add/substract a number from the an item, returns new number in the callback if provided, in case of an error null/indefined should be returned
    incr(key, val, options, callback) {
        lib.tryCall(callback, null, 0);
    }

    // Delete an item from the cache
    del(key, options, callback) {
        lib.tryCall(callback);
    }

    // LOCKING MANAGEMENT

    // By default return an error
    lock(name, options, callback) {
        logger.error("lock:", "NOT IMPLEMENTED", this.name, name, options);
        lib.tryCall(callback, { status: 500, message: "not implemented" });
    }

    unlock(name, options, callback) {
        lib.tryCall(callback);
    }

    // RATE CONTROL

    // Rate limit check, by default it uses the master LRU cache meaning it works within one physical machine only.
    //
    // The options must have the following properties:
    // - name - unique id, can be IP address, account id, etc...
    // - rate, max, interval - same as for `metrics.TokenBucket` rate limiter.
    //
    // The callback arguments must be:
    // - 1st arg is a delay to wait till the bucket is ready again,
    // - 2nd arg is an object with the bucket state: { delay:, count:, total:, elapsed: }
    //
    limiter(options, callback) {
        logger.error("limiter:", "NOT IMPLEMENTED", this.name, options);
        lib.tryCall(callback, 60000, {});
    }

}

module.exports = Client;

