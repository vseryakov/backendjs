/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

/**
 * @module lib
 */
const fs = require('fs');
const util = require('util');
const path = require('path');
const logger = require(__dirname + '/logger');

const lib =

/**
 * General purpose utilities
 */
module.exports = {
    name: 'lib',
    deferTimeout: 50,
    deferId: 1,
    maxStackDepth: 150,

    /** @var {regexp} - number validation */
    rxNumber: /^(-|\+)?([0-9]+|[0-9]+\.[0-9]+)$/,

    /** @var {regexp} - float number validation */
    rxFloat: /^(-|\+)?([0-9]+)?\.[0-9]+$/,

    /** @var {regexp} - uuid validation */
    rxUuid: /^([0-9a-z_]{1,5})?[0-9a-z]{32}(_[0-9a-z]+)?$/,

    /** @var {regexp} - url validation */
    rxUrl: /^https?:\/\/.+/,

    /** @var {regexp} - ascii chars validation */
    rxAscii: /[\x20-\x7F]/,

    /** @var {regexp} - symbol name validation */
    rxSymbol: /^[a-z0-9_]+$/i,

    /** @var {regexp} - email validation */
    rxEmail: /^[A-Z0-9'._+-]+@[A-Z0-9.-]+\.[A-Z]{2,16}$/i,

    /** @var {regexp} - phonre validation */
    rxPhone: /^([0-9 .+()-]+)/,

    /** @var {regexp} - digits only */
    rxDigits: /^[0-9]+$/,

    /** @var {regexp} - no digits */
    rxNoDigits: /[^0-9]/g,

    /** @var {regexp} - html brackets */
    rxHtml: /[<>]/g,

    /** @var {regexp} - exclude html brackets */
    rxNoHtml: /[^<>]/g,

    /** @var {regexp} - XSS characters */
    rxXss: /[<>"'&%\\]/g,

    /** @var {regexp} - exclude XSS characters */
    rxNoXss: /[^<>"'&%\\]/g,

    /** @var {regexp} - punctuation and other special characters */
    rxSpecial: /[~!#^&*(){}[\]"'?<>|\\]/g,

    /** @var {regexp} - excclude punctuation and other special characters */
    rxNoSpecial: /[^~!#^&*(){}[\]"'?<>|\\]/g,

    /** @var {regexp} - empty or spaces only */
    rxEmpty: /^\s*$/,

    /** @var {regexp} - true validation */
    rxTrue: /^(true|on|yes|1|t)$/i,

    rxGeo: /^[0-9.]+,[0-9.]+$/,
    rxLine: /[\r\n]\n?/,

    /** @var {regexp} - IP address validation */
    rxIpaddress: /^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}(\/[0-9]{1,2})?$/,

    /** @var {regexp} - numeric column types */
    rxNumericType: /^(int|smallint|bigint|now|clock|mtime|ttl|random|counter|real|float|double|numeric|number|decimal|long)/i,

    /** @var {regexp} - object column types */
    rxObjectType: /^(obj|object|array)$/i,

    /** @var {regexp} - date and time column types */
    rxDateType: /^(date|m?time)/i,

    /** @var {regexp} - list and sets column types */
    rxListType: /^(list|set)$/i,

    /** @var {regexp} - characters for camelizing */
    rxCamel: /(?:[_.:-])(\w)/g,

    /** @var {regexp} - list split characters */
    rxSplit: /[,|]/,

    /** @var {regexp} - version validation */
    rxVersion: /^([<>=]+)? *([0-9.:]+)$|^([0-9.:]+) *- *([0-9.:]+)$/,

    /** @var {string} - word boundaries characters */
    wordBoundaries: ` ,.-_:;"'/?!()<>[]{}@#$%^&*+|\``,
    locales: {},
    locale: "",
    hashids: {},

    /** @var {string} - characters allowed in urls */
    uriSafe: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._~-",

    /** @var {regexp} - base64 characters */
    base64: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=",

    /** @var {regexp} - base32 characters */
    base32: "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567",

    /** @var {regexp} - base36 characters */
    base36: "0123456789abcdefghijklmnopqrstuvwxyz",

    /** @var {regexp} - base62 characters */
    base62: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
    base64Dict: {},

    /** @var {object} - empty object, frozen */
    empty: Object.freeze({}),

    /** @var {array} - empty array, frozen */
    emptylist: Object.freeze([]),

    /** @var {function} - empty function to be used when callback was no provided */
    noop: function() {},
};

/**
 * Call a function safely with context:
 * @param {function|object} obj - a function to try or an object with a method
 * @param {string} [method] - if obj is an object try to call the method by name
 * @param {...any} [args] - pass the rest arguments to the function
 * @return {any} the function result
 * @example
 * lib.call(func,..)
 * lib.call(context, func, ...)
 * lib.call(context, method, ...)
 * @memberof module:lib
 * @method call
 */
lib.call = function(obj, method, ...arg)
{
    if (typeof obj == "function") return obj(method, ...arg);
    if (typeof obj != "object") return;
    if (typeof method == "function") return method.call(obj, ...arg);
    if (typeof obj[method] == "function") return obj[method].call(obj, ...arg);
}

/**
 * Run a callback if a valid function, all arguments after the callback will be passed as is,
 * report a warning if callback is not a function but not empty
 * @param {function} callback - try to call this function
 * @param {...any} [args] - pass the rest arguments to the function
 * @return {any} the function result
 * @memberof module:lib
 * @method tryCall
 */
lib.tryCall = function(callback, ...args)
{
    if (typeof callback == "function") return callback.apply(null, args);
    if (callback) logger.trace("tryCall:", callback, ...args);
}

/**
 * Run a callback after timeout, returns a function so it can be used instead of actual callback,
 * report a warning if callback is not a function but not empty
 * @param {function} callback - try to call this function
 * @param {int} timeout - timeout in milliseconds
 * @param {...any} [args] - pass the rest arguments to the function
 * @memberof module:lib
 * @method tryLater
 */
lib.tryLater = function(callback, timeout, ...args)
{
    if (typeof callback == "function") {
        return (err) => {
            setTimeout(callback, timeout, err, ...args);
        }
    } else
    if (callback) logger.trace("tryLater:", callback, ...args);
}

/**
 * Run a callback inside try..catch block, all arguments after the callback will be passed as is, in case of error
 * all arguments will be printed in the log. If no callback passed do nothing.
 * @param {function} callback - try to call this function
 * @param {...any} [args] - pass the rest arguments to the function
 * @memberof module:lib
 * @method tryCatch
 */
lib.tryCatch = function(callback, ...args)
{
    if (typeof callback == "function") {
        try {
            callback.apply(null, args);
        } catch (e) {
            args.unshift(e.stack);
            args.unshift("tryCatch:");
            logger.error.apply(logger, args);
        }
    } else
    if (callback) logger.trace("tryCatch:", callback, ...args);
}

/**
 * Print all arguments into the console, for debugging purposes, if the first arg is an error only print the error
 * @param {...any} [args] - print all arguments
 * @memberof module:lib
 * @method log
 */
lib.log = function(...args)
{
    if (util.types.isNativeError(args[0])) {
        return console.log(lib.traceError(args[0]));
    }
    for (const i in args) {
        console.log(util.inspect(args[i], { depth: 7 }));
    }
}

/**
 * Simple i18n translation method compatible with other popular modules, supports the following usage:
 * @param {string} msg
 * @param {...any} [args]
 * @return {string}
 * @example
 * lib.__(name)
 * lib.__(fmt, arg,...)
 * lib.__({ phrase: "", locale: "" }, arg...
 * @memberof module:lib
 * @method __
 */
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

/**
 * Return commandline argument value by name
 * @param {string} name - argument name
 * @param {any} [dflt] - return this value if no argument found
 * @return {string}
 * @memberof module:lib
 * @method getArg
 */
lib.getArg = function(name, dflt)
{
    var idx = process.argv.lastIndexOf(name);
    var val = idx > -1 && idx + 1 < process.argv.length ? process.argv[idx + 1] : "";
    if (val[0] == "-") val = "";
    if (!val && typeof dflt != "undefined") val = dflt;
    return val;
}

/**
 * Return commandline argument value as a number
 * @param {string} name - argument name
 * @param {any} [dflt] - return this value if no argument found
 * @return {int}
 * @memberof module:lib
 * @method getArgInt
 */
lib.getArgInt = function(name, dflt)
{
    return this.toNumber(this.getArg(name, dflt));
}

/**
 * Returns true of given arg(s) are present in the command line, name can be a string or an array of strings.
 * @param {string} name - argument name
 * @return {boolean}
 * @memberof module:lib
 * @method isArg
 */
lib.isArg = function(name)
{
    if (!Array.isArray(name)) return process.argv.lastIndexOf(name) > 0;
    return name.some(function(x) { return process.argv.lastIndexOf(x) > 0 });
}

/**
 * Register the callback to be run later for the given message, the message may have the `__deferId`
 * property which will be used for keeping track of the responses or it will be generated.
 * A timeout is created for this message, if `runCallback` for this message will not be called in time the timeout handler will call the callback
 * anyway with the original message.
 * @param {object} parent - can be any object and is used to register the timer and keep reference to it, a `_defer` object will be created inside the parent.
 * @param {object} msg - the message
 * @param {function} callback - will be called with only one argument which is the message itself, what is inside the message this function does not care. If
 * any errors must be passed, use the message object for it, no other arguments are expected.
 * @param {int} [timeout] - how long to wait, if not given `lib.deferTimeout` is used
 * @return {object} an object with timer and callback
 * @memberof module:lib
 * @method deferCallback
 */
lib.deferCallback = function(parent, msg, callback, timeout)
{
    if (!parent || !this.isObject(msg) || !callback) return;

    if (!parent._defer) {
        parent._defer = {};
    }
    if (!msg.__deferId) {
        msg.__deferId = this.deferId++;
    }
    var defer = parent._defer[msg.__deferId] = {
        callback,
        id: msg.__deferId,
        timer: setTimeout(onDeferCallback.bind(parent, msg), timeout || this.deferTimeout)
    };
    return defer;
}

/**
 * Clear all pending timers
 * @memberof module:lib
 * @method deferShutdown
 */
lib.deferShutdown = function(parent)
{
    if (!parent?._defer) return;
    for (const p in parent._defer) {
        clearTimeout(parent._defer[p].timer);
        delete parent._defer[p];
    }
    delete parent._defer;
}

/**
 * To be called on timeout or when explicitely called by the `runCallback`, it is called in the context of the message.
 */
function onDeferCallback(msg)
{
    var item = this._defer && this._defer[msg.__deferId];
    if (!item) return;
    delete this._defer[msg.__deferId];
    clearTimeout(item.timer);
    logger.dev("onDeferCallback:", msg);
    try { item.callback(msg); } catch (e) { logger.error('onDeferCallback:', e, msg, e.stack); }
}

/**
 * Run delayed callback for the message previously registered with the `deferCallback` method.
 * The message must have `__deferId` property which is used to find the corresponding callback,
 * if the msg is a JSON string it will be converted into the object.
 *
 * Same parent object must be used for `deferCallback` and this method.
 * @memberof module:lib
 * @method runCallback
 */
lib.runCallback = function(parent, msg)
{
    if (!parent?._defer) return;
    if (msg && typeof msg == "string") msg = this.jsonParse(msg, { logger: "error" });
    if (!msg?.__deferId || !parent._defer[msg.__deferId]) return;
    setImmediate(onDeferCallback.bind(parent, msg));
}

/**
 * Assign or clear an interval timer by name, keep the reference in the given parent object
 * @memberof module:lib
 * @method deferInterval
 */
lib.deferInterval = function(parent, interval, name, callback)
{
    if (!parent._defer) {
        parent._defer = {};
    }

    var item = parent._defer[name];

    if (interval != item?.interval) {
        clearInterval(item?.timer);
        if (interval > 0) {
            parent._defer[name] = {
                timer: setInterval(callback, interval),
                interval,
            };
        } else {
            delete parent._defer[name];
        }
    }
}

/**
 * Async sleep version
 * @param {int} delay - number of milliseconds to wait
 * @returns {Promise}
 * @memberof module:lib
 * @method sleep
 */
lib.sleep = function(delay)
{
    return new Promise((resolve) => setTimeout(resolve, delay))
}

/**
 * Sort a list be version in descending order, an item can be a string or an object with
 * a property to sort by, in such case `name` must be specified which property to use for sorting.
 * The name format is assumed to be: `XXXXX-N.N.N`
 * @memberof module:lib
 * @method sortByVersion
 */
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

/**
 * Return a new Error object, message can be a string or an object with message, code, status properties.
 * The default error status is 400 if not specified.
 * @param {string|object} message
 * @param {number} [status]
 * @param {string} [code]
 * @memberof module:lib
 * @method newError
 */
lib.newError = function(message, status, code)
{
    if (typeof message == "string") {
        message = { status: typeof status == "number" ? status : 400, message };
    }
    var err = new Error(message?.message || this.__("Internal error occurred, please try again later"));
    for (const p in message) err[p] = message[p];
    if (!err.status) err.status = 400;
    if (code) err.code = code;
    return err;
}

/**
 * Returns the error stack or the error itself, to be used in error messages
 * @param {Error} err
 * @memberof module:lib
 * @method traceError
 */
lib.traceError = function(err)
{
    return this.objDescr(err || "", { ignore: /^domain|req|res$/ }) + " " + (util.types.isNativeError(err) && err.stack ? err.stack : "");
}

/**
 * Load a file with locale translations into memory
 * @param {string} file
 * @param {function} [callback]
 * @memberof module:lib
 * @method loadLocale
 */
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

/**
 * Randomize a list items in place
 * @param {any[]} list
 * @return {any[]}
 * @memberof module:lib
 * @method shuffle
 */
lib.shuffle = function(list)
{
    if (!Array.isArray(list) || !list.length) return [];
    for (let i = 0; i < list.length; i++) {
        var j = Math.round((list.length - 1) * this.randomFloat());
        if (i == j) {
            continue;
        }
        const item = list[j];
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
require(__dirname + "/lib/hash");
require(__dirname + "/lib/hashids");
require(__dirname + "/lib/crypto");
require(__dirname + "/lib/uuid");
require(__dirname + "/lib/file");
require(__dirname + "/lib/flow");
require(__dirname + "/lib/obj");
require(__dirname + "/lib/str");
require(__dirname + '/lib/fetch');
require(__dirname + '/lib/pool');
require(__dirname + '/lib/lru');
require(__dirname + '/lib/jwt');
