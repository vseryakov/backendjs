//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var util = require('util');
var url = require('url');
var fs = require('fs');
var path = require('path');
var cluster = require('cluster');
var events = require("events");
var utils = require(__dirname + '/build/Release/backend');
var logger = require(__dirname + '/logger');
var core = require(__dirname + '/core');
var lib = require(__dirname + '/lib');
var metrics = require(__dirname + '/metrics');
var Client = require(__dirname + "/lib/ipc_client");

// IPC communications between processes and support for caching and subscriptions via queues.
// The module is EventEmitter and emits messages received.
//
// Local cache is implemented as LRU cached configued with `-lru-max` parameter defining how many items to keep in the cache.
//
// Some drivers may support TTL so global `options.ttl` or local `options.ttl` can be used for `put/incr` operqtions and it will honored if it is suported.
//
// Cache methods accept `options.cacheName` property which may specify non-default cache to use by name, this is for cases when multiple cache
// providers are configured.
//
// Queue methods use `options.queueName` for non-default queue.
//
function ipc()
{
    events.EventEmitter.call(this);
    this.role = ""
    this.msgs = {}
    this._queue = [];
    this.workers = []
    this.modules = []
    this.clients = { cache: new Client(), queue: new Client() };
    // Use shared token buckets inside the server process, reuse the same object so we do not generate
    // a lot of short lived objects, the whole operation including serialization from/to the cache is atomic.
    this.tokenBucket = new metrics.TokenBucket()

    // Config params
    this.configParams = {};
    this.args = [ { name: "lru-max", type: "callback", callback: function(v) {utils.lruInit(lib.toNumber(v,{min:10000}))}, descr: "Max number of items in the LRU cache, this cache is managed by the master Web server process and available to all Web processes maintaining only one copy per machine, Web proceses communicate with LRU cache via IPC mechanism between node processes" },
                 { name: "cache-?([a-z0-1]+)?", obj: "configParams", descr: "An URL that points to the cache server in the format `PROTO://HOST[:PORT]?PARAMS`, to use for caching in the API/DB requests, default is local LRU cache, multiple caches can be defined with unique names" },
                 { name: "cache-?([a-z0-1]+)-options", obj: "configParams", type: "json", descr: "JSON object with options to the cache client, specific to each implementation" },
                 { name: "queue-?([a-z0-1]+)?", obj: "configParams", descr: "An URL that points to the queue server in the format `PROTO://HOST[:PORT]?PARAMS`, to use for PUB/SUB or job queues, default is no local queue, multiple queues can be defined with unique names" },
                 { name: "queue-?([a-z0-1]+)?-options", obj: "configParams", type: "json", descr: "JSON object with options to the queue client, specific to each implementation" },
         ];
}

util.inherits(ipc, events.EventEmitter);

module.exports = new ipc();

ipc.prototype.handleWorkerMessages = function(msg)
{
    if (!msg) return;
    logger.dev('handleWorkerMessages:', msg)
    lib.runCallback(this.msgs, msg);

    try {
        switch (msg.__op || "") {
        case "api:restart":
            core.modules.api.shutdown(function() { process.exit(0); });
            break;

        case "worker:restart":
            if (cluster.isWorker) core.runMethods("shutdownWorker", function() { process.exit(0); });
            break;

        case "cache:init":
            this.initClients("cache");
            break;

        case "queue:init":
            this.initClients("queue");
            break;

        case "dns:init":
            core.loadDnsConfig();
            break;

        case "config:init":
            core.modules.db.initConfig();
            break;

        case "columns:init":
            core.modules.db.cacheColumns();
            break;

        case "profiler:start":
        case "profiler:stop":
            core.profiler("cpu", msg.__op.split(":").pop());
            break;

        case "heapsnapshot":
            core.profiler("heap", "save");
            break;
        }
        this.emit(msg.__op, msg);
    } catch(e) {
        logger.error('handleWorkerMessages:', e.stack, msg);
    }
}

