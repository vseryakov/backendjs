/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
'use strict';

const util = require('node:util');
const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');

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
    return str ? lib.isString(str).
                     replace("_", ".").
                     replace(/[^0-9.]/g, "").
                     split(".").
                     reduce((x, y, i) => (x + Number(y) / 10 ** (i * 3)), 0) : 0;
}

/**
 * Convert text into capitalized words, if it is less or equal than minlen leave it as is
 * @param {string} name
 * @param {int} [minlen]
 * @return {string}
 * @memberof module:lib
 * @method toTitle
  * @example
  * lib.toTitle("hello_world")
  * // "Hello World"
  * lib.toTitle("id", 2)
  * // "id"
 */
lib.toTitle = function(name, minlen)
{
    return typeof name === "string" ?
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
  * @example
  * lib.toCamel("hello_world")
  * // "helloWorld"
  * lib.toCamel("hello-world", "-")
  * // "helloWorld"
 */
lib.toCamel = function(name, chars)
{
    var rx = typeof chars === "string" ? new RegExp("(?:[" + chars + "])(\\w)", "g") : this.rxCamel;
    return typeof name === "string" ? name.substr(0, 1).toLowerCase() + name.substr(1).replace(rx, (_, c) => (c ? c.toUpperCase () : '')) : "";
}

/**
 * Convert Camel names into names separated by the given separator or dash(-) if not.
 * @param {string} str
 * @param {string} [sep]
 * @return {string}
 * @memberof module:lib
 * @method toUncamel
  * @example
  * lib.toUncamel("helloWorld")
  * // "hello-world"
  * lib.toUncamel("helloWorld", "_")
  * // "hello_world"
 */
lib.toUncamel = function(str, sep)
{
    return typeof str === "string" ? str.replace(/([A-Z])/g, (_, c, index) => ((index ? sep || '-' : '') + c.toLowerCase())) : "";
}

/**
 * Safe convertion to a number, no expections, uses 0 instead of NaN, handle booleans, if float specified, returns as float.
 * @param {any} val - to be converted to a number
 * @param {object} [options]
 * @param {int} [options.dflt] - default value
 * @param {int|boolean} [options.float] - treat as floating number if true, as integer if false or 0
 * @param {int} [options.min] - minimal value, clip
 * @param {int} [options.max] - maximum value, clip
 * @param {int} [options.incr] - a number to add before checking for other conditions
 * @param {int} [options.mult] - a number to multiply before checking for other conditions
 * @param {int} [options.novalue] - replace this number with default
 * @param {int} [options.zero] - replace with this number if result is 0
 * @param {int} [options.digits] - how many digits to keep after the floating point
 * @param {boolean} [options.bigint] - return BigInt if not a safe integer
 * @param {int} [options.base=10] - base of the input, 2, 10, 16, ...
 * @return {number}
 *
 * @example
 * lib.toNumber("123")
 * 123
 *
 * lib.toNumber("1.23", { float: 1, dflt: 0, min: 0, max: 2 })
 * 1.23
 *
 * lib.toNumber("1.23", {float: false })
 * 1
 * @memberof module:lib
 * @method toNumber
 */
lib.toNumber = function(val, options)
{
    var n;
    if (typeof val === "number") {
        n = val;
    } else
    if (typeof val === "boolean") {
        n = val ? 1 : 0;
    } else {
        if (typeof val !== "string") {
            n = options?.dflt || 0;
        } else {
            // Autodetect floating number
            const f = options?.float === undefined || options?.float === null ? this.rxFloat.test(val) : options?.float;
            n = val[0] === 't' ? 1 : val[0] === 'f' ? 0 :
                val === "infinity" ? Number.POSITIVE_INFINITY :
                (f ? Number.parseFloat(val, options?.base || 10) : Number.parseInt(val, options?.base || 10));
        }
    }
    n = Number.isNaN(n) ? options?.dflt || 0 : n;
    if (options) {
        if (typeof options.novalue === "number" && n === options.novalue) n = options.dflt || 0;
        if (typeof options.incr === "number") n += options.incr;
        if (typeof options.mult === "number") n *= options.mult;
        if (Number.isNaN(n)) n = options.dflt || 0;
        if (typeof options.min === "number" && n < options.min) n = options.min;
        if (typeof options.max === "number" && n > options.max) n = options.max;
        if (typeof options.float !== "undefined" && !options.float) n = Math.round(n);
        if (typeof options.zero === "number" && !n) n = options.zero;
        if (typeof options.digits === "number") n = Number.parseFloat(n.toFixed(options.digits));
        if (options.bigint && typeof n === "number" && !Number.isSafeInteger(n)) n = BigInt(val);
    }
    return n;
}

/**
 * Strip all non-digit characters from a string
 * @param {string} str - input string
 * @return {string} only digit in the result
 * @memberof module:lib
 * @method toDigits
  * @example
  * lib.toDigits("+1 (555) 123-4567")
  * // "15551234567"
  * lib.toDigits("abc123def")
  * // "123"
 */
lib.toDigits = function(str)
{
    return (typeof str === "string" ? str : String(str)).replace(this.rxNoDigits, "");
}

/**
 * Return true if value represents true condition, i.e. non empty value including yes, ok, 1, true
 * @param {string|number|boolean} val
 * @param {any} [dflt]
 * @return {boolean}
 * @memberof module:lib
 * @method toBool
  * @example
  * lib.toBool("yes")
  * // true
  * lib.toBool("0")
  * // false
  * lib.toBool(undefined, "true")
  * // true
 */
lib.toBool = function(val, dflt)
{
    if (typeof val === "boolean") return val;
    if (typeof val === "number") return val > 0;
    if (typeof val === "undefined" || typeof val === "function") val = dflt;
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
  * @example
  * lib.toDate("2024-01-02T03:04:05Z")
  * // Date object for 2024-01-02T03:04:05.000Z
  * lib.toDate(1704164645)
  * // Date object from Unix seconds
  * lib.toDate("bad date", null, true)
  * // null
 */
lib.toDate = function(val, dflt, invalid)
{
    if (this.isDate(val)) return val;
    let d = Number.NaN;
    // String that looks like a number
    if (typeof val === "string") {
        val = /^[0-9.]+$/.test(val) ? this.toNumber(val) : val.replace(/([0-9])(AM|PM)/i, "$1 $2");
    }
    if (typeof val === "number") {
        // Convert nanoseconds to milliseconds
        if (val > 2147485547000) val = Math.round(val / 1000);
        // Convert seconds to milliseconds
        if (val < 2147483647) val *= 1000;
    }
    // Remove unsupported timezone names
    if (typeof val === "string") {
        const gmt = val.indexOf("GMT") > -1;
        for (const i in this.tzMap) {
            if ((gmt || this.tzMap[i][3] === false) && val.indexOf(this.tzMap[i][0]) > -1) {
                val = val.replace(this.tzMap[i][0], "");
            }
        }
    }
    if (typeof val !== "string" && typeof val !== "number") val = d;
    if (val) try { d = new Date(val); } catch (_e) {}
    return this.isDate(d) ? d : invalid || (dflt !== undefined && Number.isNaN(dflt)) || dflt === null || dflt === 0 ? null : new Date(dflt || 0);
}

/**
 * Return milliseconds from the date or date string, only number as dflt is supported, for invalid dates returns 0
 * @param {string|number|Date} val
 * @param {any} [dflt]
 * @return {number}
 * @memberof module:lib
 * @method toMtime
  * @example
  * lib.toMtime("2024-01-02T03:04:05Z")
  * // 1704164645000
  * lib.toMtime("bad date", 1000)
  * // 1000
 */
lib.toMtime = function(val, dflt)
{
    val = this.toDate(val, null);
    return val ? val.getTime() : typeof dflt === "number" ? dflt : 0;
}

/**
 * Encode a string into Base64 url safe version
 * @param {string|Buffer|ArrayBuffer} str
 * @return {string}
 * @memberof module:lib
 * @method toBase64url
  * @example
  * lib.toBase64url("hello?")
  * // "aGVsbG8_"
  * lib.toBase64url(Buffer.from("test"))
  * // "dGVzdA=="
 */
lib.toBase64url = function(str)
{
    return Buffer.from(str).toString("base64").replace(/[+/]/g, (x) => (x === '+' ? '-' : '_'));
}

/**
 * Decode base64url into a string
 * @param {string} str
 * @param {boolean} [binary] - return as Buffer
 * @return {string|Buffer}
 * @memberof module:lib
 * @method fromBase64url
  * @example
  * lib.fromBase64url("aGVsbG8_")
  * // "hello?"
  * lib.fromBase64url("dGVzdA==", true)
  * // Buffer containing "test"
 */
lib.fromBase64url = function(str, binary)
{
    if (typeof str !== "string") return "";

    const padding = 4 - str.length % 4;
    if (padding !== 4) {
        for (let i = 0; i < padding; ++i) str += '=';
    }
    str = str.replace(/[_-]/g, (x) => (x === '-' ? '+' : '/'));
    str = Buffer.from(str, "base64");
    return binary ? str : str.toString();
}

/**
 * Return base62 representation for a number
 * @param {number} num
 * @param {string} alphabet
 * @return {string}
 * @memberof module:lib
 * @method toBase62
  * @example
  * lib.toBase62(61)
  * // "Z"
  * lib.toBase62(3844)
  * // "100"
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
 * @param {string} num
 * @param {string} alphabet
 * @return {number}
 * @memberof module:lib
 * @method fromBase62
  * @example
  * lib.fromBase62("Z")
  * // 61
  * lib.fromBase62("100")
  * // 3844
 */
lib.fromBase62 = function(num, alphabet)
{
    if (typeof num !== "string") return 0;
    let total = 0, c;
    if (!alphabet) alphabet = this.base62;
    for (let i = 0; i < num.length; i++) {
        c = num[num.length - 1 - i];
        total += alphabet.indexOf(c) * 62 ** i;
    }
    return total;
}

/**
 * Return a well formatted and validated url or parsed URL object
 * @param {string} str
 * @param {object} [options]
 * @param {boolean} [options.url] - if true return the URL object not string
 * @return {string|URL}
 * @memberof module:lib
 * @method toUrl
  * @example
  * lib.toUrl("https://example.com/a?b=1")
  * // "https://example.com/a?b=1"
  * lib.toUrl("https://example.com", { url: true }).hostname
  * // "example.com"
 */
lib.toUrl = function(str, options)
{
    if (str) try {
        const u = new URL(str);
        return options?.url ? u : u.toString();
    } catch (e) {
        logger.error("toUrl:", e, str, options);
    }
    return "";
}

/**
 * Return a test representation of a number according to the money formatting rules,
 * @param {number} num
 * @param {object} [options]
 * @param {string} [options.locale=en-US]
 * @param {string} [options.currency=USD]
 * @param {string} [options.display=symbol]
 * @param {string} [options.sign=standard]
 * @param {int} [options.min=2]
 * @param {int} [options.max=3]
 * @memberof module:lib
 * @method toPrice
  * @example
  * lib.toPrice(12.5)
  * // "$12.50"
  * lib.toPrice(12.5, { currency: "EUR", locale: "de-DE" })
  * // "12,50 €"
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
    }
    return "";
}

/**
 * Return an email address if valid
 * @param {string} val
 * @param {object} [options]
 * @param {boolean} [options.parse] extract the email from `name <email>` format]
 * @param {int} [options.max] - return "" if length greater than this
 * @return {string}
 * @memberof module:lib
 * @method toEmail
  * @example
  * lib.toEmail("User@Example.COM")
  * // "user@example.com"
  * lib.toEmail("User Name <user@example.com>", { parse: true })
  * // "user@example.com"
  * lib.toEmail("bad..email@example.com")
  * // ""
 */
lib.toEmail = function(val, options)
{
    if (typeof val !== "string" || val.indexOf("..") > -1) return "";
    if (options?.parse) {
        const s = val.indexOf('<');
        if (s >= 0) {
            const e = val.indexOf('>', s);
            if (e > 0) val = val.substring(s + 1, e);
        }
    }
    if (options?.max && val.length > options.max) return "";
    return this.rxEmail.test(val) ? val.trim().toLowerCase() : "";
}

/**
 * Convert to an object from as string of key:val,... pairs
 * @param {string} val
 * @param {object} [options]
 * @param {boolean} [options.delimiter] - pairs separator
 * @param {boolean} [options.separator] - key and value separator
 * @param {boolean} [options.empty] - keep empty keys
 * @param {boolean} [options.noempty] - ignore empty values
 * @param {boolean} [options.mapcamel] - camelize keys
 * @param {string} [options.maptype] - convert values to this type
 * @param {boolean} [options.noproto] - create an object using null prototype
 * @return {object}
 * @memberof module:lib
 * @method toMap
 * @example
 * lib.toMap("a:1,b:2,c:4:5")
 * { a: '1', b: '2', c: [ '4', '5' ] }
 */
lib.toMap = function(val, options)
{
    return lib.split(val, options?.delimiter || ",").
        map((y) => (lib.split(y, options?.separator || /[:;]/, options))).
        reduce((a, b) => {
            let v;
            if (b.length < 2) {
                if (options?.empty) v = "";
            } else {
                v = b.length === 2 ? b[1] : b.slice(1);
                if (options?.maptype) v = lib.toValue(v, options.maptype, options);
            }
            if (options?.noempty && lib.isEmpty(v)) return a;
            if (options?.mapcamel) b[0] = lib.toCamel(b[0]);
            a[b[0]] = v;
            return a;
        }, options?.noproto ? Object.create(null) : {});
}

/**
 * Convert a value to the proper type, default is to return a string or convert the value to a string if no type is specified,
 * options is passed to all lib.toXXX functions as is, so type specific properties can be used.
 * @param {any} val
 * @param {string} [type]
 * - null|"" - return the value as is without any conversion
 * - auto - detect type with {@link module:lib.autoType}
 * - js - parse JSON into object or array
 * - set|list|array - use {@link module.lib.split} to convert into a list
 * - map - use {@link module.lib.toMap} to convert into an object
 * - real|float|double|decimal - to floating number
 * - int|long|number|now|counter|bigint - a number
 * - bool|boolean - boolean value
 * - date|time|datetime|timestamp - a Date object
 * - mtime - convert date into milliseconds
 * - url - use {@link module.lib.toUrl}
 * - email - use {@link module.lib.toEmail}
 * - phone|e164 - validate and convert into a valid phone number with only digits
 * - json - stringify a value
 * - none - return as is
 * @param {object} [options]
 * @return {string|number|object|any}
 * @memberof module:lib
 * @method toValue
  * @example
  * lib.toValue("123", "int")
  * // 123
  * lib.toValue("true", "bool")
  * // true
  * lib.toValue("a,b,c", "list")
  * // ["a", "b", "c"]
  * lib.toValue('{"a":1}', "js")
  * // { a: 1 }
  * lib.toValue("user@example.com", "email")
  * // "user@example.com"
  * @example
  * lib.toString(123)
  * // "123"
  * lib.toString(null)
  * // ""
 */
lib.toValue = function(val, type, options)
{
    if (type === null || type === "") return val;
    type = typeof type === "string" && type.trim() || type;

    switch (type) {
    case "none":
        return val;

    case "auto":
        if (typeof val === "undefined" || val === null) return "";
        type = this.autoType(val);
        return this.toValue(val, type, options);

    case "js":
        return typeof val === "string" ? this.jsonParse(val, options) : val;

    case "set":
    case "list":
    case "array":
        return this.split(val, options?.separator, options);

    case "map":
        return this.toMap(val, options);

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
    case "int64":
    case "integer":
    case "smallint":
    case "long":
    case "bigint":
    case "numeric":
    case "number":
    case "now":
    case "clock":
    case "ttl":
    case "timeout":
    case "random":
    case "counter":
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
        if (typeof val === "number") {
            // Keep US phones without 1
            if (type[0] === "p" && val < 19999999999 && val > 10000000000) val -= 10000000000;
            if (type[0] === "e" && val < 10000000000) val += 10000000000;
            val = String(val);
        } else {
            if (typeof val !== "string") return "";
            const d = val.match(this.rxPhone);
            if (!d) return "";
            val = this.toDigits(d[1]).slice(0, 15);
        }
        const min = typeof options?.min === "number" ? options.min : 5;
        if (min && val.length < min) return "";
        // Keep US phones without 1
        if (type[0] === "p" && val.length === 11 && val[0] === "1") val = val.substr(1);
        if (type[0] === "e" && val.length === 10) val = "1" + val;
        if (options?.max > 0 && val.length > options.max) return "";
        return val;

    case "json":
        return this.stringify(val);

    case "lower":
        return this.toString(val).toLowerCase();

    case "upper":
        return this.toString(val).toUpperCase();

    case "symbol":
        return this.rxSymbol.test(val) ? val : "";

    default:
        if (typeof options?.toValue === "function") {
            return options.toValue(val, options);
        }
        return this.toString(val, options);
    }
}

/**
 * Convert a value to a string, use default Javascript toString convertion of any object,
 * null|undefined will return ""
 * @param {any} val
 * @return {string}
 * @memberof module:lib
 * @method toString
 */
lib.toString = function(val)
{
    return typeof val === "string" ? val : val === null || val === undefined ? "" : String(val);
}

/**
 * Safely create a regexp object, if invalid returns undefined, the options can be a string with srandard RegExp
 * flags or an object with the following properties:
 * @param {string} str
 * @param {object} [options]
 * @param {boolean} [options.ingoreCase] - similar to i
 * @param {boolean} [options.globalMatch] - similar to m
 * @param {boolean} [options.multiLine] - similar to m
 * @param {boolean} [options.unicode] - similar to u
 * @param {boolean} [options.sticky] - similar to y
 * @param {boolean} [options.escape] - escape all special symbols or symbol `e`
 * @param {RegExp}
 * @memberof module:lib
 * @method toRegexp
  * @example
  * lib.toRegexp("hello", "i").test("HELLO")
  * // true
  * lib.toRegexp("a+b", { escape: true }).test("a+b")
  * // true
  * lib.toRegexp("[")
  * // undefined
 */
lib.toRegexp = function(str, options)
{
    if (str instanceof RegExp) return str;
    try {
        // Check for JSON stringified format
        if (typeof str === "string" && str.startsWith("^/") && str.endsWith("$")) {
            const e = str.lastIndexOf("/");
            if (e > -1) {
                options = str.slice(e + 1, -1)
                str = str.slice(2, e);
            }
        }
        let flags = typeof options === "string" && /^[igmuye]+$/.test(options) ? options :
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
 * Add a regexp to the object that consist of list of patterns and compiled regexp, this is used in the config type `regexpobj`
 * @param {object} obj
 * @param {string} val
 * @param {object} [options]
 * @param {boolean} [options.set] - replce the whole list
 * @param {boolean} [options.not] - negative logic, return false if matched
 * @param {boolean} [options.del] - delete value, not add
 * @param {boolean} [options.escape] - escape all special characters
 * @param {boolean} [options.regexp] - RegExp options
 * @param {boolean} [options.errnull] - return null on error
 * @return {object} in format { list, rx }
 * @memberof module:lib
 * @method toRegexpObj
  * @example
  * const obj = lib.toRegexpObj(null, "admin")
  * // { list: ["admin"], rx: /admin/ }
  *
  * obj.rx.test("admin")
  * // true
  *
  * lib.toRegexpObj(obj, "!admin")
  * // { list: [], rx: null }
 */
lib.toRegexpObj = function(obj, val, options)
{
    if (val === null) obj = null;
    if (this.typeName(obj) !== "object") obj = {};
    if (!Array.isArray(obj.list)) obj.list = [];
    if (val) {
        if (typeof val === "string" && (options?.del || val[0] === "!")) {
            const idx = obj.list.indexOf(val[0] === "!" ? val.substr(1) : val);
            if (idx > -1) obj.list.splice(idx, 1);
        } else {
            if (options?.set) obj.list = [];
            if (!Array.isArray(val)) val = [ val ];
            for (const i in val) {
                if (typeof val[i] !== "string") continue;
                if (obj.list.indexOf(val[i]) === -1) obj.list.push(val[i]);
            }
        }
    }
    if (obj.list.length) {
        try {
            const str = obj.list.map((x) => {
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
    if (options?.not) obj.not = true;
    return obj;
}

/**
 * Parse the given `duration` and return milliseconds.
 *
 * @param {string} duration
 * @return {number|undefined}
 * @memberof module:lib
 * @method toMilliseconds
 * @example
 * lib.toMilliseconds('-3 day')
 * -259200000
 * lib.toMilliseconds('2.5 hrs')
 * 9000000
 * lib.toMilliseconds('1m')
 * 60000
 * lib.toMilliseconds('2.5 hr')
 * 9000000
 * lib.toMilliseconds('2.5 mon')
 * 6480000000
 */
lib.toMilliseconds = function(duration)
{
    var d = /^(-?(?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|mos?|mons?|months?|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$/i.exec(duration);
    if (!d) return;
    const n = Number.parseFloat(d[1]);
    if (d[2]) {
        const type = d[2].toLowerCase();
        switch (type[0]) {
        case "s":
            return n * 1000;
        case "h":
            return n * 3600000;
        case "d":
            return n * 86400000;
        case "m":
            if (!type[1]) return n * 60000;
            if (type[1] === "o") return n * 30 * 86400000;
            if (type[2] === "n") return n * 60000;
            break;
        case "w":
            return n * 86400000 * 7;
        case "y":
            return n * 86400000 * 365.25;
        }
    }
    return n;
}

/**
 * Given time in milliseconds, return how long ago it happened
 * @param {number} mtime
 * @param {object} [options]
 * @param {boolean|int} [options.age] - if true make it duration from now or if age > 1 then since that date in milliseconds
 * @param {boolean} [options.short] - if true use first letters only
 * @param {boolean} [options.round] - a number, 1 return only 1st part, 2 - 1st and 2nd parts
 * @return {string}
 * @memberof module:lib
 * @method toDuration
  * @example
  * lib.toDuration(65000)
  * // "1 minute 5 seconds"
  * lib.toDuration(3600000, { short: true })
  * // "1h"
  * lib.toDuration(Date.now() - 60000, { age: true, round: 1 })
  * // "1 minute"
 */
lib.toDuration = function(mtime, options)
{
    var str = "";
    mtime = typeof mtime === "number" ? mtime : util.types.isDate(mtime) ? mtime.getTime() : this.toNumber(mtime);
    if (mtime > 0) {
        const lang = options?.lang;
        if (options?.age > 1) mtime = options.age - mtime; else
        if (options?.age > 0) mtime = Date.now() - mtime;

        const secs = Math.max(0, Math.floor(mtime/1000));
        const d = Math.floor(secs / 86400);
        const mm = Math.floor(d / 30);
        const w = Math.floor(d / 7);
        const h = Math.floor((secs - d * 86400) / 3600);
        const m = Math.floor((secs - d * 86400 - h * 3600) / 60);
        const s = Math.floor(secs - d * 86400 - h * 3600 - m * 60);
        if (mm > 0) {
            str = mm > 1 ? this.__({ phrase: options?.short ? "%sm": "%s months", lang }, mm) :
                           this.__({ phrase: options?.short ? "1m" : "1 month", lang });
            if (options?.round === 1) return str;
            if (d > 0) str += " " + (d > 1 ? this.__({ phrase: options?.short ? "%sd" : "%s days", lang }, d) :
                                             this.__({ phrase: options?.short ? "1d" : "1 day", lang }));
            if (options?.round === 2) return str;
            if (h > 0) str += " " + (h > 1 ? this.__({ phrase: options?.short ? "%sh" : "%s hours", lang }, h) :
                                             this.__({ phrase: options?.short ? "1h": "1 hour", lang }));
        } else
        if (w > 0) {
            str = w > 1 ? this.__({ phrase: options?.short ? "%sw" : "%s weeks", lang }, w) :
                          this.__({ phrase: options?.short ? "1w" : "1 week", lang });
            if (options?.round === 1) return str;
            if (d > 0) str += " " + (d > 1 ? this.__({ phrase: options?.short ? "%sd" : "%s days", lang }, d) :
                                             this.__({ phrase: options?.short ? "1d" : "1 day", lang }));
            if (options?.round === 2) return str;
            if (h > 0) str += " " + (h > 1 ? this.__({ phrase: options?.short ? "%sh" : "%s hours", lang }, h) :
                                             this.__({ phrase: options?.short ? "1h" : "1 hour", lang }));
        } else
        if (d > 0) {
            str = d > 1 ? this.__({ phrase: options?.short ? "%sd" : "%s days", lang }, d) :
                          this.__({ phrase: options?.short ? "1d" : "1 day", lang });
            if (options?.round === 1) return str;
            if (h > 0) str += " " + (h > 1 ? this.__({ phrase: options?.short ? "%sh" : "%s hours", lang }, h) :
                                             this.__({ phrase: options?.short ? "1h" : "1 hour", lang }));
            if (options?.round === 2) return str;
            if (m > 0) str += " " + (m > 1 ? this.__({ phrase: options?.short ? "%sm" : "%s minutes", lang }, m) :
                                             this.__({ phrase: options?.short ? "1m" : "1 minute", lang }));
        } else
        if (h > 0) {
            str = h > 1 ? this.__({ phrase: options?.short ? "%sh" : "%s hours", lang }, h) :
                          this.__({ phrase: options?.short ? "1h" : "1 hour", lang });
            if (options?.round === 1) return str;
            if (m > 0) str += " " + (m > 1 ? this.__({ phrase: options?.short ? "%sm" : "%s minutes", lang }, m) :
                                             this.__({ phrase: options?.short ? "1m" : "1 minute", lang }));
        } else
        if (m > 0) {
            str = m > 1 ? this.__({ phrase: options?.short ? "%sm" : "%s minutes", lang }, m) :
                          this.__({ phrase: options?.short ? "1m" : "1 minute", lang });
            if (options?.round === 1) return str;
            if (s > 0) str += " " + (s > 1 ? this.__({ phrase: options?.short ? "%ss" : "%s seconds", lang }, s) :
                                             this.__({ phrase: options?.short ? "1s" : "1 second", lang }));
        } else {
            str = secs > 1 ? this.__({ phrase: options?.short ? "%ss" : "%s seconds", lang }, secs) :
                             this.__({ phrase: options?.short ? "1s" : "1 second", lang });
        }
    }
    return str;
}

/**
 * Return size human readable format
 * @param {number} size
 * @param {boolean} [decimals=2]
 * @memberof module:lib
 * @method toSize
  * @example
  * lib.toSize(1024)
  * // "1 KBytes"
  * lib.toSize(1536, 1)
  * // "1.5 KBytes"
 */
lib.toSize = function(size, decimals = 2)
{
    var i = size > 0 ? Math.floor(Math.log(size) / Math.log(1024)) : 0;
    return (size / 1024 ** i).toFixed(typeof decimals === "number" ? decimals : 2) * 1 + ' ' + [this.__('Bytes'), this.__('KBytes'), this.__('MBytes'), this.__('GBytes'), this.__('TBytes')][i];
}

/**
 * Convert a list of records into the specified format, supported formats are: `xml, csv, json, jsontext`.
 * @param {string} format
 * - For `csv` the default separator is comma but can be specified with `options.separator`. To produce columns header specify `options.header`.
 * - For `json` format puts each record as a separate JSON object on each line, so to read it back
 *   it will require to read every line and parse it and add to the list.
 * - For `xml` format the name of the row tag is `<row>` but can be specified with `options.tag`.
 * @param {object|object[]} data
 * @param {object} [options]
 * @param {string[]} [options.allow] - which is a list of property names that are allowed only in the output for each record, non-existent
 * properties will be replaced by empty strings.
 * @param {object} [options.mapping] - object property can redefine different tag/header names to be put into the file
 * instead of the exact column names from the records.
 * @param {string} [options.quotes="] - quotes for CSV
 * @param {string} [options.separator=,] - CSV field separator
 * @memberof module:lib
 * @method toFormat
  * @example
  * lib.toFormat("csv", [{ id: 1, name: "Bob" }], { header: true })
  * // "id,name\r\n1,Bob\r\n"
  * lib.toFormat("json", [{ id: 1 }])
  * // "{\"id\":1}\n"
  * lib.toFormat("xml", [{ id: 1 }])
  * // "<row>\n<id>1</id>\n</row>\n"
  * lib.toFormat("jsontext", [{ id: 1 }])
  * // formatted JSON text
 */
lib.toFormat = function(format, data, options)
{
    var rows = Array.isArray(data) ? data : Array.isArray(data.data) ? data.data : this.isObject(data) ? [ data ] : [];
    if (!rows.length) return "";
    const allow = this.isArray(options?.allow), map = options?.mapping || this.empty;
    let v, text = "";

    switch (format) {
    case "xml":
        const tag = options?.tag || "row";
        for (let i = 0; i < rows.length; i++) {
            text += "<" + tag + ">\n";
            text += (allow || Object.keys(rows[i])).map((y) => {
                v = rows[i][y];
                v = Array.isArray(v) ? v.join(",") : typeof v === "object" ? lib.stringify(v) : String(v ?? "");
                const t = map[y] || y;
                return "<" + t + ">" + lib.textToXml(v) + "</" + t + ">\n";
            });
            text += "</" + tag + ">\n";
        }
        break;

    case "csv":
        let keys;
        const sep = options?.separator || ",";
        const quotes = options?.quotes || '"';
        const rx = new RegExp("[\r\n" + sep + quotes + "]");

        if (options?.header) {
            keys = allow || Object.keys(rows[0]);
            text += keys.map((x) => (map[x] || x)).join(sep) + "\r\n";
        }
        for (let i = 0; i < rows.length; i++) {
            keys = allow || Object.keys(rows[i]);
            text += keys.map((y) => {
                v = rows[i][y];
                v = Array.isArray(v) ? v.join(",") : typeof v === "object" ? lib.stringify(v) : String(v ?? "");
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
 *
 * To use @ in the template specify it as @@
 *
 * Placeholders can have default or/and encoding
 *
 *  - default only: `@name|dflt@`
 *  - encoding with default: `@name|dflt|encoding@`
 *  - encoding no default: `@name||encoding@`
 *
 * Default placeholders:
 * - @exit@ - stop processing and return the template ignoring the rest
 * - @RAND@ - produce a random number using Math.random
 * - @n@ - produce a line break, newline
 * - @p@ - produce 2 newlines
 *
 * @param {string} text
 * @param {object|object[]} obj can be an object or an array of objects in which case all objects will be checked for the value until non empty.
 * @param {object} [options]
 * @param {string[]} [options.allow] - placeholders with a name present in this list will be replaced, all other will be replaced with empty string
 * @param {string[]} [options.skip] - placeholders with a name present in this list will be ignored, the placeholer will be kept
 * @param {string[]} [options.only] - placeholders with a name present in this list will be replaced only, all other will be ignored and kept as placeholders
 * @param {string} [options.encoding] - can be url or base64, the replaced values will be encoded accordingly
 * Encoding options:
 * - url, base64, entity, strftime, mtime, date
 * - d-url, d-base64, d-entity - decode value instead of encode it
 * @param {string} [options.separator1] - left side of the placehoder, default is @
 * @param {string} [options.separator2] - right side of the placeholder, default is @
 *
 * @example
 *
 * lib.toTemplate("http://www.site.com/@code@/@id@", { id: 123, code: "YYY" }, { encoding: "url" })
 * 'http://www.site.com/YYY/123'
 *
 * lib.toTemplate("Hello @name|friend@!", {})
 * 'Hello friend!'
 *
 * @memberof module:lib
 * @method toTemplate
 */

lib.toTemplate = function(text, obj, options)
{
    function encoder(enc, v) {
        switch (enc) {
        case "url":
            if (typeof v !== "string") v = String(v);
            v = lib.encodeURIComponent(v);
            break;
        case "d-url":
            if (typeof v !== "string") v = String(v);
            v = lib.decodeURIComponent(v);
            break;
        case "base64":
            if (typeof v !== "string") v = String(v);
            v = Buffer.from(v).toString("base64");
            break;
        case "d-base64":
            if (typeof v !== "string") v = String(v);
            v = Buffer.from(v, "base64").toString();
            break;
        case "entity":
            v = lib.textToEntity(v);
            break;
        case "d-entity":
            v = lib.entityToText(v);
            break;
        case "strftime":
            v = lib.strftime(v);
            break;
        case "mtime":
            v = lib.toMtime(v);
            break;
        case "date":
            v = lib.toDate(v);
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
    if (typeof text !== "string" || !text) return "";
    const rc = [];
    let i, j, top;
    if (!options) options = {};
    if (options.__exit === undefined) {
        top = 1;
        options.__exit = 0;
    }
    if (!Array.isArray(obj)) obj = [obj];
    for (i = 0; i < obj.length; i++) {
        if (typeof obj[i] === "object" && obj[i]) rc.push(obj[i]);
    }

    const rxVal = /^([a-zA-Z0-9._-]+)(\|.+)?$/;
    const rxIf = /^(if|ifnull|ifnotnull|ifempty|ifnotempty|ifne|ifeq|ifgt|ifge|iflt|ifle|ifnot|ifall|ifstr|ifnotstr) ([a-zA-Z0-9._-]+) *(.*)$/;

    let tmpl = "", str = text;
    const sep1 = options.separator1 || "@", sep2 = options.separator2 || sep1;
    while (str) {
        const start = str.indexOf(sep1);
        if (start === -1) {
            tmpl += str;
            break;
        }
        let end = str.indexOf(sep2, start + sep1.length);
        if (end === -1) {
            tmpl += str;
            break;
        }
        let tag = str.substr(start + sep1.length, end - start - sep2.length);
        tmpl += str.substr(0, start);
        str = str.substr(end + sep2.length);
        let d, v = null, dflt = null, field = null, enc = options.encoding;

        if (tag === "") {
            v = sep1;
        } else

        if (tag === "exit") {
            options.__exit = 1;
            break;
        } else

        if (tag === "RAND") {
            v = Math.random();
            tmpl += v;
            continue;
        } else

        if (tag === "n" || tag === "p") {
            v = tag === "p" ? "\n\n" : "\n";
            tmpl += v;
            continue;
        } else

        if (tag.startsWith("if")) {
            // @if type tester,admin@
            // @endif@
            end = str.indexOf(sep1 + "endif" + sep2);
            if (end === -1) continue;
            let body = str.substr(0, end);
            str = str.substr(end + 5 + sep1.length + sep2.length);
            d = tag.match(rxIf)
            if (!d) continue;
            let ok, val = null, t = d[2];
            i = t.indexOf(".");
            if (i > 0) {
                field = t.substr(i + 1);
                t = t.substr(0, i);
            }
            for (i = 0; i < rc.length && !val; i++) {
                val = typeof rc[i][t] === "function" ? rc[i][t]() : rc[i][t];
                if (val && field && typeof val === "object") {
                    field = field.split(".");
                    for (j = 0; val && j < field.length; j++) {
                        val = val ? val[field[j]] : undefined;
                        if (typeof val === "function") val = val();
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
                ok = val && lib.includes(lib.split(d[3]), lib.split(val));
                break;
            case "ifne":
                ok = val !== d[3];
                break;
            case "ifnot":
                ok = !val || !lib.includes(lib.split(d[3]), lib.split(val));
                break;
            case "ifall":
                val = lib.split(val);
                ok = lib.split(d[3]).every((x) => (val.includes(x)));
                break;
            case "ifstr":
                ok = lib.testRegexp(val || "", lib.toRegexp(d[3], "i"));
                break;
            case "ifnotstr":
                ok = !lib.testRegexp(val || "", lib.toRegexp(d[3], "i"));
                break;
            case "ifeq":
                ok = val === d[3];
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
                    v = typeof rc[i][tag] === "function" ? rc[i][tag]() : rc[i][tag];
                    if (v && field && typeof v === "object") {
                        field = field.split(".");
                        for (j = 0; v && j < field.length; j++) {
                            v = v ? v[field[j]] : undefined;
                            if (typeof v === "function") v = v();
                        }
                    }
                }
                if (typeof options.preprocess === "function") v = options.preprocess(tag, field, v, dflt, enc);
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
            if (Array.isArray(v) && (typeof v[0] === "string" || typeof v[0] === "number")) v = v.toString(); else
            if (typeof v === "object") v = this.stringify(v);
            if (encoder) v = encoder(enc, v, options);
        }
        if (v !== null && v !== undefined && v !== "") tmpl += v;
        if (options.__exit) break;
    }
    if (options.noline) tmpl = tmpl.replace(/[\r\n]/g, "");
    if (options.nospace) tmpl = tmpl.replace(/ {2,}/g, " ").trim();
    if (top) options.__exit = null;
    return tmpl;
}

/**
 * Return RFC3339 formatted timestamp for a date or current time
 * @param {string} [date]
 * @return {string}
 * @memberof module:lib
 * @method toRFC3339
  * @example
  * lib.toRFC3339(new Date("2024-01-02T03:04:05.006Z"))
  * // "2024-01-02T03:04:05.006+00:00" in UTC timezone
  * lib.toRFC3339()
  * // current local time in RFC3339 format
 */
lib.toRFC3339 = function (date)
{
    date = date ? date : new Date();
    const offset = date.getTimezoneOffset();
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
 * Serialize name/value into a string to be set in header Set-Cookie, options may contain cookie
 * parameters according to https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Cookies
 * @param {string} name
 * @param {string} [value]
 * @param {string} [options]
 * @return {string}
 * @memberof module:lib
 * @method toCookie
  * @example
  * lib.toCookie("sid", "abc 123")
  * // "sid=abc%20123"
  * lib.toCookie("sid", "abc", { httpOnly: true, secure: true, sameSite: "Strict" })
  * // "sid=abc; HttpOnly; Secure; SameSite=Strict"
  * lib.toCookie("sid", "", { maxAge: 3600, path: "/" })
  * // "sid=; Max-Age=3600; Path=/"
 */
lib.toCookie = function(name, value, options)
{
    if (!name) return "";

    let str = name + '=' + lib.encodeURIComponent(value ?? "");

    if (!options) return str;

    if (options.maxAge > 0) {
        str += '; Max-Age=' + options.maxAge;
    }

    if (options.domain) {
        str += '; Domain=' + options.domain;
    }

    if (options.path) {
        str += '; Path=' + options.path;
    }

    if (options.expires) {
        if (lib.isNumber(options.expires)) {
            str += '; Expires=' + new Date(options.expires).toUTCString()
        } else

        if (util.types.isDate(options.expires)) {
            str += '; Expires=' + options.expires.toUTCString()
        }
    }

    if (options.httpOnly) {
        str += '; HttpOnly';
    }

    if (options.secure) {
        str += '; Secure';
    }

    if (options.partitioned) {
        str += '; Partitioned'
    }

    if (options.priority) {
        str += '; Priority=' + options.priority;
    }

    if (options.sameSite) {
        str += '; SameSite=' + options.sameSite;
    }

    return str;
}

/**
 * Stringify JSON into base64 string, if secret is given, sign the data with it
 * @param {any} data
 * @param {string} secret
 * @param {object} [options]
 * @return {string}
 * @memberof module:lib
 * @method jsonToBase64
 * @example
 * lib.jsonToBase64({ a: 1 })
 * // "eyJhIjoxfQ=="
 * lib.jsonToBase64([1, 2, 3])
 * // "WzEsMiwzXQ=="
 */
lib.jsonToBase64 = function(data, secret, options)
{
    data = this.stringify(data);
    if (secret) {
        return this.encrypt(secret, data, options);
    }
    return Buffer.from(data).toString("base64");
}

/**
 * Parse base64 JSON into JavaScript object, in some cases this can be just a number then it is passed as it is, if secret is given verify
 * that data is not changed and was signed with the same secret
 * @param {any} data
 * @param {string} secret
 * @param {object} [options]
 * @return {object}
 * @memberof module:lib
 * @method base64ToJson
  * @example
  * lib.base64ToJson("eyJhIjoxfQ==")
  * // { a: 1 }
  * lib.base64ToJson("123")
  * // 123
 */
lib.base64ToJson = function(data, secret, options)
{
    var rc = "";
    if (data === "" || data === undefined || data === null) return rc;
    if (secret) data = this.decrypt(secret, data, options);
    try {
        if (typeof data === "number" || (typeof data === "string" && lib.rxNumber.test(data))) {
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
 * @param {string} name
 * @param {object} options
 * @memberof module:lib
 * @method jsonFormatPreset
 */
lib.jsonFormatPreset = function(name, options)
{
    if (!name) return;
    let preset = lib._jsonFormatPresets[name];
    if (!preset) preset = lib._jsonFormatPresets[name] = {};
    for (const p in options) preset[p] = options[p];
    return preset;
}

/**
 * Nicely format an object with indentations, optional `indentlevel` can be used to control until which level deep to use newlines for objects.
 * @param {object} obj
 * @param {object} [options]
 * @param {string} [options.preset] - predefined set of options, `compact` prints yaml-like text version, if a list all presets are combined
 * @param {string} [options.indent] - initial indent, empty default
 * @param {string} [options.ilevel] - level to start to use spaces for indentation, 0 default
 * @param {string} [options.ignore] - regexp with properties to ingore
 * @param {string} [options.skipnull] - do not print null/undefined/""
 * @param {string} [options.skipempty] - skip all empty object accorsding to `lib.isEmpty`
 * @param {string} [options.map] - an object to map property names
 * @param {string} [options.replace] - an object for string values replacement: { ORIG: REPL... }
 * @param {string} [options.preprocess] - a function(name, val, options) to run before prints, return undefined to skip
 * @param {string} [options.sbracket1, sbracket2] - open/close brackets for arrays, [ ]
 * @param {string} [options.cbracket1, cbracket2] - open close brackets for obejcts, { }
 * @param {string} [options.nl1, nl2] - newline chars before and after a single property
 * @param {string} [options.quote1, quote2] - quotes for property names
 * @param {string} [options.squote1, squote2] - quotes for string values
 * @param {string} [options.comma] - comma separator between items
 * @param {string} [options.sep] - separator between array items, comma by default
 * @param {string} [options.space] - symbol for indentation
 * @param {string} [options.nspace] - how many spaces to use for indentation, 4
 * @param {string} [options.prefix] - prefix for array items, each item on new line, requires `nl1`
 * @param {string} [options.wrap] - wrap long strings at this length
 * @param {string} [options.over] - number greater than 1 to allow extra characters over wrap length
 * @param {string} [options.delim] - characters that trigger wrapping
 * @memberof module:lib
 * @method jsonFormat
  * @example
  * lib.jsonFormatPreset("plain", { quote1: "", quote2: "", squote1: "", squote2: "" })
  * // registers or updates the "plain" preset
  * lib.jsonFormat({ a: "test" }, { preset: "plain" })
  * // "{\na: test\n}"
  * @example
  * lib.jsonFormat({ a: 1, b: true })
  * // "{\n    \"a\": 1, \n    \"b\": true\n}"
  * lib.jsonFormat({ a: [1, 2] }, { preset: "compact" })
  * // yaml-like compact text
  * lib.jsonFormat('{"a":1}')
  * // pretty formatted object string
  * lib.jsonFormat({ password: "secret" }, { hide: /password/ })
  * // hides matched values
 */
lib.jsonFormat = function(obj, options)
{
    if (typeof options === "string") options = { indent: options, __level: 0 };
    if (!options) options = { __level: 0 };
    if (typeof options.__level !== "number") options = lib.clone(options, { __level: 0 });

    // Shortcut to parse and format json from the string
    if (typeof obj === "string" && obj !== "") {
        if (!/^[[{.+]}]$/.test(obj.trim())) return obj;
        obj = this.jsonParse(obj, { dflt: { data: obj } });
    }
    const type = this.typeName(obj);
    if (type === "proxy") {
        return options.squote1 + "proxy" + options.squote2;
    }

    if (!options.__preset) {
        const presets = lib.isArray(options.preset, [options.preset]);
        const preset = Object.assign({}, lib._jsonFormatPresets.default, ...presets.map((x) => (lib._jsonFormatPresets[x])));
        for (const p in preset) {
            if (options[p] === undefined) options[p] = preset[p];
        }
        options.__preset = 1;
    }

    let count = 0, val, h, t, indent;
    let text = type === "array" ? options.sbracket1 : options.cbracket1;
    const map = options.map || lib.empty;
    // Insert newlines only until specified level deep
    const nline = !options.indentlevel || options.__level < options.indentlevel;
    // Top level prefix set, skip new line for the first item
    const prefix = options.__prefix;
    options.__prefix = undefined;

    for (let name in obj) {
        if (options.ignore?.test(name)) continue;
        val = obj[name];
        if (typeof options.preprocess === "function") {
            val = options.preprocess(name, val, options);
            if (val === undefined && !options.skipnull) continue;
        }

        if (options.skipnull && (val === "" || val === null || val === undefined)) continue;
        if (options.skipempty && this.isEmpty(val)) continue;
        if (options.skipvalue?.test(val)) continue;

        h = options.hide?.test(name);
        if (count > 0) {
            text += type === "array" ? options.sep : options.comma;
        }
        name = map[name] || name;
        if (type !== "array") {
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

        const vtype = this.typeName(val);
        switch (vtype) {
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
            if (type === "array" && options.prefix && options.nl1) {
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

        case "proxy":
            val = "proxy";

        case "string":
            if (h) {
                text += "...";
                break;
            }
            for (const r in options.replace) {
                val = val.replaceAll(r, options.replace[r]);
            }
            if (options.wrap > 0 && val.length > options.wrap && options.nl1) {
                text += lib.wrap(val, { quotes: [options.squote1, options.squote2], wrap: options.wrap, nl: options.nl1, over: options.over, delim: options.delim, indent });
            } else {
                text += options.squote1 + val + options.squote2;
            }
            break;

        case "error":
        case "date":
        case "regexp":
            text += h ? "..." : val.toString();
            break;

        case "undefined":
            break;

        default:
            text += ("unknown: " + vtype);
        }
        count++;
    }
    text += type === "array" ? options.sbracket2 : ((nline && options.nl2 ? options.nl2 + options.indent : "") + options.cbracket2);
    return text;
}

/**
 * JSON stringify without exceptions, on error just returns an empty string and logs the error
 * @param {any} obj
 * @param {function} [replacer]
 * @param {string|number} [space]
 * @param {boolean} [escape] - escape Unicode
 * @memberof module:lib
 * @method stringify
  * @example
  * lib.stringify({ a: 1 })
  * // "{\"a\":1}"
  * lib.stringify({ a: 1 }, null, 2)
  * // "{\n  \"a\": 1\n}"
  * lib.stringify({ text: "привет" }, null, 0, true)
  * // "{\"text\":\"\\u043f\\u0440\\u0438\\u0432\\u0435\\u0442\"}"
 */
lib.stringify = function(obj, replacer, space, _escape)
{
    try {
        obj = replacer || space ? JSON.stringify(obj, replacer, space) : JSON.stringify(obj);
        if (_escape) obj = lib.escapeUnicode(obj);
        return obj;
    } catch (e) {
        logger.error("stringify:", e.stack);
        return "";
    }
}

/**
 * Convert an object structure to a string with simplified format, used for logging
 * @param {object} obj
 * @param {objects} [options]
 * @param {int} [options.length=512] - max string length to output
 * @param {int} [options.count=50] - max number of items in arrays/maps
 * @param {int} [options.keys=50] - max number of properties per object
 * @param {int} [options.depth=7] - how deep to go into objects
 * @param {object} [options.replace] - replace occurences of a property with value: { "aaa": /^__/g }
 * @param {RegExp} [options.allow] - only output matched properties
 * @param {RegExp} [options.ignore] - skip matched properties
 * @param {boolean} [options.errstack] - show full error stack in Error
 * @param {boolean} [options.undefined] - show undefined values
 * @param {boolean} [options.keepempty] - show empty values
 * @param {string} [options.strftime] - output dates with given format
 * @param {boolean|number} [options.func] - output functions as type, if > 1 output code
 * @param {boolean} [options.newline] - use newline after each object
 * @return {string}
 * @memberof module:lib
 * @method inspect
 * @example
 * > lib.inspect({ a: 1, b: { c: 2 }, s: "test" })
 * 'a: 1, b: {c: 2}, s: test'
 * > lib.inspect(process.features)
 * 'inspector: true, debug: false, uv: true, ipv6: true, tls_alpn: true, tls_sni: true, tls_ocsp: true, tls: true, openssl_is_boringssl: false'
 */
lib.inspect = function(obj, options)
{
    if (typeof obj !== "object") {
        let str = typeof obj === "string" ? obj : typeof obj === "number" || typeof obj === "boolean" ? String(obj) : "";
        if (str && options) {
            const length = options.length || 512;
            for (const p in options.replace) str = str.replace(options.replace[p], p);
            if (str.length > length) str = str.slice(0, length) + ` (...${str.length-length})`;
        }
        return str;
    }
    if (!options) options = { __depth: 0 };
    const length = options.length || 512;
    const nkeys = options.keys || 50;
    const count = options.count || 50;
    const depth = options.depth || 7;
    const ignore = util.types.isRegExp(options.ignore) ? options.ignore : null;
    const allow = util.types.isRegExp(options.allow) ? options.allow : null;
    const hide = util.types.isRegExp(options.hide) ? options.hide : null;
    const comma = options.newline ? ",\n " : ", ";

    let rc = "", n = 0, p, v, h, e, t, keys = [];

    const type = lib.typeName(obj);
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
        if (ignore?.test(p)) continue;
        if (allow && !allow.test(p)) continue;
        const desc = Object.getOwnPropertyDescriptor(obj, p);
        if (desc) {
            v = desc.value;
        } else {
            v = obj[p];
        }
        if (v === undefined && !options.undefined) continue;
        h = hide?.test(p);
        t = lib.typeName(v);

        switch (t) {
        case "buffer":
            if (v.length || options.keepempty) {
                if (p || v.length) {
                    if (rc) rc += ", ";
                    if (p) rc += p + ": ";
                    if (!h) {
                        rc += v.slice(0, length).toString("hex");
                        if (v.length > length) {
                            rc += `...(${v.length - length})`
                        }
                    }
                }
                n++;
            }
            break;

        case "set":
            v = Array.from(v);
        case "array":
            if (v.length || options.keepempty) {
                if (options.__depth >= depth) {
                    if (rc) rc += ", ";
                    if (p) rc += p + ": ";
                    rc += `...(${depth})`;
                    n++;
                } else {
                    if (typeof options.__depth !== "number") {
                        options = Object.assign({}, options, { __depth: 0 });
                    }
                    if (!options.__seen) options.__seen = new WeakSet();
                    if (options.__seen.has(v)) {
                        if (rc) rc += ", ";
                        if (p) rc += p + ": ";
                        rc += "...(*)";
                        n++;
                    } else {
                        options.__seen.add(v);
                        options.__depth++;
                        if (p || v.length) {
                            if (rc) rc += ", ";
                            if (p) rc += p + ": ";
                            rc += "[" + v.slice(0, count).map((x) => (lib.inspect(x, options)));
                            if (v.length > count) {
                                rc += `, ...(${v.length - count})`;
                            }
                            rc += "]";
                        }
                        n++;
                        options.__depth--;
                    }
                }
            }
            break;

        case "map":
            if (options.__depth >= depth) {
                if (rc) rc += ", ";
                if (p) rc += p + ": ";
                rc += `...(${depth}})`;
                n++;
            } else {
                if (typeof options.__depth !== "number") {
                    options = Object.assign({}, options, { __depth: 0 });
                }
                if (!options.__seen) options.__seen = new WeakSet();
                if (options.__seen.has(v)) {
                    if (rc) rc += ", ";
                    if (p) rc += p + ": ";
                    rc += "...(*)";
                    n++;
                } else {
                    options.__seen.add(v);
                    options.__depth++;
                    if (h) {
                        v = v.size;
                    } else {
                        const vv = [];
                        for (const k of v) {
                            vv.push(lib.inspect(k[0], options) + ": " + lib.inspect(k[1], options));
                            if (vv.length >= count) {
                                vv.push(`...(${vv.length - count})`)
                                break;
                            }
                        }
                        v = vv;
                    }
                    if (rc) rc += ", ";
                    if (p) rc += p + ": ";
                    rc += `{${v}}`;
                    n++;
                    options.__depth--;
                }
            }
            break;

        case "error":
        case "object":
            if (options.__depth >= depth) {
                if (rc) rc += ", ";
                if (p) rc += p + ": ";
                rc += `...(${depth})`;
                n++;
            } else {
                if (typeof options.__depth !== "number") {
                    options = Object.assign({}, options, { __depth: 0 });
                }
                if (!options.__seen) options.__seen = new WeakSet();
                if (options.__seen.has(v)) {
                    if (rc) rc += ", ";
                    if (p) rc += p + ": ";
                    rc += "...(*)";
                    n++;
                } else {
                    options.__seen.add(v);
                    options.__depth++;
                    v = h ? Object.keys(v).length : lib.inspect(typeof v.toJSON === "function" ? v.toJSON() : v, options);
                    if (v || options.keepempty) {
                        if (rc) rc += comma;
                        if (p) rc += p + ": ";
                        rc += `{${v}}`;
                        n++;
                    }
                    options.__depth--;
                }
            }
            break;

        case "function":
            if (!options.func) break;
            if (rc) rc += ", ";
            if (p) rc += p + ": ";
            rc += h ? "..." : options.func > 1 ? v : "(Function)";
            n++;
            break;

        case "date":
            if (rc) rc += ", ";
            if (p) rc += p + ": ";
            rc += h ? "..." : options.strftime ? lib.strftime(v, options.strftime) : v.toISOString();
            n++;
            break;

        case "null":
        case "proxy":
            if (rc) rc += ", ";
            if (p) rc += p + ": ";
            rc += t;
            n++;
            break;

        default:
            e = lib.isEmpty(v);
            if (!e || options.keepempty) {
                n++;
                v = "" + v;
                if (rc) rc += ", ";
                if (p) rc += p + ": ";
                if (e) break;
                if (h) {
                    rc += "..."
                } else {
                    rc += v.slice(0, length);
                    if (v.length > length) rc += ` (...${v.length-length})`;
                }
            }
        }
        if (n > nkeys) {
            if (keys.length > nkeys) {
                rc += `, ...(${keys.length - nkeys})`;
            }
            break;
        }
    }
    if (!options.__depth) {
        for (const p in options.replace) rc = rc.replace(options.replace[p], p);
    }
    return rc;
}

/**
 * Encode with additional symbols, convert these into percent encoded by default:
 *          ! -> %21, * -> %2A, ' -> %27, ( -> %28, ) -> %29
 * @param {string} str
 * @param {RegExp} [charset] alternative charset to percent encode
 * @return {string}
 * @memberof module:lib
 * @method encodeURIComponent
  * @example
  * lib.encodeURIComponent("a b!")
  * // "a%20b%21"
  * lib.encodeURIComponent("a*b", /[*]/g)
  * // "a%2Ab"
 */
lib.encodeURIComponent = function(str, charset)
{
    if (typeof str === "undefined") return "";
    try {
        charset = lib.isRegExp(charset, /[!'()*]/g);
        return encodeURIComponent(str).replace(charset, (c) => (`%${c.charCodeAt(0).toString(16).toUpperCase()}`));
    } catch (e) {
        logger.error("encodeURIComponent:", str, e.stack);
        return ""
    }
}
lib.escape = lib.encodeURIComponent;

/**
 * Encode as percent encoded for given set of characters
 * @param {string} str
 * @param {RegExp} [charset] if empty all characters will be converted
 * @return {string}
 * @memberof module:lib
 * @method toPercentEncoded
  * @example
  * lib.toPercentEncoded("abc")
  * // "%61%62%63"
  * lib.toPercentEncoded("a b", / /g)
  * // "a%20b"
 */
lib.toPercentEncoded = function(str, charset)
{
    charset = lib.isRegExp(charset, /(.)/g);
    try {
        return lib.isString(str).replace(charset, (c) => (`%${c.charCodeAt(0).toString(16).toUpperCase()}`));
    } catch (e) {
        logger.error("toPercentEncoded:", str, charset, e.stack);
        return "";
    }
}


/**
 * No-exception version of the global function, on error return empty string
 * @param {string} str
 * @return {string}
 * @memberof module:lib
 * @method decodeURIComponent
  * @example
  * lib.decodeURIComponent("a%20b%21")
  * // "a b!"
  * lib.decodeURIComponent("%")
  * // ""
 */
lib.decodeURIComponent = function(str)
{
    if (typeof str === "undefined") return "";
    try {
        return decodeURIComponent(str);
    } catch (e) {
        logger.error("decodeURIComponent:", str, e.stack);
        return "";
    }
}

/**
 * Convert all Unicode binary symbols into Javascript text representation
 * @param {string} str
 * @return {string}
 * @memberof module:lib
 * @method escapeUnicode
  * @example
  * lib.escapeUnicode("hello")
  * // "hello"
  * lib.escapeUnicode("привет")
  * // "\\u043f\\u0440\\u0438\\u0432\\u0435\\u0442"
 */
lib.escapeUnicode = function(str)
{
    return String(str).replace(/[\u007F-\uFFFF]/g, (m) => ("\\u" + ("0000" + m.charCodeAt(0).toString(16)).substr(-4)));
}

lib._unicodeCache = {};

/**
 * Replace Unicode symbols with ASCII equivalents, types is a string with list of types of characters to
 * replace, default is: opqs, for quotes,other,punctuations,spaces
 * @param {string} str
 * @param {string} [types=opqs]
 * @return {string}
 * @memberof module:lib
 * @method unicode2Ascii
  * @example
  * lib.unicode2Ascii("“hello”")
  * // "\"hello\""
  * lib.unicode2Ascii("hello\u00a0world", "s")
  * // "hello world"
 */
lib.unicode2Ascii = function(str, types)
{
    if (typeof str !== "string") return "";
    types = typeof types === "string" && types || "opqs";
    let map = this._unicodeCache[types];
    if (!map) {
        map = this._unicodeCache[types] = {};
        for (const t of types) {
            Object.assign(this._unicodeCache[types], this.unicodeAsciiMap[t]);
        }
    }
    let rc = "";
    for (const c of str) rc += map[c] || c;
    return rc.trim();
}

/**
 * Convert escaped characters into native symbols
 * @param {string} str
 * @return {string}
 * @memberof module:lib
 * @method unescape
  * @example
  * lib.unescape("hello\\nworld")
  * // "hello\nworld"
  * lib.unescape("\\\"quoted\\\"")
  * // "\"quoted\""
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
 * @param {string} str
 * @return {string}
 * @memberof module:lib
 * @method textToXml
  * @example
  * lib.textToXml("<tag attr=\"1\">Tom & Jerry</tag>")
  * // "&lt;tag attr=&quot;1&quot;&gt;Tom &amp; Jerry&lt;/tag&gt;"
  * lib.textToXml("Bob's")
  * // "Bob&apos;s"
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
 * @param {string} str
 * @return {string}
 * @memberof module:lib
 * @method textToEntity
  * @example
  * lib.textToEntity("<b>Tom & Jerry</b>")
  * // "&lt;b&gt;Tom &amp; Jerry&lt;/b&gt;"
  * lib.textToEntity("plain")
  * // "plain"
 */
lib.textToEntity = function(str)
{
    if (typeof str !== "string") return "";
    if (!this.textEntities) {
        this.textEntities = {};
        for (const p in this.htmlEntities) this.textEntities[this.htmlEntities[p]] = "&" + p + ";";
    }
    return str.replace(/([&<>'":])/g, (_, n) => (lib.textEntities[n] || n));
}

/**
 * Convert html entities into their original symbols
 * @param {string} str
 * @return {string}
 * @memberof module:lib
 * @method entityToText
  * @example
  * lib.entityToText("&lt;b&gt;Tom &amp; Jerry&lt;/b&gt;")
  * // "<b>Tom & Jerry</b>"
  * lib.entityToText("&#65;&#x42;")
  * // "AB"
 */
lib.entityToText = function(str)
{
    if (typeof str !== "string") return "";
    return str.replace(/&(#?[a-zA-Z0-9]+);/g, function(_, n) {
        if (n[0] === '#') return n.charAt(1) === 'x' ? String.fromCharCode(Number.parseInt(n.substring(2), 16)) : String.fromCharCode(+n.substring(1));
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
  * @example
  * lib.toBase32(Buffer.from("hello"))
  * // "NBSWY3DP"
  * lib.toBase32(Buffer.from("hi"), { padding: true })
  * // "NBUQ===="
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
  * @example
  * lib.fromBase32("NBSWY3DP").toString()
  * // "hello"
  * lib.fromBase32("NBUQ").toString()
  * // "hi"
 */
lib.fromBase32 = function(str, options)
{
    if (typeof str !== "string") return "";
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

