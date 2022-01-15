//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const util = require('util');
const fs = require('fs');
const path = require('path');
const url = require('url');
const cluster = require('cluster');
const core = require(__dirname + '/core');
const lib = require(__dirname + '/lib');
const logger = require(__dirname + '/logger');

// Parse command line arguments
core.parseArgs = function(argv, pass, file)
{
    if (!Array.isArray(argv) || !argv.length) return;
    logger.dev('parseArgs:', this.role, file, argv.join(' '));

    // Core parameters
    this.processArgs(this, argv, pass, file);

    // Run registered handlers for each module
    for (var n in this.modules) {
        this.processArgs(this.modules[n], argv, pass, file);
    }
}

// Config parameters defined in a module as a list of parameter names prefixed with module name, a parameters can be
// a string which defines text parameter or an object with the properties: name, type, value, decimals, min, max, separator
// type can be bool, number, list, json
core.processArgs = function(mod, argv, pass, file)
{
    if (!mod || !Array.isArray(mod.args) || !Array.isArray(argv) || !argv.length) return;

    function put(obj, key, val, x, reverse, type) {
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
            val = lib.toNumber(val, x);
            break;
        case "regexp":
            if (!val) break;
            val = lib.toRegexp(val, x.regexp);
            if (!val) return;
            if (val && val.test() && !x.empty) return logger.warn("processArgs:", "wide open regexp", core.role, file, key, val);
            break;
        case "regexpobj":
            val = lib.toRegexpObj(obj[key], val, x);
            if (!val) return;
            if (val.rx && val.rx.test() && !x.empty) return logger.warn("processArgs:", "wide open regexp", core.role, file, key, val);
            break;
        case "regexpmap":
            val = lib.toRegexpMap(obj[key], val, x);
            if (!val) return;
            for (var i in val) {
                if (val[i].rx.test() && !x.empty) return logger.warn("processArgs:", "wide open regexp", core.role, file, key, val);
            }
            break;
        case "list":
            if (val === null && x.array) break;
            val = lib[x.nouniq ? "strSplit" : "strSplitUnique"](val, x.separator, x);
            if (x.max && val.length > x.max) val = val.slice(0, x.max);
            if (x.min == 1 && val.length == x.min) val = val[0];
            break;
        case "rlist":
            if (val === null && x.array) break;
            var k = key;
            key = lib.strSplitUnique(val, x.separator, x);
            val = lib.strSplitUnique(k, x.separator, x);
            x.array = 1;
            for (const i in key) put(obj, key[i], val, x);
            break;
        case "map":
            val = lib.strSplit(val, x.delimiter || ",").
                      map((y) => (lib.strSplit(y, x.separator || /[:;]/, x))).
                      reduce((a, b) => {
                          a[b[0]] = b.length == 2 ? b[1] : b.slice(1);
                          if (x.maptype) a[b[0]] = lib.toValue(a[b[0]], x.maptype);
                          return a;
                      }, {});
            break;
        case "url":
            if (!val) break;
            try {
                val = url.parse(val);
            } catch (e) {
                return logger.warn("processArgs:", core.role, file, key, val, e);
            }
            break;
        case "json":
            if (!val) break;
            val = lib.jsonParse(val, x);
            if (!val) return;
            break;
        case "path":
            val = val ? path.resolve(val) : val;
            break;
        default:
            if (x.valuetype) val = lib.toValue(val, x.valuetype);
        }
        if (x.flatten && Array.isArray(val)) {
            for (const i in val) put(obj, val[i], key, x);
        } else
        if (Array.isArray(key)) {
            for (const i in key) put(obj, key[i], val, x);
        } else
        if (x.merge) {
            if (type == "json") {
                for (const p in val) obj[p] = val[p];
            }
        } else
        if (x.array) {
            if (val == null) {
                obj[key] = [];
            } else {
                if (!Array.isArray(obj[key]) || x.set) obj[key] = [];
                if (Array.isArray(val)) {
                    val.forEach(function(y) {
                        if (typeof y == "string" && x.trim) y = y.trim();
                        if (obj[key].indexOf(y) == -1) obj[key][x.push ? "push": "unshift"](y);
                    });
                } else {
                    if (obj[key].indexOf(val) == -1) obj[key][x.push ? "push": "unshift"](val);
                }
            }
        } else {
            if (val == null) {
                delete obj[key];
            } else {
                obj[key] = val;
            }
        }
    }

    for (let i = 0; i < argv.length; i++) {
        var key = String(argv[i]);
        if (!key || key[0] != "-") continue;
        var val = argv[i + 1] || null;
        if (val) {
            val = String(val);
            // Numbers can start with the minus and be the argument value
            if (val[0] == "-" && !/^[0-9-]+$/.test(val)) val = null; else i++;
        }

        mod.args.forEach(function(x) {
            if (!x.name) return;
            // Process only equal to the given pass phase or process mode
            if ((pass && !x.pass) || (x.master && cluster.isWorker) || (x.worker && cluster.isMaster)) return;
            // Early value validation
            if (util.isRegExp(x.regexp) && !x.regexp.test(val)) return;
            // Module prefix and name of the key variable in the contenxt, key. property specifies alternative name for the value
            var prefix = mod == core ? "-" : "-" + mod.name + "-";
            var context = mod;
            // Name can be a regexp
            var d = key.match("^" + prefix + x.name + "$");
            if (!d) return;
            // Bail on all invalid input
            var o = { errnull: 1 };
            for (const p in x) o[p] = x[p];
            o.name = o.key || key.substr(prefix.length);
            o.keys = d;
            o.conf = file;
            // Preprocess the parse config if necessary
            if (typeof x.onparse == "function") x.onparse.call(mod, val, o);

            try {
                // Make name from the matched pieces
                if (o.make) {
                    o.name = o.make;
                    for (var j = 1; j < o.keys.length; j++) {
                        o.name = o.name.replace("$" + j, o.keys[j] || "");
                    }
                }
                // Place inside the object
                if (o.obj) {
                    // Substitutions from the matched key
                    if (o.obj.indexOf("$") > -1) {
                        for (let j = 1; j < o.keys.length; j++) {
                            o.obj = o.obj.replace("$" + j, o.keys[j] || "");
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
                        o.name = o.name.replace(new RegExp("^" + x.obj + "-"), "");
                    }
                }

                // Name transforms
                if (o.strip) o.name = o.name.replace(o.strip, "");
                if (!o.nocamel) o.name = lib.toCamel(o.name, o.camel);
                if (o.upper) o.name = o.name.replace(o.upper, function(v) { return v.toUpperCase(); });
                if (o.lower) o.name = o.name.replace(o.lower, function(v) { return v.toLowerCase(); });
                if (o.strip) o.name = o.name.replace(o.strip, "");
                if (o.nametype) o.name = lib.toValue(o.name, o.nametype);
                if (lib.isArray(o.names) && !lib.isFlag(o.names, o.name)) return false;
                if (o.existing && typeof context[o.name] == "undefined") return false;

                // Use defaults only for the first time
                if (val == null && typeof context[o.name] == "undefined") {
                    if (typeof o.novalue != "undefined") val = o.novalue;
                }
                // Explicit empty value
                if (val == "''" || val == '""') val = "";
                // Only some types allow no value case
                var type = (o.type || "").trim();
                if (val == null && type != "bool" && type != "callback" && type != "none") return false;

                // Can be set only once
                if (x.once) {
                    if (!x._once) x._once = {};
                    if (x._once[o.name]) return;
                    x._once[o.name] = 1;
                }

                // Freeze the command line value if pass is set
                if (x.pass == 2) {
                    if (pass == 2 && !x._pass) x._pass = 1; else
                    if (x._pass) return;
                }

                // Set the actual config variable names for further reference and easy access to the value
                if (val != null) {
                    if (!x._name) x._name = [];
                    const _n = (o.obj ? o.obj + "." : "") + o.name;
                    if (x._name.indexOf(_n) == -1) x._name.push(_n);
                    if (!x._key) x._key = [];
                    if (x._key.indexOf(key) == -1) x._key.push(key);
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
                        for (let i = 0; i < o.re_map.length - 1; i++) {
                            val = val.replace(o.re_map[i], o.re_map[i + 1]);
                        }
                    }
                    if (o.trim) val = val.trim();
                }

                // Autodetect type
                if (o.autotype && val) {
                    if (lib.isNumeric(val)) type = "number"; else
                    if (val == "true" || val == "false") type = "bool"; else
                    if (val[0] == "^" && val.slice(-1) == "$") type = "regexp"; else
                    if (val[0] == "[" && val.slice(-1) == "]") type = "json"; else
                    if (val[0] == "{" && val.slice(-1) == "}") type = "json"; else
                    if (val.indexOf("|") > -1 && !val.match(/[()[\]^$]/)) type = "list";
                }

                logger.debug("processArgs:", core.role, file, type || "str", mod.name + "." + x._name, "(" + key + ")", "=", val === null ? "null" : val);
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
                    put(context, o.name, val, o, x.reverse, type);
                    break;
                case "path":
                    // Check if it starts with local path, use the actual path not the current dir for such cases
                    for (const p in this.path) {
                        if (val && val.substr(0, p.length + 1) == p + "/") {
                            val = this.path[p] + val.substr(p.length);
                            break;
                        }
                    }
                    put(context, o.name, val, o, x.reverse, type);
                    break;
                case "file":
                    if (!val) break;
                    try { put(context, o.name, fs.readFileSync(path.resolve(val)), x); } catch (e) { logger.error('processArgs:', core.role, file, o.name, val, e); }
                    break;
                case "callback":
                    if (!x.callback) break;
                    o.context = context;
                    if (typeof x.callback == "string" && typeof mod[x.callback] == "function") {
                        mod[x.callback](val, o, pass);
                    } else
                    if (typeof x.callback == "function") {
                        x.callback.call(mod, val, o, pass);
                    }
                    delete o.context;
                    break;
                default:
                    put(context, o.name, val, o, x.reverse);
                }
                // Notify about the update
                if (typeof x.onupdate == "function") {
                    o.context = context;
                    x.onupdate.call(mod, val, o);
                    delete o.context;
                }
            } catch (e) {
                logger.error("processArgs:", core.role, file, o.name, val, e.stack);
            }
        });
    }
}

// Add custom config parameters to be understood and processed by the config parser
// - module - name of the module to add these params to, if it is an empty string or skipped then the module where any
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
    if (typeof module != "string") args = module, module = "";
    if (!Array.isArray(args)) return;
    function addArgs(ctx, args) {
        if (!ctx.args) ctx.args = [];
        ctx.args.push.apply(ctx.args, args.filter(function(x) { return x.name }));
    }
    var ctx = module == "core" ? this : this.modules[module];
    if (ctx) return addArgs(ctx, args);

    // Add arguments to the module by the prefix
    var map = {};
    args.forEach(function(x) { map[x.name] = x });
    Object.keys(this.modules).forEach(function(ctx) {
        Object.keys(map).forEach(function(x) {
            var n = x.split("-");
            if (n[0] == ctx) {
                map[x].name = n.slice(1).join("-");
                addArgs(core.modules[ctx], [map[x]]);
                delete map[x];
            }
        });
    });
    // The rest goes to the core
    addArgs(this, Object.keys(map).map(function(x) { return map[x] }));
}

