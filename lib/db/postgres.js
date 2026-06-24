/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');
const pgPool = require(__dirname + '/pg');

exports.defaults = {
    type: "postgres",
    config: {
        typesMap: { list: "text[]", set: "text[]" },
        features: {
            multi: 1,
            upsert: 1,
            list: 1,
        },
        schema: ['public'],
    },
};

/**
 * PostgreSQL pool based on the SqlPool with Postgres specific types
 */
class PostgresPool extends pgPool.Pool {

    constructor(options)
    {
        super(options, exports.defaults);
    }

    // Cache indexes using the information_schema
    cacheIndexes(client, _options, callback)
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
        switch (expr.type) {
        case "set":
        case "list":

            switch (expr.op) {
            case "add":
                if (Array.isArray(expr.value)) {
                    const array = expr.value.map(val => {
                        req.values.push(val);
                        return req.pool.placeholder(req);
                    });
                    expr.text = `${expr.column}=${expr.column}||ARRAY[${array}]`;
                    delete expr.placeholder;
                } else {
                    expr.text = `${expr.column}=${expr.column}||${expr.placeholder}`;
                }
                return;

            case "del":
                if (Array.isArray(expr.value)) {
                    let array = expr.column;
                    for (let i = 0; i < expr.value.length; i++) {
                        req.values.push(expr.value[i]);
                        array = `array_remove(${array},${req.pool.placeholder(req)})`;
                    }
                    expr.text = `${expr.column}=${array}`;
                    delete expr.placeholder;
                } else {
                    expr.text = `${expr.column}=array_remove(${expr.column},${expr.placeholder})`;
                }
                return;
            }
            break;
        }

        super.prepareUpdateExpr(req, expr);
    }

}

exports.Pool = PostgresPool;
