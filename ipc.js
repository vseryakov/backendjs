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

// IPC communications between processes and support for caching and messaging.
// Local cache is implemented as LRU cached configued with `-lru-max` parameter defining how many items to keep in the cache.
function ipc()
{
    events.EventEmitter.call(this);
    this.role = ""
    this.msgs = {}
    this.msgId = 1
    this.workers = []
    this.modules = []
    this.cacheClient = new Client()
    this.queueClient = new Client()
    this.serverQueue = core.name + ":server"
    this.workerQueue = core.name + ":worker"
    // Use shared token buckets inside the server process, reuse the same object so we do not generate
    // a lot of short lived objects, the whole operation including serialization from/to the cache is atomic.
    this.tokenBucket = new metrics.TokenBucket()
}

util.inherits(ipc, events.EventEmitter);

module.exports = new ipc();

ipc.prototype.handleWorkerMessages = function(msg)
{
    if (!msg) return;
    logger.dev('handleWorkerMessages:', msg)
    lib.runCallback(this.msgs, msg);

    try {
        switch (msg.op || "") {
        case "api:restart":
            core.modules.api.shutdown(function() { process.exit(0); });
            break;

        case "init:cache":
            this.closeClient("cache");
            this.initClient("cache");
            break;

        case "init:queue":
            this.closeClient("queue");
            this.initWorkerQueue();
            break;

        case "init:dns":
            core.loadDnsConfig();
            break;

        case "init:config":
            core.modules.db.initConfig();
            break;

        case "init:columns":
            core.modules.db.cacheColumns();
            break;

        case "profiler":
            core.profiler("cpu", msg.value ? "start" : "stop");
            break;

        case "heapsnapshot":
            core.profiler("heap", "save");
            break;
        }
        this.emit(msg.op, msg);
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
        switch (msg.op) {
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
                cluster.workers[p].send({ op: "api:restart" });
                return;
            }
            break;

        case "init:cache":
            for (var p in cluster.workers) cluster.workers[p].send(msg);
            break;

        case "init:queue":
            this.closeClient("queue");
            this.initServerQueue("queue");
            for (var p in cluster.workers) cluster.workers[p].send(msg);
            break;

        case "init:config":
            core.modules.db.initConfig();
            for (var p in cluster.workers) cluster.workers[p].send(msg);
            break;

        case "init:columns":
            core.modules.db.cacheColumns();
            for (var p in cluster.workers) cluster.workers[p].send(msg);
            break;

        case "init:dns":
            core.loadDnsConfig();
            for (var p in cluster.workers) cluster.workers[p].send(msg);
            break;

        case "check:limits":
            msg.value = this.checkLimits(msg);
            worker.send(msg);
            break;

        case 'stats':
            msg.value = utils.lruStats();
            worker.send(msg);
            break;

        case 'keys':
            msg.value = utils.lruKeys();
            worker.send(msg);
            break;

        case 'get':
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

        case 'exists':
            if (msg.name) msg.value = utils.lruExists(msg.name);
            worker.send(msg);
            break;

        case 'put':
            if (msg.name && msg.value) utils.lruPut(msg.name, msg.value);
            if (msg.reply) worker.send(msg);
            break;

        case 'incr':
            if (msg.name && msg.value) msg.value = utils.lruIncr(msg.name, msg.value);
            if (msg.reply) worker.send(msg);
            break;

        case 'del':
            if (msg.name) utils.lruDel(msg.name);
            if (msg.reply) worker.send(msg);
            break;

        case 'clear':
            utils.lruClear();
            if (msg.reply) worker.send({});
            break;
        }
        this.emit(msg.op, msg);
    } catch(e) {
        logger.error('handleServerMessages:', e.stack, msg);
    }
}

// This function is called by the Web master server process to setup IPC channels and support for cache and messaging
ipc.prototype.initServer = function()
{
    var self = this;
    this.role = "server";
    this.initServerQueue();

    cluster.on("exit", function(worker, code, signal) {
        self.emit("cluster:exit", { op: "cluster:exit", id: worker.id, pid: worker.pid });
    });

    cluster.on('fork', function(worker) {
        // Handle cache request from a worker, send back cached value if exists, this method is called inside worker context
        worker.on('message', function(msg) { self.handleServerMessages(worker, msg) });
    });
}

