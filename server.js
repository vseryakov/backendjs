//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var net = require('net');
var cluster = require('cluster');
var domain = require('domain');
var path = require('path');
var util = require('util');
var url = require('url');
var fs = require('fs');
var spawn = require('child_process').spawn;
var exec = require('child_process').exec;
var core = require(__dirname + '/core');
var lib = require(__dirname + '/lib');
var logger = require(__dirname + '/logger');
var db = require(__dirname + '/db');
var aws = require(__dirname + '/aws');
var ipc = require(__dirname + '/ipc');
var api = require(__dirname + '/api');
var jobs = require(__dirname + '/jobs');
var os = require('os');
var express = require('express');
var stream = require('stream');
var proxy = require('http-proxy');

// The main server class that starts various processes
var server = {
    // Config parameters
    args: [{ name: "max-processes", type: "callback", callback: function(v) { this.maxProcesses=lib.toNumber(v,{float:0,dflt:0,min:0,max:core.maxCPUs}); if(this.maxProcesses<=0) this.maxProcesses=Math.max(1,core.maxCPUs-1); this._name="maxProcesses" }, descr: "Max number of processes to launch for Web servers, 0 means NumberofCPUs-2" },
           { name: "max-workers", type: "number", min: 1, max: 32, descr: "Max number of worker processes to launch" },
           { name: "crash-delay", type: "number", max: 30000, obj: "crash", descr: "Delay between respawing the crashed process" },
           { name: "restart-delay", type: "number", max: 30000, descr: "Delay between respawning the server after changes" },
           { name: "log-errors" ,type: "bool", descr: "If true, log crash errors from child processes by the logger, otherwise write to the daemon err-file. The reason for this is that the logger puts everything into one line thus breaking formatting for stack traces." },
           { name: "proxy-reverse", type: "url", descr: "A Web server where to proxy requests not macthed by the url patterns or host header, in the form: http://host[:port]" },
           { name: "proxy-url-(.+)", type: "regexpobj", reverse: 1, obj: 'proxy-url', lcase: ".+", descr: "URL regexp to be passed to other web server running behind, each parameter defines an url regexp and the destination in the value in the form http://host[:port], example: -server-proxy-url-^/api http://127.0.0.1:8080" },
           { name: "proxy-host-(.+)", type: "regexpobj", reverse: 1, obj: 'proxy-host', lcase: ".+", descr: "Virtual host mapping, to match any Host: header, each parameter defines a host name and the destination in the value in the form http://host[:port], example: -server-proxy-host-www.myhost.com http://127.0.0.1:8080" },
           { name: "process-name", descr: "Path to the command to spawn by the monitor instead of node, for external processes guarded by this monitor" },
           { name: "process-args", type: "list", descr: "Arguments for spawned processes, for passing v8 options or other flags in case of external processes" },
           { name: "worker-args", type: "list", descr: "Node arguments for workers, job and web processes, for passing v8 options" },
    ],

    // Watcher process status
    child: null,
    // Aditional processes to kill on exit
    pids: {},
    exiting: false,
    // Delay (ms) before restarting the server
    restartDelay: 1000,
    // Redefined in case of log file
    stdout: null,
    stderr: null,

    // Crash throttling
    crash: { interval: 3000, timeout: 2000, delay: 30000, count: 4, time: null, events: 0 },

    // Number of workers or web servers to launch
    maxWorkers: 1,
    maxProcesses: 1,

    // Options for v8
    processArgs: [],
    workerArgs: [],

    // Proxy target
    proxyUrl: {},
    proxyHost: null,
    proxyWorkers: [],
};

module.exports = server;

