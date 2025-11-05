/*
 *   app client
 *   Vlad Seryakov vseryakov@gmail.com 2018
 */

/* global window */

(() => {
var app = window.app;

app.util = {

    // Returns the array if the value is non empty array or dflt value if given or undefined
    isArray(val, dflt)
    {
        return Array.isArray(val) && val.length ? val : dflt;
    },

    // Returns true if `name` exists in the array `list`, search is case sensitive. if `name` is an array it will return true if
    // any element in the array exists in the `list`.
    isFlag(list, name)
    {
        return Array.isArray(list) && (Array.isArray(name) ? name.some((x) => (list.includes(x))) : list.includes(name));
    },

    // Apply an iterator function to each item in an array serially. Execute a callback when all items
    // have been completed or immediately if there is is an error provided.
    forEachSeries(list, iterator, callback, direct = true)
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
    },

    // Execute a list of functions serially and execute a callback upon completion or occurance of an error.
    series(tasks, callback, direct = true)
    {
        this.forEachSeries(tasks, (task, next, ...args) => {
            if (direct) task(next, ...args); else setTimeout(task, 0, next, ...args);
        }, callback, direct);
    },

    // Apply an iterator function to each item in an array in parallel. Execute a callback when all items
    // have been completed or immediately if there is an error provided
    forEach(list, iterator, callback, direct = true)
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
    },

    // Execute a list of functions in parallel and execute a callback upon completion or occurance of an error.
    parallel(tasks, callback, direct = true)
    {
        this.forEach(tasks, (task, next) => { task(next) }, callback, direct);
    },

    // Return Date object for given text or numeric date representation, for invalid date returns 1969 unless `invalid` parameter is given,
    // in this case invalid date returned as null. If `dflt` is NaN, null or 0 returns null as well.
    toDate(val, dflt, invalid)
    {
        if (app.isF(val?.getTime)) return val;
        var d = NaN;
        // String that looks like a number
        if (app.isS(val)) {
            val = /^[0-9.]+$/.test(val) ? this.toNumber(val) : val.replace(/([0-9])(AM|PM)/i, "$1 $2");
        }
        if (app.isN(val)) {
            // Convert nanoseconds to milliseconds
            if (val > 2147485547000) val = Math.round(val / 1000);
            // Convert seconds to milliseconds
            if (val < 2147483647) val *= 1000;
        }
        if (typeof val != "string" && typeof val != "number") val = d;
        if (val) try { d = new Date(val); } catch (e) {}
        return !isNaN(d) ? d : invalid || (dflt !== undefined && isNaN(dflt)) || dflt === null || dflt === 0 ? null : new Date(dflt || 0);
    },

    // Returns a human representation of an age for the given timestamp in milliseconds
    toAge(mtime)
    {
        var str = "";
        mtime = app.isN(mtime) ?? this.toNumber(mtime);
        if (mtime > 0) {
            var secs = Math.floor((Date.now() - mtime)/1000);
            var d = Math.floor(secs / 86400);
            var mm = Math.floor(d / 30);
            var w = Math.floor(d / 7);
            var h = Math.floor((secs - d * 86400) / 3600);
            var m = Math.floor((secs - d * 86400 - h * 3600) / 60);
            var s = Math.floor(secs - d * 86400 - h * 3600 - m * 60);
            if (mm > 0) {
                str = mm > 1 ? __(mm, " months") : __("1 month");
                if (d > 0) str += " " + (d > 1 ? __(d, " days") : __("1 day"));
                if (h > 0) str += " " + (h > 1 ? __(h, " hours") : __("1 hour"));
            } else
            if (w > 0) {
                str = w > 1 ? __(w, " weeks") : __("1 week");
                if (d > 0) str += " " + (d > 1 ? __(d, " days") : __("1 day"));
                if (h > 0) str += " " + (h > 1 ? __(h, " hours") : __("1 hour"));
            } else
            if (d > 0) {
                str = d > 1 ? __(d, " days") : __("1 day");
                if (h > 0) str += " " + (h > 1 ? __(h, " hours") : __("1 hour"));
                if (m > 0) str += " " + (m > 1 ? __(m, " minutes") : __("1 minute"));
            } else
            if (h > 0) {
                str = h > 1 ? __(h, " hours") : __("1 hour");
                if (m > 0) str += " " + (m > 1 ? __(m, " minutes") : __("1 minute"));
            } else
            if (m > 0) {
                str = m > 1 ? __(m, " minutes") : __("1 minute");
                if (s > 0) str += " " + (s > 1 ? __(s, " seconds") : __("1 second"));
            } else {
                str = secs > 1 ? __(secs, " seconds") : __("1 second");
            }
        }
        return str;
    },

    // Return duration in human format, mtime is milliseconds
    toDuration(mtime)
    {
        var str = "";
        mtime = app.isN(mtime) ?? this.toNumber(mtime);
        if (mtime > 0) {
            var seconds = Math.floor(mtime/1000);
            var d = Math.floor(seconds / 86400);
            var h = Math.floor((seconds - d * 86400) / 3600);
            var m = Math.floor((seconds - d * 86400 - h * 3600) / 60);
            var s = Math.floor(seconds - d * 86400 - h * 3600 - m * 60);
            if (d > 0) {
                str = d > 1 ? __(d, " days") :
                __("1 day");
                if (h > 0) str += " " + (h > 1 ? __(h, " hours") : __("1 hour"));
                    if (m > 0) str += " " + (m > 1 ? __(m, " minutes") : __("1 minute"));
            } else
            if (h > 0) {
                str = h > 1 ? __(h, " hours") : __("1 hour");
                if (m > 0) str += " " + (m > 1 ? __(m, " minutes") : __("1 minute"));
            } else
            if (m > 0) {
                str = m > 1 ? __(m, " minutes") : __("1 minute");
                if (s > 0) str += " " + (s > 1 ? __(s, " seconds") : __("1 second"));
            } else {
                str = seconds > 1 ? __(seconds, " seconds") : __("1 second");
            }
        }
        return str;
    },

    // Return size in human format
    toSize(size, decimals = 2)
    {
        var i = size > 0 ? Math.floor(Math.log(size) / Math.log(1024)) : 0;
        return (size / Math.pow(1024, i)).toFixed(app.isN(decimals) ?? 2) * 1 + ' ' + [__('Bytes'), __('KBytes'), __('MBytes'), __('GBytes'), __('TBytes')][i];
    },

    // Capitalize words
    toTitle(name, minlen)
    {
        return typeof name == "string" ?
               minlen > 0 && name.length <= minlen ? name :
               name.replace(/_/g, " ").
               split(/[ ]+/).
               reduce((x,y) => (x + y.substr(0,1).toUpperCase() + y.substr(1) + " "), "").
               trim() : "";
    },

    // Interpret the value as a boolean
    toBool(val, dflt)
    {
        if (typeof val == "boolean") return val;
        if (typeof val == "number") return !!val;
        if (val === undefined) val = dflt;
        return /^(true|on|yes|1|t)$/i.test(val);
    },

    // Convert a string to a number, on invalid input returns 0
    toNumber(val, options)
    {
        var n = 0;
        if (app.isN(val)) {
            n = val;
        } else {
            if (!app.isS(val)) {
                n = options?.dflt || 0;
            } else {
                // Autodetect floating number
                var f = !options || options.float === undefined || options.float == null ? /^[0-9-]+\.[0-9]+$/.test(val) : options.float;
                n = val[0] == 't' ? 1 : val[0] == 'f' ? 0 : val == "infinity" ? Infinity : (f ? parseFloat(val, 10) : parseInt(val, 10));
            }
        }
        n = isNaN(n) ? (options?.dflt || 0) : n;
        if (options) {
            if (app.isN(options.min) && n < options.min) n = options.min;
            if (app.isN(options.max) && n > options.max) n = options.max;
            if (app.isN(options.digits)) n = parseFloat(n.toFixed(options.digits));
        }
        return n;
    },

    // Return a test representation of a number according to the money formatting rules
    toPrice(num, options)
    {
        try {
            return this.toNumber(num).toLocaleString(options?.locale || "en-US", { style: 'currency',
                currency: options?.currency || 'USD',
                currencyDisplay: options?.display || "symbol",
                currencySign: options?.sign || "standard",
                minimumFractionDigits: options?.min || 2,
                maximumFractionDigits: options?.max || 5 });
        } catch (e) {
            console.error("toPrice:", e, num, options);
            return "";
        }
    },

    // Return a number clamped between the range
    toClamp(num, min, max)
    {
        return Math.max(this.toNumber(min), Math.min(this.toNumber(num), this.toNumber(max)));
    },


    // Split string into array, ignore empty items,
    // - `sep` is an RegExp to use as a separator instead of default  pattern `[,\|]`,
    // If `str` is an array and type is not specified then all non-string items will be returned as is.
    split(str, sep, options)
    {
        if (!str) return [];
        var rc = (Array.isArray(str) ? str : (typeof str == "string" ? str : String(str)).split(sep || /[,|]/)).
        map(x => {
            if (typeof x != "string") return x;
            x = x.trim();
            if (x === "" && !options?.keepempty) return x;
            if (!options) return x;
            if (options.regexp && !options.regexp.test(x)) return "";
            if (options.lower) x = x.toLowerCase();
            if (options.upper) x = x.toUpperCase();
            if (options.strip) x = x.replace(options.strip, "");
            if (options.camel) x = app.toCamel(x, options);
            if (options.cap) x = app.toTitle(x);
            if (options.number) x = this.toNumber(x, options);
            if (options.replace) {
                for (const p in options.replace) {
                    x = x.replaceAll(p, options.replace[p]);
                }
            }
            if (options.trunc > 0) x = x.substr(0, options.trunc);
            return x;
        }).
        filter(x => (options?.keepempty || typeof x == "string" ? x.length : 1));

        if (options?.unique) {
            rc = Array.from(new Set(rc));
        }
        return rc;
    },

    // Convert common special symbols into xml entities
    escape(str)
    {
        if (typeof str != "string") return "";
        return str.replace(/([&<>'":])/g, (_, x) => (_entities[x] || x));
    },

};

/// Empty locale translator
var __ = (...args) => (args.join(""));

var _entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };

})();
