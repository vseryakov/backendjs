//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const logger = require(__dirname + '/../logger');
const lib = require(__dirname + '/../lib');
const modules = require(__dirname + '/../modules');

var agents = {};


/**
 * Send push notification using FCM credentials, calls FCM api directly
 * @param {object|object[]} options
 * @param {string} options.key - FCM access key
 * @memberOf module:push
 */

class FCMClient {

    constructor(options)
    {
        if (!Array.isArray(options)) options = [options];
        for (const agent of options) {
            if (!agent.key) continue;
            agents[agent.app || "default"] = {
                key: agent.key,
                app: agent.app,
                queue: 0,
                sent: 0,
            };
        }
    }

    close(callback)
    {
        lib.forEach(Object.keys(agents), (key, next) => {
            var agent = agents[key];
            delete agents[key];
            logger.info('close:', "fcm", key, agent.app, 'queue:', agent.queue, 'sent:', agent.sent);

            var n = 0;
            function check() {
                if (!agent.queue || ++n > 600) return next();
                setTimeout(check, 50);
            }
            check();
        }, callback);
    }

    // Send push notification to an Android device, return true if queued.
    send(device, options, callback)
    {
        var agent = agents[device.app] || agents.default;
        if (!agent) return callback("no agents initialized");

        var msg = { data: {}, notification: {}, priority: options.priority || "high" };
        msg[device.token.indexOf(",") > -1 ? "registration_ids" : "to"] = device.token;
        if (options.name) msg.collapse_key = options.name;
        if (options.ttl) msg.time_to_live = lib.toNumber(options.ttl);
        if (options.delay) msg.delay_while_idle = lib.toBool(options.delay);

        if (options.title) msg.notification.title = String(options.title);
        if (options.msg) msg.notification.body = String(options.msg);
        if (options.sound) msg.notification.sound = typeof options.sound == "string" ? options.sound : "default";
        if (/^[a-zA-Z0-9_]+$/.test(options.icon)) msg.notification.icon = String(options.icon);
        if (options.tag) msg.notification.tag = String(options.tag);
        if (options.color) msg.notification.color = String(options.color);
        if (options.clickAction) msg.notification.click_action = String(options.clickAction);
        if (options.titleLocKey) msg.notification.title_loc_key = String(options.titleLocKey);
        if (options.titleLocArgs) msg.notification.title_loc_args = String(options.titleLocArgs);
        if (options.bodyLocKey) msg.notification.body_loc_key = String(options.bodyLocKey);
        if (options.bodyLocArgs) msg.notification.body_loc_args = String(options.bodyLocArgs);

        if (options.id) msg.data.id = String(options.id);
        if (options.url) msg.data.url = String(options.url);
        if (options.type) msg.data.type = String(options.type);
        if (options.badge) msg.data.badge = lib.toBool(options.badge);
        if (options.sound) msg.data.sound = lib.toBool(options.sound);
        if (options.vibrate) msg.data.vibrate = lib.toBool(options.vibrate);
        if (options.user_id) msg.data.user_id = options.user_id;
        for (const p in options.payload) msg.data[p] = options.payload[p];

        var opts = {
            method: 'POST',
            headers: { 'Authorization': 'key=' + agent.key },
            postdata: msg,
            retryCount: agent.retryCount || this.retryCount || 3,
            retryTimeout: agent.retryTimeout || this.retryTimeout || 1000,
            retryOnError: retryOnError,
        };
        agent.queue++;

        lib.fetch('https://fcm.googleapis.com/fcm/send', opts, (err, rc) => {
            if (!err && rc.status >= 400) {
                err = lib.newError(rc.status + ": " + rc.data, rc.status);
            }
            logger[err ? "error" : "debug"]("send:", "fcm", device, msg, err);
            if (rc.obj) {
                for (const i in rc.obj.results) {
                    if (rc.obj.results[i].error == "NotRegistered") {
                        modules.push.emit("uninstall", rc.obj.results[i].registration_id, options.user_id);
                    }
                }
            }
            agent.queue--;
            agent.sent++;
            callback(err);
        });
    }

}

module.exports = FCMClient;

// Retry on server error, honor Retry-After header if present, use it only on the first error
function retryOnError()
{
    if (this.status < 500) return 0;
    if (!this.retryAfter) {
        this.retryAfter = lib.toNumber(this.headers['retry-after']) * 1000;
        if (this.retryAfter > 0 && this.retryCount > 0) this.retryTimeout = this.retryAfter/2;
    }
    return 1;
}
