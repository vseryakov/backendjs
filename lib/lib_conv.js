//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const util = require('util');
const logger = require(__dirname + '/logger');
const lib = require(__dirname + '/lib');
const xml2json = require("xml2json");

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
    if (val) try { d = new Date(val); } catch (e) {}
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

// Convert value to the proper type, default is to return a string or convert the value to a string if no type is specified
lib.toValue = function(val, type, options)
{
    var d;
    type = (type || "").trim();
    switch (type) {
    case "auto":
        if (typeof val == "undefined" || val === null) return "";
        if (typeof val == "string") {
            type = this.isNumeric(val) ? "number":
                   val == "true" || val == "false" ? "bool":
                   val[0] == "^" && val.slice(-1) == "$" ? "regexp":
                   val[0] == "[" && val.slice(-1) == "]" ? "js":
                   val[0] == "{" && val.slice(-1) == "}" ? "js":
                   val.indexOf("|") > -1 && !val.match(/[()[\]^$]/) ? "list": "";
        }
        return this.toValue(val, type, options);

    case "js":
        if (typeof val == "string") val = this.jsonParse(val, options);
        return val;

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

// Serialize regexp with a custom format, `lib.toRegxp`` will be able to use it
RegExp.prototype.toJSON = function()
{
    return `^/${this.source}/${this.flags}$`;
}

// Safely create a regexp object, if invalid returns undefined, the options can be a string with srandard RegExp
// flags or an object with the following properties:
// - ingoreCase - similar to i
// - globalMatch - similar to m
// - multiLine - similar to m
// - unicode - similar to u
// - sticky - similar to y
// - escape - escape all special symbols or symbol e
lib.toRegexp = function(str, options)
{
    try {
        // Check for JSON stringified format
        if (str && str[0] == "^" && str[str.length - 1] == "$" && str[1] == "/") {
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
        item.value = options && options.json ? lib.jsonParse(val[p], options) :
                     options && options.datatype ? lib.toValue(val[p], options) : val[p];
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
    options = options || this.empty;
    if (val) {
        if (options.del || val[0] == "!") {
            var idx = obj.list.indexOf(val[0] == "!" ? val.substr(1) : val);
            if (idx > -1) obj.list.splice(idx, 1);
        } else {
            if (options.set) obj.list = [];
            if (!Array.isArray(val)) val = [ val ];
            for (var i in val) {
                if (obj.list.indexOf(val[i]) == -1) obj.list.push(val[i]);
            }
        }
    }
    if (obj.list.length) {
        try {
            var str = obj.list.map(function(x) {
                if (options.escape) x = x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                return "(" + x + ")";
            }).join("|")
            obj.rx = new RegExp(str, options.regexp);
        } catch (e) {
            logger.error('toRegexpObj:', val, e);
            if (options.errnull) return null;
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
            if (v === opts.novalue) {
                delete rc[n];
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

// Stringify JSON into base64 string, if secret is given, sign the data with it
lib.jsonToBase64 = function(data, secret, options)
{
    data = this.stringify(data);
    if (secret) return this.encrypt(secret, data, options);
    return Buffer.from(data).toString("base64");
}

// Parse base64 JSON into JavaScript object, in some cases this can be just a number then it is passed as it is, if secret is given verify
// that data is not chnaged and was signed with the same secret
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

// Nicely format an object with indentations, optional `indentlevel` can be used to control until which level deep
// to use newlines for objects.
lib.jsonFormat = function(obj, options)
{
    if (typeof options == "string") options = { indent: options, __level: 0 };
    if (!options) options = { __level: 0 };
    if (typeof options.__level != "number") options = lib.objClone(options, "__level", 0);

    // Shortcut to parse and format json from the string
    if (typeof obj == "string" && obj != "") {
        if (!/^[[{.+]}]$/.test(obj.trim())) return obj;
        obj = this.jsonParse(obj, { dflt: { data: obj } });
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
        if (options.ignore && options.ignore.test(p)) continue;
        val = obj[p];
        if (typeof options.preprocess == "function") {
            val = options.preprocess(p, val, options);
            if (typeof val == "undefined") continue;
        }
        if (options.skipnull && (val === "" || val === null || val === undefined)) continue;
        if (options.skipempty && this.isEmpty(val)) continue;
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

// JSON stringify without exceptions, on error just returns an empty string and logs the error
lib.stringify = function(obj, filter)
{
    try {
        return this.escapeUnicode(JSON.stringify(obj, filter));
    } catch (e) {
        logger.error("stringify:", e);
        return "";
    }
}

// Silent JSON parse, returns null on error, no exceptions raised.
//
// options can specify the following properties:
//  - datatype - make sure the result is returned as type: obj, list, str
//  - dflt - return this in case of error
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
    } catch (err) {
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
        if (typeof obj != "object" || !obj) return options.dflt || {};
        break;
    case "obj":
        if (lib.typeName(obj) != "object") return options.dflt || {};
        break;
    case "list":
        if (lib.typeName(obj) != "array") return options.dflt || [];
        break;
    case "str":
        if (lib.typeName(obj) != "string") return options.dflt || "";
        break;
    }
    return obj;
}

// Perform validation of the result type, make sure we return what is expected, this is a helper that is used by other conversion routines
function _checkResult(type, err, obj, options)
{
    if (options) {
        if (options.logger) logger.logger(options.logger, 'parse:', type, options, lib.traceError(err), obj);
        if (options.errnull) return null;
        if (options.dflt) return options.dflt;
        if (options.datatype == "object" || options.datatype == "obj") return {};
        if (options.datatype == "list") return [];
        if (options.datatype == "str") return "";
    }
    return null;
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
    } catch (e) {
        logger.error("encodeURIComponent:", str, e.stack);
    }
}
lib.escape = lib.encodeURIComponent;

// Convert all Unicode binary symbols into Javascript text representation
lib.escapeUnicode = function(text)
{
    return String(text).replace(/[\u007F-\uFFFF]/g, function(m) {
        return "\\u" + ("0000" + m.charCodeAt(0).toString(16)).substr(-4)
    });
}

// Replace Unicode symbols with ASCII equivalents
lib.unicode2Ascii = function(str)
{
    if (typeof str != "string") return "";
    var rc = "";
    for (var i in str) rc += this.unicodeAsciiMap[str[i]] || str[i];
    return rc.trim();
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
