/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const util = require('util');
const lib = require(__dirname + '/../lib');


/**
 * Return the length of an array or 0 if it is not an array
 * @param {any[]} list
 * @return {int}
 * @memberof module:lib
 * @method arrayLength
 */
lib.arrayLength = function(list)
{
    return Array.isArray(list) && list.length || 0;
}

/**
 * Remove the given item from the list in place, returns the same list
 * @param {any[]} list
 * @param {any} item
 * @return {any[]}
 * @memberof module:lib
 * @method arrayRemove
 */
lib.arrayRemove = function(list, item)
{
    var idx = this.isArray(list, this.emptylist).indexOf(item);
    if (idx > -1) list.splice(idx, 1);
    return list;
}

/**
 * Returns only unique items in the array, optional `key` specified the name of the column to use when determining uniqueness if items are objects.
 * @param {any[]} list
 * @param {string} key
 * @memberof module:lib
 * @method arrayUnique
 */
lib.arrayUnique = function(list, key)
{
    if (!Array.isArray(list)) {
        return this.split(list, null, { unique: 1 });
    }
    var rc = [], keys = {};
    list.forEach((x) => {
        if (key) {
            if (!keys[x[key]]) rc.push(x);
            keys[x[key]] = 1;
        } else {
            if (rc.indexOf(x) == -1) rc.push(x);
        }
    });
    return rc;
}

/**
 * Returns true if both arrays contain same items, only primitive types are supported
 * @param {any[]} list1
 * @param {any[]} list2
 * @memberof module:lib
 * @method @memberof module:lib
 * @method arrayEqual
 */
lib.arrayEqual = function(list1, list2)
{
    if (!Array.isArray(list1) || !Array.isArray(list2) || list1.length != list2.length) return false;
    for (let i = 0; i < list1.length; ++i) {
        if (!list2.includes(list1[i])) return false;
    }
    return true;
}

/**
 * Flatten array of arrays into a single array
 * @param {any[]} list
 * @memberof module:lib
 * @method arrayFlatten
 */
lib.arrayFlatten = function(list)
{
    list = Array.prototype.concat.apply([], list);
    return list.some(Array.isArray) ? this.arrayFlatten(list) : list;
}

/**
 * A shallow copy of an object, still it is deeper than Object.assign for arrays, objects, sets and maps,
 * these created new but all other types are just references as in Object.assign
 * @param {object} obj - first argument is the object to clone, can be null
 * @param {...any} [args] - additional arguments are treated as object to be merged into the result using Object.assign
 * @return {object}
 * @example
 *    const a = { 1: 2, a: [1, 2] }
 *    const b = lib.clone(a, { "3": 3, "4": 4 })
 *    b.a.push(3)
 *    a.a.length != b.length
 * @memberof module:lib
 * @method clone
 */
