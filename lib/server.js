//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var cluster = require('cluster');
var domain = require('domain');
var path = require('path');
var util = require('util');
var url = require('url');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;
var exec = require('child_process').exec;
var core = require(__dirname + '/core');
var lib = require(__dirname + '/lib');
var logger = require(__dirname + '/logger');

// The main server class that starts various processes
var server = {
    // Config parameters
    args: [{ name: "max-processes", type: "callback", callback: function(v) { this.maxProcesses=lib.toNumber(v,{min:-16,max:16}); if(!this.maxProcesses)this.maxProcesses=Math.max(1,core.maxCPUs-1); if(this.maxProcesses<0) this.maxProcesses=Math.abs(this.maxProcesses)*core.maxCPUs; this._name="maxProcesses" }, descr: "Max number of processes to launch for Web servers, 0 means `NumberOfCPUs-1`, < 0 means `NumberOfCPUs*abs(N)`" },
           { name: "crash-delay", type: "number", max: 30000, obj: "crash", descr: "Delay between respawing the crashed process" },
           { name: "restart-delay", type: "number", max: 30000, descr: "Delay between respawning the server after changes" },
           { name: "no-restart", type: "bool", descr: "Do not restart any processes terminated, for debugging crashes only" },
           { name: "log-errors" ,type: "bool", descr: "If true, log crash errors from child processes by the logger, otherwise write to the daemon err-file. The reason for this is that the logger puts everything into one line thus breaking formatting for stack traces." },
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

    // Number of web workers to launch
    maxProcesses: 1,

    // Options for v8
    processArgs: [],
    workerArgs: [],
};

module.exports = server;

// Start the server process, call the callback to perform some initialization before launchng any server, just after core.init
server.start = function()
{
    process.title = core.name + ": process";
    process.on('warning', function(err) { logger.warn(core.role, err.type, err.message, err.emmiter, err.stack) });
    logger.debug("start:", process.argv);

    // REPL shell
    if (lib.isArg("-shell")) {
        var shell = require(__dirname + "/../modules/bk_shell");
        core.addModule("shell", shell);
        return core.init({ role: "shell" }, function(err, opts) { shell.runShell(opts); });
    }

    // Go to background
    if (lib.isArg("-daemon") && !lib.isArg("-no-daemon")) {
        var opts = { role: "daemon", noDb: 1, noDns: 1, noConfigure: 1, noLocales: 1, noModules: 1, noWatch: 1 };
        return core.init(opts, function(err, opts) {
            server.startDaemon(opts);
        });
    }

    // Graceful shutdown, kill all children processes
    process.once('exit', function() { server.onProcessExit()  });
    process.once('SIGTERM', function() { server.onProcessTerminate(); });
    // Reserved for restarting purposes
    process.on('SIGUSR2', function() {});

    // Watch monitor for modified source files, for development mode only, in production -monitor is used
    if (lib.isArg("-watch") && !lib.isArg("-no-watch")) {
        var opts = { role: "watcher", noDb: 1, noDns: 1, noConfigure: 1, noLocales: 1, noModules: 1, noWatch: 1 };
        return core.init(opts, function(err, opts) {
            server.startWatcher(opts);
        });
    }

    // Start server monitor, it will watch the process and restart automatically
    if (lib.isArg("-monitor") && !lib.isArg("-no-monitor")) {
        var opts = { role: "monitor", noDb: 1, noDns: 1, noConfigure: 1, noLocales: 1, noModules: 1, noWatch: 1 };
        return core.init(opts, function(err, opts) {
            server.startMonitor(opts);
        });
    }

    // Master server, always create tables in the masters processes but only for the primary db pools
    if (lib.isArg("-master") && !lib.isArg("-no-master")) {
        var opts = { role: cluster.isMaster ? "master" : "worker", localTables: cluster.isMaster && !lib.isArg("-db-create-tables"), noLocales: cluster.isMaster };
        return core.init(opts, function(err, opts) {
            server.startMaster(opts);
        });
    }

    // Backend Web server, the server makes table for all configured pools
    if (lib.isArg("-web") && !lib.isArg("-no-web")) {
        var opts = { role: cluster.isMaster ? "server" : "web", localTables: cluster.isMaster && !lib.isArg("-db-create-tables"), noLocales: cluster.isMaster };
        return core.init(opts, function(err, opts) {
            server.startWeb(opts);
        });
    }
    logger.error("start:", "no server mode specified, need one of the -web, -master, -shell");
}

// Start process monitor, running as root
server.startMonitor = function(options)
{
    if (cluster.isMaster) {
        process.title = core.name + ': monitor';
        core.role = 'monitor';
        server.writePidfile();

        // Be careful about adding functionality to the monitor, it is supposed to just watch the process and restart it
        core.runMethods("configureMonitor", options, function() {
            server.startProcess();
        });
    }
}

// Setup worker environment
server.startMaster = function(options)
{
    if (cluster.isMaster) {
        core.role = 'master';
        process.title = core.name + ': master';
        server.writePidfile();

        var d = domain.create();
        d.on('error', function(err) { logger.error('master:', lib.traceError(err)); });
        d.run(function() {
            // REPL command prompt over TCP
            if (core.repl.masterPort) core.startRepl(core.repl.masterPort, core.repl.bind);

            // Log watcher job, always runs even if no email configured, if enabled it will
            // start sending emails since the last checkpoint, not from the beginning
            server.watchLogsInterval = setInterval(core.watchLogs.bind(core), core.logwatcherInterval * 60000);

            // Watch temp files
            for (var p in core.tmpWatcher) {
                server[p + "WatcherInterval"] = setInterval(function() {
                    core.watchTmp(p, { seconds: core.tmpWatcher[p], ignore: path.basename(core.errFile) + "|" + path.basename(core.logFile) });
                }, 3600000);
            }

            // Initialize modules that need to run in the master
            core.runMethods("configureMaster", options, function() {
                // Start other master processes
                if (!core.noWeb) server.startWebProcess();
                logger.log('startMaster:', 'version:', core.version, 'home:', core.home, 'port:', core.port, 'uid:', process.getuid(), 'gid:', process.getgid(), lib.objDescr(core.instance));
            });
        });
    } else {
        core.dropPrivileges();
        core.role = 'worker';
        process.title = core.name + ': worker';

        core.runMethods("configureWorker", options, function() {
            core.modules.ipc.sendMsg("worker:ready", { id: cluster.worker.id });

            logger.log('startWorker:', 'id:', cluster.worker.id, 'version:', core.version, 'home:', core.home, 'uid:', process.getuid(), 'gid:', process.getgid(), lib.objDescr(core.instance));
        });
    }
}

// Create Express server, setup worker environment, call supplied callback to set initial environment
server.startWeb = function(options)
{
    process.on("uncaughtException", function(err) {
        logger.error('fatal:', core.role, lib.traceError(err));
        server.onProcessTerminate();
    });

    if (cluster.isMaster) {
        core.role = 'server';
        process.title = core.name + ': server';
        server.writePidfile();

        var d = domain.create();
        d.on('error', function(err) { logger.error(core.role + ':', lib.traceError(err)); });
        d.run(function() {
            // Setup IPC communication
            core.modules.ipc.initServer();

            // REPL command prompt over TCP
            if (core.repl.serverPort) core.startRepl(core.repl.serverPort, core.repl.bind);

            // In proxy mode we maintain continious sequence of ports for each worker starting with core.proxy.port
            if (core.proxy.port) {
                core.modules.api.createProxyServer();
                server.clusterFork = core.modules.api.createProxyWorker.bind(core.modules.api);
            } else {
                server.clusterFork = function() { return cluster.fork(); }
            }

            // Restart if any worker dies, keep the worker pool alive
            cluster.on("exit", function(worker, code, signal) {
                var nworkers = Object.keys(cluster.workers).length;
                logger.log('startWeb:', core.role, 'process terminated:', worker.id, 'pid:', worker.process.pid || "", "code:", code || "", 'signal:', signal || "", "workers:", nworkers);
                if (server.noRestart) return;
                // Exit when all workers are terminated
                if (server.exiting && !nworkers) process.exit(0);
                server.respawn(function() {
                    server.clusterFork();
                });
            });

            // Graceful shutdown if the server needs restart
            server.onProcessTerminate = function() {
                server.exiting = true;
                setTimeout(function() { process.exit(0); }, 30000);
                logger.log('web server: shutdown started');
                for (var p in cluster.workers) try { process.kill(cluster.workers[p].process.pid); } catch(e) {}
            }

            // Graceful restart of all web workers
            process.on('SIGUSR2', function() {
                core.modules.ipc.sendMsg("api:restart");
            });

            // Arguments passed to the v8 engine
            if (server.workerArgs.length) process.execArgv = server.workerArgs;

            // Initialize server environment for other modules
            core.runMethods("configureServer", options, function() {
                // Spawn web worker processes
                for (var i = 0; i < server.maxProcesses; i++) server.clusterFork();

                logger.log('startWeb:', core.role, 'version:', core.version, 'home:', core.home, 'port:', core.port, 'uid:', process.getuid(), 'gid:', process.getgid(), lib.objDescr(core.instance))
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

        // Setup IPC communication
        core.modules.ipc.initWorker();

        // Init API environment
        core.modules.api.init(options, function(err) {
            core.dropPrivileges();

            // Gracefull termination of the process
            server.onProcessTerminate = function() {
                server.exiting = true;
                core.modules.api.shutdown(function() {
                    process.exit(0);
                });
            }
        });

        logger.log('startWeb:', core.role, 'id:', cluster.worker.id, 'version:', core.version, 'home:', core.home, 'port:', core.port, core.bind, 'repl:', core.repl.portWeb, 'uid:', process.getuid(), 'gid:', process.getgid(), lib.objDescr(core.instance));
    }
}

// Spawn web server from the master as a separate master with web workers, it is used when web and master processes are running on the same server
server.startWebProcess = function()
{
    var child = this.spawnProcess([ "-web" ], [ "-master" ], { stdio: 'inherit' });
    this.handleChildProcess(child, "web", "startWebProcess");
}

// Setup exit listener on the child process and restart it
server.handleChildProcess = function(child, type, method)
{
    this.pids[child.pid] = 1;
    child.on('exit', function (code, signal) {
        delete server.pids[this.pid];
        logger.log('handleChildProcess:', core.role, 'process terminated:', type, 'pid:', this.pid, 'code:', code, 'signal:', signal);
        if (server.noRestart) return;
        // Make sure all web servers are down before restarting to avoid EADDRINUSE error condition
        core.killBackend(type, "SIGKILL", function() {
            server.respawn(function() { server[method](); });
        });
    });
    child.unref();
}

// Restart the main process with the same arguments and setup as a monitor for the spawn child
server.startProcess = function()
{
    this.child = this.spawnProcess();
    // Pass child output to the console
    this.child.stdout.on('data', function(data) {
        if (server.logErrors) logger.log(data); else if (data) console.log("%s", data.toString().trim());
    });
    this.child.stderr.on('data', function(data) {
        if (server.logErrors) logger.error(data); else if (data) console.log("%s", data.toString().trim());
    });
    // Restart if dies or exits
    this.child.on('exit', function(code, signal) {
        logger.log('startProcess:', core.role, 'process terminated:', 'pid:', server.child.pid, 'code:', code, 'signal:', signal);
        if (server.noRestart) return;
        core.killBackend("", "", function() {
            server.respawn(function() {
                server.startProcess();
            });
        });
    });
    process.stdin.pipe(this.child.stdin);
    logger.log('startProcess:', core.role, 'version:', core.version, 'home:', core.home, 'port:', core.port, 'uid:', process.getuid(), 'gid:', process.getgid(), 'pid:', process.pid);
}

// Watch source files for modifications and restart
server.startWatcher = function()
{
    core.role = 'watcher';
    process.title = core.name + ": watcher";

    // REPL command prompt over TCP instead of the master process
    if (core.repl.port && (!lib.isArg("-master") || lib.isArg("-no-master"))) core.startRepl(core.repl.port, core.repl.bind);

    if (core.watchdirs.indexOf(__dirname) == -1) core.watchdirs.push(__dirname, __dirname + "/../modules");
    if (core.watchdirs.indexOf(core.path.modules) == -1) core.watchdirs.push(core.path.modules);
    logger.debug('startWatcher:', core.watchdirs);
    core.watchdirs.forEach(function(dir) {
        core.watchFiles(dir, /\.js$/, function(file) {
            if (server.watchTimer) clearTimeout(server.watchTimer);
            server.watchTimer = setTimeout(function() {
                logger.log('watcher:', 'restarting', server.child.pid);
                if (server.child) server.child.kill(); else server.startProcess();
            }, server.restartDelay);
        });
    });
    this.startProcess();
}

// Create daemon from the current process, restart node with -daemon removed in the background
server.startDaemon = function()
{
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
server.onProcessExit = function()
{
    this.exiting = true;
    if (this.child) try { this.child.kill(); } catch(e) {}
    for (var pid in this.pids) { try { process.kill(pid) } catch(e) {} };
}

// Terminates the server process, it is called on SIGTERM signal but can be called manually for graceful shitdown,
// it runs `shutdown[Role]` methods before exiting
server.onProcessTerminate = function()
{
    this.exiting = true;
    core.runMethods("shutdown" + lib.toTitle(core.role), function() {
        process.exit(0);
    });
}

// Create a pid file for the current process
server.writePidfile = function()
{
    fs.writeFile(path.join(core.path.spool, core.role + ".pid"), process.pid, function(err) { if (err) logger.error("writePidfile:", err) });
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
    var now = Date.now();
    logger.debug('respawn:', this.crash, now - this.crash.time);
    if (this.crash.time && now - this.crash.time < this.crash.interval) {
        if (this.crash.count && this.crash.events >= this.crash.count) {
            logger.log('respawn:', 'throttling for', this.crash.delay, 'after', this.crash.events, 'crashes');
            this.crash.events = 0;
            this.crash.time = now;
            return setTimeout(callback, this.crash.delay);
        }
        this.crash.events++;
    } else {
        this.crash.events = 0;
    }
    this.crash.time = now;
    setTimeout(callback, this.crash.timeout);
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
    var argv = this.processArgs.concat(process.argv.slice(1).filter(function(x) { return skip.indexOf(x) == -1; }));
    if (Array.isArray(args)) argv = argv.concat(args);
    var cmd = this.processName || process.argv[0];
    logger.debug('spawnProcess:', cmd, argv, 'skip:', skip, 'opts:', opts);
    return spawn(cmd, argv, opts);
}

