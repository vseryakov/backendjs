/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const logger = require(__dirname + '/../logger');
const lib = require(__dirname + '/../lib');
const modules = require(__dirname + '/../modules');

const properties = [
    "actions", "badge", "body", "dir", "icon", "image",
    "lang", "renotify", "requireInteraction", "silent", "tag", "timestamp", "vibrate"
];
var webpush;
var agents = {};

/**
 * Send a Web push notification using the `web-push` npm module, referer to it for details how to generate VAPID credentials to
 * configure this module with 3 required parameters:
 *
 * The device token must be generated in the browser after successful subscription:
 * @param {object|object[]} options
 * @param {string} options.key - VAPID private key
 * @param {string} options.pubkey - VAPID public key
 * @param {string} options.email - an admin email for the VAPID subject
 * @example
 * const registration = await navigator.serviceWorker.register("/js/webpush.js", { scope: "/" });
 * const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKeyPublic });
 * app.fetch({ url: '/user/update', data: { pushkey: "webpush://" + window.btoa(JSON.stringify(subscription)) }, type: "POST" });
 * @memberOf module:push
 */

class WebpushClient {

    constructor(options) {
        if (!webpush) webpush = require("web-push");
        if (!Array.isArray(options)) options = [options];
        for (const agent of options) {
            if (!agent.key || !agent.pubkey) continue;
            agents[agent.app || "default"] = {
                key: options.key,
                pubkey: options.pubkey,
                subject: `mailto:${options.email}`,
                app: options.app,
                queue: 0,
                sent: 0,
            };
        }
    }

    static configure(options) {
        modules.api.hooks.add('access', '', '/js/webpush.js', (req, status, callback) => {
            req.res.header("Service-Worker-Allowed", "/");
            callback();
        });
    }

    send(device, options, callback) {
        const agent = agents[device.app] || agents.default;
        if (!agent) return callback("no agents initialized");

        const to = lib.jsonParse(Buffer.from(device.token, "base64").toString());
        if (!to) return callback(lib.newError("invalid device", { device }));

        var msg = { title: options.title, body: options.msg, data: {} };
        for (const p of properties) {
            if (typeof options[p] != "undefined") msg[p] = options[p];
        }

        if (options.id) msg.data.id = String(options.id);
        if (options.url) msg.data.url = String(options.url);
        if (options.type) msg.data.type = String(options.type);
        if (options.user_id) msg.data.user_id = options.user_id;
        for (const p in options.payload) msg.data[p] = options.payload[p];

        const opts = {
            vapidDetails: {
                subject: agent.subject,
                publicKey: agent.pubkey,
                privateKey: agent.key,
            }
        }
        this.queue++;
        webpush.sendNotification(to, lib.stringify(msg), opts).
        then(() => {
            this.queue--;
            this.sent++;
            logger.debug("send:", this.name, device, msg);
            callback();
        }).
        catch((err) => {
            this.queue--;
            logger.error("send:", this.name, err, device, msg);
            callback(err);
        });
    }
}

module.exports = WebpushClient;
