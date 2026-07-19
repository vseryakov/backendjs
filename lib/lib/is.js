/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
'use strict';

const lib = require(__dirname + '/../lib');
const util = require("node:util");

/**
 * Return object type, try to detect any distinguished type
 * @param {any} value
 * @return {string} detected Javascript type name
 * @memberof module:lib
 * @method typeName
 * @example
 * lib.typeName(null);
 * // => "null"
 *
 * lib.typeName([1, 2, 3]);
 * // => "array"
 *
 * lib.typeName(Buffer.from("test"));
 * // => "buffer"
 *
 * lib.typeName(new Error("boom"));
 * // => "error"
 *
 * lib.typeName({ id: 1 });
 * // => "object"
 */
lib.typeName = function(value)
{
    if (value === null) return "null";
    const t = typeof value;
    if (t === "object") {
        const cname = value.constructor?.name;
        switch (cname) {
        case "Error":
        case "TypeError":
        case "RangeError":
        case "SystemError":
        case "SyntaxError":
        case "ReferenceError":
        case "AggregateError":
        case "EvalError":
        case "URIError":
        case "InternalError":
            return "error";
        case "Array":
        case "Buffer":
        case "Date":
        case "RegExp":
        case "Set":
        case "Map":
        case "WeakMap":
            return cname.toLowerCase();
        }
        if (util.types.isNativeError(value)) return "error";
        if (util.types.isProxy(value)) return "proxy";
    }
    return t;
}

/**
 * Detect type from the value
 * - boolean: native or strings: boolean, true, false
 * - regexp: string inf the format: ^...$
 * - json: string in the format: [..] or {..}
 * - list: ends with , or contains |
 * @param {any} val
 * @return {string} detected library type name
 * @memberof module:lib
 * @method autoType
 * @example
 * lib.autoType("123");
 * // => "number"
 *
 * lib.autoType("true");
 * // => "bool"
 *
 * lib.autoType("^test$");
 * // => "regexp"
 *
 * lib.autoType('{"id":1}');
 * // => "js"
 *
 * lib.autoType("read|write|delete");
 * // => "list"
 */
lib.autoType = function(val)
{
    return this.isNumeric(val) ? "number":
           typeof val === "boolean" || val === "true" || val === "false" ? "bool":
           typeof val === "string" ?
           val[0] === "^" && val.slice(-1) === "$" ? "regexp":
           val[0] === "[" && val.slice(-1) === "]" ? "js":
           val[0] === "{" && val.slice(-1) === "}" ? "js":
           val[0] === "," || val.slice(-1) === "," ? "list" :
           val.includes("|") && !/[()[\]^$]/.test(val) ? "list": "" : "";
}

/**
 * @param {any[]} list
 * @param {any|any[]} item
 * @return {boolean} true if `item` exists in the array `list`, search is case sensitive. if `item` is an array it will return true if
 * any element in the array exists in the `list`.
 * @memberof module:lib
 * @method includes
 * @example
 * // Returns true when the item exists in the list
 * lib.includes(["read", "write", "delete"], "write");
 * // => true
 *
 * // Returns false when the item does not exist in the list
 * lib.includes(["read", "write", "delete"], "admin");
 * // => false
 *
 * // Search is case sensitive
 * lib.includes(["Read", "Write"], "read");
 * // => false
 *
 * // Returns true when any item from the array exists in the list
 * lib.includes(["read", "write", "delete"], ["admin", "write"]);
 * // => true
 *
 * // Returns false when none of the array items exist in the list
 * lib.includes(["read", "write", "delete"], ["admin", "owner"]);
 * // => false
 *
 * // Returns false when the first argument is not an array
 * lib.includes(null, "read");
 * // => false
 *
 * // Scalar falsy values are not matched
 * lib.includes([0, false, ""], 0);
 * // => false
 *
 * // Falsy values inside an item array can still be matched
 * lib.includes([0, false, ""], [0]);
 * // => true
 */
lib.includes = function(list, item)
{
    return Array.isArray(list) && (Array.isArray(item) ? item.some((x) => (list.includes(x))) : item && list.includes(item));
}

