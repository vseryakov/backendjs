/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const net = require('net');
const util = require('util');
const fs = require('fs');
const repl = require('repl');
const path = require('path');
const url = require('url');
const child = require('child_process');
const os = require('os');
const modules = require(__dirname + '/../modules');
const app = require(__dirname + '/../app');
const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');

/**
 * Expose mime via core, compatibility with mime module, Express uses it anyway so
 * our dependency is justified and reusing the same module
 * @property {object} mime - mime module
 * @memberof module:app
 * @method mime
 */
app.mime = require("mime-types");

/**
 * Make a HTTP request using {@link module:Fetch}
 *
 * @memberof module:app
 * @method fetch
 */
app.fetch = function(url, options, callback)
{
    return modules.Fetch(url, options, callback);
}

/**
 * Async version of fetch
 * @returns {Promise}
 * @memberof module:app
 * @method afetch
 */
app.afetch = util.promisify(app.fetch.bind(app));

/**
 * Reload runtime config from the DB
 *
 * @memberof module:app
 * @method checkConfig
 * @param {function} [callback] - a function to call after the check
 * @returns {none}
 *
 */
app.checkConfig = function(callback)
{
    modules.db.initConfig();
}

/**
 * Switch to new home directory, exit if we cannot, this is important for relative paths to work if used,
 * no need to do this in worker because we already switched to home directory in the master and all child processes
 * inherit current directory
 * Important note: If run with combined server or as a daemon then this MUST be an absolute path, otherwise calling
 * it in the spawned web master will fail due to the fact that we already set the home and relative path will not work after that.
 * @param {string} home - new home directory to chdir
 * @memberof module:app
 * @method setHome
 */
app.setHome = function(home)
{
    if ((home || this.home) && app.isPrimary) {
        if (home) this.home = path.resolve(home);
        try {
            process.chdir(this.home);
        } catch (e) {
            logger.error('setHome: cannot set home directory', this.home, e);
            process.exit(1);
        }
        logger.dev('setHome:', this.role, this.home);
    }
    this.home = process.cwd();
}

/**
 * Set hostname and domain name
 * @param {string} [host] - new host name to set
 * @returns {string} - current host name
 * @memberof module:app
 * @method setHost
 */
app.setHost = function(host)
{
    if (typeof host == "string" && host) {
        this.domain = lib.domainName(host);
        this.host = host.toLowerCase().split(".")[0];
    }
    return this.host;
}

/** Return true if the given service is not disabled
 * @param {string} name - service name
 * @memberof module:app
 * @method isOk
 */
app.isOk = function(name)
{
    return !this.none.includes(name);
}

/**
 * Install internal inspector for the logger, an alternative to the `util.inspect`
 * @memberof module:app
 * @method setLogInspect
 */
app.setLogInspect = function(set)
{
    if (lib.toBool(set)) {
        if (!logger._oldInspect) {
            logger._oldInspect = logger.inspect;
            logger._oldInspectArgs = logger.inspectArgs;
        }
        logger.inspect = this.inspect;
        logger.inspectArgs = this.logInspect;
    } else {
        if (logger._oldInspect) logger.inspect = logger._oldInspect;
        if (logger._oldInspectArgs) logger.inspectArgs = logger._oldInspectArgs;
    }
}

app.inspect = function(obj, options)
{
    return lib.objDescr(obj, options || app.logInspect);
}

/**
 * Return unique process name based on the cluster status, worker or master and the role. This is can be reused by other workers within the role thus
 * making it usable for repeating environments or storage solutions.
 * @returns {string} - process name
 * @memberof module:app
 * @method processName
 */
app.processName = function()
{
    return (app.role || app.id) + app.workerId;
}

/**
 * Kill all backend processes that match name and not the current process
 * @memberof module:app
 * @method killBackend
 */
app.killBackend = function(name, signal, callback)
{
    if (typeof signal == "function") callback = signal, signal = null;
    if (!signal) signal = 'SIGTERM';

    name = lib.strSplit(name).join("|");
    lib.findProcess({ filter: `${app.process}: ` + (name ? `(${name})`: "") }, (err, list) => {
        logger.debug("killBackend:", name, list);
        lib.forEach(list.map((x) => (x.pid)), (pid, next) => {
            try { process.kill(pid) } catch (e) { logger.debug("killBackend:", name, pid, e) }
            setTimeout(() => {
                try { process.kill(pid, "SIGKILL") } catch (e) { logger.debug("killBackend:", name, pid, e) }
                next();
            }, 1000);
        }, callback);
    });
}

