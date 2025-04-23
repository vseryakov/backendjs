//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const db = require(__dirname + '/../db');
const logger = require(__dirname + '/../logger');
const lib = require(__dirname + '/../lib');
const cache = require(__dirname + '/../cache');

// Retrieve cached result or put a record into the cache prefixed with table:key[:key...]
// Options accept the same parameters as for the usual get action but it is very important that all the options
// be the same for every call, especially `select` parameters which tells which columns to retrieve and cache.
// Additional options:
// - prefix - prefix to be used for the key instead of table name
//
//  Example:
//
//      db.getCached("get", "bk_user", { login: req.query.login }, { select: "latitude,longitude" }, function(err, row) {
//          var distance = lib.geoDistance(req.query.latitude, req.query.longitude, row.latitude, row.longitudde);
//      });
//
db.getCached = function(op, table, query, options, callback)
{
    if (typeof options == "function") callback = options,options = null;
    if (typeof callback != "function") callback = lib.noop;
    table = this.alias(table);
    var pool = this.getPool(options), key;
    if (!options?.cacheKey && options?.cacheKeyName) {
        key = this.getCacheKeys(table, query, options.cacheKeyName)[0];
        if (!key) return false;
    }
    options = lib.objClone(options, "__cached", true);
    if (key) options.cacheKey = key;
    // Get the full record if not a specific cache
    if (!options.cacheKeyName) delete options.select;
    var req = this.prepare(op, table, query, options);
    this.getCache(table, req.obj, options, (data, cached) => {
        pool.metrics.cache.update(Date.now() - req.now);
        // Cached value retrieved
        if (data) data = lib.jsonParse(data);
        // Parse errors treated as miss
        if (data) {
            pool.metrics.hit_count++;
            return callback(null, data, { cached: cached });
        }
        pool.metrics.miss_count++;
        // Retrieve account from the database, use the parameters like in Select function
        db[op](table, query, options, (err, data, info) => {
            // Store in cache if no error
            if (data && !err) db.putCache(table, data, options);
            info.cached = 0;
            callback(err, data, info);
        });
    });
    return true;
}

// Retrieve an object from the cache by key, sets `cacheKey` in the options for later use
db.getCache = function(table, query, options, callback)
{
    var key = this.getCacheKey(table, query, options);
    if (!key) return callback();
    if (options) options.cacheKey = key;
    var ttl2 = this.getCache2Ttl(table, options);
    if (ttl2) {
        var val = this.lru.get(key);
        if (val) {
            logger.debug("getCache2:", "lru:", key, options, 'ttl2:', ttl2);
            return callback(val, 2);
        }
    }
    var opts = this.getCacheOptions(table, options);
    cache.get(key, opts, (err, val) => {
        if (!val) return callback();
        if (ttl2) {
            this.lru.put(key, val, Date.now() + ttl2);
        }
        logger.debug("getCache:", "ipc:", key, opts, 'ttl2:', ttl2);
        callback(val, 1);
    });
}

// Store a record in the cache
db.putCache = function(table, query, options)
{
    var key = options?.cacheKey || this.getCacheKey(table, query, options);
    if (!key) return;
    var val = lib.stringify(query);
    var ttl2 = this.getCache2Ttl(table, options);
    if (ttl2) {
        this.lru.put(key, val, Date.now() + ttl2);
    }
    var opts = this.getCacheOptions(table, options, 1);
    cache.put(key, val, opts);
    logger.debug("putCache:", key, opts, 'ttl2:', ttl2);
}

// Notify or clear cached record, this is called after del/update operation to clear cached version by primary keys
db.delCache = function(table, query, options)
{
    var key = options?.cacheKey || this.getCacheKey(table, query, options);
    if (!key) return;
    var ttl2 = this.getCache2Ttl(table, options);
    if (ttl2) {
        this.lru.del(key);
    }
    var opts = this.getCacheOptions(table, options, 1);
    cache.del(key, opts);
    logger.debug("delCache:", key, opts, 'ttl2:', ttl2);
}

// Returns concatenated values for the primary keys, this is used for caching records by primary key
db.getCacheKey = function(table, query, options)
{
    if (options?.cacheKey) return options.cacheKey;
    var keys = this.getKeys(table, options).filter((x) => (query[x])).map((x) => (query[x])).join(this.separator);
    if (keys) keys = (options?.cachePrefix || db.alias(table)) + this.separator + keys;
    return keys;
}

// Setup common cache properties
db.getCacheOptions = function(table, options, update)
{
    table = this.alias(table);
    var ttl = options?.cacheTtl || this.cacheTtl[table] || this.cacheTtl.default;
    var cacheName = options?.cacheName ||
                    (update ? options?.pool && this.cacheUpdate[options.pool + "." + table] || this.cacheUpdate[table] || this.cacheUpdate["*"]: "") ||
                    options?.pool && this.cacheName[options.pool + "." + table] || this.cacheName[table] || this.cacheName["*"];
    if (ttl || cacheName) return { cacheName: cacheName, ttl: ttl };
    return null;
}

// Return TTL for level 2 cache, negative means use js cache
db.getCache2Ttl = function(table, options)
{
    table = this.alias(table);
    var pool = this.getPool(options);
    return this.cache2[pool.name + "-" + table] || this.cache2[table];
}

// Return a list of global cache keys, if a name is given only returns the matching key
db.getCacheKeys = function(table, query, name)
{
    table = this.alias(table);
    var keys = table && query ? this.cacheKeys[table] : null, rc = [];
    for (var p in keys) {
        var key = !name || p == name ? keys[p].map((x) => (query[x])).join(":") : null;
        if (key) rc.push(table + ":" + p + ":" + key);
    }
    return rc;
}

// Delete all global cache keys for the table record
db.delCacheKeys = function(req, result, options, callback)
{
    var cached = req.table && req.obj && (options?.cached || this.cacheTables.includes(req.table));
    var keys = [];

    switch (req.op) {
    case "add":
        keys = this.getCacheKeys(req.table, req.obj);
        break;
    case "put":
    case "update":
    case "incr":
        keys = this.getCacheKeys(req.table, req.obj);
        if (cached) keys.push(this.getCacheKey(req.table, req.obj, options));
        if (options?.returning == "*" && result?.length) keys.push.apply(keys, this.getCacheKeys(req.table, result[0]));
        break;
    case "del":
        keys = this.getCacheKeys(req.table, req.obj);
        if (cached) keys.push(this.getCacheKey(req.table, req.obj, options));
        if (options?.returning && result?.length) keys.push.apply(keys, this.getCacheKeys(req.table, result[0]));
        break;
    }
    if (!keys.length) return lib.tryCall(callback, NaN);

    var ttl2 = this.getCache2Ttl(req.table, options);
    if (ttl2) {
        for (const i in keys) this.lru.del(keys[i]);
    }
    var opts = this.getCacheOptions(req.table, options, 1);
    logger.debug("delCacheKeys:", keys, opts, options);
    cache.del(keys, opts, callback);
}

