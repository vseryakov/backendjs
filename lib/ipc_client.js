//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  May 2015
//

var util = require("util");
var events = require("events");
var logger = require(__dirname + '/../logger');

// Base for the IPC clients, implements cache and queue protocols in the same class due to not overlaping, 
// not supported methods just do nothing without raising any errors
module.exports = IpcClient;

function IpcClient(host, options) 
{
    events.EventEmitter.call(this);
    this.host = host || "";
    this.options = {};
    for (var p in options) this.options[p] = options[p];
    logger.debug("ipc: client", this.host, this.options);
}
util.inherits(IpcClient, events.EventEmitter);

// Close current connection, ports.... not valid after this call
IpcClient.prototype.close = function()
{
}

// Returns the cache statistics to the callback as the forst argument, the object tructure is specific to each cache implementstion
IpcClient.prototype.stats = function(callback)
{
    callback()
}

// Clear all cache items
IpcClient.prototype.clear = function()
{
}

// Retuns all cached keys, this is for debugging purposes mostly
IpcClient.prototype.keys = function(callback)
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
IpcClient.prototype.incr = function(key, val, options)
{
}

// Delete an item form the cache
IpcClient.prototype.del = function(key, options)
{
}

// Subscribe to receive notification for events sarting with the specified key, `data` will be passed to the callback as the forst argument
IpcClient.prototype.subscribe = function(key, callback, data)
{
}

// Stop receiving notifictions for th give key
IpcClient.prototype.unsubscribe = function(key)
{
}

// Publish an event
IpcClient.prototype.publish = function(key, data, callback)
{
    if (typeof callback == "function") callback();
}


