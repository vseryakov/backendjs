/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const fs = require('fs');
const path = require('path');
const { app, db, lib, aws, logger, shell } = require('../modules');

shell.help.push("-db-get-config [-separator =] [-format text] [-run-mode MODE] [-app-name NAME] [name VALUE ...] - show all config parameters retrieved from the remote database bk_config table for the current environment, to simulate another environment pass the following arguments as name value pairs: role, network, region, zone, tag");
shell.help.push("-db-tables [-separator nl] - list all table names for the current db pool");
shell.help.push("-db-select -table TABLE [-separator !] [-format text] [name VALUE ...] - return all records from the table or only that match given column values, all supported by db.select options are supported by prefixing with underscore like _count 10, the format is the same as for API query parameters");
shell.help.push("-db-scan -table TABLE [name VALUE ...] - return all records from the table using scan operation, same arg as for db-select");
shell.help.push("-db-get -table TABLE [name VALUE ...] - return a record from the table for given primary key");
shell.help.push("-db-put -table TABLE name VALUE ... - add or replace a record in the config table, name value pairs are column name and value to be set for the record to be added");
shell.help.push("-db-update -table TABLE name VALUE ... - update a record in the config table, name value pairs are column name and value to be set for the record to be added");
shell.help.push("-db-del -table TABLE name VALUE ... - delete a record from the table, name value pairs must define a primary key for the table");
shell.help.push("-db-del-all -table TABLE name VALUE ... - delete all records from the table that match the search criteria, name value pairs must define a primary key for the table");
shell.help.push("-db-drop -table TABLE name [-nowait] - drop a table");
shell.help.push("-db-backup [-path PATH] [-tables LIST] [-skip LIST] [-parallel-tables LIST] [-parallel-jobs N] [-progress N] [-concurrency N] [-file-suffix TEXT] - save tables into json files in the home or specified path");
shell.help.push("-db-restore [-path PATH] [-tables LIST] [-skip LIST] [-mapping ID1,ID2...] [-bulk N] [-drop] [-ddbjson] [-continue] [-progress N] [-op add|update|put] [-noexit] [-exitdelay MS] - restore tables from json files located in the home or specified path");
shell.help.push("-db-sync -tables LIST -pool POOL -sourcePool POOL  - sync tables from the sourcePool to the destication pool");

// Show all config parameters
shell.commands.dbGetConfig = function(options)
{
    var opts = shell.getQuery();
    var sep = shell.getArg("-separator", options, "=");
    var fmt = shell.getArg("-format", options);
    opts.unique = 1;
    db.getConfig(opts, (err, data) => {
        if (fmt == "text") {
            for (var i = 0; i < data.length; i++) console.log(data[i].name + (sep) + (data[i].value || "").replace(/[\r\n]/g, ""));
        } else {
            console.log(JSON.stringify(data));
        }
        shell.exit(err);
    });
}

// Show all tables
shell.commands.dbTables = function(options)
{
    var sep = shell.getArg("-separator", options, "\n");
    var tables = db.getPoolTables(db.pool, { names: 1 });
    console.log(tables.join(sep));
    shell.exit();
}

shell.commands.dbGet = function(options)
{
    var query = shell.getQuery();
    var opts = shell.getArgs();
    var table = shell.getArg("-table", options);
    var sep = shell.getArg("-separator", options, "!");
    var fmt = shell.getArg("-format", options);
    var cols = lib.strSplit(shell.getArg("-cols", options));
    if (!cols.length) cols = Object.keys(db.getColumns(table));
    var spacing = shell.getArgInt("-spacing")
    db.get(table, query, opts, (err, data) => {
        if (data) {
            if (fmt == "text") {
                console.log((cols || Object.keys(data)).map((y) => (data[y])).join(sep))
            } else {
                console.log(JSON.stringify(data, null, spacing));
            }
        }
        shell.exit(err);
    });
}

// Show record that match the search criteria, return up to `-count N` records
shell.commands.dbSelect = function(options)
{
    var query = shell.getQuery();
    var opts = shell.getArgs();
    var table = shell.getArg("-table", options);
    var sep = shell.getArg("-separator", options, "!");
    var fmt = shell.getArg("-format", options);
    var cols = Object.keys(db.getColumns(table))
    var spacing = shell.getArgInt("-spacing");
    db.select(table, query, opts, (err, data) => {
        if (data?.length) {
            if (fmt == "text") {
                data.forEach((x) => { console.log((cols || Object.keys(x)).map((y) => (x[y])).join(sep)) });
            } else {
                data.forEach((x) => { console.log(JSON.stringify(x, null, spacing)) });
            }
        }
        shell.exit(err);
    });
}

