//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var util = require('util');
var fs = require('fs');
var repl = require('repl');
var path = require('path');
var crypto = require('crypto');
var domain = require('domain');
var url = require('url');
var http = require('http');
var https = require('https');
var child = require('child_process');
var utils = require(__dirname + '/build/Release/backend');
var logger = require(__dirname + '/logger');
var cluster = require('cluster');
var os = require('os');
var uuid = require('uuid');

// Common utilities and useful functions
var corelib = {
    name: 'corelib',
}

module.exports = corelib;

// Empty function to be used when callback was no provided
corelib.noop = function() {}

// Encode with additional symbols, convert these into percent encoded:
//
//          ! -> %21, * -> %2A, ' -> %27, ( -> %28, ) -> %29
corelib.encodeURIComponent = function(str)
{
    return encodeURIComponent(str).replace(/[!'()*]/g, function(m) {
        return m == '!' ? '%21' : m == "'" ? '%27' : m == '(' ? '%28' : m == ')' ? '%29' : m == '*' ? '%2A' : m;
    });
}

// Convert text into capitalized words
corelib.toTitle = function(name)
{
    return (name || "").replace(/_/g, " ").split(/[ ]+/).reduce(function(x,y) { return x + y[0].toUpperCase() + y.substr(1) + " "; }, "").trim();
}

// Convert into camelized form
corelib.toCamel = function(name)
{
    return (name || "").replace(/(?:[-_])(\w)/g, function (_, c) { return c ? c.toUpperCase () : ''; });
}

// Convert Camel names into names with dashes
corelib.toUncamel = function(str)
{
    return str.replace(/([A-Z])/g, function(letter) { return '-' + letter.toLowerCase(); });
}

// Safe version, use 0 instead of NaN, handle booleans, if float specified, returns as float.
//
// Example:
//
//               corelib.toNumber("123")
//               corelib.toNumber("1.23", { float: 1, dflt: 0, min: 0, max: 2 })
//
corelib.toNumber = function(str, float, dflt, min, max)
{
    var n = 0;
    options = this.typeName(float) == "object" ? float : { float: float, dflt: dflt, min: min, max: max };
    if (typeof str == "number") {
        n = str;
    } else {
        if (typeof options.dflt == "undefined") options.dflt = 0;
        if (typeof str != "string") {
            n = options.dflt;
        } else {
            // Autodetect floating number
            if (typeof options.float == "undefined" || options.float == null) options.float = /^[0-9-]+\.[0-9]+$/.test(str);
            n = str[0] == 't' ? 1 : str[0] == 'f' ? 0 : str == "infinity" ? Infinity : (options.float ? parseFloat(str,10) : parseInt(str,10));
            n = isNaN(n) ? options.dflt : n;
        }
    }
    if (typeof options.min == "number" && n < options.min) n = options.min;
    if (typeof options.max == "number" && n > options.max) n = options.max;
    return n;
}

// Return true if value represents true condition
corelib.toBool = function(val, dflt)
{
    if (typeof val == "undefined") val = dflt;
    return !val || val == "false" || val == "FALSE" || val == "f" || val == "F" || val == "0" ? false : true;
}

// Return Date object for given text or numeric date representation, for invalid date returns 1969
corelib.toDate = function(val, dflt)
{
    var d = null;
    // String that looks like a number
    if (/^[0-9\.]+$/.test(val)) val = this.toNumber(val);
    // Assume it is seconds which we use for most mtime columns, convert to milliseconds
    if (typeof val == "number" && val < 2147483647) val *= 1000;
    try { d = new Date(val); } catch(e) {}
    return !isNaN(d) ? d : new Date(dflt || 0);
}

// Convert value to the proper type
corelib.toValue = function(val, type)
{
    switch ((type || "").trim()) {
    case 'array':
        return Array.isArray(val) ? val : String(val).split(/[,\|]/);

    case "expr":
    case "buffer":
        return val;

    case "real":
    case "float":
    case "double":
        return this.toNumber(val, true);

    case "int":
    case "smallint":
    case "integer":
    case "number":
    case "bigint":
    case "numeric":
    case "counter":
        return this.toNumber(val);

    case "bool":
    case "boolean":
        return this.toBool(val);

    case "date":
    case "time":
        return this.toDate(val);

    case "mtime":
        return /^[0-9\.]+$/.test(value) ? this.toNumber(val) : (new Date(val));

    case "json":
        return JSON.stringify(val);

    default:
        return String(val);
    }
}

// Add a regexp to the list of regexp objects, this is used in the config type `regexpmap`.
corelib.toRegexpMap = function(obj, val)
{
    if (val == null) return [];
    if (this.typeName(obj) != "array") obj = [];
    val = this.jsonParse(val, { obj: 1, error: 1 });
    for (var p in val) {
        var item = this.toRegexpObj(null, p);
        item.value = val[p];
        if (item.reset) obj = [];
        obj.push(item);
    }
    return obj;
}

// Add a regexp to the object that consist of list of patterns and compiled regexp, this is used in the config type `regexpobj`
corelib.toRegexpObj = function(obj, val, del)
{
    if (val == null) obj = null;
    if (this.typeName(obj) != "object") obj = {};
    if (!Array.isArray(obj.list)) obj.list = [];
    if (val) {
        if (del) {
            obj.list.splice(obj.list.indexOf(val), 1);
        } else {
            if (Array.isArray(val)) obj.list = obj.list.concat(val); else obj.list.push(val);
        }
    }
    obj.rx = null;
    if (obj.list.length) {
        try {
            obj.rx = new RegExp(obj.list.map(function(x) { return "(" + x + ")"}).join("|"));
        } catch(e) {
            logger.error('toRegexpMap:', val, e);
        }
    }
    return obj;
}

// Returns true if the given type belongs to the numeric family
corelib.isNumeric = function(type)
{
    return ["int","bigint","counter","real","float","double","numeric"].indexOf(String(type).trim()) > -1;
}

