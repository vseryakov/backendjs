/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const util = require('util');
const fs = require('fs');
const path = require('path');
const modules = require(__dirname + '/../modules');
const app = require(__dirname + '/../app');
const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');

/**
 * Parse config lines for the file or other place,
 * @param {string} data - data from a config file
 * @param {int} pass - a number representing a pass phase
 * @param {string} [file] - file name where parameters came from
 * @examples
 *  tag=T, runMode=M, role=R, roles=R, instance.tag=T, instance.roles=dev, aws.region=R, aws.tags=T, env.NAME=V
 * @memberOf module:app
 * @method  parseConfig
 */
app.parseConfig = function(data, pass, file)
{
    var context = ["role", "instance", "runMode", "version", "config", "arch", "host", "platform" ].reduce((a, b) => {
        a[b] = app[b];
        return a;
    }, {});
    context.env = process.env;
    context.tag = this.instance.tag;
    context.roles = this.instance.roles;
    var argv = lib.configParse(data, context);
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
        var key = String(argv[i]);
        if (!key || key[0] != "-") continue;
        var val = argv[i + 1] || null;
        if (val) {
            val = String(val);
            // Numbers can start with the minus and be the argument value
            if (val[0] == "-" && !/^[0-9-]+$/.test(val)) val = null; else i++;
        }
        var opts = _findArg(mod, key, val, pass, file);
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
    o._val = options.val;

    // Preprocess the parse config if necessary and value
    if (typeof arg.onparse == "function") {
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
                if (!o.nocamel || o.obj.includes("-")) o.obj = lib.toCamel(o.obj, o.camel || "-");
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
        if (!o.nocamel) o.name = lib.toCamel(o.name, o.camel || "-");
        if (o.upper) o.name = o.name.replace(o.upper, (v) => (v.toUpperCase()));
        if (o.lower) o.name = o.name.replace(o.lower, (v) => (v.toLowerCase()));
        for (const r in o.nreplace) o.name = o.name.replaceAll(r, o.nreplace[r]);
        if (o.nametype) o.name = lib.toValue(o.name, o.nametype);

        if (lib.isArray(o.names) && !lib.isFlag(o.names, o.name)) return false;
        if (o.existing && typeof context[o.name] == "undefined") return false;

        // Use defaults only for the first time
        if (val == null && typeof context[o.name] == "undefined") {
            if (typeof o.dflt != "undefined") val = o.dflt;
        }
        // Explicit empty value
        if (val == "''" || val == '""') val = "";
        // Only some types allow no value case
        var type = (o.type || "").trim();
        if (val == null && type != "bool" && type != "callback" && type != "none") return false;

        // Can be set only once
        if (arg.once) {
            if (!arg._once) arg._once = {};
            if (arg._once[o.name]) return;
            arg._once[o.name] = 1;
        }

        // Freeze the command line value if pass is set
        if (arg.pass == 2) {
            if (options.pass == 2 && !arg._pass) arg._pass = 1; else
            if (arg._pass) return;
        }

        // Set the actual config variable names for further reference and easy access to the value
        if (val != null) {
            if (!arg._name) arg._name = [];
            const _n = (o.obj ? o.obj + "." : "") + o.name;
            if (!arg._name.includes(_n)) arg._name.push(_n);
            if (!arg._key) arg._key = [];
            if (!arg._key.includes(key)) arg._key.push(key);
        }

        // Explicit clear
        if (val == "<null>" || val == "~") val = null;
        // Explicit clear for complex objects like regexpobj/map
        if (val && val[0] == "~" && val[1] == "~") {
            val = val.substr(2);
            o.set = 1;
        }

        // Value transforms
        if (typeof val == "string") {
            for (const r in o.vreplace) val = val.replaceAll(r, o.vreplace[r]);
            if (o.trim) val = val.trim();
        }
        if (o.noempty && lib.isEmpty(val)) return false;

        if (val === o.novalue || Array.isArray(o.novalue) && o.novalue.includes(val)) return false;

        // Autodetect type
        if (o.autotype && val) type = lib.autoType(val) || type;

        o._type = type;
        o._val = val;

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
        case "regexpmap":
        case "url":
        case "json":
        case "js":
            val = _processArg(context, o.name, val, o, arg.reverse, type);
            break;

        case "path":
            // Check if it starts with local path, use the actual path not the current dir for such cases
            for (const p in this.path) {
                if (val && val.substr(0, p.length + 1) == p + "/") {
                    val = this.path[p] + val.substr(p.length);
                    break;
                }
            }
            _processArg(context, o.name, val, o, arg.reverse, type);
            break;

        case "file":
            if (!val) break;
            try {
                _processArg(context, o.name, fs.readFileSync(path.resolve(val)), arg);
            } catch (e) {
                logger.error('processArg:', app.role, options.file, mod.name, o.name, val, e);
            }
            break;

        case "callback":
            if (!arg.callback) break;
            o.context = context;
            if (typeof arg.callback == "string" && typeof mod[arg.callback] == "function") {
                mod[arg.callback](val, o, options.pass);
            } else
            if (typeof arg.callback == "function") {
                arg.callback.call(mod, val, o, options.pass);
            }
            delete o.context;
            break;

        default:
            val = _processArg(context, o.name, val, o, arg.reverse);
        }

        // Notify about the update via custom function or the module method
        if (arg.onupdate) {
            o.context = context;
            if (typeof arg.onupdate == "function") arg.onupdate.call(mod, val, o); else
            if (typeof arg.onupdate == "string" && typeof mod[arg.onupdate] == "function") mod[arg.onupdate](val, o);
            delete o.context;
        }
    } catch (e) {
        logger.error("processArg:", app.role, options.file, mod.name, o.name, val, e.stack);
    }

}