// Setup a queue service to be used inside a server process
ipc.prototype.initServerQueue = function()
{
    var self = this;
    this.initClient("queue");
    // Listen for system messages
    this.queueClient.on("ready", function() {
        self.subscribe(self.serverQueue, function(ctx, key, data, next) {
            self.handleServerMessages({ send: lib.noop }, lib.jsonParse(data, { obj: 1, error: 1 }));
            if (next) next();
        });
    });
}

// This function is called by Web worker process to setup IPC channels and support for cache and messaging
ipc.prototype.initWorker = function()
{
    var self = this;
    this.role = "worker";
    this.initClient("cache");
    this.initWorkerQueue();

    // Event handler for the worker to process response and fire callback
    process.on("message", function(msg) {
        self.handleWorkerMessages(msg);
    });
}

// Setup a queue service to be used inside a worjker process
ipc.prototype.initWorkerQueue = function()
{
    var self = this;
    this.initClient("queue");
    // Listen for system messages
    this.queueClient.on("ready", function() {
        self.subscribe(self.workerQueue, function(ctx, key, data, next) {
            self.handleWorkerMessages(lib.jsonParse(data, { obj: 1, error: 1 }));
            if (next) next();
        });
    });
}

// Return a new client for the given host or null if not supported
ipc.prototype.createClient = function(host, options)
{
    var client = null;
    try {
        for (var i in this.modules) {
            client = this.modules[i].createClient(host, options);
            if (client) break;
        }
    } catch(e) {
        logger.error("ipc.create:", host, e.stack);
    }
    return client;
}

// Initialize a client for cache or queue purposes.
ipc.prototype.initClient = function(type)
{
    var client = this.createClient(core[type + 'Host'] || "", core[type + 'Options'] || {});
    if (client) this[type + 'Client'] = client;
    return client;
}

// Close a client by type, cache or qurue. Make a new empty client so the object is always valid
ipc.prototype.closeClient = function(type)
{
    try {
        this[type + 'Client'].close();
    } catch(e) {
        logger.error("ipc.close:", type, e.stack);
    }
    this[type + 'Client'] = new Client();
}

// Send a command to the master process via IPC messages, callback is used for commands that return value back
//
// - the msg object must have `op` property which defines what kind of operation to perform.
// - the `timeout` property can be used to specify a timeout for how long to wait the reply, if not given the default is used
// - the rest properties are optional and depend on the operation.
//
// If called inside the server, it process the message directly, reply is passed in the callback if given.
ipc.prototype.command = function(msg, callback)
{
    if (!cluster.isWorker) {
        if (this.role == "server") this.handleServerMessages({ send: lib.noop }, msg);
        return callback ? callback(msg.reply ? msg.value : null) : null;
    }

    if (typeof callback == "function") {
        msg.reply = true;
        msg.id = this.msgId++;
        lib.deferCallback(this.msgs, msg, function(m) { callback(m.value); }, msg.timeout);
    }
    try { process.send(msg); } catch(e) { logger.error('send:', e, msg.op, msg.name); }
}

// Always send text to the master, convert objects into JSON, value and callback are optional
ipc.prototype.send = function(op, name, value, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    var msg = { op: op };
    if (name) msg.name = name;
    if (value) msg.value = typeof value == "object" ? lib.stringify(value) : value;
    if (options && options.timeout) msg.timeout = options.timeout;
    this.command(msg, callback);
}

// Returns the cache statistics, the format depends on the cache type used
ipc.prototype.stats = function(callback)
{
    logger.dev("ipc.stats");
    if (typeof callback != "function") return;
    try {
        this.cacheClient.stats(callback);
    } catch(e) {
        logger.error('ipc.stats:', e.stack);
        callback({});
    }
}

// Returns in the callback all cached keys
ipc.prototype.keys = function(callback)
{
    logger.dev("ipc.keys");
    if (typeof callback != "function") return;
    try {
        this.cacheClient.keys(callback);
    } catch(e) {
        logger.error('ipc.keys:', e.stack);
        callback({});
    }
}

// Clear all cached items
ipc.prototype.clear = function()
{
    logger.dev("ipc.clear");
    try {
        this.cacheClient.clear();
    } catch(e) {
        logger.error('ipc.clear:', e.stack);
    }
}

// Retrive an item from the cache by key.
// If `options.set` is given and no value exists in the cache it will be set as the initial value.
//
// Example
//
//    ipc.get("my:key", function(data) { console.log(data) });
//    ipc.get("my:counter", { init: 10 }, function(data) { console.log(data) });
//
ipc.prototype.get = function(key, options, callback)
{
    logger.dev("ipc.get", key);
    if (typeof options == "function") callback = options, options = null;
    try {
        this.cacheClient.get(key, options, callback);
    } catch(e) {
        logger.error('ipc.get:', e.stack);
        callback();
    }
}

