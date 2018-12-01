/*!
 *  backend.js client
 *  Vlad Seryakov vseryakov@gmail.com 2018
 */

Bkjs.domainName = function(host)
{
    if (!host) return "";
    var name = String(host || "").split('.');
    return (name.length > 2 ? name.slice(1).join('.') : host).toLowerCase();
}

// Determine type of the object
Bkjs.typeName = function(v)
{
    var t = typeof(v);
    if (v === null) return "null";
    if (t !== "object") return t;
    if (Array.isArray(v)) return "array";
    if (v.constructor == (new Date).constructor) return "date";
    if (v.constructor == (new RegExp).constructor) return "regexp";
    return "object";
}

// Format an object into nice JSON formatted text
Bkjs.formatJSON = function(obj, options)
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

// Format a Date object
Bkjs.strftime = function(date, fmt, utc)
{
    var self = this;
    if (typeof date == "string") {
        if (date.match(/^[0-9]+$/)) date = parseInt(date);
        try { date = new Date(date); } catch(e) {}
    } else
        if (typeof date == "number") {
            try { date = new Date(date); } catch(e) {}
        }
    if (!date || isNaN(date)) return "";
    if (!fmt) fmt = "%Y-%m-%d %H:%M:%S";
    function zeropad(n) { return n > 9 ? n : '0' + n; }
    var handlers = {
        a: function(t) { return [ self.__('Sun'), self.__('Mon'), self.__('Tue'), self.__('Wed'), self.__('Thu'), self.__('Fri'), self.__('Sat') ][utc ? t.getUTCDay() : t.getDay()] },
        A: function(t) { return [ self.__('Sunday'), self.__('Monday'), self.__('Tuesday'), self.__('Wednesday'), self.__('Thursday'), self.__('Friday'), self.__('Saturday') ][utc ? t.getUTCDay() : t.getDay()] },
        b: function(t) { return [ self.__('Jan'), self.__('Feb'), self.__('Mar'), self.__('Apr'), self.__('May'), self.__('Jun'), self.__('Jul'), self.__('Aug'), self.__('Sep'), self.__('Oct'), self.__('Nov'), self.__('Dec') ][utc ? t.getUTCMonth() : t.getMonth()] },
        B: function(t) { return [ self.__('January'), self.__('February'), self.__('March'), self.__('April'), self.__('May'), self.__('June'), self.__('July'), self.__('August'), self.__('September'), self.__('October'), self.__('November'), self.__('December') ][utc ? t.getUTCMonth() : t.getMonth()] },
        c: function(t) { return utc ? t.toUTCString() : t.toString() },
        d: function(t) { return zeropad(utc ? t.getUTCDate() : t.getDate()) },
        H: function(t) { return zeropad(utc ? t.getUTCHours() : t.getHours()) },
        I: function(t) { return zeropad(((utc ? t.getUTCHours() : t.getHours()) + 12) % 12) },
        m: function(t) { return zeropad((utc ? t.getUTCMonth() : t.getMonth()) + 1) }, // month-1
        M: function(t) { return zeropad(utc ? t.getUTCMinutes() : t.getMinutes()) },
        p: function(t) { return this.H(t) < 12 ? 'AM' : 'PM'; },
        S: function(t) { return zeropad(utc ? t.getUTCSeconds() : t.getSeconds()) },
        L: function(t) { return zeropad(utc ? t.getUTCMilliseconds() : t.getMilliseconds()) },
        w: function(t) { return utc ? t.getUTCDay() : t.getDay() }, // 0..6 == sun..sat
        W: function(t) { var d = utc ? Date.UTC(utc ? t.getUTCFullYear() : t.getFullYear(), 0, 1) : new Date(t.getFullYear(), 0, 1); return Math.ceil((((t - d) / 86400000) + d.getDay() + 1) / 7); },
        y: function(t) { return zeropad(this.Y(t) % 100); },
        Y: function(t) { return utc ? t.getUTCFullYear() : t.getFullYear() },
        t: function(t) { return t.getTime() },
        u: function(t) { return Math.floor(t.getTime()/1000) },
        Z: function(t) { return "GMT" + (t.getTimezoneOffset() < 0 ? "+" : "-") + zeropad(Math.abs(-t.getTimezoneOffset()/60)) + "00" },
        Q: function(t) { var h = utc ? t.getUTCHours() : t.getHours(); return h < 12 ? self.__("Morning") : h < 17 ? self.__("Afternoon") : self.__("Evening") },
        '%': function(t) { return '%' },
    };
    for (var h in handlers) {
        fmt = fmt.replace('%' + h, handlers[h](date));
    }
    return fmt;
}

Bkjs.sprintf = function(str, args)
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
Bkjs.forEachSeries = function(list, iterator, callback)
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
Bkjs.series = function(tasks, callback)
{
    this.forEachSeries(tasks, function(task, next) {
        task(next);
    }, function(err) {
        if (typeof callback == "function") callback(err);
    });
}

// Parse the input and convert into a Date object
Bkjs.toDate = function(val, dflt)
{
    if (isDate(val)) return val;
    var d = null;
    // String that looks like a number
    if (typeof val == "string" && /^[0-9\.]+$/.test(val)) val = toNumber(val);
    // Assume it is seconds which we use for most mtime columns, convert to milliseconds
    if (typeof val == "number" && val < 2147483647) val *= 1000;
    try { d = new Date(val); } catch(e) {}
    return !isNaN(d) ? d : new Date(dflt || 0);
}

