//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var util = require('util');
var path = require('path');
var logger = require(__dirname + '/logger');
var core = require(__dirname + '/core');
var lib = require(__dirname + '/lib');
var aws = require(__dirname + '/aws');
var ipc = require(__dirname + "/ipc");
var jobs = require(__dirname + "/jobs");
var Client = require(__dirname + "/ipc_client");

// Queue client using AWS SQS, full queue url can be used or just the name as sqs://queuename
//
// The `count` config property specifies how messages to process at the same time, default is 1.
//
// The `interval` config property defines in ms how often to check for new messages after processing a message, i.e. after a messages processed
// it can poll immediately or after this amount of time, default is 1000 milliseconds.
//
// The `retryInterval` config property defines in ms how often to check for new messages after an error or no data, i.e. on empty
// pool when no messages are processed it can poll immediately or after this amount of time, default is 5000 mulliseconds.
//
// The `visibilityTimeout` property specifies how long the messages being procressed stay hidden, in milliseconds.
//
// The `timeout` property defines how long to wait for new messages, i.e. the long poll, in milliseconds
//
// The `retryCount` and `retryTimeout` define how many times to retry failed AWS HTTP requests, default is 5 times starting
//  with the backoff starting at 500 milliseconds.
//
// For messages that have `stime` property which is the time in the future when a message must be actually processed there
// is a parameter `maxTimeout` which defines in milliseconds the max time a messsage can stay invisible while waiting for its scheduled date,
// default is 6 hours, the AWS max is 12 hours. The scheduling is implemented using AWS `visibilityTimeout` feature, keep
// scheduled messages hidden until the actual time.
//
// Examples:
//
//      ipc-queue=sqs://messages?bk-interval=60000
//      ipc-queue=https://sqs.us-east-1.amazonaws.com/123456/messages?bk-visibilityTimeout=300&bk-count=2
//

module.exports = client;

var client = {
    name: "sqs",
};

ipc.modules.push(client);

client.createClient = function(url, options)
{
    if (url.match(/^sqs:\/\/|^https:\/\/sqs/)) return new IpcSQSClient(url, options);
}

function IpcSQSClient(url, options)
{
    Client.call(this, url, options);
    this.options.timeout = lib.toNumber(this.options.timeout, { dflt: 20000, min: 0 });
    this.options.visibilityTimeout = lib.toNumber(this.options.visibilityTimeout, { min: 0 });
    if (this.options.visibilityTimeout < 1000) this.options.visibilityTimeout *= 1000;
    this.options.count = lib.toNumber(this.options.count, { dflt: 0, min: 1, max: 10 });
    this.options.interval = lib.toNumber(this.options.interval, { dflt: 1000, min: 0 });
    this.options.retryInterval = lib.toNumber(this.options.retryInterval, { dflt: 5000, min: 0 });
    this.options.maxTimeout = lib.toNumber(this.options.maxTimeout, { dflt: 3600000*6, min: 60000 });
    this.options.retryCount = lib.toNumber(this.options.retryCount, { dflt: 5, min: 0 });
    this.options.retryTimeout = lib.toNumber(this.options.retryTimeout, { dflt: 250, min: 0 });
    this.options.retryOnError = lib.toBool(this.options.retryOnError, { dflt: 1 });
    if (this.url.match(/^sqs:/)) {
        this.url = "";
        aws.querySQS("GetQueueUrl", { QueueName: this.hostname }, this.options, function(err, data) {
            if (err) return;
            this.url = lib.objGet(data, "GetQueueUrlResponse.GetQueueUrlResult.QueueUrl");
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
    if (!this.url) return;
    if (!this.ready) return setTimeout(this.poller.bind(this), this.options.retryInterval);

    aws.sqsReceiveMessage(this.url, this.options, function(err, items) {
        if (err) return setTimeout(self.poller.bind(self), self.options.retyInterval);

        var processed = 0;
        lib.forEach(items || lib.emptylist, function(item, next) {
            var body = item.Body || "";
            if (body[0] != "{") body = new Buffer(body, "base64").toString();
            var msg = lib.jsonParse(body, { url: self.url, datatype: "obj", logger: "error", handle: item.ReceiptHandle });
            logger.debug("sqs.poller:", msg || item);
            var now = Date.now();
            // Check message timestamps if not ready yet then keep it hidden
            if (msg.etime > 0 && msg.etime < now) {
                logger.info("sqs.expired:", msg.etime, msg.channel, lib.objDescr(msg.data));
                aws.querySQS("DeleteMessage", { QueueUrl: self.url, ReceiptHandle: item.ReceiptHandle }, self.options, function() { next() });
                return;
            }
            if (msg.stime > 0 && msg.stime - now > self.options.interval) {
                var timeout = msg.stime - now;
                if (timeout > self.options.maxTimeout) timeout = self.options.maxTimeout;
                logger.info("sqs.schedule:", msg.stime, timeout, msg.channel, lib.objDescr(msg.data));
                var req = { QueueUrl: self.url, ReceiptHandle: item.ReceiptHandle, VisibilityTimeout: Math.round(timeout/1000) };
                aws.querySQS("ChangeMessageVisibility", req, self.options, function() { next() });
                return;
            }
            // Update visibility while the job is running
            var timer;
            if (self.options.visibilityTimeout) {
                timer = setInterval(function() {
                    // Possible race conditions, no need to report errors
                    var opts = lib.objClone(self.options, "logger_error", "info");
                    var req = { QueueUrl: self.url, ReceiptHandle: item.ReceiptHandle, VisibilityTimeout: Math.round(self.options.visibilityTimeout*1.1/1000) };
                    aws.querySQS("ChangeMessageVisibility", req, opts, function(err) {
                        logger.info("ipc.keepAlive:", msg.channel, lib.objDescr(msg.data));
                        if (err) clearInterval(timer);
                    });
                }, self.options.visibilityTimeout * 0.8);
            }
            processed++;
            // Not processed events will be back in the queue after visibility timeout automatically
            if (!self.emit("message", msg.data, function(err) {
                clearInterval(timer);
                // Retain the message only in case of known fatal errors, otherwise delete it after processing, any other error
                // is considered as undeliverable due to corruption or invalid message format...
                if (err && err.status >= 500) return next();
                aws.querySQS("DeleteMessage", { QueueUrl: self.url, ReceiptHandle: item.ReceiptHandle }, self.options, function() { next() });
            })) {
                clearInterval(timer);
                next();
            }
        }, function() {
            self.schedulePoller(processed ? self.options.interval : self.options.retryInterval);
        });
    });
}

IpcSQSClient.prototype.submit = function(msg, options, callback)
{
    var obj = { data: msg };
    if (options && options.stime) obj.stime = lib.toDate(options.stime).getTime();
    if (options && options.etime) obj.etime = lib.toDate(options.etime).getTime();
    logger.debug("sqs.publish:", options, lib.objDescr(obj));
    aws.sqsSendMessage(this.url, new Buffer(lib.stringify(obj)).toString("base64"), this.options, callback);
}
