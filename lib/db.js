//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const logger = require(__dirname + '/logger');
const core = require(__dirname + '/core');
const lib = require(__dirname + '/lib');
const metrics = require(__dirname + '/metrics');
const fs = require("fs");
const util = require("util");

// The Database API, a thin abstraction layer on top of SQLite, PostgreSQL, DynamoDB and Cassandra.
// The idea is not to introduce new abstraction layer on top of all databases but to make
// the API usable for common use cases. On the source code level access to all databases will be possible using
// this API but any specific usage like SQL queries syntax or data types available only for some databases will not be
// unified or automatically converted but passed to the database directly. Only conversion between JavaScript types and
// database types is unified to some degree meaning JavaScript data type will be converted into the corresponding
// data type supported by any particular database and vice versa.
//
// Basic operations are supported for all database and modelled after NoSQL usage, this means no SQL joins are supported
// by the API, only single table access. SQL joins can be passed as SQL statements directly to the database using low level db.query
// API call, all high level operations like add/put/del perform SQL generation for single table on the fly.
//
// The common convention is to pass options object with flags that are common for all drivers along with specific,
// this options object can be modified with new properties but all driver should try not to
// modify or delete existing properties, so the same options object can be reused in subsequent operations.
//
// All queries and update operations ignore properties that starts with underscore.
//
// Before the DB functions can be used the `core.init` MUST be called first, the typical usage:
//
//          var backend = require("backendjs"), core = backend.core, db = backend.db;
//          core.init(function(err) {
//              db.add(...
//              ...
//          });
//
// All database methods can use default db pool or any other available db pool by using `pool: name` in the options. If not specified,
// then default db pool is used, sqlite is default if no -db-pool config parameter specified in the command line or the config file.
// Even if the specified pool does not exist, the default pool will be returned, this allows to pre-confgure the app with different pools
// in the code and enable or disable any particular pool at any time.
//
//  Example, use PostgreSQL db pool to get a record and update the current pool
//
//          db.get("bk_user", { login: "123" }, { pool: "pg" }, (err, row) => {
//              if (row) db.update("bk_user", row);
//          });
//
//          const user = await db.aget("bk_user", { login: "123" });
//
// Most database pools can be configured with options `min` and `max` for number of connections to be maintained, so no overload will happen and keep warm connection for
// faster responses. Even for DynamoDB which uses HTTPS this can be configured without hitting provisioned limits which will return an error but
// put extra requests into the waiting queue and execute once some requests finished.
//
//  Example:
//
//          db-pg-pool-max = 100
//          db-dynamodb-pool-max = 100
//
// Also, to spread functionality between different databases it is possible to assign some tables to the specific pools using `db-X-pool-tables` parameters
// thus redirecting the requests to one or another databases depending on the table, this for example can be useful when using fast but expensive
// database like DynamoDB for real-time requests and slower SQL database running on some slow instance for rare requests, reports or statistics processing.
//
//  Example, run the backend with default PostgreSQL database but keep all config parametrs in the DynamoDB table for availability:
//
//          db-pool = pg
//          db-dynamodb-pool = default
//          db-dynamodb-pool-tables = bk_config
//
//
// The following databases are supported with the basic db API methods: Sqlite, PostgreSQL, DynamoDB, Elasticsearch
//
// Multiple connections of the same type can be opened, just add `N` suffix to all database config parameters where N is a number,
// referer to such pools in the code as `poolN` or by an alias.
//
// Example:
//
//          db-sqlite1-pool = billing
//          db-sqlite1-pool-max = 10
//          db-sqlite1-pool-options-path = /data/db
//          db-sqlite1-pool-options-journal_mode = OFF
//          db-sqlite1-pool-alias = billing
//
//          in the Javascript:
//
//          db.select("bills", { status: "ok" }, { pool: "billing" }, lib.log)
//          await db.aselect("bills", { status: "ok" }, { pool: "billing" })
//
const db = {
    name: 'db',

    // Config parameters
    args: [
        { name: "cap-(.+)", type: "int", strip: "cap-", descr: "Capability parameters" },
        { name: "none", type: "bool", descr: "disable all db pools" },
        { name: "pool", descr: "Default pool to be used for db access without explicit pool specified" },
        { name: "name", key: "db-name", descr: "Default database name to be used for default connections in cases when no db is specified in the connection url" },
        { name: "create-tables", key: "_createTables", type: "bool", nocamel: 1, master: 1, pass: 1, descr: "Create tables in the database or perform table upgrades for new columns in all pools, only shell or server process can perform this operation" },
        { name: "create-tables-roles", type: "list", pass: 1, descr: "Only processes with these roles can create tables" },
        { name: "cache-tables", array: 1, type: "list", descr: "List of tables that can be cached: bk_user, bk_counter. This list defines which DB calls will cache data with currently configured cache. This is global for all db pools." },
        { name: "skip-tables", array: 1, type: "list", descr: "List of tables that will not be created or modified, this is global for all pools" },
        { name: "cache-pools", array: 1, type: "list", descr: "List of pools which trigger cache flushes on update." },
        { name: "cache-sync", array: 1, type: "list", descr: "List of tables that perform synchronized cache updates before returning from a DB call, by default cache updates are done in the background" },
        { name: "cache-keys-([a-z0-9_]+)-(.+)", obj: "cacheKeys.$1", make: "$2", nocamel: 1, type: "list", descr: "List of columns to be used for the table cache, all update operations will flush the cache if the cache key can be created from the record columns. This is for ad-hoc and caches to be used for custom selects which specified the cache key." },
        { name: "describe-tables", type: "callback", callback: function(v) { this.describeTables(lib.jsonParse(v, { datatype: "obj",logger: "error" })) }, descr: "A JSON object with table descriptions to be merged with the existing definitions" },
        { name: "cache-ttl", type: "int", obj: "cacheTtl", key: "default", descr: "Default global TTL for cached tables", },
        { name: "cache-ttl-(.+)", type: "int", obj: "cacheTtl", nocamel: 1, strip: /cache-ttl-/, descr: "TTL in milliseconds for each individual table being cached", },
        { name: "cache-name-(.+)", obj: "cacheName", nocamel: 1, make: "$1", descr: "Cache client name to use for cache reading and writing for each table instead of the default in order to split cache usage for different tables, it can be just a table name or `pool.table`, use `*` to set default cache for all tables", },
        { name: "cache-update-(.+)", obj: "cacheUpdate", nocamel: 1, make: "$1", descr: "Cache client name to use for updating only for each table instead of the default in order to split cache usage for different tables, it can be just a table name or `pool.table` or `*`. This cache takes precedence for updating cache over `cache-name` parameter", },
        { name: "cache2-max", type: "int", min: 1, obj: "lru", make: "max", descr: "Max number of items to keep in the LRU Level 2 cache" },
        { name: "cache2-(.+)", obj: "cache2", type: "int", nocamel: 1, strip: /cache2-/, min: 0, descr: "Tables with TTL for level2 cache, i.e. in the local process LRU memory. It works before the primary cache and keeps records in the local LRU cache for the given amount of time, the TTL is in ms and must be greater than zero for level 2 cache to work" },
        { name: "custom-column-([a-zA-Z0-9_]+)-(.+)", obj: "customColumn.$1", make: "$2", nocamel: 1, descr: "A column that is allowed to be used in any table, the name is a column name regexp with the value to be a type, Ex: -db-custom-column-bk_user-^stats=counter", },
        { name: "describe-column-([a-z0-9_]+)-([a-zA-Z0-9_]+)", obj: "columns.$1", make: "$2", type: "map", maptype: "auto", nocamel: 1, descr: "Describe a table column properties, can be a new or existing column, overrides existing property, ex: -db-describe-column-bk_user-name max:255", },
        { name: "local", descr: "Local database pool for properties, cookies and other local instance only specific stuff" },
        { name: "config", descr: "Configuration database pool to be used to retrieve config parameters from the database, must be defined to use remote db for config parameters, set to `default` to use current default pool" },
        { name: "config-map", obj: "config-map", type: "map", merge: 1, maptype: "auto", descr: "Config options: `.interval` between loading configuration from the database configured with -db-config, in minutes, 0 disables refreshing config from the db, `.count` max records to load in one select, see the docs about `.top`, `.main`, `.other` config parameters" },
        { name: "local-tables", type: "bool", key: "_localTables", descr: "Only enable local, default and config pools" },
        { name: "cache-columns-interval", type: "int", min: 0, descr: "How often in minutes to refresh tables columns from the database, it calls cacheColumns for each pool which supports it" },
        { name: "skip-drop", type: "regexpobj", descr: "A pattern of table names which will skipped in db.drop operations to prevent accidental table deletion" },
        { name: "aliases-(.+)", obj: "aliases", nocamel: 1, reverse: 1, onparse: function(v,o) { o.name=this.table(o.name); return this.table(v) }, descr: "Table aliases to be used instead of the requested table name, only high level db operations will use it, al low level utilities use the real table names" },
        { name: "([a-z0-9]+)-pool$", obj: '_config.$1', make: "url", dflt: "default", descr: "A database pool name, depending on the driver it can be an URL, name or pathname, examples of db pools: `-db-pg-pool, -db-dynamodb-pool`, url format: `protocol://[user:password@]hostname[:port]/dbname` or `default`" },
        { name: "([a-z0-9]+)-pool-(disabled)$", obj: '_config.$1', make: "$2", type: "bool", descr: "Disable the specified pool but keep the configuration" },
        { name: "([a-z0-9]+)-pool-(max)$", obj: '_config.$1', make: "$2", type: "number", min: 1, descr: "Max number of open connections for a pool, default is Infinity" },
        { name: "([a-z0-9]+)-pool-(min)$", obj: '_config.$1', make: "$2", type: "number", min: 1, descr: "Min number of open connections for a pool" },
        { name: "([a-z0-9]+)-pool-(idle)$", obj: '_config.$1', make: "$2", type: "number", min: 1000, descr: "Number of ms for a db pool connection to be idle before being destroyed" },
        { name: "([a-z0-9]+)-pool-(tables)$", obj: '_config.$1.configOptions', make: "$2", array: 1, type: "list", onupdate: function(v,o) {this.applyPoolOptions(v,o)}, descr: "Tables to be created only in this pool, to prevent creating all tables in every pool" },
        { name: "([a-z0-9]+)-pool-connect$", obj: '_config.$1.connectOptions', type: "json", logger: "warn", descr: "Connect options for a DB pool driver for new connection, driver specific" },
        { name: "([a-z0-9]+)-pool-options$", obj: '_config.$1.configOptions', type: "map", maptype: "auto", merge: 1, onupdate: function(v,o) {this.applyPoolOptions(v,o)}, descr: "General options for a DB pool" },
        { name: "([a-z0-9]+)-pool-options-([a-zA-Z0-9_.-]+)$", obj: '_config.$1.configOptions', camel: '-', autotype: 1, make: "$2", onupdate: function(v,o) {this.applyPoolOptions(v,o)}, descr: "General options for a DB pool" },
        { name: "([a-z0-9]+)-pool-(create-tables)$", master: 1, obj: '_config.$1.configOptions', make: "$2", type: "bool", descr: "Create tables for this pool on startup" },
        { name: "([a-z0-9]+)-pool-(skip-tables)$", obj: '_config.$1.configOptions', make: "$2", array: 1, type: "list", descr: "Tables not to be created in this pool" },
        { name: "([a-z0-9]+)-pool-(metric-tables)$", obj: '_config.$1.configOptions', make: "$2", array: 1, type: "list", descr: "Tables to collect metrics in this pool" },
        { name: "([a-z0-9]+)-pool-cache2-(.+)", obj: 'cache2', nocamel: 1, strip: /pool-cache2-/, type: "int", descr: "Level 2 cache TTL for the specified pool and table, data is JSON strings in the LRU cache" },
        { name: "([a-z0-9]+)-pool-alias", obj: 'poolAliases', make: "$1", reverse: 1, descr: "Pool alias to refer by an alternative name" },
    ],

    // Database drivers
    modules: [],

    // Database connection pools by pool name
    pools: {},

    // Configuration parameters
    _config: { none: {} },

    // Default database name
    dbName: "backend",

    // Tables to be cached
    cacheTables: [],
    cachePools: [],
    cacheSync: [],
    cacheKeys: {},
    cacheName: {},
    cacheUpdate: {},
    cacheTtl: {},
    createTablesRoles: ["master","shell"],

    // Level 2 cache objects
    cache2: {},
    lru: new lib.LRUCache(),

    // Default database pool for the backend
    pool: process.env.BKJS_DB_POOL || '',

    // Local db pool, used for local storage by the core
    local: '',

    config: process.env.BKJS_DB_CONFIG || '',
    configMap: {
        count: 1000,
        interval: 1440,
        top: "runMode",
        main: "role,roles,tag",
        other: "role",
    },

    // Refresh columns from time to time to have the actual table columns
    cacheColumnsInterval: 1440,

    processRows: {},
    processColumns: [],
    customColumn: {},
    columns: {},
    aliases: {},
    poolAliases: {},

    // Separator to combined columns
    separator: "|",

    ddlOps: ["incr","update","bulk","put","add","del","delall","updateall"],
    arrayOps: ["in","all in","all_in","not in","not_in","between","not between","not_between","contains","not contains","not_contains"],

    // Table definitions, all tables form all modules eventually end up here with all columns merged
    tables: {
        // Configuration store, same parameters as in the commandline or config file, can be placed in separate config groups
        // to be used by different backends or workers
        bk_config: {
            name: { primary: 1 },                   // name of the parameter
            ctime: { type: "now", primary: 2 },     // create time
            type: { type: "text" },                 // config type or tag
            value: { type: "text" },                // the value
            status: { value: "ok" },                // ok - availaible
            version: { type: "text" },              // version conditions, >M.N,<M.N
            stime: { type: "mtime" },               // start time when in use
            etime: { type: "mtime" },               // end time when not in use
            sort: { type: "int" },                  // sorting order
            mtime: { type: "now" }
        },

        // General purpose properties, can be used to store arbitrary values
        bk_property: {
            name: { primary: 1 },
            value: { type: "text" },
            count: { type: "counter" },      // general purpose counter value
            ttl: { type: "int" },            // time to live, seconds since last update
            mtime: { type: "now" }
        },
    },

    // Computed primary keys and indexes from the table definitons
    keys: {},
    indexes: {},
};

