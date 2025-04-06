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
const ipc = require(__dirname + '/ipc');
const api = require(__dirname + '/api');
const logger = require(__dirname + '/logger');

// The main server class that starts various processes
const server = {
    name: "server",
    // Config parameters
    args: [
        { name: "workers", type: "callback", callback: setWorkers, descr: "Max number of web processes to launch, 0 means `NumberOfCPUs-1`, < 0 means `NumberOfCPUs*abs(N)`" },
        { name: "worker-args", type: "list", vreplace: { "%20": " " }, descr: "Node arguments for workers, job and web processes, for passing v8 options, use %20 for spaces" },
        { name: "no-restart", type: "bool", descr: "Do not restart any workers" },
        { name: "exit-on-empty", type: "int", descr: "Duration in ms to exit the server process after last worker terminated" },
    ],

    // Number of web workers to launch
    workers: 1,

    // Options for v8
    workerArgs: [],
};

module.exports = server;

function setWorkers(v)
{
    server.workers = lib.toNumber(v, { min: -32, max: 32 });
    if (!server.workers) server.workers = Math.max(1, core.maxCPUs - 1);
    if (server.workers < 0) server.workers = Math.abs(server.workers) * core.maxCPUs;
}

// Start the server process, run `core.init` before switching to the requested role.
// The options can be used to set the role instead of command line args: shell, master, watch, api, worker
server.start = function(options)
{
    process.title = core.name + ": process";
    process.on('warning', (err) => { logger.warn(core.role, err.type, err.message, err.emiter, err.stack) });
    logger.debug("start:", process.argv);

    // REPL shell
    if (options?.shell || lib.isArg("-shell")) {
        const opts = { role: "shell" };
        return core.init(opts, (err, opts) => {
            require(__dirname + "/shell")(opts);
        });
    }

    // Go to background
    if (lib.isArg("-daemon") && !lib.isArg("-no-daemon")) {
        const opts = { role: "daemon", noDb: 1, noIpc: 1, noConfigure: 1, noLocales: 1, noModules: 1, noPackages: 1, noWatch: 1 };
        return core.init(opts, (err, opts) => {
            this.startDaemon(opts);
        });
    }

    // Graceful shutdown, kill all children processes
    process.once("uncaughtException", (err) => {
        logger.error('fatal:', core.role, lib.traceError(err));
        this.onProcessTerminate();
    });
    process.once('exit', () => {
        this.exiting = core.exiting = true;
        for (const w of Object.values(cluster.workers || "")) {
            try { process.kill(w.process.pid) } catch (e) {}
        }
    });
    process.once('SIGINT', this.onProcessTerminate.bind(this));
    process.once('SIGTERM', this.onProcessTerminate.bind(this));
    // Reserved for restarting purposes
    process.on('SIGUSR2', lib.noop);

    // Watch monitor for modified source files, for development mode only
    if ((options?.watch && !options?.nowatch) || (lib.isArg("-watch") && !lib.isArg("-no-watch"))) {
        const opts = { role: "watcher", noDb: 1, noIpc: 1, noJobs: 1, noConfigure: 1, noLocales: 1, noModules: 1 };
        core.addModule(require(__dirname + "/watch"));
        return core.init(opts, (err, opts) => {
            core.modules.watch.start(opts);
        });
    }

    // Master server
    if ((options?.master && !options?.nomaster) || (lib.isArg("-master") && !lib.isArg("-no-master"))) {
        const wtype = process.env.BKJS_WORKER_TYPE;
        const opts = { role: cluster.isMaster ? "master" : wtype == "web" ? "web" : "worker", noLocales: cluster.isMaster, noModules: cluster.isMaster };
        return core.init(opts, (err, opts) => {
            if (cluster.isMaster) {
                this.startMaster(opts);
            } else {
                if (wtype == "web") {
                    this.startWeb(opts);
                } else {
                    this.startWorker(opts);
                }
            }
        });
    }

    // Single web api process
    if (options?.api || lib.isArg("-api")) {
        return core.init({ role: "web" }, (err, opts) => {
            this.startWeb(opts);
        });
    }

    // Single worker process
    if (options?.worker || lib.isArg("-worker")) {
        return core.init({ role: "worker" }, (err, opts) => {
            this.startWorker(opts);
        });
    }

    logger.error("start:", "no server mode specified, need one of the -master, -api, -worker, -shell");
}

