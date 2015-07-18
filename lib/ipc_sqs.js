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
var Client = require(__dirname + "/ipc_client");

// Queue client using AWS SQS
module.exports = client;

var client = {
    name: "sqs",
};

ipc.modules.push(client);

client.createClient = function(host, options)
{
    if (host.match(/^sqs:/)) return new IpcSQSClient(host, options);
}

function IpcSQSClient(host, options)
{
    Client.call(this);
    if (!this.options.timeout && !this.options.WaitTimeSeconds) this.options.timeout = 20;
    if (!this.options.visibilityTimeout && !this.options.VisibilityTimeout) this.options.visibilityTimeout = 2;
    this.emit("ready");
}
util.inherits(IpcSQSClient, Client);

IpcSQSClient.prototype.startListening = function()
{
    var self = this;
    aws.sqsReceiveMessage(this.host, this.options, function(err, rows) {
        if (!self.host || !self.running) return;
        (rows || []).forEach(function(item) {
            var msg = lib.jsonParse(item.Body, { obj: 1, error: 1 });
            // Update visibility while the job is running
            var timer, timeout = this.options.visibilityTimeout || this.options.VisibilityTimeout;
            if (timeout) {
                timer = setInterval(function() {
                    aws.querySQS("ChangeMessageVisibility", self.host, { ReceiptHandle: item.ReceiptHandle, VisibilityTimeout: timeout }, callback);
                }, timeout * 0.9 * 1000);
            }
            // No processed events will be back in the queue after visibility timeout automatically
            self.emit(channel, msg.key, msg.data, function(err) {
                clearInterval(timer);
                // Retain the message only in case of known fatal errors, otherwise delete it after processing, any other error
                // is considered as undeliverable due to corruption or invalid message format...
                if (err && err.status >= 500) return;
                aws.querySQS("DeleteMessage", { QueueUrl: self.host, ReceiptHandle: item.ReceiptHandle });
            });
        });
        setImmediate(function() { self.startListening(); });
    });
    return 1;
}

IpcSQSClient.prototype.publish = function(channel, msg, options, callback)
{
    aws.sqsSendMessage(this.host, JSON.stringify(msg), options, callback);
}
