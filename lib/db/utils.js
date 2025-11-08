/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const util = require('util');
const modules = require(__dirname + '/../modules');
const db = require(__dirname + '/../db');
const logger = require(__dirname + '/../logger');
const lib = require(__dirname + '/../lib');
const app = require(__dirname + '/../app');
const metrics = require(__dirname + "/../metrics");

/**
 * Return database pool by name or default pool, options can be a pool name or an object with { pool: name } to return
 * the pool by given name. This call always returns a valid pool object, in case no requested pool found, it returns
 * the default pool, in case of invalid pool name it returns `none` pool.
 * A special pool `none` always returns empty result and no errors.
 * @memberOf module:db
 * @method getPool
 */
db.getPool = function(options)
{
    var pool = typeof options == "string" ? options : options?.pool || this.pool;
    return this.pools[this.poolAliases[pool] || pool] || this.pools.none;
}

/**
 * Return all tables know to the given pool, returned tables are in the object with
 * column information merged from cached columns from the database with description columns
 * given by the application. If `options.names` is 1 then return just table names as a list.
 * @memberof module:db
 * @method getPoolTables
 */
db.getPoolTables = function(name, options)
{
    var pool = this.getPool(name);
    var tables = this.tables;
    if (lib.isArray(pool.configOptions.tables)) {
        tables = pool.configOptions.tables.reduce((a, b) => { a[b] = this.tables[b]; return a }, {});
    }
    if (options?.names) tables = Object.keys(tables);
    return tables;
}

/**
 * Return a list of all active database pools, returns list of objects with name: and type: properties
 * @memberof module:db
 * @method getPools
 */
db.getPools = function()
{
    var rc = [];
    for (var p in this.pools) {
        if (p != "none") rc.push({ name: this.pools[p].name, type: this.pools[p].type });
    }
    return rc;
}

/**
 * Apply a config parameter to live DB pool, used in config args `update` callback to make a config value live
 * @memberof module:db
 * @method applyPoolOptions
 */
db.applyPoolOptions = function(val, options)
{
    if (!options.obj) return;
    logger.debug("applyPoolOptions:", options.obj, options.name, "NEW:", options.context);
    var d = options.obj.match(/^_config\.([^.]+)\.configOptions\.?(.+)?/);
    var pool = d && this.getPool(d[1]);
    if (!pool) return;
    logger.debug("applyPoolOptions:", options.obj, options.name, "OLD:", pool.configOptions);
    if (d[2]) {
        pool.configOptions[d[2]] = lib.objExtend(pool.configOptions[d[2]], options.context, { deep: 1 });
    } else {
        lib.objExtend(pool.configOptions, options.context, { deep: 1 });
    }
}

/**
 * Merge all tables from all modules
 * @memberof module:db
 * @method initTables
 */
db.initTables = function()
{
    app.sortModules();

    for (const p in modules) {
        if (lib.isObject(modules[p].tables)) {
            this.describeTables(modules[p].tables);
        }
    }
    this.initColumns();
}

/**
 * Merge cached columns into tables
 * @memberof module:db
 * @method initColumns
 */
db.initColumns = function()
{
    for (const p in this.columns) {
        if (!this.tables[p]) continue;
        var cols = this.columns[p];
        for (const c in cols) {
            var col = cols[c];
            var dbcol = this.tables[p][c];
            if (!dbcol) dbcol = this.tables[p][c] = {};
            Object.assign(dbcol, col);
        }
    }
}

/**
 * Create or upgrade the tables for the given pool
 * @memberof module:db
 * @method createTables
 */
