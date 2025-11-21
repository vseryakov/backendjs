/*
 *  Vlad Seryakov <vseryakov@gmail.com>
 */

const path = require('path');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const cluster = require('cluster');
const threads = require("worker_threads");
const os = require('os');
const modules = require(__dirname + '/modules');
const lib = require(__dirname + '/lib');
const logger = require(__dirname + '/logger');
const perf_hooks = require("perf_hooks");
const async_hooks = require("async_hooks");
const { promisify } = require("util");

/**
 * @module app
 */

/**
 * Config parameters defined in a module as a list of objects.
 * @typedef {object} ConfigOptions
 * @property {string} name - parameter name, can be a string regexp to match dynamic parameters,
 *    matched pieces then can be used by the `make` property to build the final variable name.
 * @property {string} descr - parameter description, it is show when run `bksh -help` command
 * @property {string} [type] - a valid config type:
 *  - none - skip this parameter
 *  - bool - converts to a boolean
 *  - int, real, number - converts to a number
 *  - map - convert `key:value,key:value...` pairs into an object, see delimiter/separator properties
 *  - set, list - array type, set makes the list unique, splits strings by separator or `,|`
 *  - regexp - a RegExp
 *  - regexpobj - add a regexp to the object that consist of list of patterns and compiled regexp, {@link module lib.testRegexpObj}
 *  - regexpmap - Add a regexp to the list of regexp objects
 *  - url - an object produces by URL.parse
 *  - json, js - parse as JSON into an object/array
 *  - path - resolves to an absolute path
 *  - callback - calls the callback property only, does not save
 *  - file - reads contents of the file
 *
 * @property {string} [obj] - object name in the module where to store the value,
 *    otherwise the value is defined in the module, the obj name is stripped automatically from the variable name.
 *    The object name can contain dots to point to deep objects inside the module.
 * @property {string} [make] - make the variable name from the matched pieces, the final variable is constructed by
 *   replacing every `$1`, `$2`, ... with corresponding matched piece from the name regexp.
 * @property {boolean} [array] - if true prepend a value to the list, to remove an item prepend it with `!!`
 * @property {boolean} [push] - for array: mode append a value
 * @property {int} [pass] - process only args that match the pass value
 * @property {string} [env] - env variable name to apply before parsing config files
 * @property {boolean} [merge] - if true merge properties with existing object, 'obj' must be provided
 * @property {string} [maptype] - default is `auto` to parse map values or can be any value type, for type `map`
 * @property {string} [make] - works with regexp names like `name-([a-z]+)-(.+)` to build the final parameter name, can use $1, $2, $3...placeholders
 * @property {string|string[]} [novalue] - skip if value is equal or included in the list, also works for merges
 * @property {boolean} [sort] - sort array params
 * @property {boolean} [unique] - only keep unique items in lists
 * @property {string} [camel] - characters to use when camelizing the name, default is "-"
 * @property {boolean} [nocamel] - do not camelize the name
 * @property {boolean} [noempty] - do not save empty values
 * @property {boolean} [autotype] - detect type by using {@link module:lib.autoType}
 * @property {string|string[]} [novalue] - do not save if matches given string or contained in the list
 * @property {string} [example] - text with examples
 * @property {function} [callback] - function to call for the callback types for manully parsing and setting the value, (value, obj) the obj being current parameter
 * @property {function|string} [onupdate] - function to call at the end for additional processing as (value, obj)
 * @property {string} [separator] - separator to use for `list` and `map` items, for lists default is `,|`, for maps it is `:;`
 * @property {string} [delimiter] - separator to split key:value pairs, default is `,`
 * @property {boolean} [empty] - allows empty values for maps and regexps
 * @property {boolean} [ephemeral] - parsed but not saved, usually it is handled by onupdate callback
 * @property {string} [strip] - text to stripo from the final variable name
 * @property {boolean} [once] - only set this parameter once
 */

