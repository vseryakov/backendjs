//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const path = require("path");
const util = require("util");
const fs = require("fs");
const cluster = require('cluster');
const core = require(__dirname + "/../core");
const lib = require(__dirname + "/../lib");
const logger = require(__dirname + "/../logger");
const shell = core.modules.shell;

shell.help.push("-test-run CMD [-test-file FILE] - run a test command in the shell, autoload ./tests/index.js if exists, optinally can load other file with tests, all other test params will be used as well");

const tests = {
    name: "tests",
    test: {},
    started: "STARTED:",
    success: "SUCCESS:",
    failure: "FAILURE:",
    descr: "",

    init: function() {
        if (core.modules.tests) return this.test;
        core.addModule(this);
        Object.defineProperty(global, "assert", { value: this.assert, enumerable: true });
        Object.defineProperty(global, "expect", { value: this.expect, enumerable: true });
        Object.defineProperty(global, "die", { value: shell.die, enumerable: true });
        Object.defineProperty(global, "test", { value: this.test, enumerable: true });
        Object.defineProperty(global, "describe", { value: this.describe, enumerable: true });
        Object.defineProperty(global, "sleep", { value: this.sleep, enumerable: true });
        Object.defineProperty(global, "core", { value: core, enumerable: true });

        Object.defineProperty(global, "promisify", { value: util.promisify, enumerable: true });
        Object.defineProperty(global, "inspect", { value: util.inspect, enumerable: true });

        Object.defineProperty(global, "fs", { value: fs, enumerable: true });
        Object.defineProperty(global, "util", { value: util, enumerable: true });
        Object.defineProperty(global, "path", { value: path, enumerable: true });

        for (const p in core.modules) {
            Object.defineProperty(global, p, { value: core.modules[p], enumerable: true });
        }
        // Fail miserably in tests
        lib.tryCatch = function(callback, ...args) { return callback.apply(null, args) }

        return this.test;
    },

    list: function() {
        return Object.keys(this).filter((x) => (x.substr(0, 5) == "test_" && typeof this[x] == "function")).map((x) => (x.substr(5)));
    },

};

// To be used in the tests, these global functions takes the following arguments:
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
//          tests.test_GetUser = function(next)
//          {
//              describe("Test user record existence by id");
//              db.get("bk_user", { login: "123" }, (err, row) => {
//                   assert(err, "no error expected", row);
//                   expect(row?.id == "123", `id must be 123`, row);
//                   next();
//              });
//          }
//
tests.expect = function(ok, ...args)
{
    if (ok) return;
    if (!this.test.verbose) {
        console.error(logger.prefix("TEST"), tests.failure, cluster.isMaster ? "master" : "worker",
                      this.test.cmd || this.test.run, this.test.filename,
                      tests.descr ? "[" + tests.descr + "]" : "", args[0]);
        process.exit(1);
    }
    console.error("\n");
    console.error(logger.prefix("TEST"), tests.failure, cluster.isMaster ? "master" : "worker",
                  this.test.cmd || this.test.run, this.test.file,
                  tests.descr ? "[" + tests.descr + "]" : "");
    args.push("", "TEST CONTEXT:", this.test);
    console.error("Expectation failed:");
    shell.die(...args);
}

tests.assert = function(...args)
{
    if (!args[0]) return;
    if (!this.test.verbose) {
        console.error(logger.prefix("TEST"), tests.failure, cluster.isMaster ? "master" : "worker",
                      this.test.cmd || this.test.run, this.test.filename,
                      tests.descr ? "[" + tests.descr + "]" : "", args[1]);
        process.exit(1);
    }
    console.error("\n");
    console.error(logger.prefix("TEST"), tests.failure, cluster.isMaster ? "master" : "worker",
                  this.test.cmd || this.test.run, this.test.file,
                  tests.descr ? "[" + tests.descr + "]" : "");
    args.push("", "TEST CONTEXT:", this.test);
    console.error("Assertion occured:");
    shell.die(...args);
}

// Describe the next test, the title will be printed at the beginning of the global test object,
// this is a convenience utility to better document tests
tests.describe = function(title)
{
    tests.descr = title;
}

// Async sleep version
tests.sleep = function(delay)
{
    return new Promise((resolve) => setTimeout(resolve, delay))
}

