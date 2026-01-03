//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const logger = require(__dirname + '/../logger');
const lib = require(__dirname + '/../lib');
const modules = require(__dirname + '/../modules');

var apn;
var agents = {};

/**
 * Send push notification using @parse/node-apn module,
 * initialize Apple Push Notification service in the current process, Apple supports multiple connections to the APN gateway but
 * not too many so this should be called on the dedicated backend hosts, on multi-core servers every spawn web process will initialize a
 * connection to APN gateway.
 * @param {object} options
 * @param {string} key - Authentication Token key, file.p8 or base64 key data
 * @param {string} options.teamId - ID of the team associated with the provider token key
 * @param {string} options.keyId - The ID of the key issued by Apple
 * @param {boolean} [sandbox] - true if in sandbox mode
 * @memberOf module:push
 */

class APNClient {

    constructor(options)
    {
        if (!apn) apn = require("@parse/node-apn");
        if (!Array.isArray(options)) options = [options];
        for (const agent of options) {
            if (!agent.key) continue;
            agent.app = agent.app || "default";
            if (agents[agent.app]) continue;

            try {
                var opts = {
                    production: !agent.sandbox,
                    connectionRetryLimit: agent.connectionRetryLimit || 100,
                    clientCount: agent.clientCount || 1,
                    token: {
                        teamId: agent.teamId,
                        keyId: agent.keyId,
                        key: agent.key.match(/\.p8$/) ? agent.key : Buffer.from(agent.key, "base64"),
                    }
                };
                const provider = new apn.Provider(opts);
                agents[agent.app] = {
                    app: options.app,
                    teamId: agent.teamId,
                    keyId: agent.keyId,
                    sent: 0,
                    provider,
                };
            } catch (e) {
                 logger.error("init:", "apn", agent.app, e);
                 continue;
            }
        }
    }

    // Close APN agent, try to send all pending messages before closing the gateway connection
    close(callback)
    {
        lib.forEach(Object.keys(agents), (key, next) => {
            var agent = agents[key];
            delete agents[key];
            logger.info('close:', "apn", key, agent.app, 'sent:', agent.sent);
            agent.provider.shutdown();
            next();
        }, callback);
    }

    /**
     * Send push notification to an Apple device, returns true if the message has been queued.
     * @param {object} device
     * @param {object} options
     * @param {string} [options.msg] - message text
     * @param {string} [options.title] - alert title
     * @param {string} [options.badge] - badge number
     * @param {string} [options.sound] - 1, true or a sound file to play
     * @param {string} [options.category] - a user notification category
     * @param {string} [options.alertAction] - action to exec per Apple doc, action
     * @param {string} [options.launchImage] - image to show per Apple doc, launch-image
     * @param {string} [options.contentAvailable] - content indication per Apple doc, content-available
     * @param {string} [options.mutableContent] - mark the notification to go via extention for possible modifications
     * @param {string} [options.locKey] - localization key per Apple doc, loc-key
     * @param {string} [options.locArgs] - localization key per Apple doc, loc-args
     * @param {string} [options.titleLocKey] - localization key per Apple doc, title-loc-key
     * @param {string} [options.titleLocArgs] - localization key per Apple doc, title-loc-args
     * @param {string} [options.threadId] - grouping id, all msgs with the same id will be grouped together
     * @param {string} [options.id] - send id in the user properties
     * @param {string} [options.type] - set type of the event
     * @param {string} [options.url] - launch url
     * @param {string} [options.payload] - an object with additional fileds to send in the message payload
     * @param {function} [callback]
    */
    send(device, options, callback)
    {
        // Catch invalid devices before they go into the queue where is it impossible to get the exact source of the error
        var hex = null;
        try { hex = Buffer.from(device.token, "hex"); } catch (e) {}
        if (!hex) return callback(lib.newError("invalid device token", { device }));

        var agent = this.agents[device.app] || this.agents.default;
        if (!agent) return callback("no agents initialized");

        var msg = new apn.Notification();
        msg.topic = device.app;
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
        if (options.user_id) msg.payload.user_id = options.user_id;
        for (const p in options.payload) msg.payload[p] = options.payload[p];

        agent.provider.send(msg, lib.split(device.token)).then((result) => {
            logger.debug("send:", "apn", device, msg, result);
            agent.sent += result.sent.length;
            for (const i in result.failed) {
                if (result.failed[i].status == 410) {
                    modules.push.emit("uninstall", result.failed[i].device, options.user_id);
                }
            }
        });
        callback();
    }

}

module.exports = APNClient;