// Evaluate expr, compare 2 values with optional type and operation
corelib.isTrue = function(val1, val2, op, type)
{
    if (typeof val1 == "undefined" || typeof val2 == "undefined") return false;

    op = (op ||"").toLowerCase();
    var no = false, yes = true;
    if (op.substr(0, 4) == "not ") no = true, yes = false;

    switch (op) {
    case 'null':
    case "not null":
        if (val1) return no;
        break;

    case ">":
    case "gt":
        if (this.toValue(val1, type) <= this.toValue(val2, type)) return false;
        break;

    case "<":
    case "lt":
        if (this.toValue(val1, type) >= this.toValue(val2, type)) return false;
        break;

    case ">=":
    case "ge":
        if (this.toValue(val1, type) < this.toValue(val2, type)) return false;
        break;

    case "<=":
    case "le":
        if (this.toValue(val1, type) > this.toValue(val2, type)) return false;
        break;

    case "between":
        // If we cannot parse out 2 values, treat this as exact operator
        var list = Array.isArray(val2) ? val2 : this.strSplit(val2);
        if (list.length > 1) {
            if (this.toValue(val1, type) < this.toValue(list[0], type) || this.toValue(val1, type) > this.toValue(list[1], type)) return false;
        } else {
            if (this.toValue(val1, type) != this.toValue(val2, type)) return false;
        }
        break;

    case "in":
    case "not in":
        var list = Array.isArray(val2) ? val2 : this.strSplit(val2);
        if (list.indexOf(String(val1)) == -1) return no;
        break;

    case 'like%':
    case "not like%":
    case 'begins_with':
    case 'not begins_with':
        var v1 = String(val1);
        if (String(val2).substr(0, v1.length) != v1) return no;
        break;

    case "ilike%":
    case "not ilike%":
        var v1 = String(val1).toLowerCase();
        if (String(val2).substr(0, v1.length).toLowerCase() != v1) return no;
        break;

    case "!~":
    case "!~*":
    case "iregexp":
    case "not iregexp":
        if (!String(val1).match(new RegExp(String(val2), 'i'))) return no;
        break;

    case "~":
    case "~*":
    case "regexp":
    case "not regexp":
        if (!String(val1).match(new RegExp(String(val2)))) return false;
        break;

    case "contains":
    case "not contains":
        if (!String(val2).indexOf(String(val1)) > -1) return false;
        break;

    case "!=":
    case "<>":
    case "ne":
        if (this.toValue(val1, type) == this.toValue(val2, type)) return false;
        break;

    default:
        if (this.toValue(val1, type) != this.toValue(val2, type)) return false;
    }
    return yes;
}

// Apply an iterator function to each item in an array in parallel. Execute a callback when all items
// have been completed or immediately if there is an error provided.
//
//          corelib.forEach([ 1, 2, 3 ], function (i, next) {
//              console.log(i);
//              next();
//          }, function (err) {
//              console.log('done');
//          });
corelib.forEach = function(list, iterator, callback)
{
    var self = this;
    callback = typeof callback == "function" ? callback : this.noop;
    if (!list || !list.length) return callback();
    var count = list.length;
    for (var i = 0; i < list.length; i++) {
        iterator(list[i], function(err) {
            if (err) {
                callback(err);
                callback = self.noop;
                i = list.length + 1;
            } else {
                if (--count == 0) callback();
            }
        });
    }
}

// Apply an iterator function to each item in an array serially. Execute a callback when all items
// have been completed or immediately if there is is an error provided.
//
//          corelib.forEachSeries([ 1, 2, 3 ], function (i, next) {
//            console.log(i);
//            next();
//          }, function (err) {
//            console.log('done');
//          });
corelib.forEachSeries = function(list, iterator, callback)
{
    var self = this;
    callback = typeof callback == "function" ? callback : this.noop;
    if (!list || !list.length) return callback();
    function iterate(i) {
        if (i >= list.length) return callback();
        iterator(list[i], function(err) {
            if (err) {
                callback(err);
                callback = self.noop;
            } else {
                iterate(++i);
            }
        });
    }
    iterate(0);
}

// Apply an iterator function to each item in an array in parallel as many as specified in `limit` at a time. Execute a callback when all items
// have been completed or immediately if there is is an error provided.
corelib.forEachLimit = function(list, limit, iterator, callback)
{
    var self = this;
    callback = typeof callback == "function" ? callback : this.noop;
    if (!list || !list.length || typeof iterator != "function") return callback();
    if (!limit) limit = 1;
    var idx = 0, done = 0, running = 0;
    function iterate() {
        if (done >= list.length) return callback();
        while (running < limit && idx < list.length) {
            running++;
            iterator(list[idx++], function(err) {
                running--;
                if (err) {
                    callback(err);
                    callback = self.noop;
                    idx = done = list.length + 1;
                } else {
                    if (++done >= list.length) {
                        callback();
                        callback = self.noop;
                    } else {
                        iterate();
                    }
                }
            });
        }
    }
    iterate();
}

// Execute a list of functions in parellel and execute a callback upon completion or occurance of an error. Each function will be passed
// a callback to signal completion. The callback accepts an error for the first argument. The iterator and callback will be
// called via setImmediate function to allow the main loop to process I/O.
corelib.parallel = function(tasks, callback)
{
    this.forEach(tasks, function(task, next) {
        task(function(err) {
            setImmediate(next, err);
        });
    }, function(err) {
        if (typeof callback == "function") setImmediate(callback, err);
    });
}

// Execute a list of functions serially and execute a callback upon completion or occurance of an error. Each function will be passed
// a callback to signal completion. The callback accepts either an error for the first argument. The iterator and callback will be
// called via setImmediate function to allow the main loop to process I/O.
//
//          corelib.series([
//             function(next) {
//                setTimeout(function () { next(); }, 100);
//             },
//             function(next) {
//                setTimeout(function () { next(); }, 100);
//             },
//          ], function(err) {
//              console.log(err);
//          });
corelib.series = function(tasks, callback)
{
    this.forEachSeries(tasks, function(task, next) {
        task(function(err) {
            setImmediate(next, err);
        });
    }, function(err) {
        if (typeof callback == "function") setImmediate(callback, err);
    });
}

// While the test function returns true keep running the iterator, call the callback at the end if specified. All functions are called via setImmediate.
//
//          var count = 0;
//          corelib.whilst(function() { return count < 5; },
//                      function (callback) {
//                          count++;
//                          setTimeout(callback, 1000);
//                      }, function (err) {
//                          console.log(count);
//                      });
corelib.whilst = function(test, iterator, callback)
{
    var self = this;
    callback = typeof callback == "function" ? callback : this.noop;
    if (!test()) return callback();
    iterator(function (err) {
        if (err) return callback(err);
        setImmediate(function() { self.whilst(test, iterator, callback); });
    });
};

// Keep running iterator while the test function returns true, call the callback at the end if specified. All functions are called via setImmediate.
corelib.doWhilst = function(iterator, test, callback)
{
    var self = this;
    callback = typeof callback == "function" ? callback : this.noop;
    iterator(function(err) {
        if (err) return callback(err);
        if (!test()) return callback();
        setImmediate(function() { self.doWhilst(iterator, test, callback); });
    });
}

// Register the callback to be run later for the given message, the message must have id property which will be used for keeping track of the replies.
// A timeout is created for this message, if runCallback for this message will not be called in time the timeout handler will call the callback
// anyways with the original message.
// The callback passed will be called with only one argument which is the message, what is inside the message this function does not care. If
// any errors must be passed, use the message object for it, no other arguments are expected.
corelib.deferCallback = function(obj, msg, callback, timeout)
{
    var self = this;
    if (!msg || !msg.id || !callback) return;

    obj[msg.id] = {
         timeout: setTimeout(function() {
             delete obj[msg.id];
             try { callback(msg); } catch(e) { logger.error('callback:', e, msg, e.stack); }
         }, timeout || this.deferTimeout),

         callback: function(data) {
             clearTimeout(this.timeout);
             try { callback(data); } catch(e) { logger.error('callback:', e, data, e.stack); }
         }
    };
}

