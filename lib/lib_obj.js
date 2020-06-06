//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const util = require('util');
const logger = require(__dirname + '/logger');
const lib = require(__dirname + '/lib');
const xml2json = require('xml2json');

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
    case "array":
        if (Array.isArray(name)) return obj.some(function(x) { return name.indexOf(x) > -1 });
        return obj.indexOf(name) > -1;
    }
    return !!obj;
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
            for (var k in o1) o2[k] = o1[k];
            break;
        case "array":
            rc[p] = o1.slice(0);
            break;
        default:
            rc[p] = o1;
        }
    }
    for (var i = 1; i < arguments.length - 1; i += 2) rc[arguments[i]] = arguments[i + 1];
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
    var idx1 = Array.isArray(obj) && options && typeof options.index == "number" ? options.index : 0;

    for (var p in obj) {
        var p1 = idx1 ? lib.toNumber(p) + idx1 : p;
        if (typeof obj[p] == 'object') {
            var obj2 = this.objFlatten(obj[p], options);
            var idx2 = Array.isArray(obj2) && options && typeof options.index == "number" ? options.index : 0;
            for (var x in obj2) {
                var x1 = idx2 ? lib.toNumber(x) + idx2 : x;
                rc[p1 + (options && options.separator ? options.separator : '.') + x1] = obj2[x];
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
    var names = options && util.isRegExp(options.name) ? options.name : null;
    var values = options && util.isRegExp(options.value) ? options.value : null;
    var types = options && util.isRegExp(options.type) ? options.type : null;

    function toClean(type, name, val) {
        if (types && types.test(type)) return 1;
        if (names && names.test(name)) return 1;
        switch (type) {
        case "undefined":
            return 1;
        case "null":
            if (options && options.null) return 1;
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

// Add properties to an existing object, two use cases:
// - the first arg is the object, the rest are pairs: name, value,....
// - the first arg is the object, the second arg is an object to add properties from. In this case
// the third argument can be an options object that can control how the properties are merged.
//
// Options properties:
//  - allow - a regexp which properties are allowed to be merged
//  - ignore - a regexp which properties should be ignored
//  - del - a regexp which properties should be removed
//  - remove - a regexp to apply to each property name before merging, the matching parts will be removed from the name
//  - deep - extend all objects not just the top level
//
//
//         lib.objExtend({ a: 1 }, 'b', 2, 'c' 3 )
//         lib.objExtend({ a: 1 }, { b: 2, c: 3 }, { del: /^a/ })
//         lib.objExtend({ a: 1 }, { b: 2, _c: 3, _d: 4 }, { remove: /^_/ })
//
lib.objExtend = function(obj, val, options)
{
    var rc = arguments[0];
    if (this.typeName(obj) != "object") rc = {};
    if (this.typeName(arguments[1]) == "object") {
        var del = options && options.del && typeof options.del.test == "function" ? options.del : null;
        var rem = options && options.remove && typeof options.remove.test == "function" ? options.remove : null;
        var ignore = options && options.ignore && typeof options.ignore.test == "function" ? options.ignore : null;
        var allow = options && options.allow && typeof options.allow.test == "function" ? options.allow : null;
        if (del) {
            for (const p in rc) {
                if (del.test(p)) delete rc[p];
            }
        }
        for (let p in arguments[1]) {
            if (ignore && ignore.test(p)) continue;
            if (allow && !allow.test(p)) continue;
            var v = arguments[1][p];
            if (rem) p = p.replace(rem, "");
            if (options && options.deep) {
                switch (this.typeName(rc[p])) {
                case "object":
                    this.objExtend(rc[p], v);
                    continue;
                case "array":
                    rc[p].push.apply(rc[p], Array.isArray(v) ? v : [v]);
                    continue;
                }
            }
            rc[p] = v;
        }
    } else {
        for (var i = 1; i < arguments.length - 1; i += 2) {
            rc[arguments[i]] = arguments[i + 1];
        }
    }
    return rc;
}

// Merge two objects, all properties from the `val` override existing properties in the `obj`, returns a new object, shallow copy,
// only top level properties are reassigned.
//
// Options properties:
//  - allow - a regexp which properties are allowed to be merged
//  - ignore - a regexp which properties should be ignored
//  - del - a regexp which properties should be removed
//  - remove - a regexp to apply to each property name before merging, the matching parts will be removed from the name
//
//  Example
//
//       var o = lib.objMerge({ a:1, b:2, c:3 }, { c:5, d:1, _e: 4, x: 2 }, { allow: /^(c|d)/, remove: /^_/ })
//       o = { a:1, b:2, c:5, d:1 }
lib.objMerge = function(obj, val, options)
{
    var rc = {}, v;
    var del = options && options.del && typeof options.del.test == "function" ? options.del : null;
    var rem = options && options.remove && typeof options.remove.test == "function" ? options.remove : null;
    var ignore = options && options.ignore && typeof options.ignore.test == "function" ? options.ignore : null;
    var allow = options && options.allow && typeof options.allow.test == "function" ? options.allow : null;
    for (let p in val) {
        if (typeof val[p] == "undefined") continue;
        if (ignore && ignore.test(p)) continue;
        if (allow && !allow.test(p)) continue;
        v = val[p];
        if (rem) p = p.replace(rem, "");
        rc[p] = v;
    }
    for (const p in obj) {
        if (del && del.test(p)) continue;
        v = obj[p];
        switch (lib.typeName(v)) {
        case "object":
            if (!rc[p]) rc[p] = {};
            for (var c in v) {
                if (typeof rc[p][c] == "undefined") rc[p][c] = v[c];
            }
            break;
        case "null":
        case "undefined":
            break;
        default:
            if (typeof rc[p] == "undefined") rc[p] = v;
        }
    }
    return rc;
}

// Delete properties from the object, first arg is an object, the rest are properties to be deleted
lib.objDel = function()
{
    if (this.typeName(arguments[0]) != "object") return;
    for (var i = 1; i < arguments.length; i++) delete arguments[0][arguments[i]];
    return arguments[0];
}

// Return an object consisting of properties that matched given criteria in the given object or object of objects.
// options can define the following properties:
//
// - exists - search by property name, return all objects that contain given property
// - hasvalue - search by value, return all objects that have a property with given value
// - sort - if set then sort found columns by the property `name` or if it is a string by the given property
// - names - if true just return list of column names
// - flag - if true, return object with all properties set to flag value
// - value - if given return the value of this property, not the whole matched object
// - count - if true return just number of found properties
//
// Example
//
//          lib.objSearch({id:{index:1},name:{index:3},type:{index:2},descr:{}}, { exists: 'index', sort: 1 });
//          { id: { index: 1 }, type: { index: 2 }, name: { index: 3 } }
//
//          lib.objSearch({id:1,name:"test",type:"test",descr:"descr"}, { hasvalue: 'test', count: 1});
//          2
//
lib.objSearch = function(obj, options)
{
    if (!this.isObject(obj) || !options) return options && options.names ? [] : options && options.count ? 0 : {};

    var rc = Object.keys(obj).filter(function(x) {
        if (obj[x] && typeof obj[x] == "object") {
            if (options.exists && typeof obj[x][options.exists] == "undefined") return 0;
            if (typeof options.hasvalue != "undefined" && !Object.keys(obj[x]).some(function(y) { return obj[x][y] == options.hasvalue })) return 0;
        } else {
            if (options.exists && x != options.exists) return 0;
            if (typeof options.hasvalue != "undefined" && obj[x] != options.hasvalue) return 0;
        }
        return 1;
    });
    if (options.count) return rc.length;
    if (options.sort) {
        var sort = typeof options.sort == "string" ? options.sort : options.exists;
        rc = rc.sort(function(a, b) {
            // One level object can only be sorted by property names because the search for more than one item can be done only by value
            if (typeof obj[a] != "object") return a - b;
            return obj[a][sort] - obj[b][sort];
        });
    }
    rc = rc.reduce(function(x,y) {
        x[y] = options.flag || (options.value ? obj[y][options.value] : obj[y]);
        return x;
    }, {});
    if (options.names) return Object.keys(rc);
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
    if (!obj) return options ? (options.list ? [] : options.obj ? {} : options.str ? "" : options.num ? options.dflt || 0 : null) : null;
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
// - incr - increment a numeric property with the given number or 1, non-existing propertties will be initilaized with 0
// - mult - multiply a numeric property with the given number, non-existing properties will be initialized with 0
// - push - add to the array, if it is not an array a new empty aray is created
// - append - append to a string
// - unique - only push if not in the list
// - separator - separator for object names, default is `.`
// - result - "new" - new value, "old" - old value otherwise the object itself
//
// Example
//
//          var a = lib.objSet({}, "response.item.count", 1)
//          lib.objSet(a, "response.item.count", 1, { incr: 1 })
//
lib.objSet = function(obj, name, value, options)
{
    options = options || this.empty;
    if (this.typeName(obj) != "object") obj = {};
    if (!Array.isArray(name)) name = String(name).split(options.separator || ".");
    if (!name || !name.length) return obj;
    var p = name[name.length - 1], v = obj;
    for (var i = 0; i < name.length - 1; i++) {
        if (typeof obj[name[i]] == "undefined") obj[name[i]] = {};
        obj = obj[name[i]];
    }
    var old = obj[p];
    if (options.push) {
        if (!Array.isArray(obj[p])) obj[p] = old = [];
        if (!options.unique || obj[p].indexOf(value) == -1) obj[p].push(value);
    } else
    if (options.append) {
        if (typeof obj[p] != "string") obj[p] = old = "";
        obj[p] += value;
    } else
    if (options.mult) {
        if (typeof obj[p] != "number") obj[p] = old = 0;
        obj[p] *= lib.toNumber(value) || 1;
    } else
    if (options.incr) {
        if (typeof obj[p] != "number") obj[p] = old = 0;
        if (obj[p] >= Number.MAX_SAFE_INTEGER) obj[p] = 0;
        obj[p] += lib.toNumber(value) || 1;
    } else {
        obj[p] = value;
    }
    if (options.result == "old") return old;
    if (options.result == "new") return obj[p];
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
// for arrays it shows the length and `options.count` or 15 first items,
// for objects it will show up to the `options.keys` or 15 first properties,
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
    var ignore = util.isRegExp(options.ignore) ? options.ignore : null;
    var allow = util.isRegExp(options.allow) ? options.allow : null;
    var hide = util.isRegExp(options.hide) ? options.hide : null;
    var length = options.length || 256, nkeys = options.keys || 15, count = options.count || 15, depth = options.depth || 5;
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

        case "array":
            if (v.length || options.keepempty || options.array) {
                if (options.__depth >= depth) {
                    rc += `${rc ? ", " : ""}${p ? p + ": " : ""}{...}`;
                    n++;
                } else {
                    if (typeof options.__depth != "number") options = lib.objClone(options, "__depth", 0);
                    if (!options.__seen) options.__seen = [];
                    if (options.__seen.indexOf(v) > -1) {
                        rc += `${rc ? ", " : ""}${p ? p + ": " : ""}{...}`;
                        n++;
                    } else {
                        options.__seen.push(v);
                        options.__depth++;
                        if (p || v.length) {
                            rc += `${rc ? ", " : ""}${p ? p + ":" : ""}[${v.length || ""}] `;
                            if (!h) rc += v.slice(0, count).map(function(x) { return lib.objDescr(x, options) });
                        }
                        n++;
                        options.__seen.pop();
                        options.__depth--;
                    }
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
                if (!options.__seen) options.__seen = [];
                if (options.__seen.indexOf(v) > -1) {
                    rc += `${rc ? ", " : ""}${p ? p + ": " : ""}{...}`;
                    n++;
                } else {
                    options.__seen.push(v);
                    options.__depth++;
                    v = h ? Object.keys(v).length : this.objDescr(v, options);
                    if (p || v) rc += (rc ? ", " : "") + (p ? p + ": " : "") + "{" + v + "}";
                    n++;
                    options.__seen.pop();
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

// Stringify JSON into base64 string, if secret is given, sign the data with it
lib.jsonToBase64 = function(data, secret, options)
{
    data = this.stringify(data);
    if (secret) return this.encrypt(secret, data, options);
    return Buffer.from(data).toString("base64");
}

// Parse base64 JSON into JavaScript object, in some cases this can be just a number then it is passed as it is, if secret is given verify
// that data is not chnaged and was signed with the same secret
lib.base64ToJson = function(data, secret, options)
{
    var rc = "";
    if (typeof data == "undefined" || data == null) return rc;
    if (secret) data = this.decrypt(secret, data, options);
    try {
        if (typeof data == "number" || (typeof data == "string" && data.match(/^[0-9]+$/))) {
            rc = this.toNumber(data);
        } else {
            if (!secret) data = Buffer.from(data, "base64").toString();
            if (data) rc = JSON.parse(data);
        }
    } catch(e) {
        logger.debug("base64ToJson:", e.stack, data);
    }
    return rc;
}

// Nicely format an object with indentations, optional `indentlevel` can be used to control until which level deep
// to use newlines for objects.
lib.jsonFormat = function(obj, options)
{
    if (typeof options == "string") options = { indent: options, __level: 0 };
    if (!options) options = { __level: 0 };
    if (typeof options.__level != "number") options = lib.objClone(options, "__level", 0);

    // Shortcut to parse and format json from the string
    if (typeof obj == "string" && obj != "") {
        if (!/^[[{.+]}]$/.test(obj.trim())) return obj;
        obj = this.jsonParse(obj, { dflt: { data: obj } });
    }
    if (!options.indent) options.indent = "";
    if (typeof options.nl1 == "undefined") options.nl1 = "\n";
    if (typeof options.nl2 == "undefined") options.nl2 = "\n";
    if (typeof options.sbracket1 == "undefined") options.sbracket1 = "[";
    if (typeof options.sbracket2 == "undefined") options.sbracket2 = "]";
    if (typeof options.cbracket1 == "undefined") options.cbracket1 = "{";
    if (typeof options.cbracket2 == "undefined") options.cbracket2 = "}";
    if (typeof options.quote1 == "undefined") options.quote1 = '"';
    if (typeof options.quote2 == "undefined") options.quote2 = '"';
    if (typeof options.space == "undefined") options.space = "    ";
    if (typeof options.comma == "undefined") options.comma = ", ";
    if (typeof options.sep == "undefined") options.sep = ", ";

    var type = this.typeName(obj);
    var count = 0, val, h;
    var text = type == "array" ? options.sbracket1 : options.cbracket1;
    // Insert newlines only until specified level deep
    var nline = !options.indentlevel || options.__level < options.indentlevel;

    for (var p in obj) {
        if (options.ignore && options.ignore.test(p)) continue;
        val = obj[p];
        if (typeof options.preprocess == "function") {
            val = options.preprocess(p, val, options);
            if (typeof val == "undefined") continue;
        }
        h = options.hide && options.hide.test(p);
        if (count > 0) {
            text += type == "array" ? options.sep : options.comma;
        }
        if (type != "array") {
            text += ((nline ? (!options.__level && !count ? "" : options.nl1) +
                     options.indent + options.space : " ") +
                     options.quote1 + p + options.quote2 + ": ");
        }
        switch (this.typeName(val)) {
        case "array":
        case "object":
            if (h) {
                text += Array.isArray(val) ? val.length : Object.keys(val).length + "...";
                break;
            }
            if (!options.__seen) options.__seen = [];
            if (options.__seen.indexOf(val) > -1) {
                text += "...";
                break;
            }
            options.__seen.push(val);
            options.indent += options.space;
            options.__level++;
            text += this.jsonFormat(val, options);
            options.__level--;
            options.__seen.pop(val);
            options.indent = options.indent.substr(0, options.indent.length - options.space.length);
            break;
        case "boolean":
        case "number":
            text += h ? "..." : val.toString();
            break;
        case "null":
            text += "null";
            break;
        case "string":
            text += h ? "..." : (options.quote1 + val + options.quote2);
            break;
        default:
            text += ("unknown: " + typeof(val));
        }
        count++;
    }
    text += type == "array" ? options.sbracket2 : ((nline ? options.nl2 + options.indent : " ") + options.cbracket2);
    return text;
}

// JSON stringify without exceptions, on error just returns an empty string and logs the error
lib.stringify = function(obj, filter)
{
    try {
        return this.escapeUnicode(JSON.stringify(obj, filter));
    } catch(e) {
        logger.error("stringify:", e);
        return "";
    }
}

// Silent JSON parse, returns null on error, no exceptions raised.
//
// options can specify the following properties:
//  - datatype - make sure the result is returned as type: obj, list, str
//  - dflt - return this in case of error
//  - logger - report in the log with the specified level, log, debug, ...
lib.jsonParse = function(obj, options)
{
    return _parse("json", obj, options);
}

// Same arguments as for `jsonParse`
lib.xmlParse = function(obj, options)
{
    return _parse("xml", obj, options);
}

// Combined parser with type validation
function _parse(type, obj, options)
{
    if (!obj) return _checkResult(type, lib.newError("empty " + type), obj, options);
    try {
        obj = _parseResult(type, obj, options);
    } catch(err) {
        obj = _checkResult(type, err, obj, options);
    }
    return obj;
}

function _parseResult(type, obj, options)
{
    if (typeof obj == "string") {
        switch (type) {
        case "json":
            obj = JSON.parse(obj);
            break;
        case "xml":
            var opts = { object: true };
            for (var p in options) {
                if (["trim","coerce","sanitize","arrayNotation","reversible"].indexOf(p) > -1) opts[p] = options[p];
            }
            obj = xml2json.toJson(obj, opts);
            break;
        }
    }
    switch (options && options.datatype) {
    case "object":
        if (typeof obj != "object" || !obj) return options.dflt || {};
        break;
    case "obj":
        if (lib.typeName(obj) != "object") return options.dflt || {};
        break;
    case "list":
        if (lib.typeName(obj) != "array") return options.dflt || [];
        break;
    case "str":
        if (lib.typeName(obj) != "string") return options.dflt || "";
        break;
    }
    return obj;
}

// Perform validation of the result type, make sure we return what is expected, this is a helper that is used by other conversion routines
function _checkResult(type, err, obj, options)
{
    if (options) {
        if (options.logger) logger.logger(options.logger, 'parse:', type, options, lib.traceError(err), obj);
        if (options.errnull) return null;
        if (options.dflt) return options.dflt;
        if (options.datatype == "object" || options.datatype == "obj") return {};
        if (options.datatype == "list") return [];
        if (options.datatype == "str") return "";
    }
    return null;
}
