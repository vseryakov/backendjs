//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const logger = require(__dirname + '/logger');
const lib = require(__dirname + '/lib');
const metrics = require(__dirname + '/metrics');
const Client = require(__dirname + "/cache/client");

// Cache module for shared cache, jobs, events and subscriptions.
//
// Each driver can only implement subset of the cache interface, for example rate limiter only(local), or job queue only(SQS).
//
// Some drivers (Redis) may support TTL so global `options.ttl` or local `options.ttl` can be used for `put/incr` operations and it will honored if it is suported.
//
// For caches that support maps, like Redis the `options.mapName` can be used with get/put/incr/del to
// work with maps and individual keys inside maps.
//
// All methods use `options.queueName` for `options.cacheName` or non-default queue or cache.
// If it is an array then a client will be picked sequentially by maintaining internal sequence number.
//
// To specify a channel within a queue use the format `queueName#channelName`,
// for drivers that support multiple channels like NATS/Redis the channel will be used for another subscription within the same connection.
//
// For drivers (NATS) that support multiple consumers the full queue syntax is `queueName#channelName@groupName` or `queueName@groupName`,
// as well as the `groupName` property in the subscribe options.
//
// Empty `default` client always exists, it can be overridden to make default some other driver

const mod = {
    name: "cache",

    args: [
        { name: "config", obj: "_config", type: "json", merge: 1, descr: 'An object with driver configs, an object with at least url or an url string, ex: `-cache-config {"redis":{"url":redis://localhost","count":1},"nats":"nats://localhost:4222"}`' },
        { name: "([a-z0-9]+)-options$", obj: "_config.$1", type: "map", merge: 1, maptype: "auto", onupdate: function(v,o) {this.applyOptions(v,o)}, descr: "Additional parameters for clients, specific to each implementation, ex: `-cache-redis-options count:10,interval:100`" },
        { name: "([a-z0-9]+)-options-(.+)", obj: "_config.$1", make: "$2", camel: '-', autotype: 1, onupdate: function(v,o) {this.applyOptions(v,o)}, descr: "Additional parameters for clients, specific to each implementation, ex: `-cache-default-options-count 10`" },
        { name: "([a-z0-9]+)", obj: "_config.$1", make: "url", nocamel: 1, onupdate: function(v,o) {this.applyOptions(v,o)}, descr: "An URL that points to a cache/queue server in the format `PROTO://HOST[:PORT]?PARAMS`, multiple clients can be defined with unique names, all params starting with `bk-` will be copied into the options without the prefix and removed from the url, the rest of params will be left in the url, ex: `-cache-redis redis://localhost?bk-count=3&bk-ttl=3000`" },
    ],

    _queue: [],
    _nameIndex: 0,

    modules: [],
    clients: { default: new Client() },

    tokenBucket: new metrics.TokenBucket(),
    lru: new lib.LRUCache(),

    // Config params
    _config: {
        local: "local://",
        worker: "worker://",
    },
};

module.exports = mod;

mod.applyOptions = function(val, options)
{
    if (!options.obj) return;
    logger.debug("applyOptions:", options.obj, options.name, "NEW:", options.context);
    var d = lib.strSplit(options.obj, ".");
    var client = d[0] == "_config" && this.getClient(d[1]);
    if (client?.queueName != (d[1] || "default")) return;
    logger.debug("applyOptions:", client.queueName, options.obj, options.name, "OLD:", client.options);
    if (options.name == "url" && typeof val == "string") client.url = val;
    client.applyOptions(options.context);
}

// Initialize missing or new clients, existing clients stay the same
mod.checkConfig = function()
{
    for (const name in this._config) {
        if (!name) continue;
        if (!this.clients[name]) {
            var opts = this._config[name];
            if (typeof opts == "string") opts = { url: opts };
            var client = this.createClient(opts);
            if (client) {
                client.queueName = name;
                this.clients[name] = client;
                logger.info("checkConfig:", mod.name, name, client.name, "added");
            }
        }
    }
}

// Return a new client for the given host or null if not supported
mod.createClient = function(options)
{
    var client = null;
    try {
        for (const i in this.modules) {
            client = this.modules[i].createClient(options);
            if (client) {
                if (!client.name) client.name = this.modules[i].name;
                client.applyReservedOptions(options);
                break;
            }
        }
    } catch (e) {
        logger.error("createClient:", mod.name, options, e.stack);
    }
    return client;
}

