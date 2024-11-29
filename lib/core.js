//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const util = require('util');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const cluster = require('cluster');
const os = require('os');
const lib = require(__dirname + '/lib');
const logger = require(__dirname + '/logger');
const perf_hooks = require("perf_hooks");
const async_hooks = require("async_hooks");

// The primary object containing all config options and common functions
const core = {
    // Backend process name
    name: 'bkjs',

    // Always from backendjs/package.json
    version: "",

    // Application version, read from package.json if exists
    appName: process.env.BKJS_APP_NAME || '',
    appVersion: process.env.BKJS_APP_VERSION || '',
    appDescr: process.env.BKJS_APP_DESCR || "",
    appPackage: process.env.BKJS_APP_PACKAGE,

    // Process and config parameters
    argv: {},

    // Primary server role
    role: "",
    // Additional optional roles
    roles: lib.strSplit(process.env.BKJS_ROLES),

    // Environment mode of the process or the application
    runMode: process.env.BKJS_RUNMODE || 'dev',

    // Current instance attributes gathered by other modules
    instance: {
        id: os.hostname().toLowerCase(),
        pid: process.pid,
        type: "",
        tag: process.env.BKJS_TAG || "",
        image: "",
        region: "",
        zone: "",
        worker_id: cluster.worker?.id || "",
    },
    workerId: cluster.worker?.id || "",
    isMaster: cluster.isMaster,
    isWorker: cluster.isWorker,

    // Home directory, current by default, must be absolute path
    home: process.env.BKJS_HOME || `${process.env.HOME || process.env.HOMEPATH}/.bkjs`,
    cwd: process.cwd(),

    // Various folders, by default relative paths are used
    path: {
        etc: "etc",
        var: "var",
        tmp: "tmp",
        log: "log",
        images: "images",
        files: "files",
        web: ["web"],
        views: ["views"],
        modules: ["modules"],
        locales: ["locales"],
    },

    // Log file for debug and other output from the modules, error or info messages, default is stdout
    logFile: "log/message.log",
    errFile: "log/error.log",
    confFile: process.env.BKJS_CONFFILE || "config",

    // HTTP settings
    port: process.env.BKJS_PORT || 8000,
    bind: '0.0.0.0',
    backlog: 1025,

    // WebSockets config
    ws: {
        port: process.env.BKJS_WSPORT || 0,
        bind: "0.0.0.0",
        ping: 30000,
    },

    // HTTPS server options, can be updated by the apps before starting the SSL server
    ssl: { port: 443, bind: '0.0.0.0' },

    // Number of parallel tasks running at the same time, can be used by various modules
    concurrency: 2,

    // Local host IPs and name
    ipaddr: '',
    subnet: '',
    network: '',
    ipaddrs: [],
    host: 'localhost',
    hostName: 'localhost',
    domain: '',
    maxCPUs: os.cpus().length,
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    ctime: Date.now(),
    umask: '0002',
    timers: {},
    locales: [],

    // Disabled services
    none: ["locales"],

    // How long to keep temp files
    tmpWatcher: {
        tmp: { age: 86400*3 },
        log: { age: 86400*30, exclude: /\.log$/ },
    },

    // Inter-process messages
    lruMax: 100000,

    // REPL pors
    repl: {
        bind: '127.0.0.1',
        file: '.history',
        size: 1024 * 10,
    },

    // All internal and loaded modules
    modules: {},
    methods: {},
    preloadPackages: lib.strSplit(process.env.BKJS_PACKAGES),
    packages: {},
    allowMethods: {},

    logInspect: {
        depth: 7,
        count: 200,
        keys: 50,
        func: 0,
        keepempty: 1,
        length: 512,
        replace: { " ": /[\r\n\t]+/g },
        ignore: /apikey|apitoken|secret|salt|password|passwd|publickey|privatekey|passkey/i,
    },

    // Config parameters
    args: [
        { name: "help", type: "callback", callback: "showHelp", descr: "Print help and exit" },
        { name: "log", type: "callback", callback: function(v) { logger.setLevel(v) }, descr: "Set debugging level to any of " + Object.keys(logger.levels), pass: 2 },
        { name: "log-options", type: "map", maptype: "auto", empty: 1, ephemeral: 1, onupdate: function(v) { logger.setOptions(v) }, descr: "Update logger options, the format is a map: name:val,...", pass: 1, env: "BKJS_LOG_OPTIONS" },
        { name: "log-file", type: "callback", callback: function(v) { if (v) this.logFile=v;logger.setFile(this.logFile, this) }, descr: "Log to a file, if not specified used default logfile, disables syslog", pass: 1, env: "BKJS_LOG_FILE" },
        { name: "log-ignore", type: "regexp", obj: "logInspect", strip: /log-/, nocamel: 1, descr: "Regexp with property names which must not be exposed in the log when using custom logger inspector" },
        { name: "log-inspect", type: "callback", callback: "setLogInspect", descr: "Install custom secure logger inspection instead of util.inspect" },
        { name: "log-inspect-map", type: "map", obj: "log-inspect", maptype: "auto", merge: 1, replace: { "%20": " ", "%2c": ",", "%3a": ":", "%3b": ";" }, descr: "Properties for the custom log inspect via objDescr" },
        { name: "log-filter", type: "callback", callback: function(v) { if (v) logger.setDebugFilter(v) }, descr: "Enable debug filters, format is: label,... to enable, and !label,... to disable. Only first argument is used for label in logger.debug", pass: 1 },
        { name: "no-log-filter", type: "bool", ephemeral: 1, onupdate: function(v) { if (v) logger.filters={} }, descr: "Clear all log filters", pass: 1 },
        { name: "syslog", type: "callback", callback: function(v) { logger.setSyslog(v || 1) }, descr: "Log messages to syslog, pass 0 to disable, 1 or url (tcp|udp|unix):[//host:port][/path]?[facility=F][&tag=T][&retryCount=N][&bsd=1][&rfc5424=1][&rfc3164=1]...", pass: 1, env: "BKJS_SYSLOG" },
        { name: "console", type: "callback", callback: function() { logger.setFile(null) }, descr: "All logging goes to the console resetting all previous log related settings, this is used in the development mode mostly", pass: 1 },
        { name: "home", type: "callback", callback: "setHome", descr: "Specify home directory for the server, the server will try to chdir there or exit if it is not possible, the directory must exist", pass: 2 },
        { name: "conf-file", descr: "Name of the config file to be loaded instead of the default etc/config, can be relative or absolute path", pass: 1 },
        { name: "err-file", type: "path", descr: "Path to the error log file where daemon will put app errors and crash stacks", pass: 1 },
        { name: "etc-dir", type: "path", obj: "path", strip: /Dir/, descr: "Path where to keep config files", pass: 1 },
        { name: "tmp-dir", type: "path", obj: "path", strip: /Dir/, descr: "Path where to keep temp files" },
        { name: "spool-dir", type: "path", obj: "path", strip: /Dir/, descr: "Path where to keep modifiable files" },
        { name: "log-dir", type: "path", obj: "path", strip: /Dir/, descr: "Path where to keep other log files, log-file and err-file are not affected by this", pass: 1 },
        { name: "files-dir", type: "path", obj: "path", strip: /Dir/, descr: "Path where to keep uploaded files" },
        { name: "images-dir", type: "path", obj: "path", strip: /Dir/, descr: "Path where to keep images" },
        { name: "web-path", type: "path", array: 1, obj: "path", strip: /Path/, descr: "Path where to keep web pages and other static files to be served by the web servers" },
        { name: "views-path", type: "path", array: 1, obj: "path", strip: /Path/, descr: "Path where to keep virtual hosts web pages, every subdirectory name is a host name to match with Host: header, www. is always stripped before matching vhost directory" },
        { name: "modules-path", type: "path", array: 1, obj: "path", strip: /Path/, descr: "Directory from where to load modules, these are the backendjs modules but in the same format and same conventions as regular node.js modules, the format of the files is NAME_{web,worker,shell}.js. The modules can load any other files or directories, this is just an entry point", pass: 1 },
        { name: "locales-path", type: "path", array: 1, obj: "path", strip: /Path/, descr: "Path where to keep locale translations" },
        { name: "role", descr: "Override servers roles, this may have very strange side effects and should only be used for testing purposes" },
        { name: "roles", type: "list", array: 1, descr: "Additional roles this process is responsible for to use in config" },
        { name: "umask", descr: "Permissions mask for new files, calls system umask on startup, if not specified the current umask is used", pass: 1 },
        { name: "force-uid", type: "list", nouniq: 1, onupdate: function(v) { lib.dropPrivileges(v[0], v[1]) }, descr: "Drop privileges if running as root by all processes as early as possibly, this reqiures uid being set to non-root user. A convenient switch to start the backend without using any other tools like su or sudo.", pass: 1 },
        { name: "port", type: "number", min: 0, descr: "port to listen for the HTTP server, this is global default" },
        { name: "bind", descr: "Bind to this address only, if not specified listen on all interfaces" },
        { name: "backlog", type: "int", descr: "The maximum length of the queue of pending connections, used by HTTP server in listen." },
        { name: "ws-port", type: "number", obj: 'ws', min: 0, descr: "Port to listen for WebSocket server, it can be the same as HTTP/S ports to co-exist on existing web servers" },
        { name: "ws-bind", obj: 'ws', descr: "Bind to this address only for WebSocket, if not specified listen on all interfaces, only when the port is different from existing web ports" },
        { name: "ws-ping", type: "number", obj: 'ws', min: 0, descr: "How often to ping Websocket connections" },
        { name: "ws-path", type: "regexp", obj: 'ws', descr: "Websockets will be accepted only if request path maches the pattern" },
        { name: "ws-origin", type: "regexp", obj: 'ws', descr: "Websockets will be accepted only if request Origin: header maches the pattern" },
        { name: "ws-queue", obj: "ws", descr: "A queue where to publish messages for websockets, API process will listen for messages and proxy it to all macthing connected websockets " },
        { name: "ssl-port", type: "number", obj: 'ssl', min: 0, descr: "port to listen for HTTPS server, this is global default" },
        { name: "ssl-bind", obj: 'ssl', descr: "Bind to this address only for HTTPS server, if not specified listen on all interfaces" },
        { name: "ssl-key", type: "file", obj: 'ssl', descr: "Path to SSL prvate key" },
        { name: "ssl-cert", type: "file", obj: 'ssl', descr: "Path to SSL certificate" },
        { name: "ssl-pfx", type: "file", obj: 'ssl', descr: "A string or Buffer containing the private key, certificate and CA certs of the server in PFX or PKCS12 format. (Mutually exclusive with the key, cert and ca options.)" },
        { name: "ssl-ca", type: "file", obj: 'ssl', array: 1, descr: "An array of strings or Buffers of trusted certificates in PEM format. If this is omitted several well known root CAs will be used, like VeriSign. These are used to authorize connections." },
        { name: "ssl-passphrase", obj: 'ssl', descr: "A string of passphrase for the private key or pfx" },
        { name: "ssl-crl", type: "file", obj: 'ssl', array: 1, descr: "Either a string or list of strings of PEM encoded CRLs (Certificate Revocation List)" },
        { name: "ssl-ciphers", obj: 'ssl', descr: "A string describing the ciphers to use or exclude. Consult http://www.openssl.org/docs/apps/ciphers.html#CIPHER_LIST_FORMAT for details on the format" },
        { name: "ssl-request-cert", type: "bool", obj: 'ssl', descr: "If true the server will request a certificate from clients that connect and attempt to verify that certificate. " },
        { name: "ssl-reject-unauthorized", type: "bool", obj: 'ssl', decr: "If true the server will reject any connection which is not authorized with the list of supplied CAs. This option only has an effect if ssl-request-cert is true" },
        { name: "concurrency", type: "number", min: 1, max: 4, descr: "How many simultaneous tasks to run at the same time inside one process, this is used by async module only to perform several tasks at once, this is not multithreading but and only makes sense for I/O related tasks" },
        { name: "salt", type: "callback", callback: function(v) { this.salt=lib.salt=v; }, descr: "Set random or specific salt value to be used for consistent suuid generation", pass: 1 },
        { name: "app-name", type: "callback", callback: function(v) { if (!v) return;v = v.split(/[/-]/);this.appName=v[0].trim();if (v[1]) this.appVersion=v[1].trim();}, descr: "Set appName and version explicitely an skip reading it from package.json, it can be just a name or name-version", pass: 1 },
        { name: "app-version", descr: "Set appVersion explicitely an skip reading it from package.json", pass: 1 },
        { name: "app-descr", descr: "Set appdescr explicitely an skip reading it from package.json", pass: 1 },
        { name: "app-package", descr: "NPM package containing the application package.json, it will be added to the list of package.json files for app name and version discovery. The package must be included in the -preload-packages list.", pass: 1 },
        { name: "instance-([a-z0-9_-]+)", obj: 'instance', make: "$1", camel: "-", descr: "Set instance properties explicitly: tag, region, zone", pass: 1 },
        { name: "run-mode", descr: "Running mode for the app, used to separate different running environment and configurations", pass: 1 },
        { name: "daemon", type: "none", descr: "Daemonize the process, go to the background, can be specified only in the command line" },
        { name: "shell", type: "none", descr: "Run command line shell, load the backend into the memory and prompt for the commands, can be specified only in the command line" },
        { name: "master", type: "none", descr: "Start the master server, can be specified only in the command line, this process handles job schedules and starts Web server in separate process, keeps track of failed processes and restarts them" },
        { name: "worker", type: "bool", descr: "Set this process as a worker even it is actually a master, this skips some initializations" },
        { name: "no", type: "callback", callback: function(v) { lib.toFlags("add", this.none, lib.strSplit(v)) }, descr: "List of subsystems to disable instead of using many inidividual -no-NNN parameters", pass: 1 },
        { name: "no-([a-z]+)", type: "callback", callback: function(v,o) { lib.toFlags("add", this.none, o.name) }, strip: "no-", nocamel: 1, descr: "Do not start or disbale a service, matser, web, dns, jobs, ipc, db, dbconf, locales, watch, modules, packages, configure", pass: 1 },
        { name: "ok-(.+)", type: "callback", callback: function(v,o) { lib.toFlags("del", this.none, o.name) }, strip: "ok-", nocamel: 1, descr: "Enable disabled service, opposite of -no", pass: 1 },
        { name: "repl-port-([a-z]+)$", type: "number", obj: "repl", make: "$1Port", min: 1001, descr: "Base REPL port for process role (server, master, web, worker), if specified it initializes REPL in the processes, for workers the port is computed by adding a worker id to the base port, for example if specified `-repl-port-web 2090` then a web worker will use any available 2091,2092..." },
        { name: "repl-bind", obj: "repl", descr: "Listen only on specified address for REPL server in the master process" },
        { name: "repl-file", obj: "repl", descr: "User specified file for REPL history" },
        { name: "repl-size", obj: "repl", type: "int", descr: "Max size to read on start from the end of the history file" },
        { name: "preload-packages", type: "list", array: 1, push: 1, descr: "NPM packages to load on startup, the modules, locales, viewes, web subfolders from the package will be added automatically to the system paths, modules will be loaded if present, the config file in etc subfolder will be parsed if present", pass: 1 },
        { name: "exclude-modules", type: "regexp", descr: "Modules not to load, the whole path is checked", pass: 1, env: "BKJS_EXCLUDE_MODULES" },
        { name: "depth-modules", type: "int", descr: "How deep to go looking for modules, it uses lib.findFileSync to locate all .js files", pass: 1 },
        { name: "user-agent", array: 1, descr: "Add HTTP user-agent header to be used in HTTP requests, for scrapers or other HTTP requests that need to be pretended coming from Web browsers" },
        { name: "backend-host", descr: "Host of the master backend, can be used for backend nodes communications using core.sendRequest function calls with relative URLs, also used in tests." },
        { name: "backend-login", descr: "Credentials login for the master backend access when using core.sendRequest" },
        { name: "backend-secret", descr: "Credentials secret for the master backend access when using core.sendRequest" },
        { name: "host-name", type: "callback", callback: "setHost", descr: "Hostname/domain to use for communications, default is current domain of the host machine" },
        { name: "locales", array: 1, type: "list", descr: "A list of locales to load from the locales/ directory, only language name must be specified, example: en,es. It enables internal support for `res.__` and `req.__` methods that can be used for translations, for each request the internal language header will be honored forst, then HTTP Accept-Language" },
        { name: "email-from", descr: "Email address to be used when sending emails from the backend" },
        { name: "email-transport", descr: "Send emails via supported transports: ses:, sendgrid://?key=SG, if not set default SMTP settings are used" },
        { name: "sendgrid-key", descr: "SendGrid API key" },
        { name: "smtp-(.+)", obj: "smtp", make: "$1", descr: "SMTP server parameters, user, password, host, ssl, tls...see nodemailer for details" },
        { name: "tmp-watcher-(.+)", obj: "tmpWatcher.$1", type: "json", make: "$1", merge: 1, descr: "How long to keep files per subdirectory, age is in seconds, ex:  { path: P, age: S, include: rx, exclude: rx, depth: 1, nodirs: 1 }" },
        { name: "stop-on-error", type: "bool", descr: "Exit the process on any error when loading modules, for dev purposes", pass: 1 },
        { name: "allow-methods-(.+)", obj: "allow-methods", type: "regexp", nocamel: 1, descr: "Modules that allowed to run methods by name, useful to restrict configure methods. Ex: -allow-methods-configureWeb app", pass: 1 },
    ],
}