// Start the server process, call the callback to perform some initialization before launchng any server, just after core.init
server.start = function()
{
    var self = this;

    // Mark the time we started for calculating idle times properly
    jobs.time = Date.now();
    process.title = core.name + ": process";
    logger.debug("start:", process.argv);

    // REPL shell
    if (lib.isArg("-shell")) {
        var shell = require(__dirname + "/shell");
        core.addModule("shell", shell);
        return core.init({ role: "shell" }, function(err, opts) { shell.run(opts); });
    }

    // Go to background
    if (lib.isArg("-daemon")) {
        return core.init({ role: "daemon", noWatch: 1, noDb: 1, noDns: 1, noConfigure: 1 }, function(err, opts) { self.startDaemon(opts); });
    }

    // Graceful shutdown, kill all children processes
    process.once('exit', function() { self.onexit()  });
    process.once('SIGTERM', function() { self.onkill(); });
    // Reserved for restarting purposes
    process.on('SIGUSR2', function() {});

    // Watch monitor for modified source files, for development mode only, in production -monitor is used
    if (lib.isArg("-watch")) {
        return core.init({ role: "watcher", noDb: 1, noDns: 1, noConfigure: 1 }, function(err, opts) {
            self.startWatcher(opts);
        });
    }

    // Start server monitor, it will watch the process and restart automatically
    if (lib.isArg("-monitor")) {
        return core.init({ role: "monitor", noDb: 1, noDns: 1, noConfigure: 1 }, function(err, opts) {
            self.startMonitor(opts);
        });
    }

    // Master server, always create tables in the masters processes but only for the primary db pools
    if (lib.isArg("-master")) {
        return core.init({ role: "master", localMode: cluster.isMaster, noInitTables: cluster.isWorker ? /.+/ : null }, function(err, opts) {
            self.startMaster(opts);
        });
    }

    // Backend Web server, the server makes table for all configured pools
    if (lib.isArg("-web")) {
        return core.init({ role: "web", noInitTables: cluster.isWorker ? /.+/ : null }, function(err, opts) {
            self.startWeb(opts);
        });
    }
    logger.error("start:", "no server mode specified, need one of the -web, -master, -shell");
}

// Start process monitor, running as root
server.startMonitor = function(options)
{
    var self = this;

    process.title = core.name + ': monitor';
    core.role = 'monitor';
    this.writePidfile();
    // Be careful about adding functionality to the monitor, it is supposed to just watch the process and restart it
    core.runMethods("configureMonitor", options, function() {
        self.startProcess();
    });
}

// Setup worker environment
server.startMaster = function(options)
{
    var self = this;

    if (cluster.isMaster) {
        core.role = 'master';
        process.title = core.name + ': master';

        // Start other master processes
        if (!core.noWeb) this.startWebProcess();

        var d = domain.create();
        d.on('error', function(err) { logger.error('master:', lib.traceError(err)); });
        d.run(function() {
            self.writePidfile();

            // REPL command prompt over TCP
            if (core.repl.port) self.startRepl(core.repl.port, core.repl.bind);

            // Log watcher job, always runs even if no email configured, if enabled it will
            // start sending only new errors and not from the past
            self.watchInterval = setInterval(function() { core.watchLogs(); }, core.logwatcherInterval * 60000);

            // Watch temp files
            setInterval(function() { core.watchTmp("tmp", { seconds: 86400 }) }, 43200000);
            setInterval(function() { core.watchTmp("log", { seconds: 86400*7, ignore: path.basename(core.errFile) + "|" + path.basename(core.logFile) }); }, 86400000);

            // Initialize modules that need to run in the master
            core.runMethods("configureMaster", options, function() {
                logger.log('startMaster:', 'version:', core.version, 'home:', core.home, 'port:', core.port, 'uid:', process.getuid(), 'gid:', process.getgid(), 'pid:', process.pid);
            });
        });
    } else {
        core.dropPrivileges();
        this.startWorker();
    }
}

// Job worker process
server.startWorker = function(options)
{
    var self = this;
    core.role = 'worker';
    process.title = core.name + ': worker';

    // REPL command prompt over TCP
    if (core.repl.portWorker) self.startRepl(core.repl.portWorker + lib.toNumber(cluster.worker.id), core.repl.bindWorker);

    core.runMethods("configureWorker", options, function() {
        logger.log('startWorker:', 'id:', cluster.worker.id, 'version:', core.version, 'home:', core.home, 'uid:', process.getuid(), 'gid:', process.getgid(), 'pid:', process.pid);
    });
}

