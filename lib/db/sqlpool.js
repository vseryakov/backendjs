/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const logger = require(__dirname + '/../logger');
const lib = require(__dirname + '/../lib');
const sql = require(__dirname + '/sql');
const DbPool = require(__dirname + '/pool');

/**
 * Create a database pool for SQL like databases, see {@link dbPool}
 * @param {object} options - an object defining the pool, the following properties define the pool:
 * @param {string} options.pool - pool name/type, if not specified the SQLite is used
 * @param {int} options.max - max number of clients to be allocated in the pool
 * @param {int} options.idle - after how many milliseconds an idle client will be destroyed
 * @param {object} [defaults] - an object with default pool methods for init and shutdown and other properties, see {@link Pool}
 */
class SqlPool extends DbPool {

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

    /**
     * Prepare for execution, return an object with formatted or transformed SQL query for the database driver of this pool
     * @param {DbRequest} req
     */
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
            if (req.config.upsert) {
                sql.insert(req);
            } else {
                sql.update(req);
            }
            break;
        case "update":
            if (req.options.upsert && req.config.upsert) {
                sql.insert(req);
                break;
            }
        case "updateall":
            sql.update(req);
            break;
        case "del":
        case "delall":
            sql.delete(req);
            break;
        }
    }

    /**
     * Execute a query in req.text
     * @param {object} client
     * @param {DbRequest} req
     * @param {function} callback
     */
    query(client, req, callback)
    {
        logger.debug("sqlQuery:", req);

        if (req.op == "bulk") {
            return req.options.transaction ?
                        this.queryTransaction(client, req, callback) :
                        this.queryBulk(client, req, callback);
        }

        if (typeof req.text == "string" && req.text.length) {
            client.query(req, callback);
        } else

        if (lib.isArray(req.text)) {
            // run all at once, driver handles it
            if (req.config.bulkSize) {
                return client.query(req, callback);
            }
            // or run each separately
            lib.forEachLimit(req.text, req.options.concurrency, (text, next) => {
                client.query({ text, options: req.options }, next);
            }, callback, true);
        } else {
            callback(req.op != "upgrade" ? lib.newError("sql text missing") : null, []);
        }
    }

    /**
     * Support for pagination, for SQL this is the OFFSET for the next request
     * @param {object} client
     * @param {DbRequest} req
     * @param {object[]} rows
     * @return {object}
     */
    nextToken(client, req, rows)
    {
        return req.options?.count && rows.length == req.options.count ? lib.toNumber(req.options.start) + lib.toNumber(req.options.count) : null;
    }

    /**
    * SQL SET expression for a column
    * @param {DbRequest} req
    * @param {object} expr
    * @param {string} expr.name - property name
    * @param {string} expr.type - column type
    * @param {string} expr.column - quoted column name to use in SQL
    * @param {any} expr.value - current value
    * @param {string} expr.op - default op
    * @param {string} expr.placeholder - placeholder position, like $1,
    *    unsetting this property means the value should not be added to req.values
    * @param {string} expr.text - must be set to complete SET statem,ent, if not set this property is skipped
    */
    prepareUpdateExpr(req, expr)
    {
        switch (expr.op) {
        case "unset":
        case "remove":
            expr.text = expr.column + "=NULL";
            delete expr.placeholder;
            break;

        case "not_exists":
            // Update only if the value is null, otherwise skip
            expr.text = `${expr.column}=COALESCE(${expr.column},${expr.placeholder})`;
            break;

        case "incr":
            // Increment a number
            expr.text = `${expr.column}=COALESCE(${expr.column},0)+${expr.placeholder}`;
            break;

        case "add":
            // Add to a list
            expr.text = `${expr.column}=TRIM(COALESCE(${expr.column},'')||,${expr.placeholder},',')`;
            break;

        case "del":
            // Delete from a list
            expr.text = `${expr.column}=TRIM(REPLACE(${expr.column},${expr.placeholder},''),',')`;
            break;

        case "append":
            // Append to a value
            expr.text = `${expr.column}=COALESCE(${expr.column},'')||${expr.placeholder}`;
            break;

        case "prepend":
            // Append to a value
            expr.text = `${expr.column}=${expr.placeholder}||COALESCE(${expr.column},'')`;
            break;

        case "expr":
            // SQL expression
            if (Array.isArray(expr.value) && typeof expr.value[0] == "string") {
                let fmt = expr.value[0];
                for (let i = 1; i < expr.value.length; i++) {
                    req.values.push(expr.value[i]);
                    fmt = fmt.replaceAll(req.config.placeholder + i, "$^" + req.values.length);
                }
                expr.text = `${expr.column}=${fmt.replaceAll("$^", "$")}`;
            } else {
                expr.text = `${expr.column}=${expr.value}`;
            }
            delete expr.placeholder;
            break;

        default:
            expr.text = `${expr.column}=${expr.placeholder}`;
        }
    }

    /**
     * Build UPSERT or ON CONFLICT statement
     * @param {DbRequest} req
     * @return {string} full SQL text or nothing to use default
     */
    prepareUpsertExpr(req)
    {
    }

    queryTransaction(client, req, callback)
    {
        if (!/BEGIN.+TRANSACTION/i.test(req.query[0]?.text)) {
            req.query.splice(0, 0, { text: `BEGIN TRANSACTION` });
        }

        var info = { affected_rows: 0 }, errors = [];

        lib.forEachSeries(req.query, (item, next) => {
            client.query(item, (err, rc, meta) => {
                if (err) {
                    item.error = err;
                    errors.push(item);
                } else
                if (meta?.affected_rows) {
                    info.affected_rows += meta.affected_rows;
                }
                next(err);
            });
        }, (err) => {
            const text = `${err || errors?.length ? "ROLLBACK" : "COMMIT"} TRANSACTION`;
            client.query(text, (e) => {
                if (e) errors.push({ text, error: e });
                callback(err, errors, info);
            });
        }, true);
    }

    queryBulk(client, req, callback)
    {
        var info = { affected_rows: 0 }, errors = [];

        lib.forEachLimit(req.query, req.options.concurrency, (item, next) => {
            client.query(item, (err, rc, meta) => {
                if (err) {
                    item.error = err;
                    errors.push(item);
                } else
                if (meta?.affected_rows) {
                    info.affected_rows += meta.affected_rows;
                }
                next();
            });
        }, (err) => {
            callback(err, errors, info);
        }, true);
    }
}

module.exports = SqlPool;