module.exports = core;

// Main initialization, must be called prior to perform any actions.
//
// If options are given they may contain the following properties:
// - noDb - if true do not initialize database
// - noConfigure - do not run all configure methods
// - noWatch - do not watch and reload config files
// - noModules - do not load modules
// - noLocales - do not load locales
core.init = function(options, callback)
{
    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {};
    const db = core.modules.db;

    // Already initialized, skip the whole sequence so it is safe to run in the server the scripts which
    // can be used as standalone node programs
    if (this._initialized) {
        logger.debug("init:", this.role, "already initialized");
        return typeof callback == "function" ? callback.call(core, null, options) : true;
    }

    this.perf_hooks = perf_hooks;
    this.async_hooks = async_hooks;

    // Process role
    if (options.role) {
        this.role = options.role;
        process.title = core.name + ': ' + this.role;
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
    this.subnet = this.ipaddr.split(".").slice(0, 3).join(".");
    this.network = this.ipaddr.split(".").slice(0, 2).join(".");
    this.location = "http://" + this.host + ":" + this.port;
    // Pre load config files into memory to perform 2 passes
    var config = "", lconfig = "";

    // Serialize initialization procedure, run each function one after another
    lib.series([
        function(next) {
            // Default config files, locate in the etc if just name is given
            if (core.confFile.indexOf(path.sep) == -1) {
                core.confFile = path.join(core.path.etc, core.confFile);
            }
            core.confFile = path.resolve(core.confFile);
            for (const file of [core.confFile, core.confFile + "." + core.runMode, core.confFile + "." + core.instance.tag, core.confFile + ".local"]) {
                var cfg = lib.readFileSync(file);
                if (cfg) {
                    logger.debug('loadConfig:', core.role, file);
                    config += cfg + "\n";
                    if (file.indexOf(".local") > -1) lconfig = cfg;
                }
            }
            // Process first pass parameters, this is important for modules to be loaded
            core.parseConfig(config, 1, core.confFile);
            core.parseArgs(process.argv, 1, "cmdline");
            next();
        },

        // Load NPM packages
        function(next) {
            if (options.noPackages || !core.isOk("packages")) return next();
            config += "\n" + core.loadPackages(core.preloadPackages);
            next();
        },

        // Load external modules from the app home
        function(next) {
            if (options.noModules || !core.isOk("modules")) return next();
            var local = path.resolve(__dirname, "../modules");
            var modules = core.path.modules.map((x) => (path.resolve(x))).filter((x) => (x != local));
            var opts = {
                stopOnError: options.stopOnError || core.stopOnError,
                depth: options.depthModules || core.depthModules,
                exclude: options.excludeModules || core.excludeModules,
            };
            for (const mod of modules) core.loadModules(mod, opts);
            next();
        },

        // Now re-process all other config parameters for all modules again
        function(next) {
            core.parseConfig(config, 0, core.confFile);
            core.parseArgs(process.argv, 0, "cmdline");
            next();
        },

        // Application version from the package.json
        function(next) {
            var files = [];
            if (core.appPackage && core.packages[core.appPackage]) files.push(core.packages[core.appPackage].path);
            files.push(core.home, core.path.etc + "/..", __dirname + "/..");
            for (const file of files) {
                var pkg = lib.readFileSync(file + "/package.json", { json: 1, logger: "error", missingok: 1 });
                logger.debug("init:", file + "/package.json", pkg.name, pkg.version);
                if (!core.appName && pkg.name) core.appName = pkg.name;
                if (!core.appVersion && pkg.version) core.appVersion = pkg.version;
                if (!core.appDescr && pkg.description) core.appDescr = pkg.description;
                if (!core.version && pkg.name == "backendjs") core.version = pkg.version;
            }
            if (!core.appName) core.appName = core.name;
            if (!core.appVersion) core.appVersion = core.version;
            // Use the app name as salt for consistentcy
            if (!core.salt) core.salt = lib.salt = core.appName;
            next();
        },

        // Create all directories, only master should do it once but we resolve absolute paths in any mode
        function(next) {
            try { process.umask(core.umask); } catch (e) { logger.error("umask:", core.umask, e) }

            // Create all subfolders with permissions, run it before initializing db which may create files in the spool folder
            if (!core.isWorker && !core.worker) {
                for (const p of ["etc","var","tmp","log"]) {
                    var paths = Array.isArray(core.path[p]) ? core.path[p] : [core.path[p]];
                    for (const x of paths) {
                        if (!x || path.isAbsolute(x)) continue;
                        lib.mkdirSync(x);
                        lib.chownSync(this.uid, this.gid, x);
                    }
                }
            }
            next();
        },

        // Run all configure methods for every module
        function(next) {
            if (options.noConfigure || !core.isOk("configure")) return next();
            core.runMethods("configure", options, { direct: 1 }, next);
        },

        // Initialize all database pools
        function(next) {
            if (options.noDb || !core.isOk("db")) {
                db.initTables();
                next();
            } else {
                db.init(options, next);
            }
        },

        // Load all available config parameters from the config database for the specified config type
        function(next) {
            if (options.noDb || !core.isOk("db")) return next();
            if (options.noDbconf || !core.isOk("dbconf")) return next();
            db.initConfig(options, next);
        },

        // Override by the command line parameters
        function(next) {
            core.parseConfig(lconfig, 0, core.confFile + ".local");
            core.parseArgs(process.argv, 0, "cmdline");
            next();
        },

        // Make sure spool and db files are owned by regular user, not the root
        function(next) {
            if (!core.isWorker && !core.worker && lib.getuid() == 0) {
                lib.findFileSync(core.path.var).forEach((p) => {
                    lib.chownSync(core.uid, core.gid, p);
                });
            }
            next();
        },

        function(next) {
            if (options.noWatch) return next();
            // Can only watch existing files
            var files = [core.confFile, core.confFile + "." + core.runMode, core.confFile + "." + core.instance.tag];
            for (const p in core.packages) {
                if (core.packages[p].config) files.push(core.packages[p].path + "/etc/config");
            }
            // Only allow the local config to be watched for troubleshooting in no-watch mode
            if (!core.isOk("watch")) files = [];
            files.push(core.confFile + ".local");

            lib.forEach(files, (file, next2) => {
                fs.stat(file, (err) => {
                    logger.debug("init:", "watch:", file, err);
                    if (!err) fs.watch(file, (event, filename) => {
                        core.setTimeout(file, core.loadConfig.bind(core, file), lib.randomInt(1000, 5000));
                    });
                    next2();
                });
            }, next, true);
        },

        // Initialize all modules after core is done
        function(next) {
            if (options.noConfigure || !core.isOk("configure")) return next();
            core.runMethods("configureModule", options, { direct: 1 }, next);
        },

        function(next) {
            if (options.noLocales || !core.isOk("locales")) return next();
            core.loadLocales(options, next);
        },
    ], (err) => {
        logger.debug("init:", core.role, core.runMode, core.instance, options, err || "");
        if (!err) core._initialized = true;
        if (typeof callback == "function") callback.call(core, err, options);
    }, true);
}

// Reload runtime config from DB and local config file.
// the model her eis that local config files contain static config parameters or defaults,
// the database config may have overrides or other dynamic parameters that can be changed more often like rate limits, queue configs...
core.checkConfig = function(callback)
{
    core.modules.db.initConfig(() => {
        core.loadConfig(core.confFile + ".local");
    });
}

// Run any backend function after environment has been initialized, this is to be used in shell scripts,
// core.init will parse all command line arguments, the simplest case to run from /data directory and it will use
// default environment or pass -home dir so the script will reuse same config and paths as the server
// context can be specified for the callback, if no then it run in the core context
// - require('backendjs').run(function() {}) is one example where this call is used as a shortcut for ad-hoc scripting
core.run = function(options, callback)
{
    if (typeof options == "function") callback = options, options = {};
    if (typeof callback != "function") return logger.error('run:', 'callback is required');
    if (!this.role) this.role = "process";
    this.init(options, callback.bind(core));
}

// Exit the process with possible message to be displayed and status code
core.exit = function(code, msg)
{
    if (msg) console[code ? "error" : "log"](Array.prototype.slice.apply(arguments).slice(1).join(", "));
    process.exit(code || 0);
}

// Run a method for every module, a method must conform to the following signature: `function(options, callback)` and
// call the callback when finished. The callback second argument will be the parameters passed to each method, the options if provided can
// specify the conditions or parameters which wil be used by the `runMethods`` only.
//
// The following properties can be specified in the options or params:
//  - allow - regexp with allowed modules, in options only
//  - allowModules - a regexp of the modules names to be called only
//  - stopOnError - on first error stop and return, otherwise all errors are ignored and all modules are processed
//  - stopFilter - a function to be called after each pass to check if the processing must be stopped, it must return true to stop
//  - logger_error - logger level, if not specified an error with status 200 will be reported with log level 'info' and other errors with level 'error'
//  - logger_inspect - an object with inspect options to override current inspect parameters
//  - logger_allow - a list of properties allowed in the log on error, this is to prevent logging too much or sensitive data
//  - parallel - if true run methods for all modules in parallel using lib.forEach
//  - concurrency - if a number greater than 1 run that many methods in parallel using lib.forEachLimit
//  - sync - if true treat methods as simple functions without callbacks, methods MUST NOT call the second callback argument but simply return
//  - direct - if true call all methods directly othwerwise via setImmediate
//
core.runMethods = function(name, params, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (typeof params == "function") callback = params, params = options = null;
    if (!params) params = {};
    if (!options) options = lib.empty;

    // Sort by priority, greater the higher
    if (!this._modules) {
        this._modules = Object.keys(this.modules).sort((a, b) => {
            var p1 = lib.toNumber(this.modules[a].priority), p2 = lib.toNumber(this.modules[b].priority);
            return p1 > p2 ? -1 : p1 < p2 ? 1 : a > b ? 1 : a < b ? -1 : 0;
        });
    }

    var mods = this.methods[name];
    if (!Array.isArray(mods)) {
        mods = this.methods[name] = this._modules.filter((mod) => (this.modules[mod] && typeof this.modules[mod][name] == "function"));
    }
    var allow = options.allow || options.allowModules || params.allowModules || this.allowMethods[name];
    if (util.types.isRegExp(allow)) mods = mods.filter((x) => (allow.test(x)));

    if (options.sync || params.sync) {
        var stop = options.stopFilter || params.stopFilter;
        for (const p of mods) {
            logger.debug("runMethod:", core.role, name, p);
            core.modules[p][name](params);
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

// Run a method for the given module
function runMethod(mod, name, params, options, callback)
{
    logger.debug("runMethod:", core.role, name, mod);
    var ctx = core.modules[mod];
    ctx[name](params, (err) => {
        if (err) {
            var o = lib.isArray(options.logger_allow) ? options.logger_allow.reduce((a, b) => { a[b] = params[b]; return a }, {}) : params;
            logger.errorWithOptions(err, options.logger_error ? options : params, "runMethods:", core.role, name, mod, err, o);
            if (options.stopOnError || params.stopOnError) return callback(err);
        }
        var stop = options.stopFilter || params.stopFilter;
        if (typeof stop == "function" && stop(params)) return callback({});
        callback();
    });
}

// Adds reference to the objects in the core for further access, specify module name, module reference pairs.
// This is used the the core itcore to register all internal modules and makes it available in the shell and in the `core.modules` object.
//
// Also this is used when creating modular backend application by separating the logic into different modules, by registering such
// modules with the core it makes the module a first class citizen in the backendjs core and exposes all the callbacks and methods.
//
// For example, the module below will register API routes and some methods
//
//       const bkjs = require("backendjs");
//       const mymod = { name: "mymod" }
//       exports.module = mymod;
//       core.addModule(mymod);
//
//       mymod.configureWeb = function(options, callback) {
//          bkjs.api.app.all("/mymod", function(req, res) {
//               res.json({});
//          });
//       }
//
//
// In the main app.js just load it and the rest will be done automatically, i.e. routes will be created ...
//
//       const mymod = require("./mymod.js");
//
// Running the shell will make the object `mymod` available
//
//       ./app.sh -shell
//       > mymod
//         { name: "mymod" }
//
core.addModule = function(...args)
{
    for (const i in args) {
        if (!args[i].name) {
            logger.warn("addModule:", "missing name", args[i]);
        } else {
            this.modules[args[i].name] = args[i];
        }
    }
}

// Dynamically load services from the specified directory.
//
// The modules are loaded using `require` as a normal nodejs module but in addition if the module exports
// `init` method it is called immediately with options passed as an argument. This is a synchronous function so it is supposed to be
// called on startup, not dynamically during a request processing.
//
// Only .js files from top level are loaded by default unless the depth is provided. `core.addModule` is called automatically.
//
// Each module is put in the global `core.modules`` object by name, the name can be a property `name` or the module base file name.
//
// Modules can be sorted by a priority, if .priority property is defined in the module it will be used to sort the modules, the higher priority the
// closer to the top the module will be. The position of a module in the `core.modules` will define the order `runMethods` will call.
//
// it uses lib.findFileSync to locate the modules, options `depth`, `include or `exclude` can be provided
//
// **Caution must be taken for module naming, it is possible to override any default bkjs module which will result in unexpected behaviour**
//
//  Example, to load all modules from the local relative directory
//
//       core.loadModules("modules")
//
core.loadModules = function(dir, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    var modules = {};
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
                modules[mod.name] = mod;
                // Call the initializer method for the module after it is registered
                if (typeof mod.init == "function") {
                    mod.init(options);
                }
            }
            logger.debug("loadModules:", core.role, file, mod.name, "loaded");
        } catch (e) {
            logger.error("loadModules:", core.role, file, options, e.stack);
            if (options.stopOnError) process.exit(1);
        }
    });
    for (const name in modules) {
        this.addModule(modules[name]);
    }
    delete this._modules;
    if (typeof callback == "function") callback();
}

