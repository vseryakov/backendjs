/*!
 *  backend.js client
 *  Vlad Seryakov vseryakov@gmail.com 2018
 */

(() => {
var app = window.app;

app.inherits = function(ctor, superCtor, options)
{
    if (!ctor) return;
    if (ctor.prototype && superCtor?.prototype) {
        Object.setPrototypeOf(ctor.prototype, superCtor.prototype);
    }
    for (const p in options) {
        if (typeof options[p] != "function") ctor[p] = options[p]; else
        if (ctor.prototype) ctor.prototype[p] = options[p];
    }
    return ctor;
}

// Determine type of the object
app.typeName = function(v)
{
    if (v === null) return "null";
    const t = typeof v;
    if (t === "object") {
        switch (v.constructor?.name) {
        case "Array":
        case "Buffer":
        case "Date":
        case "Error":
        case "RegExp":
        case "Set":
        case "Map":
        case "WeakMap":
            return v.constructor.name.toLowerCase();
        }
    }
    return t;
}

app._formatPresets = {
    compact: {
        sbracket1: "",
        sbracket2: "",
        cbracket1: "",
        cbracket2: "",
        nl1: "<br>",
        nl2: "",
        quote1: "",
        quote2: "",
        squote1: "",
        squote2: "",
        comma: "",
        prefix: "&nbsp;&nbsp;-&nbsp;",
        space: "&nbsp;",
        skipnull: 1,
        skipempty: 1,
    },
};

// Format an object into nice JSON formatted text
app.formatJSON = function(obj, options)
{
    if (typeof options == "string") options = { indent: options };
    if (!options) options = {};
    // Shortcut to parse and format json from the string
    if (typeof obj == "string" && obj != "") {
        if (obj[0] != "[" && obj[0] != "{") return obj;
        try { obj = JSON.parse(obj); } catch (e) { app.log(e) }
    }
    var preset = app._formatPresets[options.preset];
    for (const p in preset) options[p] = preset[p];

    if (!options.level) options.level = 0;
    if (!options.indent) options.indent = "";
    if (options.nl1 === undefined) options.nl1 = "\n";
    if (options.nl2 === undefined) options.nl2 = "\n";
    if (options.sbracket1 === undefined) options.sbracket1 = "[";
    if (options.sbracket2 === undefined) options.sbracket2 = "]";
    if (options.cbracket1 === undefined) options.cbracket1 = "{";
    if (options.cbracket2 === undefined) options.cbracket2 = "}";
    if (options.quote1 === undefined) options.quote1 = '"';
    if (options.quote2 === undefined) options.quote2 = '"';
    if (options.squote1 === undefined) options.squote1 = '"';
    if (options.squote2 === undefined) options.squote2 = '"';
    if (options.space === undefined) options.space = " ";
    if (options.nspace === undefined) options.nspace = 4;
    if (options.comma === undefined) options.comma = ", ";
    if (options.sep === undefined) options.sep = ", ";
    if (options.prefix === undefined) options.prefix = "";

    var type = app.typeName(obj);
    var count = 0, indent;
    var text = type == "array" ? options.sbracket1 : options.cbracket1;
    var map = options.map || "";
    // Insert newlines only until specified level deep
    var nline = !options.indentlevel || options.level < options.indentlevel;
    // Top level prefix set, skip new line for the first item
    var prefix = options.__prefix;
    delete options.__prefix;

    for (const p in obj) {
        if (options.ignore && options.ignore.test(p)) continue;
        var val = obj[p];
        if (typeof options.preprocess == "function") {
            val = options.preprocess(p, val, options);
            if (val === undefined) continue;
        }
        if (options.skipnull && (val === "" || val === null || val === undefined)) continue;
        if (options.skipempty && app.isEmpty(val)) continue;
        if (options.skipvalue && options.skipvalue.test(val)) continue;

        if (count > 0) {
            text += type == "array" ? options.sep : options.comma;
        }
        if (type != "array") {
            if (nline && options.nl1) {
                text += !count && (prefix || !options.level) ? "" : options.nl1;
            }
            if (!prefix || count) text += options.indent;
            if (!prefix) text += options.space.repeat(options.nspace);
            text += options.quote1 + (map[p] || p) + options.quote2 + ": ";
        } else
        if (options.prefix && options.nl1) {
            text += options.nl1 + options.indent + options.prefix;
        }
        switch (app.typeName(val)) {
        case "array":
        case "object":
            if (type == "array" && options.prefix && options.nl1) {
                indent = options.__prefix = options.space.repeat(options.prefix.length);
            } else {
                indent = options.space.repeat(options.nspace);
            }
            options.indent += indent;
            options.level++;
            text += app.formatJSON(val, options);
            options.level--;
            options.indent = options.indent.substr(0, options.indent.length - indent.length);
            break;
        case "boolean":
        case "number":
            text += val.toString();
            break;
        case "null":
            text += "null";
            break;
        case "string":
            text += (options.squote1 + val + options.squote2);
            break;
        default:
            text += ("unknown: " + typeof(val));
        }
        count++;
    }
    text += type == "array" ? options.sbracket2 : ((nline && options.nl2 ? options.nl2 + options.indent : "") + options.cbracket2);
    return text;
}

app.weekOfYear = function(date, utc)
{
    date = app.toDate(date, null);
    if (!date) return 0;
    utc = utc ? "UTC": "";
    var target = new Date(date.valueOf());
    target["set" + utc + "Date"](target["get" + utc + "Date"]() - ((date["get" + utc + "Day"]() + 6) % 7) + 3);
    var firstThursday = target.valueOf();
    target["set" + utc + "Month"](0, 1);
    var day = target["get" + utc + "Day"]();
    if (day != 4) target["set" + utc + "Month"](0, 1 + ((4 - day) + 7) % 7);
    return 1 + Math.ceil((firstThursday - target) / 604800000);
}

// Returns true if the given date is in DST timezone
app.isDST = function(date)
{
    var jan = new Date(date.getFullYear(), 0, 1).getTimezoneOffset();
    var jul = new Date(date.getFullYear(), 6, 1).getTimezoneOffset();
    return Math.max(jan, jul) != date.getTimezoneOffset();
}

app.strftimeFormat = "%Y-%m-%d %H:%M:%S %Z";
app.strftimeMap = {
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
};
app.tzMap = [
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
];

// Return a timezone human name if matched (EST, PDT...), tz must be in GMT-NNNN format
app.tzName = function(tz)
{
    if (!tz || typeof tz != "string") return "";
    var t = tz.indexOf(":") > 0 ? tz.replace(":", "") : tz;
    for (const i in app.tzMap) {
        if (t == app.tzMap[i][1]) return app.tzMap[i][0];
    }
    return tz;
}

// Format a Date object
app.strftime = function(date, fmt, options)
{
    const spacepad = (n) => (n > 9 ? n : ' ' + n)
    const zeropad = (n) => (n > 9 ? n : '0' + n)

    date = app.toDate(date, null);
    if (!date) return "";
    const tz = typeof options?.tz == "number" ? options.tz : 0;
    if (tz) date = new Date(date.getTime() - tz);
    fmt = fmt || app.strftimeFormat;
    const cmds = {
        a: (t, utc, lang, tz) => {
            if (lang && !app.strftimeMap.weekDays[lang]) {
                app.strftimeMap.weekDays[lang] = app.strftimeMap.weekDays[""].map((x) => (app.__({ phrase: x, locale: lang })));
            }
            return app.strftimeMap.weekDays[lang || ""][utc ? t.getUTCDay() : t.getDay()]
        },
        A: (t, utc, lang, tz) => {
            if (lang && !app.strftimeMap.weekDaysFull[lang]) {
                app.strftimeMap.weekDaysFull[lang] = app.strftimeMap.weekDaysFull[""].map((x) => (app.__({ phrase: x, locale: lang })));
            }
            return app.strftimeMap.weekDaysFull[lang || ""][utc ? t.getUTCDay() : t.getDay()]
        },
        b: (t, utc, lang, tz) => {
            if (lang && !app.strftimeMap.months[lang]) {
                app.strftimeMap.months[lang] = app.strftimeMap.months[""].map((x) => (app.__({ phrase: x, locale: lang })));
            }
            return app.strftimeMap.months[lang || ""][utc ? t.getUTCMonth() : t.getMonth()]
        },
        B: (t, utc, lang, tz) => {
            if (lang && !app.strftimeMap.monthsFull[lang]) {
                app.strftimeMap.monthsFull[lang] = app.strftimeMap.monthsFull[""].map((x) => (app.__({ phrase: x, locale: lang })));
            }
            return app.strftimeMap.monthsFull[lang || ""][utc ? t.getUTCMonth() : t.getMonth()]
        },
        c: (t, utc, lang, tz) => (utc ? t.toUTCString() : t.toString()),
        d: (t, utc, lang, tz) => (zeropad(utc ? t.getUTCDate() : t.getDate())),
        e: (t, utc, lang, tz) => (spacepad(utc ? t.getUTCDate() : t.getDate())),
        H: (t, utc, lang, tz) => (zeropad(utc ? t.getUTCHours() : t.getHours())),
        I: (t, utc, lang, tz) => (zeropad((((utc ? t.getUTCHours() : t.getHours()) + 12) % 12) || 12)),
        k: (t, utc, lang, tz) => (spacepad(utc ? t.getUTCHours() : t.getHours())),
        l: (t, utc, lang, tz) => (spacepad((((utc ? t.getUTCHours() : t.getHours()) + 12) % 12) || 12)),
        L: (t, utc, lang, tz) => (zeropad(utc ? t.getUTCMilliseconds() : t.getMilliseconds())),
        m: (t, utc, lang, tz) => (zeropad((utc ? t.getUTCMonth() : t.getMonth()) + 1)), // month-1
        M: (t, utc, lang, tz) => (zeropad(utc ? t.getUTCMinutes() : t.getMinutes())),
        p: (t, utc, lang, tz) => ((utc ? t.getUTCHours() : t.getHours()) < 12 ? 'am' : 'pm'),
        S: (t, utc, lang, tz) => (zeropad(utc ? t.getUTCSeconds() : t.getSeconds())),
        w: (t, utc, lang, tz) => (utc ? t.getUTCDay() : t.getDay()), // 0..6 == sun..sat
        W: (t, utc, lang, tz) => (zeropad(app.weekOfYear(t, utc))),
        y: (t, utc, lang, tz) => (zeropad(t.getYear() % 100)),
        Y: (t, utc, lang, tz) => (utc ? t.getUTCFullYear() : t.getFullYear()),
        t: (t, utc, lang, tz) => (t.getTime()),
        u: (t, utc, lang, tz) => (Math.floor(t.getTime()/1000)),
        Z: (t, utc, lang, tz) => {
            tz = tz ? tz/60000 : t.getTimezoneOffset();
            return "GMT" + (tz < 0 ? "+" : "-") + zeropad(Math.abs(-tz/60)) + "00";
        },
        zz: (t, utc, lang, tz) => (cmds.z(t, utc, lang, tz, 1)),
        z: (t, utc, lang, tz, zz) => {
            tz = tz ? tz/60000 : t.getTimezoneOffset();
            tz = "GMT" + (tz < 0 ? "+" : "-") + zeropad(Math.abs(-tz/60)) + "00";
            var dst = app.isDST(t);
            for (var i in app.tzMap) {
                if (tz == app.tzMap[i][1] && (dst === app.tzMap[i][2])) {
                    return zz ? tz + " " + app.tzMap[i][0] : app.tzMap[i][0];
                }
            }
            return tz;
        },
        Q: (t, utc, lang, tz) => {
            var h = utc ? t.getUTCHours() : t.getHours();
            return h < 12 ? app.__({ phrase: "Morning", locale: lang }) :
                   h < 17 ? app.__({ phrase: "Afternoon", locale: lang }) :
                   app.__({ phrase: "Evening", locale: lang }) },
                   '%': function() { return '%' },
    };

    for (var c in cmds) {
        fmt = fmt.replace('%' + c, cmds[c](date, options?.utc, options?.lang, tz));
    }
    return fmt;
}

app.sprintf = function(fmt, ...args)
{
    if (typeof fmt != "string") return "";
    var i = -1, regex = /%(-)?(0?[0-9]+)?([.][0-9]+)?([#][0-9]+)?([scfpexdz])/g;

    return fmt.replace(regex, (sym, p0, p1, p2, p3, p4) => {
        if (sym == '%%') return '%';
        if (args[++i] === undefined) return undefined;
        var arg = args[i];
        var exp = p2 ? parseInt(p2.substr(1)) : undefined;
        var base = p3 ? parseInt(p3.substr(1)) : undefined;
        var val;
        switch (p4) {
        case 's':
            val = arg;
            break;
        case 'c':
            val = arg[0];
            break;
        case 'f':
            val = parseFloat(arg).toFixed(exp);
            if (isNaN(val)) val = 0;
            break;
        case 'g':
            val = parseFloat(arg).toFixed(exp);
            if (isNaN(val)) val = 0;
            if (val.indexOf(".") > -1) {
                while (val[val.length - 1] == "0") val = val.slice(0, -1);
                if (val[val.length - 1] == ".") val = val.slice(0, -1);
            }
            break;
        case 'p':
            val = parseFloat(arg).toPrecision(exp);
            if (isNaN(val)) val = 0;
            break;
        case 'e':
            val = parseFloat(arg).toExponential(exp);
            if (isNaN(val)) val = 0;
            break;
        case 'x':
            val = parseInt(arg).toString(base ? base : 16);
            if (isNaN(val)) val = 0;
            break;
        case 'd':
            val = parseFloat(parseInt(arg, base ? base : 10).toPrecision(exp)).toFixed(0);
            if (isNaN(val)) val = 0;
            break;
        }
        val = typeof val == "object" ? JSON.stringify(val) : val.toString(base);
        var sz = parseInt(p1); /* padding size */
        var ch = p1 && p1[0] == '0' ? '0' : ' '; /* isnull? */
        while (val.length < sz) val = p0 !== undefined ? val + ch : ch + val; /* isminus? */
        return val;
    });
}

// Apply an iterator function to each item in an array serially. Execute a callback when all items
// have been completed or immediately if there is is an error provided.
app.forEachSeries = function(list, iterator, callback, direct = true)
{
    callback = typeof callback == "function" ? callback : app.noop;
    if (!Array.isArray(list) || !list.length) return callback();
    function iterate(i, ...args) {
        if (i >= list.length) return direct ? callback(null, ...args) : setTimeout(callback, 0, null, ...args);
        iterator(list[i], (...args) => {
            if (args[0]) {
                if (direct) callback(...args); else setTimeout(callback, 0, ...args);
                callback = app.noop;
            } else {
                iterate(++i, ...args.slice(1));
            }
        }, ...args);
    }
    iterate(0);
}

// Execute a list of functions serially and execute a callback upon completion or occurance of an error.
app.series = function(tasks, callback, direct = true)
{
    app.forEachSeries(tasks, (task, next, ...args) => {
        if (direct) task(next, ...args); else setTimeout(task, 0, next, ...args);
    }, callback, direct);
}

// Apply an iterator function to each item in an array in parallel. Execute a callback when all items
// have been completed or immediately if there is an error provided
app.forEach = function(list, iterator, callback, direct = true)
{
    callback = typeof callback == "function" ? callback : app.noop;
    if (!Array.isArray(list) || !list.length) return callback();
    var count = list.length;
    for (var i = 0; i < list.length; i++) {
        iterator(list[i], (err) => {
            if (err) {
                if (direct) callback(err); else setTimeout(callback, 0, err);
                callback = app.noop;
                i = list.length + 1;
            } else
            if (--count == 0) {
                if (direct) callback(); else setTimeout(callback, 0);
                callback = app.noop;
            }
        });
    }
}

// Execute a list of functions in parallel and execute a callback upon completion or occurance of an error.
app.parallel = function(tasks, callback, direct = true)
{
    app.forEach(tasks, (task, next) => { task(next) }, callback, direct);
}

// Return Date object for given text or numeric date representation, for invalid date returns 1969 unless `invalid` parameter is given,
// in this case invalid date returned as null. If `dflt` is NaN, null or 0 returns null as well.
app.toDate = function(val, dflt, invalid)
{
    if (typeof val?.getTime == "function") return val;
    var d = NaN;
    // String that looks like a number
    if (typeof val == "string") {
        val = /^[0-9.]+$/.test(val) ? app.toNumber(val) : val.replace(/([0-9])(AM|PM)/i, "$1 $2");
    }
   if (typeof val == "number") {
        // Convert nanoseconds to milliseconds
        if (val > 2147485547000) val = Math.round(val / 1000);
        // Convert seconds to milliseconds
        if (val < 2147483647) val *= 1000;
    }
    if (typeof val != "string" && typeof val != "number") val = d;
    // Remove unsupported timezone names
    if (typeof val == "string") {
        var gmt = val.indexOf("GMT") > -1;
        for (const i in app.tzMap) {
            if ((gmt || app.tzMap[i][3] === false) && val.indexOf(app.tzMap[i][0]) > -1) {
                val = val.replace(app.tzMap[i][0], "");
            }
        }
    }
    if (val) try { d = new Date(val); } catch (e) {}
    return !isNaN(d) ? d : invalid || (dflt !== undefined && isNaN(dflt)) || dflt === null || dflt === 0 ? null : new Date(dflt || 0);
}

// Returns a human representation of an age for the given timestamp in milliseconds
app.toAge = function(mtime, options)
{
    var str = "";
    mtime = typeof mtime == "number" ? mtime : app.toNumber(mtime);
    if (mtime > 0) {
        var secs = Math.floor((Date.now() - mtime)/1000);
        var d = Math.floor(secs / 86400);
        var mm = Math.floor(d / 30);
        var w = Math.floor(d / 7);
        var h = Math.floor((secs - d * 86400) / 3600);
        var m = Math.floor((secs - d * 86400 - h * 3600) / 60);
        var s = Math.floor(secs - d * 86400 - h * 3600 - m * 60);
        if (mm > 0) {
            str = mm > 1 ? app.__("%s months", mm) : app.__("1 month");
            if (d > 0) str += " " + (d > 1 ? app.__("%s days", d) : app.__("1 day"));
            if (h > 0) str += " " + (h > 1 ? app.__("%s hours", h) : app.__("1 hour"));
        } else
            if (w > 0) {
                str = w > 1 ? app.__("%s weeks", w) : app.__("1 week");
                if (d > 0) str += " " + (d > 1 ? app.__("%s days", d) : app.__("1 day"));
                if (h > 0) str += " " + (h > 1 ? app.__("%s hours", h) : app.__("1 hour"));
            } else
                if (d > 0) {
                    str = d > 1 ? app.__("%s days", d) : app.__("1 day");
                    if (h > 0) str += " " + (h > 1 ? app.__("%s hours", h) : app.__("1 hour"));
                    if (m > 0) str += " " + (m > 1 ? app.__("%s minutes", m) : app.__("1 minute"));
                } else
                    if (h > 0) {
                        str = h > 1 ? app.__("%s hours", h) : app.__("1 hour");
                        if (m > 0) str += " " + (m > 1 ? app.__("%s minutes", m) : app.__("1 minute"));
                    } else
                        if (m > 0) {
                            str = m > 1 ? app.__("%s minutes", m) : app.__("1 minute");
                            if (s > 0) str += " " + (s > 1 ? app.__("%s seconds", s) : app.__("1 second"));
                        } else {
                            str = secs > 1 ? app.__("%s seconds", secs) : app.__("1 second");
                        }
    }
    return str;
}

app.toDuration = function(mtime, options)
{
    var str = "";
    mtime = typeof mtime == "number" ? mtime : app.toNumber(mtime);
    if (mtime > 0) {
        var seconds = Math.floor(mtime/1000);
        var d = Math.floor(seconds / 86400);
        var h = Math.floor((seconds - d * 86400) / 3600);
        var m = Math.floor((seconds - d * 86400 - h * 3600) / 60);
        var s = Math.floor(seconds - d * 86400 - h * 3600 - m * 60);
        if (d > 0) {
            str = d > 1 ? app.__("%s days", d) :
                          app.__("1 day");
            if (h > 0) str += " " + (h > 1 ? app.__("%s hours", h) :
                                             app.__("1 hour"));
            if (m > 0) str += " " + (m > 1 ? app.__("%s minutes", m) :
                                             app.__("1 minute"));
        } else
            if (h > 0) {
                str = h > 1 ? app.__("%s hours", h) :
                              app.__("1 hour");
                if (m > 0) str += " " + (m > 1 ? app.__("%s minutes", m) :
                                                 app.__("1 minute"));
            } else
                if (m > 0) {
                    str = m > 1 ? app.__("%s minutes", m) :
                                  app.__("1 minute");
                    if (s > 0) str += " " + (s > 1 ? app.__("%s seconds", s) :
                                                     app.__("1 second"));
                } else {
                    str = seconds > 1 ? app.__("%s seconds", seconds) :
                                        app.__("1 second");
                }
    }
    return str;
}

app.toSize = function(size, decimals)
{
    var i = size > 0 ? Math.floor(Math.log(size) / Math.log(1024)) : 0;
    return (size / Math.pow(1024, i)).toFixed(typeof decimals == "number" ? decimals : 2) * 1 + ' ' + [app.__('Bytes'), app.__('KBytes'), app.__('MBytes'), app.__('GBytes'), app.__('TBytes')][i];
}

app.autoType = function(val)
{
    return app.isNumeric(val) ? "number":
           typeof val == "boolean" || val == "true" || val == "false" ? "bool":
           typeof val == "string" ?
           val[0] == "^" && val.slice(-1) == "$" ? "regexp":
           val[0] == "[" && val.slice(-1) == "]" ? "js":
           val[0] == "{" && val.slice(-1) == "}" ? "js":
           val.includes("|") && !/[()[\]^$]/.test(val) ? "list": "" : "";
}

app.isArray = function(val, dflt)
{
    return Array.isArray(val) && val.length ? val : dflt;
}

app.isFlag = function(list, name)
{
    return Array.isArray(list) && (Array.isArray(name) ? name.some((x) => (list.includes(x))) : list.includes(name));
}

app.isObject = function(v)
{
    return app.typeName(v) == "object";
}

app.isNumeric = function(val)
{
    if (typeof val == "number") return true;
    if (typeof val != "string") return false;
    return /^(-|\+)?([0-9]+|[0-9]+\.[0-9]+)$/.test(val);
}

// Return true of the given value considered empty
app.isEmpty = function(val)
{
    switch (app.typeName(val)) {
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
        return /^\s*$/.test(val) ? true : false;
    default:
        return val ? false: true;
    }
}

// Flags command utility, the commands are:
// - add - adds the `name` flags to the list if does not exists, returns the same array
// - update - adds new flags and removes flags that starts with - , returns the same array
// - concat - same as add but always returns a new list
// - del - removes the flags `name`, returns the same array
// - present - returns only flags that present in the list `name`
// - absent - returns only flags that are not present in the list `name`
app.toFlags = function(cmd, list, name)
{
    switch (cmd) {
    case "concat":
        list = Array.isArray(list) ? list.slice(0) : [];
    case "add":
        if (!Array.isArray(list)) list = [];
        if (!Array.isArray(name)) {
            if (name && !list.includes(name)) list.push(name);
        } else {
            name.forEach((x) => { if (!list.includes(x)) list.push(x) });
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
                if (!list.includes(x)) list.push(x);
            }
        });
        break;

    case "del":
        if (!Array.isArray(list)) return [];
        if (!Array.isArray(name)) name = [name];
        name.forEach((x) => {
            var i = list.indexOf(x);
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

// Capitalize words
app.toTitle = function(name)
{
    return typeof name == "string" ? name.replace(/_/g, " ").split(/[ ]+/).reduce((x,y) => (x + y.substr(0,1).toUpperCase() + y.substr(1) + " "), "").trim() : "";
}

// Interpret the value as a boolean
app.toBool = function(val, dflt)
{
    if (typeof val == "boolean") return val;
    if (typeof val == "number") return !!val;
    if (val === undefined) val = dflt;
    return !val || String(val).trim().match(/^(false|off|f|0$)/i) ? false : true;
}

app.toClamp = function(num, min, max)
{
  return Math.max(app.toNumber(min), Math.min(app.toNumber(num), app.toNumber(max)));
}

// Convert a string to a number, on invalid input returns 0
app.toNumber = function(val, options)
{
    var n = 0;
    if (typeof val == "number") {
        n = val;
    } else {
        if (typeof val != "string") {
            n = options?.dflt || 0;
        } else {
            // Autodetect floating number
            var f = !options || options.float === undefined || options.float == null ? /^[0-9-]+\.[0-9]+$/.test(val) : options.float;
            n = val[0] == 't' ? 1 : val[0] == 'f' ? 0 : val == "infinity" ? Infinity : (f ? parseFloat(val, 10) : parseInt(val, 10));
        }
    }
    n = isNaN(n) ? (options?.dflt || 0) : n;
    if (options) {
        if (typeof options.min == "number" && n < options.min) n = options.min;
        if (typeof options.max == "number" && n > options.max) n = options.max;
        if (typeof options.digits == "number") n = parseFloat(n.toFixed(options.digits));
    }
    return n;
}

// Return a test representation of a number according to the money formatting rules
app.toPrice = function(num, options)
{
    return app.toNumber(num).toLocaleString("en", {
        minimumFractionDigits: options?.min || 2,
        maximumFractionDigits: options?.max || 5
    });
}

app.toValue = function(val, type, options)
{
    switch ((type || "").trim()) {
    case "auto":
        if (val === undefined || val === null) return "";
        type = app.autoType(val);
        return app.toValue(val, type, options);

    case "set":
    case "list":
    case 'array':
        return app.strSplitUnique(val, options && options.separator, options);

    case "map":
        return app.strSplit(val, options?.delimiter || ",").
            map((y) => (app.strSplit(y, options?.separator || /[:;]/, options))).
            reduce((a, b) => {
                let v;
                if (b.length < 2) {
                    if (options?.empty) v = "";
                } else {
                    v = b.length == 2 ? b[1] : b.slice(1);
                    if (options?.maptype) v = app.toValue(v, options.maptype, options);
                }
                if (options?.noempty && app.isEmpty(v)) return a;
                a[b[0]] = v;
                return a;
            }, {});

    case "expr":
    case "buffer":
        return val;

    case "real":
    case "float":
    case "double":
        return app.toNumber(val, { float: 1 });

    case "int":
    case "smallint":
    case "integer":
    case "number":
    case "bigint":
    case "numeric":
    case "counter":
        return app.toNumber(val);

    case "bool":
    case "boolean":
        return app.toBool(val);

    case "date":
    case "time":
        return app.toDate(val);

    case "mtime":
        return /^[0-9.]+$/.test(String(val)) ? app.toNumber(val) : (new Date(val));

    case "json":
        return JSON.stringify(val);

    case "phone":
        return String(val).replace(/[^0-9]+/g, "");

    default:
        if (typeof val == "string") return val;
        return String(val);
    }
}

app.toTemplate = function(text, obj, options)
{
    const encoder = (enc, v) => {
        try {
            switch (enc) {
            case "url":
                if (typeof v != "string") v = String(v);
                v = encodeURIComponent(v);
                break;
            case "d-url":
                if (typeof v != "string") v = String(v);
                v = decodeURIComponent(v);
                break;
            case "base64":
                if (typeof v != "string") v = String(v);
                v = window.btoa(v);
                break;
            case "d-base64":
                if (typeof v != "string") v = String(v);
                v = window.atob(v);
                break;
            case "entity":
                v = app.textToEntity(v);
                break;
            case "d-entity":
                v = app.entityToText(v);
                break;
            case "strftime":
                v = app.strftime(v);
                break;
            case "mtime":
                v = app.toDate(v, null);
                if (!v) v = 0;
                break;
            }
        } catch (e) {}
        return v;
    }
    return _toTemplate(text, obj, options, encoder);
}

function _toTemplate(text, obj, options, encoder)
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
            d = tag.match(/^(if|ifnull|ifnotnull|ifempty|ifnotempty|ifne|ifeq|ifgt|ifge|iflt|ifle|ifnot|ifall|ifstr) ([a-zA-Z0-9._-]+) *(.*)$/)
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
                ok = app.isEmpty(val);
                break;
            case "ifnotempty":
                ok = !app.isEmpty(val);
                break;
            case "if":
                ok = val && app.isFlag(app.strSplit(d[3]), app.strSplit(val));
                break;
            case "ifne":
                ok = val != d[3];
                break;
            case "ifnot":
                ok = !val || !app.isFlag(app.strSplit(d[3]), app.strSplit(val));
                break;
            case "ifall":
                val = app.strSplit(val);
                ok = app.strSplit(d[3]).every((x) => (val.includes(x)));
                break;
            case "ifstr":
                ok = app.testRegexp(val || "", app.toRegexp(d[3], "i"));
                break;
            case "ifnotstr":
                ok = !app.testRegexp(val || "", app.toRegexp(d[3], "i"));
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
                v = app.toTemplate(body, rc, options);
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
                tmpl += sep1 + tag + sep2;
                continue;
            }
            if (Array.isArray(options.allow) && !options.allow.includes(tag)) continue;
            if (Array.isArray(options.skip) && options.skip.includes(tag)) continue;
            if (Array.isArray(options.only) && !options.only.includes(tag)) v = sep1 + tag + sep2;
        }
        v ??= dflt;
        if (v) {
            if (Array.isArray(v) && (typeof v[0] == "string" || typeof v[0] == "number")) v = v.toString(); else
            if (typeof v == "object") v = app.stringify(v);
            if (typeof encoder == "function") v = encoder(enc, v, options);
        }
        if (v !== null && v !== undefined && v !== "") tmpl += v;
        if (options.__exit) break;
    }
    if (options.noline) tmpl = tmpl.replace(/[\r\n]/g, "");
    if (options.nospace) tmpl = tmpl.replace(/ {2,}/g, " ").trim();
    if (top) delete options.__exit;
    return tmpl;
}

// Split string into array, ignore empty items,
// - `sep` is an RegExp to use as a separator instead of default  pattern `[,\|]`,
// - `options` is an object with the same properties as for the `toParams`, `datatype' will be used with
//   `toValue` to convert the value for each item
//
// If `str` is an array and type is not specified then all non-string items will be returned as is.
app.strSplit = function(str, sep, options)
{
    if (!str) return [];
    return (Array.isArray(str) ? str : (typeof str == "string" ? str : String(str)).split(sep || /[,|]/)).
            map((x) => {
                if (x === "" && !options?.keepempty) return x;
                x = options?.datatype ? app.toValue(x, options?.datatype) : typeof x == "string" ? x.trim() : x;
                if (typeof x != "string") return x;
                if (!options) return x;
                if (options.regexp && !options.regexp.test(x)) return "";
                if (options.lower) x = x.toLowerCase();
                if (options.upper) x = x.toUpperCase();
                if (options.strip) x = x.replace(options.strip, "");
                if (options.camel) x = app.toCamel(x, options);
                if (options.cap) x = app.toTitle(x);
                if (options.replace) {
                    for (const p in options.replace) {
                        x = x.replaceAll(p, options.replace[p]);
                    }
                }
                if (options.trunc > 0) x = x.substr(0, options.trunc);
                return x;
            }).
            filter((x) => (options?.keepempty || typeof x == "string" ? x.length : 1));
}

app.strSplitUnique = function(str, sep, type)
{
    var rc = [];
    var typed = type !== undefined;
    app.strSplit(str, sep, type).forEach((x) => {
        if (!rc.some((y) => (typed || !(typeof x == "string" && typeof y == "string") ? x == y : x.toLowerCase() == y.toLowerCase()))) rc.push(x);
    });
    return rc;
}

app.phraseSplit = function(str, options)
{
    if (typeof str != "string" || !str) return [];
    var delim = typeof options?.separator == "string" ? options.separator : " ";
    var quotes = typeof options?.quotes == "string" ? options.quotes : `"'`;
    var keepempty = options?.keepempty || null;

    var rc = [], i = 0, q, len = str.length;
    while (i < len) {
        while (i < len && delim.indexOf(str[i]) != -1) {
            if (keepempty) rc.push("");
            i++;
        }
        if (i >= len) break;
        // Opening quote
        if (quotes.indexOf(str[i]) > -1) {
            q = ++i;
            while (q < len) {
                while (q < len && quotes.indexOf(str[q]) == -1) q++;
                // Ignore escaped quotes
                if (q >= len || str[q - 1] != '\\') break;
                q++;
            }
            if (q < len) {
                if (keepempty || q - i > 0) rc.push(str.substr(i, q - i));
                while (q < len && delim.indexOf(str[q]) == -1) q++;
                if (q >= len) break;
                i = q + 1;
                continue;
            }
        }
        // End of the word
        for (q = i; q < len && delim.indexOf(str[q]) == -1; q++);
        if (q >= len) {
            if (keepempty || len - i > 0) rc.push(str.substr(i, len - i));
            break;
        } else {
            if (keepempty || q - i > 0) rc.push(str.substr(i, q - i));
        }
        i = q + 1;
    }
    return rc;
}

// Returns a new object constructed from the arguments pairs
app.objNew = function(...args)
{
    var obj = {};
    for (var i = 0; i < args.length - 1; i += 2) {
        if (args[i + 1] !== undefined) obj[args[i]] = args[i + 1];
    }
    return obj;
}

// Return all object properties
app.objKeys = function(obj)
{
    return app.isObject(obj) ? Object.keys(obj) : [];
}

// Shallow copy of an object, all additional arguments are treated as properties to be added to the new object
app.objClone = function(obj, ...args)
{
    var rc = Array.isArray(obj) ? [] : {}, o1, o2;
    for (const p in obj) {
        if (!obj.hasOwnProperty(p)) continue;
        o1 = obj[p];
        switch (app.typeName(o1)) {
        case "object":
            rc[p] = Object.assign({}, o1);
            break;
        case "map":
            rc[p] = o2 = new Map();
            for (const k of o1) o2.set(k[0], k[1]);
            break;
        case "set":
            rc[p] = o2 = new Set();
            for (const k of o1) o2.add(k);
            break;
        case "array":
            rc[p] = o1.slice(0);
            break;
        default:
            rc[p] = o1;
        }
    }
    for (let i = 0; i < args.length - 1; i += 2) {
        if (args[i] === "__proto__") continue;
        rc[args[i]] = args[i + 1];
    }
    return rc;
}

// Delete properties from the object, first arg is an object, the rest are properties to be deleted
app.objDel = function(obj, ...args)
{
    if (!app.isObject(obj)) return;
    for (let i = 0; i < args.length; i++) delete obj[args[i]];
    return obj;
}

// Return a value from object, can go deep inside, name is a list of parts or a string like part1.part2.part3...
app.objGet = function(obj, path)
{
    if (!Array.isArray(path)) path = String(path).split(".");
    for (var i = 0; i < path.length; i++) {
        obj = obj ? obj[path[i]] : undefined;
        if (obj === undefined) break;
    }
    return obj;
}

// Randomize the list items in place
app.shuffle = function(list)
{
    if (!Array.isArray(list)) return [];
    if (list.length == 1) return list;
    for (var i = 0; i < list.length; i++) {
        var j = Math.round((list.length - 1) * Math.random());
        if (i == j) {
            continue;
        }
        var item = list[j];
        list[j] = list[i];
        list[i] = item;
    }
    return list;
}

// Return a random hex string
app.random = function(size)
{
    var s = "", u = new Uint8Array(size || 16), h = "0123456789abcdef";
    window.crypto.getRandomValues(u);
    for (let i = 0; i < u.length; i++) s += h.charAt(u[i] >> 4) + h.charAt(u[i] & 0x0F);
    return s;
}

// Simple i18n translation method compatible with other popular modules, supports the following usage:
// - __(name)
// - __(fmt, arg,...)
// - __({ phrase: "", locale: "" }, arg...
//
app.__ = function(msg, ...args)
{
    var lang = app.lang, locales = app.locales || "";

    if (typeof msg == "object" && msg.phrase) {
        lang = msg.locale || lang;
        msg = msg.phrase;
    }
    msg = (lang && locales[lang] && locales[lang][msg]) || msg;
    if (args.length == 0) return msg;
    return app.sprintf(msg, ...args);
}

// Based on Bootstrap internal sanitizer
var sanitizer = {
    _attrs: new Set(['background','cite','href','itemtype','longdesc','poster','src','xlink:href']),
    _urls: /^(?:(?:https?|mailto|ftp|tel|file|sms):|[^#&/:?]*(?:[#/?]|$))/i,
    _data: /^data:(?:image\/(?:bmp|gif|jpeg|jpg|png|tiff|webp)|video\/(?:mpeg|mp4|ogg|webm)|audio\/(?:mp3|oga|ogg|opus));base64,[\d+/a-z]+=*$/i,
    _tags: {
        '*': ['class', 'dir', 'id', 'lang', 'role', /^aria-[\w-]*$/i,
              'data-bs-toggle', 'data-bs-target', 'data-bs-dismiss', 'data-bs-parent'],
        a: ['target', 'href', 'title', 'rel'], area: [],
        b: [], blockquote: [], br: [], button: [],
        col: [], code: [],
        div: [], em: [], hr: [],
        img: ['src', 'srcset', 'alt', 'title', 'width', 'height', 'style'],
        h1: [], h2: [], h3: [], h4: [], h5: [], h6: [],
        i: [], li: [], ol: [], p: [], pre: [],
        s: [], small: [], span: [], sub: [], sup: [], strong: [],
        table: [], thead: [], tbody: [], th: [], tr: [], td: [],
        u: [], ul: [],
    },

    isattr: function(attr, list) {
        const name = attr.nodeName.toLowerCase();
        if (list.includes(name)) {
            if (sanitizer._attrs.has(name)) {
                return sanitizer._urls.test(attr.nodeValue) || sanitizer._data.test(attr.nodeValue);
            }
            return true;
        }
        return list.some((x) => (x instanceof RegExp && x.test(name)));
    },

    run: function(html, list) {
        if (!html || typeof html != "string") return html;
        const body = app.$parse(html);
        const elements = [...body.querySelectorAll('*')];
        for (const el of elements) {
            const name = el.nodeName.toLowerCase();
            if (sanitizer._tags[name]) {
                const allow = [...sanitizer._tags['*'], ...sanitizer._tags[name] || []];
                for (const attr of [...el.attributes]) {
                    if (!sanitizer.isattr(attr, allow)) el.removeAttribute(attr.nodeName);
                }
            } else {
                el.remove();
            }
        }
        return list ? Array.from(body.childNodes) : body.innerHTML;
    }
}
app.sanitizer = sanitizer;

// Inject CSS/Script resources into the current page, all urls are loaded at the same time by default.
// - `options.series` - load urls one after another
// - `options.async` if set then scripts executed as soon as loaded otherwise executing scripts will be in the order provided
// - `options.callback` will be called with (el, opts) args for customizations after loading each url or on error
// - `options.attrs` is an object with attributes to set like nonce, ...
// - `options.timeout` - call the callback after timeout
app.loadResources = function(urls, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (typeof urls == "string") urls = [urls];
    app[`forEach${options?.series ? "Series" : ""}`](urls, (url, next) => {
        let el;
        const ev = () => { app.call(options?.callback, el, options); next() }
        if (/\.css/.test(url)) {
            el = app.$elem("link", "rel", "stylesheet", "type", "text/css", "href", url, "load", ev, "error", ev)
        } else {
            el = app.$elem('script', "async", !!options?.async, "src", url, "load", ev, "error", ev)
        }
        for (const p in options?.attrs) app.$attr(el, p, options.attrs[p]);
        document.head.appendChild(el);
    }, options?.timeout > 0 ? () => { setTimeout(callback, options.timeout) } : callback);
}

// Return a file object for the selector
app.getFileInput = function(file)
{
    if (typeof file == "string") file = app.$(file);
    if (file?.jquery !== undefined && file.length) file = file[0];
    if (app.isO(file)) {
        if (file.files?.length) return file.files[0];
        if (!app.isE(file) && file.name && file.size && (file.type || file.lastModified)) return file;
    }
    return "";
}

})();
