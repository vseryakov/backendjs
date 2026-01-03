/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const logger = require(__dirname + '/logger');
const lib = require(__dirname + '/lib');
const metrics = require(__dirname + '/metrics');
const Client = require(__dirname + "/cache/client");

/**
 * @module cache
 */

const cache = {
    name: "cache",

    /**
     * @var {ConfigOptions[]} args
     */
    args: [
        { name: "config", obj: "_config", type: "json", merge: 1, onupdate: "checkConfig", descr: 'An object with driver configs, an object with at least url or an url string', example: '-cache-config {"redis":{"url":redis://localhost","count":1},"nats":"nats://localhost:4222"}' },
        { name: "([a-z0-9]+)-options$", obj: "_config.$1", type: "map", merge: 1, onupdate: "applyOptions", descr: "Additional parameters for clients, specific to each implementation", example: "-cache-redis-options count:10,interval:100" },
        { name: "([a-z0-9]+)-options-(.+)", obj: "_config.$1", make: "$2", camel: '-', autotype: 1, onupdate: "applyOptions", descr: "Additional parameters for clients, specific to each implementation", example: "-cache-default-options-count 10" },
        { name: "([a-z0-9]+)", obj: "_config.$1", make: "url", nocamel: 1, onupdate: "applyOptions", descr: "An URL that points to a cache server in the format PROTO://HOST[:PORT]?PARAMS, multiple clients can be defined with unique names, all params starting with bk- will be copied into the options without the prefix and removed from the url, the rest of params will be left in the url", example: "-cache-redis redis://localhost?bk-count=3&bk-ttl=3000" },
    ],

    _nameIndex: 0,

    /** @var {object} - queue modules by type */
    modules: {},

    /** @var {object} - queue live clients by name */
    clients: { default: new Client() },

    tokenBucket: new metrics.TokenBucket(),
    lru: new lib.LRUCache(),

    // Config params
    _config: {
        local: "local://",
        worker: "worker://",
    },
};

/**
 * Cache module for shared cache and subscriptions.
 *
 * Some drivers (Redis) may support TTL so global options.ttl or local options.ttl can be used
 * for put/incr operations and it will be honored if it is suported.
 *
 * For caches that support maps, like Redis the *8options.mapName** can be used with get/put/incr/del to
 * work with maps and individual keys inside maps.
 *
 * All methods use **options.cacheName** for non-default cache.
 * If it is an array then a client will be picked sequentially by maintaining internal sequence number.
 *
 * Empty default client always exists, it can be overridden to make default some other driver
 *
 * To enable stats collection for a cache it must be enabled with config: cache-redis-options-metrics=1
 *
 * The class {@link module:cache.CacheClient} defines the methods that a driver may or may not implement.
 *
 * The url query parameters that start with **bk-** will be extracted from the url and placed in the class **options* object,
 * this is a way to pass special properties without using **cache-options**, the rest of the url parameters will be passed to the driver.
 *
 * @example
 * cache-default=redis://
 * cache-redis=redis://?bk-enable_offline_queue=1
 * cache-config={ "limiter": "local://", "redis": "redis://" }
 */

module.exports = cache;

cache.applyOptions = function(val, options)
{
    if (!options.obj) return;
    logger.debug("applyOptions:", options.obj, options.name, "NEW:", options.context);
    var d = lib.split(options.obj, ".");
    var client = d[0] == "_config" && this.getClient(d[1]);
    if (client?.cacheName != (d[1] || "default")) return;
    logger.debug("applyOptions:", client.cacheName, options.obj, options.name, "OLD:", client.options);
    if (options.name == "url" && typeof val == "string") client.url = val;
    client.applyOptions(options.context);
}

/**
 * Reinitialize a client for cache purposes, previous client will be closed.
 * @memberof module:cache
 * @method initClients
 */
cache.initClients = function()
{
    for (const name in this._config) {
        if (!name) continue;
        var opts = this._config[name];
        if (typeof opts == "string") opts = { url: opts };
        var client = this.createClient(opts);
        if (!client) continue;

        try {
            if (this.clients[name]) this.clients[name].close();
        } catch (e) {
            logger.error("initClient:", cache.name, name, e.stack);
        }
        client.cacheName = name;
        this.clients[name] = client;
    }
}

/**
 * Initialize missing or new clients, existing clients stay the same
 * @memberof module:cache
 * @method checkConfig
 */
