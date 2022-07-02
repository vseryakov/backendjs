//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const util = require('util');
const db = require(__dirname + '/../db');
const logger = require(__dirname + '/../logger');
const lib = require(__dirname + '/../lib');
const core = require(__dirname + '/../core');
const metrics = require(__dirname + "/../metrics");

// Merge all tables from all modules
db.initTables = function()
{
    for (const p in core.modules) {
        if (p != this.name && lib.isObject(core.modules[p].tables)) this.describeTables(core.modules[p].tables);
    }
}

// Create or upgrade the tables for the given pool
db.createTables = function(options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (typeof options == "string") options = { pool: options };

    var pool = db.getPool('', options);
    var copts = lib.objClone(options, "pool", pool.name, "tables", []);
    logger.debug("createTables:", core.role, pool.name, pool.configOptions);

    lib.series([
        function(next) {
            if (db.noCacheColumns) return next();
            db.cacheColumns(copts, next);
        },
        function(next) {
            lib.forEachSeries(Object.keys(db.tables), function(table, next2) {
                // Skip tables not supposed to be in this pool
                if (pool != db.getPool(table, options)) return next2();
                if (lib.isArray(pool.configOptions.tables) && !lib.isFlag(pool.configOptions.tables, table)) return next2();
                // We if have columns, SQL table must be checked for missing columns and indexes
                var cols = pool.dbcolumns[table];
                logger.debug("createTables:", core.role, pool.name, cols ? "upgrade" : "create", table, db.tables[table]);
                if (!cols) {
                    db.create(table, db.tables[table], options, function(err, rows, info) {
                        if (!err && info.affected_rows) copts.tables.push(table);
                        next2();
                    });
                } else {
                    // Refreshing columns after an upgrade is only required by the driver which depends on
                    // the actual db schema, in any case all columns are merged so no need to re-read just the columns,
                    // the case can be to read new indexes used in searches, this is true for DynamoDB.
                    db.upgrade(table, db.tables[table], options, function(err, rows, info) {
                        if (!err && info.affected_rows) copts.tables.push(table);
                        next2();
                    });
                }
            }, next, true);
        },
        function(next) {
            logger.logger(copts.tables.length ? "info" : "debug", 'createTables:', core.role, pool.name, 'changed:', copts.tables);
            if (!copts.tables.length) return next();
            if (!db.noCacheColumns && pool.configOptions.cacheColumns) return db.cacheColumns(copts, next);
            next();
        },
    ], callback, true);
}

// Define new tables or extend/customize existing tables. Table definitions are used with every database operation,
// on startup, the backend read all existing table columns from the database and cache them in the memory but some properties
// like public columns are only specific to the backend so to mark such columns the table with such properties must be described
// using this method. Only columns with changed properties need to be specified, other columns will be left as it is.
//
// Example
//
//          db.describeTables({
//              bk_user: { name: { pub: 1 },
//                         test: { id: { primary: 1, type: "int" },
//                         name: { pub: 1, index: 1 }
//          }});
//
db.describeTables = function(tables, callback)
{
    for (var p in tables) {
        var table1 = this.tables[p];
        if (!table1) this.tables[p] = table1 = {};
        var table2 = tables[p];
        for (const c in table2) {
            if (!table1[c]) table1[c] = {};
            // Merge columns
            for (var k in table2[c]) {
                if (!lib.isObject(table2[c][k])) {
                    table1[c][k] = table2[c][k];
                } else {
                    if (!table1[c][k]) table1[c][k] = {};
                    for (var f in table2[c][k]) {
                        table1[c][k][f] = table2[c][k][f];
                    }
                }
            }
        }
        // Produce keys and indexes
        this.keys[p] = [];
        var indexes = {};
        for (const c in table1) {
            if (table1[c].primary) this.keys[p].push(c);
            ["","1","2","3","4","5"].forEach(function(n) {
                if (!table1[c]["index" + n]) return;
                if (!indexes[n]) indexes[n] = [];
                indexes[n].push(c);
            });
        }
        this.indexes[p] = {};
        this.keys[p].sort(function(a, b) { return table1[a].primary - table1[b].primary });
        for (const n in indexes) {
            indexes[n].sort(function(a, b) { return table1[a]["index" + n] - table1[b]["index" + n] });
            this.indexes[p][indexes[n].join("_")] = indexes[n];
        }
    }
    if (typeof callback == "function") callback();
}