// Run delayed callback for the message previously registered with the `deferCallback` method.
// The message must have id property which is used to find the corresponding callback, if msg is a JSON string it will be converted into the object.
corelib.runCallback = function(obj, msg)
{
    var self = this;
    if (!msg) return;
    if (typeof msg == "string") {
        try { msg = JSON.parse(msg); } catch(e) { logger.error('runCallback:', msg, e.stack); }
    }
    if (!msg.id || !obj[msg.id]) return;
    // Only keep reference for the callback
    var item = obj[msg.id];
    delete obj[msg.id];

    // Make sure the timeout will not fire before the immediate call
    clearTimeout(item.timeout);
    // Call in the next loop cycle
    setImmediate(function() {
        try { item.callback(msg); } catch(e) { logger.error('runCallback:', msg, e.stack); }
    });
}

// Create a resource pool, create and close callbacks must be given which perform allocation and deallocation of the resources like db connections.
// Options defines the following properties:
// - create - method to be called to return a new resource item, takes 1 argument, a callback as function(err, item)
// - destroy - method to be called to destroy a resource item
// - validate - method to verify actibe resource item, return false if it needs to be destroyed
// - min - min number of active resource items
// - max - max number of active resource items
// - max_queue - how big the waiting queue can be, above this all requests will be rejected immediately
// - timeout - number of milliseconds to wait for the next available resource item, cannot be 0
// - idle - number of milliseconds before starting to destroy all active resources above the minimum, 0 to disable.
corelib.createPool = function(options)
{
    var self = this;

    var pool = { _pmin: this.toNumber(options.min, { float: 0, flt: 0, min: 0 }),
                 _pmax: this.toNumber(options.max, { float: 0, dflt: 10, min: 0 }),
                 _pmax_queue: this.toNumber(options.interval, { float: 0, dflt: 100, min: 0 }),
                 _ptimeout: this.toNumber(options.timeout, { float: 0, dflt: 5000, min: 1 }),
                 _pidle: this.toNumber(options.idle, { float: 0, dflt: 300000, min: 0 }),
                 _pcreate: options.create || function(cb) { cb(null, {}) },
                 _pdestroy: options.destroy || function() {},
                 _pvalidate: options.validate || function() { return true },
                 _pqueue_count: 0,
                 _pnum: 1,
                 _pqueue_count: 0,
                 _pqueue: {},
                 _pavail: [],
                 _pmtime: [],
                 _pbusy: [] };

    // Return next available resource item, if not available immediately wait for defined amount of time before calling the
    // callback with an error. The callback second argument is active resource item.
    pool.acquire = function(callback) {
        if (typeof callback != "function") return;

        // We have idle clients
        if (this._pavail.length) {
            var mtime = this._pmtime.shift();
            var client = this._pavail.shift();
            this._pbusy.push(client);
            return callback.call(this, null, client);
        }
        // Put into waiting queue
        if (this._pbusy.length >= this._pmax) {
            if (this._pqueue_count >= this._pmax_queue) return callback(new Error("no more resources"));

            this._pqueue_count++;
            return self.deferCallback(this._pqueue, { id: this._pnum++ }, function(m) {
                callback(m.client ? null : new Error("timeout waiting for the resource"), m.client);
            }, this._ptimeout);
        }
        // New item
        var me = this;
        this._palloc(function(err, client) {
            if (!err) me._pbusy.push(client);
            callback(err, client);
        });
    }

    // Destroy the resource item calling the provided close callback
    pool.destroy = function(client) {
        if (!client) return;

        var idx = this._pbusy.indexOf(client);
        if (idx > -1) {
            this._pclose(client);
            this._pbusy.splice(idx, 1);
            return;
        }
        var idx = this._pavail.indexOf(client);
        if (idx > -1) {
            this._pclose(client);
            this._pavail.splice(idx, 1);
            this._pmtime.splice(idx, 1);
            return;
        }
    }

    // Return the resource item back to the list of available resources.
    pool.release = function(client) {
        if (!client) return;

        var idx = this._pbusy.indexOf(client);
        if (idx == -1) {
            logger.error('pool.release:', 'not known', client);
            return;
        }

        // Pass it to the next waiting client
        for (var id in this._pqueue) {
            this._pqueue_count--;
            this._pqueue[id].id = id;
            this._pqueue[id].client = client;
            return self.runCallback(this._pqueue, this._pqueue[id]);
        }

        // Destroy if above the limit or invalid
        if (this._pavail.length > this._pmax || !this._pcheck(client)) {
            this._pclose(client);
        } else {
            // Add to the available list
            this._pavail.unshift(client);
            this._pmtime.unshift(Date.now());
        }
        // Remove from the busy list at the end to keep the object referenced all the time
        this._pbusy.splice(idx, 1);
    }

    pool.stats = function() {
        return { avail: this._pavail.length, busy: this._pbusy.length, queue: this._pqueue_count, min: this._pmin, max: this._pmax, max_queue: this._pmax_queue };
    }

    // Close all active clients
    pool.closeAll = function() {
        while (this._pavail.length > 0) this.destroy(this._pavail[0]);
    }

    // Close all connections and shutdown the pool, no more clients will be open and the pool cannot be used without re-initialization,
    // if callback is provided then wait until all items are released and call it, optional maxtime can be used to retsrict how long to wait for
    // all items to be released, when expired the callback will be called
    pool.shutdown = function(callback, maxtime) {
        logger.debug('pool.close:', 'shutdown:', this.name, 'avail:', this._pavail.length, 'busy:', this._pbusy.length);
        var self = this;
        this._pmax = -1;
        this.closeAll();
        this._pqueue = {};
        clearInterval(this._pinterval);
        if (typeof callback != "function") return;
        this._ptime = Date.now();
        this._pinterval = setInterval(function() {
            if (self._pbusy.length && (!maxtime || Date.now() - self._ptime < maxtime)) return;
            clearInterval(this._pinterval);
            callback();
        }, 500);
    }

    // Allocate a new client
    pool._palloc = function(callback) {
        try {
            this._pcreate.call(this, callback);
            logger.dev('pool.alloc:', 'avail:', this._pavail.length, 'busy:', this._pbusy.length);
        } catch(e) {
            logger.error('pool.alloc:', e);
            callback(e);
        }
    }

    // Destroy the resource item calling the provided close callback
    pool._pclose = function(client) {
        try {
            this._pdestroy.call(this, client);
            logger.dev('pool.close:', 'destroy:', this._pavail.length, 'busy:', this._pbusy.length);
        } catch(e) {
            logger.error('pool.close:', e);
        }
    }

    // Verify if the resource item is valid
    pool._pcheck = function(client) {
        try {
            return this._pvalidate.call(this, client);
        } catch(e) {
            logger.error('pool.check:', e);
            return false;
        }
    }
    // Timer to ensure pool integrity
    pool._ptimer = function() {
        var me = this;
        var now = Date.now();

        // Expire idle items
        if (this._pidle > 0) {
            for (var i = 0; i < this._pavail.length; i++) {
                if (now - this._pmtime[i] > this._pidle && this._pavail.length + this._pbusy.length > this._pmin) {
                    logger.dev('pool.timer:', pool.name || "", 'idle', i, 'avail:', this._pavail.length, 'busy:', this._pbusy.length);
                    this.destroy(this._pavail[i]);
                    i--;
                }
            }
        }

        // Ensure min number of items
        var min = this._pmin - this._pavail.length - this._pbusy.length;
        for (var i = 0; i < min; i++) {
            this._palloc(function(err, client) { if (!err) me._pavail.push(client); });
        }
    }

    // Periodic housekeeping if interval is set
    if (pool._pidle > 0) {
        this._pinterval = setInterval(function() { pool._ptimer() }, Math.max(1000, pool._pidle/3));
        setImmediate(function() { pool._ptimer(); });
    }

    return pool;
}

