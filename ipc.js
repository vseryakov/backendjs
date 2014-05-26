//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var util = require('util');
var fs = require('fs');
var repl = require('repl');
var path = require('path');
var backend = require(__dirname + '/build/Release/backend');
var logger = require(__dirname + '/logger');
var core = require(__dirname + '/core');
var cluster = require('cluster');
var async = require('async');
var memcached = require('memcached');
var redis = require("redis");
var amqp = require('amqp');

// IPC communications between processes and support for caching and messaging
var ipc = {
    subCallbacks: {},
    msgs: {},
    msgId: 1,
    workers: [],
    nanomsg: {},
    redis: {},
    memcache: {},
    amqp: {},
};

module.exports = ipc;

// This function is called by Web worker process to setup IPC channels and support for cache and messaging
ipc.initClient = function()
{
    var self = this;

    this.initClientCaching();
    this.initClientMessaging();

    // Event handler for the worker to process response and fire callback
    process.on("message", function(msg) {
        logger.dev('msg:worker:', msg)
        core.runCallback(self.msgs, msg);

        try {
            switch (msg.op || "") {
            case "api:close":
                core.context.api.shutdown(function() { process.exit(0); });
                break;

            case "init:cache":
                self.initClientCaching();
                break;

            case "init:msg":
                self.initClientMessaging();
                break;

            case "init:dns":
                core.loadDnsConfig();
                break;

            case "init:db":
                core.loadDbConfig();
                break;

            case "heapsnapshot":
                backend.heapSnapshot("tmp/" + process.pid + ".heapsnapshot");
                break;
            }
        } catch(e) {
            logger.error('msg:worker:', e, msg);
        }
    });
}

// This function is called by the Web master server process to setup IPC channels and support for cache and messaging
ipc.initServer = function()
{
    var self = this;

    this.initServerCaching();
    this.initServerMessaging();

    cluster.on('fork', function(worker) {
        // Handle cache request from a worker, send back cached value if exists, this method is called inside worker context
        worker.on('message', function(msg) {
            if (!msg) return false;
            logger.dev('msg:master:', msg);
            try {
                switch (msg.op) {
                case "metrics":
                    if (msg.name) {
                        msg.value.mtime = Date.now();
                        core.metrics[msg.name] = msg.value;
                    }
                    if (msg.reply) {
                        msg.value = core.metrics;
                        worker.send(msg);
                    }
                    break;

                case "api:close":
                    // Start gracefull restart of all api workers, wait till a new worker starts and then send a signal to another in the list.
                    // This way we keep active processes responding to the requests while restarting
                    if (self.workers.length) break;
                    for (var p in cluster.workers) self.workers.push(cluster.workers[p].pid);

                case "api:ready":
                    // Restart the next worker from the list
                    if (!self.workers.length) break;
                    for (var p in cluster.workers) {
                        var idx = self.workers.indexOf(cluster.workers[p].pid);
                        if (idx == -1) continue;
                        self.workers.splice(idx, 1);
                        cluster.workers[p].send({ op: "api:close" });
                        return;
                    }
                    break;

                case "init:cache":
                    self.initServerCaching();
                    for (var p in cluster.workers) cluster.workers[p].send(msg);
                    break;

                case "init:msg":
                    self.initServerMessaging();
                    for (var p in cluster.workers) cluster.workers[p].send(msg);
                    break;

                case "init:db":
                    core.loadDbConfig();
                    for (var p in cluster.workers) cluster.workers[p].send(msg);
                    break;

                case "init:dns":
                    core.loadDnsConfig();
                    for (var p in cluster.workers) cluster.workers[p].send(msg);
                    break;

                case 'stats':
                    msg.value = backend.lruStats();
                    worker.send(msg);
                    break;

                case 'keys':
                    msg.value = backend.lruKeys();
                    worker.send(msg);
                    break;

                case 'get':
                    if (msg.name) msg.value = backend.lruGet(msg.name);
                    worker.send(msg);
                    break;

                case 'exists':
                    if (msg.name) msg.value = backend.lruExists(msg.name);
                    worker.send(msg);
                    break;

                case 'put':
                    if (msg.name && msg.name) backend.lruSet(msg.name, msg.value);
                    if (msg.reply) worker.send({});
                    break;

                case 'incr':
                    if (msg.name && msg.value) backend.lruIncr(msg.name, msg.value);
                    if (msg.reply) worker.send({});
                    break;

                case 'del':
                    if (msg.name) backend.lruDel(msg.name);
                    if (msg.reply) worker.send({});
                    break;

                case 'clear':
                    backend.lruClear();
                    if (msg.reply) worker.send({});
                    break;
                }
                // Send to all other nodes in the cluster
                self.broadcast(msg.cmd, msg.name, msg.value);

            } catch(e) {
                logger.error('msg:', e, msg);
            }
        });
    });
}

