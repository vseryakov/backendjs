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

/**
 * Send a Web push notification using the `web-push` npm module, referer to it for details how to generate VAPID credentials to
 * configure this module with 3 required parameters:
 *
 * The device token must be generated in the browser after successful subscription:
 * @param {object} options
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
        this.type = options.type;
        this.key = options.key;
        this.pubkey = options.pubkey;
        this.subject = `mailto:${options.email}`;
        this.app = options.app;
        this.queue = 0;
    }

    close(callback) {
        lib.tryCall(callback);
    }

    static configure(options) {
        modules.api.hooks.add('access', '', '/js/webpush.js', (req, status, callback) => {
            req.res.header("Service-Worker-Allowed", "/");
            callback();
        });
    }

    send(dev, options, callback) {
        if (!dev?.id) return lib.tryCall(callback, lib.newError("invalid device:" + dev.id));

        var to = lib.jsonParse(Buffer.from(dev.id, "base64").toString());
        if (!to) return lib.tryCall(callback, lib.newError("invalid device id:" + dev.id));

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
                subject: this.subject,
                publicKey: this.pubkey,
                privateKey: this.key,
            }
        }
        this.queue++;
        webpush.sendNotification(to, lib.stringify(msg), opts).
        then(() => {
            this.queue--;
            logger.debug("send:", this.name, dev, msg);
            lib.tryCall(callback);
        }).
        catch((err) => {
            this.queue--;
            logger.error("send:", this.name, err, dev, msg);
            lib.tryCall(callback, err);
        });
        return true;
    }
}

module.exports = WebpushClient;