// Load NPM packages and auto configure paths from each package,
// etc/config file inside each package will be parsed immediately.
// Returns all config files concatenated.
core.loadPackages = function(list, options)
{
    var config = "";
    for (const pkg of lib.strSplit(list)) {
        try {
            var mod = path.dirname(require.resolve(pkg)).replace(/\/lib$/, "");
            this.packages[pkg] = { path: mod };
            if (lib.statSync(mod + "/etc").isDirectory()) {
                this.packages[pkg].etc = 1;
                var cfg = lib.readFileSync(mod + "/etc/config");
                if (cfg) {
                    config = config + "\n" + cfg;
                    this.packages[pkg].config = 1;
                    this.parseConfig(cfg, 1, mod + "/etc/config");
                    this.parseArgs(process.argv, 1, "cmdline");
                }
            }
            for (const p of ["modules","locales","views","web"]) {
                if (lib.statSync(mod + "/" + p).isDirectory()) {
                    this.path[p].push(mod + "/" + p);
                    this.packages[pkg][p] = 1;
                }
            }
            var json = lib.readFileSync(mod + "/package.json", { json: 1, logger: "error", missingok: 1 });
            if (json.version) this.packages[pkg].version = json.version;
            logger.debug("loadPackages:", "npm package:", pkg, this.packages[pkg]);
        } catch (e) {
            logger.error("loadPackages:", "npm package:", pkg, e);
        }
    }
    return config;
}


