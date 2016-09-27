//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Nov 2014
//

var logger = require(__dirname + '/logger');
var core = require(__dirname + '/core');
var lib = require(__dirname + '/lib');
var aws = require(__dirname + '/aws');
var msg = require(__dirname + '/msg');

var client = {
    name: "sns",
};
module.exports = client;

msg.modules.push(client);

client.check = function(dev)
{
    return dev.urn.match(/^arn:aws:sns:/);
}

client.init = function(options)
{
}

client.close = function(callback)
{
    callback();
}

// Send push notification to a device using AWS SNS service, device_id must be a valid SNS endpoint ARN.
//
// The options may contain the following properties:
//  - msg - message text
//  - badge - badge number
//  - type - set type of the packet
//  - id - send id in the user properties
client.send = function(dev, options, callback)
{
    if (!dev.id) return lib.tryCall(callback, lib.newError("invalid device:" + dev));

    var pkt = {};
    // Format according to the rules per platform
    if (dev.id.match("/APNS/")) {
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
        if (options.account_id) pkt.account_id = options.account_id;
        pkt = { APNS: lib.stringify(pkt) };
    } else
    if (dev.id.match("/GCM/")) {
        pkt = { data: {}, notification: {} };
        if (options.name) pkt.collapse_key = options.name;
        if (options.ttl) pkt.time_to_live = lib.toNumber(options.ttl);
        if (options.delay) pkt.delay_while_idle = lib.toBool(options.delay);

        if (options.id) pkt.data.url = String(options.url);
        if (options.url) pkt.data.url = String(options.url);
        if (options.type) pkt.data.type = String(options.type);
        if (options.account_id) pkt.data.account_id = String(options.account_id);

        if (options.msg) pkt.data.msg = options.msg;
        if (options.badge) pkt.data.badge = lib.toBool(options.badge);
        if (options.sound) pkt.data.sound = lib.toBool(options.sound);
        if (options.vibrate) pkt.data.vibrate = lib.toBool(options.vibrate);
        pkt = { GCM: lib.stringify(pkt) };
    }
    aws.snsPublish(dev.id, pkt, callback);
    return true;
}
