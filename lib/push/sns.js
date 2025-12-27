//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const lib = require(__dirname + '/../lib');
const modules = require(__dirname + '/../modules');

/**
 * The device token must be a valid SNS subscription arn
 * @memberOf module:push
 */

class SNSClient {

    send(device, options, callback)
    {
        var pkt = {};
        // Format according to the rules per platform
        if (device.token.match("/APNS/")) {
            pkt = { aps: { alert: {} } };
            if (options.category) pkt.aps.category = options.category;
            if (options.contentAvailable) pkt.aps["content-available"] = 1;
            if (options.badge) pkt.aps.badge = lib.toNumber(options.badge);
            if (options.sound) pkt.aps.sound = typeof options.sound == "string" ? options.sound : "default";

            if (options.msg) pkt.aps.alert.body = options.msg;
            if (options.title) pkt.aps.alert.title = options.title;
            if (options.launchImage) pkt.aps.alert["launch-image"] = options.launchImage;
            if (options.locKey) pkt.aps.alert["loc-key"] = options.locKey;
            if (options.locArgs) pkt.aps.alert["loc-args"] = options.locArgs;
            if (options.titleLocKey) pkt.aps.alert["title-loc-key"] = options.titleLocKey;
            if (options.titleLocArgs) pkt.aps.alert["title-loc-args"] = options.titleLocArgs;
            if (options.actionLocKey) pkt.aps.alert["action-loc-args"] = options.actionLocKey;
            if (options.alertAction) pkt.aps.alert.action = options.alertAction;
            if (Object.keys(pkt.aps.alert).length == 1 && options.msg) pkt.aps.alert = options.msg;

            if (options.id) pkt.id = options.id;
            if (options.type) pkt.type = options.type;
            if (options.url) pkt.url = options.url;
            if (options.user_id) pkt.user_id = options.user_id;
            pkt = { APNS: lib.stringify(pkt) };
        } else

        if (device.token.match("/GCM/")) {
            pkt = { data: {}, notification: {} };
            if (options.name) pkt.collapse_key = options.name;
            if (options.ttl) pkt.time_to_live = lib.toNumber(options.ttl);
            if (options.delay) pkt.delay_while_idle = lib.toBool(options.delay);

            if (options.id) pkt.data.url = String(options.url);
            if (options.url) pkt.data.url = String(options.url);
            if (options.type) pkt.data.type = String(options.type);
            if (options.user_id) pkt.data.user_id = options.user_id;

            if (options.msg) pkt.data.msg = options.msg;
            if (options.badge) pkt.data.badge = lib.toBool(options.badge);
            if (options.sound) pkt.data.sound = lib.toBool(options.sound);
            if (options.vibrate) pkt.data.vibrate = lib.toBool(options.vibrate);
            pkt = { GCM: lib.stringify(pkt) };
        }
        modules.aws.snsPublish(device.token, pkt, callback);
    }
}

module.exports = SNSClient;
