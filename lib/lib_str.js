//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const util = require('util');
const bkutils = require('bkjs-utils');
const lib = require(__dirname + '/lib');

// Perform match on a regexp for a string and returns matched value, if no index is specified returns item 1,
// this is a simple case for oneshot match and only single matched element.
// If the `rx`` object has the 'g' flag the result will be all matches in an array.
lib.matchRegexp = function(str, rx, index)
{
    if (typeof str != "string" || !rx || !util.isRegExp(rx)) return null;
    var d = str.match(rx);
    return d ? /g/.test(rx.flags) ? d : d[index || 1] : null;
}

// Perform match on a regexp and return all matches in an array, if no index is specified returns item 1
lib.matchAllRegexp = function(str, rx, index)
{
    if (typeof str != "string" || !rx || !util.isRegExp(rx)) return [];
    var d, rc = [];
    while ((d = rx.exec(str)) !== null) {
        rc.push(d[index || 1]);
    }
    return rc;
}

// Perform test on a regexp for a string and returns true only if matched.
lib.testRegexp = function(str, rx)
{
    return rx && util.isRegExp(rx) ? rx.test(str) : false;
}

// Run test on a regexpObj
lib.testRegexpObj = function(str, rx)
{
    return rx && util.isRegExp(rx.rx) ? rx.rx.test(str) : false;
}

// Safe version of replace for strings, always returns a string, if `val` is not provided performs
// removal of the matched patterns
lib.replaceRegexp = function(str, rx, val)
{
    if (typeof str != "string") return "";
    if (!util.isRegExp(rx)) return str;
    return str.replace(rx, val || "");
}

// Remove all whitespace from the begining and end of the given string, if an array with characters is not given then it trims all whitespace
lib.strTrim = function(str, chars)
{
    if (typeof str != "string" || !str) return "";
    var rx;
    if (typeof chars == "string" && chars) {
        rx = new RegExp("(^[" + chars + "]+)|([" + chars + "]+$)", "gi");
    } else {
        if (!this._whitespace) {
            this._whitespace = new RegExp("(^[" + this.whitespace + "]+)|([" + this.whitespace + "]+$)", "gi");
        }
        rx = this._whitespace;
    }
    return str.replace(rx, "");
}

// Split string into array, ignore empty items,
// - `sep` is an RegExp to use as a separator instead of default  pattern `[,\|]`,
// - `options` is an object with the same properties as for the `toParams`, `datatype' will be used with
//   `lib.toValue` to convert the value for each item
//
// If `str` is an array and type is not specified then all non-string items will be returned as is.
lib.strSplit = function(str, sep, options)
{
    if (!str) return [];
    options = options || this.empty;
    return (Array.isArray(str) ? str : String(str).split(sep || this.rxSplit)).
            map(function(x) {
                x = options.datatype ? lib.toValue(x, options.datatype) : typeof x == "string" ? x.trim() : x;
                if (typeof x == "string") {
                    if (options.regexp && !options.regexp.test(x)) return "";
                    if (options.lower) x = x.toLowerCase();
                    if (options.upper) x = x.toUpperCase();
                    if (options.strip) x = x.replace(options.strip, "");
                    if (options.camel) x = lib.toCamel(x, options);
                    if (options.cap) x = lib.toTitle(x);
                    if (options.trunc > 0) x = x.substr(0, options.trunc);
                }
                return x;
            }).
            filter(function(x) { return typeof x == "string" ? x.length : 1 });
}

// Split as above but keep only unique items, case-insensitive
lib.strSplitUnique = function(str, sep, options)
{
    var rc = [];
    var typed = options && options.datatype != "undefined";
    this.strSplit(str, sep, options).forEach(function(x) {
        if (!rc.some(function(y) {
            return typed || !(typeof x == "string" && typeof y == "string") ? x == y : x.toLowerCase() == y.toLowerCase()
        })) rc.push(x);
    });
    return rc;
}

// Split a string into phrases separated by `options.separator` character(s) and surrounded by characters in `options.quotes`. The default separator is space and
// default quotes are both double and single quote. If `options.keepempty` is given all empty parts will be kept in the list.
lib.phraseSplit = function(str, options)
{
    return bkutils.strSplit(str, options && options.separator || " ", options && options.quotes || '"\'', options && options.keepempty ? true : false);
}

// Return a string with leading zeros
lib.zeropad = function(n, width)
{
    var pad = "";
    while (pad.length < width - 1 && n < Math.pow(10, width - pad.length - 1)) pad += "0";
    return pad + String(n);
}

// C-sprintf alike
// based on http://stackoverflow.com/a/13439711
// Usage:
//  - sprintf(fmt, arg, ...)
//  - sprintf(fmt, [arg, ...]);
lib.sprintf = function(fmt, args)
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
        case 's': val = arr[i];
            break;
        case 'c': val = arr[i][0];
            break;
        case 'f': val = parseFloat(arr[i]).toFixed(exp);
            break;
        case 'p': val = parseFloat(arr[i]).toPrecision(exp);
            break;
        case 'e': val = parseFloat(arr[i]).toExponential(exp);
            break;
        case 'x': val = parseInt(arr[i]).toString(base ? base : 16);
            break;
        case 'd': val = parseFloat(parseInt(arr[i], base ? base : 10).toPrecision(exp)).toFixed(0);
            break;
        case 'z':
            return val;
        }
        val = typeof(val) == 'object' ? JSON.stringify(val) : val.toString(base);
        var sz = parseInt(p1); /* padding size */
        var ch = p1 && p1[0] == '0' ? '0' : ' '; /* isnull? */
        while (val.length < sz) val = p0 !== undefined ? val + ch : ch + val; /* isminus? */
        return val;
    }
    var regex = /%(-)?(0?[0-9]+)?([.][0-9]+)?([#][0-9]+)?([scfpexdz])/g;
    return String(fmt).replace(regex, format);
}

function zeropad(n) {
    return n > 9 ? n : '0' + n;
}

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
    H: function(t, utc, lang, tz) {
        return zeropad(utc ? t.getUTCHours() : t.getHours())
    },
    I: function(t, utc, lang, tz) {
        return zeropad((((utc ? t.getUTCHours() : t.getHours()) + 12) % 12) || 12)
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
        return (utc ? t.getUTCHours() : t.getHours()) < 12 ? 'AM' : 'PM';
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

// From https://github.com/pieroxy/lz-string/
lib.strCompress = function(data, encoding)
{
    switch (encoding) {
    case "base64":
        var rc = this._strCompress(data, 6, function(a) { return lib.base64.charAt(a) });
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

lib.strDecompress = function(data, encoding)
{
    if (data == null || data === "") return "";
    switch (encoding) {
    case "base64":
        if (!this.base64Dict.A) for (let i = 0; i < this.base64.length; i++) this.base64Dict[this.base64.charAt(i)] = i;
        return this._strDecompress(data.length, 32, function(index) { return lib.base64Dict[data.charAt(index)] });
    case "utf16":
        return this._strDecompress(data.length, 16384, function(index) { return data.charCodeAt(index) - 32; });
    default:
        return this._strDecompress(data.length, 32768, function(index) { return data.charCodeAt(index); });
    }
}

lib._strCompress = function(data, bitsPerChar, getCharFromInt)
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

lib._strDecompress = function(length, resetValue, getNextValue)
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
