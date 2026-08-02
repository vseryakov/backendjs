/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
'use strict';

const util = require('node:util');
const fs = require('node:fs');
const path = require('node:path');
const modules = require(__dirname + '/../modules');
const app = require(__dirname + '/../app');
const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');

/**
 * @summary Config parameters defined in a module as a list of objects.
 * @typedef {object} ConfigOptions
 * @property {string} name - parameter name, can be a string regexp to match dynamic parameters,
 *    matched pieces then can be used by the **make** property to build the final variable name.
 * @property {string} descr - parameter description, it is show when run **bksh -help** command
 * @property {string} [type] - a valid config type:
 *  - none - skip this parameter
 *  - bool - converts to a boolean
 *  - int, real, number - converts to a number
 *  - map - convert **key:value,key:value...** pairs into an object, see delimiter/separator properties,
 *   if the value starts with { and ends with } the JSON parser is used instead, this is to support maps for simple objects and full JSON for
 *   objects with complex types like RegExp
 *  - set, list - array type, set makes the list unique, splits strings by separator or **,|**
 *  - regexp - a RegExp
 *  - regexpobj - add a regexp to the object that consist of list of patterns and compiled regexp, {@link module lib.testRegexpObj}
 *  - url - an object produces by URL.parse
 *  - json, js - parse as JSON into an object/array
 *  - path - resolves to an absolute sanitized path
 *  - callback - calls the callback property only, does not save
 *  - file - reads contents of a file
 * @property {string} [obj] - object name in the module where to store the value,
 *    otherwise the value is defined in the module, the obj name is stripped automatically from the variable name.
 *    The object name can contain dots to point to deep objects inside the module and use placeholders like $1, $2
 *    if name has regexp parts
 * @property {string} [make] - works with regexp names like **name-([a-z]+)-(.+)** to build the final parameter name,
 *   make the variable name from the matched pieces, the final variable is constructed by
 *   replacing every **$1**, **$2**, ... with corresponding matched piece from the name regexp.
 * @property {boolean} [array] - if true prepend a value to the list, to remove an item prepend it with **!!**
 * @property {boolean} [push] - for array: mode append a value
 * @property {int} [pass] - process only args that match the pass value
 * @property {string} [env] - env variable name to apply before parsing config files
 * @property {boolean} [merge] - if true merge properties with existing object, 'obj' must be provided
 * @property {boolean} [dot] - if true and the name contains dots it is treated as deep object
 * @property {string} [map_type] - default is **auto** to parse map values or can be any value type, for type **map**
 * @property {string} [name_type] - convert name to this type using {@link module:lib.toValue}
 * @property {boolean} [same_type] - only set new value to non-existing or existing property of the same type, to prevent overriding existing properties
 * @property {string|string[]} [no_value] - skip if value is equal or included in the list, also works for merges
 * @property {boolean} [sort] - sort array params
 * @property {boolean} [unique] - only keep unique items in lists
 * @property {string} [camel] - characters to use when camelizing the name, default is "-"
 * @property {boolean} [no_camel] - do not camelize the name
 * @property {boolean} [not_empty] - do not save empty values
 * @property {boolean} [empty] - allows empty values for maps and regexps
 * @property {boolean|object} [auto_type] - detect type by using {@link module:lib.autoType}, if it is an object then
 *   each property defines a type by name/key, this is for complex parameters with `obj`
 * @property {string} [example] - text with examples
 * @property {function} [callback] - function to call for the callback types for manully parsing and setting the value, (value, obj) the obj being current parameter
 * @property {function|string} [onupdate] - function to call at the end for additional processing as (value, obj)
 * @property {string} [separator] - separator to use for **list** and **map** items, for lists default is **,|**, for maps it is **:;**
 * @property {string} [delimiter] - separator to split key:value pairs, default is **,**
 * @property {boolean} [ephemeral] - parsed but not saved, usually it is handled by onupdate callback
 * @property {string} [strip] - text to strip from the final variable name
 * @property {boolean} [once] - only set this parameter once
 * @property {boolean} [existing] - only set new value to existing property
 * @param {object} [nreplace] - an object map which characters to replace the name with new values
 * @param {object} [vreplace] - an object map which characters to replace the value with new values
 */

