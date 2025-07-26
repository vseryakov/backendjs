//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const lib = require(__dirname + '/../lib');
const util = require("util");

// Return object type, try to detect any distinguished type
lib.typeName = function(v)
{
    if (v === null) return "null";
    const t = typeof v;
    if (t === "object") {
        switch (v.constructor?.name) {
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
            return v.constructor.name.toLowerCase();
        }
    }
    return t;
}

// Detect type from the value
lib.autoType = function(val)
{
    return this.isNumeric(val) ? "number":
           typeof val == "boolean" || val == "true" || val == "false" ? "bool":
           typeof val == "string" ?
           val[0] == "^" && val.slice(-1) == "$" ? "regexp":
           val[0] == "[" && val.slice(-1) == "]" ? "js":
           val[0] == "{" && val.slice(-1) == "}" ? "js":
           val.includes("|") && !/[()[\]^$]/.test(val) ? "list": "" : "";
}

// Returns true of the argument is a generic object, not a null, Buffer, Date, RegExp or Array
lib.isObject = function(v)
{
    return this.typeName(v) === "object";
}

// Return true if the value is a number
lib.isNumber = function(val)
{
    return typeof val === "number" && !Number.isNaN(val);
}

// Returns true if given value is non empty string
lib.isString = function(val)
{
    return typeof val === "string" && val;
}

// Return true if the value is prefixed
lib.isPrefix = function(val, prefix)
{
    return typeof prefix == "string" && prefix &&
           typeof val == "string" && val.substr(0, prefix.length) == prefix;
}

// Returns true if the value represents an UUID
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

// Returns true if the value represent tuuid
lib.isTuuid = function(str)
{
    if (typeof str != "string" || !str) return 0;
    var idx = str.indexOf("_");
    if (idx > 0) str = str.substr(idx + 1);
    var bytes = Buffer.from(str, 'hex');
    if (bytes.length != 15) return 0;
    return 1;
}

// Returns true of a string contains Unicode characters
lib.isUnicode = function(str)
{
    return /[\u007F-\uFFFF]/g.test(str);
}

// Returns true if a number is positive, i.e. greater than zero
lib.isPositive = function(val)
{
    return this.isNumber(val) && val > 0;
}

// Returns the array if the value is non empty array or dflt value if given or undefined
lib.isArray = function(val, dflt)
{
    return Array.isArray(val) && val.length ? val : dflt;
}

// Return true of the given value considered empty
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

// Returns true if the value is a number or string representing a number
lib.isNumeric = function(val)
{
    if (typeof val == "number") return true;
    if (typeof val != "string") return false;
    return this.rxNumber.test(val);
}

// Returns true if the given type belongs to the numeric family of data types
lib.isNumericType = function(type)
{
    return type && this.rxNumericType.test(String(type).trim());
}

// Returns true if the given date is valid
lib.isDate = function(d)
{
    return util.types.isDate(d) && !Number.isNaN(d.getTime());
}

// Returns true if `name` exists in the array `list`, search is case sensitive. if `name` is an array it will return true if
// any element in the array exists in the `list`.
lib.isFlag = function(list, name)
{
    return Array.isArray(list) && (Array.isArray(name) ? name.some((x) => (list.includes(x))) : list.includes(name));
}

// Evaluate an expr, compare 2 values with optional type and operation, compae a data value `val`` against a condtion `cond`.
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

// Returns true if it is a word at the position `start` and `end` in the `text` string,
// - `delimiters` define a character set to be used for words boundaries, if not given or empty string the default will be used
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

// Returns first valid number from the list of arguments or 0
lib.validNum = function(...args)
{
    for (const i in args) {
        if (this.isNumber(args[i])) return args[i];
    }
    return 0;
}

// Returns first valid positive number from the list of arguments or 0
lib.validPositive = function(...args)
{
    for (const i in args) {
        if (this.isPositive(args[i])) return args[i];
    }
    return 0;
}

// Returns first valid boolean from the list of arguments or false
lib.validBool = function(...args)
{
    for (const i in args) {
        if (typeof args[i] == "boolean") return args[i];
    }
    return false;
}

// Return true if the version is within given condition(s), always true if either argument is empty.
// Conditions can be: >=M.N, >M.N, =M.N, <=M.N, <M.N, M.N-M.N
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
