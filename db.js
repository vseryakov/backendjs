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
var utils = require(__dirname + '/build/Release/backend');
var logger = require(__dirname + '/logger');
var core = require(__dirname + '/core');
var lib = require(__dirname + '/lib');
var ipc = require(__dirname + '/ipc');
var aws = require(__dirname + '/aws');
var cluster = require('cluster');
var os = require('os');
var metrics = require(__dirname + "/metrics");

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
// The following databases are supported with the basic db API methods: Sqlite, PostgreSQL, MySQL, DynamoDB, MongoDB, Cassandra, Redis, LMDB, LevelDB
//
// All these drivers fully support all methods and operations, some natively, some with emulation in the user space except Redis driver cannot perform sorting
// due to using Hash items for records, sorting can be done in memory but with pagination it is not possible so this part must be mentioned specifically. But the rest of the
// opertions on top of Redis are fully supported which makes it a good candidate to use for in-memory tables like sessions with the same database API, later moving to
// other database will not require any application code changes.
//
// Multiple connections of the same type can be opened, just add -n suffix to all database config parameters where n is 1 to 5, referer to such pools int he code as `pgsql1`.
//
// Example:
//
//          db-pgsql-pool = postgresql://locahost/backend
//          db-pgsql-pool-1 = postgresql://localhost/billing
//          db-pgsql-pool-max-1 = 100
//
var db = {
    name: 'db',

    // Config parameters
    args: [{ name: "pool", dns: 1, descr: "Default pool to be used for db access without explicit pool specified" },
           { name: "name", key: "db-name", descr: "Default database name to be used for default connections in cases when no db is specified in the connection url" },
           { name: "no-cache-columns", type: "bool", descr: "Do not load column definitions from the database tables on startup, keep using in-app Javascript definitions only, in most cases caching columns is not required if tables are in sync between the app and the database" },
           { name: "cache-columns-interval", type: "int", descr: "How often in minutes to refresh tables columns from the database, it calls cacheColumns for each pool" },
           { name: "no-init-tables", type: "regexp", novalue: ".+", descr: "Do not create tables in the database on startup and do not perform table upgrades for new columns, all tables are assumed to be created beforehand, this regexp will be applied to all pools if no pool-specific parameer defined" },
           { name: "cache-tables", array: 1, type: "list", descr: "List of tables that can be cached: bk_auth, bk_counter. This list defines which DB calls will cache data with currently configured cache. This is global for all db pools." },
           { name: "cache-ttl", type: "int", obj: "cacheTtl", key: "default", descr: "Default global TTL for cached tables", },
           { name: "cache-ttl-(.+)", type: "int", obj: "cacheTtl", nocamel: 1, strip: "cache-ttl-", descr: "TTL in milliseconds for each individual table being cached", },
           { name: "local", descr: "Local database pool for properties, cookies and other local instance only specific stuff" },
           { name: "config", descr: "Configuration database pool to be used to retrieve config parameters from the database, must be defined to use remote db for config parameters, set to `default` to use current default pool" },
           { name: "config-interval", type: "number", min: 0, descr: "Interval between loading configuration from the database configured with -db-config-type, in seconds, 0 disables refreshing config from the db" },
           { name: "([a-z0-9]+)-pool(-[0-9]+)?", obj: 'poolNames', strip: "Pool", novalue: "default", descr: "A database pool name, depending on the driver it can be an URL, name or pathname, examples of db pools: ```-db-pgsql-pool, -db-dynamodb-pool```, examples of urls: ```postgresql://[user:password@]hostname[:port]/db, mysql://[user:password@]hostname/db, mongodb://hostname[:port]/dbname, cql://[user:password@]hostname[:port]/dbname```" },
           { name: "(.+)-pool-max(-[0-9]+)?", obj: 'poolParams', strip: "Pool", type: "number", min: 1, descr: "Max number of open connections for a pool, default is Infinity" },
           { name: "(.+)-pool-min(-[0-9]+)?", obj: 'poolParams', strip: "Pool", type: "number", min: 1, descr: "Min number of open connections for a pool" },
           { name: "(.+)-pool-idle(-[0-9]+)?", obj: 'poolParams', strip: "Pool", type: "number", min: 1000, descr: "Number of ms for a db pool connection to be idle before being destroyed" },
           { name: "(.+)-pool-tables(-[0-9]+)?", obj: 'poolParams', strip: "Pool", type: "list", array: 1, descr: "A DB pool tables, list of tables that belong to this pool only" },
           { name: "(.+)-pool-connect(-[0-9]+)?", obj: 'poolParams', strip: "Pool", type: "json", descr: "Options for a DB pool driver passed during connection or creation of the pool" },
           { name: "(.+)-pool-settings(-[0-9]+)?", obj: 'poolParams', strip: "Pool", type: "json", descr: "A DB pool driver settings passed to every request, contains pool-wide options and features upported by the driver" },
           { name: "(.+)-pool-no-cache-columns(-[0-9]+)?", obj: 'poolParams', strip: "Pool", type: "bool", descr: "disable caching table columns for this pool only" },
           { name: "(.+)-pool-no-init-tables(-[0-9]+)?", type: "regexp", obj: 'poolParams', strip: "Pool", novalue: ".+", descr: "Do not create tables for this pool only, a regexp of tables to skip" },
           { name: "describe-tables", type: "callback", callback: function(v) { this.describeTables(lib.jsonParse(v, {obj:1,error:1})) }, descr: "A JSON object with table descriptions to be merged with the existing definitions" },
    ],

    // Database connection pools by pool name
    pools: {},

    // Configuration parameters
    poolNames: { sqlite: "" },
    poolParams: { sqliteIdle: 900000 },

    // Default database name
    dbName: "backend",

    // Pools by table name
    poolTables: {},

    // Tables to be cached
    cacheTables: [],
    cacheTtl: {},

    // Default database pool for the backend
    pool: 'sqlite',

    // Local db pool, sqlite is default, used for local storage by the core
    local: 'sqlite',
    // If true, only local and config db pools will be initialized
    localMode: false,

    // Refresh config from the db
    configInterval: 86400,

    // Refresh columns from time to time to have the actual table columns
    cacheColumnsInterval: 1440,

    processRows: {},
    processColumns: [],

    // Separator to combined columns
    separator: "|",

    // Default tables
    tables: {
        // Configuration store, same parameters as in the commandline or config file, can be placed in separate config groups
        // to be used by different backends or workers, 'core' is default global group
        bk_config: { name: { primary: 1 },                      // name of the parameter
                     type: { primary: 1 },                      // config type
                     value: {},                                 // the value
                     mtime: { type: "bigint", now: 1 } },

        // General purpose properties, can be used to store arbitrary values
        bk_property: { name: { primary: 1 },
                       value: {},
                       mtime: { type: "bigint", now: 1 } },

    }, // tables
};

module.exports = db;

// Gracefully close all database pools when the shutdown is initiated by a Web process
db.shutdownWeb = function(options, callback)
{
    var pools = this.getPools();
    lib.forEachLimit(pools, pools.length, function(pool, next) {
        db.pools[pool.name].shutdown(next);
    }, callback);
}

// Initialize all database pools. the options may containt the following properties:
// - localMode - only initialize default, local and config db pools, other pools are ignored, if not given
//    global value is used. Currently it can be set globally from the app only, no config parameter.
db.init = function(options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {};

    // Config pool can be set to default which means use the current default pool
    ["localMode"].forEach(function(x) {
        if (typeof options[x] != "undefined") self[x] = options[x];
    });

    // Merge all tables from all modules
    for (var p in core.modules) {
        if (p != this.name && lib.isObject(core.modules[p].tables)) this.describeTables(core.modules[p].tables);
    }

    logger.debug("db.init:", core.role, Object.keys(this.poolNames), Object.keys(this.pools));

    // Configured pools for supported databases
    lib.forEachSeries(Object.keys(this.poolNames), function(pool, next) {
        if (self.localMode && pool != self.pool && pool != self.local && pool != self.config) return next();
        self.initPool(pool, options, function(err) {
            if (err) logger.error("init: db:", pool, err);
            next();
        });
    }, callback);
}

// Initialize a db pool by parameter name.
// Options can have the following properties:
//   - noInitTables - if defined it is used instead of the global parameter
//   - noCacheColumns - if defined it is used instead of the global parameter
//   - force - if true, close existing pool with the same name, otherwise skip existing pools
db.initPool = function(name, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {};
    if (typeof callback != "function") callback = lib.noop;

    // Pool db connection parameter must exists even if empty
    var url = this.poolNames[name];
    if (typeof url == "undefined") return callback();

    var d = name.match(/^([a-z]+)([0-9]+)?$/);
    if (!d) return callback(lib.newError("invalid pool " + name));
    var type = d[1];
    var n = d[2] || "";
    if (!self[type + "InitPool"]) return callback(lib.newError("invalid pool type " + name));

    // Pool specific tables
    (this.poolParams[type + 'Tables' + n] || []).forEach(function(y) { self.poolTables[y] = name; });

    // All pool specific parameters
    var opts = { pool: name,
                 type: type,
                 url: url || "",
                 min: this.poolParams[type + 'Min' + n],
                 max: this.poolParams[type + 'Max' + n],
                 idle: this.poolParams[type + 'Idle' + n] || 300000,
                 noCacheColumns: options.noCacehColumns || this.poolParams[type + 'NoCacheColumns' + n],
                 noInitTables: options.noInitTables || this.poolParams[type + 'NoInitTables' + n],
                 connect: this.poolParams[type + 'Connect' + n],
                 settings: this.poolParams[type + 'Settings' + n] };

    // Do not re-create the pool if not forced, just update the properties
    if (this.pools[name]) {
        if (!options.force) {
            this.pools[name].configure(opts);
            return callback();
        }
        this.pools[name].shutdown();
        this.pools[name] = null;
    }

    logger.debug("initPool:", type, name);

    this[type + 'InitPool'](opts);
    this.initPoolTables(name, this.tables, options, callback);
}

