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
var lib = {
    name: 'lib',
    deferTimeout: 50,
    geoHashRange: [ [12, 0], [8, 0.019], [7, 0.076], [6, 0.61], [5, 2.4], [4, 20.0], [3, 78.0], [2, 630.0], [1, 2500.0], [1, 99999] ],
}

module.exports = lib;

// Empty function to be used when callback was no provided
lib.noop = function() {}
lib.nocb = function(cb) { if (typeof cb == "function" ) cb(); };

// Returns a floating number from the version string, it assumes common semver format as major.minor.patch, all non-digits will
// be removed, underscores will be treated as dots. Returns a floating number which can be used in comparing versions.
//
// Example
//      > lib.toVersion("1.0.3")
//      1.000003
//      > lib.toVersion("1.0.3.4")
//      1.000003004
//      > lib.toVersion("1.0.3.4") > lib.toVersion("1.0.3")
//      true
//      > lib.toVersion("1.0.3.4") > lib.toVersion("1.0.0")
//      true
//      > lib.toVersion("1.0.3.4") > lib.toVersion("1.1.0")
//      false
lib.toVersion = function(str)
{
    return String(str).replace("_", ".").replace(/[^0-9.]/g, "").split(".").reduce(function(x,y,i) { return x + Number(y) / Math.pow(10, i * 3) }, 0);
}

// Encode with additional symbols, convert these into percent encoded:
//
//          ! -> %21, * -> %2A, ' -> %27, ( -> %28, ) -> %29
lib.encodeURIComponent = function(str)
{
    return encodeURIComponent(str).replace(/[!'()*]/g, function(m) {
        return m == '!' ? '%21' : m == "'" ? '%27' : m == '(' ? '%28' : m == ')' ? '%29' : m == '*' ? '%2A' : m;
    });
}

// Convert text into capitalized words
lib.toTitle = function(name)
{
    return String(name || "").replace(/_/g, " ").split(/[ ]+/).reduce(function(x,y) { return x + (y ? (y[0].toUpperCase() + y.substr(1) + " ") : "") }, "").trim();
}

// Convert into camelized form
lib.toCamel = function(name)
{
    return String(name || "").replace(/(?:[\-\_\.])(\w)/g, function (_, c) { return c ? c.toUpperCase () : ''; });
}

// Convert Camel names into names with dashes
lib.toUncamel = function(str)
{
    return String(str).replace(/([A-Z])/g, function(letter) { return '-' + letter.toLowerCase(); });
}

// Safe version, uses 0 instead of NaN, handle booleans, if float specified, returns as float.
//
// Options:
//  - dflt - default value
//  - float - treat as floating number
//  - min - minimal value, clip
//  - max - maximum value, clip
//
// Example:
//
//               lib.toNumber("123")
//               lib.toNumber("1.23", { float: 1, dflt: 0, min: 0, max: 2 })
//
lib.toNumber = function(val, options)
{
    var n = 0;
    if (typeof val == "number") {
        if (!options) return val;
        n = val;
    } else {
        if (!options) options = {};
        if (typeof options.dflt == "undefined") options.dflt = 0;
        if (typeof val != "string") {
            n = options.dflt;
        } else {
            // Autodetect floating number
            if (typeof options.float == "undefined" || options.float == null) options.float = /^[0-9-]+\.[0-9]+$/.test(val);
            n = val[0] == 't' ? 1 : val[0] == 'f' ? 0 : val == "infinity" ? Infinity : (options.float ? parseFloat(val, 10) : parseInt(val, 10));
            n = isNaN(n) ? options.dflt : n;
        }
    }
    if (typeof options.min == "number" && n < options.min) n = options.min;
    if (typeof options.max == "number" && n > options.max) n = options.max;
    return n;
}

// Return true if value represents true condition
lib.toBool = function(val, dflt)
{
    if (typeof val == "boolean") return val;
    if (typeof val == "undefined") val = dflt;
    return !val || val == "false" || val == "FALSE" || val == "f" || val == "F" || val == "0" ? false : true;
}

// Return Date object for given text or numeric date representation, for invalid date returns 1969
lib.toDate = function(val, dflt)
{
    if (util.isDate(val)) return val;
    var d = null;
    // String that looks like a number
    if (typeof val == "string" && /^[0-9\.]+$/.test(val)) val = this.toNumber(val);
    // Assume it is seconds which we use for most mtime columns, convert to milliseconds
    if (typeof val == "number" && val < 2147483647) val *= 1000;
    try { d = new Date(val); } catch(e) {}
    return !isNaN(d) ? d : new Date(dflt || 0);
}

// Convert value to the proper type
lib.toValue = function(val, type)
{
    switch ((type || "").trim()) {
    case "list":
    case 'array':
        return Array.isArray(val) ? val : String(val).split(/[,\|]/);

    case "expr":
    case "buffer":
        return val;

    case "real":
    case "float":
    case "double":
        return this.toNumber(val, { float: 1 });

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
        return /^[0-9\.]+$/.test(String(val)) ? this.toNumber(val) : (new Date(val));

    case "json":
        return JSON.stringify(val);

    default:
        if (typeof val == "string") return val;
        return String(val);
    }
}

// Add a regexp to the list of regexp objects, this is used in the config type `regexpmap`.
lib.toRegexpMap = function(obj, val)
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
lib.toRegexpObj = function(obj, val, del)
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

