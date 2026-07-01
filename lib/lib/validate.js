/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
'use strict';

const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');


/**
 * @param {...any} args
 * @return {number} first valid number from the list of arguments or 0
 * @memberof module:lib
 * @method validNumber
 */
lib.validNumber = function(...args)
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
 * @method validPositive
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
 * @method validBool
 */
lib.validBool = function(...args)
{
    for (const i in args) {
        if (typeof args[i] === "boolean") return args[i];
    }
    return false;
}

/**
 * @param {...any} args
 * @return {any} first non empty value or undefined
 * @memberof module:lib
 * @method validValue
 */
lib.validValue = function(...args)
{
    for (const i in args) {
        if (args[i]) return args[i];
    }
    return;
}

/**
 * @param {...any} args
 * @return {any} first function
 * @memberof module:lib
 * @method validFunc
 */
lib.validFunc = function(...args)
{
    for (const i in args) {
        if (typeof args[i] === "function") return args[i];
    }
    return;
}

/**
 * @param {string} version
 * @param {string} [condition] - can be: >=M.N, >M.N, =M.N, <=M.N, <M.N, M.N-M.N
 * @eturn {boolean} true if the version is within given condition(s), always true if either argument is empty.
 * @memberof module:lib
 * @method validVersion
 */
lib.validVersion = function(version, condition)
{
    if (!version || !condition) return true;
    version = typeof version === "number" ? version : lib.toVersion(version);
    condition = lib.split(condition);
    if (!condition.length) return true;
    return condition.some((x) => {
        const d = x.match(this.rxVersion);
        if (!d) return false;
        return d[3] ? lib.isTrue(version, [lib.toVersion(d[3]), lib.toVersion(d[4])], "between", "number") :
                      lib.isTrue(version, lib.toVersion(d[2]), d[1] || ">=", "number");
    });
}


/**
 * An object to be used with {@link module:lib.validate} for object validation against a schema and converting to a desired type
 * @typedef {object} ValidateOptions
 * @memberof module:lib
 * @property {boolean} name - to save a value with different name than in the original query
 * @property {string} [type] - convert the input to the type format, default text
 *   Supported types:
 *   - string types: string, text, uuid
 *   - boolean types: bool, boolean,
 *   - numeric types: int, bigint, long, number, float, real, double, counter, clock, now, random
 *   - object types: list, map, obj, object, array, json,
 *   - date/time types: mtime, date, time, timestamp, datetime
 *   - special types: set, email, symbol, url, phone, e164, regexp
 *
 * @property {boolean} [dflt] - use this value if property does not exists or undefined
 * @property {boolean} [dfltempty] - also use the dflt value for empty properties
 * @property {boolean} [required] - if true the target value must not be empty, the check is performed after type conversion,
 *       if an object it checks the target object using `lib.isMatched` at the end
 * @property {boolean} [errmsg] - return this error on error or invalid format or required condition,
 *  it may contain @..@ placeholders refering properties from the field object, the final message will be
 *  processed by {@link module:lib.toTemplate}. Any properties listed here can be used like @label@, @max@, @maxdate||date@
 * @property {boolean} [min] - minimum length for the target data, returns an error if smaller, for list type will skip item from the list
 * @property {boolean} [max] -  maximum length alowed, returns an error if longer
 * @property {boolean} [trunc] - if true and longer than max just truncate the value instead of returning an error or skipping
 * @property {boolean} [separator] - for list type default separator is `,|`, for map type default is `:;`
 * @property {boolean} [delimiter] - map type contains elements separated by , by default, use another if commas are expected
 * @property {boolean} [regexp] - validate input against this regexp and return an error if not matched, for list type skip items not matched
 * @property {boolean} [noregexp] - validate the input against this regexp and return an error if matched, for list type skip items matched
 * @property {boolean} [maptype] - for maps convert each value to this type
 * @property {boolean} [novalue] - if the target value equals then ignore the parameter,
 *       can be a list of values to be ignored or an object { name, value }.
 *       For lists this is a number of items in the list, if less or equal the list is ignored or reset.
 * @property {boolean} [ignore] - if true skip this parameter
 * @property {boolean} [optional] - for date types, if true do not assign the current time for empty values
 * @property {boolean} [base64] - decode from base64 for json and text values
 * @property {boolean} [value] - assign this value unconditionally
 * @property {boolean} [values] - a list of allowed values, if not present the parameter is ignored
 * @property {boolean} [values_map] - an object map for values, replace matching values with a new one
 * @property {boolean} [params] - an object with schema to validate for json/obj/array types, options is passed
 * @property {boolean} [empty] - if true and the target value is empty return as empty, by default empty values are ignored
 * @property {boolean} [setempty] - to be used with `empty`, instead of skipping set with this value at the end
 * @property {boolean} [keepempty] - for list type keep empty items in the list, default is skip empty items
 * @property {boolean} [minlist] - min allowed length of the target array for list/map types, returns error if less
 * @property {boolean} [maxlist] - max allowed length of the target array for list/map types, returns error if longer
 * @property {boolean} [minnum] - min allowed number after convertion by toNumber, for numbers and mtime
 * @property {boolean} [maxnum] - max allowed number after convertion by toNumber, for numbers and mtime
 * @property {boolean} [mindate] - min allowed date after convertion by toDate, can be a Date or number
 * @property {boolean} [maxdate] - max allowed date after convertion by toDate, can be a Date or number
 * @property {boolean} [label] - alternative name to use in error messages instead of the internal property name, if not set the name is used.
 * @property {boolean} [datatype] - convert each value or item into this type, used by string/list types
 * @property {boolean} [strip] - a regexp with characters to strip from the final value
 * @property {boolean} [upper/lower] - transform case
 * @property {boolean} [cap] - capitalize the value
 * @property {boolean} [trim] - trim the final value if a string
 * @property {boolean} [replace] - an object map with characters to be replaced with other values
 */

