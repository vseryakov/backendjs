//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Nov 2014
//

var util = require('util');
var fs = require('fs');
var repl = require('repl');
var path = require('path');
var logger = require(__dirname + '/logger');
var core = require(__dirname + '/core');
var lib = require(__dirname + '/lib');
var aws = require(__dirname + '/aws');
var ipc = require(__dirname + '/ipc');
var cluster = require('cluster');
var apnagent = require("apnagent");
var gcm = require('node-gcm');

// Messaging and push notifications for mobile and other clients, supports Apple, Google and AWS/SNS push notifications.
var msg = {
    args: [ { name: "apn-cert@?(.+)?", obj: "config", camel: "-", strip: "@", descr: "A certificate for the particular app for APN service in pfx format, can be a file name with .p12 extension or a string with certificate contents encoded with base64, if the suffix is specified in the config parameter name will be used as the app name, otherwise it is global" },
            { name: "apn-sandbox", type: "bool", descr: "Enable sandbox mode for testing APN notifications, default is production mode" },
            { name: "gcm-key@?(.+)?", obj: "config", camel: "-", strip: "@", descr: "Google Cloud Messaging API key, if the suffix is specified in the config parameter will be used as the app name, without the suffix it is global" },
            { name: "shutdown-timeout", type:" int", min: 0, descr: "How long to wait for messages draining out in ms on shutdown before exiting" },],
    apnAgents: {},
    gcmAgents: {},
    config: {},
    shutdownTimeout: 1000,
};

module.exports = msg;

// A callback to be called for APN device uninstalls, it is called by the feedback service,
// the function must be defined as `function(device, timestamp, next)`, the next callback must be called at the end.
msg.onDeviceUninstall = null;

// Initialize supported notification services, it supports jobs arguments convention so can be used in the jobs that
// need to send push notifications in the worker process.
msg.init = function(options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    logger.debug("msg:", "init");

    this.initAPN(options);
    this.initGCM(options);
    if (typeof callback == "function") callback();
}

// Shutdown notification services, wait till all pending messages are sent before calling the callback
msg.shutdown = function(options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;

    // Wait a little just in case for some left over tasks
    var timeout = lib.toNumber((options && options.timeout) || this.shutdownTimeout);
    logger.debug("msg:", "shutdown", timeout);

    setTimeout(function() {
        lib.parallel([
           function(next) {
               self.closeAPN(next);
           },
           function(next) {
               self.closeGCM(next);
           },
        ], callback);
    }, timeout);
}

// Deliver a notification using the specified service, apple is default.
// Options with the following properties:
//  - device_id - device(s) where to send the message to, can be multiple ids separated by , or |, REQUIRED
//  - service - which service to use for delivery only: sns, apn, gcm
//  - msg - text message to send
//  - badge - badge number to show if supported by the service
//  - type - set type of the message, service specific
//  - id - send id with the notification, this is application specific data, sent as is
msg.send = function(options, callback)
{
    var self = this;
    if (typeof callback != "function") callback = lib.noop;
    if (!lib.isObject(options) || !options.device_id) return callback(lib.newError("invalid device or options"));

    logger.info("send:", options.device_id, "id:", options.id, "type:", options.type, "msg:", options.msg);

    // Determine the service to use from the device token
    var devices = lib.strSplit(options.device_id, null, "string");
    lib.forEachSeries(devices, function(device, next) {
        var dev = self.parseDevice(device);
        if (!dev.id) return next();
        if (options.service && options.service != dev.service) return next();
        logger.dev("send:", dev, options.id, options.type);
        switch (dev.service) {
        case "gcm":
            self.sendGCM(device, options, function(err) {
                if (err) logger.error("send:", device, err);
                // Stop on explicit fatal errors only
                next(err && err.status >= 500 ? err : null);
            });
            break;

        case "sns":
            self.sendSNS(device, options, function(err) {
                if (err) logger.error("send:", device, err);
                next(err && err.status >= 500 ? err : null);
            });
            break;

        case "apn":
            self.sendAPN(device, options, function(err) {
                if (err) logger.error("send:", device, err);
                next(err && err.status >= 500 ? err : null);
            });
            break;

        default:
            logger.error("send:", device, "invalid service");
        }
    }, callback);
}

