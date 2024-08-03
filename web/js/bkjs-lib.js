/*!
 *  backend.js client
 *  Vlad Seryakov vseryakov@gmail.com 2018
 */

bkjs.noop = function() {}

bkjs.inherits = function(ctor, superCtor)
{
    ctor.prototype = Object.create(superCtor.prototype);
    ctor.prototype.constructor = ctor;
}

// Determine type of the object
bkjs.typeName = function(v)
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

bkjs._formatPresets = {
    compact: {
        sbracket1: "",
        sbracket2: "",
        cbracket1: "",
        cbracket2: "",
        nl1: "<br>",
        nl2: "",
        quote1: "",
        quote2: "",
        comma: "",
        prefix: "&nbsp;&nbsp;-&nbsp;",
        space: "&nbsp;",
        skipnull: 1,
        skipempty: 1
    },
};

// Format an object into nice JSON formatted text
bkjs.formatJSON = function(obj, options)
{
    if (this.isS(options)) options = { indent: options };
    if (!options) options = {};
    // Shortcut to parse and format json from the string
    if (this.isS(obj) && obj != "") {
        if (obj[0] != "[" && obj[0] != "{") return obj;
        try { obj = JSON.parse(obj); } catch (e) { this.log(e) }
    }
    var preset = this._formatPresets[options.preset];
    for (const p in preset) options[p] = preset[p];

    if (!options.level) options.level = 0;
    if (!options.indent) options.indent = "";
    if (this.isU(options.nl1)) options.nl1 = "\n";
    if (this.isU(options.nl2)) options.nl2 = "\n";
    if (this.isU(options.sbracket1)) options.sbracket1 = "[";
    if (this.isU(options.sbracket2)) options.sbracket2 = "]";
    if (this.isU(options.cbracket1)) options.cbracket1 = "{";
    if (this.isU(options.cbracket2)) options.cbracket2 = "}";
    if (this.isU(options.quote1)) options.quote1 = '"';
    if (this.isU(options.quote2)) options.quote2 = '"';
    if (this.isU(options.space)) options.space = " ";
    if (this.isU(options.nspace)) options.nspace = 4;
    if (this.isU(options.comma)) options.comma = ", ";
    if (this.isU(options.sep)) options.sep = ", ";
    if (this.isU(options.prefix)) options.prefix = "";

    var type = this.typeName(obj);
    var count = 0, indent;
    var text = type == "array" ? options.sbracket1 : options.cbracket1;
    var map = options.map || "";
    // Insert newlines only until specified level deep
    var nline = !options.indentlevel || options.level < options.indentlevel;
    // Top level prefix set, skip new line for the first item
    var prefix = options.__prefix;
    delete options.__prefix;

    for (var p in obj) {
        if (options.ignore && options.ignore.test(p)) continue;
        var val = obj[p];
        if (this.isF(options.preprocess)) {
            val = options.preprocess(p, val, options);
            if (this.isU(val)) continue;
        }
        if (options.skipnull && (val === "" || val === null || val === undefined)) continue;
        if (options.skipempty && this.isEmpty(val)) continue;
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
        switch (this.typeName(val)) {
        case "array":
        case "object":
            if (type == "array" && options.prefix && options.nl1) {
                indent = options.__prefix = options.space.repeat(options.prefix.length);
            } else {
                indent = options.space.repeat(options.nspace);
            }
            options.indent += indent;
            options.level++;
            text += this.formatJSON(val, options);
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
            text += (options.quote1 + val + options.quote2);
            break;
        default:
            text += ("unknown: " + typeof(val));
        }
        count++;
    }
    text += type == "array" ? options.sbracket2 : ((nline && options.nl2 ? options.nl2 + options.indent : "") + options.cbracket2);
    return text;
}

