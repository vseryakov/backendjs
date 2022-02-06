//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const util = require('util');
const lib = require(__dirname + '/../lib');
const db = require(__dirname + '/../db');
const logger = require(__dirname + '/../logger');

const pool = {
    name: "pgsql",
    configOptions: {
        noIfExists: 1,
        noJson: 1,
        noReplace: 1,
        onConflictUpdate: 1,
        schema: ['public'],
    },
    createPool: function(options) { return new Pool(options); }
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
            callback(err, result && result.rows || [], { affected_rows: result && result.rowCount });
        });
    }
}

function Pool(options)
{
    require("pg");
    options.type = pool.name;
    db.SqlPool.call(this, options);
    this.configOptions = lib.objMerge(this.configOptions, pool.configOptions);
}
util.inherits(Pool, db.SqlPool)

Pool.prototype.open = function(callback)
{
    var self = this;
    if (this.url == "default") this.url = "postgresql://postgres@127.0.0.1/" + db.dbName;
    const pg = require("pg");
    const client = new pg.Client(/:\/\//.test(this.url) ? { connectionString: this.url } : this.configOptions);
    client.connect(function(err) {
        if (err) {
            logger.error('connect:', self.name, err);
            callback(err);
        } else {
            client.on('error', logger.error.bind(logger, self.name));
            client.on('notice', logger.log.bind(logger, self.name));
            client.on('notification', logger.info.bind(logger, self.name));
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
    var self = this;

    this.acquire((err, client) => {
        if (err) return callback(err, []);

        client.query("SELECT t.relname as table, i.relname as index, indisprimary as pk, array_agg(a.attname ORDER BY a.attnum) as cols "+
                     "FROM pg_class t, pg_class i, pg_index ix, pg_attribute a, pg_catalog.pg_namespace n "+
                     "WHERE t.oid = ix.indrelid and i.oid = ix.indexrelid and a.attrelid = t.oid and n.oid = t.relnamespace and " +
                     "      a.attnum = ANY(ix.indkey) and t.relkind = 'r' and n.nspname not in ('pg_catalog', 'pg_toast') "+
                     "GROUP BY t.relname, i.relname, ix.indisprimary ORDER BY t.relname, i.relname", function(err, rows) {
            if (err) logger.error('cacheIndexes:', self.name, err);
            self.dbkeys = {};
            self.dbindexes = {};
            for (const i in rows) {
                if (rows[i].pk) {
                    self.dbkeys[rows[i].table] = rows[i].cols;
                } else {
                    self.dbindexes[rows[i].index] = rows[i].cols;
                }
            }
            self.release(client);
            callback(err, []);
        });
    });
}

// Convert JS array into db PostgreSQL array format: {..}
Pool.prototype.bindValue = function(req, name, val)
{
    function toArray(v) {
        return '{' + v.map((x) => (Array.isArray(x) ? toArray(x) : typeof x === 'undefined' || x === null ? 'NULL' : lib.stringify(x))).join(',') + '}';
    }

    switch (lib.typeName(val)) {
    case "buffer":
    case "array":
    case "object":
        var col = (this.dbcolumns[req.table] || lib.empty)[name] || db.getColumn(req.table, name) || lib.empty;
        var type = col.data_type || this.configOptions.typesMap[col.type] || col.type;
        if (/json/i.test(type)) {
            val = lib.stringify(val);
        } else
        if (/array/i.test(type)) {
            if (Buffer.isBuffer(val)) {
                var a = [];
                for (var i = 0; i < val.length; i++) a.push(val[i]);
                    val = a.join(',');
            } else
            if (Array.isArray(val)) {
                val = toArray(val);
            }
        } else {
            val = lib.stringify(val);
        }
    }
    return val;
}