cache.checkConfig = function()
{
    for (const name in this._config) {
        if (!name) continue;
        if (this.clients[name]) continue;

        var opts = this._config[name];
        if (typeof opts == "string") opts = { url: opts };
        var client = this.createClient(opts);
        if (!client) continue;

        client.cacheName = name;
        this.clients[name] = client;
        logger.debug("checkConfig:", cache.name, name, client.name, "added");
    }
}

/**
 * Close all existing clients except empty local client
 * @memberof module:cache
 * @method shutdown
 */
cache.shutdown = function(options, callback)
{
    for (const name in this.clients) {
        this.clients[name].close();
        delete this.clients[name];
    }
    this.clients.default = new Client();
    lib.tryCall(callback);
}

/**
 * Return a new client for the given host or null if not supported
 * @memberof module:cache
 * @method createClient
 */
cache.createClient = function(options)
{
    var client = null;
    try {
        var type = lib.split(options?.url, ":")[0];
        if (!type) return;

        var Mod = this.modules[type];
        if (!Mod) {
            Mod = this.modules[type] = require(__dirname + "/cache/" + type);
        }
        if (!Mod) return;
        client = new Mod(options);
        client.applyReservedOptions(options);
    } catch (e) {
        logger.error("createClient:", cache.name, options, e.stack);
    }
    return client;
}

/**
 * Return a cache client by name if specified in the options or use default client which always exists,
 * use cacheName to specify a specific driver.
 * If it is an array it will rotate items sequentially.
 * @param {object} [options]
 * @returns {module:cache.CacheClient}
 * @memberof module:cache
 * @method getClient
 */
cache.getClient = cache.getCache = function(options)
{
    var client, name = Array.isArray(options) || typeof options == "string" ? options : options?.cacheName;
    if (name) {
        if (Array.isArray(name)) {
            if (name.length > 1) {
                name = name[this._nameIndex++ % name.length];
                if (this._nameIndex >= Number.MAX_SAFE_INTEGER) this._nameIndex = 0;
            } else {
                name = name[0];
            }
        }
        client = this.clients[name];
    }
    return client || this.clients.default;
}

/**
 * Returns the cache statistics, the format depends on the cache type used
 * @param {object} [options]
 * @param {function} [callback]
 * @memberof module:cache
 * @method stats
 */
cache.stats = function(options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    logger.dev("cache.stats:", options);
    try {
        this.getClient(options).stats(options || {}, typeof callback == "function" ? callback : undefined);
    } catch (e) {
        logger.error('cache.stats:', e.stack);
        if (typeof callback == "function") callback(e);
    }
}

/**
 * Async version of {@link module:cache.stats}
 * @param {object} [options]
 * @example
 * const { err, data } = await cache.astats();
 * @memberOf module:cache
 * @method astats
 * @async
 */
cache.astats = function(options)
{
    return new Promise((resolve, reject) => {
        cache.stats(options, (err, data) => {
            resolve({ err, data });
        });
    });
}

/**
 * Clear all or only items that match the given pattern
 * @param {string} pattern
 * @param {object} [options]
 * @param {function} [callback]
 * @memberof module:cache
 * @method clear
 */
cache.clear = function(pattern, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    logger.dev("cache.clear:", pattern, options);
    try {
        this.getClient(options).clear(typeof pattern == "string" && pattern, typeof callback == "function" ? callback : undefined);
    } catch (e) {
        logger.error('cache.clear:', pattern, e.stack);
        if (typeof callback == "function") callback(e);
    }
}

/**
 * Async version of {@link module:cache.stats}
 * @param {string} pattern
 * @param {object} [options]
 * @example
 * const { err, data } = await cache.aclear("key:*");
 * @memberOf module:cache
 * @method aclear
 * @async
 */
cache.aclear = function(pattern, options)
{
    return new Promise((resolve, reject) => {
        cache.clear(pattern, options, (err, data) => {
            resolve({ err, data });
        });
    });
}