module.exports = db;

// None database driver
db.modules.push({ name: "none", createPool: function(opts) { return new db.Pool(opts) } });

// Initialize all database pools. the options may containt the following properties:
//  - createTables - if true then create new tables or upgrade tables with new columns
//  - localTables - if true only enable local, default and config pools
db.init = function(options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = lib.empty;

    // Important parameters that can persist until cleared
    if (typeof options.createTables != "undefined") this._createTables = options.createTables;

    this.initTables();

    logger.debug("dbinit:", "start", core.role, options, Object.keys(this._config), Object.keys(this.pools));

    // Periodic columns refresh
    var interval = this.cacheColumns && this.cacheColumnsInterval > 0 ? this.cacheColumnsInterval * 60000 + lib.randomShort() : 0;
    lib.deferInterval(this, interval, "columns", this.refreshColumns.bind(this));

    // Configured pools for supported databases
    var pools = this.none ? ["none"] : Object.keys(this._config);
    lib.forEachLimit(pools, options.concurrency || core.concurrency, (name, next) => {
        if ((options.localTables || db._localTables) && name != db.pool && name != db.local && name != db.config) return next();

        var params = db._config[name];
        params.pool = name;
        params.type = name.replace(/[0-9]/, "");
        logger.debug("dbinit:", "check", core.role, name, options, params);

        if (params.disabled) return next();

        var pool, old = db.pools[name];

        // Do not re-create the pool if not forced, just update the properties
        if (old && !options.force && (!params.url || !old.url || params.url == old.url)) {

            pool = old;
            pool.configure(params);

        } else {

            // Create a new pool for the given database driver
            var mod = db.modules.filter((x) => (x.name == params.type)).pop();
            if (!mod) {
                logger.error("dbinit:", core.role, name, "invalid pool type");
                return next();
            }
            try {
                pool = mod.createPool(params);
            } catch (e) {
                logger.error("dbinit:", core.role, params, e.stack);
                return next();
            }
            db.pools[name] = pool;
            if (old) old.shutdown();

            logger.debug("dbinit:", "done", core.role, name, options, params);
        }

        // Trigger create or cache columns only if explicitly set
        if (core.isMaster &&
            !pool._createTablesTime &&
            (db._createTables || pool.configOptions.createTables) &&
            lib.isFlag(db.createTablesRoles, core.role)) {
            return setTimeout(db.createTables.bind(db, name, next), 1000);
        }
        if ((options.cacheColumns || pool.configOptions.cacheColumns) && !pool._cacheColumnsTime) {
            return db.cacheColumns(name, next);
        }
        next();
    }, callback, true);
}

// Delete all specified tables from the specific pool or all active pools if `options.pool` is empty, `tables` can be a list of tables or an
// object with table definitions
db.dropTables = function(tables, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (typeof options == "string") options = { pool: options };

    tables = lib.isArray(tables, lib.objKeys(tables));
    lib.forEach(Object.keys(this.pools), (pool, next) => {
        if (options && options.pool && options.pool != pool) return next();
        lib.forEachSeries(tables, (table, next2) => {
            db.drop(table, { pool: pool }, () => { next2() });
        }, next, true);
    }, callback, true);
}

