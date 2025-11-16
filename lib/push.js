/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const { EventEmitter } = require("events");
const logger = require(__dirname + '/logger');
const lib = require(__dirname + '/lib');

/**
 * Messaging and push notifications for mobile and other clients, supports Apple, Google and Webpush push notifications.
 *
 * Emits a signal `uninstall(client, device_id, user_id)` on device invalidation or if a device token is invalid as reported by the server, user_id
 * may not be available.
 * @module push
 */
class Push extends EventEmitter {

    constructor() {
        super();
        this.name = "push";

        this.args = [
            { name: "config", obj: "_config", type: "json", merge: 1, descr: 'An object with client configs, ex: `-push-config {"wp":{"type":"wp",key":XXX","pubkey":"XXXX"}}`' },
            { name: "([a-z0-9]+)", obj: "_config.$1", type: "map", merge: 1, descr: "A client parameters, ex: `-push-wp type:wp,key:K,pubkey:PK,email:XXX`" },
            { name: "shutdown-timeout", type: "int", min: 0, descr: "How long to wait for messages draining out in ms on shutdown before exiting" },
        ];

        this.shutdownTimeout = 1000;

        this.clients = {};

        this.modules = [
            require(__dirname + "/push/webpush"),
        ];

        this._config = {};
    }

    // Make sure we drain messages if a worker sent some
    shutdownWorker(options, callback) {
        this.shutdown(options, callback);
    }

    // Make sure we drain messages if a worker sent some
    shutdownWeb(options, callback) {
        this.shutdown(options, callback);
    }

    // Perform initial setup global to the module environment
    configureModule(options, callback) {
        try {
            this.modules.forEach((m) => {
                lib.call(m.configure, options);
            });
        } catch (e) {
            logger.error("configureModule:", this.name, e.stack);
        }
        callback();
    }

    /**
     * Initialize supported notification services, it supports jobs arguments convention so can be used in the jobs that
     * need to send push notifications in the worker process.
     */
    init(options, callback) {
        if (typeof options == "function") callback = options, options = null;
        logger.debug("push:", "init");

        for (const name in this._config) {
            if (!name) continue;

            // Re-create only if forced
            if (this.clients[name]) {
                if (!options?.force) continue;
                try {
                    lib.call(this.clients[name].close);
                    delete this.clients[name];
                } catch (e) {
                    logger.error("init:", this.name, name, e.stack);
                }
            }

            const opts = this._config[name];
            for (const m of this.modules) {
                try {
                    const client = m.create(opts);
                    if (!client) continue;
                    this.clients[name] = client;
                } catch (e) {
                    logger.error("init:", this.name, name, e.stack);
                }
            }
        }
        this.emit("init");
        if (typeof callback == "function") callback();
    }

    // Shutdown notification services, wait till all pending messages are sent before calling the callback
    shutdown(options, callback) {
        if (typeof options == "function") callback = options, options = null;

        this.emit("shutdown");

        setTimeout(() => {
            logger.debug("push:", "shutdown");

            for (const name in this.clients) {
                this.clients[name].close();
                delete this.clients[name];
            }
            if (typeof callback == "function") callback();
        }, this.shutdownTimeout);
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
    * @callback callback
    */
    send(device, options, callback) {
        // Collect all device tokens per app
        var devs = lib.strSplit(device, null, "string").filter((x) => {
            var dev = this.parseDevice(x);
            if (!dev.id) return 0;
            if (options?.app_id && dev.app != options.app_id) return 0;
            return dev;
        });
        logger.debug("send:", device, options, devs);

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
    */
    parseDevice(device) {
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

