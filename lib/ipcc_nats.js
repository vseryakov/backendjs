//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2021
//

var util = require('util');
var logger = require(__dirname + '/../lib/logger');
var lib = require(__dirname + '/../lib/lib');
var ipc = require(__dirname + "/../lib/ipc");
var Client = require(__dirname + "/../lib/ipc_client");

// Queue client using NATS server
//
// To enable install the npm module:
//
//      npm i -g nats
//
// Add to the config:
//
//    ipc-queue-nats=nats://localhost:4222
//
const client = {
    name: "nats",
};
module.exports = client;

ipc.modules.push(client);

client.createClient = function(url, options)
{
    if (url.match(/^nats:/)) return new IpcNatsClient(url, options);
}

function IpcNatsClient(url, options)
{
    Client.call(this, url, options);
    this.options.maxReconnectAttempts = lib.toNumber(this.options.maxReconnectAttempts, { dflt: 100, min: 10 });
    this.options.json = true;
    this._subs = {};

    var nats = require("nats");
    this.client = nats.connect(this.url, this.options);
    this.client.on("error", (err) => { logger.error("nats:", this.url, err) });
    this.client.on("connect", () => { this.emit("ready") });
}
util.inherits(IpcNatsClient, Client);

IpcNatsClient.prototype.close = function()
{
    Client.prototype.close.call(this);
    this.client.close();
}

IpcNatsClient.prototype.onMessage = function(channel, msg, subject)
{
    logger.dev("onMessage:", channel, subject, msg);
    this.emit(channel, msg, subject);
}

IpcNatsClient.prototype._unsubscribe = function(channel)
{
    if (!this._subs[channel]) return;
    this.client.unsubscribe(this._subs[channel]);
    delete this._subs[channel];
}

IpcNatsClient.prototype.subscribe = function(channel, options, callback)
{
    Client.prototype.subscribe.call(this, channel, options, callback);
    this._subs[channel] = this.client.subscribe(channel, (msg, reply, subject) => this.onMessage(channel, msg, subject));
}

IpcNatsClient.prototype.unsubscribe = function(channel, options, callback)
{
    Client.prototype.unsubscribe.call(this, channel, options, callback);
    this._unsubscribe(channel);
}

IpcNatsClient.prototype.publish = function(channel, msg, options, callback)
{
    this.client.publish(channel, msg, undefined, callback);
}

IpcNatsClient.prototype.listen = function(options, callback)
{
    var queue = this.options.queue || this.queueName;
    Client.prototype.listen.call(this, options, callback);
    this._subs[queue] = this.client.subscribe(queue, { queue: queue }, (msg, reply, subject) => this.onMessage("message", msg));
}

IpcNatsClient.prototype.unlisten = function(options, callback)
{
    var queue = this.options.queue || this.queueName;
    Client.prototype.unlisten.call(this, options, callback);
    this._unsubscribe(queue);
}

IpcNatsClient.prototype.submit = function(msg, options, callback)
{
    var queue = this.options.queue || this.queueName;
    this.client.publish(queue, msg, undefined, callback);
}