// Show all records that match search criteria
shell.commands.dbScan = function(options)
{
    var query = shell.getQuery();
    var opts = shell.getArgs();
    var table = shell.getArg("-table", options);
    var sep = shell.getArg("-separator", options, "!");
    var fmt = shell.getArg("-format", options);
    var cols = Object.keys(db.getColumns(table));
    var spacing = shell.getArgInt("-spacing");
    db.scan(table, query, opts, (row, next) => {
        if (fmt == "text") {
            console.log((cols || Object.keys(row)).map((y) => (row[y])).join(sep));
        } else {
            console.log(JSON.stringify(row, null, spacing));
        }
        next();
    }, function(err) {
        shell.exit(err);
    });
}

// Save all tables to the specified directory or the server home
shell.commands.dbBackup = function(options)
{
    var opts = shell.getArgs();
    var query = shell.getQuery();
    var root = shell.getArg("-path", options);
    var filter = shell.getArg("-filter", options);
    var table = shell.getArg("-table", options);
    var suffix = shell.getArg("-file-suffix", options);
    var tables = lib.strSplit(shell.getArg("-tables", options));
    var skip = lib.strSplit(shell.getArg("-skip", options));
    var concurrency = shell.getArgInt("-concurrency", options, 2);
    var incremental = shell.getArgInt("-incremental", options);
    var progress = shell.getArgInt("-progress", options);
    var jobs = shell.getArgInt("-parallel-jobs", options);
    var parallel = lib.strSplit(shell.getArg("-parallel-tables", options));
    opts.fullscan = shell.getArgInt("-fullscan", options, 1);
    opts.scanRetry = shell.getArgInt("-scanRetry", options, 1);
    opts.batch = opts.noprocessrows = opts.noconvertrows = 1;
    if (!opts.useCapacity) opts.useCapacity = "read";
    if (!opts.factorCapacity) opts.factorCapacity = 0.5;
    if (table) tables.push(table);
    if (!tables.length) tables = db.getPoolTables(db.pool, { names: 1 });
    lib.forEachLimit(tables, concurrency, (table, next) => {
        if (skip.indexOf(table) > -1) return next();
        var opts2 = lib.objClone(opts, { nrows: 0, parts: [""] });
        var file = path.join(root, `${table}${suffix}.json`);
        if (incremental > 0) {
            var lines = lib.readFileSync(file, { offset: -incremental, list: "\n" });
            for (var i = lines.length - 1; i >= 0; i--) {
                var line = lib.jsonParse(lines[i]);
                if (line) opts2.start = db.getQueryForKeys(db.getKeys(table), line);
                if (opts2.start && Object.keys(opts.start).length) break;
                delete opts2.start;
            }
        } else {
            delete opts2.start;
            fs.writeFileSync(file, "");
        }
        if (jobs > 1 && parallel.indexOf(table) > -1) {
            opts2.parts = [];
            for (let i = 0; i < jobs; i++) opts2.parts.push(i);
        }
        lib.forEach(opts2.parts, (n, next2) => {
            var opts3 = typeof n == "number" ? lib.objClone(opts2, { Segment: n, TotalSegments: jobs }) : opts2;
            db.scan(table, query, opts3, function(rows, next3) {
                opts3.nrows += rows.length;
                if (progress && opts3.nrows % progress == 0) logger.info("cmdDbBackup:", table, n ? "job" + n : "", opts3.nrows, "records");
                if (filter && app[filter]) app[filter](table, rows, opts3);
                fs.appendFile(file, rows.map((x) => (JSON.stringify(x))).join("\n") + "\n", next3);
            }, function(err) {
                logger.logger(err ? "error" : "info", "cmdDbBackup:", table, err, opts3);
                next2();
            });
        }, next);
    }, function(err) {
        shell.exit(err);
    });
}

