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
    this.callbacks = {}
    this.options.host = this.host.replace(/^[a-z]+:\/\//gi,"");
    this.client = amqp.createConnection(this.options);
    this.client.on("error", function(err) { 
        logger.error("amqp:", self.host, err);
    });
    this.client.on("ready", function() {
        self.emit("ready");
        this.queue(self.options.queueName || "", this.options, function(q) {
            self.queue = q;
            q.subscribe(function(message, headers, info) {
                var cb = self.callbacks[info.routingKey];
                if (!cb) cb[0](cb[1], info.routingKey, message);
            });
        });
    });
}

util.inherits(IpcAmqpClient, Client);

IpcAmqpClient.prototype.close = function()
{
    this.client.disconnect(); 
}

IpcAmqpClient.prototype.subscribe = function(key, callback, data)
{
    this.callbacks[key] = [ callback, data ];
    this.queue.bind(key);
}

IpcAmqpClient.prototype.unsubscribe = function(key)
{
    delete this.callbacks[key];
    this.queue.unbind(key);
}

IpcAmqpClient.prototype.publish = function(key, data)
{
    this.client.publish(key, data);
}
