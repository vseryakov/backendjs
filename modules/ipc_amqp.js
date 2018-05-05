//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

var util = require('util');
var path = require('path');
var logger = require(__dirname + '/../lib/logger');
var core = require(__dirname + '/../lib/core');
var lib = require(__dirname + '/../lib/lib');
var ipc = require(__dirname + "/../lib/ipc");
var Client = require(__dirname + "/../lib/ipc_client");

// Queue client using RabbitMQ server
var client = {
    name: "amqp",
};
module.exports = client;

ipc.modules.push(client);

client.createClient = function(url, options)
{
    if (url.match(/^amqps?:/)) return new IpcAmqpClient(url, options);
}

function IpcAmqpClient(host, options)
{
    var self = this;
    Client.call(this, url, options);
    if (!lib.isObject(this.options.queueParams)) this.options.queueParams = {};
    if (!lib.isObject(this.options.subscribeParams)) this.options.subscribeParams = {};
    if (!lib.isObject(this.options.publishParams)) this.options.publishParams = {};

    var amqp = require("amqp");
    this.client = amqp.createConnection({ url: this.url }, this.options);
    this.client.on("error", function(err) {
        logger.error("amqp:", self.url, err);
    });
    this.client.on("ready", function() {
        self._queue = this.queue(self.options.queueName || "", this.options.queueParams, function() {
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

IpcAmqpClient.prototype.poller = function()
{
    var self = this;
    this._queue.subscribe(self.options.subscribeParams, function(json, headers, info, msg) {
        if (self.options.subscribeParams.ack) {
            if (!self.emit("message", json, function(err) {
                if (err && err.status >= 500) return msg.reject(true);
                msg.acknowledge();
            })) {
                msg.reject(self.options.requeueUnprocessed);
            }
        } else {
            self.emit(info.routingKey || "message", json);
        }
    });
}

IpcAmqpClient.prototype.listen = function(options, callback)
{
    Client.prototype.listen.call(this, options, callback);
    this._queue.bind(this.options.channel);
}

IpcAmqpClient.prototype.unlisten = function(options, callback)
{
    Client.prototype.unlisten.call(this, options, callback);
    this._queue.unbind(this.options.channel);
}

IpcAmqpClient.prototype.submit = function(msg, options, callback)
{
    this.client.submit(msg, options || this.options.publishOptions, callback);
}
