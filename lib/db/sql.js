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

// Translation map for similar operators from different database drivers, merge with the basic SQL mapping
const sql = {
    name: "sql",

    configOptions: {
        sql: true,
        schema: [],
        noObjectTypes: 1,
        noListOps: 1,
        noListTypes: 1,
        noCustomColumns: 1,
        initCounters: 1,
        selectSize: 25,
        typesMap: {
            real: "numeric", number: "numeric", bigint: "bigint", smallint: "smallint", int: "bigint",
            now: "bigint", mtime: "bigint", ttl: "bigint", random: "bigint", counter: "bigint",
            obj: "json", array: "json", object: "json", bool: "boolean",
        },
        opsMap: {
            begins_with: 'like%', ne: "<>", eq: '=', le: '<=', lt: '<', ge: '>=', gt: '>'
        },
        keywords: [
            'ABORT','ACTION','ADD','AFTER','ALL','ALTER','ANALYZE','AND','AS','ASC','ATTACH','AUTOINCREMENT','BEFORE','BEGIN','BETWEEN',
            'BY','CASCADE','CASE','CAST','CHECK','COLLATE','COLUMN','COMMIT','CONFLICT','CONSTRAINT','CREATE','CROSS','CURRENT_DATE',
            'CURRENT_TIME','CURRENT_TIMESTAMP','DATABASE','DEFAULT','DEFERRABLE','DEFERRED','DELETE','DESC','DETACH','DISTINCT','DROP',
            'EACH','ELSE','END','ESCAPE','EXCEPT','EXCLUSIVE','EXISTS','EXPLAIN','FAIL','FOR','FOREIGN','FROM','FULL','GLOB','GROUP',
            'HAVING','IF','IGNORE','IMMEDIATE','IN','INDEX','INDEXED','INITIALLY','INNER','INSERT','INSTEAD','INTERSECT','INTO',
            'IS','ISNULL','JOIN','KEY','LEFT','LIKE','LIMIT','MATCH','NATURAL','NO','NOT','NOTNULL','NULL','OF','OFFSET','ON','OR',
            "ORDER","OUTER","PLAN","PRAGMA","PRIMARY","QUERY","RAISE","RECURSIVE","REFERENCES","REGEXP","REINDEX","RELEASE","RENAME",
            "REPLACE","RESTRICT","RIGHT","ROLLBACK","ROW","SAVEPOINT","SELECT","SET","TABLE","TEMP","TEMPORARY","THEN","TO","TRANSACTION",
            "TRIGGER","UNION","UNIQUE","UPDATE","USER","USING","VACUUM","VALUES","VIEW","VIRTUAL","WHEN","WHERE","WITH","WITHOUT",
        ],
    },
};

module.exports = sql;

/**
 * Execute a SQL statements
 * @memberof module:sql
 * @method query
 */
sql.query = function(client, req, callback)
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

/**
 * Cache columns using the information_schema
 * @memberof module:sql
 * @method cacheColumns
 */
sql.cacheColumns = function(pool, options, callback)
{
    pool.acquire((err, client) => {
        if (err) return lib.tryCall(callback, err, []);

        // Use current database name for schema if not specified
        if (!pool.configOptions.schema.length) pool.configOptions.schema.push(client.name);

        client.query("SELECT c.table_name,c.column_name,LOWER(c.data_type) AS data_type,c.column_default,c.ordinal_position,c.is_nullable " +
                     "FROM information_schema.columns c,information_schema.tables t " +
                     "WHERE c.table_schema IN (" + sql.valueIn(pool.configOptions.schema) + ") AND c.table_name=t.table_name " +
                     (lib.isArray(options.tables) ? `AND t.table_name IN (${sql.valueIn(options.tables)})` : "") +
                     "ORDER BY 5", (err, rows) => {
            pool.dbcolumns = {};
            for (const i in rows) {
                const table = rows[i].table_name.toLowerCase()
                if (!pool.dbcolumns[table]) pool.dbcolumns[table] = {};
                // Split type cast and ignore some functions in default value expressions
                var isserial = false, val = rows[i].column_default ? String(rows[i].column_default).replace(/'/g,"").split("::")[0] : null;
                if (val && val.indexOf("nextval") == 0) val = null, isserial = true;
                if (val && val.indexOf("ARRAY") == 0) val = val.replace("ARRAY", "").replace("[", "{").replace("]", "}");
                pool.dbcolumns[table][rows[i].column_name.toLowerCase()] = {
                    id: rows[i].ordinal_position,
                    value: val,
                    data_type: rows[i].data_type,
                    isnull: rows[i].is_nullable == "YES",
                    isserial: isserial
                };
            }
            pool.release(client);
            lib.tryCall(callback, err);
        });
    });
}

/**
 * Prepare SQL statement for the given operation
 * @memberof module:sql
 * @method prepare
 */
sql.prepare = function(req)
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
    return req;
}

