//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const lib = require(__dirname + '/../lib');
const db = require(__dirname + '/../db');
const logger = require(__dirname + '/../logger');

// Execute one or more SQL statements
db.sqlQuery = function(pool, client, req, options, callback)
{
    logger.debug("sqlQuery:", pool.name, req.table, req.text);
    if (typeof req.text == "string" && req.text.length) {
        client.query(req.text, req.values, options, callback);
    } else
    if (lib.isArray(req.text)) {
        var rows = [];
        lib.forEachSeries(req.text, function(text, next) {
            client.query(text, null, options, (err, rc) => {
                if (rc) rows = rc;
                next(err);
            });
        }, (err) => {
            callback(err, rows);
        }, true);
    } else {
        callback(null, []);
    }
}

// Cache columns using the information_schema
db.sqlCacheColumns = function(pool, options, callback)
{
    pool.acquire((err, client) => {
        if (err) return callback(err, []);

        // Use current database name for schema if not specified
        if (!pool.configOptions.schema.length) pool.configOptions.schema.push(client.name);

        client.query("SELECT c.table_name,c.column_name,LOWER(c.data_type) AS data_type,c.column_default,c.ordinal_position,c.is_nullable " +
                     "FROM information_schema.columns c,information_schema.tables t " +
                     "WHERE c.table_schema IN (" + self.sqlValueIn(pool.configOptions.schema) + ") AND c.table_name=t.table_name " +
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
            callback(err);
        });
    });
}

// Prepare SQL statement for the given operation
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

// Quote value to be used in SQL expressions
db.sqlQuote = function(val)
{
    return val == null || typeof val == "undefined" ? "NULL" : ("'" + String(val).replace(/'/g,"''") + "'");
}

db.sqlColumn = function(name, pool)
{
    return pool.configOptions.keywords.indexOf(name.toUpperCase()) > -1 ? '"' + name + '"' : name;
}

// Return properly quoted value to be used directly in SQL expressions, format according to the type
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

// Return list in format to be used with SQL IN ()
db.sqlValueIn = function(list, type)
{
    var self = this;
    if (!Array.isArray(list)) {
        if (!list) return '';
        list = [list];
    }
    if (!list.length) return '';
    return list.map(function(x) { return self.sqlValue(x, type);}).join(",");
}

// Build SQL expressions for the column and value
// options may contain the following properties:
//  - op - SQL operator, default is =
//  - type - can be data, string, number, float, expr, default is string
//  - value - default value to use if passed value is null or empty
//  - min, max - are used for numeric values for validation of ranges
//  - expr - for op=expr, contains sprintf-like formatted expression to be used as is with all '%s' substituted with actual value
db.sqlExpr = function(pool, name, value, options)
{
    var self = this;
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
            for (var p in value) list.push(value[p]);
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
        sql += this.sqlColumn(name, pool) + " " + op + " (" + self.sqlValueIn(list, type) + ")";
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
            sql += this.sqlColumn(name, pool) + op + " to_tsquery('" + (options.lang || "english") + "'," + this.sqlQuote(value) + ")";
            break;

        case "array":
            value = value.map(function(x) { return "plainto_tsquery('" + (options.lang || "english") + "'," + self.sqlQuote(x) + ")" }).join('||');
            sql += this.sqlColumn(name, pool) + op + " (" + value + ")";
            break;
        }
        break;

    case '~* any':
    case '!~* any':
        sql += this.sqlQuote(value) + " " + op + "(" + this.sqlColumn(name, pool) + ")";
        break;

    case 'contains':
    case 'not contains':
    case 'not_contains':
        value = '%' + value + '%';
        sql += this.sqlColumn(name, pool) + " LIKE " + this.sqlValue(value, options);
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
        sql += this.sqlColumn(name, pool) + " " + op + " " + this.sqlValue(value, options);
        break;

    case "iregexp":
    case "not iregexp":
        sql += "LOWER(" + this.sqlColumn(name, pool) + ") " + (op[0] == 'n' ? "NOT" : "") + " REGEXP " + this.sqlValue(value, options);
        break;

    case 'begins_with':
    case 'not_begins_with':
    case "not begins_with":
        if (op[0] == "n") sql += "NOT (";
        sql += this.sqlColumn(name, pool) + " > " + this.sqlQuote(value.substr(0, value.length-1) + String.fromCharCode(value.charCodeAt(value.length-1) - 1));
        sql += " AND " + this.sqlColumn(name, pool) + " < " + this.sqlQuote(value.substr(0, value.length-1) + String.fromCharCode(value.charCodeAt(value.length-1) + 1));
        if (op[0] == "n") sql += ")";
        break;

    case 'expr':
        if (options.expr) {
            var str = options.expr;
            if (value.indexOf('|') > -1) value = value.split('|');
            str = str.replace(/%s/g, this.sqlValue(value, options));
            str = str.replace(/%1/g, this.sqlValue(value[0], options));
            str = str.replace(/%2/g, this.sqlValue(value[1], options));
            sql += str;
        }
        break;

    default:
        sql += this.sqlColumn(name, pool) + "=" + this.sqlValue(value, options);
        break;
    }
    return sql;
}