// Returns a human representation of an age for the given timestamp in milliseconds
Bkjs.toAge = function(mtime, options)
{
    var str = "";
    mtime = typeof mtime == "number" ? mtime : this.toNumber(mtime);
    if (mtime > 0) {
        var lang = options && options.lang;
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

Bkjs.toDuration = function(mtime, options)
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

Bkjs.isArray = function(val, dflt)
{
    return Array.isArray(val) && val.length ? val : dflt;
}

Bkjs.isFlag = function(list, name)
{
    return Array.isArray(list) && (Array.isArray(name) ? name.some(function(x) { return list.indexOf(x) > -1 }) : list.indexOf(name) > -1);
}

Bkjs.isObject = function(v)
{
    return this.typeName(v) == "object";
}

// Capitalize words
Bkjs.toTitle = function(name)
{
    return (name || "").replace(/_/g, " ").split(/[ ]+/).reduce(function(x,y) { return x + y.substr(0,1).toUpperCase() + y.substr(1) + " "; }, "").trim();
}

Bkjs.toCamel = function(name, chars)
{
    var rx = new RegExp("(?:[" + (chars || "-_\\.") + "])(\\w)", "g");
    return String(name || "").replace(rx, function (_, c) { return c ? c.toUpperCase () : ''; });
}

// Convert Camel names into names separated by the given separator or dash if not.
Bkjs.toUncamel = function(str, sep)
{
    return String(str).replace(/([A-Z])/g, function(letter) { return (sep || '-') + letter.toLowerCase(); });
}

// Interpret the value as a boolean
Bkjs.toBool = function(val, dflt)
{
    if (typeof val == "boolean") return val;
    if (typeof val == "number") return !!val;
    if (typeof val == "undefined") val = dflt;
    return !val || String(val).trim().match(/^(false|off|f|0$)/i) ? false : true;
}

// Convert a string to a number, on invalid input returns 0
Bkjs.toNumber = function(val, options)
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

// Return a test representation of a number according to the money formatting rules(US)
Bkjs.toMoneyNumber = function(num)
{
    var parts = String(typeof num != "number" || isNaN(num) ? 0 : num < 0 ? -num : num).split(".");
    var p1 = parts[0], i = p1.length, str = '';
    while (i--) {
        str = (i == 0 ? '' : ((p1.length - i) % 3 ? '' : ',')) + p1.charAt(i) + str;
    }
    return (num < 0 ? '-' : '') + str + (parts[1] ? '.' + parts[1] : '');
}

Bkjs.toValue = function(val, type)
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
        return /^[0-9\.]+$/.test(String(val)) ? toNumber(val) : (new Date(val));

    case "json":
        return JSON.stringify(val);

    case "phone":
        return String(str).replace(/[^0-9]+/g, "");

    default:
        if (typeof val == "string") return val;
        return String(val);
    }
}

// Split string into array, ignore empty items,
// - `sep` is an RegExp to use as a separator instead of default  pattern `[,\|]`,
// - `options` is an object with the same properties as for the `toParams`, `datatype' will be used with
//   `toValue` to convert the value for each item
//
// If `str` is an array and type is not specified then all non-string items will be returned as is.
Bkjs.strSplit = function(str, sep, type)
{
    var self = this;
    if (!str) return [];
    var typed = typeof type != "undefined";
    return (Array.isArray(str) ? str : String(str).split(sep || /[,\|]/)).
    map(function(x) { return typed ? self.toValue(x, type) : typeof x == "string" ? x.trim() : x }).
    filter(function(x) { return typeof x == "string" ? x.length : 1 });
}

Bkjs.strSplitUnique = function(str, sep, type)
{
    var rc = [];
    var typed = typeof type != "undefined";
    this.strSplit(str, sep, type).forEach(function(x) {
        if (!rc.some(function(y) { return typed ? x == y : x.toLowerCase() == y.toLowerCase() })) rc.push(x);
    });
    return rc;
}

// Return all property names for an object
Bkjs.objKeys = function(obj)
{
    return this.isObject(obj) ? Object.keys(obj) : [];
}

// Returns a new object constructed from the arguments pairs
Bkjs.objNew = function()
{
    var obj = {};
    for (var i = 0; i < arguments.length - 1; i += 2) if (typeof arguments[i + 1] != "undefined") obj[arguments[i]] = arguments[i + 1];
    return obj;
}

// Shallow copy of an object, all additional arguments are treted as properties to be added to the new object
Bkjs.objClone = function()
{
    var obj = arguments[0];
    var rc = Array.isArray(obj) ? [] : {};
    for (var p in obj) {
        switch (this.typeName(obj[p])) {
        case "object":
            rc[p] = {};
            for (var k in obj[p]) rc[p][k] = obj[p][k];
            break;
        case "array":
            rc[p] = [];
            for (var k in obj[p]) rc[p][k] = obj[p][k];
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
// - __("", locale: "" }, arg...
//
Bkjs.__ = function()
{
    var lang = this.account.lang;
    var msg = arguments[0];

    if (typeof arguments[0] === "object" && arguments[0].phrase) {
        msg = arguments[0].phrase;
        lang = arguments[0].locale || lang;
    }
    msg = (this.locales[lang] && this.locales[lang][msg]) || msg;
    if (arguments.length == 1) return msg;
    return this.sprintf(msg, Array.prototype.slice.call(arguments, 1));
}

