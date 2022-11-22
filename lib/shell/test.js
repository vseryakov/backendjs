//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const cluster = require('cluster');
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
    console.error("\n");
    if (this.test) {
        console.error(logger.prefix("TEST"), "FAILED:", cluster.isMaster ? "master" : "worker", this.test.run, this.test.file);
        args.push(this.test);
    }
    console.error("Expectation failed:");
    this.die(args);
}

shell.assert = function(...args)
{
    if (!args[0]) return;
    console.error("\n");
    if (this.test) {
        console.error(logger.prefix("TEST"), "FAILED:", cluster.isMaster ? "master" : "worker", this.test.run, this.test.file);
        args.push(this.test);
    }
    console.error("Assertion occured:");
    this.die(args);
}

shell.initTests = function()
{
    const tests = this;
    if (tests.name != "tests") {
        tests.name = "tests";
        core.addModule(tests);
    }
    if (!tests.test) tests.test = {};
    return tests.test;
}

shell.listTests = function()
{
    return Object.keys(this).filter((x) => (x.substr(0, 5) == "test_" && typeof this[x] == "function")).map((x) => (x.substr(5)));
}

// Run the test function which is defined in the tests module, all arguments will be taken from the options or the command line. Options
// use the same names as command line arguments without preceeding `test-` prefix.
//
// The main commands:
// - -test-list - show all available test functions and exit
// - -test-config - list of file(s) to load and parse as configs, all test- params will be added to the test object
// - -test-file - a javascript file to be loaded with tests
// - -test-run - name of the functions to run, can be a list, must be the last command
//
// Optional parameters for the test-run:
// - -test-delay - number of milliseconds before starting the test and exiting the process, default 500ms
// - -test-cluster - use a cluster worker to run each test in a separate process
// - -test-interval - number of milliseconds between iterations
// - -test-concurrency - how many tests to run at the same time, default is 1
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
//         bksh -test-file tests/api.js -test-run api
//
shell.cmdTestRun = function(options)
{
    var test = this.initTests();

    var args = this.getArgs({ index: 0 });
    for (const p in args) {
        if (/^test-/.test(p)) test[p.substr(5)] = args[p];
    }
    test.cluster = lib.toBool(test.cluster);
    test.delay = lib.toNumber(test.delay, { dflt: 500 });
    test.concurrency = lib.toNumber(test.concurrency, { dflt: 1 });

    if (!test.file) {
        test.file = "tools/tests.js";
        this.loadFile(test.file);
    }

    test.run = cluster.isMaster ? this.getArg("-test-run", options) : process.env.BKJS_TEST_NAME || "none";

    var tlist = this.listTests();
    var cmds = test.run ? lib.strSplit(test.run) : tlist;
    for (const cmd of cmds) {
        if (!this['test_' + cmd]) {
            console.error(logger.prefix("TEST"), "INVALID:", cluster.isMaster ? "master" : "worker", test.run, test.file, "CMDS:", tlist.join(", "), "ARGS:", process.argv, "TEST:", test);
            process.exit(1);
        }
    }

    setTimeout(() => {
        console.log(logger.prefix("TEST"), "STARTED:", cluster.isMaster ? "master" : "worker", cmds, test.file);
        test.role = cluster.isMaster ? "master" : "worker";
        test.stime = Date.now()

        lib.forEachLimit(cmds, test.concurrency, (cmd, next) => {
            if (cluster.isMaster && test.cluster) {
                var worker = cluster.fork({ "BKJS_TEST_NAME": cmd });
                worker.on('exit', (code, signal) => { next() });
                return;
            }
            shell["test_" + cmd]((err) => { setTimeout(next.bind(null, err), test.interval) }, test);
        }, (err) => {
            test.elapsed = Date.now() - test.stime;
            if (err) shell.assert(err, test);
            setTimeout(() => {
                console.log(logger.prefix("TEST"), "FINISHED:", cluster.isMaster ? "master" : "worker", test.run, test.file);
                process.exit(0);
            }, test.delay);
        }, true);
    }, test.delay);
}

shell.cmdTestList = function(options)
{
    var test = this.initTests();
    if (!test.file) this.loadFile("tools/tests.js")
    console.log(this.listTests().join(" "));
    process.exit();
}

shell.cmdTestFile = function(options)
{
    var test = this.initTests();
    test.file = this.getArg("-test-file", options)
    if (!test.file) shell.exit("-test-file argument is required");

    this.loadFile(test.file);
    return "continue";
}

shell.cmdTestConfig = function(options)
{
    var test = this.initTests();
    test.config = lib.strSplit(this.getArg("-test-config", options));
    if (!test.config.length) shell.exit("-test-config argument is required");

    for (const conf of test.config) {
        var args = lib.readFileSync(conf, { cfg: 1 });
        core.parseArgs(args, 0, conf);
        core.parseArgs(process.argv, 0, "cmdline");

        for (let i = 0; i < args.length - 1; i++) {
            if (/^-test-/.test(args[i]) && typeof this.test[args[i].substr(6)] == "undefined") {
                this.test[args[i].substr(6)] = args[i + 1][0] != "-" ? args[i + 1] : true;
            }
        }
    }
    return "continue";
}

shell.testJob = function(options, callback)
{
    logger.info("testJob:", options);
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