db.createTables = function(options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (typeof options == "string") options = { pool: options };

    var pool = db.getPool(options), tables;
    var copts = lib.objClone(options, "pool", pool.name, "tables", []);
    logger.debug("createTables:", app.role, pool.name, pool.configOptions);

    lib.series([
        function(next) {
            db.cacheColumns(copts, next);
        },
        function(next) {
            copts.tables = [];
            // All allowed tables for the pool
            tables = Object.keys(db.tables).filter((x) => (!lib.isFlag(db.skipTables, x) && !lib.isFlag(pool.configOptions.skipTables, x)));
            // Skip tables not supposed to be in this pool
            if (lib.isArray(pool.configOptions.tables)) {
                tables = tables.filter((x) => (lib.isFlag(pool.configOptions.tables, x)));
            }
            lib.forEachSeries(tables, (table, next2) => {
                table = db.table(table);
                // We if have columns, SQL table must be checked for missing columns and indexes
                const cols = db.tables[table];
                const exists = pool.exists(table);
                logger.debug("createTables:", app.role, pool.name, exists ? "upgrade" : "create", table, cols);
                if (!exists) {
                    db.create(table, cols, copts, (err, rows, info) => {
                        if (!err && info.affected_rows) copts.tables.push(table);
                        next2();
                    });
                } else {
                    // Refreshing columns after an upgrade is only required by the driver which depends on
                    // the actual db schema, in any case all columns are merged so no need to re-read just the columns,
                    // the case can be to read new indexes used in searches, this is true for DynamoDB.
                    db.upgrade(table, cols, copts, (err, rows, info) => {
                        if (!err && info.affected_rows) copts.tables.push(table);
                        next2();
                    });
                }
            }, next, true);
        },
        function(next) {
            pool._createTablesTime = Date.now();
            logger.logger(copts.tables.length ? "info" : "debug", 'createTables:', app.role, pool.name, 'changed:', copts.tables, "all:", tables);
            next();
        },
    ], callback, true);
}

/**
 * Define new tables or extend/customize existing tables. Table definitions are used with every database operation,
 * on startup, the backend read all existing table columns from the database and cache them in the memory but some properties
 * like public columns are only specific to the backend so to mark such columns the table with such properties must be described
 * using this method. Only columns with changed properties need to be specified, other columns will be left as it is.
 *
 * @example
 *
 *          db.describeTables({
 *              bk_user: { name: { pub: 1 },
 *                         test: { id: { primary: 1, type: "int" },
 *                         name: { pub: 1, index: 1 }
 *          }});
 * @memberof module:db
 * @method describeTables
 */
