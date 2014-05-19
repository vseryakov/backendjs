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
                    if (msg.name) core.metrics[msg.name] = msg.value;
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
                    // If we connected then broadcast to other servers
                    if (self.lruSocket && self.lruSocket.address) self.lruSocket.send(msg.name);
                    break;

                case 'clear':
                    backend.lruClear();
                    if (msg.reply) worker.send({});
                    break;
                }
            } catch(e) {
                logger.error('msg:', e, msg);
            }
        });
    });
}

// Close all cacheing and messaging clients, can be called by a server or a worker
ipc.shutdown = function()
{
    try { if (this.lruSocket) this.lruSocket.close(); this.lruSocket = null; } catch(e) { logger.error('ipc.shutdown:', e); }
    try { if (this.pubSocket) this.pubSocket.close(); this.pubSocket = null; } catch(e) { logger.error('ipc.shutdown:', e); }
    try { if (this.subSocket) this.subSocket.close(); this.subSocket = null; } catch(e) { logger.error('ipc.shutdown:', e); }
    try { if (this.amqpClient) this.amqpClient.disconnect(); this.amqpClient = null; } catch(e) { logger.error('ipc.shutdown:', e); }
    try { if (this.memcacheClient) this.memcacheClient.end(); this.memcacheClient = null; } catch(e) { logger.error('ipc.shutdown:', e); }
    try { if (this.redisCacheClient) this.redisCacheClient.quit(); this.redisCacheClient = null; } catch(e) { logger.error('ipc.shutdown:', e); }
    try { if (this.redisSubClient) this.redisSubClient.quit(); this.redisSubClient = null; } catch(e) { logger.error('ipc.shutdown:', e); }
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

        // LRU cache server, receives cache requests, updates the local cache and then re-broadcasts it to other connected servers
        if (!this.lruSocket) {
            try {
                this.lruSocket = new backend.NNSocket(backend.AF_SP, backend.NN_BUS);
                this.lruSocket.bind("tcp://" + core.cacheBind + ":" + core.cachePort);
                backend.lruServerStart(0, this.lruSocket.socket, this.lruSocket.socket);
            } catch(e) {
                logger.error('initServerCaching:', e);
                this.lruSocket = null;
            }
        }
        // Connect to the cache broadcasters if provided or changed
        this.connect(this.lruSocket, core.cacheHost, core.cachePort);
    }
    logger.debug('initServerCaching:', core.cacheType, core.cachePort, core.cacheHost, this.lruSocket);
}