// To be used in messages processing that came from the clients or other way
ipc.prototype.handleServerMessages = function(worker, msg)
{
    if (!msg) return false;
    logger.dev('handleServerMessages:', msg);
    try {
        switch (msg.__op) {
        case "api:restart":
            // Start gracefull restart of all api workers, wait till a new worker starts and then send a signal to another in the list.
            // This way we keep active processes responding to the requests while restarting
            if (this.workers.length) break;
            for (var p in cluster.workers) this.workers.push(cluster.workers[p].pid);

        case "api:ready":
            // Restart the next worker from the list
            if (!this.workers.length) break;
            for (var p in cluster.workers) {
                var idx = this.workers.indexOf(cluster.workers[p].pid);
                if (idx == -1) continue;
                this.workers.splice(idx, 1);
                cluster.workers[p].send({ __op: "api:restart" });
                return;
            }
            break;

        case "worker:restart":
            for (var p in cluster.workers) cluster.workers[p].send(msg);
            break;

        case "queue:init":
            this.initClients("queue");
            for (var p in cluster.workers) cluster.workers[p].send(msg);
            break;

        case "config:init":
            core.modules.db.initConfig();
            for (var p in cluster.workers) cluster.workers[p].send(msg);
            break;

        case "columns:init":
            core.modules.db.cacheColumns();
            for (var p in cluster.workers) cluster.workers[p].send(msg);
            break;

        case "dns:init":
            core.loadDnsConfig();
            for (var p in cluster.workers) cluster.workers[p].send(msg);
            break;

        case "rlimits:check":
            msg.consumed = this.checkRateLimits(msg);
            worker.send(msg);
            break;

        case "cache:init":
            this.initClients("cache");
            for (var p in cluster.workers) cluster.workers[p].send(msg);
            break;

        case 'cache:stats':
            msg.value = utils.lruStats();
            worker.send(msg);
            break;

        case 'cache:keys':
            msg.value = utils.lruKeys(msg.name);
            worker.send(msg);
            break;

        case 'cache:get':
            if (Array.isArray(msg.name)) {
                msg.value = {};
                for (var i = 0; i < msg.name.length; i++) {
                    msg.value[msg.name[i]] = utils.lruGet(msg.name[i]);
                }
            } else
            if (msg.name) {
                msg.value = utils.lruGet(msg.name);
                // Set initial value if does not exist or empty
                if (!msg.value && msg.set) {
                    utils.lruPut(msg.name, msg.value = msg.set);
                    delete msg.set;
                }
            }
            worker.send(msg);
            break;

        case 'cache:exists':
            if (msg.name) msg.value = utils.lruExists(msg.name);
            worker.send(msg);
            break;

        case 'cache:put':
            if (msg.name && msg.value) utils.lruPut(msg.name, msg.value);
            if (msg.__res) worker.send(msg);
            break;

        case 'cache:incr':
            if (msg.name && msg.value) msg.value = utils.lruIncr(msg.name, msg.value);
            if (msg.__res) worker.send(msg);
            break;

        case 'cache:del':
            if (msg.name) utils.lruDel(msg.name);
            if (msg.__res) worker.send(msg);
            break;

        case 'cache:clear':
            if (msg.name) {
                utils.lruKeys(msg.name).forEach(function(x) { utils.lruDel(x) });
            } else {
                utils.lruClear();
            }
            if (msg._res) worker.send({});
            break;

        case 'queue:push':
            this._queue.push(msg.value);
            break;

        case 'queue:pop':
            msg.value = this._queue.pop();
            worker.send(msg);
            break;
        }
        this.emit(msg.__op, msg);
    } catch(e) {
        logger.error('handleServerMessages:', e.stack, msg);
    }
}

// Returns an IPC message object, `msg` must be an object if given
ipc.prototype.newMsg = function(op, msg, options)
{
    return lib.extendObj(msg, "__op", op);
}

