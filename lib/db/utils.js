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
 * @param {string|object} options - a pool name or an object with pool property
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
 * @param {DbRequest} req
 * @param {Error|object} err
 * @return {Error|object}
 * @memberof module:db
 * @method convertError
 */
db.convertError = function(req, err)
{
    if (!err || !util.types.isNativeError(err)) return err;
    err = req.pool.convertError(req, err);
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
 * Return primary keys for a table or empty array
 */
db.getKeys = function(table, options)
{
    table = this.alias(table);
    return lib.isArray(this.getPool(options).dbkeys[table]) || this.keys[table] || lib.emptylist;
}

// Return indexes for a table or empty object, each item in the object is an array with index columns
db.getIndexes = function(table, options)
{
    table = this.alias(table);
    return this.getPool(options).dbindexes[table] || this.indexes[table] || lib.empty;
}

/**
 * Returns an object based on the list of keys, basically returns a subset of query properties.
 */
db.getQueryForKeys = function(keys, query)
{
    return lib.isArray(keys, lib.emptylist).
            reduce((obj, key) => {
                if (key && key[0] != '_' && query[key] !== undefined) {
                    obj[key] = query[key];
                }
                return obj;
            }, {});
}

/**
 * Split column name into pure name and possible op from the format: NAME[_$[OP]]
 * @param {string} name
 * @param {any} value - for null op will null, for array will be in
 * @Return {string[]} as [name, op]
 * @member module:db
 * @method parseNameOp
 */
db.parseNameOp = function(name, value)
{
    const i = name.lastIndexOf("_$");
    if (i > 0) {
        let j = i + 2;
        while (name[j] === "$") j++;
        var op = name.substr(j) || op;
        name = name.substr(0, i);
    }
    return [name, op];
}

