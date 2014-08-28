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
var apnagent = require("apnagent");
var gcmagent = require('node-gcm');

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

// A handler for unhandled messages, it is called by the server and client. In case of the server, `this` is a worker object, so to send a message back to the worker
// use `this.send()`.
ipc.onMessage = function(msg) {}

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
            case "api:restart":
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

            case "profiler":
                core.profiler("cpu", msg.value ? "start" : "stop");
                break;

            case "heapsnapshot":
                core.profiler("heap", "save");
                break;
            }
            self.onMessage(msg);
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

    cluster.on("exit", function(worker, code, signal) {
        self.onMessage.call(worker, { op: "cluster:exit" });
    });

    cluster.on('fork', function(worker) {
        // Handle cache request from a worker, send back cached value if exists, this method is called inside worker context
        worker.on('message', function(msg) {
            if (!msg) return false;
            logger.dev('msg:master:', msg);
            try {
                switch (msg.op) {
                case "api:restart":
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
                        cluster.workers[p].send({ op: "api:restart" });
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
                    if (Array.isArray(msg.name)) {
                        msg.value = {};
                        msg.name.forEach(function(x) { msg.value[x] = backend.lruGet(x); });
                    } else
                    if (msg.name) {
                        msg.value = backend.lruGet(msg.name);
                    }
                    worker.send(msg);
                    break;

                case 'exists':
                    if (msg.name) msg.value = backend.lruExists(msg.name);
                    worker.send(msg);
                    break;

                case 'put':
                    if (msg.name && msg.value) backend.lruPut(msg.name, msg.value);
                    if (msg.reply) worker.send(msg);
                    break;

                case 'incr':
                    if (msg.name && msg.value) msg.value = backend.lruIncr(msg.name, msg.value);
                    if (msg.reply) worker.send(msg);
                    break;

                case 'del':
                    if (msg.name) backend.lruDel(msg.name);
                    if (msg.reply) worker.send(msg);
                    break;

                case 'clear':
                    backend.lruClear();
                    if (msg.reply) worker.send({});
                    break;
                }
                self.onMessage.call(worker, msg);

            } catch(e) {
                logger.error('msg:', e, msg);
            }
        });
    });
}

// Initialize caching system for the configured cache type, can be called many time to re-initialize if the environment has changed
ipc.initServerCaching = function()
{
    var self = this;
    backend.lruInit(core.lruMax);

    switch (core.cacheType) {
    case "memcache":
        break;

    case "redis":
        break;

    case "nanomsg":
        if (!backend.NNSocket) break;
        core.cacheBind = core.cacheBind || (core.cacheHost == "127.0.0.1" || core.cacheHost == "localhost" ? "127.0.0.1" : "*");

        // Socket to publish cache update to all connected subscribers
        this.bind('lpub', "nanomsg", core.cacheBind, core.cachePort + 1, { type: backend.NN_PUB });
        // Socket to read a cache update and forward it to the subcribers
        this.bind('lpull', "nanomsg", core.cacheBind, core.cachePort, { type: backend.NN_PULL, forward: this.nanomsg.lpub });

        // Socket to subscribe for updates and actually update the cache
        this.connect('lsub', "nanomsg", core.cacheHost, core.cachePort + 1, { type: backend.NN_SUB, subscribe: [""] }, function(err, data) {
            if (err) return logger.error('lsub:', err);
            // \1key - del key
            // \2key\2val - set key with val
            // \3key\3val - incr key by val
            // \4 - clear cache
            switch (data[0]) {
            case "\1":
                backend.lruDel(data.substr(1));
                break;
            case "\2":
                data = data.substr(1).split("\2");
                backend.lruPut(data[0], data[1]);
                break;
            case "\3":
                data = data.substr(1).split("\3");
                backend.lruIncr(data[0], data[1]);
                break;
            case "\4":
                backend.lruClear();
                break;
            }
        });
        break;
    }
}

