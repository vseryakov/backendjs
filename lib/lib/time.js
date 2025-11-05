/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');
const microtime = require('microtime');

lib.strftimeFormat = "%Y-%m-%d %H:%M:%S %Z";

lib.strftimeMap = {
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
    
lib.tzMap = [
    // name, GMT offset, daylight, linux support
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

lib._epoch = Date.UTC(2023, 6, 31);
lib._epoch_usec = lib._epoch * 1000.0;
lib._epoch_sec = lib._epoch/1000;

// Returns current time in seconds (s), microseconds (m), time struct (tm) or milliseconds since the local `lib._epoch` (2023-07-31 UTC)
lib.localEpoch = function(type)
{
    switch (type) {
    case "s": return Math.round(Date.now()/1000) - this._epoch_sec;
    case "m": return microtime.now() - this._epoch_usec;
    case "tm":
        var tm = microtime.nowStruct();
        return [ tm[0] - this._epoch_sec, tm[1] ];
    default: return Date.now() - this._epoch;
    }
}

// Returns current time in microseconds since January 1, 1970, UTC
lib.clock = function()
{
    return microtime.now();
}

// Return current time in an array as [ tv_sec, tv_usec ]
lib.getTimeOfDay = function()
{
    return microtime.nowStruct();
}

// Return number of seconds for current time
lib.now = function()
{
    return Math.round(Date.now()/1000);
}

// Return the number of days in the given month of the specified year.
lib.daysInMonth = function(year, month)
{
    return new Date(year, month, 0).getDate();
}

// Return an ISO week number for given date, from https://www.epochconverter.com/weeknumbers
lib.weekOfYear = function(date, utc)
{
    date = this.toDate(date, null);
    if (!date) return 0;
    utc = utc ? "UTC": "";
    var target = new Date(date.valueOf());
    target[`set${utc}Date`](target[`get${utc}Date`]() - ((date[`get${utc}Day`]() + 6) % 7) + 3);
    var firstThursday = target.valueOf();
    target[`set${utc}Month`](0, 1);
    var day = target[`get${utc}Day`]();
    if (day != 4) target[`set${utc}Month`](0, 1 + ((4 - day) + 7) % 7);
    return 1 + Math.ceil((firstThursday - target) / 604800000);
}

// Return first day of the week by ISO week number
lib.weekDate = function(year, week)
{
    week = lib.toNumber(week) - 1;
    var d = new Date(year, 0, 1);
    if (lib.weekOfYear(d) != 1) week--;
    var day = d.getDay();
    d.setDate(d.getDate() - (day == 1 ? 0: (day || 7) - 1));
    return new Date(d.getTime() + 86400000 * 7 * Math.max(0, week));
}

// Returns true if the given date is in DST timezone
lib.isDST = function(date)
{
    var jan = new Date(date.getFullYear(), 0, 1).getTimezoneOffset();
    var jul = new Date(date.getFullYear(), 6, 1).getTimezoneOffset();
    return Math.max(jan, jul) != date.getTimezoneOffset();
}

// Return a timezone human name if matched (EST, PDT...), tz must be in GMT-NNNN format
lib.tzName = function(tz, dst)
{
    if (!tz || typeof tz != "string") return "";
    var t = tz.indexOf(":") > 0 ? tz.replace(":", "") : tz;
    for (const m of this.tzMap) {
        if (t == m[1] && dst === m[2]) return m[0];
    }
    return tz;
}

/**
 * Parses a string with time and return an array [hour, min], accepts 12 and 24hrs formats,
 * a single hour is accepted as well, returns undefined if cannot parse
 */
lib.parseTime = function(time)
{
    if (typeof time != "string") time = String(time);
    const d = time.match(/^(([0-9]+)|([0-9]+):([0-9]+)) *(am|AM|pm|PM)?$/);
    if (!d) return;
    let h = lib.toNumber(d[2] || d[3]);
    const m = lib.toNumber(d[4]);
    switch (d[5]) {
    case "am":
    case "AM":
        if (h >= 12) h -= 12;
        break;
    case "pm":
    case "PM":
        if (h < 12) h += 12;
        break;
    }
    if (h < 0 || h > 23 || m < 0 || m > 59) return;
    return [h, m]
}

/**
 * Returns 0 if the current time is not within specified valid time range or it is invalid. Only continious time rang eis support, it
 * does not handle over the midninght ranges, i.e. time1 is always must be greater than time2.
 *
 * `options.tz` to specify timezone, no timezone means current timezone.
 * `options.date` if given must be a list of dates in the format: YYY-MM-DD,...
 */
lib.isTimeRange = function(time1, time2, options)
{
    if (!time1 && !time2) return 0;
    var now = new Date(), tz = options && options.tz;
    if (tz === "GMT" || tz === "UTC") {
        tz = 0;
    } else {
        tz = typeof tz == "string" && tz.match(/GMT(-|\+)?([0-9]{2}):?([0-9]{2})/);
        if (tz) tz = (parseInt(tz[2], 10) * 3600000 + parseInt(tz[3], 10) * 60000) * (tz[1] == "+" ? 1 : -1);
        if (!tz) tz = now.getTimezoneOffset() * -60000;
    }
    now = new Date(now.getTime() + tz);
    if (options && options.date) {
        if (lib.strftime(now, "%Y-%m-%d") != lib.strftime(lib.toDate(options.date), "%Y-%m-%d")) return 0;
    }
    var h0 = now.getUTCHours();
    var m0 = now.getUTCMinutes();
    if (time1) {
        const t = this.parseTime(time1);
        if (!t) return 0;
        logger.debug("isTimeRange:", "start:", h0, m0, " - ", t, time1, "tz:", tz, "now:", now);
        if (h0*100+m0 < t[0]*100+t[1]) return 0;
    }
    if (time2) {
        const t = this.parseTime(time2);
        if (!t) return 0;
        logger.debug("isTimeRange:", "end:", h0, m0, " - ", t, time2, "tz:", tz, "now:", now);
        if (h0*100+m0 < t[0]*100+t[1]) return 0;
    }
    return 1;
}

function zeropad(n) { return n > 9 ? n : '0' + n }
function spacepad(n) { return n > 9 ? n : ' ' + n }

const _strftime = {
    a: function(t, utc, lang, tz) {
        if (lang && !lib.strftimeMap.weekDays[lang]) {
            lib.strftimeMap.weekDays[lang] = lib.strftimeMap.weekDays[""].map((x) => (lib.__({ phrase: x, locale: lang })));
        }
        return lib.strftimeMap.weekDays[lang || ""][utc ? t.getUTCDay() : t.getDay()]
    },
    A: function(t, utc, lang, tz) {
        if (lang && !lib.strftimeMap.weekDaysFull[lang]) {
            lib.strftimeMap.weekDaysFull[lang] = lib.strftimeMap.weekDaysFull[""].map((x) => (lib.__({ phrase: x, locale: lang })));
        }
        return lib.strftimeMap.weekDaysFull[lang || ""][utc ? t.getUTCDay() : t.getDay()]
    },
    b: function(t, utc, lang, tz) {
        if (lang && !lib.strftimeMap.months[lang]) {
            lib.strftimeMap.months[lang] = lib.strftimeMap.months[""].map((x) => (lib.__({ phrase: x, locale: lang })));
        }
        return lib.strftimeMap.months[lang || ""][utc ? t.getUTCMonth() : t.getMonth()]
    },
    B: function(t, utc, lang, tz) {
        if (lang && !lib.strftimeMap.monthsFull[lang]) {
            lib.strftimeMap.monthsFull[lang] = lib.strftimeMap.monthsFull[""].map((x) => (lib.__({ phrase: x, locale: lang })));
        }
        return lib.strftimeMap.monthsFull[lang || ""][utc ? t.getUTCMonth() : t.getMonth()]
    },
    c: function(t, utc, lang, tz) {
        return utc ? t.toUTCString() : t.toString()
    },
    d: function(t, utc, lang, tz) {
        return zeropad(utc ? t.getUTCDate() : t.getDate())
    },
    e: function(t, utc, lang, tz) {
        return spacepad(utc ? t.getUTCDate() : t.getDate())
    },
    H: function(t, utc, lang, tz) {
        return zeropad(utc ? t.getUTCHours() : t.getHours())
    },
    I: function(t, utc, lang, tz) {
        return zeropad((((utc ? t.getUTCHours() : t.getHours()) + 12) % 12) || 12)
    },
    k: function(t, utc, lang, tz) {
        return spacepad(utc ? t.getUTCHours() : t.getHours())
    },
    l: function(t, utc, lang, tz) {
        return spacepad((((utc ? t.getUTCHours() : t.getHours()) + 12) % 12) || 12)
    },
    L: function(t, utc, lang, tz) {
        return zeropad(utc ? t.getUTCMilliseconds() : t.getMilliseconds())
    },
    m: function(t, utc, lang, tz) {
        return zeropad((utc ? t.getUTCMonth() : t.getMonth()) + 1)
    }, // month-1
    M: function(t, utc, lang, tz) {
        return zeropad(utc ? t.getUTCMinutes() : t.getMinutes())
    },
    p: function(t, utc, lang, tz) {
        return (utc ? t.getUTCHours() : t.getHours()) < 12 ? 'am' : 'pm';
    },
    S: function(t, utc, lang, tz) {
       return zeropad(utc ? t.getUTCSeconds() : t.getSeconds())
    },
    w: function(t, utc, lang, tz) {
        return utc ? t.getUTCDay() : t.getDay()
    }, // 0..6 == sun..sat
    W: function(t, utc, lang, tz) {
        return zeropad(lib.weekOfYear(t, utc))
    },
    y: function(t, utc, lang, tz) {
        return zeropad(t.getYear() % 100);
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
        return "GMT" + (tz < 0 ? "+" : "-") + zeropad(Math.abs(-tz/60)) + "00";
    },
    zz: function(t, utc, lang, tz) {
        return _strftime.z(t, utc, lang, tz, 1);
    },
    z: function(t, utc, lang, tz, zz) {
        tz = tz ? tz/60000 : t.getTimezoneOffset();
        tz = "GMT" + (tz < 0 ? "+" : "-") + zeropad(Math.abs(-tz/60)) + "00";
        var dst = lib.isDST(t);
        for (const i in lib.tzMap) {
            if (tz == lib.tzMap[i][1] && (dst === lib.tzMap[i][2])) {
                return zz ? tz + " " + lib.tzMap[i][0] : lib.tzMap[i][0];
            }
        }
        return tz;
    },
    Q: function(t, utc, lang, tz) {
        var h = utc ? t.getUTCHours() : t.getHours();
        return h < 12 ? lib.__({ phrase: "Morning", locale: lang }) :
               h < 17 ? lib.__({ phrase: "Afternoon", locale: lang }) :
               lib.__({ phrase: "Evening", locale: lang }) },
    '%': function() { return '%' },
};

// Format date object
lib.strftime = function(date, fmt, options)
{
    date = this.toDate(date, null);
    if (!date) return "";
    var utc = options && options.utc;
    var lang = options && options.lang;
    var tz = options && typeof options.tz == "number" ? options.tz : 0;
    if (tz) date = new Date(date.getTime() - tz);
    fmt = fmt || this.strftimeFormat;
    for (const p in _strftime) {
        fmt = fmt.replace('%' + p, _strftime[p](date, utc, lang, tz));
    }
    return fmt;
}
