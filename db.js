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
var ipc = require(__dirname + '/ipc');
var aws = require(__dirname + '/aws');
var cluster = require('cluster');
var os = require('os');
var helenus = require('helenus');
var mongodb = require('mongodb');
var redis = require('redis');
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
// Multiple connections of the same tipy can be opened, just add -n suffix to all database config parameters where n is 1 to `count` property in the config descriptor.
//
// Example:
//
//          db-pgsql-pool = postgresql://locahost/backend
//          db-pgsql-pool-1 = postgresql://localhost/billing
//          db-pgsql-pool-max-1 = 100
//
var db = {
    name: 'db',

    // Default database pool for the backend
    pool: 'sqlite',

    // Database connection pools by pool name
    pools: {},

    // Pools by table name
    poolTables: {},

    // Tables to be cached
    cacheTables: [],

    // Local db pool, sqlite is default, used for local storage by the core
    local: 'sqlite',
    sqlitePool: core.name,

    // Refresh config from the db
    configInterval: 300,

    // Config parameters
    args: [{ name: "pool", dns: 1, descr: "Default pool to be used for db access without explicit pool specified" },
           { name: "no-pools", type: "bool", descr: "Do not use other db pools except the default pool specified by 'db-pool'" },
           { name: "no-cache-columns", type: "bool", descr: "Do not load column definitions from the database tables on startup, keep using in-app Javascript definitions only, in most cases caching columns is not required if tables are in sync between the app and the database" },
           { name: "no-init-tables", type: "bool", descr: "Do not create tables in the database on startup and do not perform table upgrades for new columns, all tables are assumed to be created beforehand, disabling this will turn on table creation in the shell and master processes" },
           { name: "cache-tables", array: 1, type: "list", descr: "List of tables that can be cached: bk_auth, bk_counter. This list defines which DB calls will cache data with currently configured cache. This is global for all db pools." },
           { name: "local", descr: "Local database pool for properties, cookies and other local instance only specific stuff" },
           { name: "config", descr: "Configuration database pool to be used to retrieve config parameters from the database, must be defined to use remote db for config parameters, set to `default` to use current default pool" },
           { name: "config-interval", type: "number", min: 0, descr: "Interval between loading configuration from the database configured with -db-config-type, in seconds, 0 disables refreshing config from the db" },
           { name: "pool-max", count: 3, match: "pool", type: "number", min: 1, max: 10000, descr: "Max number of open connections for a pool" },
           { name: "pool-min", count: 3, match: "pool", type: "number", min: 1, max: 10000, descr: "Min number of open connections for a pool" },
           { name: "pool-idle", count: 3, match: "pool", type: "number", min: 1000, max: 86400000, descr: "Number of ms for a db pool connection to be idle before being destroyed" },
           { name: "pool-tables", count: 3, match: "pool", type: "list", array: 1, descr: "A DB pool tables, list of tables that belong to this pool only" },
           { name: "pool-init-options", count: 3, match: "pool", type: "json", descr: "Options for a DB pool driver passed during creation of a pool" },
           { name: "pool-options", count: 3, match: "pool", type: "json", descr: "A DB pool driver options passed to every request" },
           { name: "sqlite-pool", count: 3, descr: "SQLite pool db name, absolute path or just a name" },
           { name: "pgsql-pool", count: 3, novalue: "postgresql://postgres@127.0.0.1/backend", descr: "PostgreSQL pool access url in the format: postgresql://[user:password@]hostname[:port]/db" },
           { name: "mysql-pool", count: 3, novalue: "mysql:///backend", descr: "MySQL pool access url in the format: mysql://[user:password@]hostname/db" },
           { name: "dynamodb-pool", count: 3, novalue: "default", descr: "DynamoDB endpoint url, a region or 'default' to use AWS account default region" },
           { name: "mongodb-pool", count: 3, novalue: "mongodb://127.0.0.1", descr: "MongoDB endpoint url in the format: mongodb://hostname[:port]/dbname" },
           { name: "cassandra-pool", count: 3, novalue: "cassandra://cassandra:cassandra@127.0.0.1/backend", descr: "Casandra endpoint url in the format: cql://[user:password@]hostname[:port]/dbname" },
           { name: "lmdb-pool", count: 3, descr: "Path to the local LMDB database" },
           { name: "leveldb-pool", count: 3, descr: "Path to the local LevelDB database" },
           { name: "redis-pool", count: 3, novalue: "127.0.0.1", descr: "Redis host" },
           { name: "elasticsearch-pool", count: 3, novalue: "127.0.0.1:9200", descr: "ElasticSearch url to the host in the format: http://hostname[:port]" },
           { name: "couchdb-pool", count: 3, novalue: "http://127.0.0.1/backend", descr: "CouchDB url to the host in the format: http://hostname[:port]/dbname" },
           { name: "riak-pool", count: 3, novalue: "http://127.0.0.1", descr: "Riak url to the host in the format: http://hostname[:port]" },
    ],

    // Default tables
    tables: {
        // Configuration store, same parameters as in the commandline or config file, can be placed in separate config groups
        // to be used by different backends or workers, 'core' is default global group
        bk_config: { name: { primary: 1 },                      // name of the parameter
                     type: { primary: 1 },                      // config type
                     value: {},                                 // the value
                     mtime: { type: "bigint", now: 1 }
        },

        // General purpose properties, can be used to store arbitrary values
        bk_property: { name: { primary: 1 },
                       value: {},
                       mtime: { type: "bigint", now: 1 }
        },

        // Pending jobs or other requests to be processed
        bk_queue: { id: { type: "uuid", primary: 1 },
                    tag: {},
                    type: {},
                    job: { type: "json" },
                    args: { type: "json" },
                    stime: { type: "bigint" },                        // time when valid for processing
                    etime: { type: "bigint" },                        // expiration time
                    ctime: { type: "bigint", readonly: 1, now: 1 },   // creation time
                    mtime: { type: "bigint", now: 1 }
        },
    }, // tables
};

module.exports = db;