// Parse device URN and returns an object with all parts into separate properties. A device URN can be in the following format:
//    [service://]device_token[@app]
//
//  - service is optional and defaults to `apn`, other options are `gcm`, `aws`
//  - app is optional and can define an application id which is used by APN for routing to the devices with corresponding APS certificate.
msg.parseDevice = function(device)
{
    var dev = { id: "", service: "apn", app: "default" };
    var d = String(device || "").match(/^([a-z]+\:\/\/)?([^@]+)@?([a-z0-9\.\_-]+)?/);
    if (d) {
        if (d[2] && d[2] != "undefined") dev.id = d[2];
        if (d[1]) dev.service = d[1].replace("://", "");
        if (d[3]) dev.app = d[3];
    }
    // Special cases
    if (dev.id.match(/^arn:aws:sns/)) dev.service = "sns";
    return dev;
}

// Initialize Apple Push Notification service in the current process, Apple supports multiple connections to the APN gateway but
// not too many so this should be called on the dedicated backend hosts, on multi-core servers every spawn web process will initialize a
// connection to APN gateway.
msg.initAPN = function(options)
{
    var self = this;

    for (var p in this.config) {
        var d = p.match(/^apnCert(.*)/);
        if (!d || !this.config[p] || typeof this.config[p] != "string") continue;
        var file = this.config[p], app = d[1] || "default";
        if (this.apnAgents[app]) continue;

        var agent = new apnagent.Agent();
        if (file.match(/\.p12$/)) {
            agent.set('pfx file', file);
        } else {
            agent.set("pfx", new Buffer(file, "base64"));
        }
        agent.enable(this.apnSandbox ? "sandbox" : "production");
        agent.on('message:error', function(err, msg) { logger[err && err.code != 10 && err.code != 8 ? "error" : "log"]('apn:message:', err.stack) });
        agent.on('gateway:error', function(err) { logger[err && err.code != 10 && err.code != 8 ? "error" : "log"]('apn:gateway:', err.stack) });
        agent.on('gateway:close', function(err) { logger.info('apn: closed') });
        agent.decoder.on("error", function(err) { logger.error('apn:decoder:', err.stack); });
        try {
            agent.connect(function(err) { logger[err ? "error" : "log"]('apn:', err || "connected"); });
        } catch(e) {
            logger.error("initAPN:", app, file, e.stack);
            continue;
        }


        // A posible workaround for the queue being stuck and not sending anything
        agent._timeout = setInterval(function() { agent.queue.process() }, 3000);
        agent._sent = 0;
        agent._app = app;

        // Only run if we need to handle uninstalls
        if (this.onDeviceUninstall) {
            agent.feedback = new apnagent.Feedback();
            if (file.match(/\.p12$/)) {
                agent.feedback.set('pfx file', file);
            } else {
                agent.feedback.set("pfx", new Buffer(file, "base64"));
            }
            agent.feedback.set('interval', '1h');
            agent.feedback.connect(function(err) { if (err) logger.error('apn: feedback:', err);  });
            agent.feedback.use(function(device, timestamp, next) {
                logger.log('apn: feedback:', device, timestamp);
                self.onDeviceUninstall(device, timestamp, next);
            });
        }
        this.apnAgents[app] = agent;
        logger.info("initAPN:", app, agent.settings);
    }
}

// Close APN agent, try to send all pending messages before closing the gateway connection
msg.closeAPN = function(callback)
{
    var self = this;
    lib.forEach(Object.keys(this.apnAgents), function(key, next) {
        var agent = self.apnAgents[key];
        delete self.apnAgents[key];
        logger.info('closeAPN:', key, agent.settings, 'connected:', agent.connected, 'queue:', agent.queue.length, 'sent:', agent._sent);
        clearInterval(agent._timeout);
        agent.close(function() {
            if (agent.feedback) agent.feedback.close();
            agent.feedback = null;
            logger.info('closeAPN: done', key);
            next();
        });
    }, callback);
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
    var dev = this.parseDevice(device_id);
    if (!dev.id) return typeof callback == "function" && callback(lib.newError("invalid device:" + device_id));

    // Catch invalid devices before they go into the queue where is it impossible to get the exact source of the error
    try { device_id = new Buffer(dev.id, "hex"); } catch(e) { device_id = ""; }
    if (!device_id) return typeof callback == "function" && callback(lib.newError("invalid device token"));

    var agent = this.apnAgents[dev.app] || this.apnAgents.default;
    if (!agent) return typeof callback == "function" && callback(lib.newError("APN is not initialized for " + dev.id, 500));

    logger.debug("sendAPN:", agent._app, dev);
    var pkt = agent.createMessage().device(device_id);
    if (options.msg) pkt.alert(options.msg);
    if (options.badge) pkt.badge(options.badge);
    if (options.type) pkt.set("type", options.type);
    if (options.id) pkt.set("id", options.id);
    pkt.send(function(err) { if (!err) agent._sent++; });
    if (typeof callback == "function") process.nextTick(callback);
    return true;
}

