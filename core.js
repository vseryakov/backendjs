//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var util = require('util');
var fs = require('fs');
var repl = require('repl');
var path = require('path');
var crypto = require('crypto');
var url = require('url');
var http = require('http');
var https = require('https');
var exec = require('child_process').exec;
var backend = require(__dirname + '/build/Release/backend');
var logger = require(__dirname + '/logger');
var cluster = require('cluster');
var printf = require('printf');
var async = require('async');
var os = require('os');
var emailjs = require('emailjs');
var xml2json = require('xml2json');
var uuid = require('uuid');
var dns = require('dns');

// The primary object containing all config options and common functions
var core = {
    name: 'backend',

    // Protocol version
    version: '2014.06.15',

    // Process and config parameters
    argv: {},

    // Server role, used by API server, for provisioning must include backend
    role: '',

    // Local domain
    domain: '',

    // Instance mode, remote jobs
    instance: false,
    instanceId: process.pid,

    // Home directory, current by default, must be absolute path
    home: process.env.BACKEND_HOME || (process.env.HOME + '/.backend'),

    // Various folders, by default relative paths are used
    path: { etc: "etc", spool: "var", images: "images", tmp: "tmp", web: "web", files: "files", log: "log" },

    // Log file for debug and other output from the modules, error or info messages, default is stdout
    logFile: "log/backend.log",
    errFile: "log/error.log",

    // HTTP settings
    port: 8000,
    bind: '0.0.0.0',
    timeout: 30000,
    backlog: 511,

    // HTTPS server options, can be updated by the apps before starting the SSL server
    ssl: { port: 443, bind: '0.0.0.0' },

    // Sockets.io config
    socketio: { port: 0, bind: "0.0.0.0", options: {} },

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
    hostname: '',
    domain: '',
    maxCPUs: os.cpus().length,
    ctime: Date.now(),

    // Collector of statistics, seconds
    collectInterval: 30,
    collectSendInterval: 300,

    // Unix user/group privileges to set after opening port 80 and if running as root, in most cases this is ec2-user on Amazon cloud,
    // for manual installations `bkjs int-server` will create a user with this id
    uid: 0,
    gid: 0,
    umask: '0002',

    // Watched source files for changes, restarts the process if any file has changed
    watchdirs: [],
    timers: {},

    // Log watcher config, watch for server restarts as well
    logwatcherMax: 1000000,
    logwatcherInterval: 60,
    logwatcherIgnore: ["NOTICE: ", "DEBUG: ", "DEV: "],
    logwatcherMatch: ['\[[0-9]+\]: (ERROR|WARNING): ', 'message":"ERROR:'],
    logwatcherFiles: [ { file: "/var/log/messages" }, { name: "logFile" }, { name: "errFile", match: /.+/, } ],

    // User agent
    userAgent: [],

    // Config parameters
    args: [ { name: "help", type: "callback", value: function() { core.showHelp() }, descr: "Print help and exit" },
            { name: "debug", type: "callback", value: function() { logger.setDebug('debug'); }, descr: "Enable debugging messages, short of -log debug", pass: 1 },
            { name: "debug-label", type: "callback", value: function(v) { logger.setDebugLabel(v); }, descr: "Enable debugging labels, format is: +label,... to enable, and -label,... to disable. Only first argument is used for label in logger.debug", pass: 1 },
            { name: "debug-run-segv", type: "callback", value: function(v) { if(v) backend.runsegv(); }, descr: "On SEGV crash keep the process spinning so attaching with gdb is possible" },
            { name: "debug-set-segv", type: "callback", value: function(v) { if(v) backend.setsegv(); }, descr: "Set default SEGV handler which shows backtrace of calls if debug info is available" },
            { name: "debug-set-backtrace", type: "callback", value: function(v) { if(v) backend.setbacktrace() }, descr: "Set alternative backtrace on SEGV crashes, including backtrace of V8 calls as well" },
            { name: "log", type: "callback", value: function(v) { logger.setDebug(v); }, descr: "Set debugging level: none, log, debug, dev", pass: 1 },
            { name: "log-file", type: "callback", value: function(v) { if(v) this.logFile=v;logger.setFile(this.logFile); }, descr: "Log to a file, if not specified used default logfile, disables syslog", pass: 1 },
            { name: "syslog", type: "callback", value: function(v) { logger.setSyslog(v ? this.toBool(v) : true); }, descr: "Write all logging messages to syslog, connect to the local syslog server over Unix domain socket", pass: 1 },
            { name: "console", type: "callback", value: function() { logger.setFile(null);}, descr: "All logging goes to the console resetting all previous log related settings, this is used in the development mode mostly", pass: 1 },
            { name: "home", type: "callback", value: "setHome", descr: "Specify home directory for the server, the server will try to chdir there or exit if it is not possible, the directory must exist", pass: 1 },
            { name: "conf-file", descr: "Name of the config file to be loaded instead of the default etc/config, can be relative or absolute path", pass: 1 },
            { name: "err-file", type: "path", descr: "Path to the error log file where daemon will put app errors and crash stacks", pass: 1 },
            { name: "etc-dir", type: "callback", value: function(v) { if (v) this.path.etc = v; }, descr: "Path where to keep config files", pass: 1 },
            { name: "web-dir", type: "callback", value: function(v) { if (v) this.path.web = v; }, descr: "Path where to keep web pages" },
            { name: "tmp-dir", type: "callback", value: function(v) { if (v) this.path.tmp = v; }, descr: "Path where to keep temp files" },
            { name: "spool-dir", type: "callback", value: function(v) { if (v) this.path.spool = v; }, descr: "Path where to keep modifiable files" },
            { name: "log-dir", type: "callback", value: function(v) { if (v) this.path.log = v; }, descr: "Path where to keep other log files, log-file and err-file are not affected by this", pass: 1 },
            { name: "files-dir", type: "callback", value: function(v) { if (v) this.path.files = v; }, descr: "Path where to keep uploaded files" },
            { name: "images-dir", type: "callback", value: function(v) { if (v) this.path.images = v; }, descr: "Path where to keep images" },
            { name: "uid", type: "callback", value: function(v) { var u = backend.getUser(v); if (u.uid) this.uid = u.uid, this.gid = u.gid; }, descr: "User id or name to switch after startup if running as root, used by Web servers and job workers", pass: 1 },
            { name: "gid", type: "callback", value: function(v) { var g = backend.getGroup(v); if (g) this.gid = g.gid; }, descr: "Group id or name to switch after startup if running to root", pass: 1 },
            { name: "force-uid", type: "callback", value: "dropPrivileges", descr: "Drop privileges if running as root by all processes as early as possibly, this reqiures uid being set to non-root user. A convenient switch to start the backend without using any other tools like su or sudo.", pass: 1 },
            { name: "umask", descr: "Permissions mask for new files, calls system umask on startup, if not specified the current umask is used", pass: 1 },
            { name: "port", type: "number", min: 0, descr: "port to listen for the HTTP server, this is global default" },
            { name: "bind", descr: "Bind to this address only, if not specified listen on all interfaces" },
            { name: "backlog", descr: "The maximum length of the queue of pending connections, used by HTTP server in listen." },
            { name: "socketio-port", type: "number", obj: 'socketio', min: 0, descr: "port to listen for sockets.io server" },
            { name: "socketio-bind", obj: 'socketio', descr: "Bind to this address only for sockets.io server, if not specified listen on all interfaces" },
            { name: "ws-port", type: "number", obj: 'ws', min: 0, descr: "port to listen for WebSocket server, it can be the same as HTTP/S ports to co-exist on existing web servers" },
            { name: "ws-bind", obj: 'ws', descr: "Bind to this address only for WebSocket, if not specified listen on all interfaces, only when the port is different from existing web ports" },
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
            { name: "concurrency", type:"number", min: 1, max: 4, descr: "How many simultaneous tasks to run at the same time inside one process, this is used by async module only to perform several tasks at once, this is not multithreading but and only makes sense for I/O related tasks" },
            { name: "timeout", type: "number", min: 0, max: 3600000, descr: "HTTP request idle timeout for servers in ms, how long to keep the connection socket open, this does not affect Long Poll requests" },
            { name: "daemon", type: "none", descr: "Daemonize the process, go to the background, can be specified only in the command line" },
            { name: "shell", type: "none", descr: "Run command line shell, load the backend into the memory and prompt for the commands, can be specified only in the command line, no servers will be initialized, only the core and db modules" },
            { name: "monitor", type: "none", descr: "For production use, monitors the master and Web server processes and restarts if crashed or exited, can be specified only in the command line" },
            { name: "master", type: "none", descr: "Start the master server, can be specified only in the command line, this process handles job schedules and starts Web server, keeps track of failed processes and restarts them" },
            { name: "proxy-port", type: "number", min: 0, obj: 'proxy', descr: "Start the HTTP reverse proxy server, all Web workers will listen on different ports and will be load-balanced by the proxy, the proxy server will listen on global HTTP port and all workers will listen on ports starting with the proxy-port" },
            { name: "proxy-ssl", type: "bool", obj: "proxy", descr: "Start HTTPS reverse proxy to accept incoming SSL requests " },
            { name: "web", type: "none", descr: "Start Web server processes, spawn workers that listen on the same port, without this flag no Web servers will be started by default" },
            { name: "no-web", type: "bool", descr: "Disable Web server processes, without this flag Web servers start by default" },
            { name: "repl-port-web", type: "number", min: 1001, descr: "Web server REPL port, if specified it initializes REPL in the Web server process" },
            { name: "repl-bind-web", descr: "Web server REPL listen address" },
            { name: "repl-port", type: "number", min: 1001, descr: "Port for REPL interface in the master, if specified it initializes REPL in the master server process" },
            { name: "repl-bind", descr: "Listen only on specified address for REPL server in the master process" },
            { name: "repl-file", descr: "User specified file for REPL history" },
            { name: "lru-max", type: "number", descr: "Max number of items in the LRU cache, this cache is managed by the master Web server process and available to all Web processes maintaining only one copy per machine, Web proceses communicate with LRU cache via IPC mechanism between node processes" },
            { name: "no-msg", type: "bool", descr: "Disable nanomsg messaging sockets" },
            { name: "msg-port", type: "int", descr: "Ports to use for nanomsg sockets for message publish and subscribe, 2 ports will be used, this one and the next" },
            { name: "msg-type", descr: "One of the redis, amqp or nanomsg to use for PUB/SUB messaging, default is nanomsg sockets" },
            { name: "msg-host", dns: 1, descr: "Server(s) where clients publish and subscribe messages using nanomsg sockets, IPs or hosts separated by comma, TCP port is optional, msg-port is used" },
            { name: "msg-bind", descr: "Listen only on specified address for messaging sockets server in the master process" },
            { name: "memcache-host", dns: 1, type: "list", descr: "List of memcached servers for cache messages: IP[:port],host[:port].." },
            { name: "memcache-options", type: "json", descr: "JSON object with options to the Memcached client, see npm doc memcached" },
            { name: "redis-port", dns: 1, descr: "Port to Redis server for cache and messaging" },
            { name: "redis-host", dns: 1, descr: "Address to Redis server for cache and messaging" },
            { name: "redis-options", type: "json", descr: "JSON object with options to the Redis client, see npm doc redis" },
            { name: "amqp-host", type: "json", descr: "Host running RabbitMQ" },
            { name: "amqp-options", type: "json", descr: "JSON object with options to the AMQP client, see npm doc amqp" },
            { name: "cache-type", descr: "One of the local, redis, memcache or nanomsg to use for caching in API requests" },
            { name: "cache-host", dns: 1, descr: "Address of nanomsg cache servers, IPs or hosts separated by comma: IP:[port],host[:[port], if TCP port is not specified, cache-port is used" },
            { name: "cache-port", type: "int", descr: "Port to use for nanomsg sockets for cache requests" },
            { name: "cache-bind", descr: "Listen only on specified address for cache sockets server in the master process" },
            { name: "worker", type:" bool", descr: "Set this process as a worker even it is actually a master, this skips some initializations" },
            { name: "collect-host", descr: "The backend URL where all collected statistics should be sent" },
            { name: "collect-interval", type: "number", min: 30, descr: "How often to collect statistics and metrics in seconds" },
            { name: "collect-send-interval", type: "number", min: 60, descr: "How often to send collected statistics to the master server in seconds" },
            { name: "logwatcher-url", descr: "The backend URL where logwatcher reports should be sent instead of email" },
            { name: "logwatcher-email", dns: 1, descr: "Email address for the logwatcher notifications, the monitor process scans system and backend log files for errors and sends them to this email address, if not specified no log watching will happen" },
            { name: "logwatcher-from", descr: "Email address to send logwatcher notifications from, for cases with strict mail servers accepting only from known addresses" },
            { name: "logwatcher-ignore", array: 1, descr: "Regexp with patterns that needs to be ignored by logwatcher process, it is added to the list of ignored patterns" },
            { name: "logwatcher-match", array: 1, descr: "Regexp patterns that match conditions for logwatcher notifications, this is in addition to default backend logger patterns" },
            { name: "logwatcher-interval", type: "number", min: 1, descr: "How often to check for errors in the log files in minutes" },
            { name: "logwatcher-file", type: "callback", value: function(v) { if (v) this.logwatcherFiles.push({file:v}) }, descr: "Add a file to be watched by the logwatcher, it will use all configured match patterns" },
            { name: "user-agent", array: 1, descr: "Add HTTP user-agent header to be used in HTTP requests, for scrapers or other HTTP requests that need to be pretended coming from Web browsers" },
            { name: "backend-host", descr: "Host of the master backend, can be used for backend nodes communications using core.sendRequest function calls with relative URLs, also used in tests." },
            { name: "backend-login", descr: "Credentials login for the master backend access when using core.sendRequest" },
            { name: "backend-secret", descr: "Credentials secret for the master backend access when using core.sendRequest" },
            { name: "domain", descr: "Domain to use for communications, default is current domain of the host machine" },
            { name: "config-domain", descr: "Domain to query for configuration TXT records, must be specified to enable DNS configuration" },
            { name: "max-distance", type: "number", min: 0.1, max: 999, descr: "Max searchable distance(radius) in km, for location searches to limit the upper bound" },
            { name: "min-distance", type: "number", min: 0.1, max: 999, descr: "Radius for the smallest bounding box in km containing single location, radius searches will combine neighboring boxes of this size to cover the whole area with the given distance request, also this affects the length of geohash keys stored in the bk_location table" },
            { name: "instance", type: "bool", descr: "Enables instance mode, it means the backend is running in the cloud to execute a job or other task and can be terminated during the idle timeout" },
            { name: "watch", type: "callback", value: function(v) { this.watch = true; this.watchdirs.push(v ? v : __dirname); }, descr: "Watch sources directory for file changes to restart the server, for development only, the backend module files will be added to the watch list automatically, so only app specific directores should be added. In the production -monitor must be used." }
    ],

    // Geo min distance for the hash key, km
    minDistance: 5,
    // Max searchable distance, km
    maxDistance: 50,

    // Inter-process messages
    deferTimeout: 50,
    lruMax: 100000,

    // REPL port for server
    replBindWeb: '127.0.0.1',
    replBind: '127.0.0.1',
    replFile: '.history',
    context: {},

    // Cache and messaging properties
    cacheType: 'nanomsg',
    cachePort: 20100,
    cacheHost: "127.0.0.1",
    msgType: 'nanomsg',
    msgPort: 20110,
    msgHost: "127.0.0.1",
    subCallbacks: {},
}

