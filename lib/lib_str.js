//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const lib = require(__dirname + '/lib');

lib.isUnicode = function(str)
{
    return /[\u007F-\uFFFF]/g.test(str);
}

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
    case "uri":
        return this._strCompress(data, 6, function(a) { return lib.uriSafe.charAt(a) });
    case "uint8":
        data = this._strCompress(data, 16, String.fromCharCode);
        var buf = new Uint8Array(data.length * 2);
        for (var i = 0, len = data.length; i < len; i++) {
            var v = data.charCodeAt(i);
            buf[i*2] = v >>> 8;
            buf[i*2+1] = v % 256;
        }
        return buf;
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
        if (!this.base64Dict.A) for (let i = 0 ;i < this.base64.length; i++) this.base64Dict[this.base64.charAt(i)] = i;
        return this._strDecompress(data.length, 32, function(index) { return lib.base64Dict[data.charAt(index)] });
    case "uri":
        if (!this.uriSafeDict.A) for (let i = 0 ;i < this.uriSafe.length; i++) this.uriSafeDict[this.uriSafe.charAt(i)] = i;
        data = data.replace(/ /g, "+");
        return this._strDecompress(data.length, 32, function(index) { return lib.uriSafeDict[data.charAt(index)] });
    case "utf16":
        return this._strDecompress(data.length, 16384, function(index) { return data.charCodeAt(index) - 32; });
    case "uint8":
        var buf = new Array(data.length/2);
        for (let i = 0, len = buf.length; i < len; i++) buf[i] = data[i*2]*256 + data[i*2+1];
        data = buf.map(function(c) { return String.fromCharCode(c) }).join('');
    default:
        return this._strDecompress(data.length, 32768, function(index) { return data.charCodeAt(index); });
    }
}

lib._strCompress = function(data, bitsPerChar, getCharFromInt)
{
    if (data == null || data === "") return "";
    var i, ii, value, context_dictionary = {}, context_dictionaryToCreate = {};
    var context_c = "", context_wc = "", context_w = "", context_enlargeIn = 2;
    var context_dictSize = 3, context_numBits = 2, context_data = [], context_data_val = 0, context_data_position = 0;

    for (ii = 0; ii < data.length; ii += 1) {
        context_c = data.charAt(ii);
        if (!Object.prototype.hasOwnProperty.call(context_dictionary,context_c)) {
            context_dictionary[context_c] = context_dictSize++;
            context_dictionaryToCreate[context_c] = true;
        }
        context_wc = context_w + context_c;
        if (Object.prototype.hasOwnProperty.call(context_dictionary,context_wc)) {
            context_w = context_wc;
        } else {
            if (Object.prototype.hasOwnProperty.call(context_dictionaryToCreate,context_w)) {
                if (context_w.charCodeAt(0)<256) {
                    for (i = 0 ; i<context_numBits ; i++) {
                        context_data_val = (context_data_val << 1);
                        if (context_data_position == bitsPerChar-1) {
                            context_data_position = 0;
                            context_data.push(getCharFromInt(context_data_val));
                            context_data_val = 0;
                        } else {
                            context_data_position++;
                        }
                    }
                    value = context_w.charCodeAt(0);
                    for (i = 0 ; i<8 ; i++) {
                        context_data_val = (context_data_val << 1) | (value&1);
                        if (context_data_position == bitsPerChar-1) {
                            context_data_position = 0;
                            context_data.push(getCharFromInt(context_data_val));
                            context_data_val = 0;
                        } else {
                            context_data_position++;
                        }
                        value = value >> 1;
                    }
                } else {
                    value = 1;
                    for (i = 0 ; i<context_numBits ; i++) {
                        context_data_val = (context_data_val << 1) | value;
                        if (context_data_position ==bitsPerChar-1) {
                            context_data_position = 0;
                            context_data.push(getCharFromInt(context_data_val));
                            context_data_val = 0;
                        } else {
                            context_data_position++;
                        }
                        value = 0;
                    }
                    value = context_w.charCodeAt(0);
                    for (i = 0 ; i<16 ; i++) {
                        context_data_val = (context_data_val << 1) | (value&1);
                        if (context_data_position == bitsPerChar-1) {
                            context_data_position = 0;
                            context_data.push(getCharFromInt(context_data_val));
                            context_data_val = 0;
                        } else {
                            context_data_position++;
                        }
                        value = value >> 1;
                    }
                }
                context_enlargeIn--;
                if (context_enlargeIn == 0) {
                    context_enlargeIn = Math.pow(2, context_numBits);
                    context_numBits++;
                }
                delete context_dictionaryToCreate[context_w];
            } else {
                value = context_dictionary[context_w];
                for (i = 0 ; i<context_numBits ; i++) {
                    context_data_val = (context_data_val << 1) | (value&1);
                    if (context_data_position == bitsPerChar-1) {
                        context_data_position = 0;
                        context_data.push(getCharFromInt(context_data_val));
                        context_data_val = 0;
                    } else {
                        context_data_position++;
                    }
                    value = value >> 1;
                }
            }
            context_enlargeIn--;
            if (context_enlargeIn == 0) {
                context_enlargeIn = Math.pow(2, context_numBits);
                context_numBits++;
            }
            context_dictionary[context_wc] = context_dictSize++;
            context_w = String(context_c);
        }
    }
    if (context_w !== "") {
        if (Object.prototype.hasOwnProperty.call(context_dictionaryToCreate,context_w)) {
            if (context_w.charCodeAt(0)<256) {
                for (i = 0 ; i<context_numBits ; i++) {
                    context_data_val = (context_data_val << 1);
                    if (context_data_position == bitsPerChar-1) {
                        context_data_position = 0;
                        context_data.push(getCharFromInt(context_data_val));
                        context_data_val = 0;
                    } else {
                        context_data_position++;
                    }
                }
                value = context_w.charCodeAt(0);
                for (i = 0 ; i<8 ; i++) {
                    context_data_val = (context_data_val << 1) | (value&1);
                    if (context_data_position == bitsPerChar-1) {
                        context_data_position = 0;
                        context_data.push(getCharFromInt(context_data_val));
                        context_data_val = 0;
                    } else {
                        context_data_position++;
                    }
                    value = value >> 1;
                }
            } else {
                value = 1;
                for (i = 0 ; i<context_numBits ; i++) {
                    context_data_val = (context_data_val << 1) | value;
                    if (context_data_position == bitsPerChar-1) {
                        context_data_position = 0;
                        context_data.push(getCharFromInt(context_data_val));
                        context_data_val = 0;
                    } else {
                        context_data_position++;
                    }
                    value = 0;
                }
                value = context_w.charCodeAt(0);
                for (i = 0 ; i<16 ; i++) {
                    context_data_val = (context_data_val << 1) | (value&1);
                    if (context_data_position == bitsPerChar-1) {
                        context_data_position = 0;
                        context_data.push(getCharFromInt(context_data_val));
                        context_data_val = 0;
                    } else {
                        context_data_position++;
                    }
                    value = value >> 1;
                }
            }
            context_enlargeIn--;
            if (context_enlargeIn == 0) {
                context_enlargeIn = Math.pow(2, context_numBits);
                context_numBits++;
            }
            delete context_dictionaryToCreate[context_w];
        } else {
            value = context_dictionary[context_w];
            for (i = 0 ; i<context_numBits ; i++) {
                context_data_val = (context_data_val << 1) | (value&1);
                if (context_data_position == bitsPerChar-1) {
                    context_data_position = 0;
                    context_data.push(getCharFromInt(context_data_val));
                    context_data_val = 0;
                } else {
                    context_data_position++;
                }
                value = value >> 1;
            }
        }
        context_enlargeIn--;
        if (context_enlargeIn == 0) {
            context_enlargeIn = Math.pow(2, context_numBits);
            context_numBits++;
        }
    }
    value = 2;
    for (i = 0 ; i<context_numBits ; i++) {
        context_data_val = (context_data_val << 1) | (value&1);
        if (context_data_position == bitsPerChar-1) {
            context_data_position = 0;
            context_data.push(getCharFromInt(context_data_val));
            context_data_val = 0;
        } else {
            context_data_position++;
        }
        value = value >> 1;
    }
    while (true) {
        context_data_val = (context_data_val << 1);
        if (context_data_position == bitsPerChar-1) {
            context_data.push(getCharFromInt(context_data_val));
            break;
        }
        else context_data_position++;
    }
    return context_data.join('');
}

