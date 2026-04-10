/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const { EventEmitter } = require("events");
const logger = require(__dirname + '/../logger');
const lib = require(__dirname + '/../lib');
const metrics = require(__dirname + '/../metrics');

/**
 * Base class for the queue clients, implements queue protocol in the same class,
 * not supported methods just do nothing without raising any errors
 * @param {object} options
 * @memberOf module:queue
 */

class QueueClient extends EventEmitter {
    name = "queue client"
    queueName = ""
    options = {}
    _polling = {}

    constructor(options) {
        super();
        this.setMaxListeners(0);
        this.url = String(options?.url || "");
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
        const h = URL.parse(this.url);
        if (!h) return;
        this.port = h.port || 0;
        this.protocol = h.protocol;
        this.hostname = h.hostname || "";
        this.pathname = h.pathname || "";
        for (const [key, val] of h.searchParams) {
            if (!key.startsWith("bk-")) continue;
            this.options[key.substr(3)] = lib.isNumeric(val) ? lib.toNumber(val) : val;
            h.searchParams.delete(key);
        }
        this.url = h.toString();

        this.options.queueCount = lib.toNumber(this.options.queueCount, { min: 1 });
        this.options.pollInterval = lib.toNumber(this.options.pollInterval, { dflt: 1000, min: 0 });
        this.options.visibilityTimeout = lib.toNumber(this.options.visibilityTimeout, { min: 0, dflt: 30000 });
        this.options.maxVisibilityTimeout = lib.toNumber(this.options.maxVisibilityTimeout, { dflt: 3600000*6, min: 60000 });
    }

    // Handle reserved options
    applyReservedOptions(options) {
        for (const p of ["paused"]) {
            if (typeof options[p] != "undefined") this[p] = options[p];
        }
    }

    /**
     * Return a subscription channel from the given name or options, the same client can support multiple subscriptions, additional
     * subscriptions are specified by appending `#channel` to the `options.queueName`, default is to use the primary queue name.
     * Group name if present is stripped off.
     */
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

    // Returns the group name for the given queue or empty if not specified, `groupName` will be used if present
    group(options) {
        var name = typeof options == "string" ? options : options?.queueName || this.options?.queueName;
        if (typeof name == "string") {
            var h = name.indexOf("@");
            if (h > -1) return name.substr(h + 1);
        }
        return options?.groupName || "";
    }