/**
 * Retrieve an item from the cache by key.
 * @param {string|string[]} key
 * If the key is an array then it returns an array with values for each key, for non existent keys an empty
 * string will be returned. For maps only if the key is * it will return the whole object, otherwise only value(s)
 * are returned.
 * @param {object} [options]
 * @param {boolean} [options.del] is given then it will delete the key after returning, i.e. Redis GETDEL op
 * @param {any} [options.set] if given and no value exists in the cache it will be set as the initial value, still
 *  nothing will be returned to signify that a new value assigned.
 * @param {string} [options.mapName] defines a map from which the key will be retrieved if the cache supports maps, to get the whole map
 *  the key must be set to *
 * @param {string} [options.listName] defines a map from which to get items, if a key is given it will return 1 if it belongs to the list,
 *  if no key is provided it will return an array with 2 elements:  [a random key, the length of the list], to get the whole list specify * as the key. Specifying
 *  del in the options will delete returned items from the list.
 * @param {int} [options.ttl] can be used with lists with del and empty key, in such case all popped up keys will be saved in
 *   the cache with specified time to live, when being popped up every key is checked if it has been served already, i.e.
 *   it exists in the cache and not expired yet, such keys are ignored and only never seen keys are returned
 * @param {string} [options.datatype] specifies that the returned value must be converted into the specified type using lib.toValue
 * @param {function} callback
 *
 * @example
 * cache.get(["my:key1", "my:key2"], function(err, data) { console.log(data) });
 * cache.get("my:key", function(err, data) { console.log(data) });
 * cache.get("my:counter", { set: 10 }, function(err, data) { console.log(data) });
 * cache.get("*", { mapName: "my:map" }, function(err, data) { console.log(data) });
 * cache.get("key1", { mapName: "my:map" }, function(err, data) { console.log(data) });
 * cache.get(["key1", "key2"], { mapName: "my:map" }, function(err, data) { console.log(data) });
 * cache.get(["key1", "key2"], { listName: "my:list" }, function(err, data) { console.log(data) });
 * cache.get("", { listName: "my:list", del: 1 }, function(err, data) { console.log(data) });
 * cache.get("", { listName: "my:list", del: 1, ttl: 30000 }, function(err, data) { console.log(data) });
 * @memberof module:cache
 * @method get
 */
cache.get = function(key, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    logger.dev("cache.get:", key, options);
    try {
        const client = this.getClient(options);
        const _timer = client.metrics.start();
        client.get(key, options || {}, (err, val) => {
            if (!err && options?.datatype) {
                val = Array.isArray(val) ? val = val.map((x) => (lib.toValue(x, options.datatype))) : lib.toValue(val, options.datatype);
            }
            _timer.end();
            if (typeof callback == "function") callback(err, val);
        });
    } catch (e) {
        logger.error('cache.get:', key, e.stack);
        if (typeof callback == "function") callback(e);
    }
}

/**
 * Async version of {@link module:cache.get}
 * @param {string|string[]} key
 * @param {object} [options]
 * @example
 * const { err, data } = await cache.aget("key");
 * @memberOf module:cache
 * @method aget
 * @async
 */
cache.aget = function(key, options)
{
    return new Promise((resolve, reject) => {
        cache.get(key, options, (err, data) => {
            resolve({ err, data });
        });
    });
}


/**
 * Delete an item by key(s),  if key is an array all keys will be deleted at once atomically if supported
 * @param {string} key
 * @param {object} [options]
 * @param {string} [options.mapName] defines a map from which the counter will be deleted if the cache supports maps, to delete the whole map
 *  the key must be set to *
 * @param {string} [options.listName] defines a list from which an item should be removed
 * @param {function} [callback]
 * @example
 * cache.del("my:key")
 * cache.del("key1", { mapName: "my:map" })
 * cache.del("*", { mapName: "my:map" })
 * cache.del("1", { listName: "my:list" })
 * @memberof module:cache
 * @method del
 */
cache.del = function(key, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    logger.dev("cache.del:", key, options);
    try {
        this.getClient(options).del(key, options || {}, typeof callback == "function" ? callback : undefined);
    } catch (e) {
        logger.error('cache.del:', key, e.stack);
        if (typeof callback == "function") callback(e);
    }
}

/**
 * Async version of {@link module:cache.del}
 * @param {string} key
 * @param {object} [options]
 * @example
 * const { err, data } = await cache.adel("key");
 * @memberOf module:cache
 * @method adel
 * @async
 */
cache.adel = function(key, options)
{
    return new Promise((resolve, reject) => {
        cache.del(key, options, (err, data) => {
            resolve({ err, data });
        });
    });
}


