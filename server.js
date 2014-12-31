//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var net = require('net');
var cluster = require('cluster');
var domain = require('domain');
var cron = require('cron');
var path = require('path');
var util = require('util');
var fs = require('fs');
var spawn = require('child_process').spawn;
var exec = require('child_process').exec;
var core = require(__dirname + '/core');
var logger = require(__dirname + '/logger');
var db = require(__dirname + '/db');
var aws = require(__dirname + '/aws');
var ipc = require(__dirname + '/ipc');
var os = require('os');
var express = require('express');
var stream = require('stream');
var proxy = require('http-proxy');

// The main server class that starts various processes
var server = {
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
    crashInterval: 3000,
    crashTimeout: 2000,
    crashDelay: 30000,
    crashCount: 4,
    crashTime: null,
    crashEvents: 0,

    // Job waiting for the next avaialble worker
    queue: [],
    // List of jobs a worker is running or all jobs running
    jobs: [],
    // Time of the last update on jobs and workers
    jobTime: 0,
    // Max number of seconds since the jobTime before killing the job instance, for long running jobs it must update jobTime periodically
    jobMaxTime: 3600,
    // Interval between jobs scheduler
    jobsInterval: 0,
    // Batch size
    jobsCount: 1,
    // Tag for jobs to process
    jobsTag: '',

    // Schedules cron jobs
    crontab: [],

    // Number of workers or web servers to launch
    maxWorkers: 1,
    maxProcesses: 1,

    // Options for v8
    processArgs: [],
    workerArgs: [],

    // How long to be in idle state and shutdown, for use in instances
    idleTime: 120000,

    // Proxy target
    proxyUrl: {},
    proxyHost: null,
    proxyPort: 80,

    // Config parameters
    args: [{ name: "max-processes", type: "callback", callback: function(v) { this.maxProcesses=core.toNumber(v,0,0,0,core.maxCPUs); if(this.maxProcesses<=0) this.maxProcesses=Math.max(1,core.maxCPUs-1) }, descr: "Max number of processes to launch for Web servers, 0 means NumberofCPUs-2" },
           { name: "max-workers", type: "number", min: 1, max: 32, descr: "Max number of worker processes to launch for jobs" },
           { name: "idle-time", type: "number", descr: "If set and no jobs are submitted the backend will be shutdown, for instance mode only" },
           { name: "job-max-time", type: "number", min: 300, descr: "Max number of seconds a job can run before being killed, for instance mode only" },
           { name: "crash-delay", type: "number", max: 30000, descr: "Delay between respawing the crashed process" },
           { name: "restart-delay", type: "number", max: 30000, descr: "Delay between respawning the server after changes" },
           { name: "log-errors" ,type: "bool", descr: "If true, log crash errors from child processes by the logger, otherwise write to the daemon err-file. The reason for this is that the logger puts everything into one line thus breaking formatting for stack traces." },
           { name: "job", type: "callback", callback: function(v) { this.queueJob(core.base64ToJson(v)) }, descr: "Job specification, JSON encoded as base64 of the job object" },
           { name: "proxy-url", type: "regexpmap", descr: "URL regexp to be passed to other web server running behind, it uses the proxy-host config parameters where to forward matched requests" },
           { name: "proxy-reverse", type: "bool", descr: "Reverse the proxy logic, proxy all that do not match the proxy-url pattern" },
           { name: "proxy-host", type: "callback", callback: function(v) { if (!v) return; v = v.split(":"); if (v[0]) this.proxyHost = v[0]; if (v[1]) this.proxyPort = core.toNumber(v[1],0,80); }, descr: "A Web server IP address or hostname where to proxy matched requests, can be just a host or host:port" },
           { name: "process-name", descr: "Path to the command to spawn by the monitor instead of node, for external processes guarded by this monitor" },
           { name: "process-args", type: "list", descr: "Arguments for spawned processes, for passing v8 options or other flags in case of external processes" },
           { name: "worker-args", type: "list", descr: "Node arguments for workers, job and web processes, for passing v8 options" },
           { name: "jobs-tag", descr: "This server executes jobs that match this tag, if empty then execute all jobs, if not empty execute all that match current IP address and this tag" },
           { name: "job-queue", descr: "Name of the queue to process, this is a generic queue name that can be used by any queue provider" },
           { name: "jobs-count", descr: "How many jobs to execute at any iteration, this relates to the bk_queue queue processing only" },
           { name: "jobs-interval", type: "number", min: 0, descr: "Interval between executing job queue, must be set to enable jobs, 0 disables job processing, in seconds, min interval is 60 secs" } ],
};

module.exports = server;

// Start the server process, call the callback to perform some initialization before launchng any server, just after core.init
server.start = function()
{
    var self = this;

    // Mark the time we started for calculating idle times properly
    self.jobTime = Date.now();
    process.title = core.name + ": process";
    logger.debug("start:", process.argv);

    // REPL shell
    if (core.isArg("-shell")) {
        return core.init({ role: "shell" }, function(err, opts) { self.startShell(opts); });
    }

    // Go to background
    if (core.isArg("-daemon")) {
        return core.init({ role: "daemon", noInit: 1 }, function(err, opts) { self.startDaemon(opts); });
    }

    // Graceful shutdown, kill all children processes
    process.once('exit', function() { self.onexit()  });
    process.once('SIGTERM', function() { self.onkill(); });

    // Watch monitor for modified source files, for development mode only, in production -monitor is used
    if (core.isArg("-watch")) {
        return core.init({ role: "watcher", noInit: 1 }, function(err, opts) { self.startWatcher(opts); });
    }

    // Start server monitor, it will watch the process and restart automatically
    if (core.isArg("-monitor")) {
        return core.init({ role: "monitor", noInit: 1 }, function(err, opts) { self.startMonitor(opts); });
    }

    // Master server, always create tables in the masters processes
    if (core.isArg("-master")) {
        return core.init({ role: "master" }, function(err, opts) { self.startMaster(opts); });
    }

    // Backend Web server
    if (core.isArg("-web")) {
        return core.init({ role: "web" }, function(err, opts) { self.startWeb(opts); });
    }
}

