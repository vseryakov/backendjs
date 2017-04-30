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
var logger = require(__dirname + '/logger');
var core = require(__dirname + '/core');
var lib = require(__dirname + '/lib');
var ipc = require(__dirname + '/ipc');
var aws = require(__dirname + '/aws');
var cluster = require('cluster');
var os = require('os');
var metrics = require(__dirname + "/metrics");
var bkcache = require('bkjs-cache');

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
//          db.get("bk_account", { id: "123" }, { pool: "pgsql" }, function(err, row) {
//              if (row) db.update("bk_account", row);
//          });
//
// Most database pools can be configured with options `min` and `max` for number of connections to be maintained, so no overload will happen and keep warm connection for
// faster responses. Even for DynamoDB which uses HTTPS this can be configured without hitting provisioned limits which will return an error but
// put extra requests into the waiting queue and execute once some requests finished.
//
//  Example:
//
//          db-pgsql-pool-max = 100
//          db-dynamodb-pool-max = 100
//
// Also, to spread functionality between different databases it is possible to assign some tables to the specific pools using `db-X-pool-tables` parameters
// thus redirecting the requests to one or another databases depending on the table, this for example can be useful when using fast but expensive
// database like DynamoDB for real-time requests and slower SQL database running on some slow instance for rare requests, reports or statistics processing.
//
//  Example, run the backend with default PostgreSQL database but keep all config parametrs in the DynamoDB table for availability:
//
//          db-pool = pgsql
//          db-dynamodb-pool = default
//          db-dynamodb-pool-tables = bk_config
//
//
// The following databases are supported with the basic db API methods:
// Sqlite, PostgreSQL, MySQL, DynamoDB, MongoDB, Elasticsearch, Cassandra, Redis, LMDB, LevelDB, Riak, CouchDB
//
// All these drivers fully support all methods and operations, some natively, some with emulation in the user space except Redis driver cannot perform sorting
// due to using Hash items for records, sorting can be done in memory but with pagination it is not possible so this part must be mentioned specifically. But the rest of the
// operations on top of Redis are fully supported which makes it a good candidate to use for in-memory tables like sessions with the same database API, later moving to
// other database will not require any application code changes.
//
// Multiple connections of the same type can be opened, just add -n suffix to all database config parameters where n is a number, referer to such pools in the code as `poolN`.
//
// Example:
//
//          db-sqlite1-pool = billing
//          db-sqlite1-pool-max = 10
//          db-sqlite1-pool-options-path = /data/db
//          db-sqlite1-pool-options-journal_mode = OFF
//
//          in the Javascript:
//
//          db.select("bills", { status: "ok" }, { pool: "sqlite1" }, lib.log)
//
var db = {
    name: 'db',

    // Config parameters
    args: [{ name: "pool", dns: 1, descr: "Default pool to be used for db access without explicit pool specified" },
           { name: "name", key: "db-name", descr: "Default database name to be used for default connections in cases when no db is specified in the connection url" },
           { name: "create-tables", key: "_createTables", type: "bool", nocamel: 1, master: 1, pass: 1, descr: "Create tables in the database or perform table upgrades for new columns in all pools, only master processes can perform this operation, never workers" },
           { name: "cache-tables", array: 1, type: "list", descr: "List of tables that can be cached: bk_auth, bk_counter. This list defines which DB calls will cache data with currently configured cache. This is global for all db pools." },
           { name: "describe-tables", type: "callback", callback: function(v) { this.describeTables(lib.jsonParse(v, {datatype:"obj",logger:"error"})) }, descr: "A JSON object with table descriptions to be merged with the existing definitions" },
           { name: "cache-ttl", type: "int", obj: "cacheTtl", key: "default", descr: "Default global TTL for cached tables", },
           { name: "cache-ttl-(.+)", type: "int", obj: "cacheTtl", nocamel: 1, strip: /cache-ttl-/, descr: "TTL in milliseconds for each individual table being cached", },
           { name: "cache-name-(.+)", obj: "cacheName", nocamel: 1, strip: /cache-name-/, descr: "Cache client name to use for each table instead of the default in order to split cache usage for different tables, it can be just a table name or `pool.table`", },
           { name: "cache2-(.+)", obj: "cache2", type: "int", nocamel: 1, strip: /cache2-/, min: 50, descr: "Tables with TTL for level2 cache, i.e. in the local process LRU memory. It works before the primary cache and keeps records in the local LRU cache for the giben amount of time, the TTL is in ms and must be greater than zero for level 2 cache to work. Make sure `ipc-lru-max-` is properly configured for each process role" },
           { name: "jscache2-(.+)", obj: "jscache2", type: "int", nocamel: 1, strip: /jscache2-/, min: 50, descr: "Same as cache2 but keeps references to the actual objects in the heap" },
           { name: "jscache2-max", type:" int", min: 0, descr: "Max number of items to keep in the Javascript Level 2 cache" },
           { name: "local", descr: "Local database pool for properties, cookies and other local instance only specific stuff" },
           { name: "config", descr: "Configuration database pool to be used to retrieve config parameters from the database, must be defined to use remote db for config parameters, set to `default` to use current default pool" },
           { name: "config-interval", type: "number", min: 0, descr: "Interval between loading configuration from the database configured with -db-config, in minutes, 0 disables refreshing config from the db" },
           { name: "cache-columns-interval", type: "int", descr: "How often in minutes to refresh tables columns from the database, it calls cacheColumns for each pool which supports it" },
           { name: "([a-z0-9]+)-pool$", obj: 'poolParams.$1', make: "url", novalue: "default", descr: "A database pool name, depending on the driver it can be an URL, name or pathname, examples of db pools: ```-db-pgsql-pool, -db-dynamodb-pool```, examples of urls: ```postgresql://[user:password@]hostname[:port]/db, mysql://[user:password@]hostname/db, mongodb://hostname[:port]/dbname, cql://[user:password@]hostname[:port]/dbname```" },
           { name: "([a-z0-9]+)-pool-(max)$", obj: 'poolParams.$1', make: "$2", type: "number", min: 1, descr: "Max number of open connections for a pool, default is Infinity" },
           { name: "([a-z0-9]+)-pool-(min)$", obj: 'poolParams.$1', make: "$2", type: "number", min: 1, descr: "Min number of open connections for a pool" },
           { name: "([a-z0-9]+)-pool-(idle)$", obj: 'poolParams.$1', make: "$2", type: "number", min: 1000, descr: "Number of ms for a db pool connection to be idle before being destroyed" },
           { name: "([a-z0-9]+)-pool-tables$", obj: 'poolTables', strip: /PoolTables/, type: "list", reverse: 1, descr: "A DB pool tables, list of tables that belong to this pool only" },
           { name: "([a-z0-9]+)-pool-(connect)$", obj: 'poolParams.$1', make: "$2", type: "json", descr: "Connect options for a DB pool driver for new connection, driver specific" },
           { name: "([a-z0-9]+)-pool-options-([a-zA-Z0-9_\.-]+)$", obj: 'poolParams.$1.configOptions', camel: '-', autotype: 1, make: "$2", onparse: function(v,o) {this.parsePoolOptions(v,o)}, descr: "General options for a DB pool" },
           { name: "([a-z0-9]+)-pool-(cache-columns)$", obj: 'poolParams.$1.configOptions', make: "$2", type: "bool", descr: "Enable caching table columns for this pool if it supports it" },
           { name: "([a-z0-9]+)-pool-(create-tables)$", master: 1, obj: 'poolParams.$1.configOptions', make: "$2", type: "bool", descr: "Create tables for this pool on startup" },
           { name: "([a-z0-9]+)-pool-cache2-(.+)", obj: 'cache2', nocamel: 1, strip: /pool-cache2-/, type: "int", descr: "Level 2 cache TTL for the specified pool and table, data is JSON strings in the LRU cache" },
           { name: "([a-z0-9]+)-pool-jscache2-(.+)", obj: 'jscache2', nocamel: 1, strip: /pool-jscache2-/, type: "int", descr: "Level 2 cache TTL for the specified pool and table, data is Js objects in the heap" },
    ],

    // Database drivers
    modules: [],

    // Database connection pools by pool name
    pools: {},

    // Configuration parameters
    poolParams: { none: {}, sqlite: { idle: 900000 } },

    // Default database name
    dbName: "backend",

    // Pools by table name
    poolTables: {},

    // Tables to be cached
    cacheTables: [],
    cacheName: {},
    cacheTtl: {},

    // Level 2 cache objects
    cache2: {},
    jscache2: {},
    jscache2Max: 1000,
    jsCache2: {},

    // Default database pool for the backend
    pool: 'sqlite',

    // Local db pool, sqlite is default, used for local storage by the core
    local: 'sqlite',

    // Refresh config from the db
    configInterval: 1440,
    // List of records to be refreshed after ttl expires
    configRefresh: {},

    // Refresh columns from time to time to have the actual table columns
    cacheColumnsInterval: 1440,

    processRows: {},
    processColumns: [],

    // Separator to combined columns
    separator: "|",

    // Translation map for similar operators from different database drivers, merge with the basic SQL mapping
    sqlConfigOptions: {
        sql: true,
        schema: [],
        noAppend: 1,
        typesMap: { uuid: 'text', counter: "int", bigint: "int", now: "int", smallint: "int" },
        opsMap: { begins_with: 'like%', ne: "<>", eq: '=', le: '<=', lt: '<', ge: '>=', gt: '>' },
        keywords: ['ABORT','ACTION','ADD','AFTER','ALL','ALTER','ANALYZE','AND','AS','ASC','ATTACH','AUTOINCREMENT','BEFORE','BEGIN','BETWEEN',
            'BY','CASCADE','CASE','CAST','CHECK','COLLATE','COLUMN','COMMIT','CONFLICT','CONSTRAINT','CREATE','CROSS','CURRENT_DATE',
            'CURRENT_TIME','CURRENT_TIMESTAMP','DATABASE','DEFAULT','DEFERRABLE','DEFERRED','DELETE','DESC','DETACH','DISTINCT','DROP',
            'EACH','ELSE','END','ESCAPE','EXCEPT','EXCLUSIVE','EXISTS','EXPLAIN','FAIL','FOR','FOREIGN','FROM','FULL','GLOB','GROUP',
            'HAVING','IF','IGNORE','IMMEDIATE','IN','INDEX','INDEXED','INITIALLY','INNER','INSERT','INSTEAD','INTERSECT','INTO',
            'IS','ISNULL','JOIN','KEY','LEFT','LIKE','LIMIT','MATCH','NATURAL','NO','NOT','NOTNULL','NULL','OF','OFFSET','ON','OR',
            "ORDER","OUTER","PLAN","PRAGMA","PRIMARY","QUERY","RAISE","RECURSIVE","REFERENCES","REGEXP","REINDEX","RELEASE","RENAME",
            "REPLACE","RESTRICT","RIGHT","ROLLBACK","ROW","SAVEPOINT","SELECT","SET","TABLE","TEMP","TEMPORARY","THEN","TO","TRANSACTION",
            "TRIGGER","UNION","UNIQUE","UPDATE","USING","VACUUM","VALUES","VIEW","VIRTUAL","WHEN","WHERE","WITH","WITHOUT",
        ],
    },

    // Table definitions, all tables form all modules eventually end up here with all columns merged
    tables: {
        // Configuration store, same parameters as in the commandline or config file, can be placed in separate config groups
        // to be used by different backends or workers
        bk_config: {
            name: { primary: 1 },            // name of the parameter
            type: { primary: 1 },            // config type or tag
            value: {},                       // the value
            status: { value: "ok" },         // ok - availaible
            ttl: { type: "int" },            // refresh interval in seconds since last read
            mtime: { type: "now" }
        },

        // General purpose properties, can be used to store arbitrary values
        bk_property: {
            name: { primary: 1 },
            value: {},
            ttl: { type: "int" },            // time to live, seconds since last update
            mtime: { type: "now" }
        },

    }, // tables

    // Computed primary keys and indexes from the table definitons
    keys: {},
    indexes: {},
};

module.exports = db;

// None database driver
db.modules.push({ name: "none", createPool: function(opts) { return new db.Pool(opts) } });

