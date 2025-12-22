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

    args: [
        { name: "config-(.+)", obj: 'configOptions', type: "map", merge: 1, descr: "Common SQL config parameters" }
    ],

    configOptions: {
        sql: true,
        schema: [],
        noObjectTypes: 1,
        noListOps: 1,
        noListTypes: 1,
        noCustomColumns: 1,
        initCounters: 1,
        selectSize: 25,
        placeholder: "$",
        maxIndexes: 20,
        typesMap: {
            real: "numeric", number: "numeric", bigint: "bigint", smallint: "smallint", int: "bigint",
            now: "bigint", mtime: "bigint", ttl: "bigint", random: "bigint", counter: "bigint",
            obj: "json", array: "json", object: "json", bool: "boolean",
        },
        opsMap: {
            begins_with: 'like%', ne: "<>", eq: '=', le: '<=', lt: '<', ge: '>=', gt: '>'
        },
        keywords: new Set([
            'ABORT','ACTION','ADD','AFTER','ALL','ALTER','ANALYZE','AND','AS','ASC','ATTACH','AUTOINCREMENT','BEFORE','BEGIN','BETWEEN',
            'BY','CASCADE','CASE','CAST','CHECK','COLLATE','COLUMN','COMMIT','CONFLICT','CONSTRAINT','CREATE','CROSS','CURRENT_DATE',
            'CURRENT_TIME','CURRENT_TIMESTAMP','DATABASE','DEFAULT','DEFERRABLE','DEFERRED','DELETE','DESC','DETACH','DISTINCT','DROP',
            'EACH','ELSE','END','ESCAPE','EXCEPT','EXCLUSIVE','EXISTS','EXPLAIN','FAIL','FOR','FOREIGN','FROM','FULL','GLOB','GROUP',
            'HAVING','IF','IGNORE','IMMEDIATE','IN','INDEX','INDEXED','INITIALLY','INNER','INSERT','INSTEAD','INTERSECT','INTO',
            'IS','ISNULL','JOIN','KEY','LEFT','LIKE','LIMIT','MATCH','NATURAL','NO','NOT','NOTNULL','NULL','OF','OFFSET','ON','OR',
            "ORDER","OUTER","PLAN","PRAGMA","PRIMARY","QUERY","RAISE","RECURSIVE","REFERENCES","REGEXP","REINDEX","RELEASE","RENAME",
            "REPLACE","RESTRICT","RIGHT","ROLLBACK","ROW","SAVEPOINT","SELECT","SET","TABLE","TEMP","TEMPORARY","THEN","TO","TRANSACTION",
            "TRIGGER","UNION","UNIQUE","UPDATE","USER","USING","VACUUM","VALUES","VIEW","VIRTUAL","WHEN","WHERE","WITH","WITHOUT"
        ])
    },
};

module.exports = sql;

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
    var type = column?.type;
    var op = column?.op;
    var raw = req.options?.raw;
    var placeholder = req.config.placeholder;
    var expr = "", list;

    // Properly quoted column name
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

        if (raw) {
           list = sql.valueIn(list, type);
        } else {
            list = list.map(val => {
                req.values.push(val);
                return placeholder + req.values.length;
            });
        }
        expr += `${name} ${op} (${list})`;
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
            if (raw) {
                expr += `${name} ${op} ${sql.value(list[0], type)} AND ${sql.value(list[1], type)}`;
            } else {
                req.values.push(list[0], list[1]);
                expr += `${name} ${op} ${placeholder + req.values.length - 1} AND ${placeholder + req.values.length}`;
            }
        } else {
            if (raw) {
                expr += `${name} = ${sql.value(value, column)}`;
            } else {
                req.values.push(value);
                expr += `${name} = ${placeholder + req.values.length}`;
            }
        }
        break;

    case "null":
    case "not null":
        expr += name + " IS " + op;
        break;

    case '@@':
        if (raw) {
            expr += `${name} ${op} to_tsquery('${column.lang || "english"}',${sql.quote(value)})`;
        } else {
            req.values.push(value);
            expr += `${name} ${op} to_tsquery('${column.lang || "english"}',${placeholder + req.values.length})`;
        }
        break;

    case '~* any':
    case '!~* any':
        if (raw) {
            expr += sql.quote(value) + " " + op + "(" + name + ")";
        } else {
            req.values.push(value);
            expr += placeholder + req.values.length + " " + op + "(" + name + ")";
        }
        break;

    case 'contains':
    case 'not contains':
        op = op[0] == "n" ? "NOT LIKE" : "LIKE";
        value = '%' + value + '%';
        if (raw) {
            expr += name + " " + op + " " + sql.value(value, column);
        } else {
            req.values.push(value);
            expr += name + " " + op + " " + placeholder + req.values.length;
        }
        break;

    case 'begins with':
    case "not begins with":
        op = op[0] == "n" ? "NOT LIKE" : "LIKE";
        value += '%';
        if (raw) {
            expr += name + " " + op + " " + sql.value(value, column);
        } else {
            req.values.push(value);
            expr += name + " " + op + " " + placeholder + req.values.length;
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
            expr += name + " " + op + " " + sql.value(value, column);
        } else {
            req.values.push(value);
            expr += name + " " + op + " " + placeholder + req.values.length;
        }
        break;

    default:
        if (raw) {
            expr += name + " = " + sql.value(value, column);
        } else {
            req.values.push(value);
            expr += name + " = " + placeholder + req.values.length;
        }
        break;
    }
    return expr;
}