// Initialize Google Cloud Messaginh servie to send push notifications to mobile devices
msg.initGCM = function(options)
{
    var self = this;
    for (var p in this.config) {
        var d = p.match(/^gcmKey(.*)/);
        if (!d || !this.config[p] || typeof this.config[p] != "string") continue;
        var key = this.config[p], app = d[1] || "default";
        if (this.gcmAgents[app]) continue;

        var agent = new gcm.Sender(key);
        agent._app = app;
        agent._sent = 0;
        agent._queue = 0;
        this.gcmAgents[app] = agent;
        logger.info("initGCM:", app, key);
    }
}

// Close GCM connection, flush the queue
msg.closeGCM = function(callback)
{
    var self = this;
    lib.forEach(Object.keys(this.gcmAgents), function(key, next) {
        var agent = self.gcmAgents[key];
        delete self.gcmAgents[key];
        logger.info('closeGCM:', key, 'queue:', agent._queue, 'sent:', agent._sent);

        var n = 0;
        function check() {
            if (!agent._queue || ++n > 600) {
                logger.info('closeGCM: done', key);
                next();
            } else {
                setTimeout(check, 50);
            }
        }
        check();
    }, callback);
}

// Send push notification to an Android device, return true if queued.
msg.sendGCM = function(device_id, options, callback)
{
    var self = this;

    var dev = this.parseDevice(device_id);
    if (!dev.id) return typeof callback == "function" && callback(lib.newError("invalid device:" + device_id));

    var agent = this.gcmAgents[dev.app] || this.gcmAgents.default;
    if (!agent) return typeof callback == "function" && callback(lib.newError("GCM is not initialized for " + dev.id, 500));

    agent._queue++;

    logger.debug("sendGCM:", agent._app, dev);
    var pkt = new gcm.Message();
    if (options.msg) pkt.addData('msg', options.msg);
    if (options.id) pkt.addData('id', options.id);
    if (options.type) pkt.addData("type", options.type);
    if (options.badge) pkt.addData('badge', options.badge);
    agent.send(pkt, [dev.id], 2, function(err) {
        agent._queue--;
        agent._sent++;
        if (typeof callback == "function") callback(err);
    });
    return true;
}

// Send push notification to a device using AWS SNS service, device_id must be a valid SNS endpoint ARN.
//
// The options may contain the following properties:
//  - msg - message text
//  - badge - badge number
//  - type - set type of the packet
//  - id - send id in the user properties
msg.sendSNS = function(device_id, options, callback)
{
    var self = this;
    var pkt = {};
    var dev = this.parseDevice(device_id);
    if (!dev.id) return typeof callback == "function" && callback(lib.newError("invalid device:" + device_id, 400));

    // Format according to the rules per platform
    if (dev.id.match("/APNS/")) {
        if (options.msg) pkt.alert = options.msg;
        ["id","type","badge"].forEach(function(x) { if (options[x]) pkt[x] = options[x]; });
        pkt = { APNS: JSON.stringify({ aps: pkt }) };
    } else
    if (dev.id.match("/GCM/")) {
        if (options.msg) pkt.message = options.msg;
        ["id","type","badge"].forEach(function(x) { if (options[x]) pkt[x] = options[x]; });
        pkt = { GCM: JSON.stringify({ data: pkt }) };
    }
    aws.snsPublish(dev.id, pkt, function(err) {
        if (typeof callback == "function") callback(err);
    });
    return true;
}