// Execute query using native database driver, the query is passed directly to the driver.
// - req - an object with the following properties:
//    - text - SQL statement or other query in the format of the native driver
//    - values - parameter values for SQL bindings or other driver specific data
//    - op - operations to be performed, used by non-SQL drivers
//    - obj - actual object with data for non-SQL drivers
//    - table - table name for the operation
// - options may have the following properties:
//    - pool - name of the database pool where to execute this query.
//      The difference with the high level functions that take a table name as their firt argument, this function must use pool
//      explicitely if it is different from the default. Other functions can resolve
//      the pool by table name if some tables are assigned to any specific pool by configuration parameters `db-pool-tables`.
//    - unique - perform sorting the result and eliminate any duplicate rows by the column name specified in the `unique` property
//    - filterrows - function to filter rows not to be included in the result, returns a new result set, args are: function(req, rows)
//    - processrows - function to process rows in the result, returns a new result, args are: function(req, rows), this result will be put in cache
//      if requested so this may be used for preparing cached results, it must return an array
//    - processasync - function to process result rows via async callback, return a new result in the callback, the function is: function(req, rows, callback),
//      the callback is function(err, rows)
//    - syncMode - skip columns preprocessing and dynamic values for pool sync and backup restore
//    - quiet - report errors in debug level
//    - first - return the first row from the result
//    - last - return the last row from the result
//    - logger_db - log results at the end with this level or debug by default
//    - logger_error - a log level to report about the errors, default is 'error', if an object it can specify different log levels by err.code, * is default level for not matched codes
//    - ignore_error - clear errors occurred as it never happen, do not report in the log, if an array then only matched codes will be cleared
//    - noprocessrows - if true then skip post processing result rows, return the data as is, this will result in returning combined columns as it is
//    - noconvertrows - if true skip converting the data from the database format into Javascript data types, it uses column definitions
//    - nopreparerow - if true skip row preparation and columns processing, the req.obj is passed as is, useful for syncing between pools
//      for the table to convert values returned from the db into the the format defined by the column
//    - cached - if true perform cache invalidation for the operations that resulted in modification of the table record(s)
//    - total - if true then it is supposed to return only one record with property `count`, skip all post processing and convertion
//    - info_obj - to return the record just processed in the info object as `obj` property, it will include all generated and updated columns
//    - result_obj - to return the query record as result including all post processing and new generated columns, this is not what `returning` property does, it only
//      returns the query record with new columns from memory
//    - keep_req - on return do not clear out the request object, by default all properties are deleted to free up memory
//    - keep_obj - only preserve op, obj, table properties in the reqest after return
//
// - callback(err, rows, info) where
//    - info is an object with information about the last query: inserted_oid,affected_rows,next_token,consumed_capacity
//    - rows is always returned as a list, even in case of error it is an empty list
//
//  Example with SQL driver
//
//          db.query({ text: "SELECT a.id,c.type FROM bk_user a,bk_icon c WHERE a.id=c.id and a.id=?", values: ['123'] }, { pool: 'pg' }, (err, rows, info) => {
//          });
//
db.query = function(req, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!lib.isObject(req)) req = { error: lib.newError("invalid request") };

    req.table = req.table || "";
    req.options = options || req.options || {};
    const pool = this.getPool(req.options);
    // For postprocess callbacks
    req.pool = pool.name;

    // Metrics collection
    req._timer = pool.metrics.req.start();
    pool.metrics.que.update(++pool.metrics.running);

    // Read/write rates for each table
    var table = req.op == "bulk" ? req.obj[0]?.table : req.table;
    if (req.op && lib.isFlag(pool.configOptions.metricTables, table)) {
        if (!pool.metrics.tables[table]) {
            pool.metrics.tables[table] = {
                read: new metrics.Meter(),
                write: new metrics.Meter(),
            };
        }
        pool.metrics.tables[table][db.ddlOps.includes(req.op) ? "write" : "read"].mark();
    }

    if (req.error) {
        return db.queryEnd(req.error, req, null, callback);
    }
    pool.acquire((err, client) => {
        if (err) return db.queryEnd(err, req, null, callback);
        try {
            db.queryRun(pool, client, req, callback);
        } catch (e) {
            db.queryEnd(e, req, null, callback);
        }
    });
}
db.aquery = util.promisify(db.query.bind(db));

db.queryRun = function(pool, client, req, callback)
{
    req.client = client;
    pool.query(client, req, req.options, (err, rows, info) => {
        req.info = info || {};
        rows = rows || [];
        if (!err) {
            if (!req.info.affected_rows) req.info.affected_rows = client.affected_rows || 0;
            if (!req.info.inserted_oid) req.info.inserted_oid = client.inserted_oid || null;
            if (!req.info.next_token) req.info.next_token = pool.nextToken(client, req, rows);
            if (!req.info.consumed_capacity) req.info.consumed_capacity = client.consumed_capacity || 0;

            pool.release(client);
            delete req.client;

            db.queryResult(req, rows, (rows) => {
                db.queryEnd(err, req, rows, callback);
            });
        } else {
            db.queryEnd(err, req, rows, callback);
        }
    });
}

db.queryEnd = function(err, req, rows, callback)
{
    var pool = this.pools[req.pool] || this.pools.none;
    pool.metrics.running--;

    req.elapsed = req._timer?.end();
    delete req._timer;

    if (req.client) {
        pool.release(req.client);
        delete req.client;
    }
    if (!Array.isArray(rows)) rows = [];
    if (err) {
        pool.metrics.err_count++;
        logger.errorWithOptions(err, req.options, "queryEnd:", req.pool, err, 'REQ:', req.op, req.table, req.obj, req.text, req.values, 'OPTS:', req.options, "I:", req.info, "F:", req.failed);
    } else {
        if (req.info) req.info.count = rows.length;
        logger.logger(req.options.logger_db || req.failed && "warn" || "debug", "queryEnd:", req.pool, req.elapsed, 'ms', rows.length, 'rows', 'REQ:', req.op, req.table, req.obj, req.values, 'OPTS:', req.options, "F:", req.failed);
    }
    if (err) {
        err = this.convertError(pool, req.table, req.op || "", err, req.options);
        if (req.options.ignore_error && (!lib.isArray(req.options.ignore_error) || lib.isFlag(req.options.ignore_error, err.code))) err = null;
    }
    if (req.info?.retry_count > 0) {
        pool.metrics.retry_count += req.info.retry_count;
    }
    var info = req.info;
    if (req.options.info_obj) {
        if (!info) info = {};
        info.obj = req.obj;
        if (req.options.info_obj.processrows) {
            db.runProcessRows("post", req.table, req, info.obj);
        }
        if (req.options.info_obj.convertrows) {
            info.obj = lib.objClone(req.obj);
            this.convertRows(req.pool, req, [info.obj], req.options.info_obj);
        }
    }
    if (info) info.elapsed = req.elapsed;
    var first = req.options.first, last = req.options.last, keep_obj = req.options.keep_obj;
    if (!req.options.keep_req) {
        for (const p in req) {
            switch (p) {
            case "options":
                req.options = {};
                break;
            case "op":
            case "obj":
            case "text":
            case "table":
                if (keep_obj) break;
            default:
                delete req[p];
            }
        }
    }
    if (typeof callback == "function") {
        lib.tryCatch(callback, err, first ? rows[0] : last ? rows.at(-1) : rows, info || req);
    }
}

db.queryResult = function(req, rows, callback)
{
    // With total we only have one property 'count'
    if (req.op == "select" && req.options.total) return callback(rows);

    lib.series([
        function(next) {
            // Automatic support for getCached and global caches
            if (lib.isArray(db.cachePools) && !lib.isFlag(db.cachePools, req.pool)) return next();
            // For sync cache flushes wait before returning
            var cbnext = lib.isFlag(db.cacheSync, req.table) ? next : undefined;
            switch (req.op) {
            case "bulk":
                var options = req.options, skipped = 0;
                lib.forEachLimit(req.obj, core.concurrency, (row, next2) => {
                    db.delCacheKeys(row, rows, options, (e) => {
                        if (isNaN(e)) skipped++; else skipped = 0;
                        if (skipped < lib.maxStackDepth) return next2();
                        setImmediate(next2);
                        skipped = 0;
                    });
                }, cbnext, true);
                break;

            default:
                db.delCacheKeys(req, rows, req.options, cbnext);
            }
            if (!cbnext) next();
        },
        function(next) {
            rows = db.queryProcessResult(req, rows);
            if (typeof req.options.processasync != "function") return next();
            req.options.processasync(req, rows, (err, rc) => {
                if (!err && rc) rows = rc;
                next();
            });
        },
    ], () => {
        callback(rows);
    }, true);
}

db.queryProcessResult = function(req, rows)
{
    // Treat the query as the result
    if (req.options.result_obj) {
        rows = [ lib.objClone(req.obj) ];
    }

    // Make sure no duplicates
    if (req.options.unique) {
        rows = lib.arrayUnique(rows, req.options.unique);
    }

    // Convert from db types into javascript, deal with json and joined columns
    if (rows.length && !req.options.noconvertrows) {
        db.convertRows(req.pool, req, rows, req.options);
    }

    // Convert values if we have custom column callback, for post process hook we
    // need to run it at least once even if there are no results
    if (!req.options.noprocessrows) {
        rows = db.runProcessRows("post", req.table, req, rows.length ? rows : {});
    }
    // Always run global hooks
    rows = db.runProcessRows("post", "*", req, rows.length ? rows : {});

    // Custom filters to return the final result set
    if (typeof req.options.filterrows == "function" && rows.length) {
        rows = req.options.filterrows(req, rows);
    }

    // Always run explicit post processing callback
    if (typeof req.options.processrows == "function") {
        rows = req.options.processrows(req, rows);
    }
    return rows;
}

// Post process hook to be used for replicating records to another pool, this is supposed to be used as this:
//
//        db.setProcessRow("post", "*", (req, row) => { db.queryProcessSync("elasticsearch", req, row) });
//
// The conditions when to use it is up to the application logic.
//
// It does not deal with the destination pool to be overloaded, all errors will be ignored, this is for simple and light load only
//
// The destination poll must have tables to be synced configured:
//
//      db-elasticsearch-pool-tables=table1,table2
//
db.queryProcessSync = function(pool, req, row)
{
    switch (req.op) {
    case "bulk":
    case "add":
    case "put":
    case "incr":
    case "update":
    case "del":
        if (!req.info?.affected_rows || pool == req.pool) break;
        var table = req.op == "bulk" ? req.obj[0]?.table : req.table;
        if (!lib.isFlag(db.getPool(pool).configOptions.tables, table)) return;

        req = { op: req.op, table: table, obj: req.obj, options: req.options };
        switch (req.op) {
        case "add":
            req.op = "put";
            delete req.options.expected;
            break;
        case "incr":
        case "update":
            req.op = "update";
            req.options.upsert = true;
            delete req.options.expected;
            break;
        }
        req.options.pool = pool;
        req.options.keep_req = req.options.no_columns = req.options.syncMode = 1;
        db.query(req, req.options);
    }
}

