/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
'use strict';
const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');
const api = require(__dirname + '/../api');
const cache = require(__dirname + '/../cache');

/**
 * Validate body/query parameters according to the `schema` by using {@link module:lib.validate},
 * uses the context.body if parsed or context.query
 * @param {RequestContext} context
 * @param {module:lib.ValidateOptions} schema - schema object
 * @param {object} [options]
 * @param {object} [options.defaults] - merged with global `api.defaults`
 * @param {boolean} [options.query] - use only `context.query`
 * @returns {object} - a query object or an error { data, err }
 * @example
 *  const { err, data } = api.validate(context, { q: { required: 1 } });
 *  if (err) return context.reply(err)
 * @memberof module:api
 * @method validate
 */
api.validate = function(context, schema, options)
{
    var opts = lib.extend({}, options, {
        dprefix: context?.path + "-",
        defaults: lib.extend({}, options?.defaults, api.defaults)
    });
    logger.debug("validate:", "api", context, "S:", schema, "O:", opts);

    var query = options?.query ? context.query : context.body || context.query;
    return lib.validate(query, schema, opts);
}

/**
 * Record reauest into access log if enabled
 * @param {RequestContext} context
 * @memberof module:api
 * @method writeAccesslog
 */
api.writeAccesslog = function(context)
{
    if (api.accesslog.disabled) return;

    if (context.var("accesslog", true)) return;

    const { reqID, time, method, req, res } = context;
    const now = new Date();

    var line = context.ip + " - " +
                (api.accesslog.file ? '[' + now.toUTCString() + ']' : "-") + " " +
                (method || "NONE") + " " +
                (context.orig?.url || context.url) + " " +
                (req?.httpVersion || "-") + " " +
                (res?.statusCode || 0) + " " +
                (res?.headers?.['content-length'] || '-') + " - " +
                (now - time) + " ms " +
                (reqID || "-") + " - " +
                (req?.headers?.['user-agent'] || "-") + " - " +
                (context?.user?.id || context?.userId || "-");

    // Append additional fields
    for (let v of api.accesslog.fields) {
        switch (v[1] === ":" ? v[0] : "") {
        case "q":
            v = context?.query?.[v.substr(2)];
            break;
        case "b":
            v = context?.body?.[v.substr(2)];
            break;
        case "h":
            v = req?.headers?.[v.substr(2)];
            break;
        case "u":
            v = context?.user?.[v.substr(2)];
            break;
        case "o":
            v = context?.[v.substr(2)];
            break;
        }
        if (typeof v === "object") v = "";
        line += " " + (v || "-");
    }
    if (api.accesslog.file) {
        line += "\n";
    }
    api.accesslog.stream.write(line);
}

/**
 * Perform rate limiting by name, uses shared or local cache where to keep TokenBucket object
 * @param {string} name - unique name to check, this is the cache key in other words
 * @param {object} options
 * @param {number} [options.max - max capacity to be used by default
 * @param {number} [options.rate] - fill rate to be used by default
 * @param {number} [options.interval=1000] - interval in ms within which the rate is measured, default 1000 ms
 * @param {number} [options.ttl] - auto expire after specified ms since last use
 * @param {number|boolean} [options.reset] - if true reset the token bucket if not consumed or the total reached this value if number greater than 1
 * @param {string} [options.message] - more descriptive text to be used in the error message for the type, if not specified a generic error message is used
 * @param {string} [options.queue] - which queue to use instead of the default, some limits are more useful with global queues like Redis instead of the default in-process cache
 * @param {number} [options.delay] - time in ms to delay the response, slowing down request rate
 * @param {number} [options.multiplier] - multiply the interval after it consumed all tokens, subsequent checks use the increased interval, fractions supported,
 *    if the multiplier is positive then the interval will keep increasing indefinitely, if it is negative the interval will reset to the default
 *    value on first successful consumption
 * @param {string} [options.cacheName=local] - cache to use for token bucket shared rate limit
 * @param {function(err:object, info:object)} callback
 * - the err object is { status: 429, message: string, retryAfter: ms }
 * - the info object from {@link module:cache.limiter} as { delay: number, count: number, total: number, elapsed: number }
 * @example
 *
 * api.limiter(context.path, { rate: 10, interval: 1000 }, lib.log);
 *
 * api.limiter(context.ip, { rate: 100, interval: 60000 }, lib.log);
 *
 * api.limiter(context.userId, { rate: 10, interval: 3600000, message: "Slow down please for %s" }, lib.log);
 *
 * api.limiter([context.userId,context.path], { rate: 10, interval: 3600000 }, lib.log);
 *
 * @memberof module:api
 * @method limiter
 */

api.limiter = function(name, options, callback)
{
    logger.dev("limiter:", api.name, name, options);
    if (!name || !options?.rate) return callback();

    const opts = {
        name: "API:LIMITER:" + name,
        rate: options.rate,
        max: options.max || options.rate,
        interval: options.interval || 1000,
        ttl: options.ttl,
        reset: options.reset,
        multiplier: options.multiplier,
        cacheName: options.cacheName || "local",
    };
    cache.limiter(opts, (delay, info) => {
        logger.debug("limiter:", api.name, name, options, "OPTS:", opts, "DELAY:", delay, "INFO:", info);
        if (!delay) return callback();
        var err = {
            status: 429,
            message: lib.__(options.message || api.errLimitReached, lib.toDuration(delay)),
            retryAfter: delay
        };
        if (options.delay) {
            return setTimeout(callback, options.delay, err, info);
        }
        callback(err, info);
    });
}


/**
 * Async verson of {@link module:api.limiter}
 * @param {string} name - unique name to check, this is the cache key in other words
 * @param {object} options - same as in {@link module:api.limiter}
 * @returns {{err:object, info:object}}
 * @memberof module:api
 * @method alimiter
 * @async
 */
api.alimiter = async function(name, options)
{
    return new Promise((resolve, _reject) => {
        api.limiter(name, options, (err, info) => {
            resolve({ err, info });
        });
    });
}
