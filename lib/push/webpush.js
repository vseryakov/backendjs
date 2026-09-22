/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
'use strict';

const logger = require(__dirname + '/../logger');
const lib = require(__dirname + '/../lib');
const webpush = require("web-push");

const properties = [
    "actions", "badge", "body", "dir", "icon", "image",
    "lang", "renotify", "requireInteraction", "silent",
    "tag", "timestamp", "vibrate"
];
var agents = {};

/**
 * Send a Web push notification using the `web-push` npm module, referer to it for details how to generate VAPID credentials to
 * configure this module with 3 required parameters:
 *
 * Config must have this entry for worker to work:
 *
 * ```
 * api-headers-^/js/webpush.js = { "Service-Worker-Allowed": "/" }
 * ```
 *
 * The device token must be generated in the browser after successful subscription:
 * @param {object|object[]} options
 * @param {string} options.key - VAPID private key
 * @param {string} options.pubkey - VAPID public key
 * @param {string} options.email - an admin email for the VAPID subject
 * @example
 * const registration = await navigator.serviceWorker.register("/js/webpush.js", { scope: "/" });
 * const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKeyPublic });
 * app.fetch('/user/update', { data: { pushkey: "webpush://" + window.btoa(JSON.stringify(subscription)) }, type: "POST" });
 * @memberOf module:push
 */

class WebPushClient {

    constructor(options) {
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

    /**
     * Send web push notification to a browser
     * @param {object} device
     * @param {object} options
     * @param {string} [options.msg] - message text
     * @param {string} [options.body] - A string representing the body text of the notification, which is displayed below the title.
     * @param {string} [options.title] - alert title
     * @param {string} [options.badge] - badge icon url
     * @param {object} [options.data] - Arbitrary data that you want associated with the notification. This can be of any structured-clonable data type.
     * @param {boolean} [options.silent] - A boolean value specifying whether the notification is silent (no sounds or vibrations issued), regardless of the device settings. The default, null, means to respect device defaults. If true, then vibrate must not be present.
     * @param {string} [options.tag] - A string representing an identifying tag for the notification. The default is the empty string.
     * @param {string} [options.icon] - A string containing the URL of an icon to be displayed in the notification.
     * @param {string} [options.image] - A string containing the URL of an image to be displayed in the notification.
     * @param {string} [options.dir] - The direction in which to display the notification. It defaults to auto, which just adopts the browser's language setting behavior, but you can override that behavior by setting values of ltr and rtl (although most browsers seem to ignore these settings.)
     * @param {string} [options.lang] - The notification's language, as specified using a string representing a BCP 47 language tag.
     * @param {string} [options.navigate] - A string containing a URL to navigate to when the user activates the notification. When set, the user agent navigates to this URL instead of firing the notificationclick event. The value is parsed relative to the base URL of the service worker. See Notification.navigate for more information.
     * @param {boolean} [options.renotify] - A boolean value specifying whether the user should be notified after a new notification replaces an old one. The default is false, which means they won't be notified. If true, then tag also must be set.
     * @param {boolean} [options.requireInteraction] - if true, indicates that a notification should remain active until the user clicks or dismisses it, rather than closing automatically.
     * @param {int[]} [options.vibrate] - A vibration pattern for the device's vibration hardware to emit with the notification. If specified, silent must not be true.
     * @param {function} [callback]
     */
    send(device, options, callback) {
        const agent = agents[device.app] || agents.default;
        if (!agent) return callback("no agents initialized");

        const to = lib.jsonParse(Buffer.from(device.token, "base64").toString());
        if (!to) return callback(lib.newError("invalid device", { device }));

        const msg = { title: options.title, body: options.msg, data: {} };
        for (const p of properties) {
            if (options[p] !== undefined) msg[p] = options[p];
        }

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

module.exports = WebPushClient;