// Return object with geohash for given coordinates to be used for location search
// options may contain the following properties:
//   - distance - limit the range key with the closest range smaller than then distance, required for search but for updates may be omitted
//   - minDistance - radius for the smallest bounding box in km containing single location, radius searches will combine neighboring boxes of
//      this size to cover the whole area with the given distance request, also this affects the length of geohash keys stored in the bk_location table
//      if not specified default `min-distance` value will be used.
corelib.geoHash = function(latitude, longitude, options)
{
    if (!options) options = {};
    var minDistance = options.minDistance || 1;
    if (options.distance && options.distance < minDistance) options.distance = minDistance;

    // Geohash ranges for different lengths in km, take the first greater than our min distance
    var range = [ [12, 0], [8, 0.019], [7, 0.076],
                  [6, 0.61], [5, 2.4], [4, 20.0],
                  [3, 78.0], [2, 630.0], [1, 2500.0],
                  [1, 99999]
                ].filter(function(x) { return x[1] > minDistance })[0];

    var geohash = utils.geoHashEncode(latitude, longitude);
    return { geohash: geohash.substr(0, range[0]),
             _geohash: geohash,
             neighbors: options.distance ? utils.geoHashGrid(geohash.substr(0, range[0]), Math.ceil(options.distance / range[1])).slice(1) : [],
             latitude: latitude,
             longitude: longitude,
             minRange: range[1],
             minDistance: minDistance,
             distance: options.distance || 0 };
}

// Return distance between two locations, options can specify the following properties:
// - round - a number how to round the distance
//
//  Example: round to the nearest full 5 km and use only 1 decimal point, if the distance is 13, it will be 15.0
//
//      corelib.geoDistance(34, -188, 34.4, -119, { round: 5.1 })
//
corelib.geoDistance = function(latitude1, longitude1, latitude2, longitude2, options)
{
    var distance = utils.geoDistance(latitude1, longitude1, latitude2, longitude2);
    if (isNaN(distance) || distance === null) return null;

    // Round the distance to the closes edge and fixed number of decimals
    if (options && typeof options.round == "number" && options.round > 0) {
        var decs = String(options.round).split(".")[1];
        distance = parseFloat(Number(Math.floor(distance/options.round)*options.round).toFixed(decs ? decs.length : 0));
        if (isNaN(distance)) return null;
    }
    return distance;
}

// Same as geoDistance but operates on 2 geohashes instead of coordinates.
corelib.geoHashDistance = function(geohash1, geohash2, options)
{
    var coords1 = utils.geoHashDecode(geohash1);
    var coords2 = utils.geoHashDecode(geohash2);
    return this.geoDistance(coords1[0], coords1[1], coords2[0], coords2[1], options);
}

// Encrypt data with the given key code
corelib.encrypt = function(key, data, algorithm, encoding)
{
    if (!key || !data) return '';
    try {
        var encrypt = crypto.createCipher(algorithm || 'aes192', key);
        var b64 = encrypt.update(String(data), 'utf8', encoding || 'base64');
        b64 += encrypt.final(encoding || 'base64');
    } catch(e) {
        b64 = '';
        logger.debug('encrypt:', e.stack, data);
    }
    return b64;
}

// Decrypt data with the given key code
corelib.decrypt = function(key, data, algorithm, encoding)
{
    if (!key || !data) return '';
    try {
        var decrypt = crypto.createDecipher(algorithm || 'aes192', key);
        var msg = decrypt.update(String(data), encoding || 'base64', 'utf8');
        msg += decrypt.final('utf8');
    } catch(e) {
        msg = '';
        logger.debug('decrypt:', e.stack, data);
    };
    return msg;
}

// HMAC signing and base64 encoded, default algorithm is sha1
corelib.sign = function (key, data, algorithm, encode)
{
    try {
        return crypto.createHmac(algorithm || "sha1", String(key)).update(String(data), "utf8").digest(encode || "base64");
    } catch(e) {
        logger.error('sing:', algorithm, encode, e.stack);
        return "";
    }
}

// Hash and base64 encoded, default algorithm is sha1
corelib.hash = function (data, algorithm, encode)
{
    try {
        return crypto.createHash(algorithm || "sha1").update(String(data), "utf8").digest(encode || "base64");
    } catch(e) {
        logger.error('hash:', algorithm, encode, e.stack);
        return "";
    }
}

// Return unique Id without any special characters and in lower case
corelib.uuid = function()
{
    return uuid.v4().replace(/[-]/g, '').toLowerCase();
}

// Generate random key, size if specified defines how many random bits to generate
corelib.random = function(size)
{
    return this.sign(crypto.randomBytes(64), crypto.randomBytes(size || 256), 'sha256').replace(/[=+%]/g, '');
}

// Return random number between 0 and USHORT_MAX
corelib.randomUShort = function()
{
    return crypto.randomBytes(2).readUInt16LE(0);
}

// Return random number between 0 and SHORT_MAX
corelib.randomShort = function()
{
    return Math.abs(crypto.randomBytes(2).readInt16LE(0));
}

// Return rando number between 0 and UINT_MAX
corelib.randomUInt = function()
{
    return crypto.randomBytes(4).readUInt32LE(0);
}

// Return random integer between min and max inclusive
corelib.randomInt = function(min, max)
{
    return min + (0 | Math.random() * (max - min + 1));
}

// Generates a random number between given min and max (required)
// Optional third parameter indicates the number of decimal points to return:
//   - If it is not given or is NaN, random number is unmodified
//   - If >0, then that many decimal points are returned (e.g., "2" -> 12.52
corelib.randomNum = function(min, max, decs)
{
    var num = min + (Math.random() * (max - min));
    return (typeof decs !== 'number' || decs <= 0) ? num : parseFloat(num.toFixed(decs));
}

// Return number of seconds for current time
corelib.now = function()
{
    return Math.round(Date.now()/1000);
}