// Initialize web worker caching system, can be called anytime the environment has changed
ipc.initClientCaching = function()
{
    var self = this;
    switch (core.cacheType) {
    case "memcache":
        this.connect("client", "memcache", core.memcacheHost, core.memcachePort, core.memcacheOptions);
        break;

    case "redis":
        this.connect("client", "redis", core.redisHost, core.redisPort, core.redisOptions);
        break;

    case "nanomsg":
        this.connect('lpush', "nanomsg", core.cacheHost, core.cachePort, { type: backend.NN_PUSH });
        break;
    }
}

// Initialize messaging system for the server process, can be called multiple times in case environment has changed
ipc.initServerMessaging = function()
{
    switch (core.msgType) {
    case "redis":
        break;

    case "nanomsg":
        if (!backend.NNSocket || core.noMsg) break;
        core.msgBind = core.msgBind || (core.msgHost == "127.0.0.1" || core.msgHost == "localhost" ? "127.0.0.1" : "*");

        // Subscription server, clients connects to it, subscribes and listens for events published to it, every Web worker process connects to this socket.
        this.bind('msub', "nanomsg", core.msgBind, core.msgPort + 1, { type: backend.NN_PUB });

        // Publish server(s), it is where the clients send events to, it will forward them to the sub socket
        // which will distribute to all subscribed clients. The publishing is load-balanced between multiple PUSH servers
        // and automatically uses next live server in case of failure.
        this.bind('mpub', "nanomsg", core.msgBind, core.msgPort, { type: backend.NN_PULL , forward: this.nanomsg.msub });
        break;
    }
}

