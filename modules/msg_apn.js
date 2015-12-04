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
var apnagent = require("apnagent");

module.exports = client;

var client = {
    name: "apn",
    agents: {},
};

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
    var self = this;

    var config = msg.getConfig(this.name);
    for (var i in config) {
        if (this.agents[config[i].app]) continue;

        var agent = new apnagent.Agent();
        agent._app = config[i].app;
        agent._sent = 0;
        if (config[i].key.match(/\.p12$/)) {
            agent.set('pfx file', config[i].key);
        } else {
            agent.set("pfx", new Buffer(config[i].key, "base64"));
        }
        agent.enable(msg.apnSandbox ? "sandbox" : "production");
        agent.on('message:error', function(err, msg) { logger[err && err.code != 10 && err.code != 8 ? "error" : "log"]('apn:message:', lib.traceError(err)) });
        agent.on('gateway:error', function(err) { logger[err && err.code != 10 && err.code != 8 ? "error" : "log"]('apn:gateway:', lib.traceError(err)) });
        agent.on('gateway:close', function(err) { logger.info('apn: closed') });
        agent.decoder.on("error", function(err) { logger.error('apn:decoder:', lib.traceError(err)); });
        try {
            agent.connect(function(err) { logger[err ? "error" : "log"]('apn:', err || "connected", this._app); });
        } catch(e) {
            logger.error("init:", "apn", config[i], e.stack);
            continue;
        }

        // A posible workaround for the queue being stuck and not sending anything
        agent._timeout = setInterval(function() { agent.queue.process() }, 3000);

        // Only run if we need to handle uninstalls
        if (msg.config.apnFeeback) {
            agent.feedback = new apnagent.Feedback();
            if (config[i].key.match(/\.p12$/)) {
                agent.feedback.set('pfx file', config[i].key);
            } else {
                agent.feedback.set("pfx", new Buffer(config[i].key, "base64"));
            }
            agent.feedback.set('interval', '1h');
            agent.feedback.connect(function(err) { if (err) logger.error('apn: feedback:', err);  });
            agent.feedback.use(function(device, timestamp, next) {
                logger.log('apn: feedback:', device, timestamp);
                msg.uninstall(self, device, timestamp, next);
            });
        }
        this.agents[config[i].app] = agent;
        logger.info("init:", "apn", config[i], agent.settings);
    }
}

// Close APN agent, try to send all pending messages before closing the gateway connection
client.close = function(callback)
{
    var self = this;
    lib.forEach(Object.keys(this.agents), function(key, next) {
        var agent = self.agents[key];
        delete self.agents[key];
        logger.info('closeAPN:', key, agent.settings, 'connected:', agent.connected, 'queue:', agent.queue.length, 'sent:', agent._sent);
        clearInterval(agent._timeout);
        agent.close(function() {
            if (agent.feedback) agent.feedback.close();
            agent.feedback = null;
            logger.info('close:', "apn", "done", key);
            next();
        });
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
    var pkt = agent.createMessage().device(dev.id);
    if (options.msg) pkt.alert(options.msg);
    if (options.badge) pkt.badge(options.badge);
    if (options.sound) pkt.sound(typeof options.sound == "string" ? options.sound : "default");
    if (options.contentAvailable) pkt.contentAvailable(1);
    if (options.type) pkt.set("type", options.type);
    if (options.id) pkt.set("id", options.id);
    if (options.category) pkt.set("category", options.category);
    pkt.send(function(err) { if (!err) agent._sent++; });
    if (typeof callback == "function") process.nextTick(callback);
    return true;
}

