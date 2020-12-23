//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const logger = require(__dirname + '/logger');
const lib = require(__dirname + '/lib');
const Msg = require(__dirname + '/msg');

const client = {
    name: "apn",
    priority: 50,
    agents: {},
};
module.exports = client;

Msg.modules.push(client);

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
    this.apn = require("@parse/node-apn");
    var config = Msg.getConfig(this.name);
    for (var i in config) {
        if (this.agents[config[i]._app]) continue;

        var opts = lib.objClone(config[i]);
        if (opts._authkey) {
            opts._app = opts._app.split("-");
            opts.token = {
                teamId: opts._app[0],
                keyId: opts._app[1],
                key: opts._authkey.match(/\.p8$/) ? opts._authkey : Buffer.from(opts._authkey, "base64"),
            };
            opts._app = opts._app[0];
        } else
        if (opts._pfx) {
            opts.pfx = opts._pfx.match(/\.p12$/) ? opts._pfx : Buffer.from(opts._pfx, "base64");
        } else {
            continue;
        }
        if (typeof opts.production == "undefined") opts.production = !opts._sandbox;
        if (typeof opts.connectionRetryLimit == "undefined") opts.connectionRetryLimit = 100;
        var agent = {};
        try {
            agent = new this.apn.Provider(opts);
            agent._app = opts._app;
            agent._sent = 0;
            agent.on('error', logger.error.bind(logger, "apn:"));
            this.agents[opts._app] = agent;
            logger.info("init:", client.name, opts, agent.options);
        } catch (e) {
            logger.error("init:", client.name, opts, agent.options, e);
        }
    }
}

// Close APN agent, try to send all pending messages before closing the gateway connection
client.close = function(callback)
{
    lib.forEach(Object.keys(this.agents), function(key, next) {
        var agent = client.agents[key];
        delete client.agents[key];
        logger.info('close:', client.name, key, agent.options, 'sent:', agent._sent);
        agent.shutdown();
        logger.info('close:', client.name, "done", key);
        next();
    }, callback);
}

// Send push notification to an Apple device, returns true if the message has been queued.
//
// The options may contain the following properties:
//  - msg - message text
//  - title - alert title
//  - badge - badge number
//  - sound - 1, true or a sound file to play
//  - category - a user notification category
//  - alertAction - action to exec per Apple doc, action
//  - launchImage - image to show per Apple doc, launch-image
//  - contentAvailable - content indication per Apple doc, content-available
//  - mutableContent - mark the notification to go via extention for possible modifications
//  - locKey - localization key per Apple doc, loc-key
//  - locArgs - localization key per Apple doc, loc-args
//  - titleLocKey - localization key per Apple doc, title-loc-key
//  - titleLocArgs - localization key per Apple doc, title-loc-args
//  - threadId - grouping id, all msgs with the same id will be grouped together
//  - id - send id in the user properties
//  - type - set type of the event
//  - url - launch url
//  - payload - an object with additional fileds to send in the message payload
client.send = function(dev, options, callback)
{
    if (!dev || !dev.id) return lib.tryCall(callback, lib.newError("invalid device:" + dev));

    // Catch invalid devices before they go into the queue where is it impossible to get the exact source of the error
    var hex = null;
    try { hex = Buffer.from(dev.id, "hex"); } catch (e) {}
    if (!hex) return lib.tryCall(callback, lib.newError("invalid device token:" + dev.id));

    var agent = this.agents[dev.app] ||
                this.agents[Msg.getTeam(dev.app)] ||
                this.agents.default;
    if (!agent) return lib.tryCall(callback, lib.newError("APN is not initialized for " + dev.id, 415));

    var msg = new this.apn.Notification();
    msg.topic = dev.app && dev.app != "default" ? dev.app : Msg.appDefault;
    if (options.msg) msg.setAlert(options.msg);
    if (options.title) msg.setTitle(options.title);
    if (options.expires) msg.setExpiry(options.expires);
    if (options.priority) msg.setPriority(options.priority);
    if (options.badge) msg.setBadge(options.badge);
    if (options.sound) msg.setSound(typeof options.sound == "string" ? options.sound : "default");
    if (options.category) msg.setCategory(options.category);
    if (options.contentAvailable) msg.setContentAvailable(true);
    if (options.mutableContent) msg.setMutableContent(true);
    if (options.launchImage) msg.setLaunchImage(options.launchImage);
    if (options.locKey) msg.setLocKey(options.locKey);
    if (options.locArgs) msg.setLocArgs(options.locArgs);
    if (options.titleLocKey) msg.setTitleLocKey(options.titleLocKey);
    if (options.titleLocArgs) msg.setTitleLocArgs(options.titleLocArgs);
    if (options.alertAction) msg.setAction(options.alertAction);
    if (options.threadId) msg.setThreadId(options.threadId);
    if (options.id) msg.payload.id = options.id;
    if (options.type) msg.payload.type = options.type;
    if (options.url) msg.payload.url = options.url;
    if (options.account_id) msg.payload.account_id = options.account_id;
    for (var p in options.payload) msg.payload[p] = options.payload[p];
    agent.send(msg, lib.strSplit(dev.id)).then(function(result) {
        logger.debug("send:", client.name, agent._app, dev, msg, result);
        agent._sent += result.sent.length;
        for (var i in result.failed) {
            if (result.failed[i].status == 410) {
                Msg.emit("uninstall", client, result.failed[i].device, options.account_id);
            }
        }
    });
    lib.tryCall(callback);
    return true;
}

