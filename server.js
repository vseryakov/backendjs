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
var async = require('async');
var printf = require('printf');
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
    crashDelay: 30000,
    crashCount: 3,
    crashTime: null,
    crashEvents: 0,

    // Job waiting for the next avaialble worker
    queue: [],
    // List of jobs a worker is running or all jobs running
    jobs: [],
    // Time of the last update on jobs and workers
    jobTime: 0,
    // Interval between jobs scheduler
    jobsInterval: 0,
    // Schedules cron jobs
    crontab: [],
    // Default jobs host to be executed
    jobsTag: os.hostname().split('.').shift(),

    // Number of workers or web servers to launch
    maxWorkers: 1,
    maxProcesses: 1,
    maxJobs: 1,

    // Options for v8
    nodeArgs: [],
    nodeWorkerArgs: [],

    // How long to be in idle state and shutdown, for use in instances
    idleTime: 120,

    // Config parameters
    args: [{ name: "max-processes", type: "callback", value: function(v) { this.maxProcesses=core.toNumber(v,0,0,0,core.maxCPUs); if(this.maxProcesses<=0) this.maxProcesses=Math.max(1,core.maxCPUs-1) }, descr: "Max number of processes to launch for Web servers, 0 means NumberofCPUs-2" },
           { name: "max-workers", type: "number", min: 1, max: 32, descr: "Max number of worker processes to launch for jobs" },
           { name: "idle-time", type: "number", descr: "If set and no jobs are submitted the backend will be shutdown, for instance mode only" },
           { name: "crash-delay", type: "number", max: 30000, descr: "Delay between respawing the crashed process" },
           { name: "restart-delay", type: "number", max: 30000, descr: "Delay between respawning the server after changes" },
           { name: "log-errors" ,type: "bool", descr: "If true, log crash errors from child processes by the logger, otherwise write to the daemon err-file. The reason for this is that the logger puts everything into one line thus breaking formatting for stack traces." },
           { name: "job", type: "callback", value: "queueJob", descr: "Job specification, JSON encoded as base64 of the job object" },
           { name: "jobs-tag", descr: "This server executes jobs that match this tag, cannot be empty, default is current hostname" },
           { name: "max-jobs", descr: "How many jobs to execute at any iteration, this relates to the bk_jobs queue only" },
           { name: "node-args", type: "list", descr: "Node arguments for spawned processes, for passing v8 options" },
           { name: "node-worker-args", type: "list", descr: "Node arguments for workers, job and web processes, for passing v8 options" },
           { name: "jobs-interval", type: "number", min: 0, descr: "Interval between executing job queue, must be set to enable jobs, 0 disables job processing, seconds, min interval is 60 secs" } ],
};

module.exports = server;

// Start the server process, call the callback to perform some initialization before launchng any server, just after core.init
server.start = function()
{
    var self = this;

    // Mark the time we started for calculating idle times properly
    self.jobTime = core.now();
    process.title = core.name + ": process";
    logger.debug("server: start", process.argv);

    // REPL shell
    if (core.isArg("-shell")) {
        return core.init({ role: "shell" }, function() { self.startShell(); });
    }

    // Go to background
    if (core.isArg("-daemon")) {
        return core.init({ role: "daemon", noInit: 1 }, function() { self.startDaemon(); });
    }

    // Graceful shutdown, kill all children processes
    process.once('exit', function() { self.onexit()  });
    process.once('SIGTERM', function() { self.onkill(); });

    // Watch monitor for modified source files, for development mode only, in production -monitor is used
    if (core.isArg("-watch")) {
        return core.init({ role: "watcher", noInit: 1 }, function() { self.startWatcher(); });
    }

    // Start server monitor, it will watch the process and restart automatically
    if (core.isArg("-monitor")) {
        return core.init({ role: "monitor", noInit: 1 }, function() { self.startMonitor(); });
    }

    // Master server
    if (core.isArg("-master")) {
        return core.init({ role: "master" }, function() { self.startMaster(); });
    }

    // Backend Web server
    if (core.isArg("-web")) {
        return core.init({ role: "web" }, function() { self.startWeb(); });
    }
}

// Start process monitor, running as root
server.startMonitor = function()
{
    process.title = core.name + ': monitor';
    core.role = 'monitor';
    this.startProcess();
}

