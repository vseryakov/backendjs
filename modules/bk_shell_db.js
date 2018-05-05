//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

var path = require('path');
var util = require('util');
var url = require('url');
var fs = require('fs');
var core = require(__dirname + '/../lib/core');
var lib = require(__dirname + '/../lib/lib');
var logger = require(__dirname + '/../lib/logger');
var db = require(__dirname + '/../lib/db');
var shell = require(__dirname + '/bk_shell');

shell.help.push("-db-get-config [-separator =] [-format text] [-run-mode MODE] [-app-name NAME] [name VALUE ...] - show all config parameters retrieved from the remote database bk_config table for the current environment, to simulate another environment pass the following arguments as name value pairs: role, network, region, zone, tag");
shell.help.push("-db-tables [-separator nl] - list all table names for the current db pool");
shell.help.push("-db-select -table TABLE [-separator !] [-format text] [name VALUE ...] - return all records from the table or only that match given column values, all supported by db.select options are supported by prefixing with underscore like _count 10, the format is the same as for API query parameters");
shell.help.push("-db-scan -table TABLE [name VALUE ...] - return all records from the table using scan operation, same arg as for db-select");
shell.help.push("-db-get -table TABLE [name VALUE ...] - return a record from the table for given primary key");
shell.help.push("-db-put -table TABLE name VALUE ... - add or replace a record in the config table, name value pairs are column name and value to be set for the record to be added");
shell.help.push("-db-del -table TABLE name VALUE ... - delete a record from the table, name value pairs must define a primary key for the table");
shell.help.push("-db-del-all -table TABLE name VALUE ... - delete all records from the table that match the search criteria, name value pairs must define a primary key for the table");
shell.help.push("-db-drop -table TABLE name [-nowait] - drop a table");
shell.help.push("-db-backup [-path PATH] [-tables LIST] [-skip LIST] - save tables into json files in the home or specified path");
shell.help.push("-db-restore [-path PATH] [-tables LIST] [-skip LIST] [-mapping ID1,ID2...] [-drop] [-continue] [-progress N] [-op add|update|put] [-noexit] [-exitdelay MS] - restore tables from json files located in the home or specified path");

// Show all config parameters
shell.cmdDbGetConfig = function(options)
{
    var opts = this.getQuery();
    var sep = this.getArg("-separator", options, "=");
    var fmt = this.getArg("-format", options);
    opts.unique = 1;
    db.getConfig(opts, function(err, data) {
        var argv = [], args = {};
        data = data.filter(function(x) {
            if (args[x.name]) return 0;
            return args[x.name] = 1;
        });
        if (fmt == "value") {
            console.log(data.length && data[0].value || "");
        } else
        if (fmt == "text") {
            for (var i = 0; i < data.length; i++) console.log(data[i].name + (sep) + (data[i].value || "").replace(/[\r\n]/g, ""));
        } else {
            console.log(JSON.stringify(data));
        }
        shell.exit(err);
    });
}

// Show all tables
shell.cmdDbTables = function(options)
{
    var sep = this.getArg("-separator", options, "\n");
    var tables = db.getPoolTables(db.pool, { names: 1 });
    console.log(tables.join(sep));
    this.exit();
}

// Show record that match the search criteria, return up to `-count N` records
shell.cmdDbSelect = function(options)
{
    var query = this.getQuery();
    var opts = this.getArgs();
    var table = this.getArg("-table", options);
    var sep = this.getArg("-separator", options, "!");
    var fmt = this.getArg("-format", options);
    var cols = Object.keys(db.getColumns(table))
    db.select(table, query, opts, function(err, data) {
        if (data && data.length) {
            if (fmt == "text") {
                data.forEach(function(x) { console.log((cols || Object.keys(x)).map(function(y) { return x[y] }).join(sep)) });
            } else {
                data.forEach(function(x) { console.log(JSON.stringify(x)) });
            }
        }
        shell.exit(err);
    });
}

// Show all records that match search criteria
shell.cmdDbScan = function(options)
{
    var query = this.getQuery();
    var opts = this.getArgs();
    var table = this.getArg("-table", options);
    var sep = this.getArg("-separator", options, "!");
    var fmt = this.getArg("-format", options);
    var cols = Object.keys(db.getColumns(table));
    db.scan(table, query, opts, function(row, next) {
        if (fmt == "text") {
            console.log((cols || Object.keys(row)).map(function(y) { return row[y] }).join(sep));
        } else {
            console.log(JSON.stringify(row));
        }
        next();
    }, function(err) {
        shell.exit(err);
    });
}

