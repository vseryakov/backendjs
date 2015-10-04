//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var util = require('util');
var path = require('path');
var logger = require(__dirname + '/../logger');
var core = require(__dirname + '/../core');
var lib = require(__dirname + '/../lib');
var aws = require(__dirname + '/../aws');
var ipc = require(__dirname + "/../ipc");
var jobs = require(__dirname + "/../jobs");
var Client = require(__dirname + "/ipc_client");

// Queue client using AWS SQS, full queue url can be used or just the name as sqs://queuename
module.exports = client;

var client = {
    name: "sqs",
};

ipc.modules.push(client);

client.createClient = function(host, options)
{
    if (host.match(/^sqs:\/\/|^https:\/\/sqs/)) return new IpcSQSClient(host, options);
}

function IpcSQSClient(host, options)
{
    Client.call(this, host, options);
    // Use long poll by default
    this.options.count = lib.toNumber(this.options.count, { dflt: 1, min: 1, max: 10 });
    this.options.interval = lib.toNumber(this.options.interval, { dflt: 5000, min: 1000 });
    this.options.timeout = lib.toNumber(this.options.timeout, { dflt: 20, min: 0 });
    this.options.visibilityTimeout = lib.toNumber(this.options.visibilityTimeout || this.options.VisibilityTimeout, { min: 0 });
    this.options.retryCount = lib.toNumber(this.options.retryCount, { dflt: 3, min: 0 });
    this.options.retryTimeout = lib.toNumber(this.options.retryTimeout, { dflt: 250, min: 0 });
    if (this.host.match(/^sqs:/)) {
        this.host = "";
        aws.querySQS("GetQueueUrl", { QueueName: this.hostname }, function(err, data) {
            if (err) return;
            this.host = lib.objGet(data, "GetQueueUrlResponse.GetQueueUrlResult.QueueUrl");
            this.ready = true;
            this.emit("ready");
        });
    } else {
        this.ready = true;
        this.emit("ready");
    }
}
util.inherits(IpcSQSClient, Client);

IpcSQSClient.prototype.poller = function()
{
    var self = this;
    if (!this.host) return;
    if (!this.ready) return setTimeout(this.poller.bind(this), this.options.interval);

    this._working++;
    aws.sqsReceiveMessage(this.host, this.options, function(err, rows) {
        if (err) {
            self._working--;
            return setTimeout(self.poller.bind(self), self.options.interval);
        }

        lib.forEach(rows || [], function(item, next) {
            var msg = lib.jsonParse(lib.entityToText(item.Body), { obj: 1, error: 1 });
            // Update visibility while the job is running
            var timer;
            if (self.options.visibilityTimeout) {
                timer = setInterval(function() {
                    aws.querySQS("ChangeMessageVisibility", { QueueUrl: self.host, ReceiptHandle: item.ReceiptHandle, VisibilityTimeout: self.options.visibilityTimeout }, self.options, function(err) {
                        logger.info("ipc.keepAlive:", msg.channel, lib.objDescr(msg.data));
                        if (err) clearInterval(timer);
                    });
                }, self.options.visibilityTimeout * 1000 * 0.9);
            }
            // No processed events will be back in the queue after visibility timeout automatically
            if (!self.emit(msg.channel || "message", msg.data, function(err) {
                clearInterval(timer);
                // Retain the message only in case of known fatal errors, otherwise delete it after processing, any other error
                // is considered as undeliverable due to corruption or invalid message format...
                if (err && err.status >= 500) return next();
                aws.querySQS("DeleteMessage", { QueueUrl: self.host, ReceiptHandle: item.ReceiptHandle }, self.options, function() { next() });
            })) {
                clearInterval(timer);
                next();
            }
        }, function() {
            self._working--;
            if (self.isPolling()) setImmediate(self.poller.bind(self));
        });
    });
}

IpcSQSClient.prototype.publish = function(channel, msg, options, callback)
{
    aws.sqsSendMessage(this.host, JSON.stringify({ channel: channel, data: msg }), this.options, callback);
}