module.exports = core;

// Main initialization, must be called prior to perform any actions.
// If options are given they may contain the following properties:
// - noPools - if true do not initialize database pools except default sqlite
// - noDns - do not retrieve config from DNS
core.init = function(options, callback)
{
    var self = this;

    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {};
    var db = self.context.db;

    // Process role
    if (options.role) this.role = options.role;

    // Random proces id to be used as a prefix in clusters
    self.pid = crypto.randomBytes(4).toString('hex');

    // Initial args to run before the config file
    self.processArgs("core", self, process.argv, 1);

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

    // Default domain from local host name
    self.hostname = os.hostname();
    self.domain = self.domainName(self.hostname);
    // Default config file
    self.confFile = path.resolve(self.confFile || path.join(self.path.etc, "config"));

    // Serialize initialization procedure, run each function one after another
    async.series([
        function(next) {
            self.loadConfig(self.confFile, function() { next(); });
        },

        // Load config params from the DNS TXT records, only the ones marked as dns
        function(next) {
            if (options.noInit) return next();
            self.loadDnsConfig(options, next);
        },

        // Create all directories, only master should do it once but we resolve absolute paths in any mode
        function(next) {
            // Redirect system logging to stderr
            logger.setChannel("stderr");

            // Process all other arguments
            self.parseArgs(process.argv);

            try { process.umask(self.umask); } catch(e) { logger.error("umask:", self.umask, e) }

            // Create all subfolders with permissions, run it before initializing db which may create files in the spool folder
            if (!cluster.isWorker && !self.worker) {
                Object.keys(self.path).forEach(function(p) {
                    self.mkdirSync(self.path[p]);
                    self.chownSync(self.path[p]);
                });
            }
            next();
        },

        function(next) {
            if (options.noInit) return next();
            // Custom application init
            self.preInit.call(self, next);
        },

        function(next) {
            if (options.noInit) return next();
            // Run all configure methods for every module
            async.forEachSeries(Object.keys(self.context), function(name, next2) {
                var ctx = self.context[name];
                if (!ctx.configure) return next2();
                ctx.configure(options, next2);
            }, next);
        },

        function(next) {
            if (options.noInit) return next();
            db.init(options, next);
        },

        // Load all available config parameters from the config database for the specified config type
        function(next) {
            if (options.noInit) return next();
            self.loadDbConfig(options, next);
        },

        // Make sure spool and db files are owned by regular user, not the root
        function(next) {
            if (!cluster.isWorker && !self.worker && process.getuid() == 0) {
                self.findFileSync(self.path.spool).forEach(function(p) { self.chownSync(p); });
            }
            next();
        },

        function(next) {
            if (options.noInit) return next();
            // Can only watch existing files
            fs.exists(self.confFile, function(exists) {
                if (!exists) return next();
                fs.watch(self.confFile, function (event, filename) {
                    self.setTimeout(filename, function() { self.loadConfig(self.confFile); }, 5000);
                });
                next();
            });
        },

        function(next) {
            if (options.noInit) return next();
            self.postInit.call(self, next);
        }],

        // Final callbacks
        function(err) {
            logger.debug("core: init:", err || "");
            if (callback) setImmediate(function() {
                callback.call(self, err);
            });
    });
}

// Called after all config files are loaded and command line args are parsed, home directory is set but before the db is initialized
core.preInit = function(callback) { callback() }

// Called after the core.init has been initialized successfully, this can be redefined in the applications to add additional
// init steps that all processes require to have.
core.postInit = function(callback) { callback() }

// Run any backend function after environment has been initialized, this is to be used in shell scripts,
// core.init will parse all command line arguments, the simplest case to run from /data directory and it will use
// default environment or pass -home dir so the script will reuse same config and paths as the server
// context can be specified for the callback, if no then it run in the core context
// - require('backendjs').run(function() {}) is one example where this call is used as a shortcut for ad-hoc scripting
core.run = function(callback)
{
    var self = this;
    if (!callback) return logger.error('run:', 'callback is required');
    this.init(function(err) {
        callback.call(self, err);
    });
}

// Switch to new home directory, exit if we cannot, this is important for relative paths to work if used,
// no need to do this in worker because we already switched to home directory in the master and all child processes
// inherit current directory
// Important note: If run with combined server or as a daemon then this MUST be an absolute path, otherwise calling
// it in the spawned web master will fail due to the fact that we already set the home and relative path will not work after that.
core.setHome = function(home)
{
	var self = this;
    if ((home || self.home) && cluster.isMaster) {
        if (home) self.home = path.resolve(home);
        // On create set permissions
        if (self.makePathSync(self.home)) self.chownSync(self.home);
        try {
            process.chdir(self.home);
        } catch(e) {
            logger.error('setHome: cannot set home directory', self.home, e);
            process.exit(1);
        }
        logger.dev('setHome:', self.home);
    }
    self.home = process.cwd();
}

// Parse config lines for the file or other place
core.parseConfig = function(data)
{
    if (!data) return;
    var argv = [], lines = String(data).split("\n");
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line.match(/^([a-z_-]+)/)) continue;
        line = line.split("=");
        if (line[0]) argv.push('-' + line[0]);
        if (line[1]) argv.push(line.slice(1).join('='));
    }
    this.parseArgs(argv);
}

// Parse command line arguments
core.parseArgs = function(argv)
{
    var self = this;
    if (!Array.isArray(argv) || !argv.length) return;

    // Convert spaces if passed via command line
    argv = argv.map(function(x) { return x.replace(/%20/g, ' ') });
    logger.dev('parseArgs:', argv.join(' '));

   // Core parameters
    self.processArgs("core", self, argv);

    // Run registered handlers for each module
    for (var n in this.context) {
        var ctx = this.context[n];
        self.processArgs(n, ctx, argv);
    }
}

// Config parameters defined in a module as a list of parameter names prefixed with module name, a parameters can be
// a string which defines text parameter or an object with the properties: name, type, value, decimals, min, max, separator
// type can be bool, number, list, json
core.processArgs = function(name, ctx, argv, pass)
{
    var self = this;
    if (!ctx || !Array.isArray(ctx.args) || !Array.isArray(argv) || !argv.length) return;
    function put(obj, key, val, x) {
        if (x.array) {
            if (!Array.isArray(obj[key]) || x.set) obj[key] = [];
            if (Array.isArray(val)) {
                val.forEach(function(x) { if (obj[key].indexOf(x) == -1) obj[key].push(x); });
            } else {
                if (obj[key].indexOf(val) == -1) obj[key].push(val);
            }
        } else {
            obj[key] = val;
        }
    }
    ctx.args.forEach(function(x) {
        try {
            var obj = ctx;
            // Process only equal to the given pass phase
            if (pass && x.pass != pass) return;
            if (typeof x == "string") x = { name: x };
            if (!x.name) return;
            // Core sets global parameters, all others by module
            var cname = (name == "core" ? "" : "-" + name) + '-' + x.name;
            if (argv.indexOf(cname) == -1) return;
            var kname = x.key || x.name;
            // Place inside the object
            if (x.obj) {
                if (!ctx[x.obj]) ctx[x.obj] = {};
                obj = ctx[x.obj];
                // Strip the prefix if starts with the same name
                kname = kname.replace(new RegExp("^" + x.obj + "-"), "");
            }
            var key = self.toCamel(kname);
            var idx = argv.indexOf(cname);
            var val = idx > -1 && idx + 1 < argv.length ? argv[idx + 1] : null;
            if (val == null && x.type != "bool" && x.type != "callback" && x.type != "none") return;
            // Ignore the value if it is a parameter
            if (val && val[0] == '-') val = "";
            logger.dev("processArgs:", name, 'type:', x.type || "", "set:", key, "=", val);
            switch ((x.type || "").trim()) {
            case "none":
                break;
            case "bool":
                put(obj, key, !val ? true : self.toBool(val), x);
                break;
            case "int":
            case "real":
            case "number":
                put(obj, key, self.toNumber(val, x.decimals, x.value, x.min, x.max), x);
                break;
            case "map":
                put(obj, key, self.strSplit(val).map(function(x) { return x.split(":") }).reduce(function(x,y) { x[y[0]] = y[1]; return x }, {}), x);
                break;
            case "intmap":
                put(obj, key, self.strSplit(val).map(function(x) { return x.split(":") }).reduce(function(x,y) { x[y[0]] = self.toNumber(y[1]); return x }, {}), x);
                break;
            case "list":
                put(obj, key, self.strSplitUnique(val, x.separator), x);
                break;
            case "regexp":
                put(obj, key, new RegExp(val), x);
                break;
            case "regexpmap":
                obj[key] = self.toRegexpMap(x.set ? null : obj[key], val, x.del);
                break;
            case "json":
                put(obj, key, JSON.parse(val), x);
                break;
            case "path":
                put(obj, key, path.resolve(val), x);
                break;
            case "file":
                try { put(obj, key, fs.readFileSync(path.resolve(val)), x); } catch(e) { logger.error('procesArgs:', key, val, e); }
                break;
            case "callback":
                if (typeof x.value == "string") {
                    obj[x.value](val);
                } else
                if (typeof x.value == "function") {
                    x.value.call(obj, val);
                }
                break;
            default:
                put(obj, key, val, x);
            }
            // Append all processed arguments into internal list when we processing all arguments, not in a pass
            self.argv[cname.substr(1)] = val || true;
        } catch(e) {
            logger.error('proessArgs:', e, x);
        }
    });
}

// Add custom config parameters to be understood and processed by the config parser
// - module - name of the module to add these params to
// - args - a list of objectsin the format: { name: N, type: T, descr: D, min: M, max: M, array: B }, all except name are optional.
//
// Example:
//
//      core.describeArgs("api", [ { name: "num", type: "int", descr: "int param" }, { name: "list", array: 1, descr: "list of words" } ]);
//
core.describeArgs = function(module, args)
{
    var self = this;
    if (!Array.isArray(args)) return;
    var ctx = module == "coe" ? this : this.context[module];
    if (!ctx) return logger.error("deescribeArgs:", "invalid module", module);
    if (!ctx.args) ctx.args = [];
    args.forEach(function(x) {
        if (x.name) ctx.args.push(x);
    });
}

// Print help about command line arguments and exit
core.showHelp = function(options)
{
    var self = this;
    var args = [ [ '', core.args ] ];
    Object.keys(this.context).forEach(function(n) {
        if (self.context[n].args) args.push([n, self.context[n].args]);
    })
    var data = "";
    args.forEach(function(x) {
        x[1].forEach(function(y) {
            if (!y.name || !y.descr) return;
            var dflt = (x[0] ? self.context[x[0]] : core)[self.toCamel(y.name)] || "";
            var line = (x[0] ? x[0] + '-' : '') + y.name + "` - " + y.descr + (dflt ? ". Default: " + dflt : "");
            if (y.dns) line += ". DNS TXT configurable.";
            if (options && options.markdown) {
                data += "- `" +  line + "\n";
            } else {
                console.log(printf("%-40s", line));
            }
        });
    });
    if (options && options.markdown) return data;
    process.exit(0);
}

