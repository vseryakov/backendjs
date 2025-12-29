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
 * @return {boolean} true of the argument is a generic object, not a null, Buffer, Date, RegExp or Array
 * @memberof module:lib
 * @method isObject
 */
lib.isObject = function(val)
{
    return this.typeName(val) === "object";
}

/**
 * @param {any} val
 * @return {boolean} true if the value is a number
 * @memberof module:lib
 * @method isNumber
 */
lib.isNumber = function(val)
{
    return typeof val === "number" && !Number.isNaN(val);
}

/**
 * @param {string} val
 * @return {string} the string value or empty string if `val` is not a string
 * @memberof module:lib
 * @method isString
 */
lib.isString = function(val)
{
    return typeof val == "string" && val || "";
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
 * @param {any} val
 * @return {boolean} true if the value represents an UUID
 * @memberof module:lib
 * @method isUuid
 */
lib.isUuid = function(val, prefix)
{
    if (this.rxUuid.test(val)) {
        if (typeof prefix == "string" && prefix) {
            if (val.substr(0, prefix.length) != prefix) return false;
        }
        return true;
    }
    return false;
}

/**
 * @param {string} str
 * @return {boolean} true of a string contains Unicode characters
 * @memberof module:lib
 * @method isUnicode
 */
lib.isUnicode = function(str)
{
    return /[\u007F-\uFFFF]/g.test(str);
}

/**
 * @param {any} val
 * @return {boolean} true if a number is positive, i.e. greater than zero
 * @memberof module:lib
 * @method isPositive
 */
lib.isPositive = function(val)
{
    return this.isNumber(val) && val > 0;
}

/**
 * @param {any[]} val
 * @param {any} dflt
 * @return {any[]} the array if the value is non empty array or dflt value if given or undefined
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
        list2 = this.strSplit(cond);
        if (list2.length > 1) {
            if (this.toValue(val, type) < this.toValue(list2[0], type) || this.toValue(val, type) > this.toValue(list2[1], type)) return no;
        } else {
            if (this.toValue(val, type) != this.toValue(cond, type)) return no;
        }
        break;

    case "in":
    case "not_in":
    case "not in":
        if (!lib.isFlag(this.strSplit(cond, null, { datatype: type }), this.strSplit(val, null, { datatype: type }))) return no;
        break;

    case "all_in":
    case "all in":
        list2 = this.strSplit(cond, null, { datatype: type });
        if (!this.strSplit(val, null, { datatype: type }).every((x) => (list2.includes(x)))) return no;
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
            if (!this.isFlag(this.strSplit(cond), this.strSplit(val))) return no;
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
    condition = lib.strSplit(condition);
    if (!condition.length) return true;
    return condition.some((x) => {
        const d = x.match(this.rxVersion);
        if (!d) return false;
        return d[3] ? lib.isTrue(version, [lib.toVersion(d[3]), lib.toVersion(d[4])], "between", "number") :
                      lib.isTrue(version, lib.toVersion(d[2]), d[1] || ">=", "number");
    });
}
