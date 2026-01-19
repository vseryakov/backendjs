/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const lib = require(__dirname + '/../lib');
const util = require("util");

/**
 * Return object type, try to detect any distinguished type
 * @param {any} value
 * @return {string} detected Javascript type name
 * @memberof module:lib
 * @method typeName
 */
lib.typeName = function(value)
{
    if (value === null) return "null";
    const t = typeof value;
    if (t === "object") {
        switch (value.constructor?.name) {
        case "Error":
        case "TypeError":
        case "RangeError":
        case "SystemError":
        case "SyntaxError":
        case "ReferenceError":
            return "error";
        case "Array":
        case "Buffer":
        case "Date":
        case "RegExp":
        case "Set":
        case "Map":
        case "WeakMap":
            return value.constructor.name.toLowerCase();
        }
    }
    return t;
}

/**
 * Detect type from the value
 * @param {any} val
 * @return {string} detected library type name
 * @memberof module:lib
 * @method autoType
 */
lib.autoType = function(val)
{
    return this.isNumeric(val) ? "number":
           typeof val == "boolean" || val == "true" || val == "false" ? "bool":
           typeof val == "string" ?
           val[0] == "^" && val.slice(-1) == "$" ? "regexp":
           val[0] == "[" && val.slice(-1) == "]" ? "js":
           val[0] == "{" && val.slice(-1) == "}" ? "js":
           val[0] == "," || val.endsWith(",") ? "list" :
           val.includes("|") && !/[()[\]^$]/.test(val) ? "list": "" : "";
}

/**
 * @param {any} val
 * @return {object|undefined} itself if a regular object and not null
 * @memberof module:lib
 * @method isObject
 */
lib.isObject = function(val)
{
    return this.typeName(val) === "object" && val || undefined;
}

/**
 * @param {any} val
 * @return {number|NaN} itself if the value is a number and not equal 0
 * @memberof module:lib
 * @method isNumber
 */
lib.isNumber = function(val)
{
    return typeof val === "number" && !Number.isNaN(val) ? val : NaN;
}

/**
 * @param {string} val
 * @return {string} the string value or empty string if not a string
 * @memberof module:lib
 * @method isString
 */
lib.isString = function(val)
{
    return typeof val == "string" ? val : "";
}

/**
 * @param {string} func
 * @return {function|undefined} the function itself or undefined if not a function
 * @memberof module:lib
 * @method isFunc
 */
lib.isFunc = function(func)
{
    return typeof func == "function" && func || undefined;
}

/**
 * @param {any} val
 * @param {string} prefix
 * @return {boolean} true if the value is prefixed
 * @memberof module:lib
 * @method isPrefix
 */
lib.isPrefix = function(val, prefix)
{
    return typeof prefix == "string" && prefix &&
           typeof val == "string" && val.substr(0, prefix.length) == prefix;
}

/**
 * @param {any} str
 * @return {string|undefined} the value represents an UUID
 * @memberof module:lib
 * @method isUuid
 */
lib.isUuid = function(str, prefix)
{
    if (this.rxUuid.test(str)) {
        if (typeof prefix == "string" && prefix) {
            if (!str.startsWith(prefix)) return;
        }
        return str;
    }
}

/**
 * @param {string} str
 * @return {string|undefined} the string iself if contains Unicode characters
 * @memberof module:lib
 * @method isUnicode
 */
lib.isUnicode = function(str)
{
    return /[\u007F-\uFFFF]/g.test(str) ? str : undefined;
}

/**
 * @param {any} val
 * @return {boolean} true if a number is positive, i.e. greater than zero
 * @memberof module:lib
 * @method isPositive
 */
lib.isPositive = function(val)
{
    return this.isNumber(val) > 0;
}

/**
 * @param {any[]} val
 * @param {any} dflt
 * @return {any[]|undefined} the array if the value is non empty array or dflt value if given or undefined
 * @memberof module:lib
 * @method isArray
 */
lib.isArray = function(val, dflt)
{
    return Array.isArray(val) && val.length ? val : dflt;
}

/**
 * @param {any} val
 * @return {boolean} true of the given value considered empty
 * @memberof module:lib
 * @method isEmpty
 */