/**
 * Replace or put a new item in the cache.
 * @param {string} key
 * @param {string|object} val
 * @param {object} [options]
 * @param {int} [options.ttl] can be passed in milliseconds if the driver supports it
 * @param {string} [options.mapName] defines a map where the counter will be stored if the cache supports maps, to store the whole map in one
 *    operation the key must be empty or * and the val must be an object
 * @param {boolean} [options.setmax] if not empty tell the driver to set this new number only if there is no existing
 *    value or it is less that the new number, only works for numeric values
 * @param {string} [options.listName] defines a list where to add items, val can be a value or an array of values, key is ignored in this case.
 *    Returns an array with 2 items: [added, total] where added is how many iterms just added and the total number of items in the list after the operation.
 * @param {function} [callback]
 * @example
 * cache.put("my:key", 2)
 * cache.put("my:key", 1, { setmax: 1 })
 * cache.put("key1", 1, { mapName: "my:map" })
 * cache.put("*", { key1: 1, key2: 2 }, { mapName: "my:map" })
 * cache.put("", [1,2,3], { listName: "my:list" }, (err, rc) => { })
 * @memberof module:cache
 * @method put
 */
cache.put = function(key, val, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    logger.dev("cache.put:", key, val, options);
    try {
        const client = this.getClient(options);
        const _timer = client.metrics.start();
        client.put(key, val, options || {}, (err, val) => {
            _timer.end();
            if (typeof callback == "function") callback(err, val);
        });
    } catch (e) {
        logger.error('cache.put:', key, e.stack);
        if (typeof callback == "function") callback(e);
    }
}

/**
 * Async version of {@link module:cache.put}
 * @param {string} key
 * @param {string|object} val
 * @param {object} [options]
 * @example
 * const { err, data } = await cache.aput("key", { ... });
 * @memberOf module:cache
 * @method aput
 * @async
 */
cache.aput = function(key, val, options)
{
    return new Promise((resolve, reject) => {
        cache.put(key, val, options, (err, data) => {
            resolve({ err, data });
        });
    });
}


/**
 * Increase/decrease a counter in the cache by val, non existent items are treated as 0, if a callback is given an
 * error and the new value will be returned.
 * @param {string|string[]} key
 * - if key is an array then increment each item in the list with given val number,
 *     in this case ttl can be an array as well with specific ttl per key
 * @param {int|object} val
 * - if val is an object then all numeric properties will be incremented, other properties just set.
 * - if val is an object then either mapName or non empty key is used for map
 * - if val is an object and the key is empty then all properties are treated as standalone items
 * @param {object} [options]
 * @param {int} [options.ttl] in milliseconds can be used if the driver supports it
 * @param {string} [options.mapName] defines a map where the counter will be stored if the cache supports maps
 * @param {string} [options.returning] - return old or new map object, if new or * it will be the first item in the result array, if old the last,
 *    to return all values for multi updates it must be provided, otherwise only first result by default.
 * @param {function} [callback]
 * @example
 * cache.incr("my:key", 1)
 * cache.incr("counter", 1, { mapName: "my:map" })
 * cache.incr("my:map", { count: 1, name: "aaa", mtime: Date.now().toString() })
 * cache.incr("", { count: 1, name: "bbb", mtime: Date.now().toString() }, { mapName: "my:map" })
 * cache.incr("", { "my-key": 1, counter2: 2 })
 * cache.incr([ "my:key", "my:counter"], 1 }, { ttl: [1000, 30000] })
 * @memberof module:cache
 * @method incr
 */
cache.incr = function(key, val, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    logger.dev("cache.incr:", key, val, options);
    try {
        const client = this.getClient(options);
        const _timer = client.metrics.start();
        client.incr(key, val, options || {}, (err, val) => {
            _timer.end();
            if (typeof callback == "function") {
                callback(err, options?.returning ? val || "": lib.toNumber(Array.isArray(val) ? val[0] : val));
            }
        });
    } catch (e) {
        logger.error('cache.incr:', key, e.stack);
        if (typeof callback == "function") callback(e);
    }
}

/**
 * Async version of {@link module:cache.incr}
 * @param {string} key
 * @param {number} val
 * @param {object} [options]
 * @example
 * const { err, data } = await cache.aincr("key", 10);
 * @memberOf module:cache
 * @method aincr
 * @async
 */
cache.aincr = function(key, val, options)
{
    return new Promise((resolve, reject) => {
        cache.incr(key, val, options, (err, data) => {
            resolve({ err, data });
        });
    });
}


