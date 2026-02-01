/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const child = require("child_process");
const logger = require(__dirname + '/../logger');
const lib = require(__dirname + '/../lib');
const os = require("os");

/**
 * Return a list of processes
 * @param {object} options
 * @param {regexp} [options.filter] - return only matching
 * @param {function} callback - in format (err, list) where list is { pid, cmd }
 * @memberof module:lib
 * @method findProcess
 */
lib.findProcess = function(options, callback)
{
    if (os.platform() == "linux") {
        lib.findFile("/proc", { include: /^\/proc\/[0-9]+$/, exclude: new RegExp("^/proc/" + process.pid + "$"), depth: 0, base: 1 }, (err, files) => {
            if (!err) {
                files = files.map((x) => ({ pid: x, cmd: lib.readFileSync(`/proc/${x}/cmdline`).replace(/\0/g," ").trim() })).
                        filter((x) => (options.filter ? x.cmd.match(options.filter) : x.cmd));
            }
            callback(err, files);
        });
    } else {
        lib.execProcess("/bin/ps agx -o pid,args", (err, stdout, stderr) => {
            var list = stdout.split("\n").
                              filter((x) => (lib.toNumber(x) != process.pid && (options.filter ? x.match(options.filter) : 1))).
                              map((x) => ({ pid: lib.toNumber(x), cmd: x.replace(/^[0-9]+/, "").trim() }));

            callback(err, list);
        });
    }
}

/**
 * Async version of {@link module:lib.findProcess}
 * @param {object} [options]
 * @return {object} in format { data, err }
 * @example
 * const { data } = await lib.afindProcess({ filter: "bkjs" });
 * console.log(data)
 * [
 *  { pid: 65841, cmd: 'bkjs: watcher' },
 *  { pid: 65867, cmd: 'bkjs: master' },
 *  { pid: 65868, cmd: 'bkjs: worker' },
 *  { pid: 65869, cmd: 'bkjs: web' }
 * ]
 * @memberOf module:lib
 * @method afindProcess
 * @async
 */

lib.afindProcess = async function(options)
{
    return new Promise((resolve, reject) => {
        lib.findProcess(options, (err, data) => {
            resolve({ data, err });
        });
    });
}

/**
 * Run the process and return all output to the callback, all fatal errors are logged
 * @param {string} cmd
 * @param {object} [options] - see `child_process.spawn` for all options
 * @param {boolean} [options.merge] - merge stderr with stdout
 * @param {function} [callback] - (err, stdout, stderr)
 * @example
 * lib.execProcess("ls -ls", lib.log)
 * @memberof module:lib
 * @method execProcess
 */
lib.execProcess = function(cmd, options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    options = Object.assign({}, options, { shell: lib.isString(options?.shell) || true });

    return this.spawnProcess(cmd, [], options, callback);
}

/**
 * Async version of {@link module:lib.execProcess}
 * @param {string} cmd
 * @param {object} [options]
 * @return {object} in format { stdout, stderr, err }
 * @example
 * const { stdout } = lib.aexecProcess("ls -ls")
 * @memberOf module:lib
 * @method aexecProcess
 * @async
 */

lib.aexecProcess = async function(cmd, options)
{
    return new Promise((resolve, reject) => {
        lib.execProcess(cmd, options, (err, stdout, stderr) => {
            resolve({ stdout, stderr, err });
        });
    });
}


/**
 * Run specified command with the optional arguments, this is similar to
 * child_process.spawn with callback being called after the process exited
 * @param {string} cmd
 * @param {string|string[]} args
 * @param {object} [options] - options for the `child_processes.spawn`
 * @param {boolean} [options.merge] - merge stderr with stdout
 * @param {string} [options.logger] - log level for errors
 * @param {function} [callback] - (err, stdout, stderr)
 * @return {ChildProcess}
 * @example
 * lib.spawProcess("ls", "-ls", { cwd: "/tmp" }, lib.log)
 * @memberof module:lib
 * @method spawnProcess
 */
