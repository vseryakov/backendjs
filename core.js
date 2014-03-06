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
var backend = require(__dirname + '/build/backend');
var logger = require(__dirname + '/logger');
var cluster = require('cluster');
var printf = require('printf');
var async = require('async');
var os = require('os');
var emailjs = require('emailjs');
var memcached = require('memcached');
var redis = require("redis");
var amqp = require('amqp');

// The primary object containing all config options and common functions
var core = {
    name: 'backend',
    version: '2014.03.01.0',

    // Process and config parameters
    argv: {},

    // Server role, used by API server, for provisioning must include backend
    role: '',

    // Local domain
    domain: '',

    // Instance mode, remote jobs
    instance: false,

    // Home directory, current by default, must be absolute path
    home: process.env.HOME + '/.backend',

    // Various folders, by default relative paths are used
    path: { etc: "etc", spool: "var", images: "images", tmp: "tmp", web: "web", files: "files", log: "log" },

    // Log file for debug and other output from the modules, error or info messages, default is stdout
    logFile: null,
    errFile: null,

    // HTTP settings
    port: 8000,
    bind: '0.0.0.0',
    bind: '0.0.0.0',
    timeout: 30000,

    // HTTPS server options, can be updated by the apps before starting the SSL server
    ssl: { port: 443, bind: '0.0.0.0' },

    // Proxy config
    proxyPort: 8000,
    proxyBind: '0.0.0.0',

    // Number of parallel tasks running at the same time, can be used by various modules
    concurrency: 2,
    ipaddr: '',
    hostname: '',

    // Unix user/group privileges to set after opening port 80 and if running as root, in most cases this is ec2-user on Amazon cloud,
    // for manual installations rc.backend setup will create a user with this id
    uid: 777,
    gid: 0,
    umask: '0002',

    // Watched source files for changes, restartes the process if any file has chaged
    watchdirs: [],
    timers: {},

    // Log watcher config, watch for server restarts as well
    logwatcherMax: 1000000,
    logwatcherInterval: 3600,
    logwatcherIgnore: "NOTICE: |DEBUG: |DEV: ",
    logwatcherFiles: [ { file: "/var/log/messages", match: /\[[0-9]+\]: (ERROR|WARNING): |message":"ERROR:|queryAWS:.+Errors:|startServer:|startFrontend:/ },
                       { name: "logFile", match: /\[[0-9]+\]: ERROR: |message":"ERROR:|queryAWS:.+Errors:|startServer:|startFrontend:/ },
                       { name: "errFile", match: /.+/, } ],

    // User agent
    userAgent: ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10.8; rv:18.0) Gecko/20100101 Firefox/18.0",
                 "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.8; rv:21.0) Gecko/20100101 Firefox/21.0",
                 "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.7; rv:20.0) Gecko/20100101 Firefox/20.0",
                 "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_8_3) AppleWebKit/536.29.13 (KHTML, like Gecko) Version/6.0.4 Safari/536.29.13",
                 "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_8_3) AppleWebKit/537.31 (KHTML, like Gecko) Chrome/26.0.1410.65 Safari/537.31",
                 "Mozilla/5.0 (X11; Linux i686) AppleWebKit/534.34 (KHTML, like Gecko) Safari/534.34",
                 "Opera/9.80 (Macintosh; Intel Mac OS X 10.7.5) Presto/2.12.388 Version/12.15",
                 "Mozilla/5.0 (Windows NT 6.1; WOW64; rv:21.0) Gecko/20100101 Firefox/21.0",
                 "Mozilla/4.0 (compatible; MSIE 7.0; Windows NT 6.1; WOW64; Trident/6.0; SLCC2; .NET CLR 2.0.50727",
                 "Mozilla/4.0 (compatible; MSIE 7.0; Windows NT 6.1; WOW64; Trident/6.0; SLCC2; .NET CLR 3.5.30729; .NET CLR 3.0.30729; Media Center PC 6.0; .NET4.0C; InfoPath.2; BRI/2",
    ],

    // Config parameters
    args: [ { name: "help", type: "callback", value: function() { core.help() }, descr: "Print help and exit" },
            { name: "debug", type: "callback", value: function() { logger.setDebug('debug'); }, descr: "Enable debugging messages, short of -log debug", pass: 1 },
            { name: "log", type: "callback", value: function(v) { logger.setDebug(v); }, descr: "Set debugging level: none, log, debug, dev", pass: 1 },
            { name: "log-file", type: "callback", value: function(v) { logger.setFile(v); }, descr: "File where to write logging messages", pass: 1 },
            { name: "syslog", type: "callback", value: function(v) { logger.setSyslog(v ? this.toBool(v) : true); }, descr: "Write all logging messages to syslog", pass: 1 },
            { name: "console", type: "callback", value: function() { core.logFile = null; logger.setFile(null);}, descr: "All logging goes to the console", pass: 1 },
            { name: "home", type: "callback", value: "setHome", descr: "Specify home directory for the server, current dir if not specified", pass: 1 },
            { name: "concurrency", type:"number", min: 1, max: 4, descr: "How many simultaneous tasks to run at the same time inside one process, this is used by async module" },
            { name: "umask", descr: "Permissions mask for new files" },
            { name: "config-file", type: "path", descr: "Path to the config file instead of the default etc/config", pass: 1 },
            { name: "err-file", type: "path", descr: "Path to the erro log file where daemon will put app errors and crash stacks" },
            { name: "etc-dir", type: "callback", value: function(v) { if (v) this.path.etc = v; }, descr: "Path where to keep config files", pass: 1 },
            { name: "web-dir", type: "callback", value: function(v) { if (v) this.path.web = v; }, descr: "Path where to keep web pages" },
            { name: "tmp-dir", type: "callback", value: function(v) { if (v) this.path.tmp = v; }, descr: "Path where to keep temp files" },
            { name: "spool-dir", type: "callback", value: function(v) { if (v) this.path.spool = v; }, descr: "Path where to keep modifiable files" },
            { name: "log-dir", type: "callback", value: function(v) { if (v) this.path.log = v; }, descr: "Path where to keep log files" },
            { name: "files-dir", type: "callback", value: function(v) { if (v) this.path.images = v; }, descr: "Path where to keep uploaded files" },
            { name: "images-dir", type: "callback", value: function(v) { if (v) this.path.images = v; }, descr: "Path where to keep images" },
            { name: "uid", type: "number", min: 0, max: 9999, descr: "User id to switch after start if running as root" },
            { name: "gid", type: "number", min: 0, max: 9999, descr: "Group id to switch after start if running to root" },
            { name: "port", type: "number", min: 0, descr: "port to listen for the servers, this is global default" },
            { name: "bind", descr: "Bind to this address only, if not specified listen on all interfaces" },
            { name: "ssl-port", type: "number", obj: 'ssl', min: 0, descr: "port to listen for HTTPS servers, this is global default" },
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
            { name: "timeout", type: "number", min: 0, max: 3600000, descr: "HTTP request idle timeout for servers in ms" },
            { name: "daemon", type: "none", descr: "Daemonize the process, go to the background, can be used only in the command line" },
            { name: "shell", type: "none", descr: "Run command line shell, load the backend into the memory and prompt for the commands, can be used only in the command line" },
            { name: "monitor", type: "none", descr: "For production use, monitor the server processes and restart if crashed or exited, can be used only in the command line" },
            { name: "master", type: "none", descr: "Start the master server, can be used only in the command line" },
            { name: "proxy", type: "none", descr: "Start the HTTP proxy server, uses etc/proxy config file, can be used only in the command line" },
            { name: "proxy-port", type: "number", min: 0, descr: "Proxy server port" },
            { name: "proxy-bind", descr: "Proxy server listen address" },
            { name: "web", type: "none", descr: "Start Web server processes, spawn workers that listen on the same port" },
            { name: "repl-port-web", type: "number", min: 1001, descr: "Web server REPL port, if specified initializes REPL in the Web server process" },
            { name: "repl-bind-web", descr: "Web server REPL listen address" },
            { name: "repl-port", type: "number", min: 1001, descr: "Port for REPL interface in the master, if specified triggers REPL server initialization" },
            { name: "repl-bind", descr: "Listen only on specified address for REPL server in the master process" },
            { name: "repl-file", descr: "User specified file for REPL history" },
            { name: "lru-max", type: "number", descr: "Max number of items in the LRU cache" },
            { name: "lru-server", descr: "LRU server that acts as a NNBUS node to brosadcast cache messages to all connected backends" },
            { name: "lru-host", descr: "Address of NNBUS servers for cache broadcasts: ipc:///path,tcp://IP:port..." },
            { name: "pub-type", descr: "One of the redis, amqp or nn to use for PUB/SUB messaging, default is nanomsg sockets" },
            { name: "pub-server", descr: "Server to listen for published messages using nanomsg: ipc:///path,tcp://IP:port..." },
            { name: "pub-host", descr: "Server where clients publish messages to using nanomsg: ipc:///path,tcp://IP:port..." },
            { name: "sub-server", descr: "Server to listen for subscribed clients using nanomsg: ipc:///path,tcp://IP:port..." },
            { name: "sub-host", descr: "Server where clients received messages from using nanomsg: ipc:///path,tcp://IP:port..." },
            { name: "memcache-host", type: "list", descr: "List of memcached servers for cache messages: IP:port,IP:port..." },
            { name: "memcache-options", type: "json", descr: "JSON object with options to the Memcached client, see npm doc memcached" },
            { name: "redis-host", descr: "Address to Redis server for cache messages" },
            { name: "redis-options", type: "json", descr: "JSON object with options to the Redis client, see npm doc redis" },
            { name: "amqp-options", type: "json", descr: "JSON object with options to the AMQP client, see npm doc amqp" },
            { name: "cache-type", descr: "One of the redis or memcache to use for caching in API requests" },
            { name: "no-cache", type:" bool", descr: "Do not use LRU server, all gets will result in miss and puts will have no effect" },
            { name: "worker", type:" bool", descr: "Set this process as a worker even it is actually a master, this skips some initializations" },
            { name: "logwatcher-email", descr: "Email for the logwatcher notifications" },
            { name: "logwatcher-from", descr: "Email to send logwatcher notifications from" },
            { name: "logwatcher-ignore", descr: "Regexp with patterns that needs to be ignored by logwatcher process" },
            { name: "logwatcher-match", descr: "Regexp patterns that match conditions for logwatcher notifications" },
            { name: "logwatcher-interval", type: "number", min: 300, max: 86400 },
            { name: "user-agent", array: 1, descr: "Add HTTP user-agent header to be used in HTTP requests, for scrapers" },
            { name: "backend-host", descr: "Host of the master backend" },
            { name: "backend-login", descr: "Credentials login for the master backend access" },
            { name: "backend-secret", descr: "Credentials secret for the master backend access" },
            { name: "domain", descr: "Domain to use for communications, default is current domain of the host machine" },
            { name: "max-distance", type: "number", min: 0.1, max: 999, descr: "Max searchable distance(radius)" },
            { name: "min-distance", type: "number", min: 0.1, max: 999, descr: "Radius for the smallest bounding box in km containing single location, radius searches will combine neighboring boxes of this size to cover the whole area with the given distance request" },
            { name: "instance", type: "bool", descr: "Enables instance mode, means the backend is running in the cloud to execute a job" },
            { name: "backtrace", type: "callback", value: function() { backend.setbacktrace(); }, descr: "Enable backtrace facility, trap crashes and report the backtrace stack" },
            { name: "watch", type: "callback", value: function(v) { this.watch = true; this.watchdirs.push(v ? v : __dirname); }, descr: "Watch sources directory for file changes to restart the server, for development" }
    ],

    // Geo min distance for the hash key, km
    minDistance: 5,
    // Max searchable distance, km
    maxDistance: 50,

    // Inter-process messages
    ipcs: {},
    ipcId: 1,
    ipcTimeout: 500,
    lruMax: 50000,

    // REPL port for server
    replBindWeb: '0.0.0.0',
    replBind: '0.0.0.0',
    replFile: '.history',
    context: {},
}