// Wrapper around EventEmitter `emit` call to send unified IPC messages in the same format
ipc.prototype.emitMsg = function(op, msg, options)
{
    if (!op) return;
    this.emit(op, this.newMsg(op, msg, options));
}

// Send a message to the master process via IPC messages, callback is used for commands that return value back
//
// - the msg object must have `op` property which defines what kind of operation to perform.
// - the `timeout` property can be used to specify a timeout for how long to wait the reply, if not given the default is used
// - the rest properties are optional and depend on the operation.
//
// If called inside the server, it process the message directly, reply is passed in the callback if given.
//
// Examples:
//
//        ipc.sendMsg("op1", { data: "data" }, { timeout: 100 })
//        ipc.sendMsg("op1", { name: "name", value: "data" }, function(data) { console.log(data); })
//        ipc.sendMsg("op1", { 1: 1, 2: 2 }, { timeout: 100 })
//        ipc.sendMsg("op1", { 1: 1, 2: 2 }, function(data) { console.log(data); })
//
ipc.prototype.sendMsg = function(op, msg, options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    msg = this.newMsg(op, msg, options);

    if (!cluster.isWorker) {
        if (this.role == "server") this.handleServerMessages({ send: lib.noop }, msg);
        return typeof callback == "function" ? callback(msg) : null;
    }

    if (typeof callback == "function") {
        msg.__res = true;
        lib.deferCallback(this.msgs, msg, function(m) { callback(m); }, options && options.timeout);
    }
    try { process.send(msg); } catch(e) { logger.error('send:', e, msg); }
}

// This function is called by the Web master server process to setup IPC channels and support for cache and messaging
ipc.prototype.initServer = function()
{
    var self = this;
    this.role = "server";
    this.initClients("cache");
    this.initClients("queue");

    cluster.on("exit", function(worker, code, signal) {
        self.emitMsg("cluster:exit", { id: worker.id, pid: worker.pid });
    });

    // Handle messages from the workers
    cluster.on('fork', function(worker) {
        worker.on('message', function(msg) {
            self.handleServerMessages(worker, msg);
        });
    });
}

// This function is called by Web worker process to setup IPC channels and support for cache and messaging
ipc.prototype.initWorker = function()
{
    var self = this;
    this.role = "worker";
    this.initClients("cache");
    this.initClients("queue");

    // Handle messages from the master
    process.on("message", function(msg) {
        self.handleWorkerMessages(msg);
    });
}

// Return a new client for the given host or null if not supported
ipc.prototype.createClient = function(host, options)
{
    var client = null;
    try {
        for (var i in this.modules) {
            client = this.modules[i].createClient(host, options);
            if (client) {
                if (!client.name) client.name = this.modules[i].name;
                break;
            }
        }
    } catch(e) {
        logger.error("ipc.createClient:", host, e.stack);
    }
    return client;
}

// Return a cache or queue client by name if specifie din the options or use default client for the prefix
ipc.prototype.getClient = function(prefix, options)
{
    return options && options[prefix + 'Name'] ? this.clients[options[prefix + 'Name']] : this.clients[prefix];
}

// Initialize a client for cache or queue purposes, previous client will be closed.
ipc.prototype.initClients = function(prefix)
{
    for (var name in this.configParams) {
        if (!name.match("^" + prefix) || name.match(/Options$/)) continue;
        var client = this.createClient(this.configParams[name] || "", this.configParams[name + 'Options'] || {});
        if (client) {
            try {
                if (this.clients[name]) this.clients[name].close();
            } catch(e) {
                logger.error("ipc.initClient:", name, e.stack);
            }
            this.clients[name] = client;
        }
    }
}

// Returns the cache statistics, the format depends on the cache type used
ipc.prototype.stats = function(options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (typeof callback != "function") return this;
    logger.dev("ipc.stats", options);
    try {
        this.getClient("cache", options).stats(options, callback);
    } catch(e) {
        logger.error('ipc.stats:', e.stack);
        callback({});
    }
    return this;
}