// Return duration in human format, mtime is msecs
lib.toDuration = function(mtime)
{
    var str = "";
    mtime = typeof mtime == "number" ? mtime : this.toNumber(mtime);
    if (mtime > 0) {
        var seconds = mtime/1000;
        var d = Math.floor(seconds / 86400);
        var h = Math.floor((seconds - d * 86400) / 3600);
        var m = Math.floor((seconds - d * 86400 - h * 3600) / 60);
        if (d > 0) {
            str = d + " day" + (d > 1 ? "s" : "");
            if (h > 0) str += " " + h + " hour" + (h > 1 ? "s" : "");
            if (m > 0) str += " " + m + " minute" + (m > 1 ? "s" : "");
        } else
        if (h > 0) {
            str = h + " hour" + (h > 1 ? "s" : "");
            if (m > 0) str += " " + m + " minute" + (m > 1 ? "s" : "");
        } else
        if (m > 0) {
            str = m + " minute" + (m > 1 ? "s" : "");
        } else {
            str = seconds + " second" + (seconds > 1 ? "s" : "");
        }
    }
    return str;
}

// Given time in msecs, return how long ago it happened
lib.toAge = function(mtime)
{
    var str = "";
    mtime = typeof mtime == "number" ? mtime : this.toNumber(mtime);
    if (mtime > 0) {
        var seconds = Math.floor((Date.now() - mtime)/1000);
        var d = Math.floor(seconds / 86400);
        var mm = Math.floor(d / 30);
        var w = Math.floor(d / 7);
        var h = Math.floor((seconds - d * 86400) / 3600);
        var m = Math.floor((seconds - d * 86400 - h * 3600) / 60);
        if (mm > 0) {
            str = mm + " month" + (mm > 1 ? "s" : "");
        } else
        if (w > 0) {
            str = w + " week" + (w > 1 ? "s" : "");
        } else
        if (d > 0) {
            str = d + " day" + (d > 1 ? "s" : "");
        } else
        if (h > 0) {
            str = h + " hour" + (h > 1 ? "s" : "");
        } else
        if (m > 0) {
            str = m + " minute" + (m > 1 ? "s" : "");
        } else {
            str = seconds + " second" + (seconds > 1 ? "s" : "");
        }
    }
    return str;
}

// Process incoming query and convert parameters according to the type definition, the schema contains the definition of the paramaters against which to
// validate incoming data. It is an object with property names and definitoons that at lrast must specify the type, all other options are type specific.
//
// The options can define the follwoing propetties:
//  - data - to pass realtime or other custom options for the validation or convertion utilities as the first argument if not defined in the definition.
//  - prefix - prefix to be used when searching for the parameters in the query, only properties with this prefix will be processed. The resulting
//     object will not have this prefix in the properties.
//
// If any of the properties have `required:1` and the value will not be resolved then the function returns an Error object with the `errmsg` message
// or default message, this is useful for detection of invalid or missing input data.
//
// Example:
//
//        var account = lib.toParams(req.query, { id: { type: "int" },
//                                                count: { type: "int", min: 1, max: 10, dflt: 5 },
//                                                page: { type: "int", min: 1, max: 10, dflt: NaN, required: 1, errmsg: "Page number is required" },
//                                                name: { type: "string" },
//                                                pair: { type: "map", separator: "|" },
//                                                code: { type: "string", regexp: /^[a-z]-[0-9]+$/, errmsg: "Valid code is required" },
//                                                start: { type: "token", required: 1 },
//                                                data: { type: "json", obj: 1 },
//                                                email: { type: "list", datatype: "string } },
//                                                ssn: { type: "string", regexp: /^[0-9]{3}-[0-9]{3}-[0-9]{4}$/, errmsg: "SSN is required" } },
//                                                phone: { type: "list", datatype: "number } },
//                                              { data: { start: { secret: req.account.secret },
//                                                        name: { dflt: "test" }
//                                              })
//
lib.toParams = function(query, schema, options)
{
    var rc = {}, opts;
    for (var name in schema) {
        opts = {};
        for (var p in schema[name]) opts[p] = schema[name][p];
        var dflt = options && options.data && options.data[name];
        for (var p in dflt) opts[p] = dflt[p];
        var v = query[((options && options.prefix)  || "") + name] || opts.dflt;
        logger.dev("toParams", name, v, ":", opts);
        switch (opts.type) {
        case "boolean":
        case "bool":
            if (typeof v != "undefined") rc[name] = this.toBool(v, opts.dflt);
            break;
        case "real":
        case "float":
        case "double":
            opts.float = 1;
        case "int":
        case "number":
        case "bigint":
        case "counter":
            if (typeof v != "undefined") rc[name] = this.toNumber(v, opts);
            break;
        case "list":
            if (v) rc[name] = this.strSplit(v, opts.separator, opts.datatype);
            break;
        case "map":
            if (!v) break;
            var list = this.strSplit(v, opts.separator, opts.datatype);
            if (!list.length) break;
            if (!rc[name]) rc[name] = {};
            for (var i = 0; i < list.length -1; i += 2) rc[name][list[i]] = list[i+1];
            break;
        case "token":
            if (v) rc[name] = this.base64ToJson(v, opts.secret);
            break;
        case "date":
        case "time":
            if (v) rc[name] = this.toDate(v, opts.dflt);
            break;
        case "timestamp":
            if (!v || this.toBool(v)) v = Date.now();
            rc[name] = this.strftime(this.toDate(v), opts.format || "%Y-%m-%d-%H:%M:%S.%L");
            break;
        case "json":
            if (!v) break;
            rc[name] = this.jsonParse(v, opts);
            break;
        default:
            if (!v) break;
            v = String(v);
            if ((opts.max && v.length > opts.max) ||
                (opts.min && v.length < opts.min) ||
                (util.isRegExp(opts.regexp) && !opts.regexp.test(v))) {
                break;
            }
            rc[name] = v;
            break;
        }
        // Return and error object
        if (opts.required && this.isEmpty(rc[name])) {
            return this.newError(opts.errmsg || (name + " is required"), opts.errcode);
        }
    }
    return rc;
}