// Start process monitor, running as root
server.startMonitor = function(options)
{
    var self = this;
    process.title = core.name + ': monitor';
    core.role = 'monitor';
    // Be careful about adding functionality to the monitor, it is supposed to just watch the process and restart it
    core.runMethods("configureMonitor");
    self.startProcess();
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

        // REPL command prompt over TCP
        if (core.replPort) self.startRepl(core.replPort, core.replBind);

        // Setup background tasks
        this.loadSchedules();

        var d = domain.create();
        d.on('error', function(err) { logger.error('master:', err, err.stack); });

        // Log watcher job
        if (core.logwatcherEmail || core.logwatcherUrl) {
            setInterval(function() { d.run(function() { core.watchLogs(); }); }, core.logwatcherInterval * 60000);
        }

        // Primary cron jobs
        if (self.jobsInterval > 0) setInterval(function() { d.run(function() { self.processQueue(); }); }, self.jobsInterval * 1000);

        // Watch temp files
        setInterval(function() { d.run(function() { core.watchTmp("tmp", { seconds: 86400 }) }); }, 43200000);
        setInterval(function() { d.run(function() { core.watchTmp("log", { seconds: 86400*7, ignore: path.basename(core.errFile) + "|" + path.basename(core.logFile) }); }); }, 86400000);

        // Maintenance tasks
        setInterval(function() {
            // Submit pending jobs
            self.execJobQueue();

            // Check idle time, if no jobs running for a long time shutdown the server, this is for instance mode mostly
            if (core.instance.job && self.idleTime > 0 && !Object.keys(cluster.workers).length && Date.now() - self.jobTime > self.idleTime) {
                logger.log('startMaster:', 'idle:', self.idleTime);
                self.shutdown();
            }
        }, 30000);

        // API related initialization
        core.runMethods("configureMaster");

        logger.log('startMaster:', 'version:', core.version, 'home:', core.home, 'port:', core.port, 'uid:', process.getuid(), 'gid:', process.getgid(), 'pid:', process.pid)
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

    process.on("message", function(job) {
        logger.debug('startWorker:', 'job:', job);
        self.runJob(job);
    });

    // Maintenance tasks
    setInterval(function() {
        var now = Date.now()
        // Check idle time, exit worker if no jobs submitted
        if (self.idleTime > 0 && !self.jobs.length && now - self.jobTime > self.idleTime) {
            logger.log('startWorker:', 'idle: no more jobs to run', self.idleTime);
            process.exit(0);
        }
        // Check how long we run and force kill if exceeded
        if (now - self.jobTime > self.jobMaxTime*1000) {
            logger.log('startWorker:', 'time: exceeded max run time', self.jobMaxTime);
            process.exit(0);
        }
    }, 30000);

    // At least API tables are needed for normal operations
    core.runMethods("configureWorker", function() {
        core.loadModules("worker");
        process.send('ready');
    });

    logger.log('startWorker:', 'id:', cluster.worker.id, 'version:', core.version, 'home:', core.home, 'uid:', process.getuid(), 'gid:', process.getgid(), 'pid:', process.pid);
}