/**
 * Parse and apply config lines for the file or other place, uses {@link module:lib.parseConfig}.
 *
 * The following properties are exposed only for conditions in sections:
 *  `home, cwd, role, roles, tag, env, version, config, arch, host, platform, process`
 *
 * - env contains all properties set via `app-env-....`
 * - process is an object: { env, pid, uid, title, arch, platform, version }
 *
 * @example
 *
 * [instance.type=]
 * db-pool=sqlite
 * db-sqlite-pool=/tmp/test
 *
 * [instance.type=aws]
 * db-pool=dynamodb
 * db-config=dynamodb
 * db-dynamodb-pool=default
 *
 * [process.platform=linux]
 * api.reuse-port=1
 *
 * @param {string} data - data from a config file
 * @param {int} pass - a number representing a pass phase
 * @param {string} [file] - file name where parameters came from
 * @memberOf module:app
 * @method  parseConfig
 */
app.parseConfig = function(data, pass, file)
{
    var context = ["home", "cwd", "role", "roles", "tag", "env", "version", "config", "arch", "host", "platform" ].reduce((a, b) => {
        a[b] = app.env[b] || app[b];
        return a;
    }, {
        process: {
            env: process.env,
            pid: process.pid,
            title: process.title,
            arch: process.arch,
            platform: process.platform,
            version: process.version,
            uid: process.getuid(),
        }
    });
    var argv = lib.configParse(data, { context });
    if (argv.length) this.parseArgs(argv, pass, file);
}

/**
 * Parse command line arguments
 * @param {string[]} argv - a list of config parameters in the form [ "-param", "value" ,...]
 * @param {int} pass - a number representing a pass phase
 * @param {string} [file] - file name where parameters came from
 * @memberOf module:app
 * @method  parseArgs
 */
app.parseArgs = function(argv, pass, file)
{
    if (!Array.isArray(argv) || !argv.length) return;
    logger.dev('parseArgs:', this.role, file, argv.join(' '));

    // Run registered handlers for each module
    for (const p in modules) {
        this.processArgs(modules[p], argv, pass, file);
    }
}

/**
 * @param {object} mod - run for module's args only
 * @param {string[]} argv - a list of config parameters in the form [ "-param", "value" ,...]
 * @param {int} pass - a number representing a pass phase
 * @param {string} [file] - file name where parameters came from
 * @memberOf module:app
 * @method  processArgs
 */
app.processArgs = function(mod, argv, pass, file)
{
    if (!Array.isArray(mod?.args) || !lib.isArray(argv)) return;

    for (let i = 0; i < argv.length; i++) {
        const key = String(argv[i]);
        if (key?.[0] !== "-") continue;
        let val = argv[i + 1] || null;
        if (val) {
            val = String(val);
            // Numbers can start with the minus and be the argument value
            if (val[0] === "-" && !/^[0-9-]+$/.test(val)) val = null; else i++;
        }
        const opts = _findArg(mod, key, val, pass, file);
        if (opts) this.processArg(opts);
    }
}

/**
 * Process parameters from env variables
 * @memberOf module:app
 * @method processEnvArgs
 */
app.processEnvArgs = function()
{
    var args = this.args.filter((x) => (x.env && process.env[x.env] !== undefined)).map((x) => ([this, x, process.env[x.env]]));
    for (const p in modules) {
        args.push(...lib.isArray(modules[p].args, []).filter((x) => (x.env && process.env[x.env] !== undefined)).map((x) => ([modules[p], x, process.env[x.env]])));
    }
    for (const a of args) {
        this.processArg({ mod: a[0], arg: a[1], key: a[1].name, val: a[2], file: "env" });
    }
}

/**
 * Process a single argument
 * @param {object} options are supposed to be returned by _findArg or prepared accordingly
 * @memberOf module:app
 * @method  processArg
 */