// Create Express server, setup worker environment, call supplied callback to set initial environment
server.startWeb = function(options)
{
    var self = this;

    process.on("uncaughtException", function(err) {
        logger.error('fatal:', core.role, lib.traceError(err));
        self.onkill();
    });

    if (cluster.isMaster) {
        core.role = 'server';
        process.title = core.name + ': server';

        var d = domain.create();
        d.on('error', function(err) { logger.error(core.role + ':', lib.traceError(err)); });
        d.run(function() {
            // Setup IPC communication
            ipc.initServer();

            // REPL command prompt over TCP
            if (core.repl.portWeb) self.startRepl(core.repl.portWeb, core.repl.bindWeb);

            // In proxy mode we maintain continious sequence of ports for each worker starting with core.proxy.port
            if (core.proxy.port) {
                ipc.on('api:ready', function(msg, worker) {
                    logger.info("api:ready:", msg, self.proxyWorkers);
                    for (var i = 0; i < self.proxyWorkers.length; i++) {
                        if (self.proxyWorkers[i].id == msg.id) return self.proxyWorkers[i] = msg;
                    }
                    logger.error("api:ready:", msg, self.proxyWorkers);
                });
                ipc.on('api:shutdown', function(msg, worker) {
                    logger.info("api:shutdown:", msg, self.proxyWorkers);
                    for (var i = 0; i < self.proxyWorkers.length; i++) {
                        if (self.proxyWorkers[i].id == msg.id) self.proxyWorkers[i].ready = false;
                    }
                });
                ipc.on("cluster:exit", function(msg) {
                    logger.info("cluster:exit:", msg, self.proxyWorkers);
                    for (var i = 0; i < self.proxyWorkers.length; i++) {
                        if (self.proxyWorkers[i].id == msg.id) return self.proxyWorkers.splice(i, 1);
                    }
                    logger.error("cluster:exit:", msg, self.proxyWorkers);
                });
                self.proxyServer = proxy.createServer();
                self.proxyServer.on("error", function(err, req) { if (err.code != "ECONNRESET") logger.error("proxy:", req.target || '', req.url, lib.traceError(err)) })
                self.server = core.createServer({ name: "http", port: core.port, bind: core.bind, restart: "web" }, function(req, res) {
                    self.handleProxyRequest(req, res, 0);
                });
                if (core.proxy.ssl && (core.ssl.key || core.ssl.pfx)) {
                    self.sslServer = core.createServer({ name: "https", ssl: core.ssl, port: core.ssl.port, bind: core.ssl.bind, restart: "web" }, function(req, res) {
                        self.handleProxyRequest(req, res, 1);
                    });
                }
                if (core.ws.port) {
                    self.server.on('upgrade', function(req, socket, head) {
                        var target = self.getProxyTarget(req);
                        if (target) return self.proxyServer.ws(req, socket, head, target);
                        req.close();
                    });
                    if (self.sslServer) {
                        self.sslServer.on('upgrade', function(req, socket, head) {
                            var target = self.getProxyTarget(req);
                            if (target) return self.proxyServer.ws(req, socket, head, target);
                            req.close();
                        });
                    }
                }
                self.clusterFork = function() {
                    var port = self.getProxyPort();
                    var worker = cluster.fork({ BKJS_PORT: port });
                    self.proxyWorkers.push({ id: worker.id, port: port });
                }
            } else {
                self.clusterFork = function() { return cluster.fork(); }
            }

            // Restart if any worker dies, keep the worker pool alive
            cluster.on("exit", function(worker, code, signal) {
                var nworkers = Object.keys(cluster.workers).length;
                logger.log('startWeb:', core.role, 'process terminated:', worker.id, 'pid:', worker.process.pid || "", "code:", code || "", 'signal:', signal || "", "workers:", nworkers);
                // Exit when all workers are terminated
                if (self.exiting && !nworkers) process.exit(0);
                self.respawn(function() {
                    self.clusterFork();
                });
            });

            // Graceful shutdown if the server needs restart
            self.onkill = function() {
                self.exiting = true;
                setTimeout(function() { process.exit(0); }, 30000);
                logger.log('web server: shutdown started');
                for (var p in cluster.workers) try { process.kill(cluster.workers[p].process.pid); } catch(e) {}
            }

            // Graceful restart of all web workers
            process.on('SIGUSR2', function() {
                ipc.sendMsg("api:restart");
            });

            // Arguments passed to the v8 engine
            if (self.workerArgs.length) process.execArgv = self.workerArgs;

            // Create tables and spawn Web workers
            db.initTables(options, function(err) {
                for (var i = 0; i < self.maxProcesses; i++) self.clusterFork();
            });

            self.writePidfile();

            // Web server related initialization, not much functionality is expected in this process
            // regardless if it is a proxy or not, it supposed to pass messages between the web workers
            // and keep the cache
            core.runMethods("configureServer", options, function() {
                logger.log('startWeb:', core.role, 'version:', core.version, 'home:', core.home, 'port:', core.port, 'uid:', process.getuid(), 'gid:', process.getgid(), 'pid:', process.pid)
            });
        });
    } else {
        core.role = 'web';
        process.title = core.name + ": web";

        // Port to listen in case of reverse proxy configuration, all other ports become offsets from the base
        if (core.proxy.port) {
            core.bind = process.env.BKJS_BIND || core.proxy.bind;
            core.port = lib.toNumber(process.env.BKJS_PORT || core.proxy.port);
            if (core.ssl.port) core.ssl.port = core.port + 100;
            if (core.ws.port) core.ws.port = core.port + 200;
        }

        // REPL command prompt over TCP
        if (core.repl.portWeb) self.startRepl(core.repl.portWeb + 1 + lib.toNumber(cluster.worker.id), core.repl.bindWeb);

        // Setup IPC communication
        ipc.initWorker();

        // Init API environment
        api.init(options, function(err) {
            core.dropPrivileges();

            // Gracefull termination of the process
            self.onkill = function() {
                self.exiting = true;
                api.shutdown(function() {
                    process.exit(0);
                });
            }
        });

        logger.log('startWeb:', core.role, 'id:', cluster.worker.id, 'version:', core.version, 'home:', core.home, 'port:', core.port, core.bind, 'repl:', core.repl.portWeb, 'uid:', process.getuid(), 'gid:', process.getgid(), 'pid:', process.pid);
    }
}

