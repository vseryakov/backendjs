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

// Queue client using RabbitMQ server
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
            self._queue = q;
            self.emit("ready");
        });
    });
}

util.inherits(IpcAmqpClient, Client);

IpcAmqpClient.prototype.close = function()
{
    Client.prototype.close.call(this);
    this.client.disconnect();
    delete this._queue;
}

IpcAmqpClient.prototype.startListening = function(channel)
{
    var self = this;
    this._queue.subscribe(self.options.subscribeParams, function(json, headers, info, msg) {
        if (self.options.subscribeParams.ack) {
            var rc = self.emit(info.routingKey, json, function(err) {
                if (err && err.status >= 500) return msg.reject(true);
                msg.acknowledge();
            });
            if (!rc) msg.reject(self.options.requeueUnknown || self.options.queueParams.persistent);
        } else {
            self.emit(info.routingKey, json);
        }
    });
}

IpcAmqpClient.prototype.subscribe = function(channel, options, callback)
{
    Client.prototype.subscribe.call(this, channel, options, callback);
    this._queue.bind(channel);
}

IpcAmqpClient.prototype.unsubscribe = function(channel, options, callback)
{
    Client.prototype.unsubscribe.call(this, channel, options, callback);
    this._queue.unbind(channel);
}

IpcAmqpClient.prototype.publish = function(channel, msg, options, callback)
{
    this.client.publish(channel, msg, options || this.options.publishOptions, callback);
}
