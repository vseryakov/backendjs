//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var util = require('util');
var fs = require('fs');
var repl = require('repl');
var path = require('path');
var crypto = require('crypto');
var domain = require('domain');
var url = require('url');
var http = require('http');
var https = require('https');
var child = require('child_process');
var utils = require(__dirname + '/build/Release/backend');
var logger = require(__dirname + '/logger');
var lib = require(__dirname + '/lib');
var cluster = require('cluster');
var os = require('os');
var emailjs = require('emailjs');
var xml2json = require('xml2json');
var dns = require('dns');

// The primary object containing all config options and common functions
var core = {
    // Backend process name
    name: 'bkjs',

    // Protocol version
    version: '2015.05.01',

    // Application version, read from package.json if exists
    appName: '',
    appVersion: '0',
    appDescr: "",

    // Process and config parameters
    argv: {},

    // Server role, used by API server, for provisioning must include backend
    role: '',

    // Environment mode of the process or the application
    runMode: 'development',

    // Current instance attributes gathered by other modules
    instance: { id: process.pid, type: "", index: 0, tag: '', image: '', region: '', zone: '' },
    workerId: '',

    // Home directory, current by default, must be absolute path
    home: process.env.BKJS_HOME || (process.env.HOME + '/.bkjs'),
    cwd: process.cwd(),

    // Various folders, by default relative paths are used
    path: { etc: "etc", spool: "var", images: "images", tmp: "tmp", web: "web", views: "views", files: "files", log: "log", modules: "modules" },

    // Log file for debug and other output from the modules, error or info messages, default is stdout
    logFile: "log/message.log",
    errFile: "log/error.log",
    confFile: "config",

    // HTTP settings
    port: 8000,
    bind: '0.0.0.0',
    timeout: 30000,
    backlog: 511,

    // HTTPS server options, can be updated by the apps before starting the SSL server
    ssl: { port: 443, bind: '0.0.0.0' },

    // WebSockets config
    ws: { port: 0, bind: "0.0.0.0", },

    // Proxy config
    proxy: { port: 0, bind: "127.0.0.1", ssl: false },

    // Number of parallel tasks running at the same time, can be used by various modules
    concurrency: 2,

    // Local host IPs and name
    ipaddr: '',
    subnet: '',
    network: '',
    ipaddrs: [],
    hostName: '',
    domain: '',
    maxCPUs: os.cpus().length,
    ctime: Date.now(),

    // Unix user/group privileges to set after opening port 80 and if running as root, in most cases this is ec2-user on Amazon cloud,
    // for manual installations `bkjs int-server` will create a user with this id
    uid: 0,
    gid: 0,
    umask: '0002',

    // Watched source files for changes, restarts the process if any file has changed
    watchdirs: [],
    timers: {},

    // Log watcher config, define different named channels for different patterns, email notification can be global or per channel
    logwatcherMax: 1000000,
    logwatcherInterval: 60,
    logwatcherAnyRange: 5,
    logwatcherEmail: {},
    logwatcherUrl: {},
    logwatcherIgnore: {},
    logwatcherMatch: {
        error: [ ' (ERROR|ALERT|EMERG|CRIT): ', 'message":"ERROR:' ],
        warning: [ ' (WARNING|WARN): ' ],
    },
    // List of files to watch, every file is an object with the following properties:
    //   - file: absolute pth to the log file - or -
    //   - name: name of the property in the core which hold the file path
    //   - ignore: a regexp with the pattern to ignore
    //   - match: a regexp with the pattern to match and report
    //   - type: channel if match is specified, otherwise it will go to the channel 'all'
    logwatcherFile: [
        { file: "/var/log/messages" },
        { name: "logFile" },
        { name: "errFile", match: /.+/, type: "error" }
    ],

    // Inter-process messages
    lruMax: 100000,

    // REPL pors
    repl: {
        bindWeb: '127.0.0.1',
        bindWorker: '127.0.0.1',
        bind: '127.0.0.1',
        file: '.history',
    },

    // All internal and loaded modules
    modules: {},
    // By default do not allow any modules, must be allowed in the config
    allowModules: /core/,

    // Config parameters
    args: [ { name: "help", type: "callback", callback: function() { this.showHelp() }, descr: "Print help and exit" },
            { name: "debug-filter", type: "callback", callback: function(v) { logger.setDebugFilter(v); }, descr: "Enable debug filters, format is: +label,... to enable, and -label,... to disable. Only first argument is used for label in logger.debug", cmdline: 1, pass: 1 },
            { name: "debug-run-segv", type: "callback", callback: function(v) { if(v) utils.runSEGV(v); }, descr: "On SEGV crash keep the process spinning so attaching with gdb is possible" },
            { name: "debug-set-segv", type: "callback", callback: function(v) { if(v) utils.setSEGV(); }, descr: "Set default SEGV handler which shows backtrace of calls if debug info is available" },
            { name: "debug-set-backtrace", type: "callback", callback: function(v) { if(v) utils.setBacktrace() }, descr: "Set alternative backtrace on SEGV crashes, including backtrace of V8 calls as well" },
            { name: "debug-logging", type: "callback", callback: function(v) { if(v) utils.logging(v) }, descr: "Set logging level only for the internal addons" },
            { name: "log", type: "callback", callback: function(v) { logger.setLevel(v); }, descr: "Set debugging level to any of " + Object.keys(logger.levels), cmdline: 1, pass: 1 },
            { name: "log-file", type: "callback", callback: function(v) { if(v) this.logFile=v;logger.setFile(this.logFile); }, descr: "Log to a file, if not specified used default logfile, disables syslog", pass: 1 },
            { name: "syslog", type: "callback", callback: function(v) { logger.setSyslog(v ? lib.toBool(v) : true); }, descr: "Write all logging messages to syslog, connect to the local syslog server over Unix domain socket", pass: 1 },
            { name: "console", type: "callback", callback: function() { logger.setFile(null);}, descr: "All logging goes to the console resetting all previous log related settings, this is used in the development mode mostly", pass: 1 },
            { name: "home", type: "callback", callback: "setHome", descr: "Specify home directory for the server, the server will try to chdir there or exit if it is not possible, the directory must exist", pass: 1 },
            { name: "conf-file", descr: "Name of the config file to be loaded instead of the default etc/config, can be relative or absolute path", pass: 1 },
            { name: "err-file", type: "path", descr: "Path to the error log file where daemon will put app errors and crash stacks", pass: 1 },
            { name: "etc-dir", type: "path", obj: "path", strip: "Dir", descr: "Path where to keep config files", pass: 1 },
            { name: "web-dir", type: "path", obj: "path", strip: "Dir", descr: "Path where to keep web pages" },
            { name: "views-dir", type: "path", obj: "path", strip: "Dir", descr: "Path where to keep web template views" },
            { name: "tmp-dir", type: "path", obj: "path", strip: "Dir", descr: "Path where to keep temp files" },
            { name: "spool-dir", type: "path", obj: "path", strip: "Dir", descr: "Path where to keep modifiable files" },
            { name: "log-dir", type: "path", obj: "path", strip: "Dir", descr: "Path where to keep other log files, log-file and err-file are not affected by this", pass: 1 },
            { name: "files-dir", type: "path", obj: "path", strip: "Dir", descr: "Path where to keep uploaded files" },
            { name: "images-dir", type: "path", obj: "path", strip: "Dir", descr: "Path where to keep images" },
            { name: "modules-dir", type: "path", obj: "path", strip: "Dir", descr: "Directory from where to load modules, these are the backendjs modules but in the same format and same conventions as regular node.js modules, the format of the files is NAME_{web,worker,shell}.js. The modules can load any other files or directories, this is just an entry point", pass: 1 },
            { name: "uid", type: "callback", callback: function(v) { if (!v)return;v = utils.getUser(v);if (v.name) this.uid = v.uid, this.gid = v.gid,this._name = "uid" }, descr: "User id or name to switch after startup if running as root, used by Web servers and job workers", pass: 1 },
            { name: "gid", type: "callback", callback: function(v) { if (!v)return;v = utils.getGroup(v);if (v.name) this.gid = v.gid,this._name = "gid" }, descr: "Group id or name to switch after startup if running to root", pass: 1 },
            { name: "email", descr: "Email address to be used when sending emails from the backend" },
            { name: "role", descr: "Override servers roles, this may have very strange side effects and should only be used for testing purposes" },
            { name: "force-uid", type: "callback", callback: "dropPrivileges", descr: "Drop privileges if running as root by all processes as early as possibly, this reqiures uid being set to non-root user. A convenient switch to start the backend without using any other tools like su or sudo.", pass: 1 },
            { name: "umask", descr: "Permissions mask for new files, calls system umask on startup, if not specified the current umask is used", pass: 1 },
            { name: "port", type: "number", min: 0, descr: "port to listen for the HTTP server, this is global default" },
            { name: "bind", descr: "Bind to this address only, if not specified listen on all interfaces" },
            { name: "backlog", descr: "The maximum length of the queue of pending connections, used by HTTP server in listen." },
            { name: "ws-port", type: "number", obj: 'ws', min: 0, descr: "port to listen for WebSocket server, it can be the same as HTTP/S ports to co-exist on existing web servers" },
            { name: "ws-bind", obj: 'ws', descr: "Bind to this address only for WebSocket, if not specified listen on all interfaces, only when the port is different from existing web ports" },
            { name: "ssl-port", type: "number", obj: 'ssl', min: 0, descr: "port to listen for HTTPS server, this is global default, be advised that proxy-port takes precedence" },
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
            { name: "concurrency", type:"number", min: 1, max: 4, descr: "How many simultaneous tasks to run at the same time inside one process, this is used by async module only to perform several tasks at once, this is not multithreading but and only makes sense for I/O related tasks" },
            { name: "timeout", type: "number", min: 0, max: 3600000, descr: "HTTP request idle timeout for servers in ms, how long to keep the connection socket open, this does not affect Long Poll requests" },
            { name: "daemon", type: "none", descr: "Daemonize the process, go to the background, can be specified only in the command line" },
            { name: "shell", type: "none", descr: "Run command line shell, load the backend into the memory and prompt for the commands, can be specified only in the command line" },
            { name: "monitor", type: "none", descr: "For production use, monitors the master and Web server processes and restarts if crashed or exited, can be specified only in the command line" },
            { name: "master", type: "none", descr: "Start the master server, can be specified only in the command line, this process handles job schedules and starts Web server, keeps track of failed processes and restarts them" },
            { name: "web", type: "none", descr: "Start Web server processes, spawn workers that listen on the same port, for use without master process which starts Web servers automatically" },
            { name: "proxy-port", type: "number", min: 0, obj: 'proxy', descr: "Start the HTTP reverse proxy server, all Web workers will listen on different ports and will be load-balanced by the proxy, the proxy server will listen on global HTTP port and all workers will listen on ports starting with the proxy-port" },
            { name: "proxy-ssl", type: "bool", obj: "proxy", descr: "Start HTTPS reverse proxy to accept incoming SSL requests, ssl-key/cert must be defined" },
            { name: "app-name", type: "callback", callback: function(v) { if (!v) return;v = v.split(/[\/-]/);this.appName=v[0].trim();if(v[1]) this.appVersion=v[1].trim();}, descr: "Set appName and version explicitely an skip reading it from package.json, it can be just a name or name-version", pass: 1 },
            { name: "instance-tag", obj: 'instance', descr: "Set instance tag explicitely, skip all meta data checks for it", pass: 1 },
            { name: "instance-region", obj: 'instance', obj: 'instance', descr: "Set instance region explicitely, skip all meta data checks for it", pass: 1 },
            { name: "instance-zone", obj: 'instance', descr: "Set instance zone explicitely, skip all meta data checks for it", pass: 1 },
            { name: "instance-job", obj: 'instance', type: "bool", descr: "Enables remote job mode, it means the backendjs is running in the cloud to execute a job or other task and can be terminated during the idle timeout" },
            { name: "run-mode", dns: 1, descr: "Running mode for the app, used to separate different running environment and configurations" },
            { name: "no-web", type: "bool", descr: "Disable Web server processes, without this flag Web servers start by default" },
            { name: "no-db", type: "bool", descr: "Do not initialize DB drivers" },
            { name: "no-dns", type: "bool", descr: "Do not use DNS configuration during the initialization" },
            { name: "no-configure", type: "bool", descr: "Do not run configure hooks during the initialization" },
            { name: "repl-bind-([a-z]+)", obj: "repl", descr: "Worker REPL listen address, supported suffixes: web, worker" },
            { name: "repl-port-([a-z]+)", type: "number", obj: "repl", min: 1001, descr: "Worker base REPL port, if specified it initializes REPL in the worker processes, in workers port is port+worker_id+1, supported suffixes: web, worker" },
            { name: "repl-port", type: "number", obj: "repl", min: 1001, descr: "Port for REPL interface in the master, if specified it initializes REPL in the master server process" },
            { name: "repl-bind", obj: "repl", descr: "Listen only on specified address for REPL server in the master process" },
            { name: "repl-file", obj: "repl", descr: "User specified file for REPL history" },
            { name: "worker", type: "bool", descr: "Set this process as a worker even it is actually a master, this skips some initializations" },
            { name: "allow-modules", type: "regexp", descr: "A regexp with modules name to be loaded on startup, only matched modules will be loaded, basename of the file is matched only, no path or extension", pass: 1 },
            { name: "deny-modules", type: "regexp", descr: "A regexp with modules names that will never be loaded even if allowed, this is for blacklisted modules", pass: 1 },
            { name: "logwatcher-from", descr: "Email address to send logwatcher notifications from, for cases with strict mail servers accepting only from known addresses" },
            { name: "logwatcher-interval", type: "number", min: 1, descr: "How often to check for errors in the log files in minutes" },
            { name: "logwatcher-any-range", type: "number", min: 1, descr: "Number of lines for matched channel `any` to be attached to the previous matched channel, if more than this number use the channel `any` on its own" },
            { name: "logwatcher-match-[a-z]+", obj: "logwatcher-match", array: 1, descr: "Regexp patterns that match conditions for logwatcher notifications, this is in addition to default backend logger patterns, suffix defines the log channel to use, like error, warning.... Special channel `any` is reserved to send matched lines to the previously matched channel if within configured range. Example: `-logwatcher-match-error=^failed:` `-logwatcher-match-any=line:[0-9]+`" },
            { name: "logwatcher-email-[a-z]+", obj: "logwatcher-email", descr: "Email address for the logwatcher notifications, the monitor process scans system and backend log files for errors and sends them to this email address, if not specified no log watching will happen, each channel must define an email separately, one of error, warning, info, all. Example: `-logwatcher-email-error=help@error.com`" },
            { name: "logwatcher-ignore-[a-z]+", obj: "logwatcher-ignore", array: 1, descr: "Regexp with patterns that need to be ignored by the logwatcher process, it is added to the list of ignored patterns for each specified channel separately" },
            { name: "logwatcher-file(-[a-z]+)?", obj: "logwatcher-file", type: "callback", callback: function(v,k) { if (v) this.push({file:v,type:k}) }, descr: "Add a file to be watched by the logwatcher, it will use all configured match patterns" },
            { name: "logwatcher-url(-[a-z]+)?", obj: "logwatcher-url", descr: "The backend URL(s) where logwatcher reports should be sent instead of sending over email" },
            { name: "user-agent", array: 1, descr: "Add HTTP user-agent header to be used in HTTP requests, for scrapers or other HTTP requests that need to be pretended coming from Web browsers" },
            { name: "backend-host", descr: "Host of the master backend, can be used for backend nodes communications using core.sendRequest function calls with relative URLs, also used in tests." },
            { name: "backend-login", descr: "Credentials login for the master backend access when using core.sendRequest" },
            { name: "backend-secret", descr: "Credentials secret for the master backend access when using core.sendRequest" },
            { name: "host-name", type: "callback", callback: function(v) { if(v)this.hostName=v;this.domain = lib.domainName(this.hostName);this._name = "hostName" }, descr: "Hostname/domain to use for communications, default is current domain of the host machine" },
            { name: "config-domain", descr: "Domain to query for configuration TXT records, must be specified to enable DNS configuration" },
            { name: "watch", type: "callback", callback: function(v) { this.watch = true; this.watchdirs.push(v ? v : __dirname); }, descr: "Watch sources directory for file changes to restart the server, for development only, the backend module files will be added to the watch list automatically, so only app specific directores should be added. In the production -monitor must be used." }
    ],
}

