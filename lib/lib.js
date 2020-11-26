//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const fs = require('fs');
const util = require('util');
const path = require('path');
const crypto = require('crypto');
const bkutils = require('bkjs-utils');
const logger = require(__dirname + '/logger');
const Hashids = require("hashids/cjs");
const child = require("child_process");
const uuid = require('uuid');
const os = require('os');

// Common utilities and useful functions
const lib = {
    name: 'lib',
    deferTimeout: 50,
    deferId: 1,
    geoHashRanges: [ [12, 0], [8, 0.019], [7, 0.076], [6, 0.61], [5, 2.4], [4, 20.0], [3, 78.0], [2, 630.0], [1, 2500.0], [1, 99999] ],
    rxNumber: /^(-|\+)?([0-9]+|[0-9]+\.[0-9]+)$/,
    rxFloat: /^(-|\+)?([0-9]+)?\.[0-9]+$/,
    rxUuid: /^([0-9a-z]{1,5}_)?[0-9a-z]{32}(_[0-9a-z]+)?$/,
    rxUrl: /^https?:\/\/.+/,
    rxAscii: /[\x20-\x7F]/,
    rxEmail: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,16}$/i,
    rxEmail1: /[^@<> ]+@[^@<> ]+/,
    rxEmail2: /<?([^@<> ]+@[^@<> ]+)>?/,
    rxPhone: /^([0-9 .+()-]+)/,
    rxPhone2: /[^0-9]/g,
    rxEmpty: /^\s*$/,
    rxGeo: /^[0-9.]+,[0-9.]+$/,
    rxLine: /[\r\n]\n?/,
    rxIpaddress: /^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}(\/[0-9]{1,2})?$/,
    rxNumericType: /^(int|smallint|bigint|now|clock|mtime|random|counter|real|float|double|numeric|number|decimal|long)/i,
    rxObjectType: /^(obj|object|list|set|array)$/i,
    rxTextType: /^(str|string|text)$/i,
    rxCamel: /(?:[-_.])(\w)/g,
    rxSplit: /[,|]/,
    locales: {},
    locale: "",
    hashids: {},
    base64: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=",
    uriSafe: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-$",
    base36: "0123456789abcdefghijklmnopqrstuvwxyz",
    base62: "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
    base62Dict: "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""),
    base64Dict: {},
    uriSafeDict: {},
    whitespace: " \r\n\t\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u202F\u205F\u3000\u008D\u009F\u0080\u0090\u009B\u0010\u0009\u0000\u0003\u0004\u0017\u0019\u0011\u0012\u0013\u0014\u2028\u2029\u2060\u202C",
    unicodeAsciiMap: {
        "\u00AB": "\"", "\u00BB": "\"", "\u201C": "\"", "\u201D": "\"", "\u02BA": "\"", "\u02EE": "\"", "\u201F": "\"", "\u275D": "\"", "\u275E": "\"", "\u301D": "\"", "\u301E": "\"",
        "\uFF02": "\"", "\u2018": "'", "\u2019": "'", "\u02BB": "'", "\u02C8": "'", "\u02BC": "'", "\u02BD": "'", "\u02B9": "'", "\u201B": "'", "\uFF07": "'", "\u00B4": "'", "\u02CA": "'",
        "\u0060": "'", "\u02CB": "'", "\u275B": "'", "\u275C": "'", "\u0313": "'", "\u0314": "'", "\uFE10": "'", "\uFE11": "'", "\u00F7": "/", "\u00BC": "1/4", "\u00BD": "1/2", "\u00BE": "3/4",
        "\u29F8": "/", "\u0337": "/", "\u0338": "/", "\u2044": "/", "\u2215": "/", "\uFF0F": "/", "\u29F9": "\\", "\u29F5": "\\", "\u20E5": "\\", "\uFE68": "\\", "\uFF3C": "\\", "\u0332": "_",
        "\uFF3F": "_", "\u20D2": "|", "\u20D3": "|", "\u2223": "|", "\uFF5C": "|", "\u23B8": "|", "\u23B9": "|", "\u23D0": "|", "\u239C": "|", "\u239F": "|", "\u23BC": "-", "\u23BD": "-",
        "\u2015": "-", "\uFE63": "-", "\uFF0D": "-", "\u2010": "-", "\u2043": "-", "\uFE6B": "@", "\uFF20": "@", "\uFE69": "$", "\uFF04": "$", "\u01C3": "!", "\uFE15": "!", "\uFE57": "!",
        "\uFF01": "!", "\uFE5F": "#", "\uFF03": "#", "\uFE6A": "%", "\uFF05": "%", "\uFE60": "&", "\uFF06": "&", "\u201A": ", ", "\u0326": ", ", "\uFE50": ", ", "\uFE51": ", ", "\uFF0C": ", ",
        "\uFF64": ", ", "\u2768": "(", "\u276A": "(", "\uFE59": "(", "\uFF08": "(", "\u27EE": "(", "\u2985": "(", "\u2769": ")", "\u276B": ")", "\uFE5A": ")", "\uFF09": ")", "\u27EF": ")",
        "\u2986": ")", "\u204E": "*", "\u2217": "*", "\u229B": "*", "\u2722": "*", "\u2723": "*", "\u2724": "*", "\u2725": "*", "\u2731": "*", "\u2732": "*", "\u2733": "*", "\u273A": "*",
        "\u273B": "*", "\u273C": "*", "\u273D": "*", "\u2743": "*", "\u2749": "*", "\u274A": "*", "\u274B": "*", "\u29C6": "*", "\uFE61": "*", "\uFF0A": "*", "\u02D6": "+", "\uFE62": "+",
        "\uFF0B": "+", "\u3002": ".", "\uFE52": ".", "\uFF0E": ".", "\uFF61": ".", "\uFF10": "0", "\uFF11": "1", "\uFF12": "2", "\uFF13": "3", "\uFF14": "4", "\uFF15": "5", "\uFF16": "6",
        "\uFF17": "7", "\uFF18": "8", "\uFF19": "9", "\u02D0": ":", "\u02F8": ":", "\u2982": ":", "\uA789": ":", "\uFE13": ":", "\uFF1A": ":", "\u204F": ";", "\uFE14": ";", "\uFE54": ";",
        "\uFF1B": ";", "\uFE64": "<", "\uFF1C": "<", "\u0347": "=", "\uA78A": "=", "\uFE66": "=", "\uFF1D": "=", "\uFE65": ">", "\uFF1E": ">", "\uFE16": "?", "\uFE56": "?", "\uFF1F": "?",
        "\uFF21": "A", "\u1D00": "A", "\uFF22": "B", "\u0299": "B", "\uFF23": "C", "\u1D04": "C", "\uFF24": "D", "\u1D05": "D", "\uFF25": "E", "\u1D07": "E", "\uFF26": "F", "\uA730": "F",
        "\uFF27": "G", "\u0262": "G", "\uFF28": "H", "\u029C": "H", "\uFF29": "I", "\u026A": "I", "\uFF2A": "J", "\u1D0A": "J", "\uFF2B": "K", "\u1D0B": "K", "\uFF2C": "L", "\u029F": "L",
        "\uFF2D": "M", "\u1D0D": "M", "\uFF2E": "N", "\u0274": "N", "\uFF2F": "O", "\u1D0F": "O", "\uFF30": "P", "\u1D18": "P", "\uFF31": "Q", "\uFF32": "R", "\u0280": "R", "\uFF33": "S",
        "\uA731": "S", "\uFF34": "T", "\u1D1B": "T", "\uFF35": "U", "\u1D1C": "U", "\uFF36": "V", "\u1D20": "V", "\uFF37": "W", "\u1D21": "W", "\uFF38": "X", "\uFF39": "Y", "\u028F": "Y",
        "\uFF3A": "Z", "\u1D22": "Z", "\u02C6": "^", "\u0302": "^", "\uFF3E": "^", "\u1DCD": "^", "\u2774": "{", "\uFE5B": "{", "\uFF5B": "{", "\u2775": "}", "\uFE5C": "}", "\uFF5D": "}",
        "\uFF3B": "[", "\uFF3D": "]", "\u02DC": "~", "\u02F7": "~", "\u0303": "~", "\u0330": "~", "\u0334": "~", "\u223C": "~", "\uFF5E": "~", "\u00A0": "'", "\u2000": "'", "\u2001": " ",
        "\u2002": " ", "\u2003": " ", "\u2004": " ", "\u2005": " ", "\u2006": " ", "\u2007": " ", "\u2008": " ", "\u2009": " ", "\u200A": " ", "\u202F": " ", "\u205F": " ", "\u3000": " ", "\u008D": " ",
        "\u009F": " ", "\u0080": " ", "\u0090": " ", "\u009B": " ", "\u0010": " ", "\u0009": " ", "\u0000": " ", "\u0003": " ", "\u0004": " ", "\u0017": " ", "\u0019": " ", "\u0011": " ", "\u0012": " ",
        "\u0013": " ", "\u0014": " ", "\u2017": "_", "\u2014": "-", "\u2013": "-", "\u2039": ">", "\u203A": "<", "\u203C": "!!", "\u201E": "\"",
        "\u2026": "...", "\u2028": " ", "\u2029": " ", "\u2060": " ", "\u202C": " ",
    },
    htmlEntities: {
        "quot": "\"", "amp": "&", "lt": "<", "gt": ">", "nbsp": "\u00a0",
        "iexcl": "¡", "cent": "¢", "pound": "£", "curren": "¤", "yen": "¥",
        "brvbar": "¦", "sect": "§", "uml": "¨", "copy": "©", "ordf": "ª", "laquo": "«",
        "not": "¬", "shy": "\u00ad", "reg": "®", "macr": "¯", "deg": "°", "plusmn": "±",
        "sup2": "²", "sup3": "³", "acute": "´", "micro": "µ", "para": "¶", "middot": "·",
        "cedil": "¸", "sup1": "¹", "ordm": "º", "raquo": "»", "frac14": "¼", "frac12": "½",
        "frac34": "¾", "iquest": "¿", "Agrave": "À", "Aacute": "Á", "Acirc": "Â", "Atilde": "Ã",
        "Auml": "Ä", "Aring": "Å", "AElig": "Æ", "Ccedil": "Ç", "Egrave": "È", "Eacute": "É",
        "Ecirc": "Ê", "Euml": "Ë", "Igrave": "Ì", "Iacute": "Í", "Icirc": "Î", "Iuml": "Ï",
        "ETH": "Ð", "Ntilde": "Ñ", "Ograve": "Ò", "Oacute": "Ó", "Ocirc": "Ô", "Otilde": "Õ",
        "Ouml": "Ö", "times": "×", "Oslash": "Ø", "Ugrave": "Ù", "Uacute": "Ú", "Ucirc": "Û",
        "Uuml": "Ü", "Yacute": "Ý", "THORN": "Þ", "szlig": "ß", "agrave": "à", "aacute": "á",
        "acirc": "â", "atilde": "ã", "auml": "ä", "aring": "å", "aelig": "æ", "ccedil": "ç",
        "egrave": "è", "eacute": "é", "ecirc": "ê", "euml": "ë", "igrave": "ì", "iacute": "í",
        "icirc": "î", "iuml": "ï", "eth": "ð", "ntilde": "ñ", "ograve": "ò", "oacute": "ó",
        "ocirc": "ô", "otilde": "õ", "ouml": "ö", "divide": "÷", "oslash": "ø", "ugrave": "ù",
        "uacute": "ú", "ucirc": "û", "uuml": "ü", "yacute": "ý", "thorn": "þ", "yuml": "ÿ",
        "OElig": "Œ", "oelig": "œ", "Scaron": "Š", "scaron": "š", "Yuml": "Ÿ", "fnof": "ƒ",
        "circ": "ˆ", "tilde": "˜", "Alpha": "Α", "Beta": "Β", "Gamma": "Γ", "Delta": "Δ",
        "Epsilon": "Ε", "Zeta": "Ζ", "Eta": "Η", "Theta": "Θ", "Iota": "Ι", "Kappa": "Κ",
        "Lambda": "Λ", "Mu": "Μ", "Nu": "Ν", "Xi": "Ξ", "Omicron": "Ο", "Pi": "Π", "Rho": "Ρ",
        "Sigma": "Σ", "Tau": "Τ", "Upsilon": "Υ", "Phi": "Φ", "Chi": "Χ", "Psi": "Ψ", "Omega": "Ω",
        "alpha": "α", "beta": "β", "gamma": "γ", "delta": "δ", "epsilon": "ε", "zeta": "ζ", "eta": "η",
        "theta": "θ", "iota": "ι", "kappa": "κ", "lambda": "λ", "mu": "μ", "nu": "ν", "xi": "ξ",
        "omicron": "ο", "pi": "π", "rho": "ρ", "sigmaf": "ς", "sigma": "σ", "tau": "τ",
        "upsilon": "υ", "phi": "φ", "chi": "χ", "psi": "ψ", "omega": "ω", "thetasym": "ϑ",
        "upsih": "ϒ", "piv": "ϖ", "ensp": " ", "emsp": " ", "thinsp": " ", "zwnj": "‌\u200c",
        "zwj": "‍\u200d", "lrm": "‎\u200e", "rlm": "\u200f‏", "ndash": "–", "mdash": "—",
        "lsquo": "‘", "rsquo": "’", "sbquo": "‚", "ldquo": "“", "rdquo": "”", "bdquo": "„",
        "dagger": "†", "Dagger": "‡", "permil": "‰", "lsaquo": "‹", "rsaquo": "›", "bull": "•",
        "hellip": "…", "prime": "′", "Prime": "″", "oline": "‾", "frasl": "⁄",
        "weierp": "℘", "image": "ℑ", "real": "ℜ", "trade": "™", "alefsym": "ℵ", "larr": "←",
        "uarr": "↑", "rarr": "→", "darr": "↓", "harr": "↔", "crarr": "↵", "lArr": "⇐", "uArr": "⇑",
        "rArr": "⇒", "dArr": "⇓", "hArr": "⇔", "forall": "∀", "part": "∂", "exist": "∃", "empty": "∅",
        "nabla": "∇", "isin": "∈", "notin": "∉", "ni": "∋", "prod": "∏", "sum": "∑", "minus": "−",
        "lowast": "∗", "radic": "√", "prop": "∝", "infin": "∞", "ang": "∠", "and": "⊥", "or": "⊦",
        "cap": "∩", "cup": "∪", "int": "∫", "there4": "∴", "sim": "∼", "cong": "≅", "asymp": "≈",
        "ne": "≠", "equiv": "≡", "le": "≤", "ge": "≥", "sub": "⊂", "sup": "⊃", "nsub": "⊄",
        "sube": "⊆", "supe": "⊇", "oplus": "⊕", "otimes": "⊗", "perp": "⊥", "sdot": "⋅", "lceil": "⌈",
        "rceil": "⌉", "lfloor": "⌊", "rfloor": "⌋", "lang": "〈", "rang": "〉", "loz": "◊", "spades": "♠",
        "clubs": "♣", "hearts": "♥", "diams": "♦",
    },
    strftimeFormat: "%Y-%m-%d %H:%M:%S %Z",
    strftimeMap: {
        weekDays: {
            "": [ 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat' ]
        },
        weekDaysFull: {
            "": [ 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday' ]
        },
        months: {
            "": [ 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec' ]
        },
        monthsFull: {
            "": [ 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December' ]
        },
    },
    tzMap: [
        // name, GMT offset, daylight, linux support
        ["EDT", "GMT-0400", true],
        ["EST", "GMT-0500", false],
        ["PDT", "GMT-0700", true],
        ["PST", "GMT-0800", false],
        ["CDT", "GMT-0500", true],
        ["CST", "GMT-0600", false],
        ["MDT", "GMT-0600", true],
        ["MST", "GMT-0700", false],
        ["HADT", "GMT-0900", true, false],
        ["HAST", "GMT-1000", false, false],
        ["AKDT", "GMT-0800", true, false],
        ["AKST", "GMT-0900", false, false],
        ["ADT", "GMT-0300", true, false],
        ["AST", "GMT-0400", false, false],
    ],
    // Respawn throttling
    respawn: { interval: 3000, timeout: 2000, delay: 30000, count: 4, time: null, events: 0 },
};

module.exports = lib;

// Empty function to be used when callback was no provided
lib.empty = {};
lib.emptylist = [];
lib.noop = function() {}

// Run a callback if a valid function, all arguments after the callback will be passed as is
lib.tryCall = function(callback)
{
    if (typeof callback == "function") return callback.apply(null, Array.prototype.slice.call(arguments, 1));
    if (callback) logger.warn("tryCall:", arguments, new Error().stack);
}

// Run a callback inside try..catch block, all arguments after the callback will be passed as is, in case of error
// all arguments will be printed in the log
lib.tryCatch = function(callback)
{
    var args = Array.prototype.slice.call(arguments, 1);
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
    if (util.isError(arguments[0])) return console.log(lib.traceError(arguments[0]));
    for (var i = 0; i < arguments.length; i++) {
        console.log(util.inspect(arguments[i], { depth: 5 }));
    }
}

// Simple i18n translation method compatible with other popular modules, supports the following usage:
// - __(name)
// - __(fmt, arg,...)
// - __({ phrase: "", locale: "" }, arg...
//
lib.__ = function()
{
    var lang = this.locale, txt, msg = arguments[0];

    if (typeof arguments[0] === "object" && arguments[0].phrase) {
        msg = arguments[0].phrase;
        lang = arguments[0].locale || lang;
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
    if (arguments.length == 1) return txt;
    return lib.sprintf(txt, Array.prototype.slice.call(arguments, 1));
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
    var minDistance = options.minDistance || 0.01;
    var range = this.geoHashRanges.filter(function(x) { return x[1] > minDistance })[0];
    var geohash = bkutils.geoHashEncode(latitude, longitude);
    return { geohash: geohash.substr(0, range[0]),
             _geohash: geohash,
             neighbors: options.distance ? bkutils.geoHashGrid(geohash.substr(0, range[0]), Math.ceil(options.distance / range[1])).slice(1) : [],
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
    var distance = bkutils.geoDistance(latitude1, longitude1, latitude2, longitude2);
    if (isNaN(distance) || distance === null || typeof distance == "undefined") return null;

    // Round the distance to the closes edge and fixed number of decimals
    if (options && typeof options.round == "number" && options.round > 0) {
        var decs = String(options.round).split(".")[1];
        distance = parseFloat(Number(Math.floor(distance/options.round)*options.round).toFixed(decs ? decs.length : 0));
        if (isNaN(distance)) return null;
    }
    return distance;
}

// Busy timer handler, supports commands:
// - init - start the timer with the given latency in ms
// - get - returns the latest latency
// - busy - returns true if busy i.e. latency is greater than configured
lib.busyTimer = function(name, val)
{
    switch (name) {
    case "init":
        bkutils.initBusy(val);
        break;
    case "get":
        return bkutils.getBusy();
    case "busy":
        return bkutils.isBusy();
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

// Return an object with user info from the /etc/passwd file, user can be uid or name, if user is ommitted the current user is returned
lib.getUser = function(user)
{
    return bkutils.getUser(user);
}

// Return an object with specified group info for the current user of for the given group id or name
lib.getGroup = function(group)
{
    return bkutils.getGroup(group);
}

// Drop root privileges and switch to a regular user
lib.dropPrivileges = function(uid, gid)
{
    if (process.getuid() == 0 && uid) {
        logger.debug('init: switching to', uid, gid);
        try { process.setgid(gid); } catch (e) { logger.error('setgid:', gid, e); }
        try { process.setuid(uid); } catch (e) { logger.error('setuid:', uid, e); }
    }
}

// Encrypt data with the given key code
lib.encrypt = function(key, data, options)
{
    if (!key || !data) return '';
    try {
        options = options || this.empty;
        const encode = options.encode === "binary" ? undefined : options.encode || "base64";
        key = Buffer.isBuffer(key) ? key : typeof key == "string" ? key : String(key);
        data = Buffer.isBuffer(data) ? data : Buffer.from(typeof data == "string" ? data : String(data));
        const iv = crypto.randomBytes(options.iv_length || 16);
        const password = crypto.pbkdf2Sync(key, iv.toString(), options.key_iterations || 10000, options.key_length || 32, options.key_hash || 'sha256');
        const cipher = crypto.createCipheriv(options.algorithm || 'aes-256-cbc', password, iv);
        var msg = Buffer.concat([iv, cipher.update(data), cipher.final()]);
        if (encode) msg = msg.toString(encode);
    } catch (e) {
        msg = '';
        logger.debug('encrypt:', options, e.stack);
    }
    return msg;
}

// Decrypt data with the given key code
lib.decrypt = function(key, data, options)
{
    if (!key || !data) return '';
    try {
        options = options || this.empty;
        const encode = options.encode === "binary" ? undefined : options.encode || "base64";
        key = Buffer.isBuffer(key) ? key : typeof key == "string" ? key : String(key);
        data = Buffer.isBuffer(data) ? data : Buffer.from(typeof data == "string" ? data : String(data), encode);
        const iv = data.slice(0, options.iv_length || 16);
        const password = crypto.pbkdf2Sync(key, iv.toString(), options.key_iterations || 10000, options.key_length || 32, options.key_hash || 'sha256');
        const decipher = crypto.createDecipheriv(options.algorithm || 'aes-256-cbc', password, iv);
        var msg = Buffer.concat([decipher.update(data.slice(16)), decipher.final()]).toString("utf8");
    } catch (e) {
        msg = '';
        logger.debug('decrypt:', options, e.stack);
    }
    return msg;
}

// Convert an IP address into integer
lib.ip2int = function(ip)
{
    return ip.split('.').reduce((int, oct) => (int << 8) + parseInt(oct, 10), 0) >>> 0;
}

// Convert an integer into IP address
lib.int2ip = function(int)
{
    return [(int >>> 24) & 0xFF, (int >>> 16) & 0xFF, (int >>> 8) & 0xFF, int & 0xFF].join('.');
}

// Return true if the given IP address is within the given CIDR block
lib.inCidr = function(ip, cidr)
{
    const [range, bits = 32] = cidr.split('/');
    const mask = ~(Math.pow(2, (32 - bits)) - 1);
    return (this.ip2int(ip) & mask) === (this.ip2int(range) & mask);
};

// Return first and last IP addresses for the CIDR block
lib.cidrRange = function(cidr)
{
    const [range, bits = 32] = cidr.split('/');
    const mask = ~(Math.pow(2, (32 - bits)) - 1);
    return [this.int2ip(this.ip2int(range) & mask), this.int2ip(this.ip2int(range) | ~mask)];
}

// HMAC signing and base64 encoded, default algorithm is sha1
lib.sign = function (key, data, algorithm, encode)
{
    try {
        key = Buffer.isBuffer(key) ? key : String(key);
        data = Buffer.isBuffer(data) ? data : String(data);
        encode = encode === "binary" ? undefined : encode || "base64";
        return crypto.createHmac(algorithm || "sha1", key).update(data, "utf8").digest(encode);
    } catch (e) {
        logger.error('sign:', algorithm, encode, e.stack);
        return "";
    }
}

// Hash and base64 encoded, default algorithm is sha1
lib.hash = function (data, algorithm, encode)
{
    try {
        data = Buffer.isBuffer(data) ? data : String(data);
        encode = encode === "binary" ? undefined : encode || "base64";
        return crypto.createHash(algorithm || "sha1").update(data, "utf8").digest(encode);
    } catch (e) {
        logger.error('hash:', algorithm, encode, e.stack);
        return "";
    }
}

// Return cached Hashids object for the given configuration
lib.getHashid = function(salt, min, alphabet)
{
    min = min || 0;
    salt = salt || this.salt;
    alphabet = alphabet || this.base62;
    var key = salt + min + alphabet;
    if (!this.hashids[key]) {
        this.hashids[key] = new Hashids(salt, lib.toNumber(min), alphabet);
        this.hashids[key]._counter = process.pid;
    }
    if (++this.hashids[key]._counter > 65535) this.hashids[key]._counter = 1;
    return this.hashids[key];
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

// Return random number between 0 and ULONG_MAX
lib.randomUInt = function()
{
    return crypto.randomBytes(6).readUIntLE(0, 6);
}

// Returns random number between 0 and 1, 32 bits
lib.randomFloat = function()
{
    return parseFloat("0." + crypto.randomBytes(4).readUInt32LE(0));
}

// Return random integer between min and max inclusive using crypto generator, based on
// https://github.com/joepie91/node-random-number-csprng
lib.randomInt = function(min, max)
{
    var bits = Math.ceil(Math.log2(max - min));
    var bytes = Math.ceil(bits / 8);
    var mask = Math.pow(2, bits) - 1, n;
    for (var t = 0; t < 3; t++) {
        var d = crypto.randomBytes(bytes);
        n = 0;
        for (var i = 0; i < bytes; i++) n |= d[i] << 8 * i;
        n = n & mask;
        if (n <= max - min) break;
    }
    return min + n;
}

// Generates a random number between given min and max (required)
// Optional third parameter indicates the number of decimal points to return:
//   - If it is not given or is NaN, random number is unmodified
//   - If >0, then that many decimal points are returned (e.g., "2" -> 12.52
lib.randomNum = function(min, max, decs)
{
    var num = min + (this.randomFloat() * (max - min));
    return (typeof decs !== 'number' || decs <= 0) ? num : parseFloat(num.toFixed(decs));
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

// Extract domain from the host name, takes all host parts except the first one
lib.domainName = function(host)
{
    if (typeof host != "string" || !host) return "";
    var name = this.strSplit(host, '.');
    return (name.length > 2 ? name.slice(1).join('.') : host).toLowerCase();
}

// Return a new Error object, msg can be a string or an object with message, code, status properties.
// The default error status is 400 if not specified.
lib.newError = function(msg, status, code)
{
    if (typeof msg == "string") msg = { status: typeof status == "number" ? status : 400, message: msg };
    var err = new Error(msg && msg.message || this.__("Internal error occurred, please try again later"));
    for (var p in msg) err[p] = msg[p];
    if (!err.status) err.status = 400;
    if (code) err.code = code;
    return err;
}

// Returns the error stack or the error itself, to be used in error messages
lib.traceError = function(err)
{
    return this.objDescr(err || "", { ignore: /^domain|req|res$/ }) + " " + (util.isError(err) && err.stack ? err.stack : "");
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

// Run the process and return all output to the callback, this a simply wrapper around child_processes.exec so the lib.runProcess
// can be used without importing the child_processes module. All fatal errors are logged.
lib.execProcess = function(cmd, callback)
{
    return child.exec(cmd, function (err, stdout, stderr) {
        logger.debug('execProcess:', cmd, err, stderr);
        lib.tryCall(callback, err, stdout, stderr);
    });
}

// Run specified command with the optional arguments, this is similar to child_process.spawn with callback being called after the process exited
//
//  Example
//
//          lib.spawProcess("ls", "-ls", { cwd: "/tmp" }, lib.log)
//
lib.spawnProcess = function(cmd, args, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = { stdio: "inherit", env: process.env, cwd: process.cwd() };
    if (!options.stdio) options.stdio = "inherit";
    if (!Array.isArray(args)) args = [ args ];
    var proc = child.spawn(cmd, args, options);
    proc.on("error", function(err) {
        logger.error("spawnProcess:", cmd, args, err);
        lib.tryCall(callback, err);
    });
    proc.on('exit', function (code, signal) {
        logger.debug("spawnProcess:", cmd, args, "exit", code || signal);
        lib.tryCall(callback, code || signal);
    });
    return proc;
}

// If respawning too fast, delay otherwise call the callback after a short timeout
lib.checkRespawn = function(callback)
{
    if (this.exiting) return;
    var now = Date.now();
    logger.debug('checkRespawn:', this.respawn, now - this.respawn.time);
    if (this.respawn.time && now - this.respawn.time < this.respawn.interval) {
        if (this.respawn.count && this.respawn.events >= this.respawn.count) {
            logger.log('checkRespawn:', 'throttling for', this.respawn.delay, 'after', this.respawn.events, 'respawns');
            this.respawn.events = 0;
            this.respawn.time = now;
            return setTimeout(callback, this.respawn.delay);
        }
        this.respawn.events++;
    } else {
        this.respawn.events = 0;
    }
    this.respawn.time = now;
    setTimeout(callback, this.respawn.timeout);
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
//                           lib.log)
//
lib.spawnSeries = function(cmds, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = { stdio: "inherit", env: process.env, cwd: process.cwd };
    this.forEachSeries(Object.keys(cmds), function(cmd, next) {
        var argv = cmds[cmd], opts = options;
        switch (lib.typeName(argv)) {
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
            return next(options.error ? lib.newError("invalid args", cmd) : null);
        }
        if (!options.stdio) options.stdio = "inherit";
        if (typeof argv == "string") argv = [ argv ];
        lib.spawnProcess(cmd, argv, opts, function(err) {
            next(options.error ? err : null);
        });
    }, callback);
}

// Returns current time in microseconds
lib.clock = function()
{
    return bkutils.getTimeOfDay();
}

// Return number of seconds for current time
lib.now = function()
{
    return Math.round(Date.now()/1000);
}

// Return an ISO week number for given date, from https://www.epochconverter.com/weeknumbers
lib.weekOfYear = function(date, utc)
{
    date = this.toDate(date, null);
    if (!date) return 0;
    utc = utc ? "UTC": "";
    var target = new Date(date.valueOf());
    target[`set${utc}Date`](target[`get${utc}Date`]() - ((date[`get${utc}Day`]() + 6) % 7) + 3);
    var firstThursday = target.valueOf();
    target[`set${utc}Month`](0, 1);
    var day = target[`get${utc}Day`]();
    if (day != 4) target[`set${utc}Month`](0, 1 + ((4 - day) + 7) % 7);
    return 1 + Math.ceil((firstThursday - target) / 604800000);
}

// Returns true if the given date is in DST timezone
lib.isDST = function(date)
{
    var jan = new Date(date.getFullYear(), 0, 1).getTimezoneOffset();
    var jul = new Date(date.getFullYear(), 6, 1).getTimezoneOffset();
    return Math.max(jan, jul) != date.getTimezoneOffset();
}

// Return a timezone human name if matched (EST, PDT...), tz must be in GMT-NNNN format
lib.tzName = function(tz)
{
    if (!tz || typeof tz != "string") return "";
    var t = tz.indexOf(":") > 0 ? tz.replace(":", "") : tz;
    for (const i in this.tzMap) {
        if (t == this.tzMap[i][1]) return this.tzMap[i][0];
    }
    return tz;
}

// Returns 0 if the current time is not within specified valid time range or it is invalid. Only continious time rang eis support, it
// does not handle over the midninght ranges, i.e. time1 is always must be greater than time2.
//
// `options.tz` to specify timezone, no timezone means current timezone.
// `options.date` if given must be a list of dates in the format: YYY-MM-DD,...
lib.isTimeRange = function(time1, time2, options)
{
    if (!time1 && !time2) return 0;
    var now = new Date(), tz = options && options.tz;
    if (tz === "GMT" || tz === "UTC") {
        tz = 0;
    } else {
        tz = typeof tz == "string" && tz.match(/GMT(-|\+)?([0-9]{2}):?([0-9]{2})/);
        if (tz) tz = (parseInt(tz[2], 10) * 3600000 + parseInt(tz[3], 10) * 60000) * (tz[1] == "+" ? 1 : -1);
        if (!tz) tz = now.getTimezoneOffset() * -60000;
    }
    now = new Date(now.getTime() + tz);
    if (options && options.date) {
        if (lib.strftime(now, "%Y-%m-%d") != lib.strftime(lib.toDate(options.date), "%Y-%m-%d")) return 0;
    }
    var h0 = now.getUTCHours();
    var m0 = now.getUTCMinutes();
    if (time1) {
        const d = String(time1).match(/^(([0-9]+)|([0-9]+):([0-9]+)) *(am|AM|pm|PM)?$/);
        if (!d) return 0;
        let h1 = lib.toNumber(d[2] || d[3]);
        const m1 = lib.toNumber(d[4]);
        switch (d[5]) {
        case "am":
        case "AM":
            if (h1 >= 12) h1 -= 12;
            break;
        case "pm":
        case "PM":
            if (h1 < 12) h1 += 12;
            break;
        }
        logger.debug("isTimeRange:", "start:", h0, m0, " - ", h1, m1, d[5], "tz:", tz, "now:", now);
        if (h0*100+m0 < h1*100+m1) return 0;
    }
    if (time2) {
        const d = String(time2).match(/^(([0-9]+)|([0-9]+):([0-9]+)) *(am|AM|pm|PM)?$/);
        if (!d) return 0;
        let h1 = lib.toNumber(d[2] || d[3]);
        const m1 = lib.toNumber(d[4]);
        switch (d[5]) {
        case "am":
        case "AM":
            if (h1 > 12) h1 -= 12;
            break;
        case "pm":
        case "PM":
            if (h1 <= 12) h1 += 12;
            break;
        }
        logger.debug("isTimeRange:", "end:", h0, m0, " - ", h1, m1, d[5], "tz:", tz, "now:", now);
        if (h0*100+m0 > h1*100+m1) return 0;
    }
    return 1;
}

// Return object type, try to detect any distinguished type
lib.typeName = function(v)
{
    if (v === null) return "null";
    var t = typeof(v);
    if (t !== "object") return t;
    if (Array.isArray(v)) return "array";
    if (Buffer.isBuffer(v)) return "buffer";
    if (util.isDate(v)) return "date";
    if (util.isError(v)) return "error";
    if (util.isRegExp(v)) return "regexp";
    return "object";
}

// Return unique Id without any special characters and in lower case
lib.uuid = function(prefix, options)
{
    var u = uuid.v4(options);
    return typeof u == "string" ? (prefix || "") + u.replace(/[-]/g, '').toLowerCase() : u;
}

// Returns a short unique id
lib.suuid = function(prefix, options)
{
    if (!options) options = this.empty;
    var hashid = this.getHashid(options.salt, options.min, options.alphabet);
    var tm = bkutils.getTimeOfDay(2);
    var s = hashid.encode(tm.tv_sec, tm.tv_usec, hashid._counter);
    return prefix ? prefix + s : s;
}

// Returns time sortable unique id, inspired by https://github.com/paixaop/node-time-uuid
lib.tuuid = function(prefix, encode)
{
    if (!this._hostHash) {
        var b = Buffer.from(crypto.createHash('sha512').update(os.hostname(), 'ascii').digest('binary'));
        this._hostHash = Buffer.from([b[1], b[3], b[5], (process.pid) & 0xFF, (process.pid >> 8) & 0xFF ]);
        this._hostCounter = 0;
    }
    // Must fit into 3 bytes only
    if (++this._hostCounter >= 8388607) this._hostCounter = 1;
    var tm = bkutils.getTimeOfDay(2);
    var s = Buffer.from([tm.tv_sec >> 24,
                        tm.tv_sec >> 16,
                        tm.tv_sec >> 8,
                        tm.tv_sec,
                        tm.tv_usec >> 16,
                        tm.tv_usec >> 8,
                        tm.tv_usec,
                        this._hostHash[0],
                        this._hostHash[1],
                        this._hostHash[2],
                        this._hostHash[3],
                        this._hostHash[4],
                        this._hostCounter >> 16,
                        this._hostCounter >> 8,
                        this._hostCounter
                       ]);
    if (encode != "binary") s = s.toString(encode || "hex");
    return prefix ? prefix + s : s;
}

// Return time in milliseconds from the time uuid
lib.tuuidTime = function(str)
{
    if (typeof str != "string" || !str) return 0;
    var idx = str.indexOf("_");
    if (idx > 0) str = str.substr(idx + 1);
    var bytes = Buffer.from(str, 'hex');
    var secs = bytes.length > 4 ? bytes.readUInt32BE(0) : 0;
    var usecs = bytes.length > 7 ? bytes.readUInt32BE(3) & 0x00FFFFFF : 0;
    return secs*1000 + (usecs/1000);
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

// Return true if the value is prefixed
lib.isPrefix = function(val, prefix)
{
    return typeof prefix == "string" && prefix &&
           typeof val == "string" && val.substr(0, prefix.length) == prefix;
}

// Returns true if the value represents an UUID
lib.isUuid = function(val, prefix)
{
    if (this.rxUuid.test(val)) {
        if (typeof prefix == "string" && prefix) {
            if (val.substr(0, prefix.length) != prefix) return false;
        }
        return true;
    }
    return false;
}

// Returns true if the value represent tuuid
lib.isTuuid = function(str)
{
    if (typeof str != "string" || !str) return 0;
    var idx = str.indexOf("_");
    if (idx > 0) str = str.substr(idx + 1);
    var bytes = Buffer.from(str, 'hex');
    if (bytes.length != 15) return 0;
    return 1;
}

// Returns true of a string contains Unicode characters
lib.isUnicode = function(str)
{
    return /[\u007F-\uFFFF]/g.test(str);
}

// Returns true if a number is positive, i.e. greater than zero
lib.isPositive = function(val)
{
    return this.isNumber(val) && val > 0;
}

// Returns the array if the value is non empty array or dflt value if given or undefined
lib.isArray = function(val, dflt)
{
    return Array.isArray(val) && val.length ? val : dflt;
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
    case "function":
        return false;
    case "object":
        for (const p in val) return false;
        return true;
    case "string":
        return this.rxEmpty.test(val) ? true : false;
    default:
        return val ? false: true;
    }
}

// Returns true if the value is a number or string representing a number
lib.isNumeric = function(val)
{
    if (typeof val == "number") return true;
    if (typeof val != "string") return false;
    return this.rxNumber.test(val);
}

// Returns true if the given type belongs to the numeric family of data types
lib.isNumericType = function(type)
{
    return type && this.rxNumericType.test(String(type).trim());
}

// Returns true if the given date is valid
lib.isDate = function(d)
{
    return util.isDate(d) && !isNaN(d.getTime());
}

// Returns true if `name` exists in the array `list`, search is case sensitive. if `name` is an array it will return true if
// any element in the array exists in the `list`.
lib.isFlag = function(list, name)
{
    return Array.isArray(list) && (Array.isArray(name) ? name.some(function(x) { return list.indexOf(x) > -1 }) : list.indexOf(name) > -1);
}
