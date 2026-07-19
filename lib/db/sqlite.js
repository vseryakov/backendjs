/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
'use strict';

const path = require('node:path');
const app = require(__dirname + '/../app');
const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');
const sqlPool = require(__dirname + '/sqlpool');

exports.defaults = {
    type: "sqlite",
    config: {
        typesMap: { bool: "int" },
        features: {
            upsert: 1,
        },
        temp_store: 0,
        read_uncommitted: true,
        timeout: 50,
    },
};

class SqliteClient {
    constructor(db) {
        this.db = db;
    }

    query(req, callback) {
        if (typeof req === "string") req = { text: req };
        var params = {}, placeholder = req.config?.placeholder || "$";

        for (let i = 1; i <= req.values?.length; i++) {
            params[placeholder + i] = req.values[i - 1];
        }

        logger.dev("sqliteClient:", req.text, params);

        if (/^ *(INSERT|REPLACE|UPDATE|DELETE|CREATE)/i.test(req.text) && !req.options?.returning) {
            const rc = this.db.prepare(req.text).run(params);
            callback(null, [], { affected_rows: rc.changes, last_rowid: rc.lastInsertRowid });
        } else {
            const rows = this.db.prepare(req.text).all(params);
            callback(null, rows);
        }
    }
}

var _sqlite;

/**
 * SQLite database pool
 */

class SqlitePool extends sqlPool.Pool {

    constructor(options)
    {
        _sqlite = require("node:sqlite");
        super(options, exports.defaults);
    }

    openDb(callback)
    {
        var config = this.config;
        var file = path.join(config.path || "", (this.url || app.id) + ".db");
        lib.makePathSync(path.dirname(file));

        const db = new _sqlite.DatabaseSync(file, {
            readOnly: !!config.readOnly,
            timeout: config.timeout,
            allowExtension: !!config.allowExtentions
        });

        logger.dev('openDb:', this.name);

        // Execute initial statements to setup the environment, like pragmas
        const sql = [];
        if (typeof config.cache_size !== "undefined") sql.push("PRAGMA cache_size=-" + config.cache_size);
        if (typeof config.temp_store !== "undefined") sql.push("PRAGMA temp_store=" + config.temp_store);
        if (typeof config.journal_mode !== "undefined") sql.push("PRAGMA journal_mode=" + config.journal_mode);
        if (typeof config.locking_mode !== "undefined") sql.push("PRAGMA locking_mode=" + config.locking_mode);
        if (typeof config.synchronous !== "undefined") sql.push("PRAGMA synchronous=" + config.synchronous);
        if (typeof config.read_uncommitted !== "undefined") sql.push("PRAGMA read_uncommitted=" + config.read_uncommitted);
        for (const stmt of sql) {
            try {
                db.exec(stmt);
            } catch (err) {
                logger.error('openDb:', this.name, file, err);
            }
        }
        callback(null, new SqliteClient(db));
    }

    closeDb(client, callback)
    {
        logger.debug('closeDb:', this.name);
        try {
            client.db.close();
        } catch (err) {
            logger.error('closeDb:', this.name, err);
        }
        lib.tryCall(callback);
    }

    cacheColumns(client, options, callback)
    {
        SqlitePool.sqliteCacheColumns.call(this, client, options, callback);
    }

    static sqliteCacheColumns(client, _options, callback)
    {
        var schema = { dbcolumns: {}, dbkeys: {}, dbindexes: {} };

        client.query("SELECT name FROM sqlite_master WHERE type='table'", (err, tables) => {
            if (err) return lib.tryCall(callback, err);

            lib.forEachSeries(tables, (table, next) => {
                client.query("PRAGMA table_info(" + table.name + ")", (err, rows) => {
                    if (err) return next(err);
                    for (let i = 0; i < rows.length; i++) {
                        if (!schema.dbcolumns[table.name]) schema.dbcolumns[table.name] = {};
                        if (!schema.dbkeys[table.name]) schema.dbkeys[table.name] = [];
                        // Split type cast and ignore some functions in default value expressions
                        let dflt = rows[i].dflt_value;
                        if (dflt && dflt[0] === "'" && dflt[dflt.length-1] === "'") dflt = dflt.substr(1, dflt.length-2);
                        schema.dbcolumns[table.name][rows[i].name] = { id: rows[i].cid, name: rows[i].name, value: dflt, data_type: rows[i].type.toLowerCase(), isnull: !rows[i].notnull, primary: rows[i].pk };
                        if (rows[i].pk) schema.dbkeys[table.name].push(rows[i].name);
                    }
                    client.query("PRAGMA index_list(" + table.name + ")", (_err4, indexes) => {
                        lib.forEachSeries(indexes, function(idx, next2) {
                            client.query("PRAGMA index_info(" + idx.name + ")", (_err5, cols) => {
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
                // Replace all at once, it is run inside a pool
                for (const p in schema) this[p] = schema[p];
                lib.tryCall(callback, err);
            }, true);
        });
    }

}

exports.Pool = SqlitePool;