/**
 * Shutdown the machine now
 * @memberof module:app
 * @method shutdown
 */
app.shutdown = function()
{
    child.exec("/sbin/halt", function(err, stdout, stderr) {
        logger.log('shutdown:', stdout || "", stderr || "", err || "");
    });
}

/**
 * Create REPL interface with all modules available
 * @memberof module:app
 * @method createRepl
 */
app.createRepl = function(options)
{
    var r = repl.start(options || {});
    r.context.core = this;
    r.context.fs = fs;
    r.context.os = os;
    r.context.util = util;
    r.context.url = url;
    r.context.path = path;
    r.context.child = child;
    r.historyIndex = 0;
    r.history = [];
    // Expose all modules as top level objects
    r.context.modules = modules;
    for (const p in modules) r.context[p] = modules[p];

    // Support history
    var file = options && options.file;
    if (file) {
        r.history = lib.readFileSync(file, { list: '\n', offset: -options.size }).reverse();
        r.addListener('line', (code) => {
            if (code) {
                fs.appendFile(file, code + '\n', lib.noop);
            } else {
                r.historyIndex++;
                r.history.pop();
            }
        });
    }
    return r;
}

/**
 * Start command prompt on TCP socket, context can be an object with properties assigned with additional object to be accessible in the shell
 * @memberof module:app
 * @method startRepl
 */
app.startRepl = function(port, bind, options)
{
    if (!bind) bind = '127.0.0.1';
    try {
        this.repl.server = net.createServer((socket) => {
            var repl = app.createRepl(lib.objClone(options, "prompt", '> ', "input", socket, "output", socket, "terminal", true, "useGlobal", false));
            repl.on('exit', () => {
                socket.end();
            });
        }).on('error', (err) => {
            logger.error('startRepl:', app.role, port, bind, err);
        }).listen(port, bind);

        logger.info('startRepl:', app.role, 'port:', port, 'bind:', bind);
    } catch (e) {
        logger.error('startRepl:', port, bind, e);
    }
}

/**
 * Watch temp files and remove files that are older than given number of seconds since now, remove only files that match pattern if given
 * Options properties:
 * - path - root folder, relative or absolute
 * - age - number of seconds a file to be older to be deleted, default 1 day
 * - include - a regexp that specifies only files to be watched
 * - exclude - a regexp of files to be ignored
 * - nodirs - if 1 skip deleting directories
 * - depth - how deep to go, default is 1
 * @memberof module:app
 * @method watchTmp
 */
app.watchTmp = function(options, callback)
{
    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {};
    var age = lib.toNumber(options.age, { dflt: 86400 }) * 1000;
    var exclude = options.exclude && lib.toRegexp(options.exclude);
    var include = options.include && lib.toRegexp(options.include);

    logger.debug("watchTmp:", options);
    var now = Date.now();
    lib.findFile(options.path, { details: 1, include, exclude, depth: options.depth || 1 }, (err, files) => {
        if (err) return callback ? callback(err) : null;

        files = files.filter(file => {
            if (options.nodirs && file.isDirectory()) return 0;
            if (now - file.mtime < age) return 0;
            return 1;
        });
        lib.forEachSeries(files, (file, next) => {
            logger.info('watchTmp: delete', age, file.file, lib.toAge(file.mtime), "old");
            if (file.isDirectory()) {
                lib.unlinkPath(file.file, (err) => {
                    if (err && err.code != "ENOENT") logger.error('watchTmp:', file.file, err);
                    next();
                });
            } else {
                fs.unlink(file.file, (err) => {
                    if (err && err.code != "ENOENT") logger.error('watchTmp:', file.file, err);
                    next();
                });
            }
        }, callback);
    });
}

/**
 *  Sort modules according to dependencies in `deps` property.
 * @memberof module:app
 * @method sortModules
 */
