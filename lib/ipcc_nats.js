//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2021
//

var util = require('util');
var core = require(__dirname + '/../lib/core');
var logger = require(__dirname + '/../lib/logger');
var lib = require(__dirname + '/../lib/lib');
var ipc = require(__dirname + "/../lib/ipc");
var Client = require(__dirname + "/../lib/ipc_client");

// Queue client using NATS server
//
// To enable install the npm modules:
//
//      npm i -g nats node-nats-streaming
//
// Configuration:
//
//    ipc-queue-nats=nats://localhost:4222
//
//    ipc-queue-stan=stan://localhost:4222/bkjs
//
const client = {
    name: "nats",
};
module.exports = client;

ipc.modules.push(client);

client.createClient = function(url, options)
{
    if (url.match(/^(nats|stan):/)) return new IpcNatsClient(url, options);
}

function IpcNatsClient(url, options)
{
    Client.call(this, url, options);
    this.options.maxReconnectAttempts = lib.toNumber(this.options.maxReconnectAttempts, { dflt: 100, min: 10 });
    this.options.visibilityTimeout = lib.toNumber(this.options.visibilityTimeout, { min: 0 });
    this.options.json = true;
    this._subs = {};

    if (this.protocol == "nats:") {
        var nats = require("nats");
        this.client = nats.connect(this.url, this.options);
    } else {
        var stan = require("node-nats-streaming");
        this.client_id = this.options.client_id && lib.toTemplate(this.options.client_id, [this.options, core]) || `${core.instance.id}-${core.instance.pid}`;
        this.client = stan.connect(this.pathname.replace("/", "") || core.name, this.client_id, this.options);
    }
    this.client.on("connect", () => { this.emit("ready") });
    this.client.on("error", (err) => { logger.error("nats:", this.url, err) });
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
    Client.prototype.listen.call(this, options, callback);
    var queue = this.options.queue || this.queueName;
    if (this.protocol == "nats:") {
        this._subs[queue] = this.client.subscribe(queue, { queue: queue }, (msg, reply, subject) => this.onMessage("message", msg));
    } else {
        var opts = this.client.subscriptionOptions();
        if (this.options.durable) {
            opts.setDurableName(queue);
        }
        if (this.options.replay_all) {
            opts.setDeliverAllAvailable();
        } else
        if (this.options.replay_delta > 0) {
            opts.setStartAtTimeDelta(this.options.replay_delta);
        } else
        if (this.options.replay_mtime > 0) {
            opts.setStartTime(this.options.replay_mtime);
        } else
        if (this.options.reply_last) {
            opts.setStartWithLastReceived();
        }
        var timeout = this.options.visibilityTimeout;
        if (timeout) {
            opts.setAckWait(timeout);
            opts.setManualAckMode(true);
        }
        this._subs[queue] = this.client.subscribe(queue, queue, opts);
        this._subs[queue].on("message", (data) => {
            var now = Date.now()
            var msg = lib.jsonParse(data.getData(), { logger: "info" });
            if (!msg) return;
            if (msg.endTime > 0 && msg.endTime < now) return data.ack();
            if (msg.startTime > 0 && msg.startTime > now) return;
            if (msg.noWaitTimeout > 0) {
                setTimeout(() => { if (!msg.done) { msg.noWait = 1; data.ack(); } }, msg.noWaitTimeout * 1000);
            }
            if (msg.noWait) data.ack();
            if (!this.emit("message", msg, (err, next) => {
                msg.done = 1;
                if (!msg.noVisibility && (err && err.status >= 500 || msg.noWait)) return;
                if (timeout || msg.noVisibility) data.ack();
            })) {
                msg.done = 1;
            }
        });
    }
}

IpcNatsClient.prototype.unlisten = function(options, callback)
{
    Client.prototype.unlisten.call(this, options, callback);
    var queue = this.options.queue || this.queueName;
    if (this.protocol == "nats:") {
        this._unsubscribe(queue);
    } else {
        if (this._subs[queue] && typeof this._subs[queue].unsubscribe == "function") {
            this._subs[queue].unsubscribe();
        }
    }
}

IpcNatsClient.prototype.submit = function(msg, options, callback)
{
    var queue = this.options.queue || this.queueName;
    this.client.publish(queue, lib.stringify(msg), undefined, callback);
}

