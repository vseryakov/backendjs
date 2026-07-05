/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
'use strict';

/**
 * @module lib
 */
const fs = require('node:fs');
const util = require('node:util');
const path = require('node:path');
const logger = require(__dirname + '/logger');
const { AsyncLocalStorage } = require("node:async_hooks");

const lib =

/**
 * General purpose utilities
 */
module.exports = {
    name: 'lib',

    maxStackDepth: 150,

    /** @var {regexp} - number validation
     * @default
     */
    rxNumber: /^(-|\+)?([0-9]+|[0-9]+\.[0-9]+)$/,

    /** @var {regexp} - float number validation
     * @default
     */
    rxFloat: /^(-|\+)?([0-9]+)?\.[0-9]+$/,

    /** @var {regexp} - uuid validation
     * @default
     */
    rxUuid: /^([0-9a-z]{1,5}_)?[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i,

    /** @var {regexp} - url validation
     * @default
     */
    rxUrl: /^https?:\/\/.+/,

    /** @var {regexp} - ascii charset validation
     * @default
     */
    rxAscii: /^[\x20-\x7F]+$/,

    /** @var {regexp} - all non-ascii characters
     * @default
     */
    rxNoAscii: /[^\x20-\x7F]+/g,

    /** @var {regexp} - printable ascii/ext charset validation
     * @default
     */
    rxPrintable: /^[\x20-\x7e\x80-\xff]+$/,

    /** @var {regexp} - all non-printable ascii/ext charset validation
     * @default
     */
    rxNoPrintable: /[^\x20-\x7e\x80-\xff]+/g,

    /** @var {regexp} - symbol name validation, only alpha numeric and underscore
     * @default
     */
    rxSymbol: /^[a-z0-9_]+$/i,

    /** @var {regexp} - all non-symbol ASCII characters
     * @default
     */
    rxNoSymbol: /[^a-z0-9_]+/ig,

    /** @var {regexp} - email validation
     * @default
     */
    rxEmail: /^[A-Z0-9'._+-]+@[A-Z0-9.-]+\.[A-Z]{2,16}$/i,

    /** @var {regexp} - phonre validation
     * @default
     */
    rxPhone: /^([0-9 .+()-]+)/,

    /** @var {regexp} - digits only
     * @default
     */
    rxDigits: /^[0-9]+$/,

    /** @var {regexp} - no digits
     * @default
     */
    rxNoDigits: /[^0-9]/g,

    /** @var {regexp} - html brackets
     * @default
     */
    rxHtml: /[<>]/g,

    /** @var {regexp} - exclude html brackets
     * @default
     */
    rxNoHtml: /[^<>]/g,

    /** @var {regexp} - XSS characters
     * @default
     */
    rxXss: /[<>"'&%\\]/g,

    /** @var {regexp} - exclude XSS characters
     * @default
     */
    rxNoXss: /[^<>"'&%\\]/g,

    /** @var {regexp} - punctuation and other special ASCII characters
     * @default
     */
    rxSpecial: /[~!#^&*(){}[\]"'?<>|\\]/g,

    /** @var {regexp} - exclude punctuation and other special ASCII characters
     * @default
     */
    rxNoSpecial: /[^~!#^&*(){}[\]"'?<>|\\]/g,

    /** @var {regexp} - exclude control characters and dots from the path
     * @default
     */
    rxSanitizePath: /([%:\\\x00-\x1F\x7F])|((?:^|[\\/])\.\.(?:[\\/]|$))/g,

    /** @var {regexp} - empty or spaces only
     * @default
     */
    rxEmpty: /^\s*$/,

    /** @var {regexp} - true validation
     * @default
     */
    rxTrue: /^(true|on|yes|1|t)$/i,

    rxGeo: /^[0-9.]+,[0-9.]+$/,
    rxLine: /[\r\n]\n?/,

    /** @var {regexp} - IP address validation
     * @default
     */
    rxIpaddress: /^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}(\/[0-9]{1,2})?$/,

    /** @var {regexp} - numeric column types
     * @default
     */
    rxNumericType: /^(int|smallint|long|bigint|real|float|double|numeric|number|decimal|now|clock|mtime|ttl|timeout|random|counter)/i,

    /** @var {regexp} - object column types
     * @default
     */
    rxObjectType: /^(obj|object|array)$/i,

    /** @var {regexp} - date and time column types
     * @default
     */
    rxDateType: /^(date|m?time)/i,

    /** @var {regexp} - list and sets column types
     * @default
     */
    rxListType: /^(list|set)$/i,

    /** @var {regexp} - characters for camelizing
     * @default
     */
    rxCamel: /(?:[_.:-])(\w)/g,

    /** @var {regexp} - list split characters
     * @default
     */
    rxSplit: /[,|]/,

    /** @var {regexp} - version validation
     * @default
     */
    rxVersion: /^([<>=]+)? *([0-9.:]+)$|^([0-9.:]+) *- *([0-9.:]+)$/,

    /** @var {string} - word boundaries characters
     * @default
     */
    wordBoundaries: ` ,.-_:;"'/?!()<>[]{}@#$%^&*+|\``,

    /** @var {string} - characters allowed in urls
     * @default
     */
    uriSafe: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._~-",

    /** @var {regexp} - base64 characters
     * @default
     */
    base64: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=",

    /** @var {regexp} - base32 characters
     * @default
     */
    base32: "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567",

    /** @var {regexp} - base36 characters
     * @default
     */
    base36: "0123456789abcdefghijklmnopqrstuvwxyz",

    /** @var {regexp} - base62 characters
     * @default
     */
    base62: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
    base64Dict: {},

    /** @var {object} - empty object, frozen */
    empty: Object.freeze({}),

    /** @var {array} - empty array, frozen */
    emptylist: Object.freeze([]),

    /** @var {function} - empty function to be used when callback was no provided */
    noop() {},

    _digits: new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]),

    /** @var {function} - return true if an argument is a digit */
    isDigit(digit) { return this._digits.has(digit) },

    locales: {},
    locale: "",
    hashids: {},

    /** @var {AsyncLocalStorage} - async storage to use with tryCatch, emits "error" signal if store has emit method */
    als: new AsyncLocalStorage(),
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
lib.call = function(obj, method, ...args)
{
    return typeof obj === "function" ? obj(method, ...args) :
           typeof obj !== "object" ? undefined :
           typeof method === "function" ? method.call(obj, ...args) :
           typeof obj[method] === "function" ? obj[method].call(obj, ...args) :
           undefined;
}

/**
 * Run a callback if a valid function, all arguments after the callback will be passed as is,
 * report a warning if callback is not emptry but not a function
 * @param {function} callback - try to call this function
 * @param {...any} [args] - pass the rest arguments to the function
 * @return {any} the function result
 * @memberof module:lib
 * @method tryCall
 */
lib.tryCall = function(callback, ...args)
{
    if (typeof callback === "function") {
        return callback.apply(null, args);
    }
    if (callback) {
        logger.trace("tryCall:", callback, ...args);
    }
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
    if (typeof callback === "function") {
        return (err) => {
            setTimeout(callback, timeout, err, ...args);
        }
    }
    if (callback) {
        logger.trace("tryLater:", callback, ...args);
    }
}

/**
 * Run a callback inside try..catch block, all arguments after the callback will be passed as is, in case of error
 * all arguments will be printed in the log. If no callback passed do nothing.
 * If the async local storage is not empty and has `emit` method it will be called as `error` event.
 * @param {function} callback - try to call this function
 * @param {...any} [args] - pass the rest arguments to the function
 * @return {undefined|Error} - Error if an exception is caught
 * @memberof module:lib
 * @method tryCatch
 */
lib.tryCatch = function(callback, ...args)
{
    if (typeof callback === "function") {
        try {
            callback.apply(null, args);
        } catch (e) {
            args.unshift(e);
            args.unshift("tryCatch:");
            logger[util.types.isNativeError(e) ? "error": "trace"].apply(logger, args);

            const ctx = lib.als.getStore();
            if (lib.isFunc(ctx?.emit)) {
                ctx.emit("error", e);
            }
            return e;
        }
    } else

    if (callback) {
        logger.trace("tryCatch:", callback, ...args);
    }
}

/**
 * Try loading a module, log if failed, no expection is raised
 * @param {string} path - module path
 * @param {object} [options]
 * @param {string} [options.logger] - use logger level
 * @param {string} [options.message] - additional error message
 * @return {object|null}
 * @memberof module:lib
 * @method tryRequire
 */
lib.tryRequire = function(path, options)
{
    try {
        return require(path);
    } catch (_e) {
        logger.logger(options?.logger || "trace", "tryRequire:", path, options?.message || "not found");
        return null;
    }
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
    var lang = lib.locale, txt;

    if (msg?.phrase) {
        msg = msg.phrase;
        lang = msg.locale || lang;
    }
    let locale = lib.locales[lang];
    if (!locale && typeof lang === "string" && lang.indexOf("-") > 0) {
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
    if (val[0] === "-") val = "";
    if (!val && typeof dflt !== "undefined") val = dflt;
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
        var v1 = typeof a === "string" ? a : a[name];
        var v2 = typeof b === "string" ? b : b[name];
        var n1 = v1?.match(/^(.+)[ -]([0-9.]+)$/);
        if (n1) n1[2] = lib.toVersion(n1[2]);
        const n2 = v2?.match(/^(.+)[ -]([0-9.]+)$/);
        if (n2) n2[2] = lib.toVersion(n2[2]);
        return !n1 || !n2 ? 0 : n1[1] > n2[1] ? -1 : n1[1] < n2[1] ? 1 : n2[2] - n1[2];
    });
}

/**
 * Return a new Error object, message can be a string or an object with message, code, status and other properties.
 * The default error status is 400 if not specified.
 * @param {string|object} message
 * @param {number|object} [status] - if an object all properties are copied into the error
 * @param {string|number} [code] - if provided set as the .code property
 * @example
 * lib.newError("not found", 404)
 * lib.newError("not found", 404, "NOTFOUND")
 * lib.newError("not found", { status: 404, path: "/..." })
 * lib.newError({ message: "not found", status: 404, code: 123 })
 * @memberof module:lib
 * @method newError
 */
lib.newError = function(message, status, code)
{
    if (typeof message === "string") {
        message = { status: typeof status === "number" ? status : 400, message };
    }
    const err = new Error(message?.message || this.__("Internal error occurred, please try again later"));
    if (typeof message === "object") Object.assign(err, message);
    if (typeof status === "object") Object.assign(err, status);
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
    return this.inspect(err, { errstack: util.types.isNativeError(err) });
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
        var d;
        if (!err) {
            d = lib.jsonParse(data.toString(), { logger: "error" });
            if (d) lib.locales[path.basename(file, ".json")] = d;
        }
        logger[err && err.code !== "ENOENT" ? "error" : "debug"]("loadLocale:", file, err);
        if (typeof callback === "function") callback(err, d);
    });
}

require(__dirname + "/lib/is");
require(__dirname + "/lib/validate");
require(__dirname + "/lib/system");
require(__dirname + "/lib/proc");
require(__dirname + "/lib/time");
require(__dirname + "/lib/conv");
require(__dirname + "/lib/defer");
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
require(__dirname + '/lib/respawn');
require(__dirname + "/lib/mime")