// Initialize all database pools. the options may containt the following properties:
//  - localTables - only initialize default, local and config db pools, other pools are ignored, if not given
//     global value is used. Currently it can be set globally from the app only, no config parameter.
//  - createTables - if true then create new tables or upgrade tables with new columns
db.init = function(options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    // Important parameters that can persist until cleared
    if (options) {
        ["localTables","createTables"].forEach(function(x) {
            if (typeof options[x] != "undefined") this["_" + x] = options[x];
        });
    }

    // Merge all tables from all modules
    for (var p in core.modules) {
        if (p != this.name && lib.isObject(core.modules[p].tables)) this.describeTables(core.modules[p].tables);
    }

    logger.debug("dbinit:", core.role, Object.keys(this.poolParams), Object.keys(this.pools));

    // Periodic columns refresh
    var interval = this.cacheColumnsInterval ? this.cacheColumnsInterval * 60000 + lib.randomShort() : 0;
    lib.deferInterval(this, interval, "columns", this.refreshColumns.bind(this));

    // Configured pools for supported databases
    lib.forEachSeries(Object.keys(this.poolParams), function(name, next) {
        if (db._localTables && name != db.pool && name != db.local && name != db.config) return next();

        var params = db.poolParams[name];
        params.pool = name;
        params.type = name.replace(/[0-9]/, "");
        logger.debug('dbinit:', core.role, params);

        // Do not re-create the pool if not forced, just update the properties
        if (db.pools[name] && (!options || !options.force) && (!params.url || params.url == db.pools[name].url)) {
            db.pools[name].configure(params);
            return next();
        }

        // Create a new pool for the given database driver
        var mod = db.modules.filter(function(x) { return x.name == params.type } ).pop();
        if (!mod) {
            logger.error("dbinit:", core.role, name, "invalid pool type");
            return next();
        }
        var old = db.pools[name];
        try {
            var pool = mod.createPool(params);
        } catch(e) {
            logger.error("dbinit:", core.role, params, e.stack);
            return next();
        }
        db.pools[name] = pool;
        if (old) old.shutdown();

        logger.debug('dbinit:', core.role, params);

        if (cluster.isMaster && (db._createTables || pool.configOptions.createTables)) return db.createTables(name, function() { next() });
        if (pool.configOptions.cacheColumns) return db.cacheColumns(name, function() { next() });
        next();
    }, callback);
}

// Load configuration from the config database, must be configured with `db-config-type` pointing to the database pool where bk_config table contains
// configuration parameters.
//
// The priority of the paramaters is fixed and goes from the most broad to the most specific, most specific always wins, this allows
// for very flexible configuration policies defined by the app or place where instances running and separated by the run mode.
//
// The following list of properties will be queried from the config database and the sorting order is very important, the last values
// will override values received for the earlier properties, for example, if two properties defined in the `bk_config` table with the
// types `myapp` and `prod-myapp`, then the last value will be used only.
//
// The major elements are the following:
//  - the run mode specified in the command line `-run-mode: production`
//  - the application name from the package.json: `myapp`
//  - the process role: `-worker`
//  - the instance tag, AWS name tag or other name: `-nat`
//
// The modifiers which are appended to each major attributes:
//  - the network where the instance is running, first 2 octets from the current IP address: `-192.168`
//  - the region where the instance is running, AWS region or other: `us-east-1`
//  - the zone where the instance is running, AWS availability zone or other: `-us-east-1a`
//
// The top level list is the following:
// - runMode
// - appName
// - runMode-appName
// - runMode-role
// - runMode-tag
// - runMode-appName-role
// - runMode-appName-tag
//
// All modifiers are appended for every item in the list like `runMode-network`, `runMode-appName-tag-region`,...
//
// The options takes the following properties:
//  - force - if true then force to refresh and reopen all db pools
//  - delta - if true then pull only records updated since the last config pull using the max mtime from received records.
//  - table - a table where to read the config parameters, default is bk_config
//
// **NOTE: The config parameters from the DB always take precedence even over config.local.**
//
// On return, the callback second argument will receive all parameters received form the database as a list: -name value ...
db.initConfig = function(options, callback)
{

    if (typeof options == "function") callback = options, options = null;

    // The order of the types here defines the priority of the parameters, most specific at the end always wins
    var types = [], argv = [];

    // All other entries in order of priority with all common prefixes
    var attrs = [ core.runMode,
                  core.appName,
                  core.runMode + "-" + core.appName,
                  core.runMode + "-" + (options && options.role || core.role || ""),
                  core.runMode + "-" + (options && options.tag || core.instance.tag || ""),
                  core.runMode + "-" + core.appName + "-" + (options && options.role || core.role || ""),
                  core.runMode + "-" + core.appName + "-" + (options && options.tag || core.instance.tag || ""),
            ];
    var mods = [ options && options.network || core.network,
                 options && options.region || core.instance.region,
                 options && options.zone || core.instance.zone ];

    attrs.forEach(function(x) {
        if (!x) return;
        x = String(x).trim();
        if (!x || x.slice(-1) == "-") return;
        types.push(x);
        for (var i in mods) {
            if (mods[i]) types.push(x + "-" + mods[i]);
        }
    });
    // Make sure we have only unique items in the list, skip empty or incomplete items
    types = lib.strSplitUnique(types);

    logger.debug("initConfig:", core.role, this.config, types, this._configMtime || 0, options);

    // Refresh from time to time with new or modified parameters, randomize a little to spread across all servers.
    // Do not create/upgrade tables and indexes when reloading the config, this is to
    // avoid situations when maintenance is being done and any process reloading the config may
    // create indexes/columns which are not missing but being provisioned or changed.
    var interval = db.configInterval ? db.configInterval * 60000 + lib.randomShort() : 0;
    lib.deferInterval(this, interval, "config", this.initConfig.bind(this, interval ? options : null));
    lib.deferInterval(this, 60000, "refresh", this.refreshConfig.bind(this, options));

    var query = { type: types, mtime: options && options.delta ? this._configMtime : 0, status: "ok" };
    var opts = { ops: { type: "in", mtime: "gt" }, pool: options && options.pool || this.config };
    var table = options && options.table || "bk_config";
    this.select(table, query, opts, function(err, rows) {
        if (err) return lib.tryCall(callback, err, []);

        // Sort inside to be persistent across databases
        rows.sort(function(a,b) { return types.indexOf(b.type) - types.indexOf(a.type); });
        logger.dev("initConfig:", core.role, rows);

        // Testing mode just return all retrieved sorted rows
        if (options && options.test) return lib.tryCall(callback, null, rows)

        // Only keep the most specific value, it is sorted in descendent order most specific at the top
        var args = {};
        rows.forEach(function(x) {
            db._configMtime = Math.max(db._configMtime || 0, x.mtime);
            if (args[x.name]) return;
            args[x.name] = 1;
            argv.push('-' + x.name);
            if (x.value) argv.push(x.value);
            if (x.ttl > 0) {
                db.configRefresh[x.type+"|"+x.name] = x.ttl*1000 + Date.now();
            } else {
                delete db.configRefresh[x.type+"|"+x.name];
            }
        });
        core.parseArgs(argv);

        // Create or reconfigure db pools if needed
        db.init(options, function(err) {
            lib.tryCall(callback, err, argv);
        });
    });
}

// Refresh parameters which are configured with a TTL
db.refreshConfig = function(options, callback)
{

    var now = Date.now();
    var list = Object.keys(this.configRefresh).reduce(function(l, x) {
        if (db.configRefresh[x] > 0 && db.configRefresh[x] <= now) {
            x = x.split("|");
            l.push({ type: x[0], name: x[1] });
        }
        return l;
    }, []);
    if (!list.length) return lib.tryCall(callback);
    var table = options && options.table || "bk_config";
    var pool = options && options.pool || this.config;
    this.list(table, list, { pool: pool }, function(err, rows) {
        var argv = rows.reduce(function(l, x) {
            l.push('-' + x.name);
            if (x.value) l.push(x.value);
            if (x.ttl > 0) {
                db.configRefresh[x.type+"|"+x.name] = x.ttl*1000 + now;
            } else {
                delete db.configRefresh[x.type+"|"+x.name];
            }
            return l;
        }, []);
        core.parseArgs(argv);
        lib.tryCall(callback, err, argv);
    });
}

// Create or upgrade the tables for the given pool
db.createTables = function(options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (typeof options == "string") options = { pool: options };

    var pool = db.getPool('', options);
    var changed = [];
    logger.info("createTables:", core.role, pool.name, pool.configOptions);

    lib.series([
      function(next) {
          db.cacheColumns(pool.name, next);
      },
      function(next) {
          lib.forEachSeries(Object.keys(db.tables), function(table, next2) {
              // We if have columns, SQL table must be checked for missing columns and indexes
              var cols = pool.dbcolumns[table];
              if (!cols) {
                  db.create(table, db.tables[table], options, function(err, rows, info) {
                      if (!err && info.affected_rows) changed.push(table);
                      next2();
                  });
              } else {
                  // Refreshing columns after an upgrade is only required by the driver which depends on
                  // the actual db schema, in any case all columns are merged so no need to re-read just the columns,
                  // the case can be to read new indexes used in searches, this is true for DynamoDB.
                  db.upgrade(table, db.tables[table], options, function(err, rows, info) {
                      if (!err && info.affected_rows) changed.push(table);
                      next2();
                  });
              }
          }, next);
      },
      function(next) {
          if (!changed.length) return next();
          logger.info('createTables:', core.role, pool.name, 'changed:', changed);
          if (pool.configOptions.cacheColumns) return db.cacheColumns({ pool: pool.name, tables: changed }, next);
          next();
      },
    ], callback);
}

// Delete all specified tables from the pool, if `name` is empty then default pool will be used, `tables` is an object with table names as
// properties, same table definition format as for create table method
db.dropTables = function(tables, options, callback)
{

    if (typeof options == "function") callback = options, options = null;

    var pool = db.getPool('', options);
    lib.forEachSeries(Object.keys(tables || lib.empty), function(table, next) {
        db.drop(table, options, function() { next() });
    }, callback);
}

// Execute query using native database driver, the query is passed directly to the driver.
// - req - can be a string or an object with the following properties:
//   - text - SQL statement or other query in the format of the native driver, can be a list of statements
//   - values - parameter values for SQL bindings or other driver specific data
//   - op - operations to be performed, used by non-SQL drivers
//   - obj - actual object with data for non-SQL drivers
//   - table - table name for the operation
// - options may have the following properties:
//     - pool - name of the database pool where to execute this query.
//       The difference with the high level functions that take a table name as their firt argument, this function must use pool
//       explicitely if it is different from the default. Other functions can resolve
//       the pool by table name if some tables are assigned to any specific pool by configuration parameters `db-pool-tables`.
//     - unique - perform sorting the result and eliminate any duplicate rows by the column name specified in the `unique` property
//     - filter - function to filter rows not to be included in the result, return false to skip row, args are: function(req, row, options)
//     - quiet - do not report about the error in the log, still the error is returned to the caller
//     - ignore_error - clear any error occured as it never happen, do not report in the log
//     - noprocessrows - if true then skip post processing result rows, return the data as is, this will result in returning combined columns as it is
//     - noconvertrows - if true skip converting the data from the database format into Javascript data types, it uses column definitions
//       for the table to convert values returned from the db into the the format defined by the column
//     - cached - if true perform cache invalidation for the operations that resulted in modification of the table record(s)
//     - total - if true then it is supposed to return only one record with property `count`, skip all post processing and convertion
//     - info_obj - to return the record just processed in the info object as `obj` property, it will include all generated and updated columns
// - callback(err, rows, info) where
//    - info is an object with information about the last query: inserted_oid,affected_rows,next_token,consumed_capacity
//    - rows is always returned as a list, even in case of error it is an empty list
//
//  Example with SQL driver
//
//          db.query({ text: "SELECT a.id,c.type FROM bk_account a,bk_connection c WHERE a.id=c.id and a.id=?", values: ['123'] }, { pool: 'pgsql' }, function(err, rows, info) {
//          });
//
db.query = function(req, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!lib.isObject(req)) return typeof callback == "function" && callback(lib.newError("invalid request"));

    req.table = req.table || "";
    req.options = options || req.options;
    var pool = this.getPool(req.table, req.options);
    // For postprocess callbacks
    req.pool = pool.name;

    // Metrics collection
    req._timer = pool.metrics.Timer('que').start();
    pool.metrics.Histogram('req').update(pool.metrics.Counter('count').inc());
    pool.metrics.Counter('req_0').inc();

    pool.acquire(function dbQuery(err, client) {
        if (err) return db.queryEnd(err, req, null, callback);
        try {
            db.queryRun(pool, client, req, callback);
        } catch(e) {
            db.queryEnd(e, req, null, callback);
        }
    });
}

db.queryRun = function(pool, client, req, callback)
{
    req.client = client;
    pool.query(client, req, req.options, function(err, rows, info) {
        req.info = info || {};
        rows = rows || [];
        if (!err) {
            if (!req.info.affected_rows) req.info.affected_rows = client.affected_rows || 0;
            if (!req.info.inserted_oid) req.info.inserted_oid = client.inserted_oid || null;
            if (!req.info.next_token) req.info.next_token = pool.nextToken(client, req, rows);
            if (!req.info.consumed_capacity) req.info.consumed_capacity = client.consumed_capacity || 0;

            pool.release(client);
            delete req.client;

            rows = db.queryResult(err, req, rows);
        }
        db.queryEnd(err, req, rows, callback);
    });
}

