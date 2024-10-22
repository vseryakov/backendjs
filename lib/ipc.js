//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const util = require('util');
const cluster = require('cluster');
const events = require("events");
const logger = require(__dirname + '/logger');
const core = require(__dirname + '/core');
const lib = require(__dirname + '/lib');
const cache = require(__dirname + '/cache');

// IPC communications between processes and support for subscriptions via queues.
//
// The module is EventEmitter and emits messages received.
//
// A special system queue can be configured and it will be used by all processes to listen for messages on the channel `bkjs:role`, where the role
// is the process role, the same messages that are processed by the server/worker message handlers like api:restart, config:init,....
//
// All instances will be listening and processing these messages at once, the most usefull use case is refreshing the DB config on demand or
// restarting without configuring any other means like SSH, keys....
//
function Ipc()
{
    events.EventEmitter.call(this);
    this.name = "ipc";
    this.role = "";
    this.msgs = {};
    this.restarting = [];
    this.ports = {};
    this.ping = {};

    this.args = [
        { name: "ping", obj: "ping", type: "map", merge: 1, maptype: "auto", descr: "Keep alive pings for workers: interval:ms how oftern do pings, kill:ms kill worker after this period" },
        { name: "system-queue", descr: "System queue name to send broadcast control messages, this is a PUB/SUB queue to process system messages like restart, re-init config,..." },
    ];
}

util.inherits(Ipc, events.EventEmitter);

module.exports = new Ipc();

// This function is called by a master server process to setup IPC channels and support for cache and messaging
Ipc.prototype.initServer = function()
{
    if (this.__init || !core.isOk("ipc")) return;
    this.__init = 1;
    this.role = "server";

    cache.initClients();

    cluster.on("exit", (worker, code, signal) => {
        this.handleServerMessages(worker, this.newMsg("cluster:exit", { id: worker.id, pid: worker.process.pid, code: code || undefined, signal: signal || undefined }));
    });

    cluster.on("disconnect", (worker, code, signal) => {
        this.handleServerMessages(worker, this.newMsg("cluster:disconnect", { id: worker.id, pid: worker.process.pid }));
    });

    cluster.on('listening', (worker, address) => {
        this.handleServerMessages(worker, this.newMsg("cluster:listen", { id: worker.id, pid: worker.process.pid, port: address.port, address: address.address }));
    });

    // Handle messages from the workers
    cluster.on('fork', (worker) => {
        worker.pingTime = worker.startTime = Date.now();
        worker.on('message', (msg) => {
            this.handleServerMessages(worker, msg);
        });
        worker.on("error", (err) => {
            logger.error("server:", worker.id, worker.process.pid, err);
        });
    });

    // Subscribe to the system bus
    cache.subscribe(core.name + ":" + core.role, { queueName: this.systemQueue }, (msg) => {
        this.handleServerMessages({ send: lib.noop }, this.newMsg(msg));
    });

    this._pingTimer = setInterval(() => {
        if (!this.ping.interval) return;
        var now = Date.now();
        for (const w of lib.getWorkers()) {
            var pt = w.pingTime || 0, lt = now - pt;
            if (pt >= 0 && lt > this.ping.interval) {
                logger.error("initServer:", core.role, "dead worker detected", w.id, w.process.pid, "ping:", this.ping, "last ping:", lt, "started:", now - w.startTime);
                if (this.ping.kill > 0 && lt > this.ping.kill) {
                    try { process.kill(w.process.pid, w.killTime ? "SIGKILL" : "SIGTERM"); } catch (e) {}
                    w.killTime = Date.now();
                }
            }
        }
    }, this.ping.interval/2 || 60000);

    logger.debug("initServer:", this.name, "started", core.role, core.workerId || process.pid, "ping:", this.pingInterval, this.systemQueue);
}

// This function is called by a worker process to setup IPC channels and support for cache and messaging
Ipc.prototype.initWorker = function()
{
    if (this.__init || !core.isOk("ipc")) return;
    this.__init = 1;
    this.role = "worker";

    cache.initClients();

    // Handle messages from the master
    process.on("message", this.handleWorkerMessages.bind(this));

    // Subscribe to the system bus
    cache.subscribe(core.name + ":" + core.role, { queueName: this.systemQueue }, (msg) => {
        this.handleWorkerMessages(this.newMsg(msg));
    });

    if (this.ping.interval > 0) {
        this._pingTimer = setInterval(this.sendMsg.bind(this, "worker:ping"), Math.max(1000, this.ping.interval/5));
        this.sendMsg("worker:ping");
    }

    logger.debug("initWorker:", this.name, "started", core.role, core.workerId || process.pid, this.systemQueue);
}

Ipc.prototype.handleWorkerMessages = function(msg)
{
    if (!msg) return;
    logger.dev('handleWorkerMessages:', msg.__op, core.role, msg)
    lib.runCallback(this.msgs, msg);

    try {
        switch (msg.__op || "") {
        case "repl:init":
            if (msg.port) core.startRepl(msg.port, core.repl.bind);
            break;

        case "repl:shutdown":
            if (core.repl.server) core.repl.server.end();
            delete core.repl.server;
            break;

        case "ipc:lru:del":
            msg.data = cache.lru.del(msg.name);
            logger.debug("ipc:lru:", msg);
            break;

        case "cache:init":
            cache.checkConfig();
            break;

        case "config:init":
            core.checkConfig();
            break;
        }

        this.emit(msg.__op, msg);
    } catch (e) {
        logger.error('handleWorkerMessages:', e.stack, msg);
    }
}