// Initialize caching system for the configured cache type, can be called many time to re-initialize if the environment has changed
ipc.initServerCaching = function()
{
    backend.lruInit(core.lruMax);

    switch (core.cacheType || "") {
    case "memcache":
        break;

    case "redis":
        break;

    default:
        if (!backend.NNSocket || core.noCache) break;
        core.cacheBind = core.cacheHost == "127.0.0.1" || core.cacheHost == "localhost" ? "127.0.0.1" : "*";

        // Pair of cache sockets for communication between nodes and cache coordinators
        this.bind('pull', "nanomsg", core.cacheBind, core.cachePort, backend.NN_PULL);
        this.connect('push', "nanomsg", core.cacheHost, core.cachePort, backend.NN_PUSH);

        // LRU cache server, for broadcasting cache updates to all nodes in the cluster
        this.bind('lru', "nanomsg", core.cacheBind, core.cachePort + 1, backend.NN_BUS);
        this.connect('lru', "nanomsg", core.cacheHost, core.cachePort + 1, backend.NN_BUS);

        // Forward cache requests to the bus
        if (this.nanomsg.pull && this.nanomsg.lru) {
            var err = backend.lruServerStart(this.nanomsg.pull.socket, this.nanomsg.lru.socket);
            if (err) logger.error('initServerCaching:', 'lru', backend.nn_strerror(err));
        }
    }
}

// Initialize web worker caching system, can be called anytime the environment has changed
ipc.initClientCaching = function()
{
    switch (core.cacheType || "") {
    case "memcache":
        this.connect("client", "memcache", core.memcacheHost, core.memcachePort, core.memcacheOptions);
        break;

    case "redis":
        this.connect("client", "redis", core.redisHost, core.redisPort, core.redisOptions);
        break;
    }
}

// Initialize messaging system for the server process, can be called multiple times in case environment has changed
ipc.initServerMessaging = function()
{
    switch (core.msgType || "") {
    case "redis":
        break;

    default:
        if (!backend.NNSocket || core.noMsg) break;
        core.msgBind = core.msgHost == "127.0.0.1" || core.msgHost == "localhost" ? "127.0.0.1" : "*";

        // Subscription server, clients connects to it, subscribes and listens for events published to it, every Web worker process connects to this socket.
        this.bind('sub', "nanomsg", core.msgBind, core.msgPort + 1, backend.NN_PUB);

        // Publish server(s), it is where the clients send events to, it will forward them to the sub socket
        // which will distribute to all subscribed clients. The publishing is load-balanced between multiple PUSH servers
        // and automatically uses next live server in case of failure.
        this.bind('pub', "nanomsg", core.msgBind, core.msgPort, backend.NN_PULL);
        // Forward all messages to the sub server socket, we dont use proxy because PUB socket broadcasts to all peers but we want load-balancer
        if (this.nanomsg.pub && this.nanomsg.sub) this.nanomsg.pub.setForward(this.nanomsg.sub);
    }
}