app.processArg = function(options)
{
    var mod = options.mod;
    var context = options.mod;
    var arg = options.arg;
    var val = options.val;
    var key = options.key;

    var o = Object.assign({ errnull: 1 }, arg);
    o.name = o.key || key;
    o.matches = options.matches;
    o._conf = options.file;
    o._pass = options.pass;
    o._value = options.val;

    // Preprocess the parse config if necessary and value
    if (typeof arg.onparse === "function") {
        val = arg.onparse.call(mod, val, o);
    }

    try {
        // Make name from the matched pieces
        if (o.make) {
            o.name = o.make;
            if (o.name.includes("$")) {
                for (let j = 1; j < o.matches?.length; j++) {
                    o.name = o.name.replace("$" + j, o.matches[j] || "");
                }
            }
        }
        // Place inside the object
        if (o.obj) {
            // Compound name, no camel
            if (o.obj.includes(".")) {
                const obj = o.obj.split(".");
                // Substitutions from the matched key
                for (const i in obj) {
                    if (!obj[i].includes("$")) continue;
                    for (let j = 1; j < o.matches?.length; j++) {
                        obj[i] = obj[i].replace("$" + j, o.matches[j] || "");
                    }
                }
                context = lib.objGet(mod, obj.concat(o.name), { owner: 1 });
                if (!context) lib.objSet(mod, obj, context = {});
                o.obj = obj.join(".");
            } else {
                // Substitutions from the matched key
                if (o.obj.includes("$")) {
                    for (let j = 1; j < o.matches?.length; j++) {
                        o.obj = o.obj.replace("$" + j, o.matches[j] || "");
                    }
                }
                if (!o.no_camel || o.obj.includes("-")) {
                    o.obj = lib.toCamel(o.obj, o.camel || "-");
                }
                if (!mod[o.obj]) mod[o.obj] = {};
                context = mod[o.obj];

                // Strip the prefix if starts with the same name
                if (o.name.startsWith(arg.obj + "-")) {
                    o.name = o.name.substr(arg.obj.length + 1);
                }
            }
        }

        // Name transforms
        if (o.strip) o.name = o.name.replace(o.strip, "");
        if (!o.no_camel) o.name = lib.toCamel(o.name, o.camel || "-");
        for (const r in o.nreplace) o.name = o.name.replaceAll(r, o.nreplace[r]);
        if (o.name_type) o.name = lib.toValue(o.name, o.name_type);

        if (lib.isArray(o.names) && !lib.includes(o.names, o.name)) return false;

        const missing = context[o.name] === undefined;

        if (o.existing && missing) return false;
        if (o.same_type && !(missing || lib.typeName(context[o.name]) === o.type)) return false;

        // Use defaults only for the first time
        if (val === null && missing) {
            if (o.dflt !== undefined) val = o.dflt;
        }
        // Explicit empty value
        if (val === "''" || val === '""') val = "";
        // Only some types allow no value case
        let type = (o.type || "").trim();
        if (val === null && type !== "bool" && type !== "callback" && type !== "none") return false;

        // Can be set only once
        if (arg.once) {
            if (!arg._once) arg._once = {};
            if (arg._once[o.name]) return;
            arg._once[o.name] = 1;
        }

        // Freeze the command line value if pass is set
        if (arg.pass === 2) {
            if (options.pass === 2 && !arg._pass) arg._pass = 1; else
            if (arg._pass) return;
        }

        // Set the actual config variable names for further reference and easy access to the value
        if (val !== null) {
            if (!arg._name) arg._name = [];
            const _n = (o.obj ? o.obj + "." : "") + o.name;
            if (!arg._name.includes(_n)) arg._name.push(_n);
            if (!arg._key) arg._key = [];
            if (!arg._key.includes(key)) arg._key.push(key);
        }

        // Explicit clear
        if (val === "<null>" || val === "~") val = null;
        // Explicit clear for complex objects like regexpobj/map
        if (val && val[0] === "~" && val[1] === "~") {
            val = val.substr(2);
            o.set = 1;
        }

        // Value transforms
        if (typeof val === "string") {
            for (const r in o.vreplace) val = val.replaceAll(r, o.vreplace[r]);
            if (o.trim) val = val.trim();
            if (o.lower) val = val.toLowerCase();
            if (o.upper) val = val.toUpperCase();
        }
        if (o.not_empty && lib.isEmpty(val)) return false;

        if (val === o.no_value || Array.isArray(o.no_value) && o.no_value.includes(val)) return false;

        // Autodetect type
        if (o.auto_type && val) {
            type = o.auto_type[o.name] || lib.autoType(val) || type;
        }

        o._type = type;
        o._value = val;

        logger.debug("processArg:", app.role, options.file, mod.name, type || "str", o.obj, o.name, "(" + key + ")", "=", val === null ? "null" : val);
        logger.dev(key, "=", val, o);

        switch (type) {
        case "none":
            break;

        case "bool":
        case "int":
        case "real":
        case "number":
        case "map":
        case "set":
        case "list":
        case "rlist":
        case "regexp":
        case "regexpobj":
        case "url":
        case "json":
        case "js":
            val = _processArg(context, o.name, val, o, arg.reverse, type);
            break;

        case "path":
            // Check if it starts with local path, use the actual path not the current dir for such cases
            for (const p in this.path) {
                if (val && val.substr(0, p.length + 1) === p + "/") {
                    val = this.path[p] + val.substr(p.length);
                    break;
                }
            }
            _processArg(context, o.name, val, o, arg.reverse, type);
            break;

        case "file":
            if (!val) break;
            try {
                _processArg(context, o.name, fs.readFileSync(path.resolve(lib.sanitizePath(val))), arg);
            } catch (e) {
                logger.error('processArg:', app.role, options.file, mod.name, o.name, val, e);
            }
            break;

        case "callback":
            if (!arg.callback) break;
            o.context = context;
            if (typeof arg.callback === "string" && typeof mod[arg.callback] === "function") {
                mod[arg.callback](val, o, options.pass);
            } else
            if (typeof arg.callback === "function") {
                arg.callback.call(mod, val, o, options.pass);
            }
            o.context = undefined;
            break;

        default:
            val = _processArg(context, o.name, val, o, arg.reverse);
        }

        // Notify about the update via custom function or the module method
        if (arg.onupdate) {
            o.context = context;
            if (typeof arg.onupdate === "function") arg.onupdate.call(mod, val, o); else
            if (typeof arg.onupdate === "string" && typeof mod[arg.onupdate] === "function") mod[arg.onupdate](val, o);
            o.context = undefined;
        }
        arg._mtime = Date.now();

    } catch (e) {
        logger.error("processArg:", app.role, options.file, mod.name, o.name, val, e.stack);
    }

}

