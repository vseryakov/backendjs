/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const lib = require(__dirname + '/../lib');
const db = require(__dirname + '/../db');
const logger = require(__dirname + '/../logger');
const SqlPool = require(__dirname + '/sqlpool');

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
        return new PostgresPool(options);
    }
};
module.exports = pool;

db.modules.push(pool);

class PgClient {
    constructor(client) {
        this.pg = client;
    }

    query(req, callback) {
        if (typeof req == "string") req = { text: req };
        logger.dev("pgQuery:", req.text, req.values);

        this.pg.query(req.text, req.values, (err, result) => {
            callback(err, result?.rows || [], { affected_rows: result?.rowCount });
        });
    }
}

class PostgresPool extends SqlPool {

    constructor(options)
    {
        pool.pg = require("pg");
        super(options, pool);
    }

    openDb(callback)
    {
        if (this.url == "default") this.url = "postgresql://postgres@127.0.0.1/" + db.dbName;
        const client = new pool.pg.Client(/:\/\//.test(this.url) ? { connectionString: this.url } : this.configOptions);
        client.connect((err) => {
            if (err) {
                logger.error('openDb:', this.name, err);
                callback(err);
            } else {
                client.on('error', logger.error.bind(logger, this.name));
                client.on('notice', logger.log.bind(logger, this.name));
                client.on('notification', logger.info.bind(logger, this.name));
                callback(err, new PgClient(client));
            }
        });
    }

    closeDb(client, callback)
    {
        client.pg.end(callback);
    }

    // Cache indexes using the information_schema
    cacheIndexes(client, options, callback)
    {
        client.query("SELECT t.relname as table, i.relname as index, indisprimary as pk, array_agg(a.attname ORDER BY a.attnum) as cols "+
                     "FROM pg_class t, pg_class i, pg_index ix, pg_attribute a, pg_catalog.pg_namespace n "+
                     "WHERE t.oid = ix.indrelid and i.oid = ix.indexrelid and a.attrelid = t.oid and n.oid = t.relnamespace and " +
                     "      a.attnum = ANY(ix.indkey) and t.relkind = 'r' and n.nspname not in ('pg_catalog', 'pg_toast') " +
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
    }

    updateOps(req, name, value, op, placeholder)
    {
        switch (op) {
        case "add":
            // Add to a list
            return { placeholder: name + "||" + placeholder, value };

        case "del":
            // Delete from a list, only one item at as time
            return { placeholder: "array_remove(" + name + "," + placeholder + ")", value: Array.isArray(value) ? value[0] : value };
        }
    }

}