/**
 * Quote value to be used in SQL expressions
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
 * @param {DbPool} [pool] - a pool may be used for configOptions
 * @param {string} name - column name
 * @memberof module:sql
 * @method column
 */
sql.column = function(req, name)
{
    return req.config?.keywords?.includes(name.toUpperCase()) ? '"' + name + '"' : name;
}

/**
 * Return properly quoted value to be used directly in SQL expressions, format according to the type
 * @param {any} value - column value to format
 * @param {DBRequestColumn} [options]
 * @memberof module:sql
 * @method value
 */
sql.value = function(value, options)
{
    if (value == "null") return "NULL";
    switch ((typeof options == "string" && options) || options?.type || lib.typeName(value)) {
    case "expr":
    case "buffer":
        return value;

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
 * @memberof module:sql
 * @method valueIn
 */
sql.valueIn = function(list, type)
{
    if (!Array.isArray(list)) {
        if (!list) return '';
        list = [list];
    }
    if (!list.length) return '';
    return list.map((x) => (sql.value(x, type))).join(",");
}

/**
 * Build SQL expressions for the column and value
 * @param {DbPool} [pool] - a pool may be used for configOptions
 * @param {string} name - column name
 * @param {any} value - value to compare
 * @param {DBRequestColumn} [options] - column definition returned by {@link module.db:prepareColumn}
 * @memberof module:sql
 * @method expr
 */
sql.expr = function(req, name, value, options)
{
    if (!name || typeof value == "undefined") return "";
    var type = options?.type || "text", list;
    var op = options?.op;
    var expr = "";
    name = sql.column(req, name);

    switch (op) {
    case "not in":
    case "in":
        list = [];
        // Convert type into array
        switch (lib.typeName(value)) {
        case "object":
            for (const p in value) list.push(value[p]);
            break;

        case "array":
            list = value;
            break;

        case "string":
            // For number array allow to be separated by comma as well, either one but not to be mixed
            if ((type == "number" || type == "int") && value.indexOf(',') > -1) {
                list = value.split(',');
                break;
            } else
            if (value.indexOf('|') > -1) {
                list = value.split('|');
                break;
            }

        default:
            list.push(value);
        }
        if (!list.length) break;
        expr += name + " " + op + " (" + sql.valueIn(list, type) + ")";
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
            if ((type == "number" || type == "int") && value.indexOf(',') > -1) {
                list = value.split(',');
                break;
            } else
            if (value.indexOf('|') > -1) {
                list = value.split('|');
                break;
            }
        }
        if (list.length > 1) {
            if (req.config?.noBetween) {
                expr += name + ">=" + sql.value(list[0], options) + " AND " + name + "<=" + sql.value(list[1], options);
            } else {
                expr += name + " " + op + " " + sql.value(list[0], type) + " AND " + sql.value(list[1], options);
            }
        } else {
            expr += name + "=" + sql.value(value, options);
        }
        break;

    case "null":
    case "not null":
        expr += name + " IS " + op;
        break;

    case '@@':
        switch (lib.typeName(value)) {
        case "string":
            expr += name + op + " to_tsquery('" + (options.lang || "english") + "'," + sql.quote(value) + ")";
            break;

        case "array":
            value = value.map((x) => ("plainto_tsquery('" + (options.lang || "english") + "'," + sql.quote(x) + ")")).join('||');
            expr += name + op + " (" + value + ")";
            break;
        }
        break;

    case '~* any':
    case '!~* any':
        expr += sql.quote(value) + " " + op + "(" + name + ")";
        break;

    case 'contains':
    case 'not contains':
        value = '%' + value + '%';
        expr += name + " LIKE " + sql.value(value, options);
        break;

    case 'like%':
    case "ilike%":
    case "not like%":
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
        expr += name + " " + op + " " + sql.value(value, options);
        break;

    case "iregexp":
    case "not iregexp":
        expr += "LOWER(" + name + ") " + (op[0] == 'n' ? "NOT" : "") + " REGEXP " + sql.value(value, options);
        break;

    case 'begins with':
    case "not begins with":
        if (op[0] == "n") expr += "NOT (";
        expr += name + " > " + sql.quote(value.substr(0, value.length-1) + String.fromCharCode(value.charCodeAt(value.length-1) - 1));
        expr += " AND " + name + " < " + sql.quote(value.substr(0, value.length-1) + String.fromCharCode(value.charCodeAt(value.length-1) + 1));
        if (op[0] == "n") expr += ")";
        break;

    default:
        expr += name + "=" + sql.value(value, options);
        break;
    }
    return expr;
}

/**
 * Return time formatted for SQL usage as ISO, if no date specified returns current time
 * @memberof module:sql
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
 * @param {DbPool} [pool] - a pool may be used for configOptions
 * @param {DBRequest} req - current request
 * @memberof module:sql
 * @method limit
 */
sql.limit = function(req)
{
    var expr = "";

    // Sorting column, multiple nested sort orders
    var orderby = "";
    ["", "1", "2"].forEach((x) => {
        var sort = req.options['sort' + x];
        if (!sort) return;
        if (!req.columns[sort] && sort.match(/^[a-z_]+$/)) {
            sort = sort.split("_").filter((x) => (req.columns[x]));
        }
        if (!sort) return;
        var desc = lib.toBool(req.options['desc' + x]);
        orderby += (orderby ? "," : "") + sort + (desc ? " DESC" : "");
    });
    // Simulate NoSQL behaviour by always sorting by the primary key
    if (!orderby) {
        if (req.options.sortKeys || req.config?.sortKeys) {
            orderby = db.getKeys(req.table, req.options).join(",");
        }
    }
    if (orderby) expr += " ORDER BY " + orderby;

    // Limit clause
    var page = lib.toNumber(req.options.page, { float: false, dflt: 0, min: 0 });
    var count = lib.toNumber(req.options.count, { float: false, dflt: req.config?.selectSize, min: 0 });
    var start = lib.toNumber(req.options.start, { float: false, dflt: 0, min: 0 });
    if (count) {
        expr += " LIMIT " + count;
    }
    if (start) {
        expr += " OFFSET " + start;
    } else
    if (page && count) {
        expr += " OFFSET " + ((page - 1) * count);
    }
    return expr;
}

/**
 * Build SQL where condition from the keys and object values, returns SQL statement to be used in WHERE
 * @param {DbPool} [pool] - a pool may be used for configOptions
 * @param {DBRequest} req - current request
 * @param {object} query - properties for the condition, in case of an array the primary keys for IN condition will be used only,
 *    a property named or$ or and$ will be treated as a sub-expression if it is an object. Add a number if need multiple OR/AND conditions like
 *    or$$, or$$,...
 * @param {string} [join] - AND is default
 * @memberof module:sql
 * @method where
 */
sql.where = function(req, query, join)
{
    const bindValue = req.pool?.bindValue || ((req, name, value) => (value));

    // List of records to return by primary key, when only one primary key property
    // is provided use IN operator otherwise combine all conditions with OR
    if (Array.isArray(query)) {
        if (!query.length) return "";
        var keys = db.getKeys(req.table, req.options);
        var props = Object.keys(query[0]);
        if (props.length == 1 && keys.includes(props[0])) {
            return sql.column(req.pool, props[0]) + " IN (" + sql.valueIn(query.map((x) => (x[props[0]]))) + ")";
        }
        return query.map((x) => `(${keys.map((y) => (sql.column(req.pool, y) + "=" + sql.quote(bindValue(req, y, x[y])))).join(" AND ")})`).
                     join(" OR ");
    }

    // Regular object with conditions
    var where = [];
    for (const p in query) {
        if (p[0] == "_") continue;
        const val = query[p];
        if (val === undefined) continue;
        const d = p.match(db.rxOrAnd);
        if (d) {
            const e = sql.where(req, val, d[1]);
            if (e) where.push("(" + e + ")");
            continue;
        }
        const col = db.prepareColumn(req, p, val);
        const expr = sql.expr(req, col.name, col.value, col);
        if (expr) where.push(expr);
    }
    return where.join(" " + (join || "AND") + " ");
}

/**
 * Create SQL table using table definition
 * @param {DbPool} [pool] - a pool may be used for configOptions
 * @param {DBRequest} req - request object
 * @memberof module:sql
 * @method create
 */
sql.create = function(req)
{
    function keys(name) {
        var cols = Object.keys(req.query).filter((x) => (req.query[x][name])).sort((a,b) => (req.query[a] - req.query[b]));
        if (name == "index" && req.pool.configOptions.noCompositeIndex) {
            return sql.column(req, cols.pop());
        }
        return cols.map((x) => (sql.column(req, x))).join(',');
    }
    var typesMap = req.config?.typesMap || {}, rc;

    if (req.op == "create") {
        const pk = keys('primary');
        rc = [`CREATE TABLE ${!req.config?.noIfExists ? "IF NOT EXISTS" : ""} ${req.table} (` +
                Object.keys(req.query).
                filter((x) => (!req.query[x].hidden)).
                map((x) => {
                    var col = req.query[x], fk = col.foreign_key, custom = col.custom || lib.empty;

                    return sql.column(req, x) + " " +
                        (typesMap[col.type] || req.config?.defaultType || "text") +
                        (!req.config?.noLengths && col.len ? " (" + col.len + ") " : " ") +
                        (!req.config?.noNulls && (col.not_null || col.not_empty) ? " NOT NULL " : " ") +
                        (!req.config?.noAuto && col.auto ? " AUTO_INCREMENT " : " ") +
                        (!req.config?.noDefaults && col.value != undefined ? "DEFAULT " + sql.value(col.value, col) : "") +
                        `${custom[req.pool.type] || ""} ${custom.sql || ""} ` +
                        (fk?.table ? `REFERENCES ${fk.table}(${fk.name || x}) ${fk.ondelete ? "ON DELETE " + fk.ondelete : ""} ${fk.custom || ""}`: "")
                }).join(",") + " " +
                (pk ? `,PRIMARY KEY(${pk})` : "") + " " +
                (req.config?.tableOptions || "") + ")" ];

    } else {
        const dbcols = req.pool.dbcolumns[req.table] || lib.empty;
        rc = Object.keys(req.query).
             filter((x) => (!(x in dbcols || x.toLowerCase() in dbcols) && !req.query[x].hidden)).
             map((x) => {
                var col = req.query[x], fk = col.foreign_key, custom = col.custom || lib.empty;

                return `ALTER TABLE ${req.table} ADD ${sql.column(req, x)} ` +
                    (typesMap[col.type] || req.config?.defaultType || "text") +
                    (!req.config?.noLengths && col.len ? " (" + col.len + ") " : " ") +
                    (!req.config?.noDefaults && col.value != undefined ? "DEFAULT " + sql.value(col.value, col) : "") +
                    `${custom[req.pool.type] || ""} ${custom.sql || ""} ` +
                    (fk?.table ? `REFERENCES ${fk.table}(${fk.name || x}) ${fk.ondelete ? "ON DELETE " + fk.ondelete : ""} ${fk.custom || ""}`: "")
             }).
             filter((x) => (x));
    }

    for (const type of ["index", "unique"]) {
        (new Array(25)).fill(0, 0).forEach((_, n, t) => {
            n = n || "";
            t = type + n;
            var cols = keys(t);
            if (!cols) return;
            var idx = req.table + "_" + cols.replace(",", "_").replace(/"/g, "") + "_idx";
            if (req.pool.dbindexes[idx] || req.pool.dbindexes[idx.toLowerCase()]) return;
            rc.push(`CREATE ${type[0] == "u" && "UNIQUE" || ""} INDEX ${!req.config?.noIfExists ? "IF NOT EXISTS" : ""} ${idx} ON ${req.table}(${cols})`);
        });
    }
    req.text = req.config?.noMultiSQL && rc.length ? rc : rc.join(";");
}

/**
 * Create ALTER TABLE ADD COLUMN statements for missing columns
 * @param {DbPool} [pool] - a pool may be used for configOptions
 * @param {DBRequest} req - request object
 * @memberof module:sql
 * @method upgrade
 */
sql.upgrade = function(req)
{
    sql.create(req);
}

/**
 * Create SQL DROP TABLE statement
 * @param {DbPool} [pool] - a pool may be used for configOptions
 * @param {DBRequest} req - request object
 * @memberof module:sql
 * @method sqlDrop
 */
sql.drop = function(req)
{
    req.text = "DROP TABLE IF EXISTS " + req.table;
}

/**
 * Get one record from the database
 * @param {DbPool} [pool] - a pool may be used for configOptions
 * @param {DBRequest} req - request object
 * @param {string[]} [req.options.select] is a list of columns or expressions to return
 * @memberof module:sql
 * @method sqlGet
 */
sql.get = function(req)
{
    var select = lib.strSplit(req.options.select).map((x) => (sql.column(req, x))).join(",");
    var where = sql.where(req, req.query);
    if (where) req.text = `SELECT ${select || "*"} FROM ${req.table} WHERE ${where} LIMIT 1`;
}

/**
 * Select object from the database
 * @param {DbPool} [pool] - a pool may be used for configOptions
 * @param {DBRequest} req - request object
 * @param {string[]} [req.options.select] - is list of columns or expressions to return
 * @memberof module:sql
 * @method select
 */
sql.select = function(req)
{
    var select = lib.strSplit(req.options.select).map((x) => (sql.column(req, x))).join(",");
    var where = sql.where(req, req.query);
    if (where) where = " WHERE " + where;

    // No full scans allowed
    if (!where && req.options.noscan) {
        logger.warn('sqlSelect:', req.table, 'nothing to do', req.query);
        return null;
    }
    req.text = `SELECT ${select || "*"} FROM ${req.table} ${where} ${sql.limit(req)}`;
}

/**
 * Build SQL insert statement
 * @param {DbPool} [pool] - a pool may be used for configOptions
 * @param {DBRequest} req - request object
 * @memberof module:sql
 * @method insert
 */
sql.insert = function(req)
{
    const placeholder = req.config?.placeholder || "$";
    var names = [], pnums = [], i = 1;

    req.values = [];

    for (const p in req.query) {
        names.push(p);
        pnums.push(placeholder + i);
        req.values.push(req.pool.bindValue(req, p, req.query[p]));
        i++;
    }
    // No columns to insert, just exit, it is not an error, return empty result
    if (!names.length) {
        logger.debug('sqlInsert:', req.table, 'nothing to do', req.query, req.columns);
        return null;
    }
    names = names.map((x) => (sql.column(req, x)));
    var op = req.op == "put" && !req.config?.noReplace ? "REPLACE" :
             req.op == "put" && req.config?.upsert ? "UPSERT" : "INSERT";

    req.text = `${op} INTO ${req.table}(${names}) VALUES(${pnums})`;

    if (req.op == "put" && !req.config?.upsert && req.config?.onConflictUpdate) {
        req.text += ` ON CONFLICT (${req.keys.map((x) => (sql.column(req, x)))}) DO UPDATE SET (${names}) = (${pnums})`;
    }
    if (req.options.donothing) req.text += ` ON CONFLICT (${req.keys.map((x) => (sql.column(req, x)))}) DO NOTHING`;
    if (req.options.returning) req.text += " RETURNING " + req.options.returning;
    if (req.options.ifnotexists) req.text += " IF NOT EXISTS ";
    if (req.options.using_ttl) req.text += " USING TTL " + req.options.using_ttl;
    if (req.options.using_timestamp) req.text += " USING TIMESTAMP " + req.options.using_timestamp;
}

/**
 * Build SQL statement for update
 * @param {DbPool} [pool] - a pool may be used for configOptions
 * @param {DBRequest} req - request object
 * @memberof module:sql
 * @method updade
 */
sql.update = function(req)
{
    const placeholder = req.config?.placeholder || "$";
    var sets = [], i = 1, query = {};
    const updateOps = req.options?.updateOps || lib.empty;

    req.values = [];

    for (let p in req.query) {
        const v = req.query[p];
        const col = req.column(p);
        console.log(p, col, v)
        // Do not update primary columns, only use in condition
        if (col.primary) {
            query[p] = v;
            continue;
        }
        p = sql.column(req, p);
        sets.push(req.pool.updateOps(req, updateOps[p], p, v, placeholder + i));
        req.values.push(req.pool.bindValue(req, p, v, updateOps[p]));
        i++;
    }

    // Additional condition if not by primary keys only
    if (req.options.expected) {
        Object.assign(query, req.options.expected);
    }
    var where = sql.where(req, query);

    if (!sets.length || !where) {
        // No keys or columns to update, just exit, it is not an error, return empty result
        logger.debug('sqlUpdate:', req.table, 'nothing to do', req.query, "W:", query);
        return null;
    }
    req.text = "UPDATE " + req.table ;
    if (req.options.using_ttl) req.text += " USING TTL " + req.options.using_ttl;
    if (req.options.using_timestamp) req.text += " USING TIMESTAMP " + req.options.using_timestamp;

    req.text += " SET " + sets.join(",") + " WHERE " + where;

    if (req.options.returning) {
        req.text += " RETURNING " + req.options.returning;
    }
}

/**
 * Build SQL statement for delete
 * @param {DbPool} [pool] - a pool may be used for configOptions
 * @param {DBRequest} req - request object
 * @memberof module:sql
 * @method sqlDelete
 */
sql.delete = function(req)
{
    var where = sql.where(req, req.query);
    if (where) where = " WHERE " + where;

    if (!where && req.options.noscan) {
        logger.warn('sqlDelete:', req.table, 'nothing to do', req.query);
        return null;
    }
    req.text = `DELETE FROM ${req.table} ${where}`;
    if (req.options?.returning) req.text += " RETURNING " + req.options.returning;
}
