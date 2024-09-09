//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const util = require('util');
const fs = require('fs');
const path = require('path');
const url = require('url');
const cluster = require('cluster');
const core = require(__dirname + '/../core');
const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');

// Parse config lines for the file or other place,
// Examples of sections from modules:
//
//     tag=T, instance.tag=T, runMode=M, appName=N, role=R, db.configRoles=dev, aws.region=R, aws.tags=T
//
core.parseConfig = function(data, pass, file)
{
    this.tag = this.instance.tag;
    var argv = lib.configParse(data, this);
    if (argv.length) this.parseArgs(argv, pass, file);
}

// Parse command line arguments
core.parseArgs = function(argv, pass, file)
{
    if (!Array.isArray(argv) || !argv.length) return;
    logger.dev('parseArgs:', this.role, file, argv.join(' '));

    // Core parameters
    this.processArgs(this, argv, pass, file);

    // Run registered handlers for each module
    for (const p in this.modules) {
        this.processArgs(this.modules[p], argv, pass, file);
    }
}

// Config parameters defined in a module as a list of parameter names prefixed with module name, a parameters can be
// a string which defines text parameter or an object with the properties:
// - name - parameter name, can be a string regexp
// - type - a valid config type: bool, int, number, url, js, callback, set, list, json, map, regexp, regexpobj, regexpmap,
// - descr - parameter description, it is show when run `bksh -help` command
// - obj - object name in the module where to store the value
// - array - if true append value to the list
// - pass - process only args that match the pass value
// - env - env variable name to apply before parsing config files
// - merge - if true merge properties with existing object, 'obj' must be provided
// - maptype - usually `auto` to parse map values or can be any valie type, for type `map`
// - make - works with regexp names like `name-([a-z]+)-(.+)` to build the final parameter name, can use $1, $2, $3...placeholders
// - novalue - skip if value is equal or included in the list, also works for merges
core.processArgs = function(mod, argv, pass, file)
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

// Process parameters from env variables
core.processEnvArgs = function()
{
    var args = this.args.filter((x) => (x.env && process.env[x.env] !== undefined)).map((x) => ([this, x, process.env[x.env]]));
    for (const p in this.modules) {
        args.push(...lib.isArray(this.modules[p].args, []).filter((x) => (x.env && process.env[x.env] !== undefined)).map((x) => ([this.modules[p], x, process.env[x.env]])));
    }
    for (const a of args) {
        this.processArg({ mod: a[0], arg: a[1], key: a[1].name, val: a[2], file: "env" });
    }
}

// Process a single argument, options are supposed to be returned by _findArg or prepared accordingly
core.processArg = function(options)
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
            for (var j = 1; j < o.matches?.length; j++) {
                o.name = o.name.replace("$" + j, o.matches[j] || "");
            }
        }
        // Place inside the object
        if (o.obj) {
            // Substitutions from the matched key
            if (o.obj.indexOf("$") > -1) {
                for (let j = 1; j < o.matches?.length; j++) {
                    o.obj = o.obj.replace("$" + j, o.matches[j] || "");
                }
            }
            // Compound name, no camel
            if (o.obj.indexOf(".") > -1) {
                context = lib.objGet(mod, o.obj.split(".").concat(o.name), { owner: 1 });
                if (!context) lib.objSet(mod, o.obj, context = {});
            } else {
                if (!o.nocamel || o.obj.indexOf("-") > -1) o.obj = lib.toCamel(o.obj, o.camel);
                if (!mod[o.obj]) mod[o.obj] = {};
                context = mod[o.obj];
                // Strip the prefix if starts with the same name
                o.name = o.name.replace(new RegExp("^" + arg.obj + "-"), "");
            }
        }

        // Name transforms
        if (o.strip) o.name = o.name.replace(o.strip, "");
        if (!o.nocamel) o.name = lib.toCamel(o.name, o.camel);
        if (o.upper) o.name = o.name.replace(o.upper, (v) => (v.toUpperCase()));
        if (o.lower) o.name = o.name.replace(o.lower, (v) => (v.toLowerCase()));
        if (o.strip) o.name = o.name.replace(o.strip, "");
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
            if (lib.isArray(o.re_map)) {
                for (let i = 0; i < o.re_map.length - 1; i += 2) {
                    val = val.replaceAll(o.re_map[i], o.re_map[i + 1]);
                }
            }
            if (o.trim) val = val.trim();
        }
        if (o.noempty && lib.isEmpty(val)) return false;

        if (val === o.novalue || Array.isArray(o.novalue) && o.novalue.includes(val)) return false;

        // Autodetect type
        if (o.autotype && val) type = lib.autoType(val) || type;

        o._type = type;
        o._val = val;

        logger.debug("processArg:", core.role, options.file, type || "str", o.obj, o.name, "(" + key + ")", "=", val === null ? "null" : val);
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
                logger.error('processArg:', core.role, options.file, o.name, val, e);
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

        // Notify about the update
        if (typeof arg.onupdate == "function") {
            o.context = context;
            arg.onupdate.call(mod, val, o);
            delete o.context;
        }
    } catch (e) {
        logger.error("processArg:", core.role, options.file, o.name, val, e.stack);
    }

}

