//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const cluster = require('cluster');
const util = require('util');
const fs = require('fs');
const core = require(__dirname + '/../lib/core');
const lib = require(__dirname + '/../lib/lib');
const logger = require(__dirname + '/../lib/logger');
const db = require(__dirname + '/../lib/db');
const ipc = require(__dirname + '/../lib/ipc');
const api = require(__dirname + '/../lib/api');
const jobs = require(__dirname + '/../lib/jobs');

const shell = {
    name: "bk_shell",
    help: [
        "-show-info - show app and version information",
        "-run-file FILE.js - load a script and run it if it exports run function",
        "-login-get LOGIN ... - show login records",
        "-login-add [-noscramble] login LOGIN secret SECRET [name NAME] [type TYPE] ... - add a new login record for API access",
        "-login-update [-scramble 1] login LOGIN [name NAME] [type TYPE] ... - update existing login record, for web use -scramble must be set to 1",
        "-login-del login LOGIN... - delete a login record",
        "-account-get ID|LOGIN ... - show accounts by id or login",
        "-account-add [-noscramble] login LOGIN secret SECRET [name NAME] [email EMAIL] [type TYPE] ... - add a new user for API access, any property from bk_account can be passed in the form: name value",
        "-account-update [-noscramble] [login LOGIN|id ID] [name NAME] [email EMAIL] [type TYPE] ... - update existing user properties, any property from bk_account can be passed in the form: name value ",
        "-account-del [login LOGIN|id ID]... - delete a user and login",
        "-location-put [login LOGIN|id ID] latitude LAT longitude LON ... - update location for an account",
        "-send-request -url URL [-id ID|-login LOGIN] param value param value ... - send API request to the server specified in the url as user specified by login or account id, resolving the user is done directly from the current db pool, param values should not be url-encoded",
        "-log-watch - run logwatcher and exit, send emails in case any errors found",
    ],
}

module.exports = shell;

// Exit and write to the console a message or error message if non empty
shell.exit = function(err, msg)
{
    for (var i = 0; i < arguments.length; i++ ) {
        if (typeof arguments[i] == "undefined" || arguments[i] === null || arguments[i] === "") continue;
        console.log(arguments[i]);
    }
    process.exit(err ? 1 : 0);
}