// Return a cache or queue client by name if specified in the options or use default client which always exists,
// use `queueName` or `cacheName` to specify a specific driver.
// If it is an array it will rotate items sequentially.
mod.getClient = mod.getQueue = mod.getCache = function(options)
{
    var client, name = Array.isArray(options) || typeof options == "string" ? options : options?.queueName || options?.cacheName;
    if (name) {
        if (Array.isArray(name)) {
            if (name.length > 1) {
                name = name[this._nameIndex++ % name.length];
                if (this._nameIndex >= Number.MAX_SAFE_INTEGER) this._nameIndex = 0;
            } else {
                name = name[0];
            }
        }
        if (typeof name == "string") {
            var h = name.indexOf("#");
            if (h > -1) name = name.substr(0, h);
        }
        client = this.clients[name];
    }
    return client || this.clients.default;
}

// Initialize a client for cache or queue purposes, previous client will be closed.
mod.initClients = function()
{
    for (const name in this._config) {
        if (!name) continue;
        var opts = this._config[name];
        if (typeof opts == "string") opts = { url: opts };
        var client = this.createClient(opts);
        if (client) {
            try {
                if (this.clients[name]) this.clients[name].close();
            } catch (e) {
                logger.error("initClient:", mod.name, name, e.stack);
            }
            client.queueName = name;
            this.clients[name] = client;
        }
    }
}

// Close all existing clients except empty local client
mod.closeClients = function()
{
    for (const name in this.clients) {
        this.clients[name].close();
        delete this.clients[name];
    }
    this.clients.default = new Client();
}

// Returns the cache statistics, the format depends on the cache type used, for queues it returns a property 'queueCount' with currently
// visible messages in the queue, 'queueRunning' with currently in-flight messages
mod.stats = function(options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    logger.dev("cache.stats:", options);
    try {
        this.getClient(options).stats(options || {}, typeof callback == "function" ? callback : undefined);
    } catch (e) {
        logger.error('cache.stats:', e.stack);
        if (typeof callback == "function") callback(e);
    }
    return this;
}

// Clear all or only items that match the given pattern
mod.clear = function(pattern, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    logger.dev("cache.clear:", pattern, options);
    try {
        this.getClient(options).clear(typeof pattern == "string" && pattern, typeof callback == "function" ? callback : undefined);
    } catch (e) {
        logger.error('cache.clear:', pattern, e.stack);
        if (typeof callback == "function") callback(e);
    }
    return this;
}

