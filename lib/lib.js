//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const util = require('util');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const child = require('child_process');
const bkutils = require('bkjs-utils');
const logger = require(__dirname + '/logger');
const os = require('os');
const uuid = require('uuid');
const xml2json = require('xml2json');
const Hashids = require("hashids");

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
    rxIpaddress: /^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}(\/[0-9]{1,2})?$/,
    rxNumericType: /^(int|smallint|bigint|now|clock|mtime|counter|real|float|double|numeric|number|decimal|long)/i,
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
        ["EDT", "GMT-0400", true],
        ["EST", "GMT-0500", false],
        ["PDT", "GMT-0700", true],
        ["PST", "GMT-0800", false],
        ["CDT", "GMT-0500", true],
        ["CST", "GMT-0600", false],
        ["MDT", "GMT-0600", true],
        ["MST", "GMT-0700", false],
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
    } catch(e) {
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

// Returns true of given arg(s) are present in the command line, name can be a string or an array of strings.
lib.isArg = function(name)
{
    if (!Array.isArray(name)) return process.argv.lastIndexOf(name) > 0;
    return name.some(function(x) { return process.argv.lastIndexOf(x) > 0 });
}

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
    return str ? String(str).replace("_", ".").replace(/[^0-9.]/g, "").split(".").reduce(function(x,y,i) { return x + Number(y) / Math.pow(10, i * 3) }, 0) : 0;
}

// Encode with additional symbols, convert these into percent encoded:
//
//          ! -> %21, * -> %2A, ' -> %27, ( -> %28, ) -> %29
lib.encodeURIComponent = function(str)
{
    if (typeof str == "undefined") return "";
    try {
        return encodeURIComponent(str).replace(/[!'()*]/g, function(m) {
            return m == '!' ? '%21' : m == "'" ? '%27' : m == '(' ? '%28' : m == ')' ? '%29' : m == '*' ? '%2A' : m;
        });
    } catch(e) {
        logger.error("encodeURIComponent:", str, e.stack);
    }
}
lib.escape = lib.encodeURIComponent;

// Convert text into capitalized words
lib.toTitle = function(name)
{
    return typeof name == "string" ? name.replace(/_/g, " ").split(/[ ]+/).reduce(function(x,y) {
        return x + (y ? (y.substr(0,1).toUpperCase() + y.substr(1).toLowerCase() + " ") : "")
    }, "").trim() : "";
}

// Convert into camelized form, optional chars can define the separators, default is -, _ and .
lib.toCamel = function(name, chars)
{
    var rx = typeof chars == "string" ? new RegExp("(?:[" + chars + "])(\\w)", "g") : this.rxCamel;
    return typeof name == "string" ? name.substr(0, 1).toLowerCase() + name.substr(1).replace(rx, function (_, c) { return c ? c.toUpperCase () : ''; }) : "";
}

// Convert Camel names into names separated by the given separator or dash if not.
lib.toUncamel = function(str, sep)
{
    return typeof str == "string" ? str.replace(/([A-Z])/g, function(_, c, index) { return (index ? sep || '-' : '') + c.toLowerCase(); }) : "";
}

// Safe version, uses 0 instead of NaN, handle booleans, if float specified, returns as float.
//
// Options:
//  - dflt - default value
//  - float - treat as floating number
//  - min - minimal value, clip
//  - max - maximum value, clip
//  - incr - a number to add before checking for other conditions
//  - mult - a number to multiply before checking for other conditions
//  - novalue - replace this number with default
//  - zero - replace with this number if result is 0
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
        n = val;
    } else
    if (typeof val == "boolean") {
        n = val ? 1 : 0;
    } else {
        if (typeof val != "string") {
            n = options && options.dflt || 0;
        } else {
            // Autodetect floating number
            var f = !options || typeof options.float == "undefined" || options.float == null ? this.rxFloat.test(val) : options.float;
            n = val[0] == 't' ? 1 : val[0] == 'f' ? 0 : val == "infinity" ? Infinity : (f ? parseFloat(val, 10) : parseInt(val, 10));
        }
    }
    n = isNaN(n) ? (options && options.dflt || 0) : n;
    if (options) {
        if (typeof options.novalue == "number" && n === options.novalue) n = options.dflt || 0;
        if (typeof options.incr == "number") n += options.incr;
        if (typeof options.mult == "number") n *= options.mult;
        if (typeof options.min == "number" && n < options.min) n = options.min;
        if (typeof options.max == "number" && n > options.max) n = options.max;
        if (typeof options.float != "undefined" && !options.float) n = Math.round(n);
        if (typeof options.zero == "number" && !n) n = options.zero;
    }
    return n;
}

// Return a number clamped between the range
lib.toClamp = function(num, min, max)
{
  return Math.max(lib.toNumber(min), Math.min(lib.toNumber(num), lib.toNumber(max)));
}

// Return true if value represents true condition, i.e. non empty value
lib.toBool = function(val, dflt)
{
    if (typeof val == "boolean") return val;
    if (typeof val == "number") return !!val;
    if (typeof val == "undefined") val = dflt;
    if (typeof val == "function") val = dflt;
    return !val || String(val).trim().match(/^(false|off|nil|null|no|f|n|0$)/i) ? false : true;
}

// Return Date object for given text or numeric date representation, for invalid date returns 1969 unless `invalid` parameter is given,
// in this case invalid date returned as null. If `dflt` is NaN, null or 0 returns null as well.
lib.toDate = function(val, dflt, invalid)
{
    if (this.isDate(val)) return val;
    var d = NaN;
    // String that looks like a number
    if (typeof val == "string" && /^[0-9.]+$/.test(val)) val = this.toNumber(val);
    // Assume it is seconds which we use for most mtime columns, convert to milliseconds
    if (typeof val == "number" && val < 2147483647) val *= 1000;
    if (typeof val != "string" && typeof val != "number") val = d;
    if (val) try { d = new Date(val); } catch(e) {}
    return this.isDate(d) ? d : invalid || (dflt !== undefined && isNaN(dflt)) || dflt === null || dflt === 0 ? null : new Date(dflt || 0);
}

// Return milliseconds from the date or date string, only number as dflt is supported, for invalid dates returns 0
lib.toMtime = function(val, dflt)
{
    val = this.toDate(val, null);
    return val ? val.getTime() : typeof dflt == "number" ? dflt : 0;
}

// Return base62 representation for a number
lib.toBase62 = function(num, alphabet)
{
    var s = '';
    if (Array.isArray(num) && typeof num[0] == "number") num = Buffer.alloc(num);
    if (Buffer.isBuffer(num)) {
        for (var i = 0; i < num.length - 3; i += 4) {
            s += this.toBase62(num.readUInt32LE(i), alphabet);
        }
    } else {
        if (!alphabet) alphabet = this.base62Dict;
        while (num > 0) {
            s = alphabet[num % alphabet.length] + s;
            num = Math.floor(num/alphabet.length);
        }
    }
    return s;
}

// Convert value to the proper type
lib.toValue = function(val, type, options)
{
    var d;
    type = (type || "").trim();
    switch (type) {
    case "set":
    case "list":
    case 'array':
        return this.strSplitUnique(val, options && options.separator, options);

    case "expr":
    case "buffer":
        return val;

    case "real":
    case "float":
    case "double":
    case "decimal":
        return this.toNumber(val, { float: 1 });

    case "int":
    case "int32":
    case "long":
    case "smallint":
    case "integer":
    case "number":
    case "bigint":
    case "numeric":
    case "counter":
    case "now":
    case "clock":
        return this.toNumber(val, options);

    case "bool":
    case "boolean":
        return this.toBool(val, options && options.dflt);

    case "date":
    case "time":
    case "timestamp":
        return this.toDate(val, options && options.dflt);

    case "regexp":
        return this.toRegexp(val, options);

    case "mtime":
        return val ? this.toDate(val, options && options.dflt).getTime() : 0;

    case "url":
        if (typeof val == "string" && val.length && !this.rxUrl.test(val)) val = "http://" + val;
        return val;

    case "email":
        if (typeof val != "string" || val.indexOf("..") > -1 || !this.rxEmail1.test(val)) val = "";
        d = val.match(this.rxEmail2);
        if (d) val = d[1];
        return val.trim().toLowerCase();

    case "phone":
    case "e164":
        if (typeof val == "number") {
            // Keep US phones without 1
            if (type[0] == "p" && val < 19999999999 && val > 10000000000) val -= 10000000000;
            if (type[0] == "e" && val < 10000000000) val += 10000000000;
            return String(val);
        }
        if (typeof val != "string") return "";
        d = val.match(this.rxPhone);
        if (!d) return "";
        val = d[1].replace(this.rxPhone2, "").slice(0, 15);
        var min = options && typeof options.min == "number" ? options.min : 7;
        if (min && val.length < min) return "";
        // Keep US phones without 1
        if (type[0] == "p" && val.length == 11 && val[0] == "1") val = val.substr(1);
        if (type[0] == "e" && val.length == 10) val = "1" + val;
        return val;

    case "json":
        return this.stringify(val);

    case "lower":
        return String(val).toLowerCase();

    case "upper":
        return String(val).toUpperCase();

    default:
        if (options && typeof options.toValue == "function") return options.toValue(val, options);
        return typeof val == "string" ? val : typeof val == "undefined" || val === null ? "" : String(val);
    }
}

// Safely create a regexp object, if invalid returns undefined, the options can be a string with srandard RegExp
// flags or an object with the following properties:
// - ingoreCase - similar to i
// - globalMatch - similar to m
// - multiLine - similar to m
// - unicode - similar to u
// - sticky - similar to y
lib.toRegexp = function(str, options)
{
    try {
        var flags = typeof options == "string" && /^[igmuy]+$/.test(options) ? options :
                    options ? (options.ignoreCase ? "i" : "") +
                              (options.globalMatch ? "g" : "") +
                              (options.multiLine ? "m" : "") +
                              (options.unicode ? "u" : "") +
                              (options.sticky ? "y" : "") : "";
        return new RegExp(str, flags);
    } catch(e) {
        logger.error('toRegexp:', str, options, e);
    }
}

// Add a regexp to the list of regexp objects, this is used in the config type `regexpmap`.
lib.toRegexpMap = function(obj, val, options)
{
    if (val == null) return [];
    if (this.typeName(obj) != "array") obj = [];
    if (options && options.set) obj = [];
    val = this.jsonParse(val, { datatype: "obj", logger: "error" });
    for (var p in val) {
        if (obj.some(function(x) { return x.list.indexOf(p) > -1 })) continue;
        var item = this.toRegexpObj(null, p, options);
        item.value = val[p];
        if (item.reset) obj = [];
        obj.push(item);
    }
    return obj;
}

// Add a regexp to the object that consist of list of patterns and compiled regexp, this is used in the config type `regexpobj`
lib.toRegexpObj = function(obj, val, options)
{
    if (val == null) obj = null;
    if (this.typeName(obj) != "object") obj = {};
    if (!Array.isArray(obj.list)) obj.list = [];
    if (val) {
        if (options && options.del) {
            var idx = obj.list.indexOf(val);
            if (idx > -1) obj.list.splice(idx, 1);
        } else {
            if (options && options.set) obj.list = [];
            if (!Array.isArray(val)) val = [ val ];
            for (var i in val) {
                if (obj.list.indexOf(val[i]) == -1) obj.list.push(val[i]);
            }
        }
    }
    obj.rx = null;
    if (obj.list.length) {
        try {
            obj.rx = new RegExp(obj.list.map(function(x) { return "(" + x + ")"}).join("|"), options && options.regexp);
        } catch(e) {
            logger.error('toRegexpObj:', val, e);
        }
    }
    return obj;
}

// Return duration in human format, mtime is msecs
lib.toDuration = function(mtime, options)
{
    var str = "";
    mtime = typeof mtime == "number" ? mtime : this.toNumber(mtime);
    if (mtime > 0) {
        var lang = options && options.lang;
        var seconds = Math.floor(mtime/1000);
        var d = Math.floor(seconds / 86400);
        var h = Math.floor((seconds - d * 86400) / 3600);
        var m = Math.floor((seconds - d * 86400 - h * 3600) / 60);
        var s = Math.floor(seconds - d * 86400 - h * 3600 - m * 60);
        if (d > 0) {
            str = d > 1 ? this.__({ phrase: "%s days", lang: lang }, d) :
                          this.__({ phrase: "1 day", lang: lang });
            if (h > 0) str += " " + (h > 1 ? this.__({ phrase: "%s hours", lang: lang }, h) :
                                             this.__({ phrase: "1 hour", lang: lang }));
            if (m > 0) str += " " + (m > 1 ? this.__({ phrase: "%s minutes", lang: lang }, m) :
                                             this.__({ phrase: "1 minute", lang: lang }));
        } else
        if (h > 0) {
            str = h > 1 ? this.__({ phrase: "%s hours", lang: lang }, h) :
                          this.__({ phrase: "1 hour", lang: lang });
            if (m > 0) str += " " + (m > 1 ? this.__({ phrase: "%s minutes", lang: lang }, m) :
                                             this.__({ phrase: "1 minute", lang: lang }));
        } else
        if (m > 0) {
            str = m > 1 ? this.__({ phrase: "%s minutes", lang: lang }, m) :
                          this.__({ phrase: "1 minute", lang: lang });
            if (s > 0) str += " " + (s > 1 ? this.__({ phrase: "%s seconds", lang: lang }, s) :
                                             this.__({ phrase: "1 second", lang: lang }));
        } else {
            str = seconds > 1 ? this.__({ phrase: "%s seconds", lang: lang }, seconds) :
                                this.__({ phrase: "1 second", lang: lang });
        }
    }
    return str;
}

// Given time in msecs, return how long ago it happened
lib.toAge = function(mtime, options)
{
    var str = "";
    mtime = typeof mtime == "number" ? mtime : this.toNumber(mtime);
    if (mtime > 0) {
        var lang = options && options.lang;
        var secs = Math.max(0, Math.floor((Date.now() - mtime)/1000));
        var d = Math.floor(secs / 86400);
        var mm = Math.floor(d / 30);
        var w = Math.floor(d / 7);
        var h = Math.floor((secs - d * 86400) / 3600);
        var m = Math.floor((secs - d * 86400 - h * 3600) / 60);
        var s = Math.floor(secs - d * 86400 - h * 3600 - m * 60);
        if (mm > 0) {
            str = mm > 1 ? this.__({ phrase: "%s months", lang: lang }, mm) :
                           this.__({ phrase: "1 month", lang: lang });
            if (d > 0) str += " " + (d > 1 ? this.__({ phrase: "%s days", lang: lang }, d) :
                                             this.__({ phrase: "1 day", lang: lang }));
            if (h > 0) str += " " + (h > 1 ? this.__({ phrase: "%s hours", lang: lang }, h) :
                                             this.__({ phrase: "1 hour", lang: lang }));
        } else
        if (w > 0) {
            str = w > 1 ? this.__({ phrase: "%s weeks", lang: lang }, w) :
                          this.__({ phrase: "1 week", lang: lang });
            if (d > 0) str += " " + (d > 1 ? this.__({ phrase: "%s days", lang: lang }, d) :
                                             this.__({ phrase: "1 day", lang: lang }));
            if (h > 0) str += " " + (h > 1 ? this.__({ phrase: "%s hours", lang: lang }, h) :
                                             this.__({ phrase: "1 hour", lang: lang }));
        } else
        if (d > 0) {
            str = d > 1 ? this.__({ phrase: "%s days", lang: lang }, d) :
                          this.__({ phrase: "1 day", lang: lang });
            if (h > 0) str += " " + (h > 1 ? this.__({ phrase: "%s hours", lang: lang }, h) :
                                             this.__({ phrase: "1 hour", lang: lang }));
            if (m > 0) str += " " + (m > 1 ? this.__({ phrase: "%s minutes", lang: lang }, m) :
                                             this.__({ phrase: "1 minute", lang: lang }));
        } else
        if (h > 0) {
            str = h > 1 ? this.__({ phrase: "%s hours", lang: lang }, h) :
                          this.__({ phrase: "1 hour", lang: lang });
            if (m > 0) str += " " + (m > 1 ? this.__({ phrase: "%s minutes", lang: lang }, m) :
                                             this.__({ phrase: "1 minute", lang: lang }));
        } else
        if (m > 0) {
            str = m > 1 ? this.__({ phrase: "%s minutes", lang: lang }, m) :
                          this.__({ phrase: "1 minute", lang: lang });
            if (s > 0) str += " " + (s > 1 ? this.__({ phrase: "%s seconds", lang: lang }, s) :
                                             this.__({ phrase: "1 second", lang: lang }));
        } else {
            str = secs > 1 ? this.__({ phrase: "%s seconds", lang: lang }, secs) :
                             this.__({ phrase: "1 second", lang: lang });
        }
    }
    return str;
}

