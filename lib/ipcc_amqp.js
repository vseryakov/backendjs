//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

var util = require('util');
var logger = require(__dirname + '/../lib/logger');
var lib = require(__dirname + '/../lib/lib');
var ipc = require(__dirname + "/../lib/ipc");
var Client = require(__dirname + "/../lib/ipc_client");

// Queue client using RabbitMQ server
//
// To enable install the npm module:
//
//      npm i -g amqplib
//
const client = {
    name: "amqp",
};
module.exports = client;

ipc.modules.push(client);

client.createClient = function(url, options)
{
    if (url.match(/^amqps?:/)) return new IpcAmqpClient(url, options);
}

function IpcAmqpClient(url, options)
{
    Client.call(this, url, options);
    if (!lib.isObject(this.options.queueParams)) this.options.queueParams = {};
    if (!lib.isObject(this.options.subscribeParams)) this.options.subscribeParams = {};
    if (!lib.isObject(this.options.publishParams)) this.options.publishParams = {};

    var amqp = require("amqplib");
    this.client = amqp.connect(this.url, (err, conn) => {
        this.client.on("error", (err) => { logger.error("amqp:", this.url, err) });
        this.client.on("ready", () => {
            this._queue = this.queue(this.options.queueName || "", this.options.queueParams, () => {
                this.emit("ready");
            });
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
    this._queue.subscribe(self.options.subscribeParams, (json, headers, info, msg) => {
        if (this.options.subscribeParams.ack) {
            if (!this.emit("message", json, (err) => {
                if (err && err.status >= 500) return msg.reject(true);
                msg.acknowledge();
            })) {
                msg.reject(this.options.requeueUnprocessed);
            }
        } else {
            this.emit(info.routingKey || "message", json);
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
    this.client.submit(msg, options || this.options.publishParams, callback);
}