function _findArg(mod, key, val, pass, file)
{
    var prefix = mod === core ? "-" : "-" + mod?.name + "-";
    if (!key || !key.startsWith(prefix)) return;
    key = key.substr(prefix.length);

    for (const i in mod.args) {
        var arg = mod.args[i];
        if (!arg?.name) continue;

        // Process only equal to the given pass phase or process mode
        if ((pass && !arg.pass) || (arg.master && cluster.isWorker) || (arg.worker && cluster.isMaster)) continue;

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
        if (val && val.test("") && !arg.empty) return logger.warn("processArg:", "wide open regexp", core.role, arg._conf, key, val);
        break;

    case "regexpobj":
        val = lib.toRegexpObj(obj[key], val, arg);
        if (!val) return;
        if (val.rx && val.rx.test("") && !arg.empty) return logger.warn("processArg:", "wide open regexp", core.role, arg._conf, key, val);
        break;

    case "regexpmap":
        val = lib.toRegexpMap(obj[key], val, arg);
        if (!val) return;
        for (const i in val) {
            if (val[i].rx.test("") && !arg.empty) return logger.warn("processArg:", "wide open regexp", core.role, arg._conf, key, val);
        }
        break;

    case "list":
        if (val === null && arg.array) break;
        val = lib[arg.nouniq ? "strSplit" : "strSplitUnique"](val, arg.separator, arg);
        if (arg.max && val.length > arg.max) val = val.slice(0, arg.max);
        if (arg.min == 1 && val.length == arg.min) val = val[0];
        break;

    case "rlist":
        if (val === null && arg.array) break;
        var k = key;
        key = lib.strSplitUnique(val, arg.separator, arg);
        val = lib.strSplitUnique(k, arg.separator, arg);
        arg.array = 1;
        for (const i in key) _processArg(obj, key[i], val, arg);
        break;

    case "map":
        val = lib.toValue(val, "map", arg);
        break;

    case "url":
        if (!val) break;
        try {
            val = url.parse(val);
        } catch (e) {
            return logger.warn("processArg:", core.role, arg._conf, key, val, e);
        }
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
        switch (type) {
        case "json":
            if (!obj || arg.set) for (const p in obj) delete obj[p];
            for (const p in val) {
                if (typeof obj[p] == "function") continue;
                if (val[p] === arg.novalue || Array.isArray(arg.novalue) && arg.novalue.includes(val[p])) continue;
                obj[p] = val[p];
            }
            break;

        case "map":
            if (!obj || arg.set) for (const p in obj) delete obj[p];
            for (const p in val) {
                if (typeof obj[p] == "function") continue;
                if (val[p] === arg.novalue || Array.isArray(arg.novalue) && arg.novalue.includes(val[p])) continue;
                obj[p] = val[p];
            }
            break;
        }
    } else
    if (arg.array) {
        if (val == null) {
            obj[key] = [];
        } else {
            if (!Array.isArray(obj[key]) || arg.set) obj[key] = [];
            if (Array.isArray(val)) {
                for (let y of val) {
                    if (typeof y == "string" && arg.trim) y = y.trim();
                    if (obj[key].indexOf(y) == -1) obj[key][arg.push ? "push": "unshift"](y);
                }
            } else {
                if (obj[key].indexOf(val) == -1) obj[key][arg.push ? "push": "unshift"](val);
            }
        }
    } else {
        if (val == null) {
            delete obj[key];
        } else {
            obj[key] = val;
        }
    }
    return val;
}

// Add custom config parameters to be understood and processed by the config parser
// - module - a module object or name of the module to add these params to, if it is an empty string or skipped then the module where any
//    parameter goes is determined by the prefix, for example if name is 'aws-elastic-ip' then it will be added to the aws module,
//    all not matched parameters will be added to the core module.
// - args - a list of objects in the format: { name: N, type: T, descr: D, min: M, max: M, array: B }, all except name are optional.
//
// Example:
//
//      core.describeArgs("api", [ { name: "num", type: "int", descr: "int param" }, { name: "list", array: 1, descr: "list of words" } ]);
//      core.describeArgs([ { name: "api-list", array: 1, descr: "list of words" } ]);
//
core.describeArgs = function(module, args)
{
    if (Array.isArray(module)) args = module, module = "";
    if (!Array.isArray(args)) return;
    function addArgs(ctx, args) {
        if (!ctx.args) ctx.args = [];
        ctx.args.push.apply(ctx.args, args.filter((x) => (x.name)));
    }
    var ctx = lib.isObject(module) ? module : module == "core" ? this : this.modules[module];
    if (ctx) return addArgs(ctx, args);

    // Add arguments to the module by the prefix
    var map = {};
    args.forEach((x) => { map[x.name] = x });
    Object.keys(this.modules).forEach((ctx) => {
        Object.keys(map).forEach((x) => {
            var n = x.split("-");
            if (n[0] == ctx) {
                map[x].name = n.slice(1).join("-");
                addArgs(core.modules[ctx], [map[x]]);
                delete map[x];
            }
        });
    });
    // The rest goes to the core
    addArgs(this, Object.keys(map).map((x) => (map[x])));
}