/**
 * Check for rate limit using the default or specific cache, by default TokenBucket using local LRU cache is
 * used unless a client provides its own implementation.
 *
 * @param {object} options
 * @param {string} options.name - unique id, can be IP address, account id, etc...
 * @param {int} [options.max - the maximum burst capacity
 * @param {int} options.rate - the rate to refill tokens
 * @param {int} [options.interval - interval for the bucket refills, default 1000 ms
 * @param {int} [options.ttl] - auto expire after specified ms since last use
 * @param {boolean} [options.reset] - if true reset the token bucket if not consumed or the total reached this value if it is a number greater than 1
 * @param {int} [options.multiplier] - multiply the interval after it consumed all tokens, subsequent checks use the increased interval, fractions supported,
 *    if the multiplier is positive then the interval will keep increasing indefinitely, if it is negative the interval will reset to the default
 *    value on first successful consumption
 *
 * @param {function} callback - takes 2 arguments:
 * - delay is a number of milliseconds till the bucket can be used again if not consumed, i.e. 0 means consumed.
 * - info is an object with info about the state of the token bucket after the operation with properties: delay, count, total, elapsed
 * @memberof module:cache
 * @method limiter
 */
cache.limiter = function(options, callback)
{
    logger.dev("limiter:", options);
    if (typeof callback != "function") return;
    if (!options?.name) return callback(0, {});
    options.rate = lib.toNumber(options.rate, { min: 0 });
    if (!options.rate) return callback(0, {});
    options.max = lib.toNumber(options.max, { min: options.rate, max: options.max || options.rate });
    options.interval = lib.toNumber(options.interval, { min: 0, zero: 1000 });
    options.ttl = lib.toNumber(options.ttl, { min: 0 });
    options.reset = lib.toNumber(options.reset);
    options.multiplier = lib.toNumber(options.multiplier);
    try {
        this.getClient(options).limiter(options, callback);
    } catch (e) {
        logger.error('cache.limiter:', e.stack);
        callback(options.interval, {});
    }
}

cache.alimiter = async function(options)
{
    return new Promise((resolve, reject) => {
        cache.limiter(options, (delay, info) => {
            resolve({ delay, info });
        });
    });
}

/**
 * Keep checking the limiter until it is clear to proceed with the operation, if there is no available tokens in the bucket
 * it will wait and try again until the bucket is filled.
 *
 * The callback will receive the same arguments as {@link module:cache.limiter}.
 *  options._retries will be set to how many times it tried.
 * @param {object} options - same as in {@link module:cache.limiter}
 * @param {int} [options.retry] - To never retry pass -1 or number of loops to run before exiting
 * @memberof module:cache
 * @method checkLimiter
 */
cache.checkLimiter = function(options, callback)
{
    options._retries = lib.toNumber(options._retries) + 1;
    this.limiter(options, (delay, info) => {
        logger.debug("checkLimiter:", delay, options, info);
        if (!delay || (options.retry && options._retries >= options.retry)) {
            return callback(delay, info);
        }
        setTimeout(this.checkLimiter.bind(this, options, callback), delay);
    });
}

cache.acheckLimiter = async function(options)
{
    return new Promise((resolve, reject) => {
        cache.checkLimiter(options, (delay, info) => {
            resolve({ delay, info });
        });
    });
}

/**
 * Uses local limiter returns the same message with consumed set to 1 or 0
 * @param {object} msg
 * @param {string} msg.name
 * @returns {object}
 * @memberof module:cache
 * @method localLimiter
 */
cache.localLimiter = function(msg)
{
    var interval = msg.interval;
    var token = this.lru.get(msg.name);
    this.tokenBucket.configure(token || msg);
    if (msg.multiplier && token) msg.interval = this.tokenBucket._interval;
    // Reset the bucket if any number has been changed, now we have a new rate to check
    if (!this.tokenBucket.equal(msg.rate, msg.max, msg.interval)) this.tokenBucket.configure(msg);
    msg.consumed = this.tokenBucket.consume(msg.consume || 1);
    msg.delay = msg.consumed ? 0 : this.tokenBucket.delay(msg.consume || 1);
    msg.total = this.tokenBucket._total;
    msg.count = this.tokenBucket._count;
    msg.elapsed = this.tokenBucket._elapsed;
    if ((msg.delay && msg.reset) || (msg.reset > 1 && msg.total >= msg.reset)) {
        this.lru.del(msg.name);
    } else {
        if (msg.multiplier) {
            if (msg.delay) {
                this.tokenBucket._interval = Math.min(30000000000, this.tokenBucket._interval * Math.abs(msg.multiplier));
                msg.interval = this.tokenBucket._interval;
            } else
            if (msg.multiplier < 0) {
                this.tokenBucket._interval = msg.interval = interval;
            }
        }
        token = this.tokenBucket.toArray();
        this.lru.put(msg.name, token, msg.expire);
    }
    logger.debug("cache:limiter:", msg, token);
    return msg;
}