function _findArg(mod, key, val, pass, file)
{
    var prefix = "-" + mod?.name?.replaceAll(".", "-") + "-";
    if (!key || !key.startsWith(prefix)) return;
    key = key.substr(prefix.length);

    for (const i in mod.args) {
        var arg = mod.args[i];
        if (!arg?.name) continue;

        // Process only equal to the given pass phase or process mode
        if ((pass && !arg.pass) || (arg.master && app.isWorker) || (arg.worker && app.isPrimary)) continue;

        // Early value validation
        if (util.types.isRegExp(arg.regexp) && !arg.regexp.test(val)) continue;

        // Name can be a regexp
        if (!arg._rx) arg._rx = new RegExp("^" + arg.name + "$");

        var matches = key.match(arg._rx);
        if (matches) return { mod, arg, key, val, pass, file, matches };
    }
}

function _processArg(obj, key, val, arg, reverse, type)
{
    function warn() {
        logger.warn("processArg:", "function", app.role, arg._conf, key, val);
    }

    if (reverse) {
        var v = val;
        val = key;
        key = v;
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

    case "regexpmap":
        val = lib.toRegexpMap(obj[key], val, arg);
        if (!val) return;
        for (const i in val) {
            if (val[i]?.rx?.test("") && !arg.empty) return warn();
        }
        break;

    case "set":
        arg.unique = true;
    case "list":
        if (val === null && arg.array) break;
        val = lib.strSplit(val, arg.separator, arg);
        if (arg.max && val.length > arg.max) val = val.slice(0, arg.max);
        if (arg.min == 1 && val.length == arg.min) val = val[0];
        break;

    case "rlist":
        if (val === null && arg.array) break;
        var k = key;
        arg.unique = 1;
        key = lib.strSplit(val, arg.separator, arg);
        val = lib.strSplit(k, arg.separator, arg);
        arg.array = 1;
        for (const i in key) _processArg(obj, key[i], val, arg);
        break;

    case "map":
        if (!arg.maptype) arg.maptype = "auto";
        val = lib.toValue(val, "map", arg);
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
        val = val ? path.resolve(val) : val;
        break;

    default:
        if (arg.valuetype) val = lib.toValue(val, arg.valuetype);
    }
    if (arg.ephemeral) return val;

    if (arg.flatten && Array.isArray(val)) {
        for (const i in val) _processArg(obj, val[i], key, arg);
    } else

    if (Array.isArray(key)) {
        for (const i in key) _processArg(obj, key[i], val, arg);
    } else

    if (arg.merge) {
        if (typeof obj == "function") return warn();
        switch (type) {
        case "json":
            if (!obj || arg.set) for (const p in obj) delete obj[p];
            for (const p in val) {
                if (typeof obj[p] == "function") continue;
                if (val[p] === arg.novalue || Array.isArray(arg.novalue) && arg.novalue.includes(val[p])) continue;
                if (arg.noempty && lib.isEmpty(val[p])) continue;
                obj[p] = val[p];
            }
            break;

        case "map":
            if (!obj || arg.set) for (const p in obj) delete obj[p];
            for (const p in val) {
                if (typeof obj[p] == "function") continue;
                if (val[p] === arg.novalue || Array.isArray(arg.novalue) && arg.novalue.includes(val[p])) continue;
                if (arg.noempty && lib.isEmpty(val[p])) continue;
                obj[p] = val[p];
            }
            break;
        }
    } else

    if (arg.array) {
        if (typeof obj[key] == "function") return warn();
        if (val == null) {
            obj[key] = [];
        } else {
            if (!Array.isArray(obj[key]) || arg.set) obj[key] = [];
            if (Array.isArray(val)) {
                for (let y of val) {
                    if (typeof y == "string" && arg.trim) y = y.trim();
                    if (typeof y == "string" && y[0] == "!" && y[1] == "!") {
                        var i = obj[key].indexOf(y.substr(2));
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
        if (typeof obj[key] == "function") return warn();
        if (val == null) {
            delete obj[key];
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
    if (typeof name != "string" || !Array.isArray(args)) return;
    var ctx = modules[name];
    if (!ctx) return;
    if (!ctx.args) ctx.args = [];
    ctx.args.push(...args.filter((x) => (x.name)));
    return ctx;
}

