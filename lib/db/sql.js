/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const lib = require(__dirname + '/../lib');
const db = require(__dirname + '/../db');
const logger = require(__dirname + '/../logger');

/**
 * @module sql
 */

const sql =

/**
 * SQL generation helpers, very simple functionality
 */

module.exports = {
    name: "sql",

};

/**
 * Quote value to be used in SQL expressions
 * @param {any} value
 * @return {string}
 * @memberof module:sql
 * @method quote
 */
sql.quote = function(val)
{
    return val === null || val === undefined ? "NULL" :
           `'${(typeof val == "string" ? val : String(val)).replace(/'/g,"''")}'`;
}

/**
 * Return properly quoted column name if it is a keyword
 * @param {DbRequest} req - current request
 * @param {string} name - column name
 * @return {string}
 * @memberof module:sql
 * @method column
 */
sql.column = function(req, name)
{
    return req.config?.keywords?.has(name?.toUpperCase()) ? '"' + name + '"' : name;
}

/**
 * Return properly quoted value to be used directly in SQL expressions, format according to the type
 * @param {any} value - column value to format
 * @param {string|DbRequestColumn} [options] - type or options
 * @return {string}
 * @memberof module:sql
 * @method value
 */
sql.value = function(value, options)
{
    if (value == "null") return "NULL";
    switch ((typeof options == "string" && options) || options?.type || lib.typeName(value)) {
    case "real":
    case "float":
    case "double":
    case "decimal":
    case "int":
    case "int32":
    case "long":
    case "smallint":
    case "integer":
    case "number":
    case "bigint":
    case "numeric":
    case "counter":
    case "now":
    case "clock":
    case "ttl":
        return lib.toNumber(value, options);

    case "bool":
    case "boolean":
        return lib.toBool(value);

    case "date":
        return sql.quote(lib.toDate(value).toISOString());

    case "time":
    case "timestamp":
        return sql.quote(lib.toDate(value).toLocaleTimeString());

    default:
        return sql.quote(value);
    }
}

/**
 * Return list in format to be used with SQL IN ()
 * @param {any|any[]} list - items to compare with
 * @param {string} [type] - optional data type
 * @return {string}
 * @memberof module:sql
 * @method valueIn
 */
sql.valueIn = function(list, type)
{
    if (!Array.isArray(list)) {
        if (list === null || list === undefined) return '';
        list = [list];
    }
    if (!list.length) return '';
    return list.map((x) => (sql.value(x, type))).join(",");
}

/**
 * Return time formatted for SQL usage as ISO, if no date specified returns current time
 * @memberof module:sql
 * @return {string}
 * @method time
 */
sql.time = function(d)
{
    if (d) {
       try { d = (new Date(d)).toISOString() } catch (e) { d = '' }
    } else {
        d = (new Date()).toISOString();
    }
    return d;
}

/**
 * Build SQL orderby/limit/offset conditions, config can define defaults for sorting and paging
 * @param {DbRequest} req - current request
 * @return {string}
 * @memberof module:sql
 * @method limit
 */
sql.limit = function(req)
{
    var expr = "";

    const orderby = lib.split(req.options.sort).
                        map(x => (x ? (x[0] == "!" ? x.substr(1) : x) + (x[0] == "!" ? " DESC" : "") : "")).
                        filter(x => x);

    if (orderby.length) {
        expr += " ORDER BY " + orderby;
    }

    // Limit clause
    var count = lib.toNumber(req.options.count, { float: false, dflt: req.config?.features?.limit, min: 0 });
    if (count) {
        expr += " LIMIT " + count;
    }

    var page = lib.toNumber(req.options.page, { float: false, dflt: 0, min: 0 });
    var start = lib.toNumber(req.options.start, { float: false, dflt: 0, min: 0 });
    if (start) {
        expr += " OFFSET " + start;
    } else
    if (page && count) {
        expr += " OFFSET " + ((page - 1) * count);
    }
    return expr;
}

