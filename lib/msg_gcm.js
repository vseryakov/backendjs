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
var gcm = require('node-gcm');

module.exports = client;

var client = {
    name: "gcm",
    agents: {},
};

msg.modules.push(client);

client.check = function(dev)
{
    return dev.service == "gcm";
}

// Initialize Google Cloud Messaginh servie to send push notifications to mobile devices
client.init = function(options)
{
    var self = this;
    var config = msg.getConfig(this.name);
    for (var i in config) {
        if (this.agents[config[i].app]) continue;
        var agent = new gcm.Sender(config[i].key);
        agent._app = config[i].app;
        agent._sent = 0;
        agent._queue = 0;
        this.agents[config[i].app] = agent;
        logger.info("init:", "gcm", config);
    }
}

// Close GCM connection, flush the queue
client.close = function(callback)
{
    var self = this;
    lib.forEach(Object.keys(this.agents), function(key, next) {
        var agent = self.agents[key];
        delete self.agents[key];
        logger.info('close:', "gcm", key, 'queue:', agent._queue, 'sent:', agent._sent);

        var n = 0;
        function check() {
            if (!agent._queue || ++n > 600) {
                logger.info('close:', "gcm", "done", key);
                next();
            } else {
                setTimeout(check, 50);
            }
        }
        check();
    }, callback);
}

// Send push notification to an Android device, return true if queued.
client.send = function(dev, options, callback)
{
    if (!dev || !dev.id) return typeof callback == "function" && callback(lib.newError("invalid device:" + dev.id));

    var agent = this.agents[dev.app] || this.agents.default;
    if (!agent) return typeof callback == "function" && callback(lib.newError("GCM is not initialized for " + dev.id, 500));

    agent._queue++;

    logger.debug("send:", "gcm", agent._app, dev);
    var pkt = new gcm.Message();
    if (options.msg) pkt.addData('msg', options.msg);
    if (options.id) pkt.addData('id', options.id);
    if (options.type) pkt.addData("type", options.type);
    if (options.badge) pkt.addData('badge', options.badge);
    if (options.sound) pkt.addData('sound', options.sound);
    if (options.vibrate) pkt.addData('vibrate', options.vibrate);
    agent.send(pkt, [dev.id], 2, function(err) {
        agent._queue--;
        agent._sent++;
        if (typeof callback == "function") callback(err);
    });
    return true;
}

