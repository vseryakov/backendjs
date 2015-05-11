//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var net = require('net');
var cluster = require('cluster');
var domain = require('domain');
var cron = require('cron');
var path = require('path');
var util = require('util');
var url = require('url');
var fs = require('fs');
var spawn = require('child_process').spawn;
var exec = require('child_process').exec;
var core = require(__dirname + '/core');
var lib = require(__dirname + '/lib');
var logger = require(__dirname + '/logger');
var db = require(__dirname + '/db');
var aws = require(__dirname + '/aws');
var ipc = require(__dirname + '/ipc');
var api = require(__dirname + '/api');
var app = require(__dirname + '/app');
var os = require('os');

var shell = {
    name: "shell",
}

module.exports = shell;

// Exit and write to the console a message or error message if non empty
shell.exit = function(err, msg)
{
    if (err) console.log(err);
    if (msg) console.log(msg);
    process.exit(err ? 1 : 0);
}

// Resolves a user from `obj.id` or `obj.login` params and return the record in the callback
shell.getUser = function(obj, callback)
{
    db.get("bk_account", { id: obj.id }, function(err, row) {
        if (err) exit(err);

        db.get("bk_auth", { login: row ? row.login : obj.login }, function(err, row) {
            if (err || !row) exit(err, "ERROR: no user found with this id: " + util.inspect(obj));
            callback(row);
        });
    });
}

// Returns an object with all command line params that do not start with dash(-), treat 2 subsequent parms without dashes as name value pair
shell.getQuery = function()
{
    var query = {};
    for (var i = process.argv.length - 1; i > 1; i -= 2) {
        var a = process.argv[i - 1][0], b = process.argv[i][0];
        if (a != '-' && b != '-') query[process.argv[i - 1]] = process.argv[i];
    }
    return query;
}

// Returns an object with all command line params starting with dash set with the value if the next param does not start with dash or 1,
// this is API query emulaton and only known API parameters will be set, all other config options must be handkled by each command separately
shell.getOptions = function()
{
    var query = {};
    for (var i = process.argv.length - 1; i > 1; i -= 2) {
        var a = process.argv[i - 1][0], b = process.argv[i][0];
        if (a == '-') query[process.argv[i - 1]] = b != '-' ? process.argv[i] : 1;
    }
    return api.getOptions({ query: query, options: { path: ["", "", ""], ops: {} } });
}

// Start REPL shell or execute any subcommand if specified in the command line.
// A subcommand may return special string to indicate how to treat the flow:
// - stop - stop processing commands and create REPL
// - continue - do not exit and continue processing other commands or end with REPL
// - all other values will result in returning from the run assuming the command will decide what to do, exit or continue running, no REPL is created
shell.run = function(options)
{
    var self = this;
    process.title = core.name + ": shell";

    logger.debug('startShell:', process.argv);

    core.runMethods("configureShell", options, function(err, opts) {
        if (opts.done) exit();

        for (var i = 1; i < process.argv.length; i++) {
            if (process.argv[i][0] != '-') continue;
            var name = lib.toCamel("cmd" + process.argv[i]);
            if (typeof self[name] != "function") continue;
            var rc = self[name](opts);
            if (rc == "stop") break;
            if (rc == "continue") continue;
            return;
        }
        ipc.initWorker();
        core.createRepl();
    });
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
    console.log('domain=' + core.domain);
    this.exit();
}

// Run API server inside the shell
shell.cmdRunApi = function(options)
{
    api.init();
    return "continue";
}

// Add a user
shell.cmdAccountAdd = function(options)
{
    var self = this;
    if (!core.modules.accounts) exit("accounts module not loaded");
    var query = this.getQuery();
    var opts = this.getOptions();
    if (core.isArg("-scramble")) opts.scramble = 1;
    if (query.login && !query.name) query.name = query.login;
    core.modules.accounts.addAccount({ query: query, account: { type: 'admin' } }, opts, function(err, data) {
        self.exit(err, data);
    });
}

// Delete a user and all its history according to the options
shell.cmdAccountUpdate = function(options)
{
    var self = this;
    if (!core.modules.accounts) this.exit("accounts module not loaded");
    var query = this.getQuery();
    var opts = this.getOptions();
    if (core.isArg("-scramble")) opts.scramble = 1;
    this.getUser(query, function(row) {
        core.modules.accounts.updateAccount({ account: row, query: query }, opts, function(err, data) {
            self.exit(err, data);
        });
    });
}

