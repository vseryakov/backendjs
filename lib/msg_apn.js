//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Nov 2014
//

var util = require('util');
var fs = require('fs');
var path = require('path');
var logger = require(__dirname + '/logger');
var core = require(__dirname + '/core');
var lib = require(__dirname + '/lib');
var aws = require(__dirname + '/aws');
var msg = require(__dirname + '/msg');
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
    return dev.service == client.name || (!dev.service && dev.id.match(/^[0-9a-f]+$/i));
}

// Initialize Apple Push Notification service in the current process, Apple supports multiple connections to the APN gateway but
// not too many so this should be called on the dedicated backend hosts, on multi-core servers every spawn web process will initialize a
// connection to APN gateway.
client.init = function(options)
{
    apn = require("apn");
    var config = msg.getConfig(this.name);
    for (var i in config) {
        if (this.agents[config[i]._app]) continue;

        var opts = lib.cloneObj(config[i]);
        opts.pfx = config[i]._pfx ? config[i]._pfx.match(/\.p12$/) ? config[i]._pfx : new Buffer(config[i]._pfx, "base64") : "";
        if (typeof opts.production == "undefined") opts.production = !config[i]._sandbox;
        if (typeof opts.autoAdjustCache == "undefined") opts.autoAdjustCache = true;
        if (typeof opts.connectionRetryLimit == "undefined") opts.connectionRetryLimit = 100;

        var agent = new apn.Connection(opts);
        agent._app = config[i]._app;
        agent._sent = 0;
        agent.on('error', logger.error.bind(logger, "apn:"));
        agent.on('transmissionError', this.onError.bind(this));
        agent.on('connected', function() { logger.debug('apn: connected') });
        agent.on('disconnected', function() { logger.debug('apn: disconnected') });

        // Only run if we need to handle uninstalls
        if (config[i].feeback) {
            opts.batchFeedback = true;
            agent.feedback = new apn.feedback(opts);
            agent.feedback.on("feedback", function(devices) {
                logger.info('init:', client.name, "feedback", devices);
                for (var i in devices) msg.emit("uninstall", client, devices[i].device, devices[i].time);
            });
            agent.feedback.on("error", logger.error.bind(logger, client.name + ":"));
            agent.feedback.on("feedbackError", logger.error.bind(logger, client.name + ":"));
            agent.feedback.start();
        }
        this.agents[config[i]._app] = agent;
        logger.info("init:", client.name, lib.objDescr(config[i]), lib.objDescr(agent.options));
    }
}

// Close APN agent, try to send all pending messages before closing the gateway connection
client.close = function(callback)
{
    lib.forEach(Object.keys(this.agents), function(key, next) {
        var agent = client.agents[key];
        delete client.agents[key];
        logger.info('close:', client.name, key, lib.objDescr(agent.options), 'sent:', agent._sent);
        agent.shutdown();
        if (agent.feedback) agent.feedback.cancel();
        agent.feedback = null;
        logger.info('close:', client.name, "done", key);
        next();
    }, callback);
}

// Send push notification to an Apple device, returns true if the message has been queued.
//
// The options may contain the following properties:
//  - msg - message text
//  - badge - badge number
//  - sound - 1, true or a sound file to play
//  - category - a user notification category
//  - alertAction - action to exec per Apple doc, action
//  - launchImage - image to show per Apple doc, launch-image
//  - contentAvailable - content indication per Apple doc, content-available
//  - locKey - localization key per Apple doc, loc-key
//  - locArgs - localization key per Apple doc, loc-args
//  - titleLocKey - localization key per Apple doc, title-loc-key
//  - titleLocArgs - localization key per Apple doc, title-loc-args
//  - id - send id in the user properties
//  - type - set type of the event
//  - url - launch url
//  - payload - an object with additional fileds to send in the message payload
client.send = function(dev, options, callback)
{
    if (!dev || !dev.id) return lib.tryCall(callback, lib.newError("invalid device:" + dev));

    // Catch invalid devices before they go into the queue where is it impossible to get the exact source of the error
    var hex = null;
    try { hex = new Buffer(dev.id, "hex"); } catch(e) {}
    if (!hex) return lib.tryCall(callback, lib.newError("invalid device token:" + dev.id));

    var agent = this.agents[dev.app] || this.agents.default;
    if (!agent) return lib.tryCall(callback, lib.newError("APN is not initialized for " + dev.id, 415));

    logger.debug("send:", client.name, agent._app, dev);
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
    if (options.id) msg.payload.id = options.id;
    if (options.type) msg.payload.type = options.type;
    if (options.url) msg.payload.url = options.url;
    if (options.account_id) msg.payload.account_id = options.account_id;
    for (var p in options.payload) msg.payload[p] = options.payload[p];
    var msg = new apn.Notification();
    var devices = lib.strSplit(dev.id).map(function(x) { return new apn.Device(x) });
    agent.pushNotification(msg, devices);
    agent._sent++;
    lib.tryCall(callback);
    return true;
}

client.onError = function(err, message, dev)
{
    logger[err >= 512 ? "error" : "debug"]('onError:', client.name, err, message, dev);
    if (err == 8) msg.emit("uninstall", this, dev.toString(), "", message && message.payload ? message.payload.account_id : "");
}