// Spawn web server from the master as a separate master with web workers, it is used when web and master processes are running on the same server
server.startWebProcess = function()
{
    var self = this;
    var child = this.spawnProcess([ "-web" ], [ "-master", "-proxy" ], { stdio: 'inherit' });
    this.handleChildProcess(child, "web", "startWebProcess");
}

// Setup exit listener on the child process and restart it
server.handleChildProcess = function(child, type, method)
{
    var self = this;
    self.pids[child.pid] = 1;
    child.on('exit', function (code, signal) {
        delete self.pids[this.pid];
        logger.log('handleChildProcess:', core.role, 'process terminated:', type, 'pid:', this.pid, 'code:', code, 'signal:', signal);
        // Make sure all web servers are down before restating to avoid EADDRINUSE error condition
        core.killBackend(type, "SIGKILL", function() {
            self.respawn(function() { self[method](); });
        });
    });
    child.unref();
}

// Restart the main process with the same arguments and setup as a monitor for the spawn child
server.startProcess = function()
{
    var self = this;
    self.child = this.spawnProcess();
    // Pass child output to the console
    self.child.stdout.on('data', function(data) {
        if (self.logErrors) logger.log(data); else util.print(data);
    });
    self.child.stderr.on('data', function(data) {
        if (self.logErrors) logger.error(data); else util.print(data);
    });
    // Restart if dies or exits
    self.child.on('exit', function(code, signal) {
        logger.log('startProcess:', core.role, 'process terminated:', 'pid:', self.child.pid, 'code:', code, 'signal:', signal);
        core.killBackend("", "", function() {
            self.respawn(function() {
                self.startProcess();
            });
        });
    });
    process.stdin.pipe(self.child.stdin);
    logger.log('startProcess:', core.role, 'version:', core.version, 'home:', core.home, 'port:', core.port, 'uid:', process.getuid(), 'gid:', process.getgid(), 'pid:', process.pid);
}