/**
 * Build SQL expression for the column and value to be used in WHERE,
 * req.values will be updated with actual values for each placeholder
 * @param {DbRequest} req - current request
 * @param {string} name - column name
 * @param {any} value - value to compare
 * @param {DbRequestColumn} [column] - column definition returned by {@link module.db:prepareColumn}
 * @return {string} SQL comparison expression
 * @memberof module:sql
 * @method expr
 */
sql.expr = function(req, name, value, column)
{
    if (!name || value === undefined) return "";

    var text = req.pool.prepareExpr(req, name, value, column);

    logger.debug("expr:", "sql", name, value, "C:", column, "R:", req, text);

    if (text) return text;

    const placeholder = req.config.placeholder;
    const type = column?.type;
    const raw = req.options?.raw;
    let op = column?.op;

    name = sql.column(req, name)

    switch (op) {
    case "not in":
    case "in":
    case "&&":
    case "not &&":
    case "@>":
    case "not @>":
    case "<@":
    case "not <@":
        var list = [];
        // Convert type into array
        switch (lib.typeName(value)) {
        case "object":
            for (const p in value) list.push(value[p]);
            break;

        case "array":
            list = value;
            break;

        default:
            list.push(value);
        }
        if (!list.length) break;

        if (raw) {
            list = sql.valueIn(list, type);
        } else {
            list = list.map(val => {
                req.values.push(val);
                return req.pool.placeholder(req);
            });
        }

        if (!op.endsWith("in")) {
            if (op[0] == "n") {
                text = `NOT (${name} ${op.substr(4)} ARRAY[${list}])`;
            } else {
                text = `${name} ${op} ARRAY[${list}]`;
            }
        } else {
            text = `${name} ${op} (${list})`;
        }
        break;

    case "between":
    case "not between":
        // If we cannot parse out 2 values, treat this as exact operator
        list = [];
        switch (lib.typeName(value)) {
        case "array":
            list = value;
            break;

        case "string":
            // For number array allow to be separated by comma as well, either one but not to be mixed
            if (lib.rxNumericType.test(type) && value.indexOf(',') > -1) {
                list = value.split(',');
                break;
            } else
            if (value.indexOf('|') > -1) {
                list = value.split('|');
                break;
            }
        }
        if (list.length > 1) {
            if (raw) {
                text = `${name} ${op} ${sql.value(list[0], type)} AND ${sql.value(list[1], type)}`;
            } else {
                req.values.push(list[0], list[1]);
                text = `${name} ${op} ${req.pool.placeholder(req, req.values.length - 1)} AND ${req.pool.placeholder(req)}`;
            }
        } else {
            if (raw) {
                text = `${name} = ${sql.value(value, column)}`;
            } else {
                req.values.push(value);
                text = `${name} = ${req.pool.placeholder(req)}`;
            }
        }
        break;

    case "null":
    case "not null":
        text = name + " IS " + op;
        break;

    case '@@':
        if (raw) {
            text = `${name} ${op} to_tsquery('${column.lang || "english"}',${sql.quote(value)})`;
        } else {
            req.values.push(value);
            text = `${name} ${op} to_tsquery('${column.lang || "english"}',${req.pool.placeholder(req)})`;
        }
        break;

    case '~* any':
    case '!~* any':
        if (raw) {
            text = sql.quote(value) + " " + op + "(" + name + ")";
        } else {
            req.values.push(value);
            text = req.pool.placeholder(req) + " " + op + "(" + name + ")";
        }
        break;

    case 'contains':
    case 'not contains':
        op = op[0] == "n" ? "NOT LIKE" : "LIKE";
        value = '%' + value + '%';
        if (raw) {
            text = name + " " + op + " " + sql.value(value, column);
        } else {
            req.values.push(value);
            text = name + " " + op + " " + req.pool.placeholder(req);
        }
        break;

    case 'begins with':
    case "not begins with":
        op = op[0] == "n" ? "NOT LIKE" : "LIKE";
        value += '%';
        if (raw) {
            text = name + " " + op + " " + sql.value(value, column);
        } else {
            req.values.push(value);
            text = name + " " + op + " " + req.pool.placeholder(req);
        }
        break;

    case 'like%':
    case "not like%":
    case "ilike%":
    case "not ilike%":
        value += '%';
        op = op.substr(0, op.length-1);

    case '>':
    case '>=':
    case '<':
    case '<=':
    case '<>':
    case '!=':
    case "not like":
    case "like":
    case "ilike":
    case "not ilike":
    case "not similar to":
    case "similar to":
    case "regexp":
    case "not regexp":
    case "~":
    case "~*":
    case "!~":
    case "!~*":
    case 'match':
        if (raw) {
            text = name + " " + op + " " + sql.value(value, column);
        } else {
            req.values.push(value);
            text = name + " " + op + " " + req.pool.placeholder(req);
        }
        break;

    case "expr":
        if (!raw && Array.isArray(value) && typeof value[0] == "string") {
            let i = 0;
            text = value[0].replace(/\?/g, () => {
                if (value[++i] === undefined) return;
                req.values.push(value[i]);
                return req.pool.placeholder(req);
            });
        } else {
            text = value;
        }
        break;

    default:
        if (raw) {
            text = name + " = " + sql.value(value, column);
        } else {
            req.values.push(value);
            text = name + " = " + req.pool.placeholder(req);
        }
        break;
    }
    return text;
}

