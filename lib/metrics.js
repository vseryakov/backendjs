/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 *
 * Based on https://github.com/felixge/node-measured
 */

/**
 * Metrics library
 * @module metrics
 */

exports.name = "metrics";

/** @var {Counter} */
exports.Counter = require('./metrics/Counter');

/** @var {Histogram} */
exports.Histogram = require('./metrics/Histogram');

/** @var {Meter} */
exports.Meter = require('./metrics/Meter');

/** @var {Timer} */
exports.Timer = require('./metrics/Timer');

/** @var {TokenBucket} */
exports.TokenBucket = require('./metrics/TokenBucket');

/** @var {Trace} */
exports.Trace = require('./metrics/Trace');

/** @var {FakeTrace} */
exports.FakeTrace = require('./metrics/FakeTrace');

/**
 * Convert all metrics for all propeties.
 * Options:
 * - reset - true to reset all metrics
 * - take - regexp for variable that should use `take` i.e. resetable counters
 * - skip - regexp of properties to ignore
 * @memberof module:metrics
 * @method toJSON
 */
exports.toJSON = function(obj, options)
{
    var rc = {};
    for (const p in obj) {
        const type = typeof obj[p];
        if (!obj[p] || type == "function") continue;
        if (options?.skip?.test && options.skip.test(p)) continue;

        if (typeof obj[p].toJSON == "function") {
            rc[p] = obj[p].toJSON(options);
        } else
        if (type == "object") {
            rc[p] = this.toJSON(obj[p], options);
        } else
        if (type == "number") {
            rc[p] = obj[p];
            if (options?.take?.test && options.take.test(p)) {
                obj[p] = 0;
            }
        }
    }
    return rc;
}

/**
 * Increments a counter in an object, creates a new var if not exist or not a number
 *
 * @param {object} obj
 * @param {string} name
 * @param {number} [coount=1]
 * @return {number}
 * @memberof module:metrics
 * @method incr
 */
exports.incr = function(obj, name, count)
{
    if (typeof obj[name] != "number") obj[name] = 0;
    obj[name] += typeof count == "number" ? count : 1;
    return obj[name];
}

/**
 * Return the value for the given var and resets it to 0
 * @param {object} obj
 * @param {string} name
 * @return {number}
 * @memberof module:metrics
 * @method take
 */
exports.take = function(obj, name)
{
    if (typeof obj[name] !== "number") return 0;
    const n = obj[name];
    obj[name] = 0;
    return n;
}