// Returns in the callback all cached keys or if pattern is given can return only matched keys according to the
// cache implementation, options is an object passed down to the driver as is
ipc.prototype.keys = function(pattern, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (typeof callback != "function") return this;
    logger.dev("ipc.keys", pattern, options);
    try {
        this.getClient("cache", options).keys(typeof pattern == "string" && pattern, callback);
    } catch(e) {
        logger.error('ipc.keys:', pattern, e.stack);
        callback({});
    }
    return this;
}

// Clear all or only items that match the given pattern
ipc.prototype.clear = function(pattern, options)
{
    logger.dev("ipc.clear", pattern, options);
    try {
        this.getClient("cache", options).clear(typeof pattern == "string" && pattern);
    } catch(e) {
        logger.error('ipc.clear:', pattern, e.stack);
    }
    return this;
}

// Retrieve an item from the cache by key.
// If `options.set` is given and no value exists in the cache it will be set as the initial value.
//
// Example
//
//    ipc.get("my:key", function(data) { console.log(data) });
//    ipc.get("my:counter", { init: 10 }, function(data) { console.log(data) });
//
ipc.prototype.get = function(key, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    logger.dev("ipc.get", key, options);
    try {
        var client = options && options.cacheName ? this.clients[options.cacheName] : this.clients.cache;
        client.get(key, options, callback);
    } catch(e) {
        logger.error('ipc.get:', e.stack);
        callback();
    }
    return this;
}

// Delete an item by key
ipc.prototype.del = function(key, options)
{
    logger.dev("ipc.del", key, options);
    try {
        this.getClient("cache", options).del(key, options);
    } catch(e) {
        logger.error('ipc.del:', e.stack);
    }
    return this;
}

// Replace or put a new item in the cache, options.ttl can be passed if the driver supprts it.
ipc.prototype.put = function(key, val, options)
{
    logger.dev("ipc.put", key, val, options);
    try {
        this.getClient("cache", options).put(key, val, options);
    } catch(e) {
        logger.error('ipc.put:', e.stack);
    }
    return this;
}

// Increase/decrease a counter in the cache by `val`, non existent items are treated as 0, if a callback is given new value will be returned
ipc.prototype.incr = function(key, val, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    logger.dev("ipc.incr", key, val, options);
    try {
        this.getClient("cache", options).incr(key, lib.toNumber(val), options, callback);
    } catch(e) {
        logger.error('ipc.incr:', e.stack);
        if (typeof callback == "function") callback(0);
    }
    return this;
}

// Subscribe to a publish or queue server for messages for the given channel, the callback will be called only on new message received.
//
// The callback accepts 2 arguments, a message and optional next callback, if it is provided it must be called at the end to confirm or reject the message processing.
// Only errors with code>=500 will result in rejection, not ll drivers support the next callback if the underlying queue does not support message acknowledgement.
//
// Depending on the implementation, the subscription can work as fan-out, delivering messages to all subscribed to the same channel or
// can implement job queue model where only one subscriber receives a message.
//
// For cases when the `next` callback is provided this means the queue implementation requires an acknowledgement of successful processing,
// returning an error with .status >= 500 will keep the message in the queue to be processed later.

//
//  Example:
//
//          ipc.subscribe("alerts", function(msg, next) {
//              req.res.json(data);
//              if (next) next();
//          }, req);
//
ipc.prototype.subscribe = function(channel, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    logger.dev("ipc.subscribe", channel, options);
    try {
        this.getClient("queue", options).subscribe(channel, options, callback);
    } catch(e) {
        logger.error('ipc.subscribe:', channel, e.stack);
    }
    return this;
}

