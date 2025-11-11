/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const cluster = require('cluster');
const domain = require('domain');
const fs = require('fs');
const spawn = require('child_process').spawn;
const modules = require(__dirname + '/../modules');
const app = require(__dirname + '/../app');
const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');

/**
 * Start the server process, runs `app.init` before switching to the requested role.
 * The options can be used to set the role instead of command line args: shell, master, watch, api, worker
 * @param {object} options - properties to customize initialization
 * @param {boolean} shell - run the shell process
 * @param {boolean} watch - run the watcher process
 * @param {boolean} nowatch - ignore watcher mode
 * @param {boolean} master - run the master process
 * @param {boolean} nomaster - ignore master mode
 * @param {boolean} api - run the standalone api process
 * @param {boolean} worker - run the standalone worker process
 * @memberof module:app
 * @method start
 */
app.start = function(options)
{
    process.title = app.id + ": process";
    process.on('warning', (err) => { logger.warn(app.role, err.type, err.message, err.emiter, err.stack) });
    logger.debug("start:", process.argv);

    // REPL shell
    if (options?.shell || lib.isArg("-shell")) {
        const opts = { role: "shell" };
        return app.init(opts, (err, opts) => {
            require("../server/shell")(opts);
        });
    }

    // Go to background
    if (lib.isArg("-daemon") && !lib.isArg("-no-daemon")) {
        const opts = { role: "daemon", noDb: 1, noIpc: 1, noConfigure: 1, noModules: 1, noPackages: 1 };
        return app.init(opts, (err, opts) => {
            _startDaemon(opts);
        });
    }

    // Graceful shutdown, kill all children processes
    process.once("uncaughtException", (err) => {
        logger.error('fatal:', app.role, lib.traceError(err));
        _onProcessTerminate();
    });
    process.once('exit', () => {
        this.exiting = app.exiting = true;
        for (const w of Object.values(cluster.workers || "")) {
            try { process.kill(w.process.pid) } catch (e) {}
        }
    });
    process.once('SIGINT', _onProcessTerminate);
    process.once('SIGTERM', _onProcessTerminate);
    // Reserved for restarting purposes
    process.on('SIGUSR2', lib.noop);

    // Watch monitor for modified source files, for development mode only
    if ((options?.watch && !options?.nowatch) || (lib.isArg("-watch") && !lib.isArg("-no-watch"))) {
        const opts = { role: "watcher", noDb: 1, noIpc: 1, noJobs: 1, noConfigure: 1, noModules: 1 };
        const watcher = require("../server/watcher");
        app.addModule(watcher);
        return app.init(opts, (err, opts) => {
            watcher.start(opts);
        });
    }

    // Master server
    if ((options?.master && !options?.nomaster) || (lib.isArg("-master") && !lib.isArg("-no-master"))) {
        const wtype = process.env.BKJS_WORKER_TYPE;
        const opts = { role: cluster.isMaster ? "master" : wtype == "web" ? "web" : "worker", noModules: cluster.isMaster };
        return app.init(opts, (err, opts) => {
            if (cluster.isMaster) {
                _startMaster(opts);
            } else {
                if (wtype == "web") {
                    _startWeb(opts);
                } else {
                    _startWorker(opts);
                }
            }
        });
    }

    // Single web api process
    if (options?.api || lib.isArg("-api")) {
        return app.init({ role: "web" }, (err, opts) => {
            _startWeb(opts);
        });
    }

    // Single worker process
    if (options?.worker || lib.isArg("-worker")) {
        return app.init({ role: "worker" }, (err, opts) => {
            _startWorker(opts);
        });
    }

    logger.error("start:", "no server mode specified, need one of the -master, -api, -worker, -shell");
}