// Retrieve one record from the database by primary key, returns found record or null if not found
// Options can use the following special properties:
//  - select - a list of columns or expressions to return, default is to return all columns
//  - ops - operators to use for comparison for properties, see `db.select`
//  - cached - if specified it runs getCached version
//  - nocache - disable caching even if configured for the table
//
// NOTE: On return the `info.cached` will be set to
// - 1 if retrieved from top level cache
// - 2 if retrieved from level 2 cache
// - 0 if retrieved from db and put in the cache
//
// Example
//
//          db.get("bk_user", { login: '12345' }, function(err, row) {
//             if (row) console.log(row.name);
//          });
//          const user = await db.aget("bk_user", { login: '12345' });
//
db.get = function(table, query, options, callback)
{
    if (typeof options == "function") callback = options,options = null;
    if (typeof callback != "function") callback = lib.noop;
    if (!options?.__cached && !options?.nocache && (options?.cached || this.cacheTables.includes(table))) {
        if (this.getCached("get", table, query, options, callback) === true) return;
    }
    var req = this.prepare("get", table, query, options);
    this.query(req, req.options, (err, rows, info) => {
        callback(err, rows.length ? rows[0] : null, info);
    });
}
db.aget = util.promisify(db.get.bind(db));

// Select objects from the database that match supplied conditions.
// - query - can be an object with properties for the condition, all matching records will be returned,
//   also can be a list where each item is an object with primary key condition. Only records specified in the list must be returned.
// - options can use the following special properties:
//    - ops - operators to use for comparison for properties, an object with column name and operator. The following operators are available:
//       `>, gt, <, lt, =, !=, <>, >=, ge, <=, le, in, all_in, between, regexp, iregexp, begins_with, not_begins_with, like%, ilike%, contains, not_contains`
//    - opsMap - operator mapping between supplied operators and actual operators supported by the db
//    - typesMap - type mapping between supplied and actual column types, an object
//    - select - a list of columns or expressions to return or all columns if not specified, only existing columns will be returned
//    - select_all - a list of columns or expressions to return, passed as is to the underlying driver
//    - start - start records with this primary key, this is the next_token passed by the previous query
//    - count - how many records to return
//    - first - a convenient option to return the first record from the result or null (similar to `db.get` method)
//    - last - similar to first but return last record
//    - join - how to join condition expressions, default is AND
//    - joinOps - operators to use to combine several expressions in case when an array of values is given, supports `and|or|AND|OR``
//    - sort - sort by this column. if null then no sorting must be done at all, records will be returned in the order they are kept in the DB.
//       _NOTE: For DynamoDB this may affect the results if columns requsted are not projected in the index, with sort
//        `select` property might be used to get all required properties. For Elasticsearch if sort is null then scrolling scan will be used,
//        if no `timeout` or `scroll` are given the default is 1m._
//    - sort_timeout - for pagination how long to keep internal state in millisecons, depends on the DB, for example for Elasticsearch it corresponds
//       to the scroll param and defaults to 60000 (1m)
//    - desc - if sorting, do in descending order
//    - page - starting page number for pagination, uses count to find actual record to start, for SQL databases mostly
//    - unique - specified the column name to be used in determining unique records, if for some reasons there are multiple records in the location
//       table for the same id only one instance will be returned
//    - cacheKey - exlicit key for caching, return from the cache or from the DB and then cache it with this key, works the same as `get`
//    - cacheKeyName - a name of one of the cache keys to use, it must be defined by a `db-cache-keys-table-name` parameter
//    - nocache - do not use cache even if cache key is given
//    - aliases - an object with mapping between artificial name to real column name, useful in $or/$and conditions with same column but different values,
//       alternative is to prepend aliases with $, like $name or $$name, the name must be valid column name
//    - custom_columns - an array of pairs to define global or artificial columns, the format is: [ RegExp, type, ...], useful with aliases
//
// On return, the callback can check third argument which is an object with some predefined properties along with driver specific state returned by the query:
// - affected_rows - how many records this operation affected, for add/put/update
// - inserted_oid - last created auto generated id
// - next_token - next primary key or offset for pagination by passing it as .start property in the options, if null it means there are no more pages availabe for this query
//
// Example: get by primary key, refer above for default table definitions
//
//        db.select("bk_message", { id: '123' }, { count: 2 }, (err, rows) => {
//
//        });
//
//        const rows = await db.aselect("bk_message", { id: '123' }, { count: 2 });
//
// Example: get all icons with type greater or equal to 2
//
//        db.select("bk_icon", { id: '123', type: '2' }, { select: 'id,type', ops: { type: 'ge' } }, (err, rows) => {
//
//        });
//
// Example: get unread msgs sorted by time, recent first
//
//        db.select("bk_message", { id: '123', status: 'N:' }, { sort: "status", desc: 1, ops: { status: "begins_with" } }, (err, rows) => {
//
//        });
//
// Example: allow all accounts icons to be visible
//
//        db.select("bk_user", {}, (err, rows) => {
//            rows.forEach(function(row) {
//                row.acl_allow = 'auth';
//                db.update("bk_icon", row);
//            });
//        });
//
// Example: scan accounts with custom filter, not by primary key: by exact zipcode
//
//        db.select("bk_user", { zipcode: '20000' }, (err, rows) => {
//
//        });
//
// Example: select accounts by type for the last day
//
//        db.select("bk_user", { type: 'admin', mtime: Date.now()-86400000 }, { ops: { type: "contains", mtime: "gt" } }, (err, rows) => {
//
//        });
//
db.select = function(table, query, options, callback)
{
    if (typeof options == "function") callback = options,options = null;
    if ((options?.cacheKey || options?.cacheKeyName) && !options.__cached && !options.nocache) {
        if (this.getCached("select", table, query, options, callback) === true) return;
    }
    var req = this.prepare(Array.isArray(query) ? "list" : "select", table, query, options);
    this.query(req, req.options, callback);
}
db.aselect = util.promisify(db.select.bind(db));

// Perform full text search on the given table, the database implementation may ignore table name completely
// in case of global text index.
//
// Query in general is a text string with the format that is supported by the underlying driver,
// the db module *DOES NOT PARSE* the query at all if the driver supports full text search, otherwise it behaves like `select`.
//
// Options make take the same properties as in the `select` method.
//
// A special query property `q` may be used for generic search in all fields.
//
// Without full text search support in the driver this may return nothing or an error.
//
//  Example
//            db.search("bk_user", { type: "admin", q: "john*" }, { pool: "elasticsearch" }, lib.log);
//            db.search("bk_user", "john*", { pool: "elasticsearch" }, lib.log);
//            await db.asearch("bk_user", "john*", { pool: "elasticsearch" });
//
db.search = function(table, query, options, callback)
{
    if (typeof options == "function") callback = options,options = null;
    var req = this.prepare("search", table, query, options);
    this.query(req, req.options, callback);
}
db.asearch = util.promisify(db.search.bind(db));

// Insert new object into the database
// - obj - an JavaScript object with properties for the record, primary key properties must be supplied
// - options may contain the following properties:
//      - no_columns - do not check for actual columns defined in the pool tables and add all properties from the obj, only will work for NoSQL dbs,
//        by default all properties in the obj not described in the table definition for the given table will be ignored.
//      - skip_columns - ignore properties by name listed in the this array, the most use case is to skip autogeneratd columns like "now"
//
// On return the `obj` will contain all new columns generated before adding the record
//
// Note: SQL, DynamoDB, MongoDB, Redis drivers are fully atomic but other drivers may be subject to race conditions
//
// Example
//
//       db.add("bk_user", { id: '123', login: 'admin', name: 'test' }, function(err, rows, info) {
//       });
//
//       await db.aadd("bk_user", { id: '123', login: 'admin', name: 'test' })
//
db.add = function(table, obj, options, callback)
{
    if (typeof options == "function") callback = options,options = null;
    var req = this.prepare("add", table, obj, options);
    this.query(req, req.options, callback);
}
db.aadd = util.promisify(db.add.bind(db));

// Counter operation, increase or decrease column values, similar to update but all specified columns except primary
// key will be incremented, use negative value to decrease the value.
//
// If no `options.updateOps` object specified or no 'incr' operations are provided then
// all columns with type 'counter' will be used for the action `incr`
//
// *Note: The record must exist already for SQL databases, for DynamoDB and Cassandra a new record will be created
// if does not exist yet.* To disable upsert pass `noupsert` in the options.
//
// Example
//
//       db.incr("bk_counter", { id: '123', like0: 1, invite0: 1 }, (err, rows, info) => {
//       });
//
//       await db.aincr("bk_counter", { id: '123', like0: 1, invite0: 1 })
//
db.incr = function(table, obj, options, callback)
{
    if (typeof options == "function") callback = options,options = null;
    var req = this.prepare("incr", table, obj, options);
    this.query(req, req.options, callback);
}
db.aincr = util.promisify(db.incr.bind(db));

// Add/update an object in the database, if object already exists it will be replaced with all new properties from the obj
// - obj - an object with record properties, primary key properties must be specified
// - options - same properties as for `db.add` method
//
// Example
//
//       db.put("bk_user", { id: '123', login: 'test', name: 'test' }, function(err, rows, info) {
//       });
//
//       await db.aput("bk_user", { id: '123', login: 'test', name: 'test' })
//
db.put = function(table, obj, options, callback)
{
    if (typeof options == "function") callback = options,options = null;

    // Custom handler for the operation
    var pool = this.getPool(options);
    if (pool.put) return pool.put(table, obj, options, callback);

    var req = this.prepare("put", table, obj, options);
    this.query(req, req.options, callback);
}
db.aput = util.promisify(db.put.bind(db));