/**
 * Build SQL expressions for the column and value to be used in UPDATE,
 * req.values will be updated with actual value for each placeholder,
 * primary keys are skipped
 * @param {DbRequest} req - current request
 * @param {string} name - column name
 * @param {any} value - value to set
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
        if (col.primary) continue;

        const expr = {
            name,
            type: col.type,
            column: sql.column(req, name),
            placeholder: req.config.placeholder + (req.values.length + 1),
            op: req.options.updateOps?.[name],
            value: query[name],
        };

        req.pool.prepareUpdateExpr(req, expr);
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
            placeholders.push(req.config.placeholder + req.values.length);
        }
        return sql.column(req, keys) + ` IN (${placeholders})`;

    }

    for (const row of list) {
        const cols = [];
        for (const p in row) {
            req.values.push(row[p]);
            cols.push(sql.column(req, p) + "=" + (req.config.placeholder + req.values.length));
        }
        placeholders.push("(" + cols.join(" AND ") + ")");
    }
    return placeholders.join(" OR ");
}

/**
 * Build SQL where condition from the keys and object values, returns SQL statement to be used in WHERE
 * @param {DbRequest} req - current request
 * @param {object} query - properties for the condition, in case of an array the primary keys for IN condition will be used only,
 *    a property named or$ or and$ will be treated as a sub-expression if it is an object. Add a number if need multiple OR/AND conditions like
 *    or$$, or$$$,...
 * @param {string} [join] - AND is default
 * @return {string}
 * @memberof module:sql
 * @method where
 */
