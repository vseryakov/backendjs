//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  May 2015
//

var util = require("util");
var events = require("events");
var logger = require(__dirname + '/../logger');

// Base class for the IPC clients, implements cache and queue protocols in the same class, some clients can support both(Redis),
// not supported methods just do nothing without raising any errors
module.exports = IpcClient;

function IpcClient(host, options)
{
    events.EventEmitter.call(this);
    this.setMaxListeners(0);
    this.host = host || "";
    this.options = {};
    for (var p in options) this.options[p] = options[p];
    logger.debug("ipc: client", this.host, this.options);
}
util.inherits(IpcClient, events.EventEmitter);

// Close current connection, ports.... not valid after this call
IpcClient.prototype.close = function()
{
    this.host = null;
    this.options = {};
    this.removeAllListeners();
    this._listening = 0;
}

// Returns the cache statistics to the callback as the forst argument, the object tructure is specific to each cache implementstion
IpcClient.prototype.stats = function(options, callback)
{
    callback()
}

// Clear all cache items
IpcClient.prototype.clear = function(options)
{
}

// Retuns all cached keys, this is for debugging purposes mostly
IpcClient.prototype.keys = function(options, callback)
{
    callback()
}

// Returns an item from the cache
IpcClient.prototype.get = function(key, options, callback)
{
    callback()
}

// Store an item in the cache, `options.ttl` can be used to specify TTL in milliseconds
IpcClient.prototype.put = function(key, val, options)
{
}

// Add/substract a number from the an item
IpcClient.prototype.incr = function(key, val, options, callback)
{
    if (typeof callback == "function") callback(0);
}

// Delete an item form the cache
IpcClient.prototype.del = function(key, options)
{
}

// This is called to configure and setup event processing from the queue on first subscription, if nobody subscribe this
// will never be claled and thus no initialization for event processing either, for clients that only publish this may save
// lots of processing.
IpcClient.prototype.startListening = function(channel)
{
}

// Subscribe to receive notification from the given channel
IpcClient.prototype.subscribe = function(channel, options, callback)
{
    this.addListener(channel, callback);
    if (!this._listening) {
        this._listening = 1;
        this.startListening(channel);
    }
}

// Stop receiving notifictions for th give key
IpcClient.prototype.unsubscribe = function(channel, options, callback)
{
    this.removeListener(channel, callback);
}

// Publish an event
IpcClient.prototype.publish = function(channel, msg, options, callback)
{
    if (typeof callback == "function") callback();
}



