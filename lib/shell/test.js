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
// expect(ok, ....)
//
//  - ok - it must be true or non empty value in order to continue
//  - all other arguments will be printed to stderr before exiting including the backtrace
//
// assert(failed, ....)
//
//  - failed - it must be false or empty value in order to continue
//  - all arguments will be printed to stderr before exiting including the backtrace
//
// Example
//
//          function testGetUser(next) {
//              db.get("bk_user", { login: "123" }, function(err, row) {
//                   tests.assert(err, "no error expected", row);
//                   tests.expect(row?.id == "123", `id must be 123`, row);
//                   next();
//              });
//          }
shell.expect = function(ok, ...args)
{
    if (ok) return;
    console.error("Expectation failed:");
    this.die(args);
}

shell.assert = function(...args)
{
    if (!args[0]) return;
    console.error("Assertion occured:");
    this.die(args);
}

shell.die = function(...args)
{
    for (const a of args) console.log(util.inspect(a, { depth: 10, showHidden: true }).split("\n").map((x) => ("   " + x)).join("\n"));
    var e = {};
    Error.stackTraceLimit = 32;
    Error.captureStackTrace(e, shell.die);
    console.error(e.stack.replace("Error", "Backtrace:"));
    process.exit(1);
}

shell.tests = function()
{
    return Object.keys(this).filter((x) => (x.substr(0, 5) == "test_" && typeof this[x] == "function")).map((x) => (x.substr(5)));
}

// Run the test function which is defined in the tests module, all arguments will be taken from the options or the command line. Options
// use the same names as command line arguments without preceeding `test-` prefix.
//
// The common command line arguments that supported:
// - -test-run - name of the function to run
// - -test-list - show all available test functions and exit
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
//          const bkjs = require("backendjs");
//          const db = bkjs.db;
//          const tests = bkjs.core.modules.tests;
//
//          tests.test_mytest = function(next) {
//             db.get("bk_user", { login: "123" }, function(err, row) {
//                 tests.expect(!err, err);
//                 tests.expect(row?.id != "123", "Record not found or invalid", row)
//                 next();
//             });
//          }
//
//          # bksh -test-run mytest
//
// Custom tests:
//
//   - create a user for backend testing, if the API does not require authentication skip this step:
//
//           bksh -user-add login testuser secret testpw
//
//   - configure global backend credentials
//
//           echo "backend-login=testuser" >> etc/config.local
//           echo "backend-secret=testpw" >> etc/config.local
//
//   - to start a test command in the shell using local ./tools/tests.js
//
//         bksh -test-run db
//
//   - to start a test command in the shell using custom file with tests
//
//         bksh -test-run api -test-file tests/api.js
//
shell.cmdTestRun = function(options)
{
    const tests = shell;
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
        delay: tests.getArgInt("-test-delay", options, 500),
        file: tests.getArg("-test-file", options, "tools/tests.js"),
        config: tests.getArg("-test-config", options, ""),
        stime: Date.now(),
    };

    // Add all remaining arguments starting with test-
    var args = this.getArgs();
    for (const p in args) {
        if (/^test-/.test(p) && typeof test[p.substr(5)] == "undefined") test[p.substr(5)] = args[p];
    }

    if (test.config) {
        args = lib.readFileSync(test.config, { cfg: 1 });
        core.parseArgs(args, 0, test.config);
        core.parseArgs(process.argv, 0, "cmdline");
        for (let i = 0; i < args.length - 1; i++) {
            if (/^-test-/.test(args[i]) && typeof test[args[i].substr(6)] == "undefined") {
                test[args[i].substr(6)] = args[i + 1][0] != "-" ? args[i + 1] : true;
            }
        }
    }

    if (test.file) {
        this.loadFile(test.file);
    }

    if (tests.isArg("-test-list", options)) {
        console.log(tests.tests().join("\n"));
        process.exit();
    }

    var cmds = lib.strSplit(test.cmd);
    for (const cmd of cmds) {
        if (!this['test_' + cmd]) {
            logger.error("cmdTestRun:", "invaid test:", cmd, "usage: -test-run CMD where CMD is one of:", tests.tests().join(", "), "ARGS:", process.argv, "TEST:", test);
            process.exit(1);
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

    var file = test.file ? test.file.split("/").slice(-2).join("/") : "";

    setTimeout(() => {
        logger.test("STARTED:", cluster.isMaster ? "master" : "worker", 'cmd:', test.cmd, file);

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
                }, next, true);
            },
            function(err) {
                test.elapsed = Date.now() - test.stime;
                if (err) {
                    logger.test("FAILED:", test.cmd, test.file);
                    shell.die(err, test);
                }
                setInterval(() => {
                    if (test.running > 0) return;
                    logger.test("FINISHED:", test.cmd, file);
                    process.exit(0);
                }, 100);
        });
    }, test.delay, true);
}

