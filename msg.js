//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Nov 2014
//

var util = require('util');
var fs = require('fs');
var repl = require('repl');
var path = require('path');
var backend = require(__dirname + '/build/Release/backend');
var logger = require(__dirname + '/logger');
var core = require(__dirname + '/core');
var aws = require(__dirname + '/aws');
var cluster = require('cluster');
var apnagent = require("apnagent");
var gcm = require('node-gcm');

// Notifications for mobile and others
var msg = {
    apnSent: 0,
    gcmSent: 0,
    awsSent: 0,
};

module.exports = msg;

// Initialize supported notification services, this must be called before sending any push notifications
msg.init = function(callback)
{
    var self = this;

    this.notificationQueue = null;

    // Explicitly configured notification client queue, send all messages there
    if (core.notificationClient) {
        this.notificationQueue = core.notificationClient;
        return callback ? callback() : null;
    } else

    // Explicitely configured notification server queue
    if (core.notificationServer) {
        this.subscribe(core.notificationServer, function(arg, key, data) {
            self.sendNotification(core.jsonParse(data, { obj: 1 }));
        });
    } else

    // Connect to notification gateways only on the hosts configured to be the notification servers
    if (core.notificationHost) {
        var queue = "bk.notification.queue";
        if (!core.strSplit(core.notificationHost).some(function(x) { return core.hostname == x || core.ipaddrs.indexOf(x) > -1 })) {
            this.notificationQueue = queue;
            return callback ? callback() : null;
        }
        // Listen for published messages and forward them to the notification gateways
        this.subscribe(queue, function(arg, key, data) {
            self.sendNotification(core.jsonParse(data, { obj: 1 }));
        });
    }

    // Direct access to the gateways
    this.initAPN();
    this.initGCM();
    if (callback) callback();
}

// Shutdown notification services, wait till all pending messages are sent before calling the callback
msg.shutdown = function(options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    // Wait a little just in case for some left over tasks
    setTimeout(function() {
        core.parallel([
           function(next) {
               self.closeAPN(next);
           },
           function(next) {
               self.closeGCM(next);
           },
        ], callback);
    }, options.timeout || 2000);
}

// Deliver a notification using the specified service, apple is default.
// Options may contain the following properties:
//  - device_id - device where to send the message to
//  - service - which service to use for delivery: aws, apns, gcm, ads, mpns, wns
//  - msg - text message to send
//  - badge - badge number to show if supported by the service
//  - type - set type of the message, service specific
//  - id - send id with the notification, this is application specific data, sent as is
msg.send = function(options, callback)
{
    var self = this;
    if (typeof callback != "function") callback = core.noop;
    if (!options || typeof options.device_id != "string") return callback ? callback("invalid device or options") : null;

    // Queue to the publish server
    if (this.notificationQueue) {
        if (callback) setImmediate(callback);
        return this.publish(this.notificationQueue, options);
    }

    // Determine the service to use from the device token
    var service = options.service || "";
    var device_id = String(options.device_id);
    if (device_id.match(/^arn\:aws\:/)) {
        service = "aws";
    } else {
        var d = device_id.match(/^([^:]+)\:\/\/(.+)$/);
        if (d) service = d[1], device_id = d[2];
    }
    switch (service) {
    case "gcm":
        return this.sendGCM(device_id, options, callback);

    case "aws":
        return this.sendAWS(device_id, options, callback);

    default:
        return this.sendAPN(device_id, options, callback);
    }
}

// Initiaize Apple Push Notification service in the current process, Apple supports multiple connections to the APN gateway but
// not too many so this should be called on the dedicated backend hosts, on multi-core servers every spawn web process will initialize a
// connection to APN gateway.
msg.initAPN = function()
{
    var self = this;

    if (!core.apnCert) return;
    this.apnAgent = new apnagent.Agent();
    this.apnAgent.set('pfx file', core.apnCert);
    this.apnAgent.enable(core.apnProduction || core.apnCert.indexOf("production") > -1 ? 'production' : 'sandbox');
    this.apnAgent.on('message:error', function(err) { logger.error('apn:message:', err) });
    this.apnAgent.on('gateway:error', function(err) { logger[err && err.code != 10 && err.code != 8 ? "error" : "log"]('apn:gateway:', err) });
    this.apnAgent.on('gateway:close', function(err) { logger.log('apn: closed') });
    this.apnAgent.connect(function(err) { logger[err ? "error" : "log"]('apn:', err || "connected"); });
    // A posible workaround for the queue being stuck and not sending anything
    this.apnTimeout = setInterval(function() { self.apnAgent.queue.process() }, 3000);
    this.apnSent = 0;
    logger.debug("initAPN:", this.apnAgent.settings);

    this.apnFeedback = new apnagent.Feedback();
    this.apnFeedback.set('interval', '1h');
    this.apnFeedback.set('pfx file', core.apnCert);
    this.apnFeedback.connect(function(err) { if (err) logger.error('apn: feedback:', err);  });
    this.apnFeedback.use(function(device, timestamp, next) {
        logger.log('apn: feedback:', device, timestamp);
        next();
    });
}