lib.isEmpty = function(val)
{
    switch (this.typeName(val)) {
    case "null":
    case "undefined":
        return true;
    case "buffer":
    case "array":
        return val.length === 0;
    case "set":
    case "map":
        return val.size === 0;
    case "number":
    case "date":
        return Number.isNaN(val);
    case "regexp":
    case "boolean":
    case "function":
        return false;
    case "object":
        for (const p in val) return false;
        return true;
    case "string":
        return this.rxEmpty.test(val) ? true : false;
    default:
        return val ? false: true;
    }
}

/**
 * @param {any} val
 * Return {boolean} true if the value is a number or string representing a number
 * @memberof module:lib
 * @method isNumeric
 */
lib.isNumeric = function(val)
{
    if (typeof val == "number") return true;
    if (typeof val != "string") return false;
    return this.rxNumber.test(val);
}

/**
 * @param {any} val
 * @return {boolean} true if the given date is valid
 * @memberof module:lib
 * @method isDate
 */
lib.isDate = function(val)
{
    return util.types.isDate(val) && !Number.isNaN(val.getTime());
}

/**
 * @param {any[]} list
 * @param {any|any[]} item
 * @return {boolean} true if `item` exists in the array `list`, search is case sensitive. if `item` is an array it will return true if
 * any element in the array exists in the `list`.
 * @memberof module:lib
 * @method isFlag
 */
lib.isFlag = function(list, item)
{
    return Array.isArray(list) && (Array.isArray(item) ? item.some((x) => (list.includes(x))) : item && list.includes(item));
}

/**
 * Evaluate an expr, compare 2 values with optional type and operation, compare a data value `val`` against a condtion `cond`.
 * @param {any} val
 * @param {object} condition
 * @param {string} [op]
 * @param {string} [type]
 * @return {boolean} true if equal
 * @memberof module:lib
 * @method isTrue
 */
lib.isTrue = function(val, cond, op, type)
{
    if (val === undefined && cond === undefined) return true;
    if (val === null && cond === null) return true;

    op = typeof op == "string" && op.toLowerCase() || "";
    var no = false, yes = true, v1, list2;
    if (op[0] == "n" && op[1] == "o" && op[2] == "t") no = true, yes = false;

    switch (op) {
    case "null":
        if (val) return no;
        break;

    case "not null":
    case "not_null":
        if (val) return no;
        break;

    case ">":
    case "gt":
        if (this.toValue(val, type) <= this.toValue(cond, type)) return no;
        break;

    case "<":
    case "lt":
        if (this.toValue(val, type) >= this.toValue(cond, type)) return no;
        break;

    case ">=":
    case "ge":
        if (this.toValue(val, type) < this.toValue(cond, type)) return no;
        break;

    case "<=":
    case "le":
        if (this.toValue(val, type) > this.toValue(cond, type)) return no;
        break;

    case "between":
        // If we cannot parse out 2 values, treat this as exact operator
        list2 = this.split(cond);
        if (list2.length > 1) {
            if (this.toValue(val, type) < this.toValue(list2[0], type) || this.toValue(val, type) > this.toValue(list2[1], type)) return no;
        } else {
            if (this.toValue(val, type) != this.toValue(cond, type)) return no;
        }
        break;

    case "in":
    case "not_in":
    case "not in":
        if (!lib.isFlag(this.split(cond, null, { datatype: type }), this.split(val, null, { datatype: type }))) return no;
        break;

    case "all_in":
    case "all in":
        list2 = this.split(cond, null, { datatype: type });
        if (!this.split(val, null, { datatype: type }).every((x) => (list2.includes(x)))) return no;
        break;

    case 'like%':
    case "not like%":
    case 'begins_with':
    case 'not begins_with':
        v1 = this.toValue(val);
        if (this.toValue(cond).substr(0, v1.length) != v1) return no;
        break;

    case "ilike%":
    case "not ilike%":
        v1 = this.toValue(val).toLowerCase();
        if (this.toValue(cond).substr(0, v1.length).toLowerCase() != v1) return no;
        break;

    case "ilike":
    case "not ilike":
        if (this.toValue(val).toLowerCase() != this.toValue(cond).toLowerCase()) return no;
        break;

    case "!~":
    case "!~*":
    case "iregexp":
    case "not iregexp":
        if (!util.types.isRegExp(cond)) cond = this.toRegexp(cond, "i");
        if (!cond || !cond.test(val)) return no;
        break;

    case "~":
    case "~*":
    case "regexp":
    case "not regexp":
        if (!util.types.isRegExp(cond)) cond = this.toRegexp(cond);
        if (!cond || !cond.test(val)) return no;
        break;

    case "contains":
    case "not contains":
    case "not_contains":
        if (!this.toValue(cond).indexOf(this.toValue(val)) > -1) return no;
        break;

    case "!=":
    case "<>":
    case "ne":
        if (this.toValue(val, type) == this.toValue(cond, type)) return no;
        break;

    default:
        if (type == "list") {
            if (!this.isFlag(this.split(cond), this.split(val))) return no;
        } else
        if (Array.isArray(cond)) {
            if (!this.isFlag(cond, val)) return no;
        } else
        if (Array.isArray(val)) {
            if (!this.isFlag(val, cond)) return no;
        } else
        if (util.types.isRegExp(cond)) {
            if (!cond.test(val)) return no;
        } else
        if (this.toValue(val, type) != this.toValue(cond, type)) {
            return no;
        }
    }
    return yes;
}

