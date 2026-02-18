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
const api = require(__dirname + '/../api');
const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');

/**
 * Start the application, runs `app.init` before switching to the requested role.
 * The options can be used to set the role instead of command line args: shell, server, watch, api, worker
 * @param {object} options - properties to customize initialization
 * @param {boolean} shell - run the shell process
 * @param {boolean} watch - run the watcher process
 * @param {boolean} nowatch - ignore watcher mode
 * @param {boolean} server - run the main server process with api workers
 * @param {boolean} noserver - ignore server mode
 * @param {boolean} api - run the standalone api process
 * @param {boolean} worker - run the standalone worker process
 * @memberof module:app
 * @method start
 */
app.start = function(options)
{
    process.on('warning', (err) => { logger.warn(app.role, err.type, err.message, err.emiter, err.stack) });
    logger.debug("start:", process.argv);

    // REPL shell
    if (options?.shell || lib.isArg("-shell")) {
        const opts = Object.assign({}, options, { role: "shell" });
        return app.init(opts, (err, opts) => {
            require("../util/shell")(opts);
        });
    }

    // Go to background
    if (lib.isArg("-daemon") && !lib.isArg("-no-daemon")) {
        const opts = Object.assign({}, options, { role: "daemon", nodb: 1, noipc: 1, noconfigure: 1, nomodules: 1, noimport: 1 });
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
        app.exiting = true;
        lib.killWorkers();
    });
    process.once('SIGINT', _onProcessTerminate);
    process.once('SIGTERM', _onProcessTerminate);
    // Reserved for restarting purposes
    process.on('SIGUSR2', lib.noop);

    // Watch monitor for modified source files, for development mode only
    if ((options?.watch && !options?.nowatch) || (lib.isArg("-watch") && !lib.isArg("-no-watch"))) {
        const opts = Object.assign({}, options, { role: "watcher", nodb: 1, noipc: 1, nojobs: 1, noevents: 1, noconfigure: 1, nomodules: 1 });
        const watcher = require("../util/watcher");
        app.addModule(watcher);
        return app.init(opts, (err, opts) => {
            watcher.start(opts);
        });
    }

    // Main server
    if ((options?.server && !options?.noserver) || (lib.isArg("-server") && !lib.isArg("-no-server"))) {
        const wtype = process.env.BKJS_WORKER_TYPE;
        const opts = Object.assign({}, options, { role: cluster.isPrimary ? "server" : wtype == "web" ? "web" : "worker", nomodules: cluster.isPrimary });
        return app.init(opts, (err, opts) => {
            if (cluster.isPrimary) {
                _startServer(opts);
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
        const opts = Object.assign({}, options, { role: "web" });
        return app.init(opts, (err, opts) => {
            _startWeb(opts);
        });
    }

    // Single worker process
    if (options?.worker || lib.isArg("-worker")) {
        const opts = Object.assign({}, options, { role: "worker" });
        return app.init(opts, (err, opts) => {
            _startWorker(opts);
        });
    }

    logger.error("start:", "no server mode specified, need one of the -server, -api, -worker, -shell");
}

/**
 * Shutdown all services, calls the `shutdown` method first and then `shutdownRole` method.
 * @callback [callback]
 * @memberof module:app
 * @method stop
 *
 */
app.stop = function(callback)
{
    app.runMethods("shutdown", { parallel: 1, direct: 1 }, () => {
        app.runMethods("shutdown" + lib.toTitle(app.role || "node"), { parallel: 1, direct: 1 }, () => {
            lib.tryCall(callback);
        });
    });
}

app.astop = async function()
{
    return new Promise((resolve, reject) => {
        app.stop(resolve);
    });
}

// Setup worker environment
function _startServer(options)
{
    if (app.pidFile) {
        fs.writeFile(app.pidFile, String(process.pid), (err) => {
            if (err) logger.error("startServer:", app.pidFile, err)
        });
    }

    modules.ipc.initServer();

    // Arguments passed to the v8 engine
    if (app.workerArgs?.length) process.execArgv = app.workerArgs;

    _logger('startServer:');

    var d = domain.create();
    d.on('error', (err) => { logger.error(app.role + ':', lib.traceError(err)); });
    d.run(() => {
        // Initialize modules that need to run in the server
        app.runMethods("configureServer", options, { direct: 1 }, () => {

            // REPL command prompt over TCP
            if (app.repl.serverPort) {
                app.startRepl(app.repl.serverPort, app.repl.bind);
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
            if (app.repl.webPort && cluster.isPrimary) {
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
        lib.respawn.check(() => { cluster.fork({ "BKJS_WORKER_TYPE": worker.worker_type }) });
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
    app.stop(() => { process.exit(0) });
}

function _logger(prefix, ...args)
{
    logger.log(prefix, app.role, app.roles,
               'id:', app.workerId || process.pid,
               'version:', app.version,
               'home:', app.home,
               'port:', api.port,
               'uid:', lib.getuid(),
               'primary:', app.isPrimary,
               'ip:', app.ipaddr,
               'cpus:', app.maxCPUs + "/" + Math.round(app.totalMem/1024/1024/1024),
               'workers:', app.workers,
               app.instance, ...args);
}