/**
 * Implementation of a lock with optional ttl, only one instance can lock it, can be for some period of time and will expire after timeout.
 *
 * This is intended to be used for background job processing or something similar when
 * only one instance is needed to run. At the end of the processing {@link module.cache.unlock}
 * must be called to enable another instance immediately, otherwise it will be available after the ttl only.
 *
 * The callback must be passed which will take an error and a boolean value, if true is returned it means the timer has been locked by the caller,
 * otherwise it is already locked by other instance. In case of an error the lock is not supposed to be locked by the caller.
 * @param {string} name - unique lock name
 * @param {object} [options]
 * @param {int} [options.ttl] - ttl period in milliseconds.
 * @param {int} [options.timeout] - if given the function will keep trying to lock for the timeout milliseconds.
 * @param {boolean} [options.set] - if given it will unconditionally set the lock for the specified ttl, this is for cases when
 * the lock must be active for longer because of the long running task
 * @param {function} [callback]
 * @example
 * cache.lock("my-lock", { ttl: 60000, timeout: 30000 }, (err, locked) => {
 *   if (locked) {
 *       ...
 *       cache.unlock("my-lock");
 *   }
 * });
 * @memberof module:cache
 * @method lock
 */
cache.lock = function(name, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    logger.dev("cache.lock:", name, options);
    var self = this, locked = false, delay = 0, timeout = 0;
    var started = Date.now();
    options = options || {};
    lib.doWhilst(
        function(next) {
            try {
                self.getClient(options).lock(name, options, (err, val) => {
                    if (err) return next(err);
                    locked = lib.toBool(val);
                    setTimeout(next, delay);
                });
            } catch (e) {
                next(e);
            }
        },
        function() {
            if (!delay) delay = lib.toNumber(options.delay);
            if (!timeout) timeout = lib.toNumber(options.timeout);
            return !locked && timeout > 0 && Date.now() - started < timeout;
        },
        function(err) {
            if (err) logger.error('cache.lock:', err.stack);
            if (typeof callback == "function") callback(err, locked);
    }, true);
}

/**
 * Async version of {@link module:cache.lock}
 * @param {string} name
 * @param {object} [options]
 * @example
 * const { err, locked } = await cache.alock("key", { ttl: 1000 });
 * @memberOf module:cache
 * @method alock
 * @async
 */
cache.alock = function(name, options)
{
    return new Promise((resolve, reject) => {
        cache.lock(name, options, (err, locked) => {
            resolve({ err, locked });
        });
    });
}


/**
 * Unconditionally unlock the lock by key, any client can unlock any lock.
 * @param {string} name
 * @param {object} [options]
 * @param {function} [callback]
 * @memberof module:cache
 * @method unlock
 */
cache.unlock = function(name, options, callback)
{
    logger.dev("cache.unlock:", name, options);
    try {
        this.getClient(options).unlock(name, options || {}, typeof callback == "function" ? callback : undefined);
    } catch (e) {
        logger.error('cache.unlock:', e.stack);
        if (typeof callback == "function") callback(e);
    }
}

/**
 * Async version of {@link module:cache.unlock}
 * @param {string} name
 * @param {object} [options]
 * @example
 * const { err, data } = await cache.aunlock("key");
 * @memberOf module:cache
 * @method aunlock
 * @async
 */
cache.aunlock = function(name, options)
{
    return new Promise((resolve, reject) => {
        cache.unlock(name, options, (err, data) => {
            resolve({ err, data });
        });
    });
}


cache.configureCollectStats = function(options)
{
    for (let q in this.clients) {
        const cl = this.clients[q];
        if (!cl.options?.metrics) continue;
        const m = cl.metrics.toJSON({ reset: 1 });
        q = cl.cacheName;
        if (m.meter?.count) {
            options.stats["cache_" + q + "_req_count"] = m.meter.count;
            options.stats["cache_" + q + "_req_rate"] = m.meter.rate;
            options.stats["cache_" + q + "_res_time"] = m.histogram.med;
        }
    }
}