// Initialize web worker messaging system, client part, sends all publish messages to this socket which will be broadcasted into the
// publish socket by the receiving end. Can be called anytime to reconfigure if the environment has changed.
ipc.initClientMessaging = function()
{
    var self = this;

    switch (core.msgType || "") {
    case "amqp":
        this.connect("client", "amqp", core.amqpHost, core.amqpPort, core.amqpOptions, function() {
            this.queue(core.amqpQueueName || '', core.amqpQueueOptions | {}, function(q) {
                self.amqpQueue = q;
                q.subscribe(function(message, headers, info) {
                    var cb = self.subCallbacks[info.routingKey];
                    if (!cb) cb[0](cb[1], info.routingKey, message);
                });
            });
        });
        break;

    case "redis":
        this.connect("pub", "redis", core.redisHost, core.redisPort, core.redisOptions);
        this.connect("sub", "redis", core.redisHost, core.redisPort, core.redisOptions, function() {
            this.on("pmessage", function(channel, message) {
                var cb = self.subCallbacks[channel];
                if (!cb) cb[0](cb[1], channel, message);
            });
        });
        break;

    default:
        if (!backend.NNSocket || core.noMsg || !core.msgHost) break;

        // Socket where we publish our messages
        this.connect('pub', "nanomsg", core.msgHost, core.msgPort, backend.NN_PUSH);

        // Socket where we receive messages for us
        this.connect('sub', "nanomsg", core.msgHost, core.msgPort + 1, backend.NN_SUB, function(err, data) {
            if (err) return logger.error('subscribe:', err);
            data = data.split("\1");
            var cb = self.subCallbacks[data[0]];
            if (cb) cb[0](cb[1], data[0], data[1]);
        });
    }
}

// Close all caching and messaging clients, can be called by a server or a worker
ipc.shutdown = function()
{
    var self = this;
    ["nanomsg","redis","memcache","amqp"].forEach(function(type) { for (var name in this[type]) { this.close(type, name); } });
}

// Send a command to the master process via IPC messages, callback is used for commands that return value back
ipc.command = function(msg, callback)
{
    if (!cluster.isWorker) return callback ? callback() : null;

    if (typeof callback == "function") {
        msg.reply = true;
        msg.id = this.msgId++;
        core.deferCallback(this.msgs, msg, function(m) { callback(m.value); });
    }
    try { process.send(msg); } catch(e) { logger.error('send:', e, msg.op, msg.name); }
}

// Always send text to the master, convert objects into JSON, value and callback are optional
ipc.send = function(op, name, value, callback)
{
    if (typeof value == "function") callback = value, value = '';
    if (typeof value == "object") value = JSON.stringify(value);
    this.command({ op: op, name: name, value: value }, callback);
}

// Bind a socket to the address and port i.e. initialize the server socket
ipc.bind = function(name, type, host, port, options)
{
    if (!host || !this[type]) return;

    switch (type) {
    case "redis":
    case "memcache":
    case "amqp":
        break;

    case "nanomsg":
        if (!backend.NNSocket) break;
        if (!this[type][name]) this[type][name] = new backend.NNSocket(backend.AF_SP, options);
        if (this[type][name] instanceof backend.NNSocket) {
            var h = host.split(":");
            host = "tcp://" + h[0] + ":" + (h[1] || port)
            var err = this[type][name].bind(host);
            if (err) logger.error('ipc.bindSocket:', host, this[type][name]);
        }
    }
    return this[type][name];
}

// Connect to the host(s)
ipc.connect = function(name, type, host, port, options, callback)
{
    if (!host || !this[type]) return;

    switch (type) {
    case "redis":
        if (this[type][name]) break;
        try {
            this[type][name] = redis.createClient(port, host, options || {});
            this[type][name].on("error", function(err) { logger.error(type, name, host, err) });
            if (callback) this[type][name].on("ready", function() { callback.call(this) });
        } catch(e) {
            delete this[type][name];
            logger.error('ipc.connect:', name, type, host, e);
        }
        break;

    case "memcache":
        if (this[type][name]) break;
        try {
            this[type][name] = new memcached(host, options || {});
            this[type][name].on("error", function(err) { logger.error(type, name, host, err) });
            if (callback) this[type][name].on("ready", function() { callback.call(this) });
        } catch(e) {
            delete this[type][name];
            logger.error('ipc.connect:', name, type, host, e);
        }
        break;

    case "amqp":
        if (this[type][name]) break;
        try {
            this[type][name] = amqp.createConnection(core.cloneObj(options, "host", host));
            this[type][name].on("error", function(err) { logger.error(type, name, host, err) });
            if (callback) this[type][name].on("ready", function() { callback.call(this) });
        } catch(e) {
            delete this[type][name];
            logger.error('ipc.connect:', name, type, host, e);
        }
        break;

    case "nanomsg":
        if (!backend.NNSocket) break;
        if (!this[type][name]) this[type][name] = new backend.NNSocket(backend.AF_SP, options);
        if (this[type][name] instanceof backend.NNSocket) {
            host = core.strSplit(host).map(function(x) { x = x.split(":"); return "tcp://" + x[0] + ":" + (x[1] || port); }).join(',');
            var err = this[type][name].connect(host);
            if (!err && callback) err = this[type][name].setCallback(callback);
            if (err) logger.error('ipc.connect:', host, this[type][name]);
        }
    }
    return this[type][name];
}