// Setup worker environment
server.startMaster = function()
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
        if (self.jobsInterval > 0) setInterval(function() { d.run(function() { self.processJobs(); }); }, self.jobsInterval * 1000);

        // Watch temp files
        setInterval(function() { d.run(function() { core.watchTmp("tmp", { seconds: 86400 }) }); }, 43200000);
        setInterval(function() { d.run(function() { core.watchTmp("log", { seconds: 86400*7, ignore: path.basename(core.errFile) + "|" + path.basename(core.logFile) }); }); }, 86400000);

        // Pending requests from local queue
        core.processRequestQueue();
        setInterval(function() { d.run(function() { core.processRequestQueue(); }) }, core.requestQueueInterval || 300000);

        // Maintenance tasks
        setInterval(function() {
            // Submit pending jobs
            self.execJobQueue();

            // Check idle time, if no jobs running for a long time shutdown the server, this is for instance mode mostly
            if (core.instance && self.idleTime > 0 && !Object.keys(cluster.workers).length && core.now() - self.jobTime > self.idleTime) {
                logger.log('startMaster:', 'idle:', self.idleTime);
                self.shutdown();
            }
        }, 30000);

        // API related initialization
        core.context.api.initMasterServer();

        logger.log('startMaster:', 'version:', core.version, 'home:', core.home, 'port:', core.port, 'uid:', process.getuid(), 'gid:', process.getgid(), 'pid:', process.pid)
    } else {
        core.dropPrivileges();
        this.startWorker();
    }
}

// Job worker process
server.startWorker = function()
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
        // Check idle time, exit worker if no jobs submitted
        if (self.idleTime > 0 && !self.jobs.length && core.now() - self.jobTime > self.idleTime) {
            logger.log('startWorker:', 'idle:', self.idleTime);
            process.exit(0);
        }
    }, 30000);

    process.send('ready');

    logger.log('startWorker:', 'id:', cluster.worker.id, 'version:', core.version, 'home:', core.home, 'uid:', process.getuid(), 'gid:', process.getgid(), 'pid:', process.pid);
}