// Initialize database pools.
// Options can have the following properties:
//   - noPools - disables all other pools except sqlite, similar to `-db-no-pools` config parameter, id db-local is configured and
//       different than sqlite it is initialized always as well
//   - noInitTables - if defined it is used instesd of the global parameter
//   - noCacheColumns - if defined it is used instead fo the global parameter
db.init = function(options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {};

    // Config pool can be set to default which means use the current default pool
    if (this.config == "default") this.config = this.pool;

    // Configured pools for supported databases
    self.args.filter(function(x) { return x.name.match(/\-pool$/) }).forEach(function(x) {
        var pool = x.name.replace('-pool', '');
        // Several drivers can be defined
        for (var i = 0; i < (x.count || 1); i++) {
            var n = i > 0 ? i : "";
            var name = pool + n;
            var db = self[pool + 'Pool' + n];
            if (!db || self.pools[name]) continue;
            // local pool must be always initialized
            if (options.noPools || self.noPools) {
                if (name != self.local && name != self.pool) continue;
            }
            var opts = { pool: name,
                         db: db,
                         min: self[pool + 'Min' + n] || 0,
                         max: self[pool + 'Max' + n] || Infinity,
                         idle: self[pool + 'Idle' + n] || 86400000,
                         dbinit: self[pool + 'InitOptions' + n],
                         dboptions: self[pool + 'Options' + n] };
            self[pool + 'InitPool'](opts);
            // Pool specific tables
            (self[pool + 'Tables' + n] || []).forEach(function(y) { self.poolTables[y] = pool; });
        }
    });

    // Initialize all pools with common tables
    self.initTables(self.tables, options, callback);
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
// On return, the callback second argument will receive all parameters received form the database as a list: -name value ...
db.initConfig = function(options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null
    if (!options) options = {};

    if (!self.config || !db.getPoolByName(self.config)) return callback ? callback(null, []) : null;

    // The order of the types here defines the priority of the parameters, most specific at the end always wins
    var types = [];

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
    types = core.strSplitUnique(types);

    self.select(options.table || "bk_config", { type: types }, { ops: { type: "in" }, pool: self.config }, function(err, rows) {
        if (err) return callback ? callback(err, []) : null;

        var argv = [];
        // Sort inside to be persistent across databases
        rows.sort(function(a,b) { return types.indexOf(b.type) - types.indexOf(a.type); });
        // Only keep the most specific value, it is sorted in descendent order most specific at the end
        rows.forEach(function(x) {
            var name = '-' + x.name;
            if (argv.indexOf(name) > -1) return;
            if (x.name) argv.push(name);
            if (x.value) argv.push(x.value);
        });
        core.parseArgs(argv);

        // Refresh from time to time with new or modified parameters, randomize a little to spread across all servers, we run in at the end
        // in order to pickup any new config parameters that we just loaded
        clearInterval(self.configTimer);
        if (self.configInterval > 0) self.configTimer = setInterval(function() { self.initConfig(); }, self.configInterval * 1000 + core.randomShort());

        // Return the normalized argument list to the caller for extra processing
        if (callback) callback(null, argv);
    });
}

// Create tables in all pools
db.initTables = function(tables, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;

    core.forEachSeries(Object.keys(self.pools), function(name, next) {
        if (name == "none") return next();
        self.initPoolTables(name, tables, options, next);
    }, function(err) {
        if (callback) callback(err);
    });
}


// Init the pool, create tables and columns:
// - name - db pool to create the tables in
// - tables - an object with list of tables to create or upgrade
db.initPoolTables = function(name, tables, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    // Add tables to the list of all tables this pool supports
    var pool = self.getPool('', { pool: name });
    if (!pool.dbtables) pool.dbtables = {};
    // Collect all tables in the pool to be merged with the actual tables later
    for (var p in tables) pool.dbtables[p] = tables[p];
    options.pool = name;
    options.tables = tables;

    // These options can redefine behaviour of the initialization sequence
    var noCacheColumns = options.noCacheColumns || self.noCacheColumns;
    var noInitTables = options.noInitTables || self.noInitTables;
    logger.debug('initPoolTables:', core.role, name, noCacheColumns || 0, noInitTables || 0, Object.keys(tables));

    // Skip loading column definitions from the database, keep working with the javascript models only
    if (noCacheColumns) {
        self.mergeColumns(pool);
        self.mergeKeys(pool);
        return callback ? callback() : null;
    }
    self.cacheColumns(options, function() {
        // Workers do not manage tables, only master process
        if (cluster.isWorker || core.worker || noInitTables) {
            return callback ? callback() : null;
        }

        var changes = 0;
        core.forEachSeries(Object.keys(options.tables || {}), function(table, next) {
            // We if have columns, SQL table must be checked for missing columns and indexes
            var cols = self.getColumns(table, options);
            if (!cols || Object.keys(cols).every(function(x) { return cols[x].fake })) {
                self.create(table, options.tables[table], options, function(err, rows) { changes++; next() });
            } else {
                self.upgrade(table, options.tables[table], options, function(err, rows) { if (rows) changes++; next() });
            }
        }, function() {
            logger.debug('db.initPoolTables:', name, 'changes:', changes);
            if (!changes) return callback ? callback() : null;
            self.cacheColumns(options, function() {
                if (callback) callback();
            });
        });
    });
}

// Gracefully close all database pools when the shutdown is initiated by a Web process
db.shutdownWeb = function(optios, callback)
{
    var pools = this.getPools();
    core.forEachLimit(pools, pools.length, function(pool, next) {
        db.pools[pool.name].shutdown(next);
    }, callback);
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
    core.forEachSeries(Object.keys(tables || {}), function(table, next) {
        self.drop(table, options, function() { next() });
    }, callback);
}

// Return all tables know to the given pool, returned tables are in the object with
// column information merged from cached columns from the database with description columns
// given by the application. Property fake: 1 in any column signifies not a real column but
// a column described by the application and not yet created by the database driver or could not be added
// due to some error.
db.getPoolTables = function(name)
{
    var pool = this.getPool('', { pool: name });
    return pool.dbcolumns || {};
}

// Return a list of all active database pools, returns list of objects with name: and type: properties
db.getPools = function()
{
    var rc = [];
    for (var p in this.pools) rc.push({ name: this.pools[p].name, type: this.pools[p].type });
    return rc;
}

// Create a new database pool with default methods and properties
// - options - an object with default pool properties
//    - type - pool type, this is the db driver name
//    - pool or name - pool name
//    - pooling - create generic pool for connection caching
//    - watchfile - file path to be watched for changes, all clients will be destroyed gracefully
//    - min - min number of open database connections
//    - max - max number of open database connections, all attempts to run more will result in clients waiting for the next available db connection, if set to Infinity no
//            pooling will be enabled and result in unlimited connections, this is default for DynamoDB
//    - max_queue - how many db requests can be in the waiting queue, above that all requests will be denied instead of putting in the waiting queue
// The following pool callback can be assigned to the pool object:
// - connect - a callback to be called when actual database client needs to be created, the callback signature is
//    function(pool, callback) and will be called with first arg an error object and second arg is the database instance, required for pooling
// - close - a callback to be called when a db connection needs to be closed, optional callback with error can be provided to this method
// - bindValue - a callback function(val, info) that returns the value to be used in binding, mostly for SQL drivers, on input value and col info are passed, this callback
//   may convert the val into something different depending on the DB driver requirements, like timestamp as string into milliseconds
// - convertError - a callback function(table, op, err, options) that converts native DB driver error into other human readable format
// - resolveTable - a callback function(op, table, obj, options) that returns poosible different table at the time of the query, it is called by the `db.prepare` method
//   and if exist it must return the same or new table name for the given query parameters.
//
// The db methods cover most use cases but in case native driver needs to be used this is how to get the client and use it with its native API,
// it is required to call `pool.free` at the end to return the connection back to the connection pool.
//
//          var pool = db.getPool("", { pool: "mongodb" });
//          pool.get(function(err, client) {
//              var collection = client.collection('bk_account');
//              collection.findOne({ id: '123' }, function() {
//                  pool.free(client);
//              });
//          });
//
db.createPool = function(options)
{
    var self = this;
    if (!options || !options.pool) throw "Options with pool: must be provided";

    logger.debug('createPool:', options);

    if (options.pooling || (options.max > 0 && options.max != Infinity)) {
        var pool = core.createPool({
            min: options.min,
            max: options.max,
            idle: options.idle,

            create: function(callback) {
                var me = this;
                try {
                    me.connect.call(self, me, function(err, client) {
                        if (err) return callback(err, client);
                        me.watch(client);
                        me.setup(client, callback);
                    });
                } catch(e) {
                    logger.error('pool.create:', this.name, e);
                    callback(e);
                }
            },
            validate: function(client) {
                return self.pools[this.name].serialNum == client.pool_serial;
            },
            destroy: function(client) {
                logger.debug('pool.destroy', client.pool_name, "#", client.pool_serial);
                try {
                    this.close(client, function(err) { if (err) logger.error("db.close:", client.pool_name, err || "") });
                } catch(e) {
                    logger.error("pool.destroy:", client.pool_name, e);
                }
            },
        });

        // Acquire a connection with error reporting
        pool.get = function(callback) {
            this.acquire(function(err, client) {
                if (err) logger.error('pool.get:', pool.name, err);
                callback(err, client);
            });
        }
        // Release or destroy a client depending on the database watch counter
        pool.free = function(client) {
            if (this.serialNum != client.pool_serial) {
                this.destroy(client);
            } else {
                this.release(client);
            }
        }
    } else {
        var pool = {};
        pool.get = function(callback) { callback(null, {}); };
        pool.free = function(client) {};
        pool.closeAll = function() {};
        pool.stats = function() { return null };
        pool.shutdown = function(cb) { if (cb) cb() }
    }

    // Save all options and methods
    for (var p in options) {
        if (p[0] != "_" && !pool[p] && typeof options[p] != "undefined") pool[p] = options[p];
    }

    // Watch for changes or syncs and reopen the database file
    pool.watch = function(client) {
        var me = this;
        if (this.watchfile && !this.serialNum) {
            this.serialNum = 1;
            fs.watch(this.watchfile, function(event, filename) {
                logger.log('db.watch:', me.name, event, filename, me.watchfile, "#", me.serialNum);
                me.serialNum++;
                me.closeAll();
            });
        }
        // Mark the client with the current db pool serial number, if on release this number differs we
        // need to destroy the client, not return to the pool
        client.pool_serial = this.serialNum;
        client.pool_name = this.name;
        logger.debug('pool:', 'open', this.name, "#", this.serialNum);
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

    // Default methods if not setup from the options
    if (typeof pool.connect != "function") pool.connect = function(pool, callback) { callback(null, {}); };
    if (typeof pool.close != "function") pool.close = function(client, callback) { callback() }
    if (typeof pool.setup != "function") pool.setup = function(client, callback) { callback(null, client); };
    if (typeof pool.query != "function") pool.query = function(client, req, opts, callback) { callback(null, []); };
    if (typeof pool.cacheColumns != "function") pool.cacheColumns = function(opts, callback) { callback(); }
    if (typeof pool.cacheIndexes != "function") pool.cacheIndexes = function(opts, callback) { callback(); };
    if (typeof pool.nextToken != "function") pool.nextToken = function(client, req, rows, opts) { return client.next_token || null };
    // Pass all request in an object with predefined properties
    if (typeof pool.prepare != "function") {
        pool.prepare = function(op, table, obj, opts) {
            return { text: table, op: op, table: (table || "").toLowerCase(), obj: obj };
        }
    }

    pool.name = pool.pool || pool.name;
    delete pool.pool;
    pool.processRow = {};
    pool.serialNum = 0;
    pool.dbtables = {};
    pool.dbcolumns = {};
    pool.dbkeys = {};
    pool.dbindexes = {};
    pool.dbcache = {};
    pool.metrics = new metrics.Metrics('name', pool.name);
    [ 'dbinit', 'dboptions'].forEach(function(x) { if (core.typeName(pool[x]) != "object") pool[x] = {}; });
    [ 'ops', 'typesMap', 'opsMap', 'namesMap', 'skipNull' ].forEach(function(x) { if (!pool.dboptions[x]) pool.dboptions[x] = {} });
    if (!pool.type) pool.type = "unknown";
    this.pools[pool.name] = pool;
    logger.debug('db.createPool:', pool.type, pool.name);
    return pool;
}

// Convenient helper to show results from the database requests, can be used as the callback in all db method.
//
// Example:
//
//          db.select("bk_account", {}, db.showResult);
//
db.showResult = function(err, rows, info)
{
    if (err) return console.log(err);
    console.log(util.inspect(rows, { depth: 5 }), info);
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
//     - filter - function to filter rows not to be included in the result, return false to skip row, args are: function(row, options)
//     - async_filter - perform filtering of the result but with possible I/O so it can delay returning results: function(rows, options, callback),
//          the calback on result will return err and rows as any other regular database callbacks. This filter can be used to perform
//          filtering based on the ata in the other table for example.
//     - silence_error - do not report about the error in the log, still the error is retirned to the caller
//     - noprocessrows - if true then skip post processing result rows, return the data as is, this will result in returning combined
//       columns as is
//     - noconvertrows - if true skip converting the data from the database format into Javascript data types
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
    if (!options) options = {};

    var table = req.table || "";
    var pool = this.getPool(table, options);

    // Metrics collection
    var t1 = Date.now();
    var m1 = pool.metrics.Timer('que').start();
    pool.metrics.Histogram('req').update(pool.metrics.Counter('count').inc());
    pool.metrics.Counter('req_0').inc();

    function onEnd(err, client, rows, info) {
        if (client) pool.free(client);

        m1.end();
        pool.metrics.Counter('count').dec();

        if (err && !options.silence_error) {
            pool.metrics.Counter("errors_0").inc();
            logger.error("db.query:", pool.name, err, 'REQ:', req, 'OPTS:', options, err.stack);
        } else {
            logger.debug("db.query:", pool.name, Date.now() - t1, 'ms', rows.length, 'rows', 'REQ:', req, 'INFO:', info, 'OPTS:', options);
        }
        if (typeof callback != "function")  return;
        try {
            // Auto convert the error according to the rules
            if (err && pool.convertError) err = pool.convertError(table, req.op || "", err, options);

            callback(err, rows, info);
        } catch(e) {
            logger.error("db.query:", pool.name, e, 'REQ:', req, 'OPTS:', options, e.stack);
        }
    }

    pool.get(function(err, client) {
        if (err) return onEnd(err, null, [], {});

        try {
            pool.query(client, req, options, function(err, rows, info) {
                if (err) return onEnd(err, client, [], {});

                try {
                    if (!info) info = {};
                    if (!info.affected_rows) info.affected_rows = client.affected_rows || 0;
                    if (!info.inserted_id) info.inserted_oid = client.inserted_oid || null;
                    if (!info.next_token) info.next_token = pool.nextToken(client, req, rows, options);

                    pool.free(client);
                    client = null;

                    // Cache notification in case of updates, we must have the request prepared by the db.prepare
                    var cached = options.cached || self.cacheTables.indexOf(table) > -1;
                    if (cached && table && req.obj && req.op && ['put','update','incr','del'].indexOf(req.op) > -1) {
                        self.delCache(table, req.obj, options);
                    }

                    // Make sure no duplicates
                    if (options.unique) {
                        items = core.arrayUnique(items, options.unique);
                    }

                    // With total we only have one property 'count'
                    if (options.total) {
                        return onEnd(err, client, rows, info);
                    }

                    // Convert from db types into javascript, deal with json and joined columns
                    if (rows.length && !options.noconvertrows) {
                        var cols = pool.dbcolumns[table.toLowerCase()] || {};
                        for (var p in cols) {
                            var col = cols[p];
                            // Convert from JSON type
                            if (options.noJson && col.type == "json") {
                                rows.forEach(function(row) {
                                    if (typeof row[p] == "string" && row[p]) row[p] = core.jsonParse(row[p], { logging : 1 });
                                });
                            }
                            // Extract joined values and place into separate columns
                            if (col.join) {
                                rows.forEach(function(row) {
                                    if (typeof row[p] == "string" && row[p]) {
                                        var v = row[p].split("|");
                                        if (v.length == col.join.length) col.join.forEach(function(x, i) { row[x] = v[i]; });
                                    }
                                });
                            }
                        }
                    }

                    // Convert values if we have custom column callback
                    if (!options.noprocessrows) {
                        rows = self.processRows(pool, table, rows, options);
                    }

                    // Custom filter to return the final result set
                    if (options.filter && rows.length) {
                        rows = rows.filter(function(row) { return options.filter(row, options); })
                    }

                    // Async filter, can perform I/O for filtering
                    if (options.async_filter && rows.length) {
                        return options.async_filter(rows, options, function(err, rows) { onEnd(err, client, rows, info); });
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
//      - ops - object for comparison operators for primary key, default is equal operator
//      - opsMap - operator mapping into supported by the database
//      - typesMap - type mapping for properties to be used in the condition
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
//   - concurrency - how many update queries to execute at the same time, default is 1, this is done by using core.forEachLimit.
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
//                              r.birthday = core.strftime(new Date(r.birthday, "%Y-%m-D"));
//                        } },
//                        function(err, rows) {
//          });
//
db.updateAll = function(table, query, obj, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options,options = {};
    options = this.getOptions(table, options);

    // Custom handler for the operation
    var pool = this.getPool(table, options);
    if (pool.updateAll && !options.process) return pool.updateAll(table, query, obj, options, callback);

    options.noprocessrows = 1;
    self.select(table, query, options, function(err, rows) {
        if (err) return callback ? callback(err) : null;

        options.ops = {};
        core.forEachLimit(rows, options.concurrency || 1, function(row, next) {
            for (var p in obj) row[p] = obj[p];
            if (options && options.process) options.process(row, options);
            self.update(table, row, options, next);
        }, function(err) {
            if (callback) callback(err, rows);
        });
    });
}

// Counter operation, increase or decrease column values, similar to update but all specified columns except primary
// key will be incremented, use negative value to decrease the value.
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
    var cols = this.getColumns(table, options);
    if (!options.counter) options.counter = Object.keys(cols).filter(function(x) { return cols[x].type == "counter" });

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
// - concurrency - how many delete requests to execute at the same time by using core.forEachLimit.
// - process - a function callback that will be called for each row before deleting it, this is for some transformations of the record properties
//   in case of complex columns that may contain concatenated values as in the case of using DynamoDB. The callback will be called
//   as `options.process(row, options)`
db.delAll = function(table, query, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options,options = {};
    options = this.getOptions(table, options);
    options.noprocessrows = 1;

    // Custom handler for the operation
    var pool = this.getPool(table, options);
    if (pool.delAll && !options.process) return pool.delAll(table, query, options, callback);

    // Options without ops for delete
    var opts = core.cloneObj(options, 'ops', {});
    self.select(table, query, options, function(err, rows) {
        if (err) return callback ? callback(err) : null;

        core.forEachLimit(rows, options.concurrency || 1, function(row, next) {
            if (options && options.process) options.process(row, opts);
            self.del(table, row, opts, next);
        }, function(err) {
            if (callback) callback(err, rows);
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
        if (options.put_only) return callback ? callback(null, []) : null;
        return self.add(table, obj, options, callback);
    }

    // Create deep copy of the object so we have it complete inside the callback
    obj = core.cloneObj(obj);

    self.query(req, options, function(err, rows) {
        if (err) return callback ? callback(err, []) : null;

        logger.debug('db.replace:', req, rows.length);
        if (rows.length) {
            // Skip update if specified or mtime is less or equal
            if (options.add_only || (select == options.check_mtime && core.toDate(rows[0][options.check_mtime]) >= core.toDate(obj[options.check_mtime]))) {
                return callback ? callback(null, []) : null;
            }
            // Verify all fields by value
            if (options.check_data) {
                var same = select == "1" || Object.keys(rows[0]).every(function(x) { return String(rows[0][x]) == String(obj[x]) });
                // Nothing has changed
                if (same) return callback ? callback(null, []) : null;
            }
            self.update(table, obj, options, callback);
        } else {
            if (options.put_only) return callback ? callback(null, []) : null;
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

    switch (core.typeName(query)) {
    case "string":
    case "array":
        query = core.strSplit(query);
        if (typeof query[0] == "string") {
            var keys = this.getKeys(table, options);
            if (!keys.length) return callback ? callback(new Error("invalid keys"), []) : null;
            query = query.map(function(x) { return core.newObj(keys[0], x) });
        }
        break;

    default:
        return callback ? callback(new Error("invalid list"), []) : null;
    }
    if (!query.length) return callback ? callback(null, []) : null;
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

    // Custom handler for the operation
    var pool = this.getPool(table, options);
    if (pool.batch) return pool.batch(table, op, objs, options, callback);
    var info = [];

    core.forEachLimit(objs, options.concurrency || 1, function(obj, next) {
        db[op](table, obj, options, function(err) {
            if (err && options.ignore_error) {
                info.push([ err, obj ]);
                return next();
            }
            next(err);
        });
    }, function(err) {
        if (callback) callback(err, [], info);
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
//    - noprocessrows - default is 1 to pass raw records for processing, to work with normal records pass 0 to disable default behaviour
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
    if (typeof options.noprocessrows == "undefined") options.noprocessrows = 1;

    core.whilst(
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
                  core.forEachSeries(rows, function(row, next2) { rowCallback(row, next2); }, next);
              }
          });
      }, endCallback);
}

// Migrate a table via temporary table, copies all records into a temp table, then re-create the table with up-to-date definitions and copies all records back into the new table.
// The following options can be used:
// - preprocess - a callback function(row, options, next) that is called for every row on the original table, next must be called to move to the next row, if err is returned as first arg then the processing will stop
// - postprocess - a callback function(row, options, next) that is called for every row on the destination table, same rules as for preprocess
// - tmppool - the db pool to be used for temporary table
// - tpmdrop - if 1 then the temporary table willbe dropped at the end in case of success, by default it is kept
db.migrate = function(table, options, callback)
{
    if (!options) options = {};
    if (!options.preprocess) options.preprocess = function(row, options, next) { next() }
    if (!options.postprocess) options.postprocess = function(row, options, next) { next() }
    if (!options.delay) options.delay = 1000;
    var pool = db.getPool(table, options);
    var cols = db.getColumns(table, options);
    var tmptable = table + "_tmp";
    var obj = pool.dbtables[table];

    core.series([
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
                    db.add(tmptable, row, { pool: options.tmppool }, next2);
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
                    db.add(table, row, options, next2);
                });
            }, next);
        },
        function(next) {
            if (!options.tmpdrop) return next();
            db.drop(tmptable, options, next);
        }],
        function(err) {
            if (callback) callback(err);
    });
}

// Perform full text search on the given table, the database implementation may ignore table name completely
// in case of global text index.
// Query is in general a text string with the format that is supported by the underlying driver, bkjs does not parse the query at all.
// Options make take the same properties as in the select method. Without full text support
// this works the same way as the `select` method.
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
// - options.existing is 1 then return only joined records.
// - options.override - joined table properties will replace existing ones
//
// Example:
//
//          db.join("bk_account", [{id:"123",key1:1},{id:"234",key1:2}], db.showResult)
//
db.join = function(table, rows, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    options = this.getOptions(table, options);

    var map = {}, ids = [];
    var keys = options.keys || self.getKeys(table, options);
    rows.forEach(function(x) {
        var key = self.getQueryForKeys(keys, x);
        var k = Object.keys(key).map(function(y) { return key[y]}).join("|");
        if (!map[k]) map[k] = [];
        map[k].push(x);
        ids.push(key);
    });
    db.list(table, ids, options, function(err, list, info) {
        if (err) return callback(err, []);

        list.forEach(function(x) {
            var key = self.getQueryForKeys(keys, x);
            var k = Object.keys(key).map(function(y) { return key[y]}).join("|");
            map[k].forEach(function(row) {
                for (var p in x) if (options.override || !row[p]) row[p] = x[p];
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
//          api.describeTables({
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
    options = this.getOptions(table, options);
    var cols = db.getColumns(table, options);
    var keys = db.getKeys(table, options);
    var lcols =  ["geohash", "latitude", "longitude"];
    var rows = [];

    // New location search
    if (!options.geohash) {
        options.count = options.gcount = core.toNumber(options.count, 0, 10, 0, 50);
        options.geokey = lcols[0] = options.geokey && cols[options.geokey] ? options.geokey : 'geohash';
        options.distance = core.toNumber(query.distance, 0, core.minDistance, 0, 999);
        options.start = null;
        // Have to maintain sorting order for pagination
        if (!options.sort && keys.length > 1) options.sort = keys[1];
        var geo = core.geoHash(query.latitude, query.longitude, { distance: options.distance });
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
    core.doWhilst(
      function(next) {
          db.select(table, query, options, function(err, items, info) {
              if (err) return next(err);

              // Next page if any or go to the next neighbor
              options.start = info.next_token;

              // If no coordinates but only geohash decode it
              items.forEach(function(row) {
                  row.distance = core.geoDistance(options.latitude, options.longitude, row.latitude, row.longitude, options);
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
          if (callback) callback(err, rows, info);
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
//  - op - operators to use for comparison for properties, see `db.select`
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
    options = this.getOptions(table, options);
    if (!options._cached && (options.cached || this.cacheTables.indexOf(table) > -1)) {
        options._cached = 1;
        return this.getCached("get", table, query, options, callback);
    }
    var req = this.prepare("get", table, query, options);
    this.query(req, options, function(err, rows) {
        if (callback) callback(err, rows.length ? rows[0] : null);
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
    options = this.getOptions(table, options);
    var pool = this.getPool(table, options);
    var m = pool.metrics.Timer('cache').start();
    this.getCache(table, query, options, function(rc) {
        m.end();
        // Cached value retrieved
        if (rc) rc = core.jsonParse(rc);
        // Parse errors treated as miss
        if (rc) {
            pool.metrics.Counter("hits").inc();
            return callback ? callback(null, rc, {}) : null;
        }
        pool.metrics.Counter("misses").inc();
        // Retrieve account from the database, use the parameters like in Select function
        self[op](table, query, options, function(err, row, info) {
            // Store in cache if no error
            if (row && !err) self.putCache(table, row, options);
            if (callback) callback(err, row, info);
        });
    });
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
db.putCache = function(table, obj, options)
{
    var key = options && options.cacheKey ? options.cacheKey : this.getCacheKey(table, obj, options);
    if (key) ipc.put(key, core.stringify(obj), options);
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
    var keys = this.getKeys(table, options).filter(function(x) { return query[x] }).map(function(x) { return query[x] }).join("|");
    if (keys) keys = (options && options.cachePrefix ? options.cachePrefix : table) + "|" + keys;
    return keys;
}

// Create a table using column definitions represented as a list of objects. Each column definition can
// contain the following properties:
// - name - column name
// - type - column type, one of: int, real, string, counter or other supported type
// - primary - column is part of the primary key
// - unique - column is part of an unique key
// - index - column is part of an index
// - value - default value for the column
// - len - column length
// - pub - columns is public, *this is very important property because it allows anybody to see it when used in the default API functions, i.e. anybody with valid
//    credentials can retrieve all public columns from all other tables, and if one of the other tables is account table this may expose some personal infoamtion,
//    so by default only a few columns are marked as public in the bk_account table*
// - hidden - completely ignored by all update operations but could be used by the public columns cleaning procedure, if it is computed and not stored in the db
//    it can contain pub property to be returned to the client
// - readonly - only add/put operations will use the value, incr/update will not affect the value
// - writeonly - only incr/update can chnage this value, add/put will ignore it
// - now - means on every add/put/update set this column with current time as Date.now()
// - autoincr - for counter tables, mark the column to be auto-incremented by the connection API if the connection type has the same name as the column name
//
// *Some properties may be defined multiple times with number suffixes like: unique1, unique2, index1, index2 to create more than one index for the table, same
// properties define a composite key in the order of definition or sorted by the property value, for example: `{ a: {index:2 }, b: { index:1 } }` will create index (b,a)
// because of the index: property value being not the same.*
//
// NOTE: Index creation is not required and all index properties can be omitted, it can be done more effectively using native tools for any specific database,
// this format is for simple and common use cases without using any other tools but it does not cover all possible variations for every database. But all indexes and
// primary keys created outside of the backend application still be be detected properly by `db.cacheColumns` method for every database.
//
// Each database pool also can support native options that are passed directly to the driver in the options, these properties are
// defined in the object with the same name as the db driver, all properties are combined, for example to define provisioned throughput for the DynamoDB index:
//
//          db.create("test_table", { id: { primary: 1, type: "int", index: 1, dynamodb: { readCapacity: 50, writeCapacity: 50 } },
//                                    type: { primary: 1, pub: 1, projection: 1 },
//                                    name: { index: 1, pub: 1 } }
//                                  });
//
// Create DynamoDB table with global secondary index, first index property if not the same as primary key hash defines global index, if it is the same then local,
// below we create global secondary index on property 'name' only, in the example above it was local secondary index for id and name. also local secondary index is
// created on id,title.
//
//          db.create("test_table", { id: { primary: 1, type: "int", index1: 1 },
//                                    type: { primary: 1, projection: 1 },
//                                    name: { index: 1 }
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

// Upgrade a table with missing columns from the definition list
db.upgrade = function(table, columns, options, callback)
{
    if (typeof options == "function") callback = options,options = {};
    options = this.getOptions(table, options);
    var req = this.prepare("upgrade", table, columns, options);
    if (!req.text) return callback ? callback() : null;
    this.query(req, options, callback);
}

// Drop a table
db.drop = function(table, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options,options = {};
    options = this.getOptions(table, options);
    var req = this.prepare("drop", table, {}, options);
    if (!req.text) return callback ? callback() : null;
    this.query(req, options, function(err, rows, info) {
        // Clear table cache
        if (!err) {
            var pool = self.getPool(table, options);
            delete pool.dbcolumns[table];
            delete pool.dbkeys[table];
        }
        if (callback) callback(err, rows, info);
    });
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

    // Keep an object in the format we support
    if (["object","string","array"].indexOf(core.typeName(obj)) == -1) obj = {};

    // Process special columns
    var keys = pool.dbkeys[table.toLowerCase()] || [];
    var cols = pool.dbcolumns[table.toLowerCase()] || {};
    var now = Date.now();
    switch (op) {
    case "add":
    case "put":
        // Set all default values if any
        for (var p in cols) {
            if (typeof cols[p].value != "undefined" && !obj[p]) obj[p] = cols[p].value;
            // Counters must have default value or use 0 is implied
            if (typeof obj[p] == "undefined") {
                if (cols[p].type == "counter") obj[p] = 0;
                if (cols[p].type == "uuid") obj[p] = core.uuid();
            }
        }

    case "incr":
        // All values must be numbers
        for (var p in cols) {
            if (typeof obj[p] != "undefined" && cols[p].type == "counter") obj[p] = core.toNumber(obj[p]);
        }

    case "update":
        // Current timestamps, for primary keys only support add
        for (var p in cols) {
            if (cols[p].now && !obj[p] && (!cols[p].primary || op == "add")) obj[p] = now;
        }

        // Keep only columns from the table definition if we have it
        // Go over all properties in the object and makes sure the types of the values correspond to the column definition types,
        // this is for those databases which are very sensitive on the types like DynamoDB. This function updates the object in-place.
        var o = {};
        for (var p in obj) {
            var v = obj[p];
            var col = cols[p];
            if (col) {
                if (col.hidden) continue;
                if (col.readonly && (op == "incr" || op == "update")) continue;
                if (col.writeonly && (op == "add" || op == "put")) continue;
                // Handle json separately in sync with processRows
                if (options.noJson && !options.strictTypes && cols[p].type == "json" && typeof obj[p] != "undefined") v = JSON.stringify(v);
                // Convert into native data type
                if (options.strictTypes && (col.primary || col.type) && typeof obj[p] != "undefined") v = core.toValue(v, col.type);
                // Verify against allowed values
                if (Array.isArray(col.values) && col.values.indexOf(String(v)) == -1) continue;
                // The field is combined from several values contatenated for complex primary keys
                if (col.join) v = col.join.map(function(x) { return obj[x] || "" }).join("|");
                // Max length limit for text fields
                if (col.maxlength && typeof v == "string" && !col.type && v.length > col.maxlength) v = v.substr(0, col.maxlength);
            }
            if (this.skipColumn(p, v, options, cols)) continue;
            if ((v == null || v === "") && options.skipNull[op]) continue;
            o[p] = v;
        }
        obj = o;
        break;

    case "del":
        var o = {};
        for (var p in obj) {
            var v = obj[p];
            var col = cols[p];
            if (!col) continue;
            // Convert into native data type
            if (options.strictTypes && (col.primary || col.type) && typeof obj[p] != "undefined") v = core.toValue(v, col.type);
            // The field is combined from several values contatenated for complex primary keys
            if (col.join && typeof obj[p] != "undefined") v = col.join.map(function(x) { return obj[x] || "" }).join("|");
            o[p] = v;
        }
        obj = o;
        break;

    case "select":
        if (options.ops) {
            for (var p in options.ops) {
                switch (options.ops[p]) {
                case "in":
                case "between":
                    if (obj[p] && !Array.isArray(obj[p])) {
                        var type = cols[p] ? cols[p].type : "";
                        obj[p] = core.strSplit(obj[p], null, core.isNumeric(type));
                    }
                    break;
                }
            }
        }

        // Convert simple types into the native according to the table definition, some query parameters are not
        // that strict and can be more arrays which we should not convert due to options.ops
        if (options.strictTypes) {
            for (var p in cols) {
                if (core.isNumeric(cols[p].type)) {
                    if (typeof obj[p] == "string") obj[p] = core.toNumber(obj[p]);
                } else {
                    if (typeof obj[p] == "number") obj[p] = String(obj[p]);
                }
            }
        }
        break;

    case "upgrade":
        if (options.noUpgrade) return {};
        break;
    }
    return pool.prepare(op, table, obj, options);
}

// Return database pool by table name or default pool, options may contain { pool: name } to return
// the pool by given name. This call always return valid pool object, in case no requiested pool found it returns
// special empty pool which provides same interface but returns errors instesd of results.
db.getPool = function(table, options)
{
    return this.pools[(options || {})["pool"] || this.poolTables[table] || this.pool] || this.nopool;
}

// Returns given pool if it exists and initialized otherwise returns null
db.getPoolByName = function(name)
{
    var pool = this.getPool("", { pool: name });
    return pool == this.nopool ? null : pool;
}

// Return combined options for the pool including global pool options
db.getOptions = function(table, options)
{
    if (options && options._merged) return options;
    var pool = this.getPool(table, options);
    options = core.mergeObj(pool.dboptions, options);
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

// Return a value for the given property from the column definition, return empty string if no column or attribute found
db.getColumnProperty = function(table, name, attr, options)
{
    var col = this.getColumns(table, options)[name];
    return col ? col[attr] : "";
}

// Return an object with capacity property which is the max write capacity for the table, for DynamoDB only. It check writeCapacity property
// of all table columns.
db.getCapacity = function(table)
{
    var obj = { table: table, capacity: 0, count: 0, total: 0, mtime: Date.now(), ctime: Date.now() };
    var cols = this.getColumns(table);
    for (var p in cols) {
        if (cols[p].writeCapacity) obj.capacity = Math.max(cols[p].writeCapacity, obj.capacity);
    }
    return obj;
}

// Check if number of write requests exceeds the capacity per second, delay if necessary, for DynamoDB only but can be used for pacing
// write requests with any database or can be used generically. The `obj` must be initialized with `db.getCapacity` call.
db.checkCapacity = function(obj, callback)
{
    var now = Date.now();
    obj.total++;
    if (obj.capacity > 0 && ++obj.count >= obj.capacity && now - obj.mtime < 1000) {
        setTimeout(callback, 1000 - (now - obj.mtime));
        obj.count = 0;
        obj.mtime = now;
    } else {
        callback();
    }
}

// Return list of selected or allowed only columns, empty list if no options.select is specified
db.getSelectedColumns = function(table, options)
{
    var self = this;
    var select = [];
    if (options.select && options.select.length) {
        var cols = this.getColumns(table, options);
        options.select = core.strSplitUnique(options.select);
        select = Object.keys(cols).filter(function(x) { return !self.skipColumn(x, "", options, cols) && options.select.indexOf(x) > -1; });
    } else
    if (options.skip_columns) {
        var cols = this.getColumns(table, options);
        select = Object.keys(cols).filter(function(x) { return !self.skipColumn(x, "", options, cols); });
    }
    return select.length ? select : null;
}

// Verify column against common options for inclusion/exclusion into the operation, returns 1 if the column must be skipped
db.skipColumn = function(name, val, options, columns)
{
    return !name || name[0] == '_' || typeof val == "undefined" ||
           (options && options.skip_null && val === null) ||
           (options && !options.all_columns && (!columns || !columns[name])) ||
           (options && options.skip_columns && options.skip_columns.indexOf(name) > -1) ? true : false;
}

// Given object with data and list of keys perform comparison in memory for all rows, return only rows that match all keys. This method is usee
// by custom filters in `db.select` by the drivers which cannot perform comparisons with non-indexes columns like DynamoDb, Cassandra.
// The rows that satisfy primary key conditions are retunred and then called this function to eliminate the records that do not satisfy non-indexed column conditions.
//
// Options support the following propertis:
// - keys - list of columns to check, these may or may not be the primary keys, any columns to be compared
// - cols - an object with columns definition
// - ops - operations for columns
// - typesMap - types for the columns if different from the actual Javascript type
db.filterColumns = function(obj, rows, options)
{
    if (!options.ops) options.ops = {};
    if (!options.typesMap) options.typesMap = {};
    if (!options.cols) options.cols = {};
    // Keep rows which satisfy all conditions
    return rows.filter(function(row) {
        return (options.keys || []).every(function(name) {
            return core.isTrue(row[name], obj[name], options.ops[name], options.typesMap[name] || (options.cols[name] || {}).type);
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
    return this.getQueryForKeys(this.getSearchKeys(table, options), obj);
}

// Returns an object based on the list of keys, basically returns a subset of properties
db.getQueryForKeys = function(keys, obj, options)
{
    var self = this;
    return (keys || []).
            filter(function(x) { return !self.skipColumn(x, obj[x]) }).
            map(function(x) { return [ x, obj[x] ] }).
            reduce(function(x,y) { x[y[0]] = y[1]; return x }, {});
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
    return cb ? cb(val, info) : val;
}

// Return transformed value for the column value returned by the database, same parameters as for getBindValue
db.getColumnValue = function(table, options, val, info)
{
    var cb = this.getPool(table, options).colValue;
    return cb ? cb(val, info) : val;
}

// Convert native database error in some generic human readable string
db.convertError = function(table, op, err, options)
{
    if (!err || !(err instanceof Error)) return err;
    var cb = this.getPool(table, options).convertError;
    return cb ? cb(table, op, err, options) : err;
}

// Reload all columns into the cache for the pool
db.cacheColumns = function(options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    var pool = this.getPool('', options);
    pool.cacheColumns.call(pool, options, function(err) {
        if (err) logger.error('cacheColumns:', pool.name, err);
        self.mergeColumns(pool);
        pool.cacheIndexes.call(pool, options, function(err) {
            if (err) logger.error('cacheIndexes:', pool.name, err);
            self.mergeKeys(pool);
            if (callback) callback(err);
        });
    });
}

// Merge JavaScript column definitions with the db cached columns
db.mergeColumns = function(pool)
{
    var tables = pool.dbtables;
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
        if (!dbkeys[table]) dbkeys[table] = core.searchObj(dbcolumns[table], { name: 'primary', sort: 1, names: 1 });
    }
}

// Custom row handler that is called for every row in the result, this assumes that pool.processRow callback has been assigned previously by db.setProcessRow.
// This function is called automatically by the db.query but can be called manually for rows that are not received from the database, for example on
// adding new records and returning them back to the client. In such case, the `pool` argument can be passed as null, it will be found by the table name.
// `rows` can be list of records or single record.
db.processRows = function(pool, table, rows, options)
{
    var self = this;
    if (!pool) pool = this.getPool(table, options);
    var hooks = pool.processRow[table];
    if (!Array.isArray(hooks) || !hooks.length) return rows;
    var cols = this.getColumns(table, options);

    // Stop of the first hook returning true to remove this row from the list
    function processRow(row) {
        for (var i = 0; i < hooks.length; i++) {
            if (hooks[i].call(pool, row, options, cols) === true) return false;
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

// Assign processRow callback for a table, this callback will be called for every row on every result being retrieved from the
// specified table thus providing an opportunity to customize the result.
//
// All assigned callback to this table will be called in the order of the assignment.
//
// The callback accepts 3 arguments: function(row, options, columns)
//   where - row is a row from the table, options are the obj passed to the db called and columns is an object with table's columns
//
// **If the callback returns true, row will be filtered out and not included in the final result set.**
//
//
//  Example
//
//      db.setProcessRow("bk_account", function(row, opts, cols) {
//          if (row.birthday) row.age = Math.floor((Date.now() - core.toDate(row.birthday))/(86400000*365));
//      });
//
//      db.setProcessRow("bk_icon", function(row, opts, cols) {
//          if (row.type == "private" && row.id != opts.account.id) return true;
//      });
//
db.setProcessRow = function(table, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (!table || !callback) return;
    for (var p in this.pools) {
        var pool = this.pools[p];
        if (!pool.processRow[table]) pool.processRow[table] = [];
        pool.processRow[table].push(callback);
    }
}

// Create a database pool for SQL like databases
// - options - an object defining the pool, the following properties define the pool:
//    - pool - pool name/type, of not specified SQLite is used
//    - max - max number of clients to be allocated in the pool
//    - idle - after how many milliseconds an idle client will be destroyed
db.sqlInitPool = function(options)
{
    var self = this;
    if (!options) options = {};
    if (!options.pool) options.pool = "sqlite";

    options.pooling = true;
    // Translation map for similar operators from different database drivers, merge with the basic SQL mapping
    var dboptions = { sql: true, schema: [], typesMap: { counter: "int", bigint: "int", smallint: "int" }, opsMap: { begins_with: 'like%', ne: "<>", eq: '=', le: '<=', lt: '<', ge: '>=', gt: '>' } };
    options.dboptions = core.mergeObj(dboptions, options.dboptions);
    var pool = this.createPool(options);

    // Execute initial statements to setup the environment, like pragmas
    pool.setup = function(client, callback) {
        var me = this;
        var init = Array.isArray(options.init) ? options.init : [];
        core.forEachSeries(init, function(sql, next) {
            client.query(sql, next);
        }, function(err) {
            if (err) logger.error('db.setup:', me.name, err);
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
        if (!req || typeof req.text == "undefined") return callback(null, []);

        if (!req.values) req.values = [];
        if (!Array.isArray(req.text)) {
            client.query(req.text, req.values, opts, callback);
        }  else {
            var rows = [];
            core.forEachSeries(req.text, function(text, next) {
                client.query(text, null, opts, function(err, rc) { if (rc) rows = rc; next(err); });
            }, function(err) {
                callback(err, rows);
            });
        }
    }
    // Support for pagination, for SQL this is the OFFSET for the next request
    pool.nextToken = function(client, req, rows, opts) {
        return  opts.count && rows.length == opts.count ? core.toNumber(opts.start) + core.toNumber(opts.count) : null;
    }
    return pool;
}

// Cache columns using the information_schema
db.sqlCacheColumns = function(options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    var pool = this.getPool('', options);
    pool.get(function(err, client) {
        if (err) return callback ? callback(err, []) : null;

        // Use current database name for schema if not specified
        if (!pool.dboptions.schema.length) pool.dboptions.schema.push(client.name);
        client.query("SELECT c.table_name,c.column_name,LOWER(c.data_type) AS data_type,c.column_default,c.ordinal_position,c.is_nullable " +
                     "FROM information_schema.columns c,information_schema.tables t " +
                     "WHERE c.table_schema IN (" + self.sqlValueIn(pool.dboptions.schema) + ") AND c.table_name=t.table_name " +
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
            pool.free(client);
            if (callback) callback(err);
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
        req = this.sqlSelect(table, obj, core.extendObj(options, "count", 1, "keys", this.getKeys(table, options)));
        break;
    case "add":
        req = this.sqlInsert(table, obj, options);
        break;
    case "put":
        req = this.sqlInsert(table, obj, core.extendObj(options, "replace", !options.noReplace));
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
db.sqlValue = function(value, type, dflt, min, max)
{
    var self = this;
    if (value == "null") return "NULL";
    switch ((type || core.typeName(value))) {
    case "expr":
    case "buffer":
        return value;

    case "real":
    case "float":
    case "double":
        return core.toNumber(value, true, dflt, min, max);

    case "int":
    case "bigint":
    case "smallint":
    case "integer":
    case "number":
    case "counter":
        return core.toNumber(value, null, dflt, min, max);

    case "bool":
    case "boolean":
        return core.toBool(value);

    case "date":
        return this.sqlQuote((new Date(value)).toISOString());

    case "time":
        return this.sqlQuote((new Date(value)).toLocaleTimeString());

    case "mtime":
        return /^[0-9\.]+$/.test(value) ? this.toNumber(value, null, dflt, min, max) : this.sqlQuote((new Date(value)).toISOString());

    default:
        return this.sqlQuote(value);
    }
}

// Return list in format to be used with SQL IN ()
db.sqlValueIn = function(list, type)
{
    var self = this;
    if (!Array.isArray(list) || !list.length) return '';
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
        switch (core.typeName(value)) {
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
        switch (core.typeName(value)) {
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
                sql += name + ">=" + this.sqlValue(list[0], options.type) + " AND " + name + "<=" + this.sqlValue(list[1], options.type);
            } else {
                sql += name + " " + op + " " + this.sqlValue(list[0], options.type) + " AND " + this.sqlValue(list[1], options.type);
            }
        } else {
            sql += name + "=" + this.sqlValue(value, options.type, options.value, options.min, options.max);
        }
        break;

    case "null":
    case "not null":
        sql += name + " IS " + op;
        break;

    case '@@':
        switch (core.typeName(value)) {
        case "string":
            if (value.indexOf('|') > -1) {
                value = value.split('|');
            } else {
                sql += name + op + " plainto_tsquery('" + (options.min || "english") + "'," + this.sqlQuote(value) + ")";
                break;
            }

        case "array":
            value = value.map(function(x) { return "plainto_tsquery('" + (options.min || "english") + "'," + self.sqlQuote(x) + ")" }).join('||');
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
        sql += name + " LIKE " + this.sqlValue(value, options.type, options.value, options.min, options.max);
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
        sql += name + " " + op + " " + this.sqlValue(value, options.type, options.value, options.min, options.max);
        break;

    case "iregexp":
    case "not iregexp":
        sql += "LOWER(" + name + ") " + (op[0] == 'n' ? "NOT" : "") + " REGEXP " + this.sqlValue(value, options.type, options.value, options.min, options.max);
        break;

    case 'begins_with':
        sql += name + " > " + this.sqlQuote(value.substr(0, value.length-1) + String.fromCharCode(value.charCodeAt(value.length-1) - 1));
        sql += " AND " + name + " < " + this.sqlQuote(value.substr(0, value.length-1) + String.fromCharCode(value.charCodeAt(value.length-1) + 1));
        break;

    case 'expr':
        if (options.expr) {
            var str = options.expr;
            if (value.indexOf('|') > -1) value = value.split('|');
            str = str.replace(/%s/g, this.sqlValue(value, options.type, null, options.min, options.max));
            str = str.replace(/%1/g, this.sqlValue(value[0], options.type, null, options.min, options.max));
            str = str.replace(/%2/g, this.sqlValue(value[1], options.type, null, options.min, options.max));
            sql += str;
        }
        break;

    default:
        sql += name + "=" + this.sqlValue(value, options.type, options.value, options.min, options.max);
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

// Given columns definition object, build SQL query using values from the values object, all conditions are joined using AND,
// - columns is a list of objects with the following properties:
//     - name - column name, also this is the key to use in the values object to get value by
//     - col - actual column name to use in the SQL
//     - alias - optional table prefix if multiple tables involved
//     - value - default value
//     - type - type of the value, this is used for proper formatting: boolean, number, float, date, time, string, expr
//     - op - any valid SQL operation: =,>,<, between, like, not like, in, not in, ~*,.....
//     - group - for grouping multiple columns with OR condition, all columns with the same group will be in the same ( .. OR ..)
//     - always - only use default value if true
//     - required - value default or supplied must be in the query, otherwise return empty SQL
//     - search - additional name for a value, for cases when generic field is used for search but we search specific column
// - values - actual values for the condition as an object, usually req.query
// - params - if given will contain values for binding parameters
db.sqlFilter = function(columns, values, params)
{
    var self = this;
    var all = [], groups = {};
    if (!values) values = {};
    if (!params) params = [];
    for (var name in columns) {
        var col = columns[name];
        // Default value for this column
        var value = col.value;
        // Can we use supplied value or use only default one
        if (!col.always) {
            if (values[name]) value = values[name];
            // In addition to exact field name there could be query alias to be used for this column in case of generic search field
            // which should be applied for multiple columns, this is useful to search across multiple columns or use different formats
            var search = col.search;
            if (search) {
                if (!Array.isArray(col.search)) search = [ search ];
                for (var j = 0; j < search.length; j++) {
                    if (values[search[j]]) value = values[search[j]];
                }
            }
        }
        if (typeof value =="undefined" || (typeof value == "string" && !value)) {
            // Required filed is missing, return empty query
            if (col.required) return "";
            // Allow empty values explicitly
            if (!col.empty) continue;
        }
        // Uses actual column name now once we got the value
        if (col.col) name = col.col;
        // Table prefix in case of joins
        if (col.alias) name = col.alias + '.' + name;
        // Wrap into COALESCE
        if (typeof col.coalesce != "undefined") {
            name = "COALESCE(" + name + "," + this.sqlValue(col.coalesce, col.type) + ")";
        }
        var sql = "";
        // Explicit skip of the parameter
        if (col.op == 'skip') {
            continue;
        } else
        // Add binding parameters
        if (col.op == 'bind') {
            sql = col.expr.replace('$#', '$' + (params.length + 1));
            params.push(value);
        } else
        // Special case to handle NULL
        if (col.isnull && (value == "null" || value == "notnull")) {
            sql = name + " IS " + value.replace('null', ' NULL');
        } else {
            // Primary condition for the column
            sql = this.sqlExpr(name, value, col);
        }
        if (!sql) continue;
        // If group specified, that means to combine all expressions inside that group with OR
        if (col.group) {
            if (!groups[col.group]) groups[col.group] = [];
            groups[col.group].push(sql);
        } else {
            all.push(sql);
        }
    }
    var sql = all.join(" AND ");
    for (var p in groups) {
        var g = groups[p].join(" OR ");
        if (!g) continue;
        if (sql) sql += " AND ";
        sql += "(" + g + ")";
    }
    return sql;
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
        var desc = core.toBool(options['desc' + x]);
        orderby += (orderby ? "," : "") + sort + (desc ? " DESC" : "");
    });
    if (orderby) rc += " ORDER BY " + orderby;

    // Limit clause
    var page = core.toNumber(options.page, false, 0, 0);
    var count = core.toNumber(options.count, false, 50, 0);
    var start = core.toNumber(options.start, false, 0, 0);
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
    var opts = core.cloneObj(options);
    var where = [], c = {};
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
        if (options.typesMap && options.typesMap[opts.type]) type = options.typesMap[opts.type];
        var sql = self.sqlExpr(k, v, opts);
        if (sql) where.push(sql);
    });
    return where.join(" AND ");
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
    return this.sqlCreate(table, obj, core.cloneObj(options, "upgrade", 1));
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
        if (v && col.db_type == "number" && typeof v != "number") v = core.toNumber(v);
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
        if (v && col.db_type == "number" && typeof v != "number") v = core.toNumber(v);
        var placeholder = (options.sqlPlaceholder || ("$" + i));
        // Update only if the value is null, otherwise skip
        if (options.coalesce && options.coalesce.indexOf(p) > -1) {
            sets.push(p + "=COALESCE(" + p + "," + placeholder + ")");
        } else
        // Concat mode means append new value to existing, not overwrite
        if (options.concat && options.concat.indexOf(p) > -1) {
            sets.push(p + "=" + (options.noConcat ? p + "+" + placeholder : "CONCAT(" + p + "," + placeholder + ")"));
        } else
        // Incremental update
        if ((col.type === "counter") || (options.counter && options.counter.indexOf(p) > -1)) {
            sets.push(p + "=" + (options.noCoalesce ? p : "COALESCE(" + p + ",0)") + "+" + placeholder);
        } else {
            sets.push(p + "=" + placeholder);
        }
        v = this.getBindValue(table, options, v, col);
        req.values.push(v);
        i++;
    }
    var where = this.sqlWhere(table, obj, keys, options);
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
    if (options.expected) {
        var expected = Object.keys(options.expected).
                              filter(function(x) { return ["string","number"].indexOf(core.typeName(options.expected[x])) > -1 }).
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

// Setup PostgreSQL pool driver
db.pgsqlInitPool = function(options)
{
    if (!utils.PgSQLDatabase) {
        logger.error("PostgreSQL driver is not compiled in, consider to install postgresql libpq library");
        return this.nopool;
    }

    var self = this;
    if (!options) options = {};
    if (!options.pool) options.pool = "pgsql";
    options.dboptions = { typesMap: { real: "numeric", bigint: "bigint", smallint: "smallint" }, noIfExists: 1, noReplace: 1, schema: ['public'] };
    options.type = "pgsql";
    var pool = this.sqlInitPool(options);
    pool.connect = function(options, callback) {
        new utils.PgSQLDatabase(options.db, function(err) {
            if (err) {
                logger.error('pgsqlOpen:', options, err);
                return callback(err);
            }
            this.notify(function(msg) { logger.log('notify:', msg) });
            callback(err, this);
        });
    }
    pool.bindValue = self.pgsqlBindValue;
    pool.cacheIndexes = self.pgsqlCacheIndexes;
    // No REPLACE INTO support, do it manually
    pool.put = function(table, obj, opts, callback) {
        self.update(table, obj, opts, function(err, rows, info) {
            if (err || info.affected_rows) return callback ? callback(err, rows, info) : null;
            self.add(table, obj, opts, callback);
        });
    }
    return pool;
}

// Cache indexes using the information_schema
db.pgsqlCacheIndexes = function(options, callback)
{
    var self = this;

    self.get(function(err, client) {
        if (err) return callback ? callback(err, []) : null;

        client.query("SELECT t.relname as table, i.relname as index, indisprimary as pk, array_agg(a.attname ORDER BY a.attnum) as cols "+
                     "FROM pg_class t, pg_class i, pg_index ix, pg_attribute a, pg_catalog.pg_namespace n "+
                     "WHERE t.oid = ix.indrelid and i.oid = ix.indexrelid and a.attrelid = t.oid and n.oid = t.relnamespace and " +
                     "      a.attnum = ANY(ix.indkey) and t.relkind = 'r' and n.nspname not in ('pg_catalog', 'pg_toast') "+
                     "GROUP BY t.relname, i.relname, ix.indisprimary ORDER BY t.relname, i.relname", function(err, rows) {
            if (err) logger.error('cacheIndexes:', self.name, err);
            self.dbkeys = {};
            self.dbindexes = {};
            for (var i = 0; i < rows.length; i++) {
                if (rows[i].pk) {
                    self.dbkeys[rows[i].table] = rows[i].cols;
                } else {
                    self.dbindexes[rows[i].index] = rows[i].cols;
                }
            }
            self.free(client);
            if (callback) callback(err);
        });
    });
}

// Convert JS array into db PostgreSQL array format: {..}
db.pgsqlBindValue = function(val, info)
{
    function toArray(v) {
        return '{' + v.map(function(x) { return Array.isArray(x) ? toArray(x) : typeof x === 'undefined' || x === null ? 'NULL' : JSON.stringify(x); } ).join(',') + '}';
    }
    switch (info && info.data_type ? info.data_type : "") {
    case "json":
        val = JSON.stringify(val);
        break;

    case "array":
        if (Buffer.isBuffer(val)) {
            var a = [];
            for (var i = 0; i < v.length; i++) a.push(v[i]);
            val = a.join(',');
        } else
        if (Array.isArray(val)) {
            val = toArray(val);
        }
        if (val && val[0] != "{") val = "{" + v + "}";
        break;

    default:
        if (Buffer.isBuffer(val)) val = val.toJSON();
        if (Array.isArray(val)) val = String(val);
    }
    return val;
}

// Initialize local SQLite cache database by name, the db files are open in read only mode and are watched for changes,
// if new file got copied from the master, we reopen local database
db.sqliteInitPool = function(options)
{
    var self = this;
    if (!options) options = {};
    if (typeof options.temp_store == "undefined") options.temp_store = 0;
    if (typeof options.cache_size == "undefined") options.cache_size = 50000;
    if (typeof options.busy_timeout == "undefined") options.busy_timeout = -1;
    if (typeof options.read_uncommitted == "undefined") options.read_uncommitted = true;

    if (!options.pool) options.pool = "sqlite";
    options.type = "sqlite";
    options.file = path.join(options.path || core.path.spool, (options.db || name)  + ".db");
    options.dboptions = { noLengths: 1, noMultiSQL: 1 };
    var pool = this.sqlInitPool(options);
    pool.connect = self.sqliteConnect;
    pool.cacheColumns = self.sqliteCacheColumns;
    return pool;
}

// Common code to open or create local SQLite databases, execute all required initialization statements, calls callback
// with error as first argument and database object as second
db.sqliteConnect = function(options, callback)
{
    var self = this;
    new utils.SQLiteDatabase(options.file, options.readonly ? utils.OPEN_READONLY : 0, function(err) {
        if (err) {
            // Do not report errors about not existing databases
            if (err.code != "SQLITE_CANTOPEN" || !options.silent) logger.error('sqliteOpen', options.file, err);
            return callback(err);
        }
        var db = this;

        // Execute initial statements to setup the environment, like pragmas
        var opts = [];
        if (typeof options.cache_size != "undefined") opts.push("PRAGMA cache_size=-" + options.cache_size);
        if (typeof options.temp_store != "undefined") opts.push("PRAGMA temp_store=" + options.temp_store);
        if (typeof options.journal_mode != "undefined") opts.push("PRAGMA journal_mode=" + options.journal_mode);
        if (typeof options.locking_mode != "undefined") opts.push("PRAGMA locking_mode=" + options.locking_mode);
        if (typeof options.synchronous != "undefined") opts.push("PRAGMA synchronous=" + options.synchronous);
        if (typeof options.read_uncommitted != "undefined") opts.push("PRAGMA read_uncommitted=" + options.read_uncommitted);
        if (typeof options.busy_timeout != "undefined") opts.push("SELECT busy_timeout(" + options.busy_timeout + ")");
        if (Array.isArray(options.init)) opts = opts.concat(options.init);
        core.forEachSeries(opts, function(sql, next) {
            logger.debug('sqliteOpen:', options.file, sql);
            db.exec(sql, next);
    }, function(err2) {
            if (err) logger.error('sqliteOpen:', 'init', options.file, err);
            callback(err2, db);
        });
    });
}

db.sqliteCacheColumns = function(options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    self.get(function(err, client) {
        if (err) return callback ? callback(err, []) : null;
        client.query("SELECT name FROM sqlite_master WHERE type='table'", function(err, tables) {
            if (err) return callback ? callback(err2) : null;
            self.dbcolumns = {};
            self.dbkeys = {};
            self.dbindexes = {};
            core.forEachSeries(tables, function(table, next) {

                client.query("PRAGMA table_info(" + table.name + ")", function(err, rows) {
                    if (err) return next(err);
                    for (var i = 0; i < rows.length; i++) {
                        if (!self.dbcolumns[table.name]) self.dbcolumns[table.name] = {};
                        if (!self.dbkeys[table.name]) self.dbkeys[table.name] = [];
                        // Split type cast and ignore some functions in default value expressions
                        var dflt = rows[i].dflt_value;
                        if (dflt && dflt[0] == "'" && dflt[dflt.length-1] == "'") dflt = dflt.substr(1, dflt.length-2);
                        self.dbcolumns[table.name][rows[i].name] = { id: rows[i].cid, name: rows[i].name, value: dflt, db_type: rows[i].type.toLowerCase(), data_type: rows[i].type, isnull: !rows[i].notnull, primary: rows[i].pk };
                        if (rows[i].pk) self.dbkeys[table.name].push(rows[i].name);
                    }
                    client.query("PRAGMA index_list(" + table.name + ")", function(err4, indexes) {
                        core.forEachSeries(indexes, function(idx, next2) {
                            client.query("PRAGMA index_info(" + idx.name + ")", function(err5, cols) {
                                cols.forEach(function(x) {
                                    if (!self.dbcolumns[table.name]) self.dbcolumns[table.name] = {};
                                    if (!self.dbcolumns[table.name][x.name]) self.dbcolumns[table.name][x.name] = {};
                                    var col = self.dbcolumns[table.name][x.name];
                                    if (idx.unique) col.unique = 1;
                                    if (!self.dbindexes[idx.name]) self.dbindexes[idx.name] = [];
                                    self.dbindexes[idx.name].push(x.name);
                                });
                                next2();
                            });
                    }, function() {
                            next();
                        });
                    });
                });
        }, function(err) {
                self.free(client);
                if (callback) callback(err);
            });
        });
    });
}

// Setup MySQL database driver
db.mysqlInitPool = function(options)
{
    if (!utils.MysqlDatabase) {
        logger.error("MySQL driver is not compiled in, consider to install libmysqlclient library");
        return this.nopool;
    }

    var self = this;
    if (!options) options = {};
    if (!options.pool) options.pool = "mysql";
    options.type = "mysql";
    options.dboptions = { typesMap: { json: "text", bigint: "bigint" }, sqlPlaceholder: "?", defaultType: "VARCHAR(128)", noIfExists: 1, noJson: 1, noMultiSQL: 1 };
    var pool = this.sqlInitPool(options);
    pool.connect = function(options, callback) {
        new utils.MysqlDatabase(options.db, function(err) {
            callback(err, this);
        });
    }
    pool.cacheIndexes = self.mysqlCacheIndexes;
    return pool;
}

db.mysqlCacheIndexes = function(options, callback)
{
    var self = this;
    self.get(function(err, client) {
        if (err) return callback ? callback(err, []) : null;

        self.dbkeys = {};
        self.dbindexes = {};
        client.query("SHOW TABLES", function(err, tables) {
            core.forEachSeries(tables, function(table, next) {
                table = table[Object.keys(table)[0]].toLowerCase();
                client.query("SHOW INDEX FROM " + table, function(err, rows) {
                    for (var i = 0; i < rows.length; i++) {
                        if (!self.dbcolumns[table]) continue;
                        var col = self.dbcolumns[table][rows[i].Column_name];
                        switch (rows[i].Key_name) {
                        case "PRIMARY":
                            if (!self.dbkeys[table]) self.dbkeys[table] = [];
                            self.dbkeys[table].push(rows[i].Column_name);
                            if (col) col.primary = true;
                            break;

                        default:
                            if (!self.dbindexes[rows[i].Key_name]) self.dbindexes[rows[i].Key_name] = [];
                            self.dbindexes[rows[i].Key_name].push(rows[i].Column_name);
                            break;
                        }
                    }
                    next();
                });
            }, function(err) {
                self.free(client);
                if (callback) callback(err);
            });
        });
    });
}

// Setup DynamoDB database driver
db.dynamodbInitPool = function(options)
{
    var self = this;
    if (!options) options = {};
    if (!options.pool) options.pool = "dynamodb";

    options.type = "dynamodb";
    options.max = options.max || 500;
    options.dboptions = { noUpgrade: 1, noJson: 1, strictTypes: 1, skipNull: { add: 1, put: 1 } };
    var pool = this.createPool(options);

    pool.cacheColumns = function(opts, callback) {
        var pool = this;
        var options = { db: pool.db };

        aws.ddbListTables(options, function(err, rc) {
            if (err) return callback ? callback(err) : null;
            pool.dbkeys = {};
            pool.dbcolumns = {};
            pool.dbindexes = {};
            core.forEachLimit(rc.TableNames, 3, function(table, next) {
                aws.ddbDescribeTable(table, options, function(err, rc) {
                    if (err) return next(err);
                    rc.Table.AttributeDefinitions.forEach(function(x) {
                        if (!pool.dbcolumns[table]) pool.dbcolumns[table] = {};
                        var db_type = x.AttributeType == "N" ? "number" : x.AttributeType.length == 2 ? "array" : "text";
                        pool.dbcolumns[table][x.AttributeName] = { db_type: db_type, data_type: x.AttributeType };
                    });
                    rc.Table.KeySchema.forEach(function(x) {
                        if (!pool.dbkeys[table]) pool.dbkeys[table] = [];
                        pool.dbkeys[table].push(x.AttributeName);
                        pool.dbcolumns[table][x.AttributeName].primary = 1;
                        pool.dbcolumns[table][x.AttributeName].readCapacity =  rc.Table.ProvisionedThroughput.ReadCapacityUnits || 0;
                        pool.dbcolumns[table][x.AttributeName].writeCapacity = rc.Table.ProvisionedThroughput.WriteCapacityUnits || 0;
                    });
                    (rc.Table.LocalSecondaryIndexes || []).forEach(function(x) {
                        x.KeySchema.forEach(function(y) {
                            core.objSet(pool.dbindexes, [table, x.IndexName], y.AttributeName, { push: 1 });
                            pool.dbcolumns[table][y.AttributeName].index = 1;
                        });
                    });
                    (rc.Table.GlobalSecondaryIndexes || []).forEach(function(x) {
                        x.KeySchema.forEach(function(y) {
                            core.objSet(pool.dbindexes, [table, x.IndexName], y.AttributeName, { push: 1 });
                            pool.dbcolumns[table][y.AttributeName].index = 1;
                            pool.dbcolumns[table][y.AttributeName].global = 1;
                        });
                    });
                    next();
                });
            }, callback);
        });
    }

    // Convert into human readable messages
    pool.convertError = function(table, op, err, opts) {
        switch (op) {
        case "add":
        case "put":
            if (err.code == "ConditionalCheckFailedException") return core.newError({ message: "Record already exists", code: "ExpectedCondition", status: 409 });
            break;
        case "incr":
        case "update":
            if (err.code == "ConditionalCheckFailedException") return core.newError({ message: "Record not found", code: "ExpectedCondition", status: 406 });
            break;
        }
        return err;
    }

    // Simulate query as in SQL driver but performing AWS call, text will be a table name and values will be request options
    pool.query = function(client, req, opts, callback) {
        var pool = this;
        var table = req.text;
        var obj = req.obj;
        var dbcols = pool.dbcolumns[table] || {};
        var dbkeys = pool.dbkeys[table] || [];
        opts.db = pool.db;

        switch(req.op) {
        case "create":
            var local = {}, global = {}, attrs = {}, projection = {};
            var keys = Object.keys(obj).filter(function(x, i) { return obj[x].primary }).
                              sort(function(a,b) { return obj[a].primary - obj[b].primary }).
                              filter(function(x, i) { return i < 2 }).
                              map(function(x, i) { return [ x, i ? 'RANGE' : 'HASH' ] }).
                              reduce(function(x,y) { attrs[y[0]] = 1; x[y[0]] = y[1]; return x }, {});
            var hash = Object.keys(keys)[0];

            ["","1","2","3","4","5"].forEach(function(n) {
                var idx = Object.keys(obj).filter(function(x, i) { return obj[x]["index" + n]; }).sort(function(a,b) { return obj[a]["index" + n] - obj[b]["index" + n] });
                if (!idx.length) return;
                var name = idx.join("_");
                // Index starts with the same hash, local
                if (idx.length == 2 && idx[0] == hash) {
                    local[name] = core.newObj(idx[0], 'HASH', idx[1], 'RANGE');
                } else
                // Global if does not start with the primary hash
                if (idx.length == 2) {
                    global[name] = core.newObj(idx[0], 'HASH', idx[1], 'RANGE');
                } else {
                    global[name] = core.newObj(idx[0], 'HASH');
                }
                idx.forEach(function(y) { attrs[y] = 1 });
                var p = Object.keys(obj).filter(function(x, i) { return obj[x]["projection" + n]; });
                if (p.length) projection[name] = p;
            });

            // All native properties for options from the key columns
            Object.keys(attrs).forEach(function(x) {
                attrs[x] = ["int","bigint","double","real","counter"].indexOf(obj[x].type || "text") > -1 ? "N" : "S";
                for (var p in obj[x].dynamodb) opts[p] = obj[x].dynamodb[p];
            });

            opts.local = local;
            opts.global = global;
            opts.projection = projection;
            // Wait long enough for the table to be active, currently used by DynamoDB only
            if (typeof opts.waitTimeout == "undefined") opts.waitTimeout = 60000;
            aws.ddbCreateTable(table, attrs, keys, opts, function(err, item) {
                callback(err, [], item);
            });
            break;

        case "upgrade":
            callback(null, []);
            break;

        case "drop":
            aws.ddbDeleteTable(table, opts, function(err) {
                callback(err, []);
            });
            break;

        case "get":
            var keys = self.getSearchQuery(table, obj);
            opts.select = self.getSelectedColumns(table, opts);
            aws.ddbGetItem(table, keys, opts, function(err, item) {
                callback(err, item.Item ? [item.Item] : [], item);
            });
            break;

        case "select":
        case "search":
            // Save the original values of the options
            var old = pool.saveOptions(opts, 'sort', 'keys', 'select', 'start', 'count');
            // Sorting by the default range key is default
            if (opts.sort && opts.sort == dbkeys[1]) opts.sort = null;
            // Use primary keys from the secondary index
            if (opts.sort) {
                // Use index by name, mostly global indexes
                if (pool.dbindexes[table] && pool.dbindexes[table][opts.sort]) {
                    dbkeys = pool.dbindexes[table][opts.sort];
                } else {
                    // Local sorting order by range key
                    for (var p in pool.dbindexes[table]) {
                        var idx = pool.dbindexes[table][p];
                        if (idx && idx.length == 2 && idx[1] == opts.sort) {
                            opts.sort = p;
                            dbkeys = pool.dbindexes[table][p];
                            break;
                        }
                    }
                }
            }
            var keys = Object.keys(obj);
            // If we have other key columns we have to use custom filter
            var other = keys.filter(function(x) { return x[0] != "_" && dbkeys.indexOf(x) == -1 && typeof obj[x] != "undefined" });
            // Query based on the keys
            keys = self.getSearchQuery(table, obj, { keys: keys });
            // Operation depends on the primary keys in the query, for Scan we can let the DB to do all the filtering
            var op = typeof keys[dbkeys[0]] != "undefined" ? 'ddbQueryTable' : 'ddbScanTable';
            logger.debug('select:', 'dynamodb', op, keys, dbkeys, opts.sort, opts.count, opts.noscan);

            // Scans explicitely disabled
            if (op == 'ddbScanTable' && opts.noscan) return callback(null, []);

            opts.keys = dbkeys;
            // IN is not supported for key condition, move it in the query
            for (var p in opts.ops) {
                if (opts.ops[p] == "in" && p == dbkeys[1]) opts.keys = [ dbkeys[0] ];
                if (opts.ops[p] == "in" && p == dbkeys[0]) op = 'ddbScanTable';
            }
            opts.select = self.getSelectedColumns(table, opts);
            var rows = [];
            // Keep retrieving items until we reach the end or our limit
            core.doWhilst(
               function(next) {
                   aws[op](table, keys, opts, function(err, item) {
                       if (opts.total) item.Items.push({ count: item.Count });
                       rows.push.apply(rows, item.Items);
                       client.next_token = item.LastEvaluatedKey ? aws.fromDynamoDB(item.LastEvaluatedKey) : null;
                       opts.count -= item.Items.length;
                       next(err);
                   });
               },
               function() {
                   if (client.next_token == null || opts.count <= 0) return false;
                   opts.start = client.next_token;
                   return true;
               },
               function(err) {
                   pool.restoreOptions(opts, old);
                   callback(err, rows);
               });
            break;

        case "list":
            var req = {};
            var rows = [];
            // Keep retrieving items until we reach the end or our limit
            core.doWhilst(
               function(next) {
                   var list = obj.slice(0, 100);
                   obj = obj.slice(100);
                   if (!list.length) return next();
                   req[table] = { keys: list, select: self.getSelectedColumns(table, opts), consistent: opts.consistent };
                   aws.ddbBatchGetItem(req, opts, function(err, item) {
                       if (err) return callback(err, []);
                       // Keep retrieving items until we get all items from this batch
                       var moreKeys = item.UnprocessedKeys || null;
                       rows.push.apply(rows, item.Responses[table] || []);
                       core.whilst(
                           function() {
                               return moreKeys && Object.keys(moreKeys).length;
                           },
                           function(next2) {
                               opts.RequestItems = moreKeys;
                               aws.ddbBatchGetItem({}, opts, function(err, item) {
                                   moreKeys = item.UnprocessedKeys || null;
                                   rows.push.apply(rows, item.Responses[table] || []);
                                   next2(err);
                               });
                       }, function(err) {
                           next(err);
                       });
                   });
               },
               function() {
                   return obj.length > 0;
               },
               function(err) {
                   callback(err, rows);
               });
            break;

        case "add":
            opts.expected = (pool.dbkeys[table] || []).map(function(x) { return x }).reduce(function(x,y) { x[y] = null; return x }, {});
            aws.ddbPutItem(table, obj, opts, function(err, rc) {
                callback(err, rc && rc.Item ? [rc.Item] : [], rc);
            });
            break;

        case "put":
            aws.ddbPutItem(table, obj, opts, function(err, rc) {
                callback(err, rc && rc.Item ? [rc.Item] : [], rc);
            });
            break;

        case "update":
            var keys = self.getSearchQuery(table, obj);
            if (!options.expected && !options.Expected && !options.expr && !options.ConditionExpression) opts.expected = keys;
            if (opts.counter) opts.counter.forEach(function(x) { opts.ops[x] = 'ADD'; });
            aws.ddbUpdateItem(table, keys, obj, opts, function(err, rc) {
                callback(err, rc && rc.Item ? [rc.Item] : [], rc);
            });
            break;

        case "incr":
            var keys = self.getSearchQuery(table, obj);
            // Increment counters, only specified columns will use ADD operation, they must be numbers
            if (opts.counter) opts.counter.forEach(function(x) { opts.ops[x] = 'ADD'; });
            aws.ddbUpdateItem(table, keys, obj, opts, function(err, rc) {
                callback(err, rc && rc.Item ? [rc.Item] : [], rc);
            });
            break;

        case "del":
            var keys = self.getSearchQuery(table, obj);
            aws.ddbDeleteItem(table, keys, opts, function(err, rc) {
                callback(err, rc && rc.Item ? [rc.Item] : [], rc);
            });
            break;

        default:
            callback(new Error("invalid op"), []);
        }
    };
    return pool;
}

// MongoDB pool
db.mongodbInitPool = function(options)
{
    var self = this;
    if (!options) options = {};
    if (!options.pool) options.pool = "mongodb";

    options.type = "mongodb";
    options.pooling = true;
    options.dboptions = { jsonColumns: true, skipNull: { add: 1, put: 1 } };
    var pool = this.createPool(options);

    pool.connect = function(opts, callback) {
        mongodb.MongoClient.connect(opts.db, opts.dbinit, function(err, db) {
            if (err) logger.error('mongodbOpen:', err);
            if (callback) callback(err, db);
        });
    }
    pool.close = function(client, callback) {
        client.close(callback);
    }
    pool.cacheColumns = function(opts, callback) {
        var pool = this;
        pool.get(function(err, client) {
            if (err) return callback(err);
            pool.dbcolumns = {};
            pool.dbindexes = {};
            pool.dbkeys = {};
            client.collectionNames(function(err, items) {
                (items || []).forEach(function(x) {
                    x = x.name.split(".");
                    if (x.length != 2) return;
                    if (!pool.dbcolumns[x[1]]) pool.dbcolumns[x[1]] = {};
                    pool.dbcolumns[x[1]]['_id'] = { primary: 1 };
                });
                client.indexInformation(null, {full:true}, function(err, items) {
                    (items || []).forEach(function(x) {
                        var n = x.ns.split(".").pop();
                        if (x.key._id) return;
                        if (x.unique) {
                            if (!pool.dbkeys[n]) pool.dbkeys[n] = [];
                            pool.dbkeys[n] = Object.keys(x.key);
                        } else {
                            if (!pool.dbindexes[n]) pool.dbindexes[n] = [];
                            pool.dbindexes[n] = Object.keys(x.key);
                        }
                    });
                    pool.free(client);
                    callback(err);
                });
            });
        });
    }
    pool.query = function(client, req, opts, callback) {
        var pool = this;
        var table = req.text;
        var obj = req.obj;
        var dbcols = pool.dbcolumns[table] || {};
        var dbkeys = pool.dbkeys[table] || [];
        // Default write concern
        if (!opts.w) opts.w = 1;
        opts.safe = true;

        switch(req.op) {
        case "create":
        case "upgrade":
            var keys = [];
            var cols = core.searchObj(obj, { name: 'primary', sort: 1, flag: 1 });
            var kopts = core.mergeObj(opts, { unique: true, background: true });
            // Merge with mongo properties from the column, primary key properties also applied for the collection as well
            Object.keys(cols).forEach(function(x) { for (var p in obj[x].mongodb) opts[p] = obj[x].mongodb[p]; });
            keys.push({ cols: cols, opts: kopts });

            ["", "1", "2", "3", "4", "5"].forEach(function(n) {
                var cols = core.searchObj(obj, { name: "unique" + n, sort: 1, flag: 1 });
                var uopts = core.mergeObj(opts, { name: Object.keys(cols).join('_'), unique: true, background: true });
                Object.keys(cols).forEach(function(x) { for (var p in obj[x].mongodb) uopts[p] = obj[x].mongodb[p]; });

                if (Object.keys(cols).length) keys.push({ cols: cols, opts: uopts });
                cols = core.searchObj(obj, { name: "index" + n, sort: 1, flag: 1 });
                var iopts = core.mergeObj(opts, { name: Object.keys(cols).join('_'), background: true });
                Object.keys(cols).forEach(function(x) { for (var p in obj[x].mongodb) iopts[p] = obj[x].mongodb[p]; });
                if (Object.keys(cols).length) keys.push({ cols: cols, opts: iopts });
            });

            client.createCollection(table, opts, function(err, item) {
                if (err) return callback(err, []);

                core.forEachSeries(keys, function(idx, next) {
                    client.ensureIndex(table, idx.cols, idx.opts, function(err) {
                        if (err) logger.error('db.create:', idx, err);
                        next();
                    });
                }, function(err) {
                    callback(err, []);
                });
            });
            break;

        case "drop":
            client.dropCollection(table, function(err) {
                callback(err, []);
            });
            break;

        case "get":
            var collection = client.collection(table);
            var fields = self.getSelectedColumns(table, opts);
            opts.fields = (fields || Object.keys(dbcols)).reduce(function(x,y) { x[y] = 1; return x }, {});
            var keys = self.getSearchQuery(table, obj, opts);
            collection.findOne(keys, opts, function(err, item) {
                callback(err, item ? [item] : []);
            });
            break;

        case "select":
        case "search":
            var old = pool.saveOptions(opts, 'sort', 'skip', 'limit');
            var collection = client.collection(table);
            var fields = self.getSelectedColumns(table, opts);
            opts.fields = (fields || Object.keys(dbcols)).reduce(function(x,y) { x[y] = 1; return x }, {});
            if (opts.start) opts.skip = opts.start;
            if (opts.count) opts.limit = opts.count;
            if (typeof opts.sort == "string") opts.sort = [[opts.sort,opts.desc ? -1 : 1]];
            var o = {};
            for (var p in obj) {
                if (p[0] == '_') continue;
                switch (opts.ops[p]) {
                case "regexp":
                    o[p] = { '$regex': obj[p] };
                    break;

                case "between":
                    var val = core.strSplit(obj[p]);
                    if (val.length == 2) {
                        o[p] = { '$gte': val[0], '$lte': val[1] };
                    } else {
                        o[p] = obj[p];
                    }
                    break;

                case "like%":
                case "begins_with":
                    o[p] = { '$regex': "^" + obj[p] };
                    break;

                case "in":
                    o[p] = { '$in': core.strSplit(obj[p]) };
                    break;

                case ">":
                case "gt":
                    o[p] = { '$gt': obj[p] };
                    break;

                case "<":
                case "lt":
                    o[p] = { '$lt': obj[p] };
                    break;

                case ">=":
                case "ge":
                    o[p] = { '$gte': obj[p] };
                    break;

                case "<=":
                case "le":
                    o[p] = { '$lte': obj[p] };
                    break;

                case "ne":
                case "!=":
                case "<>":
                    o[p] = { '$ne': obj[p] };
                    break;

                case "eq":
                    o[p] = obj[p];
                    break;

                default:
                    if (typeof obj[p] == "string" && !obj[p]) break;
                    o[p] = obj[p];
                }
            }
            logger.debug('select:', pool.name, o, keys);
            collection.find(o, opts).toArray(function(err, rows) {
                pool.restoreOptions(opts, old);
                callback(err, rows);
            });
            break;

        case "list":
            var collection = client.collection(table);
            var fields = self.getSelectedColumns(table, opts);
            opts.fields = (fields || Object.keys(dbcols)).reduce(function(x,y) { x[y] = 1; return x }, {});
            var name = Object.keys(obj[0])[0];
            var o = {};
            o[name] = {};
            o[name]['$in'] = obj.map(function(x) { return x[name] } );
            collection.find(o, opts).toArray(function(err, rows) {
                callback(err, rows);
            });
            break;

        case "add":
            var collection = client.collection(table);
            collection.insert(obj, opts, function(err, rc) {
                callback(err, []);
            });
            break;

        case "put":
            opts.upsert = true;

        case "incr":
        case "update":
            var collection = client.collection(table);
            var keys = self.getSearchQuery(table, obj, opts);
            var o = obj, i = {}, q = {};
            (opts.counter || []).forEach(function(x) {
                if (keys[x]) return;
                i[x] = core.toNumber(obj[x]);
                delete o[x];
            });
            if (Object.keys(o).length) q["$set"] = o;
            if (Object.keys(i).length) q["$inc"] = i;
            collection.update(keys, q, opts, function(err, rc) {
                callback(err, []);
            });
            break;

        case "del":
            var collection = client.collection(table);
            var keys = self.getSearchQuery(table, obj, opts);
            collection.remove(keys, opts, function(err, rc) {
                callback(err, []);
            });
            break;

        default:
            callback(new Error("invalid op"), []);
        }
    };
    pool.nextToken = function(client, req, rows, opts) {
        return opts.count && rows.length == opts.count ? core.toNumber(opts.start) + core.toNumber(opts.count) : null;
    }
    return pool;
}

// Cassandra pool
db.cassandraInitPool = function(options)
{
    var self = this;
    if (!options) options = {};
    if (!options.pool) options.pool = "cassandra";
    options.type = "cassandra";
    options.pooling = true;
    options.dboptions = { typesMap: { json: "text", real: "double", counter: "counter", bigint: "bigint" },
                          opsMap: { begins_with: "begins_with" },
                          sqlPlaceholder: "?",
                          noCoalesce: 1,
                          noConcat: 1,
                          noDefaults: 1,
                          noAuto: 1,
                          noNulls: 1,
                          noLengths: 1,
                          noReplace: 1,
                          noBetween: 1,
                          noJson: 1,
                          noCustomKey: 1,
                          noCompositeIndex: 1,
                          noMultiSQL: 1 };
    var pool = this.sqlInitPool(options);
    pool.cacheColumns = self.cassandraCacheColumns;
    pool.connect = function(options, callback) {
        var self = this;
        var hosts = core.strSplit(options.db).map(function(x) { return url.parse(x); });
        var db = new helenus.ConnectionPool({ hosts: hosts.map(function(x) { return x.host }),
                                              keyspace: hosts[0].path.substr(1),
                                              user: hosts[0].auth ? hosts[0].auth.split(':')[0] : null,
                                              password: hosts[0].auth ? hosts[0].auth.split(':')[1] : null });
        db.query = this.cassandraQuery;
        db.on('error', function(err) { logger.error('cassandra:', err); });
        db.connect(function(err, keyspace) {
            if (err) logger.error('cassandraOpen:', err);
            if (callback) callback(err, db);
        });
    }
    // No REPLACE INTO support but UPDATE creates new record if no primary key exists
    pool.put = function(table, obj, opts, callback) {
        self.update(table, obj, opts, callback);
    };
    pool.nextToken = function(client, req, rows, opts) {
        if (opts.count > 0 && rows.length == opts.count) {
            var keys = this.dbkeys[req.table] || [];
            return keys.map(function(x) { return core.newObj(x, rows[rows.length-1][x]) });
        }
        return null;
    }
    pool.close = function(client, callback) {
        client.close(callback);
    }
    pool.prepare = function(op, table, obj, opts) {
        switch (op) {
        case "search":
        case "select":
            // Cannot search by non primary keys
            var keys = this.dbkeys[table.toLowerCase()] || [];
            var cols = this.dbcolumns[table.toLowerCase()] || {};
            // Save original properties, restore on exit to keep options unmodified for the caller
            var old = pool.saveOptions(opts, 'keys', 'sort');
            var lastKey = keys[keys.length - 1], lastOps = opts.ops[lastKey];

            // Install custom filter if we have other columns in the keys
            var other = Object.keys(obj).filter(function(x) { return x[0] != "_" && keys.indexOf(x) == -1 && typeof obj[x] != "undefined" });
            // Custom filter function for in-memory filtering of the results using non-indexed properties
            if (other.length) opts.rowfilter = function(rows) { return self.filterColumns(obj, rows, { keys: other, cols: cols, ops: opts.ops, typesMap: options.typesMap }); }
            opts.keys = keys;

            // Sorting is limited to the second part of the composite key so we will do it in memory
            if (opts.sort && (keys.length < 2 || keys[1] != opts.sort)) {
                var sort = opts.sort;
                opts.rowsort = function(rows) { return rows.sort(function(a,b) { return (a[sort] - b[sort])*(opts.desc?-1:1) }) }
                opts.sort = null;
            }

            // Pagination, start must be a token returned by the previous query
            if (Array.isArray(opts.start) && typeof opts.start[0] == "object") {
                obj = core.cloneObj(obj);
                opts.ops[lastKey] = opts.desc ? "lt" : "gt";
                opts.start.forEach(function(x) { for (var p in x) obj[p] = x[p]; });
            }
            logger.debug('select:', pool.name, opts.keys, opts.sort, other);

            var req = self.sqlPrepare(op, table, obj, opts);
            pool.restoreOptions(opts, old);
            if (lastOps) opts.ops[lastKey] = lastOps;
            return req;
        }
        return self.sqlPrepare(op, table, obj, opts);
    }
    return pool;
}

db.cassandraQuery = function(text, values, options, callback)
{
    var self = this;
    if (typeof values == "function") callback = values, values = null, options = null;
    if (typeof options == "function") callback = options, options = null;
    try {
        this.cql(text, core.cloneObj(values), function(err, results) {
            if (err || !results) return callback ? callback(err, []) : null;
            var rows = [];
            results.forEach(function(row) {
                var obj = {};
                row.forEach(function(name, value, ts, ttl) {
                    obj[name] = value;
                    if (ts) obj["_timestamp"] = ts;
                    if (ttl) obj["_ttl"] = ttl;
                    if (name == ['[applied]']) self.affected_rows = value ? 1 : 0;
                });
                rows.push(obj);
            });
            if (options && options.rowfilter) {
                rows = options.rowfilter(rows);
                delete options.rowfilter;
            }
            if (options && options.rowsort) {
                rows = options.rowsort(rows);
                delete options.rowsort;
            }
            if (callback) callback(err, rows);
        });
    } catch(e) {
        if (callback) callback(e, []);
    }
}

db.cassandraCacheColumns = function(options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    self.get(function(err, client) {
        if (err) return callback ? callback(err, []) : null;

        client.query("SELECT * FROM system.schema_columns WHERE keyspace_name = ?", [client.keyspace], function(err, rows) {
            rows.sort(function(a,b) { return a.component_index - b.component_index });
            self.dbcolumns = {};
            self.dbindexes = {};
            self.dbkeys = {};
            for (var i = 0; i < rows.length; i++) {
                if (!self.dbcolumns[rows[i].columnfamily_name]) self.dbcolumns[rows[i].columnfamily_name] = {};
                var data_type = rows[i].validator.replace(/[\(\)]/g,".").split(".").pop().replace("Type", "").toLowerCase();
                var db_type = "";
                switch (data_type) {
                case "decimal":
                case "float":
                case "int32":
                case "long":
                case "double":
                case "countercolumn":
                    db_type = "number";
                    break;

                case "boolean":
                    db_type = "bool";
                    break;

                case "date":
                case "timestamp":
                    db_type = "date";
                    break;
                }
                // Set data type to collection type, use type for items
                var d = rows[i].validator.match(/(ListType|SetType|MapType)/);
                if (d) data_type = d[1].replace("Type", "").toLowerCase() + ":" + data_type;
                var col = { id: i, db_type: db_type, data_type: data_type };
                switch(rows[i].type) {
                case "regular":
                    if (!rows[i].index_name) break;
                    if (!self.dbindexes[rows[i].index_name]) self.dbindexes[rows[i].index_name] = [];
                    self.dbindexes[rows[i].index_name].push(rows[i].column_name);
                    break;
                case "partition_key":
                    if (!self.dbkeys[rows[i].columnfamily_name]) self.dbkeys[rows[i].columnfamily_name] = [];
                    self.dbkeys[rows[i].columnfamily_name].unshift(rows[i].column_name);
                    if (col) col.primary = true;
                    break;
                case "clustering_key":
                    if (!self.dbkeys[rows[i].columnfamily_name]) self.dbkeys[rows[i].columnfamily_name] = [];
                    self.dbkeys[rows[i].columnfamily_name].push(rows[i].column_name);
                    if (col) col.primary = true;
                    break;
                }
                self.dbcolumns[rows[i].columnfamily_name][rows[i].column_name] = col;
            }
            self.free(client);
            if (callback) callback(err);
        });
    });
}

// Setup LMDB/LevelDB database driver, this is simplified driver which supports only basic key-value operations,
// table parameter is ignored, the object only supports the properties name and value in the record objects.
//
// Because this driver supports 2 databases it requires type to be specified, possible values are: `lmdb, leveldb`
//
// Options are passed to the LMDB low level driver as MDB_ flags according to http://symas.com/mdb/doc/ and
// as properties for LevelDB as described in http://leveldb.googlecode.com/svn/trunk/doc/index.html
//
// The LevelDB database can only be shared by one process so if no unique options.db is given, it will create a unique database using core.processId()
db.leveldbInitPool = function(options)
{
    var self = this;
    if (!options) options = {};
    if (!options.pool) options.pool = "leveldb";
    options.type = "leveldb";
    return this.lmdbInitPool(options);
}

db.lmdbInitPool = function(options)
{
    var self = this;
    if (!options) options = {};
    if (!options.pool) options.pool = "lmdb";
    if (!options.type) options.type = "lmdb"
    if (!options.concurrency) options.concurrency = 3;
    options.dboptions = { noJson: 1 };
    var pool = this.createPool(options);

    pool.nextToken = function(client, req, rows, opts) {
        if (opts.count > 0 && rows.length == opts.count) {
            var key = this.getKey(req.table, rows[rows.length - 1], { ops: {} }, 1);
            return key.substr(0, key.length - 1) + String.fromCharCode(key.charCodeAt(key.length - 1) + 1);
        }
        return null;
    }

    pool.getLevelDB = function(callback) {
        if (this.dbhandle) return callback(null, this.dbhandle);
        try {
            if (!core.exists(this.create_if_missing)) options.create_if_missing = true;
            var path = core.path.spool + "/" + (options.db || ('ldb_' + core.processName()));
            new utils.LevelDB(path, options, function(err) {
                pool.dbhandle = this;
                callback(null, this);
            });
        } catch(e) {
            callback(e);
        }
    }
    pool.getLMDB = function(callback) {
        if (this.dbhandle) return callback(null, this.dbhandle);
        try {
            if (!options.path) options.path = core.path.spool;
            if (!options.flags) options.flags = utils.MDB_CREATE;
            if (!options.dbs) options.dbs = 1;
            // Share same environment between multiple pools, each pool works with one db only to keep the API simple
            if (options.env && options.env instanceof utils.LMDBEnv) this.env = options.env;
            if (!this.env) this.env = new utils.LMDBEnv(options);
            new utils.LMDB(this.env, { name: options.db, flags: options.flags }, function(err) {
                pool.dbhandle = this;
                callback(err, this);
            });
        } catch(e) {
            callback(e);
        }
    }
    pool.get = function(callback) {
        switch (this.type) {
        case "lmdb": return this.getLMDB(callback);
        case "leveldb": return this.getLevelDB(callback);
        default: return callback();
        }
    }
    pool.getKeys = function(table, obj, opts, search) {
        var keys = self.getQueryForKeys(this.dbkeys[table] || [], obj);
        if (!search) return keys;
        for (var p in keys) {
            if (!opts.ops[p]) continue;
            switch (opts.ops[p]) {
            case "eq":
            case "begins_with":
            case "like%":
                break;

            default:
                delete keys[p];
            }
        }
        return keys;
    }
    pool.getKey = function(table, obj, opts, search) {
        var keys = this.getKeys(table, obj, opts, search);
        for (var p in keys) table += "|" + keys[p];
        return table;
    }
    pool.query = function(client, req, opts, callback) {
        var pool = this;
        var obj = req.obj;
        var table = req.table || "";
        var keys = this.dbkeys[table] || [];
        var cols = this.dbcolumns[table] || {};

        switch(req.op) {
        case "create":
        case "upgrade":
            callback(null, []);
            break;

        case "drop":
            client.select(table, table, opts, function(err, rows) {
                if (err || !rows.length) return callback(err, []);
                core.forEachLimit(rows, opts.concurrency || pool.concurrency, function(row, next) {
                    client.del(row.name, next);
                }, function(err) {
                    callback(err, []);
                });
            });
            break;

        case "get":
            var key = pool.getKey(table, obj, opts);
            var selected = self.getSelectedColumns(table, opts);
            client.get(key, function(err, row) {
                if (err || !row) return callback(err, []);
                row = core.jsonParse(row);
                if (selected) row = selected.map(function(x) { return [x, row[x] ]}).reduce(function(x,y) { x[y[0]] = y[1]; return x }, {});
                callback(err, [row]);
            });
            break;

        case "select":
        case "search":
            var dbkeys = pool.getKeys(table, obj, opts, 1);
            var key = pool.getKey(table, obj, opts, 1);
            var selected = self.getSelectedColumns(table, opts);
            // Custom filter on other columns
            var other = Object.keys(obj).filter(function(x) { return x[0] != "_" && (keys.indexOf(x) == -1 || !dbkeys[x]) && typeof obj[x] != "undefined" });
            client.select(opts.start || key, key, { begins_with: 1, count: opts.count }, function(err, items) {
                if (err) return callback(err, []);
                var rows = [];
                items.forEach(function(row) {
                    row = core.jsonParse(row.value);
                    if (!row) return;
                    if (selected) row = selected.map(function(x) { return [x, row[x] ]}).reduce(function(x,y) { x[y[0]] = y[1]; return x }, {});
                    rows.push(row);
                });
                if (other.length > 0) {
                    rows = self.filterColumns(obj, rows, { keys: other, cols: cols, ops: opts.ops, typesMap: opts.typesMap });
                }
                if (rows.length && opts.sort) rows.sort(function(a,b) { return (a[opts.sort] - b[opts.sort]) * (opts.desc ? -1 : 1) });
                callback(null, rows);
            });
            break;

        case "list":
            var rc = [];
            var selected = self.getSelectedColumns(table, opts);
            core.forEachSeries(obj, function(o, next) {
                var key = pool.getKey(table, o, opts);
                client.get(key, opts, function(err, row) {
                    if (row) {
                        row = core.jsonParse(row);
                        if (selected) row = selected.map(function(x) { return [x, row[x] ]}).reduce(function(x,y) { x[y[0]] = y[1]; return x }, {});
                        rc.push(row);
                    }
                    next(err);
                });
            }, function(err) {
                callback(err, rc);
            });
            break;

        case "add":
            var key = pool.getKey(table, obj, opts);
            client.get(key, opts, function(err, item) {
                if (err) return callback(err, []);
                if (item) return callback(new Error("already exists"), []);
                client.put(key, JSON.stringify(obj), opts, function(err) {
                    callback(err, []);
                });
            });
            break;

        case "update":
            var key = pool.getKey(table, obj, opts);
            client.get(key, opts, function(err, item) {
                if (err) return callback(err, []);
                if (!item) return callback(null, []);
                item = core.jsonParse(item);
                if (!item) item = obj; else for (var p in obj) item[p] = obj[p];
                client.put(key, JSON.stringify(item), opts, function(err) {
                    callback(err, []);
                });
            });
            break;

        case "put":
            var key = pool.getKey(table, obj, opts);
            client.put(key, JSON.stringify(obj), opts, function(err) {
                callback(err, []);
            });
            break;

        case "incr":
            var key = pool.getKey(table, obj, opts);
            var nums = (opts.counter || []).filter(function(x) { return keys.indexOf(x) == -1 });
            if (!nums.length) return callback();
            client.get(key, function(err, item) {
                if (err) return callback(err);
                item = core.jsonParse(item);
                if (!item) item = obj; else nums.forEach(function(x) { item[x] = core.toNumber(item[x]) + obj[x]; });
                client.put(key, JSON.stringify(item), function(err) {
                    callback(err, []);
                });
            });
            break;

        case "del":
            var key = pool.getKey(table, obj, opts);
            client.del(key, opts, function(err) {
                callback(err, []);
            });
            break;

        default:
            callback(new Error("invalid op"), []);
        }
    };
    return pool;
}

// Create a database pool that works with nanomsg server, all requests will be forwarded to the nanomsg socket,
// the server can be on the same machine or on the remote, 2 nanomsg socket types are supported: NN_PUSH or NN_REQ.
// In push mode no replies are expected, only sending db updates, in Req mode the server will reply on 'get' command only,
// all other commands work as in push mode. Only 'get,put,del,incr' comamnd are supported, add,update will be sent as put, LevelDB or LMDB
// on the other side only support simple key-value operations.
// Options can define the following:
// - socket - nanomsg socket type, default is utils.NN_PUSH, can be utils.NN_REQ
db.nndbInitPool = function(options)
{
    var self = this;
    if (!options) options = {};
    if (!options.pool) options.pool = "nndb";

    options.type = "nndb";
    var pool = this.createPool(options);

    pool.get = function(callback) {
        if (this.sock) return callback(null, this);

        try {
            if (typeof options.socket == "string") options.socket = backend[options.socket];
            this.sock = new utils.NNSocket(utils.AF_SP, options.socket || utils.NN_PUSH);
            this.sock.connect(options.db);
        } catch(e) {
            return callback(e, this);
        }
        // Request socket needs a callback handler, reply comes as JSON with id property
        if (this.sock.type == utils.NN_REQ) {
            this.socknum = 1;
            this.callbacks = {};
            this.sock.setCallback(function(err, msg) { core.runCallback(pool.callbacks, msg); });
        }
        return callback(null, this);
    }

    pool.query = function(client, req, opts, callback) {
        if (typeof req.obj == "string") req.obj = { name: req.obj, value: "" };
        var obj = { op: req.op, name: req.obj.name, value: req.obj.value || "" };

        switch (req.op) {
        case "get":
        case "select":
            if (this.sock.type != utils.NN_REQ) return callback(null, []);

            obj.id = this.socknum++;
            core.deferCallback(this.callbacks, obj, function(msg) { callback(null, msg.value) });
            this.sock.send(JSON.stringify(obj));
            return;

        case "add":
        case "update":
        case "put":
        case "del":
        case "incr":
            this.sock.send(JSON.stringify(obj));

        default:
            return callback(null, []);
        }
    }

    return pool;
}

// Redis database pool, uses Hash to store the records
db.redisInitPool = function(options)
{
    var self = this;
    if (!options) options = {};
    if (!options.pool) options.pool = "redis";
    if (!options.concurrency) options.concurrency = 2;

    options.type = "redis";
    options.dboptions = { noJson: 1 };
    var pool = this.createPool(options);

    pool.get = function(callback) {
        var err = null;
        if (!this.redis) {
            try {
                this.redis = redis.createClient(this.dbinit.port, this.db, this.dbinit);
                this.redis.on("error", function(err) { logger.error('redis:', err) });
            } catch(e) {
                err = e;
            }
        }
        callback(err, this.redis);
    }

    pool.close = function(cient, callback) {
        client.quit();
        if (callback) callback();
    }

    pool.getKeys = function(table, obj, opts, search) {
        var keys = self.getQueryForKeys(this.dbkeys[table] || [], obj);
        if (!search) return keys;
        for (var p in keys) {
            if (!opts.ops[p]) continue;
            switch (opts.ops[p]) {
            case "eq":
            case "begins_with":
            case "like%":
                break;

            default:
                delete keys[p];
            }
        }
        return keys;
    }

    pool.getKey = function(table, obj, opts, search) {
        var key = table;
        var keys = this.getKeys(table, obj, opts, search);
        for (var p in keys) key += "|" + keys[p];
        if (search) key += key == table ? "|*" : "*";
        return key;
    }

    pool.getItem = function(client, table, obj, opts, callback) {
        var key = this.getKey(table, obj, opts);
        var cols = self.getSelectedColumns(table, opts);
        if (cols) {
            client.hmget(key, cols, function(err, vals) {
                if (!vals) vals = [];
                vals = [ cols.map(function(x,i) { return [x, vals[i]] }).reduce(function(x, y) { x[y[0]] = y[1]; return x }, {}) ];
                callback(err, vals);
            })
        } else {
            client.hgetall(key, function(err, val) {
                if (val) val = [ val ]; else val = [];
                callback(err, val);
            });
        }
    }
    pool.getList = function(client, table, obj, opts, callback) {
        if (!obj.length) return callback(null, []);
        var keys = this.dbkeys[table || ""] || [];

        // If we have a list of strings, split into objects by primary key
        if (typeof obj[0] == "string") {
            obj = obj.map(function(x) {
                return x.split("|").slice(1).map(function(x,i) { return [x, keys[i]] }).reduce(function(x,y) { x[y[1]] = y[0]; return x }, {});
            });
        }
        // If only want primary keys then return as is
        if (opts.select && core.strSplit(opts.select).every(function(x) { return keys.indexOf(x)>-1 })) {
            return callback(null, obj);
        }
        var rows = [];
        core.forEachLimit(obj, opts.concurrency || this.concurrency, function(item, next) {
            pool.getItem(client, table, item, opts, function(err, val) {
                if (!err && val.length) rows.push(val[0]);
                next(err);
            });
        }, function(err) {
            callback(err, rows);
        });
    }

    pool.query = function(client, req, opts, callback) {
        var obj = req.obj;
        var table = req.table || "";
        var keys = this.dbkeys[table] || [];
        var cols = this.dbcolumns[table] || {};

        switch (req.op) {
        case "drop":
            client.keys(table + "|*", function(err, list) {
                if (err || !list.length) return callback(err, []);
                core.forEachLimit(list, opts.concurrency || pool.concurrency, function(key, next) {
                    client.del(key, next);
                }, function(err) {
                    callback(err, []);
                });
            });
            return;

        case "get":
            this.getItem(client, table, obj, opts, callback);
            return;

        case "select":
            var dbkeys = this.getKeys(table, obj, opts, 1);
            var args = [ opts.start || 0, "MATCH", this.getKey(table, obj, opts, 1)];
            if (opts.count) args.push("COUNT", opts.count);
            // Custom filter on other columns
            var other = Object.keys(obj).filter(function(x) { return x[0] != "_" && (keys.indexOf(x) == -1 || !dbkeys[x]) && typeof obj[x] != "undefined" });
            var filter = function(items) {
                if (other.length > 0) items = self.filterColumns(obj, items, { keys: other, cols: cols, ops: opts.ops, typesMap: opts.typesMap });
                return items;
            }
            var rows = [];
            var count = opts.count || 0;
            core.doWhilst(
                function(next) {
                    client.send_command("SCAN", args, function(err, reply) {
                        if (err) return next(err);
                        pool.getList(client, table, reply[1], opts, function(err, items) {
                            items = filter(items);
                            rows.push.apply(rows, items);
                            client.next_token = args[0] = core.toNumber(reply[0]);
                            count -= items.length;
                            if (opts.count) args[4] = count;
                            next(err);
                        });
                    });
                },
                function() {
                    return client.next_token || (opts.count && count > 0);
                },
                function(err) {
                    if (rows.length && opts.sort) rows.sort(function(a,b) { return (a[opts.sort] - b[opts.sort]) * (opts.desc ? -1 : 1) });
                    callback(err, rows);
            });
            return;

        case "list":
            this.getList(client, table, obj, opts, callback);
            return;

        case "add":
            var key = this.getKey(table, obj, opts);
            client.exists(key, function(err, yes) {
                if (yes) return callback(new Error("already exists"), []);
                client.hmset(key, obj, function(err) {
                    callback(err, []);
                });
            });
            return;

        case "put":
            var key = this.getKey(table, obj, opts);
            client.hmset(key, obj, function(err) {
                callback(err, []);
            });
            return;

        case "update":
            var key = this.getKey(table, obj, opts);
            client.exists(key, function(err, yes) {
                if (!yes) return callback(null, []);
                client.hmset(key, obj, function(err) {
                    callback(err, []);
                });
            });
            return;

        case "del":
            var key = this.getKey(table, obj, opts);
            client.del(key, function(err) {
               callback(err, []);
            });
            return;

        case "incr":
            var key = this.getKey(table, obj, opts);
            var nums = (opts.counter || []).filter(function(x) { return keys.indexOf(x) == -1 }).map(function(x) { return { name: x, value: obj[x] } });
            core.forEachLimit(nums, opts.concurrency || this.concurrency, function(num, next) {
                client.hincrby(key, num.name, num.value, next);
            }, function(err) {
                callback(err, []);
            });
            return;

        default:
            return callback(null, []);
        }
    }

    return pool;
}

// Create a database pool that works with ElasticSearch server
db.elasticsearchInitPool = function(options)
{
    var self = this;
    if (!options) options = {};
    if (!options.pool) options.pool = "elasticsearch";

    options.type = "elasticsearch";
    options.dboptions = { noJson: 1 };
    var u = url.parse(options.db);
    if (!u.port) u.host = u.hostname + ":" + 9200;
    options.db = url.format(u);
    var pool = this.createPool(options);

    // Native query parameters for each operation
    var _query = { index: ["op_type","version","routing","parent","timestamp","ttl","consistency","refresh","timeout","replication"],
                   del: ["version","routing","parent","consistency","refresh","timeout","replication"],
                   get: ["version","fields","routing","realtime","preference","refresh","_source","_source_include","_source_exclude"],
                   select: ["version","analyzer","analyze_wildcard","default_operator","df","explain","fields","from","ignore_unavailable",
                            "allow_no_indices","expand_wildcards","indices_boost","lenient","lowercase_expanded_terms","preference","q",
                            "routing","scroll","search_type","size","sort","_source","_source_include","_source_exclude","stats","local",
                            "terminate_after","suggest_field","suggest_mode","suggest_size","suggest_text","timeout","track_scores","query_cache"],
                   list: ["version","fields","routing","_source","_source_include","_source_exclude"] };

    function query(op, method, path, obj, opts, callback) {
        var uri = pool.db + "/" + path;
        var params = { method: method, postdata: obj, query: {} };
        if (_query[op]) _query[op].forEach(function(x) { if (opts[x]) params.query[x] = opts[x] });

        core.httpGet(uri, params, function(err, params) {
            if (err) {
                logger.error("elasticsearch:", method, path, err);
                return callback(err, {});
            }
            var err = null;
            obj = core.jsonParse(params.data, { obj: 1 });
            if (params.status >= 400) {
                err = core.newError({ message: obj.reason || (method + " Error: " + params.status), code: obj.error, status: params.status });
            }
            callback(err, obj);
        });
    }

    pool.query = function(client, req, opts, callback) {
        var keys = self.getKeys(req.table, opts);
        var key = keys.filter(function(x) { return req.obj[x] }).map(function(x) { return req.obj[x] }).join("|");

        switch (req.op) {
        case "get":
            if (opts.select) opts.fields = String(opts.select);
            var path = "/" + req.table + "/" + (opts.type || req.table) + "/" + (opts.id || key).replace(/[\/]/g, "%2F");
            query("get", "GET", path, "", opts, function(err, res) {
                if (err) return callback(err, []);
                callback(null, [ res._source || res.fields || {} ], res);
            });
            break;

        case "select":
        case "search":
            if (opts.count) opts.size = opts.count;
            if (opts.select) opts.fields = String(opts.select);
            if (typeof req.obj == "string") {
                opts.q = req.obj;
                req.obj = "";
            } else
            if (req.obj.query) {

            } else {
                opts.q = Object.keys(req.obj).map(function(x) {
                    var val = req.obj[x];
                    var op = opts.ops[x];
                    switch (op) {
                    case "in": return x + ':' + (Array.isArray(val) ? '(' + val.map(function(y) { return '"' + y + '"' }).join(" OR ") + ')' : val);
                    case "ne": return x + ':-"' + val + '"';
                    case "gt": return x + ':>' + val;
                    case "lt": return x + ':<' + val;
                    case "ge": return x + ':>=' + val;
                    case "le": return x + ':<=' + val;
                    case "between": return x + ':' + (val.length == 2 ? '["' + val[0] + '" TO "' + val[1] + '"]' : val);
                    case "begins_with": return x + ':"' + val + '*"';
                    case "contains": return x + ':"*' + val + '*"';
                    case "not_contains": return x + ':>' + val;
                    default: return x + ':"' + val + '"';
                    }
                }).join(" AND ");
                req.obj = "";
            }
            var path = "/" + req.table + "/" + (opts.type || req.table) +  "/" + (opts.op || "_search");
            query("select", "POST", path, req.obj, opts, function(err, res) {
                if (err) return callback(err, []);
                callback(null, res.hits ? res.hits.hits.map(function(x) { return x._source || x.fields || {} }) : [], res);
            });
            break;

        case "list":
            if (opts.count) opts.searchSize = opts.count;
            if (opts.select) opts.fields = String(opts.select);
            var ids = req.obj.map(function(x) { return Object.keys(x).map(function(y) { return x[y]}).join("|") });
            var path = "/" + req.table + "/" + (opts.type || req.table) +  "/_mget";
            query("list", "GET", path, { ids: ids }, opts, function(err, res) {
                if (err) return callback(err, []);
                callback(null, res.docs ? res.docs.map(function(x) { return x._source || x.fields || {} }) : [], res);
            });
            break;

        case "add":
            opts.op_type = "create";
            var path = "/" + req.table + "/" + (opts.type || req.table) + "/" + (opts.id || key).replace(/[\/]/g, "%2F");
            query("index", "PUT", path, req.obj, opts, function(err, res) {
                callback(err, [], res);
            });
            break;

        case "put":
        case "update":
            var path = "/" + req.table + "/" + (opts.type || req.table) + "/" + (opts.id || key).replace(/[\/]/g, "%2F");
            query("index", "PUT", path, req.obj, opts, function(err, res) {
                callback(err, [], res);
            });
            break;

        case "del":
            var path = "/" + req.table + "/" + (opts.type || req.table) + "/" + (opts.id || key).replace(/[\/]/g, "%2F");
            query("del", "DELETE", path, "", opts, function(err, res) {
                callback(err, [], res);
            });
            break;

        default:
            return callback(null, []);
        }
    }

    return pool;
}

// Create a database pool that works with CouchDB server.
//
// In addition to the standard commands it can execute any CouchDB HTTP API directly
//
//      db.query({ op: "GET", text: "/db/url" }, { pool: "couchdb" }, db.showResult)
//      db.query({ op: "PUT", text: "/db/url", obj: { a: 1 b: 2 } }, { pool: "couchdb" }, db.showResult)
//
db.couchdbInitPool = function(options)
{
    var self = this;
    if (!options) options = {};
    if (!options.pool) options.pool = "couchdb";

    options.type = "couchdb";
    var u = url.parse(options.db);
    if (!u.port) u.host = u.hostname + ":" + 5984;
    options.db = url.format(u);
    var pool = this.createPool(options);

    // Native query parameters for each operation
    var _query = { get : ["attachments","att_encoding_info","atts_since","conflicts","deleted_conflicts","latest","local_seq","meta","open_revs","rev","revs","revs_info"],
                   select: ["conflicts","descending","endkey","end_key","endkey_docid","end_key_doc_id","group","group_level","include_docs","attachments","att_encoding_info",
                           "inclusive_end","key","limit","reduce","skip","stale","startkey","start_key","startkey_docid","start_key_doc_id","update_seq"],
                   put: ["batch"],
                   del: ["rev", "batch"] };

    function query(op, method, path, obj, opts, callback) {
        var uri = pool.db + "/" + path;
        var params = { method: method, postdata: method != "GET" ? obj : "", query: {} };
        if (_query[op]) _query[op].forEach(function(x) { if (opts[x]) params.query[x] = opts[x] });

        core.httpGet(uri, params, function(err, params) {
            if (err) {
                logger.error("couchdb:", method, path, err);
                return callback(err, {});
            }
            var err = null;
            obj = core.jsonParse(params.data, { obj: 1 });
            if (params.status >= 400) {
                err = core.newError({ message: obj.reason || (method + " Error: " + params.status), code: obj.error, status: params.status });
            }
            callback(err, obj);
        });
    }

    pool.query = function(client, req, opts, callback) {
        var keys = self.getKeys(req.table, opts);
        var key = req.table + "|" + keys.filter(function(x) { return req.obj[x] }).map(function(x) { return req.obj[x] }).join("|");

        switch (req.op) {
        case "create":
        case "upgrade":
            var views = {}, changed = 0;
            var cols = Object.keys(core.searchObj(req.obj, { name: 'primary', sort: 1, flag: 1 }));
            if (cols.length) views.primary = cols;

            ["", "1", "2", "3", "4", "5"].forEach(function(n) {
                var cols = Object.keys(core.searchObj(req.obj, { name: "unique" + n, sort: 1, flag: 1 }));
                if (cols.length) views[cols.join("_")] = cols;
                var cols = Object.keys(core.searchObj(req.obj, { name: "index" + n, sort: 1, flag: 1 }));
                if (cols.length) views[cols.join("_")] = cols;
            });

            query("get", "GET", "_design/" + req.table, "", {}, function(err, res) {
                if (err && err.status != 404) return callback(err);
                if (!res || !res.views) res = { id: "_design/" + req.table, language: "javascript", views: {} }, changed = 1;
                Object.keys(views).forEach(function(view) {
                    if (res.views[view]) return;
                    var cols = views[view];
                    res.views[view] = { map: "function(doc) { if (" + cols.map(function(x) { return "doc." + x }).join(" && ") + ") emit(" + (cols.map(function(x) { return "doc." + x }).join("+'|'+")) + ", doc); }" };
                    changed = 1;
                });
                if (!changed) return callback(err, []);
                query("put", "PUT", "_design/" + req.table, res, {}, function(err, res) {
                    callback(err, []);
                });
            });
            break;

        case "get":
            key = key.replace(/[\/]/g, "%2F");
            query("get", "GET", key, "", opts, function(err, res) {
                if (err) return callback(err.status == 404 ? null : err, []);
                callback(null, [ res ]);
            });
            break;

        case "select":
            if (opts.desc) opts.descending = true;
            if (opts.count) opts.limit = opts.count;
            if (opts.start) opts.skip = opts.start;
            opts.startkey = key;
            // Matching the beginning of the primary key
            if (keys.some(function(x) { return opts.ops[x] == "begins_with" })) {
                opts.endkey = key.substr(0, key.length - 1) + String.fromCharCode(key.charCodeAt(key.length - 1) + 1);
            }
            // Custom filter on other columns
            var cols = self.getColumns(req.table, opts);
            var other = Object.keys(req.obj).filter(function(x) { return x[0] != "_" && keys.indexOf(x) == -1 && typeof req.obj[x] != "undefined" });
            var opts2 = { keys: other, cols: cols, ops: opts.ops, typesMap: opts.typesMap };
            var filter = function(items) { return other.length > 0 ? self.filterColumns(req.obj, items, opts2) : items; }

            query("select", "GET", "_design/" + req.table + "/_view/" + (opts.sort || "primary"), "", opts, function(err, res) {
                if (err) return callback(err, []);
                callback(null, filter(res.rows.map(function(x) { return x.value })));
            });
            break;

        case "list":
            var ids = req.obj.map(function(x) { return req.table + "|" + keys.map(function(y) { return x[y] || "" }).join("|"); });
            var rows = [];
            core.forEachLimit(ids, opts.concurrency || core.concurrency, function(key, next) {
                key = key.replace(/[\/]/g, "%2F");
                query("get", "GET", key, "", opts, function(err, res) {
                    if (err && err.status != 404) return next(err);
                    if (!err) rows.push(res);
                    next();
                });
            }, function(err) {
                callback(err, rows);
            });
            break;

        case "add":
        case "put":
            req.obj._id = key;
            query("put", "POST", "", req.obj, opts, function(err, res) {
                callback(err, [], res);
            });
            break;

        case "incr":
        case "update":
            req.obj._id = key;
            key = key.replace(/[\/]/g, "%2F");
            // Not a full document, retrieve the latest revision
            if (req.obj._rev && req.obj._id) {
                query("PUT", key, req.obj, opts, function(err, res) {
                    callback(err, [], res);
                });
            } else {
                query("get", "GET", key, "", opts, function(err, res) {
                    if (err) return callback(err, []);
                    for (var p in res) {
                        if (opts.counter && opts.counter.indexOf(p) > -1) {
                            req.obj[p] = core.toNumber(res[p]) + core.toNumber(req.obj[p]);
                        } else
                        if (!req.obj[p]) {
                            req.obj[p] = res[p];
                        }
                    }
                    query("put", "PUT", key, req.obj, opts, function(err, res) {
                        callback(err, [], res);
                    });
                });
            }
            break;

        case "del":
            key = key.replace(/[\/]/g, "%2F");
            query("del", "DELETE", key, "", opts, function(err, res) {
                callback(err, [], res);
            });
            break;

        default:
            query("", req.op, req.text, req.obj, opts, function(err, res) {
                callback(err, res);
            });
        }
    }

    return pool;
}

// Create a database pool that works with the Riak database.
//
// By default the driver uses simple key-value mode of operations, to enable bucket-type mode
// pass bucketType in the `-db-riak-options`:
//
// To use maps for the object records set `useMaps` in the `-db-riak-options`
//
//      -db-riak-options '{ "bucketType": "bk", "useMaps": 1 }'
//
// In addition to the standard commands it can execute any Riak HTTP API directly
//
//      db.query({ op: "GET", text: "/buckets?buckets=true" }, { pool: "riak" }, db.showResult)
//      db.query({ op: "POST", text: "/buckets/bucket/counter/name", obj: 1 }, { pool: "riak" }, db.showResult)
//
db.riakInitPool = function(options)
{
    var self = this;
    if (!options) options = {};
    if (!options.pool) options.pool = "riak";

    options.type = "riak";
    var u = url.parse(options.db);
    if (!u.port) u.host = u.hostname + ":" + 8098;
    u.path = u.pathname = null;
    options.db = url.format(u);
    var pool = this.createPool(options);

    // Native query parameters for each operation
    var _query = { del: ["rw", "pr", "w", "dw", "pw"],
                   get: ["r","pr","basic_quorum","notfound_ok","vtag"],
                   put: ["w","dw","pw","returnbody"],
                   select: ["return_terms","max_results","continuation"], };

    function query(op, method, path, obj, opts, callback) {
        var uri = pool.db + path;
        var params = { method: method, postdata: method != "GET" ? obj : "", query: {}, headers: { "content-type": "application/json" } };
        if (_query[op]) _query[op].forEach(function(x) { if (opts[x]) params.query[x] = opts[x] });
        for (var p in opts.headers) params.headers[p] = opts.headers[p];

        core.httpGet(uri, params, function(err, params) {
            if (err) {
                logger.error("riak:", method, path, err);
                return callback(err, {});
            }
            var err = null;
            obj = core.jsonParse(params.data, { obj: 1 });
            if (params.status >= 400) {
                err = core.newError({ message: params.data || (method + " Error: " + params.status), code: obj.error, status: params.status });
            }
            callback(err, obj, { context: params.headers['x-riak-vclock'] });
        });
    }

    function getPath(table, key) {
        if (pool.bucketType) {
            return "/types/" + pool.bucketType + "/buckets/" + table + (pool.useMaps ? "/datatypes/" : "/keys/") + key.replace(/[\/]/g, "%2F");
        }
        return "/buckets/" + table + "/keys/" + key.replace(/[\/]/g, "%2F");
    }
    function getValue(obj) {
        if (pool.bucketType && pool.useMaps && obj.value) {
            var o = {};
            for (var p in obj.value) o[p.replace(/(_register|_flag|_counter)$/, "")] = obj[p];
            obj = o;
        }
        return obj;
    }
    function toValue(obj, cols) {
        if (pool.bucketType && pool.useMaps) {
            var o = { update: {} };
            for (var p in obj) o.update[p + (cols && cols[p] && cols[p].type == "counter" ? "_counter" : "_register")] = obj[p];
            obj = o;
        }
        return obj;
    }

    pool.query = function(client, req, opts, callback) {
        var keys = self.getKeys(req.table, opts);
        var key = keys.filter(function(x) { return req.obj[x] }).map(function(x) { return req.obj[x] }).join("|");

        switch (req.op) {
        case "get":
            var path = getPath(req.table, key);
            query("get", "GET", path, "", opts, function(err, res, info) {
                if (err) return callback(err.status == 404 ? null : err, []);
                callback(null, [ getValue(res) ], info);
            });
            break;

        case "select":
            opts.return_terms = "true";
            if (opts.count) opts.max_results = opts.count;
            if (opts.start) opts.continuation = opts.start;

            // Custom filter on other columns
            var cols = self.getColumns(req.table, opts);
            var other = Object.keys(req.obj).filter(function(x) { return x[0] != "_" && keys.indexOf(x) == -1 && typeof req.obj[x] != "undefined" });
            var opts2 = { keys: other, cols: cols, ops: opts.ops, typesMap: opts.typesMap };
            var filter = function(item) { return other.length > 0 ? self.filterColumns(req.obj, [ item ], opts2).length : 1; }

            var path = "/buckets/" + req.table + "/index/" + (opts.sort || "primary_bin") + "/" + key.replace(/[\/]/g, "%2F");

            // Matching the beginning of the primary key
            if (keys.some(function(x) { return opts.ops[x] == "begins_with" })) {
                path += "/" + key.substr(0, key.length - 1) + String.fromCharCode(key.charCodeAt(key.length - 1) + 1);
            }
            query("select", "GET", path, "", opts, function(err, res) {
                if (err) return callback(err, []);
                var rows = [];
                core.forEachLimit(res.keys, opts.concurrency || core.concurrency, function(key, next) {
                    var path = getPath(req.table, key);
                    query("get", "GET", path, "", opts, function(err, res, info) {
                        if (err && err.status != 404) return next(err);
                        res = getValue(res);
                        if (!err && filter(res)) rows.push(res);
                        next();
                    });
                }, function(err) {
                    client.next_token = res.continuation;
                    callback(err, rows);
                });
            });
            break;

        case "list":
            var ids = req.obj.map(function(x) { return keys.map(function(y) { return x[y] || "" }).join("|"); });
            var rows = [];
            core.forEachLimit(ids, opts.concurrency || core.concurrency, function(key, next) {
                var path = getPath(req.table, key);
                query("get", "GET", path, "", opts, function(err, res, info) {
                    if (err && err.status != 404) return next(err);
                    if (!err) rows.push(getValue(res));
                    next();
                });
            }, function(err) {
                callback(err, rows);
            });
            break;

        case "add":
        case "put":
            // Index by the hash property
            opts.headers = { "x-riak-index-primary_bin": key };
            if (opts.context) opts.headers['x-riak-vclock'] = opts.context;
            var cols = self.getColumns(req.table, opts);
            var path = getPath(req.table, key);
            query("put", "PUT", path, toValue(req.obj, cols), opts, function(err, res) {
                callback(err, [], res);
            });
            break;

        case "incr":
        case "update":
            // Index by the hash property
            opts.headers = { "x-riak-index-primary_bin": key };
            if (opts.context) opts.headers['x-riak-vclock'] = opts.context;
            var cols = self.getColumns(req.table, opts);
            var path = getPath(req.table, key);
            if (pool.bucketType && pool.useMaps) {
                query("put", "PUT", key, toValue(req.obj, cols), opts, function(err, res) {
                    callback(err, [], res);
                });
                break;
            }
            query("get", "GET", path, "", opts, function(err, res, info) {
                if (err) return callback(err, []);
                for (var p in res) {
                    if (opts.counter && opts.counter.indexOf(p) > -1) {
                        req.obj[p] = core.toNumber(res[p]) + core.toNumber(req.obj[p]);
                    } else
                    if (!req.obj[p]) {
                        req.obj[p] = res[p];
                    }
                }
                if (info && info.context) opts.headers['x-riak-vclock'] = info.context;
                query("put", "PUT", key, req.obj, opts, function(err, res) {
                    callback(err, [], res);
                });
            });
            break;

        case "del":
            var path = getPath(req.table, key);
            query("del", "DELETE", path, "", opts, function(err, res) {
                callback(err, [], res);
            });
            break;

        default:
            query("", req.op, req.text, req.obj, opts, function(err, res) {
                callback(err, res);
            });
        }
    }

    return pool;
}

// Make sure the empty pool is created to properly report init issues
db.nopool = db.createPool({ pool: "none", type: "none" });
db.nopool.prepare = function(op, table, obj, options)
{
    switch (op) {
    case "create":
    case "upgrade":
        break;
    default:
        logger.error("db.none: core.init must be called before using the backend DB functions:", op, table, obj);
    }
    return {};
}