/**
 * Build SQL expressions for the column and value to be used in UPDATE,
 * req.values will be updated with actual value for each placeholder,
 * primary keys are skipped
 * @param {DbRequest} req - current request
 * @param {object} query - query object
 * @returns {object[]} { text, name, column, op, placeholder, value }
 * @memberof module:sql
 * @method updateExpr
 */
sql.updateExpr = function(req, query)
{
    var rc = [];

    if (!Array.isArray(req.values)) req.values = [];

    for (const name in query) {
        const col = req.column(name);
        if (!col || col.primary) continue;

        const expr = {
            name,
            type: col.type,
            column: sql.column(req, name),
            op: req.options.ops?.[name],
            value: query[name],
        };

        switch (expr.op) {
        case "expr":
            // SQL expression
            if (Array.isArray(expr.value) && typeof expr.value[0] == "string") {
                let i = 0;
                expr.text = expr.value[0].replace(/\?/g, () => {
                    if (expr.value[++i] === undefined) return;
                    req.values.push(expr.value[i]);
                    return req.pool.placeholder(req);
                });
            } else {
                expr.text = expr.value;
            }
            break;

        default:
            expr.placeholder = req.pool.placeholder(req, req.values.length + 1);
            req.pool.prepareUpdateExpr(req, expr);
        }

        logger.debug("updateExpr:", "sql", expr, "R:", req)

        if (!expr.text) continue;

        // Some expressions may not need a placeholder value or did it manually
        if (expr.placeholder) {
            expr.index = req.values.length;
            req.values.push(expr.value);
        }

        rc.push(expr);
    }
    return rc;
}

/**
 * Build SQL where condition from the keys and object values, returns SQL statement to be used in WHERE
 * @param {DbRequest} req - current request
 * @param {object} query - properties for the condition, in case of an array the primary keys for IN condition will be used only,
 *  - A property named $OR or $AND will be treated as a sub-expression if it is an object.
 *  - A property named $NOT will be trated as sub-expression with NOT before it
 *  - A property named $JOIN will produce JOIN expression, joined table name will be inferred fron the table.column properties/values
 *  - If need multiple OR/AND/JOIN conditions use more $ signs, like $$OR, $$$OR, $$JOIN
 *  - JOIN syntax:
 *    1. column op table.column - current table column with other table column
 *    2. column op value - current table column compare to a value
 *    3. table.column op value - other table column compare to a value
 * @return {string}
 * @memberof module:sql
 * @method where
 */
