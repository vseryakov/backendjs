//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const cluster = require('cluster');
const util = require("util");
const core = require(__dirname + "/../core");
const lib = require(__dirname + "/../lib");
const logger = require(__dirname + "/../logger");
const shell = core.modules.shell;

shell.help.push("-test-run CMD [-test-file FILE] - run a test command in the shell, autoload ./tools/tests.js if exists, optinally can load other file with tests, all other test params will be used as well");

// To be used in the tests, this function takes the following arguments:
//
// assert(next, err, ....)
//
//  - next - is a callback to be called to continue to the next test or fail with an error
//  - err - an error object from the most recent operation, can be null/undefined or any value that results in Javascript "true" evaluation,
//    assertion happens if an err is given or this value is not null or empty
//  - all other arguments will be added to the `err` object or converted into an object to be printed when the test exits on failure
//
//  NOTES:
//   - In forever mode `-test-forever` any error is ignored and not reported
//   - if `tests.test.delay` is set it will be used to delay calling the next callback and reset, this is for one time delays.
//
// Example
//
//          function(next) {
//              db.get("bk_user", { login: "123" }, function(err, row) {
//                  tests.assert(next, err || !row || row.id != "123", "Record not found", row)
//              });
//          }
shell.assert = function(next, err, ...args)
{
    if (typeof next != "function") throw new Error("invalid assertion");
    if (this.test.forever) return next();

    if (err) {
        err = util.isError(err) ? err : lib.newError(err);
        err.details = lib.objDescr(args);
    }
    setTimeout(next.bind(null, err), this.test.timeout || this.test.delay || 0);
    this.test.delay = 0;
}