// Setup worker environment
function _startMaster(options)
{
    if (app.pidFile) {
        fs.writeFile(app.pidFile, String(process.pid), (err) => {
            if (err) logger.error("startMaster:", app.pidFile, err)
        });
    }

    modules.ipc.initServer();

    // Arguments passed to the v8 engine
    if (app.workerArgs?.length) process.execArgv = app.workerArgs;

    _logger('startMaster:');

    var d = domain.create();
    d.on('error', (err) => { logger.error(app.role + ':', lib.traceError(err)); });
    d.run(() => {
        // Initialize modules that need to run in the master
        app.runMethods("configureMaster", options, { direct: 1 }, () => {

            // REPL command prompt over TCP
            if (app.repl.masterPort) {
                app.startRepl(app.repl.masterPort, app.repl.bind);
            }

            // Restart if any worker dies, keep the worker pool alive
            cluster.on("exit", _onWorkerExit);

            // Send restart to all workers
            process.on('SIGUSR2', () => {
                modules.ipc.sendMsg(`${app.isOk("web") ? "api" : "worker"}:restart`)
            });

            // Start web workers
            if (app.isOk("web")) {

                var workers = app.workers || Math.round(app.maxCPUs * (app.workerCpuFactor || 1));
                for (let i = 0; i < workers; i++) {
                    var child = cluster.fork({ "BKJS_WORKER_TYPE": "web" });
                    child.worker_type = "web";
                }
                _logger('startWeb:');
            }
        });
    });
}

function _startWeb(options)
{
    // Setup IPC communication
    modules.ipc.initWorker();

    // Init API environment
    setTimeout(() => {
        modules.api.init(options, () => {
            if (app.repl.webPort && cluster.isMaster) {
                app.startRepl(app.repl.webPort, app.repl.bind);
            }
        });
    }, app.workerDelay);

    _logger('startWeb:');
}

function _startWorker(options)
{
    // Setup IPC communication
    modules.ipc.initWorker();

    app.runMethods("configureWorker", options, { direct: 1 }, () => {
        modules.ipc.sendMsg("worker:ready", { id: app.workerId || process.pid });

        _logger('startWorker:');
    });
}

// Create daemon from the current process, restart node with -daemon removed in the background
function _startDaemon()
{
    // Avoid spawning loop, skip daemon flag
    var argv = process.argv.slice(1).filter((x) => (x != "-daemon"));
    var log = "ignore";
    var errFile = app.errFile;

    // Rotate if the file is too big, keep 2 files but big enough to be analyzed in case the logwatcher is not used
    if (errFile) {
        var st = lib.statSync(errFile);
        if (st.size > 1024*1024*100) {
            fs.rename(errFile, errFile + ".old", (err) => { logger.error('rotate:', err) });
        }
        try { log = fs.openSync(errFile, 'a'); } catch (e) { logger.error('startDaemon:', e); }
    }

    spawn(process.argv[0], argv, { stdio: [ 'ignore', log, log ], detached: true });
    process.exit(0);
}

function _onWorkerExit(worker, code, signal)
{
    var nworkers = Object.keys(cluster.workers).length;
    logger.log('onWorkerExit:', app.role, 'process terminated:', worker.worker_type, worker.id, 'pid:', worker.process?.pid, "code:", code, 'signal:', signal, "workers:", nworkers);
    if (app.exiting) return;

    if (!app.noRestart) {
        lib.checkRespawn(() => { cluster.fork({ "BKJS_WORKER_TYPE": worker.worker_type }) });
    } else

    if (app.exitOnEmpty > 0 && !nworkers) {
        logger.log('onWorkerExit:', app.role, "no more workers, exiting in", app.exitOnEmpty, "ms");
        setTimeout(() => { process.kill(process.pid) }, app.exitOnEmpty);
    }
}

/*
 * Terminates the server process, it is called on SIGTERM signal but can be called manually for graceful shutdown,
 * it runs `shutdown[Role]` methods before exiting
 */
function _onProcessTerminate()
{
    app.exiting = true;
    app.runMethods("shutdown" + lib.toTitle(app.role || "process"), { parallel: 1, direct: 1 }, () => {
        process.exit(0);
    });
}

function _logger(prefix, ...args)
{
    logger.log(prefix, app.role, app.roles,
               'id:', app.workerId || process.pid,
               'version:', app.version,
               'home:', app.home,
               'port:', app.port,
               'uid:', lib.getuid(),
               'runMode:', app.runMode,
               'ip:', app.ipaddr,
               'cpus:', app.maxCPUs + "/" + Math.round(app.totalMem/1024/1024/1024),
               'workers:', app.workers,
               app.instance, ...args);
}