/**
 * Process incoming query and convert parameters according to the type definition, the schema contains the definition of the paramaters against which to
 * validate incoming data. It is an object with property names and definitoons that at least must specify the type, all other options are type specific.
 *
 * This validation serves 2 purposes:
 * - verify error conditions for the converted fields
 * - convert incoming user data into desired types, means the schema is not strict in the sense that all incoming data must be of desired type,
 * all transformations like strip/replace.... are run in the order as defined in the schema object to control order of changes
 *
 * For example if we need a numeric code from a user sent, it is ok to receive it as string and convert, if there are no more conditions check we
 * we work with the number. If there are range checks then in case of error we will notify the user or service about it.
 *
 * @param {object} query - request query object, usually req.context.query or req.context.body
 * @param {object} schema - an object in format: { name: {@link module:lib.ValidateOptions}, ...}
 * @param {object} [options] - options can define the following properties to customize convertion:
 * @param {boolean} [options.setnull] - if the value is equal this or any value if an array then set property to null, useful to reset lists, maps...
 * @param {boolean} [options.existing] - skip properties if not present in the query
 * @param {string} [options.prefix] - prefix to be used when searching for the parameters in the query, only properties with this prefix will be processed. The resulting
 *  object will not have this prefix in the properties.
 * @param {string} [options.dprefix] - prefix to use when checking for defaults, defaults are checks in this order: dprefix+name, name, *.type, *
 * @param {object} [options.defaults] - to pass realtime or other custom options for the validation or convertion utilities as the first argument if not defined in the definition,
 *  this is the place to customize/add/override global parameter conditions without changing it.
 *  Exact parameter name is used or a wildcard in the format
 *   `*.type` where type is any valid type supported or just `*` for all parameters. Special default '**' is always applied to all parameters.
 * @return {{err:object, data:object}} an object with properties:
 * - `err` - on error it is an object { status, message, name, code },
 * - `data` - validated object if no error
 *
 * @example <caption>User login form validation</caption>
 *
 * api.app.post("/login", (context) => {
 *
 *     const { err, data } = api.validate(context, {
 *         login: { type: "email", required: 1 },
 *         password: { required: 1 },
 *         code: { type: "int", minnum: 100000 },
 *     });
 *     if (err) return lib.tryCall(callback, err);
 *
 * });
 *
 * @example <caption>Show most fields at once for review purposes</caption>
 *
 * const { err, data } = lib.validate(context.context.body, {
 *        id: { type: "int" },
 *        uid: { type: "uuid" },
 *        count: { type: "int", min: 1, max: 10, dflt: 5 },
 *        age: { type: "int", minnum: 10, maxnum: 99 },
 *        name: { type: "string", max: 32, trunc: 1 },
 *        pair: { type: "map", maptype: "int" },
 *        code: { type: "string", regexp: /^[a-z]-[0-9]+$/, errmsg: "Valid code is required for @label@" },
 *        start: { type: "token", required: 1 },
 *        email: { type: "list", datatype: "email", novalue: ["a@a"] },
 *        email1: { type: "email", required: { email: null } },
 *        data: { type: "json", datatype: "obj" },
 *        mtime: { type: "mtime", name: "timestamp" },
 *        date: { type: "date", mindate: new Date(2000,1,1) },
 *        flag: { type: "bool", novalue: false },
 *        descr: { novalue: { name: "name", value: "test" }, replace: { "<": "!" } },
 *        internal: { ignore: 1 },
 *        tm: { type: "timestamp", optional: 1 },
 *        ready: { value: "ready" },
 *        state: { values: [ "ok","bad","good" ] },
 *        status: { value: [ "ok","done" ] },
 *        obj: { type: "obj", params: { id: { type: "int" }, name: {} } },
 *        arr: { type: "array", params: { id: { type: "int" }, name: {} } },
 *        ssn: { type: "string", regexp: /^[0-9]{3}-[0-9]{3}-[0-9]{4}$/, errmsg: "Valid SSN is required for @label@" },
 *        phone: { type: "list", datatype: "number" },
 *        }, {
 *        defaults: {
 *            start: { secret: req.user.secret },
 *            name: { dflt: "test" },
 *            count: { max: 100 },
 *            email: { ignore: req.user.roles != "admin" },
 *            "*.string": { max: 255 },
 *            "*": { maxlist: 255 },
 *            "**" : { max: 512 }
 *        });
 *
 * if (err) return context.reply(err);
 *
 * @memberof module:lib
 * @method validate
 */