shell.testJob = function(options, callback)
{
    logger.test("testJob:", options);
    if (options.dead) return;
    if (options.rand) return setTimeout(callback, lib.randomInt(0, options.rand));
    if (options.timeout) return setTimeout(callback, options.timeout);
    callback();
}

// Generic access checker to be used in tests, accepts an array in .config with urls to check
// The following properties can be used:
// - url - URL to be checked with POST
// - get - URL to be check with GET
// - method - explicit method for url
// - data - query data for GET or postdata for POST
// - form - formdata for requests that need urlformencoded data
// - user - a user record with login and secret, a signature is send
// - status - status to expect, 200 is default
// - match - an object to checked against the response, uses lib.isMatched
// - nocsrf/nosig - do not use CSRF or signature in request
// - preprocess - function(conf, cb) to be called before making request
// - postprocess - function(conf, rc, cb) to be called after the request, rc is the response object from the request
// - delay - wait before making next request
shell.checkAccess = function(options, callback)
{
    lib.forEachSeries(options.config, (conf, next) => {
        var q = {
            url: conf.get || conf.url,
            method: conf.get ? "GET" : conf.method || "POST",
            query: conf.get && conf.data,
            postdata: !conf.get && conf.data,
            formdata: conf.form,
            headers: {},
            cookies: {},
            login: conf.user?.login,
            secret: conf.user?.secret,
            _rc: conf.status || 200,
        };
        if (conf.noscrf) options.csrf = null;
        if (conf.nosig) options.sig = null;
        if (options.csrf) {
            q.headers[core.modules.api.csrfHeaderName] = options.csrf;
            q.cookies[core.modules.api.csrfHeaderName] = options.csrf;
        }
        if (!conf.user && options.sig) {
            q.cookies[core.modules.api.signatureHeaderName] = options.sig;
        }
        lib.everySeries([
            function(next2) {
                if (typeof conf.preprocess != "function") return next2();
                conf.preprocess(conf, next2);
            },
            function(next2) {
                core.sendRequest(q, (err, rc) => {
                    shell.expect(rc.status == q._rc, `${conf.user?.login || "pub"}: ${q.url}: expect ${q._rc} but got ${rc.status}`, rc.data, "config:", conf);
                    if (rc.resheaders[core.modules.api.csrfHeaderName]) {
                        options.csrf = rc.resheaders[core.modules.api.csrfHeaderName];
                    }
                    if (rc.rescookies[core.modules.api.signatureHeaderName]) {
                        options.sig = rc.rescookies[core.modules.api.signatureHeaderName].value;
                    }
                    if (conf.match) {
                        shell.expect(lib.isMatched(rc.obj, conf.match), "match failed", rc.obj, "config:", conf);
                    }
                    if (conf.delay) {
                        return setTimeout(next2, conf.delay, null, rc);
                    }
                    next2(null, rc);
                });
            },
            function(next2, err, rc) {
                if (typeof conf.postprocess != "function") return next2();
                conf.postprocess(conf, rc, next2);
            }
        ], next, true);

    }, callback, true);
}

