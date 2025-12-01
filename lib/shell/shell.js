/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const util = require('util');
const path = require('path');
const fs = require('fs');
const modules = require("../modules");
const { app, lib, api, jobs, cache, queue, shell, stats, httpGet } = modules;

shell.help.push(
    "-help-config - show all config parameters",
    "-exit - exit shell",
    "-exit-timeout N - delay exit for N milliseconds",
    "-show-info - show app and version information",
    "-show-args ... - show collected query and args for debugging purposes",
    "-run-file FILE.js - load a script and run it if it exports run function",
    "-run-config FILE - load a config file",
    "-run-api - initialize web server inside the server shell only",
    "-run-worker - initialize job worker in server shell only",
    "-run-ipc - initialize all cache clients in all shells",
    "-run-jobs - initialize jobs in server and workers",
    "-send-request -url URL [-method GET|POST] [-raw] [-user ID|LOGIN] [-csrf URL] [-hdr name=value] [-cookie name=value] param value param value ... - send API request to the server specified in the url as user specified by login or id, resolving the user is done directly from the current db pool, param values should not be url-encoded",
    "-log-watch - run logwatcher and exit, send emails in case any errors found",
    "-submit-job -job NAME [-option value ...] param value... - submit a job, all params without dashes will be passed to the job handler, all options with dashes will be passed in options",
    "-stats [-age S] [-interval S] [-groups tag] [-fields host_cpu_util] [-raw] [-count N] [-since DATE] [-before DATE] - show aggregated stats from bk_stats table",
);

// Exit and write to the console a message or error message if non empty
shell.exit = function(err, msg)
{
    shell.log(...arguments);
    if (lib.isArg("-noexit")) return;
    setTimeout(() => { process.exit(err ? 1 : 0) }, shell.exitTimeout);
}

// Exit with error code and dump all arguments to the stderr, backtrace as well
shell.die = function(...args)
{
    for (const a of args) {
        console.error(!a ? "" : util.inspect(a, { depth: 10, showHidden: true, compact: 10 }).split("\n").map((x) => ("   " + x)).join("\n"));
    }
    var e = {};
    Error.stackTraceLimit = 32;
    Error.captureStackTrace(e, shell.die);
    console.error(e.stack.replace("Error", "Backtrace:"), "\n");
    process.exit(1);
}

shell.log = function(...args)
{
    for (const arg of args) {
        if (arg === undefined || arg === null || arg === "") continue;
        console.log(util.inspect(arg, { depth: null, showHidden: true, compact: 10 }));
    }
}

shell.jsonFormat = function(...args)
{
    for (const arg of args) {
        if (arg === undefined || arg === null || arg === "") continue;
        console.log(lib.jsonFormat(arg, { preset: "compact", ignore: app.logInspect.ignore }));
    }
}

// Returns an object with all command line params that do not start with dash(-), treat 2 subsequent parms without dashes as name value pair
shell.getQuery = function(options)
{
    var query = {};
    var index = typeof options?.index == "number" ? options.index : 1;
    for (var i = index + 2; i < process.argv.length; i++) {
        var a = process.argv[i - 1], b = process.argv[i];
        if (a[0] == '-' && b[0] != '-') i++; else
        if (a[0] != '-' && b[0] != '-') query[a] = b, i++;
    }
    return query;
}

// Returns a list with all command line params that do not start with dash(-), only the trailing arguments will be collected
shell.getQueryList = function()
{
    var query = [];
    for (var i = process.argv.length - 1; i > 1; i--) {
        if (process.argv[i][0] == '-') break;
        query.unshift(process.argv[i]);
    }
    return query;
}

/**
 * Returns an object with all command line params starting with dash set with the value if the next param does not start with dash or 1.
 * By sefault all args are stored as is with dashes, if `options.camel`` is true then all args will be stored in camel form,
 * if `options.underscore is true then all args will be stored with dashes converted into underscores.
 * `options.index` can be used to get the args from any position
 */
shell.getArgs = function(options)
{
    var query = {};
    var index = typeof options?.index == "number" ? options.index : 1;
    for (var i = process.argv.length - 1; i > index + 1; i--) {
        var a = process.argv[i - 1], b = process.argv[i];
        if (b[0] == '-') query[options?.camel ? lib.toCamel(b.substr(1)) : options?.underscore ? b.substr(1).replace(/-/g, "_") : b.substr(1)] = 1; else
        if (a[0] == '-') query[options?.camel ? lib.toCamel(a.substr(1)) : options?.underscore ? a.substr(1).replace(/-/g, "_") : a.substr(1)] = b || 1, i--;
    }
    return query;
}

// Return an argument by name from the options, options may contain parameters in camel form or with underscores, both formats will be checked
shell.getOption = function(name, options)
{
    return name && options ? options[lib.toCamel(name.substr(1))] || options[name.substr(1).replace(/-/g, "_")] : undefined;
}

// Return first available value for the given name, options first, then command arg and then default,
shell.getArg = function(name, options, dflt)
{
    return decodeURIComponent(String(shell.getOption(name, options) || lib.getArg(name, dflt))).trim();
}