app.sortModules = function()
{
    this._modules = [];
    var deps = {};

    // Collect all dependencies into groups
    for (const m in modules) {
        this._modules.push(m);
        let d = modules[m].deps;
        if (typeof d == "string" && d) {
            if (d[0] == "-" && d.length > 1) d = d.substr(1);
            if (!deps[d]) deps[d] = [];
            deps[d].push(m);
        }
    }

    // Sort groups
    var groups = Object.keys(deps).map((key, pos) => {
        Object.keys(deps).forEach((x, j) => {
            if (deps[x].includes(key)) pos += j;
        });
        return { key, pos, deps: deps[key] };
    }).sort((a, b) => (a.pos - b.pos));

    // Sort modules by group
    for (const g of groups) {
        for (const m of g.deps) {
            const d = modules[m].deps;
            let j;
            if (d[0] == "-") {
                j = d.length == 1 ? 0 : this._modules.indexOf(d.substr(1));
                if (j == -1) continue;
            } else {
                j = this._modules.indexOf(d);
                if (j == -1) continue;
                j++;
            }
            const i = this._modules.indexOf(m);
            if (i == -1 || i == j) continue;
            this._modules.splice(i, 1);
            this._modules.splice(j, 0, m);
        }
    }
}

/**
 * Run a method for every module, a method must conform to the following signature: `function(options, callback)` and
 * call the callback when finished. The callback second argument will be the parameters passed to each method, the options if provided can
 * specify the conditions or parameters which wil be used by the `runMethods`` only.
 *
 * The modules's `deps` property defines the position in the modules list and thus determines the order of calling methods.
 * The property contains other module name this module depend on, i.e. it must be placed after it.
 * if `deps` starts with `-` it means place this module before the other module.
 * A single `-` means place it at the beginningh of the list.
 *
 * @memberof module:app
 * @method runMethods
 * @param {string} name - method name
 * @param {object} params - parameters for the method
 * @param {object} options - additional options to control method execution
 * @param {array} [options.logger_allow] - list of properties to be logged only on error instead of params
 * @param {string} [options.logger_error] - logger level for error reporting
 * @param {boolean} [options.stopOnError] - if true return an error in the callback to stop processing other methods
 * @param {function} [options.stopFilter] - a function that must return true in order to stop execution other methods
 * @param {function} [callback] - function to be called at the end
 * @returns {undefined}
 * @param {regexp} allow - regexp with allowed modules, in options only
 * @param {regexp} - allowModules - a regexp of the modules names to be called only
 * @param {boolean} - stopOnError - on first error stop and return, otherwise all errors are ignored and all modules are processed
 * @param {function} - stopFilter - a function to be called after each pass to check if the processing must be stopped, it must return true to stop
 * @param {string} - logger_error - logger level, if not specified an error with status 200 will be reported with log level 'info' and other errors with level 'error'
 * @param {object} - logger_inspect - an object with inspect options to override current inspect parameters
 * @param {array} - logger_allow - a list of properties allowed in the log on error, this is to prevent logging too much or sensitive data
 * @param {boolean} - parallel - if true run methods for all modules in parallel using lib.forEach
 * @param {number} - concurrency - if a number greater than 1 run that many methods in parallel using lib.forEachLimit
 * @param {boolean} - sync - if true treat methods as simple functions without callbacks, methods MUST NOT call the second callback argument but simply return
 * @param {boolean} - direct - if true call all methods directly otherwise via setImmediate
 */
app.runMethods = function(name, params, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (typeof params == "function") callback = params, params = options = null;
    if (!params) params = {};
    if (!options) options = lib.empty;

    if (!this._modules) app.sortModules();

    var mods = this.methods[name];
    if (!Array.isArray(mods)) {
        mods = this.methods[name] = this._modules.filter((mod) => (modules[mod] && typeof modules[mod][name] == "function"));
    }
    var allow = options.allow || options.allowModules || params.allowModules || this.allowMethods[name];
    if (util.types.isRegExp(allow)) mods = mods.filter((x) => (allow.test(x)));

    if (options.sync || params.sync) {
        var stop = options.stopFilter || params.stopFilter;
        for (const p of mods) {
            logger.debug("runMethod:", app.role, name, p);
            modules[p][name](params);
            if (typeof stop == "function" && stop(params)) break;
        }
        lib.tryCall(callback);
    } else
    if (options.parallel || params.parallel) {
        lib.forEach(mods, (mod, next) => {
            runMethod(mod, name, params, options, next);
        }, callback, options.direct || params.direct);
    } else
    if (options.concurrency > 1 || params.concurrency > 1) {
        lib.forEachLimit(mods, options.concurrency || params.concurrency, (mod, next) => {
            runMethod(mod, name, params, options, next);
        }, callback, options.direct || params.direct);
    } else {
        lib.forEachSeries(mods, (mod, next) => {
            runMethod(mod, name, params, options, next);
        }, callback, options.direct || params.direct);
    }
}