// Close a subscription, if no callback is provided all listeners for the key will be unsubscribed, otherwise only the specified listener.
// The callback will not be called.
// It keeps a count how many subscribe/unsubscribe calls been made and stops any internal listeners once nobody is
// subscribed. This is specific to a queue which relies on polling.
ipc.prototype.unsubscribe = function(channel, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    logger.dev("ipc.unsubscribe", channel, options);
    try {
        this.getClient("queue", options).unsubscribe(channel, options, callback);
    } catch(e) {
        logger.error('ipc.unsubscribe:', channel, e.stack);
    }
    return this;
}

// Publish an event to the channel, if no `options.queueName` is specified then it is sent to the default queue
ipc.prototype.publish = function(channel, msg, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    logger.dev("ipc.publish", channel, options);
    try {
        this.getClient("queue", options).publish(channel, msg, options, callback);
    } catch(e) {
        logger.error('ipc.publish:', channel, e.stack);
    }
    return this;
}

// Queue specific monitor services that must be run in the master process, this is intended to perform
// queue cleanup or dealing with stuck messages
ipc.prototype.monitor = function(options)
{
    logger.dev("ipc.monitor", options);
    try {
        this.getClient("queue", options).monitor(options);
    } catch(e) {
        logger.error('ipc.monitor:', e.stack);
    }
    return this;
}

// A Javascript object `msg` must have the following properties:
// - name - unique id, can be IP address, account id, etc...
// - rate, max, interval - same as for `metrics.TokenBucket` rate limiter.
//
// Returns true if consumed or false otherwise, if callback
// is given, call it with the consumed flag as first argument.
//
// Keeps the token bucket in the LRU local cache by name, this is supposed to be used on the server, not concurrently by several clients.
ipc.prototype.checkRateLimits = function(msg, callback)
{
    var data = utils.lruGet(msg.name);
    this.tokenBucket.configure(data ? lib.strSplit(data) : msg);
    // Reset the bucket if any number has been changed, now we have a new rate to check
    if (!this.tokenBucket.equal(msg.rate, msg.max, msg.interval)) this.tokenBucket.configure(msg);

    var consumed = this.tokenBucket.consume(msg.consume || 1);
    utils.lruPut(msg.name, this.tokenBucket.toString());

    logger.debug("checkRateLimits:", msg.name, consumed, this.tokenBucket);
    if (typeof callback == "function") callback(consumed);
    return consumed;
}

// Implementation of a timer with the lock, only one instance can lock something for some period of time(interval) and will expire after timeout, all other
// attempts to lock the timer will fail. A timer is named and optional properties in the options can specify the `interval` and `timeout` in milliseconds, the
// defaults are 1 min and 1 hour accordingly.
//
// This is intended to be used for background job processing or something similar when
// only on instrance is needed to run. At the end of the processing `clearTimer` must be called to enable another instance immediately,
// otherwise it will be available sfter the timeout only.
//
// The callback must be passed which will take one boolean argument, if true is retuned the timer has been locked by the caller, otherwise it is already locked by other
// instance.
//
// Note: The implementaton uses the currently configured cache system.
ipc.prototype.checkTimer = function(name, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {};

    var now = Date.now();
    var interval = options.interval || 60000;
    var timeout = options.timeout || 3600000;

    this.get(name + ":t", options, function(t) {
        var d = now - lib.toNumber(t);
        logger.debug("checkTimer:", name, "interval:", interval, "time:", d, t);
        if (!options.force && t < interval) return callback(false);

        self.incr(name + ":n", 1, options, function(n) {
            logger.debug("checkTimer:", name, "timeout:", timeout, "time:", d, "counter:", n);
            if (!options.force && n > 1 && t < timeout) return callback(false);
            self.put(name + ":t", now, options);
            callback(true);
        })
    });
    return this;
}

// Reset the timer so it can be locked immediately.
ipc.prototype.resetTimer = function(name)
{
    this.put(name + ":t", Date.now());
    this.put(name + ":n", "0");
    return this;
}