/**
 * Detect if the input is valid object and return it, while the function starts with `is` and may mean it returns a boolean
 * this way is more practival and does check and return in one call.
 * @param {any} val
 * @param {any} [dflt] - default value if not valid
 * @return {object|undefined} itself if a regular object and not null or undefined
 * @memberof module:lib
 * @method isObject
 * @example
 * lib.isObject({ id: 1 });
 * // => { id: 1 }
 *
 * lib.isObject(null);
 * // => undefined
 *
 * lib.isObject([1, 2, 3]);
 * // => undefined
 *
 * lib.isObject(new Date());
 * // => undefined
 */
lib.isObject = function(val, dflt)
{
    return this.typeName(val) === "object" && val || dflt;
}

/**
 * @param {any} val
 * @param {any} dflt=NaN - default value if not valid
 * @return {number|NaN} itself if the value is a valid number or NaN
 * @memberof module:lib
 * @method isNumber
 * @example
 * lib.isNumber(123);
 * // => 123
 *
 * lib.isNumber(0);
 * // => 0
 *
 * Number.isNaN(lib.isNumber("123"));
 * // => true
 *
 * Number.isNaN(lib.isNumber(NaN));
 * // => true
 */
lib.isNumber = function(val, dflt = Number.NaN)
{
    return typeof val === "number" && !Number.isNaN(val) ? val : dflt;
}

/**
 * @param {string} val
 * @param {any} [dflt=""] - default value if not valid
 * @return {string|any} the string value or empty string if not a string
 * @memberof module:lib
 * @method isString
 * @example
 * lib.isString("hello");
 * // => "hello"
 *
 * lib.isString("");
 * // => ""
 *
 * lib.isString(123);
 * // => ""
 *
 * lib.isString(null);
 * // => ""
 */
lib.isString = function(val, dflt = "")
{
    return typeof val === "string" ? val : dflt;
}

/**
 * @param {string} func
 * @param {any} [dflt] - default value if not valid function
 * @return {function|undefined} the function itself or undefined if not a function
 * @memberof module:lib
 * @method isFunc
 * @example
 * function test() {}
 * lib.isFunc(test);
 * // => test
 *
 * lib.isFunc(() => true);
 * // => [Function]
 *
 * lib.isFunc("test");
 * // => undefined
 *
 * lib.isFunc(null);
 * // => undefined
 */
lib.isFunc = function(func, dflt)
{
    return typeof func === "function" && func || dflt;
}

/**
 * @param {RegExp} rx
 * @param {any} [dflt] - default value if not valid
 * @return {RegExp|undefined} the regexp itself or undefined if not a valid RegExp
 * @memberof module:lib
 * @method isRegExp
 * @example
 * lib.isRegExp(/^test$/);
 * // => /^test$/
 *
 * lib.isRegExp("test");
 * // => undefined
 *
 * lib.isRegExp("test", /default/);
 * // => /default/
 *
 * lib.isRegExp(new RegExp("abc"));
 * // => /abc/
 */
lib.isRegExp = function(rx, dflt)
{
    return util.types.isRegExp(rx) ? rx : dflt;
}

/**
 * Check if the value is prefixed with given prefix
 * @param {any} val
 * @param {string} prefix
 * @return {boolean}
 * @memberof module:lib
 * @method isPrefixed
 * @example
 * lib.isPrefixed("user:123", "user:");
 * // => true
 *
 * lib.isPrefixed("admin:123", "user:");
 * // => false
 *
 * lib.isPrefixed(123, "user:");
 * // => false
 *
 * lib.isPrefixed("user:123", null);
 * // => false
 */
lib.isPrefixed = function(val, prefix)
{
    return typeof prefix === "string" && typeof val === "string" && val.startsWith(prefix);
}

/**
 * @param {any} str
 * @return {string|undefined} the value represents an UUID if valid
 * @memberof module:lib
 * @method isUuid
 * @example
 * lib.isUuid("550e8400-e29b-41d4-a716-446655440000");
 * // => "550e8400-e29b-41d4-a716-446655440000"
 *
 * lib.isUuid("not-a-uuid");
 * // => undefined
 *
 * lib.isUuid("550e8400-e29b-41d4-a716-446655440000", "550e");
 * // => "550e8400-e29b-41d4-a716-446655440000"
 *
 * lib.isUuid("550e8400-e29b-41d4-a716-446655440000", "abc");
 * // => undefined
 */