shell.getArgInt = function(name, options, dflt)
{
    return lib.toNumber(shell.getArg(name, options, dflt));
}

// Returns a list of all values for the given argument name, it handles duplicate arguments with the same name
shell.getArgList = function(name, options)
{
    if (!name) return [];
    var arg = shell.getOption(name, options);
    if (arg) return Array.isArray(arg) ? arg : [ arg ];
    var list = [];
    for (var i = 1; i < process.argv.length - 1; i++) {
        if (process.argv[i] == name && process.argv[i + 1][0] != "-") list.push(process.argv[i + 1]);
    }
    return list;
}

shell.isArg = function(name, options)
{
    return typeof shell.getOption(name, options) != "undefined" || lib.isArg(name);
}

shell.loadFile = function(file)
{
    var mod;
    if (!/\.js$/.test(file)) file += ".js";
    if (fs.existsSync(file)) mod = require(path.resolve(file)); else
    if (fs.existsSync(app.cwd + "/" + file)) mod = require(app.cwd + "/" + file); else
    if (!mod &&fs.existsSync(app.home + "/" + file)) mod = require(app.home + "/" + file); else
    if (!mod && fs.existsSync(__dirname + "/../" + file)) mod = require(__dirname + "/../" + file);
    if (!mod) app.path.modules.forEach((x) => { if (!mod && fs.existsSync(x + "/../" + file)) mod = require(x + "/../" + file) });
    if (!mod) return shell.exit("file not found " + file);
    return mod;
}

shell.commands.exit = function()
{
    shell.exit();
}

shell.commands.help = function()
{
    for (const i in shell.help) console.log("  ", shell.help[i]);
    shell.exit();
}

shell.commands.helpConfig = function()
{
    console.log("# Config parameters");

    Object.keys(modules).forEach((n) => {
        if (!modules[n].args) return;
        console.log(`- [${modules[n].name}](#${modules[n].name})`);
    });

    Object.keys(modules).forEach((n) => {
        if (!modules[n].args) return;

        console.log(`# <a name="${modules[n].name}">${modules[n].name}</a>`);
        console.log("See {@link module:" + modules[n].name + "}");

        modules[n].args.forEach((y) => {
            if (!y.name || !y.descr) return;
            var name = y._name?.length && y._name[0] || y.make || y.name;
            if (y.strip) name = name.replace(y.strip, "");
            if (!y.nocamel) name = lib.toCamel(name, y.camel || "-");
            var dflt = lib.objGet(modules[n], name);
            console.log(`#### **${n.replace(".", "-")}-${y.name}**\n`, y.descr, "  ");
            if (y.type) {
                console.log("  Type: " + y.type, "  ");
            }
            if (dflt && typeof dflt != "function") {
                console.log("  Default: " + JSON.stringify(dflt), "  ");
            }
            if (y.example) {
                console.log("  Example:  ", "\n```\n", y.example, "\n```\n");
            }
        });
    });
    process.exit(0);
}

// App version
shell.commands.showInfo = function(options)
{
    var info = {
        home: app.home,
        host: app.host,
        ipaddr: app.ipaddr,
        runMode: app.runMode,
        config: app.config,
        appName: app.appName,
        appVersion: app.appVersion,
        instance: app.instance,
        path: app.path,
        packages: app.packages,
        modules: app._modules,
    };
    shell.jsonFormat(info);
    shell.exit();
}


shell.commands.showArgs = function(options)
{
    console.log("query:", shell.getQuery());
    console.log("options:", shell.getArgs());
    shell.exit();
}

/**
 * Load a module and optionally execute it
 *
 * @example
 *
 * var { app } = require("backendjs")
 * app.test = 123;
 * exports.run = function() {
 *   console.log("run");
 * }
 * exports.newMethod = function() {
 *   console.log(app.version, "version");
 * }
 *
 * // Save into a file a.js and run
 *
 *   bksh -run-file a.js
 *
 * // In the shell now it new methods can be executed
 *
 *    > shell.newMethod()
 */
shell.commands.runFile = function(options)
{
    var file = shell.getArg("-run-file", options);
    if (!file) return shell.exit("-run-file argument is required");
    var mod = shell.loadFile(file);
    // Exported functions are set in the shell module
    for (var p in mod) if (typeof mod[p] == "function") shell[p] = mod[p];
    if (typeof mod.run == "function") mod.run(options);
    return "continue";
}

// Load a config file
shell.commands.runConfig = function(options)
{
    var file = shell.getArg("-run-config", options);
    if (!file) return shell.exit("-run-config argument is required");
    var args = lib.readFileSync(file, { cfg: 1 });
    app.parseArgs(args, 0, file);
    app.parseArgs(process.argv, 0, "cmdline");
    return "continue";
}

// Initialize ipc/cache clients
shell.commands.runIpc = function(options)
{
    queue.checkConfig();
    cache.checkConfig();
    return "continue";
}

// Run API server inside the shell
shell.commands.runApi = function(options)
{
    if (app.isPrimary) api.init();
    return "continue";
}