// Delete an item by key
ipc.prototype.del = function(key, options)
{
    logger.dev("ipc.del", key, options);
    try {
        this.cacheClient.del(key, options);
    } catch(e) {
        logger.error('ipc.del:', e.stack);
    }
}

// Replace or put a new item in the cache
ipc.prototype.put = function(key, val, options)
{
    logger.dev("ipc.put", key, val, options);
    try {
        this.cacheClient.put(key, val, options);
    } catch(e) {
        logger.error('ipc.put:', e.stack);
    }
}

// Increase/decrease a counter in the cache by `val`, non existent items are treated as 0, if a callback is given new value will be returned
ipc.prototype.incr = function(key, val, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    logger.dev("ipc.incr", key, val, options);
    try {
        this.cacheClient.incr(key, lib.toNumber(val), options, callback);
    } catch(e) {
        logger.error('ipc.incr:', e.stack);
        if (typeof callback == "function") callback(0);
    }
}

// Subscribe to the publishing server for messages starting with the given key, the callback will be called only on new data received, the `data`
// is passed to the callback as first argument, if not specified then "undefined" will still be passed, the actual key will be passed as the second
// argument, the message received as the third argument.
//
// If `next` callback is provided it must be called at the end, not all queue drivers will provide it.
//
// For cases when the `next` callback is provided this means the queue implementation reqires acknowledgement of successful processing,
// returning an error with .status >= 500 will keep the message in the queue to be processed later.

//
//  Example:
//
//          ipc.subscribe("alert:", function(req, key, data, next) {
//              req.res.json(data);
//              if (next) next();
//          }, req);
//
ipc.prototype.subscribe = function(key, callback, data)
{
    logger.dev("ipc.subscribe", key);
    try {
        this.queueClient.subscribe(key, callback, data);
    } catch(e) {
        logger.error('ipc.subscribe:', key, e.stack);
    }
}

// Close a subscription
ipc.prototype.unsubscribe = function(key)
{
    logger.dev("ipc.unsubscribe", key);
    try {
        this.queueClient.unsubscribe(key);
    } catch(e) {
        logger.error('ipc.unsubscribe:', key, e.stack);
    }
}

// Publish an event to be sent to the subscribed clients
ipc.publish = function(key, data)
{
    logger.dev("ipc.publish", key, data);
    try {
        return this.queueClient.publish(key, data);
    } catch(e) {
        logger.error('ipc.publish:', key, e.stack);
    }
}

// A Javascript object `msg` must have the following properties:
// - name - unique id, can be IP address, account id, etc...
// - rate, max, interval - same as for `metrics.TokenBucket` rate limiter.
//
// Returns true if consumed or false otherwise, if callback
// is given, call it with the consumed flag as first argument.
//
// Keeps the token bucket in the LRU local cache by name, this is supposed to be used on the server, not concurrently by several clients.
ipc.prototype.checkLimits = function(msg, callback)
{
    var data = utils.lruGet(msg.name);
    this.tokenBucket.configure(data ? lib.strSplit(data) : msg);
    // Reset the bucket if any number has been changed, now we have a new rate to check
    if (!this.tokenBucket.equal(msg.rate, msg.max, msg.interval)) this.tokenBucket.configure(msg);

    var consumed = this.tokenBucket.consume(msg.consume || 1);
    utils.lruPut(msg.name, this.tokenBucket.toString());

    logger.debug("checkLimits:", msg.name, consumed, this.tokenBucket);
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

    this.get(name + ":t", function(t) {
        var d = now - lib.toNumber(t);
        logger.debug("checkTimer:", name, "interval:", interval, "time:", d, t);
        if (!options.force && t < interval) return callback(false);

        self.incr(name + ":n", 1, function(n) {
            logger.debug("checkTimer:", name, "timeout:", timeout, "time:", d, "counter:", n);
            if (!options.force && n > 1 && t < timeout) return callback(false);
            self.put(name + ":t", now);
            callback(true);
        })
    });
}

// Reset the timer so it can be locked immediately.
ipc.prototype.resetTimer = function(name)
{
    this.put(name + ":t", Date.now());
    this.put(name + ":n", "0");
}

