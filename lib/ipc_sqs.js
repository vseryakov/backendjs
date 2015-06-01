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
    if (!this.options.timeout && !this.options.WaitTimeSeconds) this.options.timeout = 30;
    this.callbacks = {};
    this.processQueue();
}

IpcSQSClient.prototype.processQueue = function(callback)
{
    var self = this;
    aws.sqsReceiveMessage(this.host, this.options, function(err, rows) {
        if (!self.host) return;
        (rows || []).forEach(function(item) {
            var msg = lib.jsonParse(item.Body, { obj: 1, error: 1 });
            var cb = self.callbacks[msg.key];
            if (!cb) return;
            aws.querySQS("DeleteMessage", { QueueUrl: self.host, ReceiptHandle: item.ReceiptHandle });
            cb[0](cb[1], msg.key, msg.data);
        });
        setImmediate(function() { self.processQueue(); });
    });
}

util.inherits(IpcSQSClient, Client);

IpcSQSClient.prototype.close = function()
{
    this.host = null;
}

IpcSQSClient.prototype.subscribe = function(key, callback, data)
{
    this.callbacks[key] = [ callback, data ];
}

IpcSQSClient.prototype.unsubscribe = function(key)
{
    delete this.callbacks[key];
}

IpcSQSClient.prototype.publish = function(key, data, callback)
{
    aws.sqsSendMessage(this.host, JSON.stringify({ key: key, data: data }), callback);
}
