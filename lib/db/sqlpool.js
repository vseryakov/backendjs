/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const logger = require(__dirname + '/../logger');
const lib = require(__dirname + '/../lib');
const db = require(__dirname + '/../db');
const sql = require(__dirname + '/sql');
const DbPool = require(__dirname + '/pool');

/**
 * Create a database pool for SQL like databases, see {@link dbPool}
 * @param {object} options - an object defining the pool, the following properties define the pool:
 * @param {string} options.pool - pool name/type, if not specified the SQLite is used
 * @param {int} options.max - max number of clients to be allocated in the pool
 * @param {int} options.idle - after how many milliseconds an idle client will be destroyed
 * @param {object} defaults - an object with default pool methods for init and shutdown and other properties, see {@link Pool}
 * @class SqlPool
 */
module.exports = class SqlPool extends DbPool {

    constructor(options, defaults)
    {
        // SQL databases cannot support unlimited connections, keep reasonable default to keep it from overloading
        if (!lib.isPositive(options.max)) options.max = 25;

        if (defaults) {
            defaults = lib.objMerge({ configOptions: sql.configOptions },
                { configOptions: defaults.configOptions, connectOptions: defaults.connectOptions },
                { deep: 1 });
        }

        super(options, defaults);
    }

    // Call column caching callback with our pool name
    cacheColumns(client, options, callback)
    {
        // Use current database name for schema if not specified
        if (!this.configOptions.schema.length) {
            this.configOptions.schema.push(client.name);
        }

        client.query("SELECT c.table_name,c.column_name,LOWER(c.data_type) AS data_type,c.column_default,c.ordinal_position,c.is_nullable " +
                     "FROM information_schema.columns c,information_schema.tables t " +
                     "WHERE c.table_schema IN (" + sql.valueIn(this.configOptions.schema) + ") AND c.table_name=t.table_name " +
                     (lib.isArray(options.tables) ? `AND t.table_name IN (${sql.valueIn(options.tables)})` : "") +
                     "ORDER BY 5", (err, rows) => {
            this.dbcolumns = {};
            for (const i in rows) {
                const table = rows[i].table_name.toLowerCase()
                if (!this.dbcolumns[table]) this.dbcolumns[table] = {};

                // Split type cast and ignore some functions in default value expressions
                var isserial = false, val = rows[i].column_default ? String(rows[i].column_default).replace(/'/g,"").split("::")[0] : null;
                if (val && val.indexOf("nextval") == 0) val = null, isserial = true;
                if (val && val.indexOf("ARRAY") == 0) val = val.replace("ARRAY", "").replace("[", "{").replace("]", "}");

                this.dbcolumns[table][rows[i].column_name.toLowerCase()] = {
                    id: rows[i].ordinal_position,
                    value: val,
                    data_type: rows[i].data_type,
                    isnull: rows[i].is_nullable == "YES",
                    isserial: isserial
                };
            }
            lib.tryCall(callback, err);
        });
    }

    // Prepare for execution, return an object with formatted or transformed SQL query for the database driver of this pool
    prepare(req)
    {
        switch (req.op) {
        case "list":
        case "select":
        case "search":
            sql.select(req);
            break;
        case "create":
            sql.create(req);
            break;
        case "upgrade":
            sql.upgrade(req);
            break;
        case "drop":
            sql.drop(req);
            break;
        case "get":
            sql.get(req);
            break;
        case "add":
        case "put":
            sql.insert(req);
            break;
        case "incr":
        case "update":
        case "updateall":
            sql.update(req);
            break;
        case "del":
        case "delall":
            sql.delete(req);
            break;
        }
    }

    // Execute a query in req.text
    query(client, req, callback)
    {
        logger.debug("sqlQuery:", req);
        if (typeof req.text == "string" && req.text.length) {
            client.query(req, callback);
        } else
        if (lib.isArray(req.text)) {
            lib.forEachSeries(req.text, (text, next) => {
                client.query({ text, options: req.options }, next);
            }, callback, true);
        } else {
            callback(null, []);
        }
    }

    // Support for pagination, for SQL this is the OFFSET for the next request
    nextToken(client, req, rows)
    {
        return req.options?.count && rows.length == req.options.count ? lib.toNumber(req.options.start) + lib.toNumber(req.options.count) : null;
    }
}
