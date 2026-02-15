/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const path = require('path');
const app = require(__dirname + '/../app');
const api = require(__dirname + '/../api');
const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');
const spawn = require('child_process').spawn;

/**
 * Watches source files for changes and triggers server restarts and/or web rebuilds.
 *
 * This module is meant for development use. It sets up filesystem watchers on:
 *
 * 1) Backend/module sources (server-side JS):
 *    - Adds BackendJS core directory (`libdir`) and `<cwd>/modules`
 *    - Adds all configured module paths from `app.path.modules` (deduped)
 *    - Watches **recursive** `*.js` changes (ignoring `mod.ignore`)
 *    - On change, calls the internal restart handler (`_restart`) to restart the process
 *
 * 2) Web/source assets (client-side files), only when `mod.build` is configured:
 *    - Builds a unique set of web roots including:
 *      - `app.cwd`
 *      - `<backendjs>/../web`
 *      - Any directories listed in `mod.web`
 *        - If an entry is absolute: watch it as-is
 *        - If relative: apply it to every package in `app.packages` (e.g. `web/js`)
 *    - Watches **recursive** files matching `mod.match` (default: `.js|.css|.html`)
 *      while ignoring `mod.ignore` (default ignores `*.bundle.(js|css)`)
 *    - On change, calls the internal rebuild handler (`_rebuild`) which runs the build command
 *
 * Additional behavior:
 * - If `app.repl.watcherPort` is set, starts a REPL on that port (for dev introspection).
 * - Uses `mod.delay` to debounce rapid save bursts (handled by the restart/build handlers).
 * - Logs what it is watching and what build command is used.
 * - Finally calls `startProcess()` to launch/ensure the watched process is running.
 *
 * @module watcher
 */

 const mod = {
    name: "watcher",
    args: [
        { name: "dir", type: "list", array: 1, descr: "Watch sources directories for file changes to restart the server, for development only, the backend module files will be added to the watch list automatically, so only app specific directores should be added." },
        { name: "ignore", type: "regexp", descr: "Files to be ignored by the watcher" },
        { name: "match", type: "regexp", descr: "Files to be watched, .js and .css is the default" },
        { name: "web", type: "list", array: 1, descr: "List of directories to be watched for file modifications and execute a `watcher-build` command to produce bundles, apps, etc... Relative paths will be applied to all packages, example: web/js,web/css" },
        { name: "build", descr: "Command to run on web files modifications, to be used with tools like esbuild/uglify, changed file is appended to the build command" },
        { name: "mode", descr: "How to serialize web build launches for multiple files chnaged at the same time, if empty run one build per file, `dir` to run every launch per config directory, `dir1` to run by next top dir, `dir3` to run by thid directory from the file...." },
        { name: "delay", type: "int", descr: "Delay in ms before triggering restart/build to allow multiple files saved" },
        { name: "no-restart", type: "bool", descr: "Do not restart any processes terminated, for debugging crashes only" },
    ],

    dir: [],
    web: ["web"],
    match: /\.(js|css|html)$/,
    ignore: /.bundle.(js|css)$/,
    delay: 250,
    _web: {},
};

/**
 * Watch the sources for changes and restart the server
 */

module.exports = mod;

mod.start = function()
{
    if (app.repl.watcherPort) {
        app.startRepl(app.repl.watcherPort, app.repl.bind);
    }

    // Backend modules watcher
    var libdir = path.resolve(__dirname + "/..");
    this.dir.push(libdir, app.cwd + "/modules");

    for (let dir of app.path.modules) {
        dir = path.resolve(dir);
        if (!lib.isFlag(this.dir, dir)) this.dir.push(dir);
    }

    logger.info('startWatcher:', "modules:", String(this.dir));

    for (const root of this.dir) {
        lib.watchFiles({ root, match: /\.js$/, ignore: this.ignore, recursive: true }, _restart, (err) => {
            if (err && err.code != "ENOENT") logger.error("startWatcher:", root, err);
        });
    }

    // Web source files watcher
    if (this.build) {
        var webdirs = {
            [app.cwd]: 1,
            [libdir + "/../web"]: 1,
        };

        for (const dir of this.web) {
            if (path.isAbsolute(dir)) {
                webdirs[path.resolve(dir)] = 1;
            } else {
                for (const p in app.packages) {
                    webdirs[(path.resolve(path.join(app.packages[p].path, dir)))] = 1;
                }
            }
        }

        this.web = Object.keys(webdirs);
        logger.info('startWatcher:', "build:", this.build, "web:", String(this.web), String(this.match), String(this.ignore));

        for (const root of this.web) {
            lib.watchFiles({ root, match: this.match, ignore: this.ignore, recursive: true }, _rebuild, (err) => {
                if (err && err.code != "ENOENT") logger.error("startWatcher:", root, err);
            });
        }
    }
    this.startProcess();
}

// Restart the main process with the same arguments and setup as a monitor for the spawn child
mod.startProcess = function()
{
    this.child = spawn(process.argv[0], process.argv.slice(1).filter((x) => (!["-daemon", "-watch"].includes(x))));

    this.child.on('spawn', () => {
        delete this._restarting;
    });

    this.child.on('error', (err) => {
        delete this._restarting;
        logger.error("startProcess:", app.role, err);
    });

    this.child.stdout.on('data', (data) => {
        if (data) console.log("%s", data.toString().trim());
    });

    this.child.stderr.on('data', (data) => {
        if (data) console.log("%s", data.toString().trim());
    });

    // Restart if dies or exits
    this.child.on('exit', (code, signal) => {
        this._restarting = true;

        logger.log('startProcess:', app.role, 'process terminated:', 'pid:', this.child.pid, 'code:', code, 'signal:', signal);
        if (this.noRestart) return;

        app.killBackend("", "", () => {
            lib.respawn.check(this.startProcess.bind(this));
        });
    });

    process.stdin.pipe(this.child.stdin);

    logger.log('startProcess:', app.role, 'version:', app.version, 'home:', app.home, 'port:', api.port, 'uid:', lib.getuid(), 'pid:', process.pid, 'app:', app.runMode, app.instance);
}

function _restart(file)
{
    if (mod._restarting) return;
    mod._restarting = true;

    setTimeout(() => {
        logger.log('watcher:', 'restarting', mod.child.pid, "file:", file.name);
        if (mod.child) mod.child.kill(); else mod.startProcess();
    }, mod.delay);
}

function _rebuild(file)
{
    if (!file.stat.size) return;
    if (mod._restarting) return;
    if (mod._wtimer) return;

    var mode = path.basename(file.name);
    if (/^dir/.test(mod.buildMode)) {
        var dirs = path.dirname(file.name).split("/");
        mode = dirs.slice(0, -lib.toNumber(mod.buildMode.substr(3)) || dirs.length).join("/");
    }
    if (mod._web[mode]) return;

    mod._web[mode] = file.name;
    mod._wtimer = setTimeout(() => {
        logger.log('watcher:', 'running', mod.buildMode, mode, mod.build, file.name);
        lib.execProcess(mod.build + " " + file.name, (err, stdout, stderr) => {
            delete mod._web[mode];
            delete mod._wtimer;
            if (stdout) console.log(stdout);
            if (stderr) console.error(stderr);
            if (err) console.error(err);
        });
    }, mod.delay);
}