const app = {
    name: 'app',

    /**
     * @var {ConfigOptions[]} args
     */
    args: [
        { name: "log", type: "callback", callback: function(v) { logger.setLevel(v) }, descr: "Set debugging level to any of " + Object.keys(logger.levels), pass: 2 },
        { name: "log-options", type: "map", empty: 1, ephemeral: 1, onupdate: function(v) { logger.setOptions(v) }, descr: "Update logger options, the format is a map: name:val,...", pass: 1, env: "BKJS_LOG_OPTIONS" },
        { name: "log-file", type: "callback", callback: function(v) { if (v) this.logFile=v;logger.setFile(this.logFile, this) }, descr: "Log to a file, if not specified used default logfile, disables syslog", pass: 1, env: "BKJS_LOG_FILE" },
        { name: "log-ignore", type: "regexp", obj: "logInspect", strip: /log-/, nocamel: 1, descr: "Regexp with property names which must not be exposed in the log when using custom logger inspector" },
        { name: "log-inspect", type: "callback", callback: "setLogInspect", descr: "Install custom secure logger inspection instead of util.inspect" },
        { name: "log-inspect-map", type: "map", obj: "log-inspect", merge: 1, replace: { "%20": " ", "%2c": ",", "%3a": ":", "%3b": ";" }, descr: "Properties for the custom log inspect via objDescr" },
        { name: "log-filter", type: "callback", callback: function(v) { if (v) logger.setDebugFilter(v) }, descr: "Enable debug filters, format is: label,... to enable, and !label,... to disable. Only first argument is used for label in logger.debug", pass: 1 },
        { name: "no-log-filter", type: "bool", ephemeral: 1, onupdate: function(v) { if (v) logger.filters={} }, descr: "Clear all log filters", pass: 1 },
        { name: "syslog", type: "callback", callback: function(v) { logger.setSyslog(v || 1) }, descr: "Log messages to syslog, pass 0 to disable, 1 or url (tcp|udp|unix):[//host:port][/path]?[facility=F][&tag=T][&retryCount=N][&bsd=1][&rfc5424=1][&rfc3164=1]...", pass: 1, env: "BKJS_SYSLOG" },
        { name: "console", type: "callback", callback: function() { logger.setFile(null) }, descr: "All logging goes to the console resetting all previous log related settings, this is used in the development mode mostly", pass: 1 },
        { name: "home", type: "callback", callback: "setHome", descr: "Specify home directory for the server, the server will try to chdir there or exit if it is not possible, the directory must exist", pass: 2 },
        { name: "config", type: "path", descr: "Name of the config file to be loaded, can be relative or absolute path", pass: 1 },
        { name: "tmp-dir", type: "path", descr: "Path where to keep temp files" },
        { name: "path-web", type: "path", array: 1, obj: "path", descr: "Add a path where to keep web pages and other static files to be served by the web servers" },
        { name: "path-views", type: "path", array: 1, obj: "path", descr: "Add a path where to keep Express render templates and virtual hosts web pages, every subdirectory name is a host name to match with Host: header, www. is always stripped before matching vhost directory" },
        { name: "path-modules", type: "path", array: 1, obj: "path", descr: "Add a path from where to load modules, these are the backendjs modules but in the same format and same conventions as regular node.js modules. The modules can load any other files or directories, this is just an entry point", pass: 1 },
        { name: "role", descr: "Override servers roles, this may have very strange side effects and should only be used for testing purposes" },
        { name: "salt", type: "callback", callback: function(v) { this.salt=lib.salt=v; }, descr: "Set random or specific salt value to be used for consistent suuid generation", pass: 1 },
        { name: "version", descr: "Set app name/version explicitely and skip reading it from the package.json", pass: 1 },
        { name: "instance-([a-z0-9_-]+)", obj: 'instance', make: "$1", camel: "-", descr: "Set instance properties explicitly: tag, region, zone, roles", pass: 1 },
        { name: "run-mode", descr: "Running mode for the app, used to separate different running environment and configurations", pass: 1 },
        { name: "daemon", type: "none", descr: "Daemonize the process, go to the background, can be specified only in the command line" },
        { name: "shell", type: "none", descr: "Run command line shell, load the backend into the memory and prompt for the commands, can be specified only in the command line" },
        { name: "master", type: "none", descr: "Start the master server, can be specified only in the command line, this process handles job schedules and starts Web server in separate process, keeps track of failed processes and restarts them" },
        { name: "worker", type: "bool", descr: "Set this process as a worker even it is actually a master, this skips some initializations" },
        { name: "no", type: "callback", callback: function(v) { lib.toFlags("add", this.none, lib.strSplit(v)) }, descr: "List of subsystems to disable instead of using many inidividual -no-NNN parameters", pass: 1 },
        { name: "no-([a-z]+)", type: "callback", callback: function(v,o) { lib.toFlags("add", this.none, o.name) }, strip: "no-", nocamel: 1, descr: "Do not start or disbale a service, master, web, jobs, ipc, db, dbconf, watch, modules, packages, configure", pass: 1 },
        { name: "ok-(.+)", type: "callback", callback: function(v,o) { lib.toFlags("del", this.none, o.name) }, strip: "ok-", nocamel: 1, descr: "Enable disabled service, opposite of -no", pass: 1 },
        { name: "repl-port-([a-z]+)$", type: "number", obj: "repl", make: "$1Port", min: 1001, descr: "Base REPL port for process role (master, web, worker), if specified it initializes REPL in the processes, for workers the port is computed by adding a worker id to the base port, for example if specified `-repl-port-web 2090` then a web worker will use any available 2091,2092..." },
        { name: "repl-([a-z]+)", obj: "repl", type: "auto", descr: "REPL settings: listen, file, size" },
        { name: "import-packages", type: "list", array: 1, push: 1, descr: "NPM packages to load on startup, the modules, views, web subfolders from the package will be added automatically to the system paths, modules will be loaded if present, the bkjs.conf will be parsed if present", pass: 1 },
        { name: "include-modules", type: "regexp", descr: "Modules to load, the whole path is checked", pass: 1, env: "BKJS_INCLUDE_MODULES" },
        { name: "exclude-modules", type: "regexp", descr: "Modules not to load, the whole path is checked", pass: 1, env: "BKJS_EXCLUDE_MODULES" },
        { name: "depth-modules", type: "int", descr: "How deep to go looking for modules, it uses lib.findFileSync to locate all .js files", pass: 1 },
        { name: "host-name", type: "callback", callback: "setHost", descr: "Hostname/domain to use for communications, default is current domain of the host machine" },
        { name: "stop-on-error", type: "bool", descr: "Exit the process on any error when loading modules, for dev purposes", pass: 1 },
        { name: "allow-methods-(.+)", obj: "allow-methods", type: "regexp", nocamel: 1, descr: "Modules that allowed to run methods by name, useful to restrict configure methods. Ex: -allow-methods-configureWeb app", pass: 1 },
        { name: "workers", type: "int", descr: "Max number of web processes to launch, -1 disables workers, 0 means launch as many as the CPUs available`" },
        { name: "worker-cpu-factor", type: "real", min: 0, descr: "A number to multiply the number of CPUs available to make the total number of workers to launch, only used if `workers` is 0" },
        { name: "worker-args", type: "list", vreplace: { "%20": " " }, descr: "Node arguments for workers, job and web processes, for passing v8 options, use %20 for spaces" },
        { name: "worker-delay", type: "int", descr: "Delay in milliseconds for a web worker before it will start accepting requests, for cases when other dependencies may take some time to start" },
        { name: "no-restart", type: "bool", descr: "Do not restart any workers" },
        { name: "exit-on-empty", type: "int", descr: "Duration in ms to exit the server process after last worker terminated" },
        { name: "pid-file", descr: "Master process pid file" },
        { name: "err-file", descr: "Server error log file in daemon mode" },
    ],

    id: "bkjs",
    version: process.env.BKJS_VERSION || 'bkjs/0.0',
    home: process.env.BKJS_HOME,
    cwd: process.cwd(),
    runMode: process.env.BKJS_RUNMODE || 'dev',
    role: "process",

    instance: {
        id: os.hostname().toLowerCase(),
        pid: process.pid,
        tag: process.env.BKJS_TAG || "",
        roles: lib.strSplit(process.env.BKJS_ROLES),
        worker_id: cluster.worker?.id || "",
    },
    workerId: cluster.worker?.id || "",
    isPrimary: cluster.isPrimary,
    isWorker: cluster.isWorker,
    isMainThread: threads.isMainThread,

    config: process.env.BKJS_CONFIG || "bkjs.conf",
    logFile: process.env.BKJS_LOGFILE,
    tmpDir: process.env.BKJS_TMP_DIR || "/tmp",

    path: {
        web: ["web"],
        views: ["views"],
        modules: ["modules"],
    },

    ipaddr: '',
    ipaddrs: [],
    host: 'localhost',
    domain: '',
    maxCPUs: os.cpus().length,
    totalMem: os.totalmem(),
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    ctime: Date.now(),

    repl: {
        bind: '127.0.0.1',
        file: '.bkjs_history',
        size: 1024 * 10,
        masterPort: 2080,
        webPort: 2090,
        workerPort: 2100,
    },

    none: [],
    methods: {},
    packages: {},
    allowMethods: {},
    depthModules: 3,
    importPackages: lib.strSplit(process.env.BKJS_PACKAGES),

    logInspect: {
        depth: 7,
        count: 200,
        keys: 50,
        func: 0,
        keepempty: 1,
        length: 1024,
        replace: { " ": /[\r\n\t]+/g },
        ignore: /apikey|apitoken|secret|salt|password|passwd|publickey|privatekey|passkey|pushkey|authorization|signature/i,
    },

    workers: 1,
    workerCpuFactor: 2,
    workerArgs: [],
};