lib._strDecompress = function(length, resetValue, getNextValue)
{
    var dictionary = [], enlargeIn = 4, dictSize = 4, numBits = 3, entry = "", result = [];
    var i, w, c, resb;
    var data = { val: getNextValue(0), position: resetValue, index: 1 };

    var bits = 0, maxpower = Math.pow(2,2), power = 1
    for (i = 0; i < 3; i += 1) dictionary[i] = i;
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
    dictionary[3] = c;
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

            dictionary[dictSize++] = String.fromCharCode(bits);
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
            dictionary[dictSize++] = String.fromCharCode(bits);
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
        if (dictionary[c]) {
            entry = dictionary[c];
        } else {
            if (c === dictSize) {
                entry = w + w.charAt(0);
            } else {
                return null;
            }
        }
        result.push(entry);
        dictionary[dictSize++] = w + entry.charAt(0);
        enlargeIn--;
        w = entry;
        if (enlargeIn == 0) {
            enlargeIn = Math.pow(2, numBits);
            numBits++;
        }
    }
}

// LZW Compression/Decompression for Strings, does not handle UTF-8/16
// Based on https://gist.github.com/fliptopbox/6990878
lib.strQuickCompress = function(str, raw)
{
    var i, c, wc, w = "", dict = {}, dsize = 256;
    var rc = raw ? [] : '';

    for (i = 0; i < 256; i++) dict[String.fromCharCode(i)] = i;

    for (i = 0; i < str.length; i++) {
        c = str.charAt(i);
        wc = w + c;
        if (dict.hasOwnProperty(wc)) {
            w = wc;
        } else {
            if (Array.isArray(rc)) rc.push(dict[w]); else rc += String.fromCharCode(dict[w]);
            dict[wc] = dsize++;
            w = String(c);
        }
    }
    if (w !== "") {
        if (Array.isArray(rc)) rc.push(dict[w]); else rc += String.fromCharCode(dict[w]);
    }
    return rc;
};

lib.strQuickDecompress = function(str)
{
    var i, rc, w, wc = "", dict = [], dsize = 256;

    if (str && typeof str === 'string') {
        var tmp = [];
        for (i = 0; i < str.length; i++) tmp.push(str[i].charCodeAt(0));
        str = tmp;
    } else
    if (!Array.isArray(str)) return "";

    for (i = 0; i < 256; i++) dict[i] = String.fromCharCode(i);

    rc = w = String.fromCharCode(str[0]);
    for (i = 1; i < str.length; i++) {
        wc = dict[str[i]];
        if (!wc) {
            if (str[i] !== dsize) return "";
            wc = w + w.charAt(0);
        }
        rc += wc;
        dict[dsize++] = w + wc.charAt(0);
        w = wc;
    }
    return rc;
};