// Watch source files for modifications and restart
server.startWatcher = function()
{
    var self = this;
    core.role = 'watcher';
    process.title = core.name + ": watcher";

    // REPL command prompt over TCP instead of the master process
    if (core.repl.port && !lib.isArg("-master")) self.startRepl(core.repl.port, core.repl.bind);

    if (core.watchdirs.indexOf(__dirname) == -1) core.watchdirs.push(__dirname, __dirname + "/lib", __dirname + "/modules");
    if (core.watchdirs.indexOf(core.path.modules) == -1) core.watchdirs.push(core.path.modules);
    logger.debug('startWatcher:', core.watchdirs);
    core.watchdirs.forEach(function(dir) {
        core.watchFiles(dir, /\.js$/, function(file) {
            if (self.watchTimer) clearTimeout(self.watchTimer);
            self.watchTimer = setTimeout(function() {
                logger.log('watcher:', 'restarting', self.child.pid);
                if (self.child) self.child.kill(); else self.startProcess();
            }, self.restartDelay);
        });
    });
    this.startProcess();
}

// Start command prompt on TCP socket, context can be an object with properties assigned with additional object to be accessible in the shell
server.startRepl = function(port, bind)
{
    var self = this;
    var repl = net.createServer(function(socket) {
        self.repl = core.createRepl({ prompt: '> ', input: socket, output: socket, terminal: true, useGlobal: false });
        self.repl.on('exit', function() { socket.end(); })
        self.repl.context.socket = socket;
    });
    repl.on('error', function(err) {
       logger.error('startRepl:', core.role, port, bind, err);
    });
    try { repl.listen(port, bind || '0.0.0.0'); } catch(e) { logger.error('startRepl:', port, bind, e) }
    logger.info('startRepl:', core.role, 'port:', port, 'bind:', bind || '0.0.0.0');
}

// Create daemon from the current process, restart node with -daemon removed in the background
server.startDaemon = function()
{
    var self = this;
    // Avoid spawning loop, skip daemon flag
    var argv = process.argv.slice(1).filter(function(x) { return x != "-daemon"; });
    var log = "ignore";

    // Rotate if the file is too big, keep 2 files but big enough to be analyzed in case the logwatcher is not used
    var st = lib.statSync(core.errFile);
    if (st.size > 1024*1024*100) {
        fs.rename(core.errFile, core.errFile + ".old", function(err) { logger.error('rotate:', err) });
    }
    try { log = fs.openSync(core.errFile, 'a'); } catch(e) { logger.error('startDaemon:', e); }

    // Allow clients to write to it otherwise there will be no messages written if no permissions
    lib.chownSync(core.uid, core.gid, core.errFile);

    spawn(process.argv[0], argv, { stdio: [ 'ignore', log, log ], detached: true });
    process.exit(0);
}

// Kill all child processes on exit
server.onexit = function()
{
    this.exiting = true;
    if (this.child) try { this.child.kill('SIGTERM'); } catch(e) {}
    for (var pid in this.pids) { try { process.kill(pid) } catch(e) {} };
}

// Terminates the server process
server.onkill = function()
{
    this.exiting = true;
    process.exit(0);
}

// Create a pid file for the current process
server.writePidfile = function()
{
    fs.writeFile(path.join(core.path.spool, core.role + ".pid"), process.pid, function(err) { if (err) logger.error("writePidfile:", err) });
}

// Shutdown the system immediately, mostly to be used in the remote jobs as the last task
server.shutdown = function(options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    logger.log('shutdown:', 'server');
    core.watchLogs(function() {
        setTimeout(function() { core.shutdown(); }, options.timeout || 30000);
    });
}

