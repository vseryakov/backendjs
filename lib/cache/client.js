/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const { EventEmitter } = require("events");
const logger = require(__dirname + '/../logger');
const lib = require(__dirname + '/../lib');
const metrics = require(__dirname + '/../metrics');

/**
 * Base class for the cache clients, implements cache protocol in the same class,
 * not supported methods just do nothing without raising any errors
 * @param {object} [options]
 * @memberOf module:cache
 */

class CacheClient extends EventEmitter {
    name = "cache client"
    cacheName = ""
    options = {}

    constructor(options) {
        super();
        this.setMaxListeners(0);
        this.url = String(options?.url || "");
        this.metrics = new metrics.Timer();
        this.applyOptions(options);
        this.on("ready", () => { this.ready = true });
        logger.debug("client:", this.url, this.options);
    }

    /**
     * Close current connection, ports.... not valid after this call
     */
    close() {
        this.url = "";
        this.options = {};
        this.metrics.end();
        this.removeAllListeners();
    }

    /**
     * Prepare options to be used safely, parse the reserved params from the url
     * @param {object} options
     */
    applyOptions(options) {
        for (const p in options) {
            if (p[0] != "_" && p != "url") this.options[p] = options[p];
        }
        const h = URL.parse(this.url);
        if (!h) return;
        this.port = h.port || 0;
        this.protocol = h.protocol;
        this.hostname = h.hostname || "";
        this.pathname = h.pathname || "";
        for (const [key, val] of h.searchParams) {
            if (!key.startsWith("bk-")) continue;
            this.options[key.substr(3)] = lib.isNumeric(val) ? lib.toNumber(val) : val;
            h.searchParams.delete(key);
        }
        this.url = h.toString();
    }

    /**
     * Handle reserved options
     @param {object} options
     */
    applyReservedOptions(options) {}

    /**
     * Returns the cache statistics to the callback as the forst argument, the object tructure is specific to each implementstion
     * @param {object} [options]
     * @param {function} [callback]
     */
    stats(options, callback) {
        lib.tryCall(callback);
    }

    // CACHE MANAGEMENT

    /**
     * Clear all or only matched keys from the cache
     * @param {string} pattern
     * @param {function} [callback]
     */
    clear(pattern, callback) {
        lib.tryCall(callback);
    }

    /**
     * Returns an item from the cache by a key, callback is required and it acceptes only the item,
     * on any error null or undefined will be returned
     * @param {string} key
     * @param {object} options
     * @param {function} callback
     */
    get(key, options, callback) {
        lib.tryCall(callback);
    }

    /**
     * Store an item in the cache
     * @param {string} key
     * @param {string} val
     * @param {object} options
     * @param {int} [options.ttl] - TTL in milliseconds
     * @param {function} [callback]
     */
    put(key, val, options, callback) {
        lib.tryCall(callback);
    }

    /**
     * Add/substract a number from the an item, returns new number in the callback if provided, in case of an error null/indefined should be returned
     * @param {string} key
     * @param {number} val
     * @param {object} options
     * @param {function} [callback]
     */
    incr(key, val, options, callback) {
        lib.tryCall(callback, null, 0);
    }

    /**
     * Delete an item from the cache
     * @param {string} key
     * @param {object} options
     * @param {function} [callback]
     */
    del(key, options, callback) {
        lib.tryCall(callback);
    }

    // LOCKING MANAGEMENT

    /**
     * Lock by name
     * by default return an error
     * @param {string} name
     * @param {object} options
     * @param {function} [callback]
     */
    lock(name, options, callback) {
        logger.error("lock:", "NOT IMPLEMENTED", this.name, name, options);
        lib.tryCall(callback, { status: 500, message: "not implemented" });
    }

    /**
     * Unlock by name
     * @param {string} name
     * @param {object} options
     * @param {function} [callback]
     */

    unlock(name, options, callback) {
        lib.tryCall(callback);
    }

    // RATE CONTROL

    /**
     * Rate limit check, by default it uses the server LRU cache meaning it works within one physical machine only.
     *
     * @param {string} key
     * @param {number} val
     * @param {object} options - same as for {@link module:metrics.TokenBucket} rate limiter
     * @param {string} options.name - unique id, can be IP address, account id, etc...
     * @param {int} options.rate - rate per interval
     * @param {int} options.interval - in milliseconds
     * @param {int} [options.max]
     * @param {function} [callback] - arguments must be:
     * - 1st arg is a delay to wait till the bucket is ready again,
     * - 2nd arg is an object with the bucket state: { delay:, count:, total:, elapsed: }
     */
    limiter(options, callback) {
        logger.error("limiter:", "NOT IMPLEMENTED", this.name, options);
        lib.tryCall(callback, 60000, {});
    }

}

module.exports = CacheClient;

