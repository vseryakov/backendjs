//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const url = require('url');
const util = require("util");
const events = require("events");
const logger = require(__dirname + '/../logger');
const lib = require(__dirname + '/../lib');
const metrics = require(__dirname + '/../metrics');

// Base class for the IPC clients, implements cache and queue protocols in the same class, some clients can support both(Redis),
// not supported methods just do nothing without raising any errors
module.exports = Client;

function Client(options)
{
    events.EventEmitter.call(this);
    this.setMaxListeners(0);
    this.queueName = "";
    this.url = String(options?.url || "");
    this.options = {};
    this._polling = {};
    this.metrics = {
        req: new metrics.Timer(),
        que: new metrics.Timer(),
    };
    this.applyOptions(options);
    this.on("ready", () => { this.ready = true });
    this.on("pause", () => { this.paused = true });
    this.on("unpause", () => { this.paused = false });
    logger.debug("client:", this.url, this.options);
}
util.inherits(Client, events.EventEmitter);

// Close current connection, ports.... not valid after this call
Client.prototype.close = function()
{
    this.url = "";
    this.options = {};
    this._polling = {};
    this.metrics.req.end();
    this.metrics.que.end();
    this.removeAllListeners();
}

// Prepare options to be used safely, parse the reserved params from the url
Client.prototype.applyOptions = function(options)
{
    for (const p in options) {
        if (p[0] != "_" && p != "url") this.options[p] = options[p];
    }
    const h = url.parse(this.url, true);
    this.port = h.port || 0;
    this.protocol = h.protocol;
    this.hostname = h.hostname || "";
    this.pathname = h.pathname || "";
    for (const p in h.query) {
        var d = p.match(/^bk-(.+)/);
        if (!d) continue;
        this.options[d[1]] = lib.isNumeric(h.query[p]) ? lib.toNumber(h.query[p]) : h.query[p];
        delete h.query[p];
    }
    h.search = null;
    h.path = null;
    this.url = url.format(h);
}

// Handle reserved options
Client.prototype.applyReservedOptions = function(options)
{
    for (const p of ["paused"]) {
        if (typeof options[p] != "undefined") this[p] = options[p];
    }
}

// Return a subscription channel from the given name or options, the same client can support multiple subscriptions, additional
// subscriptions are specified by appending `#channel` to the `options.queueName`, default is to use the primary queue name.
// Consumer name if present is stripped off.
Client.prototype.channel = function(options)
{
    var name = typeof options == "string" ? options : options?.queueName || this.options?.queueName;
    if (typeof name == "string") {
        var h = name.indexOf("#");
        if (h > -1) {
            var e = name.indexOf("@", h);
            return name.slice(h + 1, e > -1 ? e : name.length);
        }
        h = name.indexOf("@");
        if (h > -1) return name.substr(0, h);
    }
    return this.queueName;
}

// Returns the consumer name for the given queue or empty if not specified, `groupName` will be used as the consumer name if present
Client.prototype.consumer = function(options)
{
    var name = typeof options == "string" ? options : options?.queueName || this.options?.queueName;
    if (typeof name == "string") {
        var h = name.indexOf("@");
        if (h > -1) return name.substr(h + 1);
    }
    return options?.groupName || "";
}

// Return canonical queue name, default channel is not appended, default consumer is not appened
Client.prototype.canonical = function(options)
{
    var chan = this.channel(options);
    var consumer = this.consumer(options);
    var name = this.queueName;
    if (chan && chan != this.queueName) name += "#" + chan;
    if (consumer && consumer != this.queueName) name += "@" + consumer;
    return name;
}

// CACHE MANAGEMENT

// Returns the cache statistics to the callback as the forst argument, the object tructure is specific to each cache implementstion
Client.prototype.stats = function(options, callback)
{
    if (typeof callback == "function") callback()
}

// Clear all or only matched keys from the cache
Client.prototype.clear = function(pattern, callback)
{
    if (callback) callback();
}

// Returns an item from the cache by a key, callback is required and it acceptes only the item,
// on any error null or undefined will be returned
Client.prototype.get = function(key, options, callback)
{
    if (typeof callback == "function") callback()
}

// Store an item in the cache, `options.ttl` can be used to specify TTL in milliseconds
Client.prototype.put = function(key, val, options, callback)
{
    if (typeof callback == "function") callback()
}