// Setup worker environment
server.startMaster = function(options)
{
    this.writePidfile();

    ipc.initServer();

    // Cleanup temp files
    for (const p in core.tmpWatcher) {
        if (!core.tmpWatcher[p].path) core.tmpWatcher[p].path = p;
        this[p + "WatcherInterval"] = setInterval(core.watchTmp.bind(core, core.tmpWatcher[p]), 3600000);
    }

    // Arguments passed to the v8 engine
    if (this.workerArgs?.length) process.execArgv = this.workerArgs;

    server.logger('startMaster:');

    var d = domain.create();
    d.on('error', (err) => { logger.error(core.role + ':', lib.traceError(err)); });
    d.run(() => {
        // Initialize modules that need to run in the master
        core.runMethods("configureMaster", options, { direct: 1 }, () => {

            // REPL command prompt over TCP
            if (core.repl.masterPort) {
                core.startRepl(core.repl.masterPort, core.repl.bind);
            }

            // Restart if any worker dies, keep the worker pool alive
            cluster.on("exit", this.onWorkerExit.bind(this));

            // Send restart to all workers
            process.on('SIGUSR2', () => {
                ipc.sendMsg(`${core.isOk("web") ? "api" : "worker"}:restart`)
            });

            // Start web workers
            if (core.isOk("web")) {

                for (let i = 0; i < this.workers; i++) {
                    var child = cluster.fork({ "BKJS_WORKER_TYPE": "web" });
                    child.worker_type = "web";
                }
                server.logger('startWeb:');
            }
        });
    });
}

server.startWeb = function(options)
{
    // Setup IPC communication
    ipc.initWorker();

    // Init API environment
    api.init(options, () => {
        lib.dropPrivileges(core.uid, core.gid);

        if (core.repl.apiPort) {
            core.startRepl(core.repl.apiPort, core.repl.bind);
        }

    });

    server.logger('startWeb:');
}

server.startWorker = function(options)
{
    lib.dropPrivileges(core.uid, core.gid);

    // Setup IPC communication
    ipc.initWorker();

    core.runMethods("configureWorker", options, { direct: 1 }, () => {
        ipc.sendMsg("worker:ready", { id: core.workerId || process.pid });

        server.logger('startWorker:');
    });
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

server.onWorkerExit = function(worker, code, signal)
{
    var nworkers = Object.keys(cluster.workers).length;
    logger.log('onWorkerExit:', core.role, 'process terminated:', worker.worker_type, worker.id, 'pid:', worker.process?.pid, "code:", code, 'signal:', signal, "workers:", nworkers);
    if (this.exiting) return;

    if (!this.noRestart) {
        lib.checkRespawn(() => { cluster.fork({ "BKJS_WORKER_TYPE": worker.worker_type }) });
    } else
    if (this.exitOnEmpty && !nworkers) {
        logger.log('onWorkerExit:', core.role, "no more workers, exiting in", this.exitOnEmpty, "ms");
        setTimeout(() => { process.kill(process.pid) }, this.exitOnEmpty);
    }
}

// Terminates the server process, it is called on SIGTERM signal but can be called manually for graceful shutdown,
// it runs `shutdown[Role]` methods before exiting
server.onProcessTerminate = function()
{
    this.exiting = core.exiting = true;
    core.runMethods("shutdown" + lib.toTitle(core.role || "process"), { parallel: 1, direct: 1 }, () => {
        process.exit(0);
    });
}

// Create a pid file for the current process
server.writePidfile = function()
{
    fs.writeFile(path.join(core.path.var, core.role + ".pid"), String(process.pid), (err) => { if (err) logger.error("writePidfile:", err) });
}

server.logger = function(prefix, ...args)
{
    logger.log(prefix, core.role, core.roles,
               'id:', core.workerId || process.pid,
               'version:', core.version,
               'home:', core.home,
               'port:', core.port,
               'uid:', lib.getuid(),
               'app:', core.appName, core.runMode,
               'ip:', core.ipaddr,
               'cpus:', core.maxCPUs + "/" + Math.round(core.totalMem/1024/1024/1024),
               'workers:', this.workers,
               core.instance, ...args);
}