// Initialize web worker messaging system, client part, sends all publish messages to this socket which will be broadcasted into the
// publish socket by the receiving end. Can be called anytime to reconfigure if the environment has changed.
ipc.initClientMessaging = function()
{
    var self = this;

    switch (core.msgType) {
    case "amqp":
        this.connect("client", "amqp", core.amqpHost, core.amqpPort, core.amqpOptions, function() {
            this.queue(core.amqpQueueName || '', core.amqpQueueOptions | {}, function(q) {
                self.amqp.queue = q;
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

    case "nanomsg":
        if (!backend.NNSocket || core.noMsg || !core.msgHost) break;

        // Socket where we publish our messages
        this.connect('pub', "nanomsg", core.msgHost, core.msgPort, { type: backend.NN_PUSH });

        // Socket where we receive messages for us
        this.connect('sub', "nanomsg", core.msgHost, core.msgPort + 1, { type: backend.NN_SUB }, function(err, data) {
            if (err) return logger.error('subscribe:', err);
            data = data.split("\1");
            var cb = self.subCallbacks[data[0]];
            if (cb) cb[0](cb[1], data[0], data[1]);
        });
        break;
    }
}

// Close all caching and messaging clients, can be called by a server or a worker
ipc.shutdown = function()
{
    var self = this;
    ["nanomsg","redis","memcache","amqp"].forEach(function(type) { for (var name in this[type]) { this.close(type, name); } });
}

// Send a command to the master process via IPC messages, callback is used for commands that return value back
ipc.command = function(msg, callback, timeout)
{
    if (!cluster.isWorker) return callback ? callback() : null;

    if (typeof callback == "function") {
        msg.reply = true;
        msg.id = this.msgId++;
        core.deferCallback(this.msgs, msg, function(m) { callback(m.value); }, timeout);
    }
    try { process.send(msg); } catch(e) { logger.error('send:', e, msg.op, msg.name); }
}

// Always send text to the master, convert objects into JSON, value and callback are optional
ipc.send = function(op, name, value, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    var msg = { op: op };
    if (name) msg.name = name;
    if (value) msg.value = typeof value == "object" ? core.stringify(value) : value;
    if (options && options.local) msg.local = true;
    this.command(msg, callback, options ? options.timeout : 0);
}

// Bind a socket to the address and port i.e. initialize the server socket
ipc.bind = function(name, type, host, port, options, callback)
{
    if (!host || !this[type]) return;

    logger.debug("ipc.bind:", type, name, host, port, options);

    switch (type) {
    case "redis":
    case "memcache":
    case "amqp":
        break;

    case "nanomsg":
        if (!backend.NNSocket) break;
        if (!this[type][name]) this[type][name] = new backend.NNSocket(backend.AF_SP, options.type);
        if (this[type][name] instanceof backend.NNSocket) {
            var h = host.split(":");
            host = "tcp://" + h[0] + ":" + (h[1] || port)
            var err = this[type][name].bind(host);
            if (!err) err = this.setup(name, type, options, callback);
            if (err) logger.error('ipc.bind:', host, this[type][name]);
        }
        break;
    }
    return this[type][name];
}

// Connect to the host(s)
ipc.connect = function(name, type, host, port, options, callback)
{
    logger.debug("ipc.connect:", type, name, host, port, options);
    if (!host || !this[type]) return;

    switch (type) {
    case "amqp":
    case "redis":
    case "memcache":
        if (this[type][name]) break;
        try {
            switch (type) {
            case "amqp":
                this[type][name] = amqp.createConnection(core.cloneObj(options, "host", host));
                break;
            case "redis":
                this[type][name] = redis.createClient(port, host, options || {});
                break;
            case "memcache":
                this[type][name] = new memcached(host, options || {});
                break;
            }
            this[type][name].on("error", function(err) { logger.error(type, name, host, err) });
            if (callback) this[type][name].on("ready", function() { callback.call(this) });
        } catch(e) {
            delete this[type][name];
            logger.error('ipc.connect:', name, type, host, e);
        }
        break;

    case "nanomsg":
        if (!backend.NNSocket) break;
        if (!this[type][name]) this[type][name] = new backend.NNSocket(backend.AF_SP, options.type);
        if (this[type][name] instanceof backend.NNSocket) {
            host = core.strSplit(host).map(function(x) { x = x.split(":"); return "tcp://" + x[0] + ":" + (x[1] || port); }).join(',');
            var err = this[type][name].connect(host);
            if (!err) err = this.setup(name, type, options, callback);
            if (err) logger.error('ipc.connect:', host, this[type][name]);
        }
        break;
    }
    return this[type][name];
}

// Setup a socket or client, return depends on the client type
ipc.setup = function(name, type, options, callback)
{
    var self = this;
    switch (type) {
    case "nanomsg":
        var err = 0;
        if (!err && typeof options.peer != "undefined") err = this[type][name].setPeer(options.peer);
        if (!err && typeof options.forward != "undefined") err = this[type][name].setForward(options.forward);
        if (!err && Array.isArray(options.subscribe)) options.subscribe.forEach(function(x) { if (!err) err = self[type][name].subscribe(x); });
        if (!err && Array.isArray(options.opts)) options.opts.forEach(function(x) { if (!err) err = self[type][name].setOption(x[0], x[1]); });
        if (!err && callback) err = this[type][name].setCallback(callback);
        return err;
    }
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

ipc.stats = function(callback)
{
    try {
        switch (core.cacheType) {
        case "memcache":
            if (!this.memcache.client) return callback({});
            this.memcache.client.stats(function(e,v) { callback(v) });
            break;
        case "redis":
            if (!this.redis.client) return callback({});
            this.redis.client.info(function(e,v) { callback(v) });
            break;
        case "nanomsg":
            this.send("stats", "", "", callback);
            break;
        }
    } catch(e) {
        logger.error('ipc.stats:', e);
        callback({});
    }
}

ipc.keys = function(callback)
{
    try {
        switch (core.cacheType) {
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

        case "nanomsg":
            this.send("keys", "", "", callback);
            break;
        }
    } catch(e) {
        logger.error('ipcKeys:', e);
        callback({});
    }
}

ipc.clear = function()
{
    try {
        switch (core.cacheType) {
        case "memcache":
            if (!this.memcache.client) break;
            this.memcache.client.flush();
            break;

        case "redis":
            if (!this.redis.client) break;
            this.redis.client.flushall();
            break;

        case "nanomsg":
            if (!this.nanomsg.lpush) break;
            this.nanomsg.lpush.send("\4");
            break;

        case "local":
            this.send("clear");
            break;
        }
    } catch(e) {
        logger.error('ipc.clear:', e);
    }
}

ipc.get = function(key, options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    try {
        switch (core.cacheType) {
        case "memcache":
            if (!this.memcache.client) return callback({});
            this.memcache.client.get(key, function(e, v) { callback(v) });
            break;

        case "redis":
            if (!this.redis.client) return callback();
            this.redis.client.get(key, function(e, v) {
                if (Array.isArray(key)) v = key.map(function(x) { return {} });
                callback(v);
            });
            break;

        case "nanomsg":
            this.send("get", key, "", options, callback);
            break;
        }
    } catch(e) {
        logger.error('ipc.get:', e);
        callback();
    }
}

ipc.del = function(key, options)
{
    try {
        switch (core.cacheType) {
        case "memcache":
            if (!this.memcache.client) break;
            this.memcache.client.del(key);
            break;

        case "redis":
            if (!this.redis.client) break;
            this.redis.client.del(key, function() {});
            break;

        case "nanomsg":
            if (!this.nanomsg.lpush) break;
            this.nanomsg.lpush.send("\1" + key);
            break;

        case "local":
            this.send("del", key, "", options);
            break;
        }
    } catch(e) {
        logger.error('ipc.del:', e);
    }
}

ipc.put = function(key, val, options)
{
    try {
        switch (core.cacheType) {
        case "memcache":
            if (!this.memcache.client) break;
            this.memcache.client.set(key, val, 0);
            break;

        case "redis":
            if (!this.redis.client) break;
            this.redis.client.set(key, val, function() {});
            break;

        case "nanomsg":
            if (!this.nanomsg.lpush) break;
            this.nanomsg.lpush.send("\2" + key + "\2" + val);
            break;

        case "local":
            this.send("put", key, val, options);
            break;
        }
    } catch(e) {
        logger.error('ipc.put:', e);
    }
}

ipc.incr = function(key, val, options)
{
    try {
        switch (core.cacheType) {
        case "memcache":
            if (!this.memcache.client) break;
            this.memcache.client.incr(key, val, 0);
            break;

        case "redis":
            if (!this.redis.client) break;
            this.redis.client.incr(key, val, function() {});
            break;

        case "nanomsg":
            if (!this.nanomsg.lpush) break;
            this.nanomsg.lpush.send("\3" + key + "\3" + val);
            break;

        case "local":
            this.send("incr", key, val, options);
            break;
        }
    } catch(e) {
        logger.error('ipc.incr:', e);
    }
}

// Subscribe to the publishing server for messages starting with the given key, the callback will be called only on new data received
// Returns a non-zero handle which must be unsubscribed when not needed. If no pubsub system is available or error occurred returns 0.
ipc.subscribe = function(key, callback, data)
{
    var self = this;
    try {
        switch (core.msgType) {
        case "redis":
            if (!this.redis.sub) break;
            this.subCallbacks[key] = [ callback, data ];
            sock = this.redis.sub.psubscribe(key);
            break;

        case "amqp":
            if (!this.amqp.queue) break;
            this.subCallbacks[key] = [ callback, data ];
            this.amqp.queue.bind(key);
            break;

        case "nanomsg":
            if (!this.nanomsg.sub) break;
            this.subCallbacks[key] = [ callback, data ];
            this.nanomsg.sub.subscribe(key);
            break;
        }
    } catch(e) {
        logger.error('ipc.subscribe:', this.subHost, key, e);
    }
}

// Close subscription
ipc.unsubscribe = function(key)
{
    try {
        delete this.subCallbacks[key];
        switch (core.msgType) {
        case "redis":
            if (!this.redis.sub) break;
            this.redis.sub.punsubscribe(key);
            break;

        case "amqp":
            if (!this.amqp.queue) break;
            this.amqp.queue.unbind(key);
            break;

        case "nanomsg":
            if (!this.nanomsg.sub) break;
            this.nanomsg.sub.unsubscribe(key);
            break;
        }
    } catch(e) {
        logger.error('ipc.unsubscribe:', e);
    }
}

// Publish an event to be sent to the subscribed clients
ipc.publish = function(key, data, callback)
{
    try {
        switch (core.msgType) {
        case "redis":
            if (!this.redis.pub) break;
            this.redis.pub.publish(key, data);
            break;

        case "amqp":
            if (!this.amqp.client) break;
            this.amqp.client.publish(key, data);
            break;

        case "nanomsg":
            if (!this.nanomsg.pub) break;
            this.nanomsg.pub.send(key + "\1" + JSON.stringify(data));
            break;
        }
    } catch(e) {
        logger.error('ipc.publish:', e, key);
    }
}

// Initiaize Apple Push Notification service in the current process, Apple supports multiple connections to the APN gateway but
// not too many so this should be called on the dedicated backend hosts, on multi-core servers every spawn web process will initialize a
// connection to APN gateway.
ipc.initAPN = function()
{
    var self = this;

    logger.log("initAPN:", "cert:", core.apnCert);

    this.apnAgent = new apnagent.Agent();
    this.apnAgent.set('pfx file', core.apnCert);
    this.apnAgent.enable(core.apnProduction || core.apnCert.indexOf("production") > -1 ? 'production' : 'sandbox');
    this.apnAgent.on('message:error', function(err) { if (err && err.code != 10) logger.error('apn:', err) });
    this.apnAgent.on('gateway:error', function(err) { if (err && err.code != 10) logger.error('apn:', err) });
    this.apnAgent.connect(function(err) { if (err && err.code != 10) logger.error('apn:', err); });

    this.apnFeedback = new apnagent.Feedback();
    this.apnFeedback.set('interval', '1h');
    this.apnFeedback.set('pfx file', core.apnCert);
    this.apnFeedback.connect(function(err) { if (err && err.code != 10) logger.error('apn: feedback:', err);  });
    this.apnFeedback.use(function(device, timestamp, next) {
        logger.log('apn: feedback:', device, timestamp);
        next();
    });
}

// Send push notification to an Apple device, returns true if the message has been queued.
//
// The options may contain the following properties:
//  - msg - message text
//  - badge - badge number
//  - type - set type of the packet
//  - id - send id in the user properties
ipc.sendAPN = function(device_id, options, callback)
{
    var self = this;
    if (!this.apnAgent) return callback ? callback("APN is not initialized") : false;

    var pkt = this.apnAgent.createMessage().device(device_id);
    if (options.msg) pkt.alert(options.msg);
    if (options.badge) pkt.badge(options.badge);
    if (options.type) pkt.set("type", options.type);
    if (options.id) pkt.set("id", options.id);
    pkt.send();
    if (callback) callback();
    return true;
}

// Initialize Google Cloud Messaginh servie to send push notifications to mobile devices
ipc.initGCM = function()
{
    var self = this;
}

// Send push notification to an Android device, return true if queued.
ipc.sendGCM = function(device_id, options, callback)
{
    var self = this;
    if (!core.gcmKey) return callback ? callback("GCM is not initialized") : false;

    var pkt = new gcm.Message();
    var sender = new gcm.Sender(core.gcmKey);
    if (options.msg) pkt.addData('msg', options.msg);
    if (options.id) pkt.addData('id', options.id);
    if (options.badge) pkt.addData('badge', options.badge);
    sender.send(pkg, core.gcmRegistrationIds, 2, callback);
    return true;
}

