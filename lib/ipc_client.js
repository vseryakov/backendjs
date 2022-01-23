//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const url = require('url');
const util = require("util");
const events = require("events");
const logger = require(__dirname + '/logger');
const lib = require(__dirname + '/../lib/lib');
const metrics = require(__dirname + '/metrics');

// Base class for the IPC clients, implements cache and queue protocols in the same class, some clients can support both(Redis),
// not supported methods just do nothing without raising any errors
module.exports = IpcClient;

function IpcClient(uri, options)
{
    options = options || {};
    events.EventEmitter.call(this);
    this.setMaxListeners(0);
    this.url = String(uri || "");
    this.options = {};
    this._polling = {};
    for (const p in options) this.options[p] = options[p];
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
    logger.debug("client:", this.url, this.options);
}
util.inherits(IpcClient, events.EventEmitter);

// Close current connection, ports.... not valid after this call
IpcClient.prototype.close = function()
{
    this.url = "";
    this.options = {};
    this._polling = {};
    this.removeAllListeners();
}

// Prepare options to be used safely
IpcClient.prototype.applyOptions = function()
{
}

// Return a subscription channel from the given name or options, the same client can support multiple subscriptions, additional
// subscriptions are specified by appending `#channel` to the `options.queueName`, default is to use the primary queue name
IpcClient.prototype.channel = function(options)
{
    var name = typeof options == "string" ? options : options && options.queueName || this.options.queueName;
    if (typeof name == "string") {
        var h = name.indexOf("#");
        if (h > -1) return name.substr(h + 1);
    }
    return this.queueName;
}

// Return canonical queue name, default channel is not appended
IpcClient.prototype.canonical = function(options)
{
    var chan = this.channel(options);
    return this.queueName + (chan == this.queueName ? "" : "#" + chan);
}

// CACHE MANAGEMENT

// Returns the cache statistics to the callback as the forst argument, the object tructure is specific to each cache implementstion
IpcClient.prototype.stats = function(options, callback)
{
    if (typeof callback == "function") callback()
}

// Clear all or only matched keys from the cache
IpcClient.prototype.clear = function(pattern, callback)
{
    if (callback) callback();
}

// Returns an item from the cache by a key, callback is required and it acceptes only the item,
// on any error null or undefined will be returned
IpcClient.prototype.get = function(key, options, callback)
{
    if (typeof callback == "function") callback()
}

// Store an item in the cache, `options.ttl` can be used to specify TTL in milliseconds
IpcClient.prototype.put = function(key, val, options, callback)
{
    if (typeof callback == "function") callback()
}

// Add/substract a number from the an item, returns new number in the callback if provided, in case of an error null/indefined should be returned
IpcClient.prototype.incr = function(key, val, options, callback)
{
    if (typeof callback == "function") callback(0);
}

// Delete an item from the cache
IpcClient.prototype.del = function(key, options, callback)
{
    if (typeof callback == "function") callback();
}

// EVENT MANAGEMENT

// Subscribe to receive notification from the given channel
IpcClient.prototype.subscribe = function(channel, options, callback)
{
    this.addListener(channel, callback);
}

// Stop receiving notifications on the given channel
IpcClient.prototype.unsubscribe = function(channel, options, callback)
{
    if (typeof callback == "function") {
        this.removeListener(channel, callback);
    } else {
        this.removeAllListeners(channel);
    }
}

// Publish an event
IpcClient.prototype.publish = function(channel, msg, options, callback)
{
    if (typeof callback == "function") callback();
}

// QUEUE MANAGEMENT

// Listen for incoming messages
IpcClient.prototype.subscribeQueue = function(options, callback)
{
    var chan = this.channel(options);
    this.addListener(chan, callback);
    if (!this._polling[chan]) {
        this._polling[chan] = 1;
        this.schedulePollQueue(options);
    }
}

// Stop receiving messages
IpcClient.prototype.unsubscribeQueue = function(options, callback)
{
    var chan = this.channel(options);
    if (typeof callback == "function") {
        this.removeListener(chan, callback);
    } else {
        this.removeAllListeners(chan);
    }
    if (this._polling[chan] && !this.listenerCount(chan)) {
        delete this._polling[chan];
    }
}

// Submit a job to a queue
IpcClient.prototype.publishQueue = function(msg, options, callback)
{
    if (typeof callback == "function") callback();
}

// Drop a job in case of abnormal shutdown or exceeded run time
IpcClient.prototype.unpublishQueue = function(options, callback)
{
    if (typeof callback == "function") callback();
}

// This method must take care how to keep the poller running via interval or timeout as long as the `this._pollingQueue=1`.
IpcClient.prototype.pollQueue = function(options)
{
}

// Schedule next poller iteration immediately or after timeout, check configured polling rate, make sure it polls no more than
// configured number of times per second
IpcClient.prototype.schedulePollQueue = function(options, timeout)
{
    var chan = this.channel(options);
    if (!this._polling[chan]) return;
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
IpcClient.prototype.monitorQueue = function()
{
}

// LOCKING MANAGEMENT

// By default return an error
IpcClient.prototype.lock = function(name, options, callback)
{
    if (typeof callback == "function") callback({ status: 500, message: "not implemented" });
}

IpcClient.prototype.unlock = function(name, options, callback)
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
IpcClient.prototype.limiter = function(options, callback)
{
    if (typeof callback == "function") callback(0, {});
}