// Make a HTTP request, see `httpGet` module for more details.
core.httpGet = function(uri, params, callback)
{
    return this.modules.httpGet(uri, params, callback);
}
core.ahttpGet = util.promisify(core.httpGet.bind(core));

// Make a HTTP request using `httpGet` with ability to sign requests.
//
// The POST request is made, if data is an object, it is converted into string.
//
// Returns params as in `httpGet` with .json property assigned with an object from parsed JSON response.
//
// *When used with API endpoints, the `backend-host` parameter must be set in the config or command line to the base URL of the backend,
// like http://localhost:8000, this is when `uri` is relative URL. Absolute URLs do not need this parameter.*
//
// Special parameters for options:
// - url - url if options is first argument
// - login - login to use for access credentials instead of global credentials
// - secret - secret to use for access instead of global credentials
// - checksum - calculate checksum from the data
// - obj - return just the result object, not the whole params
core.sendRequest = function(options, callback)
{
    if (typeof options == "string") options = { url: options };

    // Sign request using internal backend credentials
    if (options.sign || typeof options.sign == "undefined") {
        options = lib.objClone(options, "signer", this.signRequest);
    }

    for (var p in this.requestHeaders) {
        if (!options.headers) options.headers = {};
        options.headers[p] = this.requestHeaders[p];
    }

    // Relative urls resolve against global backend host
    if (typeof options.url == "string" && options.url.indexOf("://") == -1) {
        options = lib.objClone(options, "url", (this.backendHost || "http://localhost:" + this.port) + options.url);
    }

    return this.httpGet(options.url, options, (err, params) => {
        if (!params.obj) params.obj = {};
        if ((params.status < 200 || params.status > 299) && !err) {
            if (params.obj.message) {
                err = params.obj;
                err.status = params.status;
            } else
            if (!lib.isEmpty(params.obj)) {
                err = { message: lib.objDescr(params.obj), status: params.status };
            } else {
                err = { message: "Error " + params.status + (params.data ? ": " + params.data : ""), status: params.status };
            }
            if (err.status == 429 && !err.code) err.code = "OverCapacity";
        }
        logger.debug("sendRequest:", options, "rc:", params.status, params.type, params.size, "obj:", params.obj);
        lib.tryCall(callback, err, options.obj ? params.obj : params);
    });
}
core.asendRequest = util.promisify(core.sendRequest.bind(core));

core.signRequest = function()
{
    this.login = this.login || core.backendLogin || '';
    this.secret = this.secret || core.backendSecret || '';
    if (!this.login || !this.secret) return;
    var headers = core.modules.api.createSignature(this.login,
                                                   this.secret,
                                                   this.method,
                                                   this.hostname,
                                                   this.path,
                                                   { type: this.headers['content-type'], checksum: this.checksum });
    for (var p in headers) this.headers[p] = headers[p];
}

require(__dirname + "/core/args")
require(__dirname + "/core/utils")
require(__dirname + "/core/sendgrid")
