//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Nov 2014
//

var util = require('util');
var fs = require('fs');
var path = require('path');
var logger = require(__dirname + '/../logger');
var core = require(__dirname + '/../core');
var lib = require(__dirname + '/../lib');
var aws = require(__dirname + '/../aws');
var msg = require(__dirname + '/../msg');
var apn;

var client = {
    name: "apn",
    agents: {},
};
module.exports = client;

msg.modules.push(client);

// Returns true if given device is supported by APN
client.check = function(dev)
{
    return dev.service == "apn" || (!dev.service && dev.id.match(/^[0-9a-f]+$/i));
}

// Initialize Apple Push Notification service in the current process, Apple supports multiple connections to the APN gateway but
// not too many so this should be called on the dedicated backend hosts, on multi-core servers every spawn web process will initialize a
// connection to APN gateway.
client.init = function(options)
{
    apn = require("apn");
    var config = msg.getConfig(this.name);
    for (var i in config) {
        if (this.agents[config[i].app]) continue;

        var opts = lib.cloneObj(config[i]);
        opts.pfx = config[i]._pfx ? config[i]._pfx.match(/\.p12$/) ? config[i]._pfx : new Buffer(config[i]._pfx, "base64") : "";
        if (typeof opts.production == "undefined") opts.production = !config[i]._sandbox;
        if (typeof opts.autoAdjustCache == "undefined") opts.autoAdjustCache = true;
        if (typeof opts.connectionRetryLimit == "undefined") opts.connectionRetryLimit = 100;

        var agent = new apn.Connection(opts);
        agent._app = config[i]._app;
        agent._sent = 0;
        agent.on('error', console.error);
        agent.on('transmissionError', function(err, msg, dev) { logger[err >= 512 ? "error" : "log"]('apn:', err, msg, dev) });
        agent.on('connected', function() { logger.info('apn: connected') });
        agent.on('disconnected', function() { logger.info('apn: disconnected') });

        // Only run if we need to handle uninstalls
        if (config[i].feeback) {
            opts.batchFeedback = true;
            agent.feedback = new apn.feedback(opts);
            agent.feedback.on("feedback", function(devices) {
                logger.info('apn: feedback:', devices);
                for (var i in devices) msg.uninstall(self, devices[i].device, devices[i].time, next);
            });
            agent.feedback.on("error", console.error);
            agent.feedback.on("feedbackError", console.error);
            agent.feedback.start();
        }
        this.agents[config[i]._app] = agent;
        logger.info("init:", "apn", lib.descrObj(config[i]), agent.settings);
    }
}

// Close APN agent, try to send all pending messages before closing the gateway connection
client.close = function(callback)
{
    lib.forEach(Object.keys(this.agents), function(key, next) {
        var agent = client.agents[key];
        delete client.agents[key];
        logger.info('closeAPN:', key, agent.settings, 'connected:', agent.connected, 'queue:', agent.queue.length, 'sent:', agent._sent);
        agent.shutdown();
        if (agent.feedback) agent.feedback.cancel();
        agent.feedback = null;
        logger.info('close:', "apn", "done", key);
        next();
    }, callback);
}

// Send push notification to an Apple device, returns true if the message has been queued.
//
// The options may contain the following properties:
//  - msg - message text
//  - badge - badge number
//  - sound - 1, true or a sound file to play
//  - type - set type of the packet
//  - category - a user notification category
//  - contentAvailable - to indicate about new content so fetchCompletionHandler is called
//  - id - send id in the user properties
client.send = function(dev, options, callback)
{
    if (!dev || !dev.id) return typeof callback == "function" && callback(lib.newError("invalid device:" + dev));

    // Catch invalid devices before they go into the queue where is it impossible to get the exact source of the error
    var hex = null;
    try { hex = new Buffer(dev.id, "hex"); } catch(e) {}
    if (!hex) return typeof callback == "function" && callback(lib.newError("invalid device token:" + dev.id));

    var agent = this.agents[dev.app] || this.agents.default;
    if (!agent) return typeof callback == "function" && callback(lib.newError("APN is not initialized for " + dev.id, 415));

    logger.debug("sendAPN:", agent._app, dev);
    var device = new apn.Device(dev.id);
    var msg = new apn.Notification();
    if (options.expires) msg.setExpiry(options.expires);
    if (options.priority) msg.setPriority(options.priority);
    if (options.badge) msg.setBadge(options.badge);
    if (options.sound) msg.setSound(typeof options.sound == "string" ? options.sound : "default");
    if (options.msg) msg.setAlertText(options.msg);
    if (options.title) msg.setAlertTitle(options.title);
    if (options.category) msg.setCategory(options.category);
    if (options.contentAvailable) msg.setContentAvailable(true);
    if (options.launchImage) msg.setLaunchImage(options.launchImage);
    if (options.locKey) msg.setLocKey(options.locKey);
    if (options.locArgs) msg.setLocArgs(options.locArgs);
    if (options.titleLocKey) msg.setTitleLocKey(options.titleLocKey);
    if (options.titleLocArgs) msg.setTitleLocArgs(options.titleLocArgs);
    if (options.alertAction) msg.setAlertAction(options.alertAction);
    if (options.type) msg.payload.type = options.type;
    if (options.id) msg.payload.id = options.id;
    agent.pushNotification(msg, device);
    agent._sent++;
    if (typeof callback == "function") process.nextTick(callback);
    return true;
}

