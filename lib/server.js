//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const cluster = require('cluster');
const domain = require('domain');
const path = require('path');
const fs = require('fs');
const spawn = require('child_process').spawn;
const core = require(__dirname + '/core');
const lib = require(__dirname + '/lib');
const logger = require(__dirname + '/logger');

// The main server class that starts various processes
const server = {
    name: "server",
    // Config parameters
    args: [
        { name: "max-processes", type: "callback", callback: setWorkers },
        { name: "workers", type: "callback", callback: setWorkers, descr: "Max number of processes to launch for Web servers, 0 means `NumberOfCPUs-1`, < 0 means `NumberOfCPUs*abs(N)`" },
        { name: "crash-delay", type: "number", max: 30000, obj: "crash", descr: "Delay between respawing the crashed process" },
        { name: "restart-delay", type: "number", max: 30000, descr: "Delay between respawning the server after changes" },
        { name: "no-restart", type: "bool", descr: "Do not restart any processes terminated, for debugging crashes only" },
        { name: "log-errors" , type: "bool", descr: "If true, log crash errors from child processes by the logger, otherwise write to the daemon err-file. The reason for this is that the logger puts everything into one line thus breaking formatting for stack traces." },
        { name: "process-name", descr: "Path to the command to spawn by the monitor instead of node, for external processes guarded by this monitor" },
        { name: "process-args", type: "list", re_map: ["%20", " "], descr: "Arguments for spawned processes, for passing v8 options or other flags in case of external processes" },
        { name: "worker-args", type: "list", re_map: ["%20", " "], descr: "Node arguments for workers, job and web processes, for passing v8 options" },
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

    // Number of web workers to launch
    workers: 1,

    // Options for v8
    processArgs: [],
    workerArgs: [],
};

module.exports = server;

function setWorkers(v)
{
    server.workers = lib.toNumber(v, { min: -32, max: 32 });
    if (!server.workers) server.workers = Math.max(1, core.maxCPUs - 1);
    if (server.workers < 0) server.workers = Math.abs(server.workers) * core.maxCPUs;
}

// Start the server process, call the callback to perform some initialization before launchng any server, just after core.init
server.start = function()
{
    process.title = core.name + ": process";
    process.on('warning', (err) => { logger.warn(core.role, err.type, err.message, err.emiter, err.stack) });
    logger.debug("start:", process.argv);

    // REPL shell
    if (lib.isArg("-shell")) {
        const opts = { role: "shell" };
        return core.init(opts, (err, opts) => {
            require(__dirname + "/shell").start(opts);
        });
    }

    // Go to background
    if (lib.isArg("-daemon") && !lib.isArg("-no-daemon")) {
        const opts = { role: "daemon", noDb: 1, noIpc: 1, noDns: 1, noConfigure: 1, noLocales: 1, noModules: 1, noPackages: 1, noWatch: 1 };
        return core.init(opts, (err, opts) => {
            server.startDaemon(opts);
        });
    }

    // Graceful shutdown, kill all children processes
    process.once('exit', this.onProcessExit.bind(this));
    process.once('SIGINT', this.onProcessTerminate.bind(this));
    process.once('SIGTERM', this.onProcessTerminate.bind(this));
    // Reserved for restarting purposes
    process.on('SIGUSR2', lib.noop);

    // Watch monitor for modified source files, for development mode only, in production -monitor is used
    if (lib.isArg("-watch") && !lib.isArg("-no-watch")) {
        const opts = { role: "watcher", noDb: 1, noIpc: 1, noDns: 1, noConfigure: 1, noLocales: 1, noModules: 1 };
        core.addModule(require(__dirname + "/watch"));
        return core.init(opts, (err, opts) => {
            core.modules.watch.start(opts);
        });
    }

    // Start server monitor, it will watch the process and restart automatically
    if (lib.isArg("-monitor") && !lib.isArg("-no-monitor")) {
        const opts = { role: "monitor", noDb: 1, noIpc: 1, noDns: 1, noConfigure: 1, noLocales: 1, noModules: 1, noPackages: 1, noWatch: 1 };
        return core.init(opts, (err, opts) => {
            server.startMonitor(opts);
        });
    }

    // Master server
    if (lib.isArg("-master") && !lib.isArg("-no-master")) {
        const opts = { role: cluster.isMaster ? "master" : "worker", noLocales: cluster.isMaster, noModules: cluster.isMaster };
        return core.init(opts, (err, opts) => {
            server.startMaster(opts);
        });
    }

    // Backend Web server, the server makes tables for all configured pools
    if (lib.isArg("-web") && !lib.isArg("-no-web")) {
        const opts = { role: cluster.isMaster ? "server" : "web", noLocales: cluster.isMaster, noModules: cluster.isMaster };
        return core.init(opts, (err, opts) => {
            server.startWebServer(opts);
        });
    }

    // Single web api process
    if (lib.isArg("-api")) {
        return core.init({ role: "web" }, (err, opts) => {
            server.startWebProcess(opts);
        });
    }

    // Single worker process
    if (lib.isArg("-worker")) {
        return core.init({ role: "worker" }, (err, opts) => {
            server.startWorker(opts);
        });
    }

    logger.error("start:", "no server mode specified, need one of the -web, -master, -api, -worker, -shell");
}

// Start process monitor, running as root
server.startMonitor = function(options)
{
    if (!cluster.isMaster) return;

    process.title = core.name + ': monitor';
    core.role = 'monitor';
    server.writePidfile();

    // Be careful about adding functionality to the monitor, it is supposed to just watch the process and restart it
    core.runMethods("configureMonitor", options, { direct: 1 }, () => {
        server.startProcess();
    });
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
            core.modules.ipc.initServer();

            // REPL command prompt over TCP
            if (core.repl.masterPort) core.startRepl(core.repl.masterPort, core.repl.bind);

            // Log watcher job, always runs even if no email configured, if enabled it will
            // start sending emails since the last checkpoint, not from the beginning
            server.watchLogsInterval = setInterval(core.watchLogs.bind(core), 5000);

            // Cleanup temp files
            for (const p in core.tmpWatcher) {
                if (!core.tmpWatcher[p].path) core.tmpWatcher[p].path = p;
                server[p + "WatcherInterval"] = setInterval(core.watchTmp.bind(core, core.tmpWatcher[p]), 3600000);
            }

            // Send restart to all workers
            process.on('SIGUSR2', function() {
                core.modules.ipc.sendMsg("worker:restart");
            });

            // Initialize modules that need to run in the master
            core.runMethods("configureMaster", options, { direct: 1 }, () => {
                // Start other master processes
                if (!core.noWeb) server.startWebMaster();
                logger.log('startMaster:', 'version:', core.version, 'home:', core.home, 'port:', core.port, 'uid:', lib.getuid(), 'app:', core.appName, core.runMode, core.instance);
            });
        });
    } else {
        this.startWorker(options);
    }
}