sql.where = function(req, query)
{
    logger.dev("where:", "sql", req, "QUERY:", query);

    if (!Array.isArray(req.values)) req.values = [];

    if (Array.isArray(query)) {
        return { where: [sql.list(req, query)] };
    }

    var where = [], join;
    for (const p in query) {
        if (p[0] == "_") continue;

        const val = query[p];
        if (val === undefined) continue;

        if (p[0] === "$") {
            let w, jreq, jwhere;
            const op = p.match(/^\$+(OR|AND|NOT|JOIN)$/i)?.[1];
            switch (op) {
            case "OR":
            case "or":
            case "AND":
            case "and":
                w = sql.where(req, val);
                if (w.where.length) {
                    where.push(`(${w.where.join(` ${op} `)})`);
                }
                break

            case "NOT":
            case "not":
                w = sql.where(req, val);
                if (w.where.length) {
                    where.push(`(NOT (${w.where.join(" AND ")}))`);
                }
                break;

            case "JOIN":
            case "join":
                for (const name in val) {
                    const value = val[name];

                    const [jname] = db.parseNameOp(name);
                    const dbcol = req.column(jname);

                    const [, table, colname] = lib.isString(dbcol ? value : jname).match(/^([a-z0-9_]+)\.([a-z0-9_]+)$/i) || "";
                    if (!jreq && db.tables[table]) {
                        jreq = new db.Request({ table, query: val, values: req.values, pool: req.pool });
                    }

                    logger.debug("where:", "sql", "join", name, value, "R:", jreq)
                    if (!jreq) continue;

                    const col = db.prepareColumn(dbcol ? req : jreq, dbcol ? name : colname, value);
                    if (!col.col || col.value === undefined) continue;

                    // use case 1: name op table.name
                    if (dbcol && colname) {
                        if (!jwhere) jwhere = [];
                        jwhere.push(`${req.table}.${jname} ${col.op} ${value}`);
                        continue;
                    }

                    // Other expressions with explicit table name
                    const expr = sql.expr(jreq, dbcol ? `${req.table}.${jname}` : jname, col.value, col);
                    if (expr) {
                        if (!jwhere) jwhere = [];
                        jwhere.push(expr);
                    }

                }
                if (jwhere) {
                    if (!join) join = [];
                    join.push(`${op} ${jreq.table} ON ${jwhere.join(" AND ")}`);
                }
                break;
            }
            continue;
        }

        const col = db.prepareColumn(req, p, val);
        if (col.value === undefined) continue;

        const expr = sql.expr(req, col.name, col.value, col);
        if (expr) where.push(expr);
    }
    return { where, join };
}

/**
 * Build SQL where condition for a list of objects
 * @param {DbRequest} req - current request
 * @param {object[]} list - list of objects with properties
 * @return {string}
 * @memberof module:sql
 * @method where
 */
sql.list = function(req, list)
{
    if (!lib.isArray(list)) return "";

    if (!Array.isArray(req.values)) req.values = [];

    const placeholders = [];
    let keys = Object.keys(req.query[0]);

    if (keys.length == 1) {
        keys = keys[0];
        for (const row of list) {
            req.values.push(row[keys]);
            placeholders.push(req.pool.placeholder(req));
        }
        return sql.column(req, keys) + ` IN (${placeholders})`;

    }

    for (const row of list) {
        const cols = [];
        for (const p in row) {
            req.values.push(row[p]);
            cols.push(sql.column(req, p) + "=" + req.pool.placeholder(req));
        }
        placeholders.push("(" + cols.join(" AND ") + ")");
    }
    return placeholders.join(" OR ");
}

/**
 * Create SQL table using table definition
 * @param {DbRequest} req - request object
 * @return {string}
 * @memberof module:sql
 * @method create
 */
sql.create = function(req)
{
    const config = req.config;
    const ifNotExists = !config?.features?.no_ifexists ? "IF NOT EXISTS" : "";


    const columns = Object.keys(req.query).filter(x => x[0] !== "_");
    const sql_columns = columns.map(x => sql.createColumn(req, x, req.query[x]));

    const primary = db.getIndexColumns(req.query).primary?.map(x => sql.column(req, x)).join(',');

    if (primary) {
        sql_columns.push(`PRIMARY KEY(${primary})`);
    }

    // Table custom type and options per pool or sql-wide
    const opts = req.query["_$" + req.pool.type] || req.query._$db;

    const text = [];

    if (opts?.sql) {
        text.push(lib.toTemplate(opts.sql, [{ sql_columns, columns }, req]))
    } else {
        text.push(`CREATE TABLE ${ifNotExists} ${req.table} (${sql_columns}) ${opts?.sql_extra || ""}`);
    }
    text.push(...sql.createIndexes(req));

    req.text = !config?.features?.multi && text.length ? text : text.join(";");
}


