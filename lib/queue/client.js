//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const url = require('url');
const { EventEmitter } = require("events");
const logger = require(__dirname + '/../logger');
const lib = require(__dirname + '/../lib');
const metrics = require(__dirname + '/../metrics');

// Base class for the queue clients, implements queue protocol in the same class,
// not supported methods just do nothing without raising any errors

class Client extends EventEmitter {

    constructor(options) {
        super();
        this.setMaxListeners(0);
        this.queueName = "";
        this.url = String(options?.url || "");
        this.options = {};
        this._polling = {};
        this.metrics = new metrics.Timer();
        this.applyOptions(options);
        this.on("ready", () => { this.ready = true });
        this.on("pause", () => { this.paused = true });
        this.on("unpause", () => { this.paused = false });
        logger.debug("client:", this.url, this.options);
    }

    // Close current connection, ports.... not valid after this call
    close() {
        this.url = "";
        this.options = {};
        this._polling = {};
        this.metrics.end();
        this.removeAllListeners();
    }

    // Prepare options to be used safely, parse the reserved params from the url
    applyOptions(options) {
        for (const p in options) {
            if (p[0] != "_" && p != "url") this.options[p] = options[p];
        }
        const h = url.parse(this.url, true);
        this.port = h.port || 0;
        this.protocol = h.protocol;
        this.hostname = h.hostname || "";
        this.pathname = h.pathname || "";
        for (const p in h.query) {
            var d = p.match(/^bk-(.+)/);
            if (!d) continue;
            this.options[d[1]] = lib.isNumeric(h.query[p]) ? lib.toNumber(h.query[p]) : h.query[p];
            delete h.query[p];
        }
        h.search = null;
        h.path = null;
        this.url = url.format(h);
    }

    // Handle reserved options
    applyReservedOptions(options) {
        for (const p of ["paused"]) {
            if (typeof options[p] != "undefined") this[p] = options[p];
        }
    }

    // Return a subscription channel from the given name or options, the same client can support multiple subscriptions, additional
    // subscriptions are specified by appending `#channel` to the `options.queueName`, default is to use the primary queue name.
    // Consumer name if present is stripped off.
    channel(options) {
        var name = typeof options == "string" ? options : options?.queueName || this.options?.queueName;
        if (typeof name == "string") {
            var h = name.indexOf("#");
            if (h > -1) {
                var e = name.indexOf("@", h);
                return name.slice(h + 1, e > -1 ? e : name.length);
            }
            h = name.indexOf("@");
            if (h > -1) return name.substr(0, h);
        }
        return this.queueName;
    }

    // Returns the consumer name for the given queue or empty if not specified, `groupName` will be used as the consumer name if present
    consumer(options) {
        var name = typeof options == "string" ? options : options?.queueName || this.options?.queueName;
        if (typeof name == "string") {
            var h = name.indexOf("@");
            if (h > -1) return name.substr(h + 1);
        }
        return options?.groupName || "";
    }

    // Return canonical queue name, default channel is not appended, default consumer is not appened
    canonical(options) {
        var chan = this.channel(options);
        var consumer = this.consumer(options);
        var name = this.queueName;
        if (chan && chan != this.queueName) name += "#" + chan;
        if (consumer && consumer != this.queueName) name += "@" + consumer;
        return name;
    }

    // Returns the cache statistics to the callback as the forst argument, the object tructure is specific to each implementstion
    stats(options, callback) {
        lib.tryCall(callback);
    }

    // EVENT MANAGEMENT

    // Subscribe to receive notification from the given channel
    subscribe(channel, options, callback) {
        this.addListener(channel, callback);
    }

    // Stop receiving notifications on the given channel
    unsubscribe(channel, options, callback) {
        if (typeof callback == "function") {
            this.removeListener(channel, callback);
        } else {
            this.removeAllListeners(channel);
        }
    }

    // Publish an event
    publish(channel, msg, options, callback) {
        lib.tryCall(callback);
    }

    // JOB MANAGEMENT

    // Listen for incoming messages
    listen(options, callback) {
        var sub = this.canonical(options);
        this.applyReservedOptions(options);
        this.addListener(sub, callback);
        if (!this._polling[sub]) {
            this._polling[sub] = 1;
            this.schedule(options);
        }
    }

    // Stop listening for messages
    unlisten(options, callback) {
        var sub = this.canonical(options);
        if (typeof callback == "function") {
            this.removeListener(sub, callback);
        } else {
            this.removeAllListeners(sub);
        }
        if (this._polling[sub] && !this.listenerCount(sub)) {
            delete this._polling[sub];
        }
    }

    // Submit a job to a queue
    submit(msg, options, callback) {
        lib.call(callback);
    }

    // Drop a job in case of abnormal shutdown or exceeded run time
    drop(options, callback) {
        lib.tryCall(callback);
    }

    // INTERNAL QUEUE MANAGENENT

    // This method must take care how to keep the poller running via interval or timeout as long as the `this._pollingQueue=1`.
    poll(options) {}

    // Schedule next poller iteration immediately or after timeout, check configured polling rate, make sure it polls no more than
    // configured number of times per second. If not ready then keep polling until the ready signal is sent.
    // Two events can be used for back pressure support: `pause` and `unpause` to stop/restart queue processing
    schedule(options, timeout) {
        var sub = this.canonical(options);
        if (!this._polling[sub]) return;
        if (!this.ready || this.paused) {
            return setTimeout(this.schedule.bind(this, options), timeout || this.interval || 500);
        }
        if (this.options.pollingRate > 0) {
            if (!this._tokenBucket || !this._tokenBucket.equal(this.options.pollingRate)) {
                this._tokenBucket = new metrics.TokenBucket(this.options.pollingRate);
            }
            if (!this._tokenBucket.consume(1)) {
                timeout = Math.max(timeout || 0, this._tokenBucket.delay(1));
            }
        }
        if (timeout > 0) {
            setTimeout(this.poll.bind(this, options), timeout);
        } else {
            setImmediate(this.poll.bind(this, options));
        }
    }

    // Queue monitor or cleanup service, when poller is involved this will be started and can be used for cleaning up stale messages or other
    // maintainence work the requires.
    monitor() {}

}

module.exports = Client;
