//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  May 2015
//

var url = require('url');
var util = require("util");
var events = require("events");
var logger = require(__dirname + '/logger');
var metrics = require(__dirname + '/metrics');
var lib = require(__dirname + '/lib');

// Base class for the IPC clients, implements cache and queue protocols in the same class, some clients can support both(Redis),
// not supported methods just do nothing without raising any errors
module.exports = IpcClient;

function IpcClient(uri, options)
{
    events.EventEmitter.call(this);
    this.setMaxListeners(0);
    this.url = String(uri || "");
    this.options = {};
    this.servers = [];
    this._polling = 0;
    this._listeners = 0;
    for (var p in options) this.options[p] = options[p];
    var h = url.parse(this.url, true);
    this.port = h.port || 0;
    this.hostname = h.hostname || "";
    this.pathname = h.pathname || "";
    for (var p in h.query) {
        var d = p.match(/^bk-(.+)/);
        if (!d) continue;
        this.options[d[1]] = h.query[p];
        delete h.query[p];
    }
    h.search = null;
    h.path = null;
    this.url = url.format(h);
    logger.debug("ipc: client", this.url, this.options);
}
util.inherits(IpcClient, events.EventEmitter);

// Close current connection, ports.... not valid after this call
IpcClient.prototype.close = function()
{
    this.url = "";
    this.options = {};
    this.removeAllListeners();
    this._polling = 0;
    this._listeners = 0;
}

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

// This is called to configure and setup event processing on first subscribe call, if nobody subscribes this
// will never be called and thus no initialization for event processing either, for clients that only publish this may save
// lots of processing and memory.
//
// This method must take care how to keep the poller running via interval or timeout as long as the `this._polling=1`.
IpcClient.prototype.poller = function()
{
}

// Schedule next poller iteration immediately or after timeout, check configured polling rate, make sure it polls no more than
// configured number of times per second
IpcClient.prototype.schedulePoller = function(timeout)
{
    if (!this._polling) return;
    var now = Date.now();
    if (this.options.pollingRate > 0) {
        if (!this._tokenBucket || !this._tokenBucket.equal(this.options.pollingRate)) this._tokenBucket = new metrics.TokenBucket(this.options.pollingRate);
        if (!this._tokenBucket.consume(1)) timeout = Math.max(timeout || 0, this._tokenBucket.delay(1));
    }
    if (timeout) {
        setTimeout(this.poller.bind(this), timeout);
    } else {
        setImmediate(this.poller.bind(this));
    }
}

// Queue monitor or cleanup service, when poller is involved this will be started and can be used for cleaning up stale messages or other
// maintainence work the requires.
IpcClient.prototype.monitor = function()
{
}

// Returns 1 if the poller is active
IpcClient.prototype.isPolling = function()
{
    return this._polling;
}

// Rate limit check, by default it uses the master LRU cache meaning it works within one physical machine only.
//
// The options must have the following properties:
// - name - unique id, can be IP address, account id, etc...
// - rate, max, interval - same as for `metrics.TokenBucket` rate limiter.
//
// The callback argument will be called with an object where the property `consumed` set to true if consumed or false otherwise,
// and the property `delay` with number of milliseconds till the bucket can be used again.
//
IpcClient.prototype.limiter = function(options, callback)
{
    if (typeof callback == "function") callback(0);
}

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

// Listen for incoming messages
IpcClient.prototype.listen = function(options, callback)
{
    this.addListener("message", callback);
    this._listeners++;
    if (!this._polling) {
        this._polling = 1;
        this.schedulePoller();
    }
}

// Stop receiving messages
IpcClient.prototype.unlisten = function(options, callback)
{
    if (typeof callback == "function") {
        this.removeListener("message", callback);
    } else {
        this.removeAllListeners("message");
    }
    if (this._listeners) {
        this._listeners--;
    }
    if (this._polling && !this._listeners) {
        this._polling = 0;
    }
}

// Submit a message to a queue
IpcClient.prototype.submit = function(msg, options, callback)
{
    if (typeof callback == "function") callback();
}

// By default always lock because of lack of actual implementtion
IpcClient.prototype.lock = function(name, options, callback)
{
    if (typeof callback == "function") callback(null, 1);
}

IpcClient.prototype.unlock = function(name, options, callback)
{
    if (typeof callback == "function") callback();
}