/**
 * Run a method for the given module
 * @param {string} mod - module name
 * @param {string} name - method name
 * @param {object} params - parameters for the method
 * @param {object} options - additional options to control method execution
 * @param {array} [options.logger_allow] - list of properties to be logged only on error instead of params
 * @param {string} [options.logger_error] - logger level for error reporting
 * @param {boolean} [options.stopOnError] - if true return an error in the callback to stop processing other methods
 * @param {function} [options.stopFilter] - a function that must return true in order to stop execution other methods
 * @param {function} [callback] - function to be called at the end
 * @returns {undefined}
 * @method runMethod
 *
 */
function runMethod(mod, name, params, options, callback)
{
    logger.debug("runMethod:", app.role, name, mod);
    var ctx = modules[mod];
    ctx[name](params, (err) => {
        if (err) {
            var o = lib.isArray(options.logger_allow) ? options.logger_allow.reduce((a, b) => { a[b] = params[b]; return a }, {}) : params;
            logger.errorWithOptions(err, options.logger_error ? options : params, "runMethods:", app.role, name, mod, err, o);
            if (options.stopOnError || params.stopOnError) return callback(err);
        }
        var stop = options.stopFilter || params.stopFilter;
        if (typeof stop == "function" && stop(params)) return callback({});
        callback();
    });
}

/**
 * Adds reference to the objects in the core for further access.
 * This is used in the core to register all internal modules and makes it available in the shell and in the {@link module:modules} object.
 *
 * If module name starts with underscore it is silently ignored. Empty names are not allowed and reported.
 *
 * Module name can contain dots, meaning to place the module under hierarchy of namespaces. Modules can be placed under existing
 * modules, the context is still separate for each module.
 *
 * Also this is used when creating modular backend application by separating the logic into different modules, by registering such
 * modules with the core it makes the module a first class citizen in the backendjs core and exposes all the callbacks and methods.
 *
 * @memberof module:app
 * @method addModule
 * @param {object[]} any - modules to add
 *
 * @example
 *
 *  const { modules } = require("backendjs");
 *  const mymod = { name: "billing.invoices", request: () => { ... } }
 *  app.addModule(mymod);
 *
 *  modules.billing.invoices.request({ ... });
 *
 * @example <caption>The module below will register API routes and some methods</caption>
 *
 *  const { api, core } = require("backendjs");
 *  const mymod = { name: "mymod" }
 *  exports.module = mymod;
 *  app.addModule(mymod);
 *
 *  mymod.configureWeb = function(options, callback) {
 *     api.app.all("/mymod", (req, res) => {
 *          res.json({});
 *     });
 *  }
 *
 * @example
 * In the main app.js just load it and the rest will be done automatically, i.e. routes will be created ...
 *
 *       const mymod = require("./mymod.js");
 *
 * Running the shell will make the object `mymod` available
 *
 *       ./app.sh -shell
 *       > mymod
 *         { name: "mymod" }
 */
app.addModule = function(...args)
{
    for (const mod of args) {
        let root = modules;
        if (!mod?.name || typeof mod?.name != "string") {
            console.trace("addModule:", "missing name", mod);
            continue
        }
        const name = mod.name.trim();
        if (name[0] == "_") continue;
        if (root[mod.name]) {
            console.trace("addModule:", "already registered", name);
            continue
        }
        root[name] = mod;
        if (!name.includes(".")) continue;

        // Create empty intermediate objects
        const names = name.split(".");
        while (names.length) {
            const part = names.shift().trim();
            if (!part) continue;
            if (names.length) {
                if (root[part] === undefined) root[part] = {};
                if (!lib.isObject(root[part])) {
                    console.trace("addModule:", "non-object", part, "in", name);
                    break;
                }
                root = root[part];
            } else {
                if (root[part] !== undefined) {
                    console.trace("addModule:", "property exists", part, "in", name);
                    break;
                }
                root[part] = mod;
            }
        }
    }
}