lib.isUuid = function(str, prefix)
{
    if (this.rxUuid.test(str)) {
        if (typeof prefix === "string" && prefix) {
            if (!str.startsWith(prefix)) return;
        }
        return str;
    }
}

/**
 * @param {string} str
 * @param {any} [dflt] - default value if not valid
 * @return {string|undefined} the string iself if contains Unicode characters
 * @memberof module:lib
 * @method isUnicode
 * @example
 * lib.isUnicode("café");
 * // => "café"
 *
 * lib.isUnicode("hello");
 * // => undefined
 *
 * lib.isUnicode("Привет");
 * // => "Привет"
 *
 * lib.isUnicode("hello 😀");
 * // => "hello 😀"
 */
lib.isUnicode = function(str, dflt)
{
    return /[\u007F-\uFFFF]/g.test(str) ? str : dflt;
}

/**
 * @param {any} val
 * @return {boolean} true if a number is positive, i.e. greater than zero
 * @memberof module:lib
 * @method isPositive
 * @example
 * lib.isPositive(10);
 * // => true
 *
 * lib.isPositive(0);
 * // => false
 *
 * lib.isPositive(-5);
 * // => false
 *
 * lib.isPositive("10");
 * // => false
 */
lib.isPositive = function(val)
{
    return this.isNumber(val) > 0;
}

/**
 * @param {any[]} val
 * @param {any} [dflt] - default value if not valid
 * @return {any[]|undefined} the array if the value is non empty array or dflt value if given or undefined
 * @memberof module:lib
 * @method isArray
 * @example
 * lib.isArray([1, 2, 3]);
 * // => [1, 2, 3]
 *
 * lib.isArray([]);
 * // => undefined
 *
 * lib.isArray([], ["default"]);
 * // => ["default"]
 *
 * lib.isArray("test");
 * // => undefined
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
 * @example
 * lib.isEmpty(null);
 * // => true
 *
 * lib.isEmpty("");
 * // => true
 *
 * lib.isEmpty([]);
 * // => true
 *
 * lib.isEmpty({});
 * // => true
 *
 * lib.isEmpty({ id: 1 });
 * // => false
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
        for (const _p in val) return false;
        return true;
    case "string":
        return this.rxEmpty.test(val);
    default:
        return !val;
    }
}

/**
 * @param {any} val
 * Return {boolean} true if the value is a number or string representing a number
 * @memberof module:lib
 * @method isNumeric
 * @example
 * lib.isNumeric(123);
 * // => true
 *
 * lib.isNumeric("123");
 * // => true
 *
 * lib.isNumeric("-12.5");
 * // => true
 *
 * lib.isNumeric("abc");
 * // => false
 *
 * lib.isNumeric(null);
 * // => false
 */
lib.isNumeric = function(val)
{
    if (typeof val === "number") return true;
    if (typeof val !== "string") return false;
    return this.rxNumber.test(val);
}

/**
 * @param {any} val
 * @param {any} [dflt] - default value if not valid
 * @return {Date|undefined} true the date itself if valid or undefined
 * @memberof module:lib
 * @method isDate
 * @example
 * lib.isDate(new Date());
 * // => true
 *
 * lib.isDate(new Date("2024-01-01"));
 * // => true
 *
 * lib.isDate(new Date("bad-date"));
 * // => false
 *
 * lib.isDate("2024-01-01");
 * // => false
 */
lib.isDate = function(val, dflt)
{
    return util.types.isDate(val) && !Number.isNaN(val.getTime()) ? val : dflt;
}

/**
 * Evaluate an expr, compare 2 values with optional type and operation, compare a data value `val`` against a condtion `cond`.
 *
 * For typed values strict equality is used, === but for untyped values default != is used relying on Javascript type coersion
 * @param {any} val
 * @param {object} condition
 * @param {string} [op]
 * @param {string} [type]
 * @return {boolean} true if equal
 * @memberof module:lib
 * @method isTrue
 * @example
 * lib.isTrue("5", 5);
 * // => true
 *
 * lib.isTrue(10, 5, "gt", "number");
 * // => true
 *
 * lib.isTrue(7, "5,10", "between", "number");
 * // => true
 *
 * lib.isTrue("admin", "user,admin", "in");
 * // => true
 *
 * lib.isTrue("hello", /^h/);
 * // => true
 */
