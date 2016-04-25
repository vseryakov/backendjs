//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Nov 2014
//

var util = require('util');
var fs = require('fs');
var path = require('path');
var events = require("events");
var logger = require(__dirname + '/logger');
var core = require(__dirname + '/core');
var lib = require(__dirname + '/lib');

// Messaging and push notifications for mobile and other clients, supports Apple, Google and AWS/SNS push notifications.
//
// Emits a signal `uninstall(client, device_id, timestamp[, account_id])` on device invalidation or if a device token is invalid as reported by the server, account_id
// may not be available.
//
function Msg()
{
    events.EventEmitter.call(this);

    this.args = [
             { name: "([^-]+)-(cert)(@.+)?", obj: "config", make: "$1$3|_pfx", nocamel: 1, descr: "A certificate for APN or similar services in pfx format, can be a file name with .p12 extension or a string with certificate contents encoded with base64, if the suffix is specified in the config parameter name will be used as the app name, otherwise it is global" },
             { name: "([^-]+)-(key)(@.+)?", obj: "config", make: "$1$3|_key", nocamel: 1, descr: "API key for GCM or similar services, if the suffix is specified in the config parameter will be used as the app name, without the suffix it is global" },
             { name: "([^-]+)-(sandbox)(@.+)?", obj: "config", make: "$1$3|_sandbox", nocamel: 1, type: "bool", descr: "Enable sandbox for a service, default is production mode" },
             { name: "([^-]+)-(feedback)(@.+)?", obj: "config", make: "$1$3|_feedback", nocamel: 1, type: "bool", descr: "Enable feedback mode for a service, default is no feedback service" },
             { name: "([^-]+)-options-([^@]+)(@.+)?", obj: "config", make: "$1$3|$2", autotype: 1, nocamel: 1, descr: "A config property to the specified agent, driver specific" },
             { name: "shutdown-timeout", type:" int", min: 0, descr: "How long to wait for messages draining out in ms on shutdown before exiting" },
         ];
    this.config = {};
    this.shutdownTimeout = 1000;
    this.modules = [];
}
util.inherits(Msg, events.EventEmitter);

module.exports = new Msg();

// Initialize supported notification services, it supports jobs arguments convention so can be used in the jobs that
// need to send push notifications in the worker process.
Msg.prototype.init = function(options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    logger.debug("msg:", "init");

    for (var i in this.modules) {
        try {
            this.modules[i].init(options);
        } catch(e) {
            logger.error("msg:", core.role, this.modules[i].name, options, e.stack);
        }
    }
    this.emit("init");
    if (typeof callback == "function") callback();
}

// Shutdown notification services, wait till all pending messages are sent before calling the callback
Msg.prototype.shutdown = function(options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;

    this.emit("shutdown");

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
//
// Options with the following properties:
//  - device_id - device(s) where to send the message to, can be multiple ids separated by , or |, REQUIRED
//  - service_id - which service to use for delivery only: sns, apn, gcm
//  - account_id - an account id associated wit this token, for debugging and invalid token management
//  - app_id - send to the devices for the given app only, if none matched send to the default device tokens only
//  - msg - text message to send
//  - badge - badge number to show if supported by the service
//  - sound - set to 1 if a sound should be produced on message receive
//  - type - set type of the message, service specific
//  - id - send id with the notification, this is application specific data, sent as is
//  - name - notification group name, can be used for grouping multiple messages under this name
//  - url - a launch url for the app, it show associated screen on launch if supported
Msg.prototype.send = function(options, callback)
{
    var self = this;
    if (!lib.isObject(options)) options = {};

    logger.debug("send:", options);

    var apps = [], dflts = [], devs = [];
    // Collect all device tokens per app
    lib.strSplit(options.device_id, null, "string").forEach(function(x) {
        var dev = self.parseDevice(x);
        if (!dev.id) return;
        if (dev.app == "default") dflts.push(dev);
        if (options.app_id && options.app_id == dev.app) apps.push(dev);
        devs.push(dev);
    });
    // Only send to the specific app or default
    if (options.app_id) {
        if (!apps.length) apps = dflts;
        devs = apps;
    }
    lib.forEach(devs, function(dev, next) {
        var client = self.getClient(dev);
        if (!client) {
            logger.error("send:", "unsupported:", dev);
            return next();
        }
        if (options.service_id && options.service_id != client.name) return next();
        client.send(dev, options, function(err) {
            if (err) logger.error("send:", client.name, dev, err);
            next();
        });
    }, callback);
}

// Parse device URN and returns an object with all parts into separate properties. A device URN can be in the following format:
//    [service://]device_token[@app]
//
//  - service is optional, supported types: `apn`, `gcm`, `sns`
//  - app is optional and can define an application id which is used by APN for routing to the devices with corresponding APS certificate.
Msg.prototype.parseDevice = function(device)
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
Msg.prototype.getClient = function(dev)
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
// Each item in the list is an object with the following properties: key, secret, app
Msg.prototype.getConfig = function(name)
{
    var rc = [], apps = {};
    for (var p in this.config) {
        var d = p.match(/^([^@\|]+)(@[^\|]+)?\|(.+)/);
        if (!d || d[1] != name || typeof this.config[p] == "undefined") continue;
        var app = d[2] ? d[2].substr(1) : "default";
        if (!apps[app]) apps[app] = { _app : app };
        apps[app][d[3]] = this.config[p];
    }
    for (var p in apps) rc.push(apps[p]);
    return rc;
}
