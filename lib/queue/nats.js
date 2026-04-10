/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2021
 */

const app = require(__dirname + '/../app');
const logger = require(__dirname + '/../logger');
const lib = require(__dirname + '/../lib');
const QueueClient = require(__dirname + "/client");
const nats = require("nats");
const sc = nats.StringCodec();

/**
 * Queue client using NATS server
 *
 * To enable install the npm module:
 *
 *      npm i nats
 *
 * @example
 *
 *  queue-nats=nats://
 *  queue-nats=nats://host:4222
 *
 * @memberOf module:queue
 */

class NatsQueueClient extends QueueClient {

    constructor(options) {
        super(options);
        this.name = "nats";
        this.applyOptions();
        this._subs = {};
        this._pending = [];
        this._running = new Set();
        this._mtime = this._ptime = 0;
        this.connect();
    }

    applyOptions(options) {
        super.applyOptions(options);
        this.options.servers = lib.split(this.options.servers);
        this.options.maxReconnectAttempts = lib.toNumber(this.options.maxReconnectAttempts, { dflt: -1 });
        this.options.expires = lib.toNumber(this.options.expires, { min: 0 });
        this.options.no_wait = lib.toBool(this.options.no_wait, true);
        this.options.name = this.options.name && lib.toTemplate(this.options.name, [this.options, app]) || `${app.env.id}-${app.env.pid}`;
        if (typeof this.options.waitOnFirstConnect == "undefined") this.options.waitOnFirstConnect = true;
    }

    connect() {
        nats.connect(this.options).then((client) => {
            this.client = client;
            this.emit("ready");
            for (const client of this._pending) {
                this[client[0]].apply(this, client.slice(1));
            }
        }).catch((err) => {
            logger.error("connect:", this.name, err, this.options);
            setTimeout(this.connect.bind(this), this.options.reconnectTimeWait || 2000);
        });
    }

    close() {
        if (!this.client) return super.close();
        this.client.drain().then(() => {}).catch((err) => {
            logger.error("close:", this.name, err, this.options);
        }).finally(() => {
            super.close();
        });
    }

    subscribe(channel, options, callback) {
        if (!this.client) {
            return this._pending.push(["subscribe", channel, options, callback]);
        }
        super.subscribe(channel, options, callback);
        if (this._subs[channel]) return;
        var opts = {
            max: options.max,
            timeout: options.timeout,
            queue: options.queue,
            callback: (err, msg) => {
                if (err) return logger.error("subscribe:", this.name, channel, err, msg);
                logger.dev("onMessage:", this.name, channel, msg);
                var data = sc.decode(msg.data);
                if (options.raw) data = { subject: msg.subject, data: data, sid: msg.sid, headers: msg.headers };
                if (msg.reply) {
                    this.emit(channel, data, (err, rc) => {
                        if (!err) msg.respond(sc.encode(rc));
                    });
                } else {
                    this.emit(channel, data);
                }
            }
        };
        this._subs[channel] = this.client.subscribe(channel, opts);
    }

    unsubscribe(channel, options, callback) {
        super.unsubscribe(channel, options, callback);
        if (!callback && this._subs[channel]) {
            this._subs[channel].unsubscribe();
            delete this._subs[channel];
        }
    }

    publish(channel, msg, options, callback) {
        if (!this.client) {
            return this._pending.push(["publish", msg, options, callback]);
        }
        var opts;
        if (options.headers) opts = { headers: options.headers };
        if (options.reply) opts = Object.assign(opts, { reply: options.reply });
        this.client.publish(channel, sc.encode(msg), opts);
        return typeof callback == "function" && callback();
    }

    listen(options, callback) {
        if (!this.client) {
            return this._pending.push(["subscribeQueue", options, callback]);
        }
        if (!this.js) {
            this.js = this.client.jetstream();
        }

        const sub = this.canonical(options);
        if (this._subs[sub]) {
            logger.debug("listen:", this.name, sub, "reusing:", options);
            return super.listen(options, callback);
        }

        const chan = this.channel(options);
        const group = this.group(options) || chan;

        const opts = nats.consumerOpts();
        opts.ackExplicit();
        opts.ackWait(this.options.visibilityTimeout);
        opts.deliverAll();
        opts.manualAck();
        opts.maxAckPending(-1);
        opts.queue(group);
        opts.durable(group);
        opts.callback(this._callback.bind(this, options));

        for (const n of [ 'ackAll', 'ackExplicit', 'ackNone', 'deliverAll', 'deliverLast', 'deliverLastPerSubject', 'deliverNew',
                          'flowControl', 'headersOnly', 'manualAck', 'orderedConsumer', 'replayInstantly', 'replayOriginal' ]) {
            if (this.options[n]) opts[n]();
        }
        for (const n of [ 'ackWait', 'deliverGroup', 'deliverTo', 'durable', 'filterSubject', 'idleHeartbeat', 'limit',
                          'maxAckPending', 'maxDeliver',  'maxMessages', 'maxWaiting', 'queue',
                          'startAtTimeDelta', 'startSequence', 'startTime' ]) {
            if (this.options[n] !== undefined) opts[n](this.options[n]);
        }

        const jsSub = this.options.pushSubscribe ? this.js.subscribe(chan, opts) :
                              this.js.pullSubscribe(chan, opts);

        jsSub.then((s) => {
            this._subs[sub] = s;
            super.listen(options, callback);
            logger.debug("listen:", this.name, sub, opts);
        }).catch((err) => {
            logger.error("listen:", this.name, sub, opts, err);
        });
    }

    unlisten(options, callback) {
        super.unlisten(options, callback);
        if (callback) return;
        var sub = this.canonical(options);
        if (this._subs[sub]) {
            this._subs[sub].unsubscribe();
            delete this._subs[sub];
        }
    }

    submit(job, options, callback) {
        if (!this.client) {
            return this._pending.push(["publishQueue", options, callback]);
        }
        if (!this.js) {
            this.js = this.client.jetstream();
        }
        var chan = this.channel(options);
        var opts = options;
        if (options.unique) {
            opts = lib.clone(options, { msgID: options.unique });
        }
        if (typeof job != "string") {
            job = lib.stringify(job);
        }
        this.js.publish(chan, sc.encode(job), opts).then((rc) => {
            lib.tryCall(callback, null, rc);
        }).catch((err) => {
            lib.tryCall(callback, err);
        });
    }

    poll(options) {
        var sub = this.canonical(options);
        if (!this._subs[sub]) return;

        if (this._running.size < this.options.queueCount) {
            this._subs[sub].pull({
                batch: this.options.queueCount - this._running.size,
                expires: this.options.expires,
                no_wait: this.options.no_wait,
            });
        }
        this.schedule(options, this.options.pollInterval);
    }

    _poll_update(options, item, visibilityTimeout, callback) {
        if (!this.options.ackNone) {
            item.msg.working();
        }
        lib.tryCall(callback)
    }

    _poll_del(options, item, callback) {
        if (!this.options.ackNone) {
            item.msg[this.options.ackNext ? "next": "ack"]();
        }
        lib.tryCall(callback)
    }

    _callback(options, err, msg) {
        if (err && err.code != 404 && err.code != 408) {
            return logger.error("poll:", this.name, options, this._running.size, err, msg);
        }
        if (!msg) return;
        const item = {
            msg,
            data: sc.decode(msg.data),
        };
        this._running.add(item);
        this._poll_run_item(options, item, () => {
            this._running.delete(item);
        });
    }

}

module.exports = NatsQueueClient;
