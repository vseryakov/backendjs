/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const util = require('util');
const lib = require(__dirname + '/../lib');
const db = require(__dirname + '/../db');
const logger = require(__dirname + '/../logger');

const pool = {
    name: "pg",
    type: "pg",
    configOptions: {
        typesMap: { list: "text[]" },
        noReplace: 1,
        noListOps: 0,
        noListTypes: 0,
        onConflictUpdate: 1,
        schema: ['public'],
    },
    createPool: function(options) {
        return new Pool(options);
    }
};
module.exports = pool;

db.modules.push(pool);

class PgClient {
    constructor(client) {
        this.pg = client;
    }

    query(text, values, options, callback) {
        if (typeof options == "function") callback = options, options = null;
        if (typeof values == "function") callback = values, values = null, options = null;
        this.pg.query(text, values, (err, result) => {
            callback(err, result?.rows || [], { affected_rows: result?.rowCount });
        });
    }
}

function Pool(options)
{
    pool.pg = require("pg");
    db.SqlPool.call(this, options, pool);
}
util.inherits(Pool, db.SqlPool)

Pool.prototype.open = function(callback)
{
    if (this.url == "default") this.url = "postgresql://postgres@127.0.0.1/" + db.dbName;
    const client = new pool.pg.Client(/:\/\//.test(this.url) ? { connectionString: this.url } : this.configOptions);
    client.connect((err) => {
        if (err) {
            logger.error('connect:', this.name, err);
            callback(err);
        } else {
            client.on('error', logger.error.bind(logger, this.name));
            client.on('notice', logger.log.bind(logger, this.name));
            client.on('notification', logger.info.bind(logger, this.name));
            callback(err, new PgClient(client));
        }
    });
}

Pool.prototype.close = function(client, callback)
{
    client.pg.end(callback);
}

// Cache indexes using the information_schema
Pool.prototype.cacheIndexes = function(options, callback)
{
    this.acquire((err, client) => {
        if (err) return lib.tryCall(callback, err, []);

        client.query("SELECT t.relname as table, i.relname as index, indisprimary as pk, array_agg(a.attname ORDER BY a.attnum) as cols "+
                     "FROM pg_class t, pg_class i, pg_index ix, pg_attribute a, pg_catalog.pg_namespace n "+
                     "WHERE t.oid = ix.indrelid and i.oid = ix.indexrelid and a.attrelid = t.oid and n.oid = t.relnamespace and " +
                     "      a.attnum = ANY(ix.indkey) and t.relkind = 'r' and n.nspname not in ('pg_catalog', 'pg_toast') " +
                     (lib.isArray(options.tables) ? `AND t.relname IN (${db.sqlValueIn(options.tables)})` : "") +
                     "GROUP BY t.relname, i.relname, ix.indisprimary ORDER BY t.relname, i.relname", (err, rows) => {
            if (err) logger.error('cacheIndexes:', this.name, err);
            this.dbkeys = {};
            this.dbindexes = {};
            for (const i in rows) {
                if (rows[i].pk) {
                    this.dbkeys[rows[i].table] = rows[i].cols;
                } else {
                    this.dbindexes[rows[i].index] = rows[i].cols;
                }
            }
            this.release(client);
            lib.tryCall(callback, err, []);
        });
    });
}

Pool.prototype.updateOps = function(req, op, name, value, placeholder)
{
    switch (op) {
    case "add":
        // Add to a list
        return name + "=" + name + "||" + placeholder;

    case "del":
        // Delete from a list
        return name + "=array_remove(" + name + "," + placeholder + ")";

    default:
        return db.SqlPool.prototype.updateOps.call(this, req, op, name, value, placeholder);
    }
}

Pool.prototype.bindValue = function(req, name, value, op)
{
    // array_remove can only work with single value
    if (op == "del" && Array.isArray(value)) return value[0];
    return value;
}