// Close APN agent, try to send all pending messages before closing the gateway connection
msg.closeAPN = function(callback)
{
    var self = this;
    if (!this.apnAgent) return callback ? callback() : null;

    logger.debug('closeAPN:', this.apnAgent.settings, 'connected:', this.apnAgent.connected, 'queue:', this.apnAgent.queue.length, 'sent:', this.apnSent);

    clearInterval(this.apnTimeout);
    this.apnAgent.close(function() {
        self.apnFeedback.close();
        self.apnAgent = null;
        self.apnFeedback = null;
        logger.log('closeAPN: done');
        if (callback) callback();
    });
}

// Send push notification to an Apple device, returns true if the message has been queued.
//
// The options may contain the following properties:
//  - msg - message text
//  - badge - badge number
//  - type - set type of the packet
//  - id - send id in the user properties
msg.sendAPN = function(device_id, options, callback)
{
    var self = this;
    if (!this.apnAgent) return callback ? callback("APN is not initialized") : false;

    var pkt = this.apnAgent.createMessage().device(device_id);
    if (options.msg) pkt.alert(options.msg);
    if (options.badge) pkt.badge(options.badge);
    if (options.type) pkt.set("type", options.type);
    if (options.id) pkt.set("id", options.id);
    pkt.send(function(err) { if (!err) self.apnSent++; });
    if (callback) process.nextTick(callback);
    return true;
}

// Initialize Google Cloud Messaginh servie to send push notifications to mobile devices
msg.initGCM = function()
{
    var self = this;
    if (!core.gcmKey) return;
    this.gcmAgent = new gcm.Sender(core.gcmKey);
    this.gcmQueue = 0;
}

// Close GCM connection, flush the queue
msg.closeGCM = function(callback)
{
    var self = this;
    if (!self.gcmAgent || !self.gcmQueue) return callback ? callback() : null;

    logger.debug('closeGCM:', 'queue:', self.gcmQueue, 'sent:', this.gcmSent);

    var n = 0;
    function check() {
        if (!self.gcmQueue || ++n > 30) {
            self.gcmAgent = null;
            self.gcmSent = 0;
            logger.log('closeGCM: done');
            next();
        } else {
            setTimeout(check, 1000);
        }
    }
    check();
}

// Send push notification to an Android device, return true if queued.
msg.sendGCM = function(device_id, options, callback)
{
    var self = this;
    if (!this.gcmAgent) return callback ? callback("GCM is not initialized") : false;

    this.gcmQueue++;
    var pkt = new gcm.Message();
    if (options.msg) pkt.addData('msg', options.msg);
    if (options.id) pkt.addData('id', options.id);
    if (options.type) pkt.addData("type", options.type);
    if (options.badge) pkt.addData('badge', options.badge);
    this.gcmAgent.send(pkg, [device_id], 2, function() {
        self.gcmQueue--;
        self.gcmSent++;
        if (callback) process.nextTick(callback);
    });
    return true;
}

// Send push notification to a device using AWS SNS service, device_d must be a valid SNS endpoint ARN.
//
// The options may contain the following properties:
//  - msg - message text
//  - badge - badge number
//  - type - set type of the packet
//  - id - send id in the user properties
msg.sendAWS = function(device_id, options, callback)
{
    var self = this;
    var pkt = {};
    // Format according to the rules per platform
    if (device_id.match("/APNS/")) {
        if (options.msg) pkt.alert = options.msg;
        ["id","type","badge"].forEach(function(x) { if (options[x]) pkt[x] = options[x]; });
        pkt = { APNS: JSON.stringify({ aps: pkt }) };
    } else
    if (device_id.match("/GCM/")) {
        if (options.msg) pkt.message = options.msg;
        ["id","type","badge"].forEach(function(x) { if (options[x]) pkt[x] = options[x]; });
        pkt = { GCM: JSON.stringify({ data: pkt }) };
    }
    aws.snsPublish(device_id, pkt, function(err) {
        if (!err) self.awsSent++;
        if (callback) callback(err);
    });
    return true;
}
