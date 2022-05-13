//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const cluster = require('cluster');
const core = require(__dirname + '/core');
const lib = require(__dirname + '/lib');

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
mod.start = function(options)
{
    require(__dirname + "/shell/aws");
    require(__dirname + "/shell/db");
    require(__dirname + "/shell/shell");
    require(__dirname + "/shell/test");

    process.title = core.name + ": shell";

    core.runMethods("configureShell", options, function(err) {
        if (options.done) process.exit();

        core.modules.ipc.initServer();

        for (var i = 1; i < process.argv.length; i++) {
            if (process.argv[i][0] != '-') continue;
            var name = lib.toCamel("cmd" + process.argv[i]);
            if (typeof core.modules.shell[name] != "function") continue;
            core.modules.shell.cmdName = name;
            core.modules.shell.cmdIndex = i;
            var rc = core.modules.shell[name](options);
            if (rc == "stop") break;
            if (rc == "continue") continue;
            if (lib.isArg("-noexit")) continue;
            return;
        }
        if (cluster.isMaster) {
            core.modules.repl = core.createRepl({ file: core.repl.file, size: core.repl.size });
            core.modules.repl.on('exit', () => {
                core.runMethods("shutdownShell", { sync: 1 }, () => {
                    setTimeout(() => { process.exit() }, core.modules.shell.exitTimeout || 1000);
                });
            });
        }
    });
}