// Create Express server, setup worker environment, call supplied callback to set initial environment
server.startWebServer = function(options)
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

            // Restart if any worker dies, keep the worker pool alive
            cluster.on("exit", function(worker, code, signal) {
                var nworkers = Object.keys(cluster.workers).length;
                logger.log('startWeb:', core.role, 'process terminated:', worker.id, 'pid:', worker.process.pid || "", "code:", code || "", 'signal:', signal || "", "workers:", nworkers);
                if (server.noRestart) return;
                // Exit when all workers are terminated
                if (server.exiting && !nworkers) process.exit(0);
                lib.checkRespawn(() => { cluster.fork() });
            });

            // Graceful restart of all web workers
            process.on('SIGUSR2', function() {
                core.modules.ipc.sendMsg("api:restart");
            });

            // Arguments passed to the v8 engine
            if (server.workerArgs.length) process.execArgv = server.workerArgs;

            // Initialize server environment for other modules
            core.runMethods("configureServer", options, { direct: 1 }, () => {
                // Spawn web worker processes
                for (var i = 0; i < server.workers; i++) cluster.fork();

                logger.log('startWeb:', core.role, 'version:', core.version, 'home:', core.home, 'port:', core.port, 'uid:', lib.getuid(), 'app:', core.appName, core.runMode, core.instance);
            });
        });
    } else {
        this.startWebProcess(options);
    }
}

// Spawn web server from the master as a separate master with web workers, it is used when web and master processes are running on the same server
server.startWebMaster = function()
{
    var child = this.spawnProcess([ "-web" ], [ "-master" ], { stdio: 'inherit' });
    this.handleChildProcess(child, "web", "startWebMaster");
}

