/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const { EventEmitter } = require("events");
const logger = require(__dirname + '/logger');
const lib = require(__dirname + '/lib');

/**
 * Messaging and push notifications for mobile and other clients, supports Webpush push notifications.
 *
 * Emits a signal **uninstall(client, device_id, user_id)** on device invalidation or if a device token is invalid as
 * reported by the server, user_id may not be available.
 * @module push
 */
class Push extends EventEmitter {

    constructor() {
        super();
        this.name = "push";

        this.args = [
            { name: "config", obj: "_config", type: "json", merge: 1, descr: "An object with client configs by type", example: '-push-config {"webpush":{"type":"webpush",key":XXX","pubkey":"XXXX"}}' },
            { name: "([a-z0-9]+)", obj: "_config.$1", type: "map", merge: 1, descr: "A single client type parameters", example: "-push-webpush type:webpush,key:K,pubkey:PK,email:XXX" },
        ];

        /** @var {object} - push modules by type */
        this.modules = {};

        /** @var {object} - push live clients by name */
        this.clients = {};

        this._config = {};
    }

    /**
     * Perform initial setup by calling static configure method for each module
     * @memberof module:push
     * @method configureModule
     */
    configureModule(options, callback)
    {
        for (const name in this._config) {
            let Mod = this.modules[name];
            if (!Mod) {
                Mod = this.modules[name] = require(__dirname + "/push/" + name);
            }
            if (!Mod) continue;
            lib.call(Mod.configure, options);
        }
        callback();
    }

    /**
     * Initialize supported notification services, it supports jobs arguments convention so can be used in the jobs that
     * need to send push notifications in the worker process.
     * @memberof module:push
     * @method init
     */
    init(options, callback)
    {
        if (typeof options == "function") callback = options, options = null;
        logger.debug("push:", "init");

        for (const name in this._config) {
            if (!name) continue;

            const Mod = this.modules[name];
            if (!Mod) continue;

            this.clients[name] = new Mod(this._config[name]);
        }
        this.emit("init");
        if (typeof callback == "function") callback();
    }

    /**
     * Shutdown notification services, may wait till all pending messages are sent before calling the callback
     * @memberof module:push
     * @method shutdown
     */
    shutdown(options, callback)
    {
        this.emit("shutdown");
        logger.debug("shutdown:", this.name);

        lib.forEach(Object.keys(this.clients), (name, next) => {
            const client = this.clients[name];
            delete this.clients[name];
            client.close(next);
        }, callback);
    }

    /**
    * Deliver a notification for the given device token(s).
    *
    * @param {string} device - where to send the message to, can be multiple ids separated by , or |.
    * @param {object} options
    * @param {string} options.user_id - an user id associated with this token, for debugging and invalid token management
    * @param {string} options.app_id - send to the devices for the given app only, if none matched send to the default device tokens only
    * @param {string} options.msg - text message to send
    * @param {int} options.badge - badge number to show if supported by the service
    * @param {boolean} options.sound - set to true if a sound should be produced on message receive
    * @param {string} options.type - set type of the message, service specific
    * @param {string} options.category - action category for APN
    * @param {string} options.id - send id with the notification, this is application specific data, sent as is
    * @param {string} options.name - notification group name, can be used for grouping multiple messages under this name
    * @param {string} options.url - a launch url for the app, it show associated screen on launch if supported
    * @param {function} callback
    * @memberof module:push
    * @method send
    */
    send(device, options, callback)
    {
        // Collect all device tokens per app
        var devs = lib.strSplit(device, null, "string").filter((x) => {
            var dev = this.parseDevice(x);
            if (!dev.id) return 0;
            if (options?.app_id && dev.app != options.app_id) return 0;
            return dev;
        });
        logger.debug("send:", this.name, device, options, devs);

        lib.forEach(devs, (dev, next) => {
            var clients = Object.keys(this.clients).filter((name) => {
                var client = this.clients[name];
                if (client.type != dev.type) return 0;
                if (client.app && client.app != dev.app) return 0;
                return client;
            });

            if (!clients.length) {
                logger.error("send:", "unsupported:", dev);
                return next();
            }

            lib.forEach(clients, (client, next2) => {
                client.send(dev, options, (err) => {
                    if (err) logger.error("send:", client.name, dev, err);
                    next2();
                });
            }, next, true);

        }, callback);
    }

    /**
    * Parse device URN and returns an object with all parts into separate properties. A device URN can be in the following format:
    * @param {string} device - [type://]device_token[@app]
    *  - type - `apn`, `fcm`, `wp`, ...
    *  - id - device token
    *  - app - optional application name or bundle
    * @memberof module:push
    * @method parseDevice
    */
    parseDevice(device)
    {
        var dev = { id: "", type: "", app: "" };
        if (typeof device != "string") return dev;
        var d = device.match(/^([a-z]+:\/\/)([^@]+)?@?([a-z0-9._-]+)?/i);
        if (d) {
            if (d[2] && d[2] != "undefined") dev.id = d[2];
            if (d[1]) dev.type = d[1].slice(0, -3);
            if (d[3]) dev.app = d[3];
        }
        return dev;
    }

}

module.exports = new Push();

