//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const util = require('util');
const lib = require(__dirname + '/../lib');

// Return true if a variable or property in the object exists,
// - if obj is null or undefined return false
// - if obj is an object, return true if the property is not undefined
// - if obj is an array then search for the value with indexOf, only simple values supported,
// - if obj is a string then perform indexOf if the name is also a string or a number
// - if both are arrays return true if at least one item is in both arrays
//
// Example:
//
//         lib.exists({ 1: 1 }, "1")
//         lib.exists([ 1, 2, 3 ], 1)
//         lib.exists([ 1, 2, 3 ], [ 1, 5 ])
lib.exists = function(obj, name)
{
    switch (this.typeName(obj)) {
    case "null":
    case "undefined":
        return false;
    case "object":
        return typeof obj[name] != "undefined";
    case "string":
        return obj.indexOf(name) > -1;
    case "set":
    case "map":
        return obj.has(name);
    case "array":
        if (Array.isArray(name)) return obj.some(function(x) { return name.indexOf(x) > -1 });
        return obj.indexOf(name) > -1;
    }
    return !!obj;
}

// All properties in the object `obj` must match all properties in the object `condition`, for comparison `lib.isTrue` is used for each property
// in the condition object.
//
// - if a condition value is null it means an empty or non-existed value,
// - if a condition property is a string/number or regexp then it must match or be equal
// - if a condition property is a list then the object value must be present in the list
// - if an object property is a list and the condition property is a string/number/list then it must be present in the list
// - a condition can be a RegExp to test patterns
//
// The options can provide specific `ops` and `types` per property.
//
// Example:
//
//        lib.isMatched({ id: 1, name: "test", type: ["user", "admin"] }, { name: /^j/ })
//        true
//        lib.isMatched({ id: 1, name: "test", type: ["user", "admin"] }, { type: "admin" }, { ops: { type: "not_in" } })
//        false
//        lib.isMatched({ id: 1, name: "test", type: ["user", "admin"] }, { type: [staff"] })
//        false
//        lib.isMatched({ id: 1, name: "test", type: ["user", "admin"] }, { id: 1 }, { ops: { id: "ge" } })
//        true
//
lib.isMatched = function(obj, condition, options)
{
    options = options || this.empty;
    var ops = options.ops || lib.empty;
    var types = options.types || lib.empty;
    var ignore = typeof options?.ignore?.test == "function" && options.ignore;
    var allow = typeof options?.allow?.test == "function" && options.allow;
    for (const p in condition) {
        if (ignore && ignore.test(p)) continue;
        if (allow && !allow.test(p)) continue;
        if (!lib.isTrue(obj[p], condition[p], ops[p], types[p] || null)) return false;
    }
    return true;
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

// Return the length of an array or 0 if it is not an array
lib.arrayLength = function(list)
{
    return Array.isArray(list) && list.length || 0;
}

// Remove the given item from the list in place, returns the same list
lib.arrayRemove = function(list, item)
{
    var idx = this.isArray(list, this.emptylist).indexOf(item);
    if (idx > -1) list.splice(idx, 1);
    return list;
}

// Returns only unique items in the array, optional `key` specified the name of the column to use when determining uniqueness if items are objects.
lib.arrayUnique = function(list, key)
{
    if (!Array.isArray(list)) return this.strSplitUnique(list);
    var rc = [], keys = {};
    list.forEach(function(x) {
        if (key) {
            if (!keys[x[key]]) rc.push(x);
            keys[x[key]] = 1;
        } else {
            if (rc.indexOf(x) == -1) rc.push(x);
        }
    });
    return rc;
}

// Returns true if both arrays contain same items, only primitive types are supported
lib.arrayEqual = function(list1, list2)
{
    if (!Array.isArray(list1) || !Array.isArray(list2) || list1.length != list2.length) return false;
    for (let i = 0; i < list1.length; ++i) {
        if (list2.indexOf(list1[i]) == -1) return false;
    }
    return true;
}

// Flatten array of arrays into a single array
lib.arrayFlatten = function(list)
{
    list = Array.prototype.concat.apply([], list);
    return list.some(Array.isArray) ? this.arrayFlatten(list) : list;
}

// A copy of an object, this is a shallow copy, only arrays and objects are created but all other types are just referenced in the new object
// - first argument is the object to clone, can be null
// - all additional arguments are treated as name value pairs and added to the cloned object as additional properties
// Example:
//          lib.objClone({ 1: 2 }, "3", 3, "4", 4)
lib.objClone = function()
{
    var obj = arguments[0];
    var rc = Array.isArray(obj) ? [] : {}, o1, o2;
    for (var p in obj) {
        if (!obj.hasOwnProperty(p)) continue;
        o1 = obj[p];
        switch (this.typeName(o1)) {
        case "object":
            rc[p] = o2 = {};
            for (const k in o1) o2[k] = o1[k];
            break;
        case "map":
            rc[p] = o2 = new Map();
            for (const k of o1) o2.set(k[0], k[1]);
            break;
        case "set":
            rc[p] = o2 = new Set();
            for (const k of o1) o2.add(k);
            break;
        case "array":
            rc[p] = o1.slice(0);
            break;
        default:
            rc[p] = o1;
        }
    }
    for (var i = 1; i < arguments.length - 1; i += 2) {
        if (arguments[i] === "__proto__") continue;
        rc[arguments[i]] = arguments[i + 1];
    }
    return rc;
}

// Return new object using arguments as name value pairs for new object properties
lib.objNew = function()
{
    var obj = {};
    for (var i = 0; i < arguments.length - 1; i += 2) if (typeof arguments[i + 1] != "undefined") obj[arguments[i]] = arguments[i + 1];
    return obj;
}

// Flatten a javascript object into a single-depth object, all nested values will have property names appended separated by comma
//
// The options properties:
//  - separator - use something else instead of .
//  - index - initial index for arrays, 0 is default
//
// Example
//
//          > lib.objFlatten({ a: { c: 1 }, b: { d: 1 } } )
//          { 'a.c': 1, 'b.d': 1 }
//         > lib.objFlatten({ a: { c: 1 }, b: { d: [1,2,3] } }, { index: 1 })
//          { 'a.c': 1, 'b.d.1': 1, 'b.d.2': 2, 'b.d.3': 3 }
lib.objFlatten = function(obj, options)
{
    var rc = {};
    var idx1 = Array.isArray(obj) && typeof options?.index == "number" ? options.index : 0;

    for (var p in obj) {
        var p1 = idx1 ? lib.toNumber(p) + idx1 : p;
        if (typeof obj[p] == 'object') {
            var obj2 = this.objFlatten(obj[p], options);
            var idx2 = Array.isArray(obj2) && typeof options?.index == "number" ? options.index : 0;
            for (var x in obj2) {
                var x1 = idx2 ? lib.toNumber(x) + idx2 : x;
                rc[p1 + (options?.separator || '.') + x1] = obj2[x];
            }
        } else {
            if (typeof obj[p] != "undefined") rc[p1] = obj[p];
        }
    }
    return rc;
}

// Cleanup object properties, delete all undefined values in place by default.
// Additional options:
// - If `null` is true then delete all null properties.
// - If `empty` is true then delete all empty properties, i.e. null/undefined/""/[]
// - If `type` is a RegExp then all properties that match it by type will be deleted.
// - If `name` is a RegExp then all properties that match it by name will be deleted.
// - If `value` is a RegExp then all string|number|boolean properties that match it by value will be deleted.
// - If `array` is true then process all array items recursivelly
//
// Example
//
//     > lib.cleanObj({ a: 1, b: true, c: undefined, d: 2, e: null, l: ["a", "b", null, undefined, { a: 1, b: undefined } ] },{ null:1, array:1, type: /boolean/})
//     { a: 1, d: 2, l: [ 'a', 'b', { a: 1 } ] }
//
lib.objClean = function(obj, options)
{
    var names = util.types.isRegExp(options?.name) ? options.name : null;
    var values = util.types.isRegExp(options?.value) ? options.value : null;
    var types = util.types.isRegExp(options?.type) ? options.type : null;
    var empty = options?.empty;

    function toClean(type, name, val) {
        if (empty && lib.isEmpty(val)) return 1;
        if (types && types.test(type)) return 1;
        if (names && names.test(name)) return 1;
        switch (type) {
        case "undefined":
            return 1;
        case "null":
            if (options?.null) return 1;
            break;
        case "string":
        case "number":
        case "boolean":
            if (values && values.test(val)) return 1;
            break;
        }
        return 0;
    }

    switch (this.typeName(obj)) {
    case "object":
        for (const p in obj) {
            var type = this.typeName(obj[p]);
            if (toClean(type, p, obj[p])) {
                delete obj[p];
                continue;
            }
            switch (type) {
            case "array":
                if (!options || !options.array) break;
            case "object":
                obj[p] = this.objClean(obj[p], options);
                break;
            }
        }
        break;

    case "array":
        if (!options || !options.array) return obj;
        obj = obj.filter(function(x) {
            var t = lib.typeName(x);
            if (toClean(t, "", x)) return 0;
            switch (t) {
            case "array":
                if (!options || !options.array) break;
            case "object":
                x = lib.objClean(x, options);
                break;
            }
            return 1;
        });
        break;
    }
    return obj;
}

// Add properties to an existing object where the first arg is an object, the second arg is an object to add properties from,
// the third argument can be an options object that can control how the properties are merged.
//
// Options properties:
//  - allow - a regexp which properties are allowed to be merged
//  - ignore - a regexp which properties should be ignored
//  - del - a regexp which properties should be removed
//  - strip - a regexp to apply to each property name before merging, the matching parts will be removed from the name
//  - deep - extend all objects not just the top level
//  - noempty - skip undefined, default is to keep
//
//
//       lib.objExtend({ a:1, c:5 }, { c: { b: 2 }, d: [{ d: 3 }], _e: 4, f: 5, x: 2 }, { allow: /^(c|d|_e)/, strip: /^_/, del: /^f/ })
//       { a: 1, c: { b: 2 }, d: [ { d: 3 } ], e: 4 }
//
//       lib.objExtend({ a:1, c:5 }, { c: { b: 2 }, d: [{ d: 3 }], _e: 4, f: 5, x: 2 }, { allow: /^(c|d|_e)/, strip: /^_/, del: /^f/, deep: 1 })
//       { a: 1, c: {}, d: [ { d: 3 } ], e: 4 }
//
lib.objExtend = function(obj, val, options)
{
    obj = typeof obj == "object" || typeof obj == "function" ? obj || {} : {};
    if (options) {
        if (typeof options.del?.test == "function") {
            for (const p in obj) {
                if (options.del.test(p)) delete obj[p];
            }
        }
        const a = Array.isArray(val);
        for (let p in val) {
            const v = val[p];
            if (v === obj) continue;
            if (v === undefined && options.noempty) continue;
            if (!a) {
                if (typeof options.ignore?.test == "function" && options.ignore.test(p)) continue;
                if (typeof options.allow?.test == "function" && !options.allow.test(p)) continue;
                if (typeof options.strip?.test == "function") p = p.replace(options.strip, ""); else
                if (typeof options.remove?.test == "function") p = p.replace(options.remove, "");
            }
            if (p === "__proto__") continue;
            if (options.deep && v) {
                if (Array.isArray(v)) {
                    obj[p] = this.objExtend(Array.isArray(obj[p]) ? obj[p] : [], v, options);
                    continue;
                } else
                if (this.typeName(v) === "object") {
                    obj[p] = this.objExtend(obj[p], v, options);
                    continue;
                }
            }
            obj[p] = v;
        }
    } else {
        for (const p in val) {
            if (p === "__proto__") continue;
            obj[p] = val[p];
        }
    }
    return obj;
}

// Merge two objects, all properties from the `val` override existing properties in the `obj`, returns a new object
//
// Options properties:
//  - allow - a regexp which properties are allowed to be merged
//  - ignore - a regexp which properties should be ignored
//  - del - a regexp which properties should be removed
//  - remove - a regexp to apply to each property name before merging, the matching parts will be removed from the name
//  - deep - make a deep copy using objExtend
//
//  Example
//
//       var o = lib.objMerge({ a:1, b:2, c:3 }, { c:5, d:1, _e: 4, f: 5, x: 2 }, { allow: /^(c|d)/, remove: /^_/, del: /^f/ })
//       o = { a:1, b:2, c:5, d:1 }
lib.objMerge = function(obj, val, options)
{
    return this.objExtend(this.objExtend({}, obj || null, options), val, options);
}

// Delete properties from the object, first arg is an object, the rest are properties to be deleted
lib.objDel = function()
{
    if (!this.isObject(arguments[0])) return;
    for (var i = 1; i < arguments.length; i++) delete arguments[0][arguments[i]];
    return arguments[0];
}

// Return list of objects that matched the given criteria in the given object. Performs the deep search.
//
// The options can define the following properties:
//
// - exists - search by property name, return all objects that contain given property
// - hasValue - return only objects that have a property with given value
// - matchValue - return only objects that match the given RegExp by property value
// - matchName - return only objects that match the given RegExp by property name
// - sort - sort the result by the given property
// - value - return an object with this property only, not the whole matched object
// - count - return just number of found properties
//
// Example:
//
//          var obj = { id: { index: 1 }, name: { index: 3 }, descr: { type: "string", pub: 1 }, items: [ { name: "test" } ] };
//
//          lib.objSearch(obj, { matchValue: /string/ });
//          [ { name: 'descr', value: { type: "string", pub: 1 } } ]
//
//          lib.objSearch(obj, { matchName: /name/, matchValue: /^t/ });
//          [{ name: '0': value: { name: "test" }]
//
//          lib.objSearch(obj, { exists: 'index', sort: 1, value: "index" });
//          { id: 1, name: 3 }
//
//          lib.objSearch(obj, { hasValue: 'test', count: 1 });
//          1
//
lib.objSearch = function(obj, options)
{
    if (!options) options = this.empty;

    var rc = [], v;
    var rxn = util.types.isRegExp(options.matchName) && options.matchName;
    var rxv = util.types.isRegExp(options.matchValue) && options.matchValue;
    function find(o, k) {
        for (const p in o) {
            v = o[p];
            if (typeof v == "object") {
                find(v, p);
                continue;
            }
            if (options.exists && !(p == options.exists && typeof v != "undefined")) continue;
            if (rxn && !rxn.test(p)) continue;
            if (typeof options.hasValue != "undefined" && v != options.hasValue) continue;
            if (rxv && !rxv.test(v)) continue;
            rc.push({ name: k, value: o });
        }
    }
    find(obj);

    if (options.count) return rc.length;
    if (options.sort) rc.sort((a, b) => (a.value[options.sort] - b.value[options.sort]));
    if (options.names) return rc.map((x) => (x.name));
    if (options.value) return rc.reduce(function(x, y) { x[y.name] = y.value[options.value]; return x }, {});
    return rc;
}

// Return a property from the object, name specifies the path to the property, if the required property belong to another object inside the top one
// the name uses . to separate objects. This is a convenient method to extract properties from nested objects easily.
// Options may contains the following properties:
//   - list - return the value as a list even if there is only one value found
//   - obj - return the value as an object, if the result is a simple type, wrap into an object like { name: name, value: result }
//   - str - return the value as a string, convert any other type into string
//   - num - return the value as a number, convert any other type by using toNumber
//   - func - return the value as a function, if the object is not a function returns null
//   - owner - return the owner object, not the value, i.e. return the object who owns the value specified in the name
//
// Example:
//
//          > lib.objGet({ response: { item : { id: 123, name: "Test" } } }, "response.item.name")
//          "Test"
//          > lib.objGet({ response: { item : { id: 123, name: "Test" } } }, "response.item.name", { list: 1 })
//          [ "Test" ]
//          > lib.objGet({ response: { item : { id: 123, name: "Test" } } }, "response.item.name", { owner: 1 })
//          { item : { id: 123, name: "Test" } }
lib.objGet = function(obj, name, options)
{
    if (!obj) {
        if (!options) return null;
        return options.list ? [] : options.obj ? {} : options.str ? "" : options.num ? options.dflt || 0 : null;
    }
    var path = !Array.isArray(name) ? String(name).split(".") : name, owner = obj;
    for (var i = 0; i < path.length; i++) {
        if (i && owner) owner = owner[path[i - 1]];
        obj = obj ? obj[path[i]] : undefined;
        if (typeof obj == "undefined") {
            if (!options) return obj;
            return options.owner && i == path.length - 1 ? owner : options.list ? [] : options.obj ? {} : options.str ? "" : options.num ? options.dflt || 0 : undefined;
        }
    }
    if (options) {
        if (options.owner) return owner;
        if (obj) {
            if (options.func && typeof obj != "function") return null;
            if (options.list && !Array.isArray(obj)) return [ obj ];
            if (options.obj && typeof obj != "object") return { name: name, value: obj };
            if (options.str && typeof obj != "string") return String(obj);
            if (options.num && typeof obj != "number") return this.toNumber(obj, options);
        }
    }
    return obj;
}

// Set a property of the object, name can be an array or a string with property path inside the object, all non existent intermediate
// objects will be create automatically. The options can have the folowing properties:
// - incr - increment a numeric property with the given number or 1, 0 is noop, non-existing propertties will be initilaized with 0
// - mult - multiply a numeric property with the given number, non-existing properties will be initialized with 0
// - push - add to the array, if it is not an array a new empty aray is created
// - append - append to a string
// - unique - only push if not in the list
// - separator - separator for object names, default is `.`
// - result - "new" - new value, "old" - old value, "obj" - final object, otherwise the original object itself
//
// Example
//
//          var a = lib.objSet({}, "response.item.count", 1)
//          lib.objSet(a, "response.item.count", 1, { incr: 1 })
//
lib.objSet = function(obj, name, value, options)
{
    if (this.typeName(obj) != "object") obj = {};
    if (!Array.isArray(name)) name = String(name).split(options?.separator || ".");
    if (!name?.length) return obj;
    var p = name[name.length - 1], v = obj;
    for (var i = 0; i < name.length - 1; i++) {
        if (typeof obj[name[i]] == "undefined") obj[name[i]] = {};
        obj = obj[name[i]];
    }
    var old = obj[p];
    if (options?.push) {
        if (!Array.isArray(obj[p])) obj[p] = old = [];
        if (!options.unique || obj[p].indexOf(value) == -1) obj[p].push(value);
    } else
    if (options?.append) {
        if (typeof obj[p] != "string") obj[p] = old = "";
        obj[p] += value;
    } else
    if (options?.mult) {
        if (typeof obj[p] != "number") obj[p] = old = 0;
        obj[p] *= typeof value == "number" ? value : lib.toNumber(value) || 1;
    } else
    if (options?.incr) {
        if (value !== 0) {
            if (typeof obj[p] != "number") obj[p] = old = 0;
            if (obj[p] >= Number.MAX_SAFE_INTEGER) obj[p] = 0;
            obj[p] += lib.toNumber(value) || 1;
        }
    } else {
        obj[p] = value;
    }
    switch (options?.result) {
    case "old": return old;
    case "obj": return obj;
    case "new": return obj[p];
    }
    return v;
}

// Increment a property by the specified number, if the property does not exist it will be created,
// returns new incremented value or the value specified by the `result` argument.
// It uses `lib.objSet` so the property name can be a nested path.
lib.objIncr = function(obj, name, count, result)
{
    return this.objSet(obj, name, count, { incr: 1, result: result || "new" });
}

// Similar to `objIncr` but does multiplication
lib.objMult = function(obj, name, count, result)
{
    return this.objSet(obj, name, count, { mult: 1, result: result || "new" });
}

// Return all property names for an object
lib.objKeys = function(obj)
{
    return this.isObject(obj) ? Object.keys(obj) : [];
}

// Return an object structure as a string object by showing primitive properties only,
// for arrays it shows the length and `options.count` or 25 first items,
// for objects it will show up to the `options.keys` or 25 first properties,
// strings are limited by `options.length` or 256 bytes, if truncated the full string length is shown.
// the object depth is limited by `options.depth` or 5 levels deep, the number of properties are limited by options.count or 15,
// all properties that match `options.ignore` will be skipped from the output, if `options.allow` is a regexp, only properties that
// match it will be output. Use `options.replace` for replacing anything in the final string.
lib.objDescr = function(obj, options)
{
    if (typeof obj != "object") {
        var str = typeof obj == "string" ? obj : typeof obj == "number" || typeof obj == "boolean" ? String(obj) : "";
        if (str && options) for (const p in options.replace) str = str.replace(options.replace[p], p);
        return str;
    }
    if (!options) options = { __depth: 0 };
    var ignore = util.types.isRegExp(options.ignore) ? options.ignore : null;
    var allow = util.types.isRegExp(options.allow) ? options.allow : null;
    var hide = util.types.isRegExp(options.hide) ? options.hide : null;
    var length = options.length || 256, nkeys = options.keys || 25, count = options.count || 25, depth = options.depth || 5;
    var rc = "", n = 0, p, v, h, e, t, keys = [], type = this.typeName(obj);
    switch (type) {
    case "object":
        break;
    case "error":
        v = { error: options.errstack ? obj.stack : obj.message };
        for (const k in obj) v[k] = obj[k];
        obj = v;
        break;
    default:
        obj = { "": obj };
    }
    for (const k in obj) keys.push(k);
    if (options.sort && !options.__depth && keys.length) keys = keys.sort();

    for (const i in keys) {
        p = keys[i];
        if (ignore && ignore.test(p)) continue;
        if (allow && !allow.test(p)) continue;
        v = obj[p];
        if (typeof v == "undefined" && !options.undefined) continue;
        h = hide && hide.test(p);
        t = this.typeName(v);

        switch (t) {
        case "buffer":
            if (v.length || options.keepempty || options.buffer) {
                if (p || v.length) {
                    rc += `${rc ? ", " : ""}${p ? p + ":" : ""}[${v.length || ""}] `;
                    if (!h) rc += v.slice(0, length).toString("hex");
                }
                n++;
            }
            break;

        case "set":
            v = Array.from(v);
        case "array":
            if (v.length || options.keepempty || options.array) {
                if (options.__depth >= depth) {
                    rc += `${rc ? ", " : ""}${p ? p + ": " : ""}{...}`;
                    n++;
                } else {
                    if (typeof options.__depth != "number") options = lib.objClone(options, "__depth", 0);
                    if (!options.__seen) options.__seen = new WeakSet();
                    if (options.__seen.has(v)) {
                        rc += `${rc ? ", " : ""}${p ? p + ": " : ""}{...}`;
                        n++;
                    } else {
                        options.__seen.add(v);
                        options.__depth++;
                        if (p || v.length) {
                            rc += `${rc ? ", " : ""}${p ? p + ":" : ""}[${v.length || ""}] `;
                            if (!h) rc += v.slice(0, count).map((x) => (lib.objDescr(x, options)));
                        }
                        n++;
                        options.__depth--;
                    }
                }
            }
            break;

        case "map":
            if (options.__depth >= depth) {
                rc += `${rc ? ", " : ""}${p ? p + ": " : ""}{...}`;
                n++;
            } else {
                if (typeof options.__depth != "number") options = lib.objClone(options, "__depth", 0);
                if (!options.__seen) options.__seen = new WeakSet();
                if (options.__seen.has(v)) {
                    rc += `${rc ? ", " : ""}${p ? p + ": " : ""}{...}`;
                    n++;
                } else {
                    options.__seen.add(v);
                    options.__depth++;
                    if (h) {
                        v = v.size;
                    } else {
                        const vv = [];
                        for (const k of v) {
                            vv.push(lib.objDescr(k[0]) + ": " + lib.objDescr(k[1]));
                            if (vv.length >= count) break;
                        }
                        v = vv;
                    }
                    if (p || v) rc += (rc ? ", " : "") + (p ? p + ": " : "") + "{" + v + "}";
                    n++;
                    options.__depth--;
                }
            }
            break;

        case "error":
        case "object":
            if (options.__depth >= depth) {
                rc += `${rc ? ", " : ""}${p ? p + ": " : ""}{...}`;
                n++;
            } else {
                if (typeof options.__depth != "number") options = lib.objClone(options, "__depth", 0);
                if (!options.__seen) options.__seen = new WeakSet();
                if (options.__seen.has(v)) {
                    rc += `${rc ? ", " : ""}${p ? p + ": " : ""}{...}`;
                    n++;
                } else {
                    options.__seen.add(v);
                    options.__depth++;
                    v = h ? Object.keys(v).length : this.objDescr(typeof v.toJSON == "function" ? v.toJSON() : v, options);
                    if (v || options.keepempty) {
                        if (p || v) rc += (rc ? ", " : "") + (p ? p + ": " : "") + "{" + v + "}";
                        n++;
                    }
                    options.__depth--;
                }
            }
            break;

        case "string":
            if (v || options.keepempty || options.string) {
                rc += (rc ? ", " : "") + (p ? p + ":" : "");
                if (v.length > length) rc += `[${v.length}] `;
                rc += h ? "..." : v.slice(0, length);
                n++;
            }
            break;

        case "function":
            if (!options.func) break;
            if (options.func > 1) v = "[Function]";
            rc += (rc ? ", " : "") + (p ? p + ":" : "") + (h ? "..." : v);
            n++;
            break;

        case "date":
            rc += (rc ? ", " : "") + (p ? p + ":" : "");
            rc += h ? "..." : options.strftime ? this.strftime(v, options.strftime) : v.toISOString();
            n++;
            break;

        case "null":
            if (!options.null) break;
            rc += (rc ? ", " : "") + (p ? p + ": " : "") + "null";
            n++;
            break;

        default:
            e = this.isEmpty(v);
            if (!e || options.keepempty) {
                v = "" + v;
                rc += (rc ? ", " : "") + (p ? p + ": " : "");
                if (v.length > length) rc += `[${v.length}] `;
                rc += e ? "" : h ? "..." : v.slice(0, length);
                n++;
            }
        }
        if (n > nkeys) break;
    }
    if (!options.__depth) {
        for (const p in options.replace) rc = rc.replace(options.replace[p], p);
    }
    return rc;
}

// Returns the size of the whole object, this is not exact JSON size, for speed it
// summarizes approximate size of each property recursively
//
// - `depth` - limits how deep it goes, on limit returns MAX_SAFE_INTEGER+ number
// - `nan` - if true return NaN on reaching the limits
// - `pad` - extra padding added for each property, default is 5 to simulate JSON encoding, "..": ".."
lib.objSize = function(obj, options, priv)
{
    if (typeof obj != "object") {
        return typeof obj == "string" ? obj.length : String(obj).length;
    }
    var rc = 0, depth = options?.depth || 10, pad = lib.toNumber(options?.pad) || 5;
    if (this.typeName(obj) != "object") obj = { "": obj };
    if (typeof priv?.depth != "number") priv = { depth: 0, seen: new WeakSet() };

    for (const p in obj) {
        let v = obj[p];
        rc += p.length + pad;

        switch (this.typeName(v)) {
        case "array":
            if (priv.depth > depth || priv.seen.has(v)) return options?.nan ? NaN : Number.MAX_SAFE_INTEGER;
            priv.seen.add(v);
            priv.depth++;
            for (const k of v) rc += this.objSize(k, options, priv);
            priv.depth--;
            break;

        case "set":
            if (priv.depth > depth || priv.seen.has(v)) return options?.nan ? NaN : Number.MAX_SAFE_INTEGER;
            priv.seen.add(v);
            v = Array.from(v);
            priv.depth++;
            for (const k of v) rc += this.objSize(k, options, priv);
            priv.depth--;
            break;

        case "map":
            if (priv.depth > depth || priv.seen.has(v)) return options?.nan ? NaN : Number.MAX_SAFE_INTEGER;
            priv.seen.add(v);
            priv.depth++;
            for (const k of v) rc += this.objSize(k[0]) + this.objSize(k[1]);
            priv.depth--;
            break;

        case "error":
            if (priv.depth > depth || priv.seen.has(v)) return options?.nan ? NaN : Number.MAX_SAFE_INTEGER;
            priv.seen.add(v);
            rc += v.message?.length;
            for (const k in v) rc += k.length + this.objSize(k[v], options, priv);
            break;

        case "object":
            if (priv.depth > depth || priv.seen.has(v)) return options?.nan ? NaN : Number.MAX_SAFE_INTEGER;
            priv.seen.add(v);
            priv.depth++;
            rc += this.objSize(v, options, priv);
            priv.depth--;
            break;

        case "string":
        case "buffer":
            rc += v.length;
            break;

        case "function":
            break;

        default:
            v = "" + v;
            rc += v.length;
        }
    }
    return rc;
}

// Reset properties of the `obj` matching the regexp, simple types are removed but objects/arrays/maps are set to empty objects
// Options properties:
// - name - a regexp with property names to be matched
// - type - a regexp of types to be matched
lib.objReset = function(obj, options)
{
    for (const p in obj) {
        if (options?.name && !options.name.test(p)) continue;
        const t = lib.typeName(obj[p]);
        if (options?.type && !options.type.test(t)) continue;
        switch (t) {
        case "object":
            obj[p] = {};
            break;
        case "array":
            obj[p] = [];
            break;
        case "set":
            obj[p] = new Set();
            break;
        case "map":
            obj[p] = new Map();
            break;
        case "weakmap":
            obj[p] = new WeakMap();
            break;
        case "date":
        case "regexp":
        case "number":
        case "string":
        case "boolean":
            delete obj[p];
            break;
        }
    }
}