// Return time formatted for SQL usage as ISO, if no date specified returns current time
db.sqlTime = function(d)
{
    if (d) {
       try { d = (new Date(d)).toISOString() } catch (e) { d = '' }
    } else {
        d = (new Date()).toISOString();
    }
    return d;
}

// Build SQL orderby/limit/offset conditions, config can define defaults for sorting and paging
db.sqlLimit = function(pool, req)
{
    var rc = "";
    var opts = req.options || lib.empty;
    var cols = this.getColumns(req.table, req.options);

    // Sorting column, multiple nested sort orders
    var orderby = "";
    ["", "1", "2"].forEach(function(x) {
        var sort = opts['sort' + x];
        if (!sort) return;
        if (!cols[sort] && sort.match(/^[a-z_]+$/)) {
            sort = sort.split("_").filter(function(x) { return cols[x] });
        }
        if (!sort) return;
        var desc = lib.toBool(opts['desc' + x]);
        orderby += (orderby ? "," : "") + sort + (desc ? " DESC" : "");
    });
    // Simulate NoSQL behaviour by always sorting by the primary key
    if (!orderby) {
        if (opts.sortKeys || pool.configOptions.sortKeys) {
            orderby = this.getKeys(req.table, req.options).join(",");
        }
    }
    if (orderby) rc += " ORDER BY " + orderby;

    // Limit clause
    var page = lib.toNumber(opts.page, { float: false, dflt: 0, min: 0 });
    var count = lib.toNumber(opts.count, { float: false, dflt: 50, min: 0 });
    var start = lib.toNumber(opts.start, { float: false, dflt: 0, min: 0 });
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

// Build SQL where condition from the keys and object values, returns SQL statement to be used in WHERE
// - query - properties for the condition, in case of an array the primary keys for IN condition will be used only,
//    a property named $or or $and will be treated as a sub-expression if it is an object.
// - keys - a list of columns to use for the condition, other properties will be ignored
// - options may contains the following properties:
//     - pool - pool to be used for driver specific functions
//     - ops - an object for comparison operators for primary key, default is equal operator
//     - aliases - an object with column aliases, for cases when more than one time the same column mut be used
// - join - how to join all expressions, default is AND
db.sqlWhere = function(pool, req, query, keys, join)
{
    var self = this;
    var cols = this.getColumns(req.table, req.options);

    // List of records to return by primary key, when only one primary key property is provided use IN operator otherwise combine all conditions with OR
    if (Array.isArray(query)) {
        if (!query.length) return "";
        keys = this.getKeys(req.table, req.options);
        var props = Object.keys(query[0]);
        if (props.length == 1 && keys.indexOf(props[0]) > -1) {
            return self.sqlColumn(props[0], pool) + " IN (" + this.sqlValueIn(query.map(function(x) { return x[props[0]] })) + ")";
        }
        return query.map(function(x) { return "(" + keys.map(function(y) { return self.sqlColumn(y, pool) + "=" + self.sqlQuote(pool.bindValue(req, y, x[y])) }).join(" AND ") + ")" }).join(" OR ");
    }

    // Regular object with conditions
    var where = [], opts = {};
    var ops = req.options && req.options.ops || lib.empty;
    var aliases = req.options && req.options.aliases || lib.empty;
    var opsMap = pool.configOptions.opsMap || lib.empty;
    var typesMap = pool.configOptions.typesMap || lib.empty;
    for (var k in query) {
        if (k[0] == "_") continue;
        var v = query[k];
        if (!v && v !== null) continue;
        var d = k.match(/^\$(or|and)/);
        if (d) {
            v = this.sqlWhere(pool, req, v, keys, d[1]);
            if (v) where.push("(" + v + ")");
            continue;
        }
        opts.op = ops[k] || "";
        if (aliases[k]) k = aliases[k];
        if (keys && keys.indexOf(k) == -1) continue;
        // Operation for a column, explicit or in the column definition
        var col = cols[k] || lib.empty;
        opts.type = col.type || "";
        if (!opts.op && v === null) opts.op = "null";
        if (!opts.op && Array.isArray(v)) opts.op = "in";
        if (opsMap[opts.op]) opts.op = opsMap[opts.op];
        if (typesMap[opts.type]) opts.type = typesMap[opts.type];
        var sql = this.sqlExpr(pool, k, v, opts);
        if (sql) where.push(sql);
    }
    return where.join(" " + (join || "AND") + " ");
}

// Create SQL table using table definition
// - table - name of the table to create
// - obj - object with properties as column names and each property value is an object:
//      - name - column name
//      - type - type of the column, default is TEXT, options: int, real or other supported types
//      - value - default value for the column
//      - primary - part of the primary key
//      - index - indexed column, part of the composite index
//      - unique - must be combined with index property to specify unique composite index
//      - len - max length of the column
//      - notnull - true if should be NOT NULL
//      - auto - true for AUTO_INCREMENT column
//      - hidden - skip column completely
// - options may contains:
//      - upgrade - perform alter table instead of create
//      - typesMap - type mapping, convert lowercase type into other type supported by any specific database
//      - noDefaults - ignore default value if not supported (Cassandra)
//      - noNulls - NOT NULL restriction is not supported (Cassandra)
//      - noMultiSQL - return as a list, the driver does not support multiple SQL commands
//      - noLengths - ignore column length for columns (Cassandra)
//      - noIfExists - do not support IF EXISTS on table or indexes
//      - noCompositeIndex - does not support composite indexes (Cassandra)
//      - noAuto - no support for auto increment columns
//      - skipNull - object with operations which dont support null(empty) values (DynamoDB cannot add/put empty/null values)
db.sqlCreate = function(pool, req)
{
    var self = this;

    function keys(name) {
        var cols = Object.keys(req.obj).filter((x) => (req.obj[x][name])).sort((a,b) => (req.obj[a] - req.obj[b]));
        if (name == "index" && pool.configOptions.noCompositeIndex) return self.sqlColumn(cols.pop(), pool);
        return cols.map((x) => (self.sqlColumn(x, pool))).join(',');
    }
    var typesMap = pool.configOptions.typesMap || {}, rc;
    if (req.op == "create") {
        const pk = keys('primary');
        rc = [`CREATE TABLE ${!pool.configOptions.noIfExists ? "IF NOT EXISTS" : ""} ${req.table} (` +
                Object.keys(req.obj).
                filter((x) => (!req.obj[x].hidden)).
                map((x) => (
                    self.sqlColumn(x, pool) + " " +
                    (typesMap[req.obj[x].type] || req.obj[x].type || pool.configOptions.defaultType || "text") +
                    (!pool.configOptions.noLengths && req.obj[x].len ? " (" + req.obj[x].len + ") " : " ") +
                    (!pool.configOptions.noNulls && (req.obj[x].notnull || req.obj[x].notempty) ? " NOT NULL " : " ") +
                    (!pool.configOptions.noAuto && req.obj[x].auto ? " AUTO_INCREMENT " : " ") +
                    (!pool.configOptions.noDefaults && typeof req.obj[x].value != "undefined" ? "DEFAULT " + self.sqlValue(req.obj[x].value, req.obj[x]) : "")
                )).join(",") + " " +
                (pk ? `,PRIMARY KEY(${pk})` : "") + " " +
                (pool.configOptions.tableOptions || "") + ")" ];

    } else {
        const dbcols = pool.dbcolumns[req.table] || lib.empty;
        rc = Object.keys(req.obj).
             filter((x) => (!(x in dbcols) && !req.obj[x].hidden)).
             map((x) => (
                `ALTER TABLE ${req.table} ADD ${self.sqlColumn(x, pool)} ` +
                (typesMap[req.obj[x].type] || req.obj[x].type || pool.configOptions.defaultType || "text") +
                (!pool.configOptions.noLengths && req.obj[x].len ? " (" + req.obj[x].len + ") " : " ") +
                (!pool.configOptions.noDefaults && typeof req.obj[x].value != "undefined" ? "DEFAULT " + self.sqlValue(req.obj[x].value, req.obj[x]) : "")
             )).
             filter((x) => (x));
    }

    for (const type of ["index", "unique"]) {
        (new Array(pool.configOptions.maxIndexes)).fill(0, 0).forEach(function(_, n, t) {
            n = n || "";
            t = type + n;
            var cols = keys(t);
            if (!cols) return;
            var idx = req.table + "_" + cols.replace(",", "_").replace(/"/g, "") + "_idx";
            if (pool.dbindexes[idx]) return;
            rc.push(`CREATE ${type[0] == "u" && "UNIQUE" || ""} INDEX ${!pool.configOptions.noIfExists ? "IF NOT EXISTS" : ""} ${idx} ON ${req.table}(${cols})`);
        });
    }
    req.text = pool.configOptions.noMultiSQL && rc.length ? rc : rc.join(";");
}

// Create ALTER TABLE ADD COLUMN statements for missing columns
db.sqlUpgrade = function(pool, req)
{
    this.sqlCreate(pool, req);
}

// Create SQL DROP TABLE statement
db.sqlDrop = function(pool, req)
{
    req.text = "DROP TABLE IF EXISTS " + req.table;
}

// Get one object from the database,
// options may define the following properties:
//  - select is list of columns or expressions to return
db.sqlGet = function(pool, req)
{
    var self = this;
    // Requested columns, support only existing
    var select = this.getSelectedColumns(req.table, req.options);
    if (!select) select = "*"; else select = select.map(function(x) { return self.sqlColumn(x, pool) });

    var keys = this.getKeys(req.table, req.options);
    var where = this.sqlWhere(pool, req, req.obj, keys);
    if (where) req.text = "SELECT " + select + " FROM " + req.table + " WHERE " + where + " LIMIT 1";
}

// Select object from the database,
// options may define the following properties:
//  - keys is a list of columns for the condition
//  - select is list of columns or expressions to return
db.sqlSelect = function(pool, req)
{
    var self = this;
    // Requested columns, support only existing
    var select = "*";
    if (req.options && req.options.total) {
        select = "COUNT(*) AS count";
    } else {
        select = this.getSelectedColumns(req.table, req.options);
        if (!select) select = "*"; else select = select.map(function(x) { return self.sqlColumn(x, pool) });
    }

    // We dont use getSearchKeys here to avoid using primary keys only
    var keys = Array.isArray(req.options && req.options.keys) && req.options.keys.length ? req.options.keys : Object.keys(req.obj);
    var where = this.sqlWhere(pool, req, req.obj, keys);
    if (where) where = " WHERE " + where;

    // No full scans allowed
    if (!where && req.options && req.options.noscan) return;
    req.text = "SELECT " + select + " FROM " + req.table + where + this.sqlLimit(pool, req);
}

// Build SQL insert statement
db.sqlInsert = function(pool, req)
{
    var self = this;
    var names = [], pnums = [], i = 1;
    // Columns should exist prior to calling this
    var cols = this.getColumns(req.table, req.options);
    var keys = this.getSearchKeys(req.table, req.options);
    var dbcols = pool.dbcolumns[req.table] || lib.empty;
    req.values = [];

    for (const p in req.obj) {
        var v = req.obj[p];
        var col = cols[p] || req.allow && req.allow[p] || lib.empty;
        var data_type = col.data_type || (dbcols[p] && dbcols[p].data_type) || col.type;
        // Filter not allowed columns or only allowed columns
        if (!col && col.allow() && this.skipColumn(p, v, req.options, cols)) continue;
        // Avoid int parse errors with empty strings
        if ((v === "null" || v === "") && (data_type == "json" || lib.isNumericType(data_type))) v = null;
        // Pass number as number, some databases strict about this
        if (v && lib.isNumericType(data_type) && typeof v != "number") v = lib.toNumber(v);
        names.push(p);
        pnums.push(pool.configOptions.sqlPlaceholder || ("$" + i));
        v = pool.bindValue(req, p, v);
        req.values.push(v);
        i++;
    }
    // No columns to insert, just exit, it is not an error, return empty result
    if (!names.length) {
        logger.debug('sqlInsert:', req.table, 'nothing to do', req.obj, cols);
        return null;
    }
    names = names.map((x) => (self.sqlColumn(x, pool)));
    var op = req.op == "put" && !pool.configOptions.noReplace ? "REPLACE" :
             req.op == "put" && pool.configOptions.upsert ? "UPSERT" : "INSERT";

    req.text = `${op} INTO ${req.table}(${names}) VALUES(${pnums})`;

    if (req.options) {
        if (req.op == "put" && !pool.configOptions.upsert && pool.configOptions.onConflictUpdate) {
            req.text += ` ON CONFLICT (${keys.map((x) => (self.sqlColumn(x, pool)))}) DO UPDATE SET (${names}) = (${pnums})`;
        }
        if (req.options.donothing) req.text += ` ON CONFLICT (${keys.map((x) => (self.sqlColumn(x, pool)))}) DO NOTHING`;
        if (req.options.returning) req.text += " RETURNING " + req.options.returning;
        if (req.options.ifnotexists) req.text += " IF NOT EXISTS ";
        if (req.options.using_ttl) req.text += " USING TTL " + req.options.using_ttl;
        if (req.options.using_timestamp) req.text += " USING TIMESTAMP " + req.options.using_timestamp;
    }
}

// Build SQL statement for update
db.sqlUpdate = function(pool, req)
{
    var self = this;
    var sets = [], i = 1;
    var cols = this.getColumns(req.table, req.options);
    var keys = this.getSearchKeys(req.table, req.options);
    var dbcols = pool.dbcolumns[req.table] || lib.empty;
    req.values = [];

    for (let p in req.obj) {
        var v = req.obj[p];
        var col = cols[p] || req.allow && req.allow[p] || lib.empty;
        var data_type = col.data_type || (dbcols[p] && dbcols[p].data_type) || col.type;
        // Filter not allowed columns or only allowed columns
        if (keys.indexOf(p) > -1 || (!(col && col.allow) && this.skipColumn(p, v, req.options, cols))) continue;
        // Do not update primary columns
        if (col.primary) continue;
        // Avoid int parse errors with empty strings
        if ((v === "null" || v === "") && (data_type == "json" || lib.isNumericType(data_type))) v = null;
        // Pass number as a number, some databases strict about this
        if (v && lib.isNumericType(data_type) && typeof v != "number") v = lib.toNumber(v);
        var placeholder = pool.configOptions.sqlPlaceholder || ("$" + i);
        var op = req.options && req.options.updateOps && req.options.updateOps[p];
        p = this.sqlColumn(p, pool);
        // Update only if the value is null, otherwise skip
        switch (op) {
        case "not_exists":
            if (pool.configOptions.noCoalesce) break;
            sets.push(p + "=COALESCE(" + p + "," + placeholder + ")");
            break;
        case "concat":
            // Concat to a string
            if (pool.configOptions.noConcat) break;
            sets.push(p + "=CONCAT(" + p + "," + placeholder + ")");
            break;
        case "add":
        case "append":
            // Append to a list
            if (pool.configOptions.noAppend) break;
            sets.push(p + "=" + p + "+" + placeholder);
            break;
        case "del":
            // Delete from a list
            if (pool.configOptions.noAppend) break;
            sets.push(p + "=" + p + "-" + placeholder);
            break;
        case "incr":
            // Increment a number
            sets.push(p + "=" + (pool.configOptions.noCoalesce ? p : "COALESCE(" + p + ",0)") + "+" + placeholder);
            break;
        case "remove":
            sets.push(p + "=NULL");
            break;
        default:
            sets.push(p + "=" + placeholder);
        }
        v = pool.bindValue(req, p, v);
        req.values.push(v);
        i++;
    }
    var where = this.sqlWhere(pool, req, req.obj, keys);
    // Additional condition that is supplied separatly to support different noSQL databases that can operate by the primary keys mostly
    if (req.options && lib.isObject(req.options.expected) && !pool.configOptions.ifExpected) {
        const expected = this.sqlWhere(pool, req, req.options.expected, Object.keys(req.options.expected), req.options.expectedJoin);
        if (expected) where += (where ? " AND " : "") + expected;
    }
    if (!sets.length || !where) {
        // No keys or columns to update, just exit, it is not an error, return empty result
        logger.debug('sqlUpdate:', req.table, 'nothing to do', req.obj, keys);
        return null;
    }
    req.text = "UPDATE " + req.table ;
    if (req.options && req.options.using_ttl) req.text += " USING TTL " + req.options.using_ttl;
    if (req.options && req.options.using_timestamp) req.text += " USING TIMESTAMP " + req.options.using_timestamp;

    req.text += " SET " + sets.join(",") + " WHERE " + where;

    if (!pool.configOptions.noReturning && req.options && req.options.returning) {
        req.text += " RETURNING " + req.options.returning;
    }
    if (pool.configOptions.ifExpected && req.options && lib.isObject(req.options.expected)) {
        const expected = Object.keys(req.options.expected).
                              filter(function(x) { return ["string","number"].indexOf(lib.typeName(req.options.expected[x])) > -1 }).
                              map(function(x) { return self.sqlColumn(x, pool) + "=" + self.sqlValue(req.options.expected[x]) }).
                              join(" AND ");
        if (expected) req.text += " IF " + expected;
    }
}

// Build SQL statement for delete
db.sqlDelete = function(pool, req)
{
    var keys = this.getSearchKeys(req.table, req.options);

    var where = this.sqlWhere(pool, req, req.obj, keys);
    if (!where) {
        // No keys or columns to update, just exit, it is not an error, return empty result
        logger.debug('sqlDelete:', req.table, 'nothing to do', req.obj, keys);
        return null;
    }
    req.text = "DELETE FROM " + req.table + " WHERE " + where;
    if (req.options && req.options.returning) req.text += " RETURNING " + req.options.returning;
}
