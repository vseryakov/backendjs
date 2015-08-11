//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var util = require('util');
var url = require('url');
var net = require('net');
var fs = require('fs');
var path = require('path');
var domain = require('domain');
var cluster = require('cluster');
var os = require('os');
var core = require(__dirname + '/../core');
var lib = require(__dirname + '/../lib');
var db = require(__dirname + '/../db');
var logger = require(__dirname + '/../logger');
var utils = require(__dirname + '/../build/Release/backend');

// Create a database pool for SQL like databases
// - options - an object defining the pool, the following properties define the pool:
//    - pool - pool name/type, if not specified the SQLite is used
//    - max - max number of clients to be allocated in the pool
//    - idle - after how many milliseconds an idle client will be destroyed
db.sqlInitPool = function(options)
{
    var self = this;
    if (!options) options = {};
    if (!options.pool) options.pool = "sqlite";

    // SQL databases cannot support unlimited connections, keep reasonable default to keep it from overloading
    if (!lib.isPositive(options.max)) options.max = 25;
    // Translation map for similar operators from different database drivers, merge with the basic SQL mapping
    var settings = {
        sql: true,
        schema: [],
        noAppend: 1,
        typesMap: { uuid: 'text', counter: "int", bigint: "int", smallint: "int" },
        opsMap: { begins_with: 'like%', ne: "<>", eq: '=', le: '<=', lt: '<', ge: '>=', gt: '>' }
    };
    options.settings = lib.mergeObj(settings, options.settings);
    var pool = this.createPool(options);

    // Execute initial statements to setup the environment, like pragmas
    pool.setup = function(client, callback) {
        if (!Array.isArray(options.init)) return callback(null, client);
        lib.forEachSeries(options.init, function(sql, next) {
            client.query(sql, next);
        }, function(err) {
            if (err) logger.error('pool.setup:', err);
            callback(err, client);
        });
    }
    // Call column caching callback with our pool name
    pool.cacheColumns = function(opts, callback) {
        self.sqlCacheColumns(opts, callback);
    }
    // Prepare for execution, return an object with formatted or transformed SQL query for the database driver of this pool
    pool.prepare = function(op, table, obj, opts) {
        return self.sqlPrepare(op, table, obj, opts);
    }
    // Execute a query or if req.text is an Array then run all queries in sequence
    pool.query = function(client, req, opts, callback) {
        return self.sqlQuery(client, req,opts, callback);
    }
    // Support for pagination, for SQL this is the OFFSET for the next request
    pool.nextToken = function(client, req, rows, opts) {
        return opts.count && rows.length == opts.count ? lib.toNumber(opts.start) + lib.toNumber(opts.count) : null;
    }
    pool.updateAll = function(table, query, obj, options, callback) {
        var req = self.prepare("update", table, query, obj, lib.extendObj(options, "keys", Object.keys(obj)));
        self.query(req, options, callback);
    }
    pool.delAll = function(table, query, options, callback) {
        var req = self.prepare("del", table, query, lib.extendObj(options, "keys", Object.keys(query)));
        self.query(req, options, callback);
    }

    return pool;
}

// Execute one or more SQL statements
db.sqlQuery = function(client, req, opts, callback)
{
    if (typeof req.text == "string" && req.text.length) {
        client.query(req.text, req.values || [], opts, callback);
    } else
    if (Array.isArray(req.text) && req.text.length) {
        var rows = [];
        lib.forEachSeries(req.text, function(text, next) {
            client.query(text, null, opts, function(err, rc) { if (rc) rows = rc; next(err); });
        }, function(err) {
            callback(err, rows);
        });
    } else {
        callback(null, []);
    }
}