    // Return canonical queue name, default channel is not appended, default group is not appened
    canonical(options) {
        var chan = this.channel(options);
        var group = this.group(options);
        var name = this.queueName;
        if (chan && chan != this.queueName) name += "#" + chan;
        if (group && group != this.queueName) name += "@" + group;
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

    /**
     * Listen for incoming messages
     */
    listen(options, callback) {
        var sub = this.canonical(options);
        this.applyReservedOptions(options);
        this.addListener(sub, callback);
        if (!this._polling[sub]) {
            this._polling[sub] = Date.now();
            this.schedule(options);
        }
    }

    /**
     * Stop listening for messages
     */
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

    /**
     * Submit a job to a queue
     */
    submit(msg, options, callback) {
        lib.call(callback);
    }

    /**
     * Purge all messages from the queue
     */
    purge(options, callback) {
        lib.tryCall(callback);
    }

    // INTERNAL QUEUE MANAGENENT

    /**
     * This method must take care how to retrieve messages during a single poll cycle, this is called by the `schedule` method
     * automatically in the listen. The typical implementation when using default SQS like logic is just to use {@link this._poll_run}
     * @example
     * poll(options) {
     *     this._poll_run(options);
     * }
     */
    poll(options) {}

    /**
     * Schedule next poller iteration immediately or after timeout, check configured polling rate, make sure it polls no more than
     * configured number of times per second. If not ready then keep polling until the ready signal is sent.
     * Two events can be used for back pressure support: `pause` and `unpause` to stop/restart queue processing
     */
    schedule(options, timeout) {
        var sub = this.canonical(options);
        if (!this.url || !this._polling[sub]) return;
        if (!this.ready || this.paused) {
            return setTimeout(this.schedule.bind(this, options), timeout || this.pollInterval || 500);
        }
        if (this.options.pollingRate > 0) {
            if (!this._tokenBucket || !this._tokenBucket.equal(this.options.pollingRate)) {
                this._tokenBucket = new metrics.TokenBucket(this.options.pollingRate);
            }
            if (!this._tokenBucket.consume(1)) {
                timeout = Math.max(timeout || 0, this._tokenBucket.delay(1));
            }
        }
        logger.debug("schedule:", this.queueName, this.name, timeout);
        if (timeout > 0) {
            setTimeout(this.poll.bind(this, options), timeout);
        } else {
            setImmediate(this.poll.bind(this, options));
        }
    }

    // POLLING MANAGAEMENT

    /**
     * Return a list of items from the queue
     * @returns {object[]} - { id, data }
     */
    _poll_get(options, callback) {}

    /**
     * Update visibilityTimeout for the item in ms
     */
    _poll_update(options, item, visibilityTimeout, callback) {}


    /**
     * Delete an item from the queue by id
     */
    _poll_del(options, item, callback) {}

    /**
     * Perform a single run, pull messages, process all and schedule next run
     */
    _poll_run(options) {
        if (!this.url) return;

        this._poll_get(options, (err, items) => {
            if (err) logger.error("poll:", this.url, lib.traceError(err), items);

            if (err || !items?.length) {
                return this.schedule(options, this.options.pollInterval);
            }

            lib.forEvery(items, (item, next) => {
                this._poll_run_item(options, item, next);
            }, () => {
                this.schedule(options, this.options.pollInterval);
            });
        });
    }

    /**
     * Error safe emit, catch and report errors
     */
    _poll_emit(chan, msg, callback) {
        try {
            return this.emit(chan, msg, callback);
        } catch (e) {
            logger.error("poll:", this.name, chan, e, msg);
            callback(e);
        }
    }

    /**
     * Run a single item
     *
     */

    _poll_run_item(options, item, callback) {

        let timer, done, msg;

        const chan = this.channel(options);

        // base64 can be used for complex JSON
        if (lib.isString(item.data)) {
            if (item.data[0] != "{") {
                item.data = Buffer.from(item.data, "base64").toString();
            }
            msg = lib.jsonParse(item.data, { datatype: "obj", logger: "error", id: item.id, chan });
        } else {
            msg = lib.isObject(item.data);
        }

        logger.debug("poll:", this.name, chan, "MSG:", msg, "ITEM:", item);
        if (!msg) {
            return this._poll_del(options, item, callback)
        }

        // Check message timestamps if not ready yet then keep it hidden
        if (msg.endTime > 0 && msg.endTime < Date.now()) {
            logger.info("poll:", this.name, chan, "expired", item);
            return this._poll_del(options, item, callback)
        }

        if (msg.startTime > 0 && msg.startTime - Date.now() > this.options.pollInterval) {
            let timeout = msg.startTime - Date.now();
            if (timeout > this.options.maxVisibilityTimeout) timeout = this.options.maxVisibilityTimeout;
            logger.info("poll:", this.name, chan, timeout, "scheduled", item);
            return this._poll_update(options, item, timeout, callback)
        }

        // Delete immediately, this is a one-off message not to be handled or repeated
        if (msg.noWait) {
            this._poll_del(options, item);
        } else

        // Delay deletion in case checks need to be done for uniqueness or something else
        if (msg.noWaitTimeout > 0) {
            setTimeout(() => {
                if (done) return;
                msg.noWait = 1;
                this._poll_del(options, item);
            }, msg.noWaitTimeout * 1000);
        } else

        if (!msg.noVisibilityTimeout) {
            // Update visibility now and while the job is running
            const timeout = msg.visibilityTimeout > 0 ? msg.visibilityTimeout : this.options.visibilityTimeout;
            if (timeout) {
                if (msg.visibilityTimeout > 0) {
                    this._poll_update(options, item, timeout)
                }

                timer = setInterval(() => {
                    if (done) return;
                    this._poll_update(options, item, timeout, (err) => {
                        logger.debug("poll:", this.name, chan, "keepalive", item);
                        if (err) clearInterval(timer);
                    });
                }, timeout * 0.8);
            }
        }

        // Not processed events will be back in the queue after visibility timeout automatically
        if (!this._poll_emit(chan, msg, (err) => {
            if (done) return;
            done = 1;
            clearInterval(timer);
            logger.debug("poll:", this.name, chan, err, item);

            // Retain the message only in case of known fatal errors, otherwise delete it after processing, any other error
            // is considered as undeliverable due to corruption or invalid message format...
            if (!msg.noRetryVisibilityTimeout && (err?.status >= 500 || msg.noWait)) {
                const timeout = lib.toNumber(msg.retryVisibilityTimeout?.[err?.status]);
                if (err && timeout > 0) {
                    return this._poll_update(options, item, timeout, callback);
                }
                return callback();
            }

            this._poll_del(options, item, callback)
        })) {
            done = 1;
            clearInterval(timer);
            callback();
        }
    }

}

module.exports = QueueClient;