db.describeTables = function(tables, callback)
{
    if (typeof tables == "string") {
        tables = lib.jsonParse(tables, { datatype: "obj", logger: "error" });
    }

    for (const p in tables) {
        var table1 = this.tables[p];
        if (!table1) this.tables[p] = table1 = {};
        var table2 = tables[p];
        for (const c in table2) {
            if (!table1[c]) table1[c] = {};
            // Merge columns
            for (const k in table2[c]) {
                if (!lib.isObject(table2[c][k])) {
                    table1[c][k] = table2[c][k];
                } else {
                    if (!table1[c][k]) table1[c][k] = {};
                    Object.assign(table1[c][k], table2[c][k]);
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
        this.keys[p].sort((a, b) => (table1[a].primary - table1[b].primary));
        for (const n in indexes) {
            indexes[n].sort((a, b) => (table1[a]["index" + n] - table1[b]["index" + n]));
            this.indexes[p][indexes[n].join("_")] = indexes[n];
        }
    }
    if (typeof callback == "function") callback();
}

/**
 * Convert native database error in some generic human readable string
 * @memberof module:db
 * @method convertError
 */
db.convertError = function(pool, table, op, err, options)
{
    if (!err || !util.types.isNativeError(err)) return err;
    if (typeof pool == "string") pool = this.pools[pool];
    err = pool.convertError(table, op, err, options);
    if (util.types.isNativeError(err)) {
        switch (err.code) {
        case "AlreadyExists":
            return { message: lib.__("Record already exists"), status: 409, code: err.code };

        case "NotFound":
            return { message: lib.__("Record could not be found"), status: 404, code: err.code };
        }
    }
    return err;
}

/**
 * Refresh columns for all pools which need it
 * @memberof module:db
 * @method refreshColumns
 */
db.refreshColumns = function(options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    var pools = this.none ? [] : this.getPools();
    lib.forEachLimit(pools, pools.length, function(pool, next) {
        if (!db.pools[pool.name].configOptions.cacheColumns) return next();
        db.cacheColumns(pool.name, next);
    }, (err) => {
        db.initColumns();
        if (typeof callback == "function") callback(err);
    }, true);
}

/**
 * Reload all columns into the cache for the pool, options can be a pool name or an object like `{ pool: name }`.
 * if `tables` property is an arary it asks to refresh only specified tables if that is possible.
 * @memberof module:db
 * @method cacheColumns
 */
db.cacheColumns = function(options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (typeof options == "string") options = { pool: options };

    var pool = this.getPool(options);
    logger.debug("cacheColumns:", options);

    pool.cacheColumns.call(pool, options, (err) => {
        if (err) logger.error('cacheColumns:', pool.name, lib.traceError(err));
        pool.cacheIndexes.call(pool, options, (err) => {
            if (err) logger.error('cacheIndexes:', pool.name, err);

            // Allow other modules to handle just cached columns for post processing
            for (const i in db.processColumns) {
                if (typeof db.processColumns[i] == "function") {
                    db.processColumns[i].call(pool, options);
                }
            }
            pool._cacheColumnsTime = Date.now();
            if (typeof callback == "function") callback(err);
        });
    });
}

// Returns true if a pool exists
db.existsPool = function(name)
{
    return !!this.pools[name];
}

// Return a normalized table name
db.table = function(table)
{
    return typeof table == "string" ? table.toLowerCase() : "";
}

// Returns a table alias if mapped or the same table name normalized
db.alias = function(table)
{
    return this.aliases[table] || this.table(table);
}

// Return columns for a table or null, columns is an object with column names and objects for definition.
db.getColumns = function(table, options)
{
    return this.tables[this.alias(table)] || lib.empty;
}

// Return the column definition for a table, for non-existent columns it returns an empty object
db.getColumn = function(table, name, options)
{
    return this.getColumns(table, options)[name] || lib.empty;
}

/**
 * Return an object with capacity property which is the max write capacity for the table, for DynamoDB only.
 * By default it checks `writeCapacity` property of all table columns and picks the max.
 *
 * The options can specify the capacity explicitely:
 * - useCapacity - what to use for capacity rating, can be `write`, `read` or a number with max capacity to use
 * - factorCapacity - a number between 0 and 1 to multiple the rate capacity
 * - rateCapacity - if set it will be used for rate capacity limit
 * - maxCapacity - if set it will be used as the max burst capacity limit
 * - minCapacity - if set it will be used as the minimum threshold
 * - intervalCapacity - default is 1000 ms
 * - sort - an index to use for capacity, for systems like DynamoDB which has different capacity for
 *   global indexes, it makes sense for indexed reads or partial updates where only global index is affected and not the whole record
 */
db.getCapacity = function(table, options)
{
    if (!options) options = lib.empty;
    table = this.alias(table);
    var pool = this.getPool(options);
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

/**
 * Check if number of requests exceeds the capacity per second, delay if necessary, for DynamoDB only but can be used for pacing
 * requests with any database or can be used generically. The `cap` must be initialized with `db.getCapacity` call.
 */
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

/**
 * Return list of selected or allowed only columns, empty list if no `options.select` is specified or it is equal to `*`. By default only allowed or existing
 * columns will be returned, to pass the list as is to the driver just use `options.select_all` instead.
 */
db.getSelectedColumns = function(req)
{
    if (req.options?.select == "*") return null;
    if (req.options?.select?.length) {
        const list = lib.strSplit(req.options.select, null, { unique: 1 });
        const select = list.filter((x) => {
            if (db.skipColumn(req, x, true)) return 0;
            if (x.indexOf(".") > 0) x = x.split(".")[0];
            return req.column(x);
        });
        if (select.length) return select;
    } else
    if (req.options?.select_all?.length) {
        return lib.strSplit(req.options.select_all, null, { unique: 1 });
    } else
    if (req.options?.skip_columns) {
        const select = Object.keys(req.columns).filter((x) => (!db.skipColumn(req, x, true)));
        if (select.length) return select;
    }
    return null;
}

/**
 * Return table columns that match the given filter.
 * The filter can be:
 *  - a string, means return all columns that contain the given property
 *  - an object, match column properties by value,
 *    - `undefined` means skip columns,
 *    - `null` means column does not exist,
 *    - `Infinity` means column is not undefined,
 *    - `name` will match against the column name not a property
 *
 * The options can contain:
 *  - list - return just column names
 *  - select - an array with properties to return, this will create a new list of columns with specified properties only
 *  - strict - only return columns that match all conditions in the filter, default is at least one
 *
 * Example:
 *
 *      db.getFilteredColumns("bk_user", "pub")
 *      db.getFilteredColumns("bk_user", { pub: undefined })
 *      db.getFilteredColumns("bk_user", { pub: null, internal: 1 })
 *      db.getFilteredColumns("bk_user", { type: "now" }, { list: 1 })
 *      db.getFilteredColumns("bk_user", { name: /^email/ }, { select: ["type"] })
 */
db.getFilteredColumns = function(table, filter, options)
{
    var cols = db.getColumns(table), obj = {}, i, m, v, col;
    if (typeof filter == "string") filter = { [filter]: Infinity };
    for (const p in cols) {
        i = m = 0;
        col = cols[p];
        for (const name in filter) {
            v = filter[name];
            if (v === undefined) continue;
            if ((v === Infinity && col[name] !== undefined) ||
                (v === null && col[name] === undefined)) {
                obj[p] = col;
                m++;
            } else
            if (name === "name") {
                if ((Array.isArray(v) && v.indexOf(p) > -1) ||
                    (util.types.isRegExp(v) && v.test(p))) {
                    obj[p] = col;
                    m++;
                }
            } else
            if ((Array.isArray(v) && v.indexOf(col[name]) > -1) ||
                (util.types.isRegExp(v) && v.test(col[name])) ||
                v == col[name]) {
                obj[p] = col;
                m++;
            }
            i++;
        }
        if (options?.strict && i !== m) delete obj[p];
    }
    if (Array.isArray(options?.select)) {
        var rc = {};
        for (const p in obj) {
            rc[p] = {};
            for (const n of options.select) {
                rc[p][n] = obj[p][n];
            }
        }
        return rc;
    }
    return options?.list ? Object.keys(obj) : obj;
}

/**
 * Returns type for a global custom column if exists otherwise null, all resolved
 * columns will be saved in `req.custom` for further reference as name: type.
 * For request specific custom columns pass `options.custom_columns` array in the format: [ RegExp, type, ...]
 */
db.checkCustomColumn = function(req, name)
{
    var col, cols = this.customColumn[req.table];
    for (const p in cols) {
        col = cols[p];
        if (typeof col == "string") {
            col = [ lib.toRegexp(p), col];
            this.customColumn[req.table][p] = col;
        }
        if (Array.isArray(col) && col[0] && col[0].test(name)) {
            req.custom[name] = { type: col[1] };
            return;
        }
    }
    if (lib.isArray(req.options?.custom_columns)) {
        for (let i = 0; i < req.options.custom_columns.length; i+= 2) {
            if (util.types.isRegExp(req.options.custom_columns[i]) && req.options.custom_columns[i].test(name)) {
                req.custom[name] = { type: req.options.custom_columns[i + 1] };
                return;
            }
        }
    }
    // Top level aliases require a custom column
    if (req.options?.aliases && req.options.aliases[name]) {
        cols = db.getColumns(req.table);
        if (cols[req.options.aliases[name]]) {
            if (!req.custom[name]) req.custom[name] = { type: cols[req.options.aliases[name]].type };
        }
    }
}

/**
 * Verify column against common options for inclusion/exclusion into the operation, returns 1 if the column must be skipped
 *  - to enable all properties to be saved in the record without column definition set `options.no_columns=1`
 *  - to skip specific columns define `options.skip_columns=["a","b"]`
 *  - to restrict to specific DB pools only define `options.allow_pools=["sqlite","mysql"]`
 */
db.skipColumn = function(req, name, val)
{
    if (!name || name[0] == '_' || typeof val == "undefined") return true;
    var col = req.column(name);
    if (!col && !req.options?.no_columns) {
        var pool = this.getPool(req.pool);
        // Allow nested fields if objects supported and the parent exists
        if (pool.configOptions.noObjectTypes) return true;
        var dot = name.indexOf(".");
        if (dot == -1) return true;
        col = req.column(name.substr(0, dot));
        if (!col || !lib.rxObjectType.test(col.type)) return true;
    }
    if (Array.isArray(req.options?.skip_columns) && req.options.skip_columns.includes(name)) return true;
    if (Array.isArray(req.options?.allow_pools) && !req.options.allow_pools.includes(req.pool)) return true;
    if (Array.isArray(col?.allow_pools) && !col.allow_pools.includes(req.pool)) return true;
    return false;
}

/**
 * Given an object with data and list of keys perform comparison in memory for all rows, return only rows that match all keys. This method is used
 * by custom filters in `db.select` by the drivers which cannot perform comparisons with non-indexes columns like DynamoDb, Cassandra.
 * The rows that satisfy primary key conditions are returned and then called this function to eliminate the records that do not satisfy non-indexed column conditions.
 *
 * Options support the following propertis:
 * - keys - list of columns to check, these may or may not be the primary keys, any columns to be compared
 * - cols - an object with columns definition
 * - ops - operations for columns
 * - typesMap - types for the columns if different from the actual Javascript type
 */
db.filterRows = function(query, rows, options)
{
    if (!options) options = lib.empty;
    var keys = lib.isArray(options.keys, lib.emptylist);
    if (!keys.length) return false;
    var ops = options.ops || lib.empty;
    var typesMap = options.typesMap || lib.empty;
    var cols = options.cols || lib.empty;
    // Keep only rows which satisfy all conditions
    return lib.isArray(rows, lib.emptylist).
               filter((row) => (keys.every((p) => (lib.isTrue(row[p], query[p], ops[p], typesMap[p] || (cols[p] || lib.empty).type || null)))));
}

/**
 * Return primary keys for a table or empty array, if `allkeys` is given in the options then return
 * a list of all properties involed in primary keys including joined columns
 */
db.getKeys = function(table, options)
{
    table = this.alias(table);
    var keys = lib.isArray(this.getPool(options).dbkeys[table]) || this.keys[table] || lib.emptylist;
    if (options?.allkeys) {
        var cols = this.getColumns(table);
        for (var p in cols) {
            if (cols[p].primary && Array.isArray(cols[p].join)) {
                keys = keys.concat(cols[p].join.filter((x) => (keys.indexOf(x) == -1)));
            }
        }
    }
    return keys;
}

// Return indexes for a table or empty object, each item in the object is an array with index columns
db.getIndexes = function(table, options)
{
    table = this.alias(table);
    return this.getPool(options).dbindexes[table] || this.indexes[table] || lib.empty;
}

// Return columns for all indexes as alist
db.getIndexColumns = function(table, options)
{
    var indexes = this.getIndexes(table, options);
    return Object.keys(indexes).reduce((a, b) => { a = a.concat(indexes[b]); return a }, []);
}

/**
 * Return an index name that can be used for searching for the given keys, the index match is performed on the index columns
 * from the left to right  and stop on the first missing key, for example for given keys { id: "1", name: "2", state: "VA" }
 * the index ["id", "state"] or ["id","name"] will be returned but the index ["id","city","state"] will not.
 */
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

/**
 * Return keys for the table search, if options.keys provided and not empty it will be used otherwise
 * table's primary keys will be returned. This is a wrapper that makes sure that valid keys are used and
 * deals with input errors like empty keys list to be consistent between different databases.
 * This function always returns an Array even if it is empty.
 */
db.getSearchKeys = function(table, options)
{
    var keys = options?.keys ? options.keys : null;
    if (!lib.isArray(keys)) keys = this.getKeys(table, options);
    return keys;
}

/**
 * Return query object based on the keys specified in the options or primary keys for the table, only search properties
 * will be returned in the query object
 */
db.getSearchQuery = function(table, obj, options)
{
    return this.getQueryForKeys(this.getSearchKeys(table, options), obj, options);
}

/**
 * Returns an object based on the list of keys, basically returns a subset of properties.
 * `options.keysMap` defines an object to map record properties with the actual names to be returned.
 */
db.getQueryForKeys = function(keys, obj, options)
{
    keys = lib.isArray(keys, lib.emptylist).filter((x) => (x && x[0] != '_' && typeof obj[x] != "undefined")).map((x) => ([x, obj[x]]));
    if (options?.skip_columns || options?.noempty) {
        keys = keys.filter((x) => (!lib.isFlag(options?.skip_columns, x[0]) && !lib.testRegexp(x[0], options?.skip_columns) && options?.noempty ? !lib.isEmpty(x[1]) : 1));
    }
    if (options?.keysMap) {
        keys = keys.map((x) => ([ options.keysMap[x[0]] || x[0], x[1] ]));
    }
    return keys.reduce((x, y) => { x[y[0]] = y[1]; return x; }, {});
}

