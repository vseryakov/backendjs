//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const logger = require(__dirname + '/logger');
const lib = require(__dirname + '/lib');
const Client = require(__dirname + "/queue/client");

// Queue module for jobs, events and subscriptions.
//
// All methods use `options.queueName` for non-default queue.
//
// If it is an array then a client will be picked sequentially by maintaining internal sequence number.
//
// To specify a channel within a queue use the format `queueName#channelName`,
// for drivers that support multiple channels like NATS/Redis the channel will be used for another subscription within the same connection.
//
// For drivers (NATS) that support multiple consumers the full queue syntax is `queueName#channelName@groupName` or `queueName@groupName`,
// as well as the `groupName` property in the subscribe options.
//
// Empty `default` client always exists, it can be overridden to make default some other driver
//
// To enable stats collection for a queue it must be enabled
//
//      queue-redis-options-metrics=1
//

const mod = {
    name: "queue",

    args: [
        { name: "config", obj: "_config", type: "json", merge: 1, onupdate: "checkConfig", descr: 'An object with driver configs, an object with at least url or an url string, ex: `-queue-config {"redis":{"url":redis://localhost","count":1},"nats":"nats://localhost:4222"}`' },
        { name: "([a-z0-9]+)-options$", obj: "_config.$1", type: "map", merge: 1, maptype: "auto", onupdate: "applyOptions", descr: "Additional parameters for drivers, specific to each implementation, ex: `-queue-redis-options count:10,interval:100`" },
        { name: "([a-z0-9]+)-options-(.+)", obj: "_config.$1", make: "$2", camel: '-', autotype: 1, onupdate: "applyOptions", descr: "Additional parameters for drivers, specific to each implementation, ex: `-queue-default-options-count 10`" },
        { name: "([a-z0-9]+)", obj: "_config.$1", make: "url", nocamel: 1, onupdate: "applyOptions", descr: "An URL that points to a server in the format `PROTO://HOST[:PORT]?PARAMS`, multiple clients can be defined with unique names, all params starting with `bk-` will be copied into the options without the prefix and removed from the url, the rest of params will be left in the url, ex: `-queue-redis redis://localhost?bk-count=3&bk-ttl=3000`" },
    ],

    _queue: [],
    _nameIndex: 0,

    modules: [
        require(__dirname + "/queue/local"),
        require(__dirname + "/queue/worker"),
        require(__dirname + "/queue/redis"),
        require(__dirname + "/queue/sqs"),
        require(__dirname + "/queue/nats"),
    ],
    clients: { default: new Client() },

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

// Initialize a client for queue purposes, previous client will be closed.
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

// Close all existing clients except empty local client
mod.closeClients = function()
{
    for (const name in this.clients) {
        this.clients[name].close();
        delete this.clients[name];
    }
    this.clients.default = new Client();
}

// Return a new client for the given host or null if not supported
mod.createClient = function(options)
{
    var client = null;
    try {
        for (const m of this.modules) {
            client = m.create(options);
            if (client) {
                if (!client.name) client.name = m.name;
                client.applyReservedOptions(options);
                break;
            }
        }
    } catch (e) {
        logger.error("createClient:", mod.name, options, e.stack);
    }
    return client;
}

// Return a queue client by name if specified in the options or use default client which always exists,
// use `queueName` to specify a specific driver.
// If it is an array it will rotate items sequentially.
mod.getClient = mod.getQueue = function(options)
{
    var client, name = Array.isArray(options) || typeof options == "string" ? options : options?.queueName;
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

// Subscribe to receive messages from the given channel, the callback will be called only on new message received.
//  - `options.queueName` defines the queue, if not specified then it is sent to the default queue
//
//  Example:
//
//          queue.subscribe("alerts", (msg) => {
//              req.res.json(data);
//          }, req);
//
mod.subscribe = function(channel, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    logger.dev("queue.subscribe:", channel, options);
    try {
        this.getClient(options).subscribe(channel, options || {}, typeof callback == "function" ? callback : undefined);
    } catch (e) {
        logger.error('queue.subscribe:', channel, options, e.stack);
    }
    return this;
}

// Close a subscription for the given channel, no more messages will be delivered.
//  - `options.queueName` defines the queue, if not specified then it is sent to the default queue
//
mod.unsubscribe = function(channel, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    logger.dev("queue.unsubscribe:", channel, options);
    try {
        this.getClient(options).unsubscribe(channel, options || {}, typeof callback == "function" ? callback : undefined);
    } catch (e) {
        logger.error('queue.unsubscribe:', channel, e.stack);
    }
    return this;
}

// Publish an event to the channel to be delivered to all subscribers. If the `msg` is not a string it will be stringified.
//  - `options.queueName` defines the queue, if not specified then it is sent to the default queue
//
mod.publish = function(channel, msg, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    logger.dev("queue.publish:", channel, options);
    try {
        if (typeof msg != "string") msg = lib.stringify(msg);
        const client = this.getClient(options);
        const _timer = client.metrics.start();
        client.publish(channel, msg, options || {}, (err, val) => {
            _timer.end();
            if (typeof callback == "function") callback(err, val);
        });
    } catch (e) {
        logger.error('queue.publish:', channel, e.stack);
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
//          queue.listen({ queueName: "jobs" }, (msg, next) => {
//              req.res.json(data);
//              if (next) next();
//          }, req);
//
mod.listen = function(options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    logger.dev("queue.listen:", options);
    try {
        this.getClient(options).listen(options || {}, typeof callback == "function" ? callback : undefined);
    } catch (e) {
        logger.error('queue.listen:', options, e.stack);
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
mod.unlisten = function(options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    logger.dev("queue.unlisten:", options);
    try {
        this.getClient(options).unlisten(options || {}, typeof callback == "function" ? callback : undefined);
    } catch (e) {
        logger.error('queue.unlisten:', options, e.stack);
    }
    return this;
}

// Submit a message to the queue, if the `msg` is not a string it will be stringified.
//  - `options.queueName` defines the queue, if not specified then it is sent to the default queue
//  - `options.stime` defines when the message should be processed, it will be held in the queue until the time comes
//  - `options.etime` defines when the message expires, i.e. will be dropped if not executed before this time.
//
mod.submit = function(msg, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    logger.dev("queue.submit:", options);
    try {
        if (typeof msg != "string") msg = lib.stringify(msg);
        const client = this.getClient(options);
        const _timer = client.metrics.start();
        client.submit(msg, options || {}, (err, val) => {
            _timer.end();
            if (typeof callback == "function") callback(err, val);
        });
    } catch (e) {
        logger.error('queue.submit:', e.stack);
        if (typeof callback == "function") callback(e);
    }
    return this;
}

// Queue specific monitor services that must be run in the master process, this is intended to perform
// queue cleanup or dealing with stuck messages (Redis)
mod.monitor = function(options)
{
    logger.dev("queue.monitor:", options);
    try {
        this.getClient(options).monitor(options || {});
    } catch (e) {
        logger.error('queue.monitor:', e.stack);
    }
    return this;
}

// Queue specific message deletion from the queue in case of abnormal shutdown or job running too long in order not to re-run it after the restart, this
// is for queues which require manual message deletion ofter execution(SQS). Each queue client must maintain the mapping or other means to identify messages,
// the options is the message passed to the listener
mod.drop = function(msg, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    logger.dev("queue.drop:", msg, options);
    try {
        this.getClient(options).drop(msg, options || {}, callback);
    } catch (e) {
        logger.error('queue.drop:', e.stack);
        if (typeof callback == "function") callback(e);
    }
    return this;
}

mod.bkCollectStats = function(options)
{
    for (let q in this.clients) {
        const cl = this.clients[q];
        if (!cl.options?.metrics) continue;
        const m = cl.metrics.toJSON({ reset: 1 });
        q = cl.queueName;
        if (!m.meter?.count) continue;
        options.stats["queue_" + q + "_req_count"] = m.meter.count;
        options.stats["queue_" + q + "_req_rate"] = m.meter.rate;
        options.stats["queue_" + q + "_res_time"] = m.histogram.med;
    }
}