// Delete a user and all its history according to the options
shell.cmdAccountDel = function(options)
{
    var self = this;
    if (!core.modules.accounts) this.exit("accounts module not loaded");
    var query = this.getQuery();
    var opts = {};
    for (var i = 1; i < process.argv.length - 1; i += 2) {
        if (process.argv[i] == "-keep") opts[process.argv[i + 1]] = 1;
    }
    this.getUser(query, function(row) {
        core.modules.accounts.deleteAccount(row.id, opts, function(err, data) {
            self.exit(err, data);
        });
    });
}

// Update location
shell.cmdLocationPut = function(options)
{
    var self = this;
    if (!core.modules.locations) this.exit("locations module not loaded");
    var query = this.getQuery();
    this.getUser(query, function(row) {
        core.modules.locations.putLocation({ account: row, query: query }, {}, function(err, data) {
            self.exit(err, data);
        });
    });
}

// Run logwatcher and exit
shell.cmdLogWatch = function(options)
{
    var self = this;
    core.watchLogs(function(err) {
        self.exit(err);
    });
}

// Get file
shell.cmdS3Get = function(options)
{
    var self = this;
    var query = this.getQuery();
    var file = core.getArg("-file");
    var uri = core.getArg("-path");
    query.file = file || uri.split("?")[0].split("/").pop();
    aws.s3GetFile(uri, query, function(err, data) {
        self.exit(err, data);
    });
}

// Put file
shell.cmdS3Put = function(options)
{
    var self = this;
    var query = this.getQuery();
    var path = core.getArg("-path");
    var uri = core.getArg("-file");
    aws.s3PutFile(uri, file, query, function(err, data) {
        self.exit(err, data);
    });
}

// Show all config parameters
shell.cmdDbGetConfig = function(options)
{
    var self = this;
    var opts = this.getQuery();
    var sep = core.getArg("-separator", "=");
    var fmt = core.getArg("-format");
    db.initConfig(opts, function(err, data) {
        if (fmt == "text") {
            for (var i = 0; i < data.length; i += 2) console.log(data[i].substr(1) + (sep) + data[ i + 1]);
        } else {
            console.log(JSON.stringify(data));
        }
        self.exit(err);
    });
}

// Show all tables
shell.cmdDbTtables = function(options)
{
    var sep = core.getArg("-separator", "\n");
    var tables = db.getPoolTables(db.pool, { names: 1 });
    console.log(tables.join(sep));
    this.exit(err);
}

// Show record that match the search criteria, return up to `-count N` records
shell.cmdDbSelect = function(options)
{
    var self = this;
    var query = this.getQuery();
    var opts = this.getOptions();
    var table = core.getArg("-table");
    var sep = core.getArg("-separator", "!");
    var fmt = core.getArg("-format");
    var cols = Object.keys(db.getColumns(table))
    db.select(table, query, opts, function(err, data) {
        if (data && data.length) {
            if (fmt == "text") {
                data.forEach(function(x) { console.log((cols || Object.keys(x)).map(function(y) { return x[y] }).join(sep)) });
            } else {
                data.forEach(function(x) { console.log(JSON.stringify(x)) });
            }
        }
        self.exit(err);
    });
}

// Show all records that match search criteria
shell.cmdDbScan = function(options)
{
    var self = this;
    var query = this.getQuery();
    var opts = this.getOptions();
    var table = core.getArg("-table");
    var sep = core.getArg("-separator", "!");
    var fmt = core.getArg("-format");
    var cols = Object.keys(db.getColumns(table));
    db.scan(table, query, opts, function(row, next) {
        if (fmt == "text") {
            console.log((cols || Object.keys(row)).map(function(y) { return row[y] }).join(sep));
        } else {
            console.log(JSON.stringify(row));
        }
        next();
    }, function(err) {
        self.exit(err);
    });
}

// Save all tables to the specified directory or the server home
shell.cmdDbBackup = function(options)
{
    var self = this;
    var opts = this.getOptions();
    var root = core.getArg("-path");
    var filter = core.getArg("-filter");
    var tables = lib.strSplit(core.getArg("-tables"));
    if (!tables.length) tables = db.getPoolTables(db.pool, { names: 1 });
    lib.forEachSeries(tables, function(table, next) {
        file = path.join(root, table +  ".json");
        fs.writeFileSync(file, "");
        db.scan(table, query, opts, function(row, next2) {
            if (filter && app[filter]) app[filter](table, row);
            fs.appendFileSync(file, JSON.stringify(row) + "\n");
            next2();
        }, next);
    }, function(err) {
        logger.info("dbBackup:", root, tables, opts);
        self.exit(err);
    });
}

