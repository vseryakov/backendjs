//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

var logger = require(__dirname + '/../lib/logger');
var lib = require(__dirname + '/../lib/lib');
var api = require(__dirname + '/../lib/api');
var Msg = require(__dirname + '/../lib/msg');

const client = {
    name: "webpush",
    priority: 10,
    agents: {},
};
module.exports = client;

Msg.modules.push(client);

client.check = function(dev)
{
    return dev.service == "wp";
}

client.preinit = function(options)
{
    api.registerAccessCheck('', '/js/webpush.js', function(req, cb) {
        req.res.header("Service-Worker-Allowed", "/");
        cb();
    });
}

client.init = function(options)
{
    var config = Msg.getConfig(this.name);
    for (var i in config) {
        if (this.agents[config[i]._app]) continue;
        if (!this.webpush) this.webpush = require("web-push");
        this.agents[config[i]._app] = lib.objClone(config[i], "_sent", 0, "_queue", 0);
        logger.info("init:", client.name, config[i]);
    }
}

client.close = function(callback)
{
    for (const p in this.agents) {
        var agent = this.agents[p];
        delete this.agents[p];
        logger.info('close:', client.name, p, 'queue:', agent._queue, 'sent:', agent._sent);
    }
    lib.tryCall(callback);
}

// Send a Web push notification using the `web-push` npm module, referer to it for details how to generate VAPID credentials to
// configure this module with 3 required parameters:
//
//  - `msg-webpush-key` - VAPID private key
//  - `msg-webpush-pubkey` - VAPID public key
//  - `msg-webpush-options-email` - an admin email for the VAPID subject
//
// The device token must be generated in the browser after successful subscription:
//
//          navigator.serviceWorker.register("/js/webpush.js", { scope: "/" }).then(function(registration) {
//              registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKeyPublic }).then(function(subscription) {
//                  bkjs.send({ url: '/uc/account/update', data: { device_id: "wp://" + window.btoa(JSON.stringify(subscription)) }, type: "POST" });
//              }).catch((err) => {})
//          });
//
client.send = function(dev, options, callback)
{
    if (!dev || !dev.id) return lib.tryCall(callback, lib.newError("invalid device:" + dev.id));

    var agent = this.agents[dev.app] || this.agents.default;
    if (!agent) return lib.tryCall(callback, lib.newError("Webpush is not initialized for " + dev.id, 415));

    var to = lib.jsonParse(Buffer.from(dev.id, "base64").toString());
    if (!to) return lib.tryCall(callback, lib.newError("invalid device id:" + dev.id));

    var msg = { title: options.title, body: options.msg, data: {} };
    for (const p of ["actions", "badge", "body", "dir", "icon", "image", "lang", "renotify", "requireInteraction", "silent", "tag", "timestamp", "vibrate"]) {
        if (typeof options[p] != "undefined") msg[p] = options[p];
    }

    if (options.id) msg.data.id = String(options.id);
    if (options.url) msg.data.url = String(options.url);
    if (options.type) msg.data.type = String(options.type);
    if (options.account_id) msg.data.account_id = options.account_id;
    for (const p in options.payload) msg.data[p] = options.payload[p];

    const opts = {
        vapidDetails: {
            subject: `mailto:${agent.email}`,
            publicKey: agent._pubkey,
            privateKey: agent._key,
        }
    }
    agent._queue++;
    this.webpush.sendNotification(to, lib.stringify(msg), opts).
        then(() => {
            agent._queue--;
            logger.debug("send:", client.name, dev, msg);
            lib.tryCall(callback);
        }).
        catch((err) => {
            agent._queue--;
            logger.error("send:", client.name, err, dev, msg);
            lib.tryCall(callback, err);
        });
    return true;
}