// Format date object
corelib.strftime = function(date, fmt, utc)
{
    if (typeof date == "string" || typeof date == "number") try { date = new Date(date); } catch(e) {}
    if (!date || isNaN(date)) return "";
    function zeropad(n) { return n > 9 ? n : '0' + n; }
    var handlers = {
        a: function(t) { return [ 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat' ][utc ? t.getUTCDay() : t.getDay()] },
        A: function(t) { return [ 'Sunday', 'Monday', 'Tuedsay', 'Wednesday', 'Thursday', 'Friday', 'Saturday' ][utc ? t.getUTCDay() : t.getDay()] },
        b: function(t) { return [ 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec' ][utc ? t.getUTCMonth() : t.getMonth()] },
        B: function(t) { return [ 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December' ][utc ? t.getUTCMonth() : t.getMonth()] },
        c: function(t) { return utc ? t.toUTCString() : t.toString() },
        d: function(t) { return zeropad(utc ? t.getUTCDate() : t.getDate()) },
        H: function(t) { return zeropad(utc ? t.getUTCHours() : t.getHours()) },
        I: function(t) { return zeropad(((utc ? t.getUTCHours() : t.getHours()) + 12) % 12) },
        L: function(t) { return zeropad(utc ? t.getUTCMilliseconds() : t.getMilliseconds()) },
        m: function(t) { return zeropad((utc ? t.getUTCMonth() : t.getMonth()) + 1) }, // month-1
        M: function(t) { return zeropad(utc ? t.getUTCMinutes() : t.getMinutes()) },
        p: function(t) { return this.H(t) < 12 ? 'AM' : 'PM'; },
        S: function(t) { return zeropad(utc ? t.getUTCSeconds() : t.getSeconds()) },
        w: function(t) { return utc ? t.getUTCDay() : t.getDay() }, // 0..6 == sun..sat
        W: function(t) { var d = new Date(t.getFullYear(), 0, 1); return zeropad(Math.ceil((((t - d) / 86400000) + (utc ? d.getUTCDay() : d.getDay()) + 1) / 7)); },
        y: function(t) { return zeropad(this.Y(t) % 100); },
        Y: function(t) { return utc ? t.getUTCFullYear() : t.getFullYear() },
        t: function(t) { return t.getTime() },
        u: function(t) { return Math.floor(t.getTime()/1000) },
        '%': function(t) { return '%' },
    };
    for (var h in handlers) {
        fmt = fmt.replace('%' + h, handlers[h](date));
    }
    return fmt;
}

// Return RFC3339 formatted timestamp for a date or current time
corelib.toRFC3339 = function (date)
{
    date = date ? date : new Date();
    var offset = date.getTimezoneOffset();
    return this.zeropad(date.getFullYear(), 4)
            + "-" + this.zeropad(date.getMonth() + 1, 2)
            + "-" + this.zeropad(date.getDate(), 2)
            + "T" + this.zeropad(date.getHours(), 2)
            + ":" + this.zeropad(date.getMinutes(), 2)
            + ":" + this.zeropad(date.getSeconds(), 2)
            + "." + this.zeropad(date.getMilliseconds(), 3)
            + (offset > 0 ? "-" : "+")
            + this.zeropad(Math.floor(Math.abs(offset) / 60), 2)
            + ":" + this.zeropad(Math.abs(offset) % 60, 2);
}

// Return a string with leading zeros
corelib.zeropad = function(n, width)
{
    var pad = "";
    while (pad.length < width - 1 && n < Math.pow(10, width - pad.length - 1)) pad += "0";
    return pad + String(n);
}

// Nicely format an object with indentations
corelib.formatJSON = function(obj, indent)
{
    var self = this;
    // Shortcut to parse and format json from the string
    if (typeof obj == "string" && obj != "") {
        if (obj[0] != "[" && obj[0] != "{") return obj;
        try { obj = JSON.parse(obj); } catch(e) { self.log(e) }
    }
    if (!indent) indent = "";
    var style = "    ";
    var type = this.typeName(obj);
    var count = 0;
    var text = type == "array" ? "[" : "{";

    for (var p in obj) {
        var val = obj[p];
        if (count > 0) text += ",";
        if (type != "array") {
            text += ("\n" + indent + style + "\"" + p + "\"" + ": ");
        }
        switch (this.typeName(val)) {
        case "array":
        case "object":
            text += this.formatJSON(val, (indent + style));
            break;
        case "boolean":
        case "number":
            text += val.toString();
            break;
        case "null":
            text += "null";
            break;
        case "string":
            text += ("\"" + val + "\"");
            break;
        default:
            text += ("unknown: " + typeof(val));
        }
        count++;
    }
    text += type == "array" ? "]" : ("\n" + indent + "}");
    return text;
}

// Split string into array, ignore empty items, `sep` is an RegExp to use as a separator instead of default  pattern `[,\|]`, if num is 1, then convert all items into numbers
corelib.strSplit = function(str, sep, num)
{
    var self = this;
    if (!str) return [];
    return (Array.isArray(str) ? str : String(str).split(sep || /[,\|]/)).
            map(function(x) { return num ? self.toNumber(x) : typeof x == "string" ? x.trim() : x }).
            filter(function(x) { return typeof x == "string" ? x : 1 });
}

// Split as above but keep only unique items
corelib.strSplitUnique = function(str, sep, num)
{
    var rc = [];
    this.strSplit(str, sep, num).forEach(function(x) { if (!rc.some(function(y) { return x.toLowerCase() == y.toLowerCase() })) rc.push(x)});
    return rc;
}

// Returns only unique items in the array, optional `key` specified the name of the column to use when determining uniqueness if items are objects.
corelib.arrayUnique = function(list, key)
{
    if (!Array.isArray(list)) return this.strSplitUnique(list);
    var rc = [], keys = {};
    list.forEach(function(x) {
        if (key) {
            if (!keys[x[key]]) rc.push(x);
            keys[x[key]] = 1;
        } else {
            if (rc.indexOf(x) == -1) rc.push(x);
        }
    });
    return rc;
}

// Stringify JSON into base64 string, if secret is given, sign the data with it
corelib.jsonToBase64 = function(data, secret)
{
    data = JSON.stringify(data);
    if (secret) return this.encrypt(secret, data);
    return new Buffer(data).toString("base64");
}

// Parse base64 JSON into JavaScript object, in some cases this can be just a number then it is passed as it is, if secret is given verify
// that data is not chnaged and was signed with the same secret
corelib.base64ToJson = function(data, secret)
{
    var rc = "";
    if (secret) data = this.decrypt(secret, data);
    try {
        if (data.match(/^[0-9]+$/)) {
            rc = this.toNumber(data);
        } else {
            if (!secret) data = new Buffer(data, "base64").toString();
            if (data) rc = JSON.parse(data);
        }
    } catch(e) {
        logger.debug("base64ToJson:", e.stack, data);
    }
    return rc;
}

// Copy file and then remove the source, do not overwrite existing file
corelib.moveFile = function(src, dst, overwrite, callback)
{
    var self = this;
    if (typeof overwrite == "function") callback = overwrite, overwrite = false;

    function copyIfFailed(err) {
        if (!err) return (callback ? callback(null) : null);
        self.copyFile(src, dst, overwrite, function(err2) {
            if (!err2) {
                fs.unlink(src, callback);
            } else {
                if (callback) callback(err2);
            }
        });
    }

    logger.debug('moveFile:', src, dst, overwrite);
    fs.stat(dst, function (err) {
        if (!err && !overwrite) return callback(new Error("File " + dst + " exists."));
        fs.rename(src, dst, copyIfFailed);
    });
}

// Copy file, overwrite is optional flag, by default do not overwrite
corelib.copyFile = function(src, dst, overwrite, callback)
{
    if (typeof overwrite == "function") callback = overwrite, overwrite = false;

    function copy(err) {
        var ist, ost;
        if (!err && !overwrite) return callback ? callback(new Error("File " + dst + " exists.")) : null;
        fs.stat(src, function (err2) {
            if (err2) return callback ? callback(err2) : null;
            ist = fs.createReadStream(src);
            ost = fs.createWriteStream(dst);
            ist.on('end', function() { if (callback) callback() });
            ist.pipe(ost);
        });
    }
    logger.debug('copyFile:', src, dst, overwrite);
    fs.stat(dstopy);
}

// Run the process and return all output to the callback, this a simply wrapper around child_processes.exec so the corelib.runProcess
// can be used without importing the child_processes module. All fatal errors are logged.
corelib.execProcess = function(cmd, callback)
{
    var self = this;
    child.exec(cmd, function (err, stdout, stderr) {
        if (err) logger.error('execProcess:', cmd, err);
        if (callback) callback(err, stdout, stderr);
    });
}

// Run specified command with the optional arguments, this is similar to child_process.spawn with callback being called after the process exited
//
//  Example
//
//          corelib.spawProcess("ls", "-ls", { cwd: "/tmp" }, db.showResult)
//
corelib.spawnProcess = function(cmd, args, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = { stdio: "inherit", env: process.env, cwd: process.cwd };
    if (!options.stdio) options.stdio = "inherit";
    if (!Array.isArray(args)) args = [ args ];
    var proc = child.spawn(cmd, args, options);
    proc.on("error", function(err) {
        logger.error("spawnProcess:", cmd, args, err);
        if (callback) callback(err);
    });
    proc.on('exit', function (code, signal) {
        logger.debug("spawnProcess:", cmd, args, "exit", code || signal);
        if (callback) callback(code || signal);
    });
    return proc;
}

// Run a series of commands, `cmds` is an object where a property name is a command to execute and the value is an array of arguments or null.
// if `options.error` is 1, then stop on first error or if non-zero status on a process exit.
//
//  Example:
//
//          corelib.spawnSeries({"ls": "-la",
//                            "ps": "augx",
//                            "du": { argv: "-sh", stdio: "inherit", cwd: "/tmp" },
//                            "uname": ["-a"] },
//                           db.showResult)
//
corelib.spawnSeries = function(cmds, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = { stdio: "inherit", env: process.env, cwd: process.cwd };
    this.forEachSeries(Object.keys(cmds), function(cmd, next) {
        var argv = cmds[cmd], opts = options;
        switch (self.typeName(argv)) {
        case "null":
            argv = [];
            break;

        case "object":
            opts = argv;
            argv = opts.argv;
            break;

        case "array":
        case "string":
            break;

        default:
            logger.error("spawnSeries:", "invalid arguments", cmd, argv);
            return next(options.error ? self.newError("invalid args", cmd) : null);
        }
        if (!options.stdio) options.stdio = "inherit";
        if (typeof argv == "string") argv = [ argv ];
        self.spawnProcess(cmd, argv, opts, function(err) {
            next(options.error ? err : null);
        });
    }, callback);
}

// Non-exception version, returns empty object,
// mtime is 0 in case file does not exist or number of seconds of last modified time
// mdate is a Date object with last modified time
corelib.statSync = function(file)
{
    var stat = { size: 0, mtime: 0, mdate: "", isFile: function() {return false}, isDirectory: function() {return false} }
    try {
        stat = fs.statSync(file);
        stat.mdate = stat.mtime.toISOString();
        stat.mtime = stat.mtime.getTime()/1000;
    } catch(e) {
        if (e.code != "ENOENT") logger.error('statSync:', e, e.stack);
    }
    return stat;
}

// Return contents of a file, empty if not exist or on error.
// Options can specify the format:
// - json - parse file as JSON, return an object, in case of error an empty object
// - list - split contents with the given separator
// - encoding - file encoding when converting to string
// - logger - if 1 log all errors
corelib.readFileSync = function(file, options)
{
    if (!file) return "";
    try {
        var data = fs.readFileSync(file).toString(options && options.encoding ? options.encoding : "utf8");
        if (options) {
            if (options.json) data = JSON.parse(data);
            if (options.list) data = data.split(options.list);
        }
        return data;
    } catch(e) {
        if (options) {
            if (options.logger) logger.error('readFileSync:', file, e);
            if (options.json) return {};
            if (options.list) return [];
        }
        return "";
    }
}

// Filter function to be used in findFile methods
corelib.findFilter = function(file, stat, options)
{
    if (!options) return 1;
    if (options.filter) return options.filter(file, stat);
    if (options.exclude instanceof RegExp && options.exclude.test(file)) return 0;
    if (options.include instanceof RegExp && !options.include.test(file)) return 0;
    if (options.types) {
        if (stat.isFile() && options.types.indexOf("f") == -1) return 0;
        if (stat.isDirectory() && options.types.indexOf("d") == -1) return 0;
        if (stat.isBlockDevice() && options.types.indexOf("b") == -1) return 0;
        if (stat.isCharacterDevice() && options.types.indexOf("c") == -1) return 0;
        if (stat.isSymbolicLink() && options.types.indexOf("l") == -1) return 0;
        if (stat.isFIFO() && options.types.indexOf("p") == -1) return 0;
        if (stat.isSocket() && options.types.indexOf("s") == -1) return 0;
    }
    return 1;
}

// Return list of files than match filter recursively starting with given path, file is the starting path.
// The options may contain the following:
//   - include - a regexp with file pattern to include
//   - exclude - a regexp with file pattern to exclude
//   - filter - a function(file, stat) that return 1 if the given file matches, stat is a object returned by fs.statSync
//   - depth - if a number it specifies max depth to go into the subfolders, starts with 1
//   - types - a string with types of files to include: d - a dir, f - a file, l - a symlink, c - char dev, b - block dev, s - socket, p - a FIFO
//   - base - if set only keep base file name in the result, not full path
corelib.findFileSync = function(file, options)
{
    var list = [];
    var level = arguments[2];
    if (typeof level != "number") level = 0;

    try {
        var stat = this.statSync(file);
        if (stat.isFile()) {
            if (this.findFilter(file, stat, options)) {
                list.push(options && options.base ? path.basename(file) : file);
            }
        } else
        if (stat.isDirectory()) {
            if (this.findFilter(file, stat, options)) {
                list.push(options && options.base ? path.basename(file) : file);
            }
            // We reached our directory depth
            if (options && typeof options.depth == "number" && level >= options.depth) return list;
            var files = fs.readdirSync(file);
            for (var i in files) {
                list = list.concat(this.findFileSync(path.join(file, files[i]), options, level + 1));
            }
        }
    } catch(e) {
        logger.error('findFileSync:', file, options, e.stack);
    }
    return list;
}

// Async version of find file, same options as in the sync version
corelib.findFile = function(dir, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {}
    if (!options.files) options.files = [];

    var level = arguments[3];
    if (typeof level != "number") level = 0;

    fs.readdir(dir, function(err, files) {
        if (err) return callback(err);

        self.forEachSeries(files, function(file, next) {
            if (options.done) return next();
            var full = path.join(dir, file);

            fs.stat(full, function(err, stat) {
                if (err) return next(err);

                if (stat.isFile()) {
                    if (self.findFilter(full, stat, options)) {
                        options.files.push(options.base ? file : full);
                    }
                    next();
                } else
                if (stat.isDirectory()) {
                    if (self.findFilter(full, stat, options)) {
                        options.files.push(options.base ? file : full);
                    }
                    // We reached our directory depth
                    if (options && typeof options.depth == "number" && level >= options.depth) return next();
                    self.findFile(full, options, next, level + 1);
                } else {
                    next()
                }
            });
        }, function(err) {
            if (callback) callback(err, options.files);
        });
    });
}

// Recursively create all directories, return 1 if created or 0 on error or if exists, no exceptions are raised, error is logged only
corelib.makePathSync = function(dir)
{
    var rc = 0;
    var list = path.normalize(dir).split("/");
    for (var i = 0, dir = ''; i < list.length; i++) {
        dir += list[i] + '/';
        try {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir);
                rc = 1;
            }
        } catch(e) {
            logger.error('makePath:', dir, e);
            return 0;
        }
    }
    return rc;
}

// Async version of makePath, stops on first error
corelib.makePath = function(dir, callback)
{
    var self = this;
    var list = path.normalize(dir).split("/");
    var full = "";
    self.forEachSeries(list, function(d, next) {
        full += d + '/';
        fs.exists(full, function(yes) {
            if (yes) return next();
            fs.mkdir(full, function(err) {
                next(err && err.code != 'EEXIST' && err.code != 'EISDIR' ? err : null);
            });
        });
    }, function(err) {
        if (err) logger.error('makePath:', err);
        if (callback) callback(err);
    });
}

// Recursively remove all files and folders in the given path, returns an error to the callback if any
corelib.unlinkPath = function(dir, callback)
{
    var self = this;
    fs.stat(dir, function(err, stat) {
        if (err) return callback ? callback(err) : null;
        if (stat.isDirectory()) {
            fs.readdir(dir, function(err, files) {
                if (err) return next(err);
                self.forEachSeries(files, function(f, next) {
                    self.unlinkPath(path.join(dir, f), next);
                }, function(err) {
                    if (err) return callback ? callback(err) : null;
                    fs.rmdir(dir, callback);
                });
            });
        } else {
            fs.unlink(dir, callback);
        }
    });
}

// Recursively remove all files and folders in the given path, stops on first error
corelib.unlinkPathSync = function(dir)
{
    var files = this.findFileSync(dir);
    // Start from the end to delete files first, then folders
    for (var i = files.length - 1; i >= 0; i--) {
        try {
            var stat = this.statSync(files[i]);
            if (stat.isDirectory()) {
                fs.rmdirSync(files[i]);
            } else {
                fs.unlinkSync(files[i]);
            }
        } catch(e) {
            logger.error("unlinkPath:", dir, e);
            return 0;
        }
    }
    return 1;
}

// Change file owner, multiples files can be specified, do not report errors about non existent files, the uid/gid must be set to non-root user
// for this function to work and it is called by the root only, all the rest of the arguments are used as files names
//
// Example:
//
//           corelib.chownSync(1, 1, "/path/file1", "/path/file2")
corelib.chownSync = function(uid, gid)
{
    if (process.getuid() || !uid) return;
    for (var i = 2; i < arguments.length; i++) {
        var file = arguments[i];
        if (!file) continue;
        try {
            fs.chownSync(file, uid, gid);
        } catch(e) {
            if (e.code != 'ENOENT') logger.error('chownSync:', uid, gid, file, e);
        }
    }
}

// Create a directories if do not exist, multiple dirs can be specified, all preceeding directories are not created
//
// Example:
//
//             corelib.mkdirSync("dir1", "dir2")
corelib.mkdirSync = function()
{
    for (var i = 0; i < arguments.length; i++) {
        var dir = arguments[i];
        if (!dir) continue;
        if (!fs.existsSync(dir)) {
            try { fs.mkdirSync(dir) } catch(e) { logger.error('mkdirSync:', dir, e); }
        }
    }
}

// Extract domain from the host name, takes all host parts except the first one
corelib.domainName = function(host)
{
    var name = String(host || "").split('.');
    return (name.length > 2 ? name.slice(1).join('.') : host).toLowerCase();
}

// Return object type, try to detect any distinguished type
corelib.typeName = function(v)
{
    var t = typeof(v);
    if (v === null) return "null";
    if (t !== "object") return t;
    if (Array.isArray(v)) return "array";
    if (Buffer.isBuffer(v)) return "buffer";
    if (v instanceof Date) return "date";
    if (v instanceof RegExp) return "regexp";
    return "object";
}

// Return true of the given value considered empty
corelib.isEmpty = function(val)
{
    switch (this.typeName(val)) {
    case "null":
    case "undefined":
        return true;
    case "buffer":
    case "array":
        return val.length == 0;
    case "number":
    case "regexp":
    case "boolean":
        return false;
    case "date":
        return isNaN(val);
    default:
        return val ? false: true;
    }
}

// Return true if a variable or property in the object exists, just a syntax sugar
corelib.exists = function(obj, name)
{
    if (typeof obj == "undefined") return false;
    if (typeof obj == "obj" && typeof obj[name] == "undefined") return false;
    return true;
}

// A copy of an object, this is a shallow copy, only arrays and objects are created but all other types are just referenced in the new object
// - first argument is the object to clone, can be null
// - all additional arguments are treated as name value pairs and added to the cloned object as additional properties
// Example:
//          corelib.cloneObj({ 1: 2 }, "3", 3, "4", 4)
corelib.cloneObj = function()
{
    var obj = arguments[0];
    var rc = {};
    for (var p in obj) {
        switch (this.typeName(obj[p])) {
        case "object":
            rc[p] = {};
            for (var k in obj[p]) rc[p][k] = obj[p][k];
            break;
        case "array":
            rc[p] = [];
            for (var k in obj[p]) rc[p][k] = obj[p][k];
            break;
        default:
            rc[p] = obj[p];
        }
    }
    for (var i = 1; i < arguments.length - 1; i += 2) rc[arguments[i]] = arguments[i + 1];
    return rc;
}

// Return a new Error object, options can be a string which will create an error with a message only
// or an object with message, code, status, and name properties to build full error
corelib.newError = function(options)
{
    if (typeof options == "string") options = { message: options };
    if (!options) options = {};
    var err = new Error(options.message || "Unknown error");
    if (options.name) err.name = options.name;
    if (options.code) err.code = options.code;
    if (options.status) err.status = options.status;
    if (err.code && !err.status) err.status = err.code;
    if (err.status && !err.code) err.code = err.status;
    return err;
}

// Return new object using arguments as name value pairs for new object properties
corelib.newObj = function()
{
    var obj = {};
    for (var i = 0; i < arguments.length - 1; i += 2) obj[arguments[i]] = arguments[i + 1];
    return obj;
}

// Merge an object with the options, all properties in the options override existing in the object, returns a new object
//
//  Example
//
//       var o = corelib.mergeObject({ a:1, b:2, c:3 }, { c:5, d:1 })
//       o = { a:1, b:2, c:5, d:1 }
corelib.mergeObj = function(obj, options)
{
    var rc = {};
    for (var p in options) rc[p] = options[p];
    for (var p in obj) {
        var val = obj[p];
        switch (corelib.typeName(val)) {
        case "object":
            if (!rc[p]) rc[p] = {};
            for (var c in val) {
                if (!rc[p][c]) rc[p][c] = val[c];
            }
            break;
        case "null":
        case "undefined":
            break;
        default:
            if (!rc[p]) rc[p] = val;
        }
    }
    return rc;
}

// Flatten a javascript object into a single-depth object, all nested values will have property names appended separated by comma
//
// Example
//
//          > corelib.flattenObj({ a: { c: 1 }, b: { d: 1 } } )
//          { 'a.c': 1, 'b.d': 1 }
corelib.flattenObj = function(obj, options)
{
    var rc = {};

    for (var p in obj) {
        if (typeof obj[p] == 'object') {
            var o = this.flattenObj(obj[p], options);
            for (var x in o) {
                rc[p + (options && options.separator ? options.separator : '.') + x] = o[x];
            }
        } else {
            rc[p] = obj[p];
        }
    }
    return rc;
}

// Add properties to existing object, first arg is the object, the rest are pairs: name, value,....
// If the second argument is an object then add all properties from this object only.
//
//         corelib.extendObj({ a: 1 }, 'b', 2, 'c' 3 )
//         corelib.extendObj({ a: 1 }, { b: 2, c: 3 })
//
corelib.extendObj = function()
{
    if (this.typeName(arguments[0]) != "object") arguments[0] = {};
    if (this.typeName(arguments[1]) == "object") {
        for (var p in arguments[1]) arguments[0][p] = arguments[1][p];
    } else {
        for (var i = 1; i < arguments.length - 1; i += 2) arguments[0][arguments[i]] = arguments[i + 1];
    }
    return arguments[0];
}

// Delete properties from the object, first arg is an object, the rest are properties to be deleted
corelib.delObj = function()
{
    if (this.typeName(arguments[0]) != "object") return;
    for (var i = 1; i < arguments.length; i++) delete arguments[0][arguments[i]];
    return arguments[0];
}

// Return an object consisting of properties that matched given criteria in the given object.
// optins can define the following properties:
// - name - search by property name, return all objects that contain given property
// - value - search by value, return all objects that have a property with given value
// - sort if true then sort found columns by the property value.
// - names - if true just return list of column names
// - flag - if true, return object with all properties set to flag value
//
// Example
//
//          corelib.searchObj({id:{index:1},name:{index:3},type:{index:2},descr:{}}, { name: 'index', sort: 1 });
//          { id: { index: 1 }, type: { index: 2 }, name: { index: 3 } }
//
corelib.searchObj = function(obj, options)
{
    if (!options) options = {};
    var name = options.name;
    var val = options.value;
    var rc = Object.keys(obj).
                    filter(function(x) {
                        if (typeof obj[x] != "object") return 0;
                        if (typeof name != "undefined" && typeof obj[x][name] == "undefined") return 0;
                        if (typeof val != "undefined" && !Object.keys(obj[x]).some(function(y) { return obj[x][y] == val })) return 0;
                        return 1;
                    }).
                    sort(function(a, b) {
                        if (options.sort) return obj[a][name] - obj[b][name];
                        return 0;
                    }).
                    reduce(function(x,y) { x[y] = options.flag || obj[y]; return x; }, {});

    if (options.names) return Object.keys(rc);
    return rc;
}

// Return a property from the object, name specifies the path to the property, if the required property belong to another object inside the top one
// the name uses . to separate objects. This is a convenient method to extract properties from nested objects easily.
// Options may contains the following properties:
//   - list - return the value as a list even if there is only one value found
//   - obj - return the value as an object, if the result is a simple type, wrap into an object like { name: name, value: result }
//   - str - return the value as a string, convert any other type into string
//   - num - return the value as a number, convert any other type by using toNumber
//   - func - return the value as a function, if the object is not a function returns null
//
// Example:
//
//          > corelib.objGet({ response: { item : { id: 123, name: "Test" } } }, "response.item.name")
//          "Test"
//          > corelib.objGet({ response: { item : { id: 123, name: "Test" } } }, "response.item.name", { list: 1 })
//          [ "Test" ]
corelib.objGet = function(obj, name, options)
{
    if (!obj) return options ? (options.list ? [] : options.obj ? {} : options.str ? "" : options.num ? 0 : null) : null;
    var path = !Array.isArray(name) ? String(name).split(".") : name;
    for (var i = 0; i < path.length; i++) {
        obj = obj[path[i]];
        if (typeof obj == "undefined") return options ? (options.list ? [] : options.obj ? {} : options.str ? "" : options.num ? 0 : null) : null;
    }
    if (obj && options) {
        if (options.func && typeof obj != "function") return null;
        if (options.list && !Array.isArray(obj)) return [ obj ];
        if (options.obj && typeof obj != "object") return { name: name, value: obj };
        if (options.str && typeof obj != "string") return String(obj);
        if (options.num && typeof obj != "number") return this.toNumber(obj);
    }
    return obj;
}

// Set a property of the object, name can be an array or a string with property path inside the object, all non existent intermediate
// objects will be create automatically. The options can have the folowing properties:
// - incr - if 1 the numeric value will be added to the existing if any
// - push - add to the array, if it is not an array a new empty aray is created
//
// Example
//
//          var a = corelib.objSet({}, "response.item.count", 1)
//          corelib.objSet(a, "response.item.count", 1, { incr: 1 })
//
corelib.objSet = function(obj, name, value, options)
{
    if (!obj) obj = {};
    if (!Array.isArray(name)) name = String(name).split(".");
    if (!name || !name.length) return obj;
    var p = name[name.length - 1], v = obj;
    for (var i = 0; i < name.length - 1; i++) {
        if (typeof obj[name[i]] == "undefined") obj[name[i]] = {};
        obj = obj[name[i]];
    }
    if (options && options.push) {
        if (!Array.isArray(obj[p])) obj[p] = [];
        obj[p].push(value);
    } else
    if (options && options.incr) {
        if (!obj[p]) obj[p] = 0;
        obj[p] += value;
    } else {
        obj[p] = value;
    }
    return v;
}

// JSON stringify without exceptions, on error just returns an empty string and logs the error
corelib.stringify = function(obj, filter)
{
    try { return JSON.stringify(obj, filter); } catch(e) { logger.error("stringify:", e); return "" }
}

// Silent JSON parse, returns null on error, no exceptions raised.
// options can specify the output in case of an error:
//  - list - return empty list
//  - obj - return empty obj
//  - str - return empty string
//  - error - report all errors
//  - debug - report errors in debug level
corelib.jsonParse = function(obj, options)
{
    function onerror(e) {
        if (options) {
            if (options.error) logger.error('jsonParse:', e, obj);
            if (options.debug) logger.debug('jsonParse:', e, obj);
            if (options.obj) return {};
            if (options.list) return [];
            if (options.str) return "";
        }
        return null;
    }
    if (!obj) return onerror("empty");
    try {
        obj = typeof obj == "string" ? JSON.parse(obj) : obj;
        if (options && options.obj && this.typeName(obj) != "object") obj = {};
        if (options && options.list && this.typeName(obj) != "array") obj = [];
        if (options && options.str && this.typeName(obj) != "string") obj = "";
    } catch(e) {
        obj = onerror(e);
    }
    return obj;
}

