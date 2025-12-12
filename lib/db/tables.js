/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const modules = require(__dirname + '/../modules');
const db = require(__dirname + '/../db');
const logger = require(__dirname + '/../logger');
const lib = require(__dirname + '/../lib');
const app = require(__dirname + '/../app');

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
 * Create or upgrade the tables for the given pool
 * @memberof module:db
 * @method createTables
 */
db.createTables = function(options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (typeof options == "string") options = { pool: options };

    var pool = db.getPool(options), tables;
    var copts = lib.objClone(options, { pool: pool.name, tables: [] });
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
        this.indexes[p] = {};
        this.joins[p] = [];

        var indexes = {};
        for (const c in table1) {
            if (table1[c].primary) this.keys[p].push(c);
            if (table1[c].join?.length) this.joins[p].push(c);
            ["","1","2","3","4","5"].forEach(function(n) {
                if (!table1[c]["index" + n]) return;
                if (!indexes[n]) indexes[n] = [];
                indexes[n].push(c);
            });
        }

        this.keys[p].sort((a, b) => (table1[a].primary - table1[b].primary));
        for (const n in indexes) {
            indexes[n].sort((a, b) => (table1[a]["index" + n] - table1[b]["index" + n]));
            this.indexes[p][indexes[n].join("_")] = indexes[n];
        }
    }
    if (typeof callback == "function") callback();
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
 * Refresh columns for all pools which need it
 * @memberof module:db
 * @method refreshColumns
 */
db.refreshColumns = function(options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    var pools = this.none ? [] : this.getPools();
    lib.forEachLimit(pools, pools.length, (pool, next) => {
        if (!db.pools[pool.name].configOptions?.cacheColumns) return next();
        db.cacheColumns(pool.name, next);
    }, (err) => {
        db.initColumns();
        if (typeof callback == "function") callback(err);
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
    if (typeof options == "function") callback = options, options = null;
    if (typeof options == "string") options = { pool: options };

    const pool = this.getPool(options);
    logger.debug("cacheColumns:", options);

    pool.use((err, client) => {
        if (err) return lib.tryCall(callback, err);

        pool.cacheColumns(client, options, (err) => {
            if (err) logger.error('cacheColumns:', pool.name, lib.traceError(err));

            pool.cacheIndexes(options, (err) => {
                if (err) logger.error('cacheIndexes:', pool.name, err);

                // Allow other modules to handle just cached columns for post processing
                for (const i in db.processColumns) {
                    if (typeof db.processColumns[i] == "function") {
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
        if (typeof col == "string") {
            col = [ lib.toRegexp(p), col];
            this.customColumn[req.table][p] = col;
        }
        if (Array.isArray(col) && col[0] && col[0].test(name)) {
            req.custom[name] = { type: col[1] };
            return;
        }
    }
}

