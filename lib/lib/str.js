//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const util = require('util');
const lib = require(__dirname + '/../lib');

lib.whitespace = " \r\n\t\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u202F\u205F\u3000\u008D\u009F\u0080\u0090\u009B\u0010\u0009\u0000\u0003\u0004\u0017\u0019\u0011\u0012\u0013\u0014\u2028\u2029\u2060\u202C";

// Perform match on a regexp for a string and returns matched value, if no index is specified returns item 1,
// using index 0 returns the whole matched string, -1 means to return the whole matched array
// If the `rx`` object has the 'g' flag the result will be all matches in an array.
lib.matchRegexp = function(str, rx, index)
{
    if (typeof str != "string" || !rx || !util.isRegExp(rx)) return null;
    var d = str.match(rx);
    return d ? index < 0 || /g/.test(rx.flags) ? d : d[typeof index == "number" ? index : 1] : null;
}

// Perform match on a regexp and return all matches in an array, if no index is specified returns item 1
lib.matchAllRegexp = function(str, rx, index)
{
    if (typeof str != "string" || !rx || !util.isRegExp(rx)) return [];
    var d, rc = [];
    while ((d = rx.exec(str)) !== null) {
        rc.push(d[typeof index == "number" ? index : 1]);
    }
    return rc;
}

// Perform test on a regexp for a string and returns true only if matched.
lib.testRegexp = function(str, rx)
{
    return util.isRegExp(rx) ? rx.test(str) : false;
}