lib.spawnProcess = function(cmd, args, options, callback)
{
    if (typeof args == "function") callback = args, args = null, options = null;
    if (typeof options == "function") callback = options, options = null;
    if (!Array.isArray(args)) args = [ args ];

    var exited = 0
    var proc = child.spawn(cmd, args || [], options);
    proc.on("error", err => {
        if (exited++) return;
        logger.logger(options?.logger || "error", "spawnProcess:", cmd, args, err);
        lib.tryCall(callback, err, stdout, stderr);
    });
    proc.on('close', (code, signal) => {
        if (exited++) return;
        var err = code || signal ? lib.newError(`Failed ${cmd}`, { status: 500, signal, code, killed: proc.killed, args }) : undefined;
        logger.logger(err ? options?.logger || "error": " debug", "spawnProcess:", cmd, args, "close:", code || signal, err);
        lib.tryCall(callback, err, stdout, stderr);
    });

    var stdout = "", stderr = "";
    if (proc.stdout) {
        proc.stdout.on('data', data => { stdout += data.toString() });
    }
    if (proc.stderr) {
        proc.stderr.on('data', data => {
            if (options?.merge) stdout += data.toString(); else stderr += data.toString();
        });
    }
    return proc;
}

/**
 * Async version of {@link module:lib.spawnProcess}
 * @param {string} cmd
 * @param {object} [options]
 * @return {object} in format { proc, err }
 * @memberOf module:lib
 * @method aspawnProcess
 * @async
 */

lib.aspawnProcess = async function(cmd, args, options)
{
    return new Promise((resolve, reject) => {
        var proc = lib.spawnProcess(cmd, args, options, (err, stdout, stderr) => {
            resolve({ proc, stdout, stderr, err });
        });
    });
}

/**
 * Run a series of commands, if stdio is a pipe then output from all commands is concatenated.
 * @param {object[]|string[]} cmds is a list of commands to execute, runs {@link module:lib.spawnProcess} for each command.
 * @param {object} [options] - commond properties for `child_process.spawn`
 * @param {boolean} [options.stopOnError] - stop on first error or if non-zero status on a process exit.
 * @param {function} [callback] - (err, stdout, stderr)
 * @example
 * lib.spawnSeries([
 *     "ls -la",
 *     "ps augx",
 *     { command: "du", args: "-sh", stdio: "inherit", cwd: "/tmp" },
 *     { command: "du", args: "-sh", stdio: "inherit", cwd: "/etc" },
 *     "uname "-a"
 * ], lib.log)
 * @memberof module:lib
 * @method spawnSeries
 */
lib.spawnSeries = function(cmds, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    var stdout = "", stderr = "", opts;
    this.forEachSeries(cmds, (cmd, next) => {
        if (lib.isString(cmd?.command)) {
            opts = Object.assign({}, options, cmd, { command: undefined, args: undefined });
            lib.spawnProcess(cmd.command, cmd.args, opts, (err, o, e) => {
                stdout += o;
                stderr += e;
                next(options?.stopOnError ? err : null);
            });
        } else

        if (lib.isString(cmd)) {
            opts = Object.assign({}, options, { shell: true });
            lib.spawnProcess(cmd, [], opts, (err, o, e) => {
                stdout += o;
                stderr += e;
                next(options?.stopOnError ? err : null);
            });
        } else {
            logger.debug("spawnSeries:", "ignore:", cmd);
            return next();
        }
    }, (err) => {
        lib.tryCall(callback, err, stdout, stderr);
    });
}

/**
 * Async version of {@link module:lib.spawnSeries}
 * @param {object} cmds
 * @param {object} [options]
 * @return {object} in format { stdout, stderr, err }
 * @example
 * const { stdout, stderr } = await lib.aspawnSeries({"ls": "-l", "ps": "agx" }, { stdio:"pipe" })
 * @memberOf module:lib
 * @method areadFile
 * @async
 */

lib.aspawnSeries = async function(cmds, options)
{
    return new Promise((resolve, reject) => {
        lib.spawnSeries(cmds, options, (err, stdout, stderr) => {
            resolve({ stdout, stderr, err });
        });
    });
}
