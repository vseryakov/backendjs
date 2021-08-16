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
    if (!lib.isObject(this.options.sockParams)) this.options.sockParams = {};
    if (!lib.isObject(this.options.channelParams)) this.options.channelParams = {};
    if (!lib.isObject(this.options.consumeParams)) this.options.consumeParams = {};
    if (!this.options.queue) this.options.queue = "queue";

    var amqp = require("amqplib/callback_api");
    amqp.connect(this.url, this.options.sockParams, (err, conn) => {
        if (err) return logger.error("amqp:", this.url, err);
        this.client = conn;
        conn.on("error", (err) => { logger.error("amqp:", this.url, err) });
        conn.createChannel((err, ch) => {
            if (err) return logger.error("amqp:", "create", this.url, err);
            ch.on("error", (err) => { logger.error("amqp:", this.url, err) });
            ch.assertQueue(this.options.queue, this.options.channelParams, (err) => {
                if (err) return logger.error("amqp:", "assert", this.url, err);
                this.channel = ch;
                this.emit("ready");
            });
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

IpcAmqpClient.prototype.poller = function()
{
    if (!this.channel) return;
    if (this.options.count) {
        this.channel.prefetch(this.options.count);
    }
    this.channel.consume(this.options.queue, (item) => {
        if (item === null) return;
        var msg = lib.jsonParse(item.content.toString(), { url: this.url, datatype: "obj", logger: "error" });
        logger.debug("amqp:", "MSG:", msg, "ITEM:", item);

        if (!this.emit("message", msg, (err) => {
            if (this.options.consumeParams.noAck) return;
            if (err && err.status >= 500) return this.channel.nack(item);
            this.channel.ack(item);
        })) {
            if (!this.options.consumeParams.noAck) this.channel.nack(item);
        }
    }, this.options.consumeParams, (err, ok) => {
        logger.logger(err ? "error": "debug", "amqp:", "consume", this.options.queue, err, ok);
        if (!err) this.tag = ok.consumerTag;
    });
}

IpcAmqpClient.prototype.listen = function(options, callback)
{
    Client.prototype.listen.call(this, options, callback);
}

IpcAmqpClient.prototype.unlisten = function(options, callback)
{
    Client.prototype.unlisten.call(this, options, callback);
    if (this.channel && this.tag) this.channel.cancel(this.tag);
}

IpcAmqpClient.prototype.submit = function(msg, options, callback)
{
    if (this.channel) {
        this.channel.sendToQueue(this.options.queue, Buffer.from(lib.stringify(msg)));
    }
    lib.tryCall(callback, this.channel ? null : { status: 400, message: "not open" });
}
