//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Nov 2014
//

var util = require('util');
var fs = require('fs');
var path = require('path');
var logger = require(__dirname + '/logger');
var core = require(__dirname + '/core');
var lib = require(__dirname + '/lib');

// Messaging and push notifications for mobile and other clients, supports Apple, Google and AWS/SNS push notifications.
var msg = {
    args: [ { name: "(.+)-cert@?(.+)?", obj: "config", camel: "-", descr: "A certificate for APN or similar services in pfx format, can be a file name with .p12 extension or a string with certificate contents encoded with base64, if the suffix is specified in the config parameter name will be used as the app name, otherwise it is global" },
            { name: "(.+)-key@?(.+)?", obj: "config", camel: "-", descr: "API key for GCM or similar services, if the suffix is specified in the config parameter will be used as the app name, without the suffix it is global" },
            { name: "(.+)-secret@?(.+)?", obj: "config", camel: "-", strip: "", descr: "API secret for services that require it, if the suffix is specified in the config parameter will be used as the app name, without the suffix it is global" },
            { name: "(.+)-sandbox", type: "bool", descr: "Enable sandbox for a service, default is production mode" },
            { name: "(.+)-feedback", type: "bool", descr: "Enable feedback mode for a service, default is no feedback service" },
            { name: "shutdown-timeout", type:" int", min: 0, descr: "How long to wait for messages draining out in ms on shutdown before exiting" },],
    config: {},
    shutdownTimeout: 1000,
    modules: [],
};

module.exports = msg;

// Initialize supported notification services, it supports jobs arguments convention so can be used in the jobs that
// need to send push notifications in the worker process.
msg.init = function(options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    logger.debug("msg:", "init");

    for (var i in this.modules) this.modules[i].init(options);
    if (typeof callback == "function") callback();
}

// Shutdown notification services, wait till all pending messages are sent before calling the callback
msg.shutdown = function(options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;

    // Wait a little just in case for some left over tasks
    var timeout = lib.toNumber((options && options.timeout) || this.shutdownTimeout);
    logger.debug("msg:", "shutdown", timeout);

    setTimeout(function() {
        lib.forEach(self.modules, function(client, next) {
            client.close(next);
        }, callback);
    }, timeout);
}

// Deliver a notification for the given device token(s).
// Options with the following properties:
//  - device_id - device(s) where to send the message to, can be multiple ids separated by , or |, REQUIRED
//  - service - which service to use for delivery only: sns, apn, gcm
//  - msg - text message to send
//  - badge - badge number to show if supported by the service
//  - type - set type of the message, service specific
//  - id - send id with the notification, this is application specific data, sent as is
msg.send = function(options, callback)
{
    var self = this;
    if (typeof callback != "function") callback = lib.noop;
    if (!lib.isObject(options) || !options.device_id) return callback(lib.newError("invalid device or options"));

    logger.info("send:", options.device_id, "id:", options.id, "type:", options.type, "msg:", options.msg);

    // Determine the service to use from the device token
    var devices = lib.strSplit(options.device_id, null, "string");
    lib.forEachSeries(devices, function(device, next) {
        var dev = self.parseDevice(device);
        if (!dev.id) return next();
        var client = self.getClient(dev);
        if (!client) {
            logger.error("send:", "msg", "unsupported:", dev);
            return next();
        }
        if (options.service && options.service != client.name) return next();
        logger.dev("send:", client.name, dev, options.id, options.type);
        client.send(dev, options, function(err) {
            if (err) logger.error("send:", client.name, dev, err);
            // Stop on explicit fatal errors only
            next(err && err.status >= 500 ? err : null);
        });
    }, callback);
}

// Parse device URN and returns an object with all parts into separate properties. A device URN can be in the following format:
//    [service://]device_token[@app]
//
//  - service is optional, supported types: `apn`, `gcm`, `sns`
//  - app is optional and can define an application id which is used by APN for routing to the devices with corresponding APS certificate.
msg.parseDevice = function(device)
{
    var dev = { id: "", service: "", app: "default", urn: String(device || "") };
    var d = dev.urn.match(/^([a-z]+\:\/\/)?([^@]+)?@?([a-z0-9\.\_-]+)?/);
    if (d) {
        if (d[2] && d[2] != "undefined") dev.id = d[2];
        if (d[1]) dev.service = d[1].replace("://", "");
        if (d[3]) dev.app = d[3];
    }
    return dev;
}

// Return a client module that supports the given device
msg.getClient = function(dev)
{
    if (!dev || !dev.id || !dev.urn) return null;
    for (var i in this.modules) {
        try {
            if (this.modules[i].check(dev)) return this.modules[i];
        } catch(e) {
            logger.error("getClient:", this.modules[i], e.stack);
        }
    }
    return null;
}

// Return a list of all config cert/key parameters for the given name.
// Each item in th list is an object with the following properties: key, secret, app
msg.getConfig = function(name)
{
    var rc = [];
    var rx = new RegExp("^" + name + "(Key|Cert)@?(.+)?");
    for (var p in this.config) {
        var d = p.match(rx);
        if (!d || !this.config[p] || typeof this.config[p] != "string") continue;
        var obj = { app: d[2] || "default" };
        obj.key = this.config[p];
        obj.secret = this.config[name + "Secret"] || this.config[name + "Secret@" + obj.app] || "";
        rc.push(obj);
    }
    return rc;
}

// Perform device uninstall, the next callback must be called at the end.
msg.uninstall = function(client, device, timestamp, next)
{
    logger.info("uninstall", client.name, device, timestamp);
    next();
}
