/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const util = require('util');
const db = require(__dirname + '/../db');
const logger = require(__dirname + '/../logger');
const lib = require(__dirname + '/../lib');
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

// Returns true if a pool exists
db.existsPool = function(name)
{
    return !!this.pools[name];
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