lib.isTrue = function(val, cond, op, type)
{
    if (val === undefined && cond === undefined && !op) return true;
    if (val === null && cond === null && !op) return true;

    op = typeof op === "string" && op.toLowerCase() || "";
    let no = false, yes = true, v1, list2;
    if (op[0] === "n" && op[1] === "o" && op[2] === "t") no = true, yes = false;

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
            if (this.toValue(val, type) !== this.toValue(cond, type)) return no;
        }
        break;

    case "in":
    case "not_in":
    case "not in":
        if (!lib.includes(this.split(cond, null, { data_type: type }), this.split(val, null, { data_type: type }))) return no;
        break;

    case "all_in":
    case "all in":
        list2 = this.split(cond, null, { data_type: type });
        if (!this.split(val, null, { data_type: type }).every((x) => (list2.includes(x)))) return no;
        break;

    case 'like%':
    case "not like%":
    case 'begins_with':
    case 'not begins_with':
        v1 = this.toValue(val);
        if (this.toValue(cond).substr(0, v1.length) !== v1) return no;
        break;

    case "ilike%":
    case "not ilike%":
        v1 = this.toValue(val).toLowerCase();
        if (this.toValue(cond).substr(0, v1.length).toLowerCase() !== v1) return no;
        break;

    case "ilike":
    case "not ilike":
        if (this.toValue(val).toLowerCase() !== this.toValue(cond).toLowerCase()) return no;
        break;

    case "!~":
    case "!~*":
    case "iregexp":
    case "not iregexp":
        if (!util.types.isRegExp(cond)) cond = this.toRegexp(cond, "i");
        if (!cond?.test(val)) return no;
        break;

    case "~":
    case "~*":
    case "regexp":
    case "not regexp":
        if (!util.types.isRegExp(cond)) cond = this.toRegexp(cond);
        if (!cond?.test(val)) return no;
        break;

    case "contains":
    case "not contains":
    case "not_contains":
        if (!this.toValue(cond).includes(this.toValue(val))) return no;
        break;

    case "!=":
    case "<>":
    case "ne":
        if (this.toValue(val, type) === this.toValue(cond, type)) return no;
        break;

    default:
        if (type === "list") {
            if (!lib.includes(this.split(cond), this.split(val))) return no;
        } else

        if (Array.isArray(cond)) {
            if (!lib.includes(cond, val)) return no;
        } else

        if (Array.isArray(val)) {
            if (!lib.includes(val, cond)) return no;
        } else

        if (util.types.isRegExp(cond)) {
            if (!cond.test(val)) return no;
        } else

        if (type) {
            if (this.toValue(val, type) !== this.toValue(cond, type)) return no;
        } else {
            // biome-ignore lint/suspicious/noDoubleEquals: non typed check
            if (val != cond) return no;
        }
    }
    return yes;
}

/**
 * All properties in the object `obj` must match all properties in the object `condition`, for comparison `lib.isTrue` is used for each property
 * in the condition object.
 * @param {object} obj
 * @param {object} condition
 * - if a condition value is null it means an empty or non-existed value,
 * - if a condition property is a string/number or regexp then it must match or be equal
 * - if a condition property is a list then the object value must be present in the list
 * - if an object property is a list and the condition property is a string/number/list then it must be present in the list
 * - a condition can be a RegExp to test patterns
 * @param {object} [options]
 * The options can provide specific `ops` and `types` per property.
 *
 * @example
 * lib.isMatched({ id: 1, name: "test", type: ["user", "admin"] }, { name: /^j/ })
 * true
 * lib.isMatched({ id: 1, name: "test", type: ["user", "admin"] }, { type: "admin" }, { ops: { type: "not_in" } })
 * false
 * lib.isMatched({ id: 1, name: "test", type: ["user", "admin"] }, { type: [staff"] })
 * false
 * lib.isMatched({ id: 1, name: "test", type: ["user", "admin"] }, { id: 1 }, { ops: { id: "ge" } })
 * true
 * @memberof module:lib
 * @method isMatched
 */
