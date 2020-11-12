//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const util = require('util');
const lib = require(__dirname + '/lib');
const db = require(__dirname + '/db');
const logger = require(__dirname + '/logger');
const pool = require(__dirname + '/pool');
const metrics = require(__dirname + "/metrics");

// Return database pool by table name or default pool, options can be a pool name or an object with { pool: name } to return
// the pool by given name. This call always returns a valid pool object, in case no requested pool found, it returns
// the default pool, in case of invalid pool name it returns `none` pool.
// A special pool `none` always returns empty result and no errors.
// Pools specific tables will not be returned even if a different pool name is provided, the none pool will be returned.
db.getPool = function(table, options)
{
    for (var p in this.poolTables) {
        if (this.poolTables[p].test(table)) return this.pools[p] || this.pools.none;
    }
    var pool = options ? (typeof options == "string" ? options : options.pool || this.pool) : this.pool;
    return this.pools[pool] || this.pools.none;
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
    for (var p in this.pools) {
        if (p != "none") rc.push({ name: this.pools[p].name, type: this.pools[p].type });
    }
    return rc;
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

db.applyPoolOptions = function(val, options)
{
    if (!options.obj) return;
    var obj = options.obj.split(/[.-]/);
    var pool = this.getPool("", obj[1]);
    if (!pool) return;
    logger.debug("applyPoolOptions:", obj, "NEW:", options.context, "OLD:", pool.configOptions);
    lib.objExtend(pool.configOptions, options.context);
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
                } catch (e) {
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
                } catch (e) {
                    logger.error("pool.destroy:", this.name, e);
                    if (typeof callback == "function") callback(e);
                }
            },
        };
        pool.call(this, methods);
    } else {
        pool.call(this);
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

util.inherits(db.Pool, pool);

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
    pool.prototype.shutdown.call(this, function() {
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

// Update the options with pool config parameters if needed, the options is from the request
db.Pool.prototype.prepareOptions = function(options)
{
}

// Default prepareRow is to perform pool specific actions for prepared row before passing it to the op specific columns filterting
db.Pool.prototype.prepareRow = function(req)
{
}

// Default prepare is to return all parameters in an object
db.Pool.prototype.prepare = function(req)
{
}

// Return the value to be used in binding, mostly for SQL drivers, on input value and col info are passed, this callback
// may convert the value into something different depending on the DB driver requirements, like timestamp as string into milliseconds
db.Pool.prototype.bindValue = function(req, name, value)
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
    return db.getTable(table);
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