// Add/substract a number from the an item, returns new number in the callback if provided, in case of an error null/indefined should be returned
Client.prototype.incr = function(key, val, options, callback)
{
    if (typeof callback == "function") callback(0);
}

// Delete an item from the cache
Client.prototype.del = function(key, options, callback)
{
    if (typeof callback == "function") callback();
}

// EVENT MANAGEMENT

// Subscribe to receive notification from the given channel
Client.prototype.subscribe = function(channel, options, callback)
{
    this.addListener(channel, callback);
}

// Stop receiving notifications on the given channel
Client.prototype.unsubscribe = function(channel, options, callback)
{
    if (typeof callback == "function") {
        this.removeListener(channel, callback);
    } else {
        this.removeAllListeners(channel);
    }
}

// Publish an event
Client.prototype.publish = function(channel, msg, options, callback)
{
    if (typeof callback == "function") callback();
}

// QUEUE MANAGEMENT

// Listen for incoming messages
Client.prototype.subscribeQueue = function(options, callback)
{
    var sub = this.canonical(options);
    this.applyReservedOptions(options);
    this.addListener(sub, callback);
    if (!this._polling[sub]) {
        this._polling[sub] = 1;
        this.schedulePollQueue(options);
    }
}

// Stop receiving messages
Client.prototype.unsubscribeQueue = function(options, callback)
{
    var sub = this.canonical(options);
    if (typeof callback == "function") {
        this.removeListener(sub, callback);
    } else {
        this.removeAllListeners(sub);
    }
    if (this._polling[sub] && !this.listenerCount(sub)) {
        delete this._polling[sub];
    }
}

// Submit a job to a queue
Client.prototype.publishQueue = function(msg, options, callback)
{
    if (typeof callback == "function") callback();
}

// Drop a job in case of abnormal shutdown or exceeded run time
Client.prototype.unpublishQueue = function(options, callback)
{
    if (typeof callback == "function") callback();
}

// This method must take care how to keep the poller running via interval or timeout as long as the `this._pollingQueue=1`.
Client.prototype.pollQueue = function(options)
{
}

// Schedule next poller iteration immediately or after timeout, check configured polling rate, make sure it polls no more than
// configured number of times per second. If not ready then keep polling until the ready signal is sent.
// Two events can be used for back pressure support: `pause` and `unpause` to stop/restart queue processing
Client.prototype.schedulePollQueue = function(options, timeout)
{
    var sub = this.canonical(options);
    if (!this._polling[sub]) return;
    if (!this.ready || this.paused) {
        return setTimeout(this.schedulePollQueue.bind(this, options), timeout || this.interval || 500);
    }
    if (this.options.pollingRate > 0) {
        if (!this._tokenBucket || !this._tokenBucket.equal(this.options.pollingRate)) this._tokenBucket = new metrics.TokenBucket(this.options.pollingRate);
        if (!this._tokenBucket.consume(1)) timeout = Math.max(timeout || 0, this._tokenBucket.delay(1));
    }
    if (timeout > 0) {
        setTimeout(this.pollQueue.bind(this, options), timeout);
    } else {
        setImmediate(this.pollQueue.bind(this, options));
    }
}

// Queue monitor or cleanup service, when poller is involved this will be started and can be used for cleaning up stale messages or other
// maintainence work the requires.
Client.prototype.monitorQueue = function()
{
}

// LOCKING MANAGEMENT

// By default return an error
Client.prototype.lock = function(name, options, callback)
{
    logger.error("lock:", "NOT IMPLEMENTED", name, options);
    if (typeof callback == "function") callback({ status: 500, message: "not implemented" });
}

Client.prototype.unlock = function(name, options, callback)
{
    if (typeof callback == "function") callback();
}

// RATE CONTROL

// Rate limit check, by default it uses the master LRU cache meaning it works within one physical machine only.
//
// The options must have the following properties:
// - name - unique id, can be IP address, account id, etc...
// - rate, max, interval - same as for `metrics.TokenBucket` rate limiter.
//
// The callback arguments must be:
// - 1st arg is a delay to wait till the bucket is ready again,
// - 2nd arg is an object with the bucket state: { delay:, count:, total:, elapsed: }
//
Client.prototype.limiter = function(options, callback)
{
    logger.error("limiter:", "NOT IMPLEMENTED", options);
    if (typeof callback == "function") callback(60000, {});
}


