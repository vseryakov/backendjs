//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var util = require('util');
var url = require('url');
var net = require('net');
var fs = require('fs');
var path = require('path');
var domain = require('domain');
var cluster = require('cluster');
var os = require('os');
var core = require(__dirname + '/../core');
var lib = require(__dirname + '/../lib');
var db = require(__dirname + '/../db');
var logger = require(__dirname + '/../logger');
var bksqlite = require("bkjs-sqlite");

// Initialize local SQLite cache database by name or full path
db.sqliteInitPool = function(options)
{
    var self = this;
    if (!options) options = {};

    if (!options.pool) options.pool = "sqlite";
    options.type = "sqlite";
    options.settings = { typesMap: { bool: "int", }, noLengths: 1, noMultiSQL: 1 };
    options.settings.file = path.join(options.path || core.path.spool, (options.url || core.name)  + ".db");
    options.settings.temp_store = options.temp_store || 0;
    options.settings.busy_timeout = options.busy_timeout || -1;
    options.settings.read_uncommitted = options.read_uncommitted || true;
    options.validate = function(client) { return this.serialNum == client.poolSerialNum; }

    var pool = this.sqlInitPool(options);
    pool.serialNum = 0;
    pool.open = self.sqliteConnect;
    pool.cacheColumns = self.sqliteCacheColumns;
    pool.setup = self.sqliteSetup;
    pool.close = function(client, callback) {
        client.close(callback);
    }
    // Release or destroy a client depending on the database watch counter
    pool._release = pool.release;
    pool.release = function(client) {
        if (this.serialNum != client.poolSerialNum) {
            this.destroy(client);
        } else {
            this._release(client);
        }
    }
    return pool;
}

// Common code to open or create local SQLite databases, execute all required initialization statements, calls callback
// with error as first argument and database object as second
db.sqliteConnect = function(callback)
{
    var self = this;
    new bksqlite.Database(this.settings.file, this.settings.readonly ? bksqlite.OPEN_READONLY : 0, function(err) {
        if (err) {
            // Do not report errors about not existing databases
            if (err.code != "SQLITE_CANTOPEN" || !self.settings.silent) logger.error('sqliteOpen:', self.settings.file, err);
            return callback(err);
        }
        var db = this;

        // Execute initial statements to setup the environment, like pragmas
        var opts = [];
        if (typeof self.settings.cache_size != "undefined") opts.push("PRAGMA cache_size=-" + self.settings.cache_size);
        if (typeof self.settings.temp_store != "undefined") opts.push("PRAGMA temp_store=" + self.settings.temp_store);
        if (typeof self.settings.journal_mode != "undefined") opts.push("PRAGMA journal_mode=" + self.settings.journal_mode);
        if (typeof self.settings.locking_mode != "undefined") opts.push("PRAGMA locking_mode=" + self.settings.locking_mode);
        if (typeof self.settings.synchronous != "undefined") opts.push("PRAGMA synchronous=" + self.settings.synchronous);
        if (typeof self.settings.read_uncommitted != "undefined") opts.push("PRAGMA read_uncommitted=" + self.settings.read_uncommitted);
        if (typeof self.settings.busy_timeout != "undefined") opts.push("SELECT busy_timeout(" + self.settings.busy_timeout + ")");
        lib.forEachSeries(opts, function(sql, next) {
            logger.debug('sqliteOpen:', self.settings.file, sql);
            db.exec(sql, next);
        }, function(err) {
            if (err) logger.error('sqliteOpen:', 'init', self.settings.file, err);
            callback(err, db);
        });
    });
}

db.sqliteCacheColumns = function(options, callback)
{
    var self = this;

    self.acquire(function(err, client) {
        if (err) return callback(err, []);

        client.query("SELECT name FROM sqlite_master WHERE type='table'", function(err, tables) {
            if (err) return callback(err);
            self.dbcolumns = {};
            self.dbkeys = {};
            self.dbindexes = {};
            lib.forEachSeries(tables, function(table, next) {

                client.query("PRAGMA table_info(" + table.name + ")", function(err, rows) {
                    if (err) return next(err);
                    for (var i = 0; i < rows.length; i++) {
                        if (!self.dbcolumns[table.name]) self.dbcolumns[table.name] = {};
                        if (!self.dbkeys[table.name]) self.dbkeys[table.name] = [];
                        // Split type cast and ignore some functions in default value expressions
                        var dflt = rows[i].dflt_value;
                        if (dflt && dflt[0] == "'" && dflt[dflt.length-1] == "'") dflt = dflt.substr(1, dflt.length-2);
                        self.dbcolumns[table.name][rows[i].name] = { id: rows[i].cid, name: rows[i].name, value: dflt, db_type: rows[i].type.toLowerCase(), data_type: rows[i].type, isnull: !rows[i].notnull, primary: rows[i].pk };
                        if (rows[i].pk) self.dbkeys[table.name].push(rows[i].name);
                    }
                    client.query("PRAGMA index_list(" + table.name + ")", function(err4, indexes) {
                        lib.forEachSeries(indexes, function(idx, next2) {
                            client.query("PRAGMA index_info(" + idx.name + ")", function(err5, cols) {
                                cols.forEach(function(x) {
                                    if (!self.dbcolumns[table.name]) self.dbcolumns[table.name] = {};
                                    if (!self.dbcolumns[table.name][x.name]) self.dbcolumns[table.name][x.name] = {};
                                    var col = self.dbcolumns[table.name][x.name];
                                    if (idx.unique) col.unique = 1;
                                    if (!self.dbindexes[idx.name]) self.dbindexes[idx.name] = [];
                                    self.dbindexes[idx.name].push(x.name);
                                });
                                next2();
                            });
                    }, function() {
                            next();
                        });
                    });
                });
            }, function(err) {
                self.release(client);
                callback(err);
            });
        });
    });
}

// Watch for changes or syncs and reopen the database file
db.sqliteSetup = function(client, callback)
{
    var self = this;
    if (this.settings.watch && !this.serialNum) {
        this.serialNum = 1;
        fs.watch(this.file, function(event, filename) {
            logger.info('db.watch:', self.name, event, filename, self.file, "#", self.serialNum);
            self.serialNum++;
            self.destroyAll();
        });
    }
    // Mark the client with the current db pool serial number, if on release this number differs we
    // need to destroy the client, not return to the pool
    client.poolSerialNum = this.serialNum;
    logger.debug('pool:', 'setup', this.name, "#", this.serialNum);
    callback(null, client)
}