// Run the test function which is defined in the tests module, all arguments will be taken from the options or the command line. Options
// use the same names as command line arguments without preceeding `test-` prefix.
//
// The common command line arguments that supported:
// - -test-run - name of the function to run
// - -test-delay - number of milliseconds before starting the test
// - -test-workers - number of workers to run the test at the same time
// - -test-workers-delay - number of milliseconds before starting worker processes, default is 500ms
// - -test-timeout - number of milliseconds between test steps, i.e. between invocations of the check
// - -test-interval - number of milliseconds between iterations
// - -test-iterations - how many times to run this test function, default is 1
// - -test-concurrency - how many functions to run at the same time, default is 1
// - -test-nowait - do not wait for test function to finish to start next iteration, default is 0
// - -test-forever - run forever without reporting any errors, for performance testing
// - -test-file - a javascript file to be loaded with additional tests
//
// All other common command line arguments are used normally, like -db-pool to specify which db to use.
//
// After finish or in case of error the process exits if no callback is given.
//
// Example, store it in tools/tests.js:
//
//          var bkjs = require("backendjs");
//          var tests = bkjs.core.modules.tests;
//
//          tests.test_mytest = function(next) {
//             bkjs.db.get("bk_user", { login: "123" }, function(err, row) {
//                 tests.assert(next, err || !row || row.id != "123", "Record not found", row)
//             });
//          }
//
//          # bksh -test-run mytest
//
// Custom tests:
//
//   - create a user for backend testing, if the API does not require authentication skip this step:
//
//           bksh -account-add login testuser secret testpw
//
//   - configure global backend credentials
//
//           echo "backend-login=testuser" >> etc/config.local
//           echo "backend-secret=testpw" >> etc/config.local
//
//   - to start a test command in the shell using local ./tests.js
//
//         bksh -test-run account
//
//   - to start a test command in the shell using custom file with tests
//
//         bksh -test-run api -test-file tests/api.js
//
shell.cmdTestRun = function(options)
{
    var tests = shell;
    tests.name = "tests";
    core.addModule(tests);

    var test = tests.test = {
        cmd: tests.getArg("-test-run", options),
        role: cluster.isMaster ? "master" : "worker",
        elapsed: 0,
        iterations: 0,
        running: 0,
        countdown: tests.getArgInt("-test-iterations", options, 1),
        forever: tests.getArgInt("-test-forever", options, 0),
        timeout: tests.getArgInt("-test-timeout", options, 0),
        nowait: tests.getArgInt("-test-nowait", options, 0),
        interval: tests.getArgInt("-test-interval", options, 0),
        concurrency: tests.getArgInt("-test-concurrency", options, 1),
        keepmaster: tests.getArgInt("-test-keepmaster", options, 0),
        workers: tests.getArgInt("-test-workers", options, 0),
        workers_delay: tests.getArgInt("-test-workers-delay", options, 500),
        delay: tests.getArgInt("-test-delay", options, 0),
        file: tests.getArg("-test-file", options, "tools/tests.js"),
        config: tests.getArg("-test-config", options, ""),
        stime: Date.now(),
    };
    if (test.file) this.loadFile(test.file);

    var cmds = lib.strSplit(test.cmd);
    for (const i in cmds) {
        if (!this['test_' + cmds[i]]) {
            var avail = Object.keys(tests).filter((x) => (x.substr(0, 5) == "test_" && typeof tests[x] == "function")).map((x) => (x.substr(5))).join(", ");
            logger.error("cmdTestRun:", "invaid test:", cmds[i], "usage: -test-run CMD where CMD is one of:", avail, "ARGS:", process.argv, "TEST:", test);
            process.exit(1);
        }
    }

    // Add all remaining arguments starting with test-
    var args = this.getArgs();
    for (const p in args) {
        if (/^test-/.test(p) && typeof test[p.substr(5)] == "undefined") test[p.substr(5)] = args[p];
    }

    if (test.config) {
        args = lib.readFileSync(test.config, { cfg: 1 });
        core.parseArgs(args, 0, test.config);
        for (let i = 0; i < args.length - 1; i++) {
            if (/^-test-/.test(args[i]) && typeof test[args[i].substr(6)] == "undefined") {
                test[args[i].substr(6)] = args[i + 1][0] != "-" ? args[i + 1] : true;
            }
        }
    }

    if (cluster.isMaster) {
        setTimeout(() => {
            for (let i = 0; i < test.workers; i++) cluster.fork();
        }, test.workers_delay);

        cluster.on("exit", (worker) => {
            if (!Object.keys(cluster.workers).length && !test.forever && !test.keepmaster) process.exit(0);
        });
    } else {
        if (!test.workers) return "continue";
    }

    while (cmds.length < test.concurrency) {
        cmds = cmds.concat(cmds.slice(0, Math.min(cmds.length, test.concurrency - cmds.length)));
    }

    setTimeout(() => {
        logger.log("TEST STARTED:", cluster.isMaster ? "master" : "worker", 'cmd:', test.cmd, cmds.length, 'db-pool:', core.modules.db.pool);

        lib.whilst(
            function() {
                return test.countdown > 0 || test.forever || options.running
            },
            function(next) {
                test.countdown--;
                lib.forEachLimit(cmds, test.concurrency, (cmd, next2) => {
                    test.running++;
                    tests["test_" + cmd]((err) => {
                        test.running--;
                        test.iterations++;
                        if (test.nowait) return;
                        if (test.forever) err = null;
                        setTimeout(next2.bind(null, err), test.interval);
                    }, test);
                    if (test.nowait) setImmediate(next2);
                }, next);
            },
            function(err) {
                test.elapsed = Date.now() - test.stime;
                if (err) {
                    core.setLogInspect();
                    logger.oneline = false;
                    logger.error("TEST FAILED:", test.cmd, err);
                    process.exit(1);
                }
                setInterval(function() {
                    if (test.running > 0) return;
                    logger.log("TEST FINISHED:", test.cmd);
                    process.exit(0);
                }, 100);
        });
    }, test.delay);
}

shell.testJob = function(options, callback)
{
    logger.log("testJob:", options);
    if (options.dead) return;
    if (options.rand) return setTimeout(callback, lib.randomInt(0, options.rand));
    if (options.timeout) return setTimeout(callback, options.timeout);
    callback();
}