lib.validate = function(query, schema, options)
{
    const onError = (opts, name, value, errmsg) => {
        errmsg = lib.toTemplate(opts.errmsg || errmsg, [{ label: opts.label || name, name, value }, opts]);
        return { err: { status: 400, message: errmsg, name, code: "validate" } };
    };
    var data = Object.create(null), opts, dopts, dflts, p, n, v, e, required = [];
    dflts = options?.defaults || lib.empty;

    for (const name in schema) {
        v = schema[name];
        switch (this.typeName(v)) {
        case "undefined":
            continue;
        case "object":
            if (v.ignore) continue;
            break;
        default:
            v = { value: v };
        }
        opts = {};
        for (const c in v) opts[c] = v[c];
        dopts = (options?.dprefix ? dflts[options.dprefix + name] : null) ||
                dflts[name] ||
                dflts[`${name}.${opts.type}`] ||
                dflts[`*.${opts.type || "string"}`] ||
                dflts['*'];

        for (const p in dopts) if (opts[p] === undefined) opts[p] = dopts[p];
        for (const p in dflts["**"]) if (opts[p] === undefined) opts[p] = dflts["**"][p];
        if (opts.ignore) continue;

        opts.name = n = opts.name || name;
        p = options?.prefix ? options.prefix + name : name;
        if (options?.existing && !(p in query)) continue;
        v = query[p];
        if (options?.setnull && (options.setnull === v || lib.includes(options.setnull, v))) {
            data[n] = null;
            continue;
        }
        if (v === undefined || (opts.dfltempty && this.isEmpty(v))) v = opts.dflt;
        if (opts.value !== undefined) {
            let val = opts.value;
            switch (this.typeName(val)) {
            case "object":
                val = [ val ];
            case "array":
                for (const i in val) {
                    const cond = val[i];
                    if (this.isTrue(cond.name ? data[cond.name] : v, cond.value, cond.op, cond.type || opts.type)) {
                        opts.type = "set";
                        v = cond.set;
                        break;
                    }
                }
                break;
            default:
                opts.type = "set";
                v = val;
            }
        }
        logger.dev("validate:", name, n, typeof v, v, "O:", opts, "D:", dopts);

        switch (opts.type) {
        case "set":
            if (v === undefined) {
                delete data[n];
            } else {
                data[n] = v;
            }
            break;

        case "boolean":
        case "bool":
            if (v !== undefined) data[n] = this.toBool(v, opts.dflt);
            break;

        case "real":
        case "float":
        case "double":
            opts.float = 1;
            if (v !== undefined) data[n] = this.toNumber(v, opts);
            break;

        case "int":
        case "long":
        case "bigint":
        case "counter":
        case "clock":
        case "now":
        case "random":
            opts.float = 0;
        case "number":
            if (v !== undefined) data[n] = this.toNumber(v, opts);
            break;

        case "regexp":
            if (typeof v !== "string") break;
            if (opts.max > 0 && v.length > opts.max) {
                return onError(opts, name, v, "@label@ is too long, the max length is @max@");
            }
            data[n] = this.toRegexp(v, opts);
            break;

        case "list":
            if (!v && !opts.empty) break;
            v = opts.keepempty ? (Array.isArray(v) ? v : this.phraseSplit(v, opts)) : this.split(v, opts.separator, opts);
            if (Array.isArray(opts.values)) v = v.filter((x) => (opts.values.indexOf(x) > -1));
            if (Array.isArray(opts.novalue)) v = v.filter((x) => (opts.novalue.indexOf(x) === -1));
            if (opts.minlist > 0 && v.length < opts.minlist) {
                return onError(opts, name, v, "@label@ is too short, the min size is @minlist@");
            }
            if (opts.maxlist > 0 && v.length > opts.maxlist) {
                if (!opts.trunc) {
                    return onError(opts, name, v, "@label@ is too long, the max size is @maxlist@")
                }
                v = v.slice(0, opts.maxlist);
            }
            if (!v?.length && !opts.empty) break;
            if (v && opts.flatten) v = this.arrayFlatten(v);
            data[n] = v || [];
            break;

        case "map":
            if (!v && !opts.empty) break;
            v = lib.split(v, opts.delimiter || ",");
            if (opts.maxlist > 0 && v.length > opts.maxlist) {
                if (!opts.trunc) {
                    return onError(opts, name, v, "@label@ is too long, the max size is @maxlist@")
                }
                v = v.slice(0, opts.maxlist);
            }
            v = v.map((x) => (lib.split(x, opts.separator || /[:;]/, opts))).
                  reduce((a, b) => {
                      if (b.length < 2) return a;
                      a[b[0]] = b.length === 2 ? b[1] : b.slice(1);
                      if (opts.maptype) a[b[0]] = lib.toValue(a[b[0]], opts.maptype, opts);
                      return a;
                  }, Object.create(null));
            if (this.isEmpty(v) && !opts.empty) break;
            if (!data[n]) data[n] = Object.create(null);
            for (const p in v) data[n][p] = v[p];
            break;

        case "obj":
            if (!v && !opts.empty) break;
            e = this.validate(v || lib.empty, opts.params, options);
            if (e.err) return onError(opts, name, v, e.err.message);
            v = e.data;
            if (opts.max > 0 && lib.objSize(v) > opts.max) {
                return onError(opts, name, v, "@label@ is too large, the max size is @opts.max@")
            }
            if (!this.isEmpty(v) || opts.empty) data[n] = v;
            break;

        case "object":
            if (!lib.isObject(v)) break;
            if (opts.params) {
                e = this.validate(v, opts.params, options);
                if (e.err) return onError(opts, name, v, e.err.message);
                v = e.data;
            }
            if (opts.max > 0 && lib.objSize(v) > opts.max) {
                return onError(opts, name, v, "@label is too large, the max size is @max@")
            }
            if (!this.isEmpty(v) || opts.empty) data[n] = v;
            break;

        case "array":
            if (!v && !opts.empty) break;
            v = lib.isArray(v, []);
            if (opts.params) {
                const list = [];
                for (let a of v) {
                    a = lib.validate(a, opts.params, options)
                    if (a.err) return onError(opts, name, v, a.err.message);
                    list.push(a.data);
                }
                v = list;
            }
            if (opts.minlist > 0 && v.length < opts.minlist) {
                return onError(opts, name, v, "@label@ is too short, the min length is @minlist@")
            }
            if (opts.maxlist > 0 && v.length > opts.maxlist) {
                if (!opts.trunc) {
                    return onError(opts, name, v, "@label@ is too long, the max length is @maxlist@")
                }
                v = v.slice(0, opts.maxlist);
            }
            if (v.length || opts.empty) data[n] = v;
            break;

        case "token":
            if (!v) break;
            if (opts.max > 0 && v.length > opts.max) {
                return onError(opts, name, v, "@label@ is too long, the max length is @max@");
            }
            data[n] = this.base64ToJson(v, opts.secret);
            break;

        case "mtime":
            if (!v) break;
            v = this.toDate(v, opts.dflt, true);
            if (v) {
                if (opts.mindate && v < opts.mindate) {
                    return onError(opts, name, v, "@label@ is too soon, the earliest date is @mindate||date@");
                }
                if (opts.maxdate && v > opts.maxdate) {
                    return onError(opts, name, v, "@label@ is too late, the latest date is @maxdate||date@");
                }
                data[n] = v.getTime();
            }
            break;

        case "date":
        case "time":
            if (v) v = this.toDate(v, opts.dflt, true);
            if (v) {
                if (opts.mindate && v < opts.mindate) {
                    return onError(opts, name, v, "@label@ is too soon, the earliest date is @mindate||date@");
                }
                if (opts.maxdate && v > opts.maxdate) {
                    return onError(opts, name, v, "@label@ is too late, the latest date is @maxdate||date@");
                }
                data[n] = v;
            }
            break;

        case "datetime":
            if (!opts.optional && (!v || (typeof v === "boolean" && v))) v = Date.now();
            if (v) v = this.toDate(v, opts.dflt);
            if (v) {
                if (opts.mindate && v < opts.mindate) {
                    return onError(opts, name, v, "@label@ is too soon, the earliest date is @mindate||date@");
                }
                if (opts.maxdate && v > opts.maxdate) {
                    return onError(opts, name, v, "@label@ is too late, the latest date is @maxdate||date@");
                }
                data[n] = this.strftime(v, opts.format || "%Y/%m/%d %H:%M");
            }
            break;

        case "timestamp":
            if (!opts.optional && (!v || (typeof v === "boolean" && v))) v = Date.now();
            if (v) v = this.toDate(v, opts.dflt, true);
            if (v) {
                if (opts.mindate && v < opts.mindate) {
                    return onError(opts, name, v, "@label@ is too soon, the earliest date is @mindate||date@");
                }
                if (opts.maxdate && v > opts.maxdate) {
                    return onError(opts, name, v, "@label@ is too late, the latest date is @maxdate||date@");
                }
                data[n] = opts.format ? this.strftime(v, opts.format) : v.toISOString();
            }
            break;

        case "json":
            if (typeof v !== "string") break;
            if (opts.max > 0 && v.length > opts.max) {
                return onError(opts, name, v, "@label@ is too long, the max length is @max@");
            }
            if (opts.base64) {
                v = Buffer.from(v, "base64").toString();
            }
            v = this.jsonParse(v, opts);
            if (opts.params) {
                const e = this.validate(v, opts.params, options);
                if (e.err) return onError(opts, name, v, e.err.message);
                v = e.data;
            }
            if (v || opts.empty) data[n] = v;
            break;

        default:
            if (typeof v === "undefined" || v === null) break;
            v = typeof v === "string" ? v : String(v);

            switch (opts.type) {
            case "symbol":
            case "email":
            case "phone":
            case "e164":
            case "url":
            case "uuid":
                if (v) {
                    v = this.toValue(v.trim(), opts.type, opts);
                }
                break;
            }
            if (opts.trim) v = v.trim();
            if (opts.base64) {
                v = Buffer.from(v, "base64").toString();
            }

            if (opts.max && v.length > opts.max) {
                if (!opts.trunc) {
                    return onError(opts, name, v, "@label@ is too long, the max length is @max@");
                }
                v = v.substr(0, opts.max);
            }
            if (opts.min > 0 && v.length < opts.min) {
                return onError(opts, name, v, "@label@ is too short, the min length is @min@");
            }

            if (opts.noregexp) {
                const rx = lib.isArray(opts.noregexp, [opts.noregexp]);
                if (rx.some((r) => (lib.testRegexp(v, r)))) {
                    if (!opts.required && opts.errmsg) {
                        return onError(opts, name, v, "invalid characters in @label@");
                    }
                    break;
                }
            } else

            if (opts.regexp) {
                const rx = lib.isArray(opts.regexp, [opts.regexp]);
                if (!rx.some((r) => (lib.testRegexp(v, r)))) {
                    if (!opts.required && opts.errmsg) {
                        return onError(opts, name, v, "invalid characters in @label@");
                    }
                    break;
                }
            }

            // Run all transforms in the order of definition
            for (const p in opts) {
                switch (p) {
                case "replace":
                    for (const p in opts.replace) {
                        v = v.replaceAll(p, opts.replace[p]);
                    }
                    break;
                case "strip":
                    v = v.replace(opts.strip, "");
                    break;
                case "upper":
                    v = v.toUpperCase();
                    break;
                case "lower":
                    v = v.toLowerCase();
                    break;
                case "camel":
                    v = lib.toCamel(v, opts.camel);
                    break;
                case "cap":
                    v = lib.toTitle(v, opts.cap);
                    break;
                case "datatype":
                    v = lib.toValue(v, opts.datatype, opts);
                    break;
                }
            }
            if (!v && !opts.empty) break;
            data[n] = v;
            break;
        }
        v = data[n];
        if (this.isEmpty(v)) {
            if (opts.setempty !== undefined) {
                v = data[n] = opts.setempty;
            }
        } else {
            switch (opts.type) {
            case "list":
                if (typeof opts.novalue === "number" && v.length <= opts.novalue) {
                    delete data[n];
                }
                break;

            default:
                if (typeof v === "number") {
                    if (opts.maxnum && v > opts.maxnum) {
                        return onError(opts, name, v, "@label@ is too large, the max value is @maxnum@");
                    }
                    if (opts.minnum > 0 && v < opts.minnum) {
                        return onError(opts, name, v, "@label@ is too small, the min value is @minnum@");
                    }
                }
                if (Array.isArray(opts.values) && !opts.values.includes(v)) {
                    delete data[n];
                } else

                // Delete if equal to a special value(s)
                if (v === opts.novalue || Array.isArray(opts.novalue) && opts.novalue.includes(v)) {
                    delete data[n];
                } else

                if (typeof opts.novalue === "object") {
                    if (v === data[opts.novalue.name] || v === opts.novalue.value) delete data[n];
                } else

                if (lib.isArray(opts.values_map)) {
                    for (let i = 0; i < opts.values_map.length - 1; i += 2) {
                        if (v === opts.values_map[i]) {
                            v = data[n] = opts.values_map[i + 1];
                            break;
                        }
                    }
                }
            }
        }

        // Return an error if required, delay checks for complex conditions
        if (opts.required && this.isEmpty(data[n])) {
            if (typeof opts.required !== "object") {
                return onError(opts, name, v, "@label@ is required");
            }
            required.push(opts);
        }
    }
    // Delayed required checks against all properties
    for (const req of required) {
        if (this.isMatched(data, req.required)) {
            return onError(opts, req.name, v, "@label@ is required");
        }
    }
    return { data };
}