// To be used in messages processing that came from the clients or other way
Ipc.prototype.handleServerMessages = function(worker, msg)
{
    if (!msg) return false;
    logger.dev('handleServerMessages:', msg.__op, core.role, worker.id, msg);

    try {
        switch (msg.__op) {
        case "api:restart":
            // Start gracefull restart of all api workers, wait till a new worker starts and then send a signal to another in the list.
            // This way we keep active processes responding to the requests while restarting
            if (this.restarting.length) break;
            this.restarting = lib.getWorkers({ worker_type: "web" });

        case "api:ready":
            // Restart the next worker from the list
            if (this.restarting.length) {
                while (this.restarting.length > 0) {
                    let w = this.restarting.pop();
                    try { w.send({ __op: "api:restart" }) } catch (e) { w = 0 }
                    if (w) break;
                }
            }
            worker.worker_type = "web";
            this.sendReplPort("web", worker);
            break;

        case "worker:restart":
            lib.notifyWorkers(msg, { worker_type: null });
            break;

        case "worker:ready":
            this.sendReplPort("worker", worker);
            break;

        case "worker:ping":
            worker.pingTime = Date.now();
            break;

        case "cluster:disconnect":
            worker.pingTime = -1;
            break;

        case "cluster:exit":
            for (const p in this.ports) {
                if (this.ports[p] == worker.process?.pid) {
                    this.ports[p] = 0;
                    break;
                }
            }
            worker.pingTime = -1;
            break;

        case "cluster:listen":
            this.ports[msg.port] = worker.process?.pid;
            break;

        case "ipc:limiter":
            worker.send(cache.localLimiter(msg));
            break;

        case "ipc:lru:del":
            msg.data = cache.lru.del(msg.name);
            logger.debug("ipc:lru:", msg);
            break;

        case "cache:init":
        case "config:init":
            lib.notifyWorkers(msg);
            break;
        }

        this.emit(msg.__op, msg, worker);
    } catch (e) {
        logger.error('handleServerMessages:', e.stack, msg);
    }
}

// Send REPL port to a worker if needed
Ipc.prototype.sendReplPort = function(role, worker)
{
    if (!worker?.process) return;
    var port = core.repl[role + "Port"];
    if (!port) return;
    var ports = Object.keys(this.ports).sort();
    for (var i in ports) {
        var diff = ports[i] - port;
        if (diff > 0) break;
        if (diff == 0) {
            if (this.ports[port] == worker.process.pid) return;
            if (!this.ports[port]) break;
            port++;
        }
    }
    this.ports[port] = worker.process.pid;
    worker.send({ __op: "repl:init", port: port });
}

// Returns an IPC message object, `msg` must be an object if given.
Ipc.prototype.newMsg = function(op, msg, options)
{
    if (op?.__op) return op;
    if (typeof op == "string" && op[0] == "{" && op[op.length-1] == "}") {
        return lib.jsonParse(op, { datatype: "obj" });
    }
    if (typeof msg == "string") msg = lib.jsonParse(msg, { logger: "info" });
    return lib.objExtend(msg, { __op: String(op) });
}

// Wrapper around EventEmitter `emit` call to send unified IPC messages in the same format
Ipc.prototype.emitMsg = function(op, msg, options)
{
    if (op) this.emit(op, this.newMsg(op, msg, options));
}

// Send a message to the master process via IPC messages, callback is used for commands that return value back
//
// - the `timeout` property can be used to specify a timeout for how long to wait the reply, if not given the default is used
// - the rest of the properties are optional and depend on the operation.
//
// If called inside the server, it process the message directly, reply is passed in the callback if given.
//
// Examples:
//
//        ipc.sendMsg("op1", { data: "data" }, { timeout: 100 })
//        ipc.sendMsg("op1", { name: "name", value: "data" }, function(data) { console.log(data); })
//        ipc.sendMsg("op1", { 1: 1, 2: 2 }, { timeout: 100 })
//        ipc.sendMsg("op1", { 1: 1, 2: 2 }, function(data) { console.log(data); })
//        ipc.newMsg({ __op: "op1", name: "test" })
//
Ipc.prototype.sendMsg = function(op, msg, options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    msg = this.newMsg(op, msg, options);
    logger.dev("sendMsg:", msg.__op, core.role, msg);

    if (!cluster.isWorker) {
        if (this.role == "server") this.handleServerMessages({ send: lib.noop }, msg);
        return typeof callback == "function" ? callback(msg) : null;
    }

    if (typeof callback == "function") {
        msg.__res = true;
        lib.deferCallback(this.msgs, msg, callback, options && options.timeout);
    }
    try { process.send(msg); } catch (e) { logger.error('send:', e, msg); }
}

// Send a message to a channel, this is high level routine that uses the corresponding queue, it uses eventually queue.publish.
// If no client or queue is provided in the options it uses default `systemQueue`.
Ipc.prototype.broadcast = function(channel, msg, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!options?.queueName) {
        options = lib.objExtend(options, { queueName: this.systemQueue });
    }
    cache.publish(channel, msg, options, callback);
}