// Update existing object in the database.
// - obj - is an actual record to be updated, primary key properties must be specified
// - options - same properties as for `db.add` method with the following additional properties:
//     - ops - object for comparison operators for primary key, default is equal operator
//     - opsMap - operator mapping into supported by the database
//     - typesMap - type mapping for properties to be used in the condition
//     - aliases - an object to map column aliases in the query in case the same column is used ultiple times
//     - expected - an object with the condition for the update, it is used in addition to the primary keys condition from the `obj`,
//        a property named $or/$and will be treated as a sub-expression if it is an object. For multiple OR/AND use
//        $or1, $or2,...
//     - expectedJoin - how to join expected expressions: OR, AND, default is AND
//     - upsert - create a new record if it does not exist
//     - syncMode - skip columns preprocessing and dynamic values for pool sync and backup restore
//     - updateOps - an object with column names and operations to be performed on the named column
//        - incr - increment by given value
//        - add - add an item to the list
//        - del - remove an item from the list
//        - set - to update as it is, for reseting counters forexample
//        - concat - concatenate given value, for strings if the database supports it
//        - append - append to the list of values, only for lists if the database supports it
//        - prepend - insert at the beginning of the list, depends on the database
//        - not_exists - only update if not exists or null
//     - typesOps - an object that defines updateOps operation by column type, for example `typesOps: { list: "add" }` will
//        make sure all lists will have updateOps set as add if not specified explicitly
//
// Note: not all database drivers support atomic update with conditions, all drivers for SQL, DynamoDB, MongoDB, Redis fully atomic, but other drivers
// perform get before put and so subject to race conditions
//
// Example
//
//          db.update("bk_user", { login: 'test', id: '123' }, (err, rows, info) => {
//              console.log('updated:', info.affected_rows);
//          });
//
//          await db.aupdate("bk_user", { login: 'test', name: 'Test')
//
//          db.update("bk_user", { login: 'test', id: '123', first_name: 'Mr' }, { pool: pg' }, (err, rows, info) => {
//              console.log('updated:', info.affected_rows);
//          });
//
//          db.update("bk_user", { login: 'test', first_name: 'John' }, { expected: { first_name: "Carl" } }, (err, rows, info) => {
//              console.log('updated:', info.affected_rows);
//          });
//
//          db.update("bk_user", { login: 'test', first_name: 'John' }, { expected: { "$or": { first_name: "Carl", g1: null }, aliases: { g1: "first_name" } }, (err, rows, info) => {
//              console.log('updated:', info.affected_rows);
//          });
//
db.update = function(table, obj, options, callback)
{
    if (typeof options == "function") callback = options,options = null;
    var req = this.prepare("update", table, obj, options);
    this.query(req, req.options, callback);
}
db.aupdate = util.promisify(db.update.bind(db));

// Update all records that match given condition in the `query`, one by one, the input is the same as for `db.select` and every record
// returned will be updated using `db.update` call by the primary key, so make sure options.select include the primary key for every row found by the select.
//
// All properties from the `obj` will be set in every matched record.
//
// The callback will receive on completion the err and all rows found and updated. This is mostly for non-SQL databases and for very large range it may take a long time
// to finish due to sequential update every record one by one.
// Special properties that can be in the options for this call:
//   - updateOptions - options to be passed to the db.update if needed, this is useful so select and update options will not be mixed up
//   - updateCollect - if true return all updated rows in the callback otherwise just the number of updated rows
//   - factorCapacity - write capacity factor for update operations, default is 0.25
//   - op - by default it uses db.update but the `op` can be set to `put` or `add`
//   - updateProcess - a function callback that will be called for each row before updating it, this is for some transformations of the record properties
//      in case of complex columns that may contain concatenated values as in the case of using DynamoDB. The callback will be called
//      as `options.updateProcess(row, options)`. If it returns non-empty value the update will stop and return it as the error.
//   - updateFilter - a function that must return something to the callback in order to skip the current record. `options.updateFilter(row, options, (skip) => {})`
//
//  If no `options.select` is specified only the primary keys will be returned or collected
//
// Example, update birthday format if not null
//
//          db.updateAll("bk_user",
//                      { birthday: 1 },
//                      { mtime: Date.now() },
//                      { ops: { birthday: "not null" },
//                        updateProcess: function(r, o) {
//                           r.birthday = lib.strftime(new Date(r.birthday, "%Y-%m-D"));
//                        },
//                        updateFilter: function(r, o, cb) {
//                           cb(r.status == 'ok');
//                        } },
//          function(err, count) {
//             console.log(count, "rows updated");
//          });
//
db.updateAll = function(table, query, obj, options, callback)
{
    if (typeof options == "function") callback = options,options = null;

    options = lib.objClone(options);
    var pool = this.getPool(options);
    var process = typeof options.updateProcess == "function" ? options.updateProcess : null;
    if (typeof pool.updateAll == "function" && !process) return pool.updateAll(table, query, obj, options, callback);

    var rows = [], nupdated = 0;
    var filter = typeof options.updateFilter == "function" ? options.updateFilter : function(r, o, cb) { cb() };
    var cap = db.getCapacity(table, { useCapacity: "write", factorCapacity: options.factorCapacity || 0.25 });

    // No need to pull all columns, just the primary key
    if (!options.select) {
        options.select = db.getKeys(table);
        if (!(options.updateCollect || process || filter)) options.noconvertrows = options.noprocessrows = 1;
    }
    this.scan(table, query, options, (row, next) => {
        if (options.updateCollect) rows.push(row);
        if (process) {
            var err = process(row, options);
            if (err) return next(err);
        }
        for (var p in obj) row[p] = obj[p];
        filter(row, options, (skip) => {
            if (skip) return next();
            db[options.op || "update"](table, row, options.updateOptions, (err) => {
                if (!err) nupdated++;
                if (err && !options.ignore_error) return next(err);
                db.checkCapacity(cap, next);
            });
        });
    }, function(err) {
        logger.logger(options.logger || "debug", "updateAll:", table, query, nupdated, "records");
        lib.tryCall(callback, err, options.updateCollect ? rows : nupdated);
    });
}
db.aupdateAll = util.promisify(db.updateAll.bind(db));

// Delete an object in the database, no error if the object does not exist
// - obj - an object with primary key properties only, other properties will be ignored
// - options - same properties as for `db.update` method
//
// Example
//
//       db.del("bk_user", { login: '123' }, function(err, rows, info) {
//           console.log('updated:', info.affected_rows);
//       });
//
db.del = function(table, obj, options, callback)
{
    if (typeof options == "function") callback = options,options = null;
    var req = this.prepare("del", table, obj, options);
    this.query(req, req.options, callback);
}
db.adel = util.promisify(db.del.bind(db));

// Delete all records that match given condition, one by one, the input is the same as for `db.select` and every record
// returned will be deleted using `db.del` call. The callback will receive on completion the err and all rows found and deleted.
// Special properties that can be in the options for this call:
//  - ops - query operations to retrieve records to be deleted
//  - count - how many matching records to delete
//  - delScan - if true force to use db.scan instead of native `delAll` for the given pool
//  - delOptions - options to be passed to the db.del if needed, this is useful so select and del options will not be mixed up
//  - delCollect - if true return all deleted rows in the callback, oherwise just the number of rows deleted
//  - factorCapacity - write capqcity factor for delete operations, default is 0.35
//  - concurrency - how many delete requests to execute at the same time by using lib.forEachLimit.
//  - ignore_error - continue deleting records even after an error
//  - delProcess - a function callback that will be called for each row before deleting it, this is for some transformations of the record properties
//    in case of complex columns that may contain concatenated values as in the case of using DynamoDB. The callback will be called
//    as `options.delProcess(row, options, info)`. If it returns non-empty value the scan will stop and return it as the error.
//  - delFilter - a function that must return something to the callback in order to skip the current record. `options.delFilter(row, options, (skip) => {})`
//  - batch - delete using bulk operations, all functions must accept an array of rows instead
//
//  If no `options.select` is specified only the primary keys will be returned or collected
//
// If `db-skip-drop` matches the table name and there is no query provided it will exit with error
//
db.delAll = function(table, query, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (lib.testRegexpObj(table, this.skipDrop) && lib.isEmpty(query)) return lib.tryCall(callback, "skip-drop");

    options = lib.objClone(options, "table", table);
    var pool = this.getPool(options);
    var process = typeof options.delProcess == "function" ? options.delProcess : null;
    if (typeof pool.delAll == "function" && !process && !options.delScan) return pool.delAll(table, query, options, callback);

    var rows = [], ndeleted = 0;
    var filter = typeof options.delFilter == "function" ? options.delFilter : function(r, o, cb) { cb() };
    var cap = db.getCapacity(table, { useCapacity: "write", factorCapacity: options.factorCapacity || 0.35 });

    // No need to pull all columns, just the primary key
    if (!options.select) {
        options.select = db.getKeys(table);
        if (!(options.delCollect || process || filter)) options.noconvertrows = options.noprocessrows = 1;
    }

    this.scan(table, query, options, (row, next, info) => {
        if (options.delCollect) rows.push(row);
        if (process) {
            var err = process(row, options, info);
            if (err) return next(err);
        }
        filter(row, options, (skip) => {
            if (skip) return next();
            if (options.batch) {
                db.bulk(row.map((x) => ({ op: "del", table: table, obj: x, options: options.delOptions })), { cap: cap }, (err, rc) => {
                    if (!err) ndeleted += row.length - rc.length;
                    if (err && !options.ignore_error) return next(err);
                    db.checkCapacity(cap, next);
                });
            } else {
                db.del(table, row, options.delOptions, function(err) {
                    if (!err) ndeleted++;
                    if (err && !options.ignore_error) return next(err);
                    db.checkCapacity(cap, next);
                });
            }
        });
    }, function(err) {
        logger.logger(options.logger || "debug", "delAll:", table, query, ndeleted, "records");
        lib.tryCall(callback, err, options.delCollect ? rows : ndeleted);
    });
}
db.adelAll = util.promisify(db.delAll.bind(db));