// Generic access checker to be used in tests, accepts an array in .config with urls to check
// The following properties can be used:
// - url - URL to be checked with POST
// - get - URL to be check with GET
// - method - explicit method for url
// - data - query data for GET or postdata for POST
// - form - formdata for requests that need urlformencoded data
// - headers/cookies - extra headers and cookies to send
// - user - a user record with login and secret, a signature is send
// - status - status to expect, 200 is default
// - match - an object to checked against the response, uses lib.isMatched
// - nocsrf/nosig - do not use CSRF or signature in request
// - preprocess - function(conf, cb) to be called before making request
// - postprocess - function(conf, rc, cb) to be called after the request, rc is the response object from the request
// - delay - wait before making next request
tests.checkAccess = function(options, callback)
{
    lib.forEachSeries(options.config, (conf, next) => {
        var q = {
            url: conf.get || conf.url,
            method: conf.get ? "GET" : conf.method || "POST",
            query: conf.get && conf.data,
            postdata: !conf.get && conf.data,
            formdata: conf.form,
            headers: conf.headers || {},
            cookies: conf.cookies || {},
            login: conf.user?.login,
            secret: conf.user?.secret,
            _rc: conf.status || 200,
        };
        if (conf.noscrf) options.h_csrf = options.c_csrf = null;
        if (conf.nosig) options.sig = null;
        if (options.h_csrf) {
            q.headers[core.modules.api.csrfHeaderName] = options.h_csrf;
        }
        if (options.c_csrf) {
            q.cookies[core.modules.api.csrfHeaderName] = options.c_csrf;
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
                    tests.expect(rc.status == q._rc, `${conf.user?.login || "pub"}: ${q.url}: expect ${q._rc} but got ${rc.status}`, rc.data, "CONFIG:", conf, "OPTS:", options);
                    if (rc.resheaders[core.modules.api.csrfHeaderName]) {
                        options.h_csrf = rc.resheaders[core.modules.api.csrfHeaderName];
                    }
                    if (rc.rescookies[core.modules.api.csrfHeaderName]) {
                        options.c_csrf = rc.rescookies[core.modules.api.csrfHeaderName].value;
                    }
                    if (rc.rescookies[core.modules.api.signatureHeaderName]) {
                        options.sig = rc.rescookies[core.modules.api.signatureHeaderName].value;
                    }
                    if (conf.match) {
                        tests.expect(lib.isMatched(rc.obj, conf.match), "match failed", rc.obj, "config:", conf);
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

// Run the test function which is defined in the global tests module, all arguments will be taken from the options or the command line. Options
// use the same names as command line arguments without preceeding `test-` prefix.
//
// The main commands:
// - -test-list - show all available test functions and exit
// - -test-config - list of file(s) to load and parse as configs, all test- params will be added to the test object
// - -test-file - a javascript file to be loaded with tests or functions, it must reside inside tests/ folder, only the name is expected
// - -test-run - name of the functions to run, can be a list, must be the last command
//
// Optional parameters for the test-run:
// - -test-verbose - on error print the context and backtrace
// - -test-delay - number of milliseconds before starting the test and exiting the process, default 500ms
// - -test-cluster - use a cluster worker to run each test in a separate process, if 2 skip worker for a single command
// - -test-interval - number of milliseconds between iterations
// - -test-concurrency - how many tests to run at the same time, default is 1
//
// All other common command line arguments are used normally, like -db-pool to specify which db to use.
//
// After finish or in case of error the process exits if no callback is given.
//
// Example, store it in tests/index.js:
//
//          tests.test_mytest = async function(next) {
//             describe("Check user record existence")
//             var row = await db.aget("bk_user", { login: "123" });
//             expect(row, "record must exists");
//             expect(row.id != "123", "Record id must not be 123", row)
//             next();
//          }
//
//          # bksh -test-run mytest
//
// Custom tests:
//
//   - to run al test in tests/
//
//         bkjs test-all
//
//   - to start all test commands in the shell using local ./tests/db.js
//
//         bksh -test-file db -test-run
//
//         or
//
//         bkjs test-db
//
//   - to start a specific test
//
//         bksh -test-file db -test-run dynamodb
//
shell.cmdTestRun = function(options)
{
    const test = tests.init();

    var args = this.getArgs({ index: 0 });
    for (const p in args) {
        if (/^test-/.test(p)) test[p.substr(5)] = args[p];
    }
    test.verbose = lib.toBool(test.verbose);
    test.delay = lib.toNumber(test.delay, { dflt: 500 });
    test.concurrency = lib.toNumber(test.concurrency, { dflt: 1 });

    if (!test.file) {
        test.file = "tests/index.js";
        this.loadFile(test.file);
    }
    test.filename = test.verbose ? test.file : path.basename(test.file);

    test.run = cluster.isMaster ? this.getArg("-test-run", options) : process.env.BKJS_TEST_NAME || "none";

    if (cluster.isWorker) {
        core.modules.jobs.initWorker();
        core.modules.ipc.sendMsg("shell:ready", { pid: process.pid, wid: cluster.worker?.id });
    }

    if (test.run == "continue") {
        console.log(logger.prefix("TEST"), tests.started, cluster.isMaster ? "master" : "worker", test.filename);
        return "continue";
    }

    var tlist = tests.list();
    var cmds = lib.isArray(lib.strSplit(test.run, /[ ,.*;]/), tlist);
    for (const cmd of cmds) {
        if (!tests['test_' + cmd]) {
            console.error(logger.prefix("TEST"), "INVALID:", cluster.isMaster ? "master" : "worker",
                          test.run, test.filename, "TEST:", cmd, "CMDS:", tlist.join(", "),
                          "ARGS:", process.argv, "TEST:", test);
            process.exit(1);
        }
    }

    setTimeout(() => {
        console.log(logger.prefix("TEST"), tests.started, cluster.isMaster ? "master" : "worker", cmds, test.filename);
        test.role = cluster.isMaster ? "master" : "worker";
        test.stime = Date.now();
        var errcode = 0;

        lib.forEachLimit(cmds, test.concurrency, (cmd, next) => {
            if (cluster.isMaster && cmd.startsWith("master_")) {
                const worker = cluster.fork({ "BKJS_TEST_NAME": "continue" });
                core.modules.ipc.on("shell:ready", (msg, w) => {
                    test.cmd = cmd;
                    tests["test_" + cmd]((err) => {
                        worker.kill();
                        next(err);
                    }, test);
                });
                return;
            } else
            if (cluster.isMaster && test.cluster) {
                const worker = cluster.fork({ "BKJS_TEST_NAME": cmd });
                worker.on('exit', (code, signal) => {
                    if (code) errcode = code;
                    next();
                });
                return;
            }
            test.cmd = cmd;
            tests["test_" + cmd]((err) => { setTimeout(next.bind(null, err), test.interval) }, test);
        }, (err) => {
            test.elapsed = Date.now() - test.stime;
            if (err) assert(err, test);
            setTimeout(() => {
                console.log(logger.prefix("TEST"), errcode ? tests.failure : tests.success, cluster.isMaster ? "master" : "worker",
                            test.run, test.filename);
                process.exit(errcode);
            }, test.delay);
        }, true);
    }, test.delay);
}

shell.cmdTestList = function(options)
{
    const test = tests.init();
    if (!test.file) this.loadFile("tests/index.js")
    console.log(tests.list().join(" "));
    process.exit();
}

shell.cmdTestEnv = function(options)
{
    tests.init();
    shell.exit(global);
}

shell.cmdTestDump = function(options)
{
    tests.init();
    shell.exit(tests.test);
}

shell.cmdTestFile = function(options)
{
    const test = tests.init();
    test.file = this.getArg("-test-file", options)
    if (!test.file) return shell.exit("-test-file argument is required");

    this.loadFile(test.file.includes("/") ? test.file : "tests/" + test.file);
    return "continue";
}

shell.cmdTestConfig = function(options)
{
    const test = tests.init();
    test.config = lib.strSplit(this.getArg("-test-config", options));
    if (!test.config.length) return shell.exit("-test-config argument is required");

    for (const conf of test.config) {
        var args = lib.readFileSync(conf, { cfg: 1 });
        core.parseArgs(args, 0, conf);
        core.parseArgs(process.argv, 0, "cmdline");

        for (let i = 0; i < args.length - 1; i++) {
            if (args[i].startsWith("-test-")) {
                test[args[i].substr(6)] = args[i + 1][0] != "-" ? args[i + 1] : true;
            }
        }
    }
    return "continue";
}

shell.testJob = function(options, callback)
{
    logger.logger(options.logger || "info", "testJob:", options);
    if (options.dead) return;

    var timer, interval;
    if (options.timeout_rand) {
        timer = setTimeout(callback, lib.randomInt(0, options.timeout_rand), options.err);
    } else
    if (options.timeout) {
        timer = setTimeout(callback, options.timeout, options.err);
    }
    if (options.cancel) {
        interval = setInterval(() => {
            if (core.modules.jobs.isCancelled(options.cancel)) {
                clearTimeout(timer)
                clearInterval(interval);
                if (options.file) {
                    fs.writeFileSync(options.file, `${options.data} cancelled`);
                }
                return callback("cancelled");
            }
            logger.debug("testJob:", options);
        }, 250);
    }
    if (options.file) {
        fs.writeFileSync(options.file, `${options.data}`);
    }
    if (!timer) callback(options.err);
}