bkjs.weekOfYear = function(date, utc)
{
    date = this.toDate(date, null);
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
bkjs.isDST = function(date)
{
    var jan = new Date(date.getFullYear(), 0, 1).getTimezoneOffset();
    var jul = new Date(date.getFullYear(), 6, 1).getTimezoneOffset();
    return Math.max(jan, jul) != date.getTimezoneOffset();
}

bkjs.zeropad = function(n)
{
    return n > 9 ? n : '0' + n;
}

bkjs.strftimeFormat = "%Y-%m-%d %H:%M:%S %Z";
bkjs.strftimeMap = {
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
bkjs.tzMap = [
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
bkjs.tzName = function(tz)
{
    if (!tz || !this.isS(tz)) return "";
    var t = tz.indexOf(":") > 0 ? tz.replace(":", "") : tz;
    for (const i in this.tzMap) {
        if (t == this.tzMap[i][1]) return this.tzMap[i][0];
    }
    return tz;
}

// Format a Date object
bkjs.strftime = function(date, fmt, options)
{
    date = this.toDate(date, null);
    if (!date) return "";
    const tz = this.isN(options?.tz) ? options.tz : 0;
    if (tz) date = new Date(date.getTime() - tz);
    fmt = fmt || this.strftimeFormat;
    const cmds = {
        a: (t, utc, lang, tz) => {
            if (lang && !this.strftimeMap.weekDays[lang]) {
                this.strftimeMap.weekDays[lang] = this.strftimeMap.weekDays[""].map((x) => (this.__({ phrase: x, locale: lang })));
            }
            return this.strftimeMap.weekDays[lang || ""][utc ? t.getUTCDay() : t.getDay()]
        },
        A: (t, utc, lang, tz) => {
            if (lang && !this.strftimeMap.weekDaysFull[lang]) {
                this.strftimeMap.weekDaysFull[lang] = this.strftimeMap.weekDaysFull[""].map((x) => (this.__({ phrase: x, locale: lang })));
            }
            return this.strftimeMap.weekDaysFull[lang || ""][utc ? t.getUTCDay() : t.getDay()]
        },
        b: (t, utc, lang, tz) => {
            if (lang && !this.strftimeMap.months[lang]) {
                this.strftimeMap.months[lang] = this.strftimeMap.months[""].map((x) => (this.__({ phrase: x, locale: lang })));
            }
            return this.strftimeMap.months[lang || ""][utc ? t.getUTCMonth() : t.getMonth()]
        },
        B: (t, utc, lang, tz) => {
            if (lang && !this.strftimeMap.monthsFull[lang]) {
                this.strftimeMap.monthsFull[lang] = this.strftimeMap.monthsFull[""].map((x) => (this.__({ phrase: x, locale: lang })));
            }
            return this.strftimeMap.monthsFull[lang || ""][utc ? t.getUTCMonth() : t.getMonth()]
        },
        c: (t, utc, lang, tz) => (utc ? t.toUTCString() : t.toString()),
        d: (t, utc, lang, tz) => (this.zeropad(utc ? t.getUTCDate() : t.getDate())),
        H: (t, utc, lang, tz) => (this.zeropad(utc ? t.getUTCHours() : t.getHours())),
        I: (t, utc, lang, tz) => (this.zeropad((((utc ? t.getUTCHours() : t.getHours()) + 12) % 12) || 12)),
        L: (t, utc, lang, tz) => (this.zeropad(utc ? t.getUTCMilliseconds() : t.getMilliseconds())),
        m: (t, utc, lang, tz) => (this.zeropad((utc ? t.getUTCMonth() : t.getMonth()) + 1)), // month-1
        M: (t, utc, lang, tz) => (this.zeropad(utc ? t.getUTCMinutes() : t.getMinutes())),
        p: (t, utc, lang, tz) => ((utc ? t.getUTCHours() : t.getHours()) < 12 ? 'AM' : 'PM'),
        S: (t, utc, lang, tz) => (this.zeropad(utc ? t.getUTCSeconds() : t.getSeconds())),
        w: (t, utc, lang, tz) => (utc ? t.getUTCDay() : t.getDay()), // 0..6 == sun..sat
        W: (t, utc, lang, tz) => (this.zeropad(this.weekOfYear(t, utc))),
        y: (t, utc, lang, tz) => (this.zeropad(t.getYear() % 100)),
        Y: (t, utc, lang, tz) => (utc ? t.getUTCFullYear() : t.getFullYear()),
        t: (t, utc, lang, tz) => (t.getTime()),
        u: (t, utc, lang, tz) => (Math.floor(t.getTime()/1000)),
        Z: (t, utc, lang, tz) => {
            tz = tz ? tz/60000 : t.getTimezoneOffset();
            return "GMT" + (tz < 0 ? "+" : "-") + this.zeropad(Math.abs(-tz/60)) + "00";
        },
        zz: (t, utc, lang, tz) => (cmds.z(t, utc, lang, tz, 1)),
        z: (t, utc, lang, tz, zz) => {
            tz = tz ? tz/60000 : t.getTimezoneOffset();
            tz = "GMT" + (tz < 0 ? "+" : "-") + this.zeropad(Math.abs(-tz/60)) + "00";
            var dst = this.isDST(t);
            for (var i in this.tzMap) {
                if (tz == this.tzMap[i][1] && (dst === this.tzMap[i][2])) {
                    return zz ? tz + " " + this.tzMap[i][0] : this.tzMap[i][0];
                }
            }
            return tz;
        },
        Q: (t, utc, lang, tz) => {
            var h = utc ? t.getUTCHours() : t.getHours();
            return h < 12 ? this.__({ phrase: "Morning", locale: lang }) :
                   h < 17 ? this.__({ phrase: "Afternoon", locale: lang }) :
                   this.__({ phrase: "Evening", locale: lang }) },
                   '%': function() { return '%' },
    };

    for (var c in cmds) {
        fmt = fmt.replace('%' + c, cmds[c](date, options?.utc, options?.lang, tz));
    }
    return fmt;
}

bkjs.sprintf = function(str, args)
{
    var i = 0, arr = arguments;
    if (arguments.length == 2 && Array.isArray(args)) i = -1, arr = args;

    const format = (sym, p0, p1, p2, p3, p4) => {
        if (sym == '%%') return '%';
        if (arr[++i] === undefined) return undefined;
        var exp = p2 ? parseInt(p2.substr(1)) : undefined;
        var base = p3 ? parseInt(p3.substr(1)) : undefined;
        var val;
        switch (p4) {
        case 's':
            val = arr[i];
            break;
        case 'c':
            val = arr[i][0];
            break;
        case 'f':
            val = parseFloat(arr[i]).toFixed(exp);
            if (isNaN(val)) val = 0;
            break;
        case 'g':
            val = parseFloat(arr[i]).toFixed(exp);
            if (isNaN(val)) val = 0;
            if (val.indexOf(".") > -1) {
                while (val[val.length - 1] == "0") val = val.slice(0, -1);
                if (val[val.length - 1] == ".") val = val.slice(0, -1);
            }
            break;
        case 'p':
            val = parseFloat(arr[i]).toPrecision(exp);
            if (isNaN(val)) val = 0;
            break;
        case 'e':
            val = parseFloat(arr[i]).toExponential(exp);
            if (isNaN(val)) val = 0;
            break;
        case 'x':
            val = parseInt(arr[i]).toString(base ? base : 16);
            if (isNaN(val)) val = 0;
            break;
        case 'd':
            val = parseFloat(parseInt(arr[i], base ? base : 10).toPrecision(exp)).toFixed(0);
            if (isNaN(val)) val = 0;
            break;
        }
        val = this.isO(val) ? JSON.stringify(val) : val.toString(base);
        var sz = parseInt(p1); /* padding size */
        var ch = p1 && p1[0] == '0' ? '0' : ' '; /* isnull? */
        while (val.length < sz) val = p0 !== undefined ? val + ch : ch + val; /* isminus? */
        return val;
    }
    var regex = /%(-)?(0?[0-9]+)?([.][0-9]+)?([#][0-9]+)?([scfpexdg])/g;
    return str.replace(regex, format);
}

// Apply an iterator function to each item in an array serially. Execute a callback when all items
// have been completed or immediately if there is is an error provided.
bkjs.forEachSeries = function(list, iterator, callback)
{
    callback = this.isF(callback) ? callback : this.noop;
    if (!Array.isArray(list) || !list.length) return callback();
    function iterate(i, data) {
        if (i >= list.length) return callback(null, data);
        iterator(list[i], (err, data) => {
            if (err) {
                callback(err, data);
                callback = function() {};
            } else {
                iterate(++i, data);
            }
        }, data);
    }
    iterate(0);
}

// Execute a list of functions serially and execute a callback upon completion or occurance of an error.
bkjs.series = function(tasks, callback)
{
    this.forEachSeries(tasks, (task, next, data1) => {
        task(next, data1);
    }, (err, data) => {
        if (this.isF(callback)) callback(err, data);
    });
}

// Apply an iterator function to each item in an array in parallel. Execute a callback when all items
// have been completed or immediately if there is an error provided
bkjs.forEach = function(list, iterator, callback)
{
    callback = this.isF(callback) ? callback : this.noop;
    if (!Array.isArray(list) || !list.length) return callback();
    var count = list.length;
    for (var i = 0; i < list.length; i++) {
        iterator(list[i], (err) => {
            if (err) {
                callback(err);
                callback = function() {};
                i = list.length + 1;
            } else
            if (--count == 0) {
                callback();
                callback = function() {};
            }
        });
    }
}

// Execute a list of functions in parallel and execute a callback upon completion or occurance of an error.
bkjs.parallel = function(tasks, callback)
{
    this.forEach(tasks, (task, next) => {
        task(next);
    }, (err) => {
        if (this.isF(callback)) callback(err);
    });
}

// Return Date object for given text or numeric date representation, for invalid date returns 1969 unless `invalid` parameter is given,
// in this case invalid date returned as null. If `dflt` is NaN, null or 0 returns null as well.
bkjs.toDate = function(val, dflt, invalid)
{
    if (this.isF(val?.getTime)) return val;
    var d = NaN;
    // String that looks like a number
    if (this.isS(val)) {
        val = /^[0-9.]+$/.test(val) ? this.toNumber(val) : val.replace(/([0-9])(AM|PM)/i, "$1 $2");
    }
   if (this.isN(val)) {
        // Convert nanoseconds to milliseconds
        if (val > 2147485547000) val = Math.round(val / 1000);
        // Convert seconds to milliseconds
        if (val < 2147483647) val *= 1000;
    }
    if (!this.isS(val) && !this.isN(val)) val = d;
    // Remove unsupported timezone names
    if (this.isS(val)) {
        var gmt = val.indexOf("GMT") > -1;
        for (const i in this.tzMap) {
            if ((gmt || this.tzMap[i][3] === false) && val.indexOf(this.tzMap[i][0]) > -1) {
                val = val.replace(this.tzMap[i][0], "");
            }
        }
    }
    if (val) try { d = new Date(val); } catch (e) {}
    return !isNaN(d) ? d : invalid || (dflt !== undefined && isNaN(dflt)) || dflt === null || dflt === 0 ? null : new Date(dflt || 0);
}

// Returns a human representation of an age for the given timestamp in milliseconds
bkjs.toAge = function(mtime, options)
{
    var str = "";
    mtime = this.isN(mtime) ? mtime : this.toNumber(mtime);
    if (mtime > 0) {
        var secs = Math.floor((Date.now() - mtime)/1000);
        var d = Math.floor(secs / 86400);
        var mm = Math.floor(d / 30);
        var w = Math.floor(d / 7);
        var h = Math.floor((secs - d * 86400) / 3600);
        var m = Math.floor((secs - d * 86400 - h * 3600) / 60);
        var s = Math.floor(secs - d * 86400 - h * 3600 - m * 60);
        if (mm > 0) {
            str = mm > 1 ? this.__("%s months", mm) : this.__("1 month");
            if (d > 0) str += " " + (d > 1 ? this.__("%s days", d) : this.__("1 day"));
            if (h > 0) str += " " + (h > 1 ? this.__("%s hours", h) : this.__("1 hour"));
        } else
            if (w > 0) {
                str = w > 1 ? this.__("%s weeks", w) : this.__("1 week");
                if (d > 0) str += " " + (d > 1 ? this.__("%s days", d) : this.__("1 day"));
                if (h > 0) str += " " + (h > 1 ? this.__("%s hours", h) : this.__("1 hour"));
            } else
                if (d > 0) {
                    str = d > 1 ? this.__("%s days", d) : this.__("1 day");
                    if (h > 0) str += " " + (h > 1 ? this.__("%s hours", h) : this.__("1 hour"));
                    if (m > 0) str += " " + (m > 1 ? this.__("%s minutes", m) : this.__("1 minute"));
                } else
                    if (h > 0) {
                        str = h > 1 ? this.__("%s hours", h) : this.__("1 hour");
                        if (m > 0) str += " " + (m > 1 ? this.__("%s minutes", m) : this.__("1 minute"));
                    } else
                        if (m > 0) {
                            str = m > 1 ? this.__("%s minutes", m) : this.__("1 minute");
                            if (s > 0) str += " " + (s > 1 ? this.__("%s seconds", s) : this.__("1 second"));
                        } else {
                            str = secs > 1 ? this.__("%s seconds", secs) : this.__("1 second");
                        }
    }
    return str;
}

bkjs.toDuration = function(mtime, options)
{
    var str = "";
    mtime = this.isN(mtime) ? mtime : this.toNumber(mtime);
    if (mtime > 0) {
        var seconds = Math.floor(mtime/1000);
        var d = Math.floor(seconds / 86400);
        var h = Math.floor((seconds - d * 86400) / 3600);
        var m = Math.floor((seconds - d * 86400 - h * 3600) / 60);
        var s = Math.floor(seconds - d * 86400 - h * 3600 - m * 60);
        if (d > 0) {
            str = d > 1 ? this.__("%s days", d) :
                          this.__("1 day");
            if (h > 0) str += " " + (h > 1 ? this.__("%s hours", h) :
                                             this.__("1 hour"));
            if (m > 0) str += " " + (m > 1 ? this.__("%s minutes", m) :
                                             this.__("1 minute"));
        } else
            if (h > 0) {
                str = h > 1 ? this.__("%s hours", h) :
                              this.__("1 hour");
                if (m > 0) str += " " + (m > 1 ? this.__("%s minutes", m) :
                                                 this.__("1 minute"));
            } else
                if (m > 0) {
                    str = m > 1 ? this.__("%s minutes", m) :
                                  this.__("1 minute");
                    if (s > 0) str += " " + (s > 1 ? this.__("%s seconds", s) :
                                                     this.__("1 second"));
                } else {
                    str = seconds > 1 ? this.__("%s seconds", seconds) :
                                        this.__("1 second");
                }
    }
    return str;
}

bkjs.toSize = function(size, decimals)
{
    var i = size > 0 ? Math.floor(Math.log(size) / Math.log(1024)) : 0;
    return (size / Math.pow(1024, i)).toFixed(this.isN(decimals) ? decimals : 2) * 1 + ' ' + [this.__('Bytes'), this.__('KBytes'), this.__('MBytes'), this.__('GBytes'), this.__('TBytes')][i];
}

bkjs.isArray = function(val, dflt)
{
    return Array.isArray(val) && val.length ? val : dflt;
}

bkjs.isFlag = function(list, name)
{
    return Array.isArray(list) && (Array.isArray(name) ? name.some((x) => (list.includes(x))) : list.includes(name));
}

bkjs.isObject = function(v)
{
    return this.typeName(v) == "object";
}

bkjs.isNumeric = function(val)
{
    if (this.isN(val)) return true;
    if (!this.isS(val)) return false;
    return /^(-|\+)?([0-9]+|[0-9]+\.[0-9]+)$/.test(val);
}

// Return true of the given value considered empty
bkjs.isEmpty = function(val)
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
bkjs.toFlags = function(cmd, list, name)
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
bkjs.toTitle = function(name)
{
    return this.isS(name) ? name.replace(/_/g, " ").split(/[ ]+/).reduce((x,y) => (x + y.substr(0,1).toUpperCase() + y.substr(1) + " "), "").trim() : "";
}

bkjs.toCamel = function(name, chars)
{
    return this.isS(name) ? name.substr(0, 1).toLowerCase() + name.substr(1).replace(/(?:[-_.])(\w)/g, (_, c) => (c ? c.toUpperCase() : '')) : "";
}

// Convert Camel names into names separated by the given separator or dash if not.
bkjs.toUncamel = function(str, sep)
{
    return this.isS(str) ? str.replace(/([A-Z])/g, (letter) => ((sep || '-') + letter.toLowerCase())) : "";
}

// Interpret the value as a boolean
bkjs.toBool = function(val, dflt)
{
    if (this.isB(val)) return val;
    if (this.isN(val)) return !!val;
    if (this.isU(val)) val = dflt;
    return !val || String(val).trim().match(/^(false|off|f|0$)/i) ? false : true;
}

bkjs.toClamp = function(num, min, max)
{
  return Math.max(this.toNumber(min), Math.min(this.toNumber(num), this.toNumber(max)));
}

// Convert a string to a number, on invalid input returns 0
bkjs.toNumber = function(val, options)
{
    var n = 0;
    if (this.isN(val)) {
        n = val;
    } else {
        if (!this.isS(val)) {
            n = options?.dflt || 0;
        } else {
            // Autodetect floating number
            var f = !options || this.isU(options.float) || options.float == null ? /^[0-9-]+\.[0-9]+$/.test(val) : options.float;
            n = val[0] == 't' ? 1 : val[0] == 'f' ? 0 : val == "infinity" ? Infinity : (f ? parseFloat(val, 10) : parseInt(val, 10));
        }
    }
    n = isNaN(n) ? (options?.dflt || 0) : n;
    if (options) {
        if (this.isN(options.min) && n < options.min) n = options.min;
        if (this.isN(options.max) && n > options.max) n = options.max;
        if (this.isN(options.digits)) n = parseFloat(n.toFixed(options.digits));
    }
    return n;
}

// Return a test representation of a number according to the money formatting rules
bkjs.toPrice = function(num, options)
{
    return this.toNumber(num).toLocaleString("en", {
        minimumFractionDigits: options?.min || 2,
        maximumFractionDigits: options?.max || 5
    });
}

bkjs.toValue = function(val, type, options)
{
    switch ((type || "").trim()) {
    case "auto":
        if (this.isU(val) || val === null) return "";
        if (this.isS(val)) {
            type = this.isNumeric(val) ? "number":
                   val == "true" || val == "false" ? "bool":
                   val[0] == "^" && val.slice(-1) == "$" ? "regexp":
                   val[0] == "[" && val.slice(-1) == "]" ? "js":
                   val[0] == "{" && val.slice(-1) == "}" ? "js":
                   val.indexOf("|") > -1 && !val.match(/[()[\]^$]/) ? "list": "";
        }
        return this.toValue(val, type, options);

    case "set":
    case "list":
    case 'array':
        return this.strSplitUnique(val, options && options.separator, options);

    case "map":
        return this.strSplit(val, options?.delimiter || ",").
               map((y) => (this.strSplit(y, options?.separator || /[:;]/, options))).
               reduce((a, b) => {
                a[b[0]] = b.length == 2 ? b[1] : b.slice(1);
                if (options?.maptype) a[b[0]] = this.toValue(a[b[0]], options.maptype);
                return a
            }, {});

    case "expr":
    case "buffer":
        return val;

    case "real":
    case "float":
    case "double":
        return this.toNumber(val, { float: 1 });

    case "int":
    case "smallint":
    case "integer":
    case "number":
    case "bigint":
    case "numeric":
    case "counter":
        return this.toNumber(val);

    case "bool":
    case "boolean":
        return this.toBool(val);

    case "date":
    case "time":
        return this.toDate(val);

    case "mtime":
        return /^[0-9.]+$/.test(String(val)) ? this.toNumber(val) : (new Date(val));

    case "json":
        return JSON.stringify(val);

    case "phone":
        return String(val).replace(/[^0-9]+/g, "");

    default:
        if (this.isS(val)) return val;
        return String(val);
    }
}

bkjs.toTemplate = function(text, obj, options)
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
                v = this.textToEntity(v);
                break;
            case "d-entity":
                v = this.entityToText(v);
                break;
            case "strftime":
                v = this.strftime(v);
                break;
            case "mtime":
                v = this.toDate(v, null);
                if (!v) v = 0;
                break;
            }
        } catch (e) {}
        return v;
    }
    return this._toTemplate(text, obj, options, encoder);
}

bkjs._toTemplate = function(text, obj, options, encoder)
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
                ok = this.isEmpty(val);
                break;
            case "ifnotempty":
                ok = !this.isEmpty(val);
                break;
            case "if":
                ok = val && this.isFlag(this.strSplit(d[3]), this.strSplit(val));
                break;
            case "ifne":
                ok = val != d[3];
                break;
            case "ifnot":
                ok = !val || !this.isFlag(this.strSplit(d[3]), this.strSplit(val));
                break;
            case "ifall":
                val = this.strSplit(val);
                ok = this.strSplit(d[3]).every((x) => (val.includes(x)));
                break;
            case "ifstr":
                ok = this.testRegexp(val || "", this.toRegexp(d[3], "i"));
                break;
            case "ifnotstr":
                ok = !this.testRegexp(val || "", this.toRegexp(d[3], "i"));
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

// Split string into array, ignore empty items,
// - `sep` is an RegExp to use as a separator instead of default  pattern `[,\|]`,
// - `options` is an object with the same properties as for the `toParams`, `datatype' will be used with
//   `toValue` to convert the value for each item
//
// If `str` is an array and type is not specified then all non-string items will be returned as is.
bkjs.strSplit = function(str, sep, options)
{
    if (!str) return [];
    options = options || {};
    return (Array.isArray(str) ? str : (this.isS(str) ? str : String(str)).split(sep || /[,|]/)).
            map((x) => {
                if (x === "" && !options.keepempty) return x;
                x = options.datatype ? this.toValue(x, options.datatype) : this.isS(x) ? x.trim() : x;
                if (!this.isS(x)) return x;
                if (options.regexp && !options.regexp.test(x)) return "";
                if (options.lower) x = x.toLowerCase();
                if (options.upper) x = x.toUpperCase();
                if (options.strip) x = x.replace(options.strip, "");
                if (options.camel) x = this.toCamel(x, options);
                if (options.cap) x = this.toTitle(x);
                if (options.trunc > 0) x = x.substr(0, options.trunc);
                return x;
            }).
            filter((x) => (options.keepempty || this.isS(x) ? x.length : 1));
}

bkjs.strSplitUnique = function(str, sep, type)
{
    var rc = [];
    var typed = !this.isU(type);
    this.strSplit(str, sep, type).forEach((x) => {
        if (!rc.some((y) => (typed || !(this.isS(x) && this.isS(y)) ? x == y : x.toLowerCase() == y.toLowerCase()))) rc.push(x);
    });
    return rc;
}

// Returns a new object constructed from the arguments pairs
bkjs.objNew = function()
{
    var obj = {};
    for (var i = 0; i < arguments.length - 1; i += 2) if (!this.isU(arguments[i + 1])) obj[arguments[i]] = arguments[i + 1];
    return obj;
}

// Return all object properties
bkjs.objKeys = function(obj)
{
    return this.isObject(obj) ? Object.keys(obj) : [];
}

// Shallow copy of an object, all additional arguments are treated as properties to be added to the new object
bkjs.objClone = function()
{
    var obj = arguments[0];
    var rc = Array.isArray(obj) ? [] : {}, o1, o2;
    for (const p in obj) {
        if (!obj.hasOwnProperty(p)) continue;
        o1 = obj[p];
        switch (this.typeName(o1)) {
        case "object":
            rc[p] = o2 = {};
            for (const k in o1) o2[k] = o1[k];
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
    for (let i = 1; i < arguments.length - 1; i += 2) rc[arguments[i]] = arguments[i + 1];
    return rc;
}

bkjs.objExtend = function(obj, val, options)
{
    obj = typeof obj == "object" || typeof obj == "function" ? obj || {} : {};
    if (options) {
        const a = Array.isArray(val);
        for (let p in val) {
            const v = val[p];
            if (v === obj) continue;
            if (v === undefined && options.noempty) continue;
            if (!a) {
                if (typeof options.ignore?.test == "function" && options.ignore.test(p)) continue;
                if (typeof options.allow?.test == "function" && !options.allow.test(p)) continue;
                if (typeof options.strip?.test == "function") p = p.replace(options.strip, ""); else
                if (typeof options.remove?.test == "function") p = p.replace(options.remove, "");
            }
            if (p === "__proto__") continue;
            if (options.deep && v) {
                if (Array.isArray(v)) {
                    obj[p] = this.objExtend(Array.isArray(obj[p]) ? obj[p] : [], v, options);
                    continue;
                } else
                if (this.typeName(v) === "object") {
                    obj[p] = this.objExtend(obj[p], v, options);
                    continue;
                }
            }
            obj[p] = v;
        }
    } else {
        for (const p in val) obj[p] = val[p];
    }
    return obj;
}

// Delete properties from the object, first arg is an object, the rest are properties to be deleted
bkjs.objDel = function()
{
    const a = arguments;
    if (!this.isObject(a[0])) return;
    for (let i = 1; i < a.length; i++) delete a[0][a[i]];
    return a[0];
}

// Return a value from object, can go deep inside, name is a list of parts or a string like part1.part2.part3...
bkjs.objGet = function(obj, name, options)
{
    if (!obj) {
        if (!options) return null;
        return options.list ? [] : options.obj ? {} : options.str ? "" : options.num ? options.dflt || 0 : null;
    }
    var path = !Array.isArray(name) ? String(name).split(".") : name, owner = obj;
    for (var i = 0; i < path.length; i++) {
        if (i && owner) owner = owner[path[i - 1]];
        obj = obj ? obj[path[i]] : undefined;
        if (typeof obj == "function") obj = obj();
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

// Randomize the list items in place
bkjs.shuffle = function(list)
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
bkjs.random = function(size)
{
    var s = "";
    if (window.crypto && window.crypto.getRandomValues) {
        var u = new Uint8Array(size || 16), h = "0123456789abcdef";
        window.crypto.getRandomValues(u);
        for (let i = 0; i < u.length; i++) s += h.charAt(u[i] >> 4) + h.charAt(u[i] & 0x0F);
    } else {
        var l = (size || 16) * 2;
        while (s.length < l) s += Math.abs((((1 + Math.random()) * 0x100000000) | 0)).toString(16);
        if (s.length > l) s = s.substr(0, l);
    }
    return s;
}

// Return numeric representation of the version string to perfom arithmetic comparions
bkjs.toVersion = function(str)
{
    return str ? String(str).replace("_", ".").replace(/[^0-9.]/g, "").split(".").reduce((x,y,i) => (x + Number(y) / Math.pow(10, i * 3)), 0) : 0;
}

// Simple i18n translation method compatible with other popular modules, supports the following usage:
// - __(name)
// - __(fmt, arg,...)
// - __({ phrase: "", locale: "" }, arg...
//
bkjs.__ = function()
{
    var lang = this.account.lang;
    var msg = arguments[0];

    if (this.isO(msg) && msg.phrase) {
        lang = msg.locale || lang;
        msg = msg.phrase;
    }
    msg = (lang && this.locales[lang] && this.locales[lang][msg]) || msg;
    if (arguments.length == 1) return msg;
    return this.sprintf(msg, Array.prototype.slice.call(arguments, 1));
}

