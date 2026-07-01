/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
'use strict';

const util = require('node:util');
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
    var pool = typeof options === "string" ? options : options?.pool || this.pool;
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
    if (lib.isArray(pool.config.tables)) {
        tables = pool.config.tables.reduce((a, b) => { a[b] = this.tables[b]; return a }, {});
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
    for (const p in this.pools) {
        if (p !== "none") rc.push({ name: this.pools[p].name, type: this.pools[p].type });
    }
    return rc;
}

/**
 * Apply a config parameter to live DB pool, used in config args `update` callback to make a config value live
 * @memberof module:db
 * @method applyPoolOptions
 */
db.applyPoolOptions = function(_val, options)
{
    if (!options.obj) return;
    logger.debug("applyPoolOptions:", options.obj, options.name, "NEW:", options.context);
    const d = options.obj.match(/^_config\.([^.]+)\.config\.?(.+)?/);
    const pool = d && this.getPool(d[1]);
    if (!pool) return;
    logger.debug("applyPoolOptions:", options.obj, options.name, "OLD:", pool.config);
    if (d[2]) {
        pool.config[d[2]] = lib.extend(pool.config[d[2]], options.context);
    } else {
        lib.extend(pool.config, options.context);
    }
}

/**
 * Returns true if a pool exists
 * @memberof module:db
 * @method existsPool
 */
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
 * Return an object to be returned to the client as a page of result data with possibly next token
 * if present in the info. This result object can be used for pagination responses.
 * @param {DbRequest} req - request object
 * @param {boolean} [req.options.total] - return count only from rows[0].count
 * @param {object|object[]} data
 * @param {object} info
 * @param {any} [info.next_token] - if present returned in result, this is from DB pagination, only numbers are returned
 *  as is, if it is a not number the next_token is base64 encoded with {@link module:lib.jsonToBase64}.
 *  When processing requests with JSON tokens in {@link module:api.validate} use the "token" type
 * @return {object} with properties { count, data, next_token, total }
 * @memberof module:db
 * @method paginatePage
 */
db.paginateResult = function(data, info)
{
    data = Array.isArray(data) ? data : [];
    const token = { count: data.length, data };
    if (info) {
        if (info.next_token) {
            token.next_token = lib.isNumber(info.next_token) || lib.jsonToBase64(info.next_token);
        }
        if (info.total > 0) token.total = info.total;
    }
    return token;
}

/**
 * Process records and keep only public properties as defined in the table columns. This method is supposed to be used in the post process
 * callbacks after all records have been processes and are ready to be returned to the client, the last step would be to cleanup
 * all non public columns if necessary.
 *
 * This method is useful in case when no new object shapes are required to return but existing table shape, in such case removing
 * private properties requires less code to keep in sync.
 *
 * The `cleanup` property in {@link DbTableColumn} is used to determine if a column can be present in the result or stripped away,
 * absense of the `cleanup` property means never return the column, i.e. it is private.
 *
 * @param {string|string[]} tables - can be a single table name or a list of table names which combined public columns need to
 * be kept in the rows.
 * @param {object|object[]} data - row(s) to be cleaned up
 * @param {object|RequestContext} [options]
 * @param {object} [options.user] - current user record to check for roles, this can be {@link RequestContext} if no other properies atre needed
 * @param {object} [options.cleanup] can be an object similar to the cleanup object in the table, these rules take precedence
 * @return {object|object[]} cleaned records, a new object/array if any field must be excluded
 *
 * @memberof module:db
 * @method cleanupResult
 * @example
 * // assuming the users table is
 * users: {
 *     id: { type: "test", cleanup: false },
 *     name: { type: "test", cleanup: false },
 *     secret: { type: "test" },
 * }
 *
 * // and the API route handler
 * api.app.get("/user/:id", async (context) => {
 *      const { err, data } = db.aget("users", { id: context.params.id });
 *      if (!data) return context.reply(err || { status: 404 })
 *
 *      context.json(db.cleanupResult('users', data, context));
 * })
 *
 * // added a user somewhere
 * db.add("users", { id: 123, name: "test", secret: "...." });
 *
 * // asking for that user will return only public properties
 * curl localhost:8000/user/123
 * { "id": 123, "name": "test "}
 */
db.cleanupResult = function(tables, data, options)
{
    if (!tables || !data) return;

    const clean = Object.create(null);
    let changed = 0;

    const roles = lib.split(options?.user?.roles);

    for (const table of lib.split(tables)) {
        const cols = db.getColumns(table, options);
        for (const p in cols) {
            const col = cols[p];
            const cleanup = options?.cleanup?.[p] ?? col.cleanup ?? this.cleanup?.[table]?.[p];
            let rm = cleanup;

            if (rm !== true && typeof rm !== "boolean" && cleanup) {
                rm = true;
                if (cleanup.roles?.length && lib.includes(cleanup.roles, roles)) rm = false;
                if (cleanup.noroles?.length && !lib.includes(cleanup.noroles, roles)) rm = false;
            }

            // For nested objects explicit cleanup: true
            if (!rm && col.params) {
                for (const k in col.params) {
                    if (col.params?.[k]?.cleanup) {
                        if (!rm) rm = [];
                        rm.push(k);
                    }
                }
            }
            changed += rm ? 1 : 0;
            clean[p] = rm;
        }
    }
    // Exit if nothing to cleanup
    if (!changed) return data;

    let nrows;
    const rows = Array.isArray(data) ? data : [ data ];
    for (let i = 0; i < rows.length; ++i) {
        let row = rows[i];
        let nrow = null;
        for (const p in row) {
            const rm = clean[p];
            if (rm || rm === undefined) {
                // Lazy copy on modify
                if (!nrow) {
                    nrow = Object.assign(Object.create(null), row);
                    row = nrow;
                }
                // Nested properties
                if (Array.isArray(rm) && row[p]) {
                    for (const _row of (Array.isArray(row[p]) ? row[p] : [row[p]])) {
                        for (const c of rm) delete _row[c];
                    }
                } else {
                    delete row[p];
                }
            }
        }
        if (nrow) {
            if (!nrows) nrows = rows.slice(0);
            nrows[i] = nrow;
        }
    }
    if (nrows) {
        data = Array.isArray(data) ? nrows : nrows[0];
    }
    logger.debug("cleanupResult:", "db", tables, rows.length, options, "clean:", clean);
    return data;
}