db.queryEnd = function(err, req, rows, callback)
{
    var pool = this.pools[req.pool];
    pool.metrics.Counter('count').dec();
    req.elapsed = req._timer.end();
    delete req._timer;

    if (req.client) {
        pool.release(req.client);
        delete req.client;
    }
    var options = req.options || lib.empty;
    if (!Array.isArray(rows)) rows = [];
    if (err) {
        pool.metrics.Counter("err_0").inc();
        logger[options.quiet ? "debug" : "error"]("queryError:", req.pool, err, 'REQ:', req.op, req.table, req.obj, req.text, req.values, 'OPTS:', req.options, req.info, lib.traceError(err));
    } else {
        logger.debug("queryEnd:", req.pool, req.elapsed, 'ms', rows.length, 'rows', 'REQ:', req.op, req.table, req.obj, req.values, 'OPTS:', req.options, err);
    }
    if (err && options.ignore_error) err = null;
    if (err) err = this.convertError(pool, req.table, req.op || "", err, req.options);

    var info = req.info;
    if (options.info_obj) {
        if (!info) info = {};
        info.obj = req.obj;
    }
    for (var p in req) delete req[p];

    if (typeof callback == "function") {
        lib.tryCatch(callback, err, rows, info || req);
    }
}

db.queryResult = function(err, req, rows)
{
    var options = req.options || lib.empty;
    // With total we only have one property 'count'
    if (options.total) return rows;

    // Cache notification in case of updates, we must have the request prepared by the db.prepare
    var cached = options.cached || this.cacheTables.indexOf(req.table) > -1;
    if (cached && req.table && req.obj && req.op && ['put','update','incr','del'].indexOf(req.op) > -1) {
        if (options.returning == "*" && rows.length && req.op != "del") {
            this.putCache(req.table, rows[0], options);
        } else {
            this.delCache(req.table, req.obj, options);
        }
    }

    // Make sure no duplicates
    if (options.unique) {
        rows = lib.arrayUnique(rows, options.unique);
    }

    // Convert from db types into javascript, deal with json and joined columns
    if (rows.length && !options.noconvertrows) {
        this.convertRows(req.pool, req, rows, options);
    }

    // Convert values if we have custom column callback
    if (!options.noprocessrows) {
        rows = this.runProcessRows("post", req.table, req, rows);
    }
    // Always run global hooks
    rows = this.runProcessRows("post", "*", req, rows);

    // Custom filter to return the final result set
    if (typeof options.filter == "function" && rows.length) {
        rows = rows.filter(function(row) {
            return options.filter(req, row, options);
        });
    }
    return rows;
}

// Retrieve one record from the database by primary key, returns found record or null if not found
// Options can use the following special properties:
//  - select - a list of columns or expressions to return, default is to return all columns
//  - ops - operators to use for comparison for properties, see `db.select`
//  - cached - if specified it runs getCached version
//  - nocache - disable caching even if configured for the table
//
// NOTE: On return the `info.cached` will be set to 1 if the record was retrieved from cache or was put in the cache.
//
// Example
//
//          db.get("bk_account", { id: '12345' }, function(err, row) {
//             if (row) console.log(row.name);
//          });
//
db.get = function(table, query, options, callback)
{
    if (typeof options == "function") callback = options,options = null;
    if (typeof callback != "function") callback = lib.noop;
    if (!options) options = lib.empty;
    if (!options.__cached && !options.nocache && (options.cached || this.cacheTables.indexOf(table) > -1)) {
        return this.getCached("get", table, query, options, callback);
    }
    var req = this.prepare("get", table, query, options);
    this.query(req, req.options, function(err, rows, info) {
        callback(err, rows.length ? rows[0] : null, info);
    });
}

// Select objects from the database that match supplied conditions.
// - query - can be an object with properties for the condition, all matching records will be returned,
//   also can be a list where each item is an object with primary key condition. Only records specified in the list must be returned.
// - options can use the following special properties:
//    - ops - operators to use for comparison for properties, an object with column name and operator. The following operators are available:
//       `>, gt, <, lt, =, !=, <>, >=, ge, <=, le, in, between, regexp, iregexp, begins_with, like%, ilike%`
//    - opsMap - operator mapping between supplied operators and actual operators supported by the db
//    - typesMap - type mapping between supplied and actual column types, an object
//    - select - a list of columns or expressions to return or all columns if not specified
//    - start - start records with this primary key, this is the next_token passed by the previous query
//    - count - how many records to return
//    - join - how to join condition expressions, default is AND
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
//    - cacheKey - exlicit key for caching, return from the cche or from the DB and then cache it with this key, works the same as `get`
//    - nocache - do not use cache even if cche key is given
//
// On return, the callback can check third argument which is an object with some predefined properties along with driver specific state returned by the query:
// - affected_rows - how many records this operation affected, for add/put/update
// - inserted_oid - last created auto generated id
// - next_token - next primary key or offset for pagination by passing it as .start property in the options, if null it means there are no more pages availabe for this query
//
// Example: get by primary key, refer above for default table definitions
//
//        db.select("bk_message", { id: '123' }, { count: 2 }, function(err, rows) {
//
//        });
//
// Example: get all icons with type greater or equal to 2
//
//        db.select("bk_icon", { id: '123', type: '2' }, { select: 'id,type', ops: { type: 'ge' } }, function(err, rows) {
//
//        });
//
// Example: get unread msgs sorted by time, recent first
//
//        db.select("bk_message", { id: '123', status: 'N:' }, { sort: "status", desc: 1, ops: { status: "begins_with" } }, function(err, rows) {
//
//        });
//
// Example: allow all accounts icons to be visible
//
//        db.select("bk_account", {}, function(err, rows) {
//            rows.forEach(function(row) {
//                row.acl_allow = 'auth';
//                db.update("bk_icon", row);
//            });
//        });
//
// Example: scan accounts with custom filter, not by primary key: all females
//
//        db.select("bk_account", { gender: 'f' }, function(err, rows) {
//
//        });
//
// Example: select connections using primary key and other filter columns: all likes for the last day
//
//        db.select("bk_connection", { id: '123', type: 'like', mtime: Date.now()-86400000 }, { ops: { type: "begins_with", mtime: "gt" } }, function(err, rows) {
//
//        });
//
db.select = function(table, query, options, callback)
{
    if (typeof options == "function") callback = options,options = null;
    if (options && options.cacheKey && !options.__cached && !options.nocache) {
        return this.getCached("select", table, query, options, callback);
    }
    var req = this.prepare(Array.isArray(query) ? "list" : "select", table, query, options);
    this.query(req, req.options, callback);
}

// Insert new object into the database
// - obj - an JavaScript object with properties for the record, primary key properties must be supplied
// - options may contain the following properties:
//      - no_columns - do not check for actual columns defined in the pool tables and add all properties from the obj, only will work for NoSQL dbs,
//        by default all properties in the obj not described in the table definition for the given table will be ignored.
//      - skip_columns - ignore properties by name listed in the this array
//      - mtime - if set, mtime column will be added automatically with the current timestamp, if mtime is a
//        string then it is used as a name of the column instead of default mtime name
//      - skip_null - if set, all null values will be skipped, otherwise will be written into the DB as NULLs
//
// On return the `obj` will contain all new columns generated before adding the record
//
// Note: SQL, DynamoDB, MongoDB, Redis drivers are fully atomic but other drivers may be subject to race conditions
//
// Example
//
//       db.add("bk_account", { id: '123', name: 'test', gender: 'm' }, function(err, rows, info) {
//       });
//
db.add = function(table, obj, options, callback)
{
    if (typeof options == "function") callback = options,options = null;
    var req = this.prepare("add", table, obj, options);
    this.query(req, req.options, callback);
}

// Counter operation, increase or decrease column values, similar to update but all specified columns except primary
// key will be incremented, use negative value to decrease the value.
//
// If no `options.updateOps` object specified or no 'incr' operations are provided then
// all columns with type 'counter' will be used for the action `incr`
//
// *Note: The record must exist already for SQL databases, for DynamoDB and Cassandra a new record will be created
// if does not exist yet.*
//
// Example
//
//       db.incr("bk_counter", { id: '123', like0: 1, invite0: 1 }, function(err, rows, info) {
//       });
//
db.incr = function(table, obj, options, callback)
{
    if (typeof options == "function") callback = options,options = null;
    var req = this.prepare("incr", table, obj, options);
    this.query(req, req.options, callback);
}

// Add/update an object in the database, if object already exists it will be replaced with all new properties from the obj
// - obj - an object with record properties, primary key properties must be specified
// - options - same properties as for `db.add` method
//
// Example
//
//       db.put("bk_account", { id: '123', name: 'test', gender: 'm' }, function(err, rows, info) {
//       });
//
db.put = function(table, obj, options, callback)
{
    if (typeof options == "function") callback = options,options = null;

    // Custom handler for the operation
    var pool = this.getPool(table, options);
    if (pool.put) return pool.put(table, obj, options, callback);

    var req = this.prepare("put", table, obj, options);
    this.query(req, req.options, callback);
}

// Update existing object in the database.
// - obj - is an actual record to be updated, primary key properties must be specified
// - options - same properties as for `db.add` method with the following additional properties:
//     - ops - object for comparison operators for primary key, default is equal operator
//     - opsMap - operator mapping into supported by the database
//     - typesMap - type mapping for properties to be used in the condition
//     - aliases - an object to map column aliases in the query in case the same column is used ultiple times
//     - expected - an object with the condition for the update, it is used in addition to the primary keys condition from the `obj`,
//        a property named $or or $and will be treated as a sub-expression if it is an object.
//     - expectedJoin - how to join expected expressions: OR, AND, default is AND
//     - upsert - create a new record if it does not exist
//     - updateOps - an object with column names and operations to be performed on the named column
//        - incr - increment by given value
//        - set - to update as it is, for reseting counters forexample
//        - concat - concatenate given value, for strings if the database supports it
//        - append - appended to the list of values, only for lists if the database supports it
//        - not_exists - only update if not exists or null
//
// Note: not all database drivers support atomic update with conditions, all drivers for SQL, DynamoDB, MongoDB, Redis fully atomic, but other drivers
// perform get before put and so subject to race conditions
//
// Example
//
//          db.update("bk_account", { id: '123', gender: 'm' }, function(err, rows, info) {
//              console.log('updated:', info.affected_rows);
//          });
//
//          db.update("bk_account", { id: '123', gender: 'm', prefix: 'Mr' }, { pool: pgsql' }, function(err, rows, info) {
//              console.log('updated:', info.affected_rows);
//          });
//
//          db.update("bk_account", { id: '123', gender: 'm', prefix: 'Mr' }, { expected: { gender: "f" } }, function(err, rows, info) {
//              console.log('updated:', info.affected_rows);
//          });
//
//          db.update("bk_account", { id: '123', gender: 'm', prefix: 'Mr' }, { expected: { "$or": { gender: "f", g1: null }, aliases: { g1: "gender" } }, function(err, rows, info) {
//              console.log('updated:', info.affected_rows);
//          });
//
db.update = function(table, obj, options, callback)
{
    if (typeof options == "function") callback = options,options = null;
    var req = this.prepare("update", table, obj, options);
    this.query(req, req.options, callback);
}

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
//   - concurrency - how many update queries to execute at the same time, default is 1, this is done by using lib.forEachLimit.
//   - process - a function callback that will be called for each row before updating it, this is for some transformations of the record properties
//      in case of complex columns that may contain concatenated values as in the case of using DynamoDB. The callback will be called
//      as `options.process(row, options)`
//
// Example, update birthday format if not null
//
//          db.updateAll("bk_account",
//                      { birthday: 1 },
//                      { mtime: Date.now() },
//                      { ops: { birthday: "not null" },
//                        concurrency: 2,
//                        process: function(r, o) {
//                              r.birthday = lib.strftime(new Date(r.birthday, "%Y-%m-D"));
//                        } },
//          function(err, count) {
//             console.log(count, "rows updated");
//          });
//
db.updateAll = function(table, query, obj, options, callback)
{

    if (typeof options == "function") callback = options,options = null;

    var pool = this.getPool(table, options);
    var process = options && typeof options.process == "function" ? options.process : null;
    if (typeof pool.updateAll == "function" && !process) return pool.updateAll(table, query, obj, options, callback);

    var uoptions = options && options.updateOptions;
    var ucollect = options && options.updateCollect;
    var ignore_error = options && options.ignore_error;
    var cap = db.getCapacity(table, { useCapacity: "write", factorCapacity: options && options.factorCapacity || 0.25 });
    var rows = [], nupdated = 0;

    this.scan(table, query, options, function(row, next) {
        nupdated++;
        if (ucollect) rows.push(row);
        if (process) process(row, options);
        for (var p in obj) row[p] = obj[p];
        db.update(table, row, uoptions, function(err) {
            if (err && !ignore_error) return next(err);
            db.checkCapacity(cap, next);
        })
    }, function(err) {
        lib.tryCall(callback, err, ucollect ? rows : nupdated);
    });
}