sql.createColumn = function(req, name, col)
{
    const fk = col.foreign;
    const config = req.config;

    name = sql.column(req, name);

    const type = db.getColumnType(req, col.type);

    const opts = col["_$" + req.pool.type] || col._$db;

    if (opts?.sql) {
        return lib.toTemplate(opts.sql, [ { type, name }, col]);
    }

    return name + " " + type + " " +
           (col.length ? ` (${col.length}) ` : " ") +
           (col.not_null || col.check?.not_empty ? " NOT NULL " : "") +
           (col.auto && config?.features?.no_auto ? " AUTO_INCREMENT " : "") +
           (col.value !== undefined ? ` DEFAULT ${sql.value(col.value, col)} `: "") +
           (opts?.sql_extra || "") +
           (fk?.table ? ` REFERENCES ${fk.table}(${fk.name || name}) ${fk.ondelete ? "ON DELETE " + fk.ondelete : ""} ${fk.custom || ""}`: "")
}

/**
 * Create missing SQL indexes, index naming convention is `table_col1_col2_index`
 * @return {string[]}
 * @memberof module:sql
 * @method createIndexes
 */
sql.createIndexes = function(req)
{
    const config = req.config;
    const ifNotExists = !config?.features?.no_ifexists ? "IF NOT EXISTS" : "";

    const indexes = db.getIndexColumns(req.query);
    const text = [];

    for (const name in indexes) {
        if (name[0] == "p") continue;
        const index = req.table + "_" + indexes[name].join("_") + "_index";
        if (req.pool.dbindexes[index] || req.pool.dbindexes[index.toLowerCase()]) continue;

        const columns = indexes[name].map(x => sql.column(req, x));

        const copts = req.query[name]?.["_$" + req.pool.type] || req.query[name]?._$db;
        const topts = req.query["_$" + req.pool.type]?.[name] || req.query._$db?.[name];
        const _sql = copts?.sql || topts?.sql;

        if (_sql) {
            text.push(lib.toTemplate(_sql, [{ index, columns }, req]));
        } else {
            const type = lib.isString(copts);
            text.push(`CREATE ${type} INDEX ${ifNotExists} ${index} ON ${req.table} (${columns}) ${copts?.sql_extra || topts?.sql_extra || ""}`);
        }
    }
    return text;
}

/**
 * Create ALTER TABLE ADD COLUMN statements for missing columns and indexes
 * @param {DbRequest} req - request object
 * @return {string}
 * @memberof module:sql
 * @method upgrade
 */
sql.upgrade = function(req)
{
    const config = req.config;
    const dbcols = req.pool.dbcolumns[req.table] || lib.empty;

    const text = Object.keys(req.query).
                    filter(x => !(x[0] == "_" || x in dbcols || x.toLowerCase() in dbcols)).
                    map(x => sql.createColumn(req, x, req.query[x])).
                    map(x => `ALTER TABLE ${req.table} ADD ${x}`);

    text.push(...sql.createIndexes(req));

    req.text = !config?.features?.multi && text.length ? text : text.join(";");
}

/**
 * Create SQL DROP TABLE statement
 * @param {DbRequest} req - request object
 * @return {string}
 * @memberof module:sql
 * @method drop
 */
sql.drop = function(req)
{
    req.text = "DROP TABLE IF EXISTS " + req.table;
}

/**
 * Get one record from the database
 * @param {DbRequest} req - request object
 * @param {string[]} [req.options.select] is a list of columns or expressions to return
 * @return {string}
 * @memberof module:sql
 * @method get
 */
sql.get = function(req)
{
    var select = lib.split(req.options.select).map((x) => (sql.column(req, x))).join(",") || "*";
    var w = sql.where(req, req.query);
    var join = w.join?.length ? w.join.join(" ") : "";
    req.text = `SELECT ${select} FROM ${req.table} ${join} WHERE ${w.where.join(" AND ")} LIMIT 1`;
}