module.exports = core;

// Main initialization, must be called prior to perform any actions.
//
// If options are given they may contain the following properties:
// - noDb - if true do not initialize database
// - noConfigure - do not run all configure methods
// - noDns - do not retrieve config from DNS
// - noWatch - do not watch and reload config files
// - localDb - no db pools except local and config, this is passed to db.init
core.init = function(options, callback)
{
    var self = this;

    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {};
    var db = self.modules.db;

    // Already initialized, skip the whole sequence so it is safe to run in the server the scripts which
    // can be used as standalone node programs
    if (this._initialized) {
        logger.debug("init:", "already initialized");
        return typeof callback == "function" ? callback.call(self, null, options) : true;
    }

    // Process role
    if (options.role) this.role = options.role;
    if (cluster.worker) this.workerId = cluster.worker.id;

    // Random proces id to be used as a prefix in clusters
    self.pid = crypto.randomBytes(4).toString('hex');

    // Initial args to run before the config file
    self.processArgs(self, process.argv, 1);

    // Default home as absolute path from the command line or custom config file passed
    self.setHome(self.home);

    // No restriction on the client http clients
    http.globalAgent.maxSockets = http.Agent.defaultMaxSockets = Infinity;
    https.globalAgent.maxSockets = Infinity;

    // Find our IP address
    var intf = os.networkInterfaces();
    Object.keys(intf).forEach(function(x) {
        if (x.substr(0, 2) == 'lo') return;
        intf[x].forEach(function(y) {
            if (y.family != 'IPv4' || !y.address) return;
            if (!self.ipaddr) self.ipaddr = y.address;
            self.ipaddrs.push(y.address);
        });
    });
    self.subnet = self.ipaddr.split(".").slice(0, 3).join(".");
    self.network = self.ipaddr.split(".").slice(0, 2).join(".");
    self.hostName = os.hostname().toLowerCase();
    self.domain = lib.domainName(self.hostName);
    self.location = "http://" + self.hostName + ":" + core.port;
    // Pre load config files into memory to perform 2 passes
    var config = "";

    // Serialize initialization procedure, run each function one after another
    lib.series([
        function(next) {
            // Default config files, locate in the etc if just name is given
            if (self.confFile.indexOf("/") == -1) self.confFile = path.join(self.path.etc, self.confFile);
            self.confFile = path.resolve(self.confFile);
            lib.forEachSeries([self.confFile, self.confFile + ".local"], function(file, next2) {
                logger.debug('loadConfig:', file);
                fs.readFile(file, function(err, data) {
                    if (data) config += data.toString() + "\n";
                    next2();
                });
            }, next);
        },

        // Process first pass parameters, this is important for modules to be loaded
        function(next) {
            self.parseConfig(config, 2);
            next();
        },

        // Load external modules, from the core and from the app home
        function(next) {
            var modules = path.resolve(__dirname, "modules");
            if (modules != path.resolve(self.path.modules)) {
                self.loadModules(modules, { denyModules: self.denyModules, allowModules: self.allowModules });
            }
            self.loadModules(self.path.modules, { denyModules: self.denyModules, allowModules: self.allowModules });
            next();
        },

        // Now re-process all other config parameters for all modules again
        function(next) {
            self.parseConfig(config);

            // Override by the command line parameters
            self.parseArgs(process.argv);
            next();
        },

        // Application version from the package.json
        function(next) {
            if (!self.appName) {
                var pkg = lib.readFileSync("package.json", { json: 1 });
                if (!pkg.version) pkg = lib.readFileSync(self.cwd + "/package.json", { json: 1 });
                if (!pkg.version) pkg = lib.readFileSync(self.path.etc + "/../package.json", { json: 1 });
                if (pkg.name) self.appName = pkg.name;
                if (pkg.version) self.appVersion = pkg.version;
                if (pkg.description) self.appDescr = pkg.description;
                if (!self.appName) self.appName = self.name;
            }
            next();
        },

        // Load config params from the DNS TXT records, only the ones marked as dns
        function(next) {
            if (options.noDns || self.noDns) return next();
            self.loadDnsConfig(options, next);
        },

        // Create all directories, only master should do it once but we resolve absolute paths in any mode
        function(next) {
            // Redirect system logging to stderr
            logger.setChannel("stderr");

            try { process.umask(self.umask); } catch(e) { logger.error("umask:", self.umask, e) }

            // Create all subfolders with permissions, run it before initializing db which may create files in the spool folder
            if (!cluster.isWorker && !self.worker) {
                Object.keys(self.path).forEach(function(p) {
                    lib.mkdirSync(self.path[p]);
                    lib.chownSync(this.uid, this.gid, self.path[p]);
                });
            }
            next();
        },

        // Run all configure methods for every module
        function(next) {
            if (options.noConfigure || self.noConfigure) return next();
            self.runMethods("configure", options, next);
        },

        // Initialize all database pools
        function(next) {
            if (options.noDb || self.noDb) return next();
            db.init(options, next);
        },

        // Load all available config parameters from the config database for the specified config type
        function(next) {
            if (options.noDb || self.noDb) return next();
            db.initConfig(options, next);
        },

        // Make sure spool and db files are owned by regular user, not the root
        function(next) {
            if (!cluster.isWorker && !self.worker && process.getuid() == 0) {
                lib.findFileSync(self.path.spool).forEach(function(p) { lib.chownSync(self.uid, self.gid, p); });
            }
            next();
        },

        function(next) {
            if (options.noWatch) return next();
            // Can only watch existing files
            lib.forEach([self.confFile, self.confFile + ".local"], function(file, next2) {
                fs.exists(file, function(exists) {
                    if (exists) fs.watch(file, function (event, filename) {
                        self.setTimeout(file, function() { self.loadConfig(file); }, 5000);
                    });
                    next2();
                });
            }, next);
        },
        // Initialize all modules after core is done
        function(next) {
            if (options.noConfigure || self.noConfigure) return next();
            self.runMethods("configureModule", options, next);
        },
        function(next) {
            // Default email address
            if (!self.email) self.email = (self.appName || self.name) + "@" + self.domain;
            next();
        },
        ],
        // Final callbacks
        function(err) {
            logger.debug("init:", err || "");
            if (!err) self._initialized = true;
            if (typeof callback == "function") callback.call(self, err, options);
    });
}

