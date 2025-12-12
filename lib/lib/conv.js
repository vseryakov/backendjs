/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const util = require('util');
const logger = require(__dirname + '/../logger');
const lib = require(__dirname + '/../lib');

/**
 * Returns a floating number from the version string, it assumes common semver format as major.minor.patch, all non-digits will
 * be removed, underscores will be treated as dots. Returns a floating number which can be used in comparing versions.
 * @param {string} str - version like string
 * @return {number}
 * @example
 *      > lib.toVersion("1.0.3")
 *      1.000003
 *      > lib.toVersion("1.0.3.4")
 *      1.000003004
 *      > lib.toVersion("1.0.3.4") > lib.toVersion("1.0.3")
 *      true
 *      > lib.toVersion("1.0.3.4") > lib.toVersion("1.0.0")
 *      true
 *      > lib.toVersion("1.0.3.4") > lib.toVersion("1.1.0")
 *      false
 * @memberof module:lib
 * @method toVersion
 */
lib.toVersion = function(str)
{
    return str ? String(str).replace("_", ".").replace(/[^0-9.]/g, "").split(".").reduce((x, y, i) => (x + Number(y) / Math.pow(10, i * 3)), 0) : 0;
}

/**
 * Convert text into capitalized words, if it is less or equal than minlen leave it as is
 * @param {string} name
 * @param {int} [minlen]
 * @return {string}
 * @memberof module:lib
 * @method toTitle
 */
lib.toTitle = function(name, minlen)
{
    return typeof name == "string" ?
           minlen > 0 && name.length <= minlen ? name :
           name.replaceAll("_", " ").
                split(/[ ]+/).
                reduce((x, y) => (x + (y ? (y.substr(0,1).toUpperCase() + y.substr(1).toLowerCase() + " ") : "")), "").
                trim() : "";
}

/**
 * Convert into camelized form
 * @param {string} name
 * @param {string} [chars] can define the separators, default is [ _.:-]
 * @return {string}
 * @memberof module:lib
 * @method toCamel
 */
lib.toCamel = function(name, chars)
{
    var rx = typeof chars == "string" ? new RegExp("(?:[" + chars + "])(\\w)", "g") : this.rxCamel;
    return typeof name == "string" ? name.substr(0, 1).toLowerCase() + name.substr(1).replace(rx, (_, c) => (c ? c.toUpperCase () : '')) : "";
}

/**
 * Convert Camel names into names separated by the given separator or dash(-) if not.
 * @param {string} str
 * @param {string} [sep]
 * @return {string}
 * @memberof module:lib
 * @method toUncamel
 */
lib.toUncamel = function(str, sep)
{
    return typeof str == "string" ? str.replace(/([A-Z])/g, (_, c, index) => ((index ? sep || '-' : '') + c.toLowerCase())) : "";
}

/**
 * Safe convertion to a number, no expections, uses 0 instead of NaN, handle booleans, if float specified, returns as float.
 * @param {any} val - to be converted to a number
 * @param {object} [options]
 * @param {int} [options.dflt] - default value
 * @param {int} [options.float] - treat as floating number
 * @param {int} [options.min] - minimal value, clip
 * @param {int} [options.max] - maximum value, clip
 * @param {int} [options.incr] - a number to add before checking for other conditions
 * @param {int} [options.mult] - a number to multiply before checking for other conditions
 * @param {int} [options.novalue] - replace this number with default
 * @param {int} [options.zero] - replace with this number if result is 0
 * @param {int} [options.digits] - how many digits to keep after the floating point
 * @param {int} [options.bigint] - return BigInt if not a safe integer
 * @return {number}
 *
 * @example
 * lib.toNumber("123")
 * lib.toNumber("1.23", { float: 1, dflt: 0, min: 0, max: 2 })
 * @memberof module:lib
 * @method toNumber
 */
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
            n = options?.dflt || 0;
        } else {
            // Autodetect floating number
            var f = typeof options?.float == "undefined" || options?.float == null ? this.rxFloat.test(val) : options?.float;
            n = val[0] == 't' ? 1 : val[0] == 'f' ? 0 : val == "infinity" ? Infinity : (f ? parseFloat(val, 10) : parseInt(val, 10));
        }
    }
    n = isNaN(n) ? options?.dflt || 0 : n;
    if (options) {
        if (typeof options.novalue == "number" && n === options.novalue) n = options.dflt || 0;
        if (typeof options.incr == "number") n += options.incr;
        if (typeof options.mult == "number") n *= options.mult;
        if (isNaN(n)) n = options.dflt || 0;
        if (typeof options.min == "number" && n < options.min) n = options.min;
        if (typeof options.max == "number" && n > options.max) n = options.max;
        if (typeof options.float != "undefined" && !options.float) n = Math.round(n);
        if (typeof options.zero == "number" && !n) n = options.zero;
        if (typeof options.digits == "number") n = parseFloat(n.toFixed(options.digits));
        if (options.bigint && typeof n == "number" && !Number.isSafeInteger(n)) n = BigInt(n);
    }
    return n;
}

/**
 * Strip all non-digit characters from a string
 * @param {string} str - input string
 * @return {string} only digit in the result
 * @memberof module:lib
 * @method toDigits
 */
lib.toDigits = function(str)
{
    return (typeof str == "string" ? str : String(str)).replace(this.rxNoDigits, "");
}

/**
 * Return a number clamped between the range
 * @param {number} num
 * @param {number} min
 * @param {number} max
 * @return {number}
 * @memberof module:lib
 * @method toClamp
 */
lib.toClamp = function(num, min, max)
{
  return Math.max(lib.toNumber(min), Math.min(lib.toNumber(num), lib.toNumber(max)));
}

/**
 * Return true if value represents true condition, i.e. non empty value
 * @param {string|number|boolean} val
 * @param {any} [dflt]
 * @return {boolean}
 * @memberof module:lib
 * @method toBool
 */
lib.toBool = function(val, dflt)
{
    if (typeof val == "boolean") return val;
    if (typeof val == "number") return val > 0;
    if (typeof val == "undefined" || typeof val == "function") val = dflt;
    return this.rxTrue.test(val);
}

/**
 * Return Date object for given text or numeric date representation, for invalid date returns 1969 unless `invalid` parameter is given,
 * in this case invalid date returned as null. If `dflt` is NaN, null or 0 returns null as well.
 * @param {string|Date|number} val
 * @param {any} [dflt]
 * @param {boolean} [invalid]
 * @return {Date}
 * @memberof module:lib
 * @method toDate
 */
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
    if (val) try { d = new Date(val); } catch (e) {}
    return this.isDate(d) ? d : invalid || (dflt !== undefined && isNaN(dflt)) || dflt === null || dflt === 0 ? null : new Date(dflt || 0);
}

/**
 * Return milliseconds from the date or date string, only number as dflt is supported, for invalid dates returns 0
 * @param {string|number|Date} val
 * @param {any} [dflt]
 * @return {number}
 * @memberof module:lib
 * @method toMtime
 */
lib.toMtime = function(val, dflt)
{
    val = this.toDate(val, null);
    return val ? val.getTime() : typeof dflt == "number" ? dflt : 0;
}

/**
 * Encode a string into Base64 url safe version
 * @memberof module:lib
 * @method toBase64url
 */
lib.toBase64url = function(str)
{
    if (typeof str != "string") return "";
    return Buffer.from(str).toString("base64").replace(/[=+/]/g, (_, x) => (x == '+' ? '-' : x == '/' ? '_' : ''));
}

/**
 * Decode base64url into a string
 * @memberof module:lib
 * @method fromBase64url
 */
lib.fromBase64url = function(str)
{
    if (typeof str != "string") return "";

    var padding = 4 - str.length % 4;
    if (padding != 4) {
        for (let i = 0; i < padding; ++i) str += '=';
    }
    str = str.replace(/[_-]/g, (_, x) => (x == '-' ? '+' : '/'));
    return Buffer.from(str, "base64").toString();
}

/**
 * Return base62 representation for a number
 * @memberof module:lib
 * @method toBase62
 */
lib.toBase62 = function(num, alphabet)
{
    var s = '';
    if (!alphabet) alphabet = this.base62;
    while (num > 0) {
        s = alphabet[num % alphabet.length] + s;
        num = Math.floor(num/alphabet.length);
    }
    return s;
}

/**
 * Convert base62 number as a string into base10 number
 * @memberof module:lib
 * @method fromBase62
 */
lib.fromBase62 = function(num, alphabet)
{
    if (typeof num != "string") return 0;
    var total = 0, c;
    if (!alphabet) alphabet = this.base62;
    for (let i = 0; i < num.length; i++) {
        c = num[num.length - 1 - i];
        total += this.base62.indexOf(c) * 62 ** i;
    }
    return total;
}

/**
 * Return a well formatted and validated url or empty string
 * @memberof module:lib
 * @method toUrl
 */
lib.toUrl = function(val, options)
{
    if (val) try { return new URL(val).toString() } catch (e) {}
    return "";
}

/**
 * Return a test representation of a number according to the money formatting rules, default is en-US, options may include:
 * currency(USD), display(symbol), sign(standard), min(2), max(3)
 * @memberof module:lib
 * @method toPrice
 */
lib.toPrice = function(num, options)
{
    try {
        return this.toNumber(num).toLocaleString(options?.locale || "en-US", { style: 'currency',
            currency: options?.currency || 'USD',
            currencyDisplay: options?.display || "symbol",
            currencySign: options?.sign || "standard",
            minimumFractionDigits: options?.min || 2,
            maximumFractionDigits: options?.max || 5 });
    } catch (e) {
        logger.error("toPrice:", e, num, options);
        return "";
    }
}

/**
 * Return an email address if valid, `options.parse` makes it extract the email from `name <email>` format
 * @memberof module:lib
 * @method toEmail
 */
lib.toEmail = function(val, options)
{
    if (typeof val != "string" || val.indexOf("..") > -1) return "";
    if (options?.parse) {
        var s = val.indexOf('<');
        if (s >= 0) {
            var e = val.indexOf('>', s);
            if (e > 0) val = val.substring(s + 1, e);
        }
    }
    if (options?.max && val.length > options.max) return "";
    return this.rxEmail.test(val) ? val.trim().toLowerCase() : "";
}

/**
 * Convert a value to the proper type, default is to return a string or convert the value to a string if no type is specified,
 * special case if the type is "" or null return the value as is without any conversion
 * @memberof module:lib
 * @method toValue
 */
lib.toValue = function(val, type, options)
{
    if (type === null || type === "") return val;
    type = typeof type == "string" && type.trim() || type;

    switch (type) {
    case "auto":
        if (typeof val == "undefined" || val === null) return "";
        type = this.autoType(val);
        return this.toValue(val, type, options);

    case "js":
        if (typeof val == "string") val = this.jsonParse(val, options);
        return val;

    case "set":
    case "list":
    case 'array':
        return this.strSplit(val, options?.separator, options);

    case "map":
        return lib.strSplit(val, options?.delimiter || ",").
                map((y) => (lib.strSplit(y, options?.separator || /[:;]/, options))).
                reduce((a, b) => {
                    let v;
                    if (b.length < 2) {
                        if (options?.empty) v = "";
                    } else {
                        v = b.length == 2 ? b[1] : b.slice(1);
                        if (options?.maptype) v = lib.toValue(v, options.maptype, options);
                    }
                    if (options?.noempty && lib.isEmpty(v)) return a;
                    if (options?.mapcamel) b[0] = lib.toCamel(b[0]);
                    a[b[0]] = v;
                    return a;
                }, {});

    case "expr":
    case "buffer":
        return val;

    case "real":
    case "float":
    case "double":
    case "decimal":
        return this.toNumber(val, options, 1);

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
        return this.toBool(val, options?.dflt);

    case "date":
    case "time":
    case "datetime":
    case "timestamp":
        return this.toDate(val, options?.dflt);

    case "mtime":
        return val ? this.toDate(val, options?.dflt).getTime() : 0;

    case "url":
        return this.toUrl(val, options);

    case "email":
        return this.toEmail(val, options);

    case "regexp":
        return this.toRegexp(val, options);

    case "phone":
    case "e164":
        if (typeof val == "number") {
            // Keep US phones without 1
            if (type[0] == "p" && val < 19999999999 && val > 10000000000) val -= 10000000000;
            if (type[0] == "e" && val < 10000000000) val += 10000000000;
            val = String(val);
        } else {
            if (typeof val != "string") return "";
            var d = val.match(this.rxPhone);
            if (!d) return "";
            val = this.toDigits(d[1]).slice(0, 15);
        }
        var min = typeof options?.min == "number" ? options.min : 5;
        if (min && val.length < min) return "";
        // Keep US phones without 1
        if (type[0] == "p" && val.length == 11 && val[0] == "1") val = val.substr(1);
        if (type[0] == "e" && val.length == 10) val = "1" + val;
        if (options?.max > 0 && val.length > options.max) return "";
        return val;

    case "json":
        return this.stringify(val);

    case "lower":
        return String(val).toLowerCase();

    case "upper":
        return String(val).toUpperCase();

    case "symbol":
        return this.rxSymbol.test(val) ? val : "";

    default:
        if (typeof options?.toValue == "function") return options.toValue(val, options);
        return this.toString(val, options);
    }
}

/**
 * Convert a value to a string, use default Javascript toString convertion of any object
 * @param {any} val
 * @return {string}
 * @memberof module:lib
 * @method toString
 */
lib.toString = function(val)
{
    return typeof val == "string" ? val : val === null || val === undefined ? "" : String(val);
}

/**
 * Safely create a regexp object, if invalid returns undefined, the options can be a string with srandard RegExp
 * flags or an object with the following properties:
 * - ingoreCase - similar to i
 * - globalMatch - similar to m
 * - multiLine - similar to m
 * - unicode - similar to u
 * - sticky - similar to y
 * - escape - escape all special symbols or symbol `e`
 * @memberof module:lib
 * @method toRegexp
 */
lib.toRegexp = function(str, options)
{
    if (str instanceof RegExp) return str;
    try {
        // Check for JSON stringified format
        if (typeof str == "string" && str.startsWith("^/") && str.endsWith("$")) {
            const e = str.lastIndexOf("/");
            if (e > -1) {
                options = str.slice(e + 1, -1)
                str = str.slice(2, e);
            }
        }
        var flags = typeof options == "string" && /^[igmuye]+$/.test(options) ? options :
                    options ? (options.ignoreCase ? "i" : "") +
                              (options.globalMatch ? "g" : "") +
                              (options.multiLine ? "m" : "") +
                              (options.unicode ? "u" : "") +
                              (options.escape ? "e" : "") +
                              (options.sticky ? "y" : "") : "";
        if (flags.indexOf("e") > -1) {
            if (str) str = str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            flags = flags.replace("e", "");
        }
        return new RegExp(str, flags);
    } catch (e) {
        logger.error('toRegexp:', str, options, e);
    }
}

/**
 * Add a regexp to the list of regexp objects, this is used in the config type `regexpmap`.
 * @memberof module:lib
 * @method toRegexpMap
 */
lib.toRegexpMap = function(obj, val, options)
{
    if (val == null) return [];
    if (this.typeName(obj) != "array") obj = [];
    if (options?.set) obj = [];
    val = this.jsonParse(val, { datatype: "obj", logger: "error" });
    if (!val && options?.errnull) return null;
    for (const p in val) {
        if (obj.some((x) => {
            var i = x.list.indexOf(p[0] == "!" ? p.substr(1) : p);
            if (i > -1 && p[0] == "!") {
                x.list.splice(i, 1);
                lib.toRegexpObj(x, "", options);
            }
            return i > -1;
        })) continue;
        var item = this.toRegexpObj(null, p, options);
        if (!item) continue;
        item.value = options?.json ? lib.jsonParse(val[p], options) :
                     options?.datatype ? lib.toValue(val[p], options) : val[p];
        if (item.reset) obj = [];
        obj.push(item);
    }
    return obj;
}

/**
 * Add a regexp to the object that consist of list of patterns and compiled regexp, this is used in the config type `regexpobj`
 * @memberof module:lib
 * @method toRegexpObj
 */
lib.toRegexpObj = function(obj, val, options)
{
    if (val == null) obj = null;
    if (this.typeName(obj) != "object") obj = {};
    if (!Array.isArray(obj.list)) obj.list = [];
    if (val) {
        if (typeof val == "string" && (options?.del || val[0] == "!")) {
            var idx = obj.list.indexOf(val[0] == "!" ? val.substr(1) : val);
            if (idx > -1) obj.list.splice(idx, 1);
        } else {
            if (options?.set) obj.list = [];
            if (!Array.isArray(val)) val = [ val ];
            for (var i in val) {
                if (typeof val[i] != "string") continue;
                if (obj.list.indexOf(val[i]) == -1) obj.list.push(val[i]);
            }
        }
    }
    if (obj.list.length) {
        try {
            var str = obj.list.map((x) => {
                if (options?.escape) x = x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                return "(" + x + ")";
            }).join("|")
            obj.rx = new RegExp(str, options?.regexp);
        } catch (e) {
            logger.error('toRegexpObj:', val, e);
            if (options?.errnull) return null;
        }
    } else {
        obj.rx = null;
    }
    return obj;
}