/**
 * The primary application module containing all config options and common functions
 * @property {string} version - Application name/version from package.json or manually set
 * @property {string} config - Config file to load on startup, defaults to `bkjs.conf`
 * @property {string} runMode - Environment mode of the process or the application
 * @property {object} packages - Loaded packages
 * @property {string} role - the primary proccess role
 * @property {string} home - home folder, from config or env.BKJS_HOME
 * @property {string} cwd - always current directory on start
 * @property {string} ipaddr - host IP address, non-local interface
 * @property {int} port - HTTP port to listen to for Express app
 * @property {string} bind - listen on the specified local interfcae, 0.0.0.0 is default
 * @property {boolean} isPrimary - is true if the process is primary
 * @property {boolean} isWorker - is true if the process is a worker process
 * @property {boolean} isMainThread - Is true if this code is not running inside of a Worker thread.
 * @property {object} instance - Current instance or container attributes gathered by other modules
 * @property {string} instance.type - "aws" for AWS
 * @property {string} instance.image - EC2 image id
 * @property {string} instance.container - ECS container name
 * @property {string} instance.container_id - ECS container id
 * @property {string} instance.task_id - ECS container task id
 * @property {string} instance.ip - EC2/ECS private IP address
 * @property {string} instance.tag - Instance/container tag set manually or derived from AWS tags
 * @property {string} instance.roles - Addirtional roles to use for configuration purposes
 * @property {string} instance.worker_id - set from cluster.worker_id
 * @property {string} instance.region - AWS region
 * @property {string} instance.zone - AWS availability zone
 */

