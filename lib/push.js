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

        /** @var {object} - push live clients by type */
        this.clients = {};

        this._config = {};
    }

    /**
     * Perform initial setup by calling static configure method for each module
     * @param {object|object[]} options - whole config object for the type
     * @memberof module:push
     * @method configureModule
     */
    configureModule(options, callback)
    {
        for (const type in this._config) {
            let Mod = this.modules[type];
            if (!Mod) {
                Mod = this.modules[type] = require(__dirname + "/push/" + type);
            }
            if (!Mod) continue;
            lib.call(Mod.configure, this._config[type]);
        }
        callback();
    }

    /**
     * Initialize supported notification services, it supports jobs arguments convention so can be used in the jobs that
     * need to send push notifications in the worker process. Can be called muny times, only new modules will be initialized.
     * @param {object} options
     * @param {function} [callback]
     * @memberof module:push
     * @method init
     */
    init(options, callback)
    {
        if (typeof options == "function") callback = options, options = null;
        logger.debug("init:", this.name);

        for (const type in this._config) {
            if (!type || this.clients[type]) continue;

            const Mod = this.modules[type];
            if (!Mod) continue;

            this.clients[type] = new Mod(this._config[type]);
        }
        this.emit("init");
        if (typeof callback == "function") callback();
    }

    /**
     * Shutdown notification services, may wait till all pending messages are sent before calling the callback
     * @param {object} options
     * @param {function} [callback]
     * @memberof module:push
     * @method shutdown
     */
    shutdown(options, callback)
    {
        this.emit("shutdown");
        logger.debug("shutdown:", this.name);

        lib.forEach(Object.keys(this.clients), (type, next) => {
            const client = this.clients[type];
            delete this.clients[type];
            lib.call(client.close, next);
        }, callback);
    }

    /**
    * Deliver a notification for the given device token(s).
    *
    * @param {string} device - where to send the message to, can be multiple ids separated by , or |.
    * @param {object} options
    * @param {string} options.user_id - an user id associated with this token, for debugging and invalid token management
    * @param {string} options.app_id - send to the devices for the given app only
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
            if (!dev.token) return 0;
            if (options?.app_id && dev.app != options.app_id) return 0;
            return dev;
        });
        logger.debug("send:", this.name, device, options, devs);

        lib.forEach(devs, (dev, next) => {
            var client = this.clients[dev.type];
            if (!client) {
                logger.error("send:", "unsupported:", dev);
                return next();
            }
            client.send(dev, options, (err) => {
                if (err) logger.error("send:", dev, err);
                next();
            });
        }, callback);
    }

    /**
    * Parse device URN and returns an object with all parts into separate properties. A device URN can be in the following format:
    * @param {string} device - [type://]token[@app]
    *  - type - apn, fcm, webpush, sns, ...
    *  - token - device token
    *  - app - optional application name or bundle
    * @memberof module:push
    * @method parseDevice
    */
    parseDevice(device)
    {
        var dev = { token: "", type: "", app: "" };
        if (typeof device != "string") return dev;
        var d = device.match(/^([a-z]+:\/\/)([^@]+)?@?([a-z0-9._-]+)?/i);
        if (d) {
            if (d[2] && d[2] != "undefined") dev.token = d[2];
            if (d[1]) dev.type = d[1].slice(0, -3);
            if (d[3]) dev.app = d[3];
        }
        return dev;
    }

}

module.exports = new Push();