lib.isMatched = function(obj, condition, options)
{
    if (!obj || !condition) return false;
    const ignore = typeof options?.ignore?.test === "function" ? options.ignore : undefined;
    const allow = typeof options?.allow?.test === "function" ? options.allow : undefined;
    for (const p in condition) {
        if (ignore?.test(p)) continue;
        if (allow && !allow.test(p)) continue;
        if (!lib.isTrue(obj[p], condition[p], options?.ops?.[p], options?.types?.[p] || null)) return false;
    }
    return true;
}

/**
 * @param {string} text
 * @param {int} start
 * @param {int} end
 * @param {string} [delimiters] define a character set to be used for words boundaries, if not given or empty string the default will be used
 * @return {boolean} true if it is a word at the position `start` and `end` in the `text` string,
 * @memberof module:lib
 * @method isWord
 * @example
 * lib.isWord("hello world", 0, 4);
 * // => true
 *
 * lib.isWord("hello world", 1, 4);
 * // => false
 *
 * lib.isWord("hello world", 6, 10);
 * // => true
 *
 * lib.isWord("foo_bar", 4, 6, "_");
 * // => true
 */
lib.isWord = function(text, start, end, delimiters)
{
    if (typeof text !== "string") return false;
    delimiters = typeof delimiters === "string" && delimiters || this.wordBoundaries;
    if (start <= 0 || delimiters.includes(text[start - 1])) {
        if (end + 1 >= text.length || delimiters.includes(text[end + 1])) {
            return true;
        }
    }
    return false;
}

/**
 * Returns a score between 0 and 1 for two strings, 0 means no similarity, 1 means exactly similar.
 * The default algorithm is Cosine Similarity, options.type can be used to specify a different algorithm:
 * @param {string} s1
 * @param {string} s2
 * @param {object} [options]
 * @param {string} [options.type]
 * - sd - Sorensent Dice
 * - jw - Jaro Wrinkler
 * - cs - Cosine Similarity
 * @memberof module:lib
 * @method isSimilar
 * @example
 * lib.isSimilar("test", "test");
 * // => 1
 *
 * lib.isSimilar("", "test");
 * // => 0
 *
 * lib.isSimilar("martha", "marhta");
 * // => 0.9611111111111111
 *
 * lib.isSimilar("night", "nacht", { type: "sd" });
 * // => 0.25
 *
 * lib.isSimilar("hello world", "hello there", { type: "cs" });
 * // => 0.4999999999999999
 */
lib.isSimilar = function(s1, s2, options)
{
    if (!s1 || !s2 || !s1.length || !s2.length) return 0;
    if (s1 === s2) return 1;

    function SorensentDice(s1, s2) {
        function getBigrams(str) {
            var bigrams = [];
            var strLength = str.length;
            for (let i = 0; i < strLength; i++) bigrams.push(str.substr(i, 2));
            return bigrams;
        }
        var l1 = s1.length-1, l2 = s2.length-1, intersection = 0;
        if (l1 < 1 || l2 < 1) return 0;
        var b1 = getBigrams(s1), b2 = getBigrams(s2);
        for (let i = 0; i < l1; i++) {
            for (let j = 0; j < l2; j++) {
                if (b1[i] === b2[j]) {
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
            for (let i = 0; i < vec.length; i++) sum += vec[i] * vec[i];
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
            const low = (i >= range) ? i - range : 0;
            const high = (i + range <= s2.length) ? (i + range) : (s2.length - 1);

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
        let weight = (m / s1.length + m / s2.length + (m - (n / 2)) / m) / 3;
        if (weight > 0.7) {
            while (s1[l] === s2[l] && l < 4) ++l;
            weight = weight + l * p * (1 - weight);
        }
        return weight;
    }
    switch (options?.type) {
    case "sd":
        return SorensentDice(s1, s2);
    case "jw":
        return JaroWrinker(s1, s2);
    default:
        return CosineSimularity(s1, s2);
    }
}