// Load configuration from the config database, must be configured with `db-config-type` pointing to the database pool where bk_config table contains
// configuration parameters.
//
// The priority of the paramaters is fixed and goes form the most broad to the most specific, most specific always wins, this allows
// for very flexible configuration policies defined by the app or place where instances running and separated by the run mode.
//
// The following list of properties will be queried from the config database and the sorting order is very important, the last values
// will override values received for the eqrlier properties, for example, if two properties defined in the `bk_config` table with the
// types `myapp` and `prod-myapp`, then the last value will be used only.
//
// All attributes will be added multiple times in the following order, `name` being the attribute listed below:
//    `name`, runMode-`name`, appName-`name`, runMode-appName-`name`
//
// The priority of the attributes is the following:
//  - the run mode specified in the command line `-run-mode`: `prod`
//  - the application name: `myapp`
//  - the application version specified in the package.json: `1.0.0`
//  - the network where the instance is running, first 2 octets from the current IP address: `192.168`
//  - the region where the instance is running, AWS region or other name: `us-east-1`
//  - the network where the instance is running, first 2 octets from the current IP address: `192.168.1`
//  - the zone where the instance is running, AWS availability zone or other name: `us-east-1a`
//  - current instance tag or a custom tag for ad-hoc queries: `nat`
//  - current instance IP address: `192.168.1.1`
//
// The options takes the following properties:
//  - force - if true then force to refresh and reopen all db pools
//  - delta - if true then pull only records updated since the last config pull using the max mtime from received records.
//
// On return, the callback second argument will receive all parameters received form the database as a list: -name value ...
db.initConfig = function(options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null
    if (!options) options = {};
    if (typeof callback != "function") callback = lib.noop;

    // The order of the types here defines the priority of the parameters, most specific at the end always wins
    var types = [], argv = [];

    // All other entries in order of priority with all common prefixes
    var items = [ core.runMode,
                  core.appName,
                  core.appVersion,
                  options.network || core.network,
                  options.region || core.instance.region,
                  options.subnet || core.subnet,
                  options.zone || core.instance.zone,
                  options.tag || core.instance.tag,
                  options.ipaddr || core.ipaddr ];

    items.forEach(function(x) {
        if (!x) return;
        x = String(x).trim();
        if (!x) return;
        types.push(x);
        if (x != core.runMode) types.push(core.runMode + "-" + x);
        if (x != core.appName) types.push(core.appName + "-" + x);
        if (x != core.runMode && x != core.appName) types.push(core.runMode + "-" + core.appName + "-" + x);
    });
    // Make sure we have only unique items in the list, skip empty or incomplete items
    types = lib.strSplitUnique(types);

    logger.debug("initConfig:", core.role, this.config, types, this._configMtime);

    self.select(options.table || "bk_config", { type: types, mtime: options.delta ? this._configMtime : 0 }, { ops: { type: "in", mtime: "gt" }, pool: this.config }, function(err, rows) {
        if (err) return callback(err, []);

        // Sort inside to be persistent across databases
        rows.sort(function(a,b) { return types.indexOf(b.type) - types.indexOf(a.type); });
        logger.dev("initConfig:", core.role, rows);

        // Testing mode just return all retrieved sorted rows
        if (options.test) return callback(null, rows)

        // Only keep the most specific value, it is sorted in descendent order most specific at the top
        var args = {};
        rows.forEach(function(x) {
            self._configMtime = Math.max(self._configMtime || 0, x.mtime);
            if (args[x.name]) return;
            args[x.name] = 1;
            argv.push('-' + x.name);
            if (x.value) argv.push(x.value);
        });
        core.parseArgs(argv);

        // Refresh from time to time with new or modified parameters, randomize a little to spread across all servers
        if (self.configInterval > 0 && self.configInterval != self._configInterval) {
            if (self._configTimer) clearInterval(self._configTimer);
            self._configTimer = setInterval(function() { self.initConfig(); }, self.configInterval * 1000 + lib.randomShort());
            self._configInterval = self.configInterval;
        }
        // Init more db pools
        self.init(options, function(err) {
            callback(err, argv);
        });
    });
}

// Create tables in all pools
db.initTables = function(options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;

    lib.forEachSeries(Object.keys(self.pools), function(name, next) {
        self.initPoolTables(name, self.tables, options, next);
    }, callback);
}


// Init the pool, create tables and columns:
//  - name - db pool to create the tables in
//  - tables - an object with list of tables to create or upgrade
//  - noInitTables - a regexp that defines which tables should not be created/upgraded, overrides global parameter
//  - noCacheColumns - if 1 tells to skip caching database columns, overrides the global parameter
db.initPoolTables = function(name, tables, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};
    if (typeof callback != "function") callback = lib.noop;
    if (name == "none") return callback();

    // Add tables to the list of all tables this pool supports
    var pool = this.getPool('', { pool: name });
    // Collect all tables in the pool to be merged with the actual tables later
    for (var p in tables) pool.dbtables[p] = tables[p];
    options.pool = name;

    // These options can redefine behaviour of the initialization sequence
    var noCacheColumns = options.noCacheColumns || pool.noCacheColumns || pool.settings.noCacheColumns || this.noCacheColumns;
    var noInitTables = options.noInitTables || pool.noInitTables || pool.settings.noInitTables || this.noInitTables;
    logger.debug('initPoolTables:', core.role, name, noCacheColumns || 0, '/', noInitTables || 0, Object.keys(tables));

    // Skip loading column definitions from the database, keep working with the javascript models only
    if (noCacheColumns) {
        this.mergeColumns(pool);
        this.mergeKeys(pool);
        return callback();
    }
    // Periodic columns refresh
    if (this.cacheColumnsInterval > 0 && !pool._columnsTimer) {
        pool._columnsTimer = setInterval(function() { self.initPoolTables(name, {}, options); }, this.cacheColumnsInterval * 60000);
    }
    this.cacheColumns(options, function() {
        var changes = 0;
        lib.forEachSeries(Object.keys(pool.dbtables), function(table, next) {
            // Skip tables not supposed to be created
            if (lib.typeName(noInitTables) == "regexp" && noInitTables.test(table)) return next();
            // We if have columns, SQL table must be checked for missing columns and indexes
            var cols = self.getColumns(table, options);
            if (!cols || Object.keys(cols).every(function(x) { return cols[x].fake })) {
                self.create(table, pool.dbtables[table], options, function(err, rows, info) {
                    if (info.affected_rows) changes++;
                    next();
                });
            } else {
                // Refreshing columns after an upgrade is only required by the driver which depends on
                // the actual db schema, in any case all columns are merged so no need to re-read just the columns,
                // the case can be to read new indexes used in searches, this is true for DynamoDB.
                self.upgrade(table, pool.dbtables[table], options, function(err, rows, info) {
                    if (info.affected_rows) changes++;
                    next();
                });
            }
        }, function() {
            if (!changes) return callback();
            logger.info('initPoolTables:', name, 'changes:', changes);
            self.cacheColumns(options, callback);
        });
    });
}

