/*!
 *  backend.js client
 *  Vlad Seryakov vseryakov@gmail.com 2018
 */

bkjs.inherits = function(ctor, superCtor)
{
    ctor.prototype = Object.create(superCtor.prototype);
    ctor.prototype.constructor = ctor;
}

// Return value of the query parameter by name
bkjs.param = function(name, dflt, num)
{
    var d = location.search.match(new RegExp(name + "=(.*?)($|\&)", "i"));
    d = d ? decodeURIComponent(d[1]) : (dflt || "");
    if (num) {
        d = parseInt(d);
        if (isNaN(d)) d = 0;
    }
    return d;
}

// Percent encode with special symbols in addition
bkjs.encode = function(str)
{
    if (typeof str == "undefined") return "";
    return encodeURIComponent(str).replace(/[!'()*]/g, function(m) {
        return m == '!' ? '%21' : m == "'" ? '%27' : m == '(' ? '%28' : m == ')' ? '%29' : m == '*' ? '%2A' : m;
    });
}

// Return a cookie value by name
bkjs.cookie = function(name)
{
    if (!document.cookie) return "";
    var cookies = document.cookie.split(';');
    for (var i = 0; i < cookies.length; i++) {
        var cookie = jQuery.trim(cookies[i]);
        if (cookie.substring(0, name.length + 1) == (name + '=')) {
            return decodeURIComponent(cookie.substring(name.length + 1));
        }
    }
    return "";
}

// Simple debugging function that outputs arguments in the error console each argument on a separate line
bkjs.log = function()
{
    if (!console || !console.log) return;
    console.log.apply(console, arguments);
}

bkjs.domainName = function(host)
{
    if (!host) return "";
    var name = String(host || "").split('.');
    return (name.length > 2 ? name.slice(1).join('.') : host).toLowerCase();
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

// Format a Date object
bkjs.strftime = function(date, fmt, utc)
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

// Parse the input and convert into a Date object
bkjs.toDate = function(val, dflt)
{
    if (val && typeof val.getTime == "function") return val;
    var d = null;
    // String that looks like a number
    if (typeof val == "string" && /^[0-9\.]+$/.test(val)) val = this.toNumber(val);
    // Assume it is seconds which we use for most mtime columns, convert to milliseconds
    if (typeof val == "number" && val < 2147483647) val *= 1000;
    try { d = new Date(val); } catch(e) {}
    return !isNaN(d) ? d : new Date(dflt || 0);
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
    return typeof name == "string" ? name.replace(/(?:[-_.])(\w)/g, function (_, c) { return c ? c.toUpperCase() : '' }) : "";
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
    var rc = [];
    if (!options) options = {};
    if (!Array.isArray(obj)) obj = [obj];
    for (var i = 0; i < obj.length; i++) {
        if (typeof obj[i] == "object" && obj[i]) rc.push(obj[i]);
    }
    var tmpl = "", str = text;
    while (str) {
        var start = str.indexOf("@");
        if (start == -1) {
            tmpl += str;
            break;
        }
        var end = str.indexOf("@", start + 1);
        if (end == -1) {
            tmpl += str;
            break;
        }
        var tag = str.substr(start + 1, end - start - 1);
        tmpl += str.substr(0, start);
        str = str.substr(end + 1);
        var d, i, v = null, dflt = null;
        if (tag == "exit") {
            options.exit = 1;
        } else
        if (tag == "RAND") {
            v = Math.random();
        } else
        if (/^if/.test(tag)) {
            // @if type tester,admin@
            // @endif@
            end = str.indexOf("@endif@");
            if (end == -1) continue;
            var body = str.substr(0, end);
            str = str.substr(end + 7);
            d = tag.match(/^(if|ifeq|ifgt|ifge|iflt|ifle|ifnot|ifall|ifstr) ([a-zA-Z0-9]+) +(.+)$/)
            if (!d) continue;
            var ok, val = null;
            for (i = 0; i < rc.length && !val; i++) val = rc[i][d[2]];
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
                for (i = 0; i < rc.length && !v; i++) v = rc[i][tag];
            } else {
                tmpl += "@" + tag + "@";
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
    return (Array.isArray(str) ? str : String(str).split(sep || /[,\|]/)).
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

// Shallow copy of an object, all additional arguments are treted as properties to be added to the new object
bkjs.objClone = function()
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
bkjs.__ = function()
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

