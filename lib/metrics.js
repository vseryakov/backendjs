//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//
// Based on https://github.com/felixge/node-measured
//

exports.name = "metrics";
exports.Counter = require('./metrics/Counter');
exports.Histogram = require('./metrics/Histogram');
exports.Meter = require('./metrics/Meter');
exports.Timer = require('./metrics/Timer');
exports.TokenBucket = require('./metrics/TokenBucket');
exports.Trace = require('./metrics/Trace');
exports.FakeTrace = require('./metrics/FakeTrace');

// Returns all properties in an object, convert all metrics if necessary
exports.toJSON = function(options)
{
    var json = {};
    for (const p in this) {
        if (this[p] === undefined || typeof this[p] == "function" || this[p] === null) continue;
        json[p] = typeof this[p].toJSON == "function" ? this[p].toJSON(options) : this[p];
    }
    return json;
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