/**
 * Return duration in human format, mtime is msecs
 * - short - if true use first letters only
 * - round - a number, 1 return only 1st part, 2 - 1st and 2nd parts
 * @memberof module:lib
 * @method toDuration
 */
lib.toDuration = function(mtime, options)
{
    var str = "";
    mtime = typeof mtime == "number" ? mtime : this.toNumber(mtime);
    if (mtime > 0) {
        var lang = options?.lang;
        var seconds = Math.floor(mtime/1000);
        var d = Math.floor(seconds / 86400);
        var h = Math.floor((seconds - d * 86400) / 3600);
        var m = Math.floor((seconds - d * 86400 - h * 3600) / 60);
        var s = Math.floor(seconds - d * 86400 - h * 3600 - m * 60);
        if (d > 0) {
            str = d > 1 ? this.__({ phrase: options?.short ? "%sd" : "%s days", lang: lang }, d) :
                          this.__({ phrase: options?.short ? "%1d" : "1 day", lang: lang });
            if (options?.round == 1) return str;
            if (h > 0) str += " " + (h > 1 ? this.__({ phrase: options?.short ? "%sh" : "%s hours", lang: lang }, h) :
                                             this.__({ phrase: options?.short ? "1h" : "1 hour", lang: lang }));
            if (options?.round == 2) return str;
            if (m > 0) str += " " + (m > 1 ? this.__({ phrase: options?.short ? "%sm" : "%s minutes", lang: lang }, m) :
                                             this.__({ phrase: options?.short ? "1m" : "1 minute", lang: lang }));
        } else
        if (h > 0) {
            str = h > 1 ? this.__({ phrase: options?.short ? "%sh" : "%s hours", lang: lang }, h) :
                          this.__({ phrase: options?.short ? "1h" : "1 hour", lang: lang });
            if (options?.round == 1) return str;
            if (m > 0) str += " " + (m > 1 ? this.__({ phrase: options?.short ? "%sm" : "%s minutes", lang: lang }, m) :
                                             this.__({ phrase: options?.short ? "1m" : "1 minute", lang: lang }));
        } else
        if (m > 0) {
            str = m > 1 ? this.__({ phrase: options?.short ? "%sm" : "%s minutes", lang: lang }, m) :
                          this.__({ phrase: options?.short ? "1m" : "1 minute", lang: lang });
            if (options?.round == 1) return str;
            if (s > 0) str += " " + (s > 1 ? this.__({ phrase: options?.short ? "%ss" : "%s seconds", lang: lang }, s) :
                                             this.__({ phrase: options?.short ? "1s" : "1 second", lang: lang }));
        } else {
            str = seconds > 1 ? this.__({ phrase: options?.short ? "%ss" : "%s seconds", lang: lang }, seconds) :
                                this.__({ phrase: options?.short ? "1s" : "1 second", lang: lang });
        }
    }
    return str;
}

/**
 * Given time in msecs, return how long ago it happened
 * - short - if true use first letters only
 * - round - a number, 1 return only 1st part, 2 - 1st and 2nd parts
 * @memberof module:lib
 * @method toAge
 */
lib.toAge = function(mtime, options)
{
    var str = "";
    mtime = typeof mtime == "number" ? mtime : util.types.isDate(mtime) ? mtime.getTime() : this.toNumber(mtime);
    if (mtime > 0) {
        var lang = options?.lang;
        var secs = Math.max(0, Math.floor((Date.now() - mtime)/1000));
        var d = Math.floor(secs / 86400);
        var mm = Math.floor(d / 30);
        var w = Math.floor(d / 7);
        var h = Math.floor((secs - d * 86400) / 3600);
        var m = Math.floor((secs - d * 86400 - h * 3600) / 60);
        var s = Math.floor(secs - d * 86400 - h * 3600 - m * 60);
        if (mm > 0) {
            str = mm > 1 ? this.__({ phrase: options?.short ? "%sm": "%s months", lang: lang }, mm) :
                           this.__({ phrase: options?.short ? "1m" : "1 month", lang: lang });
            if (options?.round == 1) return str;
            if (d > 0) str += " " + (d > 1 ? this.__({ phrase: options?.short ? "%sd" : "%s days", lang: lang }, d) :
                                             this.__({ phrase: options?.short ? "1d" : "1 day", lang: lang }));
            if (options?.round == 2) return str;
            if (h > 0) str += " " + (h > 1 ? this.__({ phrase: options?.short ? "%sh" : "%s hours", lang: lang }, h) :
                                             this.__({ phrase: options?.short ? "1h": "1 hour", lang: lang }));
        } else
        if (w > 0) {
            str = w > 1 ? this.__({ phrase: options?.short ? "%sw" : "%s weeks", lang: lang }, w) :
                          this.__({ phrase: options?.short ? "1w" : "1 week", lang: lang });
            if (options?.round == 1) return str;
            if (d > 0) str += " " + (d > 1 ? this.__({ phrase: options?.short ? "%sd" : "%s days", lang: lang }, d) :
                                             this.__({ phrase: options?.short ? "1d" : "1 day", lang: lang }));
            if (options?.round == 2) return str;
            if (h > 0) str += " " + (h > 1 ? this.__({ phrase: options?.short ? "%sh" : "%s hours", lang: lang }, h) :
                                             this.__({ phrase: options?.short ? "1h" : "1 hour", lang: lang }));
        } else
        if (d > 0) {
            str = d > 1 ? this.__({ phrase: options?.short ? "%sd" : "%s days", lang: lang }, d) :
                          this.__({ phrase: options?.short ? "1d" : "1 day", lang: lang });
            if (options?.round == 1) return str;
            if (h > 0) str += " " + (h > 1 ? this.__({ phrase: options?.short ? "%sh" : "%s hours", lang: lang }, h) :
                                             this.__({ phrase: options?.short ? "1h" : "1 hour", lang: lang }));
            if (options?.round == 2) return str;
            if (m > 0) str += " " + (m > 1 ? this.__({ phrase: options?.short ? "%sm" : "%s minutes", lang: lang }, m) :
                                             this.__({ phrase: options?.short ? "1m" : "1 minute", lang: lang }));
        } else
        if (h > 0) {
            str = h > 1 ? this.__({ phrase: options?.short ? "%sh" : "%s hours", lang: lang }, h) :
                          this.__({ phrase: options?.short ? "1h" : "1 hour", lang: lang });
            if (options?.round == 1) return str;
            if (m > 0) str += " " + (m > 1 ? this.__({ phrase: options?.short ? "%sm" : "%s minutes", lang: lang }, m) :
                                             this.__({ phrase: options?.short ? "1m" : "1 minute", lang: lang }));
        } else
        if (m > 0) {
            str = m > 1 ? this.__({ phrase: options?.short ? "%sm" : "%s minutes", lang: lang }, m) :
                          this.__({ phrase: options?.short ? "1m" : "1 minute", lang: lang });
            if (options?.round == 1) return str;
            if (s > 0) str += " " + (s > 1 ? this.__({ phrase: options?.short ? "%ss" : "%s seconds", lang: lang }, s) :
                                             this.__({ phrase: options?.short ? "1s" : "1 second", lang: lang }));
        } else {
            str = secs > 1 ? this.__({ phrase: options?.short ? "%ss" : "%s seconds", lang: lang }, secs) :
                             this.__({ phrase: options?.short ? "1s" : "1 second", lang: lang });
        }
    }
    return str;
}

/**
 * Return size human readable format
 * @memberof module:lib
 * @method toSize
 */
lib.toSize = function(size, decimals)
{
    var i = size > 0 ? Math.floor(Math.log(size) / Math.log(1024)) : 0;
    return (size / Math.pow(1024, i)).toFixed(typeof decimals == "number" ? decimals : 2) * 1 + ' ' + [this.__('Bytes'), this.__('KBytes'), this.__('MBytes'), this.__('GBytes'), this.__('TBytes')][i];
}

/**
 * An object to be used with toParams for validation
 * @typedef {object} ParamsOptions
 * @memberof module:lib
 * @property {boolean} name - to save a value with different name than in the original query
 * @property {string} [type] - convert the input to the type format, default text
 *   Supported types:
 *   - string types: string, text,
 *   - boolean types: bool, boolean,
 *   - numeric types: int, bigint, long, number, float, real, double, counter, clock, now, random
 *   - object types: list, map, obj, object, array, json,
 *   - date/time types: mtime, date, time, timestamp, datetime
 *   - special types: set, email, symbol, url, phone, e164, regexp
 *
 * @property {boolean} [dflt] - use this value if property does not exists or undefined
 * @property {boolean} [dfltempty] - also use the dflt value for empty properties
 * @property {boolean} [required] - if true the target value must not be empty, the check is performed after type conversion,
 *       if an object it checks the target object using `lib.isMatched` at the end
 * @property {boolean} [errmsg] - return this error on error or invalid format or required condition, it may contain %s sprintf-like placeholders depending on the error
 * @property {boolean} [min] - minimum length for the target data, returns an error if smaller, for list type will skip item from the list
 * @property {boolean} [max] -  maximum length alowed, returns an error if longer
 * @property {boolean} [trunc] - if true and longer than max just truncate the value instead of returning an error or skipping
 * @property {boolean} [separator] - for list type default separator is `,|`, for map type default is `:;`
 * @property {boolean} [delimiter] - map type contains elements separated by , by default, use another if commas are expected
 * @property {boolean} [regexp] - validate input against this regexp and return an error if not matched, for list type skip items not matched
 * @property {boolean} [noregexp] - validate the input against this regexp and return an error if matched, for list type skip items matched
 * @property {boolean} [datatype] - convert each value or item into this type, used by string/list types
 * @property {boolean} [maptype] - for maps convert each value to this type
 * @property {boolean} [novalue] - if the target value equals then ignore the parameter,
 *       can be a list of values to be ignored or an object { name, value }.
 *       For lists this is a number of items in the list, if less or equal the list is ignored or reset.
 * @property {boolean} [ignore] - if true skip this parameter
 * @property {boolean} [optional] - for date types, if true do not assign the current time for empty values
 * @property {boolean} [value] - assign this value unconditionally
 * @property {boolean} [values] - a list of allowed values, if not present the parameter is ignored
 * @property {boolean} [values_map] - an object map for values, replace matching values with a new one
 * @property {boolean} [params] - an object with schema to validate for json/obj/array types
 * @property {boolean} [empty] - if true and the target value is empty return as empty, by default empty values are ignored
 * @property {boolean} [setempty] - to be used with `empty`, instead of skipping set with this value at the end
 * @property {boolean} [keepempty] - for list type keep empty items in the list, default is skip empty items
 * @property {boolean} [minlist] - min allowed length of the target array for list/map types, returns error if less
 * @property {boolean} [maxlist] - max allowed length of the target array for list/map types, returns error if longer
 * @property {boolean} [minnum] - min allowed number after convertion by toNumber, for numbers and mtime
 * @property {boolean} [maxnum] - max allowed number after convertion by toNumber, for numbers and mtime
 * @property {boolean} [mindate] - min allowed date after convertion by toDate, can be a Date or number
 * @property {boolean} [maxdate] - max allowed date after convertion by toDate, can be a Date or number
 * @property {boolean} [label] - alternative name to use in error messages which uses sprintf-like placeholders,
 *       all min/max like errors have name as first and threshold as second arg, label can be set to use friendlier name
 * @property {boolean} [strip] - a regexp with characters to strip from the final value
 * @property {boolean} [upper/lower] - transform case
 * @property {boolean} [cap] - capitalize the value
 * @property {boolean} [trim] - trim the final value if a string
 * @property {boolean} [replace] - an object map with characters to be replaced with other values
 * @property {boolean} [base64] - decode from base64
 */

/**
 * Process incoming query and convert parameters according to the type definition, the schema contains the definition of the paramaters against which to
 * validate incoming data. It is an object with property names and definitoons that at least must specify the type, all other options are type specific.
 *
 * Returns a string message on error or an object
 *
 * @param {object} query - request query object, usually req.query or req.body
 * @param {object} schema - an object in format: { name: {@link module:lib.ParamsOptions}, ...}
 * @param {object} [options] - options can define the following properties to customize convertion:
 * @param {boolean} [options.null] - always return null on any error
 * @param {boolean} [options.setnull] - if the value is equal this or any value if an array then set property to null, useful to reset lists, maps...
 * @param {boolean} [options.existing] - skip properties if not present in the query
 * @param {string} [options.prefix] - prefix to be used when searching for the parameters in the query, only properties with this prefix will be processed. The resulting
 *     object will not have this prefix in the properties.
 * @param {string} [options.dprefix] - prefix to use when checking for defaults, defaults are checks in this order: dprefix+name, name, *.type, *
 * @param {object} [options.defaults] - to pass realtime or other custom options for the validation or convertion utilities as the first argument if not defined in the definition,
 *     this is the place to customize/add/override global parameter conditions without changing it. Exact parameter name is used or a wildcard in the format
 *     `*.type` where type id any valid type supported or just `*` for all parameters. Special default '**' is always applied to all parameters.
 * @return {string|object} string in case of an error or an object
 * @example
 *
 *  var query = lib.toParams(req.query, {
 *        id: { type: "int" },
 *        count: { type: "int", min: 1, max: 10, dflt: 5 },
 *        age: { type: "int", minnum: 10, maxnum: 99 },
 *        name: { type: "string", max: 32, trunc: 1 },
 *        pair: { type: "map", maptype: "int" },
 *        code: { type: "string", regexp: /^[a-z]-[0-9]+$/, errmsg: "Valid code is required" },
 *        start: { type: "token", required: 1 },
 *        email: { type: "list", datatype: "email", novalue: ["a@a"] },
 *        email1: { type: "email", required: { email: null } },
 *        data: { type: "json", datatype: "obj" },
 *        mtime: { type: "mtime", name: "timestamp" },
 *        date: { type: "date", mindate: new Date(2000,1,1) },
 *        flag: { type: "bool", novalue: false },
 *        descr: { novalue: { name: "name", value: "test" }, replace: { "<": "!" } },
 *        internal: { ignore: 1 },
 *        tm: { type: "timestamp", optional: 1 },
 *        ready: { value: "ready" },
 *        state: { values: [ "ok","bad","good" ] },
 *        status: { value: [ "ok","done" ] },
 *        obj: { type: "obj", params: { id: { type: "int" }, name: {} } },
 *        arr: { type: "array", params: { id: { type: "int" }, name: {} } },
 *        ssn: { type: "string", regexp: /^[0-9]{3}-[0-9]{3}-[0-9]{4}$/, errmsg: "Valid SSN is required" },
 *        phone: { type: "list", datatype: "number" },
 *        }, {
 *        defaults: {
 *            start: { secret: req.user.secret },
 *            name: { dflt: "test" },
 *            count: { max: 100 },
 *            email: { ignore: req.user.roles != "admin" },
 *            "*.string": { max: 255 },
 *            '*': { maxlist: 255 },
 *        });
 *
 *  if (typeof query == "string) return api.sendReply(res, 400, query);
 *
 * @memberof module:lib
 * @method toParams
 */