// Convenient helper to retrieve all records by primary key, the obj must be a list with key property or a string with list of primary key column
// Example
//
//      db.list("bk_user", ["id1", "id2"], function(err, rows) { console.log(err, rows) });
//      db.list("bk_user", "id1,id2", function(err, rows) { console.log(err, rows) });
//
db.list = function(table, query, options, callback)
{
    if (typeof options == "function") callback = options,options = null;
    if (typeof callback != "function") callback = lib.noop;

    switch (lib.typeName(query)) {
    case "string":
    case "array":
        query = lib.strSplitUnique(query);
        if (typeof query[0] == "string") {
            var keys = this.getKeys(table, options);
            if (!keys.length) return callback(lib.newError("invalid keys"), []);
            query = query.map((x) => ({ [keys[0]]: x }));
        }
        break;

    default:
        return callback(lib.newError("invalid list"), []);
    }
    if (!query.length) return callback(null, []);
    this.select(table, query, options, callback);
}
db.alist = util.promisify(db.list.bind(db));

// Perform a batch of operations at the same time, all operations for the same table will be run
//  together one by one but different tables will be updated in parallel.
// - `list` an array of objects to put/delete from the database in the format:
//   - op - is one of add, incr, put, update, del
//   - table - which table to use
//   - obj - an object with data
//   - options - params for the operation, optional
// - options can have the follwoing:
//   - concurrency - number of how many operations to run at the same time, 1 means sequential
//   - no_errors - will stop on first error, because operations will be run in parallel some operations still may be performed
//   - factorCapacity - a capacity factor to apply to the write capacity if present, by default it is used write capacity at 100%
//
// On return the second arg to the callback is a list of records with errors, same input record with added property `errstatus` and `errmsg`
//
//  Example:
//
//          var ops = [ { op: "add", table: "bk_counter", obj: { id:1, like:1 } },
//                      { op: "add", table: "bk_user", obj: { login: "test", id:1, name:"test" }]
//          db.batch(ops, { factorCapacity: 0.5 }, lib.log);
//
db.batch = function(list, options, callback)
{
    if (typeof options == "function") callback = options,options = null;

    var info = [], tables = {}, caps = {};
    lib.isArray(list, []).forEach((x) => {
        if (!x?.table || !x.obj || !x.op || !db[x.op]) return;
        if (!tables[x.table]) tables[x.table] = [];
        tables[x.table].push(x);
    });
    lib.forEach(Object.keys(tables), (table, next) => {
        caps[table] = db.getCapacity(table, options);
        lib.forEachLimit(tables[table], options && options.concurrency || 1, (obj, next2) => {
            db[obj.op](obj.table, obj.obj, obj.options, (err) => {
                if (err) {
                    info.push(lib.objExtend(obj, { errstatus: err.code || err.status, errmsg: err.message }));
                    if (options?.no_errors) return next2(err);
                }
                db.checkCapacity(caps[obj.table], next2);
            });
        }, next, true);
    }, (err) => {
        lib.tryCall(callback, err, info, {});
    }, true);
}
db.abatch = util.promisify(db.batch.bind(db));

// Bulk operations, it will be noop if the driver does not support it.
// The input format is the same as for the `db.batch` method.
//
// On return the second arg to the callback is a list of records with errors, same input record with added property `errstatus` and `errmsg`
//
// NOTE: DynamoDB only supports add/put/del only and 25 at a time, if more specified it will send multiple batches
//
// Example
//
//          var ops = [ { op: "add", table: "bk_counter", obj: { id:1, like:1 } },
//                      { op: "del", table: "bk_user", obj: { login: "test1" } },
//                      { op: "incr", table: "bk_counter", obj: { id:2, like:1 } },
//                      { op: "add", table: "bk_user", obj: { login: "test2", id:2, name:"test2" } }]
//          db.bulk(ops, { pool: "elasticsearch" }, lib.log);
//
db.bulk = function(list, options, callback)
{
    if (typeof options == "function") callback = options,options = null;
    var req = this.prepare("bulk", "", list, options);
    this.query(req, req.options, callback);
}
db.abulk = util.promisify(db.bulk.bind(db));

// Same as the `db.bulk` but in transaction mode, all operations must succeed or fail. Not every driver can support it,
// in DynamoDB case only 10 operations can be done at the same time, if the list is larger then it will be sequentially run with batches of 25 records.
//
// In case of error the second arg will contain the records of the failed batch
//
db.transaction = function(list, options, callback)
{
    if (typeof options == "function") callback = options,options = null;
    var req = this.prepare("bulk", "", list, options);
    req.options.transaction = 1;
    this.query(req, req.options, callback);
}
db.atransaction = util.promisify(db.transaction.bind(db));

// Convenient helper for scanning a table for some processing, rows are retrieved in batches and passed to the callback until there are no more
// records matching given criteria. The obj is the same as passed to the `db.select` method which defined a condition which records to get.
// The rowCallback must be present and is called for every row or batch retrieved and second parameter which is the function to be called
// once the processing is complete. At the end, the callback will be called just with 1 argument, err, this indicates end of scan operation.
// Basically, db.scan is the same as db.select but can be used to retrieve large number of records in batches and allows async processing of such records.
// To hint a driver that scanning is in progress the `options.scanning` will be set to true.
//
// Parameters:
//  - table - table to scan
//  - query - an object with query conditions, same as in `db.select`
//  - options - same as in `db.select`, with the following additions:
//    - count - size of every batch, default is 100
//    - limit - total number of records to scan
//    - start - the primary key to start the scan from
//    - search - use search instead of select, for ElasticSearch,...
//    - batch - if true rowCallback will be called with all rows from the batch, not every row individually, batch size is defined by the count property
//    - sync - as batch mode but the rowCallback is called synchronously as `rowCallback(row, info)`
//    - concurrency - how many rows to process at the same time, if not given process sequentially
//    - noscan - if 1 no scan will be performed if no primary keys are specified
//    - emptyscan - if 0 no empty scan will be performed when no table columns in the query to be used as a filter
//    - fullscan - if 1 force to scan full table without using any primary key conditons, use all query properties for all records (DynamoDB)
//    - useCapacity - triggers to use specific capacity, default is `read`
//    - factorCapacity - a factor to apply for the read capacity limit and triggers the capacity check usage, default is `0.9`
//    - tableCapacity - use a different table for capacity throttling instead of the `table`, useful for cases when the row callback performs
//       writes into that other table and capacity is different
//    - capacity - a full capacity object to pass to select calls
//  - rowCallback - process records when called like this `callback(rows, next, info)
//  - endCallback - end of scan when called like this: `callback(err)
//
//  Example:
//
//          db.scan("bk_user", {}, { count: 10, pool: "dynamodb" }, function(row, next) {
//              // Copy all accounts from one db into another
//              db.add("bk_user", row, { pool: "pg" }, next);
//          }, function(err) { });
//
db.scan = function(table, query, options, rowCallback, endCallback)
{
    if (typeof options == "function") endCallback = rowCallback, rowCallback = options, options = null;

    options = lib.objClone(options);
    options.count = lib.toNumber(options.count, { dflt: 100 });
    options.concurrency = lib.toNumber(options.concurrency, { min: 0 });
    var pool = this.getPool(options);
    if (pool.configOptions.requireCapacity || options.useCapacity || options.factorCapacity) {
        options.capacity = db.getCapacity(options.tableCapacity || table, { useCapacity: options.useCapacity || "read", factorCapacity: options.factorCapacity || 0.9 });
    }
    options.limit_count = 0;
    options.scanning = true;

    lib.whilst(
        function() {
            if (options.limit > 0 && options.limit_count >= options.limit) return false;
            return options.start !== null;
        },
        function(next) {
            if (options.limit > 0) options.count = Math.min(options.limit - options.limit_count, options.count);
            db[options.search ? "search" : "select"](table, query, options, (err, rows, info) => {
                if (err) return next(err);
                options.start = info.next_token || null;
                options.limit_count += rows.length;
                info.scan_count = options.limit_count;
                if (options.sync) {
                    rowCallback(rows, info);
                    next();
                } else
                if (options.batch) {
                    rowCallback(rows, next, info);
                } else
                if (options.concurrency) {
                    var cnt = 0;
                    lib.forEachLimit(rows, options.concurrency, (row, next2) => {
                        if (++cnt > lib.maxStackDepth) {
                            setImmediate(rowCallback, row, next2, info);
                            cnt = 0;
                        } else {
                            rowCallback(row, next2, info);
                        }
                    }, next, true);
                } else {
                    lib.forEachSeries(rows, (row, next2) => {
                        if (++cnt > lib.maxStackDepth) {
                            setImmediate(rowCallback, row, next2, info);
                            cnt = 0;
                        } else {
                            rowCallback(row, next2, info);
                        }
                    }, next, true);
                }
            });
        }, endCallback, true);
}
db.ascan = util.promisify(db.scan.bind(db));