// Run any backend function after environment has been initialized, this is to be used in shell scripts,
// core.init will parse all command line arguments, the simplest case to run from /data directory and it will use
// default environment or pass -home dir so the script will reuse same config and paths as the server
// context can be specified for the callback, if no then it run in the core context
// - require('backendjs').run(function() {}) is one example where this call is used as a shortcut for ad-hoc scripting
core.run = function(options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = {};

    if (typeof callback != "function") return logger.error('run:', 'callback is required');
    this.init(options, function(err) {
        callback.call(self, err);
    });
}

// Exit the process with possible message to be displayed and status code
core.exit = function(code, msg)
{
    if (msg) console.log(msg);
    process.exit(code || 0);
}

// Switch to new home directory, exit if we cannot, this is important for relative paths to work if used,
// no need to do this in worker because we already switched to home directory in the master and all child processes
// inherit current directory
// Important note: If run with combined server or as a daemon then this MUST be an absolute path, otherwise calling
// it in the spawned web master will fail due to the fact that we already set the home and relative path will not work after that.
core.setHome = function(home)
{
    if ((home || this.home) && cluster.isMaster) {
        if (home) this.home = path.resolve(home);
        // On create set permissions
        if (lib.makePathSync(this.home)) lib.chownSync(this.uid, this.gid, this.home);
        try {
            process.chdir(this.home);
        } catch(e) {
            logger.error('setHome: cannot set home directory', this.home, e);
            process.exit(1);
        }
        logger.dev('setHome:', this.home);
    }
    this.home = process.cwd();
}

// Parse config lines for the file or other place
core.parseConfig = function(data, pass)
{
    if (!data) return;
    var argv = [], lines = String(data).split("\n");
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line.match(/^([a-z0-9_-]+)/)) continue;
        line = line.split("=");
        if (line[0]) argv.push('-' + line[0].trim());
        if (line[1]) argv.push(line.slice(1).join('=').trim());
    }
    this.parseArgs(argv, pass);
}

// Parse command line arguments
core.parseArgs = function(argv, pass)
{
    if (!Array.isArray(argv) || !argv.length) return;

    // Convert spaces if passed via command line
    argv = argv.map(function(x) {
        return x.replace(/(\\n|%20|%0A)/ig, function(m) { return m == '\\n' || m == '%0a' || m == '%0A' ? '\n' : m == "%20" ? ' ' : m; });
    });
    logger.dev('parseArgs:', argv.join(' '));

   // Core parameters
    this.processArgs(this, argv, pass);

    // Run registered handlers for each module
    for (var n in this.modules) {
        this.processArgs(this.modules[n], argv, pass);
    }
}

