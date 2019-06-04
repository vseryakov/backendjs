/*!
 *  backend.js client
 *  Vlad Seryakov vseryakov@gmail.com 2018
 */

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

// Format an object into nice JSON formatted text
bkjs.formatJSON = function(obj, options)
{
    if (typeof options == "string") options = { indent: options };
    if (!options) options = {};
    // Shortcut to parse and format json from the string
    if (typeof obj == "string" && obj != "") {
        if (obj[0] != "[" && obj[0] != "{") return obj;
        try { obj = JSON.parse(obj); } catch(e) { this.log(e) }
    }
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
        var val = obj[p];
        if (count > 0) {
            text += type == "array" ? options.sep : options.comma;
        }
        if (type != "array") {
            text += ((nline ? (!options.level && !count ? "" : options.nl1) + options.indent + options.space : " ") + options.quote1 + p + options.quote2 + ": ");
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
    text += type == "array" ? options.sbracket2 : ((nline ? options.nl2 + options.indent : " ") + options.cbracket2);
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
];

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
        return bkjs.zeropad(((utc ? t.getUTCHours() : t.getHours()) + 12) % 12)
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
    z: function(t, utc, lang, tz) {
        tz = tz ? tz/60000 : t.getTimezoneOffset();
        tz = "GMT" + (tz < 0 ? "+" : "-") + bkjs.zeropad(Math.abs(-tz/60)) + "00";
        var dst = bkjs.isDST(t);
        for (var i in bkjs.tzMap) {
            if (tz == bkjs.tzMap[i][1] && (dst === bkjs.tzMap[i][2])) return bkjs.tzMap[i][0];
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
    if (!list || !list.length) return callback();
    function iterate(i) {
        if (i >= list.length) return callback();
        iterator(list[i], function(err) {
            if (err) {
                callback(err);
                callback = function() {}
            } else {
                iterate(++i);
            }
        });
    }
    iterate(0);
}

// Execute a list of functions serially and execute a callback upon completion or occurance of an error.
bkjs.series = function(tasks, callback)
{
    this.forEachSeries(tasks, function(task, next) {
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
    if (typeof val == "string" && /^[0-9.]+$/.test(val)) val = this.toNumber(val);
    // Assume it is seconds which we use for most mtime columns, convert to milliseconds
    if (typeof val == "number" && val < 2147483647) val *= 1000;
    if (typeof val != "string" && typeof val != "number") val = d;
    if (val) try { d = new Date(val); } catch(e) {}
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

bkjs.toSize = function(size)
{
    var i = Math.floor( Math.log(size) / Math.log(1024) );
    return ( size / Math.pow(1024, i) ).toFixed(2) * 1 + ' ' + [this.__('Bytes'), this.__('KBytes'), this.__('MBytes'), this.__('GBytes'), this.__('TBytes')][i];
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
    return this.toNumber(num).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 20 });
}

bkjs.toValue = function(val, type)
{
    switch ((type || "").trim()) {
    case "list":
    case 'array':
        return Array.isArray(val) ? val : String(val).split(/[,\|]/);

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
        return /^[0-9\.]+$/.test(String(val)) ? this.toNumber(val) : (new Date(val));

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
    var i, rc = [];
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
            str = str.substr(end + 7);
            d = tag.match(/^(if|ifeq|ifgt|ifge|iflt|ifle|ifnot|ifall|ifstr) ([a-zA-Z0-9]+) +(.+)$/)
            if (!d) continue;
            var ok, val = null;
            for (i = 0; i < rc.length && !val; i++) val = typeof rc[i][d[2]] == "function" ? rc[i][d[2]]() : rc[i][d[2]];
            switch (d[1]) {
            case "if":
                ok = val && this.isFlag(this.strSplit(d[3]), this.strSplit(val));
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
            d = tag.match(/^([a-zA-Z0-9_]+)(\|.+)?$/);
            if (d) {
                tag = d[1];
                if (d[2]) dflt = d[2].substr(1);
                for (i = 0; i < rc.length && !v; i++) v = typeof rc[i][tag] == "function" ? rc[i][tag]() : rc[i][tag];
            } else {
                tmpl += sep1 + tag + sep2;
            }
        }
        if (!v) v = dflt;
        if (v) {
            switch (options.encoding) {
            case "url":
                v = encodeURIComponent(v);
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

// Split string into array, ignore empty items,
// - `sep` is an RegExp to use as a separator instead of default  pattern `[,\|]`,
// - `options` is an object with the same properties as for the `toParams`, `datatype' will be used with
//   `toValue` to convert the value for each item
//
// If `str` is an array and type is not specified then all non-string items will be returned as is.
bkjs.strSplit = function(str, sep, type)
{
    var self = this;
    if (!str) return [];
    var typed = typeof type != "undefined";
    return (Array.isArray(str) ? str : String(str).split(sep || /[,|]/)).
    map(function(x) { return typed ? self.toValue(x, type) : typeof x == "string" ? x.trim() : x }).
    filter(function(x) { return typeof x == "string" ? x.length : 1 });
}

bkjs.strSplitUnique = function(str, sep, type)
{
    var rc = [];
    var typed = typeof type != "undefined";
    this.strSplit(str, sep, type).forEach(function(x) {
        if (!rc.some(function(y) { return typed ? x == y : x.toLowerCase() == y.toLowerCase() })) rc.push(x);
    });
    return rc;
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