function _findArg(mod, key, val, pass, file)
{
    var prefix = "-" + mod?.name?.replaceAll(".", "-") + "-";
    if (!key?.startsWith(prefix)) return;
    key = key.substr(prefix.length);

    for (const i in mod.args) {
        const arg = mod.args[i];
        if (!arg?.name) continue;

        // Process only equal to the given pass phase or process mode
        if ((pass && !arg.pass) || (arg.primary && app.isWorker) || (arg.worker && app.isPrimary)) continue;

        // Early value validation
        if (util.types.isRegExp(arg.regexp) && !arg.regexp.test(val)) continue;

        // Name can be a regexp
        if (!arg._rx) arg._rx = new RegExp("^" + arg.name + "$");

        const matches = key.match(arg._rx);
        if (matches) return { mod, arg, key, val, pass, file, matches };
    }
}

function _processArg(obj, key, val, arg, reverse, type)
{
    function warn() {
        logger.warn("processArg:", "function", app.role, arg._conf, key, val);
    }

    if (reverse) {
        [key, val] = [val, key];
    }
    switch (type) {
    case "bool":
        val = !val ? true : lib.toBool(val);
        break;

    case "int":
    case "real":
    case "number":
        val = lib.toNumber(val, arg);
        // Number transformations
        if (arg.multiplier) val *= arg.multiplier;
        if (arg.ceil) val = Math.ceil(val);
        if (arg.floor) val = Math.floor(val);
        break;

    case "regexp":
        if (!val) break;
        val = lib.toRegexp(val, arg.regexp);
        if (!val) return;
        if (val.test("") && !arg.empty) return warn();
        break;

    case "regexpobj":
        val = lib.toRegexpObj(obj[key], val, arg);
        if (!val) return;
        if (val.rx?.test("") && !arg.empty) return warn();
        if (!val.rx) val = null;
        break;

    case "set":
        arg.unique = true;
    case "list":
        if (val === null && arg.array) break;
        val = lib.split(val, arg.separator, arg);
        if (arg.max && val.length > arg.max) val = val.slice(0, arg.max);
        if (arg.min === 1 && val.length === arg.min) val = val[0];
        break;

    case "rlist":
        if (val === null && arg.array) break;
        const k = key;
        arg.unique = 1;
        key = lib.split(val, arg.separator, arg);
        val = lib.split(k, arg.separator, arg);
        arg.array = 1;
        for (const i in key) _processArg(obj, key[i], val, arg);
        break;

    case "map":
        if (!val) break;
        if (typeof val === "string") val = val.trim();
        if (val?.[0] === "{" && val.at(-1) === "}") {
            val = lib.jsonParse(val, arg);
        } else {
            if (!arg.map_type) arg.map_type = "auto";
            val = lib.toValue(val, "map", arg);
        }
        if (!val) return;
        break;

    case "url":
        if (!val) break;
        val = URL.parse(val);
        if (!val) return;
        break;

    case "js":
    case "json":
        if (!val) break;
        val = lib.jsonParse(val, arg);
        if (!val) return;
        break;

    case "path":
        val = val ? path.resolve(lib.sanitizePath(val)) : val;
        break;

    default:
        if (arg.value_type) val = lib.toValue(val, arg.value_type);
    }
    if (arg.ephemeral) return val;

    if (arg.flatten && Array.isArray(val)) {
        for (const i in val) _processArg(obj, val[i], key, arg);
    } else

    if (Array.isArray(key)) {
        for (const i in key) _processArg(obj, key[i], val, arg);
    } else

    if (arg.merge) {
        if (typeof obj === "function") return warn();
        switch (type) {
        case "json":
            if (!obj || arg.set) for (const p in obj) delete obj[p];
            for (const p in val) {
                if (typeof obj[p] === "function") continue;
                if (val[p] === arg.no_value || Array.isArray(arg.no_value) && arg.no_value.includes(val[p])) continue;
                if (arg.not_empty && lib.isEmpty(val[p])) continue;
                obj[p] = val[p];
            }
            break;

        case "map":
            if (!obj || arg.set) for (const p in obj) delete obj[p];
            for (const p in val) {
                if (typeof obj[p] === "function") continue;
                if (val[p] === arg.no_value || Array.isArray(arg.no_value) && arg.no_value.includes(val[p])) continue;
                if (arg.not_empty && lib.isEmpty(val[p])) continue;
                obj[p] = val[p];
            }
            break;
        }
    } else

    if (arg.array) {
        if (typeof obj[key] === "function") return warn();
        if (val === null) {
            obj[key] = [];
        } else {
            if (!Array.isArray(obj[key]) || arg.set) obj[key] = [];
            if (Array.isArray(val)) {
                for (let y of val) {
                    if (typeof y === "string" && arg.trim) y = y.trim();
                    if (typeof y === "string" && y[0] === "!" && y[1] === "!") {
                        const i = obj[key].indexOf(y.substr(2));
                        if (i > -1) obj[key].splice(i, 1);
                    } else {
                        if (!obj[key].includes(y)) obj[key][arg.push ? "push": "unshift"](y);
                    }
                }
            } else {
                if (!obj[key].includes(val)) obj[key][arg.push ? "push": "unshift"](val);
            }
        }
    } else {
        if (typeof obj[key] === "function") return warn();
        if (val === null) {
            delete obj[key];
        } else
        if (arg.dot && key.includes(".")) {
            lib.objSet(obj, key, val);
        } else {
            obj[key] = val;
        }
    }
    if (Array.isArray(obj[key]) && arg.sort) {
        obj[key] = obj[key].sort();
    }
    return val;
}

/**
 * Add custom config parameters to be understood and processed by the config parser
 * @param {string} - a module name to add these params to
 * @param {object[]} args - a list of objects in the format: { name: N, type: T, descr: D, min: M, max: M, array: B... }, all except name are optional.
 * @returns {object} a module object where args added or undefined if not
 * @memberOf module:app
 * @method  describeArgs
 *
 * @example
 * app.describeArgs("api", [ { name: "num", type: "int", descr: "int param" }, { name: "list", array: 1, descr: "list of words" } ]);
 * app.describeArgs("app", [ { name: "list", array: 1, descr: "list of words" } ]);
 */
app.describeArgs = function(name, args)
{
    if (typeof name !== "string" || !Array.isArray(args)) return;
    const ctx = modules[name];
    if (!ctx) return;
    if (!ctx.args) ctx.args = [];
    ctx.args.push(...args.filter((x) => (x.name)));
    return ctx;
}