// Return size human readable format
lib.toSize = function(size)
{
    var i = Math.floor( Math.log(size) / Math.log(1024) );
    return ( size / Math.pow(1024, i) ).toFixed(2) * 1 + ' ' + [this.__('Bytes'), this.__('KBytes'), this.__('MBytes'), this.__('GBytes'), this.__('TBytes')][i];
}

// Process incoming query and convert parameters according to the type definition, the schema contains the definition of the paramaters against which to
// validate incoming data. It is an object with property names and definitoons that at least must specify the type, all other options are type specific.
//
// The options can define the following properties:
//  - null - always return null on any error
//  - data - to pass realtime or other custom options for the validation or convertion utilities as the first argument if not defined in the definition.
//    This is the place to customize/add/override global parameter conditions without changing it.
//  - prefix - prefix to be used when searching for the parameters in the query, only properties with this prefix will be processed. The resulting
//     object will not have this prefix in the properties.
//  - name - to save a value with different name than in the original query
//
// If any of the properties have `required:1` and the value will not be resolved then the function returns a string with the `errmsg` message
// or the default message, this is useful for detection of invalid or missing input data.
//
// Example:
//
//        var account = lib.toParams(req.query, { id: { type: "int" },
//                                                count: { type: "int", min: 1, max: 10, dflt: 5 },
//                                                page: { type: "int", min: 1, max: 10, dflt: NaN, required: 1, errmsg: "Page number between 1 and 10 is required" },
//                                                name: { type: "string", max: 32, trunc: 1 },
//                                                pair: { type: "map", separator: "|" },
//                                                code: { type: "string", regexp: /^[a-z]-[0-9]+$/, errmsg: "Valid code is required" },
//                                                start: { type: "token", required: 1 },
//                                                email1: { type: "email", required: { email: null } },
//                                                data: { type: "json", datatype: "obj" },
//                                                mtime: { type: "mtime", name: "timestamp" },
//                                                flag: { type: "bool", novalue: false },
//                                                descr: { novalue: { name: "name", value: "test" },
//                                                email: { type: "list", datatype: "email", novalue: ["a@a"] } },
//                                                internal: { ignore: 1 },
//                                                tm: { type:" timestamp", optional: 1 },
//                                                status: { value: "ready" },
//                                                mode: "ok",
//                                                state: { values: ["ok","bad","good"] },
//                                                status: { value: [{ name: "state", value: "ok", set: "1" }, { name: "state", value: ["bad","good"], op: "in" }],
//                                                obj: { type: "obj", params: { id: { type: "int" }, name: {} } },
//                                                arr: { type: "array", params: { id: { type: "int" }, name: {} } },
//                                                state: { type: "list", datatype: "string, values: ["VA","DC] } },
//                                                ssn: { type: "string", regexp: /^[0-9]{3}-[0-9]{3}-[0-9]{4}$/, errmsg: "Valid SSN is required" } },
//                                                phone: { type: "list", datatype: "number } },
//                                              { data: { start: { secret: req.account.secret },
//                                                        name: { dflt: "test" },
//                                                        count: { max: 100 },
//                                                        email: { ignore: req.account.type != "admin" },
//                                                        '*': { empty: 1, null: 1 },
//                                              })
//        if (typeof account == "string) return api.sendReply(res, 400, account);
//
lib.toParams = function(query, schema, options)
{
    var rc = {}, opts, dflt, n, v, o;
    for (var name in schema) {
        v = schema[name];
        switch (this.typeName(v)) {
        case "undefined":
            continue;
        case "object":
            if (v.ignore) continue;
            break;
        default:
            v = { value: v };
        }
        opts = {};
        for (var p in v) opts[p] = v[p];
        dflt = options && options.data && (options.data[name] || options.data['*']);
        for (const p in dflt) opts[p] = dflt[p];
        if (opts.ignore) continue;
        n = opts.name || name;
        v = query[((options && options.prefix) || "") + name];
        if (typeof v == "undefined" || (opts.notempty && this.isEmpty(v))) v = opts.dflt;
        if (typeof opts.value != "undefined") {
            var val = opts.value;
            switch (this.typeName(val)) {
            case "object":
                val = [ val ];
            case "array":
                for (var i in val) {
                    var cond = val[i];
                    if (this.isTrue(cond.name ? rc[cond.name] : v, cond.value, cond.op, cond.type || opts.type)) {
                        opts.type = "set";
                        v = cond.set;
                        break;
                    }
                }
                break;
            default:
                opts.type = "set";
                v = val;
            }
        }
        logger.dev("toParams", name, n, typeof v, v, ":", opts);
        switch (opts.type) {
        case "set":
            if (typeof v == "undefined") {
                delete rc[n];
            } else {
                rc[n] = v;
            }
            break;
        case "boolean":
        case "bool":
            if (typeof v != "undefined") rc[n] = this.toBool(v, opts.dflt);
            break;
        case "real":
        case "float":
        case "double":
            opts.float = 1;
        case "int":
        case "long":
        case "number":
        case "bigint":
        case "counter":
        case "clock":
        case "now":
            if (typeof v != "undefined") rc[n] = this.toNumber(v, opts);
            break;
        case "regexp":
            if (typeof v != "undefined") rc[n] = this.toRegexp(v, opts);
            break;
        case "set":
        case "list":
            if (!v && !opts.empty) break;
            v = opts.keepempty ? this.phraseSplit(v, opts) : this[opts.unique ? "strSplitUnique" : "strSplit"](v, opts.separator, opts);
            if (Array.isArray(opts.values)) v = v.filter(function(x) { return opts.values.indexOf(x) > -1 });
            if (Array.isArray(opts.novalue)) v = v.filter(function(x) { return opts.novalue.indexOf(x) == -1 });
            if (typeof opts.min == "number" && v.length < opts.min) {
                v = null;
            } else
            if (opts.max > 0 && v.length > opts.max) {
                if (opts.trunc) v = v.slice(0, opts.max); else v = null;
            }
            if ((!v || !v.length) && !opts.empty) break;
            if (v && opts.flatten) v = this.arrayFlatten(v);
            rc[n] = v || [];
            break;
        case "map":
            if (!v && !opts.empty) break;
            var list = this.strSplit(v, opts.separator, opts);
            if (!list.length && !opts.empty) break;
            if (!rc[n]) rc[n] = {};
            for (let i = 0; i < list.length -1; i += 2) {
                rc[n][list[i]] = list[i+1];
            }
            break;
        case "obj":
            if (!v && !opts.empty) break;
            o = this.toParams(v || lib.empty, opts.params, { null: 1 });
            if (o || opts.empty) rc[n] = o;
            break;
        case "array":
            if (!v && !opts.empty) break;
            o = lib.isArray(v, []).map((x) => (lib.toParams(x, opts.params, { null: 1 }))).filter((x) => (x !== null));
            if (o.length || opts.empty) rc[n] = o;
            break;
        case "token":
            if (v) rc[n] = this.base64ToJson(v, opts.secret);
            break;
        case "mtime":
            if (!v) break;
            v = this.toDate(v, opts.dflt, true);
            if (v) rc[n] = v.getTime();
            break;
        case "date":
        case "time":
            if (v) rc[n] = this.toDate(v, opts.dflt, true);
            break;
        case "datetime":
            if (!opts.optional && (!v || (typeof v == "boolean" && v))) v = Date.now();
            if (v) v = this.toDate(v, opts.dflt);
            if (v) rc[n] = this.strftime(v, opts.format || "%Y/%m/%d %H:%M");
            break;
        case "timestamp":
            if (!opts.optional && (!v || (typeof v == "boolean" && v))) v = Date.now();
            if (v) v = this.toDate(v, opts.dflt, true);
            if (v) rc[n] = opts.format ? this.strftime(v, opts.format) : v.toISOString();
            break;
        case "json":
            v = this.jsonParse(v, opts);
            if (v || opts.empty) rc[n] = v;
            break;
        case "email":
        case "phone":
            if (v) {
                if (typeof v == "string") v = v.trim();
                v = this.toValue(v.trim(), opts.type, opts);
            }
            if (v || opts.empty) rc[n] = v || "";
            break;
        case "url":
            if (v) {
                if (typeof v == "string") v = v.trim();
                if (!this.rxUrl.test(v)) v = null;
            }
            if (v || opts.empty) rc[n] = v || "";
            break;
        case "string":
        case "text":
        default:
            if (typeof v == "undefined" || v === null) break;
            v = String(v);
            if (opts.strip) v = v.replace(o.strip, "");
            if (opts.trim) v = v.trim();
            if (opts.upper) v = v.toUpperCase();
            if (opts.lower) v = v.toLowerCase();
            if (opts.camel) v = lib.toCamel(v, opts.camel);
            if (opts.cap) v = lib.toTitle(v);
            if (opts.max && v.length > opts.max) {
                if (!opts.trunc) {
                    return options && options.null ? null : opts.errmsg || this.__("%s is too long, the max is %s", name, opts.max);
                }
                v = v.substr(0, opts.max);
            }
            if (opts.min && v.length < opts.min) {
                return options && options.null ? null : opts.errmsg || this.__("%s is too short, the min is %s", name, opts.min);
            }
            if (util.isRegExp(opts.regexp) && !opts.regexp.test(v)) {
                if (!opts.required && opts.errmsg) return options && options.null ? null : opts.errmsg;
                break;
            }
            if (!v && !opts.empty) break;
            rc[n] = v;
            break;
        }
        v = rc[n];
        if (!this.isEmpty(v) && opts.type != "list") {
            if (Array.isArray(opts.values) && opts.values.indexOf(v) == -1) {
                delete rc[n];
            } else
            // Delete if equal to a special value(s)
            if (Array.isArray(opts.novalue)) {
                if (opts.novalue.length && opts.novalue.indexOf(v) > -1) delete rc[n];
            } else
            if (typeof opts.novalue == "object") {
                if (v === rc[opts.novalue.name] || v === opts.novalue.value) delete rc[n];
            } else
            if (v === opts.novalue) delete rc[n];
        }
        // Return an error message
        if (opts.required && this.isEmpty(rc[n])) {
            if (!lib.isObject(opts.required) || this.isMatched(query, opts.required)) {
                return options && options.null ? null : opts.errmsg || this.__("%s is required", name);
            }
        }
    }
    // Append remaining properties that match the criteria
    if (options && util.isRegExp(options.match)) {
        for (const p in query) {
            v = query[p];
            if (!schema[p] && options.match.test(p)) {
                if (lib.isEmpty(v) && !options.match_empty) continue;
                rc[p] = v;
            }
        }
    }
    return rc;
}

// Convert a list of records into the specified format, supported formats are: `xml, csv, json`.
// - For `csv` the default separator is comma but can be specified with `options.separator`. To produce columns header specify `options.header`.
// - For `json` format puts each record as a separate JSON object on each line, so to read it back
//   it will require to read every line and parse it and add to the list.
// - For `xml` format the name of the row tag is `<row>` but can be
//   specified with `options.tag`.
//
// All formats support the property `options.allow` which is a list of property names that are allowed only in the output for each record, non-existent
// properties will be replaced by empty strings.
//
// The `mapping` object property can redefine different tag/header names to be put into the file instead of the exact column names from the records.
lib.toFormat = function(format, data, options)
{
    var rows = Array.isArray(data) ? data : Array.isArray(data.data) ? data.data : this.isObject(data) ? [ data ] : [];
    if (!rows.length) return "";
    var allow = options && Array.isArray(options.allow) ? options.allow : null;
    var map = options && options.mapping || this.empty, v;

    switch (format) {
    case "xml":
        var xml = "";
        var tag = ((options && options.tag) || "row");
        for (var i = 0; i < rows.length; i++) {
            xml += "<" + tag + ">\n";
            xml += (allow || Object.keys(rows[i])).map(function(y) {
                v = rows[i][y];
                v = Array.isArray(v) ? v.join(",") : typeof v == "object" ? lib.stringify(v) : String(v || "");
                var t = map[y] || y;
                return "<" + t + ">" + lib.textToXml(v) + "</" + t + ">\n";
            });
            xml += "</" + tag + ">\n";
        }
        return xml;

    case "csv":
        var csv = "", keys, quotesRx;
        var sep = (options && options.separator) || ",";
        var quotes = (options && options.quotes) || '"';
        var controls = (options && options.controls) || " ";

        if (options && options.header) {
            keys = allow || Object.keys(rows[0]);
            csv += keys.map(function(x) { return map[x] || x }).join(sep) + "\r\n";
            options.header = 0;
        }
        for (let i = 0; i < rows.length; i++) {
            keys = allow || Object.keys(rows[i]);
            csv += keys.map(function(y) {
                v = rows[i][y];
                v = Array.isArray(v) ? v.join(",") : typeof v == "object" ? lib.stringify(v) : String(v || "");
                if (v) {
                    v = v.replace(/[\r\n\t]/g, controls);
                    if (v.indexOf(sep) > -1 || v.indexOf(quotes) > -1) {
                        if (!quotesRx) quotesRx = new RegExp(quotes, "g");
                        v = quotes + v.replace(quotesRx, quotes + quotes) + quotes;
                    }
                }
                return v;
            }).join(sep) + "\r\n";
        }
        return csv;

    default:
        var json = "";
        for (let i = 0; i < rows.length; i++) {
            json += lib.stringify(allow ? allow.reduce(function(x,y) { if (!lib.isEmpty(rows[i][y])) x[map[y] || y] = rows[i][y]; return x }, {}) : rows[i]) + "\n";
        }
        return json;
    }
}

// Given a template with @..@ placeholders, replace each placeholder with the value from the obj.
// The `obj` can be an object or an array of objects in which case all objects will be checked for the value until non empty.
//
// To use @ in the template specify it as @@
//
// The options if given may provide the following:
// - allow - placeholders with a name present in this list will be replaced, all other will be replaced with empty string
// - skip - placeholders with a name present in this list will be ignored, the placeholer will be kept
// - only - placeholders with a name present in this list will be replaced only, all other will be ignored and kept as placeholders
// - encoding - can be url or base64, the replaced values will be encoded accordingly
// - separator1 - left side of the placehoder, default is @
// - separator2 - right side of the placeholder, default is @
//
// Example:
//
//        lib.toTemplate("http://www.site.com/@code@/@id@", { id: 123, code: "YYY" }, { encoding: "url" })
//        lib.toTemplate("Hello @name|friend@!", {})
//
//
lib.toTemplate = function(text, obj, options)
{
    if (typeof text != "string" || !text) return "";
    var rc = [];
    if (!options) options = {};
    if (!Array.isArray(obj)) obj = [obj];
    for (var i = 0; i < obj.length; i++) {
        if (typeof obj[i] == "object" && obj[i]) rc.push(obj[i]);
    }
    var tmpl = "", str = text, sep1 = options.separator1 || "@", sep2 = options.separator2 || sep1;
    while (str) {
        var start = str.indexOf(sep1);
        if (start == -1) {
            tmpl += str;
            break;
        }
        var end = str.indexOf(sep2, start + sep1.length);
        if (end == -1) {
            tmpl += str;
            break;
        }
        var tag = str.substr(start + sep1.length, end - start - sep2.length);
        tmpl += str.substr(0, start);
        str = str.substr(end + sep2.length);
        var d, v = null, dflt = null;
        if (tag == "") {
            v = sep1;
        } else
        if (tag == "exit") {
            options.exit = 1;
        } else
        if (tag == "RAND") {
            v = Math.random();
        } else
        if (/^if/.test(tag)) {
            // @if type tester,admin@
            // @endif@
            end = str.indexOf(sep1 + "endif" + sep2);
            if (end == -1) continue;
            var body = str.substr(0, end);
            str = str.substr(end + sep1.length + sep2.length);
            d = tag.match(/^(if|ifeq|ifgt|ifge|iflt|ifle|ifnot|ifall|ifstr) ([a-zA-Z0-9]+) +(.+)$/)
            if (!d) continue;
            var ok, val = null;
            for (let i = 0; i < rc.length && !val; i++) val = typeof rc[i][d[2]] == "function" ? rc[i][d[2]]() : rc[i][d[2]];
            switch (d[1]) {
            case "if":
                ok = val && lib.isFlag(lib.strSplit(d[3]), lib.strSplit(val));
                break;
            case "ifnot":
                ok = !val || !lib.isFlag(lib.strSplit(d[3]), lib.strSplit(val));
                break;
            case "ifall":
                val = lib.strSplit(val);
                ok = lib.strSplit(d[3]).every(function(x) { return val.indexOf(x) > -1 });
                break;
            case "ifstr":
                ok = val && String(val).match(new RegExp(d[3], "i"));
                break;
            case "ifeq":
                ok = val == d[3];
                break;
            case "ifgt":
                ok = val > d[3];
                break;
            case "iflt":
                ok = val < d[3];
                break;
            case "ifge":
                ok = val >= d[3];
                break;
            case "ifle":
                ok = val <= d[3];
                break;
            }
            if (ok) {
                v = this.toTemplate(body, rc, options);
                tag = d[2];
            }
        } else {
            d = tag.match(/^([a-zA-Z0-9_]+)(\|.+)?$/);
            if (d) {
                tag = d[1];
                if (d[2]) dflt = d[2].substr(1);
                for (let i = 0; i < rc.length && !v; i++) v = typeof rc[i][tag] == "function" ? rc[i][tag]() : rc[i][tag];
                if (typeof options.preprocess == "function") v = options.preprocess(tag, v, dflt);
            } else {
                tmpl += sep1 + tag + sep2;
            }
        }
        if (!v) v = dflt;
        if (v) {
            switch (options.encoding) {
            case "url":
                v = this.encodeURIComponent(v);
                break;
            case "base64":
                v = Buffer.from(v).toString("base64");
                break;
            }
        }
        if (Array.isArray(options.allow) && options.allow.indexOf(tag) == -1) continue;
        if (Array.isArray(options.skip) && options.skip.indexOf(tag) > -1) continue;
        if (Array.isArray(options.only) && options.only.indexOf(tag) == -1) continue;
        if (v !== null && v !== undefined) tmpl += v;
        if (options.exit) break;
    }
    if (options.noline) tmpl = tmpl.replace(/[\r\n]/g, "");
    if (options.nospace) tmpl = tmpl.replace(/ {2,}/g, " ").trim();
    return tmpl;
}

