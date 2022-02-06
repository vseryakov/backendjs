//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

var util = require('util');
var logger = require(__dirname + '/../logger');
var lib = require(__dirname + '/../lib');
var ipc = require(__dirname + "/../ipc");
var Client = require(__dirname + "/client");

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
    if (/^amqps?:/.test(url)) return new IpcAmqpClient(url, options);
}

function IpcAmqpClient(url, options)
{
    Client.call(this, url, options);
    if (!lib.isObject(this.options.sockParams)) this.options.sockParams = {};
    if (!lib.isObject(this.options.channelParams)) this.options.channelParams = {};
    if (!lib.isObject(this.options.consumeParams)) this.options.consumeParams = {};

    var amqp = require("amqplib/callback_api");
    amqp.connect(this.url, this.options.sockParams, (err, conn) => {
        if (err) return logger.error("amqp:", this.url, err);
        this.client = conn;
        conn.on("error", (err) => { logger.error("amqp:", this.url, err) });
        conn.createChannel((err, ch) => {
            if (err) return logger.error("amqp:", "create", this.url, err);
            ch.on("error", (err) => { logger.error("amqp:", this.url, err) });
            this.channel = ch;
            this.emit("ready");
        });
    });
}
util.inherits(IpcAmqpClient, Client);

IpcAmqpClient.prototype.close = function()
{
    Client.prototype.close.call(this);
    if (this.client) this.client.close();
    delete this.channel;
}

IpcAmqpClient.prototype.pollQueue = function(options)
{
    if (!this.channel) return;
    if (this.options.count) {
        this.channel.prefetch(this.options.count);
    }
    var done, chan = this.channel(options);
    this.channel.consume(chan, (item) => {
        if (item === null) return;
        var msg = lib.jsonParse(item.content.toString(), { url: this.url, datatype: "obj", logger: "error" });
        logger.debug("amqp:", chan, "MSG:", msg, "ITEM:", item);

        if (!this.emit(chan, msg, (err) => {
            if (done || this.options.consumeParams.noAck) return;
            done = 1;
            if (err && err.status >= 500) return this.channel.nack(item);
            this.channel.ack(item);
        })) {
            done = 1;
            if (!this.options.consumeParams.noAck) this.channel.nack(item);
        }
    }, this.options.consumeParams, (err, ok) => {
        logger.logger(err ? "error": "debug", "amqp:", "consume", chan, err, ok);
        if (!err) this.tag = ok.consumerTag;
    });
}

IpcAmqpClient.prototype.subscribeQueue = function(options, callback)
{
    if (!this.channel) return;
    var chan = this.channel(options);
    this.channel.assertQueue(chan, this.options.channelParams, (err) => {
        if (err) return logger.error("amqp:", "assert", this.url, err);
        Client.prototype.subscribeQueue.call(this, options, callback);
    });
}

IpcAmqpClient.prototype.unsubscribeQueue = function(options, callback)
{
    Client.prototype.unsubscribeQueue.call(this, options, callback);
    if (this.channel && this.tag) this.channel.cancel(this.tag);
}

IpcAmqpClient.prototype.publishQueue = function(msg, options, callback)
{
    if (this.channel) {
        var chan = this.channel(options);
        this.channel.sendToQueue(chan, Buffer.from(msg));
    }
    lib.tryCall(callback, this.channel ? null : { status: 400, message: "not open" });
}
