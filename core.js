//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var util = require('util');
var net = require('net');
var fs = require('fs');
var repl = require('repl');
var path = require('path');
var crypto = require('crypto');
var url = require('url');
var http = require('http');
var https = require('https');
var exec = require('child_process').exec;
var backend = require(__dirname + '/backend');
var logger = require(__dirname + '/logger');
var cluster = require('cluster');
var printf = require('printf');
var gpool = require('generic-pool');
var async = require('async');
var os = require('os');
var emailjs = require('emailjs');

// The primary object containing all config options and common functions
var core = {
    name: 'backend',
    version: '2013.10.14.0', 

    // Process and config parameters
    argv: [],

    // Server role, used by API server, for provisioning must include backend
    role: '',

    // Local domain
    domain: '',

    // Instance mode, remote jobs
    instance: false,

    // Home directory, current by default, must be absolute path
    home: process.env.BACKEND_HOME || '',

    // Various folders, by default relative paths are used
    path: { etc: "etc", spool: "var", images: "images", tmp: "tmp", web: "web", log: "log" },

    // Log file for debug and other output from the modules, error or info messages, default is stdout
    logfile: null,

    // HTTP port of the server
    port: 80,
    bind: '0.0.0.0',

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
                       { name: "logfile", match: /\[[0-9]+\]: ERROR: |message":"ERROR:|queryAWS:.+Errors:|startServer:|startFrontend:/ } ],

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
    args: [ { name: "debug", type: "callback", value: function() { logger.setDebug('debug'); } },
            { name: "log", type: "callback", value: function(v) { logger.setDebug(v); } },
            { name: "logfile", type: "callback", value: function(v) { logger.setFile(v); } },
            { name: "syslog", type: "callback", value: function(v) { logger.setSyslog(v ? this.toBool(v) : true); } },
            { name: "console", type: "callback", value: function() { core.logfile = null; logger.setFile(null);} },
            { name: "home", type: "callback", value: "setHome" },
            { name: "concurrency", type:"number", min: 1, max: 4 },
            { name: "umask" },
            { name: "uid", type: "number", min: 0, max: 9999 },
            { name: "gid", type: "number", min: 0, max: 9999 },
            { name: "port", type: "number", min: 0, max: 99999 },
            { name: "bind" },
            { name: "repl-port", type: "number", min: 0, max: 99999 },
            { name: "repl-bind" },
            { name: "repl-file" },
            { name: "db-pool" },
            { name: "lru-max", type: "number" },
            { name: "lru-server" },
            { name: "lru-host" },
            { name: "sqlite-max", type: "number", min: 1, max: 100 },
            { name: "sqlite-idle", type: "number", min: 1000, max: 86400000 },
            { name: "pg-pool" },
            { name: "pg-prefix" },
            { name: "pg-max", type: "number", min: 1, max: 100 },
            { name: "pg-idle", type: "number", min: 1000, max: 86400000 },
            { name: "ddb-pool" },
            { name: "ddb-prefix" },
            { name: "logwatcher-email" },
            { name: "logwatcher-from" },
            { name: "logwatcher-ignore" },
            { name: "logwatcher-match" },
            { name: "logwatcher-interval", type: "number", min: 300, max: 86400 },
            { name: "user-agent", type: "push" },
            { name: "backend-host" },
            { name: "backend-key" },
            { name: "backend-secret" },
            { name: "backend-db" },
            { name: "domain" },
            { name: "instance", type: "bool" },
            { name: "backtrace", type: "callback", value: function() { backend.setbacktrace(); } },
            { name: "watch", type: "callback", value: function(v) { this.watch = true; this.watchdirs.push(v ? v : __dirname); } }
            ],
            
    // Database connection pools, sqlite default pool is called sqlite, PostgreSQL default pool is pg
    dbpool: {},
    nopool: { name: 'none', dbkeys: {}, dbcolumns: {}, unique: {}, 
              get: function() { throw "no pool" }, free: function() { throw "no pool" }, 
              prepare: function() {}, cacheColumns: function() {}, value: function() {} },
    
    // Inter-process messages
    ipcs: {},
    ipcId: 1,
    ipcTimeout: 500,
    lruMax: 1000,

    // Cookie jar
    cookiejar: { changed: false, cookies: [] },

    // REPL port for server
    replPort: 2080,
    replBind: '0.0.0.0',
    replFile: '.history',
    context: {},

    // Main intialization, must be called prior to perform any actions
    init: function(callback) {
        var self = this;

        // Assume current dir as our home
        self.setHome();

        // Find our IP address
        var intf = os.networkInterfaces();
        Object.keys(intf).forEach(function(x) {
            if (!self.ipaddr && x.substr(0, 2) != 'lo') {
                intf[x].forEach(function(y) { if (y.family == 'IPv4' && y.address) self.ipaddr = y.address; });
            }
        });
        // Default domain from local host name
        var host = os.hostname().split('.');
        self.hostname = host[0];
        self.domain = host.length > 2 ? host.slice(1).join('.') : self.hostname;

        // Serialize initialization procedure, run each function one after another
        async.series([
            function(next) {
                // Process arguments, override defaults
                self.parseArgs(process.argv);
                self.loadConfig(next);
            },

            // Create all directories, only master should do it once but we resolve absolute paths in any mode
            function(next) {
                // Redirect system logging to stderr
                logger.setChannel("stderr");
                
                try { process.umask(self.umask); } catch(e) { logger.error("umask:", self.umask, e) }

                // Resolve to absolute paths
                var files = [];
                Object.keys(self.path).forEach(function(p) {
                    self[p] = path.resolve(self.path[p]);
                    files.push(self[p]);
                });
                if (cluster.isWorker) return next();

                // Create all subfolders
                files.forEach(function(dir) {
                    self.mkdirSync(dir);
                });

                // Make sure created files are owned by regular user, not the root
                if (process.getuid() == 0) {
                    files.push(path.join(self.path.spool, self.name + ".db"));
                    files.forEach(function(f) { self.chownSync(f) });
                }
                next();
            },

            // Local database
            function(next) {
                var init = { backend_property: [{ name: 'name', primary: 1 }, 
                                                { name: 'value' }, 
                                                { name: 'mtime' } ] ,
                             backend_cookies: [ { name: 'name' }, 
                                                { name: 'domain', primary: 1 }, 
                                                { name: 'path', primary: 1 }, 
                                                { name: 'value', primary: 1 }, 
                                                { name: 'expires' } ],
                             backend_queue: [ { name: 'url' }, 
                                              { name: 'data' }, 
                                              { name: 'count', type: 'int', value: '0'}, 
                                              { name: 'mtime' } ],
                             backend_jobs: [ { name: 'id', primary: 1 }, 
                                             { name: 'type', value: "local" }, 
                                             { name: 'host', value: '' }, 
                                             { name: 'job' }, 
                                             { name: 'mtime', type: 'int'} ],
                           };

                // Sqlite pool is always enabled
                self.sqliteInitPool({ pool: 'sqlite', db: self.name, readonly: false, max: self.sqliteMax, idle: self.sqliteIdle });
                
                // Optional pools for supported SQL databases fro iternal management and provisioning
                if (self.pgPool) {
                    self.pgInitPool({ pool: 'pg', db: self.pgPool, max: self.pgMax, idle: self.pgIdle, prefix: self.pgPrefix });
                }
                
                // DyanmoDB pool is only for accounts and clients
                if (self.ddbPool) {
                    self.ddbInitPool({ pool: 'ddb', db: self.ddbPool, prefix: self.ddbPrefix });
                }

                // Initialize all pools, we know they all are SQL based
                async.forEachSeries(Object.keys(init), function(tbl, next2) {
                    if (cluster.isWorker) return next2();
                    async.forEachSeries(["sqlite", "pg"], function(pool, next3) { 
                        self.dbCreate(tbl, init[tbl], { pool: pool }, next3); 
                    }, next2);
                }, function() {
                    async.forEachSeries(Object.keys(self.dbpool), function(pool, next3) { 
                        self.dbCacheColumns({ pool: pool }, next3); 
                    }, next);
                });
            },

            // Make sure all cookies are cached
            function(next) {
                self.cookieLoad(next);
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
            }],
            // Final callbacks
            function(err) {
                logger.debug("init:", err || "");
                if (callback) setImmediate(function() { 
                    callback.call(self, err); 
                });
        });
    },

    // Run any backend function after environment has been intialized, this is to be used in shell scripts,
    // core.init will parse all command line arguments, the simplest case to run from /data directory and it will use
    // default environment or pass -home dir so the script will reuse same config and paths as the server
    // context can be specified for the callback, if no then it run in the core context
    // - require('backend').run(function() {}) is one example where this call is used as a shortcut for ad-hoc scripting
    run: function(callback) {
        var self = this;
        if (!callback) return;
        this.init(function(err) {
            callback.call(self, err);
        });
    },
    
    // Run console REPL shell
    shell: function() {
        this.run(function() {
            this.createRepl();
        });
    },

    // Run modules init callbacks, called by master server and all settings will be available for worker processes
    initModules: function(callback) {
        var self = this;
        async.forEachSeries(Object.keys(self.context), function(ctx, next) {
            ctx = self.context[ctx];
            if (ctx.initModule) ctx.initModule.call(ctx, next); else next();
        }, function() {
            if (callback) callback();
        });
    },

    // Switch to new home directory, exit if we cannot, this is important for relative paths to work if used,
    // no need to do this in worker because we already switched to home diretory in the master and all child processes
    // inherit current directory
    // Important note: If run with combined server or as a daemon then this MUST be an absolute path, otherwise calling it in the spawned web master will 
    // fail due to the fact that we already set the home and relative path will not work after that. 
    setHome: function(home) {
        if (this.home && cluster.isMaster) {
            if (home) this.home = path.resolve(home);
            try {
                process.chdir(this.home);
            } catch(e) {
                logger.error('init: cannot set home directory', this.home, e);
                process.exit(1);
            }
            logger.dev('setHome:', this.home);
        }
        this.home = process.cwd();
    },

    // Parse command line arguments
    parseArgs: function(argv) {
        var self = this;
        if (!argv || !argv.length) return;

        // Append all process arguments into internal list
        this.argv = this.argv.concat(argv);

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
    },

    // Config parameters defined in a module as a list of parameter names prefixed with module name, a parameters can be
    // a string which defines text parameter or an object with the properties: name, type, value, decimals, min, max, separator
    // type can be bool, number, list, json
    processArgs: function(name, ctx, argv) {
        var self = this;
        if (!ctx) return;
        if (!Array.isArray(ctx.args)) return;
        ctx.args.forEach(function(x) {
            if (typeof x == "string") x = { name: x };
            if (!x.name) return;
            // Core sets global parameters, all others by module
            var cname = (name == "core" ? "" : "-" + name) + '-' + x.name;
            var key = self.toCamel(x.name);
            var val = self.getArg(cname, null, argv);
            if (val == null) return;
            // Ignore the value if it is a parameter
            if (val && val[0] == '-') val = ""; 
            logger.dev("processArgs:", name, ":", key, "=", val);
            switch (x.type || "") {
            case "bool":
                ctx[key] = !val ? true : self.toBool(val);
                break;
            case "number":
                ctx[key] = self.toNumber(val, x.decimals, x.value, x.min, x.max);
                break;
            case "list":
                ctx[key] = val.split(x.separator || ",").map(function(y) { return y.trim() });
                break;
            case "regexp":
                ctx[key] = new RegExp(val);
                break;
            case "json":
                ctx[key] = JSON.parse(val);
                break;
            case "path":
                ctx[key] = path.resolve(val);
                break;
            case "push":
                if (!Array.isArray(ctx[key])) ctx[key] = [];
                ctx[key].push(val);
                break;
            case "callback":
                if (typeof x.value == "string") {
                    ctx[x.value](val);
                } else
                if (typeof x.value == "function") {
                    x.value.call(ctx, val);
                }
                break;
            default:
                ctx[key] = val;
            }
        });
    },
    
    // Parse local config file
    loadConfig: function(callback) {
        var self = this;

        fs.readFile(path.join(self.path.etc, "config"), function(err, data) {
            if (!err && data) {
                var argv = [], lines = data.toString().split("\n");
                for (var i = 0; i < lines.length; i++) {
                    var line = lines[i].split("=");
                    if (line[0]) argv.push('-' + line[0]);
                    if (line[1]) argv.push(line.slice(1).join('='));
                }
                self.parseArgs(argv);
            }
            if (callback) callback();
        });
    },

    // Setup 2-way IPC channel between master and worker.
    // Cache management signaling, all servers maintain local cache per process of account, any server in the cluster
    // that modifies an account record sends 'del' command to clear local caches so the actual record will be re-read from 
    // the database, all servers share the same database and update it directly. The eviction is done in 2 phases, first local process cache
    // is cleared and then it sends a broadcast to all servers in the cluster using nanomsg socket, other servers all subscribed to that
    // socket and listen for messages.
    ipcInit: function() {
        var self = this;

        // Attach our message handler to all workers, process requests from workers
        if (cluster.isMaster) {
            backend.lruInit(self.lruMax);
            
            // Run LRU cache server, receive cache refreshes from the socket, clears/puts cache entry and broadcasts 
            // it to other connected servers via the same BUS socket
            if (self.lruServer) {
                var sock = backend.nnCreate(backend.AF_SP_RAW, backend.NN_BUS);
                backend.nnBind(sock, self.lruServer);
                backend.lruServer(0, sock, sock);
            }
            
            // Send cache requests to the LRU host to be broadcasted to all other servers
            if (self.lruHost) {
                sel.lruSocket = backend.nnCreate(backend.AF_SP, backend.NN_BUS);
                backend.nnBind(self.lruSocket, self.lruHost);
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
                        if (self.lruSocket) backend.nnSend(self.lruSocket, msg.key + "\1" + msg.value);
                        break;

                    case 'del':
                        if (msg.key) backend.lruDel(msg.key);
                        if (msg.reply) worker.send({});
                        if (self.lruSocket) backend.nnSend(self.lruSocket, msg.key);
                        break;
                        
                    case 'clear':
                        backend.lruClear();
                        if (msg.reply) worker.send({});
                        break;
                    }
                });
            });
        }

        if (cluster.isWorker) {
            // Event handler for the worker to process response and fire callback
            process.on("message", function(msg) {
                if (!msg.id) return;
                if (self.ipcs[msg.id]) setImmediate(function() { 
                    self.ipcs[msg.id].callback(msg); 
                    delete self.ipcs[msg.id];
                });
                
                switch (msg.cmd) {
                case "heapsnapshot":
                    backend.heapSnapshot("tmp/" + process.pid + ".heapsnapshot");
                    break;
                }
            });
        }
    },

    // Send cache command to the master process via IPC messages, callback is used for commands that return value back
    ipcSend: function(cmd, key, value, callback) {
        var self = this;
        if (typeof value == "function") callback = value, value = '';
        var msg = { cmd: cmd, key: key, value: value };
        if (typeof callback == "function") {
            msg.reply = true;
            msg.id = self.ipcId++;
            self.ipcs[msg.id] = { timeout: setTimeout(function() { delete self.ipcs[msg.id]; callback(); }, self.ipcTimeout),
                                  callback: function(m) { clearTimeout(self.ipcs[msg.id].timeout); callback(m.value); } };
        }
        process.send(msg);
    },

    ipcGetCache: function(key, callback) { 
        this.ipcSend("get", key, callback); 
    },
    
    ipcDelCache: function(key) { 
        this.ipcSend("del", key); 
    },
    
    ipcPutCache: function(key, val) { 
        this.ipcSend("put", key, val); 
    },

    // Encode with additional symbols
    encodeURIComponent: function(str) {
        return encodeURIComponent(str).replace("!","%21","g").replace("*","%2A","g").replace("'","%27","g").replace("(","%28","g").replace(")","%29","g");
    },

    // Convert text into captalized words
    toTitle: function(name) {
        var t = "";
        name.replace(/_/g, " ").split(/[ ]+/).forEach(function(x) {
            t += x[0].toUpperCase() + x.substr(1) + " ";
        });
        return t.trim();
    },

    // Convert into camelized form
    toCamel: function(name) {
        return name.replace(/(?:[-_])(\w)/g, function (_, c) { return c ? c.toUpperCase () : ''; })
    },
    
    // Safe version, use 0 instead of NaN, handle booleans, if decimals specified, returns float
    toNumber: function(str, decimals, dflt, min, max) {
        str = String(str);
        // Autodetect floating number
        if (typeof decimals == "undefined" || decimals == null) decimals = /^[0-9]+\.[0-9]+$/.test(str);
        if (typeof dflt == "undefined") dflt = 0;
        var n = str[0] == 't' ? 1 : str[0] == 'f' ? 0 : (decimals ? parseFloat(str,10) : parseInt(str,10));
        n = isNaN(n) ? dflt : n;
        if (typeof min != "undefined" && n < min) n = min;
        if (typeof max != "undefined" && n > max) n = max;
        return n
    },

    // Return true if value represents true condition
    toBool: function(val) {
        return !val || val == "false" || val == "FALSE" || val == "f" || val == "F" || val == "0" ? false : true;
    },

    // Return Date object for given text or numeric date represantation, for invalid date returns 1969
    toDate: function(val) {
        var d = null;
        // Assume it is seconds which we use for most mtime columns, convert to milliseconds
        if (typeof val == "number" && val < 2147483647) val *= 1000;
        try { d = new Date(val); } catch(e) {}
        return d || new Date(0);
    },
    
    // Convert value to the proper type by field, resulting value will be the same type as the field
    toValue: function(field, value) {
        switch (this.typeName(field)) {
        case 'array':
            return value.split(',');

        case 'date':
            return new Date(value);

        case 'boolean':
            return this.toBool(value);

        case 'number':
            return this.toNumber(value);

        default:
            return value;
        }
    },

    // Quote value to be used in SQL expressions
    sqlQuote: function(val) {
        return val == null || typeof val == "undefined" ? "NULL" : ("'" + String(val).replace(/'/g,"''") + "'")
    },

    // Return properly quoted value to be used directly in SQL expressions, format according to the type
    sqlValue: function(value, type, dflt, min, max) {
        if (value == "null") return "NULL";
        switch ((type || this.typeName(value))) {
        case "expr":
        case "buffer":
            return value;

        case "real":
        case "float":
        case "double":
            return this.toNumber(value, true, dflt, min, max);

        case "int":
        case "integer":
        case "number":
            return this.toNumber(value, null, dflt, min, max);

        case "bool":
        case "boolean":
            return this.toBool(value);

        case "date":
            return this.sqlQuote((new Date(value)).toISOString());

        case "time":
            return this.sqlQuote((new Date(value)).toLocaleTimeString());

        case "mtime":
            return /^[0-9\.]+$/.test(value) ? this.toNumber(value, null, dflt, min, max) : this.sqlQuote((new Date(value)).toISOString());

        default:
            return this.sqlQuote(value);
        }
    },

    // Return list in format to be used with SQL IN ()
    sqlValueIn: function(list, type) {
        var self = this;
        if (!Array.isArray(list) || !list.length) return '';
        return list.map(function(x) { return self.sqlValue(x, type);}).join(",");
    },

    // Build SQL expressions for the column and value,
    //  op - SQL operator, default is =
    //       special operator null/not null is used to build IS NULL condition, value is ignored in this case
    //  type - can be data, string, number, float, expr, default is string
    //  dflt, min, max - are used for numeric values for validation of ranges
    //  for type expr, options.value contains sprintf-like formatted expression to be used as is with all '%s' substituted with actual value
    sqlExpr: function(name, value, options) {
        var self = this;
        if (!name || typeof value == "undefined") return "";
        if (!options.type) options.type = "string";
        var sql = "";
        var op = (options.op || "").toLowerCase();
        switch (op) {
        case "not in":
        case "in":
            var list = [];
            // Convert type into array
            switch (this.typeName(value)) {
            case "object":
                for (var p in value) list.push(value[p]);
                break;

            case "array":
                list = value;
                break;

            case "string":
                // For number array allow to be separated by comma as well, either one but not to be mixed
                if ((options.type == "number" || options.type == "int") && value.indexOf(',') > -1) {
                    list = value.split(',');
                    break;
                } else
                if (value.indexOf('|') > -1) {
                    list = value.split('|');
                    break;
                }

            default:
                list.push(value);
            }
            if (!list.length) break;
            sql += name + " " + op + " (" + self.sqlValueIn(list, options.type) + ")";
            break;

        case "between":
        case "not between":
            // If we cannot parse out 2 values, treat this as exact operator
            var list = [];
            switch (this.typeName(value)) {
            case "array":
                list = value;
                break;

            case "string":
                // For number array allow to be separated by comma as well, either one but not to be mixed
                if ((options.type == "number" || options.type == "int") && value.indexOf(',') > -1) {
                    list = value.split(',');
                    break;
                } else
                if (value.indexOf('|') > -1) {
                    list = value.split('|');
                    break;
                }
            }
            if (list.length > 1) {
                sql += name + " " + op + " " + this.sqlValue(list[0], options.type) + " AND " + this.sqlValue(list[1], options.type);
            } else {
                sql += name + "=" + this.sqlValue(value, options.type, options.value, options.min, options.max);
            }
            break;

        case "null":
        case "not null":
            sql += name + " IS " + op;
            break;

        case '@@':
            switch (this.typeName(value)) {
            case "string":
                if (value.indexOf('|') > -1) {
                    value = value.split('|');
                } else {
                    sql += name + op + " plainto_tsquery('" + (options.min || "english") + "'," + this.sqlQuote(value) + ")";
                    break;
                }

            case "array":
                value = value.map(function(x) { return "plainto_tsquery('" + (options.min || "english") + "'," + self.sqlQuote(x) + ")" }).join('||');
                sql += name + op + " (" +  value + ")";
                break;
            }
            break;

        case '~* any':
        case '!~* any':
            sql += this.sqlQuote(value) + " " + op + "(" + name + ")";
            break;

        case 'like%':
        case "ilike%":
        case "not like%":
        case "not ilike%":
            value += '%';
            op = op.substr(0, op.length-1);

        case '>':
        case '>=':
        case '<':
        case '<=':
        case '<>':
        case '!=':
        case "not like":
        case "like":
        case "ilike":
        case "not ilike":
        case "not similar to":
        case "similar to":
        case "regexp":
        case "not regexp":
        case "~":
        case "~*":
        case "!~":
        case "!~*":
        case 'match':
            sql += name + " " + op + " " + this.sqlValue(value, options.type, options.value, options.min, options.max);
            break;

        case "iregexp":
        case "not iregexp":
            sql += "LOWER(" + name + ") " + (op[0] == 'n' ? "NOT" : "") + " REGEXP " + this.sqlValue(value, options.type, options.value, options.min, options.max);
            break;
            
        case 'expr':
            if (options.expr) {
                var str = options.expr;
                if (value.indexOf('|') > -1) value = value.split('|');
                str = str.replace(/%s/g, this.sqlValue(value, options.type, null, options.min, options.max));
                str = str.replace(/%1/g, this.sqlValue(value[0], options.type, null, options.min, options.max));
                str = str.replace(/%2/g, this.sqlValue(value[1], options.type, null, options.min, options.max));
                sql += str;
            }
            break;

        default:
            sql += name + "=" + this.sqlValue(value, options.type, options.value, options.min, options.max);
            break;
        }
        return sql;
    },

    // Return time formatted for SQL usage as ISO, if no date specified returns current time
    sqlTime: function(d) {
        if (d) {
           try { d = (new Date(d)).toISOString() } catch(e) { d = '' }
        } else {
            d = (new Date()).toISOString();
        }
        return d;
    },

    // Given columns definition object, build SQL query using values from the values object, all conditions are joined using AND,
    // each column is defined as object with the following properties:
    //  name - column name, also this is the key to use in the values object to get value by
    //  col - actual column name to use in the SQL
    //  alias - optional table prefix if multiple tables involved
    //  value - default value
    //  type - type of the value, this is used for proper formatting: boolean, number, float, date, time, string, expr
    //  op - any valid SQL operation: =,>,<, between, like, not like, in, not in, ~*,.....
    //  group - for grouping multiple columns with OR condition, all columns with the same group will be in the same ( .. OR ..)
    //  always - only use default value if true
    //  required - value default or supplied must be in the query, otherwise return empty SQL
    //  search - aditional name for a value, for cases when generic field is used for search but we search specific column
    // params if given will contain values for binding parameters
    sqlFilter: function(columns, values, params) {
        var all = [], groups = {};
        if (!values) values = {};
        if (!params) params = [];
        if (this.typeName(columns) == "object") columns = [ columns ];
        for (var i in columns) {
            var name = columns[i].name;
            // Default value for this column
            var value = columns[i].value;
            // Can we use supplied value or use only default one
            if (!columns[i].always) {
                if (values[name]) value = values[name];
                // In addition to exact field name there could be query alias to be used for this column in case of generic search field
                // which should be applied for multiple columns, this is useful to search across multiple columns or use diferent formats
                var search = columns[i].search;
                if (search) {
                    if (!Array.isArray(columns[i].search)) search = [ search ];
                    for (var j = 0; j < search.length; j++) {
                        if (values[search[j]]) value = values[search[j]];
                    }
                }
            }
            if (typeof value =="undefined" || (typeof value == "string" && !value)) {
                // Required filed is missing, return empty query
                if (columns[i].required) return "";
                // Allow empty values excplicitely
                if (!columns[i].empty) continue;
            }
            // Uset actual column name now once we got the value
            if (columns[i].col) name = columns[i].col;
            // Table prefix in case of joins
            if (columns[i].alias) name = columns[i].alias + '.' + name;
            // Wrap into COALESCE
            if (typeof columns[i].coalesce != "undefined") {
                name = "COALESCE(" + name + "," + this.sqlValue(columns[i].coalesce, columns[i].type) + ")";
            }
            var sql = "";
            // Explicit skip of the parameter
            if (columns[i].op == 'skip') {
                continue;
            } else
            // Add binding parameters
            if (columns[i].op == 'bind') {
                sql = columns[i].expr.replace('$#', '$' + (params.length + 1));
                params.push(value);
            } else
            // Special case to handle NULL
            if (columns[i].isnull && (value == "null" || value == "notnull")) {
                sql = name + " IS " + value.replace('null', ' NULL');
            } else {
                // Primary condition for the column
                sql = this.sqlExpr(name, value, columns[i]);
            }
            if (!sql) continue;
            // If group specified, that means to combine all expressions inside that group with OR
            if (columns[i].group) {
                if (!groups[columns[i].group]) groups[columns[i].group] = [];
                groups[columns[i].group].push(sql);
            } else {
                all.push(sql);
            }
        }
        var sql = all.join(" AND ");
        for (var p in groups) {
            var g = groups[p].join(" OR ");
            if (!g) continue;
            if (sql) sql += " AND ";
            sql += "(" + g + ")";
        }
        return sql;
    },

    // Build SQL orderby/limit/offset conditions, config can define defaults for sorting and paging
    sqlLimit: function(config, values) {
        if (!config) config = {};
        if (!values) values = {};
        var rc = "";

        // Sorting column, multiple nested sort orders
        var orderby = "";
        for (var p in { "": 1, "1": 1, "2": 1 }) {
            var sort = values['_sort' + p] || config['sort' + p] || "";
            var desc = core.toBool(typeof values['_desc' + p] != "undefined" ? values['_desc' + p] : config['desc' + p]);
            if (config.names && config.names.indexOf(sort) == -1) sort = config['sort' + p] || "";
            if (!sort) continue;
            // Replace by sorting expression
            if (config.expr && config.expr[sort]) sort = config.expr[sort];
            orderby += (orderby ? "," : "") + sort + (desc ? " DESC" : "");
        }
        if (orderby) {
            rc += " ORDER BY " + orderby;
        }
        // Limit clause
        var page = core.toNumber(values['_page'], false, config.page || 0, 0, 999999);
        var count = core.toNumber(values['_count'], false, config.count || 50, 1, config.max || 1000);
        var offset = core.toNumber(values['_offset'], false, config.offset || 0, 0, 999999);
        if (count) {
            rc += " LIMIT " + count;
        }
        if (offset) {
            rc += " OFFSET " + offset;
        } else
        if (page && count) {
            rc += " OFFSET " + ((page - 1) * count);
        }
        return rc;
    },

    // Build SQL where condition from the keys and object values, return object with .values and .cond properties, idx is the starting index for
    // parameters, default is 1
    sqlWhere: function(obj, keys, idx, options) {
        if (!options) options = {};
        var req = { cond: [], values: [] };
        if (!idx) idx = 1;
        for (var j in keys) {
            var v = obj[keys[j]];
            if (typeof v == "undefined") continue;
            if (v == null) {
                req.cond.push(keys[j] + " IS NULL");
            } else
            if (Array.isArray(v)) {
                var cond = [];
                for (var i = 0; i < v.length; i++ ) {
                    cond.push(keys[j] + "=$" + idx);
                    req.values.push(v[i]);
                    idx++;
                }
                req.cond.push("(" + cond.join(" OR ") + ")");
            } else {
                req.cond.push(keys[j] + "=$" + idx);
                req.values.push(this.dbValue(options, v));
                idx++;
            }
        }
        return req;
    },

    // Create SQL table using column definition list with properties:
    // - name - column name
    // - type - type of the column, default is TEXT, options: int, real
    // - value - default value for the column
    // - primary - part of the primary key
    // - unique - part of the unique key
    // - unique1, unique2 - additional unique keys
    // - index - regular index
    // - index1, index2 - additonal indexes
    // options may contains:
    // - map - type mapping, convert lowecase type naem into other type for any specific database
    sqlCreate: function(table, obj, options, callback) {
        var self = this;
        if (typeof options == "function") callback = options, options = {};
        if (!options) options = {};
        
        function items(name) { return obj.filter(function(x) { return x[name] }).map(function(x) { return x.name }).join(','); }
        
        var sql = "CREATE TABLE IF NOT EXISTS " + table + "(" + 
                   obj.filter(function(x) { return x.name }).
                       map(function(x) { 
                           return x.name + " " + 
                           (function(t) { return (options.map || {})[t] || t })(x.type || "text") + " " + 
                           (typeof x.value != "undefined" ? "DEFAULT " + self.sqlValue(x.value, x.type) : "") }).join(",") + " " +
                   (function(x) { return x ? ",PRIMARY KEY(" + x + ")" : "" })(items('primary')) + ");";
        
        // Create indexes
        ["","1","2"].forEach(function(y) {
            sql += (function(x) { return x ? "CREATE UNIQUE INDEX IF NOT EXISTS " + table + "_unq" + y + " ON " + table + "(" + x + ");" : "" })(items('unique' + y));
            sql += (function(x) { return x ? "CREATE INDEX IF NOT EXISTS " + table + "_idx" + y + " ON " + table + "(" + x + ");" : "" })(items('index' + y));
        });
        
        return { text: sql, values: [] };
    },
    
    // Create ALTER TABLE ADD COLUMN statemwnts for missing columns
    sqlUpgrade: function(table, obj, options, callback) {
        var self = this;
        if (typeof options == "function") callback = options, options = {};
        if (!options) options = {};
        
        function items(name) { return obj.filter(function(x) { return x[name] }).map(function(x) { return x.name }).join(','); }
        var dbcols = core.dbColumns(table, options) || {};
        var sql = obj.filter(function(x) { return x.name && !(x.name in dbcols) }).
                      map(function(x) { 
                          return "ALTER TABLE " + table + " ADD COLUMN " + x.name + " " + 
                          (function(t) { return (options.map || {})[t] || t })(x.type || "text") + " " + 
                          (typeof x.value != "undefined" ? "DEFAULT " + self.sqlValue(x.value, x.type) : "") }).join(";");
        if (sql) sql += ";";
        
        // Create indexes
        ["","1","2"].forEach(function(y) {
            sql += (function(x) { return x ? "CREATE UNIQUE INDEX IF NOT EXISTS " + table + "_unq" + y + " ON " + table + "(" + x + ");" : "" })(items('unique' + y));
            sql += (function(x) { return x ? "CREATE INDEX IF NOT EXISTS " + table + "_idx" + y + " ON " + table + "(" + x + ");" : "" })(items('index' + y));
        });
        
        return { text: sql, values: [] };
    },
    
    // Select object from the database, .keys is a list of columns for condition, .select is list of columns or expressions to return
    sqlSelect: function(table, obj, options) {
        if (!options) options = {};
        var keys = options.keys;
        if (!keys || !keys.length) keys = this.dbKeys(table, options) || [];
        
        // Requested columns, support only existing
        var dbcols = core.dbColumns(table, options) || {};
        var cols = options.total ? "COUNT(*) AS count" :
                   options.select ? options.select.split(",").filter(function(x) { return /^[a-z0-9_]+$/.test(x) && x in dbcols; }).map(function(x) { return x }).join(",") : "";
        if (!cols) cols = "*";

        var req = this.sqlWhere(obj, keys);

        // No keys or columns to select, just exit, it is not an error, return empty result
        if (!req.cond.length) {
            logger.debug('sqlSelect:', table, 'nothing to do', obj, keys);
            return null;
        }
        req.text = "SELECT " + cols + " FROM " + table + " WHERE " + req.cond.join(" AND ");
        if (options.sort) req.text += " ORDER BY " + options.sort + (options.desc ? " DESC " : "");
        if (options.count) req.text += " LIMIT " + options.limit;

        return req;
    },

    // Build SQL insert
    sqlInsert: function(table, obj, options) {
        if (!options) options = {};
        var names = [], pnums = [], req = { values: [] }, i = 1
        // Columns should exist prior to calling this
        var cols = this.dbColumns(table, options) || {};

        for (var p in obj) {
            if (!p || p[0] == "_" || (!options.nocolumns && !(p in cols))) continue;
            // Filter not allowed columns or only allowed columns
            if (options.skip_cols && options.skip_cols.indexOf(p) > -1) continue;
            if (options.allow_cols && options.allow_cols.indexOf(p) == -1) continue;
            var v = obj[p];
            // Avoid int parse errors with empty strings
            if (!v && ["number","json"].indexOf(cols[p].type) > -1) v = null;
            // Ignore nulls, this way default value will be inserted if specified
            if (typeof v == "undefined" || (v == null && !options.insert_nulls)) continue;
            names.push(p);
            pnums.push(options.placeholder || ("$" + i));
            v = this.dbValue(options, v, cols[p]);
            req.values.push(v);
            i++;
        }
        // No columns to insert, just exit, it is not an error, return empty result
        if (!names.length) {
            logger.debug('sqlInsert:', table, 'nothing to do', obj, cols);
            return null;
        }
        req.text = (options.replace ? "REPLACE" : "INSERT") + " INTO " + table + "(" + names.join(",") + ") values(" + pnums.join(",") + ")";
        if (options.returning) req.text += " RETURNING " + options.returning;
        return req;
    },

    // Build SQL statement for update
    sqlUpdate: function(table, obj, options) {
        if (!options) options = {};
        var sets = [], req = { values: [] }, i = 1;
        var cols = this.dbColumns(table, options) || {};
        var keys = options.keys;
        if (!keys || !keys.length) keys = this.dbKeys(table, options) || [];

        for (p in obj) {
            if (!p || p[0] == "_" || (!options.nocolumns && !(p in cols)) || keys.indexOf(p) != -1) continue;
            var v = obj[p];
            // Filter not allowed columns or only allowed columns
            if (options.skip_cols && options.skip_cols.indexOf(p) > -1) continue;
            if (options.allow_cols && options.allow_cols.indexOf(p) == -1) continue;
            // Do not update primary columns
            if (cols[p] && cols[p].primary) continue;
            // Avoid int parse errors with empty strings
            if (!v && ["number","json"].indexOf(cols[p].type) > -1) v = null;
            // Not defined fields are skipped but nulls can be triggered by a flag
            if (typeof v == "undefined" || (v == null && options.skip_null)) continue;
            // Update only if the value is null, otherwise skip
            if (options.skip_not_null && options.skip_not_null.indexOf(p) > -1) {
                sets.push(p + "=COALESCE(" + p + ", $" + i + ")");
            } else
            // Concat mode means append new value to existing, not overwrite
            if (options.concat && options.concat.indexOf(p) > -1) {
                sets.push(p + "=STR_CONCAT(" + p + ", $" + i + ")");
            } else {
                sets.push(p + "=" + (options.placeholder || ("$" + i)));
            }
            v = this.dbValue(options, v, cols[p]);
            req.values.push(v);
            i++;
        }
        var w = this.sqlWhere(obj, keys, i, options);
        if (!sets.length || !w.values.length) {
            // No keys or columns to update, just exit, it is not an error, return empty result
            logger.debug('sqlUpdate:', table, 'nothing to do', obj, keys);
            return null;
        }
        req.values = req.values.concat(w.values);
        req.text = "UPDATE " + table + " SET " + sets.join(",") + " WHERE " + w.cond.join(" AND ");
        if (options.returning) req.text += " RETURNING " + options.returning;
        return req;
    },

    // Build SQL statement for deleyte
    sqlDelete: function(table, obj, options) {
        if (!options) options = {};
        var keys = options.keys;
        if (!keys || !keys.length) keys = this.dbKeys(table, options) || [];
        
        var req = this.sqlWhere(obj, keys, 1, options);
        if (!req.values.length) {
            // No keys or columns to update, just exit, it is not an error, return empty result
            logger.debug('sqlUpdate:', table, 'nothing to do', obj, keys);
            return null;
        }
        req.text = "DELETE FROM " + table + " WHERE " + req.cond.join(" AND ");
        if (options.returning) req.text += " RETURNING " + options.returning;
        return req;
    },
    
    // Insert or update the record, check by primary key existence, due to callback the insert/update may happen much later
    // Parameters:
    //  - obj is Javascript object with properties that correspond to table columns
    //  - options define additional flags that may
    //    - keys is list of column names to be used as primary key when looking fo or updating the record
    //    - check_mtime defines a column name to be used for checking modification time and skip if not modified, must be a date value
    //    - check_data tell to verify every value in the given object with actual value in the database and skip update if the record is the same, if it is an array
    //      then check only specified columns
    dbReplace: function(table, obj, options, callback) {
        var self = this;
        if (typeof options == "function") callback = options,options = {};
        if (!options) options = {};
        if (!options.keys || !options.keys.length) options.keys = self.dbKeys(table, options) || [];
        
        var select = "1";
        // Use mtime to check if we need to update this record
        if (options.check_mtime && obj[options.check_mtime]) {
            select = options.check_mtime;
        } else
        // Check if values are different from existing value, skip if the records are the same by comparing every field
        if (options.check_data) {
            var cols = self.dbColumns(table, options) || {};
            var list = Array.isArray(options.check_data) ? options.check_data : Object.keys(obj);
            select = list.filter(function(x) { return x[0] != "_"  && x != 'mtime' && keys.indexOf(x) == -1 && (x in cols); }).join(',');
            if (!select) select = "1";
        }
        
        var req = this.dbPrepare("get", table, obj, { select: select });
        if (!req) {
            if (options.update_only) return callback ? callback(null, []) : null;
            return self.dbInsert(table, obj, options, callback);
        }

        // Create deep copy of the object so we have it complete inside the callback
        obj = this.clone(obj);

        self.dbQuery(req, function(err, rows) {
            if (err) return callback ? callback(err, []) : null;
            
            logger.debug('dbReplace:', req, result);
            if (rows.length) {
                // Skip update if specified or mtime is less or equal
                if (options.insert_only || (select == options.check_mtime && self.toDate(rows[0][options.check_mtime]) >= self.toDate(obj[options.check_mtime]))) {
                    return callback ? callback(null, []) : null;
                }
                // Verify all fields by value
                if (options.check_data) {
                    var same = select == "1" || Object.keys(rows[0]).every(function(x) { return String(rows[0][x]) == String(obj[x]) });
                    // Nothing has changed
                    if (same) return callback ? callback(null, []) : null;
                }
                self.dbUpdate(table, obj, keys, options, callback);
            } else {
                if (options.update_only) return callback ? callback(null, []) : null;
                self.dbInsert(table, obj, options, callback);
            }
        });
    },

    // Insert object into the database
    dbInsert: function(table, obj, options, callback) {
        if (typeof options == "function") callback = options,options = null;

        var req = this.dbPrepare("add", table, obj, options);
        this.dbQuery(req, options, callback);
    },

    // Update object in the database
    dbUpdate: function(table, obj, options, callback) {
        if (typeof options == "function") callback = options,options = null;

        var req = this.dbPrepare("put", table, obj, options);
        this.dbQuery(req, options, callback);
    },

    // Delete object in the database
    dbDelete: function(table, obj, options, callback) {
        if (typeof options == "function") callback = options,options = null;

        var req = this.dbPrepare("del", table, obj, options);
        this.dbQuery(req, options, callback);
    },

    // Select objects from the database 
    // .keys is a list of columns for condition or all primary keys
    // .select is list of columns or expressions to return or *
    dbSelect: function(table, obj, options, callback) {
        if (typeof options == "function") callback = options,options = null;

        var req = this.dbPrepare("all", table, obj, options);
        this.dbQuery(req, options, callback);
    },

    // Retrieve one record from the database 
    // .keys is a list of columns for condition or all primary keys
    // .select is list of columns or expressions to return or *
    dbGet: function(table, obj, options, callback) {
        if (typeof options == "function") callback = options,options = null;

        var req = this.dbPrepare("get", table, obj, options);
        this.dbQuery(req, options, callback);
    },

    // Retrieve cached result or put db record into the cache, options.keys can be used to specify exact key to be used for caching
    dbGetCached: function(table, obj, options, callback) {
        var self = this;
        if (typeof options == "function") callback = options,options = null;
        var pool = this.dbPool(options);
        pool.stats.gets++;
        var keys = options.keys || this.dbKeys(table, options) || [];
        var key = keys.filter(function(x) { return obj[x]} ).map(function(x) { return obj[x] }).join(":");
        this.ipcGetCache(table + ":" + key, function(rc) {
            // Cached value retrieved
            if (rc) {
                pool.stats.hits++;
                return callback ? callback(null, JSON.parse(rc)) : null;
            }
            pool.stats.misses++;
            // Retrieve account from the database, use the parameters like in core.dbSelect function
            self.dbGet(table, obj, options, function(err, rows) {
                if (err) pool.stats.errs++;
                // Store in cache if no error
                if (rows.length && !err) {
                    pool.stats.puts++;
                    self.ipcPutCache(table + ":" + key, self.stringify(rows[0]));
                }
                callback(err, rows.length ? rows[0] : null);
            });
        });
   
    },
    
    // Create SQL table, obj is a list with column definitions
    dbCreate: function(table, obj, options, callback) {
        if (typeof options == "function") callback = options,options = null;

        var req = this.dbPrepare("new", table, obj, options);
        this.dbQuery(req, options, callback);
    },
    
    // Upgrade SQL table with missing columns from the definition list
    dbUpgrade: function(table, obj, options, callback) {
        if (typeof options == "function") callback = options,options = null;

        var req = this.dbPrepare("upgrade", table, obj, options);
        if (!req.sql) return callback ? callback() : null;
        this.dbQuery(req, options, callback);
    },
    
    // Return database pool by name or default sqlite pool
    dbPool: function(options) {
        return this.dbpool[typeof options == "object" && options.pool ? options.pool : "sqlite"] || this.nopool || {};
    },

    // Reload all columns into the cache for the pool
    dbCacheColumns: function(options, callback) {
        this.dbPool(options).cacheColumns(callback);
    },
    
    // Return cached columns for a table or null
    dbColumns: function(table, options) {
        return this.dbPool(options).dbcolumns[table.toLowerCase()];
    },

    // Return cached primary keys for a table or null
    dbKeys: function(table, options) {
        return this.dbPool(options).dbkeys[table.toLowerCase()];
    },
    
    // Prepare for execution, SQL,...
    dbPrepare: function(op, table, obj, options) {
        return this.dbPool(options).prepare(op, table, obj, options);
    },

    // Return possibly converted value to be used for inserting/updating values in the database, used for SQL parametrized statements
    dbValue: function(options, val, vopts) {
        return this.dbPool(options).value(val, vopts);
    },

    // Convert column definition list used in dbCreate into the format used by internal db pool functions
    dbConvertColumns: function(cols) {
        return (cols || []).reduce(function(x,y) { x[y.name] = y; return x }, {});
    },
    
    // Execute SQL query in the database pool
    // sql can be a string or an object with the following properties:
    // - .text - SQL statement
    // - .values - parameter values for sql bindings
    // - .filter - function to filter rows not to be included in the result, return false to skip row, args are: (ctx, row)
    // Callback is called with the following params:
    //  - callback(err, rows, info) where info holds inforamtion about the last query: inserted_oid and affected_rows:
    dbQuery: function(req, options, callback) { 
        if (typeof options == "function") callback = options, options = {};
        if (this.typeName(req) != "object") req = { text: req };
        if (!req.text) return callback ? callback(new Error("empty statement"), []) : null;

        var pool = this.dbPool(options);
        pool.get(function(err, client) {
            if (err) return callback ? callback(err, []) : null;
            var t1 = core.mnow();
            client.query(req.text, req.values || [], function(err2, rows) {
                var info = { affected_rows: client.affected_rows, inserted_oid: client.inserted_oid };
                pool.free(client);
                if (err2) {
                    logger.error("dbQuery:", pool.name, req.text, req.values, err2);
                    return callback ? callback(err2, rows) : null;
                }
                if (req.filter) rows = rows.filter(function(row) { return req.filter.call(opts, row); });
                logger.log("dbQuery:", pool.name, (core.mnow() - t1), 'ms', rows.length, 'rows', req.text, req.values || "");
                if (callback) callback(err, rows, info);
            });
        });
    },

    // Create a database pool with creation and columns caching callbacks
    dbInitPool: function(options, createcb, cachecb, valuecb) {
        var self = this;
        if (!options) options = {};
        if (!options.pool) options.pool = "sqlite";
        
        var pool = gpool.Pool({
            name: options.pool,
            max: options.max || 1,
            idleTimeoutMillis: options.idle || 86400 * 1000,

            create: function(callback) {
                createcb.call(self, options, function(err, client) {
                    if (!err) self.dbpool[options.pool].watch(client);
                    callback(err, client);
                });
            },
            validate: function(client) {
                return self.dbpool[this.name].serial == client.pool_serial;
            },
            destroy: function(client) {
                logger.log('pool:', 'destroy', client.pool_name, "#", client.pool_serial);
                client.close(function(err) { logger.log("pool: closed", client.pool_name, err || "") });
            },
            log: function(str, level) {
                if (level == 'info') logger.debug('pool:', str);
                if (level == 'warn') logger.log('pool:', str);
                if (level == 'error') logger.error('pool:', str);
            },            
        });
        // Aquire a connection with error reporting
        pool.get = function(callback) {
            this.acquire(function(err, client) {
                if (err) logger.error('pool:', err);
                callback(err, client);
            });
        }
        // Release or destroy a client depending on the database watch counter
        pool.free = function(client) {
            if (this.serial != client.pool_serial) {
                this.destroy(client);
            } else {
                this.release(client);
            }
        }
        // Watch for changes or syncs and reopen the database file
        pool.watch = function(client) {
            var me = this;
            if (options.watch && options.file && !this.serial) {
                this.serial = 1;
                fs.watch(options.file, function(event, filename) {
                    logger.log('pool:', 'changed', me.name, event, filename, options.file, "#", me.serial);
                    me.serial++;
                    me.destroyAllNow();
                });
            }
            // Mark the client with the current db pool serial number, if on release this number differs we
            // need to destroy the client, not return to the pool
            client.pool_serial = this.serial;
            client.pool_name = this.name;
            logger.log('pool:', 'open', this.name, "#", this.serial);
        }
        // Call column caching callback with our pool name
        pool.cacheColumns = function(callback) {
            cachecb.call(self, { pool: this.name }, callback);
        }
        // Prepare for execution, return an object with formatted or transformed query request for the database driver of this pool
        // For SQL databases it creates a SQL statement with parameters
        pool.prepare = function(op, table, obj, opts) {
            switch (op) {
            case "new": return self.sqlCreate(this.prefix + table, obj, opts);
            case "upgrade": return self.sqlUpgrade(this.prefix + table, obj, opts);
            case "all": return self.sqlSelect(this.prefix + table, obj, opts);
            case "get": return self.sqlSelect(this.prefix + table, obj, self.clone(opts, {}, { count: 1 }));
            case "add": return self.sqlInsert(this.prefix + table, obj, opts);
            case "put": return self.sqlUpdate(this.prefix + table, obj, opts);
            case "del": return self.sqlDelete(this.prefix + table, obj, opts);
            }
        }
        // Convert a value when using with parametrized statements or convert into appropriate database type
        pool.value = valuecb || function(val, opts) { return val; }
        pool.name = options.pool;
        pool.prefix = options.prefix || "";
        pool.serial = 0;
        pool.dbcolumns = {};
        pool.dbkeys = {};
        pool.dbunique = {};
        pool.sql = true;
        pool.stats = { gets: 0, hits: 0, misses: 0, puts: 0, dels: 0, errs: 0 };
        this.dbpool[options.pool] = pool;
        return pool;
    },
    
    // Setup prumary database access
    pgInitPool: function(options) {
        var self = this;
        if (!options) options = {};
        if (!options.pool) options.pool = "pg";
        return this.dbInitPool(options, self.pgOpen, self.pgCacheColumns, self.pgValue);
    },

    // Open PostgreSQL connection, execute initial statements
    pgOpen: function(options, callback) {
        if (typeof options == "function") callback = options, options = null;
        if (!options) options = {};
        
        new backend.PgSQLDatabase(options.db, function(err) {
            if (err) {
                logger.error('pgOpen:', options, err);
                return callback ? callback(err) : null;
            }
            var db = this;
            db.notify(function(msg) { logger.log('notify:', msg) });

            // Execute initial statements to setup the environment, like pragmas
            var opts = Array.isArray(options.init) ? options.init : [];
            async.forEachSeries(opts, function(sql, next) {
                logger.debug('pgOpen:', conninfo, sql);
                db.query(sql, next);
            }, function(err2) {
                logger.edebug(err2, 'pgOpen:', options);
                if (callback) callback(err2, db);
            });
        });
    },
    
    // Always keep columns and primary keys in the cache
    pgCacheColumns: function(options, callback) {
        if (typeof options == "function") callback = options, options = null;
        if (!options) options = {};

        var pool = this.dbPool(options);
        pool.get(function(err, client) {
            if (err) return callback ? callback(err, []) : null;
            
            client.query("SELECT c.table_name,c.column_name,LOWER(c.data_type) AS data_type,c.column_default,c.ordinal_position,c.is_nullable " +
                         "FROM information_schema.columns c,information_schema.tables t " +
                         "WHERE c.table_schema='public' AND c.table_name=t.table_name " +
                         "ORDER BY 5", function(err, rows) {
                pool.dbcolumns = {};
                for (var i = 0; i < rows.length; i++) {
                    if (!pool.dbcolumns[rows[i].table_name]) pool.dbcolumns[rows[i].table_name] = {};
                    // Split type cast and ignore some functions in default value expressions
                    var isserial = false, val = rows[i].column_default ? rows[i].column_default.replace(/'/g,"").split("::")[0] : null;
                    if (val && val.indexOf("nextval") == 0) val = null, isserial = true;
                    if (val && val.indexOf("ARRAY") == 0) val = val.replace("ARRAY", "").replace("[", "{").replace("]", "}");
                    var type = "";
                    switch (rows[i].data_type) {
                    case "array":
                    case "json":
                        type = rows[i].data_type;
                        break;

                    case "numeric":
                    case "bigint":
                    case "real":
                    case "integer":
                    case "smallint":
                    case "double precision":
                        type = "number";
                        break;

                    case "boolean":
                        type = "bool";
                        break;

                    case "date":
                    case "time":
                    case "timestamp with time zone":
                    case "timestamp without time zone":
                        type = "date";
                        break;
                    }
                    pool.dbcolumns[rows[i].table_name][rows[i].column_name] = { id: rows[i].ordinal_position, value: val, type: type, data_type: rows[i].data_type, isnull: rows[i].is_nullable == "YES", isserial: isserial };
                }

                client.query("SELECT c.table_name,k.column_name,constraint_type " +
                             "FROM information_schema.table_constraints c,information_schema.key_column_usage k "+
                             "WHERE constraint_type IN ('PRIMARY KEY','UNIQUE') AND c.constraint_name=k.constraint_name", function(err, rows) {
                    pool.dbkeys = {};
                    pool.dbunique = {};
                    for (var i = 0; i < rows.length; i++) {
                        var col = pool.dbcolumns[rows[i].table_name][rows[i].column_name];
                        switch (rows[i].constraint_type) {
                        case "PRIMARY KEY":
                            if (!pool.dbkeys[rows[i].table_name]) pool.dbkeys[rows[i].table_name] = [];
                            pool.dbkeys[rows[i].table_name].push(rows[i].column_name);
                            if (col) col.primary = true;
                            break;
                            
                        case "UNIQUE":
                            if (!pool.dbunique[rows[i].table_name]) pool.dbunique[rows[i].table_name] = [];
                            pool.dbunique[rows[i].table_name].push(rows[i].column_name);
                            if (col) col.unique = 1;
                            break;
                        }
                    }
                    pool.free(client);
                    if (callback) callback(err);
                });
            });
        });
    },

    // Convert js array into db PostgreSQL array format: {..}
    pgValue: function(val, opts) {
        function toArray(v) {
            return '{' + v.map(function(x) { return Array.isArray(x) ? toArray(x) : typeof x === 'undefined' || x === null ? 'NULL' : JSON.stringify(x);3 } ).join(',') + '}';
        }
        switch ((opts || {}).data_type || "") {
        case "array":
            if (Buffer.isBuffer(val)) {
                var a = [];
                for (var i = 0; i < v.length; i++) a.push(v[i]);
                val = a.join(',');
            } else
            if (Array.isArray(val)) {
                val = toArray(val);
            }
            if (val && val[0] != "{") val = "{" + v + "}";
            break;

        default:
            if (Buffer.isBuffer(val)) val = val.toJSON();
            if (Array.isArray(val)) val = String(val);
        }
        return val;
    },
    
    // Initialize local sqlite cache database by name, the db files are open in read only mode and are watched for changes,
    // if new file got copied from the master, we reopen local database
    sqliteInitPool: function(options) {
        var self = this;
        if (!options) options = {};
        if (typeof options.readonly == "undefined") options.readonly = true;
        if (typeof options.temp_store == "undefined") options.temp_store = 0;
        if (typeof options.cache_size == "undefined") options.cache_size = 50000;
        if (typeof options.busy_timeout == "undefined") options.busy_timeout = -1;
        if (typeof options.read_uncommitted == "undefined") options.read_uncommitted = true;
        
        if (!options.pool) options.pool = "sqlite";
        options.file = path.join(options.path || core.path.spool, (options.db || name)  + ".db");
        return this.dbInitPool(options, self.sqliteOpen, self.sqliteCacheColumns, self.sqliteValue);
    },

    // Common code to open or create local Sqlite databases, execute all required initialization statements, calls callback
    // with error as first argument and database object as second
    sqliteOpen: function(options, callback) {
        if (typeof options == "function") callback = options, options = null;
        if (!options) options = {};

        new backend.SQLiteDatabase(options.file, options.readonly ? backend.OPEN_READONLY : 0, function(err) {
            if (err) {
                // Do not report errors about not existing databases
                if (err.code != "SQLITE_CANTOPEN" || !options.silent) logger.error('sqliteOpen', options.file, err);
                return callback ? callback(err) : null;
            }
            var db = this;

            // Execute initial statements to setup the environment, like pragmas
            var opts = [];
            if (typeof options.cache_size != "undefined") opts.push("PRAGMA cache_size=-" + options.cache_size);
            if (typeof options.temp_store != "undefined") opts.push("PRAGMA temp_store=" + options.temp_store);
            if (typeof options.journal_mode != "undefined") opts.push("PRAGMA journal_mode=" + options.journal_mode);
            if (typeof options.locking_mode != "undefined") opts.push("PRAGMA locking_mode=" + options.locking_mode);
            if (typeof options.synchronous != "undefined") opts.push("PRAGMA synchronous=" + options.synchronous);
            if (typeof options.read_uncommitted != "undefined") opts.push("PRAGMA read_uncommitted=" + options.read_uncommitted);
            if (typeof options.busy_timeout != "undefined") opts.push("SELECT busy_timeout(" + options.busy_timeout + ")");
            if (Array.isArray(options.init)) opts = opts.concat(options.init);
            async.forEachSeries(opts, function(sql, next) {
                logger.debug('sqliteOpen:', options.file, sql);
                db.exec(sql, next);
            }, function(err2) {
                logger.edebug(err2, 'sqliteOpen:', 'init', options.file);
                if (callback) callback(err2, db);
            });
        });
    },

    // Always keep columns and primary keys in the cache for the pool
    sqliteCacheColumns: function(options, callback) {
        if (typeof options == "function") callback = options, options = null;
        if (!options) options = {};
        
        var pool = this.dbPool(options);
        pool.get(function(err, client) {
            if (err) return callback ? callback(err, []) : null;
            client.query("SELECT name FROM sqlite_master WHERE type='table'", function(err2, tables) {
                if (err2) return callback ? callback(err2) : null;
                pool.dbcolumns = {};
                pool.dbkeys = {};
                pool.dbunique = {};
                async.forEachSeries(tables, function(table, next) {
                    client.query("PRAGMA table_info(" + table.name + ")", function(err3, rows) {
                        if (err3) return next(err3);
                        for (var i = 0; i < rows.length; i++) {
                            if (!pool.dbcolumns[table.name]) pool.dbcolumns[table.name] = {};
                            if (!pool.dbkeys[table.name]) pool.dbkeys[table.name] = [];
                            // Split type cast and ignore some functions in default value expressions
                            pool.dbcolumns[table.name][rows[i].name] = { id: rows[i].cid, value: rows[i].dflt_value, type: rows[i].type.toLowerCase(), data_type: rows[i].type, isnull: !rows[i].notnull, primary: rows[i].pk };
                            if (rows[i].pk) pool.dbkeys[table.name].push(rows[i].name);
                        }
                        client.query("PRAGMA index_list(" + table.name + ")", function(err4, indexes) {
                            async.forEachSeries(indexes, function(idx, next2) {
                                if (!idx.unique) return next2();
                                client.query("PRAGMA index_info(" + idx.name + ")", function(err5, cols) {
                                    cols.forEach(function(x) {
                                        var col = pool.dbcolumns[table.name][x.name];
                                        if (!col || col.primary) return; 
                                        col.unique = 1;
                                        if (!pool.dbunique[table.name]) pool.dbunique[table.name] = [];
                                        pool.dbunique[table.name].push(x.name);
                                    });
                                    next2();
                                });
                            }, function() {
                                next();
                            });
                        });
                    });
                }, function(err4) {
                    pool.free(client);
                    if (callback) callback(err4);
                });
            });
        });
    },

    // Convert into appropriate Sqlite format
    sqliteValue: function(val, opts) {
        // Dates must be converted into seconds
        if (typeof val == "object" && val.getTime) return Math.round(val.getTime()/1000);
        return val;
    },
    
    // DynamoDB pool
    ddbInitPool: function(options) {
        var self = this;
        if (!options) options = {};
        if (!options.pool) options.pool = "ddb";
        var aws = self.context.aws;

        // Redefine pool but implement the same interface
        var pool = { name: options.pool, db: options.db, prefix: options.prefix || "", dbcolumns: {}, dbkeys: {}, dbunique: {}, stats: { gets: 0, hits: 0, misses: 0, puts: 0, dels: 0, errs: 0 } };
        this.dbpool[options.pool] = pool;
        
        pool.get = function(callback) { callback(null, this); }
        pool.free = function() {}
        pool.watch = function() {}
        pool.value = function(v) { return v }

        pool.cacheColumns = function(opts, callback) {
            if (typeof opts == "function") callback = opts, opts = null;
            var pool = this;
            var options = { db: pool.db };
            
            aws.ddbListTables(options, function(err, rc) {
                if (err) return callback ? callback(err) : null;
                pool.dbcolumns = {};
                pool.dbkeys = {};
                pool.dbunique = {};
                async.forEachSeries(rc.TableNames, function(table, next) {
                    aws.ddbDescribeTable(table, options, function(err, rc) {
                        if (err) return next(err);
                        rc.Table.AttributeDefinitions.forEach(function(x) {
                            if (!pool.dbcolumns[table]) pool.dbcolumns[table] = {};
                            var type = x.AttributeType == "N" ? "number" : x.AttributeType.length == 2 ? "array" : "text";
                            pool.dbcolumns[table][x.AttributeName] = { type: type, data_type: x.AttributeType };
                        });
                        rc.Table.KeySchema.forEach(function(x) {
                            if (!pool.dbkeys[table]) pool.dbkeys[table] = [];
                            pool.dbkeys[table].push(x.AttributeName);
                            pool.dbcolumns[table][x.AttributeName].primary = 1;
                        });
                        (rc.Table.LocalSecondaryIndexes || []).forEach(function(x) {
                            x.KeySchema.forEach(function(y) {
                                if (!pool.dbunique[table]) pool.dbunique[table] = [];
                                pool.dbunique[table].push(y.AttributeName);
                                pool.dbcolumns[table][y.AttributeName].index = 1;
                            });
                        });
                        next();
                    });
                }, function(err2) {
                    if (callback) callback(err2);
                });
            });
        }
        
        // Pass all parametetrs directly to the execute function
        pool.prepare = function(op, table, obj, opts) {
            return { text: table, values: [op, obj, opts] };
        }
        
        // Simulate query as in SQL driver but performing AWS call, text will be a table name and values will be request options
        pool.query = function(table, opts, callback) {
            logger.log("query:", table ,opts)
            var pool = this;
            var obj = opts[1];
            var options = self.addObj(opts[2], "db", pool.db);
            
            switch(opts[0]) {
            case "new":
                var attrs = obj.filter(function(x) { return x.primary || x.index }).
                                map(function(x) { return [ x.name, x.type == "int" || x.type == "real" ? "N" : "S" ] }).
                                reduce(function(x,y) { x[y[0]] = y[1]; return x }, {});
                var keys = obj.filter(function(x, i) { return x.primary && i < 2 }).
                               map(function(x, i) { return [ x.name, i ? 'RANGE' : 'HASH' ] }).
                               reduce(function(x,y) { x[y[0]] = y[1]; return x }, {});
                var idxs = obj.filter(function(x) { return x.index }).
                               map(function(x) { return [x.name, self.newObj(obj.filter(function(y) { return y.primary })[0].name, 'HASH', x.name, 'RANGE') ] }).
                               reduce(function(x,y) { x[y[0]] = y[1]; return x }, {});
                aws.ddbCreateTable(pool.prefix + table, attrs, keys, idxs, options, function(err, item) {
                    callback(err, item ? [item.Item] : []);
                });
                break;
                
            case "upgrade":
                callback();
                break;
                
            case "get":
                var keys = (options.keys || pool.dbkeys[table] || []).map(function(x) { return [ x, obj[x] ] }).reduce(function(x,y) { x[y[0]] = y[1]; return x }, {});
                aws.ddbGetItem(pool.prefix + table, keys, options, function(err, item) {
                    callback(err, item ? [item.Item] : []);
                });
                break;

            case "all":
                var keys = (options.keys || pool.dbkeys[table] || []).map(function(x) { return [ x, obj[x] ] }).reduce(function(x,y) { x[y[0]] = y[1]; return x }, {});
                aws.ddbQueryTable(pool.prefix + table, keys, options, function(err, item) {
                    callback(err, item ? item.Items : []);
                });
                break;

            case "add":
                // Add only listed columns if there is a .columns property specified
                var o = self.clone(obj, { _skip_cb: function(n,v) { return n[0] == '_' || typeof v == "undefined" || v == null || (options.columns && !(n in options.columns)); } });
                options.expected = (pool.dbkeys[table] || []).map(function(x) { return x }).reduce(function(x,y) { x[y] = null; return x }, {});
                aws.ddbPutItem(pool.prefix + table, o, options, function(err, rc) {
                    callback(err, []);
                });
                break;

            case "put":
                var keys = (options.keys || pool.dbkeys[table] || []).map(function(x) { return [ x, obj[x] ] }).reduce(function(x,y) { x[y[0]] = y[1]; return x }, {});
                // Skip special columns, nulls, primary key columns. If we have specific list of allowed columns only keep those.
                var o = self.clone(obj, { _skip_cb: function(n,v) { return n[0] == '_' || typeof v == "undefined" || v == null || keys[n] || (options.columns && !(n in options.columns)); } });
                options.expected = keys;
                aws.ddbUpdateItem(pool.prefix + table, keys, o, options, function(err, rc) {
                    callback(err, []);
                });
                break;

            case "del":
                aws.ddbDeleteItem(pool.prefix + table, obj, options, function(err, rc) {
                    callback(err, []);
                });
                break;
                
            default:
                callback(new Error("invalid op"))
            }
        }
        return pool;
    },

    // Downloads file using HTTP and pass it to the callback if provided,
    // Callback will be called with the arguments:
    //  first argument is error object if any
    //  second is params object itself with updted fields
    //  third is HTTP response object
    // params can contain the following options:
    //  - method - GET, POST
    //  - headers - object with headers to pass to HTTP request, properties must be all lower case
    //  - nocookies - do not send any saved cookies
    //  - file - file name where to save response, in case of error response the error body will be saved as well
    //  - postdata - data to be sent with the POST method
    // On end, the object params will contains the following updated properties:
    //  - data if file was not specified, data eill contain collected response body as string
    //  - status - HTTP response status code
    //  - mtime - Date object with the last modified time of the requested file
    //  - size - size of the response body or file
    // Note: SIDE EFFECT: params object is modified in place so many options will be changed/removed or added
    httpGet: function(uri, params, callback) {
        var self = this;
        if (typeof params == "function") callback = params, params = null;
        if (!params) params = {};

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
        if (params.cookies && options.hostname) {
            var cookies = this.cookieGet(options.hostname);
            if (cookies.length) {
                options.headers["cookie"] = cookies.map(function(c) { return c.name+"="+c.value; }).join(";");
            }
        }
        if (!options.headers['accept']) {
            options.headers['accept'] = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
        }
        options.headers['accept-language'] = 'en-US,en;q=0.5';
        // Runtime properties
        if (!params.retries) params.retries = 0;
        if (!params.redirects) params.redirects = 0;
        if (!params.httpTimeout) params.httpTimeout = 300000;
        if (!params.ignoreredirect) params.ignoreredirect = {};
        params.size = 0, params.err = null, params.fd = 0, params.status = 0, params.data = '';
        params.href = options.href, params.pathname = options.pathname, params.hostname = options.hostname;
        var req = null;
        var mod = uri.indexOf("https://") == 0 ? https : http;

        req = mod.request(options, function(res) {
          logger.dev("httpGet: started", params)
          res.on("data", function(chunk) {
              logger.dev("httpGet: data", 'size:', chunk.length, '/', params.size, "status:", res.statusCode, 'file:', params.file || '');

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
              if (params.cookies) {
                  self.cookieSave(res.headers["set-cookie"], params.hostname);
              }
              params.headers = res.headers;
              params.status = res.statusCode;
              params.type = (res.headers['content-type'] || '').split(';')[0];
              params.mtime = res.headers.date ? new Date(res.headers.date) : null;
              if (!params.size) params.size = self.toNumber(res.headers['content-length'] || 0);
              if (params.fd) try { fs.closeSync(params.fd); } catch(e) {}
              params.fd = 0;

              logger.debug("httpGet: end", options.method, "url:", uri, "size:", params.size, "status:", params.status, 'type:', params.type, 'location:', res.headers.location || '');

              // Retry the same request
              if (params.retries && (res.statusCode < 200 || res.statusCode >= 400)) {
                  params.retries--;
                  setTimeout(function() { self.httpGet(uri, params, callback); }, params.retryTimeout || 500);
                  return;
              }
              // Redirection
              if (res.statusCode >= 301 && res.statusCode <= 307 && !params.noredirects) {
                  params.redirects += 1;
                  delete params.method;
                  delete params.postdata;
                  if (params.redirects < 10) {
                      var uri2 = res.headers.location;
                      if (uri2.indexOf("://") == -1) {
                          uri2 = options.protocol + "//" + options.host + uri2;
                      }
                      logger.dev('httpGet:', 'redirect', uri2);

                      // Ignore redirects we dont want and return data recieved
                      if (!params.ignoreredirect[uri2]) {
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

        if (options.method == 'POST') {
            req.write(String(params.postdata));
        }
        if (params.httpTimeout) {
            req.setTimeout(params.httpTimeout, function() {
                if (!params.quiet) logger.error("httpGet:", "timeout:", uri, 'file:', params.file || "", 'retries:', params.retries, 'timeout:', params.httpTimeout);
                req.abort();
            });
        }
        req.end();
        return req;
    },

    // Produce signed URL to be used in embeded cases or with expiration so the url can be passed and be valid for longer time.
    // Host passed here must be the actual host where the request will be sent
    signUrl: function(accesskey, secret, host, uri, expires) {
        var hdrs = this.signRequest(accesskey, secret, "GET", host, uri, "", expires);
        return uri + (uri.indexOf("?") == -1 ? "?" : "") + "&v-signature=" + encodeURIComponent(hdrs['v-signature']);
    },

    // Sign HTTP request for the API server:
    // url must include all query parametetrs already encoded and ready to be sent
    // expires is absolute time in milliseconds when this request will expire, default is 30 seconds from now
    // checksum is SHA1 digest of the POST content, optional
    signRequest: function(id, secret, method, host, uri, expires, checksum) {
        var now = Date.now();
        if (!expires) expires = now + 30000;
        if (expires < now) expires += now;
        var q = String(uri || "/").split("?");
        var qpath = q[0];
        var query = (q[1] || "").split("&").sort().filter(function(x) { return x != ""; }).join("&");
        var str = String(method) + "\n" + String(host) + "\n" + String(qpath) + "\n" + String(query) + "\n" + String(expires) + "\n" + String(checksum || "");
        return { 'v-signature': '1;;' + id + ';' + this.sign(String(secret), str) + ';' + expires + ';' + String(checksum || "") + ';;' };
    },

    // Parse incomomg request for signature and return all pieces wrapped in an object, this object
    // will be used by checkSignature function for verification against an account
    parseSignature: function(req) {
        var rc = { version: 1, expires: 0, checksum: "", password: "" };
        // Input parameters, convert to empty string if not present
        rc.url = req.originalUrl || req.url || "/";
        rc.method = req.method || "";
        rc.host = (req.headers.host || "").split(':')[0];
        rc.signature = req.query['v-signature'] || req.headers['v-signature'] || "";
        var d = String(rc.signature).match(/([^;]+);([^;]*);([^;]+);([^;]+);([^;]+);([^;]*);([^;]*);/);
        if (!d) return rc;
        rc.mode = this.toNumber(d[1]);
        rc.version = d[2] || "";
        rc.id = d[3];
        rc.signature = d[4];
        rc.expires = this.toNumber(d[5]);
        rc.checksum = d[6] || "";
        rc.url = req.url.replace(/v-signature=([^& ]+)/g, "");
        return rc;
    },
    
    // Verify signature with given account, signature is an object reurned by parseSignature
    checkSignature: function(sig, account) {
        var q = sig.url.split("?");
        var qpath = q[0];
        var query = (q[1] || "").split("&").sort().filter(function(x) { return x != ""; }).join("&");
        sig.str = sig.method + "\n" + sig.host + "\n" + qpath + "\n" + query + "\n" + sig.expires + "\n" + sig.checksum;
        switch (sig.mode) {
        case 1:
            sig.hash = this.sign(account.secret, sig.str);
            return sig.signature == sig.hash;
            
        case 2:
            // Verify against digest of the account and and secret, this way a client stores not the 
            // actual secret in local storage but sha1 digest to prevent exposing the real password
            sig.hash = this.sign(this.sign(account.secret, account.email), sig.str);
            return sig.signature == sig.hash;
        }
        return false;
    },
    
    // Make a request to the backend endpoint, save data in the queue in case of error, if data specified,
    // POST request is made, if data is an object, it is converted into string.
    // Returns params as in httpGet with .json property assigned with an object from parsed JSON response
    // Special parameters for options:
    // - .proxy - used as a proxy to backend, handles all errors and returns .status and .json to be passed back to API client
    // - .queue - perform queue management, save in queue if cannot send right now, delete from queue if sent
    // - .rowid - unique record id to be used in case of queue management
    // - .data - actual data to be send in POST
    // - .json - send as application/json content type
    // - .checksum - calculate checksum from the data
    sendRequest: function(uri, data, options, callback) {
        var self = this;
        // Nothing to do without credentials
        if (!self.backendHost || !self.backendKey || !self.backendSecret) {
            logger.debug('sendRequest:', 'no backend credentials', uri, options);
            return (callback ? callback(null, { status: 200, message: "", json: { status: 200 } }) : null);
        }

        if (typeof options == "function") callback = options, options = {};
        if (!options) options = {};

        var params = { method: "GET", agent: options.agent };
        var type = "text/plain";

        // Convert data into string
        if (data) {
            if (typeof data == "object") data = JSON.stringify(data), type = "application/json";
            if (typeof data != "string") data = String(data);
        }
        // Make sure our data is not corrupted
        if (options.checksum) {
            params.checksum = data ? this.hash(data) : null;
        }
        // Data can be sent as POST even if it is small
        if (data) {
            params.method = 'POST';
            params.postdata = data;
        }
        uri = self.backendHost + uri;
        var opts = url.parse(uri);
        params.headers = self.signRequest(self.backendKey, self.backendSecret, params.method, opts.hostname, uri, 0, params.checksum);
        params.headers['content-type'] = type;

        self.httpGet(uri, params, function(err, opts, res) {
            // Queue management, insert on failure or delete on success
            if (options.queue) {
                if (params.status == 200) {
                    if (options.rowid) {
                        self.dbQuery({ text: "DELETE FROM backend_queue WHERE rowid=?", values: [options.rowid] }, function(e) { logger.edebug(e, "sendRequest:", uri); });
                    }
                } else {
                    if (!options.rowid) {
                        self.dbQuery({ text: "INSERT INTO backend_queue(url,data,mtime) VALUES(?,?,?)", values: [uri, data, self.mnow()] }, function(e) { logger.edebug(e, "sendRequest:", uri); });
                    } else {
                        self.dbQuery({ text: "UPDATE backend_queue SET count=count+1 WHERE rowid=?", values: [options.rowid] }, function(e) { logger.edebug(e, "sendRequest:", uri); });
                    }
                }
            }
            // If the contents are encrypted, decrypt before processing content type
            if (params.headers['content-encoding'] == "encrypted") {
                params.data = self.decrypt(self.backendSecret, params.data);
            }
            // Parse JSON and store in the params, set error if cannot be parsed, the caller will deal with it
            if (!err && params.data && params.type == "application/json") {
                try {
                    params.json = JSON.parse(params.data);
                } catch(e) {
                    err = e;
                }
            }
            // if we are in proxy mode, we deal with errros and provide nice result to the caller which wil be sent to the API client,
            // in proxy mode there is no error, only JSON result and status, also we copy .id property from the result if any for cases of autogenereated ids
            if (options.proxy) {
                if (err) {
                    params.status = 500;
                    params.json = { status: params.status, message: String(err) };
                } else
                if (params.json) {
                    var json = params.json;
                    if (Array.isArray(json)) json = json[0];
                    if (options.rows) {

                    } else
                    if (options.row) {
                        params.json = json;
                    } else {
                        params.json = { status: params.status, message: json.message || "", id: json.id || "" };
                    }
                } else {
                    params.json = { status: params.status, message: "" };
                }
            }
            if (callback) callback(err, params, res);
        });
    },

    // Send all pending updates from the queue table
    processQueue: function(callback) {
        var self = this;

        self.dbQuery("SELECT rowid,url,data FROM backend_queue WHERE count<10 ORDER BY mtime", function(err, rows) {
            async.forEachSeries(rows, function(row, next) {
                self.sendRequest(row.url, row.data, { queue: true, rowid: row.rowid }, function(err2) {
                    next();
                });
            }, function(err3) {
                if (rows.length) logger.log('processQueue:', 'sent', rows.length);
                if (callback) callback();
            });
        });
    },


    // Return argument value by name
    getArg: function(name, dflt, argv) {
        argv = argv || this.argv;
        var idx = argv.indexOf(name);
        return idx > -1 && idx + 1 < argv.length ? argv[idx + 1] : (typeof dflt == "undefined" ? "" : dflt);
    },

    getArgFlag: function(name, dflt) {
        return this.argv.indexOf(name) > -1 ? true : (typeof dflt != "undefined" ? dflt : false);
    },

    getArgInt: function(name, dflt) {
        return this.toNumber(this.getArg(name, dflt));
    },

    // Send email
    sendmail: function(from, to, subject, text, callback) {
        var server = emailjs.server.connect();
        server.send({ text: text || '', from: from, to: to + ",", subject: subject || ''}, function(err, message) {
             if (err) logger.error('sendmail:', err);
             if (message) logger.debug('sendmail:', message);
             if (callback) callback(err);
         });
    },

    // Call callback for each line in the file
    // options may specify the following parameters:
    // - sync - read file synchorously and call callback for every line
    // - abort - signal to stop processing
    // - limit - number of lines to process and exit
    // - progress - if > 0 report how many lines processed so far evert specified lines
    // - until - skip lines until this regexp matches
    forEachLine: function(file, options, lineCallback, endCallback) {
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
    },

    // Encrypt data with the given key code
    encrypt: function(key, data, algorithm) {
        if (!key || !data) return '';
        var encrypt = crypto.createCipher(algorithm || 'aes192', key);
        var b64 = encrypt.update(String(data), 'utf8', 'base64');
        try { b64 += encrypt.final('base64'); } catch(e) { hex = ''; logger.error('encrypt:', e); }
        return b64;
    },

    // Decrypt data with the given key code
    decrypt: function(key, data, algorithm) {
        if (!key || !data) return '';
        var decrypt = crypto.createDecipher(algorithm || 'aes192', key);
        var msg = decrypt.update(String(data), 'base64', 'utf8');
        try { msg += decrypt.final('utf8'); } catch(e) { msg = ''; logger.error('decrypt:', e); }
        return msg;
    },

    // HMAC signing and base64 encoded, default algorithm is sha1
    sign: function (key, data, algorithm, encode) {
        return crypto.createHmac(algorithm ? algorithm : "sha1", key).update(String(data), "utf8").digest(encode ? encode : "base64");
    },

    // Hash and base64 encoded, default algorithm is sha1
    hash: function (data, algorithm, encode) {
        return crypto.createHash(algorithm ? algorithm : "sha1").update(String(data), "utf8").digest(encode ? encode : "base64");
    },

    // Generate random key, size if specified defines how many random bits to generate
    random: function(size) {
        return this.sign(crypto.randomBytes(64), crypto.randomBytes(size || 256), 'sha256').replace(/[=+%]/g, '');
    },

    // Return random integer between min and max inclusive
    randomInt: function(min, max) {
        return min + (0 | Math.random() * (max - min + 1));
    },

    // Inherits prototype methods from one object to another
    inherits: function(target, source) {
        for (var k in source.prototype)
          target.prototype[k] = source.prototype[k];
    },

    // Return number of seconds for current time
    now: function() {
        return Math.round((new Date()).getTime()/1000);
    },

    // Shortcut for current time in milliseconds
    mnow: function() {
        return (new Date()).getTime();
    },

    // Format date object
    strftime: function(date, fmt, utc) {
        if (typeof date == "string") try { date = new Date(date); } catch(e) {}
        if (!date || isNaN(date)) return "";
        function zeropad(n) { return n > 9 ? n : '0' + n; }
        var handlers = {
            a : function(t) { return [ 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat' ][utc ? t.getUTCDay() : t.getDay()] },
            A : function(t) { return [ 'Sunday', 'Monday', 'Tuedsay', 'Wednesday', 'Thursday', 'Friday', 'Saturday' ][utc ? t.getUTCDay() : t.getDay()] },
            b : function(t) { return [ 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec' ][utc ? t.getUTCMonth() : t.getMonth()] },
            B : function(t) { return [ 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December' ][utc ? t.getUTCMonth() : t.getMonth()] },
            c : function(t) { return utc ? t.toUTCString() : t.toString() },
            d : function(t) { return zeropad(utc ? t.getUTCDate() : t.getDate()) },
            H : function(t) { return zeropad(utc ? t.getUTCHours() : t.getHours()) },
            I : function(t) { return zeropad(((utc ? t.getUTCHours() : t.getHours()) + 12) % 12) },
            m : function(t) { return zeropad((utc ? t.getUTCMonth() : t.getMonth()) + 1) }, // month-1
            M : function(t) { return zeropad(utc ? t.getUTCMinutes() : t.getMinutes()) },
            p : function(t) { return this.H(t) < 12 ? 'AM' : 'PM'; },
            S : function(t) { return zeropad(utc ? t.getUTCSeconds() : t.getSeconds()) },
            w : function(t) { return utc ? t.getUTCDay() : t.getDay() }, // 0..6 == sun..sat
            W : function(t) { var d = new Date(t.getFullYear(), 0, 1); return Math.ceil((((t - d) / 86400000) + d.getDay() + 1) / 7); },
            y : function(t) { return zeropad(this.Y(t) % 100); },
            Y : function(t) { return utc ? t.getUTCFullYear() : t.getFullYear() },
            t : function(t) { return t.getTime() },
            u : function(t) { return Math.floor(t.getTime()/1000) },
            '%' : function(t) { return '%' },
        };
        for (var h in handlers) {
            fmt = fmt.replace('%' + h, handlers[h](date));
        }
        return fmt;
    },

    // Split string into array, ignore empty items
    strSplit: function(str, sep) {
        if (!str) return [];
        return (Array.isArray(str) ? str : String(str).split(sep || ',')).map(function(x) { return x.trim() }).filter(function(x) { return x != '' });
    },

    // Split as above but keep only unique items
    strSplitUnique: function(str, sep) {
        var rc = [];
        this.strSplit(str, sep).forEach(function(x) { if (!rc.some(function(y) { return x.toLowerCase() == y.toLowerCase() })) rc.push(x)});
        return rc;
    },

    // Copy file and then remove the source, do not overwrite existing file
    moveFile: function(src, dst, overwrite, callback) {
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
            if (!err && !overwrite) return cb(new Error("File " + dst + " exists."));
            fs.rename(src, dst, copyIfFailed);
        });
    },

    // Copy file, overwrite is optional flag, by default do not overwrite
    copyFile: function(src, dst, overwrite, callback) {
        if (typeof overwrite == "function") callback = overwrite, overwrite = false;

        function copy(err) {
            var ist, ost;
            if (!err && !overwrite) return (callback ? callback(new Error("File " + dst + " exists.")) : null);
            fs.stat(src, function (err2) {
                if (err2) return (callback ? callback(err2) : null);
                ist = fs.createReadStream(src);
                ost = fs.createWriteStream(dst);
                util.pump(ist, ost, callback);
            });
        }
        logger.debug('copyFile:', src, dst, overwrite);
        fs.stat(dst, copy);
    },

    // Run theprocess and return all output to the callback
    runProcess: function(cmd, callback) {
        exec(cmd, function (err, stdout, stderr) {
            if (err) logger.error('getProcessOutput:', cmd, err);
            if (callback) callback(stdout, stderr);
        });
    },

    // Kill all backend processes that match name and not the current process
    killBackend: function(name, callback) {
        var self = this;
        self.runProcess("ps agx", function(stdout) {
            stdout.split("\n").
                   filter(function(x) { return x.match("backend:") && (!name || x.match(name)); }).
                   map(function(x) { return self.toNumber(x) }).
                   filter(function(x) { return x != process.pid }).
                   forEach(function(x) { process.kill(x) });
            if (callback) callback();
        });
    },

    // Shutdown the machine now
    shutdown: function() {
        exec("/sbin/halt", function(err, stdout, stderr) {
            logger.log('shutdown:', stdout || "", stderr || "", err || "");
        });
    },

    // Non-exception version, returns empty object,
    // mtime is 0 in case file does not exist or number of seconds of last modified time
    // mdate is a Date object with last modified time
    statSync: function(file) {
        var stat = { size: 0, mtime: 0, mdate: "", isFile: function() {return false}, isDirectory: function() {return false} }
        try {
            stat = fs.statSync(file);
            stat.mdate = stat.mtime.toISOString();
            stat.mtime = stat.mtime.getTime()/1000;
        } catch(e) {
            if (e.code != "ENOENT") logger.error('statSync:', e);
        }
        return stat;
    },

    // Return list of files than match filter recursively starting with given path
    findFileSync: function(file, filter) {
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
    },

    // Recursively create all directries, return 1 if created
    makePathSync: function(dir) {
        var list = path.normalize(dir).split("/");
        for (var i = 0, dir = ''; i < list.length; i++) {
            dir += list[i] + '/';
            try {
                if (!fs.existsSync(dir)) fs.mkdirSync(dir);
            }
            catch(e) {
                logger.error('makePath:', e)
                return 0;
            }
        }
        return 1;
    },

    // Async version, stops on first error
    makePath: function(dir, callback) {
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
    },

    // Change file owner do not report errors about non existent files
    chownSync: function(file) {
        try {
            fs.chownSync(file, this.uid, this.gid);
        } catch(e) {
            if (e.code != 'ENOENT') logger.error('chownSync:', this.uid, this.gid, file, e);
        }
    },

    // Create a directory if does not exist
    mkdirSync: function(dir) {
        if (!fs.existsSync(dir)) {
            try { fs.mkdirSync(dir) } catch(e) { logger.error('mkdirSync:', dir, e) }
        }
    },
    
    // Drop root privileges and switch to regular user
    dropPrivileges: function() {
        if (process.getuid() == 0) {
            logger.debug('init: switching to', core.uid, core.gid);
            try { process.setgid(core.gid); } catch(e) { logger.error('setgid:', core.gid, e); }
            try { process.setuid(core.uid); } catch(e) { logger.error('setuid:', core.uid, e); }
        }
    },

    // Set or reset a timer
    setTimeout: function(name, callback, timeout) {
        if (this.timers[name]) clearTimeout(this.timers[name]);
        this.timers[name] = setTimeout(callback, timeout);    
    },
    
    // Full path to the icon, perform necessary hashing and sharding, id can be a number or any string
    iconPath: function(id, prefix, type, ext) {
        // Convert into string and remove all chars except numbers, this will support UUIDs as well as regulat integers
        id = String(id).replace(/[^0-9]/g, '');
        return path.join(this.path.images, prefix || "", id.substr(-2), id.substr(-4, 2), (type ? String(type)[0] : "") + id + "." + (ext || "jpg"));
    },

    // Download image and convert into JPG, store under core.path.images
    // Options may be controlled using the properties:
    // - force - force rescaling for all types even if already exists
    // - types - which icons needs to be created
    // - prefix - where to store all scaled icons
    // - verify - check if the original icon is the same as at the source
    getIcon: function(uri, id, options, callback) {
        var self = this;

        if (typeof options == "function") callback = options, options = null;
        if (!options) options = {};
        logger.debug('getIcon:', uri, options);

        if (!uri || !id) return (callback ? callback(new Error("wrong args")) : null);

        // Verify image size and skip download if the same
        if (options.verify) {
            var imgfile = this.iconPath(id, options.prefix, options.type, options.ext);
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
    },

    // Put original or just downloaded file in the proper location according to the types for given id,
    // this function is used after downloading new image or when moving images from other places
    // Rescale all required icons by setting force to true in the options
    // Valid properties in the options:
    // - type - icon type, this will be prepended to the name of the icon
    // - prefix - top level subdirectory under images/
    // - force - to rescale even if it already exists
    // - width, height, filter, ext, quality for backend.resizeImage function
    putIcon: function(file, id, options, callback) {
        var self = this;
        if (typeof options == "function") callback = options, options = null;
        if (!options) options = {};
        if (!callback) callback = function() {};
        logger.debug('putIcon:', id, file, options);

        var image = self.iconPath(id, options.prefix, options.type, options.ext);
        fs.exists(image, function(yes) {
            // Exists and we do not need to rescale
            if (yes && !options.force) return callback();
            // Make new scaled icon
            self.scaleIcon(file, image, options, function(err) {
                logger.edebug(err, "putIcon:", id, file, options);
                callback(err);
            });
        });
    },

    // Return list of all existing icons by type, if any icon does not exist the corresponding item in the list will be empty
    listIcon: function(id, options, callback) {
        var self = this;
        if (typeof options == "function") callback = options, options = null;
        if (!options) options = {};

        var files = [];
        async.forEachSeries(options.types || [''], function(type, next) {
            var image = self.iconPath(id, options.prefix, type, options.ext);
            fs.stat(image, function(err, st) {
                if (err) st = { mtime : new Date("1970-08-09") };
                st.file = image;
                st.type = type;
                files.push(st);
                next();
            });
        }, function() {
            files.sort(function(a,b) { return !a.type ? -1 : !b.type ? 1 : a.mtime.getTime() - b.mtime.getTime() });
            callback(files);
        })
    },
    
    // Scale image using ImageMagick into a file, return err if failed
    scaleIcon: function(infile, outfile, options, callback) {
        if (typeof options == "function") callback = options, options = {};
        if (!options) options = {};
        backend.resizeImage(infile, options.width || 0, options.height || 0, options.ext || "jpg", options.filter || "lanczos", options.quality || 99, outfile, function(err2) {
            logger.edebug(err2, 'scaleIcon:', typeof infile == "object" ? infile.length : infile, outfile, w, h, fmt, quality, stats);
            if (callback) callback(err2);
        });
    },

    // Return object type, try to detect any distinguished type
    typeName: function(v) {
        var t = typeof(v);
        if (v === null) return "null";
        if (t !== "object") return t;
        if (Array.isArray(v)) return "array";
        if (Buffer.isBuffer(v)) return "buffer";
        if (v.constructor == (new Date).constructor) return "date";
        if (v.constructor == (new RegExp).constructor) return "regex";
        return "object";
    },

    // Deep copy of an object,
    // - filter is an object to skip properties that defined in it by name, 
    //   if filter's value is boolean, skip, if integer then skip if greater in length for string properties
    //   - _skip_null tells to skip all null properties
    //   - _skip_cb - a callback that returns true to skip a property, argumnets are property name and value
    // - props can be used to add additional properties to the new object
    clone: function(obj, filter, props) {
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
        default:
            return obj;
        }
        if (!filter) filter = {};
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
            rc[p] = this.clone(obj[p], filter);
        }
        for (var p in props) rc[p] = props[p];
        return rc;
    },

    // JSON stringify without empty properties
    stringify: function(obj) {
        return JSON.stringify(this.clone(obj, { _skip_null: 1, _skip_cb: function(n,v) { return v == "" } }));
    },
    
    // Return new object using arguments as name value pairs for new object properties
    newObj: function() {
        var obj = {};
        for (var i = 0; i < arguments.length - 1; i += 2) obj[arguments[i]] = arguments[i + 1];
        return obj;
    },

    // Add properties to existing object, first arg is the object, the rest are pairs: name, value,....
    addObj: function() {
        if (typeof arguments[0] != "object") return;
        for (var i = 1; i < arguments.length - 1; i += 2) arguments[0][arguments[i]] = arguments[i + 1];
        return arguments[0];
    },
    
    // Delete properties from the object, first arg is an object, the rest are properties to be deleted
    delObj: function() {
        if (typeof arguments[0] != "object") return;
        for (var i = 1; i < arguments.length; i++) delete arguments[0][arguments[i]];
        return arguments[0];
    },

    // Parse one cookie
    cookieParse: function(str) {
        var parts = str.split(";");
        var pair = parts[0].match(/([^=]+)=((?:.|\n)*)/);
        if (!pair) return null;
        var obj = { name: pair[1], value: pair[2], path: "", domain: "", secure: false, expires: Infinity };

        for (var i = 1; i < parts.length; i++) {
            pair = parts[i].match(/([^=]+)(?:=((?:.|\n)*))?/);
            if (!pair) continue;
            var key = pair[1].trim().toLowerCase();
            var value = pair[2];
            switch(key) {
            case "expires":
                obj.expires = value ? Number(Date.parse(value)) : Infinity;
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
        logger.dev("cookieParse:", obj)
        return obj;
    },

    // Return cookies that match request
    cookieGet: function(domain) {
        var list = [];
        for (var i in this.cookiejar.cookies) {
            var cookie = this.cookiejar.cookies[i];
            if (cookie.expires <= Date.now()) continue;
            if (cookie.domain == domain) {
                list.push(cookie);
            } else
            if (cookie.domain.charAt(0) == "." && (cookie.domain.substr(1) == domain || domain.match(cookie.domain.replace(/\./g,'\\.') + '$'))) {
                list.push(cookie);
            }
        }
        logger.dev('cookieGet:', domain, list)
        return list;
    },

    // Load cookies into memory
    cookieLoad: function(callback) {
        var self = this;
        self.cookiejar.cookies = [];
        this.dbQuery("SELECT * FROM backend_cookies", function(err, rows) {
            logger.edebug(err, 'cookieLoad:', (rows || []).length, 'records');
            self.cookiejar.cookies = rows || [];
            self.cookiejar.changed = false;
            if (callback) callback(err);
        });
    },

    // Save cookies in the jar
    cookieSave: function(cookies, hostname) {
        var self = this;
        cookies = !cookies ? [] : Array.isArray(cookies) ? cookies : cookies.split(/[:](?=\s*[a-zA-Z0-9_\-]+\s*[=])/g);
        for (var i in cookies) {
            var obj = this.cookieParse(cookies[i]);
            if (!obj.domain) obj.domain = hostname || "";
            if (!obj) continue;
            var found = false;
            for (var j = 0; j < this.cookiejar.cookies.length; j++) {
                var cookie = this.cookiejar.cookies[j];
                if (cookie.path == obj.path && cookie.domain == obj.domain && cookie.name == obj.name) {
                    if (obj.expires <= Date.now()) {
                        delete cookie;
                        logger.dev('cookieSet: delete', obj)
                    } else {
                        this.cookiejar.cookies[j] = obj;
                        logger.dev('cookieSet: replace', obj)
                    }
                    this.cookiejar.changed = true;
                    found = true;
                    break;
                }
            }
            if (!found) {
                this.cookiejar.changed = true;
                this.cookiejar.cookies.push(obj);
                logger.dev('cookieSet: add', obj)
            }
        }
        if (this.cookiejar.changed) {
            for (var i in this.cookiejar.cookies) {
                var cookie = this.cookiejar.cookies[i];
                self.dbQuery({ text: "REPLACE INTO backend_cookies VALUES(?,?,?,?,?,?)", values: [cookie.name, cookie.value, cookie.domain, cookie.path, cookie.expires, cookie.secure] }, function(err) {
                    if (err) logger.error('cookieSave:', err);
                });
            }
            logger.dev('cookieSave:', 'saved', this.cookiejar.cookies.length, 'cookies')
        }
    },

    // Adds reference to the object in the core for further access
    addContext: function(name, obj) {
        this.context[name] = obj;
    },

    // Start command prompt on TCP socket, context can be an object with properties assigned with additional object to be accessible in the shell
    startRepl: function(port, bind) {
        var self = this;
        var server = net.createServer(function(socket) {
            self.repl = self.createRepl({ prompt: '> ', input: socket, output: socket, terminal: true, useGlobal: false });
            self.repl.on('exit', function() { socket.end(); })
            self.repl.context.socket = socket;
        });
        server.on('error', function(err) {
           logger.error('startRepl:', err);
        });
        server.listen(port, bind || '0.0.0.0');
        logger.debug('startRepl:', 'port:', port, 'bind:', bind || '0.0.0.0');
    },

    // Create REPL intrface with all modules available
    createRepl: function(options) {
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
    },

    // Watch temp files and remove files that are older than given number of seconds since now, remove only files that match pattern if given
    // This function is not async-safe, it uses sync calls
    watchTmp: function(dirs, secs, pattern) {
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
    },

    // Watch files in a dir for changes and call the callback
    watchFiles: function(dir, pattern, callback) {
        logger.debug('watchFiles:', dir, pattern);
        fs.readdirSync(dir).filter(function(file) { 
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
    },
    
    // Watch log files for errors and report via email
    watchLogs: function(callback) {
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

        // Load all previous positions for every log file, we start parsing file from the previous last stop
        self.dbQuery("SELECT * FROM backend_property WHERE name LIKE 'logwatcher:%'", function(err, rows) {
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
                           self.dbQuery({ text: "REPLACE INTO backend_property VALUES(?,?,?)", values: ['logwatcher:' + file, st.size, self.logwatcherMtime.toISOString()] }, function(e) {
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
    },

}

module.exports = core;
