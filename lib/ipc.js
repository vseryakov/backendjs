//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const util = require('util');
const cluster = require('cluster');
const events = require("events");
const logger = require(__dirname + '/logger');
const core = require(__dirname + '/core');
const lib = require(__dirname + '/lib');
const metrics = require(__dirname + '/metrics');
const Client = require(__dirname + "/ipc/client");

// IPC communications between processes and support for caching and subscriptions via queues.
//
// The module is EventEmitter and emits messages received.
//
// Some drivers may support TTL so global `options.ttl` or local `options.ttl` can be used for `put/incr` operations and it will honored if it is suported.
//
// For caches that support maps, like Redis or Hazelcast the `options.mapName` can be used with get/put/incr/del to
// work with maps and individual keys inside maps.
//
// All methods use `options.queueName` or `options.cacheName` for non-default queue or cache.
// If it is an array then a client will be picked sequentially by maintaining internal sequence number.
//
// To specify a channel within a queue use the format `queueName#channelName`, for drivers that support multiple channels like NATS/Redis
// the channel will be used for another subscription within the same connection.
//
// For drivers (NATS) that support multiple consumers the full queue syntax is `queueName#channelName@groupName` or `queueName@groupName`,
// as well as the `groupName` property in the subscribe options.
//
// A special system queue can be configured and it will be used by all processes to listen for messages on the channel `bkjs:role`, where the role
// is the process role, the same messages that are processed by the server/worker message handlers like api:restart, config:init,....
// All instances will be listening and processing these messages at once, the most usefull use case is refreshing the DB config on demand or
// restarting without configuring any other means like SSH, keys....
//
function Ipc()
{
    events.EventEmitter.call(this);
    this.name = "ipc";
    this.role = "";
    this.msgs = {};
    this._queue = [];
    this._nameIndex = 0;
    this.restarting = [];
    this.modules = [];
    this.clients = { "": new Client() };
    this.ports = {};
    // Use shared token buckets inside the server process, reuse the same object so we do not generate
    // a lot of short lived objects, the whole operation including serialization from/to the cache is atomic.
    this.tokenBucket = new metrics.TokenBucket();
    this.lru = new lib.LRUCache();

    // Config params
    this.configParams = { local: { clientUrl: "local://" } };
    this.args = [
        { name: "none", type: "bool", descr: "disable all IPC subsystems" },
        { name: "ping-interval", type: "int", min: 0, descr: "Interval for a worker keep-alive pings, if not received within this period it will be killed" },
        { name: "lru-max", type: "int", obj: "lru", descr: "Max number of items in the limiter LRU cache, this cache is managed by the master Web server process and available to all Web processes maintaining only one copy per machine" },
        { name: "system-queue", descr: "System queue name to send broadcast control messages, this is a PUB/SUB queue to process system messages like restart, re-init config,..." },
        { name: "(cache|queue)-?([a-z0-9]+)?", obj: "configParams.$2", make: "clientUrl", nocamel: 1, descr: "An URL that points to a cache/queue server in the format `PROTO://HOST[:PORT]?PARAMS`, multiple clients can be defined with unique names, all params starting with `bk-` will be copied into the options without the prefix and removed from the url, the rest of params will be left in the url, ex: -ipc-client-redis redis://localhost?bk-count=3&bk-ttl=3000" },
        { name: "(cache|queue)-([a-z0-9]+)?-?options", obj: "configParams.$2", camel: '-', type: "json", merge: 1, onparse: function(v,o) {this.parseOptions(v,o)}, onupdate: function(v,o) {this.applyOptions(v,o)}, descr: "Additional parameters for clients, specific to each implementation, ex: `-ipc-client-options {\"ttl\":3000}`" },
        { name: "(cache|queue)(-([a-z0-9]+)?-?options)-(.+)$", obj: "configParams.$3", make: "$4", camel: '-', autotype: 1, onparse: function(v,o) {this.parseOptions(v,o)}, onupdate: function(v,o) {this.applyOptions(v,o)}, descr: "Additional parameters for clients, specific to each implementation, ex: `-ipc-client-options-ttl 3000`" },
    ];
}

util.inherits(Ipc, events.EventEmitter);