lib.clone = function(obj, ...args)
{
    var rc = Array.isArray(obj) ? [] : {}, o1, o2;
    for (const p in obj) {
        if (!obj.hasOwnProperty(p)) continue;
        o1 = obj[p];
        switch (this.typeName(o1)) {
        case "object":
            rc[p] = Object.assign({}, o1);
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
    for (const arg of args) {
        Object.assign(rc, arg);
    }
    return rc;
}

/**
 * Flatten a javascript object into a single-depth object, all nested values will have property names appended separated by comma
 * @param {object} obj
 * @param {object} [options]
 *  - separator - use something else instead of .
 *  - index - initial index for arrays, 0 is default
 *  - ignore - regexp with properties to ignore
 * @return {object}
 * @example
 * > lib.flatten({ a: { c: 1 }, b: { d: 1 } } )
 * { 'a.c': 1, 'b.d': 1 }
 * > lib.flatten({ a: { c: 1 }, b: { d: [1,2,3] } }, { index: 1 })
 * { 'a.c': 1, 'b.d.1': 1, 'b.d.2': 2, 'b.d.3': 3 }
 * @memberof module:lib
 * @method flatten
 */
lib.flatten = function(obj, options)
{
    var rc = {};
    var idx1 = Array.isArray(obj) && typeof options?.index == "number" ? options.index : 0;
    var sep = options?.separator || '.';

    for (const p in obj) {
        if (typeof options?.ignore?.test == "function" && options.ignore.test(p)) continue;

        var p1 = idx1 ? lib.toNumber(p) + idx1 : p;
        if (typeof obj[p] == 'object') {
            var obj2 = this.flatten(obj[p], options);
            var idx2 = Array.isArray(obj2) && typeof options?.index == "number" ? options.index : 0;
            for (var x in obj2) {
                var x1 = idx2 ? lib.toNumber(x) + idx2 : x;
                rc[p1 + sep + x1] = obj2[x];
            }
        } else {
            if (typeof obj[p] != "undefined") rc[p1] = obj[p];
        }
    }
    return rc;
}

/**
 * Extend the object with properties similar to Object.assign but perform deep merge
 * @param {object} obj
 * @param {object[]} ...args
 * @return {object}
 * @example
 * lib.extend({ a:1, c:5 }, { c: { b: 2 }, d: [{ d: 3 }] }, { c: { a: 2 }})
 * { a: 1, c: { b: 2, a: 2 }, d: [ { d: 3 } ] }
 * @memberof module:lib
 * @method extend
 */
lib.extend = function(obj, ...args)
{
    obj = typeof obj == "object" || typeof obj == "function" ? obj || {} : {};
    for (const val of args) {
        for (const p in val) {
            const v = val[p];
            if (v === obj) continue;
            if (p === "__proto__") continue;
            if (v) {
                if (Array.isArray(v)) {
                    obj[p] = this.extend(Array.isArray(obj[p]) ? obj[p] : [], v);
                    continue;
                } else
                if (this.typeName(v) === "object") {
                    obj[p] = this.extend(obj[p], v);
                    continue;
                }
            }
            obj[p] = v;
        }
    }
    return obj;
}

/**
 * Return a property from the object, name specifies the path to the property, if the required property belong to another object inside the top one
 * the name uses . to separate objects. This is a convenient method to extract properties from nested objects easily.
 * @param {object} obj
 * @param {string} name
 * @param {object} [options]
 * Options may contains the following properties:
 *   - list - return the value as a list even if there is only one value found
 *   - obj - return the value as an object, if the result is a simple type, wrap into an object like { name: name, value: result }
 *   - str - return the value as a string, convert any other type into string
 *   - num - return the value as a number, convert any other type by using toNumber
 *   - func - return the value as a function, if the object is not a function returns null
 *   - owner - return the owner object, not the value, i.e. return the object who owns the value specified in the name
 * @Return {any}
 * @example
 * > lib.objGet({ response: { item : { id: 123, name: "Test" } } }, "response.item.name")
 * "Test"
 * > lib.objGet({ response: { item : { id: 123, name: "Test" } } }, "response.item.name", { list: 1 })
 * [ "Test" ]
 * > lib.objGet({ response: { item : { id: 123, name: "Test" } } }, "response.item.name", { owner: 1 })
 * { item : { id: 123, name: "Test" } }
 * @memberof module:lib
 * @method objGet
 */
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

/**
 * Set a property of the object, name can be an array or a string with property path inside the object, all non existent intermediate
 * objects will be create automatically. The options can have the folowing properties:
 * @param {object} obj
 * @param {string} name
 * @param {any} value
 * @param {object} [options]
 * - incr - increment a numeric property with the given number or 1, 0 is noop, non-existing propertties will be initilaized with 0
 * - mult - multiply a numeric property with the given number, non-existing properties will be initialized with 0
 * - push - add to the array, if it is not an array a new empty aray is created
 * - append - append to a string
 * - unique - only push if not in the list
 * - separator - separator for object names, default is `.`
 * - result - "new" - new value, "old" - old value, "obj" - final object, otherwise the original object itself
 * @return {any}
 * @example
 * var a = lib.objSet({}, "response.item.count", 1)
 * lib.objSet(a, "response.item.count", 1, { incr: 1 })
 * @memberof module:lib
 * @method objSet
 */
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

/**
 * Increment a property by the specified number, if the property does not exist it will be created,
 * returns new incremented value or the value specified by the `result` argument.
 * It uses `lib.objSet` so the property name can be a nested path.
 * @param {object} obj
 * @param {string} name
 * @param {number} count
 * @param {string} [result=new]
 * @memberof module:lib
 * @method objIncr
 */
lib.objIncr = function(obj, name, count, result)
{
    return this.objSet(obj, name, count, { incr: 1, result: result || "new" });
}

/**
 * Similar to `objIncr` but does multiplication
 * @param {object} obj
 * @param {string} name
 * @param {number} count
 * @param {strings} [result=new]
 * @memberof module:lib
 * @method objMult
 */
lib.objMult = function(obj, name, count, result)
{
    return this.objSet(obj, name, count, { mult: 1, result: result || "new" });
}

/**
 * Return all property names for an object
 * @param {object} obj
 * @return {string[]}
 * @memberof module:lib
 * @method objKeys
 */
lib.objKeys = function(obj)
{
    return this.isObject(obj) ? Object.keys(obj) : [];
}

/**
 * Calculate the size of the whole object, this is not exact JSON size, for speed it
 * summarizes approximate size of each property recursively
 * @param {object} [options]
 * @param {int} [options.depth] - limits how deep it goes, on limit returns MAX_SAFE_INTEGER+ number
 * @param {boolean} [options.nan] - if true return NaN on reaching the limits
 * @param {int} [options.pad] - extra padding added for each property, default is 5 to simulate JSON encoding, "..": ".."
 * @return {int} the size of the whole object
 * @memberof module:lib
 * @method objSize
 */
lib.objSize = function(obj, options, priv)
{
    if (typeof obj != "object") {
        return typeof obj == "string" ? obj.length : String(obj).length;
    }
    if (util.types.isProxy(obj)) return 0;

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

        case "proxy":
        case "function":
            break;

        default:
            v = "" + v;
            rc += v.length;
        }
    }
    return rc;
}
