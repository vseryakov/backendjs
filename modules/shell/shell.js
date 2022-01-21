//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const cluster = require('cluster');
const util = require('util');
const fs = require('fs');
const bkjs = require("backendjs");
const core = bkjs.core;
const lib = bkjs.lib;
const logger = bkjs.logger;
const auth = bkjs.auth;
const ipc = bkjs.ipc;
const api = bkjs.api;
const jobs = bkjs.jobs;
const shell = bkjs.shell;

shell.help.push(
    "-show-info - show app and version information",
    "-show-args ... - show collected query and args for debugging purposes",
    "-run-file FILE.js - load a script and run it if it exports run function",
    "-auth-add [-scramble 1] [-bcrypt 10] login LOGIN secret SECRET [name NAME] [type TYPE] ... - add a new user record for API access",
    "-auth-update [-scramble 1] [-bcrypt 10] login LOGIN [name NAME] [type TYPE] ... - update existing user record, for web use -scramble or -bcrypt must used",
    "-auth-del login LOGIN... - delete a user record",
    "-auth-get ID|LOGIN ... - show user records",
    "-send-request -url URL [-user ID|LOGIN] [-hdr name=value] param value param value ... - send API request to the server specified in the url as user specified by login or account id, resolving the user is done directly from the current db pool, param values should not be url-encoded",
    "-log-watch - run logwatcher and exit, send emails in case any errors found");

// Exit and write to the console a message or error message if non empty
shell.exit = function(err, msg)
{
    for (var i = 0; i < arguments.length; i++) {
        if (typeof arguments[i] == "undefined" || arguments[i] === null || arguments[i] === "") continue;
        console.log(util.inspect(arguments[i], { depth: null }));
    }
    process.exit(err ? 1 : 0);
}

// Resolves a user from `obj.id` or `obj.login` params and return the record in the callback
shell.getUser = function(obj, callback)
{
    auth.get(obj, function(err, row) {
        if (err || !row) shell.exit(err, "ERROR: no user found with this id: " + util.inspect(obj));
        callback(row);
    });
}