// If respawning too fast, delay otherwise schedule new process after short timeout
server.respawn = function(callback)
{
    var self = this;
    if (this.exiting) return;
    var now = Date.now();
    logger.debug('respawn:', this.crash, now - this.crash.time);
    if (self.crash.time && now - self.crash.time < self.crash.interval) {
        if (self.crash.count && self.crash.events >= self.crash.count) {
            logger.log('respawn:', 'throttling for', self.crash.delay, 'after', self.crash.events, 'crashes');
            self.crash.events = 0;
            self.crash.time = now;
            return setTimeout(callback, self.crash.delay);
        }
        self.crash.events++;
    } else {
        self.crash.events = 0;
    }
    self.crash.time = now;
    setTimeout(callback, self.crash.timeout);
}

// Start new process reusing global process arguments, args will be added and args in the skip list will be removed
server.spawnProcess = function(args, skip, opts)
{
    var self = this;
    if (this.exiting) return;
    // Arguments to skip when launchng new process
    if (!skip) skip = [];
    skip.push("-daemon");
    skip.push("-watch");
    skip.push("-monitor");
    // Remove arguments we should not pass to the process
    var argv = this.processArgs.concat(process.argv.slice(1).filter(function(x) { return skip.indexOf(x) == -1; }));
    if (Array.isArray(args)) argv = argv.concat(args);
    var cmd = self.processName || process.argv[0];
    logger.debug('spawnProcess:', cmd, argv, 'skip:', skip, 'opts:', opts);
    return spawn(cmd, argv, opts);
}

// Return a target port for proxy requests, rotates between all web workers
server.getProxyPort = function()
{
    var ports = this.proxyWorkers.map(function(x) { return x.port }).sort();
    if (ports.length && ports[0] != core.proxy.port) return core.proxy.port;
    for (var i = 1; i < ports.length; i++) {
        if (ports[i] - ports[i - 1] != 1) return ports[i - 1] + 1;
    }
    return ports.length ? ports[ports.length-1] + 1 : core.proxy.port;
}

// Return a target for proxy requests
server.getProxyTarget = function(req)
{
    // Virtual host proxy
    var host = (req.headers.host || "").toLowerCase().trim();
    if (host) {
        for (var p in this.proxyHost) {
            if (this.proxyHost[p].rx && host.match(this.proxyHost[p].rx)) return { target: p, xfwd: true };
        }
    }
    // Proxy by url patterns
    var url = req.url;
    for (var p in this.proxyUrl) {
        if (this.proxyUrl[p].rx && url.match(this.proxyUrl[p].rx)) return { target: p, xfwd: true };
    }
    // In reverse mode proxy all not matched to the host
    if (this.proxyReverse) return { target: this.proxyReverse, xfwd: true };

    // Forward api requests to the workers
    for (var i = 0; i < this.proxyWorkers.length; i++) {
        var target = this.proxyWorkers.shift();
        if (!target) break;
        this.proxyWorkers.push(target);
        if (!target.ready) continue;
        // In case when the request is originated by the load balancer we send its address
        return { target: { host: core.proxy.bind, port: target.port }, xfwd: req.headers['x-forwarded-for'] ? false: true };
    }
    return null;
}

// Process a proxy request, perform all filtering or redirects
server.handleProxyRequest = function(req, res, ssl)
{
    var self = this;
    var d = domain.create();
    d.on('error', function(err) {
        logger.error('handleProxyRequest:', req.target || '', req.url, lib.traceError(err));
        if (res.headersSent) return;
        try {
            res.writeHead(500, "Internal Error");
            res.end(err.message);
        } catch(e) {}
    });
    d.add(req);
    d.add(res);

    d.run(function() {
        // Possibly overriden handler with aditiional logic
        api.handleProxyRequest(req, res, function(err) {
            if (res.headersSent) return;
            if (err) {
                res.writeHead(500, "Internal Error");
                return res.end(err.message);
            }
            req.target = self.getProxyTarget(req);
            logger.debug("handleProxyRequest:", req.headers.host, req.url, req.target);
            if (req.target) return self.proxyServer.web(req, res, req.target);
            res.writeHead(500, "Not ready yet");
            res.end();
        });
    });
}