module.exports = core;

// Main intialization, must be called prior to perform any actions
core.init = function(callback)
{
    var self = this;
    // Initial args to run before the config file
    self.processArgs("core", self, process.argv, 1);

    // Default home as absolute path
    self.setHome(self.home);

    // Find our IP address
    var intf = os.networkInterfaces();
    Object.keys(intf).forEach(function(x) {
        if (!self.ipaddr && x.substr(0, 2) != 'lo') {
            intf[x].forEach(function(y) { if (y.family == 'IPv4' && y.address) self.ipaddr = y.address; });
        }
    });
    // Default domain from local host name
    self.domain = self.domainName(os.hostname());

    var db = self.context.db;

    // Serialize initialization procedure, run each function one after another
    async.series([
        function(next) {
            self.loadConfig(next);
        },

        // Create all directories, only master should do it once but we resolve absolute paths in any mode
        function(next) {
            // Redirect system logging to stderr
            logger.setChannel("stderr");

            // Process all other arguments
            self.parseArgs(process.argv);

            try { process.umask(self.umask); } catch(e) { logger.error("umask:", self.umask, e) }

            // Resolve to absolute paths
            var files = [];
            Object.keys(self.path).forEach(function(p) {
                self[p] = path.resolve(self.path[p]);
                files.push(self[p]);
            });

            if (!cluster.isWorker && !self.worker) {
                // Create all subfolders
                files.forEach(function(dir) { self.mkdirSync(dir); });

                // Make sure created files are owned by regular user, not the root
                if (process.getuid() == 0) {
                    files.push(path.join(self.path.spool, self.name + ".db"));
                    files.forEach(function(f) { self.chownSync(f) });
                }
            }
            db.init(next);
        },

        function(next) {
            // Watch config directory for changes
            fs.watch(self.etc, function (event, filename) {
                logger.debug('watcher:', event, filename);
                switch (filename) {
                case "config":
                    self.setTimeout(filename, function() { self.loadConfig(); }, 5000);
                    break;
                }
            });
            next();
        },

        function(next) {
            if (!self.postInit) return next();
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

// Called after the core.init has been initialized successfully, this can be redefined in tha applications to add additional
// init steps that all processes require to have.
core.postInit = function(callback) { callback() }

// Run any backend function after environment has been intialized, this is to be used in shell scripts,
// core.init will parse all command line arguments, the simplest case to run from /data directory and it will use
// default environment or pass -home dir so the script will reuse same config and paths as the server
// context can be specified for the callback, if no then it run in the core context
// - require('backend').run(function() {}) is one example where this call is used as a shortcut for ad-hoc scripting
core.run = function(callback)
{
    var self = this;
    if (!callback) return logger.error('run:', 'callback is required');
    this.init(function(err) {
        callback.call(self, err);
    });
}

// Switch to new home directory, exit if we cannot, this is important for relative paths to work if used,
// no need to do this in worker because we already switched to home diretory in the master and all child processes
// inherit current directory
// Important note: If run with combined server or as a daemon then this MUST be an absolute path, otherwise calling
// it in the spawned web master will fail due to the fact that we already set the home and relative path will not work after that.
core.setHome = function(home)
{
	var self = this;
    if ((home || self.home) && cluster.isMaster) {
        if (home) self.home = path.resolve(home);
        try {
            self.makePath(self.home);
            process.chdir(self.home);
        } catch(e) {
            logger.error('setHome: cannot set home directory', self.home, e);
            process.exit(1);
        }
        logger.dev('setHome:', self.home);
    }
    self.home = process.cwd();
}

// Parse command line arguments
core.parseArgs = function(argv)
{
    var self = this;
    if (!argv || !argv.length) return;

    // Convert spaces if passed via command line
    argv = argv.map(function(x) { return x.replace(/%20/g, ' ') });
    logger.dev('parseArgs:', argv.join(' '));

   // Core parameters
    self.processArgs("core", self, argv);

    // Run registered handlers for each module
    for (var n in this.context) {
        var ctx = this.context[n];
        if (ctx.parseArgs) ctx.parseArgs.call(ctx, argv);
        self.processArgs(n, ctx, argv);
    }
}

// Config parameters defined in a module as a list of parameter names prefixed with module name, a parameters can be
// a string which defines text parameter or an object with the properties: name, type, value, decimals, min, max, separator
// type can be bool, number, list, json
core.processArgs = function(name, ctx, argv, pass)
{
    var self = this;
    if (!ctx) return;
    if (!Array.isArray(ctx.args)) return;
    function put(obj, key, val, x) {
        if (x.array) {
            if (!Array.isArray(obj[key])) obj[key] = [];
            obj[key].push(val);
        } else {
            obj[key] = val;
        }
    }
    ctx.args.forEach(function(x) {
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
        logger.dev("processArgs:", name, 'type:', x.type, "set:", key, "=", val);
        switch (x.type || "") {
        case "none":
            break;
        case "bool":
            put(obj, key, !val ? true : self.toBool(val), x);
            break;
        case "number":
            put(obj, key, self.toNumber(val, x.decimals, x.value, x.min, x.max), x);
            break;
        case "list":
            put(obj, key, self.strSplitUnique(val, x.separator), x);
            break;
        case "regexp":
            put(obj, key, new RegExp(val), x);
            break;
        case "json":
            put(obj, key, JSON.parse(val), x);
            break;
        case "path":
            put(obj, key, path.resolve(val), x);
            break;
        case "file":
            try { put(obj, key, fs.readFileSync(path.resolve(val)), x); } catch(e) { logger.error('procesArgs:', val, e); }
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
        // Append all process arguments into internal list when we processing all arguments, not in a pass
        self.argv[cname.substr(1)] = val || true;
    });
}

// Print help about command line arguments and exit
core.help = function()
{
    var self = this;
    var args = [ [ '', core.args ] ];
    Object.keys(this.context).forEach(function(n) {
        if (self.context[n].args) args.push([n, self.context[n].args]);
    })
    args.forEach(function(x) {
        x[1].forEach(function(y) {
            if (!y.name || !y.descr) return;
            var dflt = (x[0] ? self.context[x[0]] : core)[self.toCamel(y.name)] || "";
            console.log(printf("%-40s", (x[0] ? x[0] + '-' : '') + y.name), y.descr, dflt ? " Default: " + dflt : "");
        });
    });
    process.exit(0);
}

// Parse local config file
core.loadConfig = function(callback)
{
    var self = this;

    var file = this.configFile || path.join(self.path.etc, "config");
    logger.debug('loadConfig:', file);

    fs.readFile(file, function(err, data) {
        if (!err && data) {
            var argv = [], lines = data.toString().split("\n");
            for (var i = 0; i < lines.length; i++) {
                var line = lines[i].trim();
                if (!line.match(/^([a-z_-]+)/)) continue;
                line = line.split("=");
                if (line[0]) argv.push('-' + line[0]);
                if (line[1]) argv.push(line.slice(1).join('='));
            }
            self.parseArgs(argv);
        }
        if (callback) callback();
    });
}

// Setup 2-way IPC channel between master and worker.
// Cache management signaling, all servers maintain local cache per process of account, any server in the cluster
// that modifies an account record sends 'del' command to clear local caches so the actual record will be re-read from
// the database, all servers share the same database and update it directly. The eviction is done in 2 phases, first local process cache
// is cleared and then it sends a broadcast to all servers in the cluster using nanomsg socket, other servers all subscribed to that
// socket and listen for messages.
core.ipcInitServer = function()
{
    var self = this;

    // Attach our message handler to all workers, process requests from workers
    backend.lruInit(self.lruMax);

    // Run LRU cache server, receive cache refreshes from the socket, clears/puts cache entry and broadcasts
    // it to other connected servers via the same BUS socket
    if (self.lruServer) {
        try {
            self.lruServerSocket = new backend.NNSocket(backend.AF_SP_RAW, backend.NN_BUS);
            self.lruServerSocket.bind(self.lruServer);
            backend.lruServer(0, self.lruServerSocket.socket(), self.lruServerSocket.socket());
        } catch(e) {
            logger.error('ipcInit:', self.lruServer, e);
        }
    }

    // Send cache requests to the LRU host to be broadcasted to all other servers
    if (self.lruHost) {
        try {
            self.lruSocket = new backend.NNSocket(backend.AF_SP, backend.NN_BUS);
            self.lruSocket.connect(self.lruHost);
        } catch(e) {
            logger.error('ipcInit:', self.lruHost, e);
            self.lruSocket = null;
        }
    }

    // Pub/sub messaging system
    switch (this.pubType || "") {
    case "redis":
        break;

    case "amqp":
        break;

    default:
        // Subscription server, clients connect to it and listen for events, how events get published is no concern for this socket
        if (self.subServer) {
            try {
                self.subServerSocket = new backend.NNSocket(backend.AF_SP, backend.NN_PUB);
                self.subServerSocket.bind(self.subServer);
            } catch(e) {
                logger.error('ipcInit:', self.subServer, e)
                self.subServerSocket = null;
            }
        }
        // Publish server, it is where the clients send events to, it will forward them to the sub socket if it exists
        // or it can be used standalone with custom callback
        if (self.pubServer) {
            try {
                self.pubServerSocket = new backend.NNSocket(backend.AF_SP, backend.NN_PULL);
                self.pubServerSocket.bind(self.pubServer);
                // Forward all messages to the sub server socket
                if (self.subServerSocket) self.pubServerSocket.setForward(self.subServerSocket);
            } catch(e) {
                logger.error('ipcInit:', self.pubServer, e)
                self.pubServerSocket = null;
            }
        }
    }

    cluster.on('fork', function(worker) {
        // Handle cache request from a worker, send back cached value if exists, this method is called inside worker context
        worker.on('message', function(msg) {
            if (!msg) return false;
            logger.debug('LRU:', msg);
            switch (msg.cmd) {
            case 'keys':
                msg.value = backend.lruKeys();
                worker.send(msg);
                break;

            case 'get':
                if (msg.key) msg.value = backend.lruGet(msg.key);
                worker.send(msg);
                break;

            case 'put':
                if (msg.key && msg.value) backend.lruSet(msg.key, msg.value);
                if (msg.reply) worker.send({});
                if (self.lruSocket) self.lruSocket.send(msg.key + "\1" + msg.value);
                break;

            case 'incr':
                if (msg.key && msg.value) backend.lruIncr(msg.key, msg.value);
                if (msg.reply) worker.send({});
                if (self.lruSocket) self.lruSocket.send(msg.key + "\2" + msg.value);
                break;

            case 'del':
                if (msg.key) backend.lruDel(msg.key);
                if (msg.reply) worker.send({});
                if (self.lruSocket) self.lruSocket.send(msg.key);
                break;

            case 'clear':
                backend.lruClear();
                if (msg.reply) worker.send({});
                break;
            }
        });
    });
}

core.ipcInitClient = function()
{
    var self = this;

    // Pub/sub messaging system, client part, sends all publish messages to this socket which will be brodcasted into the
    // publish socket by the receiving end
    switch (self.pubType || "") {
    case "redis":
        self.redisCallbacks = {};
        self.redisSubClient = redis.createClient(null, self.redisHost, self.redisOptions || {});
        self.redisSubClient.on("ready", function() {
            self.redisSubClient.on("pmessage", function(channel, message) {
                if (self.redisCallbacks[channel]) self.redisCallback[channel](message);
            });
        });
        break;

    case "amqp":
        break;

    default:
        if (self.pubHost) {
            try {
                self.pubSocket = new backend.NNSocket(backend.AF_SP, backend.NN_PUSH);
                self.pubSocket.connect(self.pubHost);
            } catch(e) {
                logger.error('ipcInit:', self.pubHost, e)
                self.pubSocket = null;
            }
        }
    }

    switch (this.cacheType || "") {
    case "memcache":
        self.memcacheClient = new memcached(self.memcacheHost, self.memcacheOptions || {});
        self.ipcPutCache = function(k, v) { self.memcacheClient.set(k, v, 0); }
        self.ipcIncrCache = function(k, v) { self.memcacheClient.incr(k, v, 0); }
        self.ipcDelCache = function(k) { self.memcacheClient.del(k); }
        self.ipcGetCache = function(k, cb) { self.memcacheClient.get(k, function(e,v) { cb(v) }); }
        break;

    case "redis":
        self.redisCacheClient = redis.createClient(null, self.redisHost, self.redisOptions || {});
        self.ipcPutCache = function(k, v) { self.redisCacheClient.set(k, v, function() {}); }
        self.ipcIncrCache = function(k, v) { self.redisCacheClient.incr(k, v, function() {}); }
        self.ipcDelCache = function(k) { self.redisCacheClient.del(k, function() {}); }
        self.ipcGetCache = function(k, cb) { self.redisCacheClient.get(k, function(e,v) { cb(v) }); }
        break;
    }
    // Event handler for the worker to process response and fire callback
    process.on("message", function(msg) {
        if (!msg.id) return;
        if (self.ipcs[msg.id]) setImmediate(function() {
            try {
                self.ipcs[msg.id].callback(msg);
            } catch(e) {
                logger.error('message:', e, msg);
            }
            delete self.ipcs[msg.id];
        });

        switch (msg.cmd) {
        case "heapsnapshot":
            backend.heapSnapshot("tmp/" + process.pid + ".heapsnapshot");
            break;
        }
    });
}

// Send cache command to the master process via IPC messages, callback is used for commands that return value back
core.ipcSend = function(cmd, key, value, callback)
{
    var self = this;
    if (typeof value == "function") callback = value, value = '';
    if (typeof value == "object") value = JSON.stringify(value);
    var msg = { cmd: cmd, key: key, value: value };
    if (typeof callback == "function") {
        msg.reply = true;
        msg.id = self.ipcId++;
        self.ipcs[msg.id] = { timeout: setTimeout(function() { delete self.ipcs[msg.id]; callback(); }, self.ipcTimeout),
                              callback: function(m) { clearTimeout(self.ipcs[msg.id].timeout); callback(m.value); } };
    }
    process.send(msg);
}

core.ipcGetCache = function(key, callback)
{
    if (this.noCache) return callback ? callback() : null;
    this.ipcSend("get", key, callback);
}

core.ipcDelCache = function(key)
{
    if (this.noCache) return;
    this.ipcSend("del", key);
}

core.ipcPutCache = function(key, val)
{
    if (this.noCache) return;
    this.ipcSend("put", key, val);
}

core.ipcIncrCache = function(key, val)
{
    if (this.noCache) return;
    this.ipcSend("incr", key, val);
}

// Subscribe to the publishing server for messages starting with the given key, the callback will be called only on new data received
// Returns a non-zero handle which must be unsibscribed when not needed. If no pubsub system is available or error occured returns 0.
core.ipcSubscribe = function(key, callback)
{
    var sock = null;
    try {
        switch (this.pubType || "") {
        case "redis":
            this.redisSubClient.psubscribe(key);
            break;

        case "amqp":
            break;

        default:
            // Internal nanomsg based messaging system, non-persistent
            if (!this.subHost) break;
            sock = new backend.NNSocket(backend.AF_SP, backend.NN_SUB);
            sock.connect(this.subHost);
            sock.subscribe(key);
            sock.setCallback(function(err, data) { if (!err) callback.call(this, data.split("\1").pop()); });
        }
    } catch(e) {
        logger.error('ipcSubscribe:', this.subHost, key, e);
        sock = null;
    }
    return sock;
}

// Close subscription
core.ipcUnsubscribe = function(sock, key)
{
    try {
        switch (this.pubType || "") {
        case "redis":
            this.redisSubClient.punsubscribe(key);
            break;

        case "amqp":
            break;

        default:
            if (sock && sock instanceof backend.NNSocket) sock.close();
        }
    } catch(e) {
        logger.error('ipcUnsubscribe:', e, sock);
    }
    return null;
}

// Publish an event to be sent to the subscribed clients
core.ipcPublish = function(key, data)
{
    try {
        switch (this.pubType || "") {
        case "redis":
            this.redisSubClient.publish(key, data);
            break;

        case "amqp":
            break;

        default:
            // Nanomsg socket
            if (this.pubSocket) this.pubSocket.send(key + "\1" + JSON.stringify(data));
        }
    } catch(e) {
        logger.error('ipcPublish:', e, key);
    }
}

// Encode with additional symbols
core.encodeURIComponent = function(str)
{
    return encodeURIComponent(str || "").replace("!","%21","g").replace("*","%2A","g").replace("'","%27","g").replace("(","%28","g").replace(")","%29","g");
}

// Return unqiue process id based on the cluster status, worker or master and the role. This is can be reused by other workers within the role thus
// making it usable for repeating environemnts or storage solutions.
core.processId = function()
{
    return this.role + (cluster.isWorker ? cluster.worker.id : '');
}

// Convert text into captalized words
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
    var n = str[0] == 't' ? 1 : str[0] == 'f' ? 0 : (decimals ? parseFloat(str,10) : parseInt(str,10));
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

// Return Date object for given text or numeric date represantation, for invalid date returns 1969
core.toDate = function(val)
{
    var d = null;
    // Assume it is seconds which we use for most mtime columns, convert to milliseconds
    if (typeof val == "number" && val < 2147483647) val *= 1000;
    try { d = new Date(val); } catch(e) {}
    return !isNaN(d) ? d : new Date(0);
}

// Convert value to the proper type
core.toValue = function(val, type)
{
    switch ((type || this.typeName(val))) {
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
    case "integer":
    case "number":
        return core.toNumber(val);

    case "bool":
    case "boolean":
        return core.toBool(val);

    case "date":
    case "time":
        return this.toDate(val);

    case "mtime":
        return /^[0-9\.]+$/.test(value) ? this.toNumber(val) : (new Date(val));

    default:
        return val;
    }
}

// Evaluate expr, compare 2 values with optional type and opertion
core.isTrue = function(val1, val2, op, type)
{
    switch ((op ||"").toLowerCase()) {
    case 'null':
        if (v) return false;
        break;

    case 'not null':
        if (!v) return false;
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
    case "not between":
        // If we cannot parse out 2 values, treat this as exact operator
        var list = [];
        switch (core.typeName(val2)) {
        case "array":
            list = val2;
            break;

        case "string":
            // For number array allow to be separated by comma as well, either one but not to be mixed
            if ((type == "number" || type == "int") && val2.indexOf(',') > -1) {
                list = val2.split(',');
                break;
            } else
            if (value.indexOf('|') > -1) {
                list = val2.split('|');
                break;
            }
        }
        if (list.length > 1) {
            if (this.toValue(val1, type) < this.toValue(list[0], type) || this.toValue(val1, type) > this.toValue(list[1], type)) return false;
        } else {
            if (this.toValue(val1, type) != this.toValue(val2, type)) return false;
        }
        break;

    case '~* any':
    case '!~* any':
        break;

    case 'like%':
    case "ilike%":
    case "not like%":
    case "not ilike%":
        break;

    case "!~":
    case "!~*":
    case "iregexp":
    case "not iregexp":
        break;

    case "in":
    case "not in":
        break;

    case "~":
    case "~*":
    case "regexp":
    case "not regexp":
        break;

    case "!=":
    case "<>":
        if (this.toValue(val1, type) == this.toValue(val2, type)) return false;
        break;

    default:
        if (this.toValue(val1, type) != this.toValue(val2, type)) return false;
    }
    return true;
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
//   - query - aditional query parameters to be added to the url as an object or as encoded string
//   - sign - sign request with provided email/secret properties
// - callback will be called with the arguments:
//     first argument is error object if any
//     second is params object itself with updted fields
//     third is HTTP response object
// On end, the object params will contains the following updated properties:
//  - data if file was not specified, data eill contain collected response body as string
//  - status - HTTP response status code
//  - mtime - Date object with the last modified time of the requested file
//  - size - size of the response body or file
// Note: SIDE EFFECT: params object is modified in place so many options will be changed/removed or added
core.httpGet = function(uri, params, callback)
{
    var self = this;
    if (typeof params == "function") callback = params, params = null;
    if (!params) params = {};

    // Aditional query parameters as an object
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
    if (!options.headers['user-agent']) {
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
            break;
        default:
            params.postdata = String(params.postdata);
        }
        options.headers['content-length'] = params.postdata.length;
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
          params.mtime = res.headers.date ? new Date(res.headers.date) : null;
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
                  var uri2 = res.headers.location;
                  if (uri2.indexOf("://") == -1) {
                      uri2 = options.protocol + "//" + options.host + uri2;
                  }
                  logger.dev('httpGet:', 'redirect', uri2);

                  // Ignore redirects we dont want and return data recieved
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

// Produce signed URL to be used in embeded cases or with expiration so the url can be passed and be valid for longer time.
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
    // Strip the signature from the url
    rc.url = req.url.replace(/bk-signature=([^& ]+)/g, "");
    req.signature = rc;
    return rc;
}


// Verify signature with given account, signature is an object reurned by parseSignature
core.checkSignature = function(sig, account)
{
    var shatype = "sha1";
    var query = (sig.query).split("&").sort().filter(function(x) { return x != ""; }).join("&");
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
// url must include all query parametetrs already encoded and ready to be sent
// options may con tains the following:
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
    rc['bk-signature'] = (options.sigversion || 1) + '|' + (options.sigdata || "") + '|' + login + '|' + this.sign(String(secret), rc.str, shatype) + '|' + expires + '|' + (options.checksum || "") + '|';
    if (logger.level > 1) logger.log('signRequest:', rc);
    return rc;
}

// Make a request to the backend endpoint, save data in the queue in case of error, if data specified,
// POST request is made, if data is an object, it is converted into string.
// Returns params as in httpGet with .json property assigned with an object from parsed JSON response
// Special parameters for options:
// - login - login to use for access credentials instead of global credentials
// - secret - secret to use for access intead of global credentials
// - proxy - used as a proxy to backend, handles all errors and returns .status and .json to be passed back to API client
// - queue - perform queue management, save in queue if cannot send right now, delete from queue if sent
// - rowid - unique record id to be used in case of queue management
// - checksum - calculate checksum from the data
core.sendRequest = function(uri, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {};
    if (typeof options.sign == "undefined") options.sign = true;

    // Nothing to do without credentials
    if (!options.login) options.login = self.backendLogin;
    if (!options.secret) options.secret = self.backendSecret;
    if (options.sign && (!options.login || !options.secret)) {
        logger.debug('sendRequest:', 'no backend credentials', uri, options);
        return callback ? callback(null, { status: 200, message: "", json: { status: 200 } }) : null;
    }
    // Relative urls resolve against global backend host
    if (uri.indexOf("://") == -1) uri = self.backendHost + uri;

    var db = self.context.db;
    self.httpGet(uri, options, function(err, params, res) {
        // Queue management, insert on failure or delete on success
        if (options.queue) {
            if (params.status == 200) {
                if (options.id) {
                    db.del("bk_queue", { id: options.id });
                }
            } else {
                if (!options.id) options.id = core.hash(uri + (options.postdata || ""));
                options.mtime = self.now();
                options.counter = (options.counter || 0) + 1;
                if (options.counter > 10) {
                    db.del("bk_queue", { id: options.id });
                } else {
                    db.put("bk_queue", options);
                }
            }
        }
        // If the contents are encrypted, decrypt before processing content type
        if ((options.headers || {})['content-encoding'] == "encrypted") {
            params.data = self.decrypt(options.secret, params.data);
        }
        // Parse JSON and store in the params, set error if cannot be parsed, the caller will deal with it
        if (params.data && params.type == "application/json") {
            try {
                params.obj = JSON.parse(params.data);
            } catch(e) {
                err = e;
            }
        }
        if (params.status != 200) err = new Error("HTTP error: " + params.status);
        if (callback) callback(err, params, res);
    });
}

// Send all pending updates from the queue table
core.processQueue = function(callback)
{
    var self = this;
    var db = self.context.db;

    db.select("bk_queue", {}, { sort: "mtime" } , function(err, rows) {
        async.forEachSeries(rows, function(row, next) {
            self.sendRequest(row.url, self.extendObj(row, "queue", true), function(err2) { next(); });
        }, function(err3) {
            if (rows.length) logger.log('processQueue:', 'sent', rows.length);
            if (callback) callback();
        });
    });
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

// Send email
core.sendmail = function(from, to, subject, text, callback)
{
    var server = emailjs.server.connect();
    server.send({ text: text || '', from: from, to: to + ",", subject: subject || ''}, function(err, message) {
         if (err) logger.error('sendmail:', err);
         if (message) logger.debug('sendmail:', message);
         if (callback) callback(err);
     });
}

// Call callback for each line in the file
// options may specify the following parameters:
// - sync - read file synchorously and call callback for every line
// - abort - signal to stop processing
// - limit - number of lines to process and exit
// - progress - if > 0 report how many lines processed so far evert specified lines
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
        // because they will not be executed right away buty only after all lines processed
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

        // Start reding data from the optional position or from the beginning
        readData(fd, options.start, function(err2) {
            fs.close(fd, function() {});
            return (endCallback ? endCallback() : null);
        });
    });
}

// Return object with geohash for given coordinates to be used for location search
// options may contain the follwong properties:
//   - distance - limit the range key with the closest range smaller than then distance, required for search but for updates may be omitted
core.geoHash = function(latitude, longitude, options)
{
    var self = this;
	if (!options) options = {};
	if (options.distance && options.distance < this.minDistance) options.distance = this.minDistance;

	// Geohash ranges for different lenghts in km
	var range = [ [12, 0], [8, 0.019], [7, 0.076], [6, 0.61], [5, 2.4], [4, 20.0], [3, 78.0], [2, 630.0], [1, 2500.0], [1, 99999]];
	var size = range.filter(function(x) { return x[1] > self.minDistance })[0];
	var geohash = backend.geoHashEncode(latitude, longitude);
	return { geohash: geohash.substr(0, size[0]),
			 neighbors: options.distance ? backend.geoHashGrid(geohash.substr(0, size[0]), Math.floor(options.distance / size[1])).slice(1) : [],
			 latitude: latitude,
			 longitude: longitude,
			 distance: options.distance || 0 };
}

// Encrypt data with the given key code
core.encrypt = function(key, data, algorithm)
{
    if (!key || !data) return '';
    var encrypt = crypto.createCipher(algorithm || 'aes192', key);
    var b64 = encrypt.update(String(data), 'utf8', 'base64');
    try { b64 += encrypt.final('base64'); } catch(e) { b64 = ''; logger.error('encrypt:', e); }
    return b64;
}

// Decrypt data with the given key code
core.decrypt = function(key, data, algorithm)
{
    if (!key || !data) return '';
    var decrypt = crypto.createDecipher(algorithm || 'aes192', key);
    var msg = decrypt.update(String(data), 'base64', 'utf8');
    try { msg += decrypt.final('utf8'); } catch(e) { msg = ''; logger.error('decrypt:', e); };
    return msg;
}

// HMAC signing and base64 encoded, default algorithm is sha1
core.sign = function (key, data, algorithm, encode)
{
    return crypto.createHmac(algorithm || "sha1", String(key)).update(String(data), "utf8").digest(encode || "base64");
}

// Hash and base64 encoded, default algorithm is sha1
core.hash = function (data, algorithm, encode)
{
    return crypto.createHash(algorithm || "sha1").update(String(data), "utf8").digest(encode || "base64");
}

// Return unique Id without any special characters and in lower case
core.uuid = function()
{
    return backend.uuid().replace(/-/g, '').toLowerCase();
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

// Return number between min and max inclusive
core.randomNum = function(min, max)
{
    return min + (Math.random() * (max - min));
}

// Return number of seconds for current time
core.now = function()
{
    return Math.round((new Date()).getTime()/1000);
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
        W: function(t) { var d = utc ? Date.UTC(utc ? t.getUTCFullYear() : t.getFullYear(), 0, 1) : new Date(t.getFullYear(), 0, 1); return zeropad(Math.ceil((((t - d) / 86400000) + d.getDay() + 1) / 7)); },
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
core.strSplit = function(str, sep)
{
    if (!str) return [];
    return (Array.isArray(str) ? str : String(str).split(sep || /[,\|]/)).map(function(x) { return x.trim() }).filter(function(x) { return x != '' });
}

// Split as above but keep only unique items
core.strSplitUnique = function(str, sep)
{
    var rc = [];
    this.strSplit(str, sep).forEach(function(x) { if (!rc.some(function(y) { return x.toLowerCase() == y.toLowerCase() })) rc.push(x)});
    return rc;
}

// Stringify JSON into base64 string
core.toBase64 = function(data)
{
	return new Buffer(JSON.stringify(data)).toString("base64");
}

// Parse base64 JSON into Javascript object, in some cases this can be just a number then it is passed as it is
core.toJson = function(data)
{
	var rc = "";
	try {
	    if (data.match(/^[0-9]+$/)) rc = this.toNumber(data); else rc = JSON.parse(new Buffer(data, "base64").toString());
	} catch(e) {}
	return rc;
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

// Run theprocess and return all output to the callback
core.runProcess = function(cmd, callback)
{
    exec(cmd, function (err, stdout, stderr) {
        if (err) logger.error('getProcessOutput:', cmd, err);
        if (callback) callback(stdout, stderr);
    });
}

// Kill all backend processes that match name and not the current process
core.killBackend = function(name, callback)
{
    var self = this;
    self.runProcess("ps agx", function(stdout) {
        stdout.split("\n").
               filter(function(x) { return x.match("backend:") && (!name || x.match(name)); }).
               map(function(x) { return self.toNumber(x) }).
               filter(function(x) { return x != process.pid }).
               forEach(function(x) { process.kill(x) });
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

// Return list of files than match filter recursively starting with given path
// - file - starting path
// - filter - a function(file, stat) that return 1 if the given file matches, stat is a object returned by fs.statSync
core.findFileSync = function(file, filter)
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
            var files = fs.readdirSync(file);
            for (var i in files) {
                list = list.concat(this.findFileSync(path.join(file, files[i]), filter));
            }
        }
    } catch(e) {
        logger.error('findFileSync:', file, e);
    }
    return list;
}

// Recursively create all directories, return 1 if created or 0 on error, no exceptions are raised, error is logged only
core.makePathSync = function(dir)
{
    var list = path.normalize(dir).split("/");
    for (var i = 0, dir = ''; i < list.length; i++) {
        dir += list[i] + '/';
        try {
            if (!fs.existsSync(dir)) fs.mkdirSync(dir);
        } catch(e) {
            logger.error('makePath:', dir, e);
            return 0;
        }
    }
    return 1;
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

// Recursevily remove all files and folders in the given path, returns an error to the callback if any
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

// Recursevily remove all files and folders in the given path, stops on first error
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

// Change file owner do not report errors about non existent files
core.chownSync = function(file)
{
    try {
        fs.chownSync(file, this.uid, this.gid);
    } catch(e) {
        if (e.code != 'ENOENT') logger.error('chownSync:', this.uid, this.gid, file, e);
    }
}

// Create a directory if does not exist
core.mkdirSync = function(dir)
{
    if (!fs.existsSync(dir)) {
        try { fs.mkdirSync(dir) } catch(e) { logger.error('mkdirSync:', dir, e); }
    }
}

// Drop root privileges and switch to regular user
core.dropPrivileges = function()
{
    if (process.getuid() == 0) {
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
    // Convert into string and remove all chars except numbers, this will support UUIDs as well as regulat integers
    id = String(id).replace(/[^0-9]/g, '');
    return path.join(this.path.images, options.prefix || "", id.substr(-2), id.substr(-4, 2), (options.type ? String(options.type)[0] : "") + id + "." + (options.ext || "jpg"));
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
                logger.edebug(err2, 'getIcon:', id, imgfile, 'size1:', stats.size, 'size2:', params.size);
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
            logger.edebug(err, 'getIcon:', id, uri, 'not found', 'status:', params.status);
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
// this function is used after downloading new image or when moving images from other places
// Rescale all required icons by setting force to true in the options
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
            logger.edebug(err, "putIcon:", id, file, 'path:', options);
            if (callback) callback(err, options.outfile);
        });
    });
}

// Scale image using ImageMagick, return err if failed
// - infile can be a string with file name or a Buffer with actual image data
// - options can specify image properties:
//     - outfile - if not empty is a file name where to store scaled image or if empty the new image contents will be returned in the callback as a buffer
//     - width, height - new dimensions if width or height is negative this means do not perform upscale,
//       keep the original size if smaller than given positive value, if any is 0 that means keep the original
//     - filter - ImageMagick image filters, default is lanczos
//     - quality - 0-99 percent, image scaling quality
//     - ext - image format: png, gif, jpg
//     - flip - flip gorizontally
//     - flop - flip vertically
//     - blue_radius, blur_sigma - perform adaptice blur on the image
//     - crop_x, crop_y, crop_width, crop_height - perform crop using given dimenions
//     - sharpen_rafius, sharpen_sigma - perform sharpening of the image
//     - brightness - use thing to change brightness of the image
//     - contrast - set new contrast of the image
//     - rotate - rotation angle
//     - bgcolor - color for the background, used in rotation
//     - quantized - set number of colors for quantize
//     - treedepth - set tree depth for quantixe process
//     - dither - set 0 or 1 for quantie and posterize procesees
//     - posterize - set number of color levels
//     - normalize - normalize image
//     - opacity - set image opacity
core.scaleIcon = function(infile, options, callback)
{
    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {};
    backend.resizeImage(infile, options, function(err, data) {
        logger.edebug(err, 'scaleIcon:', typeof infile == "object" ? infile.length : infile, options);
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
    if (v.constructor == (new Date).constructor) return "date";
    if (v.constructor == (new RegExp).constructor) return "regex";
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

// Deep copy of an object,
// - first argument is the object to clone
// - second argument can be an object that acts as a filter to skip properties:
//     - _skip_null - to skip all null properties
//     - _empty_to_null - convert empty strings into null objects
//     - _skip_cb - a callback that returns true to skip a property, argumnets are property name and value
//     - name - a property name to skip, the value is treated depending on the type of the property:
//          - boolean - skip if true
//          - integer - skip only if the object's propetty is a string and greater in lengtth that this value
// - if the second arg is not an object then it is assumed that filter is not given and the arguments are treated as additional property to be added to the cloned object
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
        return obj;
    default:
        return obj;
    }
    for (var p in obj) {
        switch (this.typeName(filter[p])) {
        case "undefined":
            break;
        case "number":
            if (typeof obj[p] == "string" && obj[p].length < filter[p]) break;
            continue;
        default:
           continue;
        }
        if ((obj[p] == null || typeof obj[p] == "undefined") && filter._skip_null) continue;
        if (filter._skip_cb && filter._skip_cb(p, obj[p])) continue;
        rc[p] = obj[p];
    }
    for (var i = idx; i < arguments.length - 1; i += 2) rc[arguments[i]] = arguments[i + 1];
    return rc;
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

// Merge obj with the options, all options properties override existing in the obj
core.mergeObj = function(obj, options)
{
    if (!options) options = {};
    for (var p in obj) {
        var val = obj[p];
        switch (core.typeName(val)) {
        case "object":
            if (!options[p]) options[p] = {};
            for (var c in val) {
                if (!options[p][c]) options[p][c] = val[c];
            }
            break;
        case "null":
        case "undefined":
            break;
        default:
            if (!options[p]) options[p] = val;
        }
    }
    return options;
}

// JSON stringify without empty properties
core.stringify = function(obj)
{
    return JSON.stringify(this.cloneObj(obj, { _skip_null: 1, _skip_cb: function(n,v) { return v == "" } }));
}

// Return cookies that match given domain
core.cookieGet = function(domain, callback)
{
    this.context.db.select("bk_cookies", {}, function(err, rows) {
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
        self.context.db.put("bk_cookies", rec, function() { next() });
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
        try {
            r.rli.history = fs.readFileSync(this.replFile, 'utf-8').split('\n').reverse();
        } catch (e) {}

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
                // Check stat if no file name, Mac OSX does not provide it
                if (!filename && core.statSync(file.name).size == file.stat.size) return;
                logger.log('watchFiles:', event, filename || file.name);
                callback(file);
            });
        });
    });
}

// Watch log files for errors and report via email
core.watchLogs = function(callback)
{
    var self = this;

    // Need email to send
    if (!self.logwatcherEmail) return (callback ? callback() : false);

    // From address, use current hostname
    if (!self.logwatcherFrom) self.logwatcherFrom = "logwatcher@" + (self.domain || os.hostname());

    // Check interval
    var now = new Date();
    if (self.logwatcherMtime && (now.getTime() - self.logwatcherMtime.getTime())/1000 < self.logwatcherInterval) return;
    self.logwatcherMtime = now;

    var match = null;
    if (self.logwatcherMatch) {
        try { match = new RegExp(self.logwatcherIgnore); } catch(e) {}
    }
    var ignore = null
    if (self.logwatcherIgnore) {
        try { ignore = new RegExp(self.logwatcherIgnore); } catch(e) {}
    }
    var db = self.context.db;

    // Load all previous positions for every log file, we start parsing file from the previous last stop
    db.select("bk_property", { name: 'logwatcher:' }, { ops: { name: 'begins_with' } }, function(err, rows) {
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
                           // Match either global or local filter
                           if (!log.match || log.match.test(lines[i]) || (match && match.test(lines[i]))) {
                               errors += lines[i] + "\n";
                           }
                       }
                       // Separator between log files
                       if (errors.length > 1) errors += "\n\n";
                       // Save current size to start next time from
                       db.put("bk_property", { name: 'logwatcher:' + file, value: st.size, mtime: Date.now() }, function(e) {
                           if (e) logger.error('watchLogs:', file, e);
                           fs.close(fd, function() {});
                           next();
                       });
                   });
               });
            });
        }, function(err2) {
            // Ignore possibly empty lines or cut off text
            if (errors.length > 10) {
                logger.log('logwatcher:', 'found errors, send report to', self.logwatcherEmail);
                self.sendmail(self.logwatcherFrom, self.logwatcherEmail, "logwatcher: " + os.hostname() + "/" + self.ipaddr + " errors", errors, function() {
                    if (callback) callback();
                });
            } else {
                if (callback) callback();
            }
        });
    });
}