// Delete an object in the database, no error if the object does not exist
// - obj - an object with primary key properties only, other properties will be ignored
// - options - same properties as for `db.update` method
//
// Example
//
//       db.del("bk_account", { id: '123' }, function(err, rows, info) {
//           console.log('updated:', info.affected_rows);
//       });
//
db.del = function(table, obj, options, callback)
{
    if (typeof options == "function") callback = options,options = null;
    var req = this.prepare("del", table, obj, options);
    this.query(req, req.options, callback);
}

// Delete all records that match given condition, one by one, the input is the same as for `db.select` and every record
// returned will be deleted using `db.del` call. The callback will receive on completion the err and all rows found and deleted.
// Special properties that can be in the options for this call:
//  - ops - query operations to retrieve records to be deleted
//  - count - how many matching records to delete
//  - delOptions - options to be passed to the db.del if needed, this is useful so select and del options will not be mixed up
//  - delCollect - if true return all deleted rows in the callback, oherwise just the number of rows deleted
//  - factorCapacity - write capcity factor for delete operations, default is 0.35
//  - concurrency - how many delete requests to execute at the same time by using lib.forEachLimit.
//  - ignore_error - continue deleting records even after an error
//  - process - a function callback that will be called for each row before deleting it, this is for some transformations of the record properties
//    in case of complex columns that may contain concatenated values as in the case of using DynamoDB. The callback will be called
//    as `options.process(row, options)`
db.delAll = function(table, query, options, callback)
{
    if (typeof options == "function") callback = options,options = null;

    var pool = this.getPool(table, options);
    var process = options && typeof options.process == "function" ? options.process : null;
    if (typeof pool.delAll == "function" && !process) return pool.delAll(table, query, options, callback);

    var doptions = options && options.delOptions;
    var dcollect = options && options.delCollect;
    var ignore_error = options && options.ignore_error;
    var cap = db.getCapacity(table, { useCapacity: "write", factorCapacity: options && options.factorCapacity || 0.35 });
    var rows = [], ndeleted = 0;

    this.scan(table, query, options, function(row, next) {
        ndeleted++;
        if (dcollect) rows.push(row);
        if (process) process(row, options);
        db.del(table, row, doptions, function(err) {
            if (err && !ignore_error) return next(err);
            db.checkCapacity(cap, next);
        });
    }, function(err) {
        lib.tryCall(callback, err, dcollect ? rows : ndeleted);
    });
}

// Add/update the object, check existence by the primary key. This is not equivalent of REPLACE INTO, it does `db.get`
// to check if the object exists in the database and performs `db.add` or `db.update` depending on the existence.
// - obj is a JavaScript object with properties that correspond to the table columns
// - options define additional flags that may
//      - check_mtime - defines a column name to be used for checking modification time and skip if not modified, must be a date value
//      - check_data - verify every value in the given object with actual value in the database and skip update if the record is the same,
//        if it is an array then check only specified columns
//
// Example: updates record 123 only if gender is not 'm' or adds new record
//
//          db.replace("bk_account", { id: '123', gender: 'm' }, { check_data: true });
//
// Example: updates record 123 only if mtime of the record is less or equal yesterday
//
//          db.replace("bk_account", { id: '123', mtime: Date.now() - 86400000 }, { check_mtime: 'mtime' });
//
db.replace = function(table, obj, options, callback)
{
    if (typeof options == "function") callback = options,options = null;
    if (typeof callback != "function") callback = lib.noop;

    var keys = this.getKeys(table, options);
    var select = keys[0];
    // Use mtime to check if we need to update this record
    if (options && options.check_mtime && obj[options.check_mtime]) {
        select = options.check_mtime;
    } else
    // Check if values are different from existing value, skip if the records are the same by comparing every field
    if (options && options.check_data) {
        var cols = this.getColumns(table, options);
        var list = Array.isArray(options.check_data) ? options.check_data : Object.keys(obj);
        select = list.filter(function(x) { return x[0] != "_"  && x != 'mtime' && keys.indexOf(x) == -1 && (x in cols); }).join(',');
        if (!select) select = keys[0];
    }

    var req = this.prepare("get", table, obj, { select: select, pool: options && options.pool });
    if (!req) {
        if (options && options.put_only) return callback(null, []);
        return this.add(table, obj, options, callback);
    }

    // Create deep copy of the object so we have it complete inside the callback
    obj = lib.objClone(obj);

    this.query(req, req.options, function(err, rows) {
        if (err) return callback(err, []);

        logger.debug('db.replace:', req, rows.length);
        if (rows.length) {
            if (options) {
                // Skip update if specified or mtime is less or equal
                if (options.add_only || (select == options.check_mtime && lib.toDate(rows[0][options.check_mtime]) >= lib.toDate(obj[options.check_mtime]))) {
                    return callback(null, []);
                }
                // Verify all fields by value
                if (options.check_data) {
                    var same = select == "1" || Object.keys(rows[0]).every(function(x) { return String(rows[0][x]) == String(obj[x]) });
                    // Nothing has changed
                    if (same) return callback(null, []);
                }
            }
            db.update(table, obj, options, callback);
        } else {
            if (options && options.put_only) return callback(null, []);
            db.add(table, obj, options, callback);
        }
    });
}

// Convenient helper to retrieve all records by primary key, the obj must be a list with key property or a string with list of primary key column
// Example
//
//      db.list("bk_account", ["id1", "id2"], function(err, rows) { console.log(err, rows) });
//      db.list("bk_account", "id1,id2", function(err, rows) { console.log(err, rows) });
//
db.list = function(table, query, options, callback)
{
    if (typeof options == "function") callback = options,options = null;
    if (typeof callback != "function") callback = lib.noop;

    switch (lib.typeName(query)) {
    case "string":
    case "array":
        query = lib.strSplit(query);
        if (typeof query[0] == "string") {
            var keys = this.getKeys(table, options);
            if (!keys.length) return callback(lib.newError("invalid keys"), []);
            query = query.map(function(x) { return lib.objNew(keys[0], x) });
        }
        break;

    default:
        return callback(lib.newError("invalid list"), []);
    }
    if (!query.length) return callback(null, []);
    this.select(table, query, options, callback);
}

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
// The callback will receive and error if any and the list of errors for each object as an array of arrays.
//
//  Example:
//
//          var ops = [ { op: "add", table: "bk_counter", obj: { id:1, like:1 } },
//                      { op: "add", table: "bk_auth", obj: { login: "test", id:1, name:"test" }]
//          db.batch(ops, { factorCapacity: 0.5 }, lib.log);
//
db.batch = function(list, options, callback)
{
    if (typeof options == "function") callback = options,options = null;

    var info = [], tables = {}, caps = {};
    list.forEach(function(x) {
        if (!tables[x.table]) tables[x.table] = [];
        tables[x.table].push(x);
    });
    lib.forEach(Object.keys(tables), function(table, next) {
        caps[table] = db.getCapacity(table, options);
        lib.forEachLimit(tables[table], options && options.concurrency || 1, function(obj, next2) {
            db[obj.op](obj.table, obj.obj, obj.options, function(err) {
                if (err) {
                    info.push([ err, obj ]);
                    if (options && options.no_errors) return next2(err);
                }
                db.checkCapacity(caps[obj.table], next2);
            });
        }, next);
    }, function(err) {
        lib.tryCall(callback, err, info);
    });
}

// Bulk operations, it will be noop if the driver does not support it.
// The input format is the same as for the `db.batch` method.
//
// Example
//
//          var ops = [ { op: "add", table: "bk_counter", obj: { id:1, like:1 } },
//                      { op: "del", table: "bk_auth", obj: { login: "test1" } },
//                      { op: "incr", table: "bk_counter", obj: { id:2, like:1 } },
//                      { op: "add", table: "bk_auth", obj: { login: "test2", id:2, name:"test2" } }]
//          db.bulk(ops, { pool: "elasticsearch" }, lib.log);
//
db.bulk = function(list, options, callback)
{
    if (typeof options == "function") callback = options,options = null;
    var req = this.prepare("bulk", "", list, options);
    this.query(req, req.options, callback);
}

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
//    - batch - if true rowCallback will be called with all rows from the batch, not every row individually, batch size is defined by the count property
//    - noscan - if 1 no scan will be performed if no prmary keys are specified
//    - fullscan - if 1 force to scan full table without using any primary key conditons, use all query properties for all records (DynamoDB)
//    - useCapacity - triggers to use specific capacity, default is `read`
//    - factorCapacity - a factor to apply for the read capacity limit and triggers the capacity check usage, default is `0.9`
//    - tableCapacity - use a different table for capacity throttling instead of the `table`, useful for cases when the row callback performs
//       writes into that other table and capacity is different
//    - capacity - a full capacity object to pass to select calls
//  - rowCallback - process records when called like this `callback(rows, next)
//  - endCallback - end of scan when called like this: `callback(err)
//
//  Example:
//
//          db.scan("bk_account", {}, { count: 10, pool: "dynamodb" }, function(row, next) {
//              // Copy all accounts from one db into another
//              db.add("bk_account", row, { pool: "pgsql" }, next);
//          }, function(err) { });
//
db.scan = function(table, query, options, rowCallback, endCallback)
{
    if (typeof options == "function") endCallback = rowCallback, rowCallback = options, options = null;

    options = lib.objClone(options);
    options.count = lib.toNumber(options.count, { dflt: 100 });
    var pool = this.getPool(table, options);
    if (pool.configOptions.requireCapacity || options.useCapacity || options.factorCapacity) {
        options.capacity = db.getCapacity(options.tableCapacity || table, { useCapacity: options.useCapacity || "read", factorCapacity: options.factorCapacity || 0.9 });
    }
    options.nrows = 0;
    options.scanning = true;

    lib.whilst(
      function() {
          if (options.limit > 0 && options.nrows >= options.limit) return false;
          return options.start !== null;
      },
      function(next) {
          if (options.limit > 0) options.count = Math.min(options.limit - options.nrows, options.count);
          db.select(table, query, options, function(err, rows, info) {
              if (err) return next(err);
              options.start = info.next_token || null;
              options.nrows += rows.length;
              if (options.batch) {
                  rowCallback(rows, next);
              } else {
                  lib.forEachSeries(rows, function(row, next2) {
                      rowCallback(row, next2);
                  }, next);
              }
          });
      }, endCallback);
}

