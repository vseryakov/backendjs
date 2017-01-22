//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var util = require('util');
var path = require('path');
var core = require(__dirname + '/core');
var lib = require(__dirname + '/lib');
var db = require(__dirname + '/db');
var logger = require(__dirname + '/logger');
var bksqlite = require("bkjs-sqlite");

var pool = {
    name: "sqlite",
    configOptions: {
        typesMap: { bool: "int", },
        noJson: 1,
        noObjects: 1,
        noLengths: 1,
        noMultiSQL: 1,
        noReturning: 1,
        temp_store: 0,
        busy_timeout: -1,
        read_uncommitted: true,
        createTables: 1,
    },
    createPool: function(options) { return new Pool(options); }
};
module.exports = pool;

db.modules.push(pool);

function Pool(options)
{
    options.type = pool.name;
    db.SqlPool.call(this, options);
    this.configOptions = lib.objMerge(pool.configOptions, this.configOptions);
}
util.inherits(Pool, db.SqlPool);

Pool.prototype.open = function(callback)
{
    var self = this;
    var file = path.join(this.configOptions.path || core.path.spool, (this.url || core.name)  + ".db");
    new bksqlite.Database(file, this.configOptions.readonly ? bksqlite.OPEN_READONLY : 0, function(err) {
        if (err) {
            // Do not report errors about not existing databases
            if (err.code != "SQLITE_CANTOPEN" || !self.configOptions.silent) logger.error('open:', file, err);
            return callback(err);
        }
        var db = this;

        // Execute initial statements to setup the environment, like pragmas
        var opts = [];
        if (typeof self.configOptions.cache_size != "undefined") opts.push("PRAGMA cache_size=-" + self.configOptions.cache_size);
        if (typeof self.configOptions.temp_store != "undefined") opts.push("PRAGMA temp_store=" + self.configOptions.temp_store);
        if (typeof self.configOptions.journal_mode != "undefined") opts.push("PRAGMA journal_mode=" + self.configOptions.journal_mode);
        if (typeof self.configOptions.locking_mode != "undefined") opts.push("PRAGMA locking_mode=" + self.configOptions.locking_mode);
        if (typeof self.configOptions.synchronous != "undefined") opts.push("PRAGMA synchronous=" + self.configOptions.synchronous);
        if (typeof self.configOptions.read_uncommitted != "undefined") opts.push("PRAGMA read_uncommitted=" + self.configOptions.read_uncommitted);
        if (typeof self.configOptions.busy_timeout != "undefined") opts.push("SELECT busy_timeout(" + self.configOptions.busy_timeout + ")");
        lib.forEachSeries(opts, function(sql, next) {
            logger.debug('open:', file, sql);
            db.exec(sql, next);
        }, function(err) {
            if (err) logger.error('open:', file, err);
            callback(err, db);
        });
    });
}

Pool.prototype.close = function(client, callback)
{
    logger.debug('close:', client.name);
    client.close(callback);
}

Pool.prototype.cacheColumns = function(options, callback)
{
    var self = this;
    var schema = { dbcolumns: {}, dbkeys: {}, dbindexes: {} };

    this.acquire(function(err, client) {
        if (err) return callback(err, []);

        client.query("SELECT name FROM sqlite_master WHERE type='table'", function(err, tables) {
            if (err) return callback(err);

            lib.forEachSeries(tables, function(table, next) {
                client.query("PRAGMA table_info(" + table.name + ")", function(err, rows) {
                    if (err) return next(err);
                    for (var i = 0; i < rows.length; i++) {
                        if (!schema.dbcolumns[table.name]) schema.dbcolumns[table.name] = {};
                        if (!schema.dbkeys[table.name]) schema.dbkeys[table.name] = [];
                        // Split type cast and ignore some functions in default value expressions
                        var dflt = rows[i].dflt_value;
                        if (dflt && dflt[0] == "'" && dflt[dflt.length-1] == "'") dflt = dflt.substr(1, dflt.length-2);
                        schema.dbcolumns[table.name][rows[i].name] = { id: rows[i].cid, name: rows[i].name, value: dflt, data_type: rows[i].type.toLowerCase(), isnull: !rows[i].notnull, primary: rows[i].pk };
                        if (rows[i].pk) schema.dbkeys[table.name].push(rows[i].name);
                    }
                    client.query("PRAGMA index_list(" + table.name + ")", function(err4, indexes) {
                        lib.forEachSeries(indexes, function(idx, next2) {
                            client.query("PRAGMA index_info(" + idx.name + ")", function(err5, cols) {
                                cols.forEach(function(x) {
                                    if (!schema.dbcolumns[table.name]) schema.dbcolumns[table.name] = {};
                                    if (!schema.dbcolumns[table.name][x.name]) schema.dbcolumns[table.name][x.name] = {};
                                    var col = schema.dbcolumns[table.name][x.name];
                                    if (idx.unique) col.unique = 1;
                                    if (!schema.dbindexes[idx.name]) schema.dbindexes[idx.name] = [];
                                    schema.dbindexes[idx.name].push(x.name);
                                });
                                next2();
                            });
                        }, next);
                    });
                });
            }, function(err) {
                self.release(client);
                // Replace all at once
                for (var p in schema) self[p] = schema[p];
                callback(err);
            });
        });
    });
}