// Convert native database error in some generic human readable string
db.convertError = function(pool, table, op, err, options)
{
    if (!err || !util.isError(err)) return err;
    if (typeof pool == "string") pool = this.pools[pool];
    err = pool.convertError(table, op, err, options);
    if (util.isError(err)) {
        switch (err.code) {
        case "AlreadyExists":
            return { message: lib.__("Record already exists"), status: 409, code: err.code };

        case "NotFound":
            return { message: lib.__("Record could not be found"), status: 404, code: err.code };
        }
    }
    return err;
}

// Refresh columns for all polls which need it
db.refreshColumns = function(options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    var pools = this.getPools();
    lib.forEachLimit(pools, pools.length, function(pool, next) {
        if (!db.pools[pool.name].configOptions.cacheColumns) return next();
        db.cacheColumns(pool.name, next);
    }, callback, true);
}

// Reload all columns into the cache for the pool, options can be a pool name or an object like `{ pool: name }`.
// if `tables` property is an arary it asks to refresh only specified tables if that is possible.
db.cacheColumns = function(options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (typeof options == "string") options = { pool: options };

    var pool = this.getPool('', options);
    pool.cacheColumns.call(pool, options, (err) => {
        if (err) logger.error('cacheColumns:', pool.name, lib.traceError(err));
        pool.cacheIndexes.call(pool, options, (err) => {
            if (err) logger.error('cacheIndexes:', pool.name, err);

            // Remove unknown tables
            if (db.noUnknownTables || pool.configOptions.noUnknownTables) {
                for (const p in pool.dbcolumns) {
                    if (!db.tables[p]) {
                        delete pool.dbcolumns[p];
                        delete pool.dbkeys[p];
                        delete pool.dbindexes[p];
                    }
                }
            }

            // Allow other modules to handle just cached columns for post processing
            for (const i in db.processColumns) {
                if (typeof db.processColumns[i] == "function") {
                    db.processColumns[i].call(pool, options);
                }
            }
            if (typeof callback == "function") callback(err);
        });
    });
}

// Returns true if a pool exists
db.existsPool = function(name)
{
    return !!this.pools[name];
}

// Returns true if a table exists
db.existsTable = function(table, options)
{
    table = this.getTable(table);
    return this.getPool(table, options).dbcolumns[table] ? true : false;
}

// Return a table name or an alias
db.getTable = function(table)
{
    return (this.aliases[table] || table || "").toLowerCase();
}

// Return columns for a table or null, columns is an object with column names and objects for definition.
db.getColumns = function(table, options)
{
    table = this.getTable(table);
    if (this.tables[table]) return this.tables[table];
    for (var p in this.matchTables) {
        if (this.matchTables[p].test(table)) return this.tables[p] || lib.empty;
    }
    return lib.empty;
}

// Return the column definition for a table, for non-existent columns it returns an empty object
db.getColumn = function(table, name, options)
{
    return this.getColumns(table, options)[(name || "").toLowerCase()] || lib.empty;
}

// Return an object with capacity property which is the max write capacity for the table, for DynamoDB only.
// By default it checks `writeCapacity` property of all table columns and picks the max.
//
// The options can specify the capacity explicitely:
// - useCapacity - what to use for capacity rating, can be `write`, `read` or a number with max capacity to use
// - factorCapacity - a number between 0 and 1 to multiple the rate capacity
// - rateCapacity - if set it will be used for rate capacity limit
// - maxCapacity - if set it will be used as the max burst capacity limit
// - minCapacity - if set it will be used as the minimum threshold
// - intervalCapacity - default is 1000 ms
// - sort - an index to use for capacity, for systems like DynamoDB which has different capacity for
//   global indexes, it makes sense for indexed reads or partial updates where only global index is affected and not the whole record
db.getCapacity = function(table, options)
{
    if (!options) options = lib.empty;
    table = this.getTable(table);
    var pool = this.getPool(table, options);
    var capacity = pool.dbcapacity[table] || lib.empty;
    capacity = capacity[options.sort] || capacity[table] || lib.empty;
    var cap = {
        table: table,
        unitCapacity: 1,
        readCapacity: capacity.read || pool.configOptions.maxReadCapacity || 0,
        writeCapacity: capacity.write || pool.configOptions.maxWriteCapacity || 0,
    };
    var use = options.useCapacity;
    var factor = options.factorCapacity > 0 && options.factorCapacity <= 1 ? options.factorCapacity : 1;
    cap.maxCapacity = Math.max(0, typeof use == "number" ? use : use == "read" ? cap.readCapacity : cap.writeCapacity, lib.toNumber(options.maxCapacity), lib.toNumber(options.minCapacity));
    cap.rateCapacity = Math.max(lib.toNumber(options.minCapacity), cap.maxCapacity*factor);
    // Override with direct numbers if given
    for (const p in options) {
        if (/Capacity$/.test(p) && options[p] > 0) cap[p] = options[p];
    }
    if (cap.rateCapacity > 0) cap._tokenBucket = new metrics.TokenBucket(cap.rateCapacity, cap.maxCapacity, options.intervalCapacity);
    return cap;
}

