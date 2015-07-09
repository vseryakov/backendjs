//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var util = require('util');
var path = require('path');
var logger = require(__dirname + '/../logger');
var core = require(__dirname + '/../core');
var lib = require(__dirname + '/../lib');
var ipc = require(__dirname + "/../ipc");
var Client = require(__dirname + "/ipc_client");
var amqp = require("amqp");

// Cache/queue client using Redis server
module.exports = client;

var client = {
    name: "amqp",
};

ipc.modules.push(client);

client.createClient = function(host, options)
{
    if (host.match(/^amqp:/)) return new IpcAmqpClient(host, options);
}

function IpcAmqpClient(host, options)
{
    var self = this;
    Client.call(this);
    if (!lib.isObject(this.options.queueParams)) this.options.queueParams = {};
    if (!lib.isObject(this.options.subscribeParams)) this.options.subscribeParams = {};
    if (!lib.isObject(this.options.publishParams)) this.options.publishParams = {};
    this.options.host = this.host.replace(/^[a-z]+:\/\//gi,"");
    this.client = amqp.createConnection(this.options);
    this.client.on("error", function(err) {
        logger.error("amqp:", self.host, err);
    });
    this.client.on("ready", function() {
        this.queue(self.options.queueName || "", this.options.queueParams, function(q) {
            self.queue = q;
            q.subscribe(this.options.subscribeParams, function(json, headers, info, msg) {
                var cb = self.callbacks[info.routingKey];
                if (!cb) return;
                cb[0](cb[1], info.routingKey, json, function(err) {
                    if (!self.options.subscribeParams.ack) return;
                    if (err && err.status >= 500) return msg.reject(true);
                    msg.acknowledge();
                });
            });
            self.emit("ready");
        });
    });
}

util.inherits(IpcAmqpClient, Client);

IpcAmqpClient.prototype.close = function()
{
    Client.prototype.close.call(this);
    this.client.disconnect();
    delete this.queue;
}

IpcAmqpClient.prototype.subscribe = function(key, options, callback, data)
{
    Client.prototype.subscribe.call(this, key, options, callback, data);
    this.queue.bind(key);
}

IpcAmqpClient.prototype.unsubscribe = function(key)
{
    Client.prototype.unsubscribe.call(this, key);
    this.queue.unbind(key);
}

IpcAmqpClient.prototype.publish = function(key, data, options, callback)
{
    this.client.publish(key, data, options || this.options.publishOptions, callback);
}