// Parse the config file, configFile can point to a file or can be skipped and the default file will be loaded
core.loadConfig = function(file, callback)
{
    var self = this;

    logger.debug('loadConfig:', file);

    fs.readFile(file || "", function(err, data) {
        if (!err) self.parseConfig(data);
        if (callback) callback(err);
    });
}

// Load configuration from the config database
core.loadDbConfig = function(options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null
    if (!options) options = {};
    var db = self.context.db;

    if (!db.config || !db.getPoolByName(db.config)) return callback ? callback() : null;

    // Request configs by network
    var type = self.subnet ? [ self.subnet, self.network ] : undefined;
    // Custom config type
    if (db.configType) {
        if (!type) type = [];
        type.push(db.configType);
    }

    db.select("bk_config", { type: type }, { select: ['name','value'], ops: { type: "in" }, pool: db.config }, function(err, rows) {
        var argv = [];
        // Sort inside to be persistent across databases
        rows.sort(function(a,b) { return b.type - a.type});
        rows.forEach(function(x) {
            if (x.name) argv.push('-' + x.name);
            if (x.value) argv.push(x.value);
        });
        self.parseArgs(argv);
        if (callback) callback();
    });
}

// Load configuration from the DNS TXT records
core.loadDnsConfig = function(options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null
    if (!options) options = {};

    if (options.noDns || !self.configDomain) return callback ? callback() : null;

    var args = [ { name: "", args: self.args } ];
    for (var p in this.context) {
        var ctx = self.context[p];
        if (Array.isArray(ctx.args)) args.push({ name: p + "-", args: ctx.args });
    }
    async.forEachSeries(args, function(ctx, next1) {
        async.forEachLimit(ctx.args, 5, function(arg, next2) {
            var cname = ctx.name + arg.name;
            async.series([
                function(next3) {
                    // Get DNS TXT record
                    if (!arg.dns) return next3();
                    dns.resolveTxt(cname + "." + self.configDomain, function(err, list) {
                        if (!err && list && list.length) {
                            self.argv.push("-" + cname, list[0]);
                            logger.debug('dns.config:', cname, list[0]);
                        }
                        next3();
                    });
                }],
                next2);
        }, next1);
    }, callback);
}

// Encode with additional symbols, convert these into percent encoded:
//
//          ! -> %21, * -> %2A, ' -> %27, ( -> %28, ) -> %29
core.encodeURIComponent = function(str)
{
    return encodeURIComponent(str || "").replace("!","%21","g").replace("*","%2A","g").replace("'","%27","g").replace("(","%28","g").replace(")","%29","g");
}

// Return unique process id based on the cluster status, worker or master and the role. This is can be reused by other workers within the role thus
// making it usable for repeating environments or storage solutions.
core.processId = function()
{
    return this.role + (cluster.isWorker ? cluster.worker.id : '');
}

// Convert text into capitalized words
core.toTitle = function(name)
{
    return (name || "").replace(/_/g, " ").split(/[ ]+/).reduce(function(x,y) { return x + y[0].toUpperCase() + y.substr(1) + " "; }, "").trim();
}

// Convert into camelized form
core.toCamel = function(name)
{
    return (name || "").replace(/(?:[-_])(\w)/g, function (_, c) { return c ? c.toUpperCase () : ''; });
}

// Convert Camel names into names with dashes
core.toUncamel = function(str)
{
    return str.replace(/([A-Z])/g, function(letter) { return '-' + letter.toLowerCase(); });
}

// Safe version, use 0 instead of NaN, handle booleans, if decimals specified, returns float
core.toNumber = function(str, decimals, dflt, min, max)
{
    str = String(str);
    // Autodetect floating number
    if (typeof decimals == "undefined" || decimals == null) decimals = /^[0-9-]+\.[0-9]+$/.test(str);
    if (typeof dflt == "undefined") dflt = 0;
    var n = str[0] == 't' ? 1 : str[0] == 'f' ? 0 : str == "infinity" ? Infinity : (decimals ? parseFloat(str,10) : parseInt(str,10));
    n = isNaN(n) ? dflt : n;
    if (typeof min != "undefined" && n < min) n = min;
    if (typeof max != "undefined" && n > max) n = max;
    return n;
}

// Return true if value represents true condition
core.toBool = function(val)
{
    return !val || val == "false" || val == "FALSE" || val == "f" || val == "F" || val == "0" ? false : true;
}

// Return Date object for given text or numeric date representation, for invalid date returns 1969
core.toDate = function(val)
{
    var d = null;
    // String that looks like a number
    if (/^[0-9\.]+$/.test(val)) val = this.toNumber(val);
    // Assume it is seconds which we use for most mtime columns, convert to milliseconds
    if (typeof val == "number" && val < 2147483647) val *= 1000;
    try { d = new Date(val); } catch(e) {}
    return !isNaN(d) ? d : new Date(0);
}

// Convert value to the proper type
core.toValue = function(val, type)
{
    switch ((type || "").trim()) {
    case 'array':
        return Array.isArray(val) ? val : String(val).split(/[,\|]/);

    case "expr":
    case "buffer":
        return val;

    case "real":
    case "float":
    case "double":
        return core.toNumber(val, true);

    case "int":
    case "smallint":
    case "integer":
    case "number":
    case "bigint":
    case "numeric":
    case "counter":
        return core.toNumber(val);

    case "bool":
    case "boolean":
        return core.toBool(val);

    case "date":
    case "time":
        return this.toDate(val);

    case "mtime":
        return /^[0-9\.]+$/.test(value) ? this.toNumber(val) : (new Date(val));

    case "json":
        return JSON.stringify(val);

    default:
        return String(val);
    }
}

// Add a regexp to the object that consist of list of patterns and compiled regexp, this is used in config type `regexpmap`
core.toRegexpMap = function(obj, val, del)
{
    if (this.typeName(obj) != "object") obj = {};
    if (!Array.isArray(obj.list)) obj.list = [];
    if (val) {
        if (del) {
            obj.list.splice(obj.list.indexOf(val), 1);
        } else {
            if (Array.isArray(val)) obj.list = obj.list.concat(val); else obj.list.push(val);
        }
    }
    obj.rx = null;
    if (obj.list.length) {
        try {
            obj.rx = new RegExp(obj.list.map(function(x) { return "(" + x + ")"}).join("|"));
        } catch(e) {
            logger.error('toRegexpMap:', val, e);
        }
    }
    return obj;
}

// Returns true if the given type belongs to the numeric family
core.isNumeric = function(type)
{
    return ["int","bigint","counter","real","float","double","numeric"].indexOf(String(type).trim()) > -1;
}

// Evaluate expr, compare 2 values with optional type and operation
core.isTrue = function(val1, val2, op, type)
{
    if (typeof val1 == "undefined" || typeof val2 == "undefined") return false;

    op = (op ||"").toLowerCase();
    var no = false, yes = true;
    if (op.substr(0, 4) == "not ") no = true, yes = false;

    switch (op) {
    case 'null':
    case "not null":
        if (val1) return no;
        break;

    case ">":
    case "gt":
        if (this.toValue(val1, type) <= this.toValue(val2, type)) return false;
        break;

    case "<":
    case "lt":
        if (this.toValue(val1, type) >= this.toValue(val2, type)) return false;
        break;

    case ">=":
    case "ge":
        if (this.toValue(val1, type) < this.toValue(val2, type)) return false;
        break;

    case "<=":
    case "le":
        if (this.toValue(val1, type) > this.toValue(val2, type)) return false;
        break;

    case "between":
        // If we cannot parse out 2 values, treat this as exact operator
        var list = Array.isArray(val2) ? val2 : this.strSplit(val2);
        if (list.length > 1) {
            if (this.toValue(val1, type) < this.toValue(list[0], type) || this.toValue(val1, type) > this.toValue(list[1], type)) return false;
        } else {
            if (this.toValue(val1, type) != this.toValue(val2, type)) return false;
        }
        break;

    case "in":
    case "not in":
        var list = Array.isArray(val2) ? val2 : this.strSplit(val2);
        if (list.indexOf(String(val1)) == -1) return no;
        break;

    case 'like%':
    case "not like%":
    case 'begins_with':
    case 'not begins_with':
        var v1 = String(val1);
        if (String(val2).substr(0, v1.length) != v1) return no;
        break;

    case "ilike%":
    case "not ilike%":
        var v1 = String(val1).toLowerCase();
        if (String(val2).substr(0, v1.length).toLowerCase() != v1) return no;
        break;

    case "!~":
    case "!~*":
    case "iregexp":
    case "not iregexp":
        if (!String(val1).match(new RegExp(String(val2), 'i'))) return no;
        break;

    case "~":
    case "~*":
    case "regexp":
    case "not regexp":
        if (!String(val1).match(new RegExp(String(val2)))) return false;
        break;

    case "contains":
    case "not contains":
        if (!String(val2).indexOf(String(val1)) > -1) return false;
        break;

    case "!=":
    case "<>":
    case "ne":
        if (this.toValue(val1, type) == this.toValue(val2, type)) return false;
        break;

    default:
        if (this.toValue(val1, type) != this.toValue(val2, type)) return false;
    }
    return yes;
}

// Create a Web server with options and request handler, returns a server object.
// Options can have the following properties:
// - port - port number is required
// - bind - address to bind
// - restart - name of the processes to restart on address in use error, usually "web"
// - ssl - an object with SSL options for TLS createServer call
// - timeout - number of milliseconds for the request timeout
// - name - server name to be assigned
core.createServer = function(options, callback)
{
    if (!options || !options.port) {
        logger.error('createServer:', 'invalid options', options);
        return null;
    }
    var server = options.ssl ? https.createServer(options.ssl, callback) : http.createServer(callback);
    if (options.timeout) server.timeout = options.timeout;
    server.on('error', function onError(err) {
        logger.error('web:', options, err.stack);
        // Restart backend processes on address in use
        if (err.code == 'EADDRINUSE' && options.restart) {
            core.killBackend(options.restart, "SIGKILL", function() { process.exit(0) });
        }
    });
    server.serverPort = options.port;
    if (options.name) server.serverName = options.name;
    try { server.listen(options.port, options.bind, this.backlog); } catch(e) { logger.error('server: listen:', options, e); server = null; }
    return server;
}