module.exports = new Ipc();

Ipc.prototype.parseOptions = function(val, options)
{
    this.modules.forEach(function(x) {
        if (typeof x.parseOptions == "function") x.parseOptions(val, options);
    });
}

Ipc.prototype.applyOptions = function(val, options)
{
    if (!options.obj) return;
    var name = options.obj.split(/[.-]/).pop();
    var client = this.getClient(name);
    if (!client) return;
    logger.debug("applyOptions:", options.obj, "NEW:", options.context, "OLD:", client.options);
    client.options[options.name] = options.context[options.name];
    client.applyOptions();
}

Ipc.prototype.handleWorkerMessages = function(msg)
{
    if (!msg) return;
    logger.dev('handleWorkerMessages:', core.role, msg)
    lib.runCallback(this.msgs, msg);

    try {
        switch (msg.__op || "") {
        case "api:restart":
            core.modules.api.shutdown(function() { process.exit(0); });
            break;

        case "worker:restart":
            if (cluster.isWorker) core.runMethods("shutdownWorker", function() { process.exit(0); });
            break;

        case "queue:init":
            this.initClients();
            break;

        case "queue:check":
            this.checkClients();
            break;

        case "dns:init":
            core.loadDnsConfig();
            break;

        case "config:init":
            core.modules.db.initConfig();
            break;

        case "conf:init":
            core.reloadConfig();
            break;

        case "msg:init":
            core.modules.msg.init();
            break;

        case "columns:init":
            core.modules.db.refreshColumns();
            break;

        case "repl:init":
            if (msg.port) core.startRepl(msg.port, core.repl.bind);
            break;

        case "repl:shutdown":
            if (core.repl.server) core.repl.server.end();
            delete core.repl.server;
            break;
        }
        this.emit(msg.__op, msg);
    } catch (e) {
        logger.error('handleWorkerMessages:', e.stack, msg);
    }
}

// To be used in messages processing that came from the clients or other way
Ipc.prototype.handleServerMessages = function(worker, msg)
{
    if (!msg) return false;
    logger.dev('handleServerMessages:', core.role, msg);
    try {
        switch (msg.__op) {
        case "api:restart":
            // Start gracefull restart of all api workers, wait till a new worker starts and then send a signal to another in the list.
            // This way we keep active processes responding to the requests while restarting
            if (this.restarting.length) break;
            for (const p in cluster.workers) this.restarting.push(cluster.workers[p].process.pid);

        case "api:ready":
            // Restart the next worker from the list
            if (this.restarting.length) {
                for (const p in cluster.workers) {
                    var idx = this.restarting.indexOf(cluster.workers[p].process.pid);
                    if (idx == -1) continue;
                    this.restarting.splice(idx, 1);
                    cluster.workers[p].send({ __op: "api:restart" });
                    break;
                }
            }
            this.sendReplPort("web", worker);
            break;

        case "worker:ready":
            this.sendReplPort("worker", worker);
            break;

        case "worker:restart":
            for (const p in cluster.workers) cluster.workers[p].send(msg);
            break;

        case "worker:ping":
            if (!cluster.workers[worker.id]) break;
            cluster.workers[worker.id].pingTime = Date.now();
            break;

        case "cluster:disconnect":
            if (!cluster.workers[worker.id]) break;
            cluster.workers[worker.id].pingTime = -1;
            break;

        case "cluster:exit":
            for (var p in this.ports) {
                if (this.ports[p] == worker.process.pid) {
                    this.ports[p] = 0;
                    break;
                }
            }
            if (!cluster.workers[worker.id]) break;
            cluster.workers[worker.id].pingTime = -1;
            break;

        case "cluster:listen":
            this.ports[msg.port] = worker.process.pid;
            break;

        case "queue:init":
            this.initClients();
            for (const p in cluster.workers) cluster.workers[p].send(msg);
            break;

        case "queue:check":
            this.checkClients();
            for (const p in cluster.workers) cluster.workers[p].send(msg);
            break;

        case "config:init":
            core.modules.db.initConfig();
            for (const p in cluster.workers) cluster.workers[p].send(msg);
            break;

        case "conf:init":
            core.reloadConfig();
            for (const p in cluster.workers) cluster.workers[p].send(msg);
            break;

        case "columns:init":
            core.modules.db.refreshColumns();
            for (const p in cluster.workers) cluster.workers[p].send(msg);
            break;

        case "dns:init":
            core.loadDnsConfig();
            for (const p in cluster.workers) cluster.workers[p].send(msg);
            break;

        case "msg:init":
            for (const p in cluster.workers) cluster.workers[p].send(msg);
            break;

        case "ipc:limiter":
            worker.send(this.localLimiter(msg));
            break;

        }
        this.emit(msg.__op, msg, worker);
    } catch (e) {
        logger.error('handleServerMessages:', e.stack, msg);
    }
}

