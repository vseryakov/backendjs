//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

var util = require('util');
var path = require('path');
var core = require(__dirname + '/../core');
var lib = require(__dirname + '/../lib');
var db = require(__dirname + '/../db');
var logger = require(__dirname + '/../logger');

const pool = {
    name: "sqlite",
    type: "sqlite",
    configOptions: {
        typesMap: { bool: "int" },
        noLengths: 1,
        noMultiSQL: 1,
        onConflictUpdate: 1,
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
    pool.sqlite = require("bkjs-sqlite");
    db.SqlPool.call(this, options, pool);
}
util.inherits(Pool, db.SqlPool);

Pool.prototype.open = function(callback)
{
    var copts = this.configOptions;
    var file = path.join(this.configOptions.path || core.path.spool, (this.url || core.name) + ".db");
    return new pool.sqlite.Database(file, copts.readonly ? pool.sqlite.OPEN_READONLY : 0, function(err) {
        if (err) {
            // Do not report errors about not existing databases
            if (err.code != "SQLITE_CANTOPEN" || !copts.silent) logger.error('open:', file, err);
            return callback(err);
        }
        var db = this;

        // Execute initial statements to setup the environment, like pragmas
        var sql = [];
        if (typeof copts.cache_size != "undefined") sql.push("PRAGMA cache_size=-" + copts.cache_size);
        if (typeof copts.temp_store != "undefined") sql.push("PRAGMA temp_store=" + copts.temp_store);
        if (typeof copts.journal_mode != "undefined") sql.push("PRAGMA journal_mode=" + copts.journal_mode);
        if (typeof copts.locking_mode != "undefined") sql.push("PRAGMA locking_mode=" + copts.locking_mode);
        if (typeof copts.synchronous != "undefined") sql.push("PRAGMA synchronous=" + copts.synchronous);
        if (typeof copts.read_uncommitted != "undefined") sql.push("PRAGMA read_uncommitted=" + copts.read_uncommitted);
        if (typeof copts.busy_timeout != "undefined") sql.push("SELECT busy_timeout(" + copts.busy_timeout + ")");
        lib.forEachSeries(sql, function(sql, next) {
            logger.debug('open:', file, sql);
            db.exec(sql, next);
        }, function(err) {
            if (err) logger.error('open:', file, err);
            callback(err, db);
        }, true);
    });
}

Pool.prototype.close = function(client, callback)
{
    logger.debug('close:', client.name);
    client.close(callback);
}

Pool.prototype.cacheColumns = function(options, callback)
{
    var schema = { dbcolumns: {}, dbkeys: {}, dbindexes: {} };

    this.acquire((err, client) => {
        if (err) return callback(err, []);

        client.query("SELECT name FROM sqlite_master WHERE type='table'", (err, tables) => {
            if (err) return callback(err);

            lib.forEachSeries(tables, (table, next) => {
                client.query("PRAGMA table_info(" + table.name + ")", (err, rows) => {
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
                    client.query("PRAGMA index_list(" + table.name + ")", (err4, indexes) => {
                        lib.forEachSeries(indexes, function(idx, next2) {
                            client.query("PRAGMA index_info(" + idx.name + ")", (err5, cols) => {
                                cols.forEach((x) => {
                                    if (!schema.dbcolumns[table.name]) schema.dbcolumns[table.name] = {};
                                    if (!schema.dbcolumns[table.name][x.name]) schema.dbcolumns[table.name][x.name] = {};
                                    var col = schema.dbcolumns[table.name][x.name];
                                    if (idx.unique) col.unique = 1;
                                    if (!schema.dbindexes[idx.name]) schema.dbindexes[idx.name] = [];
                                    schema.dbindexes[idx.name].push(x.name);
                                });
                                next2();
                            });
                        }, next, true);
                    });
                });
            }, (err) => {
                this.release(client);
                // Replace all at once
                for (const p in schema) this[p] = schema[p];
                callback(err);
            }, true);
        });
    });
}