/**
 * Dynamically load services from the specified directory.
 *
 * The modules are loaded using `require` as a normal nodejs module but in addition if the module exports
 * `init` method it is called immediately with options passed as an argument. This is a synchronous function so it is supposed to be
 * called on startup, not dynamically during a request processing.
 *
 * Only .js files from top level are loaded by default unless the depth is provided. {@link module:app.app.addModule addModule} is called automatically,
 * it uses {@link module:lib.lib.findFileSync findFileSync} to locate the modules, options `depth`, `include or `exclude` can be provided
 *
 * Each module is put in the top level `modules` registry by name, the name can
 * be a property `name` or the module base file name. Module names starting with underscore will not be added to the registry.
 *
 * If a module name contains dots it means nested hierarchy, all intermediate objects will be created automatically. Nested
 * names allow a better separation of modules and name collisions.
 *
 * **Caution must be taken for module naming, it is possible to override any default bkjs module which will result in unexpected behaviour**
 *
 * The following module properties are reserved and used by the backendjs:
 * - `name` - module name
 * - `deps` - dependent module name be placed after, -M to be placed before, a single - means place at the beginning
 * - `args` - list of config parameters
 * - `tables` - table definitions
 *
 * @memberof module:app
 * @method loadModules
 * @param {string} dir - name of directory containing modules
 * @param {number} [options.depth] - how deep to look for modules
 * @param {regexp} [include] - regexp to match files or paths to load, default is .js
 * @param {regexp} [exclude] - regexp what files or paths to exlude
 * @returns {string[]} a list of all loaded module names
 *
 * @example
 *  // load all modules from the local relative directory
 *  app.loadModules("modules")
 */
app.loadModules = function(dir, options)
{
    if (!options) options = {};

    logger.debug("loadModules:", dir, options);

    var mods = [];
    var opts = {
        types: "f",
        depth: options.depth || 1,
        include: options.include || /\.js$/,
        exclude: options.exclude,
    };
    lib.findFileSync(path.resolve(dir), opts).sort().forEach((file) => {
        try {
            const mod = require(file);
            // Empty module means a mixin, to be listed need at least a property defined
            if (!lib.isEmpty(mod)) {
                if (!mod.name) mod.name = path.basename(file, ".js");
                mods.push(mod);
                // Call the initializer method for the module after it is registered
                if (typeof mod.init == "function") {
                    mod.init(options);
                }
            }
            logger.debug("loadModules:", app.role, file, mod.name, "loaded");
        } catch (e) {
            logger.error("loadModules:", app.role, file, options, e.stack);
            if (options.stopOnError) process.exit(1);
        }
    });
    for (const m of mods) {
        this.addModule(m);
    }
    delete this._modules;
    return mods.map(x => x.name);
}

/**
 * Load NPM packages and auto configure paths from each package.
 * `bkjs.conf` in the root of the package will be loaded as a config file.
 * @memberof module:app
 * @method loadPackages
 * @param {String|Array} list - list of packages to load
 * @param {Object} options - an object with optional parameters
 * @returns {String} all config files for all packages concatenated
 */
app.loadPackages = function(list, options)
{
    logger.debug("loadPackages:", list, options);

    var config = "";
    for (const pkg of lib.strSplit(list)) {
        try {
            var mod = require.resolve(pkg).replace(/(node_modules\/[^/]+)\/(.+)/,"$1/");
            this.packages[pkg] = { path: mod };
            var cfg = lib.readFileSync(mod + app.process + ".conf");
            if (cfg) {
                config = config + "\n" + cfg;
                this.packages[pkg].config = 1;
            }
            for (const p in this.path) {
                if (lib.statSync(mod + p).isDirectory()) {
                    this.path[p].push(mod + p);
                    this.packages[pkg][p] = 1;
                }
            }
            var json = lib.readFileSync(mod + "package.json", { json: 1, logger: "error", missingok: 1 });
            if (json.version) this.packages[pkg].version = json.version;
            logger.debug("loadPackages:", "npm package:", pkg, this.packages[pkg]);
        } catch (e) {
            logger.error("loadPackages:", "npm package:", pkg, e);
        }
    }
    return config;
}