/**
 * Select object from the database
 * @param {DbRequest} req - request object
 * @param {string[]} [req.options.select] - is list of columns or expressions to return
 * @return {string}
 * @memberof module:sql
 * @method select
 */
sql.select = function(req)
{
    var w = sql.where(req, req.query);

    if (!w.where.length && req.options.noscan) {
        logger.warn('select:', "sql", 'noscan', req);
        return null;
    }

    var select = lib.split(req.options.select).map((x) => (sql.column(req, x))).join(",") || "*";
    var where = w.where.length ? " WHERE " + w.where.join(" AND ") : "";
    var join = w.join?.length ? w.join.join(" ") : "";

    req.text = `SELECT ${select} FROM ${req.table} ${join} ${where} ${sql.limit(req)}`;
}

/**
 * Build SQL insert statement
 * @param {DbRequest} req - request object
 * @return {string}
 * @memberof module:sql
 * @method insert
 */
sql.insert = function(req)
{
    const columns = [], placeholders = [];

    const upsert = req.config.features?.upsert && (req.options.upsert || ["put", "incr"].includes(req.op));

    if (!Array.isArray(req.values)) req.values = [];

    if (upsert) {
        var sets = sql.updateExpr(req, req.query);
        for (const col of sets) {
            columns.push(col.column);
            placeholders.push(col.placeholder);
        }
        for (const name of req.keys) {
            columns.push(sql.column(req, name));
            req.values.push(req.query[name]);
            placeholders.push(req.pool.placeholder(req));
        }
    } else {
        for (const name in req.query) {
            columns.push(sql.column(req, name));
            req.values.push(req.query[name]);
            placeholders.push(req.pool.placeholder(req));
        }
    }

    req.text = `INSERT INTO ${req.table}(${columns}) VALUES(${placeholders})`;

    if (req.options.donothing) {
        req.text += ` ON CONFLICT (${req.keys.map((x) => (sql.column(req, x)))}) DO NOTHING`;
    } else

    if (upsert) {
        req.text += ` ON CONFLICT (${req.keys.map((x) => (sql.column(req, x)))}) DO UPDATE SET ${sets.map(x => x.text)}`;

        if (req.options.query) {
            var w = sql.where(req, req.options.query);
            if (w.where.length) {
                req.text += " WHERE " + w.where.join(" AND ");
            }
        }
    }

    if (req.options.returning) {
        req.text += " RETURNING " + req.options.returning;
    }
}

/**
 * Build SQL statement for update
 * @param {DbRequest} req - request object
 * @return {string}
 * @memberof module:sql
 * @method update
 */
sql.update = function(req)
{
    var update, query;

    if (req.op == "updateall") {
        query = req.query;
        update = req.options.update;
    } else {
        query = db.getQueryForKeys(req.keys, req.query);
        update = req.query;
    }

    // Additional condition to the primary keys
    if (req.options.query) {
        Object.assign(query, req.options.query);
    }

    const w = sql.where(req, query);

    if (!w.where.length && req.options.noscan) {
        logger.warn('update:', "sql", 'noscan', req);
        return null;
    }

    const sets = sql.updateExpr(req, update).map(x => x.text);

    req.text = "UPDATE " + req.table + " SET " + sets + " WHERE " + w.where.join(" AND ");

    if (req.options.returning) {
        req.text += " RETURNING " + req.options.returning;
    }
}

/**
 * Build SQL statement for delete
 * @param {DbRequest} req - request object
 * @return {string}
 * @memberof module:sql
 * @method delete
 */
sql.delete = function(req)
{
    var w = sql.where(req, req.query);

    if (!w.where.length && req.options.noscan) {
        logger.warn('delete:', "sql", 'noscan', req);
        return null;
    }

    var where = w.where.length ? " WHERE " + w.where.join(" AND ") : "";

    req.text = `DELETE FROM ${req.table} ${where}`;

    if (req.options?.returning) {
        req.text += " RETURNING " + req.options.returning;
    }
}
