//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const cluster = require('cluster');
const core = require(__dirname + '/core');
const lib = require(__dirname + '/lib');

// Shell command interface for `bksh`
//
// This module is supposed to be extended with commands, the format is `shell.cmdNAME``
//
// where `NAME` is he commnd name in camel case
//
// For example:
//
// ```javascript
//const bkjs = require("backendjs");
//const shell = bkjs.shell;
//
//shell.cmdMyCommand = function(options) { console.log("hello"); return "continue" }
//```
// Now if i call `bksh -my-command` it will print hello and launch the repl,
// instead of retuning continue if the command must exit jut call `process.exit()`
//
// Run `bksh -shell-help` to see all registered shell commands
//

const mod = {
    name: "shell",
};
module.exports = mod;

// Start REPL shell or execute any subcommand if specified in the command line.
// A subcommand may return special string to indicate how to treat the flow:
// - stop - stop processing commands and create REPL
// - continue - do not exit and continue processing other commands or end with REPL
// - all other values will result in returning from the run assuming the command will decide what to do, exit or continue running, no REPL is created
// - if `-noexit`` is passed in the command line keep the shell running after executing the command
// - `-exit-timeout MS` will be set to ms to wait before exit
// - `-shell-delay MS` will wait before running the command
mod.start = function(options)
{
    const shell = core.modules.shell;
    require(__dirname + "/shell/aws");
    require(__dirname + "/shell/db");
    require(__dirname + "/shell/shell");
    require(__dirname + "/shell/test");

    process.title = core.name + ": shell";

    shell.exitTimeout = lib.getArgInt("-exit-timeout", 1000);
    var delay = lib.getArgInt("-shell-delay");

    core.runMethods("configureShell", options, (err) => {
        if (options.done) process.exit();

        if (cluster.isMaster) {
            core.modules.ipc.initServer();
        } else {
            core.modules.ipc.initWorker();
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
            if (rc == "stop") break;
            if (rc == "continue") continue;
            if (lib.isArg("-noexit")) continue;
            return;
        }
        if (cluster.isMaster) {
            core.modules.repl = core.createRepl({ file: core.repl.file, size: core.repl.size });
            core.modules.repl.on('exit', () => {
                core.runMethods("shutdownShell", { sync: 1 }, () => {
                    setTimeout(() => { process.exit() }, shell.exitTimeout);
                });
            });
        }
    });
}