// Check if number of requests exceeds the capacity per second, delay if necessary, for DynamoDB only but can be used for pacing
// requests with any database or can be used generically. The `cap` must be initialized with `db.getCapacity` call.
db.checkCapacity = function(cap, consumed, callback)
{
    if (typeof consumed == "function") callback = consumed, consumed = 1;
    if (!cap || !cap._tokenBucket || typeof cap._tokenBucket.consume != "function") {
        callback();
        return 0;
    }
    if (cap._tokenBucket.consume(consumed)) {
        callback();
        return 0;
    }
    const delay = cap._tokenBucket.delay(consumed);
    setTimeout(callback, delay);
    logger.debug("checkCapacity:", consumed, delay, cap);
    return delay;
}

// Return list of selected or allowed only columns, empty list if no `options.select` is specified or it is equal to `*`. By default only allowed or existing
// columns will be returned, to pass the list as is to the driver just use `options.select_all` instead.
db.getSelectedColumns = function(table, options)
{
    if (options && options.select == "*") return null;
    if (options && options.select && options.select.length) {
        const cols = this.getColumns(table, options);
        const list = lib.strSplitUnique(options.select);
        const select = list.filter(function(x) {
            if (db.skipColumn(x, "", options, cols)) return 0;
            if (x.indexOf(".") > 0) x = x.split(".")[0];
            return cols[x];
        });
        if (select.length) return select;
    } else
    if (options && options.select_all && options.select_all.length) {
        return lib.strSplitUnique(options.select_all);
    } else
    if (options && options.skip_columns) {
        const cols = this.getColumns(table, options);
        const select = Object.keys(cols).filter(function(x) { return !db.skipColumn(x, "", options, cols); });
        if (select.length) return select;
    }
    return null;
}

// Return table columns filtered by a property filter, only return columns that contain(or not)
// any property from the filter list. If the filter is an object then values must match, null means if exists.
// ! at the beginning of the name means empty or does not exist.
//
// Example:
//
//      db.getFilteredColumns("bk_user", "pub")
//      db.getFilteredColumns("bk_user", "!internal")
//      db.getFilteredColumns("bk_user", { pub: null, index: 2 })
//      db.getFilteredColumns("bk_user", { type: "now" }, { list: 1 })
//
db.getFilteredColumns = function(table, filter, options)
{
    var cols = db.getColumns(table), obj = {}, reverse, v, col;
    if (!Array.isArray(filter) && !lib.isObject(filter)) filter = [ filter ];
    for (var name in filter) {
        if (lib.isNumeric(name)) {
            name = filter[name];
            v = null;
        } else {
            v = filter[name];
        }
        if (!name) continue;
        if (name[0] == "!") {
            reverse = 1;
            name = name.substr(1);
        } else {
            reverse = 0;
        }
        for (var p in cols) {
            if (obj[p]) continue;
            col = cols[p];
            if (util.isRegExp(name)) {
                if (!name.test(p)) continue;
                obj[p] = col;
            } else
            if ((!reverse && typeof col[name] != "undefined") || (reverse && typeof col[name] == "undefined")) {
                if (reverse ||
                    v === null ||
                    (Array.isArray(v) && v.indexOf(col[name]) > -1) ||
                    (util.isRegExp(v) && v.test(col[name])) ||
                    v == col[name]) obj[p] = col;
            }
        }
    }
    if (options && options.list) return Object.keys(obj);
    return obj;
}

