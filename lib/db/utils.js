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
    var d = options.obj.match(/^_config\.([^.]+)\.config\.?(.+)?/);
    var pool = d && this.getPool(d[1]);
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
 * all non public columns if necessary. See  the `api` object in {@link DbTableColumn} for all supported conditions.
 *
 * @param {string|string[]} table - can be a single table name or a list of table names which combined public columns need to
 * be kept in the rows.
 * @param {object|object[]} data
 * @param {object} [options]
 * @param {object} [options.rules] can be an object with property names and the values 0|1 for `pub`, `2` for `admin`, `3` for `staff``
 * @param { boolean} [options.strict] remove all unknown columns
 * @param { boolean} [options.copy] means to return a copy of every modified record, the original data is preserved
 * @return {object|object[]} cleaned records
 *
 * @memberof module:db
 * @method cleanupResult
 */
db.cleanupResult = function(table, data, options)
{
    if (!table || !data) return;

    var row, nrows, nrow;
    var r, col, cols = {}, all = 0, pos = 0;

    const admin = options?.isAdmin || options?.isInternal;
    const internal = options?.isStaff || options?.isInternal;
    const strict = options?.strict || this.cleanup?.strict;
    const roles = lib.split(options?.user?.roles);
    const tables = lib.split(table);
    const rules = {
        $: options?.rules || lib.empty,
        '*': this.cleanup?.rules?.["*"] || lib.empty
    };

    for (const table of tables) {
        rules[table] = this.cleanup?.rules?.[table] || lib.empty;
        const dbcols = db.getColumns(table, options);
        for (const p in dbcols) {
            col = dbcols[p] || lib.empty;
            r = typeof rules.$[p] == "number" ? rules.$[p] : typeof rules[table][p] == "number" ? rules[table][p] : undefined;
            r = cols[p] = r !== undefined ? r === 1 ? 1 : r === 2 && !admin ? 0 : r === 3 && !internal ? 0 : r === 4 && !options?.isInternal ? 0 : r :
                          !col.api || col.api.priv ? 0 :
                          col.api.pub ? 1 :
                          col.api.staff ? internal ? 3 : 0 :
                          col.api.admin ? admin ? 2 : 0 :
                          options?.isInternal ? 4 : 0;

            if (r && !options?.isInternal) {
                if (col.api.noroles && lib.isFlag(roles, col.api.noroles)) r = cols[p] = 0; else
                if (col.api.roles && !lib.isFlag(roles, col.api.roles)) r = cols[p] = 0;

                // For nested objects simplified rules based on the params only
                if (r && col.params) {
                    const hidden = [], params = col.params;
                    for (const k in params) {
                        col = params[k] || lib.empty;
                        r = !col.api || col.api.priv ? 0 :
                             col.api.staff ? internal ? 1 : 0 :
                             col.api.admin ? admin ? 1 : 0 : 1;
                        all++;
                        pos += r ? 1 : 0;
                        if (!r) hidden.push(k);
                    }
                    cols[p] = hidden.length ? hidden : cols[p];
                }
            }
            all++;
            pos += r ? 1 : 0;
        }
    }
    // Exit if nothing to cleanup
    if (!strict && (!all || all == pos)) return data;

    const _rules = {};
    function checkRules(p) {
        var r = _rules[p];
        if (r === undefined) {
            for (const n in rules) {
                r = rules[n][p];
                if (r !== undefined) {
                    r = r === 2 && !admin ? 0 : r === 3 && !internal ? 0 : r === 4 && !options?.isInternal ? 0 : r;
                    break;
                }
            }
            _rules[p] = r || 0;
        }
        return r;
    }

    const rows = Array.isArray(data) ? data : [ data ];
    for (let i = 0; i < rows.length; ++i) {
        row = rows[i];
        nrow = null;
        for (const p in row) {
            col = cols[p];
            r = col === 0 || Array.isArray(col) || (strict && col === undefined && !checkRules(p));
            if (r) {
                // Lazy copy on modify
                if (options?.copy && !nrow) {
                    nrow = {};
                    for (const k in row) nrow[k] = row[k];
                    row = nrow;
                }
                if (Array.isArray(col) && row[p]) {
                    var crows = Array.isArray(row[p]) ? row[p] : [row[p]];
                    for (let j = 0; j < crows.length; ++j) {
                        for (const c in col) delete crows[j][col[c]];
                    }
                } else {
                    delete row[p];
                }
            }
        }
        if (options?.copy && nrow) {
            if (!nrows) nrows = rows.slice(0);
            nrows[i] = nrow;
        }
    }
    if (options?.copy && nrows) {
        data = Array.isArray(data) ? nrows : nrows[0];
    }
    logger.debug("cleanupResult:", "db", table, rows.length, all, pos, cols, options, _rules);
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
        table: table,
        unitCapacity: 1,
        readCapacity: capacity?.read || pool.config.maxReadCapacity || 0,
        writeCapacity: capacity?.write || pool.config.maxWriteCapacity || 0,
    };
    var use = options?.useCapacity;
    var factor = options?.factorCapacity > 0 && options?.factorCapacity <= 1 ? options.factorCapacity : 1;
    cap.maxCapacity = Math.max(0, typeof use == "number" ? use :
                                  use == "read" ? cap.readCapacity : cap.writeCapacity,
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
    if (typeof consumed == "function") callback = consumed, consumed = 1;
    if (typeof cap?._tokenBucket?.consume != "function") {
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
                if (key && key[0] != '_' && query[key] !== undefined) {
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
    const i = name.lastIndexOf("_$");
    if (i > 0) {
        let j = i + 2;
        while (name[j] === "$") j++;
        var op = name.substr(j) || op;
        name = name.substr(0, i);
    }
    return [name, op];
}