// Returns an object with all command line params that do not start with dash(-), treat 2 subsequent parms without dashes as name value pair
shell.getQuery = function()
{
    var query = {};
    for (var i = this.cmdIndex + 2; i < process.argv.length; i++) {
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
    for (var i = process.argv.length - 1; i > this.cmdIndex; i--) {
        if (process.argv[i][0] == '-') break;
        query.unshift(process.argv[i]);
    }
    return query;
}

// Returns an object with all command line params starting with dash set with the value if the next param does not start with dash or 1.
// By sefault all args are satored as is with dahses, if `options.camel`` is true then all args will be stored in camel form,
// if `options.underscore is true then all args will be stored with dashes converted into underscores.
shell.getArgs = function(options)
{
    var query = {};
    if (!options) options = lib.empty;
    for (var i = process.argv.length - 1; i > this.cmdIndex + 1; i--) {
        var a = process.argv[i - 1], b = process.argv[i];
        if (b[0] == '-') query[options.camel ? lib.toCamel(b.substr(1)) : options.underscore ? b.substr(1).replace(/-/g, "_") : b.substr(1)] = 1; else
        if (a[0] == '-') query[options.camel ? lib.toCamel(a.substr(1)) : options.underscore ? a.substr(1).replace(/-/g, "_") : a.substr(1)] = b || 1, i--;
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
    return decodeURIComponent(String(this.getOption(name, options) || lib.getArg(name, dflt))).trim();
}

shell.getArgInt = function(name, options, dflt)
{
    return lib.toNumber(this.getArg(name, options, dflt));
}

shell.getArgList = function(name, options)
{
    if (!name) return [];
    if (!options) options = lib.empty;
    var arg = this.getOption(name, options);
    if (arg) return Array.isArray(arg) ? arg : [ arg ];
    var list = [];
    for (var i = 1; i < process.argv.length - 1; i++) {
        if (process.argv[i] == name && process.argv[i + 1][0] != "-") list.push(process.argv[i + 1]);
    }
    return list;
}

shell.isArg = function(name, options)
{
    return typeof this.getOption(name, options) != "undefined" || lib.isArg(name);
}

shell.cmdShellHelp = function()
{
    for (const i in this.help) console.log("  ", this.help[i]);
    this.exit();
}

// App version
shell.cmdShowInfo = function(options)
{
    var ver = core.appVersion.split(".");
    console.log('mode=' + core.runMode);
    console.log('name=' + core.appName);
    console.log('version=' + core.appVersion);
    console.log('major=' + (ver[0] || 0));
    console.log('minor=' + (ver[1] || 0));
    console.log('patch=' + (ver[2] || 0));
    console.log('ipaddr=' + core.ipaddr);
    console.log('network=' + core.network);
    console.log('subnet=' + core.subnet);
    for (var p in core.instance) if (core.instance[p]) console.log(p + '=' + core.instance[p]);
    this.exit();
}

shell.cmdShowArgs = function(options)
{
    console.log("query:", this.getQuery());
    console.log("options:", this.getArgs());
    this.exit();
}

shell.loadFile = function(file)
{
    var mod;
    if (!/\.js$/.test(file)) file += ".js";
    if (fs.existsSync(file)) mod = require(file); else
    if (fs.existsSync(core.cwd + "/" + file)) mod = require(core.cwd + "/" + file); else
    if (!mod &&fs.existsSync(core.home + "/" + file)) mod = require(core.home + "/" + file); else
    if (!mod && fs.existsSync(__dirname + "/../" + file)) mod = require(__dirname + "/../" + file);
    if (!mod) core.path.modules.forEach((x) => { if (!mod && fs.existsSync(x + "/../" + file)) mod = require(x + "/../" + file) });
    if (!mod) shell.exit("file not found " + file);
    return mod;
}

// Load a module and optionally execute it
//
// Example:
//
//        var bkjs = require("backendjs")
//        bkjs.app.test = 123;
//        exports.run = function() {
//            console.log("run");
//        }
//        exports.newMethod = function() {
//            console.log(bkjs.core.version, "version");
//        }
//
//  Save into a file a.js and run
//
//        bksh -run-file a.js
//
//  In the shell now it new methods can be executed
//
//        > shell.newMethod()
//
shell.cmdRunFile = function(options)
{
    var file = this.getArg("-run-file", options);
    if (!file) shell.exit("-run-file argument is required");
    var mod = this.loadFile(file);
    // Exported functions are set in the shell module
    for (var p in mod) if (typeof mod[p] == "function") shell[p] = mod[p];
    if (typeof mod.run == "function") mod.run(options);
    return "continue";
}

// Run API server inside the shell
shell.cmdRunApi = function(options)
{
    if (cluster.isMaster) api.init();
    return "continue";
}

// Run jobs workers inside the shell
shell.cmdRunJobs = function(options)
{
    if (cluster.isMaster) {
        jobs.initServer();
    } else {
        jobs.initWorker();
    }
    return "continue";
}

// Run jobs workers inside the shell
shell.cmdRunWorker = function(options)
{
    jobs.initWorker();
    return "continue";
}

// Show account records by id or login
shell.cmdAuthGet = function(options)
{
    lib.forEachSeries(process.argv.slice(2).filter((x) => (x[0] != "-")), function(login, next) {
        auth.get(login, function(err, row) {
            if (row) console.log(row);
            next();
        });
    }, this.exit);
}

// Add a user login
shell.cmdAuthAdd = function(options)
{
    auth.add(this.getQuery(), lib.objExtend(this.getArgs(), { isInternal: 1 }), this.exit);
}

// Update a user login
shell.cmdAuthUpdate = function(options)
{
    auth.update(this.getQuery(), lib.objExtend(this.getArgs(), { isInternal: 1 }), this.exit);
}

// Delete a user login
shell.cmdAuthDel = function(options)
{
    lib.forEachSeries(process.argv.slice(2).filter((x) => (x[0] != "-")), function(login, next) {
        auth.del(login, next);
    }, this.exit);
}

// Run logwatcher and exit
shell.cmdLogWatch = function(options)
{
    core.watchLogs(this.exit);
}

// Send API request
shell.cmdSendRequest = function(options)
{
    var query = this.getQuery();
    var url = this.getArg("-url", options);
    var login = this.getArg("-user", options);
    var select = lib.strSplit(this.getArg("-select", options));
    var json = this.isArg("-json", options);
    var raw = this.isArg("-raw", options);
    var flatten = this.isArg("-flatten", options)
    var headers = this.getArgList("-hdr", options).reduce((x, y) => { y = y.split("="); x[y[0]] = y[1]; return x }, {});
    lib.series([
      function(next) {
          if (!login) return next();
          shell.getUser(login, function(user) {
              next(null, user);
          });
      },
      function(next, user) {
        core.sendRequest({ url: url, login: user && user.login, secret: user && user.secret, query: query, headers: headers }, function(err, params) {
            if (err) shell.exit(err);
            if (select.length) {
                var obj = {};
                for (const i in select) lib.objSet(obj, select[i], lib.objGet(params.obj, select[i]));
                params.obj = obj;
            }
            if (flatten) params.obj = lib.objFlatten(params.obj);
            shell.exit(err, raw ? params.data : json ? lib.stringify(params.obj) : params.obj);
        });
      },
    ]);
}

