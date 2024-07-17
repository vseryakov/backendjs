//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2021
//

const util = require('util');
const core = require(__dirname + '/../core');
const logger = require(__dirname + '/../logger');
const lib = require(__dirname + '/../lib');
const ipc = require(__dirname + "/../ipc");
const Client = require(__dirname + "/client");

// Queue client using NATS server
//
// To enable install the npm modules:
//
//      npm i -g nats
//
// Configuration:
//
//    ipc-queue-nats=nats://localhost:4222
//
const mod = {
    name: "nats",
};
module.exports = mod;

ipc.modules.push(mod);

mod.createClient = function(url, options)
{
    if (/^nats:/.test(url)) return new IpcNatsClient(url, options);
}

function IpcNatsClient(url, options)
{
    if (!mod.nats) {
        mod.nats = require("nats");
        mod.sc = mod.nats.StringCodec();
    }
    Client.call(this, url, options);
    this.applyOptions();
    if (!this.options.servers.length) {
        this.options.servers = this.hostname + ":" + this.port;
    }
    this._subs = {};
    this._pending = [];
    this._running = new Set();
    this._mtime = this._ptime = 0;
    this.connect();
}
util.inherits(IpcNatsClient, Client);

IpcNatsClient.prototype.applyOptions = function(options)
{
    Client.prototype.applyOptions.call(this, options);
    this.options.servers = lib.strSplit(this.options.servers);
    this.options.maxReconnectAttempts = lib.toNumber(this.options.maxReconnectAttempts, { dflt: -1 });
    this.options.visibilityTimeout = lib.toNumber(this.options.visibilityTimeout, { min: 0 });
    this.options.interval = lib.toNumber(this.options.interval, { dflt: 1000, min: 0 });
    this.options.count = lib.toNumber(this.options.count, { min: 1, max: 32 });
    this.options.expires = lib.toNumber(this.options.expires, { min: 0 });
    this.options.no_wait = lib.toBool(this.options.no_wait, true);
    this.options.name = this.options.name && lib.toTemplate(this.options.name, [this.options, core]) || `${core.instance.id}-${core.instance.pid}`;
    if (typeof this.options.waitOnFirstConnect == "undefined") this.options.waitOnFirstConnect = true;
}

IpcNatsClient.prototype.connect = function()
{
    mod.nats.connect(this.options).then((c) => {
        this.client = c;
        this.emit("ready");
        for (const c of this._pending) {
            this[c[0]].apply(this, c.slice(1));
        }
    }).catch((err) => {
        logger.error("connect:", mod.name, err, this.options);
        setTimeout(this.connect.bind(this), this.options.reconnectTimeWait || 2000);
    });
}

IpcNatsClient.prototype.close = function()
{
    if (!this.client) return Client.prototype.close.call(this);
    this.client.drain().then(() => {}).catch((err) => {
        logger.error("close:", mod.name, err, this.options);
    }).finally(() => {
        Client.prototype.close.call(this);
    });
}

IpcNatsClient.prototype.subscribe = function(channel, options, callback)
{
    if (!this.client) return this._pending.push(["subscribe", channel, options, callback]);
    Client.prototype.subscribe.call(this, channel, options, callback);
    if (this._subs[channel]) return;
    var opts = {
        max: options.max,
        timeout: options.timeout,
        queue: options.queue,
        callback: (err, msg) => {
            if (err) return logger.error("subscribe:", mod.name, channel, err, msg);
            logger.dev("onMessage:", mod.name, channel, msg);
            var data = mod.sc.decode(msg.data);
            if (options.raw) data = { subject: msg.subject, data: data, sid: msg.sid, headers: msg.headers };
            if (msg.reply) {
                this.emit(channel, data, (err, rc) => {
                    if (!err) msg.respond(mod.sc.encode(rc));
                });
            } else {
                this.emit(channel, data);
            }
        }
    };
    this._subs[channel] = this.client.subscribe(channel, opts);
}

IpcNatsClient.prototype.unsubscribe = function(channel, options, callback)
{
    Client.prototype.unsubscribe.call(this, channel, options, callback);
    if (!callback && this._subs[channel]) {
        this._subs[channel].unsubscribe();
        delete this._subs[channel];
    }
}

IpcNatsClient.prototype.publish = function(channel, msg, options, callback)
{
    if (!this.client) return this._pending.push(["publish", msg, options, callback]);
    var opts;
    if (options.headers) opts = { headers: options.headers };
    if (options.reply) opts = lib.objExtend(opts, { reply: options.reply });
    this.client.publish(channel, mod.sc.encode(msg), opts);
    return typeof callback == "function" && callback();
}

