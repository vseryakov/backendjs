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
var Msg = require(__dirname + '/msg');

var client = {
    name: "gcm",
    priority: 5,
    agents: {},
};
module.exports = client;

Msg.modules.push(client);

client.check = function(dev)
{
    return dev.service == client.name;
}

// Initialize Google Cloud Messaging service to send push notifications to mobile devices
client.init = function(options)
{
    var self = this;
    var config = Msg.getConfig(this.name);
    for (var i in config) {
        if (this.agents[config[i]._app]) continue;
        this.agents[config[i]._app] = lib.objClone(config[i], "_sent", 0, "_queue", 0);
        logger.info("init:", client.name, lib.objDescr(config[i]));
    }
}

// Close GCM connection, flush the queue
client.close = function(callback)
{
    var self = this;
    lib.forEach(Object.keys(this.agents), function(key, next) {
        var agent = self.agents[key];
        delete self.agents[key];
        logger.info('close:', client.name, key, 'queue:', agent._queue, 'sent:', agent._sent);

        var n = 0;
        function check() {
            if (!agent._queue || ++n > 600) {
                logger.info('close:', client.name, "done", key);
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
    if (!dev || !dev.id) return lib.tryCall(callback, lib.newError("invalid device:" + dev.id));

    var agent = this.agents[dev.app] || this.agents.default;
    if (!agent) return lib.tryCall(callback, lib.newError("GCM is not initialized for " + dev.id, 415));

    agent._queue++;

    var msg = { data: {} };
    msg[dev.id.indexOf(",") > -1 ? "registration_ids" : "to"] = dev.id;
    if (options.name) msg.collapse_key = options.name;
    if (options.msg) msg.data.msg = String(options.msg);
    if (options.badge) msg.data.badge = lib.toBool(options.badge);
    if (options.sound) msg.data.sound = lib.toBool(options.sound);
    if (options.vibrate) msg.data.vibrate = lib.toBool(options.vibrate);
    if (options.id) msg.data.id = String(options.id);
    if (options.url) msg.data.url = String(options.url);
    if (options.type) msg.data.type = String(options.type);
    if (options.account_id) msg.data.account_id = String(options.account_id);
    for (var p in options.payload) msg.data[p] = options.payload[p];

    var opts = {
        method: 'POST',
        headers: { 'Authorization': 'key=' + agent._key },
        postdata: msg,
        retryCount: agent.retryCount || this.retryCount || 3,
        retryTimeout: agent.retryTimeout || this.retryTimeout || 1000,
        retryOnError: client.retryOnError,
    };
    core.httpGet('https://android.googleapis.com/gcm/send', opts, function(err, params) {
        if (!err && params.status >= 400) err = lib.newError(params.status + ": " + params.data, params.status);
        logger[err ? "error" : "debug"]("send:", client.name, agent._app, dev, msg, err);
        agent._queue--;
        agent._sent++;
        lib.tryCall(callback, err);
    });
    return true;
}

// Retry on server error, honor Retry-After header if present, use it only on the first error
client.retryOnError = function()
{
    if (this.status < 500) return 0;
    if (!this.retryAfter) {
        this.retryAfter = lib.toNumber(this.headers['retry-after']) * 1000;
        if (this.retryAfter > 0 && this.retryCount > 0) this.retryTimeout = this.retryAfter/2;
    }
    return 1;
}