// Delete all specified tables from the pool, if `name` is empty then default pool will be used, `tables` is an object with table names as
// properties, same table definition format as for create table method
db.dropPoolTables = function(name, tables, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    if (name) options.pool = name;
    var pool = self.getPool('', options);
    lib.forEachSeries(Object.keys(tables || {}), function(table, next) {
        self.drop(table, options, function() { next() });
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
//     - async_filter - perform filtering of the result but with possible I/O so it can delay returning results: function(req, rows, options, callback),
//          the calback on result will return err and rows as any other regular database callbacks. This filter can be used to perform
//          filtering based on the ata in the other table for example.
//     - silence_error - do not report about the error in the log, still the error is retirned to the caller
//     - noprocessrows - if true then skip post processing result rows, return the data as is, this will result in returning combined columns as it is
//     - noconvertrows - if true skip converting the data from the database format into Javascript data types, it uses column definitions
//       for the table to convert values returned from the db into the the format defined by the column
//     - cached - if true perform cache invalidation for the operations that resulted in modification of the table record(s)
//     - total - if true then it is supposed to return only one record with property `count`, skip all post processing and convertion
// - callback(err, rows, info) where
//    - info is an object with information about the last query: inserted_oid,affected_rows,next_token
//    - rows is always returned as a list, even in case of error it is an empty list
//
//  Example with SQL driver
//
//          db.query({ text: "SELECT a.id,c.type FROM bk_account a,bk_connection c WHERE a.id=c.id and a.id=?", values: ['123'] }, { pool: 'pgsql' }, function(err, rows, info) {
//          });
//
db.query = function(req, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (typeof callback != "function") callback = lib.noop;
    if (!lib.isObject(req)) return callback(lib.newError("invalid request"));
    if (!options) options = {};

    var table = req.table || "";
    var pool = this.getPool(table, options);

    // Metrics collection
    var m1 = pool.metrics.Timer('que').start();
    pool.metrics.Histogram('req').update(pool.metrics.Counter('count').inc());
    pool.metrics.Counter('req_0').inc();

    function onEnd(err, client, rows, info) {
        if (client) pool.release(client);

        m1.end();
        pool.metrics.Counter('count').dec();

        if (err && !options.silence_error) {
            pool.metrics.Counter("err_0").inc();
            logger.error("db.query:", pool.name, err, 'REQ:', req, 'OPTS:', options, err.stack);
        } else {
            logger.debug("db.query:", pool.name, m1.elapsed, 'ms', rows.length, 'rows', 'REQ:', req, 'INFO:', info, 'OPTS:', options);
        }
        if (typeof callback == "function") {
            try {
                // Auto convert the error according to the rules
                if (err && pool.convertError) err = pool.convertError(table, req.op || "", err, options);
                callback(err, rows, info);
            } catch(e) {
                logger.error("db.query:", pool.name, e, 'REQ:', req, 'OPTS:', options, e.stack);
            }
        }
    }

    pool.acquire(function(err, client) {
        if (err) return onEnd(err, null, [], {});

        try {
            pool.query(client, req, options, function(err, rows, info) {
                if (err) return onEnd(err, client, [], {});

                try {
                    if (!rows) rows = [];
                    if (!info) info = {};
                    if (!info.affected_rows) info.affected_rows = client.affected_rows || 0;
                    if (!info.inserted_oid) info.inserted_oid = client.inserted_oid || null;
                    if (!info.next_token) info.next_token = pool.nextToken(client, req, rows, options);

                    pool.release(client);
                    client = null;

                    // Cache notification in case of updates, we must have the request prepared by the db.prepare
                    var cached = options.cached || self.cacheTables.indexOf(table) > -1;
                    if (cached && table && req.obj && req.op && ['put','update','incr','del'].indexOf(req.op) > -1) {
                        self.delCache(table, req.obj, options);
                    }

                    // Make sure no duplicates
                    if (options.unique) {
                        items = lib.arrayUnique(items, options.unique);
                    }

                    // With total we only have one property 'count'
                    if (options.total) {
                        return onEnd(err, client, rows, info);
                    }

                    // Convert from db types into javascript, deal with json and joined columns
                    if (rows.length && !options.noconvertrows) {
                        self.convertRows(pool, req, rows, options);
                    }

                    // Convert values if we have custom column callback
                    if (!options.noprocessrows) {
                        rows = self.runProcessRows("post", req, rows, options);
                    }

                    // Custom filter to return the final result set
                    if (typeof options.filter == "function" && rows.length) {
                        rows = rows.filter(function(row) { return options.filter(req, row, options); })
                    }

                    // Async filter, can perform I/O for filtering
                    if (typeof options.async_filter == "function" && rows.length) {
                        return options.async_filter(req, rows, options, function(err, rows) { onEnd(err, client, rows, info); });
                    }

                } catch(e) {
                    err = e;
                    rows = [];
                }
                onEnd(err, client, rows, info);
            });
        } catch(e) {
            onEnd(e, client, [], {});
        }
    });
}

// Insert new object into the database
// - obj - an JavaScript object with properties for the record, primary key properties must be supplied
// - options may contain the following properties:
//      - all_columns - do not check for actual columns defined in the pool tables and add all properties from the obj, only will work for NoSQL dbs,
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
    options = this.getOptions(table, options);
    var req = this.prepare("add", table, obj, options);
    this.query(req, options, callback);
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
    options = this.getOptions(table, options);

    // Custom handler for the operation
    var pool = this.getPool(table, options);
    if (pool.put) return pool.put(table, obj, options, callback);

    var req = this.prepare("put", table, obj, options);
    this.query(req, options, callback);
}

// Update existing object in the database.
// - obj - is an actual record to be updated, primary key properties must be specified
// - options - same properties as for `db.add` method with the following additional properties:
//     - ops - object for comparison operators for primary key, default is equal operator
//     - opsMap - operator mapping into supported by the database
//     - typesMap - type mapping for properties to be used in the condition
//     - expected - an object with the condition for the update, it is used in addition to the primary keys condition from the `obj`
//     - join - how to join all expressions, default is AND
//     - updateOps - an object with column names and operations to be performed on the named column
//        - incr - increment by given value
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
db.update = function(table, obj, options, callback)
{
    if (typeof options == "function") callback = options,options = null;
    options = this.getOptions(table, options);
    var req = this.prepare("update", table, obj, options);
    this.query(req, options, callback);
}

// Update all records that match given condition in the `query`, one by one, the input is the same as for `db.select` and every record
// returned will be updated using `db.update` call by the primary key, so make sure options.select include the primary key for every row found by the select.
//
// All properties from the `obj` will be set in every matched record.
//
// The callback will receive on completion the err and all rows found and updated. This is mostly for non-SQL databases and for very large range it may take a long time
// to finish due to sequential update every record one by one.
// Special properties that can be in the options for this call:
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
//                        function(err, rows) {
//          });
//
db.updateAll = function(table, query, obj, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options,options = {};
    options = this.getOptions(table, options);
    if (typeof callback != "function") callback = lib.noop;

    // Custom handler for the operation
    var pool = this.getPool(table, options);
    if (typeof pool.updateAll == "function" && typeof options.process != "function") return pool.updateAll(table, query, obj, options, callback);

    var cap = db.getCapacity(table);
    self.select(table, query, options, function(err, rows) {
        if (err) return callback(err);

        var opts = lib.cloneObj(options, 'ops', {});
        lib.forEachLimit(rows, options.concurrency || 1, function(row, next) {
            for (var p in obj) row[p] = obj[p];
            if (typeof options.process == "function") options.process(row, opts);
            self.update(table, row, opts, function(err) {
                if (err) return next(err);
                db.checkCapacity(cap, next);
            })
        }, function(err) {
            callback(err, rows);
        });
    });
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
    options = this.getOptions(table, options);
    if (!lib.searchObj(options.updateOps, { value: "incr", count: 1 })) {
        if (!lib.isObject(options.updateOps)) options.updateOps = {};
        var cols = this.getColumns(table, options);
        for (var p in cols) {
            if (cols[p].type == "counter") options.updateOps[p] = "incr";
        }
    }

    var req = this.prepare("incr", table, obj, options);
    this.query(req, options, callback);
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
    options = this.getOptions(table, options);
    var req = this.prepare("del", table, obj, options);
    this.query(req, options, callback);
}

// Delete all records that match given condition, one by one, the input is the same as for `db.select` and every record
// returned will be deleted using `db.del` call. The callback will receive on completion the err and all rows found and deleted.
// Special properties that can be in the options for this call:
// - concurrency - how many delete requests to execute at the same time by using lib.forEachLimit.
// - process - a function callback that will be called for each row before deleting it, this is for some transformations of the record properties
//   in case of complex columns that may contain concatenated values as in the case of using DynamoDB. The callback will be called
//   as `options.process(row, options)`
db.delAll = function(table, query, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options,options = {};
    options = this.getOptions(table, options);
    if (typeof callback != "function") callback = lib.noop;

    // Custom handler for the operation
    var pool = this.getPool(table, options);
    if (typeof pool.delAll == "function" && typeof options.process != "function") return pool.delAll(table, query, options, callback);

    var cap = db.getCapacity(table);

    // Options without ops for delete
    var opts = lib.cloneObj(options, 'ops', {});
    self.select(table, query, options, function(err, rows) {
        if (err) return callback(err);

        lib.forEachLimit(rows, options.concurrency || 1, function(row, next) {
            if (typeof options.process == "function") options.process(row, opts);
            self.del(table, row, opts, function(err) {
                if (err) return next(err);
                db.checkCapacity(cap, next);
            });
        }, function(err) {
            callback(err, rows);
        });
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
    var self = this;
    if (typeof options == "function") callback = options,options = {};
    options = this.getOptions(table, options);
    if (typeof callback != "function") callback = lib.noop;

    var keys = this.getKeys(table, options);
    var select = keys[0];
    // Use mtime to check if we need to update this record
    if (options.check_mtime && obj[options.check_mtime]) {
        select = options.check_mtime;
    } else
    // Check if values are different from existing value, skip if the records are the same by comparing every field
    if (options.check_data) {
        var cols = self.getColumns(table, options);
        var list = Array.isArray(options.check_data) ? options.check_data : Object.keys(obj);
        select = list.filter(function(x) { return x[0] != "_"  && x != 'mtime' && keys.indexOf(x) == -1 && (x in cols); }).join(',');
        if (!select) select = keys[0];
    }

    var req = this.prepare("get", table, obj, { select: select, pool: options.pool });
    if (!req) {
        if (options.put_only) return callback(null, []);
        return self.add(table, obj, options, callback);
    }

    // Create deep copy of the object so we have it complete inside the callback
    obj = lib.cloneObj(obj);

    self.query(req, options, function(err, rows) {
        if (err) return callback(err, []);

        logger.debug('db.replace:', req, rows.length);
        if (rows.length) {
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
            self.update(table, obj, options, callback);
        } else {
            if (options.put_only) return callback(null, []);
            self.add(table, obj, options, callback);
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
            query = query.map(function(x) { return lib.newObj(keys[0], x) });
        }
        break;

    default:
        return callback(lib.newError("invalid list"), []);
    }
    if (!query.length) return callback(null, []);
    this.select(table, query, options, callback);
}

// Perform a batch of operations at the same time.
// - op - is one of add, put, update, del
// - objs a list of objects to put/delete from the database
// - options can have the follwoing:
//   - concurrency - number of how many operations to run at the same time, 1 means sequential
//   - ignore_error - will run all operations without stopping on error, the callback will have third argument which is an array of arrays with failed operations
//
//  Example:
//
//          db.batch("bc_counter", "add", [{id:1",like0:1}, {id:"2",like0:2}], db.showResult)
//
//
db.batch = function(table, op, objs, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options,options = {};
    options = this.getOptions(table, options);
    if (typeof callback != "function") callback = lib.noop;

    // Custom handler for the operation
    var pool = this.getPool(table, options);
    if (pool.batch) return pool.batch(table, op, objs, options, callback);
    var info = [];

    lib.forEachLimit(objs, options.concurrency || 1, function(obj, next) {
        db[op](table, obj, options, function(err) {
            if (err && options.ignore_error) {
                info.push([ err, obj ]);
                return next();
            }
            next(err);
        });
    }, function(err) {
        callback(err, [], info);
    });
}

// Convenient helper for scanning a table for some processing, rows are retrieved in batches and passed to the callback until there are no more
// records matching given criteria. The obj is the same as passed to the `db.select` method which defined a condition which records to get.
// The rowCallback must be present and is called for every row or batch retrieved and second parameter which is the function to be called
// once the processing is complete. At the end, the callback will be called just with 1 argument, err, this indicates end of scan operation.
// Basically, db.scan is the same as db.select but can be used to retrieve large number of records in batches and allows async processing of such records.
//
// Parameters:
//  - table - table to scan
//  - query - an object with query conditions, same as in `db.select`
//  - options - same as in `db.select`, with the following additions:
//    - count - size of every batch, default is 100
//    - batch - if true rowCallback will be called with all rows from the batch, not every row individually, batch size is defined by the count property
//    - noscan - if 1 no scan will be performed if no prmary keys are specified
//    - fullscan - if 1 force to scan full table without using any primary key conditons, use all query properties for all records (DynamoDB)
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
    options = this.getOptions(table, options);
    if (!options.count) options.count = 100;
    options.start = "";

    lib.whilst(
      function() {
          return options.start != null;
      },
      function(next) {
          db.select(table, query, options, function(err, rows, info) {
              if (err) return next(err);
              options.start = info.next_token;
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
// - tpmdrop - if 1 then the temporary table will be dropped at the end in case of success, by default it is kept
// - delay - number of milliseconds to wait between the steps
db.migrate = function(table, options, callback)
{
    if (typeof callback != "function") callback = lib.noop;
    if (!options) options = {};
    if (!options.preprocess) options.preprocess = function(row, options, next) { next() }
    if (!options.postprocess) options.postprocess = function(row, options, next) { next() }
    if (!options.delay) options.delay = 1000;
    var pool = db.getPool(table, options);
    var cols = db.getColumns(table, options);
    var tmptable = table + "_tmp";
    var obj = pool.dbtables[table];
    var cap = db.getCapacity(table);
    options.readCapacity = cap.readCapacity;
    options.writeCapacity = cap.writeCapacity;

    lib.series([
        function(next) {
            if (!pool.dbcolumns[tmptable]) return next();
            db.drop(tmptable, { pool: options.tmppool }, next);
        },
        function(next) {
            if (!pool.dbcolumns[tmptable]) return next();
            setTimeout(next, options.delay || 0);
        },
        function(next) {
            pool.dbcolumns[tmptable] = obj;
            db.create(tmptable, obj, { pool: options.tmppool }, next);
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
            db.create(table, obj, options, next);
        },
        function(next) {
            setTimeout(next, options.delay || 0);
        },
        function(next) {
            db.cacheColumns(options, next);
        },
        function(next) {
            db.scan(tmptable, {}, { pool: options.tmppool }, function(row, next2) {
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
// Query in general is a text string with the format that is supported by the underlying driver, the db module does not parse the query at all.
// Options make take the same properties as in the select method. Without full text support this works the same way as the `select` method.
db.search = function(table, query, options, callback)
{
    if (typeof options == "function") callback = options,options = null;
    options = this.getOptions(table, options);
    var req = this.prepare("search", table, query, options);
    this.query(req, options, callback);
}

// Join the given list of records with the records from other table by primary key.
// The properties from the joined table will be merged with the original rows preserving the existing properties
//
// - options.keys defines custom primary key to use instead of table's primary key
// - options.keysMap - an object that defines which property should be used for a key in the given rows, this is
//   for cases when actual primary keys in the table are different from the rows properties.
// - options.existing is 1 then return only joined records.
// - options.override - joined table properties will replace the original table existing properties
// - options.attach - specifies a property name which will be used to attach joined record to the original record, no merging will occur
// - options.incr can be a list of property names that need to be summed up with each other, not overriden
//
// Example:
//
//          db.join("bk_account", [{id:"123",key1:1},{id:"234",key1:2}], db.showResult)
//          db.join("bk_account", [{aid:"123",key1:1},{aid:"234",key1:2}], { keysMap: { id: "aid" }}, db.showResult)
//
db.join = function(table, rows, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    options = this.getOptions(table, options);
    if (typeof callback != "function") callback = lib.noop;

    var map = {}, ids = [];
    var keys = options.keys || self.getKeys(table, options);
    var mkeys = options.keysMap ? keys.map(function(x) { return options.keysMap[x] || x }) : keys;
    var rkeys = options.keysMap ? Object.keys(options.keysMap).reduce(function(x,y) { x[options.keysMap[y]] = y; return x }, {}) : null;
    rows.forEach(function(x) {
        var key = self.getQueryForKeys(mkeys, x, { keysMap: rkeys });
        var k = Object.keys(key).map(function(y) { return key[y]}).join(self.separator);
        if (!map[k]) map[k] = [];
        map[k].push(x);
        ids.push(key);
    });
    db.list(table, ids, options, function(err, list, info) {
        if (err) return callback(err, []);

        list.forEach(function(x) {
            var key = self.getQueryForKeys(keys, x);
            var k = Object.keys(key).map(function(y) { return key[y]}).join(self.separator);
            map[k].forEach(function(row) {
                if (options.attach) {
                    row[options.attach] = x;
                } else {
                    for (var p in x) {
                        if (Array.isArray(options.incr) && options.incr.indexOf(p) > -1) {
                            row[p] = (row[p] || 0) + x[p];
                        } else
                        if (options.override || !row[p]) row[p] = x[p];
                    }
                }
                if (options.existing) row.__1 = 1;
            });
        });
        // Remove not joined rows
        if (options.existing) rows = rows.filter(function(x) { return x.__1; }).map(function(x) { delete x.__1; return x; });
        callback(null, rows, info);
    });
}

// Geo locations search, paginate all results until the end.
// table must be defined with the following required columns:
//  - geohash - location as primary key hash column
//  - id or other column name to be used as a RANGE key for DynamoDB/Cassandra or part of the compsoite primary key for SQL, the result will be sorted by this column for all databases
//  - latitude and longitude as floating numbers to store the actual location
//
//  When defining the table for location searches the begining of the table must be defined as the following:
//
//          db.describeTables({
//                  geo: { geohash: { primary: 1 },
//                         id: { primary: 1 },
//                         latitude: { type: "real" },
//                         longitude: { type: "real" },
//                  }
//          });
//  the rest of the columns can be defined as needed, no special requirements.
//
// `obj` must contain the following:
//  - latitude
//  - longitude
//
// other properties:
//  - distance - in km, the radius around the point, in not given the `min-distance` will be used
//
// all other properties will be used as additional conditions
//
// `options` optional properties:
//  - top - number of first 'top'th records from each neighboring area, to be used with sorting by the range key to take
//     only highest/lowest matches, useful for trending/statistics, count still defines the total number of locations
//  - geokey - name of the geohash primary key column, by default it is `geohash`, it is possible to keep several different
//     geohash indexes within the same table with different geohash length which will allow to perform
//     searches more precisely dependgin on the distance given
//  - round - a number that defines the "precision" of  the distance, it rounds the distance to the nearest
//    round number and uses decimal point of the round number to limit decimals in the distance
//  - sort - sorting order, by default the RANGE key is used for DynamoDB, it is possible to specify any Index as well,
//    in case of SQL this is the second part of the primary key
//
// On first call, query must contain latitude and longitude of the center and optionally distance for the radius. On subsequent calls options must be the
// the next_token returned by the previous call and query will be ignored
//
// On return, the callback's third argument contains the object with next_token that must be provided for subsequent searches until rows array is empty.
//
//  Example
//
//          var query = { latitude: -118, longitude: 30, distance: 10 };
//          db.getLocations("bk_location", query, { round: 5 }, function(err, rows, info) {
//              ...
//              // Get next page using previous info object
//              db.getLocations("bk_location", query, info.next_token, function(err, rows, info) {
//                  ...
//              });
//          });
//
db.getLocations = function(table, query, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (typeof callback != "function") callback = lib.noop;
    options = this.getOptions(table, options);
    var cols = db.getColumns(table, options);
    var keys = db.getKeys(table, options);
    var lcols =  ["geohash", "latitude", "longitude"];
    var rows = [];

    // New location search
    if (!options.geohash) {
        options.count = options.gcount = lib.toNumber(options.count, { float: 0, dflt: 10, min: 0, max: 50 });
        options.geokey = lcols[0] = options.geokey && cols[options.geokey] ? options.geokey : 'geohash';
        options.distance = lib.toNumber(query.distance, { float: 0, dflt: options.minDistance || 1, min: 0, max: 999 });
        options.start = null;
        // Have to maintain sorting order for pagination
        if (!options.sort && keys.length > 1) options.sort = keys[1];
        var geo = lib.geoHash(query.latitude, query.longitude, { distance: options.distance, minDistance: options.minDistance });
        for (var p in geo) options[p] = geo[p];
        query[options.geokey] = geo.geohash;
        options.gquery = query;
        ['latitude', 'longitude', 'distance' ].forEach(function(x) { delete query[x]; });
    } else {
        // Original query
        query = options.gquery;
    }
    if (options.top) options.count = options.top;

    logger.debug('getLocations:', table, 'OBJ:', query, 'GEO:', options.geokey, options.geohash, options.distance, 'km', 'START:', options.start, 'COUNT:', options.count, 'NEIGHBORS:', options.neighbors);

    // Collect all matching records until specified count
    lib.doWhilst(
      function(next) {
          db.select(table, query, options, function(err, items, info) {
              if (err) return next(err);

              // Next page if any or go to the next neighbor
              options.start = info.next_token;

              // If no coordinates but only geohash decode it
              items.forEach(function(row) {
                  row.distance = lib.geoDistance(options.latitude, options.longitude, row.latitude, row.longitude, options);
                  if (row.distance == null) return;
                  // Limit the distance within the allowed range
                  if (options.round > 0 && row.distance - options.distance > options.round) return;
                  // Limit by exact distance
                  if (row.distance > options.distance) return;
                  // If we have selected columns list then clear the columns we dont want
                  if (options.select) Object.keys(row).forEach(function(p) { if (options.select.indexOf(p) == -1) delete row[p]; });
                  rows.push(row);
                  options.count--;
              });
              next(err);
          });
      },
      function() {
          // We have all rows requested
          if (rows.length >= options.gcount) return false;
          // No more in the current geo box, try the next neighbor
          if (!options.start || (options.top && options.count <= 0)) {
              if (!options.neighbors.length) return false;
              query[options.geokey] = options.neighbors.shift();
              if (options.top) options.count = options.top;
              options.start = null;
          }
          return true;
      },
      function(err) {
          // Build next token if we have more rows to search
          var info = {};
          if (options.start || options.neighbors.length > 0) {
              // If we have no start it means this geo box is empty so we need to advance to the next geohash
              // for the next round in order to avoid endless loop
              if (!options.start) query[options.geokey] = options.neighbors.shift();
              // Restore the original count
              options.count = options.gcount;
              // Set most recent query for the next round
              options.gquery = query;
              info.next_token = {};
              ["count","top","geohash","geokey","distance","latitude","longitude","start","neighbors","gquery","gcount"].forEach(function(x) {
                  if (typeof options[x] != "undefined") info.next_token[x] = options[x];
              });
          }
          callback(err, rows, info);
    });
}

// Select objects from the database that match supplied conditions.
// - query - can be an object with properties for the condition, all matching records will be returned
// - query - can be a list where each item is an object with primary key condition. Only records specified in the list must be returned.
// - options can use the following special properties:
//    - ops - operators to use for comparison for properties, an object with column name and operator. The follwoing operators are available:
//       `>, gt, <, lt, =, !=, <>, >=, ge, <=, le, in, between, regexp, iregexp, begins_with, like%, ilike%`
//    - opsMap - operator mapping between supplied operators and actual operators supported by the db
//    - typesMap - type mapping between supplied and actual column types, an object
//    - select - a list of columns or expressions to return or all columns if not specified
//    - start - start records with this primary key, this is the next_token passed by the previous query
//    - count - how many records to return
//    - join - how to join condition expressions, default is AND
//    - sort - sort by this column. _NOTE: for DynamoDB this may affect the results if columns requsted are not projected in the index, with sort
//         `select` property might be used to get all required properties._
//    - desc - if sorting, do in descending order
//    - page - starting page number for pagination, uses count to find actual record to start
//    - unique - specified the column name to be used in determinint unique records, if for some reasons there are multiple record in the location
//        table for the same id only one instance will be returned
//
// On return, the callback can check third argument which is an object with some predefined properties along with driver specific properties returned by the query:
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
    options = this.getOptions(table, options);
    var req = this.prepare(Array.isArray(query) ? "list" : "select", table, query, options);
    this.query(req, options, callback);
}

// Retrieve one record from the database by primary key, returns found record or null if not found
// Options can use the following special properties:
//  - select - a list of columns or expressions to return, default is to return all columns
//  - ops - operators to use for comparison for properties, see `db.select`
//  - cached - if specified it runs getCached version
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
    options = this.getOptions(table, options);
    if (!options._cached && (options.cached || this.cacheTables.indexOf(table) > -1)) {
        options._cached = 1;
        return this.getCached("get", table, query, options, callback);
    }
    var req = this.prepare("get", table, query, options);
    this.query(req, options, function(err, rows) {
        callback(err, rows.length ? rows[0] : null);
    });
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
//          var distance = utils.geoDistance(req.query.latitude, req.query.longitude, row.latitude, row.longitudde);
//      });
//
db.getCached = function(op, table, query, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options,options = null;
    if (typeof callback != "function") callback = lib.noop;
    options = this.getOptions(table, options);
    var pool = this.getPool(table, options);
    var m = pool.metrics.Timer('cache').start();
    var obj = this.prepareRow(pool, "get", table, query, options);
    this.getCache(table, obj, options, function(rc) {
        m.end();
        // Cached value retrieved
        if (rc) rc = lib.jsonParse(rc);
        // Parse errors treated as miss
        if (rc) {
            logger.debug("getCached:", options.cacheKey, m.elapsed, "ms");
            pool.metrics.Counter("hits").inc();
            return callback(null, rc, {});
        }
        pool.metrics.Counter("misses").inc();
        // Retrieve account from the database, use the parameters like in Select function
        self[op](table, query, options, function(err, row, info) {
            // Store in cache if no error
            if (row && !err) self.putCache(table, row, options);
            callback(err, row, info);
        });
    });
}

// Create a table using column definitions represented as a list of objects. Each column definition can
// contain the following properties:
// - `name` - column name
// - `type` - column type: int, bigint, real, string, counter or other supported type
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
// - `now` - means on every add/put/update set this column with current time as Date.now()
// - `lower' - make string value lowercase
// - `upper' - make string value uppercase
// - `autoincr` - for counter tables, mark the column to be auto-incremented by the connection API if the connection type has the same name as the column name
// - `join` - a list with porperty names that must be joined together before performing a db operation, it will use the given record to produce new property,
//     this will work both ways, to the db and when reading a record from the db it will split joined property and assign individual
//     properties the value from the joined value.
// - `joinOps` - an array with operations for which perform join only, if not specified applies for all operation, allowed values: add, put, incr, update, del, get, select
//
// *Some properties may be defined multiple times with number suffixes like: unique1, unique2, index1, index2 to create more than one index for the table, same
// properties define a composite key in the order of definition or sorted by the property value, for example: `{ a: { index:2 }, b: { index:1 } }` will create index (b,a)
// because of the `index:` property value being not the same. If all index properties are set to 1 then a composite index will use the order of the properties.*
//
// NOTE: Index creation is not required and all index properties can be omitted, it can be done more effectively using native tools for any specific database,
// this format is for simple and common use cases without using any other tools but it does not cover all possible variations for every database. But all indexes and
// primary keys created outside of the backend application will be detected properly by `db.cacheColumns` and by each pool `cacheIndexes` methods.
//
// Each database pool also can support native options that are passed directly to the driver in the options, these properties are
// defined in the object with the same name as the db driver, all properties are combined, for example to define provisioned throughput for the DynamoDB index:
//
//          db.create("test_table", { id: { primary: 1, type: "int", index: 1, dynamodb: { readCapacity: 50, writeCapacity: 50 } },
//                                    type: { primary: 1, pub: 1, projection: 1 },
//                                    name: { index: 1, pub: 1 } }
//                                  });
//
// Create DynamoDB table with global secondary index, the first index property if not the same as primary key hash defines global index, if it is the same then local,
// below we create global secondary index on property 'name' only, in the example above it was local secondary index for id and name. Also a local secondary index is
// created on id,title.
//
// DynamoDB projection is defined by a `projection` property, it can be suffixed with a number to signify which index it must belong to or if it must belong to
// all indexes it can be specified as `projections`
//
//          db.create("test_table", { id: { primary: 1, type: "int", index1: 1 },
//                                    type: { primary: 1, projection: 1 },
//                                    name: { index: 1, projections: 1 }
//                                    title: { index1: 1, projection1: 1 } }
//                                  });
//  When using real DynamoDB creating a table may take some time, for such cases if options.waitTimeout is not specified it defaults to 1min,
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
    if (typeof options == "function") callback = options,options = {};
    options = this.getOptions(table, options);
    var req = this.prepare("create", table, columns, options);
    this.query(req, options, callback);
}

// Upgrade a table with missing columns from the definition list, if after the upgrade new columns must be re-read from the database
// then `info.affected_rows` must be non zero.
db.upgrade = function(table, columns, options, callback)
{
    if (typeof options == "function") callback = options,options = {};
    options = this.getOptions(table, options);
    var req = this.prepare("upgrade", table, columns, options);
    this.query(req, options, callback);
}

// Drop a table
db.drop = function(table, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options,options = {};
    if (typeof callback != "function") callback = lib.noop;
    options = this.getOptions(table, options);
    var req = this.prepare("drop", table, {}, options);
    if (!req.text) return callback();
    this.query(req, options, function(err, rows, info) {
        // Clear the table cache
        if (!err) {
            var pool = self.getPool(table, options);
            delete pool.dbcolumns[table];
            delete pool.dbkeys[table];
        }
        callback(err, rows, info);
    });
}

// Convert native database error in some generic human readable string
db.convertError = function(table, op, err, options)
{
    if (!err || !(err instanceof Error)) return err;
    var cb = this.getPool(table, options).convertError;
    return typeof cb == "function" ? cb(table, op, err, options) : err;
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
db.describeTables = function(tables)
{
    var changed = false;
    for (var p in tables) {
        if (!this.tables[p]) this.tables[p] = {}, changed = 1;
        for (var c in tables[p]) {
            if (!this.tables[p][c]) this.tables[p][c] = {}, changed = 1;
            // Merge columns
            for (var k in tables[p][c]) {
                this.tables[p][c][k] = tables[p][c][k];
            }
        }
    }
    // If this is called after the db pools are created we have to merge it with the all active pools
    if (changed && Object.keys(this.pools).length > 1) return setImmediate(this.mergeTables.bind(this));
}

// Merge columns for all table in all pools tables with the global list of tables
db.mergeTables = function(callback)
{
    var self = this;
    lib.forEachSeries(Object.keys(this.pools), function(p, next) {
        if (p == "none") return next();
        setImmediate(function() {
            var pool = self.pools[p];
            for (var t in self.tables) pool.dbtables[t] = self.tables[t];
            self.mergeColumns(pool);
            next();
        });
    });
}

// Reload all columns into the cache for the pool
db.cacheColumns = function(options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    var pool = this.getPool('', options);
    options = this.getOptions('', options);
    pool.cacheColumns.call(pool, options, function(err) {
        if (err) logger.error('cacheColumns:', pool.name, err.stack);
        self.mergeColumns(pool);
        pool.cacheIndexes.call(pool, options, function(err) {
            if (err) logger.error('cacheIndexes:', pool.name, err);
            self.mergeKeys(pool);
            // Allow other modules to handle just cached columns for post processing
            if (Array.isArray(self.processColumns)) {
                self.processColumns.forEach(function(x) {
                    if (typeof x == "function") x.call(pool, options);
                });
            }
            if (typeof callback == "function") callback(err);
        });
    });
}

// Merge JavaScript column definitions with the db cached columns
db.mergeColumns = function(pool)
{
    tables = pool.dbtables;
    var dbcolumns = pool.dbcolumns;
    for (var table in tables) {
        for (var col in tables[table]) {
            if (!dbcolumns[table]) dbcolumns[table] = {};
            if (!dbcolumns[table][col]) {
                dbcolumns[table][col] = { fake: 1 };
            } else {
                delete dbcolumns[table][col].fake;
            }
            for (var p in tables[table][col]) {
                if (!dbcolumns[table][col][p]) dbcolumns[table][col][p] = tables[table][col][p];
            }
        }
    }
}

// Update pool keys with the primary keys form the table definitions in addition to the actual cached
// column info from the database, if no caching performed than this just set the keys assuming it will work, for databases that do
// not provide info about primary keys
db.mergeKeys = function(pool)
{
    var dbcolumns = pool.dbcolumns;
    var dbkeys = pool.dbkeys;
    for (var table in dbcolumns) {
        if (!dbkeys[table]) dbkeys[table] = lib.searchObj(dbcolumns[table], { name: 'primary', sort: 1, names: 1 });
    }
}

// Prepare for execution for the given operation: add, del, put, update,...
// Returns prepared object to be passed to the driver's .query method. This method is a part of the driver
// helpers and is not used directly in the applications.
db.prepare = function(op, table, obj, options)
{
    var pool = this.getPool(table, options);
    options = this.getOptions(table, options);

    // Check for table name, it can be determined in the real time
    if (pool.resolveTable) table = pool.resolveTable(op, table, obj, options);

    // Prepare row properties
    obj = this.prepareRow(pool, op, table, obj, options);
    return pool.prepare(op, table, obj, options);
}

// Preprocess an object for a given operation, convert types, assign defaults...
db.prepareRow = function(pool, op, table, obj, options)
{
    if (!pool) pool = this.getPool(table, options);

    // Keep an object in the format we support
    switch (lib.typeName(obj)) {
    case "object":
    case "string":
    case "array":
        break;
    default:
        obj = {};
    }
    // Pre-process input properties before sending it to the database, make a shallow copy of the
    // object to preserve the original properties in the parent
    if (!options.noprocessrows) {
        if (this.getProcessRows('pre', table, options)) obj = lib.cloneObj(obj);
        this.runProcessRows("pre", { op: op, table: table, obj: obj }, obj, options);
    }

    // Process special columns
    var keys = pool.dbkeys[table.toLowerCase()] || [];
    var cols = pool.dbcolumns[table.toLowerCase()] || {};
    var now = Date.now(), col, old = {};

    switch (op) {
    case "add":
    case "put":
        // Set all default values if any
        for (var p in cols) {
            col = cols[p];
            if (typeof col.value != "undefined" && !obj[p]) obj[p] = col.value;
            // Counters must have default value or use 0 is implied
            if (typeof obj[p] == "undefined") {
                if (col.type == "counter") obj[p] = 0;
                if (col.type == "uuid") obj[p] = lib.uuid();
            }
        }

    case "incr":
        // All values must be numbers
        for (var p in cols) {
            if (typeof obj[p] != "undefined" && cols[p].type == "counter") obj[p] = lib.toNumber(obj[p]);
        }

    case "update":
        // Keep only columns from the table definition if we have it
        // Go over all properties in the object and makes sure the types of the values correspond to the column definition types,
        // this is for those databases which are very sensitive on the types like DynamoDB. This function updates the object in-place.
        var o = {}, v;
        for (var p in obj) {
            v = obj[p];
            col = cols[p];
            if (col) {
                // Handle json separately in sync with processRows
                if (options.noJson && !options.strictTypes && col.type == "json" && typeof obj[p] != "undefined") v = JSON.stringify(v);
                // Convert into native data type
                if (options.strictTypes && (col.primary || col.index || col.type) && typeof obj[p] != "undefined") v = lib.toValue(v, col.type);
                // Verify against allowed values
                if (Array.isArray(col.values) && col.values.indexOf(String(v)) == -1) continue;
                // Max length limit for text fields
                if (col.maxlength && typeof v == "string" && !col.type && v.length > col.maxlength) v = v.substr(0, col.maxlength);
            }
            if (this.skipColumn(p, v, options, cols)) continue;
            if ((v == null || v === "") && options.skipNull && options.skipNull[op]) continue;
            o[p] = v;
        }
        obj = o;
        for (var p in cols) {
            col = cols[p];
            // Restrictions
            if (col.hidden || (col.readonly && (op == "incr" || op == "update")) || (col.writeonly && (op == "add" || op == "put"))) {
                delete obj[p];
                continue;
            }
            // Current timestamps, for primary keys only support add
            if (col.now && !obj[p] && (!col.primary || op == "add")) obj[p] = now;
            // Case conversion
            if (col.lower && typeof obj[p] == "string") obj[p] = v.toLowerCase();
            if (col.upper && typeof obj[p] == "string") obj[p] = v.toUpperCase();
            // The field is combined from several values contatenated for complex primary keys
            this.joinColumn(op, obj, p, col, options, old);
        }
        break;

    case "del":
        var o = {};
        for (var p in obj) {
            col = cols[p];
            if (!col) continue;
            o[p] = obj[p];
            // Convert into native data type
            if (options.strictTypes && (col.primary || col.type) && typeof o[p] != "undefined") o[p] = lib.toValue(o[p], col.type);
        }
        obj = o;
        for (var p in cols) {
            this.joinColumn(op, obj, p, cols[p], options, old);
        }
        break;

    case "get":
    case "select":
    case "search":
        if (!lib.isObject(options.ops)) options.ops = {};
        for (var p in options.ops) {
            switch (options.ops[p]) {
            case "in":
            case "between":
                if (obj[p] && !Array.isArray(obj[p])) {
                    var type = cols[p] ? cols[p].type : "";
                    obj[p] = lib.strSplit(obj[p], null, type);
                }
                break;
            }
        }

        // Convert simple types into the native according to the table definition, some query parameters are not
        // that strict and can be more arrays which we should not convert due to options.ops
        for (var p in cols) {
            col = cols[p];
            if (options.strictTypes) {
                if (lib.isNumeric(col.type)) {
                    if (typeof obj[p] == "string") obj[p] = lib.toNumber(obj[p]);
                } else {
                    if (typeof obj[p] == "number") obj[p] = String(obj[p]);
                }
            }
            // Default search op, for primary key cases
            if (!options.ops[p] && lib.isObject(col.ops) && col.ops[op]) options.ops[p] = col.ops[op];

            // Joined values for queries, if nothing joined or only one field is present keep the original value
            this.joinColumn(op, obj, p, col, options, old);
        }
        break;

    case "list":
        for (var i = 0; i < obj.length; i++) {
            for (var p in cols) {
                col = cols[p];
                if (options.strictTypes) {
                    if (lib.isNumeric(col.type)) {
                        if (typeof obj[i][p] == "string") obj[i][p] = lib.toNumber(obj[i][p]);
                    } else {
                        if (typeof obj[i][p] == "number") obj[i][p] = String(obj[i][p]);
                    }
                }
                // Joined values for queries, if nothing joined or only one field is present keep the original value
                this.joinColumn(op, obj[i], p, col, options, old);
                // Delete at the end to give a chance some joined columns to be created
                if (!col.primary) delete obj[i][p];
            }
        }
        break;
    }
    return obj;
}

// Convert rows returned by the database into the Javascript format or into the format
// defined by the table columns.
// The following special properties in the column definition chnage the format:
//  - type = json - if a column type is json and the value is a string returned will be converted into a Javascript object
//  - list - split the value into array
//  - unjoin - a list of names, it produces new properties by splitting the value by a separator and assigning pieces to
//      separate properties using names from the list, this is the opposite of the `join` property and is used separately if
//      splitting is required, if joined properties already in the record then no need to split it
//
//      Example:
//              db.describeTables([ { user: { id: {}, name: {}, pair: { join: ["left","right"], split: ["left", "right"] } } ]);
//
//              db.put("test", { id: "1", type: "user", name: "Test", left: "123", right: "000" })
//              db.select("test", {}, db.showResult)
//
db.convertRows = function(pool, req, rows, options)
{
    var self = this;
    if (!pool) pool = this.getPool(req.table, options);
    var cols = pool.dbcolumns[req.table.toLowerCase()] || {};
    for (var p in cols) {
        var col = cols[p], row;
        // Convert from JSON type
        if (options.noJson && col.type == "json") {
            for (var i = 0; i < rows.length; i++) {
                row = rows[i];
                if (typeof row[p] == "string" && row[p]) row[p] = lib.jsonParse(row[p], { logging : 1 });
            }
        }
        // Split into a list
        if (col.list) {
            for (var i = 0; i < rows.length; i++) {
                rows[i][p] = lib.strSplit(rows[i][p]);
            }
        }
        // Extract joined values and place into separate columns
        if (Array.isArray(col.unjoin)) {
            var separator = col.separator || this.separator;
            for (var i = 0; i < rows.length; i++) {
                row = rows[i];
                if (typeof row[p] == "string" && row[p].indexOf(separator) > -1) {
                    var v = row[p].split(separator);
                    if (v.length >= col.unjoin.length) {
                        for (var j = 0; j < col.unjoin.length; j++) row[col.unjoin[j]] = v[j];
                    }
                }
            }
        }
        // Do not return
        if (col.noresult) {
            for (var i = 0; i < rows.length; i++) {
                delete row[p];
            }
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
    if (!this.processRows[type]) return null;
    var hooks = this.processRows[type][table];
    return Array.isArray(hooks) && hooks.length ? hooks : null;
}

// Run registered pre- or post- process callbacks.
// - `type` is one of the `pre` or 'post`
// - `req` is the original db request object with the following required properties: `op, table, obj`,
// - `rows` is the result rows for post callbacks and the same request object for pre callbacks.
// - `options` is the same object passed to a db operation
db.runProcessRows = function(type, req, rows, options)
{
    if (!req || !req.table) return rows;
    var hooks = this.getProcessRows(type, req.table, options);
    if (!hooks) return rows;
    var cols = this.getColumns(req.table, options);

    // Stop on the first hook returning true to remove this row from the list
    function processRow(row) {
        for (var i = 0; i < hooks.length; i++) {
            if (hooks[i].call(row, req, row, options, cols) === true) return false;
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
// The callback accepts 4 arguments: function(req, row, options, columns)
//   where:
//  - `req` is the original request for a db operation, it must contain `op, table and obj` properties
//  - `row` is a row from the table
//  - `options` are the obj passed to the db called
//  - `columns` is an object with table's columns
//
// When producing complex properties by combining other properties it needs to be synchronized using both pre and post
// callbacks to keep the record consistent.
//
// **For queries returning rows, if the callback returns true for a row it will be filtered out and not included in the final result set.**
//
//
//  Example
//
//      db.setProcessRow("post", "bk_account", function(req, row, opts, cols) {
//          if (row.birthday) row.age = Math.floor((Date.now() - lib.toDate(row.birthday))/(86400000*365));
//      });
//
//      db.setProcessRow("post", "bk_icon", function(req, row, opts, cols) {
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

// Return database pool by table name or default pool, options may contain { pool: name } to return
// the pool by given name. This call always return valid pool object, in case no requiested pool found it returns
// default pool. A special pool `none` always return empty result and no errors.
db.getPool = function(table, options)
{
    var pool = options && options.pool ? this.pools[options.pool] : null;
    if (!pool && this.poolTables[table]) pool = this.pools[this.poolTables[table]];
    if (!pool) pool = this.pools[this.pool];
    return pool || this.nopool;
}

// Return all tables know to the given pool, returned tables are in the object with
// column information merged from cached columns from the database with description columns
// given by the application. Property fake: 1 in any column signifies not a real column but
// a column described by the application and not yet created by the database driver or could not be added
// due to some error.
// If `options.names` is 1 then return just table names as a list
db.getPoolTables = function(name, options)
{
    var pool = this.getPool('', { pool: name });
    var tables = pool.dbcolumns || {};
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

// Return combined options for the pool including global pool options
db.getOptions = function(table, options)
{
    if (options && options._merged) return options;
    var pool = this.getPool(table, options);
    options = lib.mergeObj(pool.settings, options);
    options._merged = 1;
    return options;
}

// Return columns for a table or null, columns is an object with column names and objects for definition
db.getColumns = function(table, options)
{
    return this.getPool(table, options).dbcolumns[(table || "").toLowerCase()] || {};
}

// Return the column definition for a table
db.getColumn = function(table, name, options)
{
    return this.getColumns(table, options)[name];
}

// Return a table definition which was used to create the table. This is different from cached table columns
// and only contains the original properties which are merged with the cached properties of existing table.
db.getTableProperties = function(table, options)
{
    return this.getPool(table, options).dbtables[(table || "").toLowerCase()] || {};
}

// Return columns for a table or null, columns is an object with column names and objects for definition
db.getColumns = function(table, options)
{
    return this.getPool(table, options).dbcolumns[(table || "").toLowerCase()] || {};
}

// Return an object with capacity property which is the max write capacity for the table, for DynamoDB only.
// By default it checks `writeCapacity` property of all table columns and picks the max.
//
// The options can specify the capacity explicitely:
// - useCapacity - what to use for capacity rating, can be `write`, `read` or a number with max capacity to use
// - factorCapacity - a number between 0 and 1 to multiple the used capacity, only used when useCapacity is read or write.
// - rateCapacity - if set it will be used for rate capacity limit
// - maxCapacity - if set it will be used as the max burst capacity limit
db.getCapacity = function(table, options)
{
    var cap = { table: table, writeCapacity: 0, readCapacity: 0 };
    var cols = this.getColumns(table);
    for (var p in cols) {
        if (cols[p].readCapacity) cap.readCapacity = Math.max(cols[p].readCapacity, cap.readCapacity);
        if (cols[p].writeCapacity) cap.writeCapacity = Math.max(cols[p].writeCapacity, cap.writeCapacity);
    }
    var use = options && options.useCapacity;
    var factor = options && options.factorCapacity > 0 && options.factorCapacity <= 1 ? options.factorCapacity : 1;
    cap.rateCapacity = cap.maxCapacity = typeof use == "number" ? use : use == "read" ? cap.readCapacity*factor : cap.writeCapacity*factor;
    for (var p in options) cap[p] = options[p];
    if (cap.rateCapacity > 0) cap._tokenBucket = new metrics.TokenBucket(cap.rateCapacity, cap.maxCapacity);
    return cap;
}

// Check if number of write requests exceeds the capacity per second, delay if necessary, for DynamoDB only but can be used for pacing
// write requests with any database or can be used generically. The `obj` must be initialized with `db.getCapacity` call.
db.checkCapacity = function(cap, consumed, callback)
{
    if (typeof consumed == "function") callback = consumed, consumed = 1;
    if (cap._tokenBucket) {
        if (!cap._tokenBucket.consume(consumed)) {
            setTimeout(callback, cap._tokenBucket.delay());
            return false;
        }
    }
    callback();
    return true;
}

// Return list of selected or allowed only columns, empty list if no `options.select` is specified
db.getSelectedColumns = function(table, options)
{
    var self = this;
    var select = [];
    if (options.select && options.select.length) {
        var cols = this.getColumns(table, options);
        options.select = lib.strSplitUnique(options.select);
        select = Object.keys(cols).filter(function(x) { return !self.skipColumn(x, "", options, cols) && options.select.indexOf(x) > -1; });
    } else
    if (options.skip_columns) {
        var cols = this.getColumns(table, options);
        select = Object.keys(cols).filter(function(x) { return !self.skipColumn(x, "", options, cols); });
    }
    return select.length ? select : null;
}

// Join several columns to produce a combined property if configured, given a column description and an object record
// it replaces the column value with joined value if needed. Empty properties will be still joined as empty strings.
// It always uses the original value even if one of the properties has been joined already.
//
// Checks for `join` and `joinOps` properties in the column definition.
//
// The `options.skip_join` can be used to restrict joins, it is a list with columns that should not be joined
//
// The `options.strict_join` can be used to perform join only if all columns in the list are not empty, so the join
// is for all columns or none
//
db.joinColumn = function(op, obj, name, col, options, old)
{
    if (col &&
        Array.isArray(col.join) &&
        (!Array.isArray(col.joinOps) || col.joinOps.indexOf(op) > -1) &&
        (!options || !Array.isArray(options.skip_join) || options.skip_join.indexOf(name) == -1)) {
        var separator = col.separator || this.separator;
        if (typeof obj[name] != "string" || obj[name].indexOf(separator) == -1) {
            var c, d, v = "", n = 0;
            for (var i = 0; i < col.join.length; i++) {
                c = col.join[i];
                d = ((old && old[c]) || obj[c] || "");
                if (d) {
                    n++;
                } else {
                    if (col.strict_join || options.strict_join) return;
                }
                v += (i ? separator : "") + d;
            }
            // Keep the original value before updating
            if (old && typeof old[name] == "undefined") old[name] = obj[name];
            if (v && n) obj[name] = v;
        }
    }
}

// Verify column against common options for inclusion/exclusion into the operation, returns 1 if the column must be skipped
//  - to enable all properties to be saved in the record without column definition set `options.all_columns=1`
//  - to skip all null values set `options.skip_null=1`
//  - to skip specific columns define `options.skip_columns=["a","b"]`
//  - to restrict to specific columns only define `options.allow_columns=["a","b"]`
db.skipColumn = function(name, val, options, columns)
{
    return !name || name[0] == '_' || typeof val == "undefined" ||
           (options && options.skip_null && val === null) ||
           (options && !options.all_columns && (!columns || !columns[name])) ||
           (options && Array.isArray(options.allow_columns) && options.allow_columns.indexOf(name) == -1) ||
           (options && Array.isArray(options.skip_columns) && options.skip_columns.indexOf(name) > -1) ? true : false;
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
    if (!options.ops) options.ops = {};
    if (!options.typesMap) options.typesMap = {};
    if (!options.cols) options.cols = {};
    // Keep rows which satisfy all conditions
    return rows.filter(function(row) {
        return (options.keys || []).every(function(name) {
            return lib.isTrue(row[name], obj[name], options.ops[name], options.typesMap[name] || (options.cols[name] || {}).type);
        });
    });
}

// Return cached primary keys for a table or empty array
db.getKeys = function(table, options)
{
    return this.getPool(table, options).dbkeys[(table || "").toLowerCase()] || [];
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

// Returns an object based on the list of keys, basically returns a subset of properties
// `options.keysMap` defins an object to map record properties with the actual names to be returned.
db.getQueryForKeys = function(keys, obj, options)
{
    var self = this;
    return (keys || []).
            filter(function(x) { return !self.skipColumn(x, obj[x]) }).
            map(function(x) { return [ options && options.keysMap ? (options.keysMap[x] || x) : x, obj[x] ] }).
            reduce(function(x,y) { x[y[0]] = y[1]; return x; }, {});
}

// Return possibly converted value to be used for inserting/updating values in the database,
// is used for SQL parametrized statements
//
// Parameters:
//  - options - standard pool parameters with pool: property for specific pool
//  - val - the JavaScript value to convert into bind parameter
//  - info - column definition for the value from the cached columns
db.getBindValue = function(table, options, val, info)
{
    var cb = this.getPool(table, options).bindValue;
    return typeof cb == "function" ? cb(val, info) : val;
}

// Return transformed value for the column value returned by the database, same parameters as for getBindValue
db.getColumnValue = function(table, options, val, info)
{
    var cb = this.getPool(table, options).colValue;
    return typeof cb == "function" ? cb(val, info) : val;
}

// Retrieve an object from the cache by key
db.getCache = function(table, query, options, callback)
{
    var key = this.getCacheKey(table, query, options);
    if (!key) return callback();
    if (options) options.cacheKey = key;
    ipc.get(key, options, callback);
}

// Store a record in the cache
db.putCache = function(table, query, options)
{
    var key = options && options.cacheKey ? options.cacheKey : this.getCacheKey(table, query, options);
    if (!key) return;
    var ttl = this.cacheTtl[table] || this.cacheTtl.default || 0;
    if (ttl) {
        if (!options) options = { ttl: ttl }; else options.ttl = ttl;
    }
    logger.debug("putCache:", key, ttl);
    ipc.put(key, lib.stringify(query), options);
}

// Notify or clear cached record, this is called after del/update operation to clear cached version by primary keys
db.delCache = function(table, query, options)
{
    var key = options && options.cacheKey ? options.cacheKey : this.getCacheKey(table, query, options);
    if (key) ipc.del(key, options);
}

// Returns concatenated values for the primary keys, this is used for caching records by primary key
db.getCacheKey = function(table, query, options)
{
    var keys = this.getKeys(table, options).filter(function(x) { return query[x] }).map(function(x) { return query[x] }).join(this.separator);
    if (keys) keys = (options && options.cachePrefix ? options.cachePrefix : table) + this.separator + keys;
    return keys;
}

// Convenient helper to show results from the database requests, can be used as the callback in all db method.
//
// Example:
//
//          db.select("bk_account", {}, db.showResult);
//
db.showResult = function(err, rows, info)
{
    if (err) return console.log(err.stack);
    console.log(util.inspect(rows, { depth: 5 }), info);
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
// The following pool callback can be assigned to the pool object:
// - connect - a callback to be called when actual database client needs to be created, the callback signature is
//    function(pool, callback) and will be called with first arg an error object and second arg is the database instance, required for pooling
// - close - a callback to be called when a db connection needs to be closed, optional callback with error can be provided to this method
// - bindValue - a callback function(val, info) that returns the value to be used in binding, mostly for SQL drivers, on input value and col info are passed, this callback
//   may convert the val into something different depending on the DB driver requirements, like timestamp as string into milliseconds
// - convertError - a callback function(table, op, err, options) that converts native DB driver error into other human readable format
// - processColumns - a callback function(pool) taht is called after this pool cached columms from the database, it is called sychnroniously inside the `db.cacheColumns` method.
// - resolveTable - a callback function(op, table, obj, options) that returns possible different table at the time of the query, it is called by the `db.prepare` method
//   and if exist it must return the same or new table name for the given query parameters.
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
db.createPool = function(options)
{
    var self = this;
    if (!options || !options.pool) throw "Options with pool: must be provided";

    if (lib.isPositive(options.max)) {
        var pool = lib.createPool({
            min: options.min,
            max: options.max,
            idle: options.idle,

            create: function(callback) {
                var me = this;
                try {
                    this.open.call(this, function(err, client) {
                        if (err) return callback(err, client);
                        me.setup.call(me, client, callback);
                    });
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
                }
            },
        });

    } else {
        var pool = {};
        pool.acquire = function(cb) { if (typeof cb != "function" ) throw lib.newError("callback is required"); cb(null, {}); };
        pool.release = lib.noop;
        pool.destroyAll = lib.noop;
        pool.stats = lib.noop;
        pool.shutdown = lib.nocb;
    }

    // First time initialization
    pool.initialize = function(opts) {
        var me = this;

        this.name = options.pool || options.name;
        this.type = options.type || "none";
        this.url = options.url || "default";
        this.metrics = new metrics.Metrics('name', this.name);
        this.dbtables = {};
        this.dbcolumns = {};
        this.dbkeys = {};
        this.dbindexes = {};
        this.dbcache = {};
        this.connect = {};
        this.settings = {};
        this.configure(opts);

        // Default methods if not setup from the options
        if (typeof this.open != "function") this.open = function(pool, cb) { cb(null, {}); };
        if (typeof this.setup != "function") this.setup = function(client, cb) { cb(null, client); };
        if (typeof this.query != "function") this.query = function(client, req, opts, cb) { cb(null, []); };
        if (typeof this.cacheColumns != "function") this.cacheColumns = function(opts, cb) { cb(); }
        if (typeof this.cacheIndexes != "function") this.cacheIndexes = function(opts, cb) { cb(); };
        if (typeof this.nextToken != "function") this.nextToken = function(client, req, rows, opts) { return client.next_token || null };
        if (typeof this.prepare != "function") this.prepare = function(op, table, obj, opts) { return { text: table, op: op, table: (table || "").toLowerCase(), obj: obj }; }
    }

    // Reconfigure properties, only subset of properties are allowed here so it is safe to apply all of them directly,
    // this is called during realtime config update
    pool.configure = function(opts) {
        if (typeof this._configure == "function") this._configure(opts);
        if (opts.url) this.url = opts.url;
        if (lib.isObject(opts.connect)) this.connect = lib.mergeObj(this.connect, opts.connect);
        if (lib.isObject(opts.settings)) this.settings = lib.mergeObj(this.settings, opts.settings);
        if (!lib.isEmpty(opts.noCacheColumns)) this.settings.noCacheColumns = opts.noCacheColumns;
        if (!lib.isEmpty(opts.noInitTables)) this.settings.noInitTables = opts.noInitTables;
        logger.debug("pool.configure:", this.name, this.type, opts);
    }

    // Save existing options and return as new object, first arg is options, then list of properties to save
    pool.saveOptions = function(opts) {
        var old = {};
        for (var i = 1; i < arguments.length; i++) {
            var p = arguments[i];
            old[p] = opts[p];
        }
        return old;
    }

    // Restore the properties we replaced
    pool.restoreOptions = function(opts, old) {
        for (var p in old) {
            if (old[p]) opts[p] = old[p]; else delete opts[p];
        }
    }

    pool.initialize(options);
    this.pools[pool.name] = pool;
    logger.debug('createPool:', pool.type, pool.name, options);
    return pool;
}

// Make sure the empty pool is created for dummy database operations
db.nopool = db.createPool({ pool: "none", type: "none" });
