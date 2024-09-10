//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const path = require('path');
const core = require(__dirname + '/core');
const lib = require(__dirname + '/lib');
const logger = require(__dirname + '/logger');
const spawn = require('child_process').spawn;

// Watch the sources for changes and restart the server
const mod = {
    name: "watch",
    args: [
        { name: "dir", type: "list", array: 1, descr: "Watch sources directories for file changes to restart the server, for development only, the backend module files will be added to the watch list automatically, so only app specific directores should be added." },
        { name: "ignore", type: "regexp", descr: "Files to be ignored by the watcher" },
        { name: "match", type: "regexp", descr: "Files to be watched, .js and .css is the default" },
        { name: "web", type: "list", array: 1, descr: "List of directories to be watched for file modifications and execute a `buildWeb` command to produce bundles, apps, etc... Relative paths will be applied to all packages, example: web/js,web/css" },
        { name: "build", descr: "Command to run on web files modifications, to be used with tools like minify/uglify" },
        { name: "mode", descr: "How to serialize web build launches for multiple files chnaged at the same time, if empty run one build per file, `dir` to run every launch per config directory, `dir1` to run by next top dir, `dir3` to run by thid directory from the file...." },
        { name: "delay", type: "int", descr: "Delay in ms before triggering the build web command to allow multiple files saved" },
        { name: "restart-delay", type: "number", max: 30000, descr: "Delay between respawning the server after changes" },
        { name: "no-restart", type: "bool", descr: "Do not restart any processes terminated, for debugging crashes only" },
    ],

    dir: [],
    web: [],
    match: /\.(js|css|html)$/,
    build: "bkjs bundle -dev -file",
    delay: 200,
    restartDelay: 1000,
};

module.exports = mod;

mod.start = function()
{
    // REPL command prompt over TCP instead of the master process
    if (core.repl.port && (!lib.isArg("-master") || lib.isArg("-no-master"))) {
        core.startRepl(core.repl.port, core.repl.bind);
    }

    function _restart(file) {
        if (mod._rtimer) return;
        logger.log('watcher:', 'restarting', mod.child.pid, "file:", file.name);
        mod._rtimer = setTimeout(() => {
            delete mod._rtimer;
            if (mod.child) mod.child.kill(); else mod.startProcess();
        }, mod.restartDelay);
    }

    // Backend modules watcher
    if (!lib.isFlag(this.dir, __dirname)) {
        this.dir.push(__dirname, __dirname + "/../modules");
        this.dir.push(...lib.findFileSync(__dirname, { types: "d" }));
    }
    for (const dir of core.path.modules) {
        if (!lib.isFlag(this.dir, dir)) this.dir.push(dir);
    }
    logger.info('startWatcher:', this.dir);
    for (const dir of this.dir) {
        lib.watchFiles({ root: dir, files: /\.js$/, ignore: this.ignore, depth: 3 }, _restart);
    }

    // Web source files watcher
    if (lib.isArray(this.web) && this.build) {
        mod._web = {};
        var webdirs = {};
        webdirs[path.resolve(__dirname + "/../web/js")] = 1;
        webdirs[path.resolve(__dirname + "/../web/css")] = 1;
        for (const dir of this.web) {
            if (path.isAbsolute(dir)) {
                webdirs[path.resolve(dir)] = 1;
            } else {
                for (const p in core.packages) {
                    webdirs[(path.resolve(path.join(core.packages[p].path, dir)))] = 1;
                }
            }
        }
        webdirs = Object.keys(webdirs);
        logger.info('startWatcher:', this.build, webdirs, this.match, this.ignore);
        for (const dir of webdirs) {
            lib.watchFiles({ root: dir, match: this.match, ignore: this.ignore, recursive: true }, (file) => {
                if (!file.stat.size) return;
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
            }, (err) => {
                if (err && err.code != "ENOENT") logger.error("startWatcher:", dir, err);
            });
        }
    }
    this.startProcess();
}

// Restart the main process with the same arguments and setup as a monitor for the spawn child
mod.startProcess = function()
{
    this.child = spawn(process.argv[0], process.argv.slice(1).filter((x) => (!["-daemon", "-watch"].includes(x))));

    this.child.stdout.on('data', function(data) {
        if (data) console.log("%s", data.toString().trim());
    });
    this.child.stderr.on('data', function(data) {
        if (data) console.log("%s", data.toString().trim());
    });
    // Restart if dies or exits
    this.child.on('exit', (code, signal) => {
        logger.log('startProcess:', core.role, 'process terminated:', 'pid:', mod.child.pid, 'code:', code, 'signal:', signal);
        if (mod.noRestart) return;

        core.killBackend("", "", () => {
            lib.checkRespawn(mod.startProcess.bind(mod));
        });
    });
    process.stdin.pipe(this.child.stdin);
    logger.log('startProcess:', core.role, 'version:', core.version, 'home:', core.home, 'port:', core.port, 'uid:', lib.getuid(), 'pid:', process.pid, 'app:', core.appName, core.runMode, core.instance);
}


