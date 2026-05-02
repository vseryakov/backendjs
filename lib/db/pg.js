/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');
const sqlPool = require(__dirname + '/sqlpool');

exports.defaults = {
    type: "pg",
    configOptions: {
        typesMap: { list: "text[]" },
        upsert: 1,
        noListOps: 0,
        noListTypes: 0,
        schema: ['public'],
    },
};

class PgClient {
    constructor(client) {
        this.pg = client;
    }

    query(req, callback) {
        if (typeof req == "string") req = { text: req };
        logger.dev("pgClient:", req.text, req.values);

        this.pg.query(req.text, req.values, (err, result) => {
            callback(err, result?.rows || [], { affected_rows: result?.rowCount });
        });
    }
}

var _pg;

/**
 * PostgreSQL wire compatible pool based on the SqlPool
 */
class PostgresPool extends sqlPool.Pool {

    constructor(options)
    {
        _pg = lib.tryRequire("pg");
        super(options, exports.defaults);
    }

    openDb(callback)
    {
        if (!_pg) return callback({ status: 500, message: "service unavailable" });

        if (this.url == "default") {
            this.url = "postgresql://postgres@127.0.0.1/default";
        }
        const client = new _pg.Client(/:\/\//.test(this.url) ? { connectionString: this.url } : this.configOptions);
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
            lib.tryCall(callback, err, []);
        });
    }

    prepareUpdateExpr(req, expr)
    {
        switch (expr.op) {
        case "add":
            // Add to a list
            if (expr.type != "list") break;
            expr.text = `${expr.column}=${expr.column}||${expr.placeholder}`;
            return;

        case "del":
            // Delete from a list
            if (expr.type != "list") break;
            if (Array.isArray(expr.value)) {
                let array = expr.column;
                for (let i = 0; i < expr.value.length; i++) {
                    req.values.push(expr.value[i]);
                    array = `array_remove(${array},${req.config.placeholder + req.values.length})`;
                }
                expr.text = `${expr.column}=${array}`;
                delete expr.placeholder;
            } else {
                expr.text = `${expr.column}=array_remove(${expr.column},${expr.placeholder})`;
            }
            return;
        }

        super.prepareUpdateExpr(req, expr);
    }

}

exports.Pool = PostgresPool;