// Copy records from one table to another between different DB pools or regions
//
// Parameters:
// - table - name of the table to copy
// - query - a query condition for the table
// - options properties
//   - sort - index to use for query
//   - minCapacity - capacity minimum for read/writes, it will override actual DB capacity
//   - factorCapacity - factor the actual capacity for reads/writes
//   - stopOnError - stop the copy on first DB error, otherwise ignore errors
//   - region - other region where to copy
//   - pool - other DB pool
//   - file - dump the data into a file as JSON
//   - preprocess - a function(table, row, options) to be called before the update, if it returns true the record will be skipped
//   - posprocess - a function(table, row, options, next) to be called after the record is copied, for recursive or joined cases
//   - reget - if set the actual record will read using db.get, for cases when db.scan returns only partial record as in DynamoDB cases with indexes
//   - incremental - if set, try to read the latest record in the other table and continue from there, uses `sort` index in desc order
//   - batch - a number of records to copy at once using the bulk operation
//   - syncMode - if set enabled the update mode in which all values are preserved and not pre-processed, default is 1
//   - updateOptions - pass options to update/bulk operations
db.copy = function(table, query, options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    options = lib.objClone(options);
    var count = 0, errors = 0, started = Date.now(), elapsed = Date.now();
    var cap = db.getCapacity(table, { pool: options.pool, factorCapacity: options.factorCapacity || 0.99, minCapacity: options.minCapacity });
    var qopts = { sort: options.sort, select: options.select, useCapacity: "read", factorCapacity: options.factorCapacity || 0.99, minCapacity: options.minCapacity };
    var uopts = lib.objMerge(options.updateOptions, { syncMode: lib.toNumber(options.syncMode, { dflt: 1 }), region: options.region, pool: options.pool, endpoint: options.endpoint, upsert: true });
    var file = options.file === 1 || options.file === true ? table + ".json" : options.file;
    logger.logger(options.logger || "debug", "copy:", table, query, options, "started:", cap.rateCapacity);

    lib.series([
        function(next) {
            if (!(options.region || file) && db.getPool(qopts) == db.getPool(uopts)) {
                return next({ status: 400, message: "no copy in the same pool" });
            }
            if (!options.incremental || file) return next();
            var keys = db.getIndexes(table)[options.sort] || db.getKeys(table);
            var sopts = lib.objMerge(uopts, { desc: 1, sort: options.sort, count: 1, first: 1 });
            db.select(table, query, sopts, (err, row) => {
                if (row) {
                    qopts.start = keys.reduce((a, b) => {a[b] = row[b]; return a}, {});
                }
                next();
            });
        },
        function(next) {
            if (options.batch > 0) {
                qopts.count = options.batch;
                qopts.batch = 1;
            }
            db.scan(table, query, qopts, function(row, next2) {
                if (options.progress && Date.now() - elapsed > options.progress) {
                    elapsed = Date.now();
                    logger.logger(options.logger || "debug", "copy:", table, query, options, "progress:", count, "records", errors, "errors", lib.toAge(started));
                }
                if (qopts.batch) {
                    lib.series([
                        function(next3) {
                            if (!options.reget) return next3();
                            db.join(table, row, (err, rc) => {
                                if (!err) row = rc;
                                next3();
                            });
                        },
                        function(next3) {
                            var rows = [];
                            for (var i in row) {
                                if (typeof options.preprocess == "function" && options.preprocess(table, row[i], options)) continue;
                                rows.push({ op: "put", table: table, obj: row[i], options: uopts });
                            }
                            if (file) {
                                return fs.appendFile(file, rows.map((x) => (lib.stringify(x.obj))).join("\n") + "\n", next3);
                            }
                            db.bulk(rows, uopts, function(err, rc) {
                                if (err && options.stopOnError) return next2(err);
                                if (!err) count += rows.length - rc.length; else errors++;
                                db.checkCapacity(cap, next3);
                            });
                        },
                        function(next3) {
                            if (typeof options.postprocess != "function") return next3();
                            var cnt = 0;
                            lib.forEachSeries(row, (r, next4) => {
                                if (++cnt > lib.maxStackDepth) {
                                    setImmediate(options.postprocess, table, r, options, next4);
                                    cnt = 0;
                                } else {
                                    options.postprocess(table, r, options, next4);
                                }
                            }, next3);
                        },
                    ], next2, true);
                } else {
                    lib.series([
                        function(next3) {
                            if (!options.reget) return next3();
                            db.get(table, row, (err, r) => {
                                if (r) row = r;
                                next3();
                            });
                        },
                        function(next3) {
                            if (typeof options.preprocess == "function" && options.preprocess(table, row, options)) return next3();
                            if (file) {
                                return fs.appendFile(file, lib.stringify(row) + "\n", next3);
                            }
                            db.update(table, row, uopts, function(err) {
                                if (err && options.stopOnError) return next2(err);
                                if (!err) count++; else errors++;
                                db.checkCapacity(cap, next3);
                            });
                        },
                        function(next3) {
                            if (typeof options.postprocess != "function") return next3();
                            options.postprocess(table, row, options, next3);
                        },
                    ], next2, true);
                }
            }, next);
        },
    ], (err) => {
        logger.logger(options.logger || "debug", "copy:", table, query, options, "done:", count, "records", errors, "errors", lib.toAge(started), err);
        lib.tryCall(callback, err);
    }, true);
}
db.acopy = util.promisify(db.copy.bind(db));

// Join the given list of records with the records from other table by primary key.
// The properties from the joined table will be merged with the original rows preserving the existing properties
//
// - options.keys defines custom primary key to use instead of table's primary key
// - options.keysMap - an object that defines which property should be used for a key in the given rows, this is
//   for cases when actual primary keys in the table are different from the rows properties.
// - options.columnsMap - save properties with a different name using this mapping object
// - options.existing is 1 then return only joined records.
// - options.override - joined table properties will replace the original table existing properties
// - options.attach - specifies a property name which will be used to attach joined record to the original record, no merging will occur, for
//    non-existing records an empty object will be attached
// - options.incr can be a list of property names that need to be summed up with each other, not overriden
// - options.nomerge - do not merge lists, just return new rows as is
//
// A special case when table is empty `db.join` just returns same rows to the callback, this is
// for convenience of doing joins on some conditions and trigger it by setting the table name or skip the join completely.
//
// Example:
//
//          db.join("bk_user", [{id:"123",key1:1},{id:"234",key1:2}], lib.log)
//          db.join("bk_user", [{aid:"123",key1:1},{aid:"234",key1:2}], { keysMap: { id: "aid" }}, lib.log)
//          db.join("bk_user", [{id:"123",state:"NY"},{id:"234",state:"VA"}], { columnsMap: { state: "astate" }}, lib.log)
//
db.join = function(table, rows, options, callback)
{
    if (!table) return lib.tryCall(callback, null, rows);
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = lib.empty;

    var map = {}, ids = [], jkeys = {}, cols = this.getColumns(table);
    var keys = [].concat(options.keys || db.getKeys(table, options));
    for (var p in cols) {
        if (cols[p].primary && Array.isArray(cols[p].join) && cols[p].unjoin) jkeys[p] = cols[p].join;
    }
    var mkeys = options.keysMap ? keys.map(function(x) { return options.keysMap[x] || x }) : keys;
    var rkeys = options.keysMap ? Object.keys(options.keysMap).reduce(function(x,y) { x[options.keysMap[y]] = y; return x }, {}) : null;
    rows.forEach((x) => {
        // We have to join columns to produce all primary keys for mapping
        for (var p in jkeys) {
            if (!x[p]) x[p] = jkeys[p].map((y) => (x[y])).join(cols[p].separator || db.separator)
        }
        var key = db.getQueryForKeys(mkeys, x, { keysMap: rkeys, noempty: 1 });
        var k = Object.keys(key).map((y) => (key[y])).join(db.separator);
        if (!k) return;
        if (!map[k]) {
            map[k] = [];
            ids.push(key);
        }
        map[k].push(x);
    });
    db.list(table, ids, options, (err, list, info) => {
        if (err || options.nomerge) {
            return lib.tryCall(callback, err, list || []);
        }
        list.forEach((x) => {
            for (var p in jkeys) {
                if (!x[p]) x[p] = jkeys[p].map((y) => (x[y])).join(cols[p].separator || db.separator)
            }
            var key = db.getQueryForKeys(keys, x);
            var k = Object.keys(key).map((y) => (key[y])).join(db.separator);
            if (map[k]) map[k].forEach((row) => {
                if (options.attach) {
                    row[options.attach] = x;
                } else {
                    for (var p in x) {
                        if (Array.isArray(options.incr) && options.incr.includes(p)) {
                            row[p] = (row[p] || 0) + x[p];
                        } else
                        if (options.columnsMap && options.columnsMap[p]) {
                            row[options.columnsMap[p]] = x[p];
                        } else
                        if (options.override || !row[p]) {
                            row[p] = x[p];
                        }
                    }
                }
                if (options.existing || options.attach) row.__1 = 1;
            });
        });
        // Remove not joined rows
        if (options.existing) {
            rows = rows.filter((x) => (x.__1)).map((x) => { delete x.__1; return x; });
        } else
        // Always attach even if empty
        if (options.attach) {
            for (const r of rows) {
                if (!r.__1) r[options.attach] = {};
                delete r.__1;
            }
        }
        lib.tryCall(callback, null, rows, info);
    });
}
db.ajoin = util.promisify(db.join.bind(db));