lib.toParams = function(query, schema, options)
{
    var rc = {}, opts, dopts, dflts, p, n, v, required = [];
    dflts = options?.defaults || lib.empty;
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
        dopts = (options?.dprefix ? dflts[options.dprefix + name] : null) ||
                dflts[name] ||
                dflts[opts.type ? '*.' + opts.type : '*.string'] ||
                dflts['*'];
        for (const p in dopts) if (opts[p] === undefined) opts[p] = dopts[p];
        for (const p in dflts["**"]) if (opts[p] === undefined) opts[p] = dflts["**"][p];
        if (opts.ignore) continue;
        opts.name = n = opts.name || name;
        p = options?.prefix ? options.prefix + name : name;
        if (options?.existing && !(p in query)) continue;
        v = query[p];
        if (options?.setnull && (options.setnull === v || lib.isFlag(options.setnull, v))) {
            rc[n] = null;
            continue;
        }
        if (v === undefined || (opts.dfltempty && this.isEmpty(v))) v = opts.dflt;
        if (opts.value !== undefined) {
            var val = opts.value;
            switch (this.typeName(val)) {
            case "object":
                val = [ val ];
            case "array":
                for (const i in val) {
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
        logger.dev("toParams:", name, n, typeof v, v, "O:", opts, "D:", dopts);
        switch (opts.type) {
        case "set":
            if (v === undefined) {
                delete rc[n];
            } else {
                rc[n] = v;
            }
            break;

        case "boolean":
        case "bool":
            if (v !== undefined) rc[n] = this.toBool(v, opts.dflt);
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
            if (v !== undefined) rc[n] = this.toNumber(v, opts);
            break;

        case "regexp":
            if (typeof v != "string") break;
            if (opts.max > 0 && v.length > opts.max) {
                return options?.null ? null : this.__(opts.errmsg || "%s is too long, the max length is %s", opts.label || name, opts.max);
            }
            rc[n] = this.toRegexp(v, opts);
            break;

        case "list":
            if (!v && !opts.empty) break;
            v = opts.keepempty ? (Array.isArray(v) ? v : this.phraseSplit(v, opts)) : this.strSplit(v, opts.separator, opts);
            if (Array.isArray(opts.values)) v = v.filter((x) => (opts.values.indexOf(x) > -1));
            if (Array.isArray(opts.novalue)) v = v.filter((x) => (opts.novalue.indexOf(x) == -1));
            if (opts.minlist > 0 && v.length < opts.minlist) {
                return options?.null ? null : this.__(opts.errmsg || "%s is too short, the min size is %s", opts.label || name, opts.minlist);
            }
            if (opts.maxlist > 0 && v.length > opts.maxlist) {
                if (!opts.trunc) {
                    return options?.null ? null : this.__(opts.errmsg || "%s is too long, the max size is %s", opts.label || name, opts.maxlist)
                }
                v = v.slice(0, opts.maxlist);
            }
            if ((!v || !v.length) && !opts.empty) break;
            if (v && opts.flatten) v = this.arrayFlatten(v);
            rc[n] = v || [];
            break;

        case "map":
            if (!v && !opts.empty) break;
            v = lib.strSplit(v, opts.delimiter || ",");
            if (opts.maxlist > 0 && v.length > opts.maxlist) {
                if (!opts.trunc) {
                    return options?.null ? null : this.__(opts.errmsg || "%s is too long, the max size is %s", opts.label || name, opts.maxlist)
                }
                v = v.slice(0, opts.maxlist);
            }
            v = v.map((x) => (lib.strSplit(x, opts.separator || /[:;]/, opts))).
                  reduce((a, b) => {
                      if (b.length < 2) return a;
                      a[b[0]] = b.length == 2 ? b[1] : b.slice(1);
                      if (opts.maptype) a[b[0]] = lib.toValue(a[b[0]], opts.maptype, opts);
                      return a;
                  }, {});
            if (this.isEmpty(v) && !opts.empty) break;
            if (!rc[n]) rc[n] = {};
            for (const p in v) rc[n][p] = v[p];
            break;

        case "obj":
            if (!v && !opts.empty) break;
            v = this.toParams(v || lib.empty, opts.params, { prefix: options?.prefix, dprefix: options?.dprefix, defaults: dflts });
            if (typeof v == "string") return options?.null ? null : v;
            if (opts.max > 0 && lib.objSize(v) > opts.max) {
                return options?.null ? null : this.__(opts.errmsg || "%s is too large, the max size is %s", opts.label || name, opts.max)
            }
            if (!this.isEmpty(v) || opts.empty) rc[n] = v;
            break;

        case "object":
            if (!lib.isObject(v)) break;
            if (opts.params) {
                v = this.toParams(v, opts.params, { prefix: options?.prefix, dprefix: options?.dprefix, defaults: dflts });
                if (typeof v == "string") return options?.null ? null : v;
            }
            if (opts.max > 0 && lib.objSize(v) > opts.max) {
                return options?.null ? null : this.__(opts.errmsg || "%s is too large, the max size is %s", opts.label || name, opts.max)
            }
            if (!this.isEmpty(v) || opts.empty) rc[n] = v;
            break;

        case "array":
            if (!v && !opts.empty) break;
            v = lib.isArray(v, []);
            if (opts.params) {
                const list = [];
                for (let a of v) {
                    a = lib.toParams(a, opts.params, { prefix: options?.prefix, dprefix: options?.dprefix, defaults: dflts })
                    if (typeof a == "string") return options?.null ? null : a;
                    list.push(a);
                }
                v = list;
            }
            if (opts.minlist > 0 && v.length < opts.minlist) {
                return options?.null ? null : this.__(opts.errmsg || "%s is too short, the min length is %s", opts.label || name, opts.minlist)
            }
            if (opts.maxlist > 0 && v.length > opts.maxlist) {
                if (!opts.trunc) {
                    return options?.null ? null : this.__(opts.errmsg || "%s is too long, the max length is %s", opts.label || name, opts.maxlist)
                }
                v = v.slice(0, opts.maxlist);
            }
            if (v.length || opts.empty) rc[n] = v;
            break;

        case "token":
            if (!v) break;
            if (opts.max > 0 && v.length > opts.max) {
                return options?.null ? null : this.__(opts.errmsg || "%s is too long, the max length is %s", opts.label || name, opts.max);
            }
            rc[n] = this.base64ToJson(v, opts.secret);
            break;

        case "mtime":
            if (!v) break;
            v = this.toDate(v, opts.dflt, true);
            if (v) {
                if (opts.mindate && v < opts.mindate) {
                    return options?.null ? null : this.__(opts.errmsg || "%s is too soon, the earliest date is %s", opts.label || name, lib.toDate(opts.mindate));
                }
                if (opts.maxdate && v > opts.maxdate) {
                    return options?.null ? null : this.__(opts.errmsg || "%s is too late, the latest date is %s", opts.label || name, lib.toDate(opts.maxdate));
                }
                rc[n] = v.getTime();
            }
            break;

        case "date":
        case "time":
            if (v) v = this.toDate(v, opts.dflt, true);
            if (v) {
                if (opts.mindate && v < opts.mindate) {
                    return options?.null ? null : this.__(opts.errmsg || "%s is too soon, the earliest date is %s", opts.label || name, lib.toDate(opts.mindate));
                }
                if (opts.maxdate && v > opts.maxdate) {
                    return options?.null ? null : this.__(opts.errmsg || "%s is too late, the latest date is %s", opts.label || name, lib.toDate(opts.maxdate));
                }
                rc[n] = v;
            }
            break;

        case "datetime":
            if (!opts.optional && (!v || (typeof v == "boolean" && v))) v = Date.now();
            if (v) v = this.toDate(v, opts.dflt);
            if (v) {
                if (opts.mindate && v < opts.mindate) {
                    return options?.null ? null : this.__(opts.errmsg || "%s is too soon, the earliest date is %s", opts.label || name, lib.toDate(opts.mindate));
                }
                if (opts.maxdate && v > opts.maxdate) {
                    return options?.null ? null : this.__(opts.errmsg || "%s is too late, the latest date is %s", opts.label || name, lib.toDate(opts.maxdate));
                }
                rc[n] = this.strftime(v, opts.format || "%Y/%m/%d %H:%M");
            }
            break;

        case "timestamp":
            if (!opts.optional && (!v || (typeof v == "boolean" && v))) v = Date.now();
            if (v) v = this.toDate(v, opts.dflt, true);
            if (v) {
                if (opts.mindate && v < opts.mindate) {
                    return options?.null ? null : this.__(opts.errmsg || "%s is too soon, the earliest date is %s", opts.label || name, lib.toDate(opts.mindate));
                }
                if (opts.maxdate && v > opts.maxdate) {
                    return options?.null ? null : this.__(opts.errmsg || "%s is too late, the latest date is %s", opts.label || name, lib.toDate(opts.maxdate));
                }
                rc[n] = opts.format ? this.strftime(v, opts.format) : v.toISOString();
            }
            break;

        case "json":
            if (typeof v != "string") break;
            if (opts.max > 0 && v.length > opts.max) {
                return options?.null ? null : this.__(opts.errmsg || "%s is too long, the max length is %s", opts.label || name, opts.max);
            }
            if (opts.base64) v = Buffer.from(v, "base64").toString();
            v = this.jsonParse(v, opts);
            if (opts.params) {
                v = this.toParams(v, opts.params, { prefix: options?.prefix, dprefix: options?.dprefix, defaults: dflts });
                if (typeof v == "string") return options?.null ? null : v;
            }
            if (v || opts.empty) rc[n] = v;
            break;

        default:
            if (typeof v == "undefined" || v === null) break;
            v = typeof v == "string" ? v : String(v);
            switch (opts.type) {
            case "symbol":
            case "email":
            case "phone":
            case "e164":
            case "url":
                if (v) {
                    v = this.toValue(v.trim(), opts.type, opts);
                }
                break;
            }
            if (opts.trim) v = v.trim();
            if (opts.base64) v = Buffer.from(v, "base64").toString();

            if (opts.max && v.length > opts.max) {
                if (!opts.trunc) {
                    return options?.null ? null : this.__(opts.errmsg || "%s is too long, the max length is %s", opts.label || name, opts.max);
                }
                v = v.substr(0, opts.max);
            }
            if (opts.min > 0 && v.length < opts.min) {
                return options?.null ? null : this.__(opts.errmsg || "%s is too short, the min length is %s", opts.label || name, opts.min);
            }
            if (opts.noregexp) {
                const rx = lib.isArray(opts.noregexp, [opts.noregexp]);
                if (rx.some((r) => (lib.testRegexp(v, r)))) {
                    if (!opts.required && opts.errmsg) return options?.null ? null : typeof opts.errmsg == "string" ? opts.errmsg : this.__("invalid characters in %s", opts.label || name);
                    break;
                }
            } else
            if (opts.regexp) {
                const rx = lib.isArray(opts.regexp, [opts.regexp]);
                if (!rx.some((r) => (lib.testRegexp(v, r)))) {
                    if (!opts.required && opts.errmsg) return options?.null ? null : typeof opts.errmsg == "string" ? opts.errmsg : this.__("invalid characters in %s", opts.label || name);
                    break;
                }
            }
            if (opts.replace) {
                for (const p in opts.replace) {
                    v = v.replaceAll(p, opts.replace[p]);
                }
            }
            if (opts.strip) v = v.replace(opts.strip, "");
            if (opts.upper) v = v.toUpperCase();
            if (opts.lower) v = v.toLowerCase();
            if (opts.camel) v = lib.toCamel(v, opts.camel);
            if (opts.cap) v = lib.toTitle(v, opts.cap);
            if (opts.datatype) v = lib.toValue(v, opts.datatype, opts);
            if (!v && !opts.empty) break;
            rc[n] = v;
            break;
        }
        v = rc[n];
        if (this.isEmpty(v)) {
            if (opts.setempty !== undefined) {
                v = rc[n] = opts.setempty;
            }
        } else {
            switch (opts.type) {
            case "list":
                if (typeof opts.novalue == "number" && v.length <= opts.novalue) {
                    delete rc[n];
                }
                break;

            default:
                if (typeof v == "number") {
                    if (opts.maxnum && v > opts.maxnum) {
                        return options?.null ? null : this.__(opts.errmsg || "%s is too large, the max value is %s", opts.label || name, opts.maxnum);
                    }
                    if (opts.minnum > 0 && v < opts.minnum) {
                        return options?.null ? null : this.__(opts.errmsg || "%s is too small, the min value is %s", opts.label || name, opts.minnum);
                    }
                }
                if (Array.isArray(opts.values) && !opts.values.includes(v)) {
                    delete rc[n];
                } else
                // Delete if equal to a special value(s)
                if (v === opts.novalue || Array.isArray(opts.novalue) && opts.novalue.includes(v)) {
                    delete rc[n];
                } else
                if (typeof opts.novalue == "object") {
                    if (v === rc[opts.novalue.name] || v === opts.novalue.value) delete rc[n];
                } else
                if (lib.isArray(opts.values_map)) {
                    for (let i = 0; i < opts.values_map.length - 1; i += 2) {
                        if (v === opts.values_map[i]) {
                            v = rc[n] = opts.values_map[i + 1];
                            break;
                        }
                    }
                }
            }
        }

        // Return an error if required, delay checks for complex conditions
        if (opts.required && this.isEmpty(rc[n])) {
            if (typeof opts.required != "object") {
                return options?.null ? null : opts.errmsg || this.__("%s is required", opts.label || name);
            }
            required.push(opts);
        }
    }
    // Delayed required checks against all properties
    for (const req of required) {
        if (this.isMatched(rc, req.required)) {
            return options?.null ? null : opts.errmsg || this.__("%s is required", req.label || req.name);
        }
    }
    return rc;
}

/**
 * Convert a list of records into the specified format, supported formats are: `xml, csv, json, jsontext`.
 * - For `csv` the default separator is comma but can be specified with `options.separator`. To produce columns header specify `options.header`.
 * - For `json` format puts each record as a separate JSON object on each line, so to read it back
 *   it will require to read every line and parse it and add to the list.
 * - For `xml` format the name of the row tag is `<row>` but can be
 *   specified with `options.tag`.
 *
 * All formats support the property `options.allow` which is a list of property names that are allowed only in the output for each record, non-existent
 * properties will be replaced by empty strings.
 *
 * The `mapping` object property can redefine different tag/header names to be put into the file instead of the exact column names from the records.
 * @memberof module:lib
 * @method toFormat
 */
lib.toFormat = function(format, data, options)
{
    var rows = Array.isArray(data) ? data : Array.isArray(data.data) ? data.data : this.isObject(data) ? [ data ] : [];
    if (!rows.length) return "";
    var allow = this.isArray(options?.allow);
    var v, map = options?.mapping || this.empty, text = "";

    switch (format) {
    case "xml":
        var tag = options?.tag || "row";
        for (var i = 0; i < rows.length; i++) {
            text += "<" + tag + ">\n";
            text += (allow || Object.keys(rows[i])).map((y) => {
                v = rows[i][y];
                v = Array.isArray(v) ? v.join(",") : typeof v == "object" ? lib.stringify(v) : String(v ?? "");
                var t = map[y] || y;
                return "<" + t + ">" + lib.textToXml(v) + "</" + t + ">\n";
            });
            text += "</" + tag + ">\n";
        }
        break;

    case "csv":
        var keys;
        var sep = options?.separator || ",";
        var quotes = options?.quotes || '"';
        var rx = new RegExp("[\r\n" + sep + quotes + "]");

        if (options?.header) {
            keys = allow || Object.keys(rows[0]);
            text += keys.map((x) => (map[x] || x)).join(sep) + "\r\n";
        }
        for (let i = 0; i < rows.length; i++) {
            keys = allow || Object.keys(rows[i]);
            text += keys.map((y) => {
                v = rows[i][y];
                v = Array.isArray(v) ? v.join(",") : typeof v == "object" ? lib.stringify(v) : String(v ?? "");
                if (!options?.newlines) {
                    v = v.replace(/[\r\n]/g, " ");
                }
                if (rx.test(v)) {
                    v = quotes + v.replaceAll(quotes, quotes + quotes) + quotes;
                }
                return v;
            }).join(sep) + "\r\n";
        }
        break;

    case "jsontext":
        for (let i = 0; i < rows.length; i++) {
            v = allow ? allow.reduce((x,y) => { if (!lib.isEmpty(rows[i][y])) x[map[y] || y] = rows[i][y]; return x }, {}) : rows[i];
            text += this.jsonFormat(v, options) + "\n";
        }
        break;

    default:
        for (let i = 0; i < rows.length; i++) {
            v = allow ? allow.reduce((x,y) => { if (!lib.isEmpty(rows[i][y])) x[map[y] || y] = rows[i][y]; return x }, {}) : rows[i];
            text += lib.stringify(v) + "\n";
        }
    }
    return text;
}

/**
 * Given a template with @..@ placeholders, replace each placeholder with the value from the obj.
 * The `obj` can be an object or an array of objects in which case all objects will be checked for the value until non empty.
 *
 * To use @ in the template specify it as @@
 *
 * Placeholders can have default or/and encoding
 *
 *  - default only: `@name|dflt@`
 *  - encoding with default: `@name|dflt|encoding@`
 *  - encoding no default: `@name||encoding@`
 *
 * Encoding options:
 * - url, base64, entity, strftime, mtime
 * - d-url, d-base64, d-entity - decode value instead of encode it
 *
 * The options if given may provide the following:
 * - allow - placeholders with a name present in this list will be replaced, all other will be replaced with empty string
 * - skip - placeholders with a name present in this list will be ignored, the placeholer will be kept
 * - only - placeholders with a name present in this list will be replaced only, all other will be ignored and kept as placeholders
 * - encoding - can be url or base64, the replaced values will be encoded accordingly
 * - separator1 - left side of the placehoder, default is @
 * - separator2 - right side of the placeholder, default is @
 *
 * Default placeholders:
 * - @exit@ - stop processing and return the template ignoring the rest
 * - @RAND@ - produce a random number using Math.random
 * - @n@ - produce a line break, newline
 * - @p@ - produce 2 newlines
 *
 * @example
 *
 * lib.toTemplate("http://www.site.com/@code@/@id@", { id: 123, code: "YYY" }, { encoding: "url" })
 * lib.toTemplate("Hello @name|friend@!", {})
 *
 * @memberof module:lib
 * @method toTemplate
 */

lib.toTemplate = function(text, obj, options)
{
    function encoder(enc, v) {
        switch (enc) {
        case "url":
            if (typeof v != "string") v = String(v);
            v = this.encodeURIComponent(v);
            break;
        case "d-url":
            if (typeof v != "string") v = String(v);
            v = this.decodeURIComponent(v);
            break;
        case "base64":
            if (typeof v != "string") v = String(v);
            v = Buffer.from(v).toString("base64");
            break;
        case "d-base64":
            if (typeof v != "string") v = String(v);
            v = Buffer.from(v, "base64").toString();
            break;
        case "entity":
            v = this.textToEntity(v);
            break;
        case "d-entity":
            v = this.entityToText(v);
            break;
        case "strftime":
            v = lib.strftime(v);
            break;
        case "mtime":
            v = lib.toMtime(v);
            break;
        case "price":
            v = lib.toPrice(v, options);
            break;
        }
        return v;
    }
    return this._toTemplate(text, obj, options, encoder);
}

lib._toTemplate = function(text, obj, options, encoder)
{
    if (typeof text != "string" || !text) return "";
    var i, j, rc = [], top;
    if (!options) options = {};
    if (options.__exit === undefined) {
        top = 1;
        options.__exit = 0;
    }
    if (!Array.isArray(obj)) obj = [obj];
    for (i = 0; i < obj.length; i++) {
        if (typeof obj[i] == "object" && obj[i]) rc.push(obj[i]);
    }

    const rxVal = /^([a-zA-Z0-9._-]+)(\|.+)?$/;
    const rxIf = /^(if|ifnull|ifnotnull|ifempty|ifnotempty|ifne|ifeq|ifgt|ifge|iflt|ifle|ifnot|ifall|ifstr|ifnotstr) ([a-zA-Z0-9._-]+) *(.*)$/;

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
        var d, v = null, dflt = null, field = null, enc = options.encoding;

        if (tag == "") {
            v = sep1;
        } else

        if (tag == "exit") {
            options.__exit = 1;
            break;
        } else

        if (tag == "RAND") {
            v = Math.random();
            tmpl += v;
            continue;
        } else

        if (tag == "n" || tag == "p") {
            v = tag == "p" ? "\n\n" : "\n";
            tmpl += v;
            continue;
        } else

        if (tag.startsWith("if")) {
            // @if type tester,admin@
            // @endif@
            end = str.indexOf(sep1 + "endif" + sep2);
            if (end == -1) continue;
            var body = str.substr(0, end);
            str = str.substr(end + 5 + sep1.length + sep2.length);
            d = tag.match(rxIf)
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
            case "ifnull":
                ok = val === null || val === undefined;
                break;
            case "ifnotnull":
                ok = !!val;
                break;
            case "ifempty":
                ok = lib.isEmpty(val);
                break;
            case "ifnotempty":
                ok = !lib.isEmpty(val);
                break;
            case "if":
                ok = val && lib.isFlag(lib.strSplit(d[3]), lib.strSplit(val));
                break;
            case "ifne":
                ok = val != d[3];
                break;
            case "ifnot":
                ok = !val || !lib.isFlag(lib.strSplit(d[3]), lib.strSplit(val));
                break;
            case "ifall":
                val = lib.strSplit(val);
                ok = lib.strSplit(d[3]).every((x) => (val.includes(x)));
                break;
            case "ifstr":
                ok = lib.testRegexp(val || "", lib.toRegexp(d[3], "i"));
                break;
            case "ifnotstr":
                ok = !lib.testRegexp(val || "", lib.toRegexp(d[3], "i"));
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
            end = body.indexOf(sep1 + "else" + sep2);
            if (ok) {
                if (end > -1) body = body.substr(0, end);
                v = this.toTemplate(body, rc, options);
            } else
            if (end > -1) {
                body = body.substr(end + 4 + sep1.length + sep2.length);
                v = this.toTemplate(body, rc, options);
            }
        } else {
            d = tag.match(rxVal);
            if (d) {
                tag = d[1];
                if (d[2]) dflt = d[2].substr(1);
                i = tag.indexOf(".");
                if (i > 0) {
                    field = tag.substr(i + 1);
                    tag = tag.substr(0, i);
                }
                if (dflt) {
                    i = dflt.indexOf("|");
                    if (i >= 0) {
                        enc = dflt.substr(i + 1);
                        dflt = dflt.substr(0, i);
                    }
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
                if (typeof options.preprocess == "function") v = options.preprocess(tag, field, v, dflt, enc);
            } else {
                tmpl += sep1 + tag;
                str = sep2 + str;
                continue;
            }
            if (Array.isArray(options.allow) && !options.allow.includes(tag)) continue;
            if (Array.isArray(options.skip) && options.skip.includes(tag)) continue;
            if (Array.isArray(options.only) && !options.only.includes(tag)) v = sep1 + tag + sep2;
        }
        v ??= dflt;
        if (v) {
            if (Array.isArray(v) && (typeof v[0] == "string" || typeof v[0] == "number")) v = v.toString(); else
            if (typeof v == "object") v = this.stringify(v);
            if (encoder) v = encoder(enc, v, options);
        }
        if (v !== null && v !== undefined && v !== "") tmpl += v;
        if (options.__exit) break;
    }
    if (options.noline) tmpl = tmpl.replace(/[\r\n]/g, "");
    if (options.nospace) tmpl = tmpl.replace(/ {2,}/g, " ").trim();
    if (top) delete options.__exit;
    return tmpl;
}

/**
 * Flags command utility, the commands are:
 * - add - adds the `name` flags to the list if does not exists, returns the same array
 * - update - adds new flags and removes flags that starts with - , returns the same array
 * - concat - same as add but always returns a new list
 * - del - removes the flags `name`, returns the same array
 * - present - returns only flags that present in the list `name`
 * - absent - returns only flags that are not present in the list `name`
 * @memberof module:lib
 * @method toFlags
 */
lib.toFlags = function(cmd, list, name)
{
    switch (cmd) {
    case "concat":
        list = Array.isArray(list) ? list.slice(0) : [];
    case "add":
        if (!Array.isArray(list)) list = [];
        if (!Array.isArray(name)) {
            if (name && !list.includes(name)) list.push(name);
        } else {
            name.forEach((x) => {
                if (x && !list.includes(x)) list.push(x);
            });
        }
        break;

    case "update":
        if (!Array.isArray(list)) list = [];
        if (!Array.isArray(name)) name = [name];
        name.forEach((x) => {
            if (typeof x == "string" && x[0] == "-") {
                var i = list.indexOf(x.substr(1));
                if (i > -1) list.splice(i, 1);
            } else {
                if (x && !list.includes(x)) list.push(x);
            }
        });
        break;

    case "del":
        if (!Array.isArray(list)) return [];
        if (!Array.isArray(name)) name = [name];
        name.forEach((x) => {
            var i = x && list.indexOf(x);
            if (i > -1) list.splice(i, 1);
        });
        break;

    case "present":
        if (!Array.isArray(list)) return [];
        if (!Array.isArray(name)) return list;
        list = list.filter((x) => (name.includes(x)));
        break;

    case "absent":
        if (!Array.isArray(list)) return [];
        if (!Array.isArray(name)) return list;
        list = list.filter((x) => (!name.includes(x)));
        break;
    }
    return list;
}

/**
 * Return RFC3339 formatted timestamp for a date or current time
 * @memberof module:lib
 * @method toRFC3339
 */
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

/**
 * Stringify JSON into base64 string, if secret is given, sign the data with it
 * @memberof module:lib
 * @method jsonToBase64
 */
lib.jsonToBase64 = function(data, secret, options)
{
    data = this.stringify(data);
    if (secret) return this.encrypt(secret, data, options);
    return Buffer.from(data).toString("base64");
}

/**
 * Parse base64 JSON into JavaScript object, in some cases this can be just a number then it is passed as it is, if secret is given verify
 * that data is not chnaged and was signed with the same secret
 * @memberof module:lib
 * @method base64ToJson
 */
lib.base64ToJson = function(data, secret, options)
{
    var rc = "";
    if (typeof data == "undefined" || data == null) return rc;
    if (secret) data = this.decrypt(secret, data, options);
    try {
        if (typeof data == "number" || (typeof data == "string" && data.match(/^[0-9]+$/))) {
            rc = this.toNumber(data);
        } else {
            if (!secret) data = Buffer.from(data, "base64").toString();
            if (data) rc = JSON.parse(data);
        }
    } catch (e) {
        logger.debug("base64ToJson:", e.stack, data);
    }
    return rc;
}

lib._jsonFormatPresets = {
    default: {
        indent: "",
        ilevel: 0,
        nl1: "\n",
        nl2: "\n",
        sbracket1: "[",
        sbracket2: "]",
        cbracket1: "{",
        cbracket2: "}",
        quote1: '"',
        quote2: '"',
        squote1: '"',
        squote2: '"',
        space: " ",
        nspace: 4,
        comma: ", ",
        sep: ", ",
        prefix: "",
        delim: " \r\n\t.,:;?!/-",
        over: 1.25,
    },
    compact: {
        sbracket1: "",
        sbracket2: "",
        cbracket1: "",
        cbracket2: "",
        nl1: "\n",
        nl2: "",
        quote1: "",
        quote2: "",
        squote1: "",
        squote2: "",
        comma: "",
        sep: "",
        space: " ",
        prefix: "   - ",
        skipnull: 1,
        skipempty: 1,
        wrap: 80,
    },
    html: {
        nl1: "<br>",
        prefix: "&nbsp;&nbsp;-&nbsp;",
        space: "&nbsp;",
    },
};

/**
 * Register or update a jsonFormat preset
 * @memberof module:lib
 * @method jsonFormatPreset
 */
lib.jsonFormatPreset = function(name, options)
{
    if (!name) return;
    var preset = lib._jsonFormatPresets[name];
    if (!preset) preset = preset = lib._jsonFormatPresets[name] = {};
    for (const p in options) preset[p] = options[p];
    return preset;
}

/**
 * Nicely format an object with indentations, optional `indentlevel` can be used to control until which level deep to use newlines for objects.
 * Options:
 * - preset - predefined set of options, `compact` prints yaml-like text version, if a list all presets are combined
 * - indent - initial indent, empty default
 * - ilevel - level to start to use spaces for indentation, 0 default
 * - ignore - regexp with properties to ingore
 * - skipnull - do not print null/undefined/""
 * - skipempty - skip all empty object accorsding to `lib.isEmpty`
 * - map - an object to map property names
 * - replace - an object for string values replacement: { ORIG: REPL... }
 * - preprocess - a function(name, val, options) to run before prints, return undefined to skip
 * - sbracket1, sbracket2 - open/close brackets for arrays, [ ]
 * - cbracket1, cbracket2 - open close brackets for obejcts, { }
 * - nl1, nl2 - newline chars before and after a single property
 * - quote1, quote2 - quotes for property names
 * - squote1, squote2 - quotes for string values
 * - comma - comma separator between items
 * - sep - separator between array items, comma by default
 * - space - symbol for indentation
 * - nspace - how many spaces to use for indentation, 4
 * - prefix - prefix for array items, each item on new line, requires `nl1`
 * - wrap - wrap long strings at this length
 * - over - number greater than 1 to allow extra characters over wrap length
 * - delim - characters that trigger wrapping
 * @memberof module:lib
 * @method jsonFormat
 */
lib.jsonFormat = function(obj, options)
{
    if (typeof options == "string") options = { indent: options, __level: 0 };
    if (!options) options = { __level: 0 };
    if (typeof options.__level != "number") options = lib.objClone(options, { __level: 0 });

    // Shortcut to parse and format json from the string
    if (typeof obj == "string" && obj != "") {
        if (!/^[[{.+]}]$/.test(obj.trim())) return obj;
        obj = this.jsonParse(obj, { dflt: { data: obj } });
    }

    if (!options.__preset) {
        var presets = lib.isArray(options.preset, [options.preset]);
        var preset = Object.assign({}, lib._jsonFormatPresets.default, ...presets.map((x) => (lib._jsonFormatPresets[x])));
        for (const p in preset) {
            if (options[p] === undefined) options[p] = preset[p];
        }
        options.__preset = 1;
    }

    var type = this.typeName(obj);
    var count = 0, val, h, t, indent;
    var text = type == "array" ? options.sbracket1 : options.cbracket1;
    var map = options.map || lib.empty;
    // Insert newlines only until specified level deep
    var nline = !options.indentlevel || options.__level < options.indentlevel;
    // Top level prefix set, skip new line for the first item
    var prefix = options.__prefix;
    delete options.__prefix;

    for (let name in obj) {
        if (options.ignore && options.ignore.test(name)) continue;
        val = obj[name];
        if (typeof options.preprocess == "function") {
            val = options.preprocess(name, val, options);
            if (val === undefined) continue;
        }

        if (options.skipnull && (val === "" || val === null || val === undefined)) continue;
        if (options.skipempty && this.isEmpty(val)) continue;
        if (options.skipvalue && options.skipvalue.test(val)) continue;

        h = options.hide && options.hide.test(name);
        if (count > 0) {
            text += type == "array" ? options.sep : options.comma;
        }
        name = map[name] || name;
        if (type != "array") {
            if (nline && options.nl1) {
                text += !count && (prefix || !options.__level) ? "" : options.nl1;
            }
            indent = "";
            if (!prefix || count) indent = options.indent;
            if (!prefix && options.__level >= options.ilevel) {
                indent += options.space.repeat(options.nspace);
            }
            t = options.quote1 + name + options.quote2 + ": ";
            text += indent + t;
            indent += options.space.repeat(t.length);
        } else
        if (options.prefix && options.nl1) {
            indent = options.indent + options.prefix;
            text += options.nl1 + indent;
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
            if (type == "array" && options.prefix && options.nl1) {
                indent = options.__prefix = options.space.repeat(options.prefix.length);
            } else {
                indent = options.space.repeat(options.nspace);
            }
            options.indent += indent;
            options.__seen.push(val);
            options.__level++;
            text += this.jsonFormat(val, options);
            options.__level--;
            options.__seen.pop(val);
            options.indent = options.indent.substr(0, options.indent.length - indent.length);
            break;

        case "boolean":
        case "number":
            text += h ? "..." : val.toString();
            break;

        case "null":
            text += "null";
            break;

        case "string":
            if (h) {
                text += "...";
                break;
            }
            for (const r in options.replace) {
                val = val.replaceAll(r, options.replace[r]);
            }
            if (options.wrap > 0 && val.length > options.wrap && options.nl1) {
                text += lib.strWrap(val, { quotes: [options.squote1, options.squote2], wrap: options.wrap, nl: options.nl1, over: options.over, delim: options.delim, indent });
            } else {
                text += options.squote1 + val + options.squote2;
            }
            break;

        case "error":
        case "date":
        case "regexp":
            text += h ? "..." : val.toString();
            break;

        default:
            text += ("unknown: " + typeof(val));
        }
        count++;
    }
    text += type == "array" ? options.sbracket2 : ((nline && options.nl2 ? options.nl2 + options.indent : "") + options.cbracket2);
    return text;
}

/**
 * JSON stringify without exceptions, on error just returns an empty string and logs the error
 * @memberof module:lib
 * @method stringify
 */
lib.stringify = function(obj, replacer, space)
{
    try {
        return this.escapeUnicode(replacer || space ? JSON.stringify(obj, replacer, space) : JSON.stringify(obj));
    } catch (e) {
        logger.error("stringify:", e);
        return "";
    }
}

/**
 * Encode with additional symbols, convert these into percent encoded:
 *
 *          ! -> %21, * -> %2A, ' -> %27, ( -> %28, ) -> %29
 * @memberof module:lib
 * @method encodeURIComponent
 */
lib.encodeURIComponent = function(str)
{
    if (typeof str == "undefined") return "";
    try {
        return encodeURIComponent(str).replace(/[!'()*]/g, (c) => (`%${c.charCodeAt(0).toString(16).toUpperCase()}`));
    } catch (e) {
        logger.error("encodeURIComponent:", str, e.stack);
        return ""
    }
}
lib.escape = lib.encodeURIComponent;

/**
 * No-exception version of the global function, on error return empty string
 * @memberof module:lib
 * @method decodeURIComponent
 */
lib.decodeURIComponent = function(str)
{
    if (typeof str == "undefined") return "";
    try {
        return decodeURIComponent(str);
    } catch (e) {
        logger.error("decodeURIComponent:", str, e.stack);
        return "";
    }
}

/**
 * Convert all Unicode binary symbols into Javascript text representation
 * @memberof module:lib
 * @method escapeUnicode
 */
lib.escapeUnicode = function(text)
{
    return String(text).replace(/[\u007F-\uFFFF]/g, (m) => ("\\u" + ("0000" + m.charCodeAt(0).toString(16)).substr(-4)));
}

lib._unicodeCache = {};

/**
 * Replace Unicode symbols with ASCII equivalents, types is a string with list of types of characters to
 * replace, default is: opqs, for quotes,other,punctuations,spaces
 * @memberof module:lib
 * @method unicode2Ascii
 */
lib.unicode2Ascii = function(str, types)
{
    if (typeof str != "string") return "";
    types = typeof types == "string" && types || "opqs";
    var map = this._unicodeCache[types];
    if (!map) {
        map = this._unicodeCache[types] = {};
        for (var t of types) {
            Object.assign(this._unicodeCache[types], this.unicodeAsciiMap[t]);
        }
    }
    var rc = "";
    for (var c of str) rc += map[c] || c;
    return rc.trim();
}

/**
 * Convert escaped characters into native symbols
 * @memberof module:lib
 * @method unescape
 */
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

/**
 * Convert all special symbols into xml entities
 * @memberof module:lib
 * @method textToXml
 */
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

/**
 * Convert all special symbols into html entities
 * @memberof module:lib
 * @method textToEntity
 */
lib.textToEntity = function(str)
{
    if (typeof str != "string") return "";
    if (!this.textEntities) {
        this.textEntities = {};
        for (var p in this.htmlEntities) this.textEntities[this.htmlEntities[p]] = "&" + p + ";";
    }
    return str.replace(/([&<>'":])/g, (_, n) => (lib.textEntities[n] || n));
}

/**
 * Convert html entities into their original symbols
 * @memberof module:lib
 * @method entityToText
 */
lib.entityToText = function(str)
{
    if (typeof str != "string") return "";
    return str.replace(/&(#?[a-zA-Z0-9]+);/g, function(_, n) {
        if (n[0] === '#') return n.charAt(1) === 'x' ? String.fromCharCode(parseInt(n.substring(2), 16)) : String.fromCharCode(+n.substring(1));
        return lib.htmlEntities[n.toLowerCase()] || "";
    });
}

/**
 * Convert a Buffer into base32 string
 * @param {Buffer} bug - inout buffer
 * @param {object} [options]
 * @param {string} [options.alphabet] - alphabet to use for encoding, default is base32
 * @param {boolean} [options.padding] - if true add padding using =
 * @return {string} encoded value
 * @memberof module:lib
 * @method toBase32
 */
lib.toBase32 = function(buf, options)
{
    if (!Buffer.isBuffer(buf)) return "";
    const alphabet = options?.alphabet || this.base32;
    let bits = 0, value = 0, str = "";

    for (let i = 0; i < buf.length; i++) {
        value = (value << 8) | buf[i];
        bits += 8
        while (bits >= 5) {
            str += alphabet[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) {
        str += alphabet[(value << (5 - bits)) & 31];
    }
    if (options?.padding) {
        while ((str.length % 8) !== 0) str += "=";
    }
    return str;
}

/**
 * Convert a string in base32 into a Buffer
 * @param {string} str - base32 encoded string
 * @param {object} [options]
 * @param {string} [options.alphabet] - alphabet to use for decoding
 * @memberof module:lib
 * @method fromBase32
 */
lib.fromBase32 = function(str, options)
{
    if (typeof str != "string") return "";
    const alphabet = options?.alphabet || this.base32;
    let bits = 0, value = 0, index = 0, idx;
    const buf = Buffer.alloc((str.length * 5 / 8) | 0);
    for (let i = 0; i < str.length; i++) {
        idx = alphabet.indexOf(str[i]);
        if (idx === -1) return null;
        value = (value << 5) | idx;
        bits += 5;
        if (bits >= 8) {
            buf[index++] = (value >>> (bits - 8)) & 255;
            bits -= 8;
        }
    }
    return buf;
}

lib.unicodeAsciiMap = {
    d: {
        "\uFF10": "0", "\uFF11": "1", "\uFF12": "2", "\uFF13": "3", "\uFF14": "4",
        "\uFF15": "5", "\uFF16": "6", "\uFF17": "7", "\uFF18": "8", "\uFF19": "9",
    },

    l: {
        "\uFF21": "A", "\u1D00": "A", "\uFF22": "B", "\u0299": "B", "\uFF23": "C", "\u1D04": "C",
        "\uFF24": "D", "\u1D05": "D", "\uFF25": "E", "\u1D07": "E", "\uFF26": "F", "\uA730": "F",
        "\uFF27": "G", "\u0262": "G", "\uFF28": "H", "\u029C": "H", "\uFF29": "I", "\u026A": "I",
        "\uFF2A": "J", "\u1D0A": "J", "\uFF2B": "K", "\u1D0B": "K", "\uFF2C": "L", "\u029F": "L",
        "\uFF2D": "M", "\u1D0D": "M", "\uFF2E": "N", "\u0274": "N", "\uFF2F": "O", "\u1D0F": "O",
        "\uFF30": "P", "\u1D18": "P", "\uFF31": "Q", "\uFF32": "R", "\u0280": "R", "\uFF33": "S",
        "\uA731": "S", "\uFF34": "T", "\u1D1B": "T", "\uFF35": "U", "\u1D1C": "U", "\uFF36": "V",
        "\u1D20": "V", "\uFF37": "W", "\u1D21": "W", "\uFF38": "X", "\uFF39": "Y", "\u028F": "Y",
        "\uFF3A": "Z", "\u1D22": "Z",
    },

    q: {
        "\u00AB": "\"", "\u00BB": "\"", "\u201C": "\"", "\u201D": "\"", "\u02BA": "\"", "\u02EE": "\"",
        "\u201F": "\"", "\u275D": "\"", "\u275E": "\"", "\u301D": "\"", "\u301E": "\"",
        "\uFF02": "\"", "\u2018": "'", "\u2019": "'", "\u02BB": "'", "\u02C8": "'", "\u02BC": "'",
        "\u02BD": "'", "\u02B9": "'", "\u201B": "'", "\uFF07": "'", "\u00B4": "'", "\u02CA": "'",
        "\u0060": "'", "\u02CB": "'", "\u275B": "'", "\u275C": "'", "\u0313": "'", "\u0314": "'",
        "\uFE10": "'", "\uFE11": "'", "\u00A0": "'", "\u2000": "'", "\u201E": "\"",
    },

    o: {
        "\u00BC": "1/4", "\u00BD": "1/2", "\u00BE": "3/4",

        "\u20D2": "|", "\u20D3": "|", "\u2223": "|", "\uFF5C": "|", "\u23B8": "|",
        "\u23B9": "|", "\u23D0": "|", "\u239C": "|", "\u239F": "|",

        "\uFE6B": "@", "\uFF20": "@",
        "\uFE69": "$", "\uFF04": "$",
        "\uFE5F": "#", "\uFF03": "#",
        "\uFE6A": "%", "\uFF05": "%",
        "\uFE60": "&", "\uFF06": "&",


        "\u2768": "(", "\u276A": "(", "\uFE59": "(", "\uFF08": "(", "\u27EE": "(", "\u2985": "(",
        "\u2769": ")", "\u276B": ")", "\uFE5A": ")", "\uFF09": ")", "\u27EF": ")", "\u2986": ")",

        "\u204E": "*", "\u2217": "*", "\u229B": "*", "\u2722": "*", "\u2723": "*",
        "\u2724": "*", "\u2725": "*", "\u2731": "*", "\u2732": "*", "\u2733": "*", "\u273A": "*",
        "\u273B": "*", "\u273C": "*", "\u273D": "*", "\u2743": "*", "\u2749": "*", "\u274A": "*",
        "\u274B": "*", "\u29C6": "*", "\uFE61": "*", "\uFF0A": "*",

        "\u02D6": "+", "\uFE62": "+", "\uFF0B": "+",

        "\u00F7": "/", "\u29F8": "/", "\u0337": "/", "\u0338": "/", "\u2044": "/", "\u2215": "/", "\uFF0F": "/",
        "\u29F9": "\\", "\u29F5": "\\", "\u20E5": "\\", "\uFE68": "\\", "\uFF3C": "\\",

        "\uFE64": "<", "\uFF1C": "<", "\u2039": ">", "\u203A": "<", "\uFE65": ">", "\uFF1E": ">",

        "\u0347": "=", "\uA78A": "=", "\uFE66": "=", "\uFF1D": "=",

        "\u02C6": "^", "\u0302": "^", "\uFF3E": "^", "\u1DCD": "^",
        "\u2774": "{", "\uFE5B": "{", "\uFF5B": "{", "\u2775": "}", "\uFE5C": "}", "\uFF5D": "}",
        "\uFF3B": "[", "\uFF3D": "]",
        "\u02DC": "~", "\u02F7": "~", "\u0303": "~", "\u0330": "~", "\u0334": "~", "\u223C": "~", "\uFF5E": "~",

    },

    p: {
        "\u3002": ".", "\uFE52": ".", "\uFF0E": ".", "\uFF61": ".",
        "\uFF64": ", ", "\u201A": ", ", "\u0326": ", ", "\uFE50": ", ", "\uFE51": ", ", "\uFF0C": ", ",
        "\u02D0": ":", "\u02F8": ":", "\u2982": ":", "\uA789": ":", "\uFE13": ":", "\uFF1A": ":",
        "\u204F": ";", "\uFE14": ";", "\uFE54": ";", "\uFF1B": ";",
        "\uFE16": "?", "\uFE56": "?", "\uFF1F": "?",
        "\u01C3": "!", "\uFE15": "!", "\uFE57": "!", "\uFF01": "!",
        "\u2026": "...", "\u203C": "!!",
        "\u0332": "_", "\uFF3F": "_", "\u2017": "_", "\u2014": "-", "\u2013": "-",
        "\u23BC": "-", "\u23BD": "-", "\u2015": "-", "\uFE63": "-", "\uFF0D": "-", "\u2010": "-", "\u2043": "-",
    },

    s: {
        "\u2000": " ", "\u2001": " ", "\u2002": " ", "\u2003": " ", "\u2004": " ", "\u2005": " ", "\u2006": " ",
        "\u2007": " ", "\u2008": " ", "\u2009": " ", "\u200A": " ", "\u200B": " ", "\u200E": " ",
        "\u202F": " ", "\u205F": " ", "\u2062": " ", "\u2063": " ", "\u2064": " ", "\u206B": " ",
        "\u008D": " ", "\u009F": " ", "\u0080": " ", "\u0090": " ", "\u009B": " ", "\u0010": " ",
        "\u0009": " ", "\u0000": " ", "\u0003": " ", "\u0004": " ", "\u0017": " ", "\u0019": " ",
        "\u0011": " ", "\u0012": " ", "\u0013": " ", "\u0014": " ", "\u2028": " ", "\u2029": " ",
        "\u2060": " ", "\u202C": " ",
        "\u3000": " ", "\u3164": " ",
        "\u00AD": " ", "\u00A0": " ",
        "\u1680": " ",

    }
};

lib.htmlEntities = {
        'AElig': 'Æ','AMP': '','Aacute': 'Á','Abreve': 'Ă','Acirc': 'Â',
        'Acy': 'А','Afr': '𝔄','Agrave': 'À','Alpha': 'Α','Amacr': 'Ā',
        'And': '⩓','Aogon': 'Ą','Aopf': '𝔸','ApplyFunction': '','Aring': 'Å',
        'Ascr': '𝒜','Assign': '≔','Atilde': 'Ã','Auml': 'Ä','Backslash': '∖',
        'Barv': '⫧','Barwed': '⌆','Bcy': 'Б','Because': '∵','Bernoullis': 'ℬ',
        'Beta': 'Β','Bfr': '𝔅','Bopf': '𝔹','Breve': '˘','Bscr': 'ℬ',
        'Bumpeq': '≎','CHcy': 'Ч','COPY': '©','Cacute': 'Ć','Cap': '⋒',
        'CapitalDifferentialD': 'ⅅ','Cayleys': 'ℭ','Ccaron': 'Č','Ccedil': 'Ç','Ccirc': 'Ĉ',
        'Cconint': '∰','Cdot': 'Ċ','Cedilla': '¸','CenterDot': '·','Cfr': 'ℭ',
        'Chi': 'Χ','CircleDot': '⊙','CircleMinus': '⊖','CirclePlus': '⊕','CircleTimes': '⊗',
        'ClockwiseContourIntegral': '∲','CloseCurlyDoubleQuote': '”','CloseCurlyQuote': '’','Colon': '∷','Colone': '⩴',
        'Congruent': '≡','Conint': '∯','ContourIntegral': '∮','Copf': 'ℂ','Coproduct': '∐',
        'CounterClockwiseContourIntegral': '∳','Cross': '⨯','Cscr': '𝒞','Cup': '⋓','CupCap': '≍',
        'DD': 'ⅅ','DDotrahd': '⤑','DJcy': 'Ђ','DScy': 'Ѕ','DZcy': 'Џ',
        'Dagger': '‡','Darr': '↡','Dashv': '⫤','Dcaron': 'Ď','Dcy': 'Д',
        'Del': '∇','Delta': 'Δ','Dfr': '𝔇','DiacriticalAcute': '´','DiacriticalDot': '˙',
        'DiacriticalDoubleAcute': '˝','DiacriticalGrave': '`','DiacriticalTilde': '˜','Diamond': '⋄','DifferentialD': 'ⅆ',
        'Dopf': '𝔻','Dot': '¨','DotDot': '⃜','DotEqual': '≐','DoubleContourIntegral': '∯',
        'DoubleDot': '¨','DoubleDownArrow': '⇓','DoubleLeftArrow': '⇐','DoubleLeftRightArrow': '⇔','DoubleLeftTee': '⫤',
        'DoubleLongLeftArrow': '⟸','DoubleLongLeftRightArrow': '⟺','DoubleLongRightArrow': '⟹','DoubleRightArrow': '⇒','DoubleRightTee': '⊨',
        'DoubleUpArrow': '⇑','DoubleUpDownArrow': '⇕','DoubleVerticalBar': '∥','DownArrow': '↓','DownArrowBar': '⤓',
        'DownArrowUpArrow': '⇵','DownBreve': '̑','DownLeftRightVector': '⥐','DownLeftTeeVector': '⥞','DownLeftVector': '↽',
        'DownLeftVectorBar': '⥖','DownRightTeeVector': '⥟','DownRightVector': '⇁','DownRightVectorBar': '⥗','DownTee': '⊤',
        'DownTeeArrow': '↧','Downarrow': '⇓','Dscr': '𝒟','Dstrok': 'Đ','ENG': 'Ŋ',
        'ETH': 'Ð','Eacute': 'É','Ecaron': 'Ě','Ecirc': 'Ê','Ecy': 'Э',
        'Edot': 'Ė','Efr': '𝔈','Egrave': 'È','Element': '∈','Emacr': 'Ē',
        'EmptySmallSquare': '◻','EmptyVerySmallSquare': '▫','Eogon': 'Ę','Eopf': '𝔼','Epsilon': 'Ε',
        'Equal': '⩵','EqualTilde': '≂','Equilibrium': '⇌','Escr': 'ℰ','Esim': '⩳',
        'Eta': 'Η','Euml': 'Ë','Exists': '∃','ExponentialE': 'ⅇ','Fcy': 'Ф',
        'Ffr': '𝔉','FilledSmallSquare': '◼','FilledVerySmallSquare': '▪','Fopf': '𝔽','ForAll': '∀',
        'Fouriertrf': 'ℱ','Fscr': 'ℱ','GJcy': 'Ѓ','GT': '>','Gamma': 'Γ',
        'Gammad': 'Ϝ','Gbreve': 'Ğ','Gcedil': 'Ģ','Gcirc': 'Ĝ','Gcy': 'Г',
        'Gdot': 'Ġ','Gfr': '𝔊','Gg': '⋙','Gopf': '𝔾','GreaterEqual': '≥',
        'GreaterEqualLess': '⋛','GreaterFullEqual': '≧','GreaterGreater': '⪢','GreaterLess': '≷','GreaterSlantEqual': '⩾',
        'GreaterTilde': '≳','Gscr': '𝒢','Gt': '≫','HARDcy': 'Ъ','Hacek': 'ˇ',
        'Hat': '^','Hcirc': 'Ĥ','Hfr': 'ℌ','HilbertSpace': 'ℋ','Hopf': 'ℍ',
        'HorizontalLine': '─','Hscr': 'ℋ','Hstrok': 'Ħ','HumpDownHump': '≎','HumpEqual': '≏',
        'IEcy': 'Е','IJlig': 'Ĳ','IOcy': 'Ё','Iacute': 'Í','Icirc': 'Î',
        'Icy': 'И','Idot': 'İ','Ifr': 'ℑ','Igrave': 'Ì','Im': 'ℑ',
        'Imacr': 'Ī','ImaginaryI': 'ⅈ','Implies': '⇒','Int': '∬','Integral': '∫',
        'Intersection': '⋂','InvisibleComma': '','InvisibleTimes': '','Iogon': 'Į','Iopf': '𝕀',
        'Iota': 'Ι','Iscr': 'ℐ','Itilde': 'Ĩ','Iukcy': 'І','Iuml': 'Ï',
        'Jcirc': 'Ĵ','Jcy': 'Й','Jfr': '𝔍','Jopf': '𝕁','Jscr': '𝒥',
        'Jsercy': 'Ј','Jukcy': 'Є','KHcy': 'Х','KJcy': 'Ќ','Kappa': 'Κ',
        'Kcedil': 'Ķ','Kcy': 'К','Kfr': '𝔎','Kopf': '𝕂','Kscr': '𝒦',
        'LJcy': 'Љ','LT': '<','Lacute': 'Ĺ','Lambda': 'Λ','Lang': '⟪',
        'Laplacetrf': 'ℒ','Larr': '↞','Lcaron': 'Ľ','Lcedil': 'Ļ','Lcy': 'Л',
        'LeftAngleBracket': '⟨','LeftArrow': '←','LeftArrowBar': '⇤','LeftArrowRightArrow': '⇆','LeftCeiling': '⌈',
        'LeftDoubleBracket': '⟦','LeftDownTeeVector': '⥡','LeftDownVector': '⇃','LeftDownVectorBar': '⥙','LeftFloor': '⌊',
        'LeftRightArrow': '↔','LeftRightVector': '⥎','LeftTee': '⊣','LeftTeeArrow': '↤','LeftTeeVector': '⥚',
        'LeftTriangle': '⊲','LeftTriangleBar': '⧏','LeftTriangleEqual': '⊴','LeftUpDownVector': '⥑','LeftUpTeeVector': '⥠',
        'LeftUpVector': '↿','LeftUpVectorBar': '⥘','LeftVector': '↼','LeftVectorBar': '⥒','Leftarrow': '⇐',
        'Leftrightarrow': '⇔','LessEqualGreater': '⋚','LessFullEqual': '≦','LessGreater': '≶','LessLess': '⪡',
        'LessSlantEqual': '⩽','LessTilde': '≲','Lfr': '𝔏','Ll': '⋘','Lleftarrow': '⇚',
        'Lmidot': 'Ŀ','LongLeftArrow': '⟵','LongLeftRightArrow': '⟷','LongRightArrow': '⟶','Longleftarrow': '⟸',
        'Longleftrightarrow': '⟺','Longrightarrow': '⟹','Lopf': '𝕃','LowerLeftArrow': '↙','LowerRightArrow': '↘',
        'Lscr': 'ℒ','Lsh': '↰','Lstrok': 'Ł','Lt': '≪','Map': '⤅',
        'Mcy': 'М','MediumSpace': ' ','Mellintrf': 'ℳ','Mfr': '𝔐','MinusPlus': '∓',
        'Mopf': '𝕄','Mscr': 'ℳ','Mu': 'Μ','NJcy': 'Њ','Nacute': 'Ń',
        'Ncaron': 'Ň','Ncedil': 'Ņ','Ncy': 'Н','NegativeMediumSpace': '','NegativeThickSpace': '',
        'NegativeThinSpace': '','NegativeVeryThinSpace': '','NestedGreaterGreater': '≫','NestedLessLess': '≪','NewLine': '\n',
        'Nfr': '𝔑','NoBreak': '','NonBreakingSpace': ' ','Nopf': 'ℕ','Not': '⫬',
        'NotCongruent': '≢','NotCupCap': '≭','NotDoubleVerticalBar': '∦','NotElement': '∉','NotEqual': '≠',
        'NotEqualTilde': '≂̸','NotExists': '∄','NotGreater': '≯','NotGreaterEqual': '≱','NotGreaterFullEqual': '≧̸',
        'NotGreaterGreater': '≫̸','NotGreaterLess': '≹','NotGreaterSlantEqual': '⩾̸','NotGreaterTilde': '≵','NotHumpDownHump': '≎̸',
        'NotHumpEqual': '≏̸','NotLeftTriangle': '⋪','NotLeftTriangleBar': '⧏̸','NotLeftTriangleEqual': '⋬','NotLess': '≮',
        'NotLessEqual': '≰','NotLessGreater': '≸','NotLessLess': '≪̸','NotLessSlantEqual': '⩽̸','NotLessTilde': '≴',
        'NotNestedGreaterGreater': '⪢̸','NotNestedLessLess': '⪡̸','NotPrecedes': '⊀','NotPrecedesEqual': '⪯̸','NotPrecedesSlantEqual': '⋠',
        'NotReverseElement': '∌','NotRightTriangle': '⋫','NotRightTriangleBar': '⧐̸','NotRightTriangleEqual': '⋭','NotSquareSubset': '⊏̸',
        'NotSquareSubsetEqual': '⋢','NotSquareSuperset': '⊐̸','NotSquareSupersetEqual': '⋣','NotSubset': '⊂⃒','NotSubsetEqual': '⊈',
        'NotSucceeds': '⊁','NotSucceedsEqual': '⪰̸','NotSucceedsSlantEqual': '⋡','NotSucceedsTilde': '≿̸','NotSuperset': '⊃⃒',
        'NotSupersetEqual': '⊉','NotTilde': '≁','NotTildeEqual': '≄','NotTildeFullEqual': '≇','NotTildeTilde': '≉',
        'NotVerticalBar': '∤','Nscr': '𝒩','Ntilde': 'Ñ','Nu': 'Ν','OElig': 'Œ',
        'Oacute': 'Ó','Ocirc': 'Ô','Ocy': 'О','Odblac': 'Ő','Ofr': '𝔒',
        'Ograve': 'Ò','Omacr': 'Ō','Omega': 'Ω','Omicron': 'Ο','Oopf': '𝕆',
        'OpenCurlyDoubleQuote': '“','OpenCurlyQuote': '‘','Or': '⩔','Oscr': '𝒪','Oslash': 'Ø',
        'Otilde': 'Õ','Otimes': '⨷','Ouml': 'Ö','OverBar': '‾','OverBrace': '⏞',
        'OverBracket': '⎴','OverParenthesis': '⏜','PartialD': '∂','Pcy': 'П','Pfr': '𝔓',
        'Phi': 'Φ','Pi': 'Π','PlusMinus': '±','Poincareplane': 'ℌ','Popf': 'ℙ',
        'Pr': '⪻','Precedes': '≺','PrecedesEqual': '⪯','PrecedesSlantEqual': '≼','PrecedesTilde': '≾',
        'Prime': '″','Product': '∏','Proportion': '∷','Proportional': '∝','Pscr': '𝒫',
        'Psi': 'Ψ','QUOT': '"','Qfr': '𝔔','Qopf': 'ℚ','Qscr': '𝒬',
        'RBarr': '⤐','REG': '®','Racute': 'Ŕ','Rang': '⟫','Rarr': '↠',
        'Rarrtl': '⤖','Rcaron': 'Ř','Rcedil': 'Ŗ','Rcy': 'Р','Re': 'ℜ',
        'ReverseElement': '∋','ReverseEquilibrium': '⇋','ReverseUpEquilibrium': '⥯','Rfr': 'ℜ','Rho': 'Ρ',
        'RightAngleBracket': '⟩','RightArrow': '→','RightArrowBar': '⇥','RightArrowLeftArrow': '⇄','RightCeiling': '⌉',
        'RightDoubleBracket': '⟧','RightDownTeeVector': '⥝','RightDownVector': '⇂','RightDownVectorBar': '⥕','RightFloor': '⌋',
        'RightTee': '⊢','RightTeeArrow': '↦','RightTeeVector': '⥛','RightTriangle': '⊳','RightTriangleBar': '⧐',
        'RightTriangleEqual': '⊵','RightUpDownVector': '⥏','RightUpTeeVector': '⥜','RightUpVector': '↾','RightUpVectorBar': '⥔',
        'RightVector': '⇀','RightVectorBar': '⥓','Rightarrow': '⇒','Ropf': 'ℝ','RoundImplies': '⥰',
        'Rrightarrow': '⇛','Rscr': 'ℛ','Rsh': '↱','RuleDelayed': '⧴','SHCHcy': 'Щ',
        'SHcy': 'Ш','SOFTcy': 'Ь','Sacute': 'Ś','Sc': '⪼','Scaron': 'Š',
        'Scedil': 'Ş','Scirc': 'Ŝ','Scy': 'С','Sfr': '𝔖','ShortDownArrow': '↓',
        'ShortLeftArrow': '←','ShortRightArrow': '→','ShortUpArrow': '↑','Sigma': 'Σ','SmallCircle': '∘',
        'Sopf': '𝕊','Sqrt': '√','Square': '□','SquareIntersection': '⊓','SquareSubset': '⊏',
        'SquareSubsetEqual': '⊑','SquareSuperset': '⊐','SquareSupersetEqual': '⊒','SquareUnion': '⊔','Sscr': '𝒮',
        'Star': '⋆','Sub': '⋐','Subset': '⋐','SubsetEqual': '⊆','Succeeds': '≻',
        'SucceedsEqual': '⪰','SucceedsSlantEqual': '≽','SucceedsTilde': '≿','SuchThat': '∋','Sum': '∑',
        'Sup': '⋑','Superset': '⊃','SupersetEqual': '⊇','Supset': '⋑','THORN': 'Þ',
        'TRADE': '™','TSHcy': 'Ћ','TScy': 'Ц','Tab': '  ','Tau': 'Τ',
        'Tcaron': 'Ť','Tcedil': 'Ţ','Tcy': 'Т','Tfr': '𝔗','Therefore': '∴',
        'Theta': 'Θ','ThickSpace': '  ','ThinSpace': ' ','Tilde': '∼','TildeEqual': '≃',
        'TildeFullEqual': '≅','TildeTilde': '≈','Topf': '𝕋','TripleDot': '⃛','Tscr': '𝒯',
        'Tstrok': 'Ŧ','Uacute': 'Ú','Uarr': '↟','Uarrocir': '⥉','Ubrcy': 'Ў',
        'Ubreve': 'Ŭ','Ucirc': 'Û','Ucy': 'У','Udblac': 'Ű','Ufr': '𝔘',
        'Ugrave': 'Ù','Umacr': 'Ū','UnderBar': '_','UnderBrace': '⏟','UnderBracket': '⎵',
        'UnderParenthesis': '⏝','Union': '⋃','UnionPlus': '⊎','Uogon': 'Ų','Uopf': '𝕌',
        'UpArrow': '↑','UpArrowBar': '⤒','UpArrowDownArrow': '⇅','UpDownArrow': '↕','UpEquilibrium': '⥮',
        'UpTee': '⊥','UpTeeArrow': '↥','Uparrow': '⇑','Updownarrow': '⇕','UpperLeftArrow': '↖',
        'UpperRightArrow': '↗','Upsi': 'ϒ','Upsilon': 'Υ','Uring': 'Ů','Uscr': '𝒰',
        'Utilde': 'Ũ','Uuml': 'Ü','VDash': '⊫','Vbar': '⫫','Vcy': 'В',
        'Vdash': '⊩','Vdashl': '⫦','Vee': '⋁','Verbar': '‖','Vert': '‖',
        'VerticalBar': '∣','VerticalLine': '|','VerticalSeparator': '❘','VerticalTilde': '≀','VeryThinSpace': ' ',
        'Vfr': '𝔙','Vopf': '𝕍','Vscr': '𝒱','Vvdash': '⊪','Wcirc': 'Ŵ',
        'Wedge': '⋀','Wfr': '𝔚','Wopf': '𝕎','Wscr': '𝒲','Xfr': '𝔛',
        'Xi': 'Ξ','Xopf': '𝕏','Xscr': '𝒳','YAcy': 'Я','YIcy': 'Ї',
        'YUcy': 'Ю','Yacute': 'Ý','Ycirc': 'Ŷ','Ycy': 'Ы','Yfr': '𝔜',
        'Yopf': '𝕐','Yscr': '𝒴','Yuml': 'Ÿ','ZHcy': 'Ж','Zacute': 'Ź',
        'Zcaron': 'Ž','Zcy': 'З','Zdot': 'Ż','ZeroWidthSpace': '','Zeta': 'Ζ',
        'Zfr': 'ℨ','Zopf': 'ℤ','Zscr': '𝒵','aacute': 'á','abreve': 'ă',
        'ac': '∾','acE': '∾̳','acd': '∿','acirc': 'â','acute': '´',
        'acy': 'а','aelig': 'æ','af': '','afr': '𝔞','agrave': 'à',
        'alefsym': 'ℵ','aleph': 'ℵ','alpha': 'α','amacr': 'ā','amalg': '⨿',
        'amp': '&','and': '∧','andand': '⩕','andd': '⩜','andslope': '⩘',
        'andv': '⩚','ang': '∠','ange': '⦤','angle': '∠','angmsd': '∡',
        'angmsdaa': '⦨','angmsdab': '⦩','angmsdac': '⦪','angmsdad': '⦫','angmsdae': '⦬',
        'angmsdaf': '⦭','angmsdag': '⦮','angmsdah': '⦯','angrt': '∟','angrtvb': '⊾',
        'angrtvbd': '⦝','angsph': '∢','angst': 'Å','angzarr': '⍼','aogon': 'ą',
        'aopf': '𝕒','ap': '≈','apE': '⩰','apacir': '⩯','ape': '≊',
        'apid': '≋','apos': "'",'approx': '≈','approxeq': '≊','aring': 'å',
        'ascr': '𝒶','ast': '*','asymp': '≈','asympeq': '≍','atilde': 'ã',
        'auml': 'ä','awconint': '∳','awint': '⨑','bNot': '⫭','backcong': '≌',
        'backepsilon': '϶','backprime': '‵','backsim': '∽','backsimeq': '⋍','barvee': '⊽',
        'barwed': '⌅','barwedge': '⌅','bbrk': '⎵','bbrktbrk': '⎶','bcong': '≌',
        'bcy': 'б','bdquo': '„','becaus': '∵','because': '∵','bemptyv': '⦰',
        'bepsi': '϶','bernou': 'ℬ','beta': 'β','beth': 'ℶ','between': '≬',
        'bfr': '𝔟','bigcap': '⋂','bigcirc': '◯','bigcup': '⋃','bigodot': '⨀',
        'bigoplus': '⨁','bigotimes': '⨂','bigsqcup': '⨆','bigstar': '★','bigtriangledown': '▽',
        'bigtriangleup': '△','biguplus': '⨄','bigvee': '⋁','bigwedge': '⋀','bkarow': '⤍',
        'blacklozenge': '⧫','blacksquare': '▪','blacktriangle': '▴','blacktriangledown': '▾','blacktriangleleft': '◂',
        'blacktriangleright': '▸','blank': '␣','blk12': '▒','blk14': '░','blk34': '▓',
        'block': '█','bne': '=⃥','bnequiv': '≡⃥','bnot': '⌐','bopf': '𝕓',
        'bot': '⊥','bottom': '⊥','bowtie': '⋈','boxDL': '╗','boxDR': '╔',
        'boxDl': '╖','boxDr': '╓','boxH': '═','boxHD': '╦','boxHU': '╩',
        'boxHd': '╤','boxHu': '╧','boxUL': '╝','boxUR': '╚','boxUl': '╜',
        'boxUr': '╙','boxV': '║','boxVH': '╬','boxVL': '╣','boxVR': '╠',
        'boxVh': '╫','boxVl': '╢','boxVr': '╟','boxbox': '⧉','boxdL': '╕',
        'boxdR': '╒','boxdl': '┐','boxdr': '┌','boxh': '─','boxhD': '╥',
        'boxhU': '╨','boxhd': '┬','boxhu': '┴','boxminus': '⊟','boxplus': '⊞',
        'boxtimes': '⊠','boxuL': '╛','boxuR': '╘','boxul': '┘','boxur': '└',
        'boxv': '│','boxvH': '╪','boxvL': '╡','boxvR': '╞','boxvh': '┼',
        'boxvl': '┤','boxvr': '├','bprime': '‵','breve': '˘','brvbar': '¦',
        'bscr': '𝒷','bsemi': '⁏','bsim': '∽','bsime': '⋍','bsol': '\\',
        'bsolb': '⧅','bsolhsub': '⟈','bull': '•','bullet': '•','bump': '≎',
        'bumpE': '⪮','bumpe': '≏','bumpeq': '≏','cacute': 'ć','cap': '∩',
        'capand': '⩄','capbrcup': '⩉','capcap': '⩋','capcup': '⩇','capdot': '⩀',
        'caps': '∩︀','caret': '⁁','caron': 'ˇ','ccaps': '⩍','ccaron': 'č',
        'ccedil': 'ç','ccirc': 'ĉ','ccups': '⩌','ccupssm': '⩐','cdot': 'ċ',
        'cedil': '¸','cemptyv': '⦲','cent': '¢','centerdot': '·','cfr': '𝔠',
        'chcy': 'ч','check': '✓','checkmark': '✓','chi': 'χ','cir': '○',
        'cirE': '⧃','circ': 'ˆ','circeq': '≗','circlearrowleft': '↺','circlearrowright': '↻',
        'circledR': '®','circledS': 'Ⓢ','circledast': '⊛','circledcirc': '⊚','circleddash': '⊝',
        'cire': '≗','cirfnint': '⨐','cirmid': '⫯','cirscir': '⧂','clubs': '♣',
        'clubsuit': '♣','colon': ':','colone': '≔','coloneq': '≔','comma': ',',
        'commat': '@','comp': '∁','compfn': '∘','complement': '∁','complexes': 'ℂ',
        'cong': '≅','congdot': '⩭','conint': '∮','copf': '𝕔','coprod': '∐',
        'copy': '©','copysr': '℗','crarr': '↵','cross': '✗','cscr': '𝒸',
        'csub': '⫏','csube': '⫑','csup': '⫐','csupe': '⫒','ctdot': '⋯',
        'cudarrl': '⤸','cudarrr': '⤵','cuepr': '⋞','cuesc': '⋟','cularr': '↶',
        'cularrp': '⤽','cup': '∪','cupbrcap': '⩈','cupcap': '⩆','cupcup': '⩊',
        'cupdot': '⊍','cupor': '⩅','cups': '∪︀','curarr': '↷','curarrm': '⤼',
        'curlyeqprec': '⋞','curlyeqsucc': '⋟','curlyvee': '⋎','curlywedge': '⋏','curren': '¤',
        'curvearrowleft': '↶','curvearrowright': '↷','cuvee': '⋎','cuwed': '⋏','cwconint': '∲',
        'cwint': '∱','cylcty': '⌭','dArr': '⇓','dHar': '⥥','dagger': '†',
        'daleth': 'ℸ','darr': '↓','dash': '‐','dashv': '⊣','dbkarow': '⤏',
        'dblac': '˝','dcaron': 'ď','dcy': 'д','dd': 'ⅆ','ddagger': '‡',
        'ddarr': '⇊','ddotseq': '⩷','deg': '°','delta': 'δ','demptyv': '⦱',
        'dfisht': '⥿','dfr': '𝔡','dharl': '⇃','dharr': '⇂','diam': '⋄',
        'diamond': '⋄','diamondsuit': '♦','diams': '♦','die': '¨','digamma': 'ϝ',
        'disin': '⋲','div': '÷','divide': '÷','divideontimes': '⋇','divonx': '⋇',
        'djcy': 'ђ','dlcorn': '⌞','dlcrop': '⌍','dollar': '$','dopf': '𝕕',
        'dot': '˙','doteq': '≐','doteqdot': '≑','dotminus': '∸','dotplus': '∔',
        'dotsquare': '⊡','doublebarwedge': '⌆','downarrow': '↓','downdownarrows': '⇊','downharpoonleft': '⇃',
        'downharpoonright': '⇂','drbkarow': '⤐','drcorn': '⌟','drcrop': '⌌','dscr': '𝒹',
        'dscy': 'ѕ','dsol': '⧶','dstrok': 'đ','dtdot': '⋱','dtri': '▿',
        'dtrif': '▾','duarr': '⇵','duhar': '⥯','dwangle': '⦦','dzcy': 'џ',
        'dzigrarr': '⟿','eDDot': '⩷','eDot': '≑','eacute': 'é','easter': '⩮',
        'ecaron': 'ě','ecir': '≖','ecirc': 'ê','ecolon': '≕','ecy': 'э',
        'edot': 'ė','ee': 'ⅇ','efDot': '≒','efr': '𝔢','eg': '⪚',
        'egrave': 'è','egs': '⪖','egsdot': '⪘','el': '⪙','elinters': '⏧',
        'ell': 'ℓ','els': '⪕','elsdot': '⪗','emacr': 'ē','empty': '∅',
        'emptyset': '∅','emptyv': '∅','emsp13': ' ','emsp14': ' ','emsp': ' ',
        'eng': 'ŋ','ensp': ' ','eogon': 'ę','eopf': '𝕖','epar': '⋕',
        'eparsl': '⧣','eplus': '⩱','epsi': 'ε','epsilon': 'ε','epsiv': 'ϵ',
        'eqcirc': '≖','eqcolon': '≕','eqsim': '≂','eqslantgtr': '⪖','eqslantless': '⪕',
        'equals': '=','equest': '≟','equiv': '≡','equivDD': '⩸','eqvparsl': '⧥',
        'erDot': '≓','erarr': '⥱','escr': 'ℯ','esdot': '≐','esim': '≂',
        'eta': 'η','eth': 'ð','euml': 'ë','euro': '€','excl': '!',
        'exist': '∃','expectation': 'ℰ','exponentiale': 'ⅇ','fallingdotseq': '≒','fcy': 'ф',
        'female': '♀','ffilig': 'ﬃ','fflig': 'ﬀ','ffllig': 'ﬄ','ffr': '𝔣',
        'filig': 'ﬁ','fjlig': 'fj','flat': '♭','fllig': 'ﬂ','fltns': '▱',
        'fnof': 'ƒ','fopf': '𝕗','forall': '∀','fork': '⋔','forkv': '⫙',
        'fpartint': '⨍','frac12': '½','frac13': '⅓','frac14': '¼','frac15': '⅕',
        'frac16': '⅙','frac18': '⅛','frac23': '⅔','frac25': '⅖','frac34': '¾',
        'frac35': '⅗','frac38': '⅜','frac45': '⅘','frac56': '⅚','frac58': '⅝',
        'frac78': '⅞','frasl': '⁄','frown': '⌢','fscr': '𝒻','gE': '≧',
        'gEl': '⪌','gacute': 'ǵ','gamma': 'γ','gammad': 'ϝ','gap': '⪆',
        'gbreve': 'ğ','gcirc': 'ĝ','gcy': 'г','gdot': 'ġ','ge': '≥',
        'gel': '⋛','geq': '≥','geqq': '≧','geqslant': '⩾','ges': '⩾',
        'gescc': '⪩','gesdot': '⪀','gesdoto': '⪂','gesdotol': '⪄','gesl': '⋛︀',
        'gesles': '⪔','gfr': '𝔤','gg': '≫','ggg': '⋙','gimel': 'ℷ',
        'gjcy': 'ѓ','gl': '≷','glE': '⪒','gla': '⪥','glj': '⪤',
        'gnE': '≩','gnap': '⪊','gnapprox': '⪊','gne': '⪈','gneq': '⪈',
        'gneqq': '≩','gnsim': '⋧','gopf': '𝕘','grave': '`','gscr': 'ℊ',
        'gsim': '≳','gsime': '⪎','gsiml': '⪐','gt': '>','gtcc': '⪧',
        'gtcir': '⩺','gtdot': '⋗','gtlPar': '⦕','gtquest': '⩼','gtrapprox': '⪆',
        'gtrarr': '⥸','gtrdot': '⋗','gtreqless': '⋛','gtreqqless': '⪌','gtrless': '≷',
        'gtrsim': '≳','gvertneqq': '≩︀','gvnE': '≩︀','hArr': '⇔','hairsp': ' ',
        'half': '½','hamilt': 'ℋ','hardcy': 'ъ','harr': '↔','harrcir': '⥈',
        'harrw': '↭','hbar': 'ℏ','hcirc': 'ĥ','hearts': '♥','heartsuit': '♥',
        'hellip': '…','hercon': '⊹','hfr': '𝔥','hksearow': '⤥','hkswarow': '⤦',
        'hoarr': '⇿','homtht': '∻','hookleftarrow': '↩','hookrightarrow': '↪','hopf': '𝕙',
        'horbar': '―','hscr': '𝒽','hslash': 'ℏ','hstrok': 'ħ','hybull': '⁃',
        'hyphen': '‐','iacute': 'í','ic': '','icirc': 'î','icy': 'и',
        'iecy': 'е','iexcl': '¡','iff': '⇔','ifr': '𝔦','igrave': 'ì',
        'ii': 'ⅈ','iiiint': '⨌','iiint': '∭','iinfin': '⧜','iiota': '℩',
        'ijlig': 'ĳ','imacr': 'ī','image': 'ℑ','imagline': 'ℐ','imagpart': 'ℑ',
        'imath': 'ı','imof': '⊷','imped': 'Ƶ','in': '∈','incare': '℅',
        'infin': '∞','infintie': '⧝','inodot': 'ı','int': '∫','intcal': '⊺',
        'integers': 'ℤ','intercal': '⊺','intlarhk': '⨗','intprod': '⨼','iocy': 'ё',
        'iogon': 'į','iopf': '𝕚','iota': 'ι','iprod': '⨼','iquest': '¿',
        'iscr': '𝒾','isin': '∈','isinE': '⋹','isindot': '⋵','isins': '⋴',
        'isinsv': '⋳','isinv': '∈','it': '','itilde': 'ĩ','iukcy': 'і',
        'iuml': 'ï','jcirc': 'ĵ','jcy': 'й','jfr': '𝔧','jmath': 'ȷ',
        'jopf': '𝕛','jscr': '𝒿','jsercy': 'ј','jukcy': 'є','kappa': 'κ',
        'kappav': 'ϰ','kcedil': 'ķ','kcy': 'к','kfr': '𝔨','kgreen': 'ĸ',
        'khcy': 'х','kjcy': 'ќ','kopf': '𝕜','kscr': '𝓀','lAarr': '⇚',
        'lArr': '⇐','lAtail': '⤛','lBarr': '⤎','lE': '≦','lEg': '⪋',
        'lHar': '⥢','lacute': 'ĺ','laemptyv': '⦴','lagran': 'ℒ','lambda': 'λ',
        'lang': '⟨','langd': '⦑','langle': '⟨','lap': '⪅','laquo': '«',
        'larr': '←','larrb': '⇤','larrbfs': '⤟','larrfs': '⤝','larrhk': '↩',
        'larrlp': '↫','larrpl': '⤹','larrsim': '⥳','larrtl': '↢','lat': '⪫',
        'latail': '⤙','late': '⪭','lates': '⪭︀','lbarr': '⤌','lbbrk': '❲',
        'lbrace': '{','lbrack': '[','lbrke': '⦋','lbrksld': '⦏','lbrkslu': '⦍',
        'lcaron': 'ľ','lcedil': 'ļ','lceil': '⌈','lcub': '{','lcy': 'л',
        'ldca': '⤶','ldquo': '“','ldquor': '„','ldrdhar': '⥧','ldrushar': '⥋',
        'ldsh': '↲','le': '≤','leftarrow': '←','leftarrowtail': '↢','leftharpoondown': '↽',
        'leftharpoonup': '↼','leftleftarrows': '⇇','leftrightarrow': '↔','leftrightarrows': '⇆','leftrightharpoons': '⇋',
        'leftrightsquigarrow': '↭','leftthreetimes': '⋋','leg': '⋚','leq': '≤','leqq': '≦',
        'leqslant': '⩽','les': '⩽','lescc': '⪨','lesdot': '⩿','lesdoto': '⪁',
        'lesdotor': '⪃','lesg': '⋚︀','lesges': '⪓','lessapprox': '⪅','lessdot': '⋖',
        'lesseqgtr': '⋚','lesseqqgtr': '⪋','lessgtr': '≶','lesssim': '≲','lfisht': '⥼',
        'lfloor': '⌊','lfr': '𝔩','lg': '≶','lgE': '⪑','lhard': '↽',
        'lharu': '↼','lharul': '⥪','lhblk': '▄','ljcy': 'љ','ll': '≪',
        'llarr': '⇇','llcorner': '⌞','llhard': '⥫','lltri': '◺','lmidot': 'ŀ',
        'lmoust': '⎰','lmoustache': '⎰','lnE': '≨','lnap': '⪉','lnapprox': '⪉',
        'lne': '⪇','lneq': '⪇','lneqq': '≨','lnsim': '⋦','loang': '⟬',
        'loarr': '⇽','lobrk': '⟦','longleftarrow': '⟵','longleftrightarrow': '⟷','longmapsto': '⟼',
        'longrightarrow': '⟶','looparrowleft': '↫','looparrowright': '↬','lopar': '⦅','lopf': '𝕝',
        'loplus': '⨭','lotimes': '⨴','lowast': '∗','lowbar': '_','loz': '◊',
        'lozenge': '◊','lozf': '⧫','lpar': '(','lparlt': '⦓','lrarr': '⇆',
        'lrcorner': '⌟','lrhar': '⇋','lrhard': '⥭','lrm': '','lrtri': '⊿',
        'lsaquo': '‹','lscr': '𝓁','lsh': '↰','lsim': '≲','lsime': '⪍',
        'lsimg': '⪏','lsqb': '[','lsquo': '‘','lsquor': '‚','lstrok': 'ł',
        'lt': '<','ltcc': '⪦','ltcir': '⩹','ltdot': '⋖','lthree': '⋋',
        'ltimes': '⋉','ltlarr': '⥶','ltquest': '⩻','ltrPar': '⦖','ltri': '◃',
        'ltrie': '⊴','ltrif': '◂','lurdshar': '⥊','luruhar': '⥦','lvertneqq': '≨︀',
        'lvnE': '≨︀','mDDot': '∺','macr': '¯','male': '♂','malt': '✠',
        'maltese': '✠','map': '↦','mapsto': '↦','mapstodown': '↧','mapstoleft': '↤',
        'mapstoup': '↥','marker': '▮','mcomma': '⨩','mcy': 'м','mdash': '—',
        'measuredangle': '∡','mfr': '𝔪','mho': '℧','micro': 'µ','mid': '∣',
        'midast': '*','midcir': '⫰','middot': '·','minus': '−','minusb': '⊟',
        'minusd': '∸','minusdu': '⨪','mlcp': '⫛','mldr': '…','mnplus': '∓',
        'models': '⊧','mopf': '𝕞','mp': '∓','mscr': '𝓂','mstpos': '∾',
        'mu': 'μ','multimap': '⊸','mumap': '⊸','nGg': '⋙̸','nGt': '≫⃒',
        'nGtv': '≫̸','nLeftarrow': '⇍','nLeftrightarrow': '⇎','nLl': '⋘̸','nLt': '≪⃒',
        'nLtv': '≪̸','nRightarrow': '⇏','nVDash': '⊯','nVdash': '⊮','nabla': '∇',
        'nacute': 'ń','nang': '∠⃒','nap': '≉','napE': '⩰̸','napid': '≋̸',
        'napos': 'ŉ','napprox': '≉','natur': '♮','natural': '♮','naturals': 'ℕ',
        'nbsp': ' ','nbump': '≎̸','nbumpe': '≏̸','ncap': '⩃','ncaron': 'ň',
        'ncedil': 'ņ','ncong': '≇','ncongdot': '⩭̸','ncup': '⩂','ncy': 'н',
        'ndash': '–','ne': '≠','neArr': '⇗','nearhk': '⤤','nearr': '↗',
        'nearrow': '↗','nedot': '≐̸','nequiv': '≢','nesear': '⤨','nesim': '≂̸',
        'nexist': '∄','nexists': '∄','nfr': '𝔫','ngE': '≧̸','nge': '≱',
        'ngeq': '≱','ngeqq': '≧̸','ngeqslant': '⩾̸','nges': '⩾̸','ngsim': '≵',
        'ngt': '≯','ngtr': '≯','nhArr': '⇎','nharr': '↮','nhpar': '⫲',
        'ni': '∋','nis': '⋼','nisd': '⋺','niv': '∋','njcy': 'њ',
        'nlArr': '⇍','nlE': '≦̸','nlarr': '↚','nldr': '‥','nle': '≰',
        'nleftarrow': '↚','nleftrightarrow': '↮','nleq': '≰','nleqq': '≦̸','nleqslant': '⩽̸',
        'nles': '⩽̸','nless': '≮','nlsim': '≴','nlt': '≮','nltri': '⋪',
        'nltrie': '⋬','nmid': '∤','nopf': '𝕟','not': '¬','notin': '∉',
        'notinE': '⋹̸','notindot': '⋵̸','notinva': '∉','notinvb': '⋷','notinvc': '⋶',
        'notni': '∌','notniva': '∌','notnivb': '⋾','notnivc': '⋽','npar': '∦',
        'nparallel': '∦','nparsl': '⫽⃥','npart': '∂̸','npolint': '⨔','npr': '⊀',
        'nprcue': '⋠','npre': '⪯̸','nprec': '⊀','npreceq': '⪯̸','nrArr': '⇏',
        'nrarr': '↛','nrarrc': '⤳̸','nrarrw': '↝̸','nrightarrow': '↛','nrtri': '⋫',
        'nrtrie': '⋭','nsc': '⊁','nsccue': '⋡','nsce': '⪰̸','nscr': '𝓃',
        'nshortmid': '∤','nshortparallel': '∦','nsim': '≁','nsime': '≄','nsimeq': '≄',
        'nsmid': '∤','nspar': '∦','nsqsube': '⋢','nsqsupe': '⋣','nsub': '⊄',
        'nsubE': '⫅̸','nsube': '⊈','nsubset': '⊂⃒','nsubseteq': '⊈','nsubseteqq': '⫅̸',
        'nsucc': '⊁','nsucceq': '⪰̸','nsup': '⊅','nsupE': '⫆̸','nsupe': '⊉',
        'nsupset': '⊃⃒','nsupseteq': '⊉','nsupseteqq': '⫆̸','ntgl': '≹','ntilde': 'ñ',
        'ntlg': '≸','ntriangleleft': '⋪','ntrianglelefteq': '⋬','ntriangleright': '⋫','ntrianglerighteq': '⋭',
        'nu': 'ν','num': '#','numero': '№','numsp': ' ','nvDash': '⊭',
        'nvHarr': '⤄','nvap': '≍⃒','nvdash': '⊬','nvge': '≥⃒','nvgt': '>⃒',
        'nvinfin': '⧞','nvlArr': '⤂','nvle': '≤⃒','nvlt': '<⃒','nvltrie': '⊴⃒',
        'nvrArr': '⤃','nvrtrie': '⊵⃒','nvsim': '∼⃒','nwArr': '⇖','nwarhk': '⤣',
        'nwarr': '↖','nwarrow': '↖','nwnear': '⤧','oS': 'Ⓢ','oacute': 'ó',
        'oast': '⊛','ocir': '⊚','ocirc': 'ô','ocy': 'о','odash': '⊝',
        'odblac': 'ő','odiv': '⨸','odot': '⊙','odsold': '⦼','oelig': 'œ',
        'ofcir': '⦿','ofr': '𝔬','ogon': '˛','ograve': 'ò','ogt': '⧁',
        'ohbar': '⦵','ohm': 'Ω','oint': '∮','olarr': '↺','olcir': '⦾',
        'olcross': '⦻','oline': '‾','olt': '⧀','omacr': 'ō','omega': 'ω',
        'omicron': 'ο','omid': '⦶','ominus': '⊖','oopf': '𝕠','opar': '⦷',
        'operp': '⦹','oplus': '⊕','or': '∨','orarr': '↻','ord': '⩝',
        'order': 'ℴ','orderof': 'ℴ','ordf': 'ª','ordm': 'º','origof': '⊶',
        'oror': '⩖','orslope': '⩗','orv': '⩛','oscr': 'ℴ','oslash': 'ø',
        'osol': '⊘','otilde': 'õ','otimes': '⊗','otimesas': '⨶','ouml': 'ö',
        'ovbar': '⌽','par': '∥','para': '¶','parallel': '∥','parsim': '⫳',
        'parsl': '⫽','part': '∂','pcy': 'п','percnt': '%','period': '.',
        'permil': '‰','perp': '⊥','pertenk': '‱','pfr': '𝔭','phi': 'φ',
        'phiv': 'ϕ','phmmat': 'ℳ','phone': '☎','pi': 'π','pitchfork': '⋔',
        'piv': 'ϖ','planck': 'ℏ','planckh': 'ℎ','plankv': 'ℏ','plus': '+',
        'plusacir': '⨣','plusb': '⊞','pluscir': '⨢','plusdo': '∔','plusdu': '⨥',
        'pluse': '⩲','plusmn': '±','plussim': '⨦','plustwo': '⨧','pm': '±',
        'pointint': '⨕','popf': '𝕡','pound': '£','pr': '≺','prE': '⪳',
        'prap': '⪷','prcue': '≼','pre': '⪯','prec': '≺','precapprox': '⪷',
        'preccurlyeq': '≼','preceq': '⪯','precnapprox': '⪹','precneqq': '⪵','precnsim': '⋨',
        'precsim': '≾','prime': '′','primes': 'ℙ','prnE': '⪵','prnap': '⪹',
        'prnsim': '⋨','prod': '∏','profalar': '⌮','profline': '⌒','profsurf': '⌓',
        'prop': '∝','propto': '∝','prsim': '≾','prurel': '⊰','pscr': '𝓅',
        'psi': 'ψ','puncsp': ' ','qfr': '𝔮','qint': '⨌','qopf': '𝕢',
        'qprime': '⁗','qscr': '𝓆','quaternions': 'ℍ','quatint': '⨖','quest': '?',
        'questeq': '≟','quot': '"','rAarr': '⇛','rArr': '⇒','rAtail': '⤜',
        'rBarr': '⤏','rHar': '⥤','race': '∽̱','racute': 'ŕ','radic': '√',
        'raemptyv': '⦳','rang': '⟩','rangd': '⦒','range': '⦥','rangle': '⟩',
        'raquo': '»','rarr': '→','rarrap': '⥵','rarrb': '⇥','rarrbfs': '⤠',
        'rarrc': '⤳','rarrfs': '⤞','rarrhk': '↪','rarrlp': '↬','rarrpl': '⥅',
        'rarrsim': '⥴','rarrtl': '↣','rarrw': '↝','ratail': '⤚','ratio': '∶',
        'rationals': 'ℚ','rbarr': '⤍','rbbrk': '❳','rbrace': '}','rbrack': ']',
        'rbrke': '⦌','rbrksld': '⦎','rbrkslu': '⦐','rcaron': 'ř','rcedil': 'ŗ',
        'rceil': '⌉','rcub': '}','rcy': 'р','rdca': '⤷','rdldhar': '⥩',
        'rdquo': '”','rdquor': '”','rdsh': '↳','real': 'ℜ','realine': 'ℛ',
        'realpart': 'ℜ','reals': 'ℝ','rect': '▭','reg': '®','rfisht': '⥽',
        'rfloor': '⌋','rfr': '𝔯','rhard': '⇁','rharu': '⇀','rharul': '⥬',
        'rho': 'ρ','rhov': 'ϱ','rightarrow': '→','rightarrowtail': '↣','rightharpoondown': '⇁',
        'rightharpoonup': '⇀','rightleftarrows': '⇄','rightleftharpoons': '⇌','rightrightarrows': '⇉','rightsquigarrow': '↝',
        'rightthreetimes': '⋌','ring': '˚','risingdotseq': '≓','rlarr': '⇄','rlhar': '⇌',
        'rlm': '','rmoust': '⎱','rmoustache': '⎱','rnmid': '⫮','roang': '⟭',
        'roarr': '⇾','robrk': '⟧','ropar': '⦆','ropf': '𝕣','roplus': '⨮',
        'rotimes': '⨵','rpar': ')','rpargt': '⦔','rppolint': '⨒','rrarr': '⇉',
        'rsaquo': '›','rscr': '𝓇','rsh': '↱','rsqb': ']','rsquo': '’',
        'rsquor': '’','rthree': '⋌','rtimes': '⋊','rtri': '▹','rtrie': '⊵',
        'rtrif': '▸','rtriltri': '⧎','ruluhar': '⥨','rx': '℞','sacute': 'ś',
        'sbquo': '‚','sc': '≻','scE': '⪴','scap': '⪸','scaron': 'š',
        'sccue': '≽','sce': '⪰','scedil': 'ş','scirc': 'ŝ','scnE': '⪶',
        'scnap': '⪺','scnsim': '⋩','scpolint': '⨓','scsim': '≿','scy': 'с',
        'sdot': '⋅','sdotb': '⊡','sdote': '⩦','seArr': '⇘','searhk': '⤥',
        'searr': '↘','searrow': '↘','sect': '§','semi': '','seswar': '⤩',
        'setminus': '∖','setmn': '∖','sext': '✶','sfr': '𝔰','sfrown': '⌢',
        'sharp': '♯','shchcy': 'щ','shcy': 'ш','shortmid': '∣','shortparallel': '∥',
        'shy': '','sigma': 'σ','sigmaf': 'ς','sigmav': 'ς','sim': '∼',
        'simdot': '⩪','sime': '≃','simeq': '≃','simg': '⪞','simgE': '⪠',
        'siml': '⪝','simlE': '⪟','simne': '≆','simplus': '⨤','simrarr': '⥲',
        'slarr': '←','smallsetminus': '∖','smashp': '⨳','smeparsl': '⧤','smid': '∣',
        'smile': '⌣','smt': '⪪','smte': '⪬','smtes': '⪬︀','softcy': 'ь',
        'sol': '/','solb': '⧄','solbar': '⌿','sopf': '𝕤','spades': '♠',
        'spadesuit': '♠','spar': '∥','sqcap': '⊓','sqcaps': '⊓︀','sqcup': '⊔',
        'sqcups': '⊔︀','sqsub': '⊏','sqsube': '⊑','sqsubset': '⊏','sqsubseteq': '⊑',
        'sqsup': '⊐','sqsupe': '⊒','sqsupset': '⊐','sqsupseteq': '⊒','squ': '□',
        'square': '□','squarf': '▪','squf': '▪','srarr': '→','sscr': '𝓈',
        'ssetmn': '∖','ssmile': '⌣','sstarf': '⋆','star': '☆','starf': '★',
        'straightepsilon': 'ϵ','straightphi': 'ϕ','strns': '¯','sub': '⊂','subE': '⫅',
        'subdot': '⪽','sube': '⊆','subedot': '⫃','submult': '⫁','subnE': '⫋',
        'subne': '⊊','subplus': '⪿','subrarr': '⥹','subset': '⊂','subseteq': '⊆',
        'subseteqq': '⫅','subsetneq': '⊊','subsetneqq': '⫋','subsim': '⫇','subsub': '⫕',
        'subsup': '⫓','succ': '≻','succapprox': '⪸','succcurlyeq': '≽','succeq': '⪰',
        'succnapprox': '⪺','succneqq': '⪶','succnsim': '⋩','succsim': '≿','sum': '∑',
        'sung': '♪','sup1': '¹','sup2': '²','sup3': '³','sup': '⊃',
        'supE': '⫆','supdot': '⪾','supdsub': '⫘','supe': '⊇','supedot': '⫄',
        'suphsol': '⟉','suphsub': '⫗','suplarr': '⥻','supmult': '⫂','supnE': '⫌',
        'supne': '⊋','supplus': '⫀','supset': '⊃','supseteq': '⊇','supseteqq': '⫆',
        'supsetneq': '⊋','supsetneqq': '⫌','supsim': '⫈','supsub': '⫔','supsup': '⫖',
        'swArr': '⇙','swarhk': '⤦','swarr': '↙','swarrow': '↙','swnwar': '⤪',
        'szlig': 'ß','target': '⌖','tau': 'τ','tbrk': '⎴','tcaron': 'ť',
        'tcedil': 'ţ','tcy': 'т','tdot': '⃛','telrec': '⌕','tfr': '𝔱',
        'there4': '∴','therefore': '∴','theta': 'θ','thetasym': 'ϑ','thetav': 'ϑ',
        'thickapprox': '≈','thicksim': '∼','thinsp': ' ','thkap': '≈','thksim': '∼',
        'thorn': 'þ','tilde': '˜','times': '×','timesb': '⊠','timesbar': '⨱',
        'timesd': '⨰','tint': '∭','toea': '⤨','top': '⊤','topbot': '⌶',
        'topcir': '⫱','topf': '𝕥','topfork': '⫚','tosa': '⤩','tprime': '‴',
        'trade': '™','triangle': '▵','triangledown': '▿','triangleleft': '◃','trianglelefteq': '⊴',
        'triangleq': '≜','triangleright': '▹','trianglerighteq': '⊵','tridot': '◬','trie': '≜',
        'triminus': '⨺','triplus': '⨹','trisb': '⧍','tritime': '⨻','trpezium': '⏢',
        'tscr': '𝓉','tscy': 'ц','tshcy': 'ћ','tstrok': 'ŧ','twixt': '≬',
        'twoheadleftarrow': '↞','twoheadrightarrow': '↠','uArr': '⇑','uHar': '⥣','uacute': 'ú',
        'uarr': '↑','ubrcy': 'ў','ubreve': 'ŭ','ucirc': 'û','ucy': 'у',
        'udarr': '⇅','udblac': 'ű','udhar': '⥮','ufisht': '⥾','ufr': '𝔲',
        'ugrave': 'ù','uharl': '↿','uharr': '↾','uhblk': '▀','ulcorn': '⌜',
        'ulcorner': '⌜','ulcrop': '⌏','ultri': '◸','umacr': 'ū','uml': '¨',
        'uogon': 'ų','uopf': '𝕦','uparrow': '↑','updownarrow': '↕','upharpoonleft': '↿',
        'upharpoonright': '↾','uplus': '⊎','upsi': 'υ','upsih': 'ϒ','upsilon': 'υ',
        'upuparrows': '⇈','urcorn': '⌝','urcorner': '⌝','urcrop': '⌎','uring': 'ů',
        'urtri': '◹','uscr': '𝓊','utdot': '⋰','utilde': 'ũ','utri': '▵',
        'utrif': '▴','uuarr': '⇈','uuml': 'ü','uwangle': '⦧','vArr': '⇕',
        'vBar': '⫨','vBarv': '⫩','vDash': '⊨','vangrt': '⦜','varepsilon': 'ϵ',
        'varkappa': 'ϰ','varnothing': '∅','varphi': 'ϕ','varpi': 'ϖ','varpropto': '∝',
        'varr': '↕','varrho': 'ϱ','varsigma': 'ς','varsubsetneq': '⊊︀','varsubsetneqq': '⫋︀',
        'varsupsetneq': '⊋︀','varsupsetneqq': '⫌︀','vartheta': 'ϑ','vartriangleleft': '⊲','vartriangleright': '⊳',
        'vcy': 'в','vdash': '⊢','vee': '∨','veebar': '⊻','veeeq': '≚',
        'vellip': '⋮','verbar': '|','vert': '|','vfr': '𝔳','vltri': '⊲',
        'vnsub': '⊂⃒','vnsup': '⊃⃒','vopf': '𝕧','vprop': '∝','vrtri': '⊳',
        'vscr': '𝓋','vsubnE': '⫋︀','vsubne': '⊊︀','vsupnE': '⫌︀','vsupne': '⊋︀',
        'vzigzag': '⦚','wcirc': 'ŵ','wedbar': '⩟','wedge': '∧','wedgeq': '≙',
        'weierp': '℘','wfr': '𝔴','wopf': '𝕨','wp': '℘','wr': '≀',
        'wreath': '≀','wscr': '𝓌','xcap': '⋂','xcirc': '◯','xcup': '⋃',
        'xdtri': '▽','xfr': '𝔵','xhArr': '⟺','xharr': '⟷','xi': 'ξ',
        'xlArr': '⟸','xlarr': '⟵','xmap': '⟼','xnis': '⋻','xodot': '⨀',
        'xopf': '𝕩','xoplus': '⨁','xotime': '⨂','xrArr': '⟹','xrarr': '⟶',
        'xscr': '𝓍','xsqcup': '⨆','xuplus': '⨄','xutri': '△','xvee': '⋁',
        'xwedge': '⋀','yacute': 'ý','yacy': 'я','ycirc': 'ŷ','ycy': 'ы',
        'yen': '¥','yfr': '𝔶','yicy': 'ї','yopf': '𝕪','yscr': '𝓎',
        'yucy': 'ю','yuml': 'ÿ','zacute': 'ź','zcaron': 'ž','zcy': 'з',
        'zdot': 'ż','zeetrf': 'ℨ','zeta': 'ζ','zfr': '𝔷','zhcy': 'ж',
};