/**
 * Return an object with capacity property which is the max write capacity for the table, for DynamoDB only.
 * By default it checks `writeCapacity` property of all table columns and picks the max.
 * @param {string} table
 * @param {object} [options[]
 * - useCapacity - what to use for capacity rating, can be `write`, `read` or a number with max capacity to use
 * - factorCapacity - a number between 0 and 1 to multiple the rate capacity
 * - rateCapacity - if set it will be used for rate capacity limit
 * - maxCapacity - if set it will be used as the max burst capacity limit
 * - minCapacity - if set it will be used as the minimum threshold
 * - intervalCapacity - default is 1000 ms
 * - sort - an index to use for capacity, for systems like DynamoDB which has different capacity for
 *   global indexes, it makes sense for indexed reads or partial updates where only global index is affected and not the whole record
 * @return {object}
 * @memberof module:db
 * @method getCapacity
 */
db.getCapacity = function(table, options)
{
    table = this.alias(table);
    var pool = this.getPool(options);
    var capacity = pool.dbcapacity?.[table]?.[options.sort] || pool.dbcapacity?.[table]?.[table];
    var cap = {
        table,
        unitCapacity: 1,
        readCapacity: capacity?.read || pool.config.maxReadCapacity || 0,
        writeCapacity: capacity?.write || pool.config.maxWriteCapacity || 0,
    };
    var use = options?.useCapacity;
    var factor = options?.factorCapacity > 0 && options?.factorCapacity <= 1 ? options.factorCapacity : 1;
    cap.maxCapacity = Math.max(0, typeof use === "number" ? use :
                                  use === "read" ? cap.readCapacity : cap.writeCapacity,
                                  lib.toNumber(options?.maxCapacity),
                                  lib.toNumber(options?.minCapacity));
    cap.rateCapacity = Math.max(lib.toNumber(options?.minCapacity), cap.maxCapacity*factor);
    // Override with direct numbers if given
    for (const p in options) {
        if (/Capacity$/.test(p) && options[p] > 0) cap[p] = options[p];
    }
    if (cap.rateCapacity > 0) {
        cap._tokenBucket = new metrics.TokenBucket(cap.rateCapacity, cap.maxCapacity, options?.intervalCapacity);
    }
    return cap;
}

/**
 * Check if number of requests exceeds the capacity per second, delay if necessary, for DynamoDB only but can be used for pacing
 * requests with any database or can be used generically. The `cap` must be initialized with `db.getCapacity` call.
 * @memberof module:db
 * @method checkCapacity
 */
db.checkCapacity = function(cap, consumed, callback)
{
    if (typeof consumed === "function") callback = consumed, consumed = 1;
    if (typeof cap?._tokenBucket?.consume !== "function") {
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
 * @param {string} table
 * @param {object} [options]
 * @return {string[]}
 * @memberof module:db
 * @method getKeys
 */
db.getKeys = function(table, options)
{
    table = this.alias(table);
    return lib.isArray(this.getPool(options).dbkeys[table]) || this.keys[table] || lib.emptylist;
}

/**
 * Return indexes for a table or empty object, each item in the object is an array with index columns
 * @param {string} table
 * @param {object} [options]
 * @return {string[]}
 * @memberof module:db
 * @method getIndexes
 */
db.getIndexes = function(table, options)
{
    table = this.alias(table);
    return this.getPool(options).dbindexes[table] || this.indexes[table] || lib.empty;
}

/**
 * Returns an object based on the list of keys, basically returns a subset of query properties.
 * @param {string[]} keys
 * @param {object} query
 * @return {object}
 * @memberof module:db
 * @method getQueryForKeys
 */
db.getQueryForKeys = function(keys, query)
{
    return lib.isArray(keys, lib.emptylist).
            reduce((obj, key) => {
                if (key && key[0] !== '_' && query[key] !== undefined) {
                    obj[key] = query[key];
                }
                return obj;
            }, {});
}

/**
 * Split column name into pure name and possible op from the format: `NAME[_$[OP]]`
 * @param {string} name
 * @Return {string[]} as [name, op]
 * @memberof module:db
 * @method parseNameOp
 */
db.parseNameOp = function(name)
{
    let op;
    const i = name.lastIndexOf("_$");
    if (i > 0) {
        let j = i + 2;
        while (name[j] === "$") j++;
        op = name.substr(j);
        name = name.substr(0, i);
    }
    return [name, op];
}