// Initialize web worker caching system, can be called anytime the environment has changed
ipc.initClientCaching = function()
{
    switch (core.cacheType || "") {
    case "memcache":
        if (!core.memcacheHost) break;
        try {
            this.memcacheClient = new memcached(core.memcacheHost, core.memcacheOptions || {});
        } catch(e) {
            logger.error('initClientCaching:', e);
            this.memcacheClient = null;
        }
        break;

    case "redis":
        if (!core.redisHost) break;
        try {
            this.redisCacheClient = redis.createClient(core.redisPort, core.redisHost, core.redisOptions || {});
            this.redisCacheClient.on("error", function(err) { logger.error('redis:', err) });
        } catch(e) {
            logger.error('initClientCaching:', e);
            this.redisCacheClient = null;
        }
        break;
    }
    logger.debug('initClientCaching:', core.cacheType, this.memcacheClient, this.redisClient);
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

// Return list of hosts the socket need to connect to, it checks already connected hosts and returns only new ones
ipc.connect = function(sock, hosts, port)
{
    if (!hosts) return;

    if (sock instanceof backend.NNSocket) {
        var connected = core.strSplit(sock.address || []);
        hosts = core.strSplit(hosts).
                     map(function(x) { x = x.split(":"); return "tcp://" + x[0] + ":" + (x[1] || port); }).
                     filter(function(x) { return connected.indexOf(x) == -1 }).
                     join(',');
        if (!hosts) return;
        try { sock.connect(hosts); } catch(e) { logger.error('ipc.connect:', hosts, port, e); }
    }
}

// Reconfigure the caching and/or messaging in the client and server, sends init command to the master which will reconfigure all workers after
// reconfiguring itself, this command can be sent by any worker. type can be one of cche or msg
ipc.configure = function(type)
{
    this.send('init:' + type, "");
}

ipc.statsCache = function(callback)
{
    try {
        switch (core.cacheType || "") {
        case "memcache":
            if (!this.memcacheClient) return callback({});
            this.memcacheClient.stats(function(e,v) { callback(v) });
            break;
        case "redis":
            if (!this.redisCacheClient) return callback({});
            this.redisCacheClient.info(function(e,v) { callback(v) });
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

ipc.keysCache = function(callback)
{
    try {
        switch (core.cacheType || "") {
        case "memcache":
            if (!this.memcacheClient) return callback([]);
            this.memcacheClient.items(function(err, items) {
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
            if (!this.redisCacheClient) return callback([]);
            this.redisCacheClient.keys("*", function(e,v) { cb(v) });
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

ipc.clearCache = function()
{
    try {
        switch (core.cacheType || "") {
        case "memcache":
            if (!this.memcacheClient) break;
            this.memcacheClient.flush();
            break;
        case "redis":
            if (!this.redisCacheClient) break;
            this.redisCacheClient.flushall();
            break;
        default:
            if (core.noCache) return;
            this.send("clear", key);
        }
    } catch(e) {
        logger.error('ipcClear:', e);
    }
}

ipc.getCache = function(key, callback)
{
    try {
        switch (core.cacheType || "") {
        case "memcache":
            if (!this.memcacheClient) return callback({});
            this.memcacheClient.get(key, function(e,v) { callback(v) });
            break;
        case "redis":
            if (!this.redisCacheClient) return callback();
            this.redisCacheClient.get(key, function(e,v) { callback(v) });
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

ipc.delCache = function(key)
{
    try {
        switch (core.cacheType || "") {
        case "memcache":
            if (!this.memcacheClient) break;
            this.memcacheClient.del(key);
            break;
        case "redis":
            if (!this.redisCacheClient) break;
            this.redisCacheClient.del(key, function() {});
            break;
        default:
            if (core.noCache) return;
            this.send("del", key);
        }
    } catch(e) {
        logger.error('ipcDel:', e);
    }
}

ipc.putCache = function(key, val)
{
    try {
        switch (core.cacheType || "") {
        case "memcache":
            if (!this.memcacheClient) break;
            this.memcacheClient.set(key, val, 0);
            break;
        case "redis":
            if (!this.redisCacheClient) break;
            this.redisCacheClient.set(key, val, function() {});
            break;
        default:
            if (core.noCache) return;
            this.send("put", key, val);
        }
    } catch(e) {
        logger.error('ipcPut:', e);
    }
}

ipc.incrCache = function(key, val)
{
    try {
        switch (core.cacheType || "") {
        case "memcache":
            if (!this.memcacheClient) break;
            this.memcacheClient.incr(key, val, 0);
            break;
        case "redis":
            if (!this.redisCacheClient) break;
            this.redisCacheClient.incr(key, val, function() {});
            break;
        default:
            if (core.noCache) return;
            this.send("incr", key, val);
        }
    } catch(e) {
        logger.error('ipcIncr:', e);
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

        // Subscription server, clients connect to it, subscribe and listen for events published to it
        if (!this.subServerSocket) {
            try {
                this.subServerSocket = new backend.NNSocket(backend.AF_SP, backend.NN_PUB);
                this.subServerSocket.bind("tcp://" + core.msgBind + ":" + (core.msgPort + 1));
            } catch(e) {
                logger.error('initServerMessaging:', e);
                this.subServerSocket = null;
            }
        }

        // Publish server(s), it is where the clients send events to, it will forward them to the sub socket
        // which will distribute to all subscribed clients
        if (!this.pubServerSocket) {
            try {
                this.pubServerSocket = new backend.NNSocket(backend.AF_SP, backend.NN_PULL);
                this.pubServerSocket.bind("tcp://" + core.msgBind + ":" + core.msgPort);
                // Forward all messages to the sub server socket
                if (this.subServerSocket) this.pubServerSocket.setForward(this.subServerSocket);
            } catch(e) {
                logger.error('initServerMessaging:', e);
                this.pubServerSocket = null;
            }
        }
    }
    logger.debug('initServerMessaging:', core.msgType, core.msgPort, this.subServerSocket, this.pubServerSocket);
}

// Initialize web worker messaging system, client part, sends all publish messages to this socket which will be broadcasted into the
// publish socket by the receiving end. Can be called anytime to reconfigure if the environment has changed.
ipc.initClientMessaging = function()
{
    var self = this;

    switch (core.msgType || "") {
    case "amqp":
        if (!core.amqpHost) break;
        try {
            var opts = core.amqpOptions || {};
            opts.host = core.amqpHost;
            this.amqpClient = amqp.createConnection(opts);
            this.amqpClient.on('ready', function() {
                this.amqpClient.queue(core.amqpQueueName || '', core.amqpQueueOptions | {}, function(q) {
                    self.amqpQueue = q;
                    q.subscribe(function(message, headers, info) {
                        var cb = self.subCallbacks[info.routingKey];
                        if (!cb) cb[0](cb[1], info.routingKey, message);
                    });
                });
            });
            this.amqpClient.on("error", function(err) { logger.error('amqp:', err); })
        } catch(e) {
            logger.error('initClientMessaging:', e);
            this.amqpClient = null;
        }
        break;

    case "redis":
        if (!core.redisHost) break;
        try {
            this.redisSubClient = redis.createClient(core.redisPort, core.redisHost, core.redisOptions || {});
            this.redisSubClient.on("ready", function() {
                self.redisSubClient.on("pmessage", function(channel, message) {
                    var cb = self.subCallbacks[channel];
                    if (!cb) cb[0](cb[1], channel, message);
                });
            });
        } catch(e) {
            logger.error('initClientMessaging:', e);
            this.redisSubClient = null;
        }
        break;

    default:
        if (!backend.NNSocket || core.noMsg || !core.msgHost) break;

        // Socket where we publish our messages
        try {
            if (!this.pubSocket) {
                this.pubSocket = new backend.NNSocket(backend.AF_SP, backend.NN_PUSH);
            }
        } catch(e) {
            logger.error('initClientMessaging:', e, hosts);
            this.pubSocket = null;
        }
        this.connect(this.pubSocket, core.msgHost, core.msgPort);

        // Socket where we receive messages for us
        try {
            if (!this.subSocket) {
                this.subSocket = new backend.NNSocket(backend.AF_SP, backend.NN_SUB);
                this.subSocket.setCallback(function(err, data) {
                    if (err) return logger.error('subscribe:', err);
                    data = data.split("\1");
                    var cb = self.subCallbacks[data[0]];
                    if (cb) cb[0](cb[1], data[0], data[1]);
                });
            }
        } catch(e) {
            logger.error('initClientMessaging:', e, hosts);
            this.subSocket = null;
        }
        this.connect(this.subSocket, core.msgHost, core.msgPort + 1);
    }
    logger.debug('initClientMessaging:', core.msgType, core.msgPort, this.pubSocket, this.redisClient, this.amqpClient);
}

// Subscribe to the publishing server for messages starting with the given key, the callback will be called only on new data received
// Returns a non-zero handle which must be unsubscribed when not needed. If no pubsub system is available or error occurred returns 0.
ipc.subscribe = function(key, callback, data)
{
    var self = this;
    try {
        switch (core.msgType || "") {
        case "redis":
            if (!this.redisSubClient) break;
            this.subCallbacks[key] = [ callback, data ];
            sock = this.redisSubClient.psubscribe(key);
            break;

        case "amqp":
            if (!this.amqpQueue) break;
            this.subCallbacks[key] = [ callback, data ];
            this.amqpQueue.bind(key);
            break;

        default:
            if (!this.subSocket) break;
            this.subCallbacks[key] = [ callback, data ];
            this.subSocket.subscribe(key);
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
            if (!this.redisSubClient) break;
            this.redisSubClient.punsubscribe(key);
            break;

        case "amqp":
            if (!this.amqpQueue) break;
            this.amqpQueue.unbind(key);
            break;

        default:
            if (!this.subSocket) break;
            this.subSocket.unsubscribe(key);
        }
    } catch(e) {
        logger.error('ipcUnsubscribe:', e);
    }
}

// Publish an event to be sent to the subscribed clients
ipc.publish = function(key, data)
{
    try {
        switch (core.msgType || "") {
        case "redis":
            if (!this.redisSubClient) break;
            this.redisSubClient.publish(key, data);
            break;

        case "amqp":
            if (!this.amqpClient) break;
            this.amqpClient.publish(key, data);
            break;

        default:
            // Nanomsg socket
            if (!this.pubSocket) break;
            this.pubSocket.send(key + "\1" + JSON.stringify(data));
        }
    } catch(e) {
        logger.error('ipcPublish:', e, key);
    }
}