// Downloads file using HTTP and pass it to the callback if provided
// - uri can be full URL or an object with parts of the url, same format as in url.format
// - params can contain the following options:
//   - method - GET, POST
//   - headers - object with headers to pass to HTTP request, properties must be all lower case
//   - cookies - a list with cookies or a boolean to load cookies from the db
//   - file - file name where to save response, in case of error response the error body will be saved as well
//   - postdata - data to be sent with the request in the body
//   - postfile - file to be uploaded in the POST body, not as multipart
//   - query - additional query parameters to be added to the url as an object or as encoded string
//   - sign - sign request with provided email/secret properties
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

    // Additional query parameters as an object
    var qtype = this.typeName(params.query);
    switch (this.typeName(uri)) {
    case "object":
        uri = url.format(uri);
        break;

    case "string":
        var q = url.format({ query: qtype == "object" ? params.query: null, search: qtype == "string" ? params.query: null });
        uri += uri.indexOf("?") == -1 ? q : q.substr(1);
        break;

    default:
        return callback ? callback(new Error("invalid url: " + uri)) : null;
    }

    var options = url.parse(uri);
    options.method = params.method || 'GET';
    options.headers = params.headers || {};
    options.agent = params.agent || null;
    options.rejectUnauthorized = false;

    // Make sure required headers are set
    if (!options.headers['user-agent'] && this.userAgent.length) {
        options.headers['user-agent'] = this.userAgent[this.randomInt(0, this.userAgent.length-1)];
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
    if (!options.headers['accept']) {
        options.headers['accept'] = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
    }
    options.headers['accept-language'] = 'en-US,en;q=0.5';

    // Data to be sent over in the body
    if (params.postdata) {
        if (options.method == "GET") options.method = "POST";
        switch (this.typeName(params.postdata)) {
        case "string":
        case "buffer":
            break;
        case "object":
            params.postdata = JSON.stringify(params.postdata);
            options.headers['content-type'] = "application/json";
            options.headers['content-length'] = Buffer.byteLength(params.postdata, 'utf8');
            break;
        default:
            params.postdata = String(params.postdata);
        }
        if (!options.headers['content-length']) options.headers['content-length'] = Buffer.byteLength(params.postdata, 'utf8');
    } else
    if (params.postfile) {
        if (options.method == "GET") options.method = "POST";
        options.headers['transfer-encoding'] = 'chunked';
        params.poststream = fs.createReadableStream(params.postfile);
        params.poststream.on("error", function(err) { logger.error('httpGet: stream:', params.postfile, err) });
    }

    // Make sure our data is not corrupted
    if (params.checksum) options.checksum = params.postdata ? this.hash(params.postdata) : null;

    // Sign request using internal backend credentials
    if (params.sign) {
        var headers = this.signRequest(params.login, params.secret, options.method, options.hostname, options.path, { type: options.headers['content-type'], checksum: options.checksum });
        for (var p in headers) options.headers[p] = headers[p];
    }

    // Runtime properties
    if (!params.retries) params.retries = 0;
    if (!params.redirects) params.redirects = 0;
    if (!params.httpTimeout) params.httpTimeout = 300000;
    if (!params.ignoreredirect) params.ignoreredirect = {};
    params.size = 0, params.err = null, params.fd = 0, params.status = 0, params.data = '', params.poststream = null;
    params.href = options.href, params.pathname = options.pathname, params.hostname = options.hostname;
    var req = null;
    var mod = uri.indexOf("https://") == 0 ? https : http;

    req = mod.request(options, function(res) {
      logger.dev("httpGet: started", options.method, 'headers:', options.headers, params)

      res.on("data", function(chunk) {
          logger.dev("httpGet: data", 'size:', chunk.length, '/', params.size, "status:", res.statusCode, 'file:', params.file || '');

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
          params.mtime = res.headers.date ? self.toDate(res.headers.date) : null;
          if (!params.size) params.size = self.toNumber(res.headers['content-length'] || 0);
          if (params.fd) try { fs.closeSync(params.fd); } catch(e) {}
          if (params.stream) try { params.stream.end(params.onfinish); } catch(e) {}
          params.fd = 0;

          logger.dev("httpGet: end", options.method, "url:", uri, "size:", params.size, "status:", params.status, 'type:', params.type, 'location:', res.headers.location || '');

          // Retry the same request
          if (params.retries && (res.statusCode < 200 || res.statusCode >= 400)) {
              params.retries--;
              setTimeout(function() { self.httpGet(uri, params, callback); }, params.retryTimeout || 500);
              return;
          }
          // Redirection
          if (res.statusCode >= 301 && res.statusCode <= 307 && !params.noredirects) {
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
          }
          logger.debug("httpGet: done", options.method, "url:", uri, "size:", params.size, "status:", res.statusCode, 'type:', params.type, 'location:', res.headers.location || '');

          if (callback) callback(params.err, params, res);
      });

    }).on('error', function(err) {
        if (!params.quiet) logger.error("httpGet:", "onerror:", uri, 'file:', params.file || "", 'retries:', params.retries, 'timeout:', params.httpTimeout, 'size;', params.size, err);
        // Keep trying if asked for it
        if (params.retries) {
            params.retries--;
            setTimeout(function() { self.httpGet(uri, params, callback); }, params.retryTimeout || 500);
            return;
        }
        if (callback) callback(err, params, {});
    });
    if (params.httpTimeout) {
        req.setTimeout(params.httpTimeout, function() {
            if (!params.quiet) logger.error("httpGet:", "timeout:", uri, 'file:', params.file || "", 'retries:', params.retries, 'timeout:', params.httpTimeout);
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

// Produce signed URL to be used in embedded cases or with expiration so the url can be passed and be valid for longer time.
// Host passed here must be the actual host where the request will be sent
core.signUrl = function(login, secret, host, uri, options)
{
    var hdrs = this.signRequest(login, secret, "GET", host, uri, options);
    return uri + (uri.indexOf("?") == -1 ? "?" : "") + "&bk-signature=" + encodeURIComponent(hdrs['bk-signature']);
}

// Parse incoming request for signature and return all pieces wrapped in an object, this object
// will be used by checkSignature function for verification against an account
// signature version:
//  - 1 regular signature signed with secret for specific requests
//  - 2 to be sent in cookies and uses wild support for host and path
// If the signature successfully recognized it is saved in the request for subsequent use as req.signature
core.parseSignature = function(req)
{
    if (req.signature) return req.signature;
    var rc = { sigversion: 1, expires: 0 };
    // Input parameters, convert to empty string if not present
    var url = (req.url || req.originalUrl || "/").split("?");
    rc.path = url[0];
    rc.query = url[1] || "";
    rc.method = req.method || "";
    rc.host = (req.headers.host || "").split(':').shift().toLowerCase();
    rc.type = (req.headers['content-type'] || "").toLowerCase();
    rc.signature = req.query['bk-signature'] || req.headers['bk-signature'] || "";
    if (!rc.signature) {
        rc.signature = (req.session || {})['bk-signature'] || "";
        if (rc.signature) rc.session = true;
    }
    var d = String(rc.signature).match(/([^\|]+)\|([^\|]*)\|([^\|]+)\|([^\|]+)\|([^\|]+)\|([^\|]*)\|([^\|]*)/);
    if (!d) return rc;
    rc.sigversion = this.toNumber(d[1]);
    rc.sigdata = d[2];
    rc.login = d[3];
    rc.signature = d[4];
    rc.expires = this.toNumber(d[5]);
    rc.checksum = d[6] || "";
    req.signature = rc;
    return rc;
}


// Verify signature with given account, signature is an object returned by parseSignature
core.checkSignature = function(sig, account)
{
    var shatype = "sha1";
    var query = (sig.query).split("&").sort().filter(function(x) { return x != "" && x.substr(0, 12) != "bk-signature"; }).join("&");
    switch (sig.sigversion) {
    case 2:
        if (!sig.session) break;
        sig.str = "*" + "\n" + this.domainName(sig.host) + "\n" + "/" + "\n" + "*" + "\n" + sig.expires + "\n*\n*\n";
        break;

    case 3:
        shatype = "sha256";

    default:
        sig.str = sig.method + "\n" + sig.host + "\n" + sig.path + "\n" + query + "\n" + sig.expires + "\n" + sig.type + "\n" + sig.checksum + "\n";
    }
    sig.hash = this.sign(account.secret, sig.str, shatype);
    return sig.signature == sig.hash;
}

// Sign HTTP request for the API server:
// url must include all query parameters already encoded and ready to be sent
// options may contains the following:
//  - expires is absolute time in milliseconds when this request will expire, default is 30 seconds from now
//  - sigversion a version number defining how the signature will be signed
//  - type - content-type header, may be omitted
//  - checksum - SHA1 digest of the whole content body, may be omitted
core.signRequest = function(login, secret, method, host, uri, options)
{
    if (!options) options = {};
    var now = Date.now();
    var expires = options.expires || 0;
    if (!expires) expires = now + 30000;
    if (expires < now) expires += now;
    var hostname = String(host || "").split(":").shift().toLowerCase();
    var q = String(uri || "/").split("?");
    var path = q[0];
    var query = (q[1] || "").split("&").sort().filter(function(x) { return x != ""; }).join("&");
    var shatype = "sha1";
    var rc = {};
    switch (options.sigversion || 1) {
    case 2:
        path = "/";
        method = query = "*";
        rc['bk-domain'] = hostname = this.domainName(hostname);
        rc['bk-max-age'] = Math.floor((expires - now)/1000);
        rc['bk-expires'] = expires;
        rc['bk-path'] = path;
        rc.str = String(method) + "\n" + String(hostname) + "\n" + String(path) + "\n" + String(query) + "\n" + String(expires) + "\n*\n*\n";
        break;

    case 3:
        shatype = "sha256";

    default:
        rc.str = String(method) + "\n" + String(hostname) + "\n" + String(path) + "\n" + String(query) + "\n" + String(expires) + "\n" + String(options.type || "").toLowerCase() + "\n" + (options.checksum || "") + "\n";
    }
    rc['bk-signature'] = (options.sigversion || 1) + '|' + (options.sigdata || "") + '|' + (login || "") + '|' + this.sign(String(secret), rc.str, shatype) + '|' + expires + '|' + (options.checksum || "") + '|';
    if (logger.level > 1) logger.log('signRequest:', rc);
    return rc;
}

// Make a request to the backend endpoint, save data in the queue in case of error, if data specified,
// POST request is made, if data is an object, it is converted into string.
// Returns params as in httpGet with .json property assigned with an object from parsed JSON response.
// *When used with API endpoints, the `backend-host` parameter must be set in the config or command line to the base URL of the backend,
// like http://localhost:8000, this is when `uri` is relative URL. Absolute URLs do not need this parameter.*
// Special parameters for options:
// - url - url if options is first argument
// - login - login to use for access credentials instead of global credentials
// - secret - secret to use for access instead of global credentials
// - proxy - used as a proxy to backend, handles all errors and returns .status and .json to be passed back to API client
// - queue - perform queue management, save in queue if cannot send right now, delete from queue if sent
// - id - unique record id to be used in case of queue management
// - checksum - calculate checksum from the data
// - anystatus - keep any HTTP status, dont treat as error if not 200
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
    var db = self.context.db;

    this.httpGet(options.url, core.cloneObj(options), function(err, params, res) {
        // Queue management, insert on failure or delete on success
        if (options.queue) {
            if (params.status == 200) {
                if (options.id) {
                    db.del("bk_queue", { id: options.id }, { pool: db.local });
                }
            } else {
                options.counter = self.toNumber(options.counter) + 1;
                if ((options.retries && options.counter > options.retries) ||
                    (options.expires && Date.now() > options.expires)) {
                    if (options.id) {
                        db.del("bk_queue", { id: options.id }, { pool: db.local });
                    }
                } else {
                    db.put("bk_queue", { id: options.id || self.uuid(), data: options, ctime: Date.now() }, { pool: db.local });
                }
            }
        }
        // If the contents are encrypted, decrypt before processing content type
        if ((options.headers || {})['content-encoding'] == "encrypted") {
            params.data = self.decrypt(options.secret, params.data);
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
        if (params.status != 200 && !err && !options.anystatus) err = self.newError(util.format("ResponseError: %d: %j", params.status, params.obj), "HTTP", params.status);
        if (!params.obj) params.obj = {};
        if (callback) callback(err, params, res);
    });
}

// Send all pending updates from the queue table
core.processRequestQueue = function(callback)
{
    var self = this;
    var db = self.context.db;

    db.select("bk_queue", {}, { sort: "mtime", pool: db.local } , function(err, rows) {
        async.forEachSeries(rows, function(row, next) {
            if (self.typeName(row.data) != "object") return next();
            for (var p in row) if (p != "data") row.data[p] = row[p];
            self.sendRequest(row.data, function(err2) { next(); });
        }, function(err3) {
            if (rows.length) logger.log('processQueue:', 'sent', rows.length);
            if (callback) callback();
        });
    });
}

// Register the callback to be run later for the given message, the message must have id property which will be used for keeping track of the replies.
// A timeout is created for this message, if runCallback for this message will not be called in time the timeout handler will call the callback
// anyways with the original message.
// The callback passed will be called with only one argument which is the message, what is inside the message this function does not care. If
// any errors must be passed, use the message object for it, no other arguments are expected.
core.deferCallback = function(obj, msg, callback, timeout)
{
    if (!msg || !msg.id || !callback) return;

    obj[msg.id] = {
         timeout: setTimeout(function() {
             delete obj[msg.id];
             try { callback(msg); } catch(e) { logger.error('callback:', e, msg, e.stack); }
         }, timeout || this.deferTimeout),

         callback: function(data) {
             clearTimeout(this.timeout);
             try { callback(data); } catch(e) { logger.error('callback:', e, data, e.stack); }
         }
    };
}

// Run delayed callback for the message previously registsred with the `deferCallback` method.
// The message must have id property which is used to find the corresponding callback, if msg is a JSON string it will be converted into the object.
core.runCallback = function(obj, msg)
{
    if (!msg) return;
    if (typeof msg == "string") {
        try { msg = JSON.parse(msg); } catch(e) { logger.error('runCallback:', e, msg); }
    }
    if (!msg.id || !obj[msg.id]) return;
    // Only keep reference for the callback
    var item = obj[msg.id];
    delete obj[msg.id];

    // Make sure the timeout will not fire before the immediate call
    clearTimeout(item.timeout);
    // Call in the next loop cycle
    setImmediate(function() {
        try {
            item.callback(msg);
        } catch(e) {
            logger.error('runCallback:', e, msg, e.stack);
        }
    });
}

// Create a resource pool, create and close callbacks must be given which perform allocation and deallocation of the resources like db connections.
// Options defines the following properties:
// - create - method to be called to return a new resource item, takes 1 argument, a callback as function(err, item)
// - destroy - method to be called to destroy a resource item
// - validate - method to verify actibe resource item, return false if it needs to be destroyed
// - min - min number of active resource items
// - max - max number of active resource items
// - max_queue - how big the waiting queue can be, above this all requests will be rejected immediately
// - timeout - number of milliseconds to wait for the next available resource item, cannot be 0
// - idle - number of milliseconds before starting to destroy all active resources above the minimum, 0 to disable.
core.createPool = function(options)
{
    var self = this;

    var pool = { _pmin: core.toNumber(options.min, 0, 0, 0),
                 _pmax: core.toNumber(options.max, 0, 10, 0),
                 _pmax_queue: core.toNumber(options.interval, 0, 100, 0),
                 _ptimeout: core.toNumber(options.timeout, 0, 5000, 1),
                 _pidle: core.toNumber(options.idle, 0, 300000, 0),
                 _pcreate: options.create || function(cb) { cb(null, {}) },
                 _pdestroy: options.destroy || function() {},
                 _pvalidate: options.validate || function() { return true },
                 _pqueue_count: 0,
                 _pnum: 1,
                 _pqueue_count: 0,
                 _pqueue: {},
                 _pavail: [],
                 _pmtime: [],
                 _pbusy: [] };

    // Return next available resource item, if not available immediately wait for defined amount of time before calling the
    // callback with an error. The callback second argument is active resource item.
    pool.acquire = function(callback) {
        if (typeof callback != "function") return;

        // We have idle clients
        if (this._pavail.length) {
            var mtime = this._pmtime.shift();
            var client = this._pavail.shift();
            this._pbusy.push(client);
            return callback.call(this, null, client);
        }
        // Put into waiting queue
        if (this._pbusy.length >= this._pmax) {
            if (this._pqueue_count >= this._pmax_queue) return callback(new Error("no more resources"));

            this._pqueue_count++;
            return self.deferCallback(this._pqueue, { id: this._pnum++ }, function(m) {
                callback(m.client ? null : new Error("timeout waiting for the resource"), m.client);
            }, this._ptimeout);
        }
        // New item
        var me = this;
        this._palloc(function(err, client) {
            if (!err) me._pbusy.push(client);
            callback(err, client);
        });
    }

    // Destroy the resource item calling the provided close callback
    pool.destroy = function(client) {
        if (!client) return;

        var idx = this._pbusy.indexOf(client);
        if (idx > -1) {
            this._pbusy.splice(idx, 1);
            this._pclose(client);
            return;
        }
        var idx = this._pavail.indexOf(client);
        if (idx > -1) {
            this._pavail.splice(idx, 1);
            this._pmtime.splice(idx, 1);
            this._pclose(client);
            return;
        }
    }

    // Return the resource item back to the list of available resources.
    pool.release = function(client) {
        if (!client) return;

        var idx = this._pbusy.indexOf(client);
        if (idx == -1) {
            logger.error('pool.release:', 'not known', client);
            return;
        }

        // Pass it to the next waiting client
        for (var id in this._pqueue) {
            this._pqueue_count--;
            this._pqueue[id].id = id;
            this._pqueue[id].client = client;
            return self.runCallback(this._pqueue, this._pqueue[id]);
        }

        this._pbusy.splice(idx, 1);

        // Destroy if above the limit or invalid
        if (this._pavail.length > this._pmax || !this._pcheck(client)) {
            return this._pclose(client);
        }
        // Add to the available list
        this._pavail.unshift(client);
        this._pmtime.unshift(Date.now());
    }

    pool.stats = function() {
        return { avail: this._pavail.length, busy: this._pbusy.length, queue: this._pqueue_count, min: this._pmin, max: this._pmax, max_queue: this._pmax_queue };
    }

    // Close all active clients
    pool.closeAll = function() {
        while (this._pavail.length > 0) this.destroy(this._pavail[0]);
    }

    // Close all connections and shutdown the pool, no more clients will be open and the pool cannot be used without re-initialization,
    // if callback is provided then wait until all items are released and call it, optional maxtime can be used to retsrict how long to wait for
    // all items to be released, when expired the callback will be called
    pool.shutdown = function(callback, maxtime) {
        logger.debug('pool.close:', 'shutdown:', this.name, 'avail:', this._pavail.length, 'busy:', this._pbusy.length);
        var self = this;
        this._pmax = -1;
        this.closeAll();
        this._pqueue = {};
        clearInterval(this._pinterval);
        if (!callback) return;
        this._ptime = Date.now();
        this._pinterval = setInterval(function() {
            if (self._pbusy.length && (!maxtime || Date.now() - self._ptime < maxtime)) return;
            clearInterval(this);
            callback();
        }, 500);
    }

    // Allocate a new client
    pool._palloc = function(callback) {
        try {
            this._pcreate.call(this, callback);
            logger.dev('pool.alloc:', 'avail:', this._pavail.length, 'busy:', this._pbusy.length);
        } catch(e) {
            logger.error('pool.alloc:', e);
            callback(e);
        }
    }

    // Destroy the resource item calling the provided close callback
    pool._pclose = function(client) {
        try {
            this._pdestroy.call(this, client);
            logger.dev('pool.close:', 'destroy:', this._pavail.length, 'busy:', this._pbusy.length);
        } catch(e) {
            logger.error('pool.close:', e);
        }
    }

    // Verify if the resource item is valid
    pool._pcheck = function(client) {
        try {
            return this._pvalidate.call(this, client);
        } catch(e) {
            logger.error('pool.check:', e);
            return false;
        }
    }
    // Timer to ensure pool integrity
    pool._ptimer = function() {
        var me = this;
        var now = Date.now();

        // Expire idle items
        if (this._pidle > 0) {
            for (var i = 0; i < this._pavail.length; i++) {
                if (now - this._pmtime[i] > this._pidle && this._pavail.length + this._pbusy.length > this._pmin) {
                    logger.dev('pool.timer:', pool.name || "", 'idle', i, 'avail:', this._pavail.length, 'busy:', this._pbusy.length);
                    this.destroy(this._pavail[i]);
                    i--;
                }
            }
        }

        // Ensure min number of items
        var min = this._pmin - this._pavail.length - this._pbusy.length;
        for (var i = 0; i < min; i++) {
            this._palloc(function(err, client) { if (!err) me._pavail.push(client); });
        }
    }

    // Periodic housekeeping if interval is set
    if (pool._pidle > 0) {
        this._pinterval = setInterval(function() { pool._ptimer() }, Math.max(1000, pool._pidle/3));
        setImmediate(function() { pool._ptimer(); });
    }

    return pool;
}

// Return commandline argument value by name
core.getArg = function(name, dflt)
{
    var idx = process.argv.indexOf(name);
    return idx > -1 && idx + 1 < process.argv.length ? process.argv[idx + 1] : (typeof dflt == "undefined" ? "" : dflt);
}

// Return commandline argument value as a number
core.getArgInt = function(name, dflt)
{
    return this.toNumber(this.getArg(name, dflt));
}

// Returns true of given arg(s) are present in the comman dline,name can be a string or an array of strings.
core.isArg = function(name)
{
    if (!Array.isArray(name)) return process.argv.indexOf(name) > 0;
    return name.some(function(x) { return process.argv.indexOf(x) > 0 });
}

// Send email
core.sendmail = function(from, to, subject, text, callback)
{
    try {
        var server = emailjs.server.connect();
        server.send({ text: text || '', from: from, to: to + ",", subject: subject || ''}, function(err, message) {
            if (err) logger.error('sendmail:', err);
            if (callback) callback(err);
        });
    } catch(e) {
        logger.error('sendmail:', e);
    }
}

// Call callback for each line in the file
// options may specify the following parameters:
// - sync - read file synchronously and call callback for every line
// - abort - signal to stop processing
// - limit - number of lines to process and exit
// - progress - if > 0 report how many lines processed so far every specified lines
// - until - skip lines until this regexp matches
core.forEachLine = function(file, options, lineCallback, endCallback)
{
    if (!options) options = {};
    var buffer = new Buffer(4096);
    var data = '';
    options.lines = 0;

    function readData(fd, pos, finish) {
        fs.read(fd, buffer, 0, buffer.length, pos, function(err, nread, buf) {
            data += buffer.slice(0, nread).toString(options.encoding || 'utf8');
            var lines = data.split("\n");
            data = lines.pop();
            async.forEachSeries(lines, function(line, next) {
                options.lines++;
                if (options.progress && options.lines % options.progress == 0) logger.log('forEachLine:', file, 'lines:', options.lines);
                // Skip lines until we see our pattern
                if (options.until && !options.until_seen) {
                    options.until_seen = line.match(options.until);
                    return next();
                }
                lineCallback(line.trim(), next);
            }, function(err2) {
                // Stop on reaching limit or end of file
                if (options.abort || (options.limit && options.lines >= options.limit) || nread < buffer.length) return finish(err2);
                setImmediate(function() { readData(fd, null, finish); });
            });
        });
    }

    fs.open(file, 'r', function(err, fd) {
        if (err) {
            logger.error('forEachLine:', file, err);
            return (endCallback ? endCallback(err) : null);
        }
        // Synchronous version, read every line and call callback which may not do any async operations
        // because they will not be executed right away but only after all lines processed
        if (options.sync) {
            while (!options.abort) {
                var nread = fs.readSync(fd, buffer, 0, buffer.length, options.lines == 0 ? options.start : null);
                data += buffer.slice(0, nread).toString(options.encoding || 'utf8');
                var lines = data.split("\n");
                data = lines.pop();
                for (var i = 0; i < lines.length; i++) {
                    options.lines++;
                    if (options.progress && options.lines % options.progress == 0) logger.log('forEachLine:', file, 'lines:', options.lines);
                    // Skip lines until we see our pattern
                    if (options.until && !options.until_seen) {
                        options.until_seen = lines[i].match(options.until);
                        continue;
                    }
                    lineCallback(lines[i].trim());
                }
                // Stop on reaching limit or end of file
                if (nread < buffer.length) break;
                if (options.limit && options.lines >= options.limit) break;
            }
            fs.close(fd, function() {});
            return (endCallback ? endCallback() : null);
        }

        // Start reading data from the optional position or from the beginning
        readData(fd, options.start, function(err2) {
            fs.close(fd, function() {});
            return (endCallback ? endCallback() : null);
        });
    });
}

// Return object with geohash for given coordinates to be used for location search
// options may contain the following properties:
//   - distance - limit the range key with the closest range smaller than then distance, required for search but for updates may be omitted
//   - minDistance - radius for the smallest bounding box in km containing single location, radius searches will combine neighboring boxes of
//      this size to cover the whole area with the given distance request, also this affects the length of geohash keys stored in the bk_location table
//      if not specified default `min-distance` value will be used.
core.geoHash = function(latitude, longitude, options)
{
	if (!options) options = {};
	var minDistance = options.minDistance || this.minDistance;
	if (options.distance && options.distance < minDistance) options.distance = minDistance;

	// Geohash ranges for different lengths in km, take the first greater than our min distance
	var range = [ [12, 0], [8, 0.019], [7, 0.076],
	              [6, 0.61], [5, 2.4], [4, 20.0],
	              [3, 78.0], [2, 630.0], [1, 2500.0],
	              [1, 99999]
	            ].filter(function(x) { return x[1] > minDistance })[0];

	var geohash = backend.geoHashEncode(latitude, longitude);
	return { geohash: geohash.substr(0, range[0]),
             _geohash: geohash,
			 neighbors: options.distance ? backend.geoHashGrid(geohash.substr(0, range[0]), Math.ceil(options.distance / range[1])).slice(1) : [],
			 latitude: latitude,
			 longitude: longitude,
			 minRange: range[1],
			 minDistance: minDistance,
			 distance: options.distance || 0 };
}

// Return distance between two locations, options can specify the following properties:
// - round - a number how to round the distance
//
//  Example: round to the nearest full 5 km and use only 1 decimal point, if the distance is 13, it will be 15.0
//
//      core.geoDistance(34, -188, 34.4, -119, { round: 5.1 })
//
core.geoDistance = function(latitude1, longitude1, latitude2, longitude2, options)
{
    var distance = backend.geoDistance(latitude1, longitude1, latitude2, longitude2);
    if (isNaN(distance) || distance === null) return null;

    // Round the distance to the closes edge and fixed number of decimals
    if (options && typeof options.round == "number" && options.round > 0) {
        var decs = String(options.round).split(".")[1];
        distance = parseFloat(Number(Math.floor(distance/options.round)*options.round).toFixed(decs ? decs.length : 0));
        if (isNaN(distance)) return null;
    }
    return distance;
}

// Same as geoDistance but operates on 2 geohashes instead of coordinates.
core.geoHashDistance = function(geohash1, geohash2, options)
{
    var coords1 = backend.geoHashDecode(geohash1);
    var coords2 = backend.geoHashDecode(geohash2);
    return this.geoDistance(coords1[0], coords1[1], coords2[0], coords2[1], options);
}

// Encrypt data with the given key code
core.encrypt = function(key, data, algorithm)
{
    if (!key || !data) return '';
    try {
        var encrypt = crypto.createCipher(algorithm || 'aes192', key);
        var b64 = encrypt.update(String(data), 'utf8', 'base64');
        b64 += encrypt.final('base64');
    } catch(e) {
        b64 = '';
        logger.debug('encrypt:', e.stack, data);
    }
    return b64;
}

// Decrypt data with the given key code
core.decrypt = function(key, data, algorithm)
{
    if (!key || !data) return '';
    try {
        var decrypt = crypto.createDecipher(algorithm || 'aes192', key);
        var msg = decrypt.update(String(data), 'base64', 'utf8');
        msg += decrypt.final('utf8');
    } catch(e) {
        msg = '';
        logger.debug('decrypt:', e.stack, data);
    };
    return msg;
}

// HMAC signing and base64 encoded, default algorithm is sha1
core.sign = function (key, data, algorithm, encode)
{
    try {
        return crypto.createHmac(algorithm || "sha1", String(key)).update(String(data), "utf8").digest(encode || "base64");
    } catch(e) {
        logger.error('sing:', algorithm, encode, e.stack);
        return "";
    }
}

// Hash and base64 encoded, default algorithm is sha1
core.hash = function (data, algorithm, encode)
{
    try {
        return crypto.createHash(algorithm || "sha1").update(String(data), "utf8").digest(encode || "base64");
    } catch(e) {
        logger.error('hash:', algorithm, encode, e.stack);
        return "";
    }
}

// Return unique Id without any special characters and in lower case
core.uuid = function()
{
    return uuid.v4().replace(/-/g, '').toLowerCase();
}

// Generate random key, size if specified defines how many random bits to generate
core.random = function(size)
{
    return this.sign(crypto.randomBytes(64), crypto.randomBytes(size || 256), 'sha256').replace(/[=+%]/g, '');
}

// Return random integer between min and max inclusive
core.randomInt = function(min, max)
{
    return min + (0 | Math.random() * (max - min + 1));
}

// Generates a random number between given min and max (required)
// Optional third parameter indicates the number of decimal points to return:
//   - If it is not given or is NaN, random number is unmodified
//   - If >0, then that many decimal points are returned (e.g., "2" -> 12.52
core.randomNum = function(min, max, decs)
{
    var num = min + (Math.random() * (max - min));
    return (typeof decs !== 'number' || decs <= 0) ? num : parseFloat(num.toFixed(decs));
}

// Return number of seconds for current time
core.now = function()
{
    return Math.round(Date.now()/1000);
}

// Format date object
core.strftime = function(date, fmt, utc)
{
    if (typeof date == "string" || typeof date == "number") try { date = new Date(date); } catch(e) {}
    if (!date || isNaN(date)) return "";
    function zeropad(n) { return n > 9 ? n : '0' + n; }
    var handlers = {
        a: function(t) { return [ 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat' ][utc ? t.getUTCDay() : t.getDay()] },
        A: function(t) { return [ 'Sunday', 'Monday', 'Tuedsay', 'Wednesday', 'Thursday', 'Friday', 'Saturday' ][utc ? t.getUTCDay() : t.getDay()] },
        b: function(t) { return [ 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec' ][utc ? t.getUTCMonth() : t.getMonth()] },
        B: function(t) { return [ 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December' ][utc ? t.getUTCMonth() : t.getMonth()] },
        c: function(t) { return utc ? t.toUTCString() : t.toString() },
        d: function(t) { return zeropad(utc ? t.getUTCDate() : t.getDate()) },
        H: function(t) { return zeropad(utc ? t.getUTCHours() : t.getHours()) },
        I: function(t) { return zeropad(((utc ? t.getUTCHours() : t.getHours()) + 12) % 12) },
        m: function(t) { return zeropad((utc ? t.getUTCMonth() : t.getMonth()) + 1) }, // month-1
        M: function(t) { return zeropad(utc ? t.getUTCMinutes() : t.getMinutes()) },
        p: function(t) { return this.H(t) < 12 ? 'AM' : 'PM'; },
        S: function(t) { return zeropad(utc ? t.getUTCSeconds() : t.getSeconds()) },
        w: function(t) { return utc ? t.getUTCDay() : t.getDay() }, // 0..6 == sun..sat
        W: function(t) { var d = new Date(t.getFullYear(), 0, 1); return zeropad(Math.ceil((((t - d) / 86400000) + (utc ? d.getUTCDay() : d.getDay()) + 1) / 7)); },
        y: function(t) { return zeropad(this.Y(t) % 100); },
        Y: function(t) { return utc ? t.getUTCFullYear() : t.getFullYear() },
        t: function(t) { return t.getTime() },
        u: function(t) { return Math.floor(t.getTime()/1000) },
        '%': function(t) { return '%' },
    };
    for (var h in handlers) {
        fmt = fmt.replace('%' + h, handlers[h](date));
    }
    return fmt;
}

// Split string into array, ignore empty items
core.strSplit = function(str, sep, num)
{
    var self = this;
    if (!str) return [];
    return (Array.isArray(str) ? str : String(str).split(sep || /[,\|]/)).
            map(function(x) { return num ? self.toNumber(x) : typeof x == "string" ? x.trim() : x }).
            filter(function(x) { return typeof x == "string" ? x : 1 });
}

// Split as above but keep only unique items
core.strSplitUnique = function(str, sep, num)
{
    var rc = [];
    this.strSplit(str, sep, num).forEach(function(x) { if (!rc.some(function(y) { return x.toLowerCase() == y.toLowerCase() })) rc.push(x)});
    return rc;
}

// Returns only unique items in the array, optional `key` specified the name of the column to use when determining uniqueness if items are objects.
core.arrayUnique = function(list, key)
{
    if (!Array.isArray(list)) return this.strSplitUnique(list);
    var rc = [], keys = {};
    list.forEach(function(x) {
        if (key) {
            if (!keys[x[key]]) rc.push(x);
            keys[x[key]] = 1;
        } else {
            if (rc.indexOf(x) == -1) rc.push(x);
        }
    });
    return rc;
}

// Stringify JSON into base64 string, if secret is given, sign the data with it
core.jsonToBase64 = function(data, secret)
{
    data = JSON.stringify(data);
    if (secret) return this.encrypt(secret, data);
	return new Buffer(data).toString("base64");
}

// Parse base64 JSON into JavaScript object, in some cases this can be just a number then it is passed as it is, if secret is given verify
// that data is not chnaged and was signed with the same secret
core.base64ToJson = function(data, secret)
{
	var rc = "";
	if (secret) data = this.decrypt(secret, data);
	try {
	    if (data.match(/^[0-9]+$/)) {
	        rc = this.toNumber(data);
	    } else {
	        if (!secret) data = new Buffer(data, "base64").toString();
	        rc = JSON.parse(data);
	    }
	} catch(e) {}
	return rc;
}

// Given a string with list of urls try to find if any points to our local server using IP address or host name, returns the url
// in format: protocol://*:port, mostly to be used with nanomsg sockets
core.parseLocalAddress = function(str)
{
    var url = "", ips = this.ipaddrs, host = os.hostname().toLowerCase();
    this.strSplit(str).forEach(function(x) {
        var u = url.parse(x);
        if (ips.indexOf(u.hostname) > -1 || u.hostname.toLowerCase() == host) url = u.protocol + "//*:" + u.port;
    });
    return url;
}

// Copy file and then remove the source, do not overwrite existing file
core.moveFile = function(src, dst, overwrite, callback)
{
    var self = this;
    if (typeof overwrite == "function") callback = overwrite, overwrite = false;

    function copyIfFailed(err) {
        if (!err) return (callback ? callback(null) : null);
        self.copyFile(src, dst, overwrite, function(err2) {
            if (!err2) {
                fs.unlink(src, callback);
            } else {
                if (callback) callback(err2);
            }
        });
    }

    logger.debug('moveFile:', src, dst, overwrite);
    fs.stat(dst, function (err) {
        if (!err && !overwrite) return callback(new Error("File " + dst + " exists."));
        fs.rename(src, dst, copyIfFailed);
    });
}

// Copy file, overwrite is optional flag, by default do not overwrite
core.copyFile = function(src, dst, overwrite, callback)
{
    if (typeof overwrite == "function") callback = overwrite, overwrite = false;

    function copy(err) {
        var ist, ost;
        if (!err && !overwrite) return callback ? callback(new Error("File " + dst + " exists.")) : null;
        fs.stat(src, function (err2) {
            if (err2) return callback ? callback(err2) : null;
            ist = fs.createReadStream(src);
            ost = fs.createWriteStream(dst);
            ist.on('end', function() { if (callback) callback() });
            ist.pipe(ost);
        });
    }
    logger.debug('copyFile:', src, dst, overwrite);
    fs.stat(dst, copy);
}

// Run the process and return all output to the callback
core.runProcess = function(cmd, callback)
{
    exec(cmd, function (err, stdout, stderr) {
        if (err) logger.error('getProcessOutput:', cmd, err);
        if (callback) callback(stdout, stderr);
    });
}

// Kill all backend processes that match name and not the current process
core.killBackend = function(name, signal, callback)
{
    var self = this;
    if (typeof signal == "function") callback = signal, signal = '';
    if (!signal) signal = 'SIGTERM';

    self.runProcess("/bin/ps agx", function(stdout) {
        stdout.split("\n").
               filter(function(x) { return x.match("backend:") && (!name || x.match(name)); }).
               map(function(x) { return self.toNumber(x) }).
               filter(function(x) { return x != process.pid }).
               forEach(function(x) { try { process.kill(x, signal); } catch(e) { logger.error('killBackend:', name, x, e); } });
        if (callback) callback();
    });
}

// Shutdown the machine now
core.shutdown = function()
{
    exec("/sbin/halt", function(err, stdout, stderr) {
        logger.log('shutdown:', stdout || "", stderr || "", err || "");
    });
}

// Non-exception version, returns empty object,
// mtime is 0 in case file does not exist or number of seconds of last modified time
// mdate is a Date object with last modified time
core.statSync = function(file)
{
    var stat = { size: 0, mtime: 0, mdate: "", isFile: function() {return false}, isDirectory: function() {return false} }
    try {
        stat = fs.statSync(file);
        stat.mdate = stat.mtime.toISOString();
        stat.mtime = stat.mtime.getTime()/1000;
    } catch(e) {
        if (e.code != "ENOENT") logger.error('statSync:', e);
    }
    return stat;
}

// Return contents of a file, empty if not exist or on error.
// Options can specify the format:
// - json - parse file as JSON, return an object, in case of error an empty object
// - list - split contents with the given separator
// - encoding - file encoding when converting to string
// - logger - if 1 log all errors
core.readFileSync = function(file, options)
{
    if (!file) return "";
    try {
        var data = fs.readFileSync(file).toString(options && options.encoding ? options.encoding : "utf8");
        if (options) {
            if (options.json) data = JSON.parse(data);
            if (options.list) data = data.split(options.list);
        }
        return data;
    } catch(e) {
        if (options) {
            if (options.logger) logger.error('readFileSync:', file, e);
            if (options.json) return {};
            if (options.list) return [];
        }
        return "";
    }
}

// Return list of files than match filter recursively starting with given path
// - file - starting path
// - filter - a function(file, stat) that return 1 if the given file matches, stat is a object returned by fs.statSync
// - depth - if a number specifies max depth to go into the subfolders, starts with 1
core.findFileSync = function(file, filter, depth)
{
    var list = [];
    try {
        var stat = this.statSync(file);
        if (stat.isFile()) {
            if (file != "." && file != ".." && (!filter || filter(file, stat))) {
                list.push(file);
            }
        } else
        if (stat.isDirectory()) {
            if (file != "." && file != ".." && (!filter || filter(file, stat))) {
                list.push(file);
            }
            if (typeof depth == "number" && depth == 0) return list;
            var files = fs.readdirSync(file);
            for (var i in files) {
                list = list.concat(this.findFileSync(path.join(file, files[i]), filter, depth ? depth - 1 : null));
            }
        }
    } catch(e) {
        logger.error('findFileSync:', file, e);
    }
    return list;
}

// Recursively create all directories, return 1 if created or 0 on error or if exists, no exceptions are raised, error is logged only
core.makePathSync = function(dir)
{
    var rc = 0;
    var list = path.normalize(dir).split("/");
    for (var i = 0, dir = ''; i < list.length; i++) {
        dir += list[i] + '/';
        try {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir);
                rc = 1;
            }
        } catch(e) {
            logger.error('makePath:', dir, e);
            return 0;
        }
    }
    return rc;
}

// Async version of makePath, stops on first error
core.makePath = function(dir, callback)
{
    var list = path.normalize(dir).split("/");
    var full = "";
    async.forEachSeries(list, function(d, next) {
        full += d + '/';
        fs.exists(full, function(yes) {
            if (yes) return next();
            fs.mkdir(full, function(err) {
                next(err && err.code != 'EEXIST' && err.code != 'EISDIR' ? err : null);
            });
        });
    }, function(err) {
        if (err) logger.error('makePath:', err);
        if (callback) callback(err);
    });
}

// Recursively remove all files and folders in the given path, returns an error to the callback if any
core.unlinkPath = function(dir, callback)
{
    var self = this;
    fs.stat(dir, function(err, stat) {
        if (err) return callback ? callback(err) : null;
        if (stat.isDirectory()) {
            fs.readdir(dir, function(err, files) {
                if (err) return next(err);
                async.forEachSeries(files, function(f, next) {
                    self.unlinkPath(path.join(dir, f), next);
                }, function(err) {
                    if (err) return callback ? callback(err) : null;
                    fs.rmdir(dir, callback);
                });
            });
        } else {
            fs.unlink(dir, callback);
        }
    });
}

// Recursively remove all files and folders in the given path, stops on first error
core.unlinkPathSync = function(dir)
{
    var files = this.findFileSync(dir, function() { return 1 });
    // Start from the end to delete files first, then folders
    for (var i = files.length - 1; i >= 0; i--) {
        try {
            var stat = this.statSync(files[i]);
            if (stat.isDirectory()) {
                fs.rmdirSync(files[i]);
            } else {
                fs.unlinkSync(files[i]);
            }
        } catch(e) {
            logger.error("unlinkPath:", dir, e);
            return 0;
        }
    }
    return 1;
}

// Create a directories if do not exist, multiple dirs can be specified
core.mkdirSync = function()
{
    for (var i = 0; i < arguments.length; i++) {
        var dir = arguments[i];
        if (!dir) continue;
        if (!fs.existsSync(dir)) {
            try { fs.mkdirSync(dir) } catch(e) { logger.error('mkdirSync:', dir, e); }
        }
    }
}

// Change file owner, multiples files can be specified, do not report errors about non existent files, the uid/gid must be set to non-root user
// for this function to work and it is called by the root only
core.chownSync = function()
{
    if (process.getuid() || !this.uid) return;
    for (var i = 0; i < arguments.length; i++) {
        var file = arguments[i];
        if (!file) continue;
        try {
            fs.chownSync(file, this.uid, this.gid);
        } catch(e) {
            if (e.code != 'ENOENT') logger.error('chownSync:', this.uid, this.gid, file, e);
        }
    }
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

// Full path to the icon, perform necessary hashing and sharding, id can be a number or any string
core.iconPath = function(id, options)
{
    if (!options) options = {};
    // Convert into string and remove all chars except numbers, this will support UUIDs as well as regular integers
    var num = String(id).replace(/[^0-9]/g, '');
    var ext = options.ext || "jpg";
    var name = (options.type ? options.type + '-' : "") + id + (ext[0] == '.' ? "" : ".") + ext;
    return path.join(this.path.images, options.prefix || "", num.substr(-2), num.substr(-4, 2), name);
}

// Download image and convert into JPG, store under core.path.images
// Options may be controlled using the properties:
// - force - force rescaling for all types even if already exists
// - type - type for the icon, prepended to the icon id
// - prefix - where to store all scaled icons
// - verify - check if the original icon is the same as at the source
core.getIcon = function(uri, id, options, callback)
{
    var self = this;

    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};
    logger.debug('getIcon:', uri, options);

    if (!uri || !id) return (callback ? callback(new Error("wrong args")) : null);

    // Verify image size and skip download if the same
    if (options.verify) {
        var imgfile = this.iconPath(id, options);
        fs.stat(imgfile, function(err, stats) {
            logger.debug('getIcon:', id, imgfile, 'stats:', stats, err);
            // No image, get a new one
            if (err) return self.getIcon(uri, id, self.delObj(options, 'verify'), callback);

            self.httpGet(uri, { method: 'HEAD' }, function(err2, params) {
                if (err) logger.error('getIcon:', id, imgfile, 'size1:', stats.size, 'size2:', params.size, err);
                // Not the same, get a new one
                if (params.size !== stats.size) return self.getIcon(uri, id, self.delObj(options, 'verify'), callback);
                // Same, just verify types
                self.putIcon(imgfile, id, options, callback);
            });
        });
        return;
    }

    // Download into temp file, make sure dir exists
    var opts = url.parse(uri);
    var tmpfile = path.join(this.path.tmp, core.random().replace(/[\/=]/g,'') + path.extname(opts.pathname));
    self.httpGet(uri, { file: tmpfile }, function(err, params) {
        // Error in downloading
        if (err || params.status != 200) {
            fs.unlink(tmpfile, function() {});
            if (err) logger.error('getIcon:', id, uri, 'not found', 'status:', params.status, err);
            return (callback ? callback(err || new Error('Status ' + params.status)) : null);
        }
        // Store in the proper location
        self.putIcon(tmpfile, id, options, function(err2) {
            fs.unlink(tmpfile, function() {});
            if (callback) callback(err2);
        });
    });
}

// Put original or just downloaded file in the proper location according to the types for given id,
// this function is used after downloading new image or when moving images from other places. On success
// the callback will be called with the second argument set to the output file name where the image has been saved.
// Valid properties in the options:
// - type - icon type, this will be prepended to the name of the icon
// - prefix - top level subdirectory under images/
// - force - to rescale even if it already exists
// - width, height, filter, ext, quality for backend.resizeImage function
core.putIcon = function(file, id, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};
    logger.debug('putIcon:', id, file, options);

    options.outfile = self.iconPath(id, options);

    // Filesystem based icon storage, verify local disk
    fs.exists(options.outfile, function(yes) {
        // Exists and we do not need to rescale
        if (yes && !options.force) return callback();
        // Make new scaled icon
        self.scaleIcon(file, options, function(err) {
            if (err) logger.error("putIcon:", id, file, 'path:', options, err);
            if (callback) callback(err, options.outfile);
        });
    });
}

// Scale image using ImageMagick, return err if failed
// - infile can be a string with file name or a Buffer with actual image data
// - options can specify image properties:
//     - outfile - if not empty is a file name where to store scaled image or if empty the new image contents will be returned in the callback as a buffer
//     - width, height - new image dimensions
//          - if width or height is negative this means do not perform upscale, keep the original size if smaller than given positive value,
//          - if any is 0 that means keep the original size
//     - filter - ImageMagick image filters, default is lanczos
//     - quality - 0-99 percent, image scaling quality
//     - ext - image format: png, gif, jpg, jp2
//     - flip - flip horizontally
//     - flop - flip vertically
//     - blue_radius, blur_sigma - perform adaptive blur on the image
//     - crop_x, crop_y, crop_width, crop_height - perform crop using given dimensions
//     - sharpen_radius, sharpen_sigma - perform sharpening of the image
//     - brightness - use thing to change brightness of the image
//     - contrast - set new contrast of the image
//     - rotate - rotation angle
//     - bgcolor - color for the background, used in rotation
//     - quantized - set number of colors for quantize
//     - treedepth - set tree depth for quantixe process
//     - dither - set 0 or 1 for quantixe and posterize processes
//     - posterize - set number of color levels
//     - normalize - normalize image
//     - opacity - set image opacity
core.scaleIcon = function(infile, options, callback)
{
    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {};
    backend.resizeImage(infile, options, function(err, data) {
        if (err) logger.error('scaleIcon:', typeof infile == "object" ? infile.length : infile, options, err);
        if (callback) callback(err, data);
    });
}

// Extract domain from local host name
core.domainName = function(host)
{
    var name = String(host || "").split('.');
    return (name.length > 2 ? name.slice(1).join('.') : host).toLowerCase();
}

// Return object type, try to detect any distinguished type
core.typeName = function(v)
{
    var t = typeof(v);
    if (v === null) return "null";
    if (t !== "object") return t;
    if (Array.isArray(v)) return "array";
    if (Buffer.isBuffer(v)) return "buffer";
    if (v instanceof Date) return "date";
    if (v instanceof RegExp) return "regex";
    return "object";
}

// Return true of the given value considered empty
core.isEmpty = function(val)
{
    switch (this.typeName(val)) {
    case "null":
    case "undefined":
        return true;
    case "buffer":
    case "array":
        return val.length == 0;
    case "number":
    case "regex":
    case "boolean":
        return false;
    case "date":
        return isNaN(val);
    default:
        return val ? false: true;
    }
}

// Return true if a variable or property in the object exists, just a syntax sugar
core.exists = function(obj, name)
{
    if (typeof obj == "undefined") return false;
    if (typeof obj == "obj" && typeof obj[name] == "undefined") return false;
    return true;
}

// A copy of an object, this is a shallow copy, only arrays and objects are created but all other types are just referenced in the new object
// - first argument is the object to clone
// - second argument can be an object that acts as a filter to skip properties:
//     - _skip_null - to skip all null properties
//     - _empty_to_null - convert empty strings into null objects
//     - _skip_cb - a callback that returns true to skip a property, arguments are property name and value
//     - name - a property name to skip
//   if the second arg is not an object then it is assumed that filter is not given and the arguments are treated as additional property to be added to the cloned object
// - all additional arguments are treated as name value pairs and added to the cloned object as additional properties
// Example:
//          core.cloneObj({ 1: 2 }, { 1: 1 }, "3", 3, "4", 4)
//          core.cloneObj({ 1 : 2 }, "3", 3, "4", 4)
core.cloneObj = function()
{
    var obj = arguments[0];
    var filter = {}, idx = 1;
    if (this.typeName(arguments[1]) == "object") {
        idx = 2;
        filter = arguments[1];
    }
    var rc = {};
    switch (this.typeName(obj)) {
    case "object":
        break;
    case "array":
        rc = [];
        break;
    case "buffer":
        return new Buffer(this);
    case "date":
        return new Date(obj.getTime());
    case "regex":
        return new Regexp(this);
    case "string":
        if (filter._empty_to_null && obj === "") return null;
    default:
        return obj;
    }
    for (var p in obj) {
        if (filter[p]) continue;
        if (filter._skip_null && (obj[p] == null || typeof obj[p] == "undefined")) continue;
        if (filter._skip_cb && filter._skip_cb(p, obj[p])) continue;
        rc[p] = obj[p];
    }
    for (var i = idx; i < arguments.length - 1; i += 2) rc[arguments[i]] = arguments[i + 1];
    return rc;
}

// Return a new Error object
core.newError = function(msg, name, code, status)
{
    var err = new Error(msg);
    if (name) err.name = name;
    if (code) err.code = code;
    if (status) err.status = status;
    return err;
}

// Return new object using arguments as name value pairs for new object properties
core.newObj = function()
{
    var obj = {};
    for (var i = 0; i < arguments.length - 1; i += 2) obj[arguments[i]] = arguments[i + 1];
    return obj;
}

// Add properties to existing object, first arg is the object, the rest are pairs: name, value,....
core.extendObj = function()
{
    if (!arguments[0]) arguments[0] = {}
    for (var i = 1; i < arguments.length - 1; i += 2) arguments[0][arguments[i]] = arguments[i + 1];
    return arguments[0];
}

// Delete properties from the object, first arg is an object, the rest are properties to be deleted
core.delObj = function()
{
    if (!arguments[0] || typeof arguments[0] != "object") return;
    for (var i = 1; i < arguments.length; i++) delete arguments[0][arguments[i]];
    return arguments[0];
}

// Return an object consisting of properties that matched given criteria in the given object.
// optins can define the following properties:
// - name - search by property name, return all objects that contain given property
// - value - search by value, return all objects that have a property with given value
// - sort if true then sort found columns by the property value.
// - names - if true just return list of column names
// - flag - if true, return object with all properties set to flag value
//
// Example
//
//          core.searchObj({id:{index:1},name:{index:3},type:{index:2},descr:{}}, { name: 'index', sort: 1 });
//          { id: { index: 1 }, type: { index: 2 }, name: { index: 3 } }
//
core.searchObj = function(obj, options)
{
    if (!options) options = {};
    var name = options.name;
    var val = options.value;
    var rc = Object.keys(obj).
                    filter(function(x) {
                        if (typeof obj[x] != "object") return 0;
                        if (typeof name != "undefined" && typeof obj[x][name] == "undefined") return 0;
                        if (typeof val != "undefined" && !Object.keys(obj[x]).some(function(y) { return obj[x][y] == val })) return 0;
                        return 1;
                    }).
                    sort(function(a, b) {
                        if (options.sort) return obj[a][name] - obj[b][name];
                        return 0;
                    }).
                    reduce(function(x,y) { x[y] = options.flag || obj[y]; return x; }, {});

    if (options.names) return Object.keys(rc);
    return rc;
}

// Return a property from the object, name specifies the path to the property, if the required property belong to another object inside the top one
// the name uses . to separate objects. This is a convenient method to extract properties from nested objects easily.
// Options may contains the following properties:
// - list - return the value as list even if there is only one value found
//
// Example:
//
//          core.objGet({ response: { item : { id: 123, name: "Test" } } }, "response.item.name")
//
core.objGet = function(obj, name, options)
{
    if (!obj) return null;
    if (!Array.isArray(name)) name = String(name).split(".");
    for (var i = 0; i < name.length; i++) {
        obj = obj[name[i]];
        if (typeof obj == "undefined") return null;
    }
    if (obj && options && options.list && !Array.isArray(obj)) obj = [ obj ];
    return obj;
}

// Set a property of the object, name can be an array or a string with property path inside the object, all non existent intermediate
// objects will be create automatically. The options can have the folowing properties:
// - incr - if 1 the numeric value will be added to the existing if any
// - push - add to the array, if it is not an array a new empty aray is created
//
// Example
//
//          var a = core.objSet({}, "response.item.count", 1)
//          core.objSet(a, "response.item.count", 1, { incr: 1 })
//
core.objSet = function(obj, name, value, options)
{
    if (!obj) obj = {};
    if (!Array.isArray(name)) name = String(name).split(".");
    if (!name || !name.length) return obj;
    var p = name[name.length - 1], v = obj;
    for (var i = 0; i < name.length - 1; i++) {
        if (typeof obj[name[i]] == "undefined") obj[name[i]] = {};
        obj = obj[name[i]];
    }
    if (options && options.push) {
        if (!Array.isArray(obj[p])) obj[p] = [];
        obj[p].push(value);
    } else
    if (options && options.incr) {
        if (!obj[p]) obj[p] = 0;
        obj[p] += value;
    } else {
        obj[p] = value;
    }
    return v;
}

// Merge an object with the options, all properties in the options override existing in the object, returns a new object
//
// Example
//
//      var o = core.mergeObject({ a:1, b:2, c:3 }, { c:5, d:1 })
//      o = { a:1, b:2, c:5, d:1 }
core.mergeObj = function(obj, options)
{
    var rc = {};
    for (var p in options) rc[p] = options[p];
    for (var p in obj) {
        var val = obj[p];
        switch (core.typeName(val)) {
        case "object":
            if (!rc[p]) rc[p] = {};
            for (var c in val) {
                if (!rc[p][c]) rc[p][c] = val[c];
            }
            break;
        case "null":
        case "undefined":
            break;
        default:
            if (!rc[p]) rc[p] = val;
        }
    }
    return rc;
}

// JSON stringify without empty, null or undefined properties if no filter is given
core.stringify = function(obj, filter)
{
    if (!filter && this.typeName(obj) == "object") {
        filter = [];
        for (var p in obj) if (typeof obj[p] != "undefined" && obj[p] !== null && obj[p] !== "") filter.push(p);
    }
    return JSON.stringify(obj, filter);
}

// Silent JSON parse, returns null on error, no exceptions raised.
// options can specify the output in case of an error:
// - list - return empty list
// - obj - return empty obj
// - str - return empty string
core.jsonParse = function(obj, options)
{
    try {
        return JSON.parse(obj);
    } catch(e) {
        if (options) {
            if (options.logging) logger.error('jsonParse:', e, obj);
            if (options.obj) return {};
            if (options.list) return [];
            if (options.str) return "";
        }
        return null;
    }
}

// Return cookies that match given domain
core.cookieGet = function(domain, callback)
{
    var db = this.context.db;
    db.select("bk_cookies", {}, { pool: db.local }, function(err, rows) {
        var cookies = [];
        rows.forEach(function(cookie) {
            if (cookie.expires <= Date.now()) return;
            if (cookie.domain == domain) {
                cookies.push(cookie);
            } else
            if (cookie.domain.charAt(0) == "." && (cookie.domain.substr(1) == domain || domain.match(cookie.domain.replace(/\./g,'\\.') + '$'))) {
                cookies.push(cookie);
            }
        });
        logger.debug('cookieGet:', domain, cookies);
        if (callback) callback(cookies);
    });
}

// Save new cookies arrived in the request,
// merge with existing cookies from the jar which is a list of cookies before the request
core.cookieSave = function(cookiejar, setcookies, hostname, callback)
{
    var self = this;
    var db = this.context.db;
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
                obj.expires = value ? Number(self.toDate(value)) : Infinity;
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
    async.forEachSeries(cookiejar, function(rec, next) {
        if (!rec) return next();
        if (!rec.id) rec.id = core.hash(rec.name + ':' + rec.domain + ':' + rec.path);
        db.put("bk_cookies", rec, { pool: db.local }, function() { next() });
    }, function() {
        if (callback) callback();
    });
}

// Adds reference to the objects in the core for further access, specify module name, module reference pairs
core.addContext = function()
{
	for (var i = 0; i < arguments.length - 1; i+= 2) {
		this.context[arguments[i]] = arguments[i + 1];
	}
}

// Create REPL interface with all modules available
core.createRepl = function(options)
{
    var self = this;
    var r = repl.start(options || {});
    r.context.core = this;
    r.context.logger = logger;
    r.context.backend = backend;
    r.context.fs = fs;
    r.context.os = os;
    r.context.util = util;
    r.rli.historyIndex = 0;
    r.rli.history = [];
    // Expose all modules as top level objects
    for (var p in this.context) r.context[p] = this.context[p];

    // Support history
    if (this.replFile) {
        r.rli.history = this.readFileSync(this.replFile, { list: '\n' }).reverse();
        r.rli.addListener('line', function(code) {
            if (code) {
                fs.appendFile(self.replFile, code + '\n', function() {});
            } else {
                r.rli.historyIndex++;
                r.rli.history.pop();
            }
      });
    }
    return r;
}
// Watch temp files and remove files that are older than given number of seconds since now, remove only files that match pattern if given
// This function is not async-safe, it uses sync calls
core.watchTmp = function(dirs, secs, pattern)
{
    var self = this;
    var now = core.now();
    (dirs || []).forEach(function(dir) {
        self.findFileSync(dir, function(f, s) {
            if (pattern && !f.match(patern)) return false;
            if (!s.mtime || now - s.mtime < secs || s.isDirectory()) return false;
            logger.log('watchTmp: delete', dir, f, (now - s.mtime)/60, 'mins old');
            return true;
        }).forEach(function(file) {
            fs.unlink(file, function(err) {
                if (err) logger.error('watchTmp:', file, err);
            });
        });
    });
}

// Watch files in a dir for changes and call the callback
core.watchFiles = function(dir, pattern, callback)
{
    logger.debug('watchFiles:', dir, pattern);
    fs.readdir(dir, function(err, list) {
        if (err) return callback(err);
        list.filter(function(file) {
            return file.match(pattern);
        }).map(function(file) {
            file = path.join(dir, file);
            return ({ name: file, stat: core.statSync(file) });
        }).forEach(function(file) {
            logger.debug('watchFiles:', file.name, file.stat.size);
            fs.watch(file.name, function(event, filename) {
                // Check stat if no file name, Mac OS X does not provide it
                if (!filename && core.statSync(file.name).size == file.stat.size) return;
                logger.log('watchFiles:', event, filename || file.name);
                callback(file);
            });
        });
    });
}

// Watch log files for errors and report via email or POST url
core.watchLogs = function(callback)
{
    var self = this;
    var db = self.context.db;

    // Check interval
    self.logwatcherMtime = Date.now();

    // From address, use current hostname
    if (!self.logwatcherFrom) self.logwatcherFrom = "logwatcher@" + (self.domain || os.hostname());

    var match = null;
    if (self.logwatcherMatch) {
        try { match = new RegExp(self.logwatcherMatch.map(function(x) { return "(" + x + ")"}).join("|")); } catch(e) { logger.error('watchLogs:', e, self.logwatcherMatch) }
    }
    var ignore = null
    if (self.logwatcherIgnore) {
        try { ignore = new RegExp(self.logwatcherIgnore.map(function(x) { return "(" + x + ")"}).join("|")); } catch(e) { logger.error('watchLogs:', e, self.logwatcherIgnore) }
    }

    // Load all previous positions for every log file, we start parsing file from the previous last stop
    db.select("bk_property", { name: 'logwatcher:' }, { ops: { name: 'begins_with' }, pool: db.local }, function(err, rows) {
        var lastpos = {};
        for (var i = 0; i < rows.length; i++) {
            lastpos[rows[i].name] = rows[i].value;
        }
        var errors = "";

        // For every log file
        async.forEachSeries(self.logwatcherFiles, function(log, next) {
            var file = log.file;
            if (!file && self[log.name]) file = self[log.name];
            if (!file) return next();

            fs.stat(file, function(err2, st) {
               if (err2) return next();
               // Last saved position, start from the end if the log file is too big or got rotated
               var pos = core.toNumber(lastpos['logwatcher:' + file] || 0);
               if (st.size - pos > self.logwatcherMax || pos > st.size) pos = st.size - self.logwatcherMax;

               fs.open(file, "r", function(err3, fd) {
                   if (err3) return next();
                   var buf = new Buffer(self.logwatcherMax);
                   fs.read(fd, buf, 0, buf.length, Math.max(0, pos), function(err4, nread, buffer) {
                       fs.close(fd, function() {});
                       if (err4 || !nread) {
                           fs.close(fd, function() {});
                           return next();
                       }
                       var lines = buffer.slice(0, nread).toString().split("\n");
                       for (var i in lines) {
                           // Skip global ignore list first
                           if (ignore && ignore.test(lines[i])) continue;
                           // Match both global or local filters
                           if (log.match && log.match.test(lines[i]) || (match && match.test(lines[i]))) {
                               errors += lines[i] + "\n";
                           }
                       }
                       // Separator between log files
                       if (errors.length > 1) errors += "\n\n";
                       // Save current size to start next time from
                       db.put("bk_property", { name: 'logwatcher:' + file, value: st.size }, { pool: db.local }, function(e) {
                           if (e) logger.error('watchLogs:', file, e);
                           fs.close(fd, function() {});
                           next();
                       });
                   });
               });
            });
        }, function(err2) {
            if (errors.length > 1) {
                logger.log('logwatcher:', 'found errors, send report to', self.logwatcherEmail, self.logwatcherUrl);
                if (self.logwatcherUrl) {
                    self.sendRequest({ url: self.logwatcherUrl, queue: true, headers: { "content-type": "text/plain" }, postdata: errors }, callback);
                } else
                if (self.logwatcherEmail) {
                    self.sendmail(self.logwatcherFrom, self.logwatcherEmail, "logwatcher: " + os.hostname() + "/" + self.ipaddr + " errors", errors, callback);
                }
            } else {
                if (callback) callback();
            }
        });
    });
}

// To be used in the tests, this function takes the following arguments
// checkTest(next, err, failure, ....)
//  - next is a callback to be called after printing error condition if any, it takes err as its argument
//  - err - is the error object passed by the most recent operation
//  - failure - must be true for failed test, the condition is evaluated by the caller and this is the result of it
//  - all other arguments are printed in case of error or result being false
//
//  NOTE: In forever mode (-test-forever) any error is ignored and not reported
//
// Example
//
//          function(next) {
//              db.get("bk_account", { id: "123" }, function(err, row) {
//                  core.checkTest(next, err, row && row.id == "123", "Record not found", row)
//              });
//          }
core.checkTest = function()
{
    var next = arguments[0];
    if (this.test.forever) return next();

    if (arguments[1] || arguments[2]) {
        var args = [ arguments[1] ? arguments[1] : new Error("failed condition") ];
        for (var i = 3; i < arguments.length; i++) args.push(arguments[i]);
        logger.error(args);
        return next(args[0]);
    }
    next();
}

// Run the test function which is defined in the object, all arguments will be taken from the command line.
// The common command line arguments that supported:
// - -test-cmd - name of the function to run
// - -test-workers - number of workers to run the test at the same time
// - -test-delay - number of milliseconds before starting worker processes, default is 500ms
// - -test-iterations - how many times to run this test function, default is 1
// - -test-forever - run forever without reporting any errors, for performance testing
//
// All common command line arguments can be used, like -db-pool to specify which db to use.
//
// After finish or in case of error the process exits, so this is not supposded tobe run inside the
// production backend, only as standalone utility for running unit tests
//
// Example:
//
//          var bk = require("backendjs"), core = bk.core, db = bk.db;
//          var tests = {
//              test1: function(next) {
//                  db.get("bk_account", { id: "123" }, function(err, row) {
//                      core.checkTest(next, err, row && row.id == "123", "Record not found", row)
//                  });
//              },
//              ...
//          }
//          bk.run(function() { core.runTest(tests); });
//
//          # node tests.js -test-cmd test1
//
core.runTest = function(obj, options, callback)
{
    var self = this;
    if (!options) options = {};

    this.test = { role: cluster.isMaster ? "master" : "worker", iterations: 0, stime: Date.now() };
    this.test.delay = options.delay || this.getArgInt("-test-delay", 500);
    this.test.countdown = options.iterations || this.getArgInt("-test-iterations", 1);
    this.test.forever = options.forever || this.getArgInt("-test-forever", 0);
    this.test.keepmaster = options.keepmaster || this.getArgInt("-test-keepmaster", 0);
    self.test.workers = options.workers || self.getArgInt("-test-workers", 0);
    this.test.cmd = options.cmd || this.getArg("-test-cmd");
    if (this.test.cmd[0] == "_" || !obj || !obj[this.test.cmd]) {
        console.log("usage: ", process.argv[0], process.argv[1], "-test-cmd", "command");
        console.log("      where command is one of: ", Object.keys(obj).filter(function(x) { return x[0] != "_" && typeof obj[x] == "function" }).join(", "));
        if (cluster.isMaster && callback) return callback("invalid arguments");
        process.exit(0);
    }

    if (cluster.isMaster) {
        setTimeout(function() { for (var i = 0; i < self.test.workers; i++) cluster.fork(); }, self.test.delay);
        cluster.on("exit", function(worker) {
            if (!Object.keys(cluster.workers).length && !self.test.forever && !self.test.keepmaster) process.exit(0);
        });
    }

    logger.log("test started:", cluster.isMaster ? "master" : "worker", 'name:', this.test.cmd, 'db-pool:', this.context.db.pool);

    async.whilst(
        function () { return self.test.countdown > 0 || self.test.forever || options.running; },
        function (next) {
            self.test.countdown--;
            obj[self.test.cmd](function(err) {
                self.test.iterations++;
                if (self.test.forever) err = null;
                setImmediate(function() { next(err) });
            });
        },
        function(err) {
            self.test.etime = Date.now();
            if (err) {
                logger.error("test failed:", self.test.role, 'name:', self.test.cmd, err);
                if (cluster.isMaster && callback) return callback(err);
                process.exit(1);
            }
            logger.log("test stopped:", self.test.role, 'name:', self.test.cmd, 'db-pool:', self.context.db.pool, 'time:', self.test.etime - self.test.stime, "ms");
            if (cluster.isMaster && callback) return callback();
            process.exit(0);
        });
};