IpcNatsClient.prototype.subscribeQueue = function(options, callback)
{
    if (!this.client) return this._pending.push(["subscribeQueue", options, callback]);
    if (!this.js) this.js = this.client.jetstream();

    var sub = this.canonical(options);
    if (this._subs[sub]) {
        logger.debug("subscribeQueue:", mod.name, sub, "reusing:", options);
        return Client.prototype.subscribeQueue.call(this, options, callback);
    }

    var chan = this.channel(options);
    var opts = mod.nats.consumerOpts(), p;
    opts.deliverAll();
    opts.callback(this._callback.bind(this, options));

    for (const n of ["deliverAll", "deliverLastPerSubject", "deliverLast", "deliverNew",
                     "ackNone", "ackAll", "manualAck", "ackExplicit",
                     "replayInstantly", "replayOriginal", "flowControl", "orderedConsumer", "headersOnly"]) {
        if (options[n] || this.options[n]) opts[n]();
    }
    for (const n of ["queue", "durable", "deliverTo", "deliverGroup", "idleHeartbeat", "limit", "filterSubject",
                     "maxAckPending", "maxWaiting", "maxMessages", "maxDeliver", "ackWait",
                     "startAtTimeDelta", "startTime", "startSequence"]) {
        if (typeof options[n] != "undefined") opts[n](options[n]); else
        if (typeof this.options[n] != "undefined") opts[n](this.options[n]);
    }

    if (options.pushSubscribe) {
        p = this.js.subscribe(chan, opts);
    } else {
        delete this.options.ackNone;
        delete options.ackNone;
        opts.ackExplicit();
        opts.maxAckPending(-1);
        if (options.pullSubscribe) {
            p = this.js.pullSubscribe(chan, opts);
        } else {
            var consumer = this.consumer(options) || chan;
            opts.manualAck();
            opts.queue(consumer);
            opts.durable(consumer);
            opts.ackWait(options.visibilityTimeout || this.options.visibilityTimeout);
            p = this.js.pullSubscribe(chan, opts);
        }
    }

    p.then((s) => {
        this._subs[sub] = s;
        Client.prototype.subscribeQueue.call(this, options, callback);
        logger.debug("subscribeQueue:", mod.name, sub, opts);
    }).catch((err) => {
        logger.error("subscribeQueue:", mod.name, sub, opts, err);
    });
}

IpcNatsClient.prototype.unsubscribeQueue = function(options, callback)
{
    Client.prototype.unsubscribeQueue.call(this, options, callback);
    if (callback) return;
    var sub = this.canonical(options);
    if (this._subs[sub]) {
        this._subs[sub].unsubscribe();
        delete this._subs[sub];
    }
}

IpcNatsClient.prototype.publishQueue = function(job, options, callback)
{
    if (!this.client) return this._pending.push(["publishQueue", options, callback]);
    if (!this.js) this.js = this.client.jetstream();
    var chan = this.channel(options);
    var opts = options;
    if (options.unique) {
        opts = lib.objClone(options, "msgID", options.unique);
    }
    this.js.publish(chan, mod.sc.encode(job), opts).then((rc) => {
        lib.tryCall(callback, null, rc);
    }).catch((err) => {
        lib.tryCall(callback, err);
    });
}

IpcNatsClient.prototype.pollQueue = function(options)
{
    var sub = this.canonical(options);
    if (!this._subs[sub]) return;
    var count = lib.validPositive(options.count, this.options.count);
    if (this._running.size < count) {
        this._subs[sub].pull({ batch: count - this._running.size,
                                expires: lib.validPositive(options.expire, this.options.expires),
                                no_wait: lib.validBool(options.no_wait, this.options.no_wait) });
    }
    this.schedulePollQueue(options, lib.validPositive(options.interval, this.options.interval));
}

IpcNatsClient.prototype._callback = function(options, err, jsmsg)
{
    var sub = this.canonical(options);
    if (err && err.code != 404 && err.code != 408) return logger.error("pollQueue:", this.name, sub, this._running.size, err, jsmsg);
    if (!jsmsg) return;

    var vtimer, done;
    var mtimer = this.metrics.start();
    var now = this._mtime = Date.now();
    var running = this._running;
    var ack = options.ackNext || this.options.ackNext ? "next": "ack";
    var ackNone = options.ackNone || this.options.ackNone;
    var raw = options.raw || this.options.raw;
    var data = mod.sc.decode(jsmsg.data);
    var msg = raw ? data : lib.jsonParse(data, { logger: "info" });
    logger.debug("pollQueue:", this.name, sub, running.size, "MSG:", msg, "ITEM:", jsmsg);

    if (!msg) {
        mtimer.end();
        if (!ackNone) jsmsg[ack]();
        return;
    }
    if (!raw) {
        if (msg.endTime > 0 && msg.endTime < now) {
            mtimer.end();
            if (!ackNone) jsmsg[ack]();
            return;
        }
        if (msg.startTime > 0 && msg.startTime > now) {
            mtimer.end();
            if (!ackNone) jsmsg.working();
            return;
        }
        if (!ackNone) {
            if (msg.noWait) {
                jsmsg[ack]();
            } else
            if (msg.noWaitTimeout > 0) {
                setTimeout(() => { if (!done) { msg.noWait = 1; jsmsg[ack](); } }, msg.noWaitTimeout * 1000);
            } else {
                const vtimeout = msg.visibilityTimeout > 0 ? msg.visibilityTimeout : lib.validPositive(options.visibilityTimeout, this.options.visibilityTimeout);
                if (vtimeout) {
                    vtimer = setInterval(() => { if (!done) jsmsg.working() }, vtimeout * 0.8);
                }
            }
        }
    }
    function _end() {
        done = 1;
        mtimer.end();
        if (!ackNone) running.delete(jsmsg);
        clearInterval(vtimer);
    }
    if (!ackNone) running.add(jsmsg);

    try {
        var m = raw ? { subject: jsmsg.subject, data: msg, sid: jsmsg.sid, seq: jsmsg.seq, headers: jsmsg.headers } : msg;
        if (!this.emit(sub, m, (err) => {
            if (done) return;
            _end();
            if (ackNone) return;
            if (!raw) {
                if (!msg.noVisibility && (err && err.status >= 500 || msg.noWait)) {
                    if (!msg.noWait) jsmsg.working();
                    return;
                }
            }
            jsmsg[ack]();
        })) {
            _end();
            if (!ackNone) jsmsg.working();
        }
    } catch (e) {
        _end();
        if (!ackNone) try { jsmsg.working() } catch (e2) { e._errmsg = e2.message }
        logger.error("pollQueue:", this.name, sub, running.size, e, msg);
    }
}