// Run jobs workers inside the shell
shell.commands.runJobs = function(options)
{
    if (app.isPrimary) {
        jobs.initServer();
    } else {
        jobs.initWorker();
    }
    return "continue";
}

// Run jobs workers inside the shell
shell.commands.runWorker = function(options)
{
    if (app.isPrimary) jobs.initWorker();
    return "continue";
}

// Run logwatcher and exit
shell.commands.logWatch = function(options)
{
    app.watchLogs(shell.exit);
}

// Send API request
shell.commands.sendRequest = function(options)
{
    var query = shell.getQuery();
    var url = shell.getArg("-url", options);
    var method = shell.getArg("-method", options);
    var login = shell.getArg("-user", options);
    var select = lib.strSplit(shell.getArg("-select", options));
    var json = shell.isArg("-json", options);
    var raw = shell.isArg("-raw", options);
    var flatten = shell.isArg("-flatten", options)
    var csrf = shell.getArg("-csrf", options);
    var headers = shell.getArgList("-hdr", options).reduce((x, y) => { y = y.split("="); x[y[0]] = y[1]; return x }, {});
    var cookies = shell.getArgList("-cookie", options).reduce((x, y) => { y = y.split("="); x[y[0]] = y[1]; return x }, {});
    lib.series([
        function(next) {
            if (!login) return next();
            api.users.get(login, (err, row) => {
                if (err || !row) return shell.exit(err, "ERROR: no user found with this id: " + login);
                next(null, row);
            });
        },
        function(next, user) {
            if (!csrf) return next();
            httpGet({ url: csrf, method: method, cookies: {} }, (err, rc) => {
                if (err) shell.exit(err);
                if (rc.resheaders[api.csrfHeaderName]) {
                    headers[api.csrfHeaderName] = rc.resheaders[api.csrfHeaderName];
                }
                if (rc.rescookies[api.csrfHeaderName]) {
                    cookies[api.csrfHeaderName] = rc.rescookies[api.csrfHeaderName].value;
                }
                next(null, user);
            });
        },
        function(next, user) {
            var q = {
                url: url,
                method: method,
                login: user?.login,
                secret: user?.secret,
                postdata: method && query,
                query: !method && query,
                headers: headers,
                cookies: cookies,
                signer: function () {
                    if (!this.login || !this.secret) return;
                    this.contentType = this.headers['content-type'];
                    var sig = api.signature.create(this.login, this.secret, this);
                    this.headers[sig.header] = sig.value;
                }
            };
            httpGet(q, (err, rc) => {
                if (err) shell.exit(err);
                if (select.length) {
                    var obj = {};
                    for (const i in select) lib.objSet(obj, select[i], lib.objGet(rc.obj, select[i]));
                        rc.obj = obj;
                }
                if (flatten) rc.obj = lib.objFlatten(rc.obj);
                shell.exit(err, raw ? rc.data : json ? lib.stringify(rc.obj) : rc.obj, raw ? rc.resheaders : null);
            });
        },
    ], null, true);
}

// Send API request
shell.commands.submitJob = function(options)
{
    var job = shell.getArg("-job", options);
    if (!job) return shell.exit("-job argument is required");
    var opts = shell.getArgs();
    var query = shell.getQuery();
    delete opts.job;
    jobs.submitJob({ job: { [job]: query } }, opts, shell.exit)
}

shell.commands.stats = function(options, callback)
{
    var opts = {
        pool: shell.getArg("-pool", options, "elasticsearch"),
        groups: shell.getArg("-groups", options, "tag"),
        tags: shell.getArg("-tags", options),
        tsize: shell.getArgInt("-tsize", options),
        ssize: shell.getArgInt("-ssize", options),
        trim: shell.getArgInt("-trim", options),
        timedelta: shell.getArgInt("-timedelta", options) * 1000,
        age: shell.getArgInt("-age", options, 300) * 1000,
        interval: shell.getArgInt("-interval", options, 60) * 1000,
        fields: shell.getArg("-fields", options, "host_cpu_util"),
        count: shell.getArgInt("-count", options),
        since: shell.getArgInt("-since", options),
        before: shell.getArgInt("-before", options),
        columns: lib.jsonParse(shell.getArg("-columns", options), { empty: 1, logger: "error" }),
    }

    stats.queryElasticsearch(opts, (err, rc) => {
        if (!err) {
            if (shell.isArg("-raw")) {
                shell.jsonFormat(rc);
            } else {
                for (const k in rc.data) {
                    for (const p in rc.data[k]) {
                        rc.data[k][p] = rc.data[k][p].map((x) => (Math.round(x))).sort((a, b) => (b - a)).join(", ");
                    }
                }
                if (shell.isArg("-flatten")) {
                    rc.data = lib.objFlatten(rc.data);
                }
                var header = "# key, fields, " + rc.timestamps.map((x) => (lib.toAge(x, { short: 1, round: 2 }))).join(", ");
                shell.jsonFormat(header, rc.data, rc.rows, shell.isArg("-info") ? rc.info : "");
            }
        }
        shell.exit(err);
    });
}