// Returns type for a global custom column if exists otherwise null, all resolved
// columns will be saved in `req.allow` for further reference as name: type.
// For request specific custom columns pass `options.custom_columns` array in the format: [ RegExp, type, ...]
db.checkCustomColumn = function(req, name)
{
    var col, cols = this.customColumn[req.table];
    for (const p in cols) {
        col = cols[p];
        if (typeof col == "string") {
            col = [ lib.toRegexp(p), col];
            this.customColumn[req.table][p] = col;
        }
        if (Array.isArray(col)) {
            if (col[0].test(name)) {
                if (!req.allow) req.allow = {};
                req.allow[name] = { type: col[1], allow: 1 };
                return;
            }
        }
    }
    if (!req.options) return;
    if (lib.isArray(req.options.custom_columns)) {
        for (let i = 0; i < req.options.custom_columns.length; i+= 2) {
            if (util.isRegExp(req.options.custom_columns[i]) && req.options.custom_columns[i].test(name)) {
                if (!req.allow) req.allow = {};
                req.allow[name] = { type: req.options.custom_columns[i + 1], allow: 1 };
                return;
            }
        }
    }
    // Top level aliases require a custom column
    if (req.options.aliases && req.options.aliases[name]) {
        cols = db.getColumns(req.table);
        if (cols[req.options.aliases[name]]) {
            if (!req.allow) req.allow = {};
            if (!req.allow[name]) req.allow[name] = { type: cols[req.options.aliases[name]].type, allow: 1 };
        }
    }
}

// Verify column against common options for inclusion/exclusion into the operation, returns 1 if the column must be skipped
//  - to enable all properties to be saved in the record without column definition set `options.no_columns=1`
//  - to skip all null values set `options.skip_null=1`
//  - to skip by value set `options.skip_values` to a regexp
//  - to skip specific columns define `options.skip_columns=["a","b"]`
//  - to restrict to specific columns only define `options.allow_columns=["a","b"]`
//  - to skip columns based on matched properties define `options.skip_matched=[{ admin: 1 }, { owner: 1 }]`
//  - to allow only columns based on matched properties define `options.allow_matched={ admin: null }`
//  - to restrict to specific DB pools only define `options.allow_pools=["sqlite","mysql"]`
//  - to skip specific DB pools define `options.skip_pools=["sqlite","mysql"]`
//  - to restrict to specific DB pools for this columns only define `name: { allow_pools: ["sqlite","mysql"] }`
db.skipColumn = function(name, val, options, columns)
{
    if (!name || name[0] == '_' || typeof val == "undefined") return true;
    var pool = options && options.pool || this.pool, col;
    // Allow nested fields if the parent exists only
    if (!(options && options.no_columns) && columns && !columns[name]) {
        var dot = name.indexOf(".");
        if (dot == -1) return true;
        if (this.pools[pool] && this.pools[pool].configOptions.noObjects) return true;
        col = columns[name.substr(0, dot)];
        if (!col || !lib.rxObjectType.test(col.type)) return true;
    }
    col = columns && columns[name];
    if (options) {
        if (options.skip_null && val === null) return true;
        if (options.skip_empty && lib.isEmpty(val)) return true;
        if (options.skip_matched && !lib.isMatched(col, options.skip_matched)) return true;
        if (options.allow_matched && lib.isMatched(col, options.allow_matched)) return true;
        if (util.isRegExp(options.skip_values) && options.skip_values.test(val)) return true;
        if (Array.isArray(options.allow_pools) && options.allow_pools.indexOf(pool) == -1) return true;
        if (Array.isArray(options.skip_pools) && options.skip_pools.indexOf(pool) > -1) return true;
        if (Array.isArray(options.allow_columns) && options.allow_columns.indexOf(name) == -1) return true; else
        if (util.isRegExp(options.allow_columns) && !options.allow_columns.test(name)) return true;
        if (Array.isArray(options.skip_columns) && options.skip_columns.indexOf(name) > -1) return true; else
        if (util.isRegExp(options.skip_columns) && options.skip_columns.test(name)) return true;
    }
    if (col) {
        if (Array.isArray(col.allow_pools) && col.allow_pools.indexOf(pool) == -1) return true;
        if (Array.isArray(col.skip_pools) && col.skip_pools.indexOf(pool) > -1) return true;
    }
    return false;
}

