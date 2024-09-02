//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const util = require('util');
const lib = require(__dirname + '/../lib');
const db = require(__dirname + '/../db');
const logger = require(__dirname + '/../logger');
const pool = require(__dirname + '/../pool');
const metrics = require(__dirname + "/../metrics");

// Return database pool by name or default pool, options can be a pool name or an object with { pool: name } to return
// the pool by given name. This call always returns a valid pool object, in case no requested pool found, it returns
// the default pool, in case of invalid pool name it returns `none` pool.
// A special pool `none` always returns empty result and no errors.
db.getPool = function(options)
{
    var pool = typeof options == "string" ? options : options?.pool || this.pool;
    return this.pools[this.poolAliases[pool] || pool] || this.pools.none;
}

// Return all tables know to the given pool, returned tables are in the object with
// column information merged from cached columns from the database with description columns
// given by the application. If `options.names` is 1 then return just table names as a list.
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

// Return a list of all active database pools, returns list of objects with name: and type: properties
db.getPools = function()
{
    var rc = [];
    for (var p in this.pools) {
        if (p != "none") rc.push({ name: this.pools[p].name, type: this.pools[p].type });
    }
    return rc;
}

db.applyPoolOptions = function(val, options)
{
    if (!options.obj) return;
    logger.debug("applyPoolOptions:", options.obj, options.name, "NEW:", options.context);
    var d = options.obj.match(/^poolParams\.([^.]+)/);
    var pool = d && this.getPool(d[1]);
    if (!pool) return;
    logger.debug("applyPoolOptions:", options.obj, options.name, "OLD:", pool.configOptions);
    lib.objExtend(pool.configOptions, options.context, { deep: 1 });
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
//          var pool = db.getPool("mongodb");
//          pool.get(function(err, client) {
//              var collection = client.collection('bk_user');
//              collection.findOne({ id: '123' }, function() {
//                  pool.release(client);
//              });
//          });
//
db.Pool = function(options, defaults)
{
    // Methods for db client allocations and release
    var methods = {
        init: defaults?.init,
        shutdown: defaults?.shutdown,
    };
    if (lib.isPositive(options.max)) {
        methods.create = function(callback) {
            try {
                this.open.call(this, callback);
            } catch (e) {
                logger.error('pool.create:', this.name, this.type, this.url, e);
                callback(e);
            }
        }
        methods.reset = function(client) {
            if (typeof client.reset == "function") client.reset();
        }
        methods.destroy = function(client, callback) {
            try {
                this.close.call(this, client, callback);
            } catch (e) {
                logger.error("pool.destroy:", this.name, this.type, this.url, e);
                if (typeof callback == "function") callback(e);
            }
        }
    }
    pool.call(this, methods);
    this.type = defaults?.type || options.type || "none";
    this.name = defaults?.name || options.pool || options.name || this.type;
    this.url = this.url || options.url || defaults?.url;
    this.configOptions = lib.objExtend({}, defaults?.configOptions, { deep: 1 });
    this.connectOptions = lib.objExtend({}, defaults?.connectOptions, { deep: 1 });
    this.dbcolumns = {};
    this.dbkeys = {};
    this.dbindexes = {};
    this.dbcapacity = {};
    this.metrics = {
        running: 0,
        err_count: 0,
        retry_count: 0,
        miss_count: 0,
        hit_count: 0,
        req: new metrics.Timer(),
        que: new metrics.Histogram(),
        cache: new metrics.Histogram(),
        tables: {},
    };

    this.configure(options);
}

util.inherits(db.Pool, pool);

// Reconfigure properties, only subset of properties are allowed here so it is safe to apply all of them directly,
// this is called during realtime config update
db.Pool.prototype.configure = function(options)
{
    this.init(options);
    if (options.url) this.url = options.url;
    lib.objExtend(this.configOptions, options.configOptions, { deep: 1 });
    lib.objExtend(this.connectOptions, options.connectOptions, { deep: 1 });
    logger.debug("pool.configure:", this.name, this.type, this.url, "opts:", options);
}

db.Pool.prototype.shutdown = function(callback, maxtime)
{
    logger.debug("pool.shutdown:", this.name, this.type, this.url);
    pool.prototype.shutdown.call(this, () => {
        this.metrics.req.end();
        for (const p in this.metrics.tables) {
            this.metrics.tables[p].read.end();
            this.metrics.tables[p].write.end();
        }
        this.metrics = {};
        this.dbcolumns = this.dbkeys = this.dbindexes = {};
        this.configOptions = this.connectOptions = {};
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
db.Pool.prototype.bindValue = function(req, name, value, op)
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
