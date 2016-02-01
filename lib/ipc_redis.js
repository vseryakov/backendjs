//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var url = require('url');
var util = require('util');
var logger = require(__dirname + '/../logger');
var core = require(__dirname + '/../core');
var lib = require(__dirname + '/../lib');
var ipc = require(__dirname + "/../ipc");
var Client = require(__dirname + "/ipc_redisclient");

// Cache/queue client using Redis server
module.exports = client;

var client = {
    name: "redis",
};

ipc.modules.push(client);

client.createClient = function(host, options)
{
    if (host.match(/^redis:/)) return new IpcRedisClient(host, options);
}

function IpcRedisClient(host, options)
{
    var self = this;
    Client.call(this, host, options);
}
util.inherits(IpcRedisClient, Client);

IpcRedisClient.prototype.subscribe = function(channel, options, callback)
{
    Client.prototype.subscribe.call(this, channel, options, callback);
    this.client.subscribe(channel);
}

IpcRedisClient.prototype.unsubscribe = function(channel, options, callback)
{
    Client.prototype.unsubscribe.call(this, channel, options, callback);
    this.client.unsubscribe(channel);
}

IpcRedisClient.prototype.publish = function(channel, msg, options, callback)
{
    this.client.publish(channel, msg, callback);
}