/**
 * @param {string} text
 * @param {int} start
 * @param {int} end
 * @param {string} [delimiters] define a character set to be used for words boundaries, if not given or empty string the default will be used
 * @return {boolean} true if it is a word at the position `start` and `end` in the `text` string,
 * @memberof module:lib
 * @method isWord
 */
lib.isWord = function(text, start, end, delimiters)
{
    if (typeof text != "string") return false;
    delimiters = typeof delimiters == "string" && delimiters || this.wordBoundaries;
    if (start <= 0 || delimiters.includes(text[start - 1])) {
        if (end + 1 >= text.length || delimiters.includes(text[end + 1])) {
            return true;
        }
    }
    return false;
}

/**
 * Returns a score between 0 and 1 for two strings, 0 means no similarity, 1 means exactly similar.
 * The default algorithm is JaroWrinkler, options.type can be used to specify a different algorithm:
 * - sd - Sorensent Dice
 * - cs - Cosine Similarity
 * @memberof module:lib
 * @method isSimilar
 */
lib.isSimilar = function(s1, s2, options)
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

/**
 * @param {...any} args
 * @return {number} first valid number from the list of arguments or 0
 * @memberof module:lib
 * @method isValidNum
 */
lib.validNum = function(...args)
{
    for (const i in args) {
        if (this.isNumber(args[i])) return args[i];
    }
    return 0;
}

/**
 * @param {...any} args
 * @return {number} first valid positive number from the list of arguments or 0
 * @memberof module:lib
 * @method isValidPositive
 */
lib.validPositive = function(...args)
{
    for (const i in args) {
        if (this.isPositive(args[i])) return args[i];
    }
    return 0;
}

/**
 * @param {...any} args
 * @return {boolean} first valid boolean from the list of arguments or false
 * @memberof module:lib
 * @method isValidBool
 */
lib.validBool = function(...args)
{
    for (const i in args) {
        if (typeof args[i] == "boolean") return args[i];
    }
    return false;
}

/**
 * @param {string} version
 * @param {string} [condition] - can be: >=M.N, >M.N, =M.N, <=M.N, <M.N, M.N-M.N
 * @eturn {boolean} true if the version is within given condition(s), always true if either argument is empty.
 * @memberof module:lib
 * @method isValidVersion
 */
lib.validVersion = function(version, condition)
{
    if (!version || !condition) return true;
    version = typeof version == "number" ? version : lib.toVersion(version);
    condition = lib.split(condition);
    if (!condition.length) return true;
    return condition.some((x) => {
        const d = x.match(this.rxVersion);
        if (!d) return false;
        return d[3] ? lib.isTrue(version, [lib.toVersion(d[3]), lib.toVersion(d[4])], "between", "number") :
                      lib.isTrue(version, lib.toVersion(d[2]), d[1] || ">=", "number");
    });
}