// Save all tables to the specified directory or the server home
shell.cmdDbBackup = function(options)
{
    var opts = this.getArgs();
    var query = this.getQuery();
    var root = this.getArg("-path", options);
    var filter = this.getArg("-filter", options);
    var tables = lib.strSplit(this.getArg("-tables", options));
    var skip = lib.strSplit(this.getArg("-skip", options));
    var incremental = this.getArgInt("-incremental", options);
    var progress = this.getArgInt("-progress", options);
    opts.fullscan = this.getArgInt("-fullscan", options, 1);
    opts.scanRetry = this.getArgInt("-scanRetry", options, 1);
    if (!opts.useCapacity) opts.useCapacity = "read";
    if (!opts.factorCapacity) opts.factorCapacity = 0.25;
    if (!tables.length) tables = db.getPoolTables(db.pool, { names: 1 });
    lib.forEachSeries(tables, function(table, next) {
        if (skip.indexOf(table) > -1) return next();
        var file = path.join(root, table +  ".json");
        if (incremental > 0) {
            var lines = lib.readFileSync(file, { offset: -incremental, list: "\n" });
            for (var i = lines.length - 1; i >= 0; i--) {
                var line = lib.jsonParse(lines[i]);
                if (line) opts.start = db.getSearchQuery(table, line);
                if (opts.start && Object.keys(opts.start).length) break;
                delete opts.start;
            }
        } else {
            delete opts.start;
            fs.writeFileSync(file, "");
        }
        db.scan(table, query, opts, function(row, next2) {
            if (filter && app[filter]) app[filter](table, row);
            fs.appendFileSync(file, JSON.stringify(row) + "\n");
            if (progress && opts.nrows % progress == 0) logger.info("cmdDbBackup:", table, opts.nrows, "records");
            next2();
        }, function(err) {
            if (err) logger.error("cmdDbBackup:", table, err);
            next();
        });
    }, function(err) {
        logger.info("cmdDbBackup:", root, tables, opts);
        shell.exit(err);
    });
}

// Restore tables
shell.cmdDbRestore = function(options)
{
    var opts = this.getArgs();
    var root = this.getArg("-path", options);
    var filter = this.getArg("-filter", options);
    var mapping = lib.strSplit(this.getArg("-mapping", options));
    var tables = lib.strSplit(this.getArg("-tables", options));
    var skip = lib.strSplit(this.getArg("-skip", options));
    var files = lib.findFileSync(root || core.home, { depth: 1, types: "f", include: /\.json$/ });
    var progress = this.getArgInt("-progress", options);
    var op = this.getArg("-op", options, "update");
    if (this.isArg("-drop", options)) opts.drop = 1;
    if (this.isArg("-continue", options)) opts.continue = 1;
    opts.errors = 0;
    lib.forEachSeries(files, function(file, next3) {
        var table = path.basename(file, ".json");
        if (tables.length && tables.indexOf(table) == -1) return next3();
        if (skip.indexOf(table) > -1) return next3();
        var cap = db.getCapacity(table);
        opts.readCapacity = cap.readCapacity;
        opts.writeCapacity = cap.writeCapacity;
        opts.upsert = true;
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
                db.create(table, db.tables[table], opts, next);
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
                    if (!line) return next2();
                    var row = lib.jsonParse(line, { logger: "error" });
                    if (!row) return next2(opts.continue ? null : "ERROR: parse error, line: " + opts.nlines);
                    if (filter && app[filter]) app[filter](table, row);
                    for (var i = 0; i < mapping.length-1; i+= 2) {
                        row[mapping[i+1]] = row[mapping[i]];
                        delete row[mapping[i]];
                    }
                    if (progress && opts.nlines % progress == 0) logger.info("cmdDbRestore:", table, opts.nlines, "records");
                    db[op](table, row, opts, function(err) {
                        if (err && !opts.continue) return next2(err);
                        if (err) opts.errors++;
                        db.checkCapacity(cap, next2);
                    });
                }, next);
            }
        ], next3);
    }, function(err) {
        logger.info("cmdDbRestore:", root, tables || files, opts);
        if (opts.exitdelay) return setTimeout(shell.exit.bind(shell, err), opts.exitdelay);
        if (!opts.noexit) shell.exit(err);
    });
}

// Put config entry
shell.cmdDbGet = function(options)
{
    var query = this.getQuery();
    var opts = this.getArgs();
    var table = this.getArg("-table", options);
    var sep = this.getArg("-separator", options, "!");
    var fmt = this.getArg("-format", options);
    var cols = Object.keys(db.getColumns(table))
    db.get(table, query, opts, function(err, data) {
        if (data) {
            if (fmt == "text") {
                console.log((cols || Object.keys(data)).map(function(y) { return data[y] }).join(sep))
            } else {
                console.log(JSON.stringify(data));
            }
        }
        shell.exit(err);
    });
}

// Put a record
shell.cmdDbPut = function(options)
{
    var query = this.getQuery();
    var opts = this.getArgs();
    var table = this.getArg("-table", options);
    db.put(table, query, opts, function(err, data) {
        shell.exit(err);
    });
}

// Delete a record
shell.cmdDbDel = function(options)
{
    var query = this.getQuery();
    var opts = this.getArgs();
    var table = this.getArg("-table", options);
    db.del(table, query, opts, function(err, data) {
        shell.exit(err);
    });
}

// Delete all records
shell.cmdDbDelAll = function(options)
{
    var query = this.getQuery();
    var opts = this.getArgs();
    var table = this.getArg("-table", options);
    db.delAll(table, query, opts, function(err, data) {
        shell.exit(err);
    });
}

// Drop a table
shell.cmdDbDrop = function(options)
{
    var opts = this.getArgs();
    var table = this.getArg("-table", options);
    db.drop(table, opts, function(err, data) {
        shell.exit(err);
    });
}

