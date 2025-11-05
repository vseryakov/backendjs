/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const util = require('util');
const path = require('path');
const app = require(__dirname + '/../app');
const lib = require(__dirname + '/../lib');
const db = require(__dirname + '/../db');
const logger = require(__dirname + '/../logger');

const pool = {
    name: "sqlite",
    type: "sqlite",
    configOptions: {
        typesMap: { bool: "int" },
        noLengths: 1,
        noMultiSQL: 1,
        onConflictUpdate: 1,
        temp_store: 0,
        read_uncommitted: true,
    },
    createPool: function(options) {
        return new SqlitePool(options);
    }
};
module.exports = pool;

db.modules.push(pool);

class SqliteClient {
    constructor(db) {
        this.db = db;
    }

    query(text, values, options, callback) {
        if (typeof options == "function") callback = options, options = null;
        if (typeof values == "function") callback = values, values = null, options = null;

        var params = {};
        for (let i = 1; i <= values?.length; i++) {
            params["$" + i] = values[i - 1];
        }

        if (/^ *(INSERT|UPDATE|DELETE|CREATE)/i.test(text) && !options?.returning) {
            var rc = this.db.prepare(text).run(params);
            callback(null, rows, { affected_rows: rc.changes, last_rowid: rc.lastInsertRowid });
        } else {
            var rows = this.db.prepare(text).all(params);
            callback(null, rows);
        }
    }
}

function SqlitePool(options)
{
    pool.sqlite = require("node:sqlite");
    db.SqlPool.call(this, options, pool);
}
util.inherits(SqlitePool, db.SqlPool);

SqlitePool.prototype.open = function(callback)
{
    var copts = this.configOptions;
    var file = path.join(this.configOptions.path || "", (this.url || app.id) + ".db");
    var db = new pool.sqlite.DatabaseSync(file, { readOnly: !!copts.readonly, allowExtension: !!copts.extentions });

    // Execute initial statements to setup the environment, like pragmas
    var sql = [];
    if (typeof copts.cache_size != "undefined") sql.push("PRAGMA cache_size=-" + copts.cache_size);
    if (typeof copts.temp_store != "undefined") sql.push("PRAGMA temp_store=" + copts.temp_store);
    if (typeof copts.journal_mode != "undefined") sql.push("PRAGMA journal_mode=" + copts.journal_mode);
    if (typeof copts.locking_mode != "undefined") sql.push("PRAGMA locking_mode=" + copts.locking_mode);
    if (typeof copts.synchronous != "undefined") sql.push("PRAGMA synchronous=" + copts.synchronous);
    if (typeof copts.read_uncommitted != "undefined") sql.push("PRAGMA read_uncommitted=" + copts.read_uncommitted);
    for (const s of sql) {
        try {
            db.exec(s);
        } catch (err) {
            logger.error('open:', file, err);
        }
    }
    callback(null, new SqliteClient(db));
}

SqlitePool.prototype.close = function(client, callback)
{
    logger.debug('close:', this.name);
    try {
        client.db.close();
    } catch (err) {
        logger.error('close:', this.name, err);
    }
    lib.tryCall(callback);
}

SqlitePool.prototype.cacheColumns = function(options, callback)
{
    var schema = { dbcolumns: {}, dbkeys: {}, dbindexes: {} };

    this.acquire((err, client) => {
        if (err) return lib.tryCall(callback, err, []);

        client.query("SELECT name FROM sqlite_master WHERE type='table'", (err, tables) => {
            if (err) return lib.tryCall(callback, err);

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
                lib.tryCall(callback, err);
            }, true);
        });
    });
}