// Close a socket or a client
ipc.close = function(name, type)
{
    if (!this[type] || !this[type][name]) return;

    switch (type) {
    case "amqp":
        try { this[type][name].disconnect(); } catch(e) { logger.error('ipc.close:', type, name, e); }
        break;

    case "memcache":
        try { this[type][name].end(); } catch(e) { logger.error('ipc.close:', type, name, e); }
        break;

    case "redis":
        try { this[type][name].quit(); } catch(e) { logger.error('ipc.close:', type, name, e); }
        break;

    case "nanomsg":
        if (!backend.NNSocket) break;
        try { this[type][name].close(); } catch(e) { logger.error('ipc.close:', type, name, e); }
        break;
    }
    delete this[type][name];
}

// Reconfigure the caching and/or messaging in the client and server, sends init command to the master which will reconfigure all workers after
// reconfiguring itself, this command can be sent by any worker. type can be one of cche or msg
ipc.configure = function(type)
{
    this.send('init:' + type, "");
}

ipc.broadcast = function(cmd, name, value)
{
    try {
        switch (core.cacheType || "") {
        case "memcache":
            break;

        case "amqp":
            break;

        case "redis":
            break;

        default:
            if (this.noCache || !this.nanomsg.push || !this.nanomsg.push.address.length) break;
            switch (cmd) {
            case 'put':
                this.nanomsg.push.send("\2" + name + "\2" + value);
                break;

            case 'incr':
                this.nanomsg.push.send("\3" + name + "\3" + value);
                break;

            case 'del':
                this.nanomsg.push.send("\1" + name);
                break;

            case 'clear':
                this.nanomsg.push.send("\4");
                break;
            }
        }
    } catch(e) {
        logger.error('broadcastCache:', e);
    }
}

ipc.stats = function(callback)
{
    try {
        switch (core.cacheType || "") {
        case "memcache":
            if (!this.memcache.client) return callback({});
            this.memcache.client.stats(function(e,v) { callback(v) });
            break;
        case "redis":
            if (!this.redis.client) return callback({});
            this.redis.client.info(function(e,v) { callback(v) });
            break;
        default:
            if (core.noCache) return callback({});
            this.send("stats", "", callback);
        }
    } catch(e) {
        logger.error('ipcStats:', e);
        callback({});
    }
}

ipc.keys = function(callback)
{
    try {
        switch (core.cacheType || "") {
        case "memcache":
            if (!this.memcache.client) return callback([]);
            this.memcache.client.items(function(err, items) {
                if (err || !items || !items.length) return cb([]);
                var item = items[0], keys = [];
                var keys = Object.keys(item);
                keys.pop();
                async.forEachSeries(keys, function(stats, next) {
                    memcached.cachedump(item.server, stats, item[stats].number, function(err, response) {
                        if (response) keys.push(response.key);
                        next(err);
                    });
                }, function() {
                    callback(keys);
                });
            });
            break;
        case "redis":
            if (!this.redis.client) return callback([]);
            this.redis.client.keys("*", function(e,v) { cb(v) });
            break;
        default:
            if (core.noCache) return callback([]);
            this.send("keys", "", callback);
        }
    } catch(e) {
        logger.error('ipcKeys:', e);
        callback({});
    }
}

ipc.clear = function()
{
    try {
        switch (core.cacheType || "") {
        case "memcache":
            if (!this.memcache.client) break;
            this.memcache.client.flush();
            break;
        case "redis":
            if (!this.redis.client) break;
            this.redis.client.flushall();
            break;
        default:
            if (core.noCache) return;
            this.send("clear", key);
        }
    } catch(e) {
        logger.error('ipcClear:', e);
    }
}

