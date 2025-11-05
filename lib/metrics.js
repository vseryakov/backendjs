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
exports.Counter = require('./metrics/Counter');
exports.Histogram = require('./metrics/Histogram');
exports.Meter = require('./metrics/Meter');
exports.Timer = require('./metrics/Timer');
exports.TokenBucket = require('./metrics/TokenBucket');
exports.Trace = require('./metrics/Trace');
exports.FakeTrace = require('./metrics/FakeTrace');

/**
 * Convert all metrics for all propeties.
 * Options:
 * - reset - true to reset all metrics
 * - take - regexp for variable that should use `take` i.e. resetable counters
 * - skip - regexp of properties to ignore
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

// Increments a counter in an object, creates a new var if not exist or not a number
exports.incr = function(obj, name, count)
{
    if (typeof obj[name] != "number") obj[name] = 0;
    obj[name] += typeof count == "number" ? count : 1;
    return obj[name];
}

// Return the value for the given var and resets it to 0
exports.take = function(obj, name)
{
    if (typeof obj[name] !== "number") return 0;
    const n = obj[name];
    obj[name] = 0;
    return n;
}

