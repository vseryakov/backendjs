/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
'use strict';

const modules = require(__dirname + '/../modules');
const db = require(__dirname + '/../db');
const logger = require(__dirname + '/../logger');
const lib = require(__dirname + '/../lib');
const app = require(__dirname + '/../app');

// Return a normalized table name
db.table = function(table)
{
    return typeof table === "string" ? table.toLowerCase() : "";
}

// Returns a table alias if mapped or the same table name normalized
db.alias = function(table)
{
    return this.aliases[table] || this.table(table);
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
 * Create or upgrade the tables for all or given pools
 * @param {objects|string} options
 * @param {string[]} [options.pools] - only create in these pools
 * @param {function} [callback]
 * @memberof module:db
 * @method createTables
 */
db.createTables = function(options, callback)
{
    if (typeof options === "function") callback = options, options = null;

    var pools = db.none ? [] : lib.isArray(options?.pools, Object.keys(db.pools)).filter(x => !lib.includes(db.skip?.pools, x));

    lib.forEveryLimit(pools, options?.concurrency || db.concurrency, (name, next) => {
        var pool = db.getPool(name), tables;
        var copts = lib.clone(options, { pool: pool.name, tables: [] });
        logger.debug("createTables:", app.role, pool.name, pool.config);

        lib.series([
            function(next2) {
                db.cacheColumns(copts, next2);
            },

            function(next2) {
                copts.tables = [];
                // All allowed tables for the pool
                tables = Object.keys(db.tables).filter((x) => (!lib.includes(db.skip?.tables, x) && !lib.includes(pool.config.skipTables, x)));

                // Skip tables not supposed to be in this pool
                if (lib.isArray(pool.config.tables)) {
                    tables = tables.filter((x) => (lib.includes(pool.config.tables, x)));
                }

                lib.forEachSeries(tables, (table, next3) => {
                    table = db.table(table);

                    // We if have columns, SQL table must be checked for missing columns and indexes
                    const cols = db.tables[table];
                    const exists = pool.exists(table);
                    logger.debug("createTables:", app.role, pool.name, exists ? "upgrade" : "create", table, cols);

                    if (!exists) {
                        db.create(table, cols, copts, (err, _rows, info) => {
                            if (!err && info.affected_rows) copts.tables.push(table);
                            next3();
                        });
                    } else {
                        // Refreshing columns after an upgrade is only required by the driver which depends on
                        // the actual db schema, in any case all columns are merged so no need to re-read just the columns,
                        // the case can be to read new indexes used in searches, this is true for DynamoDB.
                        db.upgrade(table, cols, copts, (err, _rows, info) => {
                            if (!err && info.affected_rows) copts.tables.push(table);
                            next3();
                        });
                    }
                }, () => {
                    logger.logger(copts.tables.length ? "info" : "debug", 'createTables:', app.role, pool.name, 'changed:', copts.tables, "all:", tables);
                    next2();
                }, true);
            },
        ], next, true);
    }, callback);
}

/**
 * Define new tables or extend/customize existing tables. Table definitions are used with every database operation,
 * on startup, the backend read all existing table columns from the database and cache them in the memory but some properties
 * like public columns are only specific to the backend so to mark such columns the table with such properties must be described
 * using this method. Only columns with changed properties need to be specified, other columns will be left as it is.
 *
 * @example
 *
 * db.describeTables({
 *  bk_user: {
 *     name: { pub: 1 },
 *     test: { id: { primary: 1, type: "int" },
 *     name: { pub: 1, index: 1 }
 * }});
 * @memberof module:db
 * @method describeTables
 */
db.describeTables = function(tables, callback)
{
    if (typeof tables === "string") {
        tables = lib.jsonParse(tables, { datatype: "obj", logger: "error" });
    }

    for (const p in tables) {
        const table1 = this.tables[p] || (this.tables[p] = {});

        const table2 = tables[p];
        for (const c1 in table2) {
            const col1 = table1[c1] || (table1[c1] = {});

            // Merge columns
            for (const c2 in table2[c1]) {
                const col2 = table2[c1];

                if (!lib.isObject(col2[c2])) {
                    col1[c2] = col2[c2];
                } else {
                    if (!col1[c2]) col1[c2] = {};
                    Object.assign(col1[c2], col2[c2]);
                }
            }
        }

        // Produce keys and indexes
        const indexes = db.getIndexColumns(p);

        this.keys[p] = indexes.primary || [];

        this.indexes[p] = {};
        for (const c in indexes) {
            this.indexes[p][indexes[c].join("_")] = indexes[c];
        }

        this.joins[p] = [];
        for (const c1 in table1) {
            if (table1[c1].join?.length) this.joins[p].push(c1);
        }
    }
    if (typeof callback === "function") callback();
}

/**
 * Return the column definition for a table, for non-existent columns it returns an empty object
 * @memberof module:db
 * @method getColumn
 */
db.getColumn = function(table, name, options)
{
    return this.getColumns(table, options)[name] || lib.empty;
}

/**
 * Return columns for a table or null, columns is an object with column names and objects for definition.
 * @memberof module:db
 * @method getColumns
 */
db.getColumns = function(table, _options)
{
    return this.tables[this.alias(table)] || lib.empty;
}

/**
 * Returns column names for all indexes sorted
 * @param {string|object} table
 * @return {object} as `{ primary: [...], index: [..], index1: [..], index2: [..] }`
 * @memberof module:db
 * @method getIndexColumns
 */
db.getIndexColumns = function(table)
{
    const cols = typeof table === "object" ? table : this.getColumns(table);
    const rc = {};

    for (const p in cols) {
        if (p[0] === "_" || p[0] === "$") continue;
        Object.keys(cols[p]).
               filter(x => /^(primary|index)/.test(x)).
               forEach(x => {
            if (!rc[x]) rc[x] = [];
            rc[x].push([p, cols[p][x]]);
        });
    }
    for (const p in rc) {
        rc[p] = rc[p].sort((a, b) => (a[1] - b[1])).map(x => x[0]);
    }
    return rc;
}

/**
 * Return actual column type to be used in column definition, performs possible conversions using table's or pool's typesMap,
 * the priority is
 * - table's typesMap[type || ""]
 * - pool config's typesMap[type || ""]
 * - tables's typesMap[*]
 * - pool config's typesMap[*]
 * - type
 * - ""
 * @param {DBRequest} req
 * @param {string} type
 * @memberof module:db
 * @method getColumnType
 */
db.getColumnType = function(req, type)
{
    const typesMap = req.query?.["_$" + req.pool?.type]?.typesMap ||
                     req.query?._$db?.typesMap;

    return typesMap?.[type || ""] ||
           req.config?.typesMap?.[type || ""] ||
           typesMap?.["*"] ||
           req.config?.typesMap?.["*"] ||
           type || "";
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
        const cols = this.columns[p];
        for (const c in cols) {
            const col = cols[c];
            let dbcol = this.tables[p][c];
            if (!dbcol) dbcol = this.tables[p][c] = {};
            Object.assign(dbcol, col);
        }
    }
}

