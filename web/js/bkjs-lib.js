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
    var t = typeof(v);
    if (v === null) return "null";
    if (t !== "object") return t;
    if (Array.isArray(v)) return "array";
    if (v.constructor == (new Date()).constructor) return "date";
    if (v.constructor == (new RegExp()).constructor) return "regexp";
    return "object";
}

bkjs._formatPresets = {
    compact: { sbracket1: "", sbracket2: "", cbracket1: "", cbracket2: "", nl1: "<br>", nl2: "", quote1: "", quote2: "", comma: "", space: "&nbsp;&nbsp;&nbsp;", skipnull: 1, skipempty: 1 },
};

// Format an object into nice JSON formatted text
bkjs.formatJSON = function(obj, options)
{
    if (typeof options == "string") options = { indent: options };
    if (!options) options = {};
    // Shortcut to parse and format json from the string
    if (typeof obj == "string" && obj != "") {
        if (obj[0] != "[" && obj[0] != "{") return obj;
        try { obj = JSON.parse(obj); } catch (e) { this.log(e) }
    }
    var preset = bkjs._formatPresets[options.preset];
    for (const p in preset) options[p] = preset[p];

    if (!options.level) options.level = 0;
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
    var count = 0;
    var text = type == "array" ? options.sbracket1 : options.cbracket1;
    // Insert newlines only until specified level deep
    var nline = !options.indentlevel || options.level < options.indentlevel;

    for (var p in obj) {
        if (options.ignore && options.ignore.test(p)) continue;
        var val = obj[p];
        if (typeof options.preprocess == "function") {
            val = options.preprocess(p, val, options);
            if (typeof val == "undefined") continue;
        }
        if (options.skipnull && (val === "" || val === null || val === undefined)) continue;
        if (options.skipempty && this.isEmpty(val)) continue;
        if (count > 0) {
            text += type == "array" ? options.sep : options.comma;
        }
        if (type != "array") {
            text += ((nline && options.nl1 ? (!options.level && !count ? "" : options.nl1) + options.indent + options.space : "") +
                     options.quote1 + p + options.quote2 + ": ");
        }
        switch (this.typeName(val)) {
        case "array":
        case "object":
            options.indent += options.space;
            options.level++;
            text += this.formatJSON(val, options);
            options.level--;
            options.indent = options.indent.substr(0, options.indent.length - options.space.length);
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
    if (!tz || typeof tz != "string") return "";
    var t = tz.indexOf(":") > 0 ? tz.replace(":", "") : tz;
    for (const i in bkjs.tzMap) {
        if (t == bkjs.tzMap[i][1]) return bkjs.tzMap[i][0];
    }
    return tz;
}

bkjs.strftimeConfig = {
    a: function(t, utc, lang, tz) {
        if (lang && !bkjs.strftimeMap.weekDays[lang]) {
            bkjs.strftimeMap.weekDays[lang] = bkjs.strftimeMap.weekDays[""].map(function(x) { return bkjs.__({ phrase: x, locale: lang }) });
        }
        return bkjs.strftimeMap.weekDays[lang || ""][utc ? t.getUTCDay() : t.getDay()]
    },
    A: function(t, utc, lang, tz) {
        if (lang && !bkjs.strftimeMap.weekDaysFull[lang]) {
            bkjs.strftimeMap.weekDaysFull[lang] = bkjs.strftimeMap.weekDaysFull[""].map(function(x) { return bkjs.__({ phrase: x, locale: lang }) });
        }
        return bkjs.strftimeMap.weekDaysFull[lang || ""][utc ? t.getUTCDay() : t.getDay()]
    },
    b: function(t, utc, lang, tz) {
        if (lang && !bkjs.strftimeMap.months[lang]) {
            bkjs.strftimeMap.months[lang] = bkjs.strftimeMap.months[""].map(function(x) { return bkjs.__({ phrase: x, locale: lang }) });
        }
        return bkjs.strftimeMap.months[lang || ""][utc ? t.getUTCMonth() : t.getMonth()]
    },
    B: function(t, utc, lang, tz) {
        if (lang && !bkjs.strftimeMap.monthsFull[lang]) {
            bkjs.strftimeMap.monthsFull[lang] = bkjs.strftimeMap.monthsFull[""].map(function(x) { return bkjs.__({ phrase: x, locale: lang }) });
        }
        return bkjs.strftimeMap.monthsFull[lang || ""][utc ? t.getUTCMonth() : t.getMonth()]
    },
    c: function(t, utc, lang, tz) {
        return utc ? t.toUTCString() : t.toString()
    },
    d: function(t, utc, lang, tz) {
        return bkjs.zeropad(utc ? t.getUTCDate() : t.getDate())
    },
    H: function(t, utc, lang, tz) {
        return bkjs.zeropad(utc ? t.getUTCHours() : t.getHours())
    },
    I: function(t, utc, lang, tz) {
        return bkjs.zeropad((((utc ? t.getUTCHours() : t.getHours()) + 12) % 12) || 12)
    },
    L: function(t, utc, lang, tz) {
        return bkjs.zeropad(utc ? t.getUTCMilliseconds() : t.getMilliseconds())
    },
    m: function(t, utc, lang, tz) {
        return bkjs.zeropad((utc ? t.getUTCMonth() : t.getMonth()) + 1)
    }, // month-1
    M: function(t, utc, lang, tz) {
        return bkjs.zeropad(utc ? t.getUTCMinutes() : t.getMinutes())
    },
    p: function(t, utc, lang, tz) {
        return (utc ? t.getUTCHours() : t.getHours()) < 12 ? 'AM' : 'PM';
    },
    S: function(t, utc, lang, tz) {
       return bkjs.zeropad(utc ? t.getUTCSeconds() : t.getSeconds())
   },
    w: function(t, utc, lang, tz) {
        return utc ? t.getUTCDay() : t.getDay()
    }, // 0..6 == sun..sat
    W: function(t, utc, lang, tz) {
        return bkjs.zeropad(bkjs.weekOfYear(t, utc))
    },
    y: function(t, utc, lang, tz) {
        return bkjs.zeropad(t.getYear() % 100);
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
        return "GMT" + (tz < 0 ? "+" : "-") + bkjs.zeropad(Math.abs(-tz/60)) + "00";
    },
    zz: function(t, utc, lang, tz) {
        return bkjs.strftimeConfig.z(t, utc, lang, tz, 1);
    },
    z: function(t, utc, lang, tz, zz) {
        tz = tz ? tz/60000 : t.getTimezoneOffset();
        tz = "GMT" + (tz < 0 ? "+" : "-") + bkjs.zeropad(Math.abs(-tz/60)) + "00";
        var dst = bkjs.isDST(t);
        for (var i in bkjs.tzMap) {
            if (tz == bkjs.tzMap[i][1] && (dst === bkjs.tzMap[i][2])) {
                return zz ? tz + " " + bkjs.tzMap[i][0] : bkjs.tzMap[i][0];
            }
        }
        return tz;
    },
    Q: function(t, utc, lang, tz) {
        var h = utc ? t.getUTCHours() : t.getHours();
        return h < 12 ? bkjs.__({ phrase: "Morning", locale: lang }) :
               h < 17 ? bkjs.__({ phrase: "Afternoon", locale: lang }) :
               bkjs.__({ phrase: "Evening", locale: lang }) },
    '%': function() { return '%' },
};

// Format a Date object
bkjs.strftime = function(date, fmt, options)
{
    date = this.toDate(date, null);
    if (!date) return "";
    var utc = options && options.utc;
    var lang = options && options.lang;
    var tz = options && typeof options.tz == "number" ? options.tz : 0;
    if (tz) date = new Date(date.getTime() - tz);
    fmt = fmt || this.strftimeFormat;
    for (var p in this.strftimeConfig) {
        fmt = fmt.replace('%' + p, this.strftimeConfig[p](date, utc, lang, tz));
    }
    return fmt;
}

bkjs.sprintf = function(str, args)
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
        val = typeof(val) == 'object' ? JSON.stringify(val) : val.toString(base);
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
    callback = typeof callback == "function" ? callback : this.noop;
    if (!Array.isArray(list) || !list.length) return callback();
    function iterate(i, data) {
        if (i >= list.length) return callback(null, data);
        iterator(list[i], function(err, data) {
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
    this.forEachSeries(tasks, function(task, next, data1) {
        task(next, data1);
    }, function(err, data) {
        if (typeof callback == "function") callback(err, data);
    });
}

// Apply an iterator function to each item in an array in parallel. Execute a callback when all items
// have been completed or immediately if there is an error provided
bkjs.forEach = function(list, iterator, callback)
{
    callback = typeof callback == "function" ? callback : this.noop;
    if (!Array.isArray(list) || !list.length) return callback();
    var count = list.length;
    for (var i = 0; i < list.length; i++) {
        iterator(list[i], function(err) {
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
    this.forEach(tasks, function(task, next) {
        task(next);
    }, function(err) {
        if (typeof callback == "function") callback(err);
    });
}

// Return Date object for given text or numeric date representation, for invalid date returns 1969 unless `invalid` parameter is given,
// in this case invalid date returned as null. If `dflt` is NaN, null or 0 returns null as well.
bkjs.toDate = function(val, dflt, invalid)
{
    if (val && typeof val.getTime == "function") return val;
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
    if (typeof val != "string" && typeof val != "number") val = d;
    // Remove unsupported timezone names
    if (typeof val == "string") {
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
    mtime = typeof mtime == "number" ? mtime : this.toNumber(mtime);
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
    mtime = typeof mtime == "number" ? mtime : this.toNumber(mtime);
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
    return (size / Math.pow(1024, i)).toFixed(typeof decimals == "number" ? decimals : 2) * 1 + ' ' + [this.__('Bytes'), this.__('KBytes'), this.__('MBytes'), this.__('GBytes'), this.__('TBytes')][i];
}

bkjs.isArray = function(val, dflt)
{
    return Array.isArray(val) && val.length ? val : dflt;
}

bkjs.isFlag = function(list, name)
{
    return Array.isArray(list) && (Array.isArray(name) ? name.some(function(x) { return list.indexOf(x) > -1 }) : list.indexOf(name) > -1);
}

bkjs.isObject = function(v)
{
    return this.typeName(v) == "object";
}

bkjs.isNumeric = function(val)
{
    if (typeof val == "number") return true;
    if (typeof val != "string") return false;
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

// Flags command utility, update flags array and returns a new array, the commands are:
// - add - adds the `name` flags if does not exists
// - concat - same as add but always returns a new list
// - del - removes the flags `name`
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
            if (name && list.indexOf(name) == -1) list.push(name);
        } else {
            name.forEach((x) => { if (list.indexOf(x) == -1) list.push(x) });
        }
        break;

    case "del":
        if (!Array.isArray(list)) return [];
        list = list.filter((x) => (Array.isArray(name) ? name.indexOf(x) == -1 : x != name));
        break;

    case "present":
        if (!Array.isArray(list)) return [];
        if (!Array.isArray(name)) return list;
        list = list.filter((x) => (name.indexOf(x) > -1));
        break;

    case "absent":
        if (!Array.isArray(list)) return [];
        if (!Array.isArray(name)) return list;
        list = list.filter((x) => (name.indexOf(x) == -1));
        break;
    }
    return list;
}

// Capitalize words
bkjs.toTitle = function(name)
{
    return typeof name == "string" ? name.replace(/_/g, " ").split(/[ ]+/).reduce(function(x,y) { return x + y.substr(0,1).toUpperCase() + y.substr(1) + " "; }, "").trim() : "";
}

bkjs.toCamel = function(name, chars)
{
    return typeof name == "string" ? name.substr(0, 1).toLowerCase() + name.substr(1).replace(/(?:[-_.])(\w)/g, function (_, c) { return c ? c.toUpperCase() : '' }) : "";
}

// Convert Camel names into names separated by the given separator or dash if not.
bkjs.toUncamel = function(str, sep)
{
    return typeof str == "string" ? str.replace(/([A-Z])/g, function(letter) { return (sep || '-') + letter.toLowerCase(); }) : "";
}

// Interpret the value as a boolean
bkjs.toBool = function(val, dflt)
{
    if (typeof val == "boolean") return val;
    if (typeof val == "number") return !!val;
    if (typeof val == "undefined") val = dflt;
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
    if (typeof val == "number") {
        n = val;
    } else {
        if (typeof val != "string") {
            n = (options && options.dflt) || 0;
        } else {
            // Autodetect floating number
            var f = !options || typeof options.float == "undefined" || options.float == null ? /^[0-9-]+\.[0-9]+$/.test(val) : options.float;
            n = val[0] == 't' ? 1 : val[0] == 'f' ? 0 : val == "infinity" ? Infinity : (f ? parseFloat(val, 10) : parseInt(val, 10));
        }
    }
    n = isNaN(n) ? ((options && options.dflt) || 0) : n;
    if (options) {
        if (typeof options.min == "number" && n < options.min) n = options.min;
        if (typeof options.max == "number" && n > options.max) n = options.max;
    }
    return n;
}

// Return a test representation of a number according to the money formatting rules
bkjs.toPrice = function(num)
{
    return this.toNumber(num).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 3 });
}

bkjs.toValue = function(val, type, options)
{
    switch ((type || "").trim()) {
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

    case "set":
    case "list":
    case 'array':
        return this.strSplitUnique(val, options && options.separator, options);

    case "map":
        return this.strSplit(val, options && options.delimiter || ",").
               map((y) => (this.strSplit(y, options && options.separator || /[:;]/, options))).
               reduce((a, b) => { a[b[0]] = b.length == 2 ? b[1] : b.slice(1); return a }, {});

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
        if (typeof val == "string") return val;
        return String(val);
    }
}

bkjs.toTemplate = function(text, obj, options)
{
    if (typeof text != "string" || !text) return "";
    var i, j, rc = [];
    if (!options) options = {}
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
            d = tag.match(/^(if|ifnull|ifnotnull|ifne|ifeq|ifgt|ifge|iflt|ifle|ifnot|ifall|ifstr) ([a-zA-Z0-9._-]+) +(.+)$/)
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
                ok = val && this.isFlag(this.strSplit(d[3]), this.strSplit(val));
                break;
            case "ifnull":
                ok = val === null || val === undefined;
                break;
            case "ifnotnull":
                ok = !!val;
                break;
            case "ifempty":
                ok = this.isEmpty(val);
                break;
            case "ifne":
                ok = val != d[3];
                break;
            case "ifnot":
                ok = !val || !this.isFlag(this.strSplit(d[3]), this.strSplit(val));
                break;
            case "ifall":
                val = this.strSplit(val);
                ok = this.strSplit(d[3]).every(function(x) { return val.indexOf(x) > -1 });
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
            }
        }
        if (!v) v = dflt;
        if (v) {
            try {
                switch (enc) {
                case "url":
                    v = encodeURIComponent(v);
                    break;
                case "d-url":
                    v = decodeURIComponent(v);
                    break;
                case "base64":
                    v = window.btoa(v);
                    break;
                case "d-base64":
                    v = window.atob(v);
                    break;
                case "entity":
                    v = bkjs.textToEntity(v);
                    break;
                case "d-entity":
                    v = bkjs.entityToText(v);
                    break;
                case "strftime":
                    v = bkjs.strftime(v);
                    break;
                case "mtime":
                    v = bkjs.toDate(v, null);
                    if (!v) v = 0;
                    break;
                }
            } catch (e) {}
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

// Convert all special symbols into xml entities
bkjs.textToXml = function(str)
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

bkjs.htmlEntities = {
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
    'amp': '','and': '∧','andand': '⩕','andd': '⩜','andslope': '⩘',
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

bkjs.textToEntity = function(str)
{
    if (typeof str != "string") return "";
    if (!this.textEntities) {
        this.textEntities = {};
        for (var p in this.htmlEntities) this.textEntities[this.htmlEntities[p]] = "&" + p + ";";
    }
    return str.replace(/([&<>'":])/g, function(_, n) {
        return bkjs.textEntities[n] || n;
    });
}

// Convert html entities into their original symbols
bkjs.entityToText = function(str)
{
    if (typeof str != "string") return "";
    return str.replace(/&(#?[a-zA-Z0-9]+);/g, function(_, n) {
        if (n[0] === '#') return n.charAt(1) === 'x' ? String.fromCharCode(parseInt(n.substring(2), 16)) : String.fromCharCode(+n.substring(1));
        return bkjs.htmlEntities[n] || "";
    });
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
    return (Array.isArray(str) ? str : (typeof str == "string" ? str : String(str)).split(sep || /[,|]/)).
            map((x) => {
                if (x === "" && !options.keepempty) return x;
                x = options.datatype ? bkjs.toValue(x, options.datatype) : typeof x == "string" ? x.trim() : x;
                if (typeof x == "string") {
                    if (options.regexp && !options.regexp.test(x)) return "";
                    if (options.lower) x = x.toLowerCase();
                    if (options.upper) x = x.toUpperCase();
                    if (options.strip) x = x.replace(options.strip, "");
                    if (options.camel) x = bkjs.toCamel(x, options);
                    if (options.cap) x = bkjs.toTitle(x);
                    if (options.trunc > 0) x = x.substr(0, options.trunc);
                }
                return x;
            }).
            filter((x) => (options.keepempty || typeof x == "string" ? x.length : 1));
}

bkjs.strSplitUnique = function(str, sep, type)
{
    var rc = [];
    var typed = typeof type != "undefined";
    this.strSplit(str, sep, type).forEach(function(x) {
        if (!rc.some(function(y) {
            return typed || !(typeof x == "string" && typeof y == "string") ? x == y : x.toLowerCase() == y.toLowerCase()
        })) rc.push(x);
    });
    return rc;
}

bkjs.base64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
bkjs.base64Dict = {};

// From https://github.com/pieroxy/lz-string/
bkjs.strCompress = function(data, encoding)
{
    switch (encoding) {
    case "base64":
        var rc = this._strCompress(data, 6, function(a) { return bkjs.base64.charAt(a) });
        switch (rc.length % 4) {
        case 1:
            return rc + "===";
        case 2:
            return rc + "==";
        case 3:
            return rc + "=";
        }
        return rc;
    case "utf16":
        return this._strCompress(data, 15, function(a) { return String.fromCharCode(a + 32) }) + " ";
    default:
        return this._strCompress(data, 16, String.fromCharCode);
    }
}

bkjs.strDecompress = function(data, encoding)
{
    if (data == null || data === "") return "";
    switch (encoding) {
    case "base64":
        if (!this.base64Dict.A) for (let i = 0; i < this.base64.length; i++) this.base64Dict[this.base64.charAt(i)] = i;
        return this._strDecompress(data.length, 32, function(index) { return bkjs.base64Dict[data.charAt(index)] });
    case "utf16":
        return this._strDecompress(data.length, 16384, function(index) { return data.charCodeAt(index) - 32; });
    default:
        return this._strDecompress(data.length, 32768, function(index) { return data.charCodeAt(index); });
    }
}

bkjs._strCompress = function(data, bitsPerChar, getCharFromInt)
{
    if (data == null || data === "") return "";
    var i, ii, value, dict = {}, _dict = {};
    var cc = "", cwc = "", cw = "", enlargeIn = 2;
    var dictSize = 3, numBits = 2, cdata = [], dataVal = 0, dataPos = 0;

    for (ii = 0; ii < data.length; ii += 1) {
        cc = data.charAt(ii);
        if (!Object.prototype.hasOwnProperty.call(dict,cc)) {
            dict[cc] = dictSize++;
            _dict[cc] = true;
        }
        cwc = cw + cc;
        if (Object.prototype.hasOwnProperty.call(dict,cwc)) {
            cw = cwc;
        } else {
            if (Object.prototype.hasOwnProperty.call(_dict,cw)) {
                if (cw.charCodeAt(0) < 256) {
                    for (i = 0 ; i<numBits ; i++) {
                        dataVal = (dataVal << 1);
                        if (dataPos == bitsPerChar-1) {
                            dataPos = 0;
                            cdata.push(getCharFromInt(dataVal));
                            dataVal = 0;
                        } else {
                            dataPos++;
                        }
                    }
                    value = cw.charCodeAt(0);
                    for (i = 0 ; i < 8 ; i++) {
                        dataVal = (dataVal << 1) | (value&1);
                        if (dataPos == bitsPerChar-1) {
                            dataPos = 0;
                            cdata.push(getCharFromInt(dataVal));
                            dataVal = 0;
                        } else {
                            dataPos++;
                        }
                        value = value >> 1;
                    }
                } else {
                    value = 1;
                    for (i = 0 ; i < numBits ; i++) {
                        dataVal = (dataVal << 1) | value;
                        if (dataPos == bitsPerChar-1) {
                            dataPos = 0;
                            cdata.push(getCharFromInt(dataVal));
                            dataVal = 0;
                        } else {
                            dataPos++;
                        }
                        value = 0;
                    }
                    value = cw.charCodeAt(0);
                    for (i = 0 ; i < 16 ; i++) {
                        dataVal = (dataVal << 1) | (value&1);
                        if (dataPos == bitsPerChar-1) {
                            dataPos = 0;
                            cdata.push(getCharFromInt(dataVal));
                            dataVal = 0;
                        } else {
                            dataPos++;
                        }
                        value = value >> 1;
                    }
                }
                enlargeIn--;
                if (enlargeIn == 0) {
                    enlargeIn = Math.pow(2, numBits);
                    numBits++;
                }
                delete _dict[cw];
            } else {
                value = dict[cw];
                for (i = 0 ; i < numBits ; i++) {
                    dataVal = (dataVal << 1) | (value&1);
                    if (dataPos == bitsPerChar-1) {
                        dataPos = 0;
                        cdata.push(getCharFromInt(dataVal));
                        dataVal = 0;
                    } else {
                        dataPos++;
                    }
                    value = value >> 1;
                }
            }
            enlargeIn--;
            if (enlargeIn == 0) {
                enlargeIn = Math.pow(2, numBits);
                numBits++;
            }
            dict[cwc] = dictSize++;
            cw = String(cc);
        }
    }
    if (cw !== "") {
        if (Object.prototype.hasOwnProperty.call(_dict,cw)) {
            if (cw.charCodeAt(0) < 256) {
                for (i = 0 ; i<numBits ; i++) {
                    dataVal = (dataVal << 1);
                    if (dataPos == bitsPerChar-1) {
                        dataPos = 0;
                        cdata.push(getCharFromInt(dataVal));
                        dataVal = 0;
                    } else {
                        dataPos++;
                    }
                }
                value = cw.charCodeAt(0);
                for (i = 0 ; i < 8 ; i++) {
                    dataVal = (dataVal << 1) | (value&1);
                    if (dataPos == bitsPerChar-1) {
                        dataPos = 0;
                        cdata.push(getCharFromInt(dataVal));
                        dataVal = 0;
                    } else {
                        dataPos++;
                    }
                    value = value >> 1;
                }
            } else {
                value = 1;
                for (i = 0 ; i < numBits ; i++) {
                    dataVal = (dataVal << 1) | value;
                    if (dataPos == bitsPerChar-1) {
                        dataPos = 0;
                        cdata.push(getCharFromInt(dataVal));
                        dataVal = 0;
                    } else {
                        dataPos++;
                    }
                    value = 0;
                }
                value = cw.charCodeAt(0);
                for (i = 0 ; i < 16 ; i++) {
                    dataVal = (dataVal << 1) | (value&1);
                    if (dataPos == bitsPerChar-1) {
                        dataPos = 0;
                        cdata.push(getCharFromInt(dataVal));
                        dataVal = 0;
                    } else {
                        dataPos++;
                    }
                    value = value >> 1;
                }
            }
            enlargeIn--;
            if (enlargeIn == 0) {
                enlargeIn = Math.pow(2, numBits);
                numBits++;
            }
            delete _dict[cw];
        } else {
            value = dict[cw];
            for (i = 0 ; i < numBits ; i++) {
                dataVal = (dataVal << 1) | (value&1);
                if (dataPos == bitsPerChar-1) {
                    dataPos = 0;
                    cdata.push(getCharFromInt(dataVal));
                    dataVal = 0;
                } else {
                    dataPos++;
                }
                value = value >> 1;
            }
        }
        enlargeIn--;
        if (enlargeIn == 0) {
            enlargeIn = Math.pow(2, numBits);
            numBits++;
        }
    }
    value = 2;
    for (i = 0 ; i<numBits ; i++) {
        dataVal = (dataVal << 1) | (value&1);
        if (dataPos == bitsPerChar-1) {
            dataPos = 0;
            cdata.push(getCharFromInt(dataVal));
            dataVal = 0;
        } else {
            dataPos++;
        }
        value = value >> 1;
    }
    while (true) {
        dataVal = (dataVal << 1);
        if (dataPos == bitsPerChar-1) {
            cdata.push(getCharFromInt(dataVal));
            break;
        }
        else dataPos++;
    }
    return cdata.join('');
}

bkjs._strDecompress = function(length, resetValue, getNextValue)
{
    var dict = [], enlargeIn = 4, dictSize = 4, numBits = 3, entry = "", result = [], i, w, c, resb;
    var data = { val: getNextValue(0), position: resetValue, index: 1 };

    var bits = 0, maxpower = Math.pow(2,2), power = 1
    for (i = 0; i < 3; i += 1) dict[i] = i;
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
    dict[3] = c;
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

            dict[dictSize++] = String.fromCharCode(bits);
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
            dict[dictSize++] = String.fromCharCode(bits);
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
        if (dict[c]) {
            entry = dict[c];
        } else {
            if (c === dictSize) {
                entry = w + w.charAt(0);
            } else {
                return null;
            }
        }
        result.push(entry);
        dict[dictSize++] = w + entry.charAt(0);
        enlargeIn--;
        w = entry;
        if (enlargeIn == 0) {
            enlargeIn = Math.pow(2, numBits);
            numBits++;
        }
    }
}

// Return all property names for an object
bkjs.objKeys = function(obj)
{
    return this.isObject(obj) ? Object.keys(obj) : [];
}

// Returns a new object constructed from the arguments pairs
bkjs.objNew = function()
{
    var obj = {};
    for (var i = 0; i < arguments.length - 1; i += 2) if (typeof arguments[i + 1] != "undefined") obj[arguments[i]] = arguments[i + 1];
    return obj;
}

// Shallow copy of an object, all additional arguments are treated as properties to be added to the new object
bkjs.objClone = function()
{
    var obj = arguments[0];
    var rc = Array.isArray(obj) ? [] : {};
    for (var p in obj) {
        switch (this.typeName(obj[p])) {
        case "object":
            rc[p] = {};
            for (var o in obj[p]) rc[p][o] = obj[p][o];
            break;
        case "array":
            rc[p] = [];
            for (var a in obj[p]) rc[p][a] = obj[p][a];
            break;
        default:
            rc[p] = obj[p];
        }
    }
    for (var i = 1; i < arguments.length - 1; i += 2) rc[arguments[i]] = arguments[i + 1];
    return rc;
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
    return str ? String(str).replace("_", ".").replace(/[^0-9.]/g, "").split(".").reduce(function(x,y,i) { return x + Number(y) / Math.pow(10, i * 3) }, 0) : 0;
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

    if (typeof msg === "object" && msg.phrase) {
        lang = msg.locale || lang;
        msg = msg.phrase;
    }
    msg = (lang && this.locales[lang] && this.locales[lang][msg]) || msg;
    if (arguments.length == 1) return msg;
    return this.sprintf(msg, Array.prototype.slice.call(arguments, 1));
}

