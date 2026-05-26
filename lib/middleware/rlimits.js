
/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

/**
  * @module middleware/rlimits
  */

const lib = require(__dirname + '/../api');
const cache = require(__dirname + '/../cache');
const logger = require(__dirname + '/../logger');

const mod = {
    name: "middleware.rlimits",
    args: [
        { name: "err-(.+)", descr: "Error messages for various cases" },
        { name: "(rate|max|interval|ttl|delay|multiplier|queue)", autotype: 1, descr: "Default rate limiter parameters for Token Bucket algorithm. `queue` to use specific queue, ttl` is to expire cache entries", example: "middleware-rlimits-queue = redis\nmiddleware-rlimits-rate = 1\nmiddleware-rlimits-ttl = 60000" },
        { name: "map-(.+)", type: "map", obj: "map.$1", merge: 1, descr: "Rate limiter parameters for Token Bucket algorithm. set all at once", example: "middleware-rlimits-map-/url=rate:1,interval:2000\nmiddleware-rlimits-map-GET/url=rate:10" },
    ],

    ttl: 86400000,
    cache: "local",

    errLimitReached: "Access limit reached, please try again later in %s.",
};

module.exports = mod;

/**
 * Check for rate limits by request IP and path
 * @memberof module:middleware/rlimits
 * @method handle
 */
mod.handle = function(context, next)
{
    if (!mod.map) return next();

    mod.check({ path: context.path, ip: context.ip, type: ["ip", "path"] }, (err) => {
        if (err) {
            return context.send(err.status, err);
        }
        next();
    });
}

/**
 * Perform rate limiting by specified property, if not given no limiting is done.
 * @param {object} options
 * @param {string|string[]} options.type - determines by which property to perform rate limiting, when using user properties
 *     the rate limiter should be called after the request signature has been parsed. Any other value is treated as
 *     custom type and used as is. If it is an array all items will be checked sequentially.
 *     **This property is required.**
 *
 *     The predefined types checked for every request:
 *     - ip - limit by IP address only
 *     - path - limit by path and IP address, * can be used at the end to match only the beginning,
 *         method can be placed before the path to use different rates for the same path by request method
 *
 *         api-rlimits-rate = 100
 *         api-rlimits-queue = redis
 *         api-rlimits-map-GET/api/path = rate:10,queue:local
 *         api-rlimits-map-/api/path/* = rate:1
 *         api-rlimits-map-/api/path/127.0.0.1 = rate:100
 *         api-rlimits-map-/api/* = rate:100,interval:1000
 *
 * @param {string} [options.method] - request method
 * @param {string} [options.path] - request path
 * @param {string} [options.ip] - to use the specified IP address
 * @param {number} [options.max - max capacity to be used by default
 * @param {number} [options.rate] - fill rate to be used by default
 * @param {number} [options.interval] - interval in ms within which the rate is measured, default 1000 ms
 * @param {string} [options.message] - more descriptive text to be used in the error message for the type, if not specified a generic error message is used
 * @param {string} [options.queue] - which queue to use instead of the default, some limits are more useful with global queues like Redis instead of the default in-process cache
 * @param {number} [options.delay] - time in ms to delay the response, slowing down request rate
 * @param {number} [options.multiplier] - multiply the interval after it consumed all tokens, subsequent checks use the increased interval, fractions supported,
 *    if the multiplier is positive then the interval will keep increasing indefinitely, if it is negative the interval will reset to the default
 *    value on first successful consumption
 * @param {function} callback as function(err, info) where info is from {@link module:cache.limiter}
 * @example
 *
 *  middleware.rlimits.check({ path: context.path, ip: context.ip, type: "ip", rate: 100, interval: 60000 }, (err, info) => {
 *     if (err) return context.send(err.status, err);
 *     ...
 *  });
 * @example <caption>More endpoint config examples</caption>
 * api-rlimits-map-/pub/settings = rate:10,interval:1000,delay:250
 * api-rlimits-map-GET/passkey/login = rate:3,interval:1000,delay:250
 * api-rlimits-map-/login = rate:3,interval:30000,delay:1000,multiplier:1.5,queue:unique
 * api-rlimits-map-/checkin* = rate:5,interval:30000
 * @memberof module:middleware/rlimits
 * @method check
 */
mod.check = function(options, callback)
{
    if (!this.map || !options?.type) return callback();

    const mapping = this.map;
    const method = options.method;
    const types = Array.isArray(options.type) ? options.type : [ options.type ];

    lib.forEachSeries(types, (type, next) => {
        var name, key = type;
        switch (type) {
        case "ip":
            name = options.ip;
            break;

        case "path":
            key = options.path;
            if (!key) break;
            if (!mapping[key] && !(method && mapping[method + key])) {
                for (const p in mapping) {
                    const item = mapping[p];
                    if (item._key === undefined) {
                        item._key = p.at(-1) == "*" ? p.slice(0, -1) : null;
                    }
                    if (item._key && key.startsWith(item._key)) {
                        key = p;
                        break;
                    }
                }
            }
            name = key + "/" + options.ip;
            break;
        }

        const map = (name && mapping[name]) || (method && mapping[method + key]) || mapping[key];
        const rate = options.rate || map?.rate;
        logger.debug("check:", mod.name, type, key, name, "OPTS:", options, "MAP:", map);
        if (!rate) return next();

        const max = options.max || map?.max || rate;
        const interval = options.interval || map?.interval || this.interval || 1000;
        const multiplier = options.multiplier || map?.multiplier || this.multiplier || 0;
        const ttl = options.ttl || map?.ttl || this.ttl;
        const cacheName = options.cache || map?.cache || this.cache;

        // Use process shared cache to eliminate race condition for the same cache item from multiple processes on the same instance,
        // in server mode use direct access to the LRU cache
        const limit = {
            name: "API.RLIMIT:" + name,
            rate,
            max,
            interval,
            ttl,
            multiplier,
            cacheName,
        };
        cache.limiter(limit, (delay, info) => {
            logger.debug("check:", mod.name, options, "L:", limit, "D:", delay, info);
            if (!delay) return next();
            var err = {
                status: 429,
                message: lib.__(options.message || map?.message || mod.errLimitReached, lib.toDuration(delay)),
                retryAfter: delay
            };
            if (options.delay || map?.delay) {
                return setTimeout(callback, options.delay || map?.delay, err, info);
            }
            callback(err, info);
        });
    }, callback, true);
}

/**
 * Register access rate limit for a given name, all other rate limit properties will be applied as
 * described in the {@link module:middleware/rlimits.check}
 * @param {string} name - path or reserved rate type
 * @param {object} options
 * @param {number} options.rate - base rate limit
 * @param {number} options.max - max rate limit
 * @param {number} options.internal - rate interval
 * @param {number} options.queue - which limiter queue to use
 * @memberof module:middleware/rlimits
 * @method register
 */
mod.register = function(name, options)
{
    if (!name) return false;
    this.map[name] = options;
    logger.debug("register:", mod.name, name, options);
    return true;
}