// Migrate a table via temporary table, copies all records into a temp table, then re-create the table with up-to-date definitions and copies all records back into the new table.
// The following options can be used:
// - preprocess - a callback function(row, options, next) that is called for every row on the original table, next must be called to move to the next row, if err is returned as first arg then the processing will stop
// - postprocess - a callback function(row, options, next) that is called for every row on the destination table, same rules as for preprocess
// - tmppool - the db pool to be used for temporary table
// - tmpdrop - if 1 then the temporary table will be dropped at the end in case of success, by default it is kept
// - delay - number of milliseconds to wait between the steps
db.migrate = function(table, options, callback)
{
    if (typeof callback != "function") callback = lib.noop;
    options = lib.objClone(options);
    if (!options.preprocess) options.preprocess = function(row, options, next) { next() }
    if (!options.postprocess) options.postprocess = function(row, options, next) { next() }
    if (!options.delay) options.delay = 1000;
    var pool = db.getPool(table, options);
    var cols = db.getColumns(table, options);
    var tmptable = table + "_tmp";
    var schema = this.tables[table];
    var cap = db.getCapacity(table);
    options.readCapacity = cap.readCapacity;
    options.writeCapacity = cap.writeCapacity;

    lib.series([
        function(next) {
            db.cacheColumns(options, next);
        },
        function(next) {
            if (!pool.dbcolumns[tmptable]) return next();
            db.drop(tmptable, { pool: options.tmppool }, next);
        },
        function(next) {
            if (!pool.dbcolumns[tmptable]) return next();
            setTimeout(next, options.delay || 0);
        },
        function(next) {
            pool.dbcolumns[tmptable] = schema;
            db.create(tmptable, schema, { pool: options.tmppool }, next);
        },
        function(next) {
            setTimeout(next, options.delay || 0);
        },
        function(next) {
            db.scan(table, {}, options, function(row, next2) {
                options.preprocess(row, options, function(err) {
                    if (err) return next2(err);
                    db.add(tmptable, row, { pool: options.tmppool }, function() {
                        db.checkCapacity(cap, next2);
                    });
                });
            }, next);
        },
        function(next) {
            db.drop(table, options, next);
        },
        function(next) {
            setTimeout(next, options.delay || 0);
        },
        function(next) {
            db.create(table, schema, options, next);
        },
        function(next) {
            setTimeout(next, options.delay || 0);
        },
        function(next) {
            db.cacheColumns(options, next);
        },
        function(next) {
            db.scan(tmptable, {}, { pool: options.tmppool, capacity: cap }, function(row, next2) {
                options.postprocess(row, options, function(err) {
                    if (err) return next2(err);
                    db.add(table, row, options, function() {
                        db.checkCapacity(cap, next2);
                    });
                });
            }, next);
        },
        function(next) {
            if (!options.tmpdrop) return next();
            db.drop(tmptable, options, next);
        }],
        function(err) {
            callback(err);
    });
}

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
//            db.search("bk_account", { type: "admin", q: "john*" }, { pool: "elasticsearch" }, lib.log);
//            db.search("bk_account", "john*", { pool: "elasticsearch" }, lib.log);
//
db.search = function(table, query, options, callback)
{
    if (typeof options == "function") callback = options,options = null;
    var req = this.prepare("search", table, query, options);
    this.query(req, req.options, callback);
}

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
//
// A special case when table is empty `db.join` just returns same rows to the callback, this is
// for convenience of doing joins on some conditions and trigger it by setting the table name or skip the join completely.
//
// Example:
//
//          db.join("bk_account", [{id:"123",key1:1},{id:"234",key1:2}], lib.log)
//          db.join("bk_account", [{aid:"123",key1:1},{aid:"234",key1:2}], { keysMap: { id: "aid" }}, lib.log)
//          db.join("bk_account", [{id:"123",state:"NY"},{id:"234",state:"VA"}], { columnsMap: { state: "astate" }}, lib.log)
//
db.join = function(table, rows, options, callback)
{
    if (!table) return callback(null, rows);
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = lib.empty;


    var map = {}, ids = [], cols = this.getColumns(table);
    var keys = [].concat(options.keys || db.getKeys(table, options));
    for (var p in cols) {
        if (cols[p].primary && Array.isArray(cols[p].join) && cols[p].unjoin) {
            for (var i in cols[p].join) if (keys.indexOf(cols[p].join[i]) == -1) keys.push(cols[p].join[i])
        }
    }
    var mkeys = options.keysMap ? keys.map(function(x) { return options.keysMap[x] || x }) : keys;
    var rkeys = options.keysMap ? Object.keys(options.keysMap).reduce(function(x,y) { x[options.keysMap[y]] = y; return x }, {}) : null;
    rows.forEach(function(x) {
        var key = db.getQueryForKeys(mkeys, x, { keysMap: rkeys, noempty: 1 });
        var k = Object.keys(key).map(function(y) { return key[y] }).join(db.separator);
        if (!k) return;
        if (!map[k]) {
            map[k] = [];
            ids.push(key);
        }
        map[k].push(x);
    });
    db.list(table, ids, options, function(err, list, info) {
        if (err) return callback(err, []);

        list.forEach(function(x) {
            var key = db.getQueryForKeys(keys, x);
            var k = Object.keys(key).map(function(y) { return key[y] }).join(db.separator);
            if (map[k]) map[k].forEach(function(row) {
                if (options.attach) {
                    row[options.attach] = x;
                } else {
                    for (var p in x) {
                        if (Array.isArray(options.incr) && options.incr.indexOf(p) > -1) {
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
            rows = rows.filter(function(x) { return x.__1; }).map(function(x) { delete x.__1; return x; });
        } else
        // Always attach even if empty
        if (options.attach) {
            for (var i in rows) {
                if (!rows[i].__1) rows[i][options.attach] = {};
                delete rows[i].__1;
            }
        }
        callback(null, rows, info);
    });
}

// Create a table using column definitions represented as a list of objects. Each column definition can
// contain the following properties:
// - `name` - column name
// - `type` - column type: int, bigint, real, string, now, counter or other supported type
// - `primary` - column is part of the primary key
// - `unique` - column is part of an unique key
// - `index` - column is part of an index
// - `value` - default value for the column
// - `len` - column length
// - `pub` - columns is public, *this is very important property because it allows anybody to see it when used in the default API functions, i.e. anybody with valid
//    credentials can retrieve all public columns from all other tables, and if one of the other tables is account table this may expose some personal infoamtion,
//    so by default only a few columns are marked as public in the bk_account table*
// - `secure` - an opposite for the pub property, if defined this property should never be returned to the client by the API handlers
// - `admin` - if defined this property can only be updated an admin account
// - `admins` - if defined this property can be visible by the owner and an admin if result is returned by `api.sendJSON`
// - `hidden` - completely ignored by all update operations but could be used by the public columns cleaning procedure, if it is computed and not stored in the db
//    it can contain pub property to be returned to the client
// - `readonly` - only add/put operations will use the value, incr/update will not affect the value
// - `writeonly` - only incr/update can change this value, add/put will ignore it
// - `noresult` - delete this property from the result, mostly for joined artificial columns which used for indexes only
// - `random` - add a random number between 0 and this value, useful with type: "now"
// - `lower' - make string value lowercase
// - `upper' - make string value uppercase
// - `list` - splits the column value into an array, optional `separator` property can be used, default separator is `,|`
// - `autoincr` - for counter tables, mark the column to be auto-incremented by the connection API if the connection type has the same name as the column name
// - `join` - a list with property names that must be joined together before performing a db operation, it will use the given record to produce new property,
//     this will work both ways, to the db and when reading a record from the db it will split joined property and assign individual
//     properties the value from the joined value.
// - `join_ops` - an array with operations for which perform columns join only, if not specified it applies for all operations,
//     allowed values: add, put, incr, update, del, get, select
//
// *Some properties may be defined multiple times with number suffixes like: unique1, unique2, index1, index2 to create more than one index for the table, same
// properties define a composite key in the order of definition or sorted by the property value, for example: `{ a: { index:2 }, b: { index:1 } }` will create index (b,a)
// because of the `index:` property value being not the same. If all index properties are set to 1 then a composite index will use the order of the properties.*
//
// *Special column types*:
//  - `uuid` - autogenerate the column value with UUID, optional `prefix` property will be prepended, `{ type: "uuid", prefix: "u_" }`
//  - `now` - defines a column to be automatically filled with the current timestamp, `{ type: "now" }`
//  - `counter` - defines a columns that will be automatically incremented by the `db.incr` command, on creation it is set with 0
//  - `uid` - defines a columns to be automatically filled with the current user id, this assumes that account object is passed in the options from the API level
//  - `uname` - defines a columns to be automatically filled with the current user name, this assumes that account object is passed in the options from the API level
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

// Upgrade a table with missing columns from the definition list, if after the upgrade new columns must be re-read from the database
// then `info.affected_rows` must be non zero.
db.upgrade = function(table, columns, options, callback)
{
    if (typeof options == "function") callback = options,options = null;
    var req = this.prepare("upgrade", table, columns, options);
    this.query(req, req.options, callback);
}

// Drop a table
db.drop = function(table, options, callback)
{

    if (typeof options == "function") callback = options,options = null;
    if (typeof callback != "function") callback = lib.noop;
    var req = this.prepare("drop", table, {}, options);
    this.query(req, req.options, function(err, rows, info) {
        // Clear the table cache
        if (!err) {
            var pool = db.getPool(table, options);
            delete pool.dbcolumns[table];
            delete pool.dbkeys[table];
            delete pool.dbindexes[table];
        }
        callback(err, rows, info);
    });
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

// Define new tables or extend/customize existing tables. Table definitions are used with every database operation,
// on startup, the backend read all existing table columns from the database and cache them in the memory but some properties
// like public columns are only specific to the backend so to mark such columns the table with such properties must be described
// using this method. Only columns with changed properties need to be specified, other columns will be left as it is.
//
// Example
//
//          db.describeTables({ bk_account: { name: { pub: 1 } },
//                              test: { id: { primary: 1, type: "int" },
//                                      name: { pub: 1, index: 1 } });
//
db.describeTables = function(tables, callback)
{
    var changed = false;
    for (var p in tables) {
        var table1 = this.tables[p];
        if (!table1) this.tables[p] = table1 = {};
        var table2 = tables[p];
        for (var c in table2) {
            if (!table1[c]) table1[c] = {};
            // Merge columns
            for (var k in table2[c]) {
                table1[c][k] = table2[c][k];
            }
        }
        // Produce keys and indexes
        this.keys[p] = [];
        var indexes = {};
        for (var c in table1) {
            if (table1[c].primary) this.keys[p].push(c);
            ["","1","2","3","4","5"].forEach(function(n) {
                if (!table1[c]["index" + n]) return;
                if (!indexes[n]) indexes[n] = [];
                indexes[n].push(c);
            });
        }
        this.indexes[p] = {};
        this.keys[p].sort(function(a, b) { return table1[a].primary - table1[b].primary });
        for (var n in indexes) {
            var name = [];
            indexes[n].sort(function(a, b) { return table1[a]["index" + n] - table1[b]["index" + n] });
            this.indexes[p][indexes[n].join("_")] = indexes[n];
        }
    }
    if (typeof callback == "function") callback();
}

// Refresh columns for all polls which need it
db.refreshColumns = function(options, callback)
{

    if (typeof options == "function") callback = options, options = null;
    var pools = this.getPools();
    lib.forEachLimit(pools, pools.length, function(pool, next) {
        if (!db.pools[pool.name].configOptions.cacheColumns) return next();
        db.cacheColumns(pool.name, next);
    }, callback);
}

// Reload all columns into the cache for the pool, options can be a pool name or an object like `{ pool: name }`.
// if `tables` property is an arary it asks to refresh only specified tables if that is possible.
db.cacheColumns = function(options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (typeof options == "string") options = { pool: options };

    var pool = this.getPool('', options);
    pool.cacheColumns.call(pool, options, function(err) {
        if (err) logger.error('cacheColumns:', pool.name, lib.traceError(err));
        pool.cacheIndexes.call(pool, options, function(err) {
            if (err) logger.error('cacheIndexes:', pool.name, err);
            // Allow other modules to handle just cached columns for post processing
            if (Array.isArray(db.processColumns)) {
                db.processColumns.forEach(function(x) {
                    if (typeof x == "function") x.call(pool, options);
                });
            }
            if (typeof callback == "function") callback(err);
        });
    });
}

// Prepare for execution for the given operation: add, del, put, update,...
// Returns prepared object to be passed to the driver's .query method. This method is a part of the driver
// helpers and is not used directly in the applications.
db.prepare = function(op, table, obj, options)
{
    var pool = this.getPool(table, options);

    // Check for table name, it can be determined in the real time
    table = pool.resolveTable(op, table || "", obj, options).toLowerCase();

    // Prepare row properties
    var req = { op: op, table: table, text: "", obj: obj, options: options };
    this.prepareRow(pool, req);
    pool.prepare(req);
    return req;
}

// Preprocess an object for a given operation, convert types, assign defaults...
db.prepareRow = function(pool, req)
{
    if (!pool) pool = this.getPool(req.table, req.options);

    // Keep an object in the format we support
    var type = lib.typeName(req.obj);
    switch (type) {
    case "object":
    case "string":
    case "array":
        break;
    default:
        req.obj = {};
    }

    // Cache table columns
    req.columns = this.getColumns(req.table, req.options);

    // Pre-process input properties before sending it to the database, make a shallow copy of the
    // object to preserve the original properties in the parent
    if (!req.options || !req.options.noprocessrows) {
        switch (req.op) {
        case "create":
        case "upgrade":
            break;

        default:
            if (this.getProcessRows('pre', req.table, req.options)) req.obj = lib.objClone(req.obj);
            this.runProcessRows("pre", req.table, req, req.obj);
        }
        // Always run the global hook, keep the original object
        this.runProcessRows("pre", "*", req, req.obj);
    }

    req.orig = {};
    // Original record before the prepare processing, only for single records
    if (type == "object") {
        for (var p in req.obj) req.orig[p] = req.obj[p];
    }

    switch (req.op) {
    case "incr":
        this.prepareForIncr(pool, req);

    case "add":
    case "put":
    case "update":
        this.prepareForUpdate(pool, req);
        break;

    case "del":
        this.prepareForDelete(pool, req);
        break;

    case "search":
        if (pool.configOptions.searchable) break;

    case "get":
    case "select":
        this.prepareForSelect(pool, req);
        break;

    case "list":
        this.prepareForList(pool, req);
        break;

    case "bulk":
        for (var i in req.obj) {
            req.obj[i] = this.prepare(req.obj[i].op, req.obj[i].table, req.obj[i].obj, req.obj[i].options);
        }
        break;
    }
}

db.prepareForIncr = function(pool, req)
{
    if (!req.options || !lib.objSearch(req.options.updateOps, { hasvalue: "incr", count: 1 })) {
        req.options = lib.objClone(req.options, "__bk", 1);
        if (!lib.isObject(req.options.updateOps)) req.options.updateOps = {};
        for (var p in req.columns) {
            if (req.columns[p].type == "counter" && typeof req.obj[p] != "undefined") req.options.updateOps[p] = "incr";
        }
    }
}

// Keep only columns from the table definition if we have it
// Go over all properties in the object and makes sure the types of the values correspond to the column definition types,
// this is for those databases which are very sensitive on the types like DynamoDB.
db.prepareForUpdate = function(pool, req)
{
    var o = {}, v, col, allkeys;
    var insert = req.op == "add" || req.op == "put";
    for (var p in req.obj) {
        v = req.obj[p];
        if (this.skipColumn(p, v, req.options, req.columns)) continue;
        col = req.columns[p];
        if (col) {
            // Skip artificial join columns
            if (pool.configOptions.noJoinColumns && Array.isArray(col.join) && col.join.indexOf(p) == -1) continue;
            // Convert into native data type
            if (v !== null) {
                // Handle json separately in sync with convertRows
                switch (col.type) {
                case "json":
                    if (pool.configOptions.noJson && typeof v != "string") v = lib.stringify(v);
                    break;
                case "obj":
                    if (typeof v != "object") continue;
                    if (pool.configOptions.noObjects && typeof v != "string") v = lib.stringify(v);
                    break;
                case "array":
                    if (!Array.isArray(v)) continue;
                    if (pool.configOptions.noObjects && typeof v != "string") v = lib.stringify(v);
                    break;
                default:
                    if (pool.configOptions.strictTypes) {
                        if (col.primary || col.index || col.type) v = lib.toValue(v, col.type);
                    }
                }
            }
            // Verify against allowed values
            if (Array.isArray(col.values) && col.values.indexOf(String(v)) == -1) continue;
            // Max length limit for text fields
            if (col.maxlength && typeof v == "string" && !col.type && v.length > col.maxlength) v = v.substr(0, col.maxlength);
            if (col.notempty && lib.isEmpty(v)) {
                if (!insert) continue;
                if (!pool.configOptions.noNulls) v = null; else
                if (typeof pool.configOptions.emptyValue != "undefined") v = pool.configOptions.emptyValue;
            }
        }
        // Handle NULL constraints
        if ((v == null || v === "") && !(col && col.notempty) && pool.configOptions.skipNull && pool.configOptions.skipNull[req.op]) continue;
        o[p] = v;
    }
    req.obj = o;
    for (var p in req.columns) {
        col = req.columns[p];
        // Restrictions
        if (this.skipColumn(p, "", req.options, req.columns) ||
                col.hidden ||
                (col.readonly && (req.op == "incr" || req.op == "update")) ||
                (col.writeonly && (req.op == "add" || req.op == "put"))) {
            delete req.obj[p];
            continue;
        }
        if (insert) {
            if (typeof col.value != "undefined" && typeof req.obj[p] == "undefined") req.obj[p] = col.value;
            if (typeof req.obj[p] == "undefined") {
                if (col.type == "counter") req.obj[p] = 0;
            }
            if (col.type == "uuid" && !lib.isUuid(req.obj[p], col.prefix)) req.obj[p] = lib.uuid(col.prefix);
        }
        if (col.type == "uid" && req.options && req.options.account) req.obj[p] = req.options.account.id;
        if (col.type == "uname" && req.options && req.options.account) req.obj[p] = req.options.account.name;
        // Only use the given timestamp if it is an update with primary key involving the property
        if (col.type == "now") {
            if (!allkeys) allkeys = this.getKeys(req.table, { allkeys: 1 });
            if (insert || !req.obj[p] || allkeys.indexOf(p) == -1) {
                req.obj[p] = col.clock ? lib.clock()/1000 : Date.now();
                if (col.epoch) req.obj[p] = Math.round(req.obj[p]/1000);
            }
        }
        if (typeof req.obj[p] == "number") {
            if (col.random) req.obj[p] += Math.random();
            if (col.multiplier) req.obj[p] *= col.multiplier;
            if (col.increment) req.obj[p] += col.increment;
        }
        if (typeof req.obj[p] == "string") {
            if (col.lower) req.obj[p] = req.obj[p].toLowerCase();
            if (col.upper) req.obj[p] = req.obj[p].toUpperCase();
        }
        if (typeof req.obj[p] != "undefined" && col.type == "counter") req.obj[p] = lib.toNumber(req.obj[p]);
        this.joinColumn(req, req.obj, p, col, req.orig);
    }
}

db.prepareForDelete = function(pool, req)
{
    var o = {}, v, col;
    for (var p in req.obj) {
        v = req.obj[p];
        col = req.columns[p];
        if (this.skipColumn(p, v, req.options, req.columns)) continue;
        if (col && col.hidden) continue;
        // Convert into native data type
        if (pool.configOptions.strictTypes && col && (col.primary || col.type) && typeof v != "undefined") v = lib.toValue(v, col.type);
        o[p] = v;
    }
    req.obj = o;
    for (var p in req.columns) {
        this.joinColumn(req, req.obj, p, req.columns[p], req.orig);
    }
}

db.prepareForSelect = function(pool, req)
{
    // Keep only columns, non existent properties cannot be used
    var o = {}, col, v, type;
    for (var p in req.obj) {
        col = req.columns[p];
        if (col && col.hidden) continue;
        if (/^\$(or|and)/.test(p) || !this.skipColumn(p, req.obj[p], req.options, req.columns)) o[p] = req.obj[p];
    }
    req.obj = o;

    // Convert simple types into the native according to the table definition, some query parameters are not
    // that strict and can be arrays which we should not convert due to options.ops
    for (var p in req.columns) {
        v = req.obj[p];
        type = typeof v;
        col = req.columns[p];
        if (pool.configOptions.strictTypes) {
            switch (col.type) {
            case "bool":
            case "boolean":
                if (type == "number") req.obj[p] = lib.toBool(v); else
                if (type == "string" && v) req.obj[p] = lib.toBool(v);
                break;
            case "mtime":
            case "date":
            case "time":
            case "timestamp":
                if (v) req.obj[p] = lib.toValue(v, col.type);
                break;
            default:
                if (lib.isNumericType(col.type)) {
                    if (type == "string" && v) req.obj[p] = lib.toNumber(v);
                } else {
                    if (type == "number") req.obj[p] = String(v);
                }
            }
        }
        // Case conversion
        if (col.lower && type == "string") req.obj[p] = v.toLowerCase();
        if (col.upper && type == "string") req.obj[p] = v.toUpperCase();

        // Default search op, for primary key cases
        var ops = req.options && req.options.ops || lib.empty;
        if (col.ops && col.ops[req.op] && !ops[p]) {
            req.options = lib.objClone(req.options, "__bk", 1);
            lib.objSet(req.options, ["ops", p], col.ops[req.op]);
            ops = req.options.ops;
        }

        switch (ops[p]) {
        case "in":
        case "between":
            if (!Array.isArray(v)) {
                if (v) {
                    req.obj[p] = lib.strSplitUnique(v, null, { datatype: col.type });
                } else {
                    delete req.obj[p];
                }
            }
            break;
        }

        // Joined values for queries, if nothing joined or only one field is present keep the original value
        this.joinColumn(req, req.obj, p, col, req.orig);
    }
}

db.prepareForList = function(pool, req)
{
    var col;
    for (var i = 0; i < req.obj.length; i++) {
        for (var p in req.columns) {
            col = req.columns[p];
            if (pool.configOptions.strictTypes) {
                if (lib.isNumericType(col.type)) {
                    if (typeof req.obj[i][p] == "string") req.obj[i][p] = lib.toNumber(req.obj[i][p]);
                } else {
                    if (typeof req.obj[i][p] == "number") req.obj[i][p] = String(req.obj[i][p]);
                }
            }
            // Joined values for queries, if nothing joined or only one field is present keep the original value
            this.joinColumn(req, req.obj[i], p, col, req.orig);
            // Delete at the end to give a chance some joined columns to be created
            if (!col.primary) delete req.obj[i][p];
        }
    }
}

// Convert rows returned by the database into the Javascript format or into the format
// defined by the table columns.
// The following special properties in the column definition chnage the format:
//  - type = json - if a column type is json and the value is a string returned will be converted into a Javascript object
//  - dflt property is defined for a json type and record does not have a value it will be set to specified default value
//  - list - split the value into an array, optional .separator property can be specified
//  - unjoin - a true value or a list of names, it produces new properties by splitting the value by a separator and assigning pieces to
//      separate properties using names from the list, this is the opposite of the `join` property and is used separately if
//      splitting is required, if joined properties already in the record then no need to split it. If not a list
//      the names are used form the join property.
//
//      Example:
//              db.describeTables([ { user: { id: {}, name: {}, pair: { join: ["left","right"], unjoin: 1 } } ]);
//
//              db.put("test", { id: "1", type: "user", name: "Test", left: "123", right: "000" })
//              db.select("test", {}, lib.log)
//
db.convertRows = function(pool, req, rows, options)
{
    if (typeof pool == "string") pool = this.pools[pool];
    if (!pool) pool = this.getPool(req.table, options);
    var col, cols = req.columns || this.getColumns(req.table, options || req.options);

    for (var p in cols) {
        col = cols[p];
        // Convert from JSON type
        if ((pool.configOptions.noJson && col.type == "json") ||
            (pool.configOptions.noObjects && (col.type == "obj" || col.type == "array"))) {
            for (var i = 0; i < rows.length; i++) {
                if (typeof rows[i][p] == "string" && rows[i][p]) rows[i][p] = lib.jsonParse(rows[i][p], { logger: "error" });
            }
        }

        // Split into a list
        if (col.list) {
            for (var i = 0; i < rows.length; i++) {
                rows[i][p] = lib.strSplit(rows[i][p], col.separator);
            }
        }
        // Extract joined values and place into separate columns
        this.unjoinColumns(rows, p, col, options);

        // Default value on return
        if (cols[p].dflt) {
            for (var i = 0; i < rows.length; i++) {
                if (!rows[i][p]) rows[i][p] = cols[p].dflt;
            }
        }

        // Do not return
        if (col.noresult) {
            for (var i = 0; i < rows.length; i++) delete row[p];
        }
    }
    return rows;
}

// Add a callback to be called after each cache columns event, it will be called for each pool separately.
// The callback to be called may take options argument and it is called in the context of the pool.
//
// The primary goal for this hook is to allow management of the existing tables which are not own by the
// backendjs application. For such tables, because we have not created them, we need to define column properties
// after the fact and to keep column definitions in the app for such cases is not realistic. This callback will
// allow to handle such situations and can be used to set necessary propeties to the table columns.
//
// Example, a few public columns, allow an admin to see all the columns
//
//         db.setProcessColumns(function() {
//             var cols = db.getColumns("users", { pool: this.name });
//             for (var p in  cols) {
//                 if (["id","name"].indexOf(p) > -1) cols[p].pub = 1; else cols[p].admin = 1;
//             }
//         })
db.setProcessColumns = function(callback)
{
    if (typeof callback != "function") return;
    this.processColumns.push(callback);
}

// Returns a list of hooks to be used for processing rows for the given table
db.getProcessRows = function(type, table, options)
{
    if (!type || !table || !this.processRows[type]) return null;
    var hooks = this.processRows[type][table];
    return Array.isArray(hooks) && hooks.length ? hooks : null;
}

// Run registered pre- or post- process callbacks.
// - `type` is one of the `pre` or 'post`
// - `table` - the table to run the hooks for, usually the same as req.table but can be '*' for global hooks
// - `req` is the original db request object with the following required properties: `op, table, obj, options, info`,
// - `rows` is the result rows for post callbacks and the same request object for pre callbacks.
db.runProcessRows = function(type, table, req, rows)
{
    if (!req) return rows;
    var hooks = this.getProcessRows(type, table, req.options);
    if (!hooks) return rows;

    // Stop on the first hook returning true to remove this row from the list
    function processRow(row) {
        for (var i = 0; i < hooks.length; i++) {
            if (hooks[i].call(row, req, row, req.options) === true) return false;
        }
        return true;
    }
    if (Array.isArray(rows)) {
        rows = rows.filter(processRow);
    } else {
        processRow(rows);
    }
    return rows;
}

// Assign a processRow callback for a table, this callback will be called for every row on every result being retrieved from the
// specified table thus providing an opportunity to customize the result.
//
// type defines at what time the callback will be called:
//  - `pre` - making a request to the db on the query record
//  - `post` - after the request finished to be called on the result rows
//
// All assigned callback to this table will be called in the order of the assignment.
//
// The callback accepts 3 arguments: function(req, row, options)
//   where:
//  - `req` - the original request for a db operation with required
//      - `op` - current db operation, like add, put, ....
//      - `table` -  current table being updated
//      - `obj` - the record with data
//      - `pool` - current request db pool name
//      - `info` - an object returned with special properties like affected_rows, next_token, only passed to the `post` callbacks
//  - `row` - a row from the result
//  - `options` - the obj passed to the original db called
//
// When producing complex properties by combining other properties it needs to be synchronized using both pre and post
// callbacks to keep the record consistent.
//
// **For queries returning rows, if the callback returns true for a row it will be filtered out and not included in the final result set.**
//
//
//  Example
//
//      db.setProcessRow("post", "bk_account", function(req, row, opts) {
//          if (row.birthday) row.age = Math.floor((Date.now() - lib.toDate(row.birthday))/(86400000*365));
//      });
//
//      db.setProcessRow("post", "bk_icon", function(req, row, opts) {
//          if (row.type == "private" && row.id != opts.account.id) return true;
//      });
//
db.setProcessRow = function(type, table, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!table || typeof callback != "function") return;
    if (!this.processRows[type]) this.processRows[type] = {};
    if (!this.processRows[type][table]) this.processRows[type][table] = [];
    this.processRows[type][table].push(callback);
}

// Returns true if a pool exists
db.existsPool = function(name)
{
    return !!this.pools[name];
}

// Returns true if a table exists
db.existsTable = function(table, options)
{
    return this.getPool(table, options).dbcolumns[(table || "").toLowerCase()] ? true : false;
}

// Return database pool by table name or default pool, options can be a pool name or an object with { pool: name } to return
// the pool by given name. This call always return valid pool object, in case no requiested pool found it returns
// default pool. A special pool `none` always return empty result and no errors.
db.getPool = function(table, options)
{
    var pool = options ? (typeof options == "string" ? this.pools[options] : options.pool ? this.pools[options.pool] : null) : null;
    if (!pool && this.poolTables[table]) pool = this.pools[this.poolTables[table]];
    if (!pool) pool = this.pools[this.pool];
    return pool || this.pools.none;
}

// Return all tables know to the given pool, returned tables are in the object with
// column information merged from cached columns from the database with description columns
// given by the application. If `options.names` is 1 then return just table names as a list.
db.getPoolTables = function(name, options)
{
    var pool = this.getPool('', name);
    var tables = pool.configOptions.cacheColumns ? pool.dbcolumns : this.tables;
    if (options && options.names) tables = Object.keys(tables);
    return tables;
}

// Return a list of all active database pools, returns list of objects with name: and type: properties
db.getPools = function()
{
    var rc = [];
    for (var p in this.pools)  {
        if (p != "none") rc.push({ name: this.pools[p].name, type: this.pools[p].type });
    }
    return rc;
}

// Return columns for a table or null, columns is an object with column names and objects for definition.
db.getColumns = function(table, options)
{
    return this.tables[(table || "").toLowerCase()] || lib.empty;
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
// - intervalCapacity - default is 1000 ms
db.getCapacity = function(table, options)
{
    if (!options) options = lib.empty;
    var pool = this.getPool(table, options);
    var capacity = pool.dbcapacity[table] || lib.empty;
    capacity = capacity[options.sort] || capacity[table] || lib.empty;
    var cap = {
        table: table,
        unitCapacity: 1,
        readCapacity: capacity.read || pool.configOptions.readCapacity || 0,
        writeCapacity: capacity.write || pool.configOptions.writeCapacity || 0,
    };
    var use = options.useCapacity;
    var factor = options.factorCapacity > 0 && options.factorCapacity <= 1 ? options.factorCapacity : 1;
    cap.maxCapacity = Math.max(0, typeof use == "number" ? use : use == "read" ? cap.readCapacity : cap.writeCapacity);
    cap.rateCapacity =  Math.max(0, cap.maxCapacity*factor);
    for (var p in options) cap[p] = options[p];
    if (cap.rateCapacity > 0) cap._tokenBucket = new metrics.TokenBucket(cap.rateCapacity, cap.maxCapacity, options.intervalCapacity);
    return cap;
}

// Check if number of requests exceeds the capacity per second, delay if necessary, for DynamoDB only but can be used for pacing
// requests with any database or can be used generically. The `cap` must be initialized with `db.getCapacity` call.
db.checkCapacity = function(cap, consumed, callback)
{
    if (typeof consumed == "function") callback = consumed, consumed = 1;
    if (!cap || !cap._tokenBucket || typeof cap._tokenBucket.consume != "function") return callback();

    if (cap._tokenBucket.consume(consumed)) return callback();
    logger.debug("checkCapacity:", consumed, cap);
    setTimeout(callback, cap._tokenBucket.delay(consumed));
}

// Return list of selected or allowed only columns, empty list if no `options.select` is specified
db.getSelectedColumns = function(table, options)
{

    if (options && options.select && options.select.length) {
        var cols = this.getColumns(table, options);
        var list = lib.strSplitUnique(options.select);
        var select = Object.keys(cols).filter(function(x) { return !db.skipColumn(x, "", options, cols) && list.indexOf(x) > -1; });
        if (select.length) return select;
    } else
    if (options && options.skip_columns) {
        var cols = this.getColumns(table, options);
        var select = Object.keys(cols).filter(function(x) { return !db.skipColumn(x, "", options, cols); });
        if (select.length) return select;
    }
    return null;
}

// Return table columns filtered by a proprty filter, only return columns that contain(or not)
// any property from the filter list. If the filter is an object then values must match, null means if exists.
//
// Example:
//
//      db.getFilteredColumns("bk_account", "pub")
//      db.getFilteredColumns("bk_account", { pub: null, index: 2 })
//      db.getFilteredColumns("bk_account", { type: "now" }, { list: 1 })
//
db.getFilteredColumns = function(table, filter, options)
{
    var cols = db.getColumns(table), obj = {}, reverse, v, col;
    if (typeof filter == "string") filter = [ filter ];
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
            if ((!reverse && typeof col[name] != "undefined") || (reverse && col[name] == "undefined")) {
                if (v === null ||
                    (Array.isArray(v) && v.indexOf(col[name]) > -1) ||
                    (util.isRegExp(v) && v.test(col[name])) ||
                    v == col[name]) obj[p] = col;
            }
        }
    }
    if (options && options.list) return Object.keys(obj);
    return obj;
}

// Join several columns to produce a combined property if configured, given a column description and an object record
// it replaces the column value with joined value if needed. Empty properties will be still joined as empty strings.
// It always uses the original value even if one of the properties has been joined already.
//
// Checks for `join` and `join_ops` properties in the column definition.
//
// The `options.skip_join` can be used to restrict joins, it is a list with columns that should not be joined
//
// The `col.join_pools` can be an array with pool names which are allowed to do the join, other pools will skip joining this column.
//
// The `col.nojoin_pools` can be an array with pool names which are not allowed to do the join, other pools will skip joining this column
//
// The `options.join_strict` can be used to perform join only if all columns in the list are not empty, so the join
// is for all columns or none
//
db.joinColumn = function(req, obj, name, col, orig)
{
    if (!col) return;
    switch (col.type) {
    case "geohash":
        if (!obj[name] && obj[col.lat || "latitude"] && obj[col.lon || "longitude"]) {
            obj[name] = lib.geoHash(obj[col.lat || "latitude"] && obj[col.lon || "longitude"], { minDistance: col.minDistance }).geohash;
        }
        break;

    case "geopoint":
        if (!obj[name] && obj[col.lat || "latitude"] && obj[col.lon || "longitude"]) {
            obj[name] = obj[col.lat || "latitude"] + "," + obj[col.lon || "longitude"];
        }
        break;
    }

    // Check if this regular column belong to any incomplete joined column, if so recreate the parent
    if (!Array.isArray(col.join) && req._join && req._join[name]) {
        name = req._join[name];
        col = req.columns[name];
    }
    if (!Array.isArray(col.join)) return;
    if (req.options && req.options.noJoinColumns) return;
    if (req.options && Array.isArray(req.options.skip_join) && req.options.skip_join.indexOf(name) > -1) return;
    if (Array.isArray(col.join_ops) && col.join_ops.indexOf(op) == -1) return;
    if (Array.isArray(col.join_pools) && col.join_pools.indexOf(req.options && req.options.pool || this.pool) == -1) return;
    if (Array.isArray(col.nojoin_pools) && col.nojoin_pools.indexOf(req.options && req.options.pool || this.pool) > -1) return;

    var separator = col.separator || this.separator;
    if (typeof obj[name] == "string" && obj[name].indexOf(separator) > -1) return;
    var c, d, v = "", n = 0;
    var ops = req.options && req.options.ops, join_strict = req.options && req.options.join_strict;
    for (var i = 0; i < col.join.length; i++) {
        c = col.join[i];
        d = (orig && orig[c]) || obj[c] || "";
        if (d) {
            n++;
        } else {
            if (col.join_strict || join_strict) return;
            switch (ops && ops[name]) {
            case "lt":
            case "le":
            case "gt":
            case "ge":
            case "begins_with":
                // Left to right comparison, skip if we have holes
                if (i > n || (i == n && i < col.join.length - 1)) return;
                break;
            default:
                // Mark for later when possibly new value will be generated, for now, uuid....
                if (!req._join) req._join = {};
                req._join[c] = name;
                return;
            }
        }
        v += (i ? separator : "") + d;
    }
    if (!v || !n) return;
    obj[name] = v;
}

// Split joined columns for all rows
db.unjoinColumns = function(rows, name, col, options)
{
    if (Array.isArray(col.unjoin) || (lib.toBool(col.unjoin) && Array.isArray(col.join))) {
        var unjoin = Array.isArray(col.unjoin) ? col.unjoin : col.join;
        var row, separator = col.separator || this.separator;
        for (var i = 0; i < rows.length; i++) {
            row = rows[i];
            if (typeof row[name] == "string" && row[name].indexOf(separator) > -1) {
                var v = row[name].split(separator);
                if (v.length >= unjoin.length) {
                    for (var j = 0; j < unjoin.length; j++) {
                        row[unjoin[j]] = lib.toValue(v[j], col.type);
                    }
                    // If it is an artificial column do not keep it after unjoining
                    if (unjoin.indexOf(name) == -1) delete row[name];
                }
            }
        }
    }
}

// Verify column against common options for inclusion/exclusion into the operation, returns 1 if the column must be skipped
//  - to enable all properties to be saved in the record without column definition set `options.no_columns=1`
//  - to skip all null values set `options.skip_null=1`
//  - to skip specific columns define `options.skip_columns=["a","b"]`
//  - to restrict to specific columns only define `options.allow_columns=["a","b"]`
//  - to restrict to specific DB pools only define `options.allow_pools=["sqlite","mysql"]`
//  - to skip specific DB pools define `options.skip_pools=["sqlite","mysql"]`
//  - to restrict to specific DB pools for this columns only define `name: { allow_pools: ["sqlite","mysql"] }`
db.skipColumn = function(name, val, options, columns)
{
    if (!name || name[0] == '_' || typeof val == "undefined") return true;
    if (!(options && options.no_columns) && columns && !columns[name]) return true;
    var pool = options && options.pool || this.pool;
    if (options) {
        if (options.skip_null && val === null) return true;
        if (Array.isArray(options.allow_pools) && options.allow_pools.indexOf(pool) == -1) return true;
        if (Array.isArray(options.skip_pools) && options.skip_pools.indexOf(pool) > -1) return true;
        if (Array.isArray(options.allow_columns) && options.allow_columns.indexOf(name) == -1) return true;
        if (Array.isArray(options.skip_columns) && options.skip_columns.indexOf(name) > -1) return true;
    }
    var col = columns && columns[name];
    if (col) {
        if (Array.isArray(col.allow_pools) && col.allow_pools.indexOf(pool) == -1) return true;
        if (Array.isArray(col.skip_pools) && col.skip_pools.indexOf(pool) > -1) return true;
    }
    return false;
}

// Given object with data and list of keys perform comparison in memory for all rows, return only rows that match all keys. This method is used
// by custom filters in `db.select` by the drivers which cannot perform comparisons with non-indexes columns like DynamoDb, Cassandra.
// The rows that satisfy primary key conditions are returned and then called this function to eliminate the records that do not satisfy non-indexed column conditions.
//
// Options support the following propertis:
// - keys - list of columns to check, these may or may not be the primary keys, any columns to be compared
// - cols - an object with columns definition
// - ops - operations for columns
// - typesMap - types for the columns if different from the actual Javascript type
db.filterRows = function(obj, rows, options)
{
    if (!options) options = lib.empty;
    var ops = options.ops || lib.empty;
    var typesMap = options.typesMap || lib.empty;
    var cols = options.cols || lib.empty;
    var keys = options.keys || [];
    // Keep rows which satisfy all conditions
    return rows.filter(function(row) {
        return keys.every(function(name) {
            return lib.isTrue(row[name], obj[name], ops[name], typesMap[name] || (cols[name] || lib.empty).type);
        });
    });
}

// Return primary keys for a table or empty array, if `allkeys` is given in the options then return
// a list of all properties involed in primary keys including joined columns
db.getKeys = function(table, options)
{
    table = (table || "").toLowerCase();
    var keys = this.getPool(table, options).dbkeys[table] || this.keys[table] || lib.emptylist;
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
    table = (table || "").toLowerCase();
    return this.getPool(table, options).dbindexes[table] || this.indexes[table] || lib.empty;
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
    if (!Array.isArray(keys) || !keys.length) keys = this.getKeys(table, options);
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

    return (keys || lib.emptylist).
            filter(function(x) { return x && x[0] != '_' && typeof obj[x] != "undefined" && !lib.isEmpty(options && options.noempty ? obj[x] : 1) }).
            map(function(x) { return [ options && options.keysMap ? (options.keysMap[x] || x) : x, obj[x] ] }).
            reduce(function(x,y) { x[y[0]] = y[1]; return x; }, {});
}

// Return possibly converted value to be used for inserting/updating values in the database,
// is used for SQL parameterized statements
//
// Parameters:
//  - options - standard pool parameters with pool: property for specific pool
//  - val - the JavaScript value to convert into bind parameter
//  - info - column definition for the value from the cached columns
db.getBindValue = function(table, options, val, info)
{
    return this.getPool(table, options).bindValue(val, info, options);
}

// Return transformed value for the column value returned by the database, same parameters as for getBindValue
db.getColumnValue = function(table, options, val, info)
{
    var cb = this.getPool(table, options).columnValue;
    return typeof cb == "function" ? cb(val, info) : val;
}

// Retrieve cached result or put a record into the cache prefixed with table:key[:key...]
// Options accept the same parameters as for the usual get action but it is very important that all the options
// be the same for every call, especially `select` parameters which tells which columns to retrieve and cache.
// Additional options:
// - prefix - prefix to be used for the key instead of table name
//
//  Example:
//
//      db.getCached("get", "bk_account", { id: req.query.id }, { select: "latitude,longitude" }, function(err, row) {
//          var distance = lib.geoDistance(req.query.latitude, req.query.longitude, row.latitude, row.longitudde);
//      });
//
db.getCached = function(op, table, query, options, callback)
{

    if (typeof options == "function") callback = options,options = null;
    if (typeof callback != "function") callback = lib.noop;
    options = lib.objClone(options, "__cached", true);
    // Always get the full record
    delete options.select;
    var pool = this.getPool(table, options);
    table = pool.resolveTable(op, table, query, options).toLowerCase();
    var req = { op: op, table: table, obj: query, options: options };
    this.prepareRow(pool, req);
    var m = pool.metrics.Timer('cache').start();
    this.getCache(table, req.obj, options, function(data) {
        m.end();
        // Cached value retrieved
        if (data) data = lib.jsonParse(data);
        // Parse errors treated as miss
        if (data) {
            pool.metrics.Counter("hits").inc();
            return callback(null, data, { cached: 1 });
        }
        pool.metrics.Counter("misses").inc();
        // Retrieve account from the database, use the parameters like in Select function
        db[op](table, query, options, function(err, data, info) {
            // Store in cache if no error
            if (data && !err) db.putCache(table, data, options);
            info.cached = 1;
            callback(err, data, info);
        });
    });
}

// Retrieve an object from the cache by key, sets `cacheKey` in the options for later use
db.getCache = function(table, query, options, callback)
{
    var key = this.getCacheKey(table, query, options);
    if (!key) return callback();
    if (options) options.cacheKey = key;
    var ttl2 = this.getCache2Ttl(table, options);
    if (ttl2 > 0) {
        var val = bkcache.lruGet(key, Date.now());
        if (val) {
            logger.debug("getCache2:", "lru:", key, options, 'ttl2:', ttl2);
            return callback(val);
        }
    } else
    if (ttl2 < 0) {
        var obj = this.jsCache2[key];
        if (obj) {
            if (obj[0] >= Date.now() && !lib.isEmpty(obj[1])) {
                logger.debug("getCache2:", "js:", key, options, 'ttl2:', ttl2);
                return callback(lib.objClone(obj[1]));
            } else {
                delete this.jsCache2[key];
            }
        }
    }
    var opts = this.getCacheOptions(table, options);
    ipc.get(key, opts, function(err, val) {
        if (!val) return callback();
        if (ttl2 > 0) {
            bkcache.lruPut(key, val, Date.now() + ttl2);
        } else
        if (ttl2 < 0) {
            val = lib.jsonParse(val);
            db.jsCache2[key] = [Date.now() - ttl2, lib.objClone(val)];
        }
        logger.debug("getCache:", key, opts, 'ttl2:', ttl2);
        callback(val);
    });
}

// Store a record in the cache
db.putCache = function(table, query, options)
{
    var key = options && options.cacheKey ? options.cacheKey : this.getCacheKey(table, query, options);
    if (!key) return;
    var opts = this.getCacheOptions(table, options);
    var val = lib.stringify(query);
    var ttl2 = this.getCache2Ttl(table, options);
    if (ttl2 > 0) {
        bkcache.lruPut(key, val, Date.now() + ttl2);
    } else
    if (ttl2 < 0) {
        this.jsCache2[key] = [Date.now() - ttl2, lib.objClone(query)];
    }
    ipc.put(key, val, opts);
    logger.debug("putCache:", key, opts, 'ttl2:', ttl2);
}

// Notify or clear cached record, this is called after del/update operation to clear cached version by primary keys
db.delCache = function(table, query, options)
{
    var key = options && options.cacheKey ? options.cacheKey : this.getCacheKey(table, query, options);
    if (!key) return;
    var opts = this.getCacheOptions(table, options);
    var ttl2 = this.getCache2Ttl(table, options);
    if (ttl2 > 0) {
        bkcache.lruDel(key);
    } else
    if (ttl2 < 0) {
        delete this.jsCache2[key];
    }
    ipc.del(key, opts);
    logger.debug("delCache:", key, opts, 'ttl2:', ttl2);
}

// Returns concatenated values for the primary keys, this is used for caching records by primary key
db.getCacheKey = function(table, query, options)
{
    if (options && options.cacheKey) return options.cacheKey;
    var keys = this.getKeys(table, options).filter(function(x) { return query[x] }).map(function(x) { return query[x] }).join(this.separator);
    if (keys) keys = (options && options.cachePrefix ? options.cachePrefix : table) + this.separator + keys;
    return keys;
}

// Setup common cache properties
db.getCacheOptions = function(table, options)
{
    var ttl = this.cacheTtl[table] || this.cacheTtl.default;
    var cacheName = (options && options.pool ? this.cacheName[options.pool + "." + table] : "") || this.cacheName[table];
    if (ttl || cacheName) return { cacheName: cacheName, ttl: ttl };
    return null;
}

// Return TTL for level 2 cache, negative means use js cache
db.getCache2Ttl = function(table, options)
{
    var pool = this.getPool(table, options);
    var ttl = this.jscache2[pool.name + "-" + table] || this.jscache2[table];
    return ttl > 0 ? -ttl : this.cache2[pool.name + "-" + table] || this.cache2[table];
}

// Callback to be called by the config parser to preprocess a config parameter for generic options, the options
// is an object with all the info about the parameter, all values can be modified to change the behavior, if not used
// the config parameter will be a string value assigned in the pool's `configOptions`.
db.parsePoolOptions = function(val, options)
{
    this.modules.forEach(function(x) {
        if (typeof x.parsePoolOptions == "function") x.parsePoolOptions(val, options);
    });
}

// Create a new database pool with default methods and properties
// - options - an object with default pool properties
//    - type - pool type, this is the db driver name
//    - pool or name - pool name
//    - watchfile - file path to be watched for changes, all clients will be destroyed gracefully
//    - min - min number of open database connections
//    - max - max number of open database connections, all attempts to run more will result in clients waiting for the next available db connection, if set to 0 no
//            pooling will be enabled and will result in the unlimited connections, this is default for DynamoDB
//    - max_queue - how many db requests can be in the waiting queue, above that all requests will be denied instead of putting in the waiting queue
//
// The db methods cover most use cases but in case native driver needs to be used this is how to get the client and use it with its native API,
// it is required to call `pool.release` at the end to return the connection back to the connection pool.
//
//          var pool = db.getPool("", { pool: "mongodb" });
//          pool.get(function(err, client) {
//              var collection = client.collection('bk_account');
//              collection.findOne({ id: '123' }, function() {
//                  pool.release(client);
//              });
//          });
//
db.Pool = function(options)
{
    // Methods for db client allocations and release
    if (lib.isPositive(options.max)) {
        var methods = {
            create: function(callback) {
                try {
                    this.open.call(this, callback);
                } catch(e) {
                    logger.error('pool.create:', this.name, e);
                    callback(e);
                }
            },
            reset: function(client) {
                if (typeof client.reset == "function") client.reset();
            },
            destroy: function(client, callback) {
                try {
                    this.close.call(this, client, callback);
                } catch(e) {
                    logger.error("pool.destroy:", this.name, e);
                    if (typeof callback == "function") callback(e);
                }
            },
        };
        lib.Pool.call(this, methods);
    } else {
        lib.Pool.call(this);
    }
    this.type = options.type || "none";
    this.name = options.pool || options.name || options.type;
    this.url = options.url || "default";
    this.metrics = new metrics.Metrics('name', this.name);
    this.configOptions = {};
    this.connectOptions = {};
    this.dbcolumns = {};
    this.dbkeys = {};
    this.dbindexes = {};
    this.dbcapacity = {};
    this.configure(options);
}

util.inherits(db.Pool, lib.Pool);

// Reconfigure properties, only subset of properties are allowed here so it is safe to apply all of them directly,
// this is called during realtime config update
db.Pool.prototype.configure = function(options)
{
    this.init(options);
    if (options.url) this.url = options.url;
    if (lib.isObject(options.configOptions)) this.configOptions = lib.objMerge(this.configOptions, options.configOptions);
    if (lib.isObject(options.connectOptions)) this.connectOptions = lib.objMerge(this.connectOptions, options.connectOptions);
    logger.debug("pool.configure:", this.name, this.type, options);
}

db.Pool.prototype.shutdown = function(callback, maxtime)
{
    lib.Pool.prototype.shutdown.call(this, function() {
        db.metrics = new metrics.Metrics();
        db.dbcolumns = db.dbkeys = db.dbindexes = {};
        db.configOptions = db.connectOptions = {};
        if (typeof callback == "function") callback();
    }, maxtime);
}

// Open a connection to the database, default is to return an empty object as a client
db.Pool.prototype.open = function(callback)
{
    if (typeof cb == "function") callback(null, {});
};

// Close a connection, default is do nothing
db.Pool.prototype.close = function(client, callback)
{
    if (typeof callback == "function") callback();
}

// Query the database, always return an array as a result (i.e. the second argument for the callback)
db.Pool.prototype.query = function(client, req, options, callback)
{
    if (typeof callback == "function") callback(null, []);
}

// Cache columns for all tables
db.Pool.prototype.cacheColumns = function(options, callback)
{
    if (typeof callback == "function") callback();
}

// Cache indexes for all tables
db.Pool.prototype.cacheIndexes = function(options, callback)
{
    if (typeof callback == "function") callback();
};

// Return next token from the client object
db.Pool.prototype.nextToken = function(client, req, rows)
{
    return client.next_token || null;
};

// Default prepare is to return all parameters in an object
db.Pool.prototype.prepare = function(req)
{
}

// Return the value to be used in binding, mostly for SQL drivers, on input value and col info are passed, this callback
// may convert the value into something different depending on the DB driver requirements, like timestamp as string into milliseconds
db.Pool.prototype.bindValue = function(value, info, options)
{
    return value;
}

// Converts native DB driver error into other human readable format
db.Pool.prototype.convertError = function(table, op, err, options)
{
    return err;
}

// that is called after this pool cached columms from the database, it is called sychnroniously inside the `db.cacheColumns` method.
db.Pool.prototype.processColumns = function(pool)
{
}

// Return possible different table at the time of the query, it is called by the `db.prepare` method
// and if exist it must return the same or new table name for the given query parameters.
db.Pool.prototype.resolveTable = function(op, table, obj, options)
{
    return table;
}

// Create a database pool for SQL like databases
// - options - an object defining the pool, the following properties define the pool:
//    - pool - pool name/type, if not specified the SQLite is used
//    - max - max number of clients to be allocated in the pool
//    - idle - after how many milliseconds an idle client will be destroyed
db.SqlPool = function(options)
{
    // SQL databases cannot support unlimited connections, keep reasonable default to keep it from overloading
    if (!lib.isPositive(options.max)) options.max = 25;

    db.Pool.call(this, options);
    this.configOptions = lib.objMerge(this.configOptions, db.sqlConfigOptions);
}
util.inherits(db.SqlPool, db.Pool);

// Call column caching callback with our pool name
db.SqlPool.prototype.cacheColumns = function(options, callback)
{
    db.sqlCacheColumns(this, options, callback);
}

// Prepare for execution, return an object with formatted or transformed SQL query for the database driver of this pool
db.SqlPool.prototype.prepare = function(req)
{
    db.sqlPrepare(this, req);
}

// Execute a query or if req.text is an Array then run all queries in sequence
db.SqlPool.prototype.query = function(client, req, options, callback)
{
    db.sqlQuery(this, client, req, options, callback);
}

// Support for pagination, for SQL this is the OFFSET for the next request
db.SqlPool.prototype.nextToken = function(client, req, rows)
{
    return req.options && req.options.count && rows.length == req.options.count ? lib.toNumber(req.options.start) + lib.toNumber(req.options.count) : null;
}

db.SqlPool.prototype.updateAll = function(table, query, obj, options, callback)
{
    var req = db.prepare("update", table, query, obj, lib.objExtend(options, "keys", Object.keys(obj)));
    db.query(req, req.options, callback);
}

db.SqlPool.prototype.delAll = function(table, query, options, callback)
{
    var req = db.prepare("del", table, query, lib.objExtend(options, "keys", Object.keys(query)));
    db.query(req, req.options, callback);
}