/**
 * Refresh columns for all pools which need it
 * @memberof module:db
 * @method refreshColumns
 */
db.refreshColumns = function(options, callback)
{
    if (typeof options === "function") callback = options, options = null;
    var pools = this.none ? [] : this.getPools();
    lib.forEachLimit(pools, pools.length, (pool, next) => {
        if (!db.pools[pool.name].config?.cacheColumns) return next();
        db.cacheColumns(pool.name, next);
    }, (err) => {
        db.initColumns();
        if (typeof callback === "function") callback(err);
    }, true);
}

/**
 * Reload all columns into the cache for the pool,
 * @param {string|object} options - a pool name or an object
 * @param {string} [options.pool] - pool name
 * @param {function} [callback]
 * @memberof module:db
 * @method cacheColumns
 */
db.cacheColumns = function(options, callback)
{
    if (typeof options === "function") callback = options, options = null;
    if (typeof options === "string") options = { pool: options };

    const pool = this.getPool(options);
    logger.debug("cacheColumns:", options);

    pool.use((err, client) => {
        if (err) return lib.tryCall(callback, err);

        pool.cacheColumns(client, options, (err) => {
            if (err) logger.error('cacheColumns:', pool.name, lib.traceError(err));

            pool.cacheIndexes(client, options, (err) => {
                if (err) logger.error('cacheIndexes:', pool.name, err);

                // Allow other modules to handle just cached columns for post processing
                for (const i in db.processColumns) {
                    if (typeof db.processColumns[i] === "function") {
                        db.processColumns[i].call(pool, options);
                    }
                }
                pool._cacheColumnsTime = Date.now();
                pool.release(client);

                lib.tryCall(callback, err);
            });
        });
    });
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
        if (typeof col === "string") {
            col = [ lib.toRegexp(p), col];
            this.customColumn[req.table][p] = col;
        }
        if (Array.isArray(col) && col[0]?.test(name)) {
            req.custom[name] = { type: col[1] };
            return;
        }
    }
}