// Returns true of the argument is a generic object, not a null, Buffer, Date, RegExp or Array
lib.isObject = function(v)
{
    return this.typeName(v) == "object";
}

// Return true if the value is a number
lib.isNumber = function(val)
{
    return typeof val == "number" && !isNaN(val);
}

// Returns true if a number is positive, i.e. greater than zero
lib.isPositive = function(val)
{
    return this.isNumber(val) && val > 0;
}

// Return true of the given value considered empty
lib.isEmpty = function(val)
{
    switch (this.typeName(val)) {
    case "null":
    case "undefined":
        return true;
    case "buffer":
    case "array":
        return val.length == 0;
    case "number":
    case "date":
        return isNaN(val);
    case "regexp":
    case "boolean":
        return false;
    case "string":
        return val.match(/^\s*$/) ? true : false;
    default:
        return val ? false: true;
    }
}

// Returns true if the given type belongs to the numeric family
lib.isNumeric = function(type)
{
    return ["int","smallint","bigint","counter","real","float","double","numeric","number"].indexOf(String(type).trim()) > -1;
}

// Evaluate expr, compare 2 values with optional type and operation
lib.isTrue = function(val1, val2, op, type)
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
//          lib.forEach([ 1, 2, 3 ], function (i, next) {
//              console.log(i);
//              next();
//          }, function (err) {
//              console.log('done');
//          });
lib.forEach = function(list, iterator, callback)
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
//          lib.forEachSeries([ 1, 2, 3 ], function (i, next) {
//            console.log(i);
//            next();
//          }, function (err) {
//            console.log('done');
//          });
lib.forEachSeries = function(list, iterator, callback)
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
lib.forEachLimit = function(list, limit, iterator, callback)
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
lib.parallel = function(tasks, callback)
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
//          lib.series([
//             function(next) {
//                setTimeout(function () { next(); }, 100);
//             },
//             function(next) {
//                setTimeout(function () { next(); }, 100);
//             },
//          ], function(err) {
//              console.log(err);
//          });
lib.series = function(tasks, callback)
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
//          lib.whilst(function() { return count < 5; },
//                      function (callback) {
//                          count++;
//                          setTimeout(callback, 1000);
//                      }, function (err) {
//                          console.log(count);
//                      });
lib.whilst = function(test, iterator, callback)
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
lib.doWhilst = function(iterator, test, callback)
{
    var self = this;
    callback = typeof callback == "function" ? callback : this.noop;
    iterator(function(err) {
        if (err) return callback(err);
        if (!test()) return callback();
        setImmediate(function() { self.doWhilst(iterator, test, callback); });
    });
}

// Register the callback to be run later for the given message, the message must have the `id` property which will be used for keeping track of the responses. The `parent`
// can be any object and is used to register the timer and keep reference to it.
//
// A timeout is created for this message, if `runCallback` for this message will not be called in time the timeout handler will call the callback
// anyway with the original message.
//
// The callback passed will be called with only one argument which is the message, what is inside the message this function does not care. If
// any errors must be passed, use the message object for it, no other arguments are expected.
lib.deferCallback = function(parent, msg, callback, timeout)
{
    var self = this;
    if (!msg || !msg.id || !callback) return;

    parent[msg.id] = {
        callback: callback,
        timeout: setTimeout(this.onDeferCallback.bind(parent, msg), timeout || this.deferTimeout)
    };
}

// To be called on timeout or when explicitely called by the `runCallback`, it is called in the context of the message.
lib.onDeferCallback = function(msg)
{
    var item = this[msg.id];
    if (!item) return;
    delete this[msg.id];
    clearTimeout(item.timeout);
    logger.dev("onDeferCallback:", msg);
    try { item.callback(msg); } catch(e) { logger.error('onDeferCallback:', e, msg, e.stack); }
}

// Run delayed callback for the message previously registered with the `deferCallback` method.
// The message must have `id` property which is used to find the corresponding callback, if the msg is a JSON string it will be converted into the object.
//
// Same parent object must be used for `deferCallback` and this method.
lib.runCallback = function(parent, msg)
{
    if (msg && typeof msg == "string") msg = this.jsonParse(msg, { error: 1 });
    if (!msg || !msg.id || !parent[msg.id]) return;
    setImmediate(this.onDeferCallback.bind(parent, msg));
}