sql.where = function(req, query, join)
{
    if (Array.isArray(query)) {
        return sql.list(req, query);
    }

    if (!Array.isArray(req.values)) req.values = [];

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
        if (!col.col || col.value === undefined) continue;

        const expr = sql.expr(req, col.name, col.value, col);
        if (expr) where.push(expr);
    }
    return where.join(" " + (join || "AND") + " ");
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
    function keys(name) {
        var cols = Object.keys(req.query).
                   filter((x) => (req.query[x][name])).
                   sort((a,b) => (req.query[a] - req.query[b]));
        if (name == "index" && req.config.noCompositeIndex) {
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
                    var col = req.query[x], fk = col.foreign;

                    return sql.column(req, x) + " " +
                        (typesMap[col.type] || req.config?.defaultType || "text") +
                        (!req.config?.noLengths && col.length ? " (" + col.length + ") " : " ") +
                        (!req.config?.noNulls && (col.not_null || col.check?.not_empty) ? " NOT NULL " : " ") +
                        (!req.config?.noAuto && col.auto ? " AUTO_INCREMENT " : " ") +
                        (!req.config?.noDefaults && col.value !== undefined ? "DEFAULT " + sql.value(col.value, col) : "") +
                        `${col[req.pool.type] || ""} ${col.sql || ""} ` +
                        (fk?.table ? `REFERENCES ${fk.table}(${fk.name || x}) ${fk.ondelete ? "ON DELETE " + fk.ondelete : ""} ${fk.custom || ""}`: "")
                }).join(",") + " " +
                (pk ? `,PRIMARY KEY(${pk})` : "") + " " +
                (req.config?.tableOptions || "") + ")" ];

    } else {
        const dbcols = req.pool.dbcolumns[req.table] || lib.empty;
        rc = Object.keys(req.query).
             filter((x) => (!(x in dbcols || x.toLowerCase() in dbcols) && !req.query[x].hidden)).
             map((x) => {
                var col = req.query[x], fk = col.foreign;

                return `ALTER TABLE ${req.table} ADD ${sql.column(req, x)} ` +
                    (typesMap[col.type] || req.config?.defaultType || "text") +
                    (!req.config?.noLengths && col.length ? " (" + col.length + ") " : " ") +
                    (!req.config?.noDefaults && col.value !== undefined ? "DEFAULT " + sql.value(col.value, col) : "") +
                    `${col[req.pool.type] || ""} ${col.sql || ""} ` +
                    (fk?.table ? `REFERENCES ${fk.table}(${fk.name || x}) ${fk.ondelete ? "ON DELETE " + fk.ondelete : ""} ${fk.custom || ""}`: "")
             }).
             filter((x) => (x));
    }

    for (const type of ["index", "unique"]) {
        Array(req.config.maxIndexes).fill(0, 0).forEach((_, n, t) => {
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
 * @param {DbRequest} req - request object
 * @return {string}
 * @memberof module:sql
 * @method upgrade
 */
sql.upgrade = function(req)
{
    sql.create(req);
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
    var select = lib.strSplit(req.options.select).map((x) => (sql.column(req, x))).join(",") || "*";
    var where = sql.where(req, req.query);
    if (where) {
        req.text = `SELECT ${select} FROM ${req.table} WHERE ${where} LIMIT 1`;
    }
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
    var where = sql.where(req, req.query);
    if (where) {
        where = " WHERE " + where;
    }

    // No full scans allowed
    if (!where && req.options.noscan) {
        logger.warn('sqlSelect:', req.table, 'noscan', req.query);
        return null;
    }
    var select = lib.strSplit(req.options.select).map((x) => (sql.column(req, x))).join(",") || "*";
    req.text = `SELECT ${select} FROM ${req.table} ${where} ${sql.limit(req)}`;
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

    const upsert = req.config.upsert && (req.options.upsert || ["put", "incr"].includes(req.op));

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
            placeholders.push(req.config.placeholder + req.values.length);
        }
    } else {
        for (const name in req.query) {
            columns.push(sql.column(req, name));
            req.values.push(req.query[name]);
            placeholders.push(req.config.placeholder + req.values.length);
        }
    }

    req.text = `INSERT INTO ${req.table}(${columns}) VALUES(${placeholders})`;

    if (req.options.donothing) {
        req.text += ` ON CONFLICT (${req.keys.map((x) => (sql.column(req, x)))}) DO NOTHING`;
    } else

    if (upsert) {
        req.text += ` ON CONFLICT (${req.keys.map((x) => (sql.column(req, x)))}) DO UPDATE SET ${sets.map(x => x.text)}`;

        if (req.options.query) {
            var where = sql.where(req, req.options.query);
            if (where) {
                req.text += " WHERE " + where;
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
    const query = db.getQueryForKeys(req.keys, req.query);

    if (req.options.query) {
        Object.assign(query, req.options.query);
    }
    const where = sql.where(req, query);

    const sets = sql.updateExpr(req, req.query).map(x => x.text);

    req.text = "UPDATE " + req.table + " SET " + sets + " WHERE " + where;

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
    var where = sql.where(req, req.query);
    if (where) {
        where = " WHERE " + where;
    }

    if (!where && req.options.noscan) {
        logger.warn('sqlDelete:', req.table, 'noscan', req.query);
        return null;
    }

    req.text = `DELETE FROM ${req.table} ${where}`;

    if (req.options?.returning) {
        req.text += " RETURNING " + req.options.returning;
    }
}
