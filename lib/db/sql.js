/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const lib = require(__dirname + '/../lib');
const db = require(__dirname + '/../db');
const logger = require(__dirname + '/../logger');

// Translation map for similar operators from different database drivers, merge with the basic SQL mapping
db.sqlConfigOptions = {
    sql: true,
    schema: [],
    noObjectTypes: 1,
    noListOps: 1,
    noListTypes: 1,
    noCustomColumns: 1,
    initCounters: 1,
    sqlPlaceholder: "$",
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
};

/**
 * Execute a SQL statements
 * @memberof module:db
 * @method sqlQuery
 */
db.sqlQuery = function(pool, client, req, options, callback)
{
    logger.debug("sqlQuery:", pool.name, req.table, req.text, req.values);
    if (typeof req.text == "string" && req.text.length) {
        client.query(req.text, req.values, options, callback);
    } else
    if (lib.isArray(req.text)) {
        lib.forEachSeries(req.text, (text, next) => {
            client.query(text, null, options, next);
        }, callback, true);
    } else {
        callback(null, []);
    }
}

/**
 * Cache columns using the information_schema
 * @memberof module:db
 * @method sqlCacheColumns
 */
db.sqlCacheColumns = function(pool, options, callback)
{
    pool.acquire((err, client) => {
        if (err) return lib.tryCall(callback, err, []);

        // Use current database name for schema if not specified
        if (!pool.configOptions.schema.length) pool.configOptions.schema.push(client.name);

        client.query("SELECT c.table_name,c.column_name,LOWER(c.data_type) AS data_type,c.column_default,c.ordinal_position,c.is_nullable " +
                     "FROM information_schema.columns c,information_schema.tables t " +
                     "WHERE c.table_schema IN (" + db.sqlValueIn(pool.configOptions.schema) + ") AND c.table_name=t.table_name " +
                     (lib.isArray(options.tables) ? `AND t.table_name IN (${db.sqlValueIn(options.tables)})` : "") +
                     "ORDER BY 5", (err, rows) => {
            this.dbcolumns = {};
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
 * @memberof module:db
 * @method sqlPrepare
 */
db.sqlPrepare = function(pool, req)
{
    switch (req.op) {
    case "list":
    case "select":
    case "search":
        this.sqlSelect(pool, req);
        break;
    case "create":
        this.sqlCreate(pool, req);
        break;
    case "upgrade":
        this.sqlUpgrade(pool, req);
        break;
    case "drop":
        this.sqlDrop(pool, req);
        break;
    case "get":
        this.sqlGet(pool, req);
        break;
    case "add":
        this.sqlInsert(pool, req);
        break;
    case "put":
        this.sqlInsert(pool, req);
        break;
    case "incr":
        this.sqlUpdate(pool, req);
        break;
    case "update":
        this.sqlUpdate(pool, req);
        break;
    case "del":
        this.sqlDelete(pool, req);
        break;
    }
    return req;
}

/**
 * Quote value to be used in SQL expressions
 * @memberof module:db
 * @method sqlQuote
 */
db.sqlQuote = function(val)
{
    return val === null || val === undefined ? "NULL" :
           `'${(typeof val == "string" ? val : String(val)).replace(/'/g,"''")}'`;
}

/**
 * Return properly quoted column name if it is a keyword
 * @memberof module:db
 * @method sqlColumn
 */
db.sqlColumn = function(name, pool)
{
    return pool.configOptions.keywords.includes(name.toUpperCase()) ? '"' + name + '"' : name;
}

/**
 * Return properly quoted value to be used directly in SQL expressions, format according to the type
 * @memberof module:db
 * @method sqlValue
 */
db.sqlValue = function(value, options)
{
    if (value == "null") return "NULL";
    switch ((typeof options == "string" && options) || (options && options.type) || lib.typeName(value)) {
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
        return this.sqlQuote(lib.toDate(value).toISOString());

    case "time":
    case "timestamp":
        return this.sqlQuote(lib.toDate(value).toLocaleTimeString());

    default:
        return this.sqlQuote(value);
    }
}

/**
 * Return list in format to be used with SQL IN ()
 * @memberof module:db
 * @method sqlValueIn
 */
db.sqlValueIn = function(list, type)
{
    if (!Array.isArray(list)) {
        if (!list) return '';
        list = [list];
    }
    if (!list.length) return '';
    return list.map((x) => (db.sqlValue(x, type))).join(",");
}

/**
 * Build SQL expressions for the column and value
 * options may contain the following properties:
 *  - op - SQL operator, default is =
 *  - type - can be data, string, number, float, expr, default is string
 *  - value - default value to use if passed value is null or empty
 *  - min, max - are used for numeric values for validation of ranges
 *  - expr - for op=expr, contains sprintf-like formatted expression to be used as is with all '%s' substituted with actual value
 * @memberof module:db
 * @method sqlExpr
 */
db.sqlExpr = function(pool, name, value, options)
{
    if (!name || typeof value == "undefined") return "";
    var type = options.type || "string", list;
    var op = (options.op || "").toLowerCase();
    var sql = "";
    switch (op) {
    case "not_in":
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
        sql += db.sqlColumn(name, pool) + " " + op + " (" + db.sqlValueIn(list, type) + ")";
        break;

    case "between":
    case "not between":
    case "not_between":
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
            if (pool.configOptions.noBetween) {
                sql += this.sqlColumn(name, pool) + ">=" + this.sqlValue(list[0], options) + " AND " + name + "<=" + this.sqlValue(list[1], options);
            } else {
                sql += this.sqlColumn(name, pool) + " " + op + " " + this.sqlValue(list[0], type) + " AND " + this.sqlValue(list[1], options);
            }
        } else {
            sql += this.sqlColumn(name, pool) + "=" + this.sqlValue(value, options);
        }
        break;

    case "null":
    case "not null":
    case "not_null":
        sql += this.sqlColumn(name, pool) + " IS " + op;
        break;

    case '@@':
        switch (lib.typeName(value)) {
        case "string":
            sql += db.sqlColumn(name, pool) + op + " to_tsquery('" + (options.lang || "english") + "'," + db.sqlQuote(value) + ")";
            break;

        case "array":
            value = value.map(function(x) { return "plainto_tsquery('" + (options.lang || "english") + "'," + db.sqlQuote(x) + ")" }).join('||');
            sql += db.sqlColumn(name, pool) + op + " (" + value + ")";
            break;
        }
        break;

    case '~* any':
    case '!~* any':
        sql += db.sqlQuote(value) + " " + op + "(" + db.sqlColumn(name, pool) + ")";
        break;

    case 'contains':
    case 'not contains':
    case 'not_contains':
        value = '%' + value + '%';
        sql += db.sqlColumn(name, pool) + " LIKE " + db.sqlValue(value, options);
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
        sql += db.sqlColumn(name, pool) + " " + op + " " + db.sqlValue(value, options);
        break;

    case "iregexp":
    case "not iregexp":
        sql += "LOWER(" + db.sqlColumn(name, pool) + ") " + (op[0] == 'n' ? "NOT" : "") + " REGEXP " + db.sqlValue(value, options);
        break;

    case 'begins_with':
    case 'not_begins_with':
    case "not begins_with":
        if (op[0] == "n") sql += "NOT (";
        sql += db.sqlColumn(name, pool) + " > " + db.sqlQuote(value.substr(0, value.length-1) + String.fromCharCode(value.charCodeAt(value.length-1) - 1));
        sql += " AND " + db.sqlColumn(name, pool) + " < " + db.sqlQuote(value.substr(0, value.length-1) + String.fromCharCode(value.charCodeAt(value.length-1) + 1));
        if (op[0] == "n") sql += ")";
        break;

    case 'expr':
        if (options.expr) {
            var str = options.expr;
            if (value.indexOf('|') > -1) value = value.split('|');
            str = str.replace(/%s/g, db.sqlValue(value, options));
            str = str.replace(/%1/g, db.sqlValue(value[0], options));
            str = str.replace(/%2/g, db.sqlValue(value[1], options));
            sql += str;
        }
        break;

    default:
        sql += db.sqlColumn(name, pool) + "=" + db.sqlValue(value, options);
        break;
    }
    return sql;
}

/**
 * Return time formatted for SQL usage as ISO, if no date specified returns current time
 * @memberof module:db
 * @method sqlTime
 */
db.sqlTime = function(d)
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
 * @memberof module:db
 * @method sqlLimit
 */
db.sqlLimit = function(pool, req)
{
    var rc = "";

    // Sorting column, multiple nested sort orders
    var orderby = "";
    ["", "1", "2"].forEach(function(x) {
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
        if (req.options.sortKeys || pool.configOptions.sortKeys) {
            orderby = this.getKeys(req.table, req.options).join(",");
        }
    }
    if (orderby) rc += " ORDER BY " + orderby;

    // Limit clause
    var page = lib.toNumber(req.options.page, { float: false, dflt: 0, min: 0 });
    var count = lib.toNumber(req.options.count, { float: false, dflt: 50, min: 0 });
    var start = lib.toNumber(req.options.start, { float: false, dflt: 0, min: 0 });
    if (count) {
        rc += " LIMIT " + count;
    }
    if (start) {
        rc += " OFFSET " + start;
    } else
    if (page && count) {
        rc += " OFFSET " + ((page - 1) * count);
    }
    return rc;
}

/**
 * Build SQL where condition from the keys and object values, returns SQL statement to be used in WHERE
 * - query - properties for the condition, in case of an array the primary keys for IN condition will be used only,
 *    a property named or$ or and$ will be treated as a sub-expression if it is an object. Add a number if need multiple OR/AND conditions like
 *    or$$, or$$,...
 * - options may contains the following properties:
 *     - pool - pool to be used for driver specific functions
 *     - ops - an object for comparison operators for primary key, default is equal operator
 *     - aliases - an object with column aliases, for cases when more than one time the same column mut be used
 * - join - how to join all expressions, default is AND
 * @memberof module:db
 * @method sqlWhere
 */
db.sqlWhere = function(pool, req, query, join)
{
    // List of records to return by primary key, when only one primary key property is provided use IN operator otherwise combine all conditions with OR
    if (Array.isArray(query)) {
        if (!query.length) return "";
        var keys = this.getKeys(req.table, req.options);
        var props = Object.keys(query[0]);
        if (props.length == 1 && keys.indexOf(props[0]) > -1) {
            return db.sqlColumn(props[0], pool) + " IN (" + db.sqlValueIn(query.map((x) => (x[props[0]]))) + ")";
        }
        return query.map((x) => ("(" + keys.map((y) => (db.sqlColumn(y, pool) + "=" + db.sqlQuote(pool.bindValue(req, y, x[y])))).join(" AND ") + ")")).join(" OR ");
    }

    // Regular object with conditions
    var where = [];
    for (const p in query) {
        if (p[0] == "_") continue;
        const val = query[p];
        if (!val && val !== null) continue;
        const d = p.match(db.rxOrAnd);
        if (d) {
            const e = this.sqlWhere(pool, req, val, d[1]);
            if (e) where.push("(" + e + ")");
            continue;
        }
        const col = db.prepareColumn(pool, req, p, val);
        if (keys && !keys.includes(col.name)) continue;
        const sql = this.sqlExpr(pool, col.name, col.value, col);
        if (sql) where.push(sql);
    }
    return where.join(" " + (join || "AND") + " ");
}

/**
 * Create SQL table using table definition
 * @param {object} pool - database pool
 * @param {DBRequest} req - request object
 * @memberof module:db
 * @method sqlCreate
 */
db.sqlCreate = function(pool, req)
{
    function keys(name) {
        var cols = Object.keys(req.obj).filter((x) => (req.obj[x][name])).sort((a,b) => (req.obj[a] - req.obj[b]));
        if (name == "index" && pool.configOptions.noCompositeIndex) return db.sqlColumn(cols.pop(), pool);
        return cols.map((x) => (db.sqlColumn(x, pool))).join(',');
    }
    var typesMap = pool.configOptions.typesMap || {}, rc;
    if (req.op == "create") {
        const pk = keys('primary');
        rc = [`CREATE TABLE ${!pool.configOptions.noIfExists ? "IF NOT EXISTS" : ""} ${req.table} (` +
                Object.keys(req.obj).
                filter((x) => (!req.obj[x].hidden)).
                map((x) => {
                    var col = req.obj[x], fk = col.foreign_key, custom = col.custom || lib.empty;

                    return db.sqlColumn(x, pool) + " " +
                        (typesMap[col.type] || pool.configOptions.defaultType || "text") +
                        (!pool.configOptions.noLengths && col.len ? " (" + col.len + ") " : " ") +
                        (!pool.configOptions.noNulls && (col.not_null || col.not_empty) ? " NOT NULL " : " ") +
                        (!pool.configOptions.noAuto && col.auto ? " AUTO_INCREMENT " : " ") +
                        (!pool.configOptions.noDefaults && col.value != undefined ? "DEFAULT " + db.sqlValue(col.value, col) : "") +
                        `${custom[pool.type] || ""} ${custom.sql || ""} ` +
                        (fk?.table ? `REFERENCES ${fk.table}(${fk.name || x}) ${fk.ondelete ? "ON DELETE " + fk.ondelete : ""} ${fk.custom || ""}`: "")
                }).join(",") + " " +
                (pk ? `,PRIMARY KEY(${pk})` : "") + " " +
                (pool.configOptions.tableOptions || "") + ")" ];

    } else {
        const dbcols = pool.dbcolumns[req.table] || lib.empty;
        rc = Object.keys(req.obj).
             filter((x) => (!(x in dbcols || x.toLowerCase() in dbcols) && !req.obj[x].hidden)).
             map((x) => {
                var col = req.obj[x], fk = col.foreign_key, custom = col.custom || lib.empty;

                return `ALTER TABLE ${req.table} ADD ${db.sqlColumn(x, pool)} ` +
                    (typesMap[col.type] || pool.configOptions.defaultType || "text") +
                    (!pool.configOptions.noLengths && col.len ? " (" + col.len + ") " : " ") +
                    (!pool.configOptions.noDefaults && col.value != undefined ? "DEFAULT " + db.sqlValue(col.value, col) : "") +
                    `${custom[pool.type] || ""} ${custom.sql || ""} ` +
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
            if (pool.dbindexes[idx] || pool.dbindexes[idx.toLowerCase()]) return;
            rc.push(`CREATE ${type[0] == "u" && "UNIQUE" || ""} INDEX ${!pool.configOptions.noIfExists ? "IF NOT EXISTS" : ""} ${idx} ON ${req.table}(${cols})`);
        });
    }
    req.text = pool.configOptions.noMultiSQL && rc.length ? rc : rc.join(";");
}

/**
 * Create ALTER TABLE ADD COLUMN statements for missing columns
 * @memberof module:db
 * @method sqlUpgrade
 */
db.sqlUpgrade = function(pool, req)
{
    this.sqlCreate(pool, req);
}

/**
 * Create SQL DROP TABLE statement
 * @memberof module:db
 * @method sqlDrop
 */
db.sqlDrop = function(pool, req)
{
    req.text = "DROP TABLE IF EXISTS " + req.table;
}

/**
 * Get one object from the database,
 * options may define the following properties:
 *  - select is list of columns or expressions to return
 * @memberof module:db
 * @method sqlGet
 */
db.sqlGet = function(pool, req)
{
    var select = lib.strSplit(req.options.select).map((x) => (db.sqlColumn(x, pool))).join(",");
    var where = this.sqlWhere(pool, req, req.obj);
    if (where) req.text = `SELECT ${select || "*"} FROM ${req.table} WHERE ${where} LIMIT 1`;
}

/**
 * Select object from the database,
 * options may define the following properties:
 * @param {string[]} [req.options.select] - is list of columns or expressions to return
 * @memberof module:db
 * @method sqlSelect
 */
db.sqlSelect = function(pool, req)
{
    var select = lib.strSplit(req.options.select).map((x) => (db.sqlColumn(x, pool))).join(",");
    var where = this.sqlWhere(pool, req, req.obj);
    if (where) where = " WHERE " + where;

    // No full scans allowed
    if (!where && req.options.noscan) return;
    req.text = `SELECT ${select || "*"} FROM ${req.table} ${where} ${this.sqlLimit(pool, req)}`;
}

/**
 * Build SQL insert statement
 * @memberof module:db
 * @method sqlInsert
 */
db.sqlInsert = function(pool, req)
{
    var names = [], pnums = [], i = 1;
    // Columns should exist prior to calling this
    var keys = this.getSearchKeys(req.table, req.options);
    req.values = [];

    for (const p in req.obj) {
        names.push(p);
        pnums.push(pool.configOptions.sqlPlaceholder + i);
        req.values.push(pool.bindValue(req, p, req.obj[p]));
        i++;
    }
    // No columns to insert, just exit, it is not an error, return empty result
    if (!names.length) {
        logger.debug('sqlInsert:', req.table, 'nothing to do', req.obj, req.columns);
        return null;
    }
    names = names.map((x) => (db.sqlColumn(x, pool)));
    var op = req.op == "put" && !pool.configOptions.noReplace ? "REPLACE" :
             req.op == "put" && pool.configOptions.upsert ? "UPSERT" : "INSERT";

    req.text = `${op} INTO ${req.table}(${names}) VALUES(${pnums})`;

    if (req.op == "put" && !pool.configOptions.upsert && pool.configOptions.onConflictUpdate) {
        req.text += ` ON CONFLICT (${keys.map((x) => (db.sqlColumn(x, pool)))}) DO UPDATE SET (${names}) = (${pnums})`;
    }
    if (req.options.donothing) req.text += ` ON CONFLICT (${keys.map((x) => (db.sqlColumn(x, pool)))}) DO NOTHING`;
    if (req.options.returning) req.text += " RETURNING " + req.options.returning;
    if (req.options.ifnotexists) req.text += " IF NOT EXISTS ";
    if (req.options.using_ttl) req.text += " USING TTL " + req.options.using_ttl;
    if (req.options.using_timestamp) req.text += " USING TIMESTAMP " + req.options.using_timestamp;
}

/**
 * Build SQL statement for update
 * @memberof module:db
 * @method sqlUpgrade
 */
db.sqlUpdate = function(pool, req)
{
    var sets = [], i = 1;
    var updateOps = req.options?.updateOps || lib.empty;
    req.values = [];

    for (let p in req.obj) {
        const v = req.obj[p];
        const col = req.column(p);
        // Do not update primary columns
        if (col.primary) continue;
        const placeholder = pool.configOptions.sqlPlaceholder + i;
        p = this.sqlColumn(p, pool);
        sets.push(pool.updateOps(req, updateOps[p], p, v, placeholder));
        req.values.push(pool.bindValue(req, p, v, updateOps[p]));
        i++;
    }
    var where = db.sqlWhere(pool, req, req.obj);
    // Additional condition that is supplied separatly to support different noSQL databases that can operate by the primary keys mostly
    if (lib.isObject(req.options.expected) && !pool.configOptions.ifExpected) {
        const expected = db.sqlWhere(pool, req, req.options.expected, Object.keys(req.options.expected), req.options.expectedJoin);
        if (expected) where += (where ? " AND " : "") + expected;
    }
    if (!sets.length || !where) {
        // No keys or columns to update, just exit, it is not an error, return empty result
        logger.debug('sqlUpdate:', req.table, 'nothing to do', req.obj);
        return null;
    }
    req.text = "UPDATE " + req.table ;
    if (req.options.using_ttl) req.text += " USING TTL " + req.options.using_ttl;
    if (req.options.using_timestamp) req.text += " USING TIMESTAMP " + req.options.using_timestamp;

    req.text += " SET " + sets.join(",") + " WHERE " + where;

    if (!pool.configOptions.noReturning && req.options.returning) {
        req.text += " RETURNING " + req.options.returning;
    }
    if (pool.configOptions.ifExpected && lib.isObject(req.options.expected)) {
        const expected = Object.keys(req.options.expected).
                              filter((x) => (["string","number"].indexOf(lib.typeName(req.options.expected[x])) > -1)).
                              map((x) => (db.sqlColumn(x, pool) + "=" + db.sqlValue(req.options.expected[x]))).
                              join(" AND ");
        if (expected) req.text += " IF " + expected;
    }
}

/**
 * Build SQL statement for delete
 * @memberof module:db
 * @method sqlDelete
 */
db.sqlDelete = function(pool, req)
{
    var keys = this.getSearchKeys(req.table, req.options);

    var where = this.sqlWhere(pool, req, req.obj, keys);
    if (!where) {
        // No keys or columns to update, just exit, it is not an error, return empty result
        logger.debug('sqlDelete:', req.table, 'nothing to do', req.obj, keys);
        return null;
    }
    req.text = `DELETE FROM ${req.table} WHERE ${where}`;
    if (req.options?.returning) req.text += " RETURNING " + req.options.returning;
}