// Send REPL port to a worker if needed
Ipc.prototype.sendReplPort = function(role, worker)
{
    if (!worker || !worker.process) return;
    var port = core.repl[role + "Port"];
    if (!port) return;
    var ports = Object.keys(this.ports).sort();
    for (var i in ports) {
        var diff = ports[i] - port;
        if (diff > 0) break;
        if (diff == 0) {
            if (this.ports[port] == worker.process.pid) return;
            if (!this.ports[port]) break;
            port++;
        }
    }
    this.ports[port] = worker.process.pid;
    worker.send({ __op: "repl:init", port: port });
}

// Returns an IPC message object, `msg` must be an object if given.
Ipc.prototype.newMsg = function(op, msg, options)
{
    if (op && op.__op) return op;
    if (typeof op == "string" && op[0] == "{" && op[op.length-1] == "}") {
        return lib.jsonParse(op, { datatype: "obj" });
    }
    if (typeof msg == "string") msg = lib.jsonParse(msg, { logger: "info" });
    return lib.objExtend(msg, "__op", String(op));
}

// Wrapper around EventEmitter `emit` call to send unified IPC messages in the same format
Ipc.prototype.emitMsg = function(op, msg, options)
{
    if (!op) return;
    this.emit(op, this.newMsg(op, msg, options));
}

// Send a message to the master process via IPC messages, callback is used for commands that return value back
//
// - the `timeout` property can be used to specify a timeout for how long to wait the reply, if not given the default is used
// - the rest of the properties are optional and depend on the operation.
//
// If called inside the server, it process the message directly, reply is passed in the callback if given.
//
// Examples:
//
//        ipc.sendMsg("op1", { data: "data" }, { timeout: 100 })
//        ipc.sendMsg("op1", { name: "name", value: "data" }, function(data) { console.log(data); })
//        ipc.sendMsg("op1", { 1: 1, 2: 2 }, { timeout: 100 })
//        ipc.sendMsg("op1", { 1: 1, 2: 2 }, function(data) { console.log(data); })
//        ipc.newMsg({ __op: "op1", name: "test" })
//
Ipc.prototype.sendMsg = function(op, msg, options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    msg = this.newMsg(op, msg, options);

    if (!cluster.isWorker) {
        if (this.role == "server") this.handleServerMessages({ send: lib.noop }, msg);
        return typeof callback == "function" ? callback(msg) : null;
    }

    if (typeof callback == "function") {
        msg.__res = true;
        lib.deferCallback(this.msgs, msg, callback, options && options.timeout);
    }
    try { process.send(msg); } catch (e) { logger.error('send:', e, msg); }
}