// Return object with geohash for given coordinates to be used for location search
//
// The options may contain the following properties:
//   - distance - limit the range key with the closest range smaller than then distance, required for search but for updates may be omitted
//   - minDistance - radius for the smallest bounding box in km containing single location, radius searches will combine neighboring boxes of
//      this size to cover the whole area with the given distance request, also this affects the length of geohash keys stored in the bk_location table
//      if not specified default `min-distance` value will be used.
lib.geoHash = function(latitude, longitude, options)
{
    if (!options) options = {};
    var minDistance = options.minDistance || 1;
    if (options.distance && options.distance < minDistance) options.distance = minDistance;

    // Geohash ranges for different lengths in km, take the first greater than our min distance
    var range = this.geoHashRange.filter(function(x) { return x[1] > minDistance })[0];

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

// Return distance between two locations
//
// The options can specify the following properties:
// - round - a number how to round the distance
//
//  Example: round to the nearest full 5 km and use only 1 decimal point, if the distance is 13, it will be 15.0
//
//      lib.geoDistance(34, -188, 34.4, -119, { round: 5.1 })
//
lib.geoDistance = function(latitude1, longitude1, latitude2, longitude2, options)
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
lib.geoHashDistance = function(geohash1, geohash2, options)
{
    var coords1 = utils.geoHashDecode(geohash1);
    var coords2 = utils.geoHashDecode(geohash2);
    return this.geoDistance(coords1[0], coords1[1], coords2[0], coords2[1], options);
}

// Encrypt data with the given key code
lib.encrypt = function(key, data, algorithm, encoding)
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
lib.decrypt = function(key, data, algorithm, encoding)
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
lib.sign = function (key, data, algorithm, encode)
{
    try {
        return crypto.createHmac(algorithm || "sha1", String(key)).update(String(data), "utf8").digest(encode || "base64");
    } catch(e) {
        logger.error('sing:', algorithm, encode, e.stack);
        return "";
    }
}

// Hash and base64 encoded, default algorithm is sha1
lib.hash = function (data, algorithm, encode)
{
    try {
        return crypto.createHash(algorithm || "sha1").update(String(data), "utf8").digest(encode || "base64");
    } catch(e) {
        logger.error('hash:', algorithm, encode, e.stack);
        return "";
    }
}

// Return unique Id without any special characters and in lower case
lib.uuid = function()
{
    return uuid.v4().replace(/[-]/g, '').toLowerCase();
}

// Generate random key, size if specified defines how many random bits to generate
lib.random = function(size)
{
    return this.sign(crypto.randomBytes(64), crypto.randomBytes(size || 256), 'sha256').replace(/[=+%]/g, '');
}

// Return random number between 0 and USHORT_MAX
lib.randomUShort = function()
{
    return crypto.randomBytes(2).readUInt16LE(0);
}

// Return random number between 0 and SHORT_MAX
lib.randomShort = function()
{
    return Math.abs(crypto.randomBytes(2).readInt16LE(0));
}

// Return rando number between 0 and UINT_MAX
lib.randomUInt = function()
{
    return crypto.randomBytes(4).readUInt32LE(0);
}

// Return random integer between min and max inclusive
lib.randomInt = function(min, max)
{
    return min + (0 | Math.random() * (max - min + 1));
}

// Generates a random number between given min and max (required)
// Optional third parameter indicates the number of decimal points to return:
//   - If it is not given or is NaN, random number is unmodified
//   - If >0, then that many decimal points are returned (e.g., "2" -> 12.52
lib.randomNum = function(min, max, decs)
{
    var num = min + (Math.random() * (max - min));
    return (typeof decs !== 'number' || decs <= 0) ? num : parseFloat(num.toFixed(decs));
}

// Return number of seconds for current time
lib.now = function()
{
    return Math.round(Date.now()/1000);
}

// Format date object
lib.strftime = function(date, fmt, utc)
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

// C-sprintf alike
// based on http://stackoverflow.com/a/13439711
lib.sprintf = function(str)
{
    var i = 0, arr = arguments;
    function format(sym, p0, p1, p2, p3, p4) {
        if (sym == '%%') return '%';
        if (arr[++i] === undefined) return undefined;
        var exp = p2 ? parseInt(p2.substr(1)) : undefined;
        var base = p3 ? parseInt(p3.substr(1)) : undefined;
        var val;
        switch (p4) {
        case 's': val = arr[i];
            break;
        case 'c': val = arr[i][0];
            break;
        case 'f': val = parseFloat(arr[i]).toFixed(exp);
            break;
        case 'p': val = parseFloat(arr[i]).toPrecision(exp);
            break;
        case 'e': val = parseFloat(arr[i]).toExponential(exp);
            break;
        case 'x': val = parseInt(arr[i]).toString(base ? base : 16);
            break;
        case 'd': val = parseFloat(parseInt(arr[i], base ? base : 10).toPrecision(exp)).toFixed(0);
            break;
        }
        val = typeof(val) == 'object' ? JSON.stringify(val) : val.toString(base);
        var sz = parseInt(p1); /* padding size */
        var ch = p1 && p1[0] == '0' ? '0' : ' '; /* isnull? */
        while (val.length < sz) val = p0 !== undefined ? val + ch : ch + val; /* isminus? */
        return val;
    }
    var regex = /%(-)?(0?[0-9]+)?([.][0-9]+)?([#][0-9]+)?([scfpexd])/g;
    return str.replace(regex, format);
}

// Return RFC3339 formatted timestamp for a date or current time
lib.toRFC3339 = function (date)
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
lib.zeropad = function(n, width)
{
    var pad = "";
    while (pad.length < width - 1 && n < Math.pow(10, width - pad.length - 1)) pad += "0";
    return pad + String(n);
}

// Nicely format an object with indentations
lib.formatJSON = function(obj, indent)
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

// Split string into array, ignore empty items,
// - `sep` is an RegExp to use as a separator instead of default  pattern `[,\|]`,
// - `type` then convert all items into the type using `toValue`
//
// If `str` is an array and type is not specified then all non-string items will be returned as is.
lib.strSplit = function(str, sep, type)
{
    var self = this;
    if (!str) return [];
    var typed = typeof type != "undefined";
    return (Array.isArray(str) ? str : String(str).split(sep || /[,\|]/)).
            map(function(x) { return typed ? self.toValue(x, type) : typeof x == "string" ? x.trim() : x }).
            filter(function(x) { return typeof x == "string" ? x : 1 });
}

// Split as above but keep only unique items, case-insensitive
lib.strSplitUnique = function(str, sep, type)
{
    var rc = [];
    this.strSplit(str, sep, type).forEach(function(x) { if (!rc.some(function(y) { return x.toLowerCase() == y.toLowerCase() })) rc.push(x)});
    return rc;
}

// Returns only unique items in the array, optional `key` specified the name of the column to use when determining uniqueness if items are objects.
lib.arrayUnique = function(list, key)
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
lib.jsonToBase64 = function(data, secret)
{
    data = JSON.stringify(data);
    if (secret) return this.encrypt(secret, data);
    return new Buffer(data).toString("base64");
}

// Parse base64 JSON into JavaScript object, in some cases this can be just a number then it is passed as it is, if secret is given verify
// that data is not chnaged and was signed with the same secret
lib.base64ToJson = function(data, secret)
{
    var rc = "";
    if (typeof data == "undefined" || data == null) return rc;
    if (secret) data = this.decrypt(secret, data);
    try {
        if (typeof data == "number" || (typeof data == "string" && data.match(/^[0-9]+$/))) {
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

// Extract domain from the host name, takes all host parts except the first one
lib.domainName = function(host)
{
    var name = String(host || "").split('.');
    return (name.length > 2 ? name.slice(1).join('.') : host).toLowerCase();
}

// Return object type, try to detect any distinguished type
lib.typeName = function(v)
{
    var t = typeof(v);
    if (v === null) return "null";
    if (t !== "object") return t;
    if (Array.isArray(v)) return "array";
    if (Buffer.isBuffer(v)) return "buffer";
    if (util.isDate(v)) return "date";
    if (util.isRegExp(v)) return "regexp";
    return "object";
}

// Return a new Error object, options can be a string which will create an error with a message only
// or an object with message, code, status, and name properties to build full error
lib.newError = function(options, status)
{
    if (typeof options == "string") options = { status: status || 400, message: options };
    if (!options) options = {};
    var err = new Error(options.message || "Internal error");
    for (var p in options) err[p] = options[p];
    if (err.code && !err.status) err.status = err.code;
    if (err.status && !err.code) err.code = err.status;
    return err;
}

// Return true if a variable or property in the object exists,
// - if obj is null or undefined return false
// - if obj is an object, return true if the property is not undefined
// - if obj is an array then search for the value with indexOf, only simple values supported,
// - if both are arrays return true if at least one item is in both arrays
//
// Example:
//
//         lib.exists({ 1: 1 }, "1")
//         lib.exists([ 1, 2, 3 ], 1)
//         lib.exists([ 1, 2, 3 ], [ 1, 5 ])
lib.exists = function(obj, name)
{
    switch (this.typeName(obj)) {
    case "null":
    case "undefined":
        return false;
    case "object":
        return typeof obj[name] != "undefined";
    case "array":
        if (Array.isArray(name)) return obj.some(function(x) { return name.indexOf(x) > -1 });
        return obj.indexOf(name) > -1;
    }
    return !!obj;
}

// A copy of an object, this is a shallow copy, only arrays and objects are created but all other types are just referenced in the new object
// - first argument is the object to clone, can be null
// - all additional arguments are treated as name value pairs and added to the cloned object as additional properties
// Example:
//          lib.cloneObj({ 1: 2 }, "3", 3, "4", 4)
lib.cloneObj = function()
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

// Return new object using arguments as name value pairs for new object properties
lib.newObj = function()
{
    var obj = {};
    for (var i = 0; i < arguments.length - 1; i += 2) obj[arguments[i]] = arguments[i + 1];
    return obj;
}

// Merge an object with the options, all properties in the options override existing in the object, returns a new object, shallow copy,
// only top level properties are reassigned.
//
//  Example
//
//       var o = lib.mergeObject({ a:1, b:2, c:3 }, { c:5, d:1 })
//       o = { a:1, b:2, c:5, d:1 }
lib.mergeObj = function(obj, options)
{
    var rc = {};
    for (var p in options) rc[p] = options[p];
    for (var p in obj) {
        var val = obj[p];
        switch (lib.typeName(val)) {
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
//          > lib.flattenObj({ a: { c: 1 }, b: { d: 1 } } )
//          { 'a.c': 1, 'b.d': 1 }
lib.flattenObj = function(obj, options)
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
//         lib.extendObj({ a: 1 }, 'b', 2, 'c' 3 )
//         lib.extendObj({ a: 1 }, { b: 2, c: 3 })
//
lib.extendObj = function()
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
lib.delObj = function()
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
//          lib.searchObj({id:{index:1},name:{index:3},type:{index:2},descr:{}}, { name: 'index', sort: 1 });
//          { id: { index: 1 }, type: { index: 2 }, name: { index: 3 } }
//
lib.searchObj = function(obj, options)
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
//          > lib.objGet({ response: { item : { id: 123, name: "Test" } } }, "response.item.name")
//          "Test"
//          > lib.objGet({ response: { item : { id: 123, name: "Test" } } }, "response.item.name", { list: 1 })
//          [ "Test" ]
lib.objGet = function(obj, name, options)
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
//          var a = lib.objSet({}, "response.item.count", 1)
//          lib.objSet(a, "response.item.count", 1, { incr: 1 })
//
lib.objSet = function(obj, name, value, options)
{
    if (this.typeName(obj) != "object") obj = {};
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
lib.stringify = function(obj, filter)
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
lib.jsonParse = function(obj, options)
{
    if (!obj) return this.checkResult(new Error("empty json"), obj, options);
    try {
        obj = typeof obj == "string" ? JSON.parse(obj) : obj;
        if (options && options.obj && this.typeName(obj) != "object") obj = {};
        if (options && options.list && this.typeName(obj) != "array") obj = [];
        if (options && options.str && this.typeName(obj) != "string") obj = "";
    } catch(err) {
        obj = this.checkResult(err, obj, options);
    }
    return obj;
}

// Perform validation of the result type, make sure we return what is expected, this is a helper that is used by other conversion routines
lib.checkResult = function(err, obj, options)
{
    if (options) {
        if (options.error) logger.error('checkResult:', err.stack, obj);
        if (options.debug) logger.debug('checkResult:', err, obj);
        if (options.obj) return {};
        if (options.list) return [];
        if (options.str) return "";
    }
    return null;
}

// Copy file and then remove the source, do not overwrite existing file
lib.moveFile = function(src, dst, overwrite, callback)
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
lib.copyFile = function(src, dst, overwrite, callback)
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

// Call callback for each line in the file
// options may specify the following parameters:
// - sync - read file synchronously and call callback for every line
// - abort - signal to stop processing
// - limit - number of lines to process and exit
// - progress - if > 0 report how many lines processed so far every specified lines
// - until - skip lines until this regexp matches
lib.forEachLine = function(file, options, lineCallback, endCallback)
{
    var self = this;
    if (!options) options = {};
    var buffer = new Buffer(4096);
    var data = '';
    options.lines = 0;

    function readData(fd, pos, finish) {
        fs.read(fd, buffer, 0, buffer.length, pos, function(err, nread, buf) {
            data += buffer.slice(0, nread).toString(options.encoding || 'utf8');
            var lines = data.split("\n");
            data = lines.pop();
            self.forEachSeries(lines, function(line, next) {
                options.lines++;
                if (options.progress && options.lines % options.progress == 0) logger.info('forEachLine:', file, 'lines:', options.lines);
                // Skip lines until we see our pattern
                if (options.until && !options.until_seen) {
                    options.until_seen = line.match(options.until);
                    return next();
                }
                lineCallback(line.trim(), next);
            }, function(err) {
                // Stop on reaching limit or end of file
                if (options.abort || err || (options.limit && options.lines >= options.limit) || nread < buffer.length) return finish(err);
                setImmediate(function() { readData(fd, null, finish); });
            });
        });
    }

    fs.open(file, 'r', function(err, fd) {
        if (err) {
            logger.error('forEachLine:', file, err);
            return (endCallback ? endCallback(err) : null);
        }
        // Synchronous version, read every line and call callback which may not do any async operations
        // because they will not be executed right away but only after all lines processed
        if (options.sync) {
            while (!options.abort) {
                var nread = fs.readSync(fd, buffer, 0, buffer.length, options.lines == 0 ? options.start : null);
                data += buffer.slice(0, nread).toString(options.encoding || 'utf8');
                var lines = data.split("\n");
                data = lines.pop();
                for (var i = 0; i < lines.length; i++) {
                    options.lines++;
                    if (options.progress && options.lines % options.progress == 0) logger.info('forEachLine:', file, 'lines:', options.lines);
                    // Skip lines until we see our pattern
                    if (options.until && !options.until_seen) {
                        options.until_seen = lines[i].match(options.until);
                        continue;
                    }
                    lineCallback(lines[i].trim());
                }
                // Stop on reaching limit or end of file
                if (nread < buffer.length) break;
                if (options.limit && options.lines >= options.limit) break;
            }
            fs.close(fd, function() {});
            return (endCallback ? endCallback() : null);
        }

        // Start reading data from the optional position or from the beginning
        readData(fd, options.start, function(err2) {
            fs.close(fd, function() {});
            return (endCallback ? endCallback() : null);
        });
    });
}

// Run the process and return all output to the callback, this a simply wrapper around child_processes.exec so the lib.runProcess
// can be used without importing the child_processes module. All fatal errors are logged.
lib.execProcess = function(cmd, callback)
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
//          lib.spawProcess("ls", "-ls", { cwd: "/tmp" }, db.showResult)
//
lib.spawnProcess = function(cmd, args, options, callback)
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
//          lib.spawnSeries({"ls": "-la",
//                            "ps": "augx",
//                            "du": { argv: "-sh", stdio: "inherit", cwd: "/tmp" },
//                            "uname": ["-a"] },
//                           db.showResult)
//
lib.spawnSeries = function(cmds, options, callback)
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
lib.statSync = function(file)
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
//
// Options can specify the format:
// - json - parse file as JSON, return an object, in case of error an empty object
// - list - split contents with the given separator
// - encoding - file encoding when converting to string
// - logger - if 1 log all errors
lib.readFileSync = function(file, options)
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
lib.findFilter = function(file, stat, options)
{
    if (!options) return 1;
    if (options.filter) return options.filter(file, stat);
    if (util.isRegExp(options.exclude) && options.exclude.test(file)) return 0;
    if (util.isRegExp(options.include) && !options.include.test(file)) return 0;
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
//
// The options may contain the following:
//   - include - a regexp with file pattern to include
//   - exclude - a regexp with file pattern to exclude
//   - filter - a function(file, stat) that return 1 if the given file matches, stat is a object returned by fs.statSync
//   - depth - if a number it specifies max depth to go into the subfolders, starts with 1
//   - types - a string with types of files to include: d - a dir, f - a file, l - a symlink, c - char dev, b - block dev, s - socket, p - a FIFO
//   - base - if set only keep base file name in the result, not full path
//
//  Example:
//
//        lib.findFileSync("modules/", { depth: 1, types: "f", include: /\.js$/ }).sort()
//
lib.findFileSync = function(file, options)
{
    var list = [];
    var level = arguments[2];
    if (typeof level != "number") level = 0;

    try {
        var stat = this.statSync(file);
        var name = options && options.base ? path.basename(file) : file;
        if (stat.isFile()) {
            if (this.findFilter(name, stat, options)) {
                list.push(name);
            }
        } else
        if (stat.isDirectory()) {
            if (this.findFilter(name, stat, options)) {
                list.push(name);
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
lib.findFile = function(dir, options, callback)
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
lib.makePathSync = function(dir)
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
lib.makePath = function(dir, callback)
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
lib.unlinkPath = function(dir, callback)
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
lib.unlinkPathSync = function(dir)
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
//           lib.chownSync(1, 1, "/path/file1", "/path/file2")
lib.chownSync = function(uid, gid)
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
//             lib.mkdirSync("dir1", "dir2")
lib.mkdirSync = function()
{
    for (var i = 0; i < arguments.length; i++) {
        var dir = arguments[i];
        if (!dir) continue;
        if (!fs.existsSync(dir)) {
            try { fs.mkdirSync(dir) } catch(e) { logger.error('mkdirSync:', dir, e); }
        }
    }
}

// Create a resource pool, `create` and `close` callbacks must be given which perform allocation and deallocation of the resources like db connections.
//
// Options defines the following properties:
// - create - method to be called to return a new resource item, takes 1 argument, a callback as `function(err, item)`
// - destroy - method to be called to destroy a resource item
// - reset - method to becalled just before releasing an item back to the resource pool, this is a chance to reset the item to the initial state
// - validate - method to verify actibe resource item, return false if it needs to be destroyed
// - min - min number of active resource items
// - max - max number of active resource items
// - max_queue - how big the waiting queue can be, above this all requests will be rejected immediately
// - timeout - number of milliseconds to wait for the next available resource item, cannot be 0
// - idle - number of milliseconds before starting to destroy all active resources above the minimum, 0 to disable.
//
// Example:
//        var pool = lib.createPool({ min: 1, max: 5,
//                                  create: function(cb) {
//                                     someDb.connect(function(err) { cb(err, this) }
//                                  },
//                                  destroy: function(client) {
//                                     client.close() }
//                                  })
//
//        pool.aquire(function(err, client) {
//           ...
//           client.findItem....
//           ...
//           pool.release(client);
//
//        });
//
lib.createPool = function(options)
{
    var self = this;

    var pool = {
        _pool: {
            min: 0,
            max: 10,
            max_queue: 100,
            timeout: 5000,
            idle: 300000,
            queue_count: 0,
            num: 1,
            queue_count: 0,
            queue: {},
            avail: [],
            mtime: [],
            busy: []
        }
    };

    // Return next available resource item, if not available immediately wait for defined amount of time before calling the
    // callback with an error. The callback second argument is active resource item.
    pool.acquire = function(callback) {
        if (typeof callback != "function") throw new Error("callback is required");

        // We have idle items
        if (this._pool.avail.length) {
            var mtime = this._pool.mtime.shift();
            var item = this._pool.avail.shift();
            this._pool.busy.push(item);
            return callback.call(this, null, item);
        }
        // Put into waiting queue
        if (this._pool.busy.length >= this._pool.max) {
            if (this._pool.queue_count >= this._pool.max_queue) return callback(new Error("no more resources"));

            this._pool.queue_count++;
            return self.deferCallback(this._pool.queue, { id: this._pool.num++ }, function(m) {
                callback(m.item ? null : new Error("timeout waiting for the resource"), m.item);
            }, this._pool.timeout);
        }
        // New item
        var me = this;
        this._call("_create", function(err, item) {
            if (err) {
                logger.error("aquire:", this.name, err.stack);
            } else {
                if (!item) item = {};
                me._pool.busy.push(item);
                logger.dev('pool: create', me.name, 'avail:', me._pool.avail.length, 'busy:', me._pool.busy.length);
            }
            callback(err, item);
        });
    }

    // Destroy the resource item calling the provided close callback
    pool.destroy = function(item, callback) {
        if (!item) return;

        var idx = this._pool.busy.indexOf(item);
        if (idx > -1) {
            this._call("_destroy", item, callback);
            this._pool.busy.splice(idx, 1);
            return;
        }
        idx = this._pool.avail.indexOf(item);
        if (idx > -1) {
            this._call("_destroy", item, callback);
            this._pool.avail.splice(idx, 1);
            this._pool.mtime.splice(idx, 1);
            return;
        }
    }

    // Return the resource item back to the list of available resources.
    pool.release = function(item) {
        if (!item) return;

        var idx = this._pool.busy.indexOf(item);
        if (idx == -1) {
            logger.error('pool.release:', 'not known', item);
            return;
        }

        // Pass it to the next waiting item
        for (var id in this._pool.queue) {
            this._pool.queue_count--;
            this._pool.queue[id].id = id;
            this._pool.queue[id].item = item;
            return self.runCallback(this._pool.queue, this._pool.queue[id]);
        }

        // Destroy if above the limit or invalid
        if (this._pool.avail.length > this._pool.max || this._call("_validate", item) === false) {
            this._call("_destroy", item);
        } else {
            // Add to the available list
            this._pool.avail.unshift(item);
            this._pool.mtime.unshift(Date.now());
            this._call("_reset", item);
        }
        // Remove from the busy list at the end to keep the object referenced all the time
        this._pool.busy.splice(idx, 1);
    }

    // Close all active items
    pool.destroyAll = function() {
        while (this._pool.avail.length > 0) this.destroy(this._pool.avail[0]);
    }

    pool.stats = function() {
        return { avail: this._pool.avail.length, busy: this._pool.busy.length, queue: this._pool.queue_count, min: this._pool.min, max: this._pool.max, max_queue: this._pool.max_queue };
    }

    // Close all connections and shutdown the pool, no more items will be open and the pool cannot be used without re-initialization,
    // if callback is provided then wait until all items are released and call it, optional maxtime can be used to retsrict how long to wait for
    // all items to be released, when expired the callback will be called
    pool.shutdown = function(callback, maxtime) {
        logger.debug('pool.close:', this.name, 'shutdown:', 'avail:', this._pool.avail.length, 'busy:', this._pool.busy.length);
        var self = this;
        this._pool.max = -1;
        this.destroyAll();
        this._pool.queue = {};
        clearInterval(this._pool.interval);
        if (typeof callback != "function") return;
        this._pool.time = Date.now();
        this._pool.interval = setInterval(function() {
            if (self._pool.busy.length && (!maxtime || Date.now() - self._pool.time < maxtime)) return;
            clearInterval(self._pool.interval);
            callback();
        }, 500);
    }

    // Initialize pool properties
    pool._configure = function(opts) {
        if (!opts) return;
        var idle = this._pool.idle;

        if (typeof opts.min != "undefined") this._pool.min = self.toNumber(opts.min, { float: 0, flt: 0, min: 0 });
        if (typeof opts.max != "undefined") this._pool.max = self.toNumber(opts.max, { float: 0, dflt: 10, min: 0, max: 9999 });
        if (typeof opts.interval != "undefined") this._pool.max_queue = self.toNumber(opts.interval, { float: 0, dflt: 100, min: 0 });
        if (typeof opts.timeout != "undefined") this._pool.timeout = self.toNumber(opts.timeout, { float: 0, dflt: 5000, min: 1 });
        if (typeof opts.idle != "undefined") this._pool.idle = self.toNumber(opts.idle, { float: 0, dflt: 300000, min: 0 });

        if (typeof opts.create == "function") this._create = opts.create;
        if (typeof opts.destroy == "function") this._destroy = opts.destroy;
        if (typeof opts.reset == "function") this._reset = opts.reset;
        if (typeof opts.validate == "function") this._validate = opts.validate;

        // Periodic housekeeping if interval is set
        if (this._pool.idle > 0 && (idle != this._pool.idle || !this._pool.interval)) {
            clearInterval(this._pool.interval);
            this._pool.interval = setInterval(function() { pool._timer() }, Math.max(30000, pool._idle/3));
            setImmediate(function() { pool._timer(); });
        }
        if (this._pool.idle == 0) clearInterval(this._pool.interval);

        return this;
    }

    // Call registered method and catch exceptions, pass it to the callback if given
    pool._call = function(name, callback) {
        if (typeof this[name] != "function") return typeof callback == "function" && callback();
        try {
            return this[name].call(this, callback);
        } catch(e) {
            logger.error('pool:', name, this.name, e);
            if (typeof callback == "function") callback(e);
        }
    }

    // Timer to ensure pool integrity
    pool._timer = function() {
        var me = this;
        var now = Date.now();

        // Expire idle items
        if (this._pool.idle > 0) {
            for (var i = 0; i < this._pool.avail.length; i++) {
                if (now - this._pool.mtime[i] > this._pool.idle && this._pool.avail.length + this._pool.busy.length > this._pool.min) {
                    logger.dev('pool.timer:', pool.name || "", 'idle', i, 'avail:', this._pool.avail.length, 'busy:', this._pool.busy.length);
                    this.destroy(this._pool.avail[i]);
                    i--;
                }
            }
        }

        // Ensure min number of items
        var min = this._pool.min - this._pool.avail.length - this._pool.busy.length;
        for (var i = 0; i < min; i++) {
            this._call("_create", function(err, item) {
                if (err) return;
                me._pool.avail.push(item);
                me._pool.mtime.push(now);
            });
        }
    }

    return pool._configure(options);
}