// Retrieve an item from the cache by key.
//
// - `options.del` is given then it will delete the key after returning, i.e. Redis GETDEL op
// - `options.set` is given and no value exists in the cache it will be set as the initial value, still
//  nothing will be returned to signify that a new value assigned.
// - `options.mapName` defines a map from which the key will be retrieved if the cache supports maps, to get the whole map
//  the key must be set to *
// - `options.listName` defines a map from which to get items, if a key is given it will return 1 if it belongs to the list,
//  if no key is provided it will return an array with 2 elements:  [a random key, the length of the list], to get the whole list specify * as the key. Specifying
//  `del` in the options will delete returned items from the list.
// - `options.ttl` can be used with lists with `del` and empty key, in such case all popped up keys will be saved in
//   the cache with specified time to live, when being popped up every key is checked if it has been served already, i.e.
//   it exists in the cache and not expired yet, such keys are ignored and only never seen keys are returned
// - `options.datatype` specifies that the returned value must be converted into the specified type using `lib.toValue`
//
// If the `key` is an array then it returns an array with values for each key, for non existent keys an empty
// string will be returned. For maps only if the `key` is * it will return the whole object, otherwise only value(s)
// are returned.
//
//
// Example
//
//    cache.get(["my:key1", "my:key2"], function(err, data) { console.log(data) });
//    cache.get("my:key", function(err, data) { console.log(data) });
//    cache.get("my:counter", { set: 10 }, function(err, data) { console.log(data) });
//    cache.get("*", { mapName: "my:map" }, function(err, data) { console.log(data) });
//    cache.get("key1", { mapName: "my:map" }, function(err, data) { console.log(data) });
//    cache.get(["key1", "key2"], { mapName: "my:map" }, function(err, data) { console.log(data) });
//    cache.get(["key1", "key2"], { listName: "my:list" }, function(err, data) { console.log(data) });
//    cache.get("", { listName: "my:list", del: 1 }, function(err, data) { console.log(data) });
//    cache.get("", { listName: "my:list", del: 1, ttl: 30000 }, function(err, data) { console.log(data) });
//
mod.get = function(key, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    logger.dev("cache.get:", key, options);
    try {
        const client = this.getClient(options);
        const _timer = client.metrics.req.start();
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
    return this;
}

// Delete an item by key(s),  if `key` is an array all keys will be deleted at once atomically if supported
// - `options.mapName` defines a map from which the counter will be deleted if the cache supports maps, to delete the whole map
//  the key must be set to *
// - `options.listName` defines a list from which an item should be removed
//
// Example:
//
//        cache.del("my:key")
//        cache.del("key1", { mapName: "my:map" })
//        cache.del("*", { mapName: "my:map" })
//        cache.del("1", { listName: "my:list" })
//
mod.del = function(key, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    logger.dev("cache.del:", key, options);
    try {
        this.getClient(options).del(key, options || {}, typeof callback == "function" ? callback : undefined);
    } catch (e) {
        logger.error('cache.del:', key, e.stack);
        if (typeof callback == "function") callback(e);
    }
    return this;
}

// Replace or put a new item in the cache.
// - `options.ttl` can be passed in milliseconds if the driver supports it
// - `options.mapName` defines a map where the counter will be stored if the cache supports maps, to store the whole map in one
//  operation the `key` must be set to * and the `val` must be an object
// - `options.setmax` if not empty tell the driver to set this new number only if there is no existing
//   value or it is less that the new number, only works for numeric values
// - `options.listName` defines a list where to add items, `val` can be a value or an array of values, `key` is ignored in this case
//
// Example:
//
//       cache.put("my:key", 2)
//       cache.put("my:key", 1, { setmax: 1 })
//       cache.put("key1", 1, { mapName: "my:map" })
//       cache.put("*", { key1: 1, key2: 2 }, { mapName: "my:map" })
//       cache.put("", [1,2,3], { listName: "my:list" })
//
mod.put = function(key, val, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    logger.dev("cache.put:", key, val, options);
    try {
        const client = this.getClient(options);
        const _timer = client.metrics.req.start();
        client.put(key, val, options || {}, (err, val) => {
            _timer.end();
            if (typeof callback == "function") callback(err, val);
        });
    } catch (e) {
        logger.error('cache.put:', key, e.stack);
        if (typeof callback == "function") callback(e);
    }
    return this;
}

// Increase/decrease a counter in the cache by `val`, non existent items are treated as 0, if a callback is given an
// error and the new value will be returned.
// - `options.ttl` in milliseconds can be used if the driver supports it
// - `options.mapName` defines a map where the counter will be stored if the cache supports maps
// - `options.returning` - return old or new map object, if `new or *` it will be the first item in the result array, if `old`` the last
// - if `val` is an object then the key is treated as a map and all numeric properties will be incremented, other properties just set,
//   this is the same as to set key to '*' and define mapName in the options
//
// Example:
//
//        cache.incr("my:key", 1)
//        cache.incr("count", 1, { mapName: "my:map" })
//        cache.incr("my:map", { count: 1, name: "aaa", mtime: Date.now().toString() })
//        cache.incr("*", { count: 1, name: "bbb", mtime: Date.now().toString() }, { mapName: "my:map" })
//
mod.incr = function(key, val, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    logger.dev("cache.incr:", key, val, options);
    try {
        const client = this.getClient(options);
        const _timer = client.metrics.req.start();
        client.incr(key, val, options || {}, (err, val) => {
            _timer.end();
            if (typeof callback == "function") callback(err, options?.returning ? val : lib.toNumber(val));
        });
    } catch (e) {
        logger.error('cache.incr:', key, e.stack);
        if (typeof callback == "function") callback(e);
    }
    return this;
}

// Subscribe to receive messages from the given channel, the callback will be called only on new message received.
//  - `options.queueName` defines the queue, if not specified then it is sent to the default queue
//
//  Example:
//
//          cache.subscribe("alerts", (msg) => {
//              req.res.json(data);
//          }, req);
//
mod.subscribe = function(channel, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    logger.dev("cache.subscribe:", channel, options);
    try {
        this.getClient(options).subscribe(channel, options || {}, typeof callback == "function" ? callback : undefined);
    } catch (e) {
        logger.error('cache.subscribe:', channel, options, e.stack);
    }
    return this;
}

// Close a subscription for the given channel, no more messages will be delivered.
//  - `options.queueName` defines the queue, if not specified then it is sent to the default queue
//
mod.unsubscribe = function(channel, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    logger.dev("cache.unsubscribe:", channel, options);
    try {
        this.getClient(options).unsubscribe(channel, options || {}, typeof callback == "function" ? callback : undefined);
    } catch (e) {
        logger.error('cache.unsubscribe:', channel, e.stack);
    }
    return this;
}

// Publish an event to the channel to be delivered to all subscribers. If the `msg` is not a string it will be stringified.
//  - `options.queueName` defines the queue, if not specified then it is sent to the default queue
//
mod.publish = function(channel, msg, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    logger.dev("cache.publish:", channel, options);
    try {
        if (typeof msg != "string") msg = lib.stringify(msg);
        const client = this.getClient(options);
        const _timer = client.metrics.req.start();
        client.publish(channel, msg, options || {}, (err, val) => {
            _timer.end();
            if (typeof callback == "function") callback(err, val);
        });
    } catch (e) {
        logger.error('cache.publish:', channel, e.stack);
        if (typeof callback == "function") callback(e);
    }
    return this;
}

// Listen for messages from the given queue, the callback will be called only on new message received.
//  - `options.queueName` defines the queue, if not specified then it is sent to the default queue
//
// The callback accepts 2 arguments, a message and optional next callback, if it is provided it must be called at the end to confirm or reject the message processing.
// Only errors with code>=500 will result in rejection, not all drivers support the next callback if the underlying queue does not support message acknowledgement.
//
// Depending on the implementation, this can work as fan-out, delivering messages to all subscribed to the same channel or
// can implement job queue model where only one subscriber receives a message.
// For some cases like Redis this is the same as `subscribe`.
//
// For cases when the `next` callback is provided this means the queue implementation requires an acknowledgement of successful processing,
// returning an error with `err.status >= 500` will keep the message in the queue to be processed later. Special code `600` means to keep the job
// in the queue and report as warning in the log.

//
//  Example:
//
//          cache.subscribeQueue({ queueName: "jobs" }, (msg, next) => {
//              req.res.json(data);
//              if (next) next();
//          }, req);
//
mod.subscribeQueue = function(options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    logger.dev("cache.subscribeQueue:", options);
    try {
        this.getClient(options).subscribeQueue(options || {}, typeof callback == "function" ? callback : undefined);
    } catch (e) {
        logger.error('cache.subscribeQueue:', options, e.stack);
    }
    return this;
}

// Stop listening for message, if no callback is provided all listeners for the key will be unsubscribed, otherwise only the specified listener.
//  - `options.queueName` defines the queue, if not specified then it is sent to the default queue
//
// The callback will not be called.
//
// It keeps a count how many subscribe/unsubscribe calls been made and stops any internal listeners once nobody is
// subscribed. This is specific to a queue which relies on polling.
//
mod.unsubscribeQueue = function(options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    logger.dev("cache.unsubscribeQueue:", options);
    try {
        this.getClient(options).unsubscribeQueue(options || {}, typeof callback == "function" ? callback : undefined);
    } catch (e) {
        logger.error('cache.unsubscribeQueue:', options, e.stack);
    }
    return this;
}

// Submit a message to the queue, if the `msg` is not a string it will be stringified.
//  - `options.queueName` defines the queue, if not specified then it is sent to the default queue
//  - `options.stime` defines when the message should be processed, it will be held in the queue until the time comes
//  - `options.etime` defines when the message expires, i.e. will be dropped if not executed before this time.
//
mod.publishQueue = function(msg, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    logger.dev("cache.publishQueue:", options);
    try {
        if (typeof msg != "string") msg = lib.stringify(msg);
        const client = this.getClient(options);
        const _timer = client.metrics.req.start();
        client.publishQueue(msg, options || {}, (err, val) => {
            _timer.end();
            if (typeof callback == "function") callback(err, val);
        });
    } catch (e) {
        logger.error('cache.publishQueue:', e.stack);
        if (typeof callback == "function") callback(e);
    }
    return this;
}

// Queue specific monitor services that must be run in the master process, this is intended to perform
// queue cleanup or dealing with stuck messages (Redis)
mod.monitorQueue = function(options)
{
    logger.dev("cache.monitorQueue:", options);
    try {
        this.getClient(options).monitorQueue(options || {});
    } catch (e) {
        logger.error('cache.monitorQueue:', e.stack);
    }
    return this;
}

// Queue specific message deletion from the queue in case of abnormal shutdown or job running too long in order not to re-run it after the restart, this
// is for queues which require manual message deletion ofter execution(SQS). Each queue client must maintain the mapping or other means to identify messages,
// the options is the message passed to the listener
mod.unpublishQueue = function(msg, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    logger.dev("cache.unpublishQueue:", msg, options);
    try {
        this.getClient(options).unpublishQueue(msg, options || {}, callback);
    } catch (e) {
        logger.error('cache.unpublishQueue:', e.stack);
        if (typeof callback == "function") callback(e);
    }
    return this;
}

// Check for rate limit using the default or specific queue, by default TokenBucket using local LRU cache is
// used unless a queue client provides its own implementation.
//
// The options must have the following properties:
//  - name - unique id, can be IP address, account id, etc...
//  - max - the maximum burst capacity
//  - rate - the rate to refill tokens
//  - interval - interval for the bucket refills, default 1000 ms
//  - ttl - auto expire after specified ms since last use
//  - reset - if true reset the token bucket if not consumed or the total reached this value if it is a number greater than 1
//  - multiplier - multiply the interval after it consumed all tokens, subsequent checks use the increased interval, fractions supported,
//    if the multiplier is positive then the interval will keep increasing indefinitely, if it is negative the interval will reset to the default
//    value on first successful consumption
//
// The callback takes 2 arguments:
// - `delay` is a number of milliseconds till the bucket can be used again if not consumed, i.e. 0 means consumed.
// - `info` is an object with info about the state of the token bucket after the operation with properties: delay, count, total, elapsed
//
mod.limiter = function(options, callback)
{
    logger.dev("limiter:", options);
    if (typeof callback != "function") return;
    if (!options) return callback(0, {});
    options.rate = lib.toNumber(options.rate, { min: 0 });
    if (!options.rate) return callback(0, {});
    options.max = lib.toClamp(options.max, options.rate, options.max || options.rate);
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
    return this;
}

// Keep checking the limiter until it is clear to proceed with the operation, if there is no available tokens in the bucket
// it will wait and try again until the bucket is filled.
// To support the same interface and ability to abort the loop pass `options.retry` with a number of loops to run before exiting.
//
// The callback will receive the same arguments as `cache.limiter``.
//  `options.retries`` will be set to how many times it tried.
mod.checkLimiter = function(options, callback)
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

// Uses msg.name as a key returns the same message with consumed set to 1 or 0
mod.localLimiter = function(msg)
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

// Implementation of a lock with optional ttl, only one instance can lock it, can be for some period of time and will expire after timeout.
// A lock must be uniquely named and the ttl period is specified by `options.ttl` in milliseconds.
//
// This is intended to be used for background job processing or something similar when
// only one instance is needed to run. At the end of the processing `cache.unlock` must be called to enable another instance immediately,
// otherwise it will be available after the ttl only.
//
// if `options.timeout` is given the function will keep trying to lock for the `timeout` milliseconds.
//
// if `options.set` is given it will unconditionally set the lock for the specified ttl, this is for cases when
// the lock must be active for longer because of the long running task
//
// The callback must be passed which will take an error and a boolean value, if true is returned it means the timer has been locked by the caller,
// otherwise it is already locked by other instance. In case of an error the lock is not supposed to be locked by the caller.
//
// Example:
//
//          cache.lock("my-lock", { ttl: 60000, timeout: 30000 }, function(err, locked) {
//               if (locked) {
//                   ...
//                   cache.unlock("my-lock");
//               }
//          });
//
mod.lock = function(name, options, callback)
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
    return this;
}

// Unconditionally unlock the lock, any client can unlock any lock.
mod.unlock = function(name, options, callback)
{
    logger.dev("cache.unlock:", name, options);
    try {
        this.getClient(options).unlock(name, options || {}, typeof callback == "function" ? callback : undefined);
    } catch (e) {
        logger.error('cache.unlock:', e.stack);
        if (typeof callback == "function") callback(e);
    }
    return this;
}

require(__dirname + "/cache/local")
require(__dirname + "/cache/worker")
require(__dirname + "/cache/redis")
require(__dirname + "/cache/sqs")
require(__dirname + "/cache/nats")