// This function is called by a master server process to setup IPC channels and support for cache and messaging
Ipc.prototype.initServer = function()
{
    if (this.none || this.__init) return;
    this.__init = 1;
    this.role = "server";
    this.initClients();

    cluster.on("exit", (worker, code, signal) => {
        this.handleServerMessages(worker, this.newMsg("cluster:exit", { id: worker.id, pid: worker.process.pid, code: code || undefined, signal: signal || undefined }));
    });

    cluster.on("disconnect", (worker, code, signal) => {
        this.handleServerMessages(worker, this.newMsg("cluster:disconnect", { id: worker.id, pid: worker.process.pid }));
    });

    cluster.on('listening', (worker, address) => {
        this.handleServerMessages(worker, this.newMsg("cluster:listen", { id: worker.id, pid: worker.process.pid, port: address.port, address: address.address }));
    });

    // Handle messages from the workers
    cluster.on('fork', (worker) => {
        worker.pingTime = worker.startTime = Date.now();
        worker.on('message', (msg) => {
            this.handleServerMessages(worker, msg);
        });
        worker.on("error", (err) => {
            logger.error("server:", worker.id, worker.process.pid, err);
        });
    });

    // Subscribe to the system bus
    this.subscribe(core.name + ":" + core.role, { queueName: this.systemQueue }, (msg) => {
        this.handleServerMessages({ send: lib.noop }, this.newMsg(msg));
    });


    setInterval(() => {
        if (this.pingInterval) {
            var now = Date.now();
            for (var i in cluster.workers) {
                var w = cluster.workers[i];
                var t = w.pingTime || 0;
                if (t >= 0 && now - t > this.pingInterval) {
                    logger.error("initServer:", core.role, "dead worker detected", w.id, w.process.pid, "interval:", this.pingInterval, "last ping:", now - t, "started:", now - w.startTime);
                    try { process.kill(w.process.pid, now -t > this.pingInterval*2 ? "SIGKILL" : "SIGTERM"); } catch (e) {}
                }
            }
        }
        this.lru.clean();
    }, this.pingInterval/2 || 60000);
}

// This function is called by a worker process to setup IPC channels and support for cache and messaging
Ipc.prototype.initWorker = function()
{
    if (this.none || this.__init) return;
    this.__init = 1;
    this.role = "worker";
    this.initClients();

    // Handle messages from the master
    process.on("message", this.handleWorkerMessages.bind(this));

    // Subscribe to the system bus
    this.subscribe(core.name + ":" + core.role, { queueName: this.systemQueue }, (msg) => {
        this.handleWorkerMessages(this.newMsg(msg));
    });

    if (this.pingInterval > 0) {
        setInterval(this.sendMsg.bind(this, "worker:ping"), Math.max(1000, this.pingInterval/5));
        this.sendMsg("worker:ping");
    }
}

// Return a new client for the given host or null if not supported
Ipc.prototype.createClient = function(url, options)
{
    var client = null;
    try {
        for (const i in this.modules) {
            client = this.modules[i].createClient(url, options);
            if (client) {
                if (!client.name) client.name = this.modules[i].name;
                client.applyReservedOptions(options);
                break;
            }
        }
    } catch (e) {
        logger.error("ipc.createClient:", url, options, e.stack);
    }
    return client;
}

// Return a cache or queue client by name if specified in the options or use default client which always exists,
// use `queueName` to specify a specific queue. If it is an array it will rotate items sequentially.
Ipc.prototype.getClient = Ipc.prototype.getQueue = function(options)
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
    return client || this.clients[""];
}

// Initialize a client for cache or queue purposes, previous client will be closed.
Ipc.prototype.initClients = function()
{
    for (const name in this.configParams) {
        var opts = this.configParams[name] || {};
        var client = this.createClient(opts.clientUrl, opts);
        if (client) {
            try {
                if (this.clients[name]) this.clients[name].close();
            } catch (e) {
                logger.error("ipc.initClient:", name, e.stack);
            }
            client.queueName = name || "default";
            this.clients[name] = client;
        }
    }
}

// Initialize missing or new clients, existing clients stay the same
Ipc.prototype.checkClients = function(prefix)
{
    for (const name in this.configParams) {
        if (!this.clients[name]) {
            var opts = this.configParams[name] || {};
            var client = this.createClient(opts.clientUrl, opts);
            if (client) {
                client.queueName = name || "default";
                this.clients[name] = client;
                logger.info("ipc.checkClients:", name, client.name, "added");
            }
        }
    }
}

// Returns the cache statistics, the format depends on the cache type used, for queues it returns a property 'queueCount' with currently
// visible messages in the queue, 'queueRunning' with currently in-flight messages
Ipc.prototype.stats = function(options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    logger.dev("ipc.stats:", options);
    try {
        this.getClient(options).stats(options || {}, typeof callback == "function" ? callback : undefined);
    } catch (e) {
        logger.error('ipc.stats:', e.stack);
        if (typeof callback == "function") callback(e);
    }
    return this;
}