// Given an object with data and list of keys perform comparison in memory for all rows, return only rows that match all keys. This method is used
// by custom filters in `db.select` by the drivers which cannot perform comparisons with non-indexes columns like DynamoDb, Cassandra.
// The rows that satisfy primary key conditions are returned and then called this function to eliminate the records that do not satisfy non-indexed column conditions.
//
// Options support the following propertis:
// - keys - list of columns to check, these may or may not be the primary keys, any columns to be compared
// - cols - an object with columns definition
// - ops - operations for columns
// - typesMap - types for the columns if different from the actual Javascript type
db.filterRows = function(query, rows, options)
{
    if (!options) options = lib.empty;
    var keys = lib.isArray(options.keys, lib.emptylist);
    if (!keys.length) return false;
    var ops = options.ops || lib.empty;
    var typesMap = options.typesMap || lib.empty;
    var cols = options.cols || lib.empty;
    // Keep only rows which satisfy all conditions
    return lib.isArray(rows, lib.emptylist).filter((row) => (keys.every((p) => (lib.isTrue(row[p], query[p], ops[p], typesMap[p] || (cols[p] || lib.empty).type || null)))));
}

// Return primary keys for a table or empty array, if `allkeys` is given in the options then return
// a list of all properties involed in primary keys including joined columns
db.getKeys = function(table, options)
{
    table = this.getTable(table);
    var keys = lib.isArray(this.getPool(table, options).dbkeys[table]) || this.keys[table] || lib.emptylist;
    if (options && options.allkeys) {
        var cols = this.getColumns(table);
        for (var p in cols) {
            if (cols[p].primary && Array.isArray(cols[p].join)) {
                keys = keys.concat(cols[p].join.filter(function(x) { return keys.indexOf(x) == -1 }));
            }
        }
    }
    return keys;
}

// Return indexes for a table or empty object, each item in the object is an array with index columns
db.getIndexes = function(table, options)
{
    table = this.getTable(table);
    return this.getPool(table, options).dbindexes[table] || this.indexes[table] || lib.empty;
}

// Return columns for all indexes as alist
db.getIndexColumns = function(table, options)
{
    var indexes = this.getIndexes(table, options);
    return Object.keys(indexes).reduce(function(a,b) { a = a.concat(indexes[b]); return a }, []);
}

// Return an index name that can be used for searching for the given keys, the index match is performed on the index columns
// from the left to right  and stop on the first missing key, for example for given keys { id: "1", name: "2", state: "VA" }
// the index ["id", "state"] or ["id","name"] will be returned but the index ["id","city","state"] will not.
db.getIndexForKeys = function(table, keys, options)
{
    var indexes = this.getIndexes(table, options);
    var found = {};
    for (var p in indexes) {
        var idx = indexes[p];
        for (var i in idx) {
            if (!keys[idx[i]]) break;
            if (!found[p]) found[p] = 0;
            found[p]++;
        }
    }
    return Object.keys(found).sort(function(a, b) { return found[a] - found[b] }).pop();
}

// Return keys for the table search, if options.keys provided and not empty it will be used otherwise
// table's primary keys will be returned. This is a wrapper that makes sure that valid keys are used and
// deals with input errors like empty keys list to be consistent between different databases.
// This function always returns an Array even if it is empty.
db.getSearchKeys = function(table, options)
{
    var keys = options && options.keys ? options.keys : null;
    if (!lib.isArray(keys)) keys = this.getKeys(table, options);
    return keys;
}

// Return query object based on the keys specified in the options or primary keys for the table, only search properties
// will be returned in the query object
db.getSearchQuery = function(table, obj, options)
{
    return this.getQueryForKeys(this.getSearchKeys(table, options), obj, options);
}

// Returns an object based on the list of keys, basically returns a subset of properties.
// `options.keysMap` defines an object to map record properties with the actual names to be returned.
db.getQueryForKeys = function(keys, obj, options)
{
    options = options || lib.empty;
    return (keys || lib.emptylist).
            filter(function(x) {
                return x && x[0] != '_' && typeof obj[x] != "undefined" &&
                !lib.isFlag(options.skip_columns, x) &&
                !lib.testRegexp(x, options.skip_columns) &&
                !lib.isEmpty(options.noempty ? obj[x] : 1) }).
            map(function(x) { return [ options.keysMap ? (options.keysMap[x] || x) : x, obj[x] ] }).
            reduce(function(x,y) { x[y[0]] = y[1]; return x; }, {});
}