lib.isUnicode = function(str)
{
    return /[\u007F-\uFFFF]/g.test(str);
}

// Convert all Unicode binary symbols into Javascript text representation
lib.escapeUnicode = function(text)
{
    return String(text).replace(/[\u007F-\uFFFF]/g, function(m) {
        return "\\u" + ("0000" + m.charCodeAt(0).toString(16)).substr(-4)
    });
}

// Convert escaped characters into native symbols
lib.unescape = function(str)
{
    return String(str).replace(/\\(.)/g, function(_, c) {
        switch (c) {
        case '"': return '"';
        case "'": return "'";
        case "f": return "\f";
        case "b": return "\b";
        case "\\": return "\\";
        case "n": return "\n";
        case "r": return "\r";
        case "t": return "\t";
        default: return c;
        }
    });
}

// Convert all special symbols into xml entities
lib.textToXml = function(str)
{
    return String(str || "").replace(/([&<>'":])/g, function(_, n) {
      switch (n) {
      case '&': return '&amp;'
      case '<': return '&lt;'
      case '>': return '&gt;'
      case '"': return '&quot;'
      case "'": return '&apos;'
      default: return n;
      }
    });
}

// Convert all special symbols into html entities
lib.textToEntity = function(str)
{
    if (typeof str != "string") return "";
    if (!this.textEntities) {
        this.textEntities = {};
        for (var p in this.htmlEntities) this.textEntities[this.htmlEntities[p]] = "&" + p + ";";
    }
    return str.replace(/([&<>'":])/g, function(_, n) {
        return lib.textEntities[n] || n;
    });
}

// Convert html entities into their original symbols
lib.entityToText = function(str)
{
    if (typeof str != "string") return "";
    return str.replace(/&(#?[a-zA-Z0-9]+);/g, function(_, n) {
        if (n[0] === '#') return n.charAt(1) === 'x' ? String.fromCharCode(parseInt(n.substring(2), 16)) : String.fromCharCode(+n.substring(1));
        return lib.htmlEntities[n.toLowerCase()] || "";
    });
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
        return Object.keys(val).length == 0;
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

// Evaluate expr, compare 2 values with optional type and operation
lib.isTrue = function(val1, val2, op, type)
{
    if (typeof val1 == "undefined" && typeof val2 == "undefined") return true;
    if (val1 === null && val2 === null) return true;

    op = op && op.toLowerCase() || "";
    var no = false, yes = true, v1, list2;
    if (op[0] == "n" && op[1] == "o" && op[2] == "t") no = true, yes = false;

    switch (op) {
    case "null":
    case "not null":
    case "not_null":
        if (val1) return yes;
        break;

    case ">":
    case "gt":
        if (this.toValue(val1, type) <= this.toValue(val2, type)) return no;
        break;

    case "<":
    case "lt":
        if (this.toValue(val1, type) >= this.toValue(val2, type)) return no;
        break;

    case ">=":
    case "ge":
        if (this.toValue(val1, type) < this.toValue(val2, type)) return no;
        break;

    case "<=":
    case "le":
        if (this.toValue(val1, type) > this.toValue(val2, type)) return no;
        break;

    case "between":
        // If we cannot parse out 2 values, treat this as exact operator
        list2 = this.strSplit(val2);
        if (list2.length > 1) {
            if (this.toValue(val1, type) < this.toValue(list2[0], type) || this.toValue(val1, type) > this.toValue(list2[1], type)) return no;
        } else {
            if (this.toValue(val1, type) != this.toValue(val2, type)) return no;
        }
        break;

    case "in":
    case "not in":
    case "not_in":
        if (this.strSplit(val2).indexOf(this.toValue(val1)) == -1) return no;
        break;

    case 'like%':
    case "not like%":
    case 'begins_with':
    case 'not begins_with':
        v1 = this.toValue(val1);
        if (this.toValue(val2).substr(0, v1.length) != v1) return no;
        break;

    case "ilike%":
    case "not ilike%":
        v1 = this.toValue(val1).toLowerCase();
        if (this.toValue(val2).substr(0, v1.length).toLowerCase() != v1) return no;
        break;

    case "ilike":
    case "not ilike":
        if (this.toValue(val1).toLowerCase() != this.toValue(val2).toLowerCase()) return no;
        break;

    case "!~":
    case "!~*":
    case "iregexp":
    case "not iregexp":
        if (!util.isRegExp(val2)) val2 = new RegExp(val2, "i");
        if (!val2.test(this.toValue(val1))) return no;
        break;

    case "~":
    case "~*":
    case "regexp":
    case "not regexp":
        if (!util.isRegExp(val2)) val2 = new RegExp(val2);
        if (!val2.test(this.toValue(val1))) return no;
        break;

    case "contains":
    case "not contains":
    case "not_contains":
        if (!this.toValue(val2).indexOf(this.toValue(val1)) > -1) return no;
        break;

    case "!=":
    case "<>":
    case "ne":
        if (this.toValue(val1, type) == this.toValue(val2, type)) return no;
        break;

    default:
        if (type == "list") {
            list2 = this.strSplit(val2);
            if (!this.strSplit(val1).every(function(x) { return list2.indexOf(x) > -1 })) return no;
        } else
        if (this.toValue(val1, type) != this.toValue(val2, type)) return no;
    }
    return yes;
}

// All properties in the object `obj` must match all properties in the object `condition`,
// each value in `condition` is treated as RegExp,
// if the value is equal to 'null' which means an empty or non-existed value,
// if the value begins with ! it means no match is expected, the leading ! will be stripped.
//
// if `condition` is an array then returns true if any matched
//
// empty condition returns true
//
// Example:
//
//        lib.isMatched({id:1,name:2,notifications0:1,type:"user,admin"}, {notifications0:0})
//        lib.isMatched({id:1,name:2,notifications0:1,type:"user,admin"}, {notifications0:1,type:"!admin"})
lib.isMatched = function(obj, condition)
{
    if (Array.isArray(condition)) {
        for (var i in condition) if (this.isMatched(obj, condition[i])) return true;
        return false;
    }
    for (var p in condition) {
        if (typeof condition[p] == "undefined") continue;
        var rx = condition[p], not = 0, ok;
        if (typeof rx == "string" && rx[0] == "!") not = 1, rx = rx.substr(1);
        var v = lib.toValue(obj && obj[p]);
        if (rx === null) {
            ok = v === "";
        } else {
            if (!util.isRegExp(rx)) rx = condition[p] = new RegExp(rx);
            ok = rx.test(v);
        }
        if (!ok) {
            if (!not) return false;
        } else {
            if (not) return false;
        }
    }
    return true;
}

// Returns true if `name` exists in the array `list`, search is case sensitive. if `name` is an array it will return true if
// any element in the array exists in the `list`.
lib.isFlag = function(list, name)
{
    return Array.isArray(list) && (Array.isArray(name) ? name.some(function(x) { return list.indexOf(x) > -1 }) : list.indexOf(name) > -1);
}

// Flags command utility, update flags array and returns a new array, the commands are:
// - add - adds the `name` flags if does not exists
// - del - removes the flags `name`
// - present - returns only flags that present in the list `name`
// - absent - returns only flags that are not present in the list `name`
lib.toFlags = function(cmd, list, name)
{
    switch (cmd) {
    case "add":
        if (!Array.isArray(list)) list = [];
        if (!Array.isArray(name)) {
            if (name && list.indexOf(name) == -1) list.push(name);
        } else {
            name.forEach(function(x) { if (list.indexOf(x) == -1) list.push(x) });
        }
        break;

    case "del":
        if (!Array.isArray(list)) return [];
        list = list.filter(function(x) { return Array.isArray(name) ? name.indexOf(x) == -1 : x != name });
        break;

    case "present":
        if (!Array.isArray(list)) return [];
        if (!Array.isArray(name)) return list;
        list = list.filter(function(x) { return name.indexOf(x) > -1 });
        break;

    case "absent":
        if (!Array.isArray(list)) return [];
        if (!Array.isArray(name)) return list;
        list = list.filter(function(x) { return name.indexOf(x) == -1 });
        break;
    }
    return list;
}

// Call callback for each line in the file
// options may specify the following parameters:
// - sync - read file synchronously and call callback for every line
// - abort - signal to stop processing
// - limit - number of lines to process and exit
// - length - amount of data in bytes to process and exit
// - count - return this number of lines in an array if greater than 0
// - skip - number of lines to skip from the start
// - progress - if > 0 report how many lines processed so far every specified lines
// - until - skip lines until this regexp matches
// - ignore - skip lines that match this regexp
// - header - if true then skip first line because it is the a header, if `options.header` it is a function
//   it will be called with the first line as an argument and must return true if this line needs to be skipped
// - json - each line represents an JSON object, convert and pass it to the line callback if not null
// - split - split every line before calling the callback, it uses phraseSplit
// - keepempty - by default is enabled if split is set to keep empty fields in the line array
// - separator - a string with characters to be used for splitting, default is `,`
// - quotes - a string with characters to be used for phrase splitting, default is `"'`
//
// Properties updated and returned in the options:
// - nlines - number of lines read from the file
// - ncalls - number of lines passed to the line callback
//
lib.forEachLine = function(file, options, lineCallback, endCallback)
{
    if (!options) options = {};
    var batch = options.count > 0 ? [] : null;
    var buffer = Buffer.alloc(4096);
    var data = '';
    options.nlines = options.ncalls = options.nbytes = 0;
    if (options.split) {
        options.keepempty = true;
        if (!options.separator) options.separator = ",";
    }

    function readData(fd, pos, finish) {
        fs.read(fd, buffer, 0, buffer.length, pos, function(err, nread) {
            data += buffer.slice(0, nread).toString(options.encoding || 'utf8');
            var lines = data.split(/[\n]/), n = 0;
            // Only if not the last part
            if (nread == buffer.length) data = lines.pop();
            lib.forEachSeries(lines, function(line, next) {
                function doNext(err) {
                    if (n > 100) n = 0;
                    return n ? next(err) : setImmediate(next, err);
                }
                n++;
                options.nlines++;
                if (options.nlines == 1 && options.header) {
                    if (typeof options.header != "function") return doNext();
                    if (options.header(line)) return doNext();
                }
                if (options.length && options.nbytes >= options.length) return doNext();
                if (options.limit && options.nlines >= options.limit) return doNext();
                if (options.skip && options.nlines < options.skip) return doNext();
                if (options.progress && options.nlines % options.progress == 0) logger.info('forEachLine:', file, options);
                line = line.trim();
                if (!line) return doNext();
                // Skip lines until we see our pattern
                if (options.until && !options.until_seen) {
                    options.until_seen = line.match(options.until);
                    return doNext();
                }
                if (options.ignore && options.ignore.test(line)) return doNext();
                if (options.json) {
                    if (line[0] != '{' && line[0] != '[') return doNext();
                    const obj = lib.jsonParse(line, options);
                    if (!obj) return doNext();
                    options.ncalls++;
                    options.nbytes += line.length;
                    if (batch) batch.push(obj); else return lineCallback(obj, doNext);
                } else
                if (options.split) {
                    const obj = lib.phraseSplit(line.trim(), options);
                    if (!obj.length) return doNext();
                    options.ncalls++;
                    options.nbytes += line.length;
                    if (batch) batch.push(obj); else return lineCallback(obj, doNext);
                } else {
                    options.ncalls++;
                    options.nbytes += line.length;
                    if (batch) batch.push(line); else return lineCallback(line, doNext);
                }
                if (!batch || batch.length < options.count) return doNext();
                lineCallback(batch, function(err) {
                    batch = [];
                    doNext(err);
                });
            }, function(err) {
                // Stop on reaching limit or end of file
                if (options.abort || err ||
                    (options.length && options.nbytes >= options.length) ||
                    (options.limit && options.nlines >= options.limit) ||
                    nread < buffer.length) {
                    if (err || !batch || !batch.length) return finish(err);
                    return lineCallback(batch, function(err) { finish(err) });
                }
                readData(fd, null, finish);
            });
        });
    }

    fs.open(file, 'r', function(err, fd) {
        if (err) {
            logger.error('forEachLine:', file, err);
            return (endCallback ? endCallback(err, options) : null);
        }
        // Synchronous version, read every line and call callback which may not do any async operations
        // because they will not be executed right away but only after all lines processed
        if (options.sync) {
            while (!options.abort) {
                var nread = fs.readSync(fd, buffer, 0, buffer.length, options.nlines == 0 ? options.start : null);
                data += buffer.slice(0, nread).toString(options.encoding || 'utf8');
                var lines = data.split(/[\n]/);
                if (nread == buffer.length) data = lines.pop();
                for (var i = 0; i < lines.length; i++) {
                    options.nlines++;
                    if (!options.nlines == 1 && options.header) {
                        if (typeof options.header != "function") continue;
                        if (options.header(lines[i])) continue;
                    }
                    if (options.length && options.nbytes >= options.length) continue;
                    if (options.limit && options.nlines >= options.limit) continue;
                    if (options.skip && options.nlines < options.skip) continue;
                    if (options.progress && options.nlines % options.progress == 0) logger.info('forEachLine:', file, options);
                    // Skip lines until we see our pattern
                    if (options.until && !options.until_seen) {
                        options.until_seen = lines[i].match(options.until);
                        continue;
                    }
                    if (options.ignore && options.ignore.test(lines[i])) continue;
                    if (options.json) {
                        const obj = lib.jsonParse(lines[i], options);
                        if (!obj) continue;
                        options.ncalls++;
                        options.nbytes += lines[i].length;
                        if (batch) batch.push(obj); else lineCallback(obj);
                    } else
                    if (options.split) {
                        const line = lib.phraseSplit(lines[i].trim(), options);
                        if (!line.length) continue;
                        options.ncalls++;
                        options.nbytes += lines[i].length;
                        if (batch) batch.push(line); else lineCallback(line);
                    } else {
                        const line = lines[i].trim();
                        if (!line) continue;
                        options.ncalls++;
                        options.nbytes += lines[i].length;
                        if (batch) batch.push(line); else lineCallback(line);
                    }
                }
                // Stop on reaching limit or end of file
                if (nread < buffer.length) break;
                if (options.length && options.nbytes >= options.length) break;
                if (options.limit && options.nlines >= options.limit) break;
                if (!batch || batch.length < options.count) continue;
                lineCallback(batch);
                batch = [];
            }
            if (batch && batch.length) lineCallback(batch);
            fs.close(fd, function() {});
            return (endCallback ? endCallback(null, options) : null);
        }

        // Start reading data from the optional position or from the beginning
        setImmediate(() => {
            readData(fd, options.start, function(err) {
                fs.close(fd, function() {});
                return (endCallback ? endCallback(err, options) : null);
            });
        });
    });
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
    callback = typeof callback == "function" ? callback : this.noop;
    if (!Array.isArray(list) || !list.length) return callback();
    var count = list.length;
    for (var i = 0; i < list.length; i++) {
        iterator(list[i], function(err) {
            if (err) {
                setImmediate(callback, err);
                callback = lib.noop;
                i = list.length + 1;
            } else
            if (--count == 0) {
                setImmediate(callback);
                callback = lib.noop;
            }
        });
    }
}

// Same as `forEach` except that the iterator will be called for every item in the list, all errors will be ignored
lib.forEvery = function(list, iterator, callback)
{
    callback = typeof callback == "function" ? callback : this.noop;
    if (!Array.isArray(list) || !list.length) return callback();
    var count = list.length;
    for (var i = 0; i < list.length; i++) {
        iterator(list[i], function(err) {
            if (--count == 0) {
                setImmediate(callback);
                callback = lib.noop;
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
//
lib.forEachSeries = function(list, iterator, callback)
{
    callback = typeof callback == "function" ? callback : this.noop;
    if (!Array.isArray(list) || !list.length) return callback();
    function iterate(i, data) {
        if (i >= list.length) return setImmediate(callback, null, data);
        iterator(list[i], function(err, data) {
            if (err) {
                setImmediate(callback, err, data);
                callback = lib.noop;
            } else {
                iterate(++i, data);
            }
        }, data);
    }
    iterate(0);
}

// Same as `forEachSeries` except that the iterator will be called for every item in the list, all errors will be passed to the next
// item with optional additional data argument.
//
//          lib.forEverySeries([ 1, 2, 3 ], function (i, next, err, data) {
//            console.log(i, err, data);
//            next(err, i, data);
//          }, function (err, data) {
//            console.log('done', err, data);
//          });
//
lib.forEverySeries = function(list, iterator, callback)
{
    callback = typeof callback == "function" ? callback : this.noop;
    if (!Array.isArray(list) || !list.length) return callback();
    function iterate(i, err, data) {
        if (i >= list.length) return setImmediate(callback, err, data);
        iterator(list[i], function(err2, data2) {
            iterate(++i, err2, data2);
        }, err, data);
    }
    iterate(0);
}

// Apply an iterator function to each item in an array in parallel as many as specified in `limit` at a time. Execute a callback when all items
// have been completed or immediately if there is is an error provided.
lib.forEachLimit = function(list, limit, iterator, callback)
{
    callback = typeof callback == "function" ? callback : this.noop;
    if (!Array.isArray(list) || !list.length || typeof iterator != "function") return callback();
    limit = lib.toNumber(limit, { min: 1, float: 0 });
    var idx = 0, done = 0, running = 0;
    function iterate() {
        if (done >= list.length) return setImmediate(callback);
        while (running < limit && idx < list.length) {
            running++;
            iterator(list[idx++], function(err) {
                running--;
                if (err) {
                    setImmediate(callback, err);
                    callback = lib.noop;
                    idx = done = list.length + 1;
                } else {
                    if (++done >= list.length) {
                        setImmediate(callback);
                        callback = lib.noop;
                    } else {
                        iterate();
                    }
                }
            });
        }
    }
    iterate();
}

// Same as `forEachLimit` but does not stop on error, all items will be processed and errors will be collected in an array and
// passed to the final callback
lib.forEveryLimit = function(list, limit, iterator, callback)
{
    callback = typeof callback == "function" ? callback : this.noop;
    if (!Array.isArray(list) || !list.length || typeof iterator != "function") return callback();
    limit = lib.toNumber(limit, { min: 1 });
    var idx = 0, done = 0, running = 0, errors;
    function iterate() {
        if (done >= list.length) return setImmediate(callback, errors);
        while (running < limit && idx < list.length) {
            running++;
            iterator(list[idx++], (err) => {
                running--;
                if (err) errors = lib.isArray(errors, []).concat(err);
                if (++done >= list.length) {
                    setImmediate(callback, errors);
                    callback = lib.noop;
                } else {
                    iterate();
                }
            });
        }
    }
    iterate();
}

// Apply an iterator function to each item returned by the `next(item, cb)` function until it returns `null` or the iterator returns an error in the callback,
// the final callback will be called after all iterators are finished.
//
// If no item is available the `next()` should return empty value, it will be called again in `options.interval` ms if specified or
// immediately in the next tick cycle.
//
// The max number of iterators to run at the same time is controlled by `options.max`, default is 1.
//
// The maximum time waiting for items can be specified by `options.timeout`, it is not an error condition, just another way to stop
// processing if it takes too long because the `next()` function is a black box just returning items to process. Timeout will send null
// to the queue and it will stop after all iterators are finished.
//
//
//        var list = [1, 2, "", "", 3, "", 4, "", "", "", null];
//        lib.forEachItem({ max: 2, interval: 1000, timeout: 30000 },
//            function(next) {
//                next(list.shift());
//            },
//            function(item, next) {
//                console.log("item:", item);
//                next();
//            },
//            (err) => {
//                console.log("done", err);
//            });


lib.forEachItem = function(options, next, iterator, callback)
{
    callback = typeof callback == "function" ? callback : this.noop;
    if (!options || typeof next != "function" || typeof iterator != "function") return callback();

    function end() {
        clearTimeout(options.timer);
        delete options.timer;
        options.etime = Date.now();
        setImmediate(callback, options.error);
        callback = lib.noop;
    }
    function iterate() {
        if (!next) return;
        next((item) => {
            if (!next) return;
            if (!item && options.timeout > 0 && Date.now() - options.mtime > options.timeout) item = null;
            // End of queue
            if (item === null) {
                next = null;
                logger.dev("forEachItem:", "null:", next ? "next" : "", options.timer ? "timer" : "", options);
                if (!options.running) end();
                return;
            }
            // No item available, need to wait
            if (!item) {
                if (!options.timer) options.timer = setTimeout(() => {
                    delete options.timer;
                    logger.dev("forEachItem:", "timer:", next ? "next" : "", options.timer ? "timer" : "", options);
                    if (!next && !options.running) return end();
                    for (var i = options.running; i < options.max; i++) iterate();
                }, options.interval);
                return;
            }
            options.count++;
            options.running++;
            options.mtime = Date.now();
            iterator(item, (err) => {
                options.running--;
                if (err) next = null, options.error = err;
                logger.dev("forEachItem:", "after:", next ? "next" : "", options.timer ? "timer" : "", options);
                if (!next && !options.running) return end();
                for (var i = options.running; i < options.max; i++) iterate();
            });
        });
    }

    options.running = options.count = 0;
    options.stime = options.mtime = Date.now();
    options.timeout = lib.toNumber(options.timeout);
    options.interval = lib.toNumber(options.interval);
    options.max = lib.toNumber(options.max, { min: 1 });
    for (var i = 0; i < options.max; i++) iterate();
}

// Execute a list of functions in parallel and execute a callback upon completion or occurance of an error. Each function will be passed
// a callback to signal completion. The callback accepts an error for the first argument. The iterator and callback will be
// called via setImmediate function to allow the main loop to process I/O.
lib.parallel = function(tasks, callback)
{
    this.forEach(tasks, function itEach(task, next) {
        task(function itNext(err) {
            setImmediate(next.bind(null, err));
        });
    }, function(err) {
        if (typeof callback == "function") setImmediate(callback, err);
    });
}

// Same as `lib.parallel` but all functions will be called and any error will be ignored
lib.everyParallel = function(tasks, callback)
{
    this.forEvery(tasks, function itEach(task, next) {
        task(function itNext() {
            setImmediate(next.bind(null));
        });
    }, function() {
        if (typeof callback == "function") setImmediate(callback);
    });
}

// Execute a list of functions serially and execute a callback upon completion or occurance of an error. Each function will be passed
// a callback to signal completion. The callback accepts either an error for the first argument in which case the flow will be aborted
// and the final callback will be called immediately or some optional data to be passed to thr next iterator function as a second argument.
//
// The iterator and callback will be
// called via setImmediate function to allow the main loop to process I/O.
//
//          lib.series([
//             function(next) {
//                setTimeout(function () { next(null, "data"); }, 100);
//             },
//             function(next, data) {
//                setTimeout(function () { next(); }, 100);
//             },
//          ], function(err) {
//              console.log(err);
//          });
lib.series = function(tasks, callback)
{
    this.forEachSeries(tasks, function itSeries(task, next, data1) {
        task(function itNext(err2, data2) {
            setImmediate(next.bind(null, err2, data2));
        }, data1);
    }, function(err, data) {
        if (typeof callback == "function") setImmediate(callback, err, data);
    });
}

// Same as `lib.series` but all functions will be called with errors passed to the next task, only the last passed error will be returned
//
//          lib.everySeries([
//             function(next, err) {
//                setTimeout(function () { next("error1", "data1"); }, 100);
//             },
//             function(next, err, data) {
//                setTimeout(function () { next(err, "data2"); }, 100);
//             },
//          ], function(err, data) {
//              console.log(err, data);
//          });

lib.everySeries = function(tasks, callback)
{
    this.forEverySeries(tasks, function itSeries(task, next, err1, data1) {
        task(function itNext(err2, data2) {
            setImmediate(next.bind(null, err2, data2));
        }, err1, data1);
    }, function(err, data) {
        if (typeof callback == "function") setImmediate(callback, err, data);
    });
}

// While the test function returns true keep running the iterator, call the callback at the end if specified. All functions are called via setImmediate.
//
//          var count = 0;
//          lib.whilst(
//              function() {
//                return count < 5;
//              },
//              function (next) {
//                count++;
//                setTimeout(next, 1000);
//              },
//              function (err, data) {
//                console.log(err, data, count);
//              });
lib.whilst = function(test, iterator, callback, data)
{
    callback = typeof callback == "function" ? callback : this.noop;
    if (!test(data)) return callback(null, data);
    iterator(function itWhilst(err, data2) {
        if (err) return callback(err, data2);
        setImmediate(lib.whilst.bind(lib, test, iterator, callback, data2));
    }, data);
};

// Keep running iterator while the test function returns true, call the callback at the end if specified. All functions are called via setImmediate.
lib.doWhilst = function(iterator, test, callback, data)
{
    callback = typeof callback == "function" ? callback : this.noop;
    iterator(function itDoWhilst(err, data2) {
        if (err) return callback(err, data2);
        if (!test(data2)) return callback(err, data2);
        setImmediate(lib.doWhilst.bind(lib, iterator, test, callback, data2));
    }, data);
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
    try { item.callback(msg); } catch(e) { logger.error('onDeferCallback:', e, msg, e.stack); }
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
        try { process.setgid(gid); } catch(e) { logger.error('setgid:', gid, e); }
        try { process.setuid(uid); } catch(e) { logger.error('setuid:', uid, e); }
    }
}

// Encrypt data with the given key code
lib.encrypt = function(key, data, algorithm, encode)
{
    if (!key || !data) return '';
    try {
        key = Buffer.isBuffer(key) ? key : String(key);
        data = Buffer.isBuffer(data) ? data : String(data);
        encode = encode === "binary" ? undefined : encode || "base64";
        var encrypt = crypto.createCipher(algorithm || 'aes192', key);
        var b64 = encrypt.update(data, 'utf8', encode);
        b64 += encrypt.final(encode);
    } catch(e) {
        b64 = '';
        logger.debug('encrypt:', algorithm, encode, e.stack, data);
    }
    return b64;
}

// Decrypt data with the given key code
lib.decrypt = function(key, data, algorithm, encode)
{
    if (!key || !data) return '';
    try {
        key = Buffer.isBuffer(key) ? key : String(key);
        data = Buffer.isBuffer(data) ? data : String(data);
        encode = encode === "binary" ? undefined : encode || "base64";
        var decrypt = crypto.createDecipher(algorithm || 'aes192', key);
        var msg = decrypt.update(data, encode, 'utf8');
        msg += decrypt.final('utf8');
    } catch(e) {
        msg = '';
        logger.debug('decrypt:', algorithm, encode, e.stack, data);
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
    const mask = ~(2 ** (32 - bits) - 1);
    return (this.ip2int(ip) & mask) === (this.ip2int(range) & mask);
};

// Return first and last IP addresses for the CIDR block
lib.cidrRange = function(cidr)
{
    const [range, bits = 32] = cidr.split('/');
    const mask = ~(2 ** (32 - bits) - 1);
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
    } catch(e) {
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
    } catch(e) {
        logger.error('hash:', algorithm, encode, e.stack);
        return "";
    }
}

// Return unique Id without any special characters and in lower case
lib.uuid = function(prefix, options)
{
    var u = uuid.v4(options);
    return typeof u == "string" ? (prefix || "") + u.replace(/[-]/g, '').toLowerCase() : u;
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

lib.isTuuid = function(str)
{
    if (typeof str != "string" || !str) return 0;
    var idx = str.indexOf("_");
    if (idx > 0) str = str.substr(idx + 1);
    var bytes = Buffer.from(str, 'hex');
    if (bytes.length != 15) return 0;
    return 1;
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

// Returns current time in microseconds
lib.clock = function()
{
    return bkutils.getTimeOfDay();
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

function zeropad(n) {
    return n > 9 ? n : '0' + n;
}

const _strftime = {
    a: function(t, utc, lang, tz) {
        if (lang && !lib.strftimeMap.weekDays[lang]) {
            lib.strftimeMap.weekDays[lang] = lib.strftimeMap.weekDays[""].map((x) => (lib.__({ phrase: x, locale: lang })));
        }
        return lib.strftimeMap.weekDays[lang || ""][utc ? t.getUTCDay() : t.getDay()]
    },
    A: function(t, utc, lang, tz) {
        if (lang && !lib.strftimeMap.weekDaysFull[lang]) {
            lib.strftimeMap.weekDaysFull[lang] = lib.strftimeMap.weekDaysFull[""].map((x) => (lib.__({ phrase: x, locale: lang })));
        }
        return lib.strftimeMap.weekDaysFull[lang || ""][utc ? t.getUTCDay() : t.getDay()]
    },
    b: function(t, utc, lang, tz) {
        if (lang && !lib.strftimeMap.months[lang]) {
            lib.strftimeMap.months[lang] = lib.strftimeMap.months[""].map((x) => (lib.__({ phrase: x, locale: lang })));
        }
        return lib.strftimeMap.months[lang || ""][utc ? t.getUTCMonth() : t.getMonth()]
    },
    B: function(t, utc, lang, tz) {
        if (lang && !lib.strftimeMap.monthsFull[lang]) {
            lib.strftimeMap.monthsFull[lang] = lib.strftimeMap.monthsFull[""].map((x) => (lib.__({ phrase: x, locale: lang })));
        }
        return lib.strftimeMap.monthsFull[lang || ""][utc ? t.getUTCMonth() : t.getMonth()]
    },
    c: function(t, utc, lang, tz) {
        return utc ? t.toUTCString() : t.toString()
    },
    d: function(t, utc, lang, tz) {
        return zeropad(utc ? t.getUTCDate() : t.getDate())
    },
    H: function(t, utc, lang, tz) {
        return zeropad(utc ? t.getUTCHours() : t.getHours())
    },
    I: function(t, utc, lang, tz) {
        return zeropad((((utc ? t.getUTCHours() : t.getHours()) + 12) % 12) || 12)
    },
    L: function(t, utc, lang, tz) {
        return zeropad(utc ? t.getUTCMilliseconds() : t.getMilliseconds())
    },
    m: function(t, utc, lang, tz) {
        return zeropad((utc ? t.getUTCMonth() : t.getMonth()) + 1)
    }, // month-1
    M: function(t, utc, lang, tz) {
        return zeropad(utc ? t.getUTCMinutes() : t.getMinutes())
    },
    p: function(t, utc, lang, tz) {
        return (utc ? t.getUTCHours() : t.getHours()) < 12 ? 'AM' : 'PM';
    },
    S: function(t, utc, lang, tz) {
       return zeropad(utc ? t.getUTCSeconds() : t.getSeconds())
   },
    w: function(t, utc, lang, tz) {
        return utc ? t.getUTCDay() : t.getDay()
    }, // 0..6 == sun..sat
    W: function(t, utc, lang, tz) {
        return zeropad(lib.weekOfYear(t, utc))
    },
    y: function(t, utc, lang, tz) {
        return zeropad(t.getYear() % 100);
    },
    Y: function(t, utc, lang, tz) {
        return utc ? t.getUTCFullYear() : t.getFullYear()
    },
    t: function(t, utc, lang, tz) {
        return t.getTime()
    },
    u: function(t, utc, lang, tz) {
        return Math.floor(t.getTime()/1000)
    },
    Z: function(t, utc, lang, tz) {
        tz = tz ? tz/60000 : t.getTimezoneOffset();
        return "GMT" + (tz < 0 ? "+" : "-") + zeropad(Math.abs(-tz/60)) + "00";
    },
    z: function(t, utc, lang, tz) {
        tz = tz ? tz/60000 : t.getTimezoneOffset();
        tz = "GMT" + (tz < 0 ? "+" : "-") + zeropad(Math.abs(-tz/60)) + "00";
        var dst = lib.isDST(t);
        for (const i in lib.tzMap) {
            if (tz == lib.tzMap[i][1] && (dst === lib.tzMap[i][2])) return lib.tzMap[i][0];
        }
        return tz;
    },
    Q: function(t, utc, lang, tz) {
        var h = utc ? t.getUTCHours() : t.getHours();
        return h < 12 ? lib.__({ phrase: "Morning", locale: lang }) :
               h < 17 ? lib.__({ phrase: "Afternoon", locale: lang }) :
               lib.__({ phrase: "Evening", locale: lang }) },
    '%': function() { return '%' },
};

// Format date object
lib.strftime = function(date, fmt, options)
{
    date = this.toDate(date, null);
    if (!date) return "";
    var utc = options && options.utc;
    var lang = options && options.lang;
    var tz = options && typeof options.tz == "number" ? options.tz : 0;
    if (tz) date = new Date(date.getTime() - tz);
    fmt = fmt || this.strftimeFormat;
    for (const p in _strftime) {
        fmt = fmt.replace('%' + p, _strftime[p](date, utc, lang, tz));
    }
    return fmt;
}

// C-sprintf alike
// based on http://stackoverflow.com/a/13439711
// Usage:
//  - sprintf(fmt, arg, ...)
//  - sprintf(fmt, [arg, ...]);
lib.sprintf = function(fmt, args)
{
    var i = 0, arr = arguments;
    if (arguments.length == 2 && Array.isArray(args)) i = -1, arr = args;

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
        case 'z':
            return val;
        }
        val = typeof(val) == 'object' ? JSON.stringify(val) : val.toString(base);
        var sz = parseInt(p1); /* padding size */
        var ch = p1 && p1[0] == '0' ? '0' : ' '; /* isnull? */
        while (val.length < sz) val = p0 !== undefined ? val + ch : ch + val; /* isminus? */
        return val;
    }
    var regex = /%(-)?(0?[0-9]+)?([.][0-9]+)?([#][0-9]+)?([scfpexdz])/g;
    return String(fmt).replace(regex, format);
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

// Perform match on a regexp for a string and returns matched value, if no index is specified returns item 1,
// this is a simple case for oneshot match and only single matched element.
// If the `rx`` object has the 'g' flag the result will be all matches in an array.
lib.matchRegexp = function(str, rx, index)
{
    if (typeof str != "string" || !rx || !util.isRegExp(rx)) return null;
    var d = str.match(rx);
    return d ? /g/.test(rx.flags) ? d : d[index || 1] : null;
}

// Perform match on a regexp and return all matches in an array, if no index is specified returns item 1
lib.matchAllRegexp = function(str, rx, index)
{
    if (typeof str != "string" || !rx || !util.isRegExp(rx)) return [];
    var d, rc = [];
    while ((d = rx.exec(str)) !== null) {
        rc.push(d[index || 1]);
    }
    return rc;
}

// Perform test on a regexp for a string and returns true only if matched.
lib.testRegexp = function(str, rx)
{
    return rx && util.isRegExp(rx) ? rx.test(str) : false;
}

// Run test on a regexpObj
lib.testRegexpObj = function(str, rx)
{
    return rx && util.isRegExp(rx.rx) ? rx.rx.test(str) : false;
}

// Safe version of replace for strings, always returns a string, if `val` is not provided performs
// removal of the matched patterns
lib.replaceRegexp = function(str, rx, val)
{
    if (typeof str != "string") return "";
    if (!util.isRegExp(rx)) return str;
    return str.replace(rx, val || "");
}

// Replace Unicode symbols with ASCII equivalents
lib.unicode2Ascii = function(str)
{
    if (typeof str != "string") return "";
    var rc = "";
    for (var i in str) rc += this.unicodeAsciiMap[str[i]] || str[i];
    return rc.trim();
}

// Remove all whitespace from the begining and end of the given string, if an array with characters is not given then it trims all whitespace
lib.strTrim = function(str, chars)
{
    if (typeof str != "string" || !str) return "";
    if (typeof chars == "string" && chars) {
        var rx = new RegExp("(^[" + chars + "]+)|([" + chars + "]+$)", "gi");
    } else {
        if (!this._whitespace) {
            this._whitespace = new RegExp("(^[" + this.whitespace + "]+)|([" + this.whitespace + "]+$)", "gi");
        }
        var rx = this._whitespace;
    }
    return str.replace(rx, "");
}

// Split string into array, ignore empty items,
// - `sep` is an RegExp to use as a separator instead of default  pattern `[,\|]`,
// - `options` is an object with the same properties as for the `toParams`, `datatype' will be used with
//   `lib.toValue` to convert the value for each item
//
// If `str` is an array and type is not specified then all non-string items will be returned as is.
lib.strSplit = function(str, sep, options)
{
    if (!str) return [];
    options = options || this.empty;
    return (Array.isArray(str) ? str : String(str).split(sep || this.rxSplit)).
            map(function(x) {
                x = options.datatype ? lib.toValue(x, options.datatype) : typeof x == "string" ? x.trim() : x;
                if (typeof x == "string") {
                    if (options.regexp && !options.regexp.test(x)) return "";
                    if (options.lower) x = x.toLowerCase();
                    if (options.upper) x = x.toUpperCase();
                    if (options.strip) x = x.replace(options.strip, "");
                    if (options.camel) x = lib.toCamel(x, options);
                    if (options.cap) x = lib.toTitle(x);
                    if (options.trunc > 0) x = x.substr(0, options.trunc);
                }
                return x;
            }).
            filter(function(x) { return typeof x == "string" ? x.length : 1 });
}

// Split as above but keep only unique items, case-insensitive
lib.strSplitUnique = function(str, sep, options)
{
    var rc = [];
    var typed = options && options.datatype != "undefined";
    this.strSplit(str, sep, options).forEach(function(x) {
        if (!rc.some(function(y) {
            return typed || !(typeof x == "string" && typeof y == "string") ? x == y : x.toLowerCase() == y.toLowerCase()
        })) rc.push(x);
    });
    return rc;
}

// Split a string into phrases separated by `options.separator` character(s) and surrounded by characters in `options.quotes`. The default separator is space and
// default quotes are both double and single quote. If `options.keepempty` is given all empty parts will be kept in the list.
lib.phraseSplit = function(str, options)
{
    return bkutils.strSplit(str, options && options.separator || " ", options && options.quotes || '"\'', options && options.keepempty ? true : false);
}

// Return the length of an array or 0 if it is not an array
lib.arrayLength = function(list)
{
    return Array.isArray(list) && list.length || 0;
}

// Remove the given item from the list in place, returns the same list
lib.arrayRemove = function(list, item)
{
    var idx = this.isArray(list, this.emptylist).indexOf(item);
    if (idx > -1) list.splice(idx, 1);
    return list;
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

// Flatten array of arrays into a single array
lib.arrayFlatten = function(list)
{
    list = Array.prototype.concat.apply([], list);
    return list.some(Array.isArray) ? this.arrayFlatten(list) : list;
}

// Stringify JSON into base64 string, if secret is given, sign the data with it
lib.jsonToBase64 = function(data, secret, algorithm)
{
    data = this.stringify(data);
    if (secret) return this.encrypt(secret, data, algorithm);
    return Buffer.from(data).toString("base64");
}

// Parse base64 JSON into JavaScript object, in some cases this can be just a number then it is passed as it is, if secret is given verify
// that data is not chnaged and was signed with the same secret
lib.base64ToJson = function(data, secret, algorithm)
{
    var rc = "";
    if (typeof data == "undefined" || data == null) return rc;
    if (secret) data = this.decrypt(secret, data, algorithm);
    try {
        if (typeof data == "number" || (typeof data == "string" && data.match(/^[0-9]+$/))) {
            rc = this.toNumber(data);
        } else {
            if (!secret) data = Buffer.from(data, "base64").toString();
            if (data) rc = JSON.parse(data);
        }
    } catch(e) {
        logger.debug("base64ToJson:", e.stack, data);
    }
    return rc;
}

// From https://github.com/pieroxy/lz-string/
lib.strCompress = function(data, encoding)
{
    switch (encoding) {
    case "base64":
        var rc = this._strCompress(data, 6, function(a) { return lib.base64.charAt(a) });
        switch (rc.length % 4) {
        case 1:
            return rc + "===";
        case 2:
            return rc + "==";
        case 3:
            return rc + "=";
        }
        return rc;
    case "uri":
        return this._strCompress(data, 6, function(a) { return lib.uriSafe.charAt(a) });
    case "uint8":
        data = this._strCompress(data, 16, String.fromCharCode);
        var buf = new Uint8Array(data.length * 2);
        for (var i = 0, len = data.length; i < len; i++) {
            var v = data.charCodeAt(i);
            buf[i*2] = v >>> 8;
            buf[i*2+1] = v % 256;
        }
        return buf;
    case "utf16":
        return this._strCompress(data, 15, function(a) { return String.fromCharCode(a + 32) }) + " ";
    default:
        return this._strCompress(data, 16, String.fromCharCode);
    }
}

lib.strDecompress = function(data, encoding)
{
    if (data == null || data === "") return "";
    switch (encoding) {
    case "base64":
        if (!this.base64Dict.A) for (let i = 0 ;i < this.base64.length; i++) this.base64Dict[this.base64.charAt(i)] = i;
        return this._strDecompress(data.length, 32, function(index) { return lib.base64Dict[data.charAt(index)] });
    case "uri":
        if (!this.uriSafeDict.A) for (let i = 0 ;i < this.uriSafe.length; i++) this.uriSafeDict[this.uriSafe.charAt(i)] = i;
        data = data.replace(/ /g, "+");
        return this._strDecompress(data.length, 32, function(index) { return lib.uriSafeDict[data.charAt(index)] });
    case "utf16":
        return this._strDecompress(data.length, 16384, function(index) { return data.charCodeAt(index) - 32; });
    case "uint8":
        var buf = new Array(data.length/2);
        for (let i = 0, len = buf.length; i < len; i++) buf[i] = data[i*2]*256 + data[i*2+1];
        data = buf.map(function(c) { return String.fromCharCode(c) }).join('');
    default:
        return this._strDecompress(data.length, 32768, function(index) { return data.charCodeAt(index); });
    }
}

lib._strCompress = function(data, bitsPerChar, getCharFromInt)
{
    if (data == null || data === "") return "";
    var i, ii, value, context_dictionary = {}, context_dictionaryToCreate = {};
    var context_c = "", context_wc = "", context_w = "", context_enlargeIn = 2;
    var context_dictSize = 3, context_numBits = 2, context_data = [], context_data_val = 0, context_data_position = 0;

    for (ii = 0; ii < data.length; ii += 1) {
        context_c = data.charAt(ii);
        if (!Object.prototype.hasOwnProperty.call(context_dictionary,context_c)) {
            context_dictionary[context_c] = context_dictSize++;
            context_dictionaryToCreate[context_c] = true;
        }
        context_wc = context_w + context_c;
        if (Object.prototype.hasOwnProperty.call(context_dictionary,context_wc)) {
            context_w = context_wc;
        } else {
            if (Object.prototype.hasOwnProperty.call(context_dictionaryToCreate,context_w)) {
                if (context_w.charCodeAt(0)<256) {
                    for (i = 0 ; i<context_numBits ; i++) {
                        context_data_val = (context_data_val << 1);
                        if (context_data_position == bitsPerChar-1) {
                            context_data_position = 0;
                            context_data.push(getCharFromInt(context_data_val));
                            context_data_val = 0;
                        } else {
                            context_data_position++;
                        }
                    }
                    value = context_w.charCodeAt(0);
                    for (i = 0 ; i<8 ; i++) {
                        context_data_val = (context_data_val << 1) | (value&1);
                        if (context_data_position == bitsPerChar-1) {
                            context_data_position = 0;
                            context_data.push(getCharFromInt(context_data_val));
                            context_data_val = 0;
                        } else {
                            context_data_position++;
                        }
                        value = value >> 1;
                    }
                } else {
                    value = 1;
                    for (i = 0 ; i<context_numBits ; i++) {
                        context_data_val = (context_data_val << 1) | value;
                        if (context_data_position ==bitsPerChar-1) {
                            context_data_position = 0;
                            context_data.push(getCharFromInt(context_data_val));
                            context_data_val = 0;
                        } else {
                            context_data_position++;
                        }
                        value = 0;
                    }
                    value = context_w.charCodeAt(0);
                    for (i = 0 ; i<16 ; i++) {
                        context_data_val = (context_data_val << 1) | (value&1);
                        if (context_data_position == bitsPerChar-1) {
                            context_data_position = 0;
                            context_data.push(getCharFromInt(context_data_val));
                            context_data_val = 0;
                        } else {
                            context_data_position++;
                        }
                        value = value >> 1;
                    }
                }
                context_enlargeIn--;
                if (context_enlargeIn == 0) {
                    context_enlargeIn = Math.pow(2, context_numBits);
                    context_numBits++;
                }
                delete context_dictionaryToCreate[context_w];
            } else {
                value = context_dictionary[context_w];
                for (i = 0 ; i<context_numBits ; i++) {
                    context_data_val = (context_data_val << 1) | (value&1);
                    if (context_data_position == bitsPerChar-1) {
                        context_data_position = 0;
                        context_data.push(getCharFromInt(context_data_val));
                        context_data_val = 0;
                    } else {
                        context_data_position++;
                    }
                    value = value >> 1;
                }
            }
            context_enlargeIn--;
            if (context_enlargeIn == 0) {
                context_enlargeIn = Math.pow(2, context_numBits);
                context_numBits++;
            }
            context_dictionary[context_wc] = context_dictSize++;
            context_w = String(context_c);
        }
    }
    if (context_w !== "") {
        if (Object.prototype.hasOwnProperty.call(context_dictionaryToCreate,context_w)) {
            if (context_w.charCodeAt(0)<256) {
                for (i = 0 ; i<context_numBits ; i++) {
                    context_data_val = (context_data_val << 1);
                    if (context_data_position == bitsPerChar-1) {
                        context_data_position = 0;
                        context_data.push(getCharFromInt(context_data_val));
                        context_data_val = 0;
                    } else {
                        context_data_position++;
                    }
                }
                value = context_w.charCodeAt(0);
                for (i = 0 ; i<8 ; i++) {
                    context_data_val = (context_data_val << 1) | (value&1);
                    if (context_data_position == bitsPerChar-1) {
                        context_data_position = 0;
                        context_data.push(getCharFromInt(context_data_val));
                        context_data_val = 0;
                    } else {
                        context_data_position++;
                    }
                    value = value >> 1;
                }
            } else {
                value = 1;
                for (i = 0 ; i<context_numBits ; i++) {
                    context_data_val = (context_data_val << 1) | value;
                    if (context_data_position == bitsPerChar-1) {
                        context_data_position = 0;
                        context_data.push(getCharFromInt(context_data_val));
                        context_data_val = 0;
                    } else {
                        context_data_position++;
                    }
                    value = 0;
                }
                value = context_w.charCodeAt(0);
                for (i = 0 ; i<16 ; i++) {
                    context_data_val = (context_data_val << 1) | (value&1);
                    if (context_data_position == bitsPerChar-1) {
                        context_data_position = 0;
                        context_data.push(getCharFromInt(context_data_val));
                        context_data_val = 0;
                    } else {
                        context_data_position++;
                    }
                    value = value >> 1;
                }
            }
            context_enlargeIn--;
            if (context_enlargeIn == 0) {
                context_enlargeIn = Math.pow(2, context_numBits);
                context_numBits++;
            }
            delete context_dictionaryToCreate[context_w];
        } else {
            value = context_dictionary[context_w];
            for (i = 0 ; i<context_numBits ; i++) {
                context_data_val = (context_data_val << 1) | (value&1);
                if (context_data_position == bitsPerChar-1) {
                    context_data_position = 0;
                    context_data.push(getCharFromInt(context_data_val));
                    context_data_val = 0;
                } else {
                    context_data_position++;
                }
                value = value >> 1;
            }
        }
        context_enlargeIn--;
        if (context_enlargeIn == 0) {
            context_enlargeIn = Math.pow(2, context_numBits);
            context_numBits++;
        }
    }
    value = 2;
    for (i = 0 ; i<context_numBits ; i++) {
        context_data_val = (context_data_val << 1) | (value&1);
        if (context_data_position == bitsPerChar-1) {
            context_data_position = 0;
            context_data.push(getCharFromInt(context_data_val));
            context_data_val = 0;
        } else {
            context_data_position++;
        }
        value = value >> 1;
    }
    while (true) {
        context_data_val = (context_data_val << 1);
        if (context_data_position == bitsPerChar-1) {
            context_data.push(getCharFromInt(context_data_val));
            break;
        }
        else context_data_position++;
    }
    return context_data.join('');
}

lib._strDecompress = function(length, resetValue, getNextValue)
{
    var dictionary = [], enlargeIn = 4, dictSize = 4, numBits = 3, entry = "", result = [];
    var i, w, c, resb;
    var data = { val: getNextValue(0), position: resetValue, index: 1 };

    var bits = 0, maxpower = Math.pow(2,2), power = 1
    for (i = 0; i < 3; i += 1) dictionary[i] = i;
    while (power != maxpower) {
        resb = data.val & data.position;
        data.position >>= 1;
        if (data.position == 0) {
            data.position = resetValue;
            data.val = getNextValue(data.index++);
        }
        bits |= (resb>0 ? 1 : 0) * power;
        power <<= 1;
    }

    switch (bits) {
    case 0:
        bits = 0;
        maxpower = Math.pow(2,8);
        power = 1;
        while (power != maxpower) {
            resb = data.val & data.position;
            data.position >>= 1;
            if (data.position == 0) {
                data.position = resetValue;
                data.val = getNextValue(data.index++);
            }
            bits |= (resb>0 ? 1 : 0) * power;
            power <<= 1;
        }
        c = String.fromCharCode(bits);
        break;
    case 1:
        bits = 0;
        maxpower = Math.pow(2,16);
        power = 1;
        while (power != maxpower) {
            resb = data.val & data.position;
            data.position >>= 1;
            if (data.position == 0) {
                data.position = resetValue;
                data.val = getNextValue(data.index++);
            }
            bits |= (resb>0 ? 1 : 0) * power;
            power <<= 1;
        }
        c = String.fromCharCode(bits);
        break;
    case 2:
        return "";
    }
    dictionary[3] = c;
    w = c;
    result.push(c);
    while (true) {
        if (data.index > length) return "";
        bits = 0;
        maxpower = Math.pow(2,numBits);
        power = 1;
        while (power!=maxpower) {
            resb = data.val & data.position;
            data.position >>= 1;
            if (data.position == 0) {
                data.position = resetValue;
                data.val = getNextValue(data.index++);
            }
            bits |= (resb>0 ? 1 : 0) * power;
            power <<= 1;
        }

        switch (c = bits) {
        case 0:
            bits = 0;
            maxpower = Math.pow(2,8);
            power = 1;
            while (power!=maxpower) {
                resb = data.val & data.position;
                data.position >>= 1;
                if (data.position == 0) {
                    data.position = resetValue;
                    data.val = getNextValue(data.index++);
                }
                bits |= (resb>0 ? 1 : 0) * power;
                power <<= 1;
            }

            dictionary[dictSize++] = String.fromCharCode(bits);
            c = dictSize-1;
            enlargeIn--;
            break;
        case 1:
            bits = 0;
            maxpower = Math.pow(2,16);
            power = 1;
            while (power != maxpower) {
                resb = data.val & data.position;
                data.position >>= 1;
                if (data.position == 0) {
                    data.position = resetValue;
                    data.val = getNextValue(data.index++);
                }
                bits |= (resb>0 ? 1 : 0) * power;
                power <<= 1;
            }
            dictionary[dictSize++] = String.fromCharCode(bits);
            c = dictSize-1;
            enlargeIn--;
            break;
        case 2:
            return result.join('');
        }
        if (enlargeIn == 0) {
            enlargeIn = Math.pow(2, numBits);
            numBits++;
        }
        if (dictionary[c]) {
            entry = dictionary[c];
        } else {
            if (c === dictSize) {
                entry = w + w.charAt(0);
            } else {
                return null;
            }
        }
        result.push(entry);
        dictionary[dictSize++] = w + entry.charAt(0);
        enlargeIn--;
        w = entry;
        if (enlargeIn == 0) {
            enlargeIn = Math.pow(2, numBits);
            numBits++;
        }
    }
}

// Extract domain from the host name, takes all host parts except the first one
lib.domainName = function(host)
{
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

// Return true if a variable or property in the object exists,
// - if obj is null or undefined return false
// - if obj is an object, return true if the property is not undefined
// - if obj is an array then search for the value with indexOf, only simple values supported,
// - if obj is a string then perform indexOf if the name is also a string or a number
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
    case "string":
        return obj.indexOf(name) > -1;
    case "array":
        if (Array.isArray(name)) return obj.some(function(x) { return name.indexOf(x) > -1 });
        return obj.indexOf(name) > -1;
    }
    return !!obj;
}

// Returns first valid function object from the arguments, if no function found a placeholder is returned
lib.callback = function()
{
    for (var i = 0; i < arguments.length; i++) {
        if (typeof arguments[i] == "function") return arguments[i];
    }
    return this.noop;
}

// A copy of an object, this is a shallow copy, only arrays and objects are created but all other types are just referenced in the new object
// - first argument is the object to clone, can be null
// - all additional arguments are treated as name value pairs and added to the cloned object as additional properties
// Example:
//          lib.objClone({ 1: 2 }, "3", 3, "4", 4)
lib.objClone = function()
{
    var obj = arguments[0];
    var rc = Array.isArray(obj) ? [] : {}, o1, o2;
    for (var p in obj) {
        if (!obj.hasOwnProperty(p)) continue;
        o1 = obj[p];
        switch (this.typeName(o1)) {
        case "object":
            rc[p] = o2 = {};
            for (var k in o1) o2[k] = o1[k];
            break;
        case "array":
            rc[p] = o1.slice(0);
            break;
        default:
            rc[p] = o1;
        }
    }
    for (var i = 1; i < arguments.length - 1; i += 2) rc[arguments[i]] = arguments[i + 1];
    return rc;
}

// Return new object using arguments as name value pairs for new object properties
lib.objNew = function()
{
    var obj = {};
    for (var i = 0; i < arguments.length - 1; i += 2) if (typeof arguments[i + 1] != "undefined") obj[arguments[i]] = arguments[i + 1];
    return obj;
}

// Flatten a javascript object into a single-depth object, all nested values will have property names appended separated by comma
//
// The options properties:
//  - separator - use something else instead of .
//  - index - initial index for arrays, 0 is default
//
// Example
//
//          > lib.objFlatten({ a: { c: 1 }, b: { d: 1 } } )
//          { 'a.c': 1, 'b.d': 1 }
//         > lib.objFlatten({ a: { c: 1 }, b: { d: [1,2,3] } }, { index: 1 })
//          { 'a.c': 1, 'b.d.1': 1, 'b.d.2': 2, 'b.d.3': 3 }
lib.objFlatten = function(obj, options)
{
    var rc = {};
    var idx1 = Array.isArray(obj) && options && typeof options.index == "number" ? options.index : 0;

    for (var p in obj) {
        var p1 = idx1 ? lib.toNumber(p) + idx1 : p;
        if (typeof obj[p] == 'object') {
            var obj2 = this.objFlatten(obj[p], options);
            var idx2 = Array.isArray(obj2) && options && typeof options.index == "number" ? options.index : 0;
            for (var x in obj2) {
                var x1 = idx2 ? lib.toNumber(x) + idx2 : x;
                rc[p1 + (options && options.separator ? options.separator : '.') + x1] = obj2[x];
            }
        } else {
            if (typeof obj[p] != "undefined") rc[p1] = obj[p];
        }
    }
    return rc;
}

// Cleanup object properties, delete all undefined values in place by default.
// Additional options:
// - If `null` is true then delete all null properties.
// - If `type` is a RegExp then all properties that match it by type will be deleted.
// - If `name` is a RegExp then all properties that match it by name will be deleted.
// - If `value` is a RegExp then all string|number|boolean properties that match it by value will be deleted.
// - If `array` is true then process all array items recursivelly
//
// Example
//
//     > lib.cleanObj({ a: 1, b: true, c: undefined, d: 2, e: null, l: ["a", "b", null, undefined, { a: 1, b: undefined } ] },{ null:1, array:1, type: /boolean/})
//     { a: 1, d: 2, l: [ 'a', 'b', { a: 1 } ] }
//
lib.objClean = function(obj, options)
{
    var names = options && util.isRegExp(options.name) ? options.name : null;
    var values = options && util.isRegExp(options.value) ? options.value : null;
    var types = options && util.isRegExp(options.type) ? options.type : null;

    function toClean(type, name) {
        if (types && types.test(type)) return 1;
        if (names && names.test(name)) return 1;
        switch (type) {
        case "undefined":
            return 1;
        case "null":
            if (options && options.null) return 1;
            break;
        case "string":
        case "number":
        case "boolean":
            if (values && values.test(obj[p])) return 1;
            break;
        }
        return 0;
    }

    switch (this.typeName(obj)) {
    case "object":
        for (const p in obj) {
            var type = this.typeName(obj[p]);
            if (toClean(type, p, obj[p])) {
                delete obj[p];
                continue;
            }
            switch (type) {
            case "array":
                if (!options || !options.array) break;
            case "object":
                obj[p] = this.objClean(obj[p], options);
                break;
            }
        }
        break;

    case "array":
        if (!options || !options.array) return obj;
        obj = obj.filter(function(x) {
            var t = lib.typeName(x);
            if (toClean(t, "", x)) return 0;
            switch (t) {
            case "array":
                if (!options || !options.array) break;
            case "object":
                x = lib.objClean(x, options);
                break;
            }
            return 1;
        });
        break;
    }
    return obj;
}

// Add properties to an existing object, two use cases:
// - the first arg is the object, the rest are pairs: name, value,....
// - the first arg is the object, the second arg is an object to add properties from. In this case
// the third argument can be an options object that can control how the properties are merged.
//
// Options properties:
//  - allow - a regexp which properties are allowed to be merged
//  - ignore - a regexp which properties should be ignored
//  - del - a regexp which properties should be removed
//  - remove - a regexp to apply to each property name before merging, the matching parts will be removed from the name
//  - deep - extend all objects not just the top level
//
//
//         lib.objExtend({ a: 1 }, 'b', 2, 'c' 3 )
//         lib.objExtend({ a: 1 }, { b: 2, c: 3 }, { del: /^a/ })
//         lib.objExtend({ a: 1 }, { b: 2, _c: 3, _d: 4 }, { remove: /^_/ })
//
lib.objExtend = function(obj, val, options)
{
    var rc = arguments[0];
    if (this.typeName(obj) != "object") rc = {};
    if (this.typeName(arguments[1]) == "object") {
        var del = options && options.del && typeof options.del.test == "function" ? options.del : null;
        var rem = options && options.remove && typeof options.remove.test == "function" ? options.remove : null;
        var ignore = options && options.ignore && typeof options.ignore.test == "function" ? options.ignore : null;
        var allow = options && options.allow && typeof options.allow.test == "function" ? options.allow : null;
        if (del) {
            for (const p in rc) {
                if (del.test(p)) delete rc[p];
            }
        }
        for (const p in arguments[1]) {
            if (ignore && ignore.test(p)) continue;
            if (allow && !allow.test(p)) continue;
            var v = arguments[1][p];
            if (rem) p = p.replace(rem, "");
            if (options && options.deep) {
                switch (this.typeName(rc[p])) {
                case "object":
                    this.objExtend(rc[p], v);
                    continue;
                case "array":
                    rc[p].push.apply(rc[p], Array.isArray(v) ? v : [v]);
                    continue;
                }
            }
            rc[p] = v;
        }
    } else {
        for (var i = 1; i < arguments.length - 1; i += 2) {
            rc[arguments[i]] = arguments[i + 1];
        }
    }
    return rc;
}

// Merge two objects, all properties from the `val` override existing properties in the `obj`, returns a new object, shallow copy,
// only top level properties are reassigned.
//
// Options properties:
//  - allow - a regexp which properties are allowed to be merged
//  - ignore - a regexp which properties should be ignored
//  - del - a regexp which properties should be removed
//  - remove - a regexp to apply to each property name before merging, the matching parts will be removed from the name
//
//  Example
//
//       var o = lib.objMerge({ a:1, b:2, c:3 }, { c:5, d:1, _e: 4, x: 2 }, { allow: /^(c|d)/, remove: /^_/ })
//       o = { a:1, b:2, c:5, d:1 }
lib.objMerge = function(obj, val, options)
{
    var rc = {}, v;
    var del = options && options.del && typeof options.del.test == "function" ? options.del : null;
    var rem = options && options.remove && typeof options.remove.test == "function" ? options.remove : null;
    var ignore = options && options.ignore && typeof options.ignore.test == "function" ? options.ignore : null;
    var allow = options && options.allow && typeof options.allow.test == "function" ? options.allow : null;
    for (const p in val) {
        if (typeof val[p] == "undefined") continue;
        if (ignore && ignore.test(p)) continue;
        if (allow && !allow.test(p)) continue;
        v = val[p];
        if (rem) p = p.replace(rem, "");
        rc[p] = v;
    }
    for (const p in obj) {
        if (del && del.test(p)) continue;
        v = obj[p];
        switch (lib.typeName(v)) {
        case "object":
            if (!rc[p]) rc[p] = {};
            for (var c in v) {
                if (typeof rc[p][c] == "undefined") rc[p][c] = v[c];
            }
            break;
        case "null":
        case "undefined":
            break;
        default:
            if (typeof rc[p] == "undefined") rc[p] = v;
        }
    }
    return rc;
}

// Delete properties from the object, first arg is an object, the rest are properties to be deleted
lib.objDel = function()
{
    if (this.typeName(arguments[0]) != "object") return;
    for (var i = 1; i < arguments.length; i++) delete arguments[0][arguments[i]];
    return arguments[0];
}

// Return an object consisting of properties that matched given criteria in the given object or object of objects.
// options can define the following properties:
//
// - exists - search by property name, return all objects that contain given property
// - hasvalue - search by value, return all objects that have a property with given value
// - sort - if set then sort found columns by the property `name` or if it is a string by the given property
// - names - if true just return list of column names
// - flag - if true, return object with all properties set to flag value
// - value - if given return the value of this property, not the whole matched object
// - count - if true return just number of found properties
//
// Example
//
//          lib.objSearch({id:{index:1},name:{index:3},type:{index:2},descr:{}}, { exists: 'index', sort: 1 });
//          { id: { index: 1 }, type: { index: 2 }, name: { index: 3 } }
//
//          lib.objSearch({id:1,name:"test",type:"test",descr:"descr"}, { hasvalue: 'test', count: 1});
//          2
//
lib.objSearch = function(obj, options)
{
    if (!this.isObject(obj) || !options) return options && options.names ? [] : options && options.count ? 0 : {};

    var rc = Object.keys(obj).filter(function(x) {
        if (obj[x] && typeof obj[x] == "object") {
            if (options.exists && typeof obj[x][options.exists] == "undefined") return 0;
            if (typeof options.hasvalue != "undefined" && !Object.keys(obj[x]).some(function(y) { return obj[x][y] == options.hasvalue })) return 0;
        } else {
            if (options.exists && x != options.exists) return 0;
            if (typeof options.hasvalue != "undefined" && obj[x] != options.hasvalue) return 0;
        }
        return 1;
    });
    if (options.count) return rc.length;
    if (options.sort) {
        var sort = typeof options.sort == "string" ? options.sort : options.exists;
        rc = rc.sort(function(a, b) {
            // One level object can only be sorted by property names because the search for more than one item can be done only by value
            if (typeof obj[a] != "object") return a - b;
            return obj[a][sort] - obj[b][sort];
        });
    }
    rc = rc.reduce(function(x,y) {
        x[y] = options.flag || (options.value ? obj[y][options.value] : obj[y]);
        return x;
    }, {});
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
//   - owner - return the owner object, not the value, i.e. return the object who owns the value specified in the name
//
// Example:
//
//          > lib.objGet({ response: { item : { id: 123, name: "Test" } } }, "response.item.name")
//          "Test"
//          > lib.objGet({ response: { item : { id: 123, name: "Test" } } }, "response.item.name", { list: 1 })
//          [ "Test" ]
//          > lib.objGet({ response: { item : { id: 123, name: "Test" } } }, "response.item.name", { owner: 1 })
//          { item : { id: 123, name: "Test" } }
lib.objGet = function(obj, name, options)
{
    if (!obj) return options ? (options.list ? [] : options.obj ? {} : options.str ? "" : options.num ? options.dflt || 0 : null) : null;
    var path = !Array.isArray(name) ? String(name).split(".") : name, owner = obj;
    for (var i = 0; i < path.length; i++) {
        if (i && owner) owner = owner[path[i - 1]];
        obj = obj ? obj[path[i]] : undefined;
        if (typeof obj == "undefined") {
            if (!options) return obj;
            return options.owner && i == path.length - 1 ? owner : options.list ? [] : options.obj ? {} : options.str ? "" : options.num ? options.dflt || 0 : undefined;
        }
    }
    if (options) {
        if (options.owner) return owner;
        if (obj) {
            if (options.func && typeof obj != "function") return null;
            if (options.list && !Array.isArray(obj)) return [ obj ];
            if (options.obj && typeof obj != "object") return { name: name, value: obj };
            if (options.str && typeof obj != "string") return String(obj);
            if (options.num && typeof obj != "number") return this.toNumber(obj, options);
        }
    }
    return obj;
}

// Set a property of the object, name can be an array or a string with property path inside the object, all non existent intermediate
// objects will be create automatically. The options can have the folowing properties:
// - incr - increment a numeric property with the given number or 1, non-existing propertties will be initilaized with 0
// - mult - multiply a numeric property with the given number, non-existing properties will be initialized with 0
// - push - add to the array, if it is not an array a new empty aray is created
// - append - append to a string
// - unique - only push if not in the list
// - separator - separator for object names, default is `.`
// - result - "new" - new value, "old" - old value otherwise the object itself
//
// Example
//
//          var a = lib.objSet({}, "response.item.count", 1)
//          lib.objSet(a, "response.item.count", 1, { incr: 1 })
//
lib.objSet = function(obj, name, value, options)
{
    options = options || this.empty;
    if (this.typeName(obj) != "object") obj = {};
    if (!Array.isArray(name)) name = String(name).split(options.separator || ".");
    if (!name || !name.length) return obj;
    var p = name[name.length - 1], v = obj;
    for (var i = 0; i < name.length - 1; i++) {
        if (typeof obj[name[i]] == "undefined") obj[name[i]] = {};
        obj = obj[name[i]];
    }
    var old = obj[p];
    if (options.push) {
        if (!Array.isArray(obj[p])) obj[p] = old = [];
        if (!options.unique || obj[p].indexOf(value) == -1) obj[p].push(value);
    } else
    if (options.append) {
        if (typeof obj[p] != "string") obj[p] = old = "";
        obj[p] += value;
    } else
    if (options.mult) {
        if (typeof obj[p] != "number") obj[p] = old = 0;
        obj[p] *= lib.toNumber(value) || 1;
    } else
    if (options.incr) {
        if (typeof obj[p] != "number") obj[p] = old = 0;
        obj[p] += lib.toNumber(value) || 1;
    } else {
        obj[p] = value;
    }
    if (options.result == "old") return old;
    if (options.result == "new") return obj[p];
    return v;
}

// Increment a property by the specified number, if the property does not exist it will be created,
// returns new incremented value or the value specified by the `result` argument.
// It uses `lib.objSet` so the property name can be a nested path.
lib.objIncr = function(obj, name, count, result)
{
    return this.objSet(obj, name, count, { incr: 1, result: result || "new" });
}

// Similar to `objIncr` but does multiplication
lib.objMult = function(obj, name, count, result)
{
    return this.objSet(obj, name, count, { mult: 1, result: result || "new" });
}

// Return all property names for an object
lib.objKeys = function(obj)
{
    return this.isObject(obj) ? Object.keys(obj) : [];
}

// Return an object structure as a string object by showing primitive properties only,
// for arrays it shows the length and `options.count` or 15 first items,
// strings are limited by `options.length` or 256 bytes, if truncated the full string length is shown.
// the object depth is limited by `options.depth` or 5 levels deep, the number of properties are limited by options.count or 15,
// all properties that match `options.ignore` will be skipped from the output, if `options.allow` is a regexp, only properties that
// match it will be output. Use `options.replace` for replacing anything in the final string.
lib.objDescr = function(obj, options)
{
    if (typeof obj != "object") {
        var str = typeof obj == "string" ? obj : typeof obj == "number" || typeof obj == "boolean" ? String(obj) : "";
        if (str && options) for (const p in options.replace) str = str.replace(options.replace[p], p);
        return str;
    }
    if (!options) options = { __depth: 0 };
    var ignore = util.isRegExp(options.ignore) ? options.ignore : null;
    var allow = util.isRegExp(options.allow) ? options.allow : null;
    var hide = util.isRegExp(options.hide) ? options.hide : null;
    var length = options.length || 256, count = options.count || 15, depth = options.depth || 5;
    var rc = "", n = 0, p, v, h, e, t, keys = [], type = this.typeName(obj);
    switch (type) {
    case "object":
        break;
    case "error":
        v = { error: options.errstack ? obj.stack : obj.message };
        for (const k in obj) v[k] = obj[k];
        obj = v;
        break;
    default:
        obj = { "": obj };
    }
    for (const k in obj) keys.push(k);
    if (options.sort && !options.__depth && keys.length) keys = keys.sort();

    for (const i in keys) {
        p = keys[i];
        if (ignore && ignore.test(p)) continue;
        if (allow && !allow.test(p)) continue;
        v = obj[p];
        if (typeof v == "undefined" && !options.undefined) continue;
        h = hide && hide.test(p);
        t = this.typeName(v);

        switch (t) {
        case "buffer":
            if (v.length || options.keepempty || options.buffer) {
                if (p || v.length) {
                    rc += `${rc ? ", " : ""}${p ? p + ":" : ""}[${v.length || ""}] `;
                    if (!h) rc += v.slice(0, length).toString("hex");
                }
                n++;
            }
            break;

        case "array":
            if (v.length || options.keepempty || options.array) {
                if (options.__depth >= depth) {
                    rc += `${rc ? ", " : ""}${p ? p + ": " : ""}{...}`;
                    n++;
                } else {
                    if (typeof options.__depth != "number") options = lib.objClone(options, "__depth", 0);
                    if (!options.__seen) options.__seen = [];
                    if (options.__seen.indexOf(v) > -1) {
                        rc += `${rc ? ", " : ""}${p ? p + ": " : ""}{...}`;
                        n++;
                    } else {
                        options.__seen.push(v);
                        options.__depth++;
                        if (p || v.length) {
                            rc += `${rc ? ", " : ""}${p ? p + ":" : ""}[${v.length || ""}] `;
                            if (!h) rc += v.slice(0, count).map(function(x) { return lib.objDescr(x, options) });
                        }
                        n++;
                        options.__seen.pop();
                        options.__depth--;
                    }
                }
            }
            break;

        case "error":
        case "object":
            if (options.__depth >= depth) {
                rc += `${rc ? ", " : ""}${p ? p + ": " : ""}{...}`;
                n++;
            } else {
                if (typeof options.__depth != "number") options = lib.objClone(options, "__depth", 0);
                if (!options.__seen) options.__seen = [];
                if (options.__seen.indexOf(v) > -1) {
                    rc += `${rc ? ", " : ""}${p ? p + ": " : ""}{...}`;
                    n++;
                } else {
                    options.__seen.push(v);
                    options.__depth++;
                    v = h ? Object.keys(v).length : this.objDescr(v, options);
                    if (p || v) rc += (rc ? ", " : "") + (p ? p + ": " : "") + "{" + v + "}";
                    n++;
                    options.__seen.pop();
                    options.__depth--;
                }
            }
            break;

        case "string":
            if (v || options.keepempty || options.string) {
                rc += (rc ? ", " : "") + (p ? p + ":" : "");
                if (v.length > length) rc += `[${v.length}] `;
                rc += h ? "..." : v.slice(0, length);
                n++;
            }
            break;

        case "function":
            if (!options.func) break;
            if (options.func > 1) v = "[Function]";
            rc += (rc ? ", " : "") + (p ? p + ":" : "") + (h ? "..." : v);
            n++;
            break;

        case "date":
            rc += (rc ? ", " : "") + (p ? p + ":" : "");
            rc += h ? "..." : options.strftime ? this.strftime(v, options.strftime) : v.toISOString();
            n++;
            break;

        case "null":
            if (!options.null) break;
            rc += (rc ? ", " : "") + (p ? p + ": " : "") + "null";
            n++;
            break;

        default:
            e = this.isEmpty(v);
            if (!e || options.keepempty) {
                v = "" + v;
                rc += (rc ? ", " : "") + ( p ? p + ": " : "");
                if (v.length > length) rc += `[${v.length}] `;
                rc += e ? "" : h ? "..." : v.slice(0, length);
                n++;
            }
        }
        if (n > count) break;
    }
    if (!options.__depth) {
        for (const p in options.replace) rc = rc.replace(options.replace[p], p);
    }
    return rc;
}

// JSON stringify without exceptions, on error just returns an empty string and logs the error
lib.stringify = function(obj, filter)
{
    try {
        return this.escapeUnicode(JSON.stringify(obj, filter));
    } catch(e) {
        logger.error("stringify:", e);
        return "";
    }
}

// Nicely format an object with indentations, optional `indentlevel` can be used to control until which level deep
// to use newlines for objects.
lib.jsonFormat = function(obj, options)
{
    if (typeof options == "string") options = { indent: options, __level: 0 };
    if (!options) options = { __level: 0 };
    if (typeof options.__level != "number") options = lib.objClone(options, "__level", 0);

    // Shortcut to parse and format json from the string
    if (typeof obj == "string" && obj != "") {
        if (obj[0] != "[" && obj[0] != "{") return obj;
        try { obj = JSON.parse(obj); } catch(e) { logger.debug(e) }
    }
    if (!options.indent) options.indent = "";
    if (typeof options.nl1 == "undefined") options.nl1 = "\n";
    if (typeof options.nl2 == "undefined") options.nl2 = "\n";
    if (typeof options.sbracket1 == "undefined") options.sbracket1 = "[";
    if (typeof options.sbracket2 == "undefined") options.sbracket2 = "]";
    if (typeof options.cbracket1 == "undefined") options.cbracket1 = "{";
    if (typeof options.cbracket2 == "undefined") options.cbracket2 = "}";
    if (typeof options.quote1 == "undefined") options.quote1 = '"';
    if (typeof options.quote2 == "undefined") options.quote2 = '"';
    if (typeof options.space == "undefined") options.space = "    ";
    if (typeof options.comma == "undefined") options.comma = ", ";
    if (typeof options.sep == "undefined") options.sep = ", ";

    var type = this.typeName(obj);
    var count = 0, val, h;
    var text = type == "array" ? options.sbracket1 : options.cbracket1;
    // Insert newlines only until specified level deep
    var nline = !options.indentlevel || options.__level < options.indentlevel;

    for (var p in obj) {
        val = obj[p];
        if (options.ignore && options.ignore.test(p)) continue;
        h = options.hide && options.hide.test(p);
        if (count > 0) {
            text += type == "array" ? options.sep : options.comma;
        }
        if (type != "array") {
            text += ((nline ? (!options.__level && !count ? "" : options.nl1) +
                     options.indent + options.space : " ") +
                     options.quote1 + p + options.quote2 + ": ");
        }
        switch (this.typeName(val)) {
        case "array":
        case "object":
            if (h) {
                text += Array.isArray(val) ? val.length : Object.keys(val).length + "...";
                break;
            }
            if (!options.__seen) options.__seen = [];
            if (options.__seen.indexOf(val) > -1) {
                text += "...";
                break;
            }
            options.__seen.push(val);
            options.indent += options.space;
            options.__level++;
            text += this.jsonFormat(val, options);
            options.__level--;
            options.__seen.pop(val);
            options.indent = options.indent.substr(0, options.indent.length - options.space.length);
            break;
        case "boolean":
        case "number":
            text += h ? "..." : val.toString();
            break;
        case "null":
            text += "null";
            break;
        case "string":
            text += h ? "..." : (options.quote1 + val + options.quote2);
            break;
        default:
            text += ("unknown: " + typeof(val));
        }
        count++;
    }
    text += type == "array" ? options.sbracket2 : ((nline ? options.nl2 + options.indent : " ") + options.cbracket2);
    return text;
}

// Silent JSON parse, returns null on error, no exceptions raised.
//
// options can specify the following properties:
//  - datatype - make sure the result is returned as type: obj, list, str
//  - logger - report in the log with the specified level, log, debug, ...
lib.jsonParse = function(obj, options)
{
    return _parse("json", obj, options);
}

// Same arguments as for `jsonParse`
lib.xmlParse = function(obj, options)
{
    return _parse("xml", obj, options);
}

// Combined parser with type validation
function _parse(type, obj, options)
{
    if (!obj) return _checkResult(type, lib.newError("empty " + type), obj, options);
    try {
        obj = _parseResult(type, obj, options);
    } catch(err) {
        obj = _checkResult(type, err, obj, options);
    }
    return obj;
}

function _parseResult(type, obj, options)
{
    if (typeof obj == "string") {
        switch (type) {
        case "json":
            obj = JSON.parse(obj);
            break;
        case "xml":
            var opts = { object: true };
            for (var p in options) {
                if (["trim","coerce","sanitize","arrayNotation","reversible"].indexOf(p) > -1) opts[p] = options[p];
            }
            obj = xml2json.toJson(obj, opts);
            break;
        }
    }
    switch (options && options.datatype) {
    case "object":
        if (typeof obj != "object" || !obj) return {};
        break;
    case "obj":
        if (lib.typeName(obj) != "object") return {};
        break;
    case "list":
        if (lib.typeName(obj) != "array") return [];
        break;
    case "str":
        if (lib.typeName(obj) != "string") return "";
        break;
    }
    return obj;
}

// Perform validation of the result type, make sure we return what is expected, this is a helper that is used by other conversion routines
function _checkResult(type, err, obj, options)
{
    if (options) {
        if (options.logger) logger.logger(options.logger, 'parse:', type, options, lib.traceError(err), obj);
        if (options.datatype == "object" || options.datatype == "obj") return {};
        if (options.datatype == "list") return [];
        if (options.datatype == "str") return "";
    }
    return null;
}

// Copy file and then remove the source, do not overwrite existing file
lib.moveFile = function(src, dst, overwrite, callback)
{
    if (typeof overwrite == "function") callback = overwrite, overwrite = false;

    function copyIfFailed(err) {
        if (!err) return (callback ? callback(null) : null);
        lib.copyFile(src, dst, overwrite, function(err2) {
            if (!err2) {
                fs.unlink(src, callback);
            } else {
                if (callback) callback(err2);
            }
        });
    }

    logger.debug('moveFile:', src, dst, overwrite);
    fs.stat(dst, function (err) {
        if (!err && !overwrite) return callback(lib.newError("File " + dst + " exists."));
        fs.rename(src, dst, copyIfFailed);
    });
}

// Copy file, overwrite is optional flag, by default do not overwrite
lib.copyFile = function(src, dst, overwrite, callback)
{
    if (typeof overwrite == "function") callback = overwrite, overwrite = false;

    function copy(err) {
        var ist, ost;
        if (!err && !overwrite) return callback ? callback(lib.newError("File " + dst + " exists.")) : null;
        fs.stat(src, function (err2) {
            if (err2) return callback ? callback(err2) : null;
            ist = fs.createReadStream(src);
            ost = fs.createWriteStream(dst);
            ist.on('end', function() { if (callback) callback() });
            ist.pipe(ost);
        });
    }
    logger.debug('copyFile:', src, dst, overwrite);
    fs.stat(copy);
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

// Non-exception version, returns empty object,
// mtime is 0 in case file does not exist or number of seconds of last modified time
// mdate is a Date object with last modified time
lib.statSync = function(file)
{
    try {
        var stat = fs.statSync(file);
        stat.mdate = stat.mtime.toISOString();
        stat._mtime = stat.mtime.getTime();
        return stat;
    } catch(e) {
        if (e.code != "ENOENT") logger.error('statSync:', e, e.stack);
        return {
            size: 0,
            mdate: "",
            mtime: new Date(0),
            _mtime: 0,
            isFile: function() { return false },
            isSymbolicLink: function() { return false },
            isDirectory: function() { return false },
        };
    }
}

// Return contents of a file, empty if not exist or on error.
//
// Options can specify the format:
// - json - parse file as JSON, return an object, in case of error an empty object
// - xml - parse the file as XML, return an object
// - list - split contents with the given separator
// - encoding - file encoding when converting to string
// - logger - log level for error messages
// - missingok - if set ENOENT will not be logged
// - offset - read from the position in the file, if negative the offset is from the end of file
// - length - read only this much of the data, otherwise read till the end of file
lib.readFileSync = function(file, options)
{
    if (!file) return "";
    var binary = options && options.encoding == "binary";
    try {
        var data = binary ? Buffer.from("") : "";
        var offset = this.toNumber(options && options.offset);
        var length = this.toNumber(options && options.length);
        if (offset || (offset === 0 && length > 0)) {
            var buf = Buffer.alloc(4096);
            var bufsize = buf.length;
            var fd = fs.openSync(file, "r");
            var size = fs.statSync(file).size;
            if (offset < 0) offset = size + offset;
            while (offset < size) {
                var nread = fs.readSync(fd, buf, 0, bufsize, data.length ? null : offset);
                if (nread <= 0) break;
                if (binary) {
                    data = Buffer.concat([data, buf.slice(0, nread)]);
                } else {
                    data += buf.slice(0, nread).toString(options.encoding || 'utf8');
                }
                offset += nread;
                if (length > 0) {
                    if (data.length >= length) break;
                    if (length - data.length < bufsize) bufsize = length - data.length;
                }
            }
            fs.closeSync(fd);
        } else {
            data = fs.readFileSync(file);
            if (!binary) data = data.toString(options && options.encoding ? options.encoding : "utf8");
        }
        if (options) {
            if (options.json) data = lib.jsonParse(data, options); else
            if (options.xml) data = lib.xmlParse(data, options); else
            if (options.list) data = data.split(options.list);
        }
        return data;
    } catch(e) {
        if (options) {
            if (options.logger && !(options.missingok && e.code == "ENOENT")) logger.logger(options.logger, 'readFileSync:', file, e.stack);
            if (options.json) return {};
            if (options.list) return [];
        }
        return "";
    }
}

// Same as `lib.readFileSync` but asynchronous
lib.readFile = function(file, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    var offset = this.toNumber(options && options.offset);
    var length = this.toNumber(options && options.length);
    var binary = options && options.encoding == "binary";
    var fd;

    function onError(err) {
        var data = "";
        if (options) {
            if (options.logger && !(options.missingok && err.code == "ENOENT")) logger.logger(options.logger, 'readFile:', file, err.stack);
            if (options.json) data = {};
            if (options.list) data = [];
        }
        if (typeof fd == "number") fs.close(fd, lib.noop);
        lib.tryCall(callback, err, data);
    }
    function onEnd(data) {
        if (options) {
            if (options.json) data = lib.jsonParse(data, options); else
            if (options.xml) data = lib.xmlParse(data, options); else
            if (options.list) data = lib.strSplit(data, options.list);
        }
        if (typeof fd == "number") fs.close(fd, lib.noop);
        lib.tryCall(callback, null, data);
    }

    if (offset || (offset === 0 && length > 0)) {
        fs.open(file, 'r', function(err, handle) {
            if (err) return onError(err);
            fd = handle;
            var data = binary ? Buffer.from("") : "";
            var buffer = Buffer.alloc(Math.min(length, 4096));
            var bufsize = Math.min(length || buffer.length, buffer.length);
            function onRead() {
                fs.read(fd, buffer, 0, bufsize, data.length ? null : offset, function(err, nread, buf) {
                    if (nread <= 0) return onEnd(data);
                    if (binary) {
                        data = Buffer.concat([data, buf.slice(0, nread)]);
                    } else {
                        data += buf.slice(0, nread).toString(options && options.encoding || 'utf8');
                    }
                    if (nread < bufsize) return onEnd(data);
                    if (length > 0) {
                        if (data.length >= length) return onEnd(data);
                        if (length - data.length < bufsize) bufsize = length - data.length;
                    }
                    offset += nread;
                    onRead();
                });
            }
            if (offset < 0) {
                fs.fstat(fd, function(err, stats) {
                    if (err) return onError(err);
                    offset = stats.size + offset;
                    onRead();
                });
            } else {
                onRead();
            }
        });
    } else {
        fs.readFile(file, function(err, data) {
            if (err) return onError(err);
            if (!binary) data = data.toString(options && options.encoding || 'utf8');
            onEnd(data);
        });
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
    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {}
    if (!Array.isArray(options.files)) options.files = [];

    var level = arguments[3];
    if (typeof level != "number") level = 0;

    fs.readdir(dir, function(err, files) {
        if (err) return lib.tryCall(callback, err, options.files);

        lib.forEachSeries(files, function(file, next) {
            if (options.done) return next();
            var full = path.join(dir, file);

            fs.stat(full, function(err, stat) {
                if (err) return next(err);

                if (stat.isFile()) {
                    if (lib.findFilter(full, stat, options)) {
                        options.files.push(options.base ? file : full);
                    }
                    next();
                } else
                if (stat.isDirectory()) {
                    if (lib.findFilter(full, stat, options)) {
                        options.files.push(options.base ? file : full);
                    }
                    // We reached our directory depth
                    if (options && typeof options.depth == "number" && level >= options.depth) return next();
                    lib.findFile(full, options, next, level + 1);
                } else {
                    next();
                }
            });
        }, function(err) {
            lib.tryCall(callback, err, options.files);
        });
    });
}

// Watch files in a dir for changes and call the callback, the parameters:
// - root - a string with root path
// - files - a regexp to watch files individually, if omitted watch the whole dir
// - match - a regexp to watch files when using the whole dir, only for matched files the callback will be called
// - ignore - a regexp to ignore files
lib.watchFiles = function(options, fileCallback, endCallback)
{
    logger.debug('watchFiles:', options);

    function watcher(event, file) {
        // Check stat if no file name, Mac OS X does not provide it
        fs.stat(file.name, function(err, stat) {
            if (err) return logger.error("watcher:", event, file.name, file.stat.size, err);
            switch (event) {
            case "rename":
                file.watcher.close();
                file.watcher = fs.watch(file.name, function(event) { watcher(event, file); });
                break;
            default:
                if (stat.size == file.stat.size && stat.mtime.getTime() == file.stat.mtime.getTime()) return;
            }
            logger.log('watchFiles:', event, file.name, file.ino, stat.size, stat.mtime);
            file.stat = stat;
            fileCallback(file);
        });
    }

    var root = options.root;
    var ignore = options.ignore && lib.toRegexp(options.ignore) || null;

    if (options.files) {
        var files = lib.toRegexp(options.files);
        fs.readdir(options.root, function(err, list) {
            if (err) return lib.tryCall(endCallback, err);
            list = list.filter(function(file) {
                return (!ignore || !ignore.test(file)) && files.test(file);
            }).map(function(file) {
                file = path.join(options.root, file);
                return ({ name: file, stat: fs.statSync(file) });
            });
            list.forEach(function(file) {
                logger.debug('watchFiles:', file.name, file.stat.ino, file.stat.size);
                file.watcher = fs.watch(file.name, function(event) { watcher(event, file) });
            });
            lib.tryCall(endCallback, err, list);
        });
    } else {
        var match = options.match && lib.toRegexp(options.match) || null;
        try {
            fs.watch(root, function(event, file) {
                logger.dev('watcher:', event, root, file);
                file = path.join(root, file);
                if (ignore && ignore.test(file)) return;
                if (match && !match.test(file)) return;
                fs.stat(file, function(err, stat) {
                    if (err) return logger.error("watcher:", file, err);
                    logger.log('watchFiles:', event, file, stat.size, stat.mtime);
                    fileCallback({ name: file, stat: stat });
                });
            });
            lib.tryCall(endCallback);
        } catch(err) {
            lib.tryCall(endCallback, err);
        }
    }
}

// Recursively create all directories, return 1 if created or 0 on error or if exists, no exceptions are raised, error is logged only
lib.makePathSync = function(dir)
{
    var rc = 0;
    var list = path.normalize(dir).split("/");
    for (let i = 0, dir = ''; i < list.length; i++) {
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
    var list = path.normalize(dir).split("/");
    var full = "";
    lib.forEachSeries(list, function(d, next) {
        full += d + '/';
        fs.stat(full, function(err) {
            if (!err) return next();
            fs.mkdir(full, function(err) {
                next(err && err.code != 'EEXIST' && err.code != 'EISDIR' ? err : null);
            });
        });
    }, function(err) {
        if (err) logger.error('makePath:', err);
        if (callback) callback(err);
    });
}

// Unlink a file, no error on non-existent file, callback is optional
lib.unlink = function(name, callback)
{
    fs.unlink(name, function(err) {
        if (err && err.code == "ENOENT") err = null;
        if (typeof callback == "function") callback(err);
    });
}

// Recursively remove all files and folders in the given path, returns an error to the callback if any
lib.unlinkPath = function(dir, callback)
{
    fs.stat(dir, function(err, stat) {
        if (err) return callback ? callback(err) : null;
        if (stat.isDirectory()) {
            fs.readdir(dir, function(err, files) {
                if (err) return callback && callback(err);
                lib.forEachSeries(files, function(f, next) {
                    lib.unlinkPath(path.join(dir, f), next);
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
// - reset - method to bec alled just before releasing an item back to the resource pool, this is a chance to reset the item to the initial state
// - validate - method to verify actibe resource item, return false if it needs to be destroyed
// - min - min number of active resource items
// - max - max number of active resource items
// - max_queue - how big the waiting queue can be, above this all requests will be rejected immediately
// - timeout - number of milliseconds to wait for the next available resource item, cannot be 0
// - idle - number of milliseconds before starting to destroy all active resources above the minimum, 0 to disable.
//
// If no create implementation callback is given then all operations are basically noop but still cals the callbacks.
//
// Example:
//        var pool = new lib.Pool({ min: 1, max: 5,
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
lib.Pool = function(options)
{
    this._pool = {
        min: 0,
        max: 10,
        max_queue: 100,
        timeout: 5000,
        idle: 300000,
        queue_count: 0,
        queue: {},
        avail: [],
        mtime: [],
        busy: []
    };
    this.init(options);
}

// Initialize pool properties, this can be run anytime even on the active pool to override some properties
lib.Pool.prototype.init = function(options)
{
    var self = this;
    if (!options) return;
    var idle = this._pool.idle;

    if (typeof options.min != "undefined") this._pool.min = lib.toNumber(options.min, { float: 0, flt: 0, min: 0 });
    if (typeof options.max != "undefined") this._pool.max = lib.toNumber(options.max, { float: 0, dflt: 10, min: 0, max: 9999 });
    if (typeof options.interval != "undefined") this._pool.max_queue = lib.toNumber(options.interval, { float: 0, dflt: 100, min: 0 });
    if (typeof options.timeout != "undefined") this._pool.timeout = lib.toNumber(options.timeout, { float: 0, dflt: 5000, min: 1 });
    if (typeof options.idle != "undefined") this._pool.idle = lib.toNumber(options.idle, { float: 0, dflt: 300000, min: 0 });

    if (typeof options.create == "function") this._create = options.create;
    if (typeof options.destroy == "function") this._destroy = options.destroy;
    if (typeof options.reset == "function") this._reset = options.reset;
    if (typeof options.validate == "function") this._validate = options.validate;

    // Periodic housekeeping if interval is set
    if (this._pool.idle > 0 && (idle != this._pool.idle || !this._pool.interval)) {
        clearInterval(this._pool.interval);
        this._pool.interval = setInterval(function() { self._timer() }, Math.max(30000, this._pool.idle/3));
        setImmediate(function() { self._timer(); });
    }
    if (this._pool.idle == 0) clearInterval(this._pool.interval);

    return this;
}

// Return next available resource item, if not available immediately wait for defined amount of time before calling the
// callback with an error. The callback second argument is active resource item.
lib.Pool.prototype.acquire = function(callback)
{
    if (typeof callback != "function") throw lib.newError("callback is required");
    if (!this._create) return callback(null, {});

    // We have idle items
    if (this._pool.avail.length) {
        this._pool.mtime.shift();
        var item = this._pool.avail.shift();
        this._pool.busy.push(item);
        return callback.call(this, null, item);
    }
    // Put into waiting queue
    if (this._pool.busy.length >= this._pool.max) {
        if (this._pool.queue_count >= this._pool.max_queue) return callback(lib.newError("no more resources"));

        this._pool.queue_count++;
        return lib.deferCallback(this._pool.queue, {}, function(m) {
            callback(m.item ? null : lib.newError("timeout waiting for the resource"), m.item);
        }, this._pool.timeout);
    }
    // New item
    var self = this;
    this._call("_create", function(err, item) {
        if (err) {
            logger.error("pool: acquire:", self.name, lib.traceError(err));
        } else {
            if (!item) item = {};
            self._pool.busy.push(item);
            logger.dev('pool: acquire', self.name, 'avail:', self._pool.avail.length, 'busy:', self._pool.busy.length);
        }
        callback(err, item);
    });
}

// Destroy the resource item calling the provided close callback
lib.Pool.prototype.destroy = function(item, callback)
{
    if (!item) return;
    if (!this._create) return typeof callback == "function" && callback();

    logger.dev('pool: destroy', this.name, 'avail:', this._pool.avail.length, 'busy:', this._pool.busy.length);

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
lib.Pool.prototype.release = function(item)
{
    if (!item) return;
    if (!this._create) return;

    var idx = this._pool.busy.indexOf(item);
    if (idx == -1) {
        logger.error('pool: release:', 'not known', item);
        return;
    }
    logger.dev('pool: release', this.name, 'avail:', this._pool.avail.length, 'busy:', this._pool.busy.length, 'max:', this._pool.max);

    // Pass it to the next waiting item
    for (var id in this._pool.queue) {
        this._pool.queue_count--;
        this._pool.queue[id].item = item;
        return lib.runCallback(this._pool.queue, this._pool.queue[id]);
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
lib.Pool.prototype.destroyAll = function()
{
    while (this._pool.avail.length > 0) this.destroy(this._pool.avail[0]);
}

// Return an object with stats
lib.Pool.prototype.stats = function()
{
    return { avail: this._pool.avail.length, busy: this._pool.busy.length, queue: this._pool.queue_count, min: this._pool.min, max: this._pool.max, max_queue: this._pool.max_queue };
}

// Close all connections and shutdown the pool, no more items will be open and the pool cannot be used without re-initialization,
// if callback is provided then wait until all items are released and call it, optional maxtime can be used to retsrict how long to wait for
// all items to be released, when expired the callback will be called
lib.Pool.prototype.shutdown = function(callback, maxtime)
{
    logger.debug('pool.close:', this.name, 'shutdown:', 'avail:', this._pool.avail.length, 'busy:', this._pool.busy.length);
    var self = this;
    this._pool.max = -1;
    this.destroyAll();
    this._pool.queue = {};
    clearInterval(this._pool.interval);
    delete this._pool.interval;
    if (typeof callback != "function") return;
    this._pool.time = Date.now();
    this._pool.interval = setInterval(function() {
        if (self._pool.busy.length && (!maxtime || Date.now() - self._pool.time < maxtime)) return;
        clearInterval(self._pool.interval);
        delete self._pool.interval;
        callback();
    }, 500);
}

// Call registered method and catch exceptions, pass it to the callback if given
lib.Pool.prototype._call = function(name, callback)
{
    if (typeof this[name] != "function") {
        if (typeof callback == "function") return callback();
        return;
    }
    try {
        return this[name].call(this, callback);
    } catch(e) {
        logger.error('pool:', this.name, name, e);
        if (typeof callback == "function") callback(e);
    }
}

// Timer to ensure pool integrity
lib.Pool.prototype._timer = function()
{
    var self = this;
    var now = Date.now();

    // Expire idle items
    if (this._pool.idle > 0) {
        for (let i = 0; i < this._pool.avail.length; i++) {
            if (now - this._pool.mtime[i] > this._pool.idle && this._pool.avail.length + this._pool.busy.length > this._pool.min) {
                logger.dev('pool: timer:', this.name, 'idle', i, 'avail:', this._pool.avail.length, 'busy:', this._pool.busy.length);
                this.destroy(this._pool.avail[i]);
                i--;
            }
        }
    }

    // Ensure min number of items
    var min = this._pool.min - this._pool.avail.length - this._pool.busy.length;
    for (let i = 0; i < min; i++) {
        this._call("_create", function(err, item) {
            if (err) return;
            self._pool.avail.push(item);
            self._pool.mtime.push(now);
        });
    }
}