// Restore tables
shell.commands.dbRestore = function(options)
{
    var opts = shell.getArgs();
    var root = shell.getArg("-path", options);
    var filter = shell.getArg("-filter", options);
    var mapping = lib.strSplit(shell.getArg("-mapping", options));
    var table = shell.getArg("-table", options);
    var tables = lib.strSplit(shell.getArg("-tables", options));
    var suffix = shell.getArg("-suffix", options);
    var skip = lib.strSplit(shell.getArg("-skip", options));
    var files = lib.findFileSync(root || app.home, { depth: 1, types: "f", include: /\.json$/ });
    var progress = shell.getArgInt("-progress", options);
    var concurrency = lib.strSplit(shell.getArg("-concurrency", options, 1));
    var op = shell.getArg("-op", options, "update");
    if (shell.isArg("-drop", options)) opts.drop = 1;
    if (shell.isArg("-continue", options)) opts.continue = 1;
    if (shell.isArg("-ddbjson", options)) opts.ddbjson = 1;
    if (table) tables.push(table);
    opts.errors = 0;
    opts.count = shell.getArgInt("-bulk", options);
    lib.forEachLimit(files, concurrency, (file, next3) => {
        var table = path.basename(file, ".json");
        if (suffix) table = table.replace(suffix, "");
        if (tables.length && tables.indexOf(table) == -1) return next3();
        if (skip.indexOf(table) > -1) return next3();
        var cap = db.getCapacity(table);
        opts.readCapacity = cap.readCapacity;
        opts.writeCapacity = cap.writeCapacity;
        opts.upsert = opts.syncMode = true;
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
                if (opts.count) return next();
                lib.forEachLine(file, opts, function(line, next2) {
                    if (!line) return next2();
                    var row = lib.jsonParse(line, { logger: "error" });
                    if (!row) return next2(opts.continue ? null : "ERROR: parse error, line: " + opts.nlines);
                    if (opts.ddbjson && row.Item) row = aws.fromDynamoDB(row.Item);
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
            },
            function(next) {
                if (!opts.count) return next();
                lib.forEachLine(file, opts, function(lines, next2) {
                    lines = lines.map((l) => {
                        var row = lib.jsonParse(l, { logger: "error" });
                        if (!row) return null;
                        if (filter && app[filter]) app[filter](table, row);
                        for (var i = 0; i < mapping.length-1; i+= 2) {
                            row[mapping[i+1]] = row[mapping[i]];
                            delete row[mapping[i]];
                        }
                        return { op: "put", table: table, obj: row, options: opts };
                    }).filter((x) => (x));
                    if (progress && opts.nlines % progress == 0) logger.info("cmdDbRestore:", table, opts.nlines, "records");
                    db.bulk(lines, opts, function(err, rc) {
                        if (err && !opts.continue) return next2(err);
                        opts.errors += rc.length;
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

// Put a record
shell.commands.dbPut = function(options)
{
    var query = shell.getQuery();
    var opts = shell.getArgs();
    var table = shell.getArg("-table", options);
    db.put(table, query, opts, (err, data) => {
        shell.exit(err, data);
    });
}

// Update a record
shell.commands.dbUpdate = function(options)
{
    var query = shell.getQuery();
    var opts = shell.getArgs();
    var table = shell.getArg("-table", options);
    db.update(table, query, opts, (err, data) => {
        shell.exit(err, data);
    });
}

// Delete a record
shell.commands.dbDel = function(options)
{
    var query = shell.getQuery();
    var opts = shell.getArgs();
    var table = shell.getArg("-table", options);
    db.del(table, query, opts, (err, data) => {
        shell.exit(err, data);
    });
}

// Delete all records
shell.commands.dbDelAll = function(options)
{
    var query = shell.getQuery();
    var opts = shell.getArgs();
    var table = shell.getArg("-table", options);
    db.delAll(table, query, opts, (err, data) => {
        shell.exit(err, data);
    });
}

// Drop a table
shell.commands.dbDrop = function(options)
{
    var opts = shell.getArgs();
    var table = shell.getArg("-table", options);
    db.drop(table, opts, (err, data) => {
        shell.exit(err);
    });
}

// Show all config parameters
shell.commands.dbSync = function(options)
{
    var opts = shell.getArgs(options);

    opts.logger = opts.logger || "info";
    opts.upsert = opts.syncMode = true;
    opts.progress = opts.progress || 90000;
    opts.pool = opts.pool || "elasticsearch";
    opts.batch = lib.toNumber(opts.batch, { dflt: 300, min: 0 });

    lib.forEachLimit(lib.strSplit(opts.tables), opts.concurrency || 1, (table, next) => {
        db.copy(table, {}, opts, (err, rc) => {
            next(err);
        });
    }, shell.exit);
}

