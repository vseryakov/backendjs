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
var metrics = require(__dirname + '/metrics');

// Messaging and push notifications for mobile and other clients, supports Apple, Google and AWS/SNS push notifications.
//
// Emits a signal `uninstall(client, device_id, account_id)` on device invalidation or if a device token is invalid as reported by the server, account_id
// may not be available.
//
function Msg()
{
    events.EventEmitter.call(this);
    this.args = [
             { name: "([^-]+)-(cert)(@.+)?", obj: "config", make: "$1$3|_pfx", nocamel: 1, descr: "A certificate for APN or similar services in pfx format, can be a file name with .p12 extension or a string with certificate contents encoded with base64, if the suffix is specified in the config parameter name will be used as the app name, otherwise it is global" },
             { name: "([^-]+)-(key)(@.+)?", obj: "config", make: "$1$3|_key", nocamel: 1, trim: 1, descr: "API key for GCM or similar services, if the suffix is specified in the config parameter will be used as the app name, without the suffix it is global" },
             { name: "([^-]+)-(sandbox)(@.+)?", obj: "config", make: "$1$3|_sandbox", nocamel: 1, type: "bool", descr: "Enable sandbox for a service, default is production mode" },
             { name: "([^-]+)-options-([^@]+)(@.+)?", obj: "config", make: "$1$3|$2", autotype: 1, nocamel: 1, descr: "A config property to the specified agent, driver specific" },
             { name: "shutdown-timeout", type:" int", min: 0, descr: "How long to wait for messages draining out in ms on shutdown before exiting" },
             { name: "app-default", descr: "Default app id(app bundle id) to be used when no app_id is specified" },
             { name: "app-dependency@(.+)", obj: "dependency", make: "$1", type: "list", nocamel: 1, descr: "List of other apps that are considered in the same app family, sending to the primary app will also send to all dependent apps" },
         ];
    this.config = {};
    this.dependency = {};
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

    // Sort by priority, greater the higher
    this.modules.sort(function(a,b) { return lib.toNumber(b.priority) - lib.toNumber(a.priority) });

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
// The `device` is where to send the message to, can be multiple ids separated by , or |.
//
// Options with the following properties:
//  - service_id - list of services to use for delivery only: default, sns, apn, gcm
//  - account_id - an account id associated with this token, for debugging and invalid token management
//  - app_id - send to the devices for the given app only, if none matched send to the default device tokens only
//  - msg - text message to send
//  - badge - badge number to show if supported by the service
//  - sound - set to 1 if a sound should be produced on message receive
//  - type - set type of the message, service specific
//  - category - action category for APN
//  - id - send id with the notification, this is application specific data, sent as is
//  - name - notification group name, can be used for grouping multiple messages under this name
//  - url - a launch url for the app, it show associated screen on launch if supported
Msg.prototype.send = function(device, options, callback)
{
    var self = this;
    if (!lib.isObject(options)) options = {};

    var apps = [], dflts = [], deps = [], devs = [];
    var services = lib.strSplit(options.service_id);
    if (options.app_id) {
        deps.push(options.app_id);
        var d = this.dependency[options.app_id];
        for (var i in d) deps.push(d[i]);
    }
    // Collect all device tokens per app
    lib.strSplit(device, null, "string").forEach(function(x) {
        var dev = self.parseDevice(x);
        if (!dev.id) return;
        if (dev.app == "default") dflts.push(dev);
        if (deps.indexOf(dev.app) > -1) apps.push(dev);
        devs.push(dev);
    });
    // Only send to the specific app or default
    if (options.app_id) {
        if (!apps.length) apps = dflts;
        devs = apps;
    }
    logger.debug("send:", device, options, devs);

    lib.forEach(devs, function(dev, next) {
        var client = self.getClient(dev);
        if (!client) {
            logger.error("send:", "unsupported:", dev);
            return next();
        }
        if (services.length && services.indexOf(client.name) == -1) return next();
        var timer = client.metrics.Timer('que').start();
        client.send(dev, options, function(err) {
            if (err) logger.error("send:", client.name, dev, err);
            timer.end();
            next();
        });
    }, callback);
}

// Parse device URN and returns an object with all parts into separate properties. A device URN can be in the following format:
//    [service://]device_token[@app]
//
//  - service is optional, supported types: `apn`, `gcm`, `sns`, the `default` service uses APN delivery
//  - app is optional and can define an application id which is used by APN for routing to the devices with corresponding APS certificate.
Msg.prototype.parseDevice = function(device)
{
    var dev = { id: "", service: "", app: "default", urn: String(device || "") };
    var d = dev.urn.match(/^([a-z]+\:\/\/)?([^@]+)?@?([a-z0-9\.\_-]+)?/i);
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
            if (this.getAgent(this.modules[i], dev) && this.modules[i].check(dev)) {
                this.modules[i].metrics = this.modules[i].metrics || (new metrics.Metrics());
                return this.modules[i];
            }
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

// Return an agent for the given module for the given device
Msg.prototype.getAgent = function(mod, dev)
{
    return mod.agents ? mod.agents[dev.app] || mod.agents.default : undefined;
}