// Restore tables
shell.cmdDbRestore = function(options)
{
    var self = this;
    var opts = this.getOptions();
    var root = core.getArg("-path");
    var filter = core.getArg("-filter");
    var tables = lib.strSplit(core.getArg("-tables"));
    var files = lib.findFileSync(root, { depth: 1, types: "f", include: /\.json$/ });
    if (core.isArg("-drop")) opts.drop = 1;
    if (core.isArg("-continue")) opts.continue = 1;
    opts.errors = 0;
    lib.forEachSeries(files, function(file, next3) {
        var table = path.basename(file, ".json");
        if (tables.length && tables.indexOf(table) == -1) return next3();
        var cap = db.getCapacity(table);
        opts.readCapacity = cap.readCapacity;
        opts.writeCapacity = cap.writeCapacity;
        lib.series([
            function(next) {
                if (!opts.drop) return next();
                db.drop(table, opts, next);
            },
            function(next) {
                if (!opts.drop) return next();
                setTimeout(next, opts.timeout || 500);
            },
            function(next) {
                if (!opts.drop) return next();
                db.create(table, db.getTableProperties(table, opts), opts, next);
            },
            function(next) {
                if (!opts.drop) return next();
                setTimeout(next, options.timeout || 500);
            },
            function(next) {
                if (!opts.drop) return next();
                db.cacheColumns(opts, next);
            },
            function(next) {
                lib.forEachLine(file, opts, function(line, next2) {
                    var row = lib.jsonParse(line, { error: 1 });
                    if (!row) return next2(opts.continue ? null : "ERROR: parse error, line: " + opts.lines);
                    if (filter && app[filter]) app[filter](table, row);
                    db.put(table, row, opts, function(err) {
                        if (err && !opts.continue) return next2(err);
                        if (err) opts.errors++;
                        db.checkCapacity(cap, next2);
                    });
                }, next);
            }], next3);
    }, function(err) {
        logger.info("dbRestore:", root, tables || files, opts);
        self.exit(err);
    });
}

// Put config entry
shell.cmdDbGet = function(options)
{
    var self = this;
    var query = this.getQuery();
    var opts = this.getOptions();
    var table = core.getArg("-table");
    var sep = core.getArg("-separator", "!");
    var fmt = core.getArg("-format");
    var cols = Object.keys(db.getColumns(table))
    db.get(table, query, opts, function(err, data) {
        if (data) {
            if (fmt == "text") {
                console.log((cols || Object.keys(data)).map(function(y) { return x[y] }).join(sep))
            } else {
                console.log(JSON.stringify(data));
            }
        }
        self.exit(err);
    });
}

// Put config entry
shell.cmdDbPut = function(options)
{
    var self = this;
    var query = this.getQuery();
    var opts = this.getOptions();
    var table = core.getArg("-table");
    db.put(table, query, opts, function(err, data) {
        self.exit(err);
    });
}

// Delete a recprd
shell.cmdDbDel = function(options)
{
    var self = this;
    var query = this.getQuery();
    var opts = this.getOptions();
    var table = core.getArg("-table");
    db.del(table, query, opts, function(err, data) {
        self.exit(err);
    });
}

// Delete all records
shell.cmdDbDelAll = function(options)
{
    var self = this;
    var query = this.getQuery();
    var opts = this.getOptions();
    var table = core.getArg("-table");
    db.delAll(table, query, opts, function(err, data) {
        self.exit(err);
    });
}

// Drop a table
shell.cmdDbDrop = function(options)
{
    var self = this;
    var opts = this.getOptions();
    var table = core.getArg("-table");
    db.drop(table, opts, function(err, data) {
        self.exit(err);
    });
}

// Send API request
shell.cmdSendRequest = function(options)
{
    var self = this;
    var query = this.getQuery();
    var url = core.getArg("-url");
    var id = core.getArg("-id");
    var login = core.getArg("-login");
    this.getUser({ id: id, login: login }, function(row) {
        core.sendRequest({ url: url, login: row.login, secret: row.secret, query: query }, function(err, params) {
            self.exit(err, params.obj);
        });
    });
}
