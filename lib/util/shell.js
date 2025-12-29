/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const { app, shell, lib, logger, ipc } = require('../modules');

/**
 * @module shell
 */

/**
 * Shell command interface for `bksh`
 *
 * Run `bksh -help` to see all registered shell commands.
 *
 * Special global command-line arguments:
 *
 * - `-noexit` - keep the shell running after executing the command
 * - `-exit` - exit with error if no shell command found
 * - `-exit-timeout MS` - will be set to ms to wait before exit for async actions to finish
 * - `-shell-delay MS` - will wait before running the command to allow initialization complete
 *
 * Shell functions must be defined in `shell.commands` object,
 * where `myCommand` is the command name in camel case for `-my-command`
 *
 * The function may return special values:
 * - `stop` - stop processing commands and create REPL
 * - `continue` - do not exit and continue processing other commands or end with REPL
 *
 *  all other values will result in returning from the run assuming the command will decide what to do, exit or continue running, no REPL is created
 *
 * @example
 * const { shell } = require("backendjs");
 *
 * shell.commands.myCommand = function(options) {
 *    console.log("hello");
 *    return "continue"
 * }
 * // Calling `bksh -my-command` it will run this command.
 */
module.exports = Shell;

function Shell(options)
{
    require("../shell/aws");
    require("../shell/db");
    require("../shell/shell");
    require("../shell/users");

    shell.exitTimeout = lib.getArgInt("-exit-timeout", 1000);
    var delay = lib.getArgInt("-shell-delay");

    app.runMethods("configureShell", options, (err) => {
        if (options.done) process.exit();

        if (app.isPrimary) {
            ipc.initServer();
        } else {
            ipc.initWorker();
        }
        var cmd;

        for (var i = 1; i < process.argv.length; i++) {
            if (process.argv[i][0] != '-') continue;
            var name = lib.toCamel(process.argv[i].substr(1));
            if (typeof shell.commands[name] != "function") continue;
            shell.cmdName = cmd = name;
            shell.cmdIndex = i;
            if (delay) {
                return setTimeout(shell.commands[name].bind(shell, options), delay);
            }
            var rc = shell.commands[name](options);
            logger.debug("start:", shell.name, name, rc);

            if (rc == "stop") break;
            if (rc == "continue") continue;
            if (lib.isArg("-noexit")) continue;
            return;
        }
        if (!cmd && lib.isArg("-exit")) {
            return shell.exit("no shell command found");
        }
        if (app.isPrimary) {
            const repl = app.createRepl({ file: app.repl.file, size: app.repl.size });
            repl.on('exit', () => {
                app.runMethods("shutdownShell", { sync: 1 }, () => {
                    setTimeout(() => { process.exit() }, shell.exitTimeout);
                });
            });
        }
    });
}

