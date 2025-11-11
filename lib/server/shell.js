/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const { app, shell, lib, logger, ipc } = require('../modules');

/**
 * Shell command interface for `bksh`
 *
 * This module is supposed to be extended with commands, the format is `shell.cmdNAME``
 *
 * where `NAME` is he commnd name in camel case
 *
 * For example:
 *
 * ```javascript
 *const { shell } = require("backendjs");
 *const shell = bkjs.shell;
 *
 *shell.cmdMyCommand = function(options) { console.log("hello"); return "continue" }
 *```
 * Now if i call `bksh -my-command` it will print hello and launch the repl,
 * instead of retuning continue if the command must exit just call `process.exit()`
 *
 * Run `bksh -help` to see all registered shell commands
 *
 * Any command may return special string to indicate how to treat the flow:
 * - stop - stop processing commands and create REPL
 * - continue - do not exit and continue processing other commands or end with REPL
 * - all other values will result in returning from the run assuming the command will decide what to do, exit or continue running, no REPL is created
 * - `-noexit` - in the command line keep the shell running after executing the command
 * - `-exit` - exit with error if no shell command found
 * - `-exit-timeout MS` - will be set to ms to wait before exit
 * - `-shell-delay MS` - will wait before running the command
 * @module db
 */
module.exports = function(options)
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

        for (var i = 1; i < process.argv.length; i++) {
            if (process.argv[i][0] != '-') continue;
            var name = lib.toCamel("cmd" + process.argv[i]);
            if (typeof shell[name] != "function") continue;
            shell.cmdName = name;
            shell.cmdIndex = i;
            if (delay) {
                return setTimeout(shell[name].bind(shell, options), delay);
            }
            var rc = shell[name](options);
            logger.debug("start:", shell.name, name, rc);

            if (rc == "stop") break;
            if (rc == "continue") continue;
            if (lib.isArg("-noexit")) continue;
            return;
        }
        if (!shell.cmdName && lib.isArg("-exit")) {
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