ipc.get = function(key, callback)
{
    try {
        switch (core.cacheType || "") {
        case "memcache":
            if (!this.memcache.client) return callback({});
            this.memcache.client.get(key, function(e,v) { callback(v) });
            break;
        case "redis":
            if (!this.redis.client) return callback();
            this.redis.client.get(key, function(e,v) { callback(v) });
            break;
        default:
            if (core.noCache) return callback();
            this.send("get", key, callback);
        }
    } catch(e) {
        logger.error('ipcGet:', e);
        callback();
    }
}

ipc.del = function(key)
{
    try {
        switch (core.cacheType || "") {
        case "memcache":
            if (!this.memcache.client) break;
            this.memcache.client.del(key);
            break;
        case "redis":
            if (!this.redis.client) break;
            this.redis.client.del(key, function() {});
            break;
        default:
            if (core.noCache) return;
            this.send("del", key);
        }
    } catch(e) {
        logger.error('ipcDel:', e);
    }
}

ipc.put = function(key, val)
{
    try {
        switch (core.cacheType || "") {
        case "memcache":
            if (!this.memcache.client) break;
            this.memcache.client.set(key, val, 0);
            break;
        case "redis":
            if (!this.redis.client) break;
            this.redis.client.set(key, val, function() {});
            break;
        default:
            if (core.noCache) return;
            this.send("put", key, val);
        }
    } catch(e) {
        logger.error('ipcPut:', e);
    }
}

ipc.incr = function(key, val)
{
    try {
        switch (core.cacheType || "") {
        case "memcache":
            if (!this.memcache.client) break;
            this.memcache.client.incr(key, val, 0);
            break;
        case "redis":
            if (!this.redis.client) break;
            this.redis.client.incr(key, val, function() {});
            break;
        default:
            if (core.noCache) return;
            this.send("incr", key, val);
        }
    } catch(e) {
        logger.error('ipcIncr:', e);
    }
}

// Subscribe to the publishing server for messages starting with the given key, the callback will be called only on new data received
// Returns a non-zero handle which must be unsubscribed when not needed. If no pubsub system is available or error occurred returns 0.
ipc.subscribe = function(key, callback, data)
{
    var self = this;
    try {
        switch (core.msgType || "") {
        case "redis":
            if (!this.redis.sub) break;
            this.subCallbacks[key] = [ callback, data ];
            sock = this.redis.sub.psubscribe(key);
            break;

        case "amqp":
            if (!this.amqpQueue) break;
            this.subCallbacks[key] = [ callback, data ];
            this.amqpQueue.bind(key);
            break;

        default:
            if (!this.nanomsg.sub) break;
            this.subCallbacks[key] = [ callback, data ];
            this.nanomsg.sub.subscribe(key);
        }
    } catch(e) {
        logger.error('ipcSubscribe:', this.subHost, key, e);
    }
}

// Close subscription
ipc.unsubscribe = function(key)
{
    try {
        delete this.subCallbacks[key];
        switch (core.msgType || "") {
        case "redis":
            if (!this.redis.sub) break;
            this.redis.sub.punsubscribe(key);
            break;

        case "amqp":
            if (!this.amqpQueue) break;
            this.amqpQueue.unbind(key);
            break;

        default:
            if (!this.nanomsg.sub) break;
            this.nanomsg.sub.unsubscribe(key);
        }
    } catch(e) {
        logger.error('ipcUnsubscribe:', e);
    }
}

// Publish an event to be sent to the subscribed clients
ipc.publish = function(key, data, callback)
{
    try {
        switch (core.msgType || "") {
        case "redis":
            if (!this.redis.pub) break;
            this.redis.pub.publish(key, data);
            break;

        case "amqp":
            if (!this.amqpClient) break;
            this.amqpClient.publish(key, data);
            break;

        default:
            // Nanomsg socket
            if (!this.nanomsg.pub) break;
            this.nanomsg.pub.send(key + "\1" + JSON.stringify(data));
        }
    } catch(e) {
        logger.error('ipcPublish:', e, key);
    }
}

