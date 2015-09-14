//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  May 2015
//

var url = require('url');
var util = require("util");
var events = require("events");
var logger = require(__dirname + '/../logger');
var lib = require(__dirname + '/../lib');

// Base class for the IPC clients, implements cache and queue protocols in the same class, some clients can support both(Redis),
// not supported methods just do nothing without raising any errors
module.exports = IpcClient;

function IpcClient(host, options)
{
    events.EventEmitter.call(this);
    this.setMaxListeners(0);
    this.host = String(host || "");
    this.options = {};
    this._polling = 0;
    this._listeners = 0;
    for (var p in options) this.options[p] = options[p];
    var h = url.parse(this.host, true);
    this.port = h.port || 0;
    this.hostname = h.hostname || "";
    this.pathname = h.pathname || "";
    lib.extendObj(this.options, h.query);

    logger.debug("ipc: client", this.host, this.options);
}
util.inherits(IpcClient, events.EventEmitter);

// Close current connection, ports.... not valid after this call
IpcClient.prototype.close = function()
{
    this.host = "";
    this.options = {};
    this.removeAllListeners();
    this._polling = 0;
    this._listeners = 0;
}

// Returns the cache statistics to the callback as the forst argument, the object tructure is specific to each cache implementstion
IpcClient.prototype.stats = function(options, callback)
{
    callback()
}

// Clear all or only matched keys from the cache
IpcClient.prototype.clear = function(pattern)
{
}

// Retun all or matched keys from the cache, this is for debugging purposes mostly
IpcClient.prototype.keys = function(pattern, callback)
{
    callback()
}

// Returns an item from the cache by a key, callback is required and it acceptes only the item,
// on any error null or undefined will be returned
IpcClient.prototype.get = function(key, options, callback)
{
    callback()
}

// Store an item in the cache, `options.ttl` can be used to specify TTL in milliseconds
IpcClient.prototype.put = function(key, val, options)
{
}

// Add/substract a number from the an item, returns new number in the callback if provided, in case of an error null/indefined should be returned
IpcClient.prototype.incr = function(key, val, options, callback)
{
    if (typeof callback == "function") callback(0);
}

// Delete an item from the cache
IpcClient.prototype.del = function(key, options)
{
}

// This is called to configure and setup event processing on first subscribe call, if nobody subscribes this
// will never be called and thus no initialization for event processing either, for clients that only publish this may save
// lots of processing and memory.
//
// This method must take care how to keep the poller running via interval or timeout as long as the `this._polling=1`.
IpcClient.prototype.poller = function()
{
}

// Queue monitor or cleanup service, when poller is involved this will be started and can be used for cleaning up stale messages or other
// maintainence work the requires.
IpcClient.prototype.monitor = function()
{
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
    callback(0);
}

// Subscribe to receive notification from the given channel
IpcClient.prototype.subscribe = function(channel, options, callback)
{
    this.addListener(channel, callback);
    this._listeners++;
    if (!this._polling) {
        this._polling = 1;
        this.poller();
    }
}

// Stop receiving notifications on the given channel
IpcClient.prototype.unsubscribe = function(channel, options, callback)
{
    if (typeof callback == "function") {
        this.removeListener(channel, callback);
    } else {
        this.removeAllListeners(channel);
    }
    if (this._listeners) {
        this._listeners--;
    }
    if (this._polling && !this._listeners) {
        this._polling = 0;
    }
}

// Publish an event
IpcClient.prototype.publish = function(channel, msg, options, callback)
{
    if (typeof callback == "function") callback();
}