// Config parameters defined in a module as a list of parameter names prefixed with module name, a parameters can be
// a string which defines text parameter or an object with the properties: name, type, value, decimals, min, max, separator
// type can be bool, number, list, json
core.processArgs = function(ctx, argv, pass)
{
    var self = this;
    if (!ctx || !Array.isArray(ctx.args) || !Array.isArray(argv) || !argv.length) return;

    function put(obj, key, val, x, reverse) {
        if (reverse) {
            var v = val;
            val = key;
            key = v;
        }

        if (Array.isArray(key)) {
            for (var i in key) put(obj, key[i], val, x);
        } else
        if (x.array) {
            if (val == null) {
                obj[key] = [];
            } else {
                if (!Array.isArray(obj[key]) || x.set) obj[key] = [];
                if (Array.isArray(val)) {
                    val.forEach(function(x) { if (obj[key].indexOf(x) == -1) obj[key].push(x); });
                } else {
                    if (obj[key].indexOf(val) == -1) obj[key].push(val);
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

    for (var i = 0; i < argv.length; i++) {
        var key = String(argv[i]);
        if (!key || key[0] != "-") continue;
        var val = argv[i + 1] || null;
        if (val) {
            val = String(val);
            if (val[0] == "-") val = null; else i++;
        }

        ctx.args.forEach(function(x) {
            if (!x.name) return;
            // Process only equal to the given pass phase
            if (pass && !x.pass) return;

            var obj = ctx;
            // Module prefix and name of the key variable in the contenxt, key. property specifies alternative name for the value
            var prefix = ctx == self ? "-" : "-" + ctx.name + "-";
            // Name can be a regexp
            if (!key.match("^" + prefix + x.name + "$")) return;
            var name = x.key || key.substr(prefix.length), oname = "";
            // Command line priority, ignore all subsequent values
            if (x.cmdline && pass != 1 && self.isArg(key)) return;

            try {
                // Place inside the object
                if (x.obj) {
                    oname = lib.toCamel(x.obj, x.camel);
                    if (!ctx[oname]) ctx[oname] = {};
                    obj = ctx[oname];
                    // Strip the prefix if starts with the same name
                    name = name.replace(new RegExp("^" + x.obj + "-"), "");
                }

                if (!x.nocamel) name = lib.toCamel(name, x.camel);
                // Update case according to the pattern(s)
                if (x.ucase) name = name.replace(new RegExp(x.ucase, 'g'), function(v) { return v.toUpperCase(); });
                if (x.lcase) name = name.replace(new RegExp(x.lcase, 'g'), function(v) { return v.toLowerCase(); });
                if (x.strip) name = name.replace(new RegExp(x.strip, 'g'), "");

                // Use defaults only for the first time
                if (val == null && typeof obj[name] == "undefined") {
                    if (typeof x.novalue != "undefined") val = x.novalue;
                }
                // Explicit empty value
                if (val == "''" || val == '""') val = "";
                // Only some types allow no value case
                var type = (x.type || "").trim();
                if (val == null && type != "bool" && type != "callback" && type != "none") return false;

                // Can be set only once
                if (x.once) {
                    if (!self._once) self._once = {};
                    if (self._once[name]) return;
                    self._once[name] = 1;
                }

                // Set the actual config variable name for further reference and easy access to the value
                if (val != null) {
                    x._name = (oname ? oname + "." : "") + name;
                    x._key = key;
                }
                if (val == "<null>") val = null;
                logger.debug("processArgs:", x.type || "str", ctx.name + "." + x._name, "(" + key + ")", "=", val);
                switch (type) {
                case "none":
                    break;
                case "bool":
                    put(obj, name, !val ? true : lib.toBool(val), x, x.reverse);
                    break;
                case "int":
                case "real":
                case "number":
                    put(obj, name, lib.toNumber(val, x.decimals, x.value, x.min, x.max), x, x.reverse);
                    break;
                case "map":
                    put(obj, name, lib.strSplit(val).map(function(x) { return x.split(":") }).reduce(function(x,y) { if (!x[y[0]]) x[y[0]] = {}; x[y[0]][y[1]] = 1; return x }, {}), x, x.reverse);
                    break;
                case "intmap":
                    put(obj, name, lib.strSplit(val).map(function(x) { return x.split(":") }).reduce(function(x,y) { x[y[0]] = lib.toNumber(y[1]); return x }, {}), x, x.reverse);
                break;
                case "list":
                    put(obj, name, lib.strSplitUnique(val, x.separator), x, x.reverse);
                    break;
                case "regexp":
                    put(obj, name, val ? new RegExp(val) : val, x, x.reverse);
                    break;
                case "regexpobj":
                    if (x.reverse) {
                        obj[val] = lib.toRegexpObj(obj[val], name, x);
                    } else {
                        obj[name] = lib.toRegexpObj(obj[name], val, x);
                    }
                    break;
                case "regexpmap":
                    if (x.reverse) {
                        obj[val] = lib.toRegexpMap(obj[val], name, x);
                    } else {
                        obj[name] = lib.toRegexpMap(obj[name], val, x);
                    }
                    break;
                case "url":
                    put(obj, name, val ? url.parse(val) : val, x, x.reverse);
                    break;
                case "json":
                    put(obj, name, val ? lib.jsonParse(val) : val, x, x.reverse);
                    break;
                case "path":
                    // Check if it starts with local path, use the actual path not the current dir for such cases
                    for (var p in this.path) {
                        if (val && val.substr(0, p.length + 1) == p + "/") {
                            val = this.path[p] + val.substr(p.length);
                            break;
                        }
                    }
                    put(obj, name, val ? path.resolve(val) : val, x, x.reverse);
                    break;
                case "file":
                    if (!val) break;
                    try { put(obj, name, fs.readFileSync(path.resolve(val)), x); } catch(e) { logger.error('procesArgs:', name, val, e); }
                    break;
                case "callback":
                    if (!x.callback) break;
                    if (typeof x.callback == "string") {
                        obj[x.callback](val, name, pass);
                    } else
                    if (typeof x.callback == "function") {
                        x.callback.call(obj, val, name, pass);
                    }
                    break;
                default:
                    put(obj, name, val, x, x.reverse);
                }
            } catch(e) {
                logger.error("processArgs:", name, val, e.stack);
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
    var self = this;
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
                addArgs(self.modules[ctx], [map[x]]);
                delete map[x];
            }
        });
    });
    // The rest goes to the core
    addArgs(this, Object.keys(map).map(function(x) { return map[x] }));
}

// Print help about command line arguments and exit
core.showHelp = function(options)
{
    var self = this;
    if (!options) options = {};
    var args = [ [ '', core.args ] ];
    Object.keys(this.modules).forEach(function(n) {
        if (self.modules[n].args) args.push([n, self.modules[n].args]);
    });
    var data = "";
    args.forEach(function(x) {
        x[1].forEach(function(y) {
            if (!y.name || !y.descr) return;
            var dflt = y._name ? lib.objGet(x[0] ? self.modules[x[0]] : self, y._name) : "";
            var line = (x[0] ? x[0] + '-' : '') + (y.match ? 'NAME-' : '') + y.name + (options.markdown ? "`" : "") + " - " + y.descr + (dflt ? ". Default: " + JSON.stringify(dflt) : "");
            if (y.dns) line += ". DNS TXT configurable.";
            if (y.match) line += ". Where NAME is the actual " + y.match + " name.";
            if (y.count) line += ". " + y.count + " variants: " + y.name + "-1 .. " + y.name + "-" + y.count + ".";
            if (options && options.markdown) {
                data += "- `" +  line + "\n";
            } else {
                console.log(" -" + line);
            }
        });
    });
    if (options.markdown) return data;
    process.exit(0);
}

// Parse the config file, configFile can point to a file or can be skipped and the default file will be loaded
core.loadConfig = function(file, callback)
{
    var self = this;
    if (typeof callback != "function") callback = lib.noop;

    logger.debug('loadConfig:', file);

    fs.readFile(file || "", function(err, data) {
        if (!err) self.parseConfig(data);
        callback(err);
    });
}

// Load configuration from the DNS TXT records
core.loadDnsConfig = function(options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null
    if (!options) options = {};
    if (typeof callback != "function") callback = lib.noop;

    if (!self.configDomain) return callback();

    var args = [], argv = [];
    this.args.forEach(function(x) { if (x.name && x.dns) push(["", x]); });
    for (var p in this.modules) {
        if (Array.isArray(this.modules[p].args)) this.modules[p].args.forEach(function(x) { if (x.name && x.dns) push([p + "-", x]); });
    }
    lib.forEachLimit(args, options.concurrency || 5, function(x, next) {
        var cname = x[0] + x[1].name;
        dns.resolveTxt(cname + "." + self.configDomain, function(err, list) {
            if (!err && list && list.length) {
                argv.push("-" + cname, list[0]);
                logger.debug('dns.config:', cname, list[0]);
            }
            next();
        });
    }, function() {
        self.parseArgs(argv);
        callback();
    });
}

// Return unique process name based on the cluster status, worker or master and the role. This is can be reused by other workers within the role thus
// making it usable for repeating environments or storage solutions.
core.processName = function()
{
    return (this.role || this.name) + this.workerId;
}

// Create a Web server with options and request handler, returns a server object.
//
// Options can have the following properties:
// - port - port number is required
// - bind - address to bind
// - restart - name of the processes to restart on address in use error, usually "web"
// - ssl - an object with SSL options for TLS createServer call
// - timeout - number of milliseconds for the request timeout
// - name - server name to be assigned
core.createServer = function(options, callback)
{
    var self = this;
    if (!options || !options.port) {
        logger.error('createServer:', 'invalid options', options);
        return null;
    }
    var server = options.ssl ? https.createServer(options.ssl, callback) : http.createServer(callback);
    if (options.timeout) server.timeout = options.timeout;
    server.on('error', function(err) {
        logger.error(this.role + ':', 'port:', options.port, lib.traceError(err));
        // Restart backend processes on address in use
        if (err.code == 'EADDRINUSE' && options.restart) {
            self.killBackend(options.restart, "SIGKILL", function() { process.exit(0) });
        }
    });
    server.serverPort = options.port;
    if (options.name) server.serverName = options.name;
    try { server.listen(options.port, options.bind, this.backlog); } catch(e) { logger.error('server: listen:', options, e); server = null; }
    logger.log("createServer:", options.port, options.bind);
    return server;
}

// Downloads file using HTTP and pass it to the callback if provided
//
// - uri can be full URL or an object with parts of the url, same format as in url.format
// - params can contain the following options:
//   - method - GET, POST
//   - headers - object with headers to pass to HTTP request, properties must be all lower case
//   - cookies - a list with cookies or a boolean to load cookies from the db
//   - file - file name where to save response, in case of error response the error body will be saved as well
//   - postdata - data to be sent with the request in the body
//   - postfile - file to be uploaded in the POST body, not as multipart
//   - postsize - file size to be uploaded if obtained separately
//   - chunked - post files using chunked encoding
//   - query - additional query parameters to be added to the url as an object or as encoded string
//   - sign - sign request with provided email/secret properties
//   - mtime - a Date or timestamp to be used in conditional requests
//   - conditional - add If-Modified-Since header using `params.mtime` if present or if `file` is given use file last modified timestamp, mtime
//   - httpTimeout - timeout in milliseconds afte which the request is borted if no data received
//   - retryCount - how many time to retry the request on error or timeout
//   - retryTimeout - timeout in milliseconds for retries, with every subsequent timeout it will be multiplied by 2
//   - retryOnErrorStatus - also retry request if received non 2xx response status
// - callback will be called with the arguments:
//     first argument is error object if any
//     second is params object itself with updated fields
//     third is HTTP response object
// On end, the object params will contain the following updated properties:
//  - data if file was not specified, data will contain collected response body as string
//  - status - HTTP response status code
//  - mtime - Date object with the last modified time of the requested file
//  - size - size of the response body or file
// Note: SIDE EFFECT: params object is modified in place so many options will be changed/removed or added
core.httpGet = function(uri, params, callback)
{
    var self = this;
    if (typeof params == "function") callback = params, params = null;
    if (!params) params = {};
    if (typeof callback != "function") callback = lib.noop;

    // Additional query parameters as an object
    var qtype = lib.typeName(params.query);
    switch (lib.typeName(uri)) {
    case "object":
        uri = url.format(uri);
        break;

    case "string":
        var q = url.format({ query: qtype == "object" ? params.query: null, search: qtype == "string" ? params.query: null });
        uri += uri.indexOf("?") == -1 ? q : q.substr(1);
        break;

    default:
        return callback(lib.newError("invalid url: " + uri), params);
    }
    // Reset output properties
    params.size = 0;
    params.err = null;
    params.fd = 0;
    params.status = 0;
    params.poststream = null;

    var options = url.parse(uri);
    options.method = params.method || 'GET';
    options.headers = params.headers || {};
    options.agent = params.agent || null;
    options.rejectUnauthorized = false;
    if (!options.hostname) options.hostname = "localhost", options.port = core.port, options.protocol = "http:";

    if (!options.headers['user-agent']) {
        options.headers['user-agent'] = this.name + "/" + this.version + " " + this.appVersion;
    }
    if (options.method == "POST" && !options.headers["content-type"]) {
        options.headers["content-type"] = "application/x-www-form-urlencoded";
    }

    // Load matched cookies and restart with the cookie list in the params
    if (params.cookies) {
        if (typeof params.cookies == "boolean" && options.hostname) {
            this.cookieGet(options.hostname, function(cookies) {
                params.cookies = cookies;
                self.httpGet(uri, params, callback);
            });
            return;
        }
        // Cookie list already provided, just use it
        if (Array.isArray(params.cookies)) {
            options.headers["cookie"] = params.cookies.map(function(c) { return c.name+"="+c.value; }).join("; ");
            logger.debug('httpGet:', uri, options.headers);
        }
    }
    if (!options.headers['accept']) options.headers['accept'] = '*/*';

    // Data to be sent over in the body
    if (params.postdata) {
        switch (lib.typeName(params.postdata)) {
        case "string":
            if (!options.headers['content-length']) options.headers['content-length'] = Buffer.byteLength(params.postdata, 'utf8');
            break;
        case "buffer":
            if (!options.headers['content-length']) options.headers['content-length'] = params.postdata.length;
            break;
        case "object":
            params.postdata = JSON.stringify(params.postdata);
            options.headers['content-type'] = "application/json";
            options.headers['content-length'] = Buffer.byteLength(params.postdata, 'utf8');
            break;
        default:
            params.postdata = String(params.postdata);
            options.headers['content-length'] = Buffer.byteLength(params.postdata, 'utf8');
        }
    } else
    if (params.postfile) {
        if (options.method == "GET") options.method = "POST";
        if (params.chunked) {
            options.headers['transfer-encoding'] = 'chunked';
        } else {
            if (!params.postsize && !options.headers["content-length"]) {
                fs.stat(params.postfile, function(err, stats) {
                    if (err) return callback(err, params);
                    params.mtime = stats.mtime.getTime();
                    params.postsize = stats.size;
                    self.httpGet(uri, params, callback);
                });
                return;
            }
            if (params.postsize) options.headers['content-length'] = params.postsize;
        }
        params.poststream = fs.createReadStream(params.postfile);
        params.poststream.on("error", function(err) { logger.error('httpGet: stream:', params.postfile, err) });
    }

    // Make sure our data is not corrupted
    if (params.checksum) options.checksum = params.postdata ? lib.hash(params.postdata) : null;

    // Sign request using internal backend credentials
    if (params.sign) {
        var headers = this.modules.api.createSignature(params.login, params.secret, options.method, options.hostname, options.path, { type: options.headers['content-type'], checksum: options.checksum });
        for (var p in headers) options.headers[p] = headers[p];
    }

    // Use file name form the url
    if (params.file && params.file[params.file.length - 1] == "/") params.file += path.basename(options.pathname);

    // Conditional, time related
    if (params.conditional) {
        delete params.conditional;
        if (params.mtime) {
            options.headers["if-modified-since"] = lib.toDate(params.mtime).toUTCString();
        } else

        if (params.file) {
            fs.stat(params.file, function(err, stats) {
                if (!err && stats.size > 0) {
                    params.mtime = stats.mtime.getTime();
                    options.headers["if-modified-since"] = lib.toDate(params.mtime).toUTCString();
                }
                self.httpGet(uri, params, callback);
            });
            return;
        }
    }

    // Runtime properties
    params.redirects = lib.toNumber(params.redirects, { min: 0 });
    params.retryCount = lib.toNumber(params.retryCount, { min: 0 });
    params.retryTimeout = lib.toNumber(params.retryTimeout, { min: 0, dflt: 250 });
    params.httpTimeout = lib.toNumber(params.httpTimeout, { min: 0, dflt: 300000 });
    if (!params.ignoreredirect) params.ignoreredirect = {};
    params.data = params.binary ? new Buffer(0) : '';
    params.href = options.href;
    params.pathname = options.pathname;
    params.hostname = options.hostname;
    params.search = options.search;
    var req = null;
    var mod = uri.indexOf("https://") == 0 ? https : http;

    req = mod.request(options, function(res) {
      logger.dev("httpGet:", "started", options.method, 'headers:', options.headers, params)

      res.on("data", function(chunk) {
          logger.dev("httpGet:", "data", 'size:', chunk.length, '/', params.size, "status:", res.statusCode, 'file:', params.file || '');

          if (params.stream) {
              try {
                  params.stream.write(chunk);
              } catch(e) {
                  if (!params.quiet) logger.error('httpGet:', "stream:", e);
                  params.err = e;
                  req.abort();
              }
          } else
          if (params.file) {
              try {
                  if (!params.fd && res.statusCode >= 200 && res.statusCode < 300) {
                      params.fd = fs.openSync(params.file, 'w');
                  }
                  if (params.fd) {
                      fs.writeSync(params.fd, chunk, 0, chunk.length, null);
                  }
              } catch(e) {
                  if (!params.quiet) logger.error('httpGet:', "file:", params.file, e);
                  params.err = e;
                  req.abort();
              }
          } else
          if (params.binary) {
              params.data = Buffer.concat([params.data, chunk]);
          } else {
              params.data += chunk.toString();
          }
          params.size += chunk.length
      });

      res.on("end", function() {
          // Array means we wanted to use cookies just did not have existing before the request, now we can save the ones we received
          if (Array.isArray(params.cookies)) {
              self.cookieSave(params.cookies, res.headers["set-cookie"], params.hostname);
          }
          params.headers = res.headers;
          params.status = res.statusCode;
          params.type = (res.headers['content-type'] || '').split(';')[0];
          params.mtime = res.headers.date ? lib.toDate(res.headers.date) : null;
          if (!params.size) params.size = lib.toNumber(res.headers['content-length'] || 0);
          if (params.fd) try { fs.closeSync(params.fd); } catch(e) {}
          if (params.stream) try { params.stream.end(params.onfinish); } catch(e) {}
          params.fd = 0;

          logger.dev("httpGet:", "end", options.method, "url:", uri, "size:", params.size, "status:", params.status, 'type:', params.type, 'location:', res.headers.location || '', 'retry:', params.retryCount, params.retryTimeout);

          // Retry the same request on status codes configured explicitely
          if ((res.statusCode < 200 || res.statusCode >= 400) && params.retryOnErrorStatus && params.retryCount-- > 0) {
              setTimeout(function() { self.httpGet(uri, params, callback); }, params.retryTimeout *=2 );
              return;
          }
          // Redirection
          switch (res.statusCode) {
          case 301:
          case 302:
          case 303:
          case 307:
              if (params.noredirects) break;
              params.redirects += 1;
              if (params.redirects < 10) {
                  var uri2 = res.headers.location || "";
                  if (uri2.indexOf("://") == -1) uri2 = options.protocol + "//" + options.host + uri2;
                  logger.dev('httpGet:', 'redirect', uri2);

                  // Ignore redirects we don't want and return data received
                  if (!params.ignoreredirect[uri2]) {
                      ['method','query','headers','postdata','postfile','poststream','sign','checksum'].forEach(function(x) { delete params[x] });
                      if (params.cookies) params.cookies = true;
                      return self.httpGet(uri2, params, callback);
                  }
              }
              break;
          }
          logger.debug("httpGet:", "done", options.method, "url:", uri, "size:", params.size, "status:", res.statusCode, 'type:', params.type, 'location:', res.headers.location || '');

          callback(params.err, params, res);
      });

    }).on('error', function(err) {
        if (!params.quiet) logger[params.retryCount ? "debug" : "error"]("httpGet:", "onerror:", uri, 'file:', params.file || "", 'retry:', params.retryCount, params.retryTimeout, 'timeout:', params.httpTimeout, 'size;', params.size, err);
        // Keep trying if asked for it
        if (params.retryCount-- > 0) {
            setTimeout(function() { self.httpGet(uri, params, callback); }, params.retryTimeout *= 2);
            return;
        }
        callback(err, params, {});
    });
    if (params.httpTimeout) {
        req.setTimeout(params.httpTimeout, function() {
            if (!params.quiet) logger[params.retryCount ? "debug" : "error"]("httpGet:", "timeout:", uri, 'file:', params.file || "", 'retry:', params.retryCount, params.retryTimeout, 'timeout:', params.httpTimeout);
            req.abort();
        });
    }
    if (params.postdata) {
        req.write(params.postdata);
    } else
    if (params.poststream) {
        params.poststream.pipe(req);
        return req;
    }
    req.end();
    return req;
}

// Make a HTTP request using `httpGet` with ability to sign requests and returne parsed JSON payload as objects.
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
// - proxy - used as a proxy to backend, handles all errors and returns .status and .json to be passed back to API client
// - checksum - calculate checksum from the data
// - anystatus - keep any HTTP status, dont treat as error if not between 200 and 299
// - obj - return just result object, not the whole params
core.sendRequest = function(options, callback)
{
    var self = this;
    if (!options) options = {};
    if (typeof options == "string") options = { url: options };
    if (typeof options.sign == "undefined") options.sign = true;
    if (options.sign) {
        if (!options.login) options.login = self.backendLogin;
        if (!options.secret) options.secret = self.backendSecret;
    }

    // Relative urls resolve against global backend host
    if (typeof options.url == "string" && options.url.indexOf("://") == -1) {
        options.url = (self.backendHost || "http://localhost:" + this.port) + options.url;
    }
    var db = self.modules.db;

    this.httpGet(options.url, lib.cloneObj(options), function(err, params, res) {
        // If the contents are encrypted, decrypt before processing content type
        if ((options.headers || {})['content-encoding'] == "encrypted") {
            params.data = lib.decrypt(options.secret, params.data);
        }
        // Parse JSON and store in the params, set error if cannot be parsed, the caller will deal with it
        if (params.data) {
            switch (params.type) {
            case "application/json":
                try { params.obj = JSON.parse(params.data); } catch(e) { err = e; }
                break;

            case "text/xml":
            case "application/xml":
                try { params.obj = xml2json.toJson(params.data, { object: true }); } catch(e) { err = e }
                break;
            }
        }
        if (!params.obj) params.obj = {};
        if ((params.status < 200 || params.status >= 300) && !err && !options.anystatus) {
            err = lib.newError({ message: util.format("ResponseError: %d: %j", params.status, params.obj), name: "HTTP", status: params.status });
        }
        if (typeof callback == "function") callback(err, options.obj ? params.obj : params, options.obj ? null : res);
    });
}

// Run a method for every module, a method must conform to the following signature: `function(options, callback)` and
// call the callback when finished. The callback second argument will be the options, so it is possible to pass anything
// in the options back to the caller. Errors from a module is never propagated and simply ignored.
//
// The following properties can be specified in the options:
//  - denyModules - a regexp of the modules names to be excluded from calling the method
//  - allowModules - a regexp of the modules names to be called only
//
core.runMethods = function(name, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = {};
    if (typeof callback != "function") callback = lib.noop;
    if (!options) options = {};

    lib.forEachSeries(Object.keys(self.modules), function(mod, next) {
        if (util.isRegExp(options.denyModules) && options.denyModules.test(mod)) return next();
        if (util.isRegExp(options.allowModules) && !options.allowModules.test(mod)) return next();
        var ctx = self.modules[mod];
        if (typeof ctx[name] != "function") return next();
        logger.debug("runMethods:", name, mod);
        ctx[name](options, function(err) {
            if (err) logger.error('runMethods:', name, mod, err);
            next();
        });
    }, function(err) {
        callback(err, options);
    });
}

// Adds reference to the objects in the core for further access, specify module name, module reference pairs.
// This is used the the core itself to register all internal modules and makes it available in the shell and in the `core.modules` object.
//
// Also this is used when cresting modular backend application by separating the logic into different modules, by registering such
// modules with the core it makes the module a first class citizen in the backendjs core and exposes all the callbacks and methods.
//
// For example, the module below will register API routes and some methods
//
//       var bkjs = require("backendjs");
//       var mymod = {}
//       exports.module = mymod;
//       core.addModule("mymod", mymod);
//       mymod.configureWeb = function(options, callback) {
//          bkjs.api.app.all("/mymod", function(req, res) {
//               res.json({});
//          });
//       }
//
//
// In the main app.js just load it and the rest will be done automatically, i.e. routes will be created ...
//
//       var mymod = require("./mymod.js");
//
// Running the shell will make the object `mymod` available
//
//       ./app.sh -shell
//       > mymod
//         {}
//
core.addModule = function()
{
    for (var i = 0; i < arguments.length - 1; i+= 2) {
        this.modules[arguments[i]] = arguments[i + 1];
        if (!arguments[i + 1].name) arguments[i + 1].name = arguments[i];
    }
}

// Dynamically load services from the specified directory.
//
// The modules are loaded using `require` as a normal nodejs module but in addition if the module exports
// `init` method it is called immediately with options passed as an argument. This is a synchronous function so it is supposed to be
// called on startup, not dynamically during a request processing. Only top level .js files are loaded, not subdirectories. `core.addModule` is called
// automatically.
//
// **Caution must be taken for module naming, it is possible to override any default bkjs module which will result in unexpected behaviour**
//
// The following options properties can be specified:
//  - denyModules - a regexp with modules name(s) to be excluded from loading, the basename of a file is checked only
//  - allowModules - a regexp with modules name(s) to be loaded only
//
//  Example, to load all modules from the local relative directory
//
//       core.loadModules("modules")
//
core.loadModules = function(dir, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    lib.findFileSync(path.resolve(dir), { depth: 1, types: "f", include: /\.js$/ }).sort().forEach(function(file) {
        try {
            var base = path.basename(file, ".js");
            if (util.isRegExp(options.denyModules) && options.denyModules.test(base)) return;
            if (util.isRegExp(options.allowModules) && !options.allowModules.test(base)) return;

            var mod = require(file);
            self.addModule(mod.name || base, mod);
            // Call the initializer method for the module after it is registered
            if (typeof mod.init == "function") {
                mod.init(options);
            }
            logger.info("loadModules:", file, "loaded");
        } catch (e) {
            logger.error("loadModules:", file, e.stack);
        }
    });
    if (typeof callback == "function") callback();
}


// Return commandline argument value by name
core.getArg = function(name, dflt)
{
    var idx = process.argv.lastIndexOf(name);
    var val = idx > -1 && idx + 1 < process.argv.length ? process.argv[idx + 1] : "";
    if (val[0] == "-") val = "";
    if (!val && typeof dflt != "undefined") val = dflt;
    return val;
}

// Return commandline argument value as a number
core.getArgInt = function(name, dflt)
{
    return lib.toNumber(this.getArg(name, dflt));
}

// Returns true of given arg(s) are present in the command line, name can be a string or an array of strings.
core.isArg = function(name)
{
    if (!Array.isArray(name)) return process.argv.lastIndexOf(name) > 0;
    return name.some(function(x) { return process.argv.lastIndexOf(x) > 0 });
}

// Send email
core.sendmail = function(options, callback)
{
    var self = this;
    try {
        if (!options.from) options.from = "admin";
        if (options.from.indexOf("@") == -1) options.from += "@" + self.domain;
        if (!options.text) options.text = "";
        if (!options.subject) options.subject = "";
        if (options.to) options.to += ",";
        var server = emailjs.server.connect();
        server.send(options, function(err, message) {
            if (err) logger.error('sendmail:', err);
            if (typeof callback == "function") callback(err);
        });
    } catch(e) {
        logger.error('sendmail:', e);
        if (typeof callback == "function") callback(e);
    }
}

// Kill all backend processes that match name and not the current process
core.killBackend = function(name, signal, callback)
{
    var self = this;
    if (typeof signal == "function") callback = signal, signal = '';
    if (!signal) signal = 'SIGTERM';

    lib.execProcess("/bin/ps agx", function(stderr, stdout) {
        stdout.split("\n").
               filter(function(x) { return x.match(core.name + ":") && (!name || x.match(name)); }).
               map(function(x) { return lib.toNumber(x) }).
               filter(function(x) { return x != process.pid }).
               forEach(function(x) { try { process.kill(x, signal); } catch(e) { logger.error('killBackend:', name, x, e); } });
        if (typeof callback == "function") callback();
    });
}

// Shutdown the machine now
core.shutdown = function()
{
    var self = this;
    child.exec("/sbin/halt", function(err, stdout, stderr) {
        logger.log('shutdown:', stdout || "", stderr || "", err || "");
    });
}

// Drop root privileges and switch to regular user
core.dropPrivileges = function()
{
    if (process.getuid() == 0 && this.uid) {
        logger.debug('init: switching to', this.uid, this.gid);
        try { process.setgid(this.gid); } catch(e) { logger.error('setgid:', this.gid, e); }
        try { process.setuid(this.uid); } catch(e) { logger.error('setuid:', this.uid, e); }
    }
}

// Set or reset a timer
core.setTimeout = function(name, callback, timeout)
{
    if (this.timers[name]) clearTimeout(this.timers[name]);
    this.timers[name] = setTimeout(callback, timeout);
}

// Return cookies that match given domain
core.cookieGet = function(domain, callback)
{
    var self = this;
    var db = this.modules.db;
    var cookies = [];
    db.scan("bk_property", {}, { pool: db.local }, function(row, next) {
        if (!row.name.match(/^bk:cookie:/)) return next();
        var cookie = lib.jsonParse(row.value, { obj: 1 })
        if (cookie.expires <= Date.now()) return next();
        if (cookie.domain == domain) {
            cookies.push(cookie);
        } else
        if (cookie.domain.charAt(0) == "." && (cookie.domain.substr(1) == domain || domain.match(cookie.domain.replace(/\./g,'\\.') + '$'))) {
            cookies.push(cookie);
        }
        next();
    }, function(err) {
        logger.debug('cookieGet:', domain, cookies);
        if (callback) callback(err, cookies);
    });
}

// Save new cookies arrived in the request,
// merge with existing cookies from the jar which is a list of cookies before the request
core.cookieSave = function(cookiejar, setcookies, hostname, callback)
{
    var self = this;
    var db = this.modules.db;
    var cookies = !setcookies ? [] : Array.isArray(setcookies) ? setcookies : String(setcookies).split(/[:](?=\s*[a-zA-Z0-9_\-]+\s*[=])/g);
    logger.debug('cookieSave:', cookiejar, 'SET:', cookies);
    cookies.forEach(function(cookie) {
        var parts = cookie.split(";");
        var pair = parts[0].match(/([^=]+)=((?:.|\n)*)/);
        if (!pair) return;
        var obj = { name: pair[1], value: pair[2], path: "", domain: "", secure: false, expires: Infinity };
        for (var i = 1; i < parts.length; i++) {
            pair = parts[i].match(/([^=]+)(?:=((?:.|\n)*))?/);
            if (!pair) continue;
            var key = pair[1].trim().toLowerCase();
            var value = pair[2];
            switch(key) {
            case "expires":
                obj.expires = value ? Number(lib.toDate(value)) : Infinity;
                break;

            case "path":
                obj.path = value ? value.trim() : "";
                break;

            case "domain":
                obj.domain = value ? value.trim() : "";
                break;

            case "secure":
                obj.secure = true;
                break;
            }
        }
        if (!obj.domain) obj.domain = hostname || "";
        var found = false;
        cookiejar.forEach(function(x, j) {
            if (x.path == obj.path && x.domain == obj.domain && x.name == obj.name) {
                if (obj.expires <= Date.now()) {
                    cookiejar[j] = null;
                } else {
                    cookiejar[j] = obj;
                }
                found = true;
            }
        });
        if (!found) cookiejar.push(obj);
    });
    lib.forEachSeries(cookiejar, function(rec, next) {
        if (!rec) return next();
        if (!rec.id) rec.id = lib.hash(rec.name + ':' + rec.domain + ':' + rec.path);
        db.put("bk_property", { name: "bk:cookie:" + rec.id, value: rec }, { pool: db.local }, function() { next() });
    }, function() {
        if (callback) callback();
    });
}

// Start/stop CPU V8 profiler, on stop, core.cpuProfile will contain the profiler nodes
core.profiler = function(type, cmd)
{
    switch(type + "." + cmd) {
    case "cpu.start":
        utils.startProfiling();
        break;

    case "cpu.stop":
        this.cpuProfile = utils.stopProfiling();
        break;

    case "cpu.clear":
        this.cpuProfile = null;
        utils.deleteAllProfiles();
        break;

    case "heap.save":
        var snapshot = utils.takeSnapshot();
        snapshot.save("tmp/" + process.pid + ".heapsnapshot");
        utils.deleteAllSnapshots();
        break;

    case "heap.take":
        this.heapSnapshot = utils.takeSnapshot();
        break;

    case "heap.clear":
        this.heapSnapshot = null;
        utils.deleteAllSnapshots();
        break;
    }
}

// Create REPL interface with all modules available
core.createRepl = function(options)
{
    var self = this;
    var r = repl.start(options || {});
    r.context.core = this;
    r.context.fs = fs;
    r.context.os = os;
    r.context.util = util;
    r.rli.historyIndex = 0;
    r.rli.history = [];
    // Expose all modules as top level objects
    for (var p in this.modules) r.context[p] = this.modules[p];

    // Support history
    if (this.repl.file) {
        r.rli.history = lib.readFileSync(this.repl.file, { list: '\n' }).reverse();
        r.rli.addListener('line', function(code) {
            if (code) {
                fs.appendFile(self.repl.file, code + '\n', function() {});
            } else {
                r.rli.historyIndex++;
                r.rli.history.pop();
            }
      });
    }
    return r;
}

// Watch temp files and remove files that are older than given number of seconds since now, remove only files that match pattern if given
// Options properties:
// - match - a regexp that specifies only files to be watched
// - ignore - a regexp of files to be ignored
// - seconds - number of seconds a file to be older to be deleted
// - nodirs - if 1 skip deleting directories
core.watchTmp = function(dir, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {};
    if (!options.seconds) options.seconds = 86400;

    var now = Date.now();
    fs.readdir(dir, function(err, files) {
        if (err) return callback ? callback(err) : null;

        lib.forEachSeries(files, function(file, next) {
            if (file == "." || file == "..") return next();
            if (options.match && !file.match(options.match)) return next();
            if (options.ignore && file.match(options.ignore)) return next();

            file = path.join(dir, file);
            fs.stat(file, function(err, st) {
                if (err) return next();
                if (options.nodirs && st.isDirectory()) return next();
                if (now - st.mtime < options.seconds*1000) return next();
                logger.info('watchTmp: delete', dir, file, (now - st.mtime)/1000, 'sec old');
                if (st.isDirectory()) {
                    lib.unlinkPath(file, function(err) {
                        if (err) logger.error('watchTmp:', file, err);
                        next();
                    });
                } else {
                    fs.unlink(file, function(err) {
                        if (err) logger.error('watchTmp:', file, err);
                        next();
                    });
                }
            });
        }, callback);
    });
}

// Watch files in a dir for changes and call the callback
core.watchFiles = function(dir, pattern, callback)
{
    var self = this;
    logger.debug('watchFiles:', dir, pattern);

    function watcher(event, file) {
        // Check stat if no file name, Mac OS X does not provide it
        var stat = lib.statSync(file.name);
        if (stat.size == file.stat.size && stat.mtime == file.stat.mtime) return;
        logger.log('watchFiles:', event, file.name, file.ino, stat.size);
        if (event == "rename") {
            file.watcher.close();
            file.watcher = fs.watch(file.name, function(event) { watcher(event, file); });
        }
        file.stat = stat;
        callback(file);
    }

    fs.readdir(dir, function(err, list) {
        if (err) return callback(err);
        list.filter(function(file) {
            return file.match(pattern);
        }).map(function(file) {
            file = path.join(dir, file);
            return ({ name: file, stat: lib.statSync(file) });
        }).forEach(function(file) {
            logger.debug('watchFiles:', file.name, file.stat.ino, file.stat.size);
            file.watcher = fs.watch(file.name, function(event) { watcher(event, file); });
        });
    });
}

// Watch log files for errors and report via email or POST url, see config parameters starting with `logwatcher-` about how this works
core.watchLogs = function(options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};
    var db = self.modules.db;

    // Check interval
    self.logwatcherMtime = Date.now();

    // From address, use current hostname
    if (!self.logwatcherFrom) self.logwatcherFrom = "logwatcher@" + self.domain;

    var match = {};
    for (var p in self.logwatcherMatch) {
        try {
            match[p] = new RegExp(self.logwatcherMatch[p].map(function(x) { return "(" + x + ")"}).join("|"));
        } catch(e) {
            logger.error('watchLogs:', e, self.logwatcherMatch[p]);
        }
    }
    var ignore = {}
    for (var p in self.logwatcherIgnore) {
        try {
            ignore[p] = new RegExp(self.logwatcherIgnore[p].map(function(x) { return "(" + x + ")"}).join("|"));
        } catch(e) {
            logger.error('watchLogs:', e, self.logwatcherIgnore[p]);
        }
    }

    // Run over all regexps in the object, return channel name if any matched
    function matchObj(obj, line) {
        for (var p in obj) if (obj[p].test(line)) return p;
        return "";
    }

    logger.debug('watchLogs:', self.logwatcherEmail, self.logwatcherUrl, self.logwatcherFiles);

    // Load all previous positions for every log file, we start parsing file from the previous last stop
    db.select("bk_property", { name: 'logwatcher:' }, { ops: { name: 'begins_with' }, pool: db.local }, function(err, rows) {
        var lastpos = {};
        for (var i = 0; i < rows.length; i++) {
            lastpos[rows[i].name] = rows[i].value;
        }
        var errors = {}, echan = "", eline = 0;

        // For every log file
        lib.forEachSeries(self.logwatcherFile, function(log, next) {
            var file = log.file;
            if (!file && self[log.name]) file = self[log.name];
            if (!file) return next();

            fs.stat(file, function(err, st) {
               if (err) return next();
               // Last saved position, start from the end if the log file is too big or got rotated
               var pos = lib.toNumber(lastpos['logwatcher:' + file] || 0);
               if (st.size - pos > self.logwatcherMax || pos > st.size) pos = st.size - self.logwatcherMax;

               fs.open(file, "r", function(err, fd) {
                   if (err) return next();
                   var buf = new Buffer(self.logwatcherMax);
                   fs.read(fd, buf, 0, buf.length, Math.max(0, pos), function(err, nread, buffer) {
                       fs.close(fd, function() {});
                       if (err || !nread) return next();

                       var lines = buffer.slice(0, nread).toString().split("\n");
                       for (var i = 0; i < lines.length; i++) {
                           // Skip local or global ignore list first
                           if ((log.ignore && log.ignore.test(lines[i])) || matchObj(ignore, lines[i])) continue;
                           // Match both global or local filters
                           var chan = log.match && log.match.test(lines[i]) ? (log.type || "all") : "";
                           if (!chan) chan = matchObj(match, lines[i]);
                           if (chan) {
                               // Attach to the previous channel, for cases when more error into like backtraces are matched with
                               // a separate pattern. If no channel previously matched use any as the channel itself.
                               chan = chan == "any" && i - eline <= self.logwatcherAnyRange ? (echan || "any") : chan;
                               if (!errors[chan]) errors[chan] = "";
                               errors[chan] += lines[i] + "\n";
                               // Add all subsequent lines starting with a space or tab, those are continuations of the error or stack traces
                               while (i < lines.length -1 && (lines[i + 1][0] == ' ' || lines[i + 1][0] == '\t')) {
                                   errors[chan] += lines[++i] + "\n";
                               }
                               echan = chan;
                               eline = i;
                           }
                       }
                       // Save current size to start next time from
                       db.put("bk_property", { name: 'logwatcher:' + file, value: st.size }, { pool: db.local }, function(err) {
                           if (err) logger.error('watchLogs:', file, err);
                           next();
                       });
                   });
               });
            });
        }, function(err) {
            lib.forEach(Object.keys(errors), function(type, next) {
                if (!errors[type].length) return next();
                logger.log('logwatcher:', type, 'found matches, sending to', self.logwatcherEmail[type] || "", self.logwatcherUrl[type] || "");

                if (self.logwatcherUrl[type]) {
                    self.sendRequest({ url: self.logwatcherUrl[type],
                                       queue: true,
                                       headers: { "content-type": "text/plain" },
                                       method: "POST",
                                       postdata: errors[type] }, function() { next() });
                    return;
                }
                if (self.logwatcherEmail[type]) {
                    self.sendmail({ from: self.logwatcherFrom,
                                    to: self.logwatcherEmail[type],
                                    subject: "logwatcher: " + type + ": " + os.hostname() + "/" + self.ipaddr + "/" + self.instance.id + "/" + self.runMode,
                                    text: errors[type] }, function() { next() });
                    return;
                }
                next();
            }, function(err) {
                if (typeof callback == "function") callback(err, errors);
            });
        });
    });
}