// Run test on a regexpObj
lib.testRegexpObj = function(str, rx)
{
    return util.isRegExp(rx?.rx) ? rx.rx.test(str) : false;
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
// - `options` is an object with the same properties as for the `toParams`,
//    - `datatype' will be used with `lib.toValue` to convert the value for each item
//    - `keepempty` - will preserve empty items, by default empty strings are ignored
//    - `notrim` - will skip trimming strings, trim is the default
//    - `max` - will skip strings over the specificed size if no `trunc`
//    - `trunc` - will truncate strings longer than `max`
//    - `regexp` - will skip string not matching
//
// If `str` is an array and type is not specified then all non-string items will be returned as is.
lib.strSplit = function(str, sep, options)
{
    if (!str) return [];
    options = options || lib.empty;
    var list = (Array.isArray(str) ? str : (typeof str == "string" ? str : String(str)).split(sep || this.rxSplit)), len = list.length;
    if (!len) return list;

    var rc = [], keys = Object.keys(options), v;
    for (let i = 0; i < len; ++i) {
        v = list[i];
        if (v === "" && !options.keepempty) continue;
        if (options.datatype) v = lib.toValue(v, options.datatype, options);
        if (typeof v != "string") {
            rc.push(v);
            continue;
        }
        if (!options.notrim) v = v.trim();

        for (let k = 0; k < keys.length; ++k) {
            switch (keys[k]) {
            case "max":
                if (v.length > options.max) {
                    v = options.trunc ? v.substr(0, options.max) : "";
                }
                break;
            case "regexp":
                if (!options.regexp.test(v)) v = "";
                break;
            case "lower":
                v = v.toLowerCase();
                break;
            case "upper":
                v = v.toUpperCase();
                break;
            case "strip":
                v = v.replace(options.strip, "");
                break;
            case "camel":
                v = lib.toCamel(v, options);
                break;
            case "cap":
                v = lib.toTitle(v);
                break;
            }
        }
        if (!v.length && !options.keepempty) continue;
        rc.push(v);
    }
    return rc;
}

// Split as above but keep only unique items, case-insensitive
lib.strSplitUnique = function(str, sep, options)
{
    var rc = [];
    var typed = options && options.datatype != "undefined";
    this.strSplit(str, sep, options).forEach((x) => {
        if (!rc.some((y) => (typed || !(typeof x == "string" && typeof y == "string") ? x == y : x.toLowerCase() == y.toLowerCase()))) rc.push(x);
    });
    return rc;
}

// Split a string into phrases separated by `options.separator` character(s) and surrounded by characters in `options.quotes`.
// The default separator is space and default quotes are both double and single quote.
// If `options.keepempty` is given all empty parts will be kept in the list.
lib.phraseSplit = function(str, options)
{
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

// Returns a score between 0 and 1 for two strings, 0 means no similarity, 1 means exactly similar.
// The default algorithm is JaroWrinkler, options.type can be used to specify a different algorithm:
// - sd - Sorensent Dice
// - cs - Cosine Similarity
lib.strSimilarity = function(s1, s2, options)
{
    if (!s1 || !s2 || !s1.length || !s2.length) return 0;
    if (s1 === s2) return 1;

    function SorensentDice(s1, s2) {
        function getBigrams(str) {
            var bigrams = [];
            var strLength = str.length;
            for (var i = 0; i < strLength; i++) bigrams.push(str.substr(i, 2));
            return bigrams;
        }
        var l1 = s1.length-1, l2 = s2.length-1, intersection = 0;
        if (l1 < 1 || l2 < 1) return 0;
        var b1 = getBigrams(s1), b2 = getBigrams(s2);
        for (let i = 0; i < l1; i++) {
            for (let j = 0; j < l2; j++) {
                if (b1[i] == b2[j]) {
                    intersection++;
                    b2[j] = null;
                    break;
                }
            }
        }
        return (2.0 * intersection) / (l1 + l2);
    }

    function CosineSimularity(s1, s2) {
        function vecMagnitude(vec) {
            var sum = 0;
            for (var i = 0; i < vec.length; i++) sum += vec[i] * vec[i];
            return Math.sqrt(sum);
        }
        var dict = {}, v1 = [], v2 = [], product = 0;
        var f1 = s1.split(" ").reduce(function(a, b) { a[b] = (a[b] || 0) + 1; return a }, {});
        var f2 = s2.split(" ").reduce(function(a, b) { a[b] = (a[b] || 0) + 1; return a }, {});
        for (const key in f1) dict[key] = true;
        for (const key in f2) dict[key] = true;
        for (const term in dict) {
            v1.push(f1[term] || 0);
            v2.push(f2[term] || 0);
        }
        for (let i = 0; i < v1.length; i++) product += v1[i] * v2[i];
        return product / (vecMagnitude(v1) * vecMagnitude(v2));
    }

    function JaroWrinker(s1, s2) {
        var i, j, m = 0, k = 0, n = 0, l = 0, p = 0.1;
        var range = (Math.floor(Math.max(s1.length, s2.length) / 2)) - 1;
        var m1 = new Array(s1.length), m2 = new Array(s2.length);

        for (i = 0; i < s1.length; i++) {
            var low = (i >= range) ? i - range : 0;
            var high = (i + range <= s2.length) ? (i + range) : (s2.length - 1);

            for (j = low; j <= high; j++) {
                if (!m1[i] && !m2[j] && s1[i] === s2[j]) {
                    m1[i] = m2[j] = true;
                    m++;
                    break;
                }
            }
        }
        if (!m) return 0;
        for (i = 0; i < s1.length; i++) {
            if (m1[i]) {
                for (j = k; j < s2.length; j++) {
                    if (m2[j]) {
                        k = j + 1;
                        break;
                    }
                }
                if (s1[i] !== s2[j]) n++;
            }
        }
        var weight = (m / s1.length + m / s2.length + (m - (n / 2)) / m) / 3;
        if (weight > 0.7) {
            while (s1[l] === s2[l] && l < 4) ++l;
            weight = weight + l * p * (1 - weight);
        }
        return weight;
    }
    switch (options && options.type) {
    case "sd":
        return SorensentDice(s1, s2);
    case "cs":
        return CosineSimularity(s1, s2);
    default:
        return JaroWrinker(s1, s2);
    }
}
