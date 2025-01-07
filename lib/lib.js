//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const fs = require('fs');
const util = require('util');
const path = require('path');
const logger = require(__dirname + '/logger');

// Common utilities and useful functions
const lib = {
    name: 'lib',
    deferTimeout: 50,
    deferId: 1,
    maxStackDepth: 150,
    rxNumber: /^(-|\+)?([0-9]+|[0-9]+\.[0-9]+)$/,
    rxFloat: /^(-|\+)?([0-9]+)?\.[0-9]+$/,
    rxUuid: /^([0-9a-z]{1,5}_)?[0-9a-z]{32}(_[0-9a-z]+)?$/,
    rxUrl: /^https?:\/\/.+/,
    rxAscii: /[\x20-\x7F]/,
    rxSymbol: /^[a-z0-9_]+$/i,
    rxEmail: /^[A-Z0-9'._+-]+@[A-Z0-9.-]+\.[A-Z]{2,16}$/i,
    rxPhone: /^([0-9 .+()-]+)/,
    rxDigits: /^[0-9]+$/,
    rxNoDigits: /[^0-9]/g,
    rxHtml: /[<>]/g,
    rxNoHtml: /[^<>]/g,
    rxXss: /[<>"'&%\\]/g,
    rxNoXss: /[^<>"'&%\\]/g,
    rxSpecial: /[~!#^&*(){}[\]"'?<>|\\]/g,
    rxNoSpecial: /[^~!#^&*(){}[\]"'?<>|\\]/g,
    rxSentence: /^[a-z0-9 ,.?/!@$%&:;`"'_-]+$/i,
    rxNoSentence: /[^a-z0-9 ,.?/!@$%&:;`"'_-]/gi,
    rxEmpty: /^\s*$/,
    rxBool: /^(false|off|nil|null|no|f|n|0)$/i,
    rxGeo: /^[0-9.]+,[0-9.]+$/,
    rxLine: /[\r\n]\n?/,
    rxIpaddress: /^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}(\/[0-9]{1,2})?$/,
    rxNumericType: /^(int|smallint|bigint|now|clock|mtime|random|counter|real|float|double|numeric|number|decimal|long)/i,
    rxObjectType: /^(obj|object|array)$/i,
    rxListType: /^(list|set)$/i,
    rxTextType: /^(str|string|text)$/i,
    rxCamel: /(?:[_.:-])(\w)/g,
    rxSplit: /[,|]/,
    rxVersion: /^([<>=]+)? *([0-9.:]+)$|^([0-9.:]+) *- *([0-9.:]+)$/,
    wordBoundaries: ` ,.-_:;"'/?!()<>[]{}@#$%^&*+|\``,
    locales: {},
    locale: "",
    hashids: {},
    base64: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=",
    uriSafe: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._~-",
    base32: "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567",
    base36: "0123456789abcdefghijklmnopqrstuvwxyz",
    base62: "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
    base62Dict: "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""),
    base64Dict: {},
    // Empty function to be used when callback was no provided
    empty: Object.freeze({}),
    emptylist: Object.freeze([]),
    noop: function() {},
};

module.exports = lib;

// Call a function safely with context:
// - bkjs.call(func,..)
// - bkjs.call(context, func, ...)
// - bkjs.call(context, method, ...)
lib.call = function(obj, method, ...arg)
{
    if (typeof obj == "function") return obj(method, ...arg);
    if (typeof obj != "object") return;
    if (typeof method == "function") return method.call(obj, ...arg);
    if (typeof obj[method] == "function") return obj[method].call(obj, ...arg);
}

// Run a callback if a valid function, all arguments after the callback will be passed as is,
// report a warning if callback is not a function but not empty
lib.tryCall = function(callback, ...args)
{
    if (typeof callback == "function") return callback.apply(null, args);
    if (callback) logger.warn("tryCall:", arguments, new Error().stack);
}

// Run a callback after timeout, returns a function so it can be used instead of actual callback,
// report a warning if callback is not a function but not empty
lib.tryLater = function(callback, timeout, ...args)
{
    if (typeof callback == "function") {
        return (err) => {
            setTimeout(callback, timeout, err, ...args);
        }
    }
    if (callback) logger.warn("tryLater:", arguments, new Error().stack);
}

// Run a callback inside try..catch block, all arguments after the callback will be passed as is, in case of error
// all arguments will be printed in the log
lib.tryCatch = function(callback, ...args)
{
    try {
        callback.apply(null, args);
    } catch (e) {
        args.unshift(e.stack);
        args.unshift("tryCatch:");
        logger.error.apply(logger, args);
    }
}

// Print all arguments into the console, for debugging purposes, if the first arg is an error only print the error
lib.log = function()
{
    if (util.types.isNativeError(arguments[0])) return console.log(lib.traceError(arguments[0]));
    for (var i = 0; i < arguments.length; i++) {
        console.log(util.inspect(arguments[i], { depth: 5 }));
    }
}

// Simple i18n translation method compatible with other popular modules, supports the following usage:
// - __(name)
// - __(fmt, arg,...)
// - __({ phrase: "", locale: "" }, arg...
//
lib.__ = function(msg, ...args)
{
    var lang = this.locale, txt;

    if (msg?.phrase) {
        msg = msg.phrase;
        lang = msg.locale || lang;
    }
    var locale = lib.locales[lang];
    if (!locale && typeof lang == "string" && lang.indexOf("-") > 0) {
        locale = lib.locales[lang.split("-")[0]];
    }
    if (locale) {
        txt = locale[msg];
        if (!txt) logger.info("missing-locale:", lang, msg);
    }
    if (!txt) txt = msg;
    if (!args.length) return txt;
    return lib.sprintf(txt, ...args);
}

// Return commandline argument value by name
lib.getArg = function(name, dflt)
{
    var idx = process.argv.lastIndexOf(name);
    var val = idx > -1 && idx + 1 < process.argv.length ? process.argv[idx + 1] : "";
    if (val[0] == "-") val = "";
    if (!val && typeof dflt != "undefined") val = dflt;
    return val;
}

// Return commandline argument value as a number
lib.getArgInt = function(name, dflt)
{
    return this.toNumber(this.getArg(name, dflt));
}

// Returns true of given arg(s) are present in the command line, name can be a string or an array of strings.
lib.isArg = function(name)
{
    if (!Array.isArray(name)) return process.argv.lastIndexOf(name) > 0;
    return name.some(function(x) { return process.argv.lastIndexOf(x) > 0 });
}

// Register the callback to be run later for the given message, the message may have the `__id` property which will be used for keeping track of the responses or it will be generated.
// The `parent` can be any object and is used to register the timer and keep reference to it.
//
// A timeout is created for this message, if `runCallback` for this message will not be called in time the timeout handler will call the callback
// anyway with the original message.
//
// The callback passed will be called with only one argument which is the message, what is inside the message this function does not care. If
// any errors must be passed, use the message object for it, no other arguments are expected.
lib.deferCallback = function(parent, msg, callback, timeout)
{
    if (!this.isObject(msg) || !callback) return;

    if (!msg.__deferId) msg.__deferId = this.deferId++;
    parent[msg.__deferId] = {
        callback: callback,
        timer: setTimeout(this.onDeferCallback.bind(parent, msg), timeout || this.deferTimeout)
    };
}

// To be called on timeout or when explicitely called by the `runCallback`, it is called in the context of the message.
lib.onDeferCallback = function(msg)
{
    var item = this[msg.__deferId];
    if (!item) return;
    delete this[msg.__deferId];
    clearTimeout(item.timer);
    logger.dev("onDeferCallback:", msg);
    try { item.callback(msg); } catch (e) { logger.error('onDeferCallback:', e, msg, e.stack); }
}

// Run delayed callback for the message previously registered with the `deferCallback` method.
// The message must have `id` property which is used to find the corresponding callback, if the msg is a JSON string it will be converted into the object.
//
// Same parent object must be used for `deferCallback` and this method.
lib.runCallback = function(parent, msg)
{
    if (msg && typeof msg == "string") msg = this.jsonParse(msg, { logger: "error" });
    if (!msg || !msg.__deferId || !parent[msg.__deferId]) return;
    setImmediate(this.onDeferCallback.bind(parent, msg));
}

// Assign or clear an interval timer, keep the reference in the given parent object
lib.deferInterval = function(parent, interval, name, callback)
{
    var tname = "_" + name + "Timer";
    var iname = "_" + name + "Interval";
    if (interval != parent[iname]) {
        if (parent[tname]) clearInterval(parent[tname]);
        if (interval > 0) {
            parent[tname] = setInterval(callback, interval);
            parent[iname] = interval;
        } else {
            delete parent[iname];
            delete parent[tname];
        }
    }
}

// Sort a list be version in descending order, an item can be a string or an object with
// a property to sort by, in such case `name` must be specified which property to use for sorting.
// The name format is assumed to be: `XXXXX-N.N.N`
lib.sortByVersion = function(list, name)
{
    if (!Array.isArray(list)) return [];
    return list.sort(function(a, b) {
        var v1 = typeof a == "string" ? a : a[name];
        var v2 = typeof b == "string" ? b : b[name];
        var n1 = v1 && v1.match(/^(.+)[ -]([0-9.]+)$/);
        if (n1) n1[2] = lib.toVersion(n1[2]);
        var n2 = v2 && v2.match(/^(.+)[ -]([0-9.]+)$/);
        if (n2) n2[2] = lib.toVersion(n2[2]);
        return !n1 || !n2 ? 0 : n1[1] > n2[1] ? -1 : n1[1] < n2[1] ? 1 : n2[2] - n1[2];
    });
}

// Return a new Error object, msg can be a string or an object with message, code, status properties.
// The default error status is 400 if not specified.
lib.newError = function(msg, status, code)
{
    if (typeof msg == "string") msg = { status: typeof status == "number" ? status : 400, message: msg };
    var err = new Error(msg && msg.message || this.__("Internal error occurred, please try again later"));
    for (const p in msg) err[p] = msg[p];
    if (!err.status) err.status = 400;
    if (code) err.code = code;
    return err;
}

// Returns the error stack or the error itself, to be used in error messages
lib.traceError = function(err)
{
    return this.objDescr(err || "", { ignore: /^domain|req|res$/ }) + " " + (util.types.isNativeError(err) && err.stack ? err.stack : "");
}

// Load a file with locale translations into memory
lib.loadLocale = function(file, callback)
{
    fs.readFile(file, function(err, data) {
        if (!err) {
            var d = lib.jsonParse(data.toString(), { logger: "error" });
            if (d) lib.locales[path.basename(file, ".json")] = d;
        }
        logger[err && err.code != "ENOENT" ? "error" : "debug"]("loadLocale:", file, err);
        if (typeof callback == "function") callback(err, d);
    });
}

// Randomize the list items in place
lib.shuffle = function(list)
{
    if (!Array.isArray(list)) return [];
    if (list.length == 1) return list;
    for (var i = 0; i < list.length; i++) {
        var j = Math.round((list.length - 1) * this.randomFloat());
        if (i == j) {
            continue;
        }
        var item = list[j];
        list[j] = list[i];
        list[i] = item;
    }
    return list;
}

require(__dirname + "/lib/is");
require(__dirname + "/lib/system");
require(__dirname + "/lib/time");
require(__dirname + "/lib/conv");
require(__dirname + "/lib/parse");
require(__dirname + "/lib/crypto");
require(__dirname + "/lib/uuid");
require(__dirname + "/lib/file");
require(__dirname + "/lib/flow");
require(__dirname + "/lib/obj");
require(__dirname + "/lib/str");
require(__dirname + "/lib/lru");