// Create Express server, setup worker environment, call supplied callback to set initial environment
server.startWeb = function(options)
{
    var self = this;
    var api = core.modules.api;

    if (cluster.isMaster) {
        core.role = 'server';
        process.title = core.name + ': server';

        // Setup IPC communication
        ipc.initServer();

        // REPL command prompt over TCP
        if (core.replPortWeb) self.startRepl(core.replPortWeb, core.replBindWeb);

        // In proxy mode we maintain continious sequence of ports for each worker starting with core.proxy.port
        if (core.proxy.port) {
            core.role = 'proxy';
            self.proxyTargets = [];

            self.getProxyPort = function() {
                var ports = self.proxyTargets.map(function(x) { return x.port }).sort();
                if (ports.length && ports[0] != core.proxy.port) return core.proxy.port;
                for (var i = 1; i < ports.length; i++) {
                    if (ports[i] - ports[i - 1] != 1) return ports[i - 1] + 1;
                }
                return ports.length ? ports[ports.length-1] + 1 : core.proxy.port;
            }
            self.getProxyTarget = function(req) {
                // Proxy to the global Web server running behind us
                if (self.proxyHost && self.proxyUrl.rx) {
                    var d = req.url.match(self.proxyUrl.rx);
                    if ((self.proxyReverse && !d) || (!self.proxyReverse && d)) return { target: { host: self.proxyHost, port: self.proxyPort } };
                }
                // Forward api requests to the workers
                for (var i = 0; i < self.proxyTargets.length; i++) {
                    var target = self.proxyTargets.shift();
                    if (!target) break;
                    self.proxyTargets.push(target);
                    if (!target.ready) continue;
                    return { target: { host: core.proxy.bind, port: target.port } };
                }
                return null;
            }
            self.clusterFork = function() {
                var port = self.getProxyPort();
                var worker = cluster.fork({ BKJS_PORT: port });
                self.proxyTargets.push({ id: worker.id, port: port });
            }
            ipc.onMessage = function(msg) {
                switch (msg.op) {
                case "api:ready":
                    for (var i = 0; i < self.proxyTargets.length; i++) {
                        if (self.proxyTargets[i].id == this.id) return self.proxyTargets[i] = msg.value;
                    }
                    break;

                case "cluster:exit":
                    for (var i = 0; i < self.proxyTargets.length; i++) {
                        if (self.proxyTargets[i].id == this.id) return self.proxyTargets.splice(i, 1);
                    }
                    break;
                }
            }
            self.proxyServer = proxy.createServer({ xfwd : true });
            self.proxyServer.on("error", function(err) { if (err.code != "ECONNRESET") logger.error("proxy:", err.code, err.stack) })
            self.server = core.createServer({ name: "http", port: core.port, bind: core.bind, restart: "web" }, function(req, res) {
                var target = self.getProxyTarget(req);
                if (target) return self.proxyServer.web(req, res, target);
                res.writeHead(500, "Not ready yet");
                res.end();
            });
            if (core.proxy.ssl && (core.ssl.key || core.ssl.pfx)) {
                self.sslServer = core.createServer({ name: "https", ssl: core.ssl, port: core.ssl.port, bind: core.ssl.bind, restart: "web" }, function(req, res) {
                    var target = self.getProxyTarget(req);
                    if (target) return self.proxyServer.web(req, res, target);
                    res.writeHead(500, "Not ready yet");
                    res.end();
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
        } else {
            self.getWorkerEnv = function() { return null; }
            self.clusterFork = function() { return cluster.fork(); }
        }
        // Arguments passed to the v8 engine
        if (self.workerArgs.length) process.execArgv = self.workerArgs;

        // Create tables and spawn Web workers
        api.initTables(options, function(err) {
            for (var i = 0; i < self.maxProcesses; i++) self.clusterFork();
        });

        // API related initialization
        core.runMethods("configureServer", options);

        // Frontend server tasks
        setInterval(function() {
            // Make sure we have all workers running
            var workers = Object.keys(cluster.workers);
            for (var i = 0; i < this.maxProcesses - workers.length; i++) self.clusterFork();
        }, 5000);

        // Restart if any worker dies, keep the worker pool alive
        cluster.on("exit", function(worker, code, signal) {
            logger.log('web worker: died:', worker.id, 'pid:', worker.process.pid || "", "code:", code || "", 'signal:', signal || "");
            self.respawn(function() { self.clusterFork(); });
            // Exit when all workers are terminated
            if (self.exiting && !Object.keys(cluster.workers).length) process.exit(0);
        });

        // Graceful shutdown if the server needs restart
        self.onkill = function() {
            self.exiting = true;
            setTimeout(function() { process.exit(0); }, 60000);
            logger.log('web server: shutdown started');
            for (var p in cluster.workers) try { process.kill(cluster.workers[p].process.pid); } catch(e) {}
        }
        logger.log('startServer:', core.role, 'version:', core.version, 'home:', core.home, 'port:', core.port, 'uid:', process.getuid(), 'gid:', process.getgid(), 'pid:', process.pid)

    } else {
        core.role = 'web';
        process.title = core.name + ": web";

        // Port to listen in case of reverse proxy configuration, all other ports become offsets from the base
        if (core.proxy.port) {
            core.bind = process.env.BKJS_BIND || core.proxy.bind;
            core.port = core.toNumber(process.env.BKJS_PORT || core.proxy.port);
            if (core.ssl.port) core.ssl.port = core.port + 100;
            if (core.ws.port) core.ws.port = core.port + 200;
        }

        // REPL command prompt over TCP
        if (core.replPortWeb) self.startRepl(core.replPortWeb + 1 + core.toNumber(cluster.worker.id), core.replBindWeb);

        // Setup IPC communication
        ipc.initClient();

        // Init API environment
        api.init(options, function(err) {
            core.dropPrivileges();

            // Use proxy headers in the Express
            if (core.proxy.port) {
                this.app.set('trust proxy', true);
            }
            // Gracefull termination of the process
            self.onkill = function() {
                self.exiting = true;
                api.shutdown(function() { process.exit(0); } );
            }

            process.on("uncaughtException", function(err) {
                logger.error('fatal:', err, err.stack);
                self.onkill();
            });
        });

        logger.log('startWeb:', core.role, 'id:', cluster.worker.id, 'version:', core.version, 'home:', core.home, 'port:', core.port, core.bind, 'repl:', core.replPortWeb, 'uid:', process.getuid(), 'gid:', process.getgid(), 'pid:', process.pid);
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
        logger.log('process terminated:', type, 'pid:', this.pid, 'code:', code, 'signal:', signal);
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
    self.child.on('exit', function (code, signal) {
        logger.log('process terminated:', 'code:', code, 'signal:', signal);
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
    if (core.replPort && !core.isArg("-master")) self.startRepl(core.replPort, core.replBind);

    if (core.watchdirs.indexOf(__dirname) == -1) core.watchdirs.push(__dirname);
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
    logger.log('startRepl:', core.role, 'port:', port, 'bind:', bind || '0.0.0.0');
}

// Create daemon from the current process, restart node with -daemon removed in the background
server.startDaemon = function()
{
    var self = this;
    // Avoid spawning loop, skip daemon flag
    var argv = process.argv.slice(1).filter(function(x) { return x != "-daemon"; });
    var log = "ignore";

    // Rotate if the file is too big, keep 2 files but big enough to be analyzed in case the logwatcher is not used
    var st = core.statSync(core.errFile);
    if (st.size > 1024*1024*100) {
        fs.rename(core.errFile, core.errFile + ".old", function(err) { logger.error('rotate:', err) });
    }
    try { log = fs.openSync(core.errFile, 'a'); } catch(e) { logger.error('startDaemon:', e); }

    // Allow clients to write to it otherwise there will be no messages written if no permissions
    core.chownSync(core.errFile);

    spawn(process.argv[0], argv, { stdio: [ 'ignore', log, log ], detached: true });
    process.exit(0);
}

// Start REPL shell or execute any subcommand if specified
server.startShell = function(options)
{
    var self = this;
    var db = core.modules.db;
    var api = core.modules.api;
    process.title = core.name + ": shell";

    logger.debug('startShell:', process.argv);

    core.loadModules("shell");

    function exit(err, msg) {
        if (err) console.log(err);
        if (msg) console.log(msg);
        process.exit(err ? 1 : 0);
    }
    function getUser(obj, callback) {
        db.get("bk_account", { id: obj.id }, function(err, row) {
            if (err) exit(err);

            db.get("bk_auth", { login: row ? row.login : obj.login }, function(err, row) {
                if (err || !row) exit(err, "ERROR: no user found with this id: " + util.inspect(obj));
                callback(row);
            });
        });
    }
    function getQuery() {
        var query = {};
        for (var i = process.argv.length - 1; i > 1; i -= 2) {
            var a = process.argv[i - 1][0], b = process.argv[i][0];
            if (a != '_' && a != '-' && b != '_' && b != '-') query[process.argv[i - 1]] = process.argv[i];
        }
        return query;
    }
    function getOptions() {
        var query = {};
        for (var i = process.argv.length - 1; i > 1; i -= 2) {
            var a = process.argv[i - 1][0], b = process.argv[i][0];
            if (a == '_' && b != '_' && b != '-') query[process.argv[i - 1]] = process.argv[i];
        }
        return api.getOptions({ query: query, options: { path: ["", "", ""], ops: {} } });
    }

    core.runMethods("configureShell", options, function(err, opts) {
        if (opts.done) exit();

        // Add a user
        if (core.isArg("-account-add")) {
            var query = getQuery();
            if (query.login && !query.name) query.name = query.login;
            if (core.isArg("-scramble")) {
                query.secret = core.sign(query.login, query.secret);
                query.login = core.sign(query.login, query.login);
            }
            api.addAccount({ query: query, account: { type: 'admin' } }, {}, function(err, data) {
                exit(err, data);
            });
        } else

        // Delete a user and all its history according to the options
        if (core.isArg("-account-update")) {
            var query = getQuery();
            getUser(query, function(row) {
                api.updateAccount({ account: row, query: query }, {}, function(err, data) {
                    exit(err, data);
                });
            });
        } else

        // Change user password
        if (core.isArg("-account-set-secret")) {
            var query = getQuery();
            if (core.isArg("-scramble") && query.login) {
                query.secret = core.sign(query.login, query.secret);
                query.login = core.sign(query.login, query.login);
            }
            getUser(query, function(row) {
                api.setAccountSecret({ account: row, query: query }, {}, function(err, data) {
                    exit(err, data);
                });
            });
        } else

        // Delete a user and all its history according to the options
        if (core.isArg("-account-del")) {
            var query = getQuery();
            var options = {};
            for (var i = 1; i < process.argv.length - 1; i += 2) {
                if (process.argv[i] == "-keep") options[process.argv[i + 1]] = 1;
            }
            getUser(query, function(row) {
                api.deleteAccount(row.id, options, function(err, data) {
                    exit(err, data);
                });
            });
        } else

        // Update location
        if (core.isArg("-location-put")) {
            var query = getQuery();
            getUser(query, function(row) {
                api.putLocation({ account: row, query: query }, {}, function(err, data) {
                    exit(err, data);
                });
            });
        } else

        // Update location
        if (core.isArg("-log-watch")) {
            core.watchLogs(function(err) {
                exit(err);
            });
        } else

        // Get file
        if (core.isArg("-s3-get")) {
            var query = getQuery(), file = core.getArg("-file"), uri = core.getArg("-path");
            query.file = file || uri.split("?")[0].split("/").pop();
            aws.s3GetFile(uri, query, function(err, data) {
                exit(err, data);
            });
        } else

        // Put file
        if (core.isArg("-s3-put")) {
            var query = getQuery(), path = core.getArg("-path"), uri = core.getArg("-file");
            aws.s3PutFile(uri, file, query, function(err, data) {
                exit(err, data);
            });
        } else

        // Show all config parameters
        if (core.isArg("-db-get-config")) {
            var opts = getQuery(), sep = core.getArg("-separator", "="), fmt = core.getArg("-format");
            db.initConfig(opts, function(err, data) {
                if (fmt == "text") {
                    for (var i = 0; i < data.length; i += 2) console.log(data[i].substr(1) + (sep) + data[ i + 1]);
                } else {
                    console.log(JSON.stringify(data));
                }
                exit(err);
            });
        } else

        // Show all records
        if (core.isArg("-db-select")) {
            var query = getQuery(), opts = getOptions(), table = core.getArg("-table"), sep = core.getArg("-separator", "!"), fmt = core.getArg("-format");
            var cols = Object.keys(db.getColumns(table))
            db.select(table, query, opts, function(err, data) {
                if (data && data.length) {
                    if (fmt == "text") {
                        data.forEach(function(x) { console.log((cols || Object.keys(x)).map(function(y) { return x[y] }).join(sep)) });
                    } else {
                        data.forEach(function(x) { console.log(JSON.stringify(x)) });
                    }
                }
                exit(err);
            });
        } else

        // Show all records
        if (core.isArg("-db-scan")) {
            var query = getQuery(), opts = getOptions(), table = core.getArg("-table"), sep = core.getArg("-separator", "!"), fmt = core.getArg("-format");
            var cols = Object.keys(db.getColumns(table));
            db.scan(table, query, opts, function(row, next) {
                if (fmt == "text") {
                    console.log((cols || Object.keys(row)).map(function(y) { return row[y] }).join(sep));
                } else {
                    console.log(JSON.stringify(row));
                }
                next();
            }, function(err) {
                exit(err);
            });
        } else

        // Import records from previous scan/select, the format MUST be json, one record per line
        if (core.isArg("-db-import")) {
            var query = getQuery(), opts = getOptions(), table = core.getArg("-table"), file = core.getArg("-file"), nostop = core.getArgInt("-nostop");
            core.forEachLine(file, opts, function(line, next) {
                var row = core.jsonParse(line, { logger: 1 });
                if (!row) return next(nostop ? null : "ERROR: parse error, line: " + opts.lines);
                db.put(table, row, opts, function(err) { next(nostop ? null : err) });
            }, function(err) {
                exit(err);
            });
        } else

        // Put config entry
        if (core.isArg("-db-get")) {
            var query = getQuery(), opts = getOptions(), table = core.getArg("-table"), sep = core.getArg("-separator", "!"), fmt = core.getArg("-format");
            var cols = Object.keys(db.getColumns(table))
            db.get(table, query, opts, function(err, data) {
                if (data) {
                    if (fmt == "text") {
                        console.log((cols || Object.keys(data)).map(function(y) { return x[y] }).join(sep))
                    } else {
                        console.log(JSON.stringify(data));
                    }
                }
                exit(err);
            });
        } else

        // Put config entry
        if (core.isArg("-db-put")) {
            var query = getQuery(), opts = getOptions(), table = core.getArg("-table");
            db.put(table, query, opts, function(err, data) {
                exit(err);
            });
        } else

        // Delete config entry
        if (core.isArg("-db-del")) {
            var query = getQuery(), opts = getOptions(), table = core.getArg("-table");
            db.del(table, query, opts, function(err, data) {
                exit(err);
            });
        } else

        // Send API request
        if (core.isArg("-send-request")) {
            var query = getQuery(), url = core.getArg("-url"), id = core.getArg("-id"), login = core.getArg("-login");
            getUser({ id: id, login: login }, function(row) {
                core.sendRequest({ url: url, login: row.login, secret: row.secret, query: query }, function(err, params) {
                    exit(err, params.obj);
                });
            });
        } else {
            ipc.initClient();
            core.createRepl();
        }
    });
}

server.startTestServer = function(options)
{
    var self = this;
    if (!options) options = {};

    if (!options.master) {
        options.running = options.stime = options.etime = options.id = 0;
        core.modules.aws.getInstanceInfo(function() {
            setInterval(function() {
                core.sendRequest({ url: options.host + '/ping/' + core.instance.id + '/' + options.id }, function(err, params) {
                    if (err) return;
                    logger.debug(params.obj);

                    switch (params.obj.cmd) {
                    case "exit":
                    case "error":
                        process.exit(0);
                        break;

                    case "register":
                        options.id = params.obj.id;
                        break;

                    case "start":
                        if (options.running) break;
                        options.running = true;
                        options.stime = Date.now();
                        if (options.callback) {
                            options.callback(options);
                        } else
                        if (options.test) {
                            var name = options.test.split(".");
                            core.runTest(core.modules[name[0]], name[1], options);
                        }
                        break;

                    case "stop":
                        if (!options.running) break;
                        options.running = false;
                        options.etime = Date.now();
                        break;

                    case "shutdown":
                        self.shutdown();
                        break;
                    }
                });

                // Check shutdown interval
                if (!options.running) {
                    var now = Date.now();
                    if (!options.etime) options.etime = now;
                    if (now - options.etime > (options.idlelimit || 3600000)) core.shutdown();
                }
            }, options.interval || 5000);
        });
        return;
    }

    var nodes = {};
    var app = express();
    app.on('error', function (e) { logger.error(e); });
    app.use(function(req, res, next) { return core.modules.api.checkQuery(req, res, next); });
    app.use(app.routes);
    app.use(function(err, req, res, next) {
        logger.error('startTestMaster:', req.path, err, err.stack);
        res.json(err);
    });
    try { app.listen(options.port || 8080); } catch(e) { logger.error('startTestMaster:', e); }

    // Return list of all nodes
    app.get('/nodes', function(req, res) {
        res.json(nodes)
    });

    // Registration: instance, id
    app.get(/^\/ping\/([a-z0-9-]+)\/([a-z0-9]+)/, function(req, res) {
        var now = Date.now();
        var obj = { cmd: 'error', mtime: now }
        var node = nodes[req.params[1]];
        if (node) {
            node.instance = req.params[0];
            node.mtime = now;
            obj.cmd = node.state;
        } else {
            obj.cmd = 'register';
            obj.id = core.uuid();
            nodes[obj.id] = { state: 'stop', ip: req.connection.remoteAddress, mtime: now, stime: now };
        }
        logger.debug(obj);
        res.json(obj)
    });

    // Change state of the node(es)
    app.get(/^\/(start|stop|launch|shutdown)\/([0-9]+)/, function(req, res, next) {
        var obj = {}
        var now = Date.now();
        var state = req.params[0];
        var num = req.params[1];
        switch (state) {
        case "launch":
            break;

        case "shutdown":
            var instances = {};
            for (var n in nodes) {
                if (num <= 0) break;
                if (!instances[nodes[n].instance]) {
                    instances[nodes[n].instance] = 1;
                    num--;
                }
            }
            for (var n in nodes) {
                var node = nodes[n];
                if (node && node.state != state && instances[node.instance]) {
                    node.state = state;
                    node.stime = now;
                }
            }
            logger.log('shutdown:', instances);
            break;

        default:
            for (var n in nodes) {
                if (num <= 0) break;
                var node = nodes[n];
                if (node && node.state != state) {
                    node.state = state;
                    node.stime = now;
                    num--;
                }
            }
        }
        res.json(obj);
    });

    var interval = options.interval || 30000;
    var runlimit = options.runlimit || 3600000;

    setInterval(function() {
        var now = Date.now();
        for (var n in nodes) {
            var node = nodes[n]
            // Last time we saw this node
            if (now - node.mtime > interval) {
                logger.debug('cleanup: node expired', n, node);
                delete nodes[n];
            } else
            // How long this node was in this state
            if (now - node.stime > runlimit) {
                switch (node.state) {
                case 'start':
                    // Stop long running nodes
                    node.state = 'stop';
                    logger.log('cleanup: node running too long', n, node)
                    break;
                }
            }
        }
    }, interval);

    logger.log('startTestMaster: started', options || "");
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

// Sleep and keep a worker busy
server.sleep = function(options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    setTimeout(function() {
        logger.log('sleep:', options);
        if (callback) callback();
    }, options.timeout || 30000);
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
    logger.debug('respawn:', 'time:', self.crashTime, now - self.crashTime, 'events:', self.crashEvents, 'interval:', self.crashInterval, 'count:', self.crashCount);
    if (self.crashTime && now - self.crashTime < self.crashInterval) {
        if (self.crashCount && self.crashEvents >= self.crashCount) {
            logger.log('respawn:', 'throttling for', self.crashDelay, 'after', self.crashEvents, 'crashes');
            self.crashEvents = 0;
            self.crashTime = now;
            return setTimeout(callback, self.crashDelay);
        }
        self.crashEvents++;
    } else {
        self.crashEvents = 0;
    }
    self.crashTime = now;
    setTimeout(callback, self.crashTimeout);
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

// Run all jobs from the job spec at the same time, when the last job finishes and it is running in the worker process, the process terminates.
server.runJob = function(job)
{
    var self = this;

    function finish(err, name) {
        logger.debug('runJob:', 'finished', name, err || "");
        if (!self.jobs.length && cluster.isWorker) {
            core.runMethods("shutdownWorker", function() {
                logger.debug('runJob:', 'exit', name, err || "");
                process.exit(0);
            });
        }
    }

    for (var name in job) {
        // Skip special objects
        if (job[name] instanceof domain.Domain) continue;

        // Make report about unknown job, leading $ are used for same method miltiple times in the same job because property names are unique in the objects
        var spec = name.replace(/^[\$]+/g, "").split('.');
        var obj = spec[0] == "core" ? core : core.modules[spec[0]];
        if (!obj || !obj[spec[1]]) {
            logger.error('runJob:', "unknown method", name, 'job:', job);
            continue;
        }

        // Pass as first argument the options object, then callback
        var args = [ core.typeName(job[name]) == "object" ? job[name] : {} ];

        // The callback to finalize job execution
        (function (jname) {
            args.push(function(err) {
                self.jobTime = Date.now();
                // Update process title with current job list
                var idx = self.jobs.indexOf(jname);
                if (idx > -1) self.jobs.splice(idx, 1);
                if (cluster.isWorker) process.title = core.name + ': worker ' + self.jobs.join(',');
                finish(err, jname);
            });
        })(name);

        var d = domain.create();
        d.on("error", args[1]);
        d.run(function() {
            obj[spec[1]].apply(obj, args);
            self.jobTime = Date.now();
            self.jobs.push(name);
            if (cluster.isWorker) process.title = core.name + ': worker ' + self.jobs.join(',');
            logger.debug('runJob:', 'started', name, job[name] || "");
        });
    }
    // No jobs started or errors, just exit
    if (!self.jobs.length && cluster.isWorker) finish(null, "no jobs");
}

// Execute job in the background by one of the workers, object must be known exported module
// and method must be existing method of the given object. The method function must take options
// object as its first argument and callback as its second argument.
// More than one job can be specified, property of the object defines name for the job to run:
//
// Example:
//
//          { 'scraper.run': {}, 'server.shutdown': {} }
//
// If the same object.method must be executed several times, prepend subsequent jobs with $
//
// Example:
//
//          { 'scraper.run': { "arg": 1 }, '$scraper.run': { "arg": 2 }, '$$scraper.run': { "arg": 3 } }
//
// Supported options by the server:
//  - skipqueue - in case of a duplicate or other condition when this job cannot be executed it is put back to
//      the waiting queue, this options if set to 1 makes the job to be ignored on error
//  - runalways - no checks for existing job wth the same name should be done
//  - runone - only run the job if there is no same running job, this options serializes similar jobs
//  - runlast - run when no more pending or running jobs
//  - runafter - specifies another job in canoncal form obj.method which must finish and not be pending in
//    order for this job to start, this implements chaining of jobs to be executed one after another
//    but submitted at the same time
//
//  Exampe: submit 3 jobs to run sequentially:
//
//          'scraper.import'
//          { 'scraper.sync': { runafter: 'scraper.import' } }
//          { 'server.shutdown': { runafter: 'scraper.sync' } }
server.execJob = function(job)
{
    var self = this;

    if (cluster.isWorker) return logger.error('exec: can be called from the master only', job);

    try {
        // Build job object with canonical name
        if (typeof job == "string") job = core.newObj(job, null);
        if (typeof job != "object") return logger.error('exec:', 'invalid job', job);

        // Do not exceed max number of running workers
        var workers = Object.keys(cluster.workers);
        if (workers.length >= self.maxWorkers) {
            self.queue.push(job);
            return logger.debug('execJob:', 'max number of workers running:', self.maxWorkers, 'job:', job);
        }

        // Perform conditions check, any failed condition will reject the whole job
        for (var p in job) {
            var opts = job[p] || {};
            // Do not execute if we already have this job running
            if (self.jobs.indexOf(p) > -1 && !opts.runalways) {
                if (!opts.skipqueue) self.queue.push(job);
                return logger.debug('execJob: already running', job);
            }

            // Condition for job, should not be any pending or running jobs
            if (opts.runlast) {
                if (self.jobs.length || self.queue.length) {
                    if (!opts.skipqueue) self.queue.push(job);
                    return logger.debug('execJob:', 'other jobs still exist', job);
                }
            }

            // Check dependencies, only run when there is no dependent job in the running list
            if (opts.runone) {
                if (self.jobs.filter(function(x) { return x.match(opts.runone) }).length) {
                    if (!opts.skipqueue) self.queue.push(job);
                    return logger.debug('execJob:', 'depending job still exists:', job);
                }
            }

            // Check dependencies, only run when there is no dependent job in the running or pending lists
            if (opts.runafter) {
                if (self.jobs.some(function(x) { return x.match(opts.runafter) }) ||
                    self.queue.some(function(x) { return Object.keys(x).some(function(y) { return y.match(opts.runafter); }); })) {
                    if (!opts.skipqueue) self.queue.push(job);
                    return logger.debug('execJob:', 'depending job still exists:', job);
                }
            }
        }
    } catch(e) {
        logger.error('execJob:', e, job);
        return false;
    }

    // Setup node args passed for each worker
    if (self.workerArgs) process.execArgv = self.workerArgs;

    self.jobTime = Date.now();
    logger.debug('execJob:', 'workers:', workers.length, 'job:', job);

    // Start a worker, send the job and wait when it finished
    var worker = cluster.fork();
    worker.on("error", function(e) {
        logger.error('execJob:', e, job);
        worker = null;
    })
    worker.on('message', function(msg) {
        if (msg != "ready") return;
        worker.send(job);
        // Make sure we add new jobs after we successfully created a new worker
        self.jobs = self.jobs.concat(Object.keys(job));
    });
    worker.on("exit", function(code, signal) {
        logger.log('execJob: finished:', worker.id, 'pid:', worker.process.pid, 'code:', code || 0, '/', signal || 0, 'job:',job);
        for (var p in job) {
            var idx = self.jobs.indexOf(p);
            if (idx > -1) self.jobs.splice(idx, 1);
        }
        worker = null;
    });
    return true;
}

// Remote mode, launch remote instance to perform scraping or other tasks
// By default, shutdown the instance after job finishes unless noshutdown:1 is specified in the options
server.launchJob = function(job, options, callback)
{
    var self = this;
    if (!job) return;
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    if (typeof job == "string") job = core.newObj(job, null);
    if (!Object.keys(job).length) return logger.error('launchJob:', 'no valid jobs:', job);

    job = core.cloneObj(job);
    self.jobTime = Date.now();
    logger.log('launchJob:', job, 'options:', options);

    // Common arguments for remote workers
    var args = ["-master", "-instance-job",
                "-backend-host", core.backendHost || "",
                "-backend-key", core.backendKey || "",
                "-backend-secret", core.backendSecret || "",
                "-server-jobname", Object.keys(job).join(","),
                "-server-job", core.jsonToBase64(job) ];

    if (!options.noshutdown) {
        args.push("-server-job", core.jsonToBase64({ 'server.shutdown': { runlast: 1 } }));
    }

    // Command line arguments for the instance, must begin with -
    for (var p in options) {
        if (p[0] != '-') continue;
        args.push(p, options[p])
    }
    options.UserData = args.map(function(x) { return String(x).replace(/ /g, '%20') }).join(" ");
    // Update tag name with current job
    var d = args.match(/\-jobname ([^ ]+)/i);
    if (d) options.instanceName = d[1];

    // Terminate after the job is done
    if (!options.InstanceInitiatedShutdownBehavior && !options.termnate && !options.stop) options.terminate = 1;

    aws.ec2RunInstances(options, callback);
    return true;
}

// Run a job, the string is in the format:
// object/method/name/value/name/value....
// All spaces must be are replaced with %20 to be used in command line parameterrs
server.queueJob = function(job)
{
    var self = this;
    switch (core.typeName(job)) {
    case "object":
        if (Object.keys(job).length) return this.queue.push(job);
        break;

    case "string":
        job = job.trim();
        if (job) return this.queue.push(core.newObj(job, null));
        break;
    }
    logger.error("queueJob:", "invalid job: ", job);
}

// Process pending jobs, submit to idle workers
server.execJobQueue = function()
{
    var self = this;
    if (!this.queue.length) return;
    var job = this.queue.shift();
    if (job) this.execJob(job);
}

// Create a new cron job, for remote jobs additional property args can be used in the object to define
// arguments for the instance backend process, properties must start with -
//
// If a job object contains the `tag` property, it will be submitted into the bk_queue for execution by that worker
//
// Example:
//
//          { "type": "server", "cron": "0 */10 * * * *", "job": "server.processQueue" },
//          { "type": "local", "cron": "0 10 7 * * *", "id": "processQueue", "job": "api.processQueue" }
//          { "type": "remote", "cron": "0 5 * * * *", "args": { "-workers": 2 }, "job": { "scraper.run": { "url": "host1" }, "$scraper.run": { "url": "host2" } } }
//          { "type": "local", "cron": "0 */10 * * * *", "tag": "host-12", "job": "server.processQueue" },
//
server.scheduleCronjob = function(spec, obj)
{
    var self = this;
    if (!spec || !obj || !obj.job) return;
    logger.debug('scheduleCronjob:', spec, obj);
    var cj = new cron.CronJob(spec, function() {
        // Submit a job via cron to a worker for execution
        if (this.job.tag) {
            self.submitJob(this.job);
        } else {
            self.scheduleJob(this.job);
        }
    }, null, true);
    cj.job = obj;
    this.crontab.push(cj);
}

// Execute a cronjob by id now, it must have been scheduled already and id property must be specified in the crontab
// When REPL is activated on the master server with -repl-port then connecting to the running master server via telnet it is possible to execute
// cron jobs manually
//
//  Example:
//
//      // Start the backend with repl-port like `bkjs run-backend -repl-port 2080`
//
//      # telnet localhost 2080
//      > server.runCronjob("processQueue")
//
server.runCronjob = function(id)
{
    var self = this;
    this.crontab.forEach(function(x) {
       if (x.job && x.job.id == id) x._callback();
    });
}

// Perform execution according to type
server.scheduleJob = function(options, callback)
{
    var self = this;
    if (typeof callback != "function") callback = core.noop;
    if (core.typeName(options) != "object" || !options.job) options = { type: "error" };

    switch (options.type || "") {
    case "error":
        callback("Invalid job", true);
        break;

    case "request":
        core.sendRequest(options, function() { callback() });
        break;

    case 'remote':
        setImmediate(function() { self.launchJob(options.job, options.args); });
        callback(null, true);
        break;

    case "server":
        setImmediate(function() {
            var d = domain.create();
            d.on('error', function(err) { logger.error('scheduleJob:', options, err.stack); });
            d.add(options.job);
            d.run(function() { self.runJob(options.job); });
        });
        callback(null, true);
        break;

    default:
        setImmediate(function() { self.queueJob(options.job); });
        callback(null, true);
        break;
    }
}

// Load crontab from JSON file as list of job specs:
// - type - local, remote, server
//      - local means spawn a worker to run the job function
//      - remote means launch an AWS instance
//      - server means run inside the master process, do not spawn a worker
// - cron - cron time interval spec: 'second' 'minute' 'hour' 'dayOfMonth' 'month' 'dayOfWeek'
// - job - a string as obj.method or an object with job name as property name and the value is an object with
//         additional options for the job passed as first argument, a job callback always takes options and callback as 2 arguments
// - args - additional arguments to be passed to the backend in the command line for the remote jobs
//
// Example:
//
//          [ { "type": "local", cron: "0 0 * * * *", job: "scraper.run" }, ..]
server.loadSchedules = function()
{
    var self = this;

    var list = [];
    fs.readFile(core.path.etc + "/crontab", function(err, data) {
        if (data && data.length) list = core.jsonParse(data.toString(), { list: 1 });

        fs.readFile(core.path.etc + "/crontab.local", function(err, data) {
            if (data && data.length) list = list.concat(core.jsonParse(data.toString(), { list: 1 }));

            if (!list.length) return;
            self.crontab.forEach(function(x) { x.stop(); delete x; });
            self.crontab = [];
            list.forEach(function(x) {
                if (!x.type || !x.cron || !x.job || x.disabled) return;
                self.scheduleCronjob(x.cron, x);
            });
            logger.log("loadSchedules:", self.crontab.length, "schedules");
        });
    });

    // Watch config directory for changes
    if (this.cronWatcher) return;
    this.cronWatcher = fs.watch(core.path.etc, function (event, filename) {
        if (filename == "crontab") core.setTimeout(filename, function() { self.loadSchedules(); }, 5000);
    });
}

// Submit job for execution, it will be saved in the server queue and the master or matched job server will pick it up later.
//
// The options can specify:
//  - tag - job name for execution, this can be used to run on specified servers by IP address or other tag asigned
//  - type - job type: local, remote, server
//  - stime - start time ofr the job, it will wait until this time is current to be processed
//  - etime - expiration time, after this this job is ignored
//  - job - an object with a job spec, for name-only job the object can look like { job: null }
//  - args - additional arguments for remote job to pass in the command line via user-data
server.submitJob = function(options, callback)
{
    var self = this;
    if (!options || core.typeName(options) != "object" || !options.job) {
        logger.error('submitJob:', 'invalid job spec, must be an object:', options);
        return callback ? callback("invalid job") : null;
    }
    logger.debug('submitJob:', options);
    db.put("bk_queue", options, callback);
}

// Process AWS SQS queue for any messages and execute jobs, a job object must be in the same format as for the cron jobs.
//
// The options can specify:
//  - queue - SQS queue ARN, if not specified the `-server-job-queue` will be used
//  - timeout - how long to wait for messages, seconds, default is 5
//  - count - how many jobs to receive, if not specified use `-api-max-jobs` config parameter
//  - visibilityTimeout - The duration in seconds that the received messages are hidden from subsequent retrieve requests
//     after being retrieved by a ReceiveMessage request.
//
server.processSQS = function(options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {};
    var queue = options.queue || self.jobQueue;
    if (!queue) return callback ? callback() : null;

    aws.sqsReceiveMessage(queue, options, function(err, rows) {
        if (err) return callback ? callback(err) : null;
        core.forEachSeries(rows || [], function(item, next) {
            var job = core.jsonParse(item.Body, { obj: 1, error: 1 });
            if (job && row.job) self.scheduleJob(row.type, row.job, row.args);

            aws.querySQS("DeleteMessage", { QueueUrl: queue, ReceiptHandle: item.ReceiptHandle }, function(err) {
                if (err) logger.error('processSQS:', err);
                next();
            });
        }, function() {
            if (callback) callback();
        });
    });
}

// Load submitted jobs for execution, it is run by the master process every `-server-jobs-interval` seconds.
// Requires connection to the PG database, how jobs appear in the table and the order of execution is not concern of this function,
// the higher level management tool must take care when and what to run and in what order.
//
server.processQueue = function(options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {};

    var now = Date.now()
    db.select("bk_queue", {}, { count: self.jobCount }, function(err, rows) {
        rows = rows.filter(function(x) {
            if (x.stime && x.stime < now) return 0;
            return !x.tag || x.tag == core.ipaddr || x.tag == self.jobsTag;
        }).sort(function(a,b) { return a.mtime - b.mtime });

        core.forEachSeries(rows, function(row, next) {
            // Cleanup expired records
            if (row.etime && row.etime < now) {
                return db.del('bk_queue', row, function() { next() });
            }
            self.scheduleJob(row, function(err, del) {
                if (del) return db.del('bk_queue', row, function() { next() });
                next();
            });
        }, function() {
            if (rows.length) logger.log('processQueue:', rows.length, 'jobs');
            if (callback) callback();
        });
    });
}