// Create a table using column definitions represented as a list of objects. Each column definition may
// contain the following properties:
// - `name` - column name
// - `type` - column type: int, bigint, real, string, now, counter or other supported type
// - `primary` - column is part of the primary key
// - `unique` - column is part of an unique key
// - `index` - column is part of an index, the value is a number for the column position in the index
// - `indexN` - additonal inxdexes where N is 1..5
// - `value` - default value for the column
// - `len` - column length
// - `max` - ignore the column if a `text`, `json` or `obj` value is greater than specified limit, unless `trunc` is provided
// - `trunc` - truncate the column value, the value will be truncated before saving into the DB, uses the `max` as the limit
// - `maxlist` - max number of items in the `list` or `array` column types
// - `pub` - columns is public, *this is very important property because it allows anybody to see it when used in the default API functions, i.e. anybody with valid
//    credentials can retrieve all public columns from all other tables, and if one of the other tables is account table this may expose some personal information,
//    so by default only a few columns are marked as public in the `bk_user` table*
// - `pub_admin` - a generic read permission requires `options.isAdmin` when used with `api.cleanResult`
// - `pub_staff` - a generic read permission requires `options.isStaff` when used with `api.cleanResult`
// - `pub_types` - a role or a list of roles which further restrict access to a public column to only users with specified roles
// - `priv_types` - a role or a list of roles which excplicitely deny access to a column for users with specified roles
// - `priv` - an opposite for the pub property, if defined this property should never be returned to the client by the API handlers
// - `auth` - this property will be set in `req.options.account` for access permissions checks when only options are available
// - `internal` - if set then this property can only be updated by admin/root or with `isInternal`` property, implemented by the `auth` module only
// - `hidden` - completely ignored by all update operations but could be used by the public columns cleaning procedure, if it is computed and not stored in the db
//    it can contain pub property to be returned to the client
// - `readonly` - only add/put operations will use the value, incr/update will not affect the value
// - `writeonly` - only incr/update can change this value, add/put will ignore it
// - `noresult` - delete this property from the result, mostly for joined artificial columns which used for indexes only
// - `random` - add a random number between 0 and this value, useful with type: "now"
// - `lower` - make string value lowercase
// - `upper` - make string value uppercase
// - `strip` - if a regexp perform replace on the column value before saving
// - `trim` - strim string value of whitespace
// - `cap` - capitalize into a title with lib.toTitle
// - `word` - if a number only save nth word from the value, split by `separator`
// - `clock` - for `now` type use high resolution clock in nanoseconds
// - `epoch` - for `now` type save as seconds since the Epoch, not milliseconds
// - `multiplier` - for numeric columns apply this multipliers before saving
// - `incrememnt` - for numeric columns add this value before saving
// - `decimal` - for numeric columns convert into fixed number using this number of decimals
// - `format` - a function (val, req) => {} that must return new value for the given column, for custom formatting
// - `prefix` - prefix to be prepended for autogenerated columns: `uuid`, `suud`, `tuud`
// - `separator` - to be used as a separator in join or split depending on the column properties
// - `list` - splits the column value into an array, optional `separator` property can be used, default separator is `,|`
// - `autoincr` - for counter tables, mark the column to be auto-incremented by the connection API if the connection type has the same name as the column name
// - `join` - a list with property names that must be joined together before performing a db operation, it will use the given record to produce new property,
//     this will work both ways, to the db and when reading a record from the db it will split joined property and assign individual
//     properties the value from the joined value. See `db.joinColumns` for more options.
// - `unjoin` - split the join column into respective columns on retrieval
// - `keepjoined` - keep the joined column value, if not specified the joined column is deleted after unjoined
// - `notempty` - do not allow empty columns, if not provided it is filled with the default value
// - `skip_empty` - ignore the column if the value is empty, i.e. null or empty string
// - `fail_ifempty` - returtn an error if there is no  value for the column, this is checked during record preprocessing
// - `values` - an array with allowed values, ignore the column if not present
// - `values_map` - an array of pairs to be checked for exact match and be replaced with the next item, ["", null, "", undefined, "null", ""]
//
// *Some properties may be defined multiple times with number suffixes like: `unique1, unique2, index1, index2` to create more than one index for the table, same
// properties define a composite key in the order of definition or sorted by the property value, for example: `{ a: { index:2 }, b: { index:1 } }` will create index (b,a)
// because of the `index:` property value being not the same. If all index properties are set to 1 then a composite index will use the order of the properties.*
//
// *Special column types*:
//  - `uuid` - autogenerate the column value with UUID, optional `prefix` property will be prepended, `{ type: "uuid", prefix: "u_" }`
//  - `now` - defines a column to be automatically filled with the current timestamp, `{ type: "now" }`
//  - `counter` - defines a columns that will be automatically incremented by the `db.incr` command, on creation it is set with 0
//  - `uid` - defines a columns to be automatically filled with the current user id, this assumes that account object is passed in the options from the API level
//  - `uname` - defines a columns to be automatically filled with the current user name, this assumes that account object is passed in the options from the API level
//  - `ttl` - mark the column to be auto expired, can be set directly to time in the future or use one of: `days`, `hours`, `minutes` as a interval in the future
//
// NOTE: Index creation is not required and all index properties can be omitted, it can be done more effectively using native tools for any specific database,
// this format is for simple and common use cases without using any other tools but it does not cover all possible variations for every database. But all indexes and
// primary keys created outside of the backend application will be detected properly by `db.cacheColumns` and by each pool `cacheIndexes` methods.
//
// Each database pool also can support native options that are passed directly to the driver in the options, these properties are
// defined in the object with the same name as the db driver, all properties are combined, for example to define provisioned throughput for the DynamoDB index:
//
//          db.create("test_table", { id: { primary: 1, type: "int", index: 1, dynamodb: { readCapacity: 50, writeCapacity: 50 } },
//                                    type: { primary: 1, pub: 1, projections: 1 },
//                                    name: { index: 1, pub: 1 } }
//                                  });
//
// Create DynamoDB table with global secondary index, the first index property if not the same as primary key hash defines global index, if it is the same then local,
// or if the second key column contains `global` property then it is a global index as well, below we create global secondary index on property 'name' only,
// in the example above it was local secondary index for id and name. Also a local secondary index is created on `id,title`.
//
// DynamoDB projection is defined by a `projections` property, can be a number/boolean or an array with index numbers:
//
//          db.create("test_table", { id: { primary: 1, type: "int", index1: 1 },
//                                    type: { primary: 1, projections: [0] },
//                                    name: { index: 1, projections: 1 },
//                                    title: { index1: 1, projections: [1] } },
//                                    descr: { index: 1, projections: [0, 1] },
//                                  });
//  When using real DynamoDB creating a table may take some time, for such cases if `options.waitTimeout` is not specified it defaults to 1min,
//  so the callback is called as soon as the table is active or after the timeout whichever comes first.
//
//
// Pass MongoDB options directly:
//        db.create("test_table", { id: { primary: 1, type: "int", mongodb: { w: 1, capped: true, max: 100, size: 100 } },
//                                  type: { primary: 1, pub: 1 },
//                                  name: { index: 1, pub: 1, mongodb: { sparse: true, min: 2, max: 5 } }
//                                });
db.create = function(table, columns, options, callback)
{
    if (typeof options == "function") callback = options,options = null;
    var req = this.prepare("create", table, columns, options);
    this.query(req, options, callback);
}
db.acreate = util.promisify(db.create.bind(db));

// Upgrade a table with missing columns from the definition list, if after the upgrade new columns must be re-read from the database
// then `info.affected_rows` must be non zero.
db.upgrade = function(table, columns, options, callback)
{
    if (typeof options == "function") callback = options,options = null;
    var req = this.prepare("upgrade", table, columns, options);
    this.query(req, req.options, callback);
}
db.aupgrade = util.promisify(db.upgrade.bind(db));

// Drop a table
db.drop = function(table, options, callback)
{
    if (typeof options == "function") callback = options,options = null;
    if (lib.testRegexpObj(this.skipDrop, table)) return lib.tryCall(callback, "skip-drop");

    var req = this.prepare("drop", table, {}, options);
    this.query(req, req.options, (err, rows, info) => {
        // Clear the table cache
        if (!err) {
            var pool = db.getPool(options);
            delete pool.dbcolumns[table];
            delete pool.dbkeys[table];
            delete pool.dbindexes[table];
        }
        lib.tryCall(callback, err, rows, info);
    });
}
db.adrop = util.promisify(db.drop.bind(db));

// Execute arbitrary SQL-like statement if the pool supports it, values must be an Array with query parameters or can be omitted.
//
// Example:
//
//       db.sql("SELECT * FROM bk_property WHERE value=? LIMIT 1", [1], { pool: "sqlite", count: 10 }, lib.log)
//       db.sql("SELECT * FROM bk_property", { pool: "dynamodb" }, lib.log)
//       db.sql("SELECT * FROM bk_property", { pool: "dynamodb", count: 10 }, lib.log)
//
db.sql = function(text, values, options, callback)
{
    if (!Array.isArray(values)) callback = options, options = values, values = null;
    if (typeof options == "function") callback = options,options = null;
    var req = this.prepare("sql", "", "", options);
    req.text = text;
    req.values = values;
    this.query(req, req.options, callback);
}
db.asql = util.promisify(db.sql.bind(db));

db.bkCollectStats = function(options)
{
    for (let pool in this.pools) {
        pool = this.pools[pool];
        if (!pool.configOptions?.metrics) continue;

        const m = metrics.toJSON(pool.metrics, { reset: 1 });
        if (!m.req?.meter?.count) continue;

        for (const p in m) {
            if (typeof m[p] == "number" && p.endsWith("_count")) {
                options.stats["db_" + pool.name + "_" + p] = metrics.take(pool.metrics, p);
            }
        }
        options.stats["db_" + pool.name + "_req_count"] = m.req.meter.count;
        options.stats["db_" + pool.name + "_req_rate"] = m.req.meter.rate;
        options.stats["db_" + pool.name + "_res_time"] = m.req.histogram.med;
        options.stats["db_" + pool.name + "_que_size"] = m.que?.med;
        options.stats["db_" + pool.name + "_cache_time"] = m.cache?.med;
        for (const p in m.tables) {
            options.stats["db_" + pool.name + "_" + p + "_read_count"] = m.tables[p].read?._count;
            options.stats["db_" + pool.name + "_" + p + "_read_rate"] = m.tables[p].read?.currentRate();
            options.stats["db_" + pool.name + "_" + p + "_write_count"] = m.tables[p].write?._count;
            options.stats["db_" + pool.name + "_" + p + "_write_rate"] = m.tables[p].write?.currentRate();
        }
    }
}

require(__dirname + "/db/config")
require(__dirname + "/db/pools")
require(__dirname + "/db/prepare")
require(__dirname + "/db/sql")
require(__dirname + "/db/cache")
require(__dirname + "/db/utils")
require(__dirname + "/db/sqlite")
require(__dirname + "/db/dynamodb")
require(__dirname + "/db/elasticsearch")
require(__dirname + "/db/pg")