// Resolves a user from `obj.id` or `obj.login` params and return the record in the callback
shell.getUser = function(obj, callback)
{
    db.get("bk_account", { id: obj.id }, function(err, row) {
        if (err) shell.exit(err);

        db.get(api.authTable, { login: row ? row.login : obj.login }, function(err, row2) {
            if (err || !(row ||row2)) shell.exit(err, "ERROR: no user found with this id: " + util.inspect(obj));
            callback(row || row2);
        });
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
// By sefault all args are zatored as is with dahses, if `options.camel`` is true then all args will be stored in camel form,
// if `options.underscor`e is true then all args will be stored with dashes convertyed into underscores.
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
    return name && options ? options[lib.toCamel(name.substr(1))] || options[name.substr(1).replace(/-/g, "_")] : "";
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

// Start REPL shell or execute any subcommand if specified in the command line.
// A subcommand may return special string to indicate how to treat the flow:
// - stop - stop processing commands and create REPL
// - continue - do not exit and continue processing other commands or end with REPL
// - all other values will result in returning from the run assuming the command will decide what to do, exit or continue running, no REPL is created
shell.runShell = function(options)
{
    process.title = core.name + ": shell";

    logger.debug('startShell:', process.argv);

    // Load all default shell modules
    var mods = lib.findFileSync(__dirname + "/../modules", { include: /bk_shell_[a-z]+\.js$/ });
    core.path.modules.forEach(function(mod) {
        mods = mods.concat(lib.findFileSync(mod, { include: /bk_shell_[a-z]+\.js$/ }));
    });
    for (var i in mods) require(mods[i]);

    core.runMethods("configureShell", options, function(err) {
        if (options.done) shell.exit();

        ipc.initServer();

        for (var i = 1; i < process.argv.length; i++) {
            if (process.argv[i][0] != '-') continue;
            var name = lib.toCamel("cmd" + process.argv[i]);
            if (typeof shell[name] != "function") continue;
            shell.cmdName = name;
            shell.cmdIndex = i;
            var rc = shell[name](options);
            if (rc == "stop") break;
            if (rc == "continue") continue;
            return;
        }
        if (cluster.isMaster) core.createRepl({ file: core.repl.file });
    });
}

shell.cmdShellHelp = function()
{
    for (var i in this.help) console.log("  ", this.help[i]);
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

shell.loadFile = function(file)
{
    var mod;
    if (!/\.js$/.test(file)) file += ".js";
    if (fs.existsSync(core.cwd + "/" + file)) mod = require(core.cwd + "/" + file); else
    if (!mod &&fs.existsSync(core.home + "/" + file)) mod = require(core.home + "/" + file); else
    if (!mod && fs.existsSync(__dirname + "/../" + file)) mod = require(__dirname + "/../" + file);
    if (!mod) core.path.modules.forEach(function(x) { if (!mod && fs.existsSync(x + "/../" + file )) mod = require(x + "/../" + file) });
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

// Show account records by id or login
shell.cmdAccountGet = function(options)
{
    lib.forEachSeries(process.argv.slice(2), function(id, next) {
        if (id.match(/^[-\/]/)) return next();
        db.get("bk_account", { id: id }, function(err, user) {
            if (user) {
                db.get(api.authTable, { login: user.login }, function(err, auth) {
                    user.bk_auth = auth;
                    console.log(user);
                    next();
                });
            } else {
                db.get(api.authTable, { login: id }, function(err, auth) {
                    if (!auth) return next();
                    db.get("bk_account", { id: auth.id }, function(err, user) {
                        if (!user) {
                            console.log(auth);
                        } else {
                            user.bk_auth = auth;
                            console.log(user);
                        }
                        next();
                    });
                });
            }
        });
    }, function(err) {
        shell.exit(err);
    });
}

// Add a user
shell.cmdAccountAdd = function(options)
{
    if (!core.modules.bk_account) this.exit("accounts module not loaded");
    var query = this.getQuery();
    var opts = api.getOptions({ query: this.getArgs(), options: { path: ["", "", ""], ops: {} } });
    opts.scramble = this.isArg("-noscramble", options) ? 0 : 1;
    if (query.login && !query.name) query.name = query.login;
    core.modules.bk_account.addAccount({ query: query, account: { type: 'admin' } }, opts, function(err, data) {
        shell.exit(err, data);
    });
}

shell.cmdAccountUpdate = function(options)
{
    if (!core.modules.bk_account) this.exit("accounts module not loaded");
    var query = this.getQuery();
    var opts = api.getOptions({ query: this.getArgs(), options: { path: ["", "", ""], ops: {} } });
    this.getUser(query, function(row) {
        core.modules.bk_account.updateAccount({ account: row, query: query }, opts, function(err, data) {
            shell.exit(err, data);
        });
    });
}

// Delete a user and all its history according to the options
shell.cmdAccountDel = function(options)
{
    if (!core.modules.bk_account) this.exit("accounts module not loaded");
    var query = this.getQuery();
    var opts = api.getOptions({ query: this.getArgs(), options: { path: ["", "", ""], ops: {} } });
    for (var i = 1; i < process.argv.length - 1; i += 2) {
        if (process.argv[i] == "-keep") opts["keep_" + process.argv[i + 1]] = 1;
    }
    if (this.isArg("-force", options)) opts.force = 1;
    this.getUser(query, function(row) {
        opts.id = row.id;
        core.modules.bk_account.deleteAccount({ account: row, obj: query, options: opts }, function(err) {
            shell.exit(err);
        });
    });
}

// Show account records by id or login
shell.cmdLoginGet = function(options)
{
    lib.forEachSeries(process.argv.slice(2), function(login, next) {
        if (login.match(/^[-\/]/)) return next();
        db.get(api.authTable, { login: login }, function(err, auth) {
            if (auth) console.log(auth);
            next();
        });
    }, function(err) {
        shell.exit(err);
    });
}

// Add a user login
shell.cmdLoginAdd = function(options)
{
    var query = this.getQuery();
    var opts = api.getOptions({ query: this.getArgs(), options: { path: ["", "", ""], ops: {} } });
    if (query.login && !query.name) query.name = query.login;
    api.addAccount(query, opts, function(err, data) {
        shell.exit(err, data);
    });
}

// Update a user login
shell.cmdLoginUpdate = function(options)
{
    var query = this.getQuery();
    var opts = api.getOptions({ query: this.getArgs(), options: { path: ["", "", ""], ops: {} } });
    api.updateAccount(query, opts, function(err, data) {
        shell.exit(err, data);
    });
}

// Delete a user login
shell.cmdLoginDel = function(options)
{
    lib.forEachSeries(process.argv.slice(2), function(login, next) {
        if (login.match(/^[-\/]/)) return next();
        db.del(api.authTable, { login: login }, function(err) {
            next(err);
        });
    }, function(err) {
        shell.exit(err);
    });
}

// Update location
shell.cmdLocationPut = function(options)
{
    if (!core.modules.bk_location) this.exit("locations module not loaded");
    var query = this.getQuery();
    this.getUser(query, function(row) {
        core.modules.bk_location.putLocation({ account: row, query: query }, {}, function(err, data) {
            shell.exit(err, data);
        });
    });
}

// Run logwatcher and exit
shell.cmdLogWatch = function(options)
{
    core.watchLogs(function(err) {
        shell.exit(err);
    });
}

// Send API request
shell.cmdSendRequest = function(options)
{
    var query = this.getQuery();
    var url = this.getArg("-url", options);
    var id = this.getArg("-id", options);
    var login = this.getArg("-login", options);
    var select = lib.strSplit(this.getArg("-select", options));
    var json = this.isArg("-json", options);
    var flatten = this.isArg("-flatten", options)
    lib.series([
      function(next) {
          if (!id && !login) return next();
          shell.getUser({ id: id, login: login }, function(row) {
              next(null, row);
          });
      },
      function(next, user) {
        core.sendRequest({ url: url, login: user && user.login, secret: user && user.secret, query: query }, function(err, params) {
            if (err) shell.exit(err);
            if (select.length) {
                var obj = {};
                for (var i in select) lib.objSet(obj, select[i], lib.objGet(params.obj, select[i]));
                params.obj = obj;
            }
            if (flatten) params.obj = lib.objFlatten(params.obj);
            shell.exit(err, json ? lib.stringify(params.obj) : params.obj);
        });
      },
    ]);
}

// If executed as standalone script directly in the node
if (!module.parent) core.init({ role: "shell" }, function(err, opts) { shell.run(opts); });