// Cache columns using the information_schema
db.sqlCacheColumns = function(options, callback)
{
    var self = this;

    var pool = this.getPool('', options);
    pool.acquire(function(err, client) {
        if (err) return callback(err, []);

        // Use current database name for schema if not specified
        if (!pool.settings.schema.length) pool.settings.schema.push(client.name);
        client.query("SELECT c.table_name,c.column_name,LOWER(c.data_type) AS data_type,c.column_default,c.ordinal_position,c.is_nullable " +
                     "FROM information_schema.columns c,information_schema.tables t " +
                     "WHERE c.table_schema IN (" + self.sqlValueIn(pool.settings.schema) + ") AND c.table_name=t.table_name " +
                     "ORDER BY 5", function(err, rows) {
            pool.dbcolumns = {};
            for (var i = 0; i < rows.length; i++) {
                var table = rows[i].table_name.toLowerCase()
                if (!pool.dbcolumns[table]) pool.dbcolumns[table] = {};
                // Split type cast and ignore some functions in default value expressions
                var isserial = false, val = rows[i].column_default ? String(rows[i].column_default).replace(/'/g,"").split("::")[0] : null;
                if (val && val.indexOf("nextval") == 0) val = null, isserial = true;
                if (val && val.indexOf("ARRAY") == 0) val = val.replace("ARRAY", "").replace("[", "{").replace("]", "}");
                var db_type = "";
                switch (rows[i].data_type) {
                case "array":
                case "json":
                    db_type = rows[i].data_type;
                    break;

                case "numeric":
                case "bigint":
                case "real":
                case "integer":
                case "smallint":
                case "double precision":
                    db_type = "number";
                    break;

                case "boolean":
                    db_type = "bool";
                    break;

                case "date":
                case "time":
                case "timestamp with time zone":
                case "timestamp without time zone":
                    db_type = "date";
                    break;
                }
                pool.dbcolumns[table][rows[i].column_name.toLowerCase()] = { id: rows[i].ordinal_position, value: val, db_type: db_type, data_type: rows[i].data_type, isnull: rows[i].is_nullable == "YES", isserial: isserial };
            }
            pool.release(client);
            callback(err);
        });
    });
}

// Prepare SQL statement for the given operation
db.sqlPrepare = function(op, table, obj, options)
{
    var self = this;
    var pool = this.getPool(table, options);
    var req = null;
    switch (op) {
    case "list":
    case "select":
    case "search":
        req = this.sqlSelect(table, obj, options);
        break;
    case "create":
        req = this.sqlCreate(table, obj, options);
        break;
    case "upgrade":
        req = this.sqlUpgrade(table, obj, options);
        break;
    case "drop":
        req = this.sqlDrop(table, obj, options);
        break;
    case "get":
        req = this.sqlSelect(table, obj, lib.extendObj(options, "count", 1, "keys", this.getKeys(table, options)));
        break;
    case "add":
        req = this.sqlInsert(table, obj, options);
        break;
    case "put":
        req = this.sqlInsert(table, obj, lib.extendObj(options, "replace", !options.noReplace));
        break;
    case "incr":
        req = this.sqlUpdate(table, obj, options);
        break;
    case "update":
        req = this.sqlUpdate(table, obj, options);
        break;
    case "del":
        req = this.sqlDelete(table, obj, options);
        break;
    }
    // Pass original object for custom processing or callbacks
    if (!req) req = {};
    req.table = table.toLowerCase();
    req.obj = obj;
    req.op = op;
    return req;
}

// Quote value to be used in SQL expressions
db.sqlQuote = function(val)
{
    return val == null || typeof val == "undefined" ? "NULL" : ("'" + String(val).replace(/'/g,"''") + "'");
}

// Return properly quoted value to be used directly in SQL expressions, format according to the type
db.sqlValue = function(value, options)
{
    var self = this;
    if (value == "null") return "NULL";
    switch (((options && options.type) || lib.typeName(value))) {
    case "expr":
    case "buffer":
        return value;

    case "real":
    case "float":
    case "double":
        return lib.toNumber(value, options);

    case "int":
    case "bigint":
    case "smallint":
    case "integer":
    case "number":
    case "counter":
        return lib.toNumber(value, options);

    case "bool":
    case "boolean":
        return lib.toBool(value);

    case "date":
        return this.sqlQuote((new Date(value)).toISOString());

    case "time":
        return this.sqlQuote((new Date(value)).toLocaleTimeString());

    case "mtime":
        return /^[0-9\.]+$/.test(value) ? this.toNumber(value, options) : this.sqlQuote((new Date(value)).toISOString());

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
db.sqlExpr = function(name, value, options)
{
    var self = this;
    if (!name || typeof value == "undefined") return "";
    if (!options.type) options.type = "string";
    var sql = "";
    var op = (options.op || "").toLowerCase();
    switch (op) {
    case "not in":
    case "in":
        var list = [];
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
            if ((options.type == "number" || options.type == "int") && value.indexOf(',') > -1) {
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
        sql += name + " " + op + " (" + self.sqlValueIn(list, options.type) + ")";
        break;

    case "between":
    case "not between":
        // If we cannot parse out 2 values, treat this as exact operator
        var list = [];
        switch (lib.typeName(value)) {
        case "array":
            list = value;
            break;

        case "string":
            // For number array allow to be separated by comma as well, either one but not to be mixed
            if ((options.type == "number" || options.type == "int") && value.indexOf(',') > -1) {
                list = value.split(',');
                break;
            } else
            if (value.indexOf('|') > -1) {
                list = value.split('|');
                break;
            }
        }
        if (list.length > 1) {
            if (options.noBetween) {
                sql += name + ">=" + this.sqlValue(list[0], options) + " AND " + name + "<=" + this.sqlValue(list[1], options);
            } else {
                sql += name + " " + op + " " + this.sqlValue(list[0], options.type) + " AND " + this.sqlValue(list[1], options);
            }
        } else {
            sql += name + "=" + this.sqlValue(value, options);
        }
        break;

    case "null":
    case "not null":
        sql += name + " IS " + op;
        break;

    case '@@':
        switch (lib.typeName(value)) {
        case "string":
            sql += name + op + " to_tsquery('" + (options.lang || "english") + "'," + this.sqlQuote(value) + ")";
            break;

        case "array":
            value = value.map(function(x) { return "plainto_tsquery('" + (options.lang || "english") + "'," + self.sqlQuote(x) + ")" }).join('||');
            sql += name + op + " (" +  value + ")";
            break;
        }
        break;

    case '~* any':
    case '!~* any':
        sql += this.sqlQuote(value) + " " + op + "(" + name + ")";
        break;

    case 'contains':
    case 'not contains':
        value = '%' + value + '%';
        sql += name + " LIKE " + this.sqlValue(value, options);
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
        sql += name + " " + op + " " + this.sqlValue(value, options);
        break;

    case "iregexp":
    case "not iregexp":
        sql += "LOWER(" + name + ") " + (op[0] == 'n' ? "NOT" : "") + " REGEXP " + this.sqlValue(value, options);
        break;

    case 'begins_with':
        sql += name + " > " + this.sqlQuote(value.substr(0, value.length-1) + String.fromCharCode(value.charCodeAt(value.length-1) - 1));
        sql += " AND " + name + " < " + this.sqlQuote(value.substr(0, value.length-1) + String.fromCharCode(value.charCodeAt(value.length-1) + 1));
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
        sql += name + "=" + this.sqlValue(value, options);
        break;
    }
    return sql;
}

// Return time formatted for SQL usage as ISO, if no date specified returns current time
db.sqlTime = function(d)
{
    if (d) {
       try { d = (new Date(d)).toISOString() } catch(ex) { d = '' }
    } else {
        d = (new Date()).toISOString();
    }
    return d;
}

// Build SQL orderby/limit/offset conditions, config can define defaults for sorting and paging
db.sqlLimit = function(options)
{
    var self = this;
    if (!options) options = {};
    var rc = "";

    // Sorting column, multiple nested sort orders
    var orderby = "";
    ["", "1", "2"].forEach(function(x) {
        var sort = options['sort' + x];
        if (!sort) return;
        var desc = lib.toBool(options['desc' + x]);
        orderby += (orderby ? "," : "") + sort + (desc ? " DESC" : "");
    });
    if (orderby) rc += " ORDER BY " + orderby;

    // Limit clause
    var page = lib.toNumber(options.page, { float: false, dflt: 0, min: 0 });
    var count = lib.toNumber(options.count, { float: false, dflt: 50, min: 0 });
    var start = lib.toNumber(options.start, { float: false, dflt: 0, min: 0 });
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
// - query - properties for the condition, in case of an array the primary keys for IN condition will be used only
// - keys - a list of columns to use for the condition, other properties will be ignored
// - options may contains the following properties:
//     - pool - pool to be used for driver specific functions
//     - ops - object for comparison operators for primary key, default is equal operator
//     - opsMap - operator mapping into supported by the database
//     - typesMap - type mapping for properties to be used in the condition
//     - join - how to join all expressions, default is AND
db.sqlWhere = function(table, query, keys, options)
{
    var self = this;
    if (!options) options = {};
    var cols = this.getColumns(table, options) || {};

    // List of records to return by primary key, when only one primary key property is provided use IN operator otherwise combine all conditions with OR
    if (Array.isArray(query)) {
        if (!query.length) return "";
        keys = this.getKeys(table, options);
        var props = Object.keys(query[0]);
        if (props.length == 1 && keys.indexOf(props[0]) > -1) {
            return props[0] + " IN (" + this.sqlValueIn(query.map(function(x) { return x[props[0]] })) + ")";
        }
        return query.map(function(x) { return "(" + keys.map(function(y) { return y + "=" + self.sqlQuote(self.getBindValue(table, options, x[y])) }).join(" AND ") + ")" }).join(" OR ");
    }
    // Regular object with conditions
    var where = [], c = {}, opts = {};
    (keys || []).forEach(function(k) {
        if (k[0] == "_") return;
        var col = cols[k] || c, v = query[k];
        opts.op = "";
        opts.type = col.type || "";
        if (!v && v != null) return;
        if (options.ops && options.ops[k]) opts.op = options.ops[k];
        if (!opts.op && v == null) opts.op = "null";
        if (!opts.op && Array.isArray(v)) opts.op = "in";
        if (options.opsMap && options.opsMap[opts.op]) opts.op = options.opsMap[opts.op];
        if (options.typesMap && options.typesMap[opts.type]) opts.type = options.typesMap[opts.type];
        var sql = self.sqlExpr(k, v, opts);
        if (sql) where.push(sql);
    });
    return where.join(" " + (options.join || "AND") + " ");
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
db.sqlCreate = function(table, obj, options)
{
    var self = this;
    if (!options) options = {};

    function keys(name) {
        var cols = Object.keys(obj).filter(function(x) { return obj[x][name]; }).sort(function(a,b) { return obj[a] - obj[b] });
        if (name == "index" && options.noCompositeIndex) return cols.pop();
        return cols.join(',');
    }
    var pool = this.getPool(table, options);
    var dbcols = pool.dbcolumns[table] || {};

    if (!options.upgrade) {

        var rc = ["CREATE TABLE " + (!options.noIfExists ? "IF NOT EXISTS " : " ") + table + "(" +
                  Object.keys(obj).
                      map(function(x) {
                          return x + " " +
                              (function(t) { return (options.typesMap || {})[t] || t })(obj[x].type || options.defaultType || "text") + (!options.noLengths && obj[x].len ? " (" + obj[x].len + ") " : " ") +
                              (!options.noNulls && obj[x].notnull ? " NOT NULL " : " ") +
                              (!options.noAuto && obj[x].auto ? " AUTO_INCREMENT " : " ") +
                              (!options.noDefaults && typeof obj[x].value != "undefined" ? "DEFAULT " + self.sqlValue(obj[x].value, obj[x].type) : "") }).join(",") + " " +
                      (function(x) { return x ? ",PRIMARY KEY(" + x + ")" : "" })(keys('primary')) + " " + (options.tableOptions || "") + ")" ];

    } else {

        rc = Object.keys(obj).filter(function(x) { return (!(x in dbcols) || dbcols[x].fake) }).
                map(function(x) {
                    return "ALTER TABLE " + table + " ADD " + x + " " +
                        (function(t) { return (options.typesMap || {})[t] || t })(obj[x].type || options.defaultType || "text") + (!options.noLengths && obj[x].len ? " (" + obj[x].len + ") " : " ") +
                        (!options.noDefaults && typeof obj[x].value != "undefined" ? "DEFAULT " + self.sqlValue(obj[x].value, obj[x].type) : "") }).
                filter(function(x) { return x });
    }

    ["","1","2","3","4"].forEach(function(y) {
        var cols = keys('index' + y);
        if (!cols) return;
        var idxname = table + "_" + cols.replace(",", "_") + "_idx";
        if (pool.dbindexes[idxname]) return;
        rc.push("CREATE INDEX " + (!options.noIfExists ? "IF NOT EXISTS " : " ") + idxname + " ON " + table + "(" + cols + ")");
    });

    return { text: options.noMultiSQL && rc.length ? rc : rc.join(";") };
}

// Create ALTER TABLE ADD COLUMN statements for missing columns
db.sqlUpgrade = function(table, obj, options)
{
    var self = this;
    return this.sqlCreate(table, obj, lib.cloneObj(options, "upgrade", 1));
}

// Create SQL DROP TABLE statement
db.sqlDrop = function(table, obj, options)
{
    var self = this;
    return { text: "DROP TABLE IF EXISTS " + table };
}

// Select object from the database,
// options may define the following properties:
//  - keys is a list of columns for the condition
//  - select is list of columns or expressions to return
db.sqlSelect = function(table, query, options)
{
    var self = this;
    if (!options) options = {};

    // Requested columns, support only existing
    var select = "*";
    if (options.total) {
        select = "COUNT(*) AS count";
    } else {
        select = this.getSelectedColumns(table, options);
        if (!select) select = "*";
    }

    // We dont use getSearchKeys here to avoid using primary keys only
    var keys = Array.isArray(options.keys) && options.keys.length ? options.keys : Object.keys(query);
    var where = this.sqlWhere(table, query, keys, options);
    if (where) where = " WHERE " + where;

    // No full scans allowed
    if (!where && options.noscan) return {};

    var req = { text: "SELECT " + select + " FROM " + table + where + this.sqlLimit(options) };
    return req;
}

// Build SQL insert statement
db.sqlInsert = function(table, obj, options)
{
    var self = this;
    if (!options) options = {};
    var names = [], pnums = [], req = { values: [] }, i = 1
    // Columns should exist prior to calling this
    var cols = this.getColumns(table, options);

    for (var p in obj) {
        var v = obj[p];
        var col = cols[p] || {};
        // Filter not allowed columns or only allowed columns
        if (this.skipColumn(p, v, options, cols)) continue;
        // Avoid int parse errors with empty strings
        if ((v === "null" || v === "") && ["number","json"].indexOf(col.db_type) > -1) v = null;
        // Pass number as number, some databases strict about this
        if (v && col.db_type == "number" && typeof v != "number") v = lib.toNumber(v);
        names.push(p);
        pnums.push(options.sqlPlaceholder || ("$" + i));
        v = this.getBindValue(table, options, v, col);
        req.values.push(v);
        i++;
    }
    // No columns to insert, just exit, it is not an error, return empty result
    if (!names.length) {
        logger.debug('sqlInsert:', table, 'nothing to do', obj, cols);
        return null;
    }
    req.text = (options.replace ? "REPLACE" : "INSERT") + " INTO " + table + "(" + names.join(",") + ") values(" + pnums.join(",") + ")";
    if (options.returning) req.text += " RETURNING " + options.returning;
    if (options.ifnotexists) req.text += " IF NOT EXISTS ";
    if (options.using_ttl) req.text += " USING TTL " + options.using_ttl;
    if (options.using_timestamp) req.text += " USING TIMESTAMP " + options.using_timestamp;
    return req;
}

// Build SQL statement for update
db.sqlUpdate = function(table, obj, options)
{
    var self = this;
    if (!options) options = {};
    var sets = [], req = { values: [] }, i = 1;
    var cols = this.getColumns(table, options) || {};
    var keys = this.getSearchKeys(table, options);

    for (p in obj) {
        var v = obj[p];
        var col = cols[p] || {};
        // Filter not allowed columns or only allowed columns
        if (keys.indexOf(p) > -1 || this.skipColumn(p, v, options, cols)) continue;
        // Do not update primary columns
        if (col.primary) continue;
        // Avoid int parse errors with empty strings
        if ((v === "null" || v === "") && ["number","json"].indexOf(col.db_type) > -1) v = null;
        // Pass number as number, some databases strict about this
        if (v && col.db_type == "number" && typeof v != "number") v = lib.toNumber(v);
        var placeholder = (options.sqlPlaceholder || ("$" + i));
        var op = options.updateOps && options.updateOps[p];
        // Update only if the value is null, otherwise skip
        if (op == "not_exists" && !options.noCoalesce) {
            sets.push(p + "=COALESCE(" + p + "," + placeholder + ")");
        } else
        // Concat to a string
        if (op == "concat" && !options.noConcat) {
            sets.push(p + "=CONCAT(" + p + "," + placeholder + ")");
        } else
        // Append to a list
        if (op == "append" && !options.noAppend) {
            sets.push(p + "=" + p + "+" + placeholder);
        } else
        // Increment a number
        if (op == "incr") {
            sets.push(p + "=" + (options.noCoalesce ? p : "COALESCE(" + p + ",0)") + "+" + placeholder);
        } else {
            sets.push(p + "=" + placeholder);
        }
        v = this.getBindValue(table, options, v, col);
        req.values.push(v);
        i++;
    }
    var where = this.sqlWhere(table, obj, keys, options);
    // Additional condition that is supplied separateltly to support different noSQL databases that can operate by the primary keys mostly
    if (lib.isObject(options.expected) && !options.ifExpected) {
        var expected = this.sqlWhere(table, options.expected, Object.keys(options.expected), options);
        if (expected) where += (where ? " AND " : "") + expected;
    }
    if (!sets.length || !where) {
        // No keys or columns to update, just exit, it is not an error, return empty result
        logger.debug('sqlUpdate:', table, 'nothing to do', obj, keys);
        return null;
    }
    req.text = "UPDATE " + table ;
    if (options.using_ttl) req.text += " USING TTL " + options.using_ttl;
    if (options.using_timestamp) req.text += " USING TIMESTAMP " + options.using_timestamp;
    req.text += " SET " + sets.join(",") + " WHERE " + where;
    if (options.returning) req.text += " RETURNING " + options.returning;
    if (lib.isObject(options.expected) && options.ifExpected) {
        var expected = Object.keys(options.expected).
                              filter(function(x) { return ["string","number"].indexOf(lib.typeName(options.expected[x])) > -1 }).
                              map(function(x) { return x + "=" + self.sqlValue(options.expected[x]) }).
                              join(" AND ");
        if (expected) req.text += " IF " + expected;
    }
    return req;
}

// Build SQL statement for delete
db.sqlDelete = function(table, obj, options)
{
    var self = this;
    if (!options) options = {};
    var keys = this.getSearchKeys(table, options);

    var where = this.sqlWhere(table, obj, keys, options);
    if (!where) {
        // No keys or columns to update, just exit, it is not an error, return empty result
        logger.debug('sqlDelete:', table, 'nothing to do', obj, keys);
        return null;
    }
    var req = { text: "DELETE FROM " + table + " WHERE " + where };
    if (options.returning) req.text += " RETURNING " + options.returning;
    return req;
}