module.exports = app;

var _initialized;

/**
 *  Main initialization, must be called prior to perform any actions.
 *
 * @memberof module:app
 * @method  init
 * @param {object} options - options for customization what to init
 * @param {boolean} [options.role] - set the process role
 * @param {boolean} [options.noDb] - if true do not initialize database
 * @param {boolean} [options.noConfigure] - do not run all configure methods
 * @param {boolean} [options.noModules] - do not load modules
 * @param {boolean} [options.noPackages] - do not load npm packages
 * @param {function} [callback] - called at the end with possible err
 *
 */
app.init = function(options, callback)
{
    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {};

    // Already initialized, skip the whole sequence so it is safe to run in the server the scripts which
    //  can be used as standalone node programs
    if (_initialized) {
        logger.debug("init:", this.role, "already initialized");
        return typeof callback == "function" ? callback(null, options) : true;
    }

    this.perf_hooks = perf_hooks;
    this.async_hooks = async_hooks;

    // Process role
    if (options.role) {
        this.role = options.role;
        process.title = app.id + ': ' + this.role;
    }

    // Random proces id to be used as a prefix in clusters
    this.pid = crypto.randomBytes(4).toString('hex');

    // Initial args to run before the config file
    this.processEnvArgs();
    this.processArgs(this, process.argv, 2);

    // Default home as absolute path from the command line or custom config file passed
    this.setHome(this.home);
    this.setHost(os.hostname());

    // No restriction on the client http clients
    http.globalAgent.maxSockets = http.Agent.defaultMaxSockets = Infinity;
    https.globalAgent.maxSockets = Infinity;

    // Find our IP address
    var intf = lib.networkInterfaces();
    this.ipaddr = intf[0]?.address || "";
    this.macaddr = intf[0]?.mac || "";
    this.ipaddrs = intf.map((x) => (x.address));
    var config = "";

    // Serialize initialization procedure, run each function one after another
    lib.series([
        function(next) {
            config = lib.readFileSync(app.config);
            app.parseConfig(config, 1, app.config);

            app.parseArgs(process.argv, 1, "cmdline");

            // Load NPM packages
            if (!options.noPackages && app.isOk("packages")) {
                config += "\n" + app.loadPackages(lib.isArray(app.importPackages, app.preloadPackages));
            }

            // Load external modules from the app home
            if (!options.noModules && app.isOk("modules")) {
                var local = path.resolve(__dirname, "../modules");
                const mods = app.path.modules.map((x) => (path.resolve(x))).filter((x) => (x != local));
                var opts = {
                    stopOnError: options.stopOnError || app.stopOnError,
                    depth: options.depthModules || app.depthModules,
                    include: options.includeModules || app.includeModules,
                    exclude: options.excludeModules || app.excludeModules,
                };
                for (const mod of mods) {
                    app.loadModules(mod, opts);
                }
            }

            // Now re-process all other config parameters for all modules again
            app.parseConfig(config, 0, app.config);
            app.parseArgs(process.argv, 0, "cmdline");

            next();
        },

        // Run all configure methods for every module
        function(next) {
            if (options.noConfigure || !app.isOk("configure")) return next();
            app.runMethods("configure", options, { direct: 1 }, next);
        },

        // Initialize all database pools
        function(next) {
            if (options.noDb || !app.isOk("db")) {
                modules.db.initTables();
                next();
            } else {
                modules.db.init(options, next);
            }
        },

        // Load all available config parameters from the config database for the specified config type
        function(next) {
            if (options.noDb || !app.isOk("db")) return next();
            if (options.noDbconf || !app.isOk("dbconf")) return next();
            modules.db.initConfig(options, next);
        },

        // Initialize all modules after core is done
        function(next) {
            // Override by the command line parameters
            app.parseArgs(process.argv, 0, "cmdline");

            if (options.noConfigure || !app.isOk("configure")) return next();
            app.runMethods("configureModule", options, { direct: 1 }, next);
        },

    ], (err) => {
        logger.logger(err ? "error": "debug", "init:", app.role, app.runMode, app.instance, options, err || "");
        if (!err) _initialized = true;
        if (typeof callback == "function") callback(err, options);
    }, true);
}

/**
 * Async version of app.init
 * @memberOf module:app
 * @method ainit
 */

app.ainit = promisify(app.init.bind(app));

/**
 * Close app timers and other resources
 */
app.shutdown = function(options, callback)
{

}

require(__dirname + "/app/args")
require(__dirname + "/app/utils")
require(__dirname + "/app/server")

