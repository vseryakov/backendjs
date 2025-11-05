/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const logger = require(__dirname + '/../logger');
const lib = require(__dirname + '/../lib');
const api = require(__dirname + '/../api');

const mod = {
    name: "webpush",

    create: function(options) {
        if (["webpush", "wp"].includes(options?.type)) return new WebpushClient(options);
    },

    configure: function(options) {
        api.hooks.add('access', '', '/js/webpush.js', function(req, status, cb) {
            req.res.header("Service-Worker-Allowed", "/");
            cb();
        });
    },

    properties: ["actions", "badge", "body", "dir", "icon", "image", "lang", "renotify", "requireInteraction", "silent", "tag", "timestamp", "vibrate"],
};

module.exports = mod;


/**
 * Send a Web push notification using the `web-push` npm module, referer to it for details how to generate VAPID credentials to
 * configure this module with 3 required parameters:
 *
 *  - `key` - VAPID private key
 *  - `pubkey` - VAPID public key
 *  - `email` - an admin email for the VAPID subject
 *
 * The device token must be generated in the browser after successful subscription:
 *
 *          navigator.serviceWorker.register("/js/webpush.js", { scope: "/" }).then(function(registration) {
 *              registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKeyPublic }).then(function(subscription) {
 *                  bkjs.send({ url: '/user/update', data: { pushkey: "wp://" + window.btoa(JSON.stringify(subscription)) }, type: "POST" });
 *              }).catch((err) => {})
 *          });
 */

class WebpushClient {

    constructor(options) {
        this.type = options.type;
        this.key = options.key;
        this.pubkey = options.pubkey;
        this.subject = `mailto:${options.email}`;
        this.app = options.app;
        this.queue = 0;
    }

    close() {}

    send(dev, options, callback) {
        if (!dev?.id) return lib.tryCall(callback, lib.newError("invalid device:" + dev.id));

        var to = lib.jsonParse(Buffer.from(dev.id, "base64").toString());
        if (!to) return lib.tryCall(callback, lib.newError("invalid device id:" + dev.id));

        var msg = { title: options.title, body: options.msg, data: {} };
        for (const p of mod.properties) {
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
        this.webpush.sendNotification(to, lib.stringify(msg), opts).
        then(() => {
            this.queue--;
            logger.debug("send:", mod.name, dev, msg);
            lib.tryCall(callback);
        }).
        catch((err) => {
            this.queue--;
            logger.error("send:", mod.name, err, dev, msg);
            lib.tryCall(callback, err);
        });
        return true;
    }
}