server.startWebProcess = function(options)
{
    core.role = 'web';
    process.title = core.name + ": web";

    // Setup IPC communication
    core.modules.ipc.initWorker();

    // Init API environment
    core.modules.api.init(options, function(err) {
        lib.dropPrivileges(core.uid, core.gid);
    });

    logger.log('startWeb:', core.role, 'id:', cluster.isMaster ? process.pid : cluster.worker.id, 'version:', core.version, 'home:', core.home, 'port:', core.port, core.bind, 'repl:', core.repl.portWeb, 'uid:', lib.getuid(), 'app:', core.appName, core.runMode, core.instance);
}

server.startWorker = function(options)
{
    core.role = 'worker';
    process.title = core.name + ': worker';

    lib.dropPrivileges(core.uid, core.gid);

    core.runMethods("configureWorker", options, { direct: 1 }, () => {
        core.modules.ipc.sendMsg("worker:ready", { id: cluster.isMaster ? process.pid : cluster.worker.id });

        logger.log('startWorker:', 'id:', cluster.isMaster ? process.pid : cluster.worker.id, 'version:', core.version, 'home:', core.home, 'uid:', lib.getuid(), 'app:', core.appName, core.runMode, core.instance);
    });
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
        core.killBackend(type, "SIGKILL", () => {
            lib.checkRespawn(server[method].bind(server));
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
        core.killBackend("", "", () => {
            lib.checkRespawn(server.startProcess.bind(server));
        });
    });
    process.stdin.pipe(this.child.stdin);
    logger.log('startProcess:', core.role, 'version:', core.version, 'home:', core.home, 'port:', core.port, 'uid:', lib.getuid(), 'pid:', process.pid, 'app:', core.appName, core.runMode, core.instance);
}


// Create daemon from the current process, restart node with -daemon removed in the background
server.startDaemon = function()
{
    // Avoid spawning loop, skip daemon flag
    var argv = process.argv.slice(1).filter((x) => (x != "-daemon"));
    var log = "ignore";

    // Rotate if the file is too big, keep 2 files but big enough to be analyzed in case the logwatcher is not used
    var st = lib.statSync(core.errFile);
    if (st.size > 1024*1024*100) {
        fs.rename(core.errFile, core.errFile + ".old", (err) => { logger.error('rotate:', err) });
    }
    try { log = fs.openSync(core.errFile, 'a'); } catch (e) { logger.error('startDaemon:', e); }

    // Allow clients to write to it otherwise there will be no messages written if no permissions
    lib.chownSync(core.uid, core.gid, core.errFile);

    spawn(process.argv[0], argv, { stdio: [ 'ignore', log, log ], detached: true });
    process.exit(0);
}

// Kill all child processes on exit
server.onProcessExit = function()
{
    this.exiting = core.exiting = true;
    if (this.child) try { this.child.kill(); } catch (e) {}
    for (const pid in this.pids) { try { process.kill(pid) } catch (e) {} }
}

// Terminates the server process, it is called on SIGTERM signal but can be called manually for graceful shitdown,
// it runs `shutdown[Role]` methods before exiting
server.onProcessTerminate = function()
{
    this.exiting = core.exiting = true;
    core.runMethods("shutdown" + lib.toTitle(core.role || "process"), { direct: 1 }, () => {
        process.exit(0);
    });
}

// Graceful shutdown if the api server needs restart
server.shutdownServer = function(options, callback)
{
    setTimeout(() => { process.exit(0) }, 30000);
    logger.log('web server: shutdown started');
    for (const p in cluster.workers) try { process.kill(cluster.workers[p].process.pid); } catch (e) {}
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
    var argv = this.processArgs.concat(process.argv.slice(1).filter((x) => (skip.indexOf(x) == -1)));
    if (Array.isArray(args)) argv = argv.concat(args);
    var cmd = this.processName || process.argv[0];
    logger.debug('spawnProcess:', cmd, argv, 'skip:', skip, 'opts:', opts);
    return spawn(cmd, argv, opts);
}

// Create a pid file for the current process
server.writePidfile = function()
{
    fs.writeFile(path.join(core.path.var, core.role + ".pid"), String(process.pid), (err) => { if (err) logger.error("writePidfile:", err) });
}