// Create Express server, setup worker environment, call supplied callback to set initial environment
server.startWeb = function(callback)
{
    var self = this;
    var api = core.context.api;

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
            self.getProxyTarget = function() {
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
                var worker = cluster.fork({ BACKEND_PORT: port });
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
            self.server = core.createServer({ port: core.port, bind: core.bind, restart: "web" }, function(req, res) {
                var target = self.getProxyTarget();
                if (target) return self.proxyServer.web(req, res, target);
                res.writeHead(500, "Not ready yet");
                res.end();
            });
            if (core.proxy.ssl) {
                self.sslServer = core.createServer({ ssl: core.ssl, port: core.ssl.port, bind: core.ssl.bind, restart: "web" }, function(req, res) {
                    var target = self.getProxyTarget();
                    if (target) return self.proxyServer.web(req, res, target);
                    res.writeHead(500, "Not ready yet");
                    res.end();
                });
            }
            if (core.ws.port) {
                self.server.on('upgrade', function(req, socket, head) {
                    var target = self.getProxyTarget();
                    if (target) return self.proxyServer.ws(req, socket, head, target);
                    req.close();
                });
                if (self.sslServer) {
                    self.sslServer.on('upgrade', function(req, socket, head) {
                        var target = self.getProxyTarget();
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
        if (self.nodeWorkerArgs.length) process.execArgv = self.nodeWorkerArgs;

        // Create tables and spawn Web workers
        api.initTables(function(err) {
            for (var i = 0; i < self.maxProcesses; i++) self.clusterFork();
        });

        // API related initialization
        api.initWebServer();

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
        logger.log('startWeb:', core.role, 'version:', core.version, 'home:', core.home, 'port:', core.port, 'uid:', process.getuid(), 'gid:', process.getgid(), 'pid:', process.pid)

    } else {
        core.role = 'web';
        process.title = core.name + ": web";

        // Port to listen in case of reverse proxy configuration, all other ports become offsets from the base
        if (core.proxy.port) {
            core.bind = process.env.BACKEND_BIND || core.proxy.bind;
            core.port = core.toNumber(process.env.BACKEND_PORT || core.proxy.port);
            if (core.ssl.port) core.ssl.port = core.port + 100;
            if (core.ws.port) core.ws.port = core.port + 200;
            if (core.socketio.port) core.socketio.port = core.port + 300;
        }

        // REPL command prompt over TCP
        if (core.replPortWeb) self.startRepl(core.replPortWeb + 1 + core.toNumber(cluster.worker.id), core.replBindWeb);

        // Setup IPC communication
        ipc.initClient();

        // Init API environment
        api.init(function(err) {
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

        logger.log('startWeb:', core.role, 'version:', core.version, 'home:', core.home, 'port:', core.port, core.bind, 'uid:', process.getuid(), 'gid:', process.getgid(), 'pid:', process.pid);
    }
}

// Spawn web server from the master as a separate master with web workers, it is used when web and master processes are running on the same server
server.startWebProcess = function()
{
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
       logger.error('startRepl:', port, bind, err);
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
server.startShell = function()
{
    var db = core.context.db;
    var api = core.context.api;

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
            if (process.argv[i - 1][0] != '-' && process.argv[i][0] != '-') query[process.argv[i - 1]] = process.argv[i];
        }
        return query;
    }

    api.initTables(function(err) {
        // Add a user
        if (core.isArg("-account-add")) {
            var query = getQuery();
            if (query.login && !query.name) query.name = query.login;
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
    if (!options) options = {};

    if (!options.master) {
        options.running = options.stime = options.etime = options.id = 0;
        core.context.aws.getInstanceInfo(function() {
            setInterval(function() {
                core.sendRequest({ url: options.host + '/ping/' + core.instanceId + '/' + options.id }, function(err, params) {
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
                            core.runTest(core.context[name[0]], name[1], options);
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
    app.use(function(req, res, next) { return core.context.api.checkQuery(req, res, next); });
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
    if (this.exiting) return;
    var self = this;
    var now = Date.now;
    if (self.crashTime && now - self.crashTime < self.crashInterval*(self.crashCount+1)) {
        if (self.crashCount && this.crashEvents >= this.crashCount) {
            logger.log('respawn:', 'throttling for', self.crashDelay, 'after', self.crashEvents, 'crashes in ', now - this.crashTime, 'ms');
            self.crashEvents = 0;
            self.crashTime = now;
            return setTimeout(callback, self.crashDelay);
        }
        self.crashEvents++;
    } else {
        self.crashEvents = 0;
    }
    self.crashTime = now;
    setTimeout(callback, self.crashInterval);
}

// Start new process reusing global process arguments, args will be added and args in the skip list will be removed
server.spawnProcess = function(args, skip, opts)
{
    if (this.exiting) return;
    // Arguments to skip when launchng new process
    if (!skip) skip = [];
    skip.push("-daemon");
    skip.push("-watch");
    skip.push("-monitor");
    // Remove arguments we should not pass to the process
    var argv = this.nodeArgs.concat(process.argv.slice(1).filter(function(x) { return skip.indexOf(x) == -1; }));
    if (Array.isArray(args)) argv = argv.concat(args);
    logger.debug('spawnProcess:', argv, 'skip:', skip);
    return spawn(process.argv[0], argv, opts);
}

// Run all jobs from the job spec at the same time, when the last job finishes and it is running in the worker process, the process terminates.
server.runJob = function(job)
{
    var self = this;

    for (var name in job) {
        // Skip special objects
        if (job[name] instanceof domain.Domain) continue;

        // Make report about unknown job, leading $ are used for same method miltiple times in the same job because property names are unique in the objects
        var spec = name.replace(/^[\$]+/g, "").split('.');
        var obj = spec[0] == "core" ? core : core.context[spec[0]];
        if (!obj || !obj[spec[1]]) {
            logger.error('runJob:', "unknown method", name, 'job:', job);
            continue;
        }

        // Pass as first argument the options object, then callback
        var args = [ core.typeName(job[name]) == "object" ? job[name] : {} ];

        // The callback to finalize job execution
        (function (jname) {
            args.push(function(err) {
                self.jobTime = core.now();
                // Update process title with current job list
                var idx = self.jobs.indexOf(jname);
                if (idx > -1) self.jobs.splice(idx, 1);
                if (cluster.isWorker) process.title = core.name + ': worker ' + self.jobs.join(',');

                logger.debug('runJob:', 'finished', jname, err || "");
                if (!self.jobs.length && cluster.isWorker) process.exit(0);
            });
        })(name);

        var d = domain.create();
        d.on("error", args[1]);
        d.run(function() {
            obj[spec[1]].apply(obj, args);
            self.jobTime = core.now();
            self.jobs.push(name);
            if (cluster.isWorker) process.title = core.name + ': worker ' + self.jobs.join(',');
            logger.debug('runJob:', 'started', name, job[name] || "");
        });
    }
    // No jobs started or errors, just exit
    if (!self.jobs.length && cluster.isWorker) process.exit(0);
}

// Execute job in the background by one of the workers, object must be known exported module
// and method must be existing method of the given object. The method function must take options
// object as its first argument and callback as its second argument.
// More than one job can be specified, property of the object defines name for the job to run:
// Example: { 'scraper.run': {}, 'server.shutdown': {} }
// If the same object.method must be executed several times, prepend subsequent jobs with $
// Example: { 'scraper.run': { "arg": 1 }, '$scraper.run': { "arg": 2 }, '$$scraper.run': { "arg": 3 } }
// Supported options by the server:
// - runalways - no checks for existing job wth the same name should be done
// - runlast - run when no more pending or running jobs
// - runafter - specifies another job in canoncal form obj.method which must finish and not be pending in
//   order for this job to start, this implements chaining of jobs to be executed one after another
//   but submitted at the same time
//   Exampe: submit 3 jobs to run sequentially:
//                'scraper.import'
//                { 'scraper.sync': { runafter: 'scraper.import' } }
//                { 'server.shutdown': { runafter: 'scraper.sync' } }
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
    if (self.nodeWorkerArgs) process.execArrgv = self.nodeWorkerArgs;

    self.jobTime = core.now();
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
    self.jobTime = core.now();
    logger.log('launchJob:', job, 'options:', options);

    // Common arguments for remote workers
    var args = ["-master", "-instance",
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
    if (typeof options.InstanceInitiatedShutdownBehavior == "undefined") options.InstanceInitiatedShutdownBehavior = "terminate";

    aws.runInstances(options, callback);
    return true;
}

// Run a job, the string is in the format:
// object/method/name/value/name/value....
// All spaces must be are replaced with %20 to be used in command line parameterrs
server.queueJob = function(job)
{
    if (!job) return;
    switch (core.typeName(job)) {
    case "object":
        this.queue.push(job);
        break;

    case "string":
    	var o = core.base64ToJson(job);
    	if (!o) logger.error('queueJob:', 'invalid job', job);
    	this.queue.push(o);
        break;
    }
}

// Process pending jobs, submit to idle workers
server.execJobQueue = function()
{
    if (!this.queue.length) return;
    var job = this.queue.shift();
    if (!job) return;
    this.execJob(job);
}

// Create a new cron job, for remote jobs additonal property args can be used in the cron object to define
// arguments to the instance backend process, properties must start with -
//
// Example:
//
//          { "type": "server", "cron": "0 */10 * * * *", "job": "server.processJobs" },
//          { "type": "local", "cron": "0 10 7 * * *", "id": "processQueue", "job": "api.processQueue" }
//          { "type": "remote", "cron": "0 5 * * * *", "args": { "-workers": 2 }, "job": { "scraper.run": { "url": "host1" }, "$scraper.run": { "url": "host2" } } }
server.scheduleCronjob = function(spec, obj)
{
    var self = this;
    var job = self.checkJob('local', obj.job);
    if (!job) return;
    logger.debug('scheduleCronjob:', spec, obj);
    var cj = new cron.CronJob(spec, function() {
        if (this.job.host && !this.job.id && !this.job.tag) {
            self.submitJob({ type: this.job.type, host: this.job.host, job: this.job.job });
        } else {
            self.doJob(this.job.type, this.job.job, this.job.args);
        }
        // Remove from the jobs queue on launch
        if (this.job.id && this.job.tag) {
            db.del('bk_jobs', this.job, function() { next() });
        }
    }, null, true);
    cj.job = { type: obj.type, host: obj.host, id: obj.id, tag: obj.tag, args: obj.args, job: job };
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
    this.crontab.forEach(function(x) {
       if (x.job && x.job.id == id) x._callback();
    });
}

// Perform execution according to type
server.doJob = function(type, job, options)
{
    var self = this;
    switch (type) {
    case 'remote':
        setImmediate(function() { self.launchJob(job, options); });
        break;

    case "server":
        setImmediate(function() {
            var d = domain.create();
            d.on('error', function(err) { logger.error('doJob:', job, err.stack); });
            d.add(job);
            d.run(function() { self.runJob(job); });
        });
        break;

    default:
        setImmediate(function() { self.queueJob(job); });
        break;
    }
}

// Verify job structure and permissions and return as an object if the job is a string
server.checkJob = function(type, job)
{
    if (typeof job == "string") job = core.newObj(job, null);
    if (typeof job != "object") return null;
    if (!Object.keys(job).length) return null;
    return core.cloneObj(job);
}

// Load crontab from JSON file as list of job specs:
// - type - local, remote, server
//      - local means spawn a worker to run the job function
//      - remote means launch an AWS instance
//      - server means run inside the master process, do not spawn a worker
// - cron - cron time interval spec: 'second' 'minute' 'hour' 'dayOfMonth' 'month' 'dayOfWeek'
// - job - a string as obj.method or an object with job name as property name and the value is an object with
//         additional options for the job passed as first argument, a job callback always takes options and callback as 2 arguments
// - args - additional arguments passwed to the backend in the command line for the remote jobs
//
// Example:
//
//          [ { "type": "local", cron: "0 0 * * * *", job: "scraper.run" }, ..]
server.loadSchedules = function()
{
    var self = this;

    fs.readFile(core.path.etc + "/crontab", function(err, data) {
        if (err || !data || !data.length) return;
        data = data.toString();
        try {
            var list = JSON.parse(data);
            if (Array.isArray(list)) {
                self.crontab.forEach(function(x) { x.stop(); delete x; });
                self.crontab = [];
                list.forEach(function(x) {
                    if (!x.type || !x.cron || !x.job || x.disabled) return;
                    self.scheduleCronjob(x.cron, x);
                });
            }
            logger.log("loadSchedules:", self.crontab.length, "schedules");

        } catch(e) {
            logger.log('loadSchedules:', e, data);
        }
    });

    // Watch config directory for changes
    if (this.cronWatcher) return;
    this.cronWatcher = fs.watch(core.path.etc, function (event, filename) {
        if (filename == "crontab") core.setTimeout(filename, function() { self.loadSchedules(); }, 5000);
    });
}

// Submit job for execution, it will be saved in the server queue and the master will pick it up later
// options can specify:
// - tag - job tag for execution, default is current jobTag, this can be used to run on specified servers only
// - job - an object with job spec
// - type - job type: local, remote, server
server.submitJob = function(options, callback)
{
    var self = this;
    if (!options || core.typeName(options.job) != "object") return logger.error('submitJob:', 'invalid job spec, must be an object:', options);
    logger.debug('submitJob:', options);
    db.put("bk_jobs", { id: options.tag || self.jobsTag, tag: core.hash(options.job), job: options.job, cron: options.cron, args: options.args, type: options.type }, function() {
        if (callback) callback();
    });
}

// Run submitted jobs, usually called from the crontab file in case of shared database, requires connection to the PG database
// To run it from crontab add line(to run every 5 mins):
//          { type: "server", cron: "0 */5 * * * *", job: "server.processJobs" }
server.processJobs = function(options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = {};

    db.select("bk_jobs", { id: this.jobsTag }, { count: this.maxJobs }, function(err, rows) {
        async.forEachSeries(rows, function(row, next) {
            try {
                if (row.job.cron) {
                    self.scheduleCronjob(row.cron, row);
                } else {
                    self.doJob(row.type, row.job);
                }
            } catch(e) {
                logger.error('processJobs:', e, row);
            }
            // Cron jobs will be removed on launch
            if (!row.job.cron) {
                db.del('bk_jobs', row, function() { next() });
            }
        }, function() {
            if (rows.length) logger.log('processJobs:', rows.length, 'jobs');
            if (callback) callback();
        });
    });
}

// Run main server if we execute this as standalone program
if (!module.parent) {
    require('backendjs').server.start();
}

