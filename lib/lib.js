//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const util = require('util');
const crypto = require('crypto');
const bkutils = require('bkjs-utils');
const logger = require(__dirname + '/logger');
const os = require('os');
const uuid = require('uuid');
const Hashids = require("hashids/cjs");

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
        if (isNaN(n)) n = options.dflt || 0;
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
    if (typeof val == "string") {
        val = /^[0-9.]+$/.test(val) ? this.toNumber(val) : val.replace(/([0-9])(AM|PM)/i, "$1 $2");
    }
    if (typeof val == "number") {
        // Convert nanoseconds to milliseconds
        if (val > 2147485547000) val = Math.round(val / 1000);
        // Convert seconds to milliseconds
        if (val < 2147483647) val *= 1000;
    }
    // Remove unsupported timezone names
    if (typeof val == "string") {
        var gmt = val.indexOf("GMT") > -1;
        for (const i in this.tzMap) {
            if ((gmt || this.tzMap[i][3] === false) && val.indexOf(this.tzMap[i][0]) > -1) {
                val = val.replace(this.tzMap[i][0], "");
            }
        }
    }
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
    case "ttl":
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
    if (!val && options && options.errnull) return null;
    for (const p in val) {
        if (obj.some(function(x) {
            var i = x.list.indexOf(p[0] == "!" ? p.substr(1) : p);
            if (i > -1 && p[0] == "!") {
                x.list.splice(i, 1);
                lib.toRegexpObj(x, "", options);
            }
            return i > -1;
        })) continue;
        var item = this.toRegexpObj(null, p, options);
        if (!item) continue;
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
        if (options && options.del || val[0] == "!") {
            var idx = obj.list.indexOf(val[0] == "!" ? val.substr(1) : val);
            if (idx > -1) obj.list.splice(idx, 1);
        } else {
            if (options && options.set) obj.list = [];
            if (!Array.isArray(val)) val = [ val ];
            for (var i in val) {
                if (obj.list.indexOf(val[i]) == -1) obj.list.push(val[i]);
            }
        }
    }
    if (obj.list.length) {
        try {
            obj.rx = new RegExp(obj.list.map(function(x) { return "(" + x + ")"}).join("|"), options && options.regexp);
        } catch(e) {
            logger.error('toRegexpObj:', val, e);
            if (options && options.errnull) return null;
        }
    } else {
        obj.rx = null;
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
    var i = size > 0 ? Math.floor(Math.log(size) / Math.log(1024)) : 0;
    return (size / Math.pow(1024, i)).toFixed(2) * 1 + ' ' + [this.__('Bytes'), this.__('KBytes'), this.__('MBytes'), this.__('GBytes'), this.__('TBytes')][i];
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
//  - existing - skip properties if not present in the query
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
    var rc = {}, opts, dflt, p, n, v, o;
    options = options || this.empty;
    for (const name in schema) {
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
        for (const c in v) opts[c] = v[c];
        dflt = options.data && (options.data[name] || options.data['*']);
        for (const p in dflt) opts[p] = dflt[p];
        if (opts.ignore) continue;
        n = opts.name || name;
        p = (options.prefix || "") + name;
        if (options.existing && !(p in query)) continue;
        v = query[p];
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
        case "random":
            if (typeof v != "undefined") rc[n] = this.toNumber(v, opts);
            break;
        case "regexp":
            if (typeof v != "undefined") rc[n] = this.toRegexp(v, opts);
            break;
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
                    return options.null ? null : opts.errmsg || this.__("%s is too long, the max is %s", name, opts.max);
                }
                v = v.substr(0, opts.max);
            }
            if (opts.min && v.length < opts.min) {
                return options.null ? null : opts.errmsg || this.__("%s is too short, the min is %s", name, opts.min);
            }
            if (util.isRegExp(opts.regexp) && !opts.regexp.test(v)) {
                if (!opts.required && opts.errmsg) return options.null ? null : opts.errmsg;
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
        for (p in query) {
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
    var i, j, rc = [];
    if (!options) options = {};
    if (!Array.isArray(obj)) obj = [obj];
    for (i = 0; i < obj.length; i++) {
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
        var d, v = null, dflt = null, field = null;
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
            str = str.substr(end + 5 + sep1.length + sep2.length);
            d = tag.match(/^(if|ifeq|ifgt|ifge|iflt|ifle|ifnot|ifall|ifstr) ([a-zA-Z0-9._-]+) +(.+)$/)
            if (!d) continue;
            var ok, val = null, t = d[2];
            i = t.indexOf(".");
            if (i > 0) {
                field = t.substr(i + 1);
                t = t.substr(0, i);
            }
            for (i = 0; i < rc.length && !val; i++) {
                val = typeof rc[i][t] == "function" ? rc[i][t]() : rc[i][t];
                if (val && field && typeof val == "object") {
                    field = field.split(".");
                    for (j = 0; val && j < field.length; j++) {
                        val = val ? val[field[j]] : undefined;
                        if (typeof val == "function") val = val();
                    }
                }
            }
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
            d = tag.match(/^([a-zA-Z0-9._-]+)(\|.+)?$/);
            if (d) {
                tag = d[1];
                if (d[2]) dflt = d[2].substr(1);
                i = tag.indexOf(".");
                if (i > 0) {
                    field = tag.substr(i + 1);
                    tag = tag.substr(0, i);
                }
                for (i = 0; i < rc.length && !v; i++) {
                    v = typeof rc[i][tag] == "function" ? rc[i][tag]() : rc[i][tag];
                    if (v && field && typeof v == "object") {
                        field = field.split(".");
                        for (j = 0; v && j < field.length; j++) {
                            v = v ? v[field[j]] : undefined;
                            if (typeof v == "function") v = v();
                        }
                    }
                }
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
    var cache = {}, rx, not, ok;
    for (var p in condition) {
        if (typeof condition[p] == "undefined") continue;
        rx = condition[p], not = 0;
        if (typeof rx == "string" && rx[0] == "!") not = 1, rx = rx.substr(1);
        var v = lib.toValue(obj && obj[p]);
        if (rx === null) {
            ok = v === "";
        } else {
            if (!util.isRegExp(rx)) {
                if (!cache[rx]) cache[rx] = new RegExp(rx);
                ok = cache[rx].test(v);
            } else {
                ok = rx.test(v);
            }
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
    } catch(e) {
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
    } catch(e) {
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
    zz: function(t, utc, lang, tz) {
        return _strftime.z(t, utc, lang, tz, 1);
    },
    z: function(t, utc, lang, tz, zz) {
        tz = tz ? tz/60000 : t.getTimezoneOffset();
        tz = "GMT" + (tz < 0 ? "+" : "-") + zeropad(Math.abs(-tz/60)) + "00";
        var dst = lib.isDST(t);
        for (const i in lib.tzMap) {
            if (tz == lib.tzMap[i][1] && (dst === lib.tzMap[i][2])) {
                return zz ? tz + " " + lib.tzMap[i][0] : lib.tzMap[i][0];
            }
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