// Clear all or only items that match the given pattern
Ipc.prototype.clear = function(pattern, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    logger.dev("ipc.clear:", pattern, options);
    try {
        this.getClient(options).clear(typeof pattern == "string" && pattern, typeof callback == "function" ? callback : undefined);
    } catch (e) {
        logger.error('ipc.clear:', pattern, e.stack);
        if (typeof callback == "function") callback(e);
    }
    return this;
}

// Retrieve an item from the cache by key.
//
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
//    ipc.get(["my:key1", "my:key2"], function(err, data) { console.log(data) });
//    ipc.get("my:key", function(err, data) { console.log(data) });
//    ipc.get("my:counter", { set: 10 }, function(err, data) { console.log(data) });
//    ipc.get("*", { mapName: "my:map" }, function(err, data) { console.log(data) });
//    ipc.get("key1", { mapName: "my:map" }, function(err, data) { console.log(data) });
//    ipc.get(["key1", "key2"], { mapName: "my:map" }, function(err, data) { console.log(data) });
//    ipc.get(["key1", "key2"], { listName: "my:list" }, function(err, data) { console.log(data) });
//    ipc.get("", { listName: "my:list", del: 1 }, function(err, data) { console.log(data) });
//    ipc.get("", { listName: "my:list", del: 1, ttl: 30000 }, function(err, data) { console.log(data) });
//
Ipc.prototype.get = function(key, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    logger.dev("ipc.get:", key, options);
    try {
        this.getClient(options).get(key, options || {}, (err, val) => {
            if (!err && options && options.datatype) {
                val = Array.isArray(val) ? val = val.map((x) => (lib.toValue(x, options.datatype))) : lib.toValue(val, options.datatype);
            }
            if (typeof callback == "function") callback(err, val);
        });
    } catch (e) {
        logger.error('ipc.get:', key, e.stack);
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
//        ipc.del("my:key")
//        ipc.del("key1", { mapName: "my:map" })
//        ipc.del("*", { mapName: "my:map" })
//        ipc.del("1", { listName: "my:list" })
//
Ipc.prototype.del = function(key, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    logger.dev("ipc.del:", key, options);
    try {
        this.getClient(options).del(key, options || {}, typeof callback == "function" ? callback : undefined);
    } catch (e) {
        logger.error('ipc.del:', key, e.stack);
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
//       ipc.put("my:key", 2)
//       ipc.put("my:key", 1, { setmax: 1 })
//       ipc.put("key1", 1, { mapName: "my:map" })
//       ipc.put("*", { key1: 1, key2: 2 }, { mapName: "my:map" })
//       ipc.put("", [1,2,3], { listName: "my:list" })
//
Ipc.prototype.put = function(key, val, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    logger.dev("ipc.put:", key, val, options);
    try {
        this.getClient(options).put(key, val, options || {}, typeof callback == "function" ? callback : undefined);
    } catch (e) {
        logger.error('ipc.put:', key, e.stack);
        if (typeof callback == "function") callback(e);
    }
    return this;
}

// Increase/decrease a counter in the cache by `val`, non existent items are treated as 0, if a callback is given an
// error and the new value will be returned.
// - `options.ttl` in milliseconds can be used if the driver supports it
// - `options.mapName` defines a map where the counter will be stored if the cache supports maps
//
// Example:
//
//        ipc.incr("my:key", 1)
//        ipc.incr("key1", 1, { mapName: "my:map" })
//
Ipc.prototype.incr = function(key, val, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    logger.dev("ipc.incr:", key, val, options);
    try {
        this.getClient(options).incr(key, lib.toNumber(val), options || {}, (err, val) => {
            if (typeof callback == "function") callback(err, lib.toNumber(val));
        });
    } catch (e) {
        logger.error('ipc.incr:', key, e.stack);
        if (typeof callback == "function") callback(e);
    }
    return this;
}

// Subscribe to receive messages from the given channel, the callback will be called only on new message received.
//  - `options.queueName` defines the queue, if not specified then it is sent to the default queue
//
//  Example:
//
//          ipc.subscribe("alerts", function(msg) {
//              req.res.json(data);
//          }, req);
//
Ipc.prototype.subscribe = function(channel, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    logger.dev("ipc.subscribe:", channel, options);
    try {
        this.getClient(options).subscribe(channel, options || {}, typeof callback == "function" ? callback : undefined);
    } catch (e) {
        logger.error('ipc.subscribe:', channel, options, e.stack);
    }
    return this;
}

// Close a subscription for the given channel, no more messages will be delivered.
//  - `options.queueName` defines the queue, if not specified then it is sent to the default queue
//
Ipc.prototype.unsubscribe = function(channel, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    logger.dev("ipc.unsubscribe:", channel, options);
    try {
        this.getClient(options).unsubscribe(channel, options || {}, typeof callback == "function" ? callback : undefined);
    } catch (e) {
        logger.error('ipc.unsubscribe:', channel, e.stack);
    }
    return this;
}

// Publish an event to the channel to be delivered to all subscribers. If the `msg` is not a string it will be stringified.
//  - `options.queueName` defines the queue, if not specified then it is sent to the default queue
//
Ipc.prototype.publish = function(channel, msg, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    logger.dev("ipc.publish:", channel, options);
    try {
        if (typeof msg != "string") msg = lib.stringify(msg);
        this.getClient(options).publish(channel, msg, options || {}, typeof callback == "function" ? callback : undefined);
    } catch (e) {
        logger.error('ipc.publish:', channel, e.stack);
        if (typeof callback == "function") callback(e);
    }
    return this;
}

// Send a message to a channel, this is high level routine that uses the corresponding queue, it uses eventually ipc.publish.
// If no client or queue is provided in the options it uses default `systemQueue`.
Ipc.prototype.broadcast = function(channel, msg, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!options || options.queueName) {
        options = lib.objExtend(options, "queueName", this.systemQueue);
    }
    this.publish(channel, msg, options, callback);
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
//          ipc.listen({ queueName: "jobs" }, function(msg, next) {
//              req.res.json(data);
//              if (next) next();
//          }, req);
//
Ipc.prototype.subscribeQueue = function(options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    logger.dev("ipc.subscribeQueue:", options);
    try {
        this.getClient(options).subscribeQueue(options || {}, typeof callback == "function" ? callback : undefined);
    } catch (e) {
        logger.error('ipc.subscribeQueue:', options, e.stack);
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
Ipc.prototype.unsubscribeQueue = function(options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    logger.dev("ipc.unsubscribeQueue:", options);
    try {
        this.getClient(options).unsubscribeQueue(options || {}, typeof callback == "function" ? callback : undefined);
    } catch (e) {
        logger.error('ipc.unsubscribeQueue:', options, e.stack);
    }
    return this;
}

// Submit a message to the queue, if the `msg` is not a string it will be stringified.
//  - `options.queueName` defines the queue, if not specified then it is sent to the default queue
//  - `options.stime` defines when the message should be processed, it will be held in the queue until the time comes
//  - `options.etime` defines when the message expires, i.e. will be dropped if not executed before this time.
//
Ipc.prototype.publishQueue = function(msg, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    logger.dev("ipc.publishQueue:", options);
    try {
        if (typeof msg != "string") msg = lib.stringify(msg);
        this.getClient(options).publishQueue(msg, options || {}, typeof callback == "function" ? callback : undefined);
    } catch (e) {
        logger.error('ipc.publishQueue:', e.stack);
        if (typeof callback == "function") callback(e);
    }
    return this;
}

// Queue specific monitor services that must be run in the master process, this is intended to perform
// queue cleanup or dealing with stuck messages (Redis)
Ipc.prototype.monitorQueue = function(options)
{
    logger.dev("ipc.monitorQueue:", options);
    try {
        this.getClient(options).monitorQueue(options || {});
    } catch (e) {
        logger.error('ipc.monitorQueue:', e.stack);
    }
    return this;
}

// Queue specific message deletion from the queue in case of abnormal shutdown or job running too long in order not to re-run it after the restart, this
// is for queues which require manual message deletion ofter execution(SQS). Each queue client must maintain the mapping or other means to identify messages,
// the options is the message passed to the listener
Ipc.prototype.unpublishQueue = function(msg, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    logger.dev("ipc.unpublishQueue:", msg, options);
    try {
        this.getClient(options).unpublishQueue(msg, options || {}, callback);
    } catch (e) {
        logger.error('ipc.unpublishQueue:', e.stack);
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
//
// The callback takes 2 arguments:
// - `delay` is a number of milliseconds till the bucket can be used again if not consumed, i.e. 0 means consumed.
// - `info` is an object with info about the state of the token bucket after the operation with properties: delay, count, total, elapsed
//
Ipc.prototype.limiter = function(options, callback)
{
    logger.dev("limiter:", options);
    if (typeof callback != "function") return;
    if (!options) return callback(0);
    options.rate = lib.toNumber(options.rate, { min: 0 });
    if (!options.rate) return callback(0);
    options.max = lib.toClamp(options.max, options.rate, options.max || options.rate);
    options.interval = lib.toNumber(options.interval, { min: 0, zero: 1000 });
    options.ttl = lib.toNumber(options.ttl, { min: 0 });
    options.reset = lib.toNumber(options.reset, { min: 0 });
    try {
        this.getClient(options).limiter(options, callback);
    } catch (e) {
        logger.error('ipc.limiter:', e.stack);
        callback(options.interval, {});
    }
    return this;
}

// Keep checking the limiter until it is clear to proceed with the operation, if there is no available tokens in the bucket
// it will wait and try again until the bucket is filled.
Ipc.prototype.checkLimiter = function(options, callback)
{
    this.limiter(options, (delay, info) => {
        logger.debug("checkLimiter:", delay, options, info);
        if (!delay) return callback();
        setTimeout(this.checkLimiter.bind(this, options, callback), delay);
    });
}

// Uses msg.name as a key returns the same message with consumed set to 1 or 0
Ipc.prototype.localLimiter = function(msg)
{
    var token = this.lru.get(msg.name);
    this.tokenBucket.configure(token || msg);
    // Reset the bucket if any number has been changed, now we have a new rate to check
    if (!this.tokenBucket.equal(msg.rate, msg.max, msg.interval)) this.tokenBucket.configure(msg);
    msg.consumed = this.tokenBucket.consume(msg.consume || 1);
    msg.delay = msg.consumed ? 0 : this.tokenBucket.delay(msg.consume || 1);
    msg.total = this.tokenBucket._total;
    msg.count = this.tokenBucket._count;
    msg.elapsed = this.tokenBucket._elapsed;
    token = this.tokenBucket.toArray();
    if ((msg.delay && msg.reset) || (msg.reset > 1 && msg.total >= msg.reset)) {
        this.lru.del(msg.name);
    } else {
        this.lru.put(msg.name, token, msg.expire);
    }
    logger.debug("ipc:limiter:", msg, token);
    return msg;
}

// Implementation of a lock with optional ttl, only one instance can lock it, can be for some period of time and will expire after timeout.
// A lock must be uniquely named and the ttl period is specified by `options.ttl` in milliseconds.
//
// This is intended to be used for background job processing or something similar when
// only one instance is needed to run. At the end of the processing `ipc.unlock` must be called to enable another instance immediately,
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
//          ipc.lock("my-lock", { ttl: 60000, timeout: 30000 }, function(err, locked) {
//               if (locked) {
//                   ...
//                   ipc.unlock("my-lock");
//               }
//          });
//
Ipc.prototype.lock = function(name, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    logger.dev("ipc.lock:", name, options);
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
            if (err) logger.error('ipc.lock:', err.stack);
            if (typeof callback == "function") callback(err, locked);
    }, true);
    return this;
}

// Unconditionally unlock the lock, any client can unlock any lock.
Ipc.prototype.unlock = function(name, options, callback)
{
    logger.dev("ipc.unlock:", name, options);
    try {
        this.getClient(options).unlock(name, options || {}, typeof callback == "function" ? callback : undefined);
    } catch (e) {
        logger.error('ipc.unlock:', e.stack);
        if (typeof callback == "function") callback(e);
    }
    return this;
}

require(__dirname + "/ipc/local")
require(__dirname + "/ipc/redis")
require(__dirname + "/ipc/sqs")
require(__dirname + "/ipc/nats")

