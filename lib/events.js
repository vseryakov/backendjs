//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2021
//

const bkjs = require('backendjs');
const core = bkjs.core;
const ipc = bkjs.ipc;
const queue = bkjs.queue;
const lib = bkjs.lib;
const jobs = bkjs.jobs;
const logger = bkjs.logger;

// Event queue processor
//
// If any of `events-worker-queue-XXX` parameters are defined then workers subscribe to configured event queues and listen for events.
//
// Each event queue can run multiple functions idependently but will ack/nack for all functions so to deal with replay dups it is advised to
// split between multiple consumers using the syntax: `queue#channel@consumer`
//
// Multiple event queues can be defined and processed at the same time.
//
// An event processing function takes 2 arguments, an event and callback to call on finish

const mod = {
    name: "events",
    args: [
        { name: "worker-queue-(.+)", obj: "worker-queue", type: "list", onupdate: function() { if (ipc.role=="worker"&&core.role=="worker") this.subscribeWorker()}, descr: "Queues to subscribe for workers, same queues can be used at the same time with different functions and channels and consumers, event queue format is `queue#channel@consumer`, ex: -events-worker-queue-ticket ticket.processEvents, -events-worker-queue-ticket#inbox@staff ticket.processInboxEvents, -events-worker-queue-ticket@staff ticket.processStaffEvents" },
        { name: "worker-options-(.+)", obj: "workerOptions", make: "$1", type: "json", logger: "error", descr: "Custom parameters by queue name, passed to `cache.subscribeQueue` on worker start, useful with channels, ex: `-events-worker-options-ticket {\"count\":3,\"raw\":1}`" },
        { name: "worker-delay", type: "int", descr: "Delay in milliseconds for a worker before it will start accepting jobs, for cases when other dependencies may take some time to start" },
        { name: "max-runtime", type: "int", min: 0, multiplier: 1000, descr: "Max number of seconds an event processing can run before being killed" },
        { name: "routing-(.+)", obj: "routing", type: "regexp", empty: 1, descr: "Queue routing by event topic" },
        { name: "properties", type: "list", descr: "List of properties to copy into an event envelope from the provided options" },
        { name: "shutdown-timeout", type: "int", min: 500, descr: "Max number of milliseconds to wait for the graceful shutdown sequence to finish, after this timeout the process just exits" },
    ],
    subscribed: new Set(),
    running: new Set(),
    runTime: 0,
    maxRuntime: 60,
    checkRuntime: 0,
    shutdownTimeout: 5000,
    workerDelay: 500,
    workerQueue: {},
    workerOptions: {},
    routing: {},
    properties: ["path", "host"]
};
module.exports = mod;

mod.configureWorker = function(options, callback)
{
    this.initWorker(options, callback);
}

// Perform graceful worker shutdown, to be used for workers restart
mod.shutdownWorker = function(options, callback)
{
    logger.log("shutdownWorker:", mod.name, "queue:", this.subscribed, "max-runtime:", this.maxRuntime, "max-lifetime:", jobs.maxLifetime, options);

    // Stop accepting messages from the queues
    for (const q in this.workerQueue) queue.unlisten({ queueName: q });

    setTimeout(callback, options?.shutdownTimeout || this.shutdownTimeout);
}

// Check how long we run a job and force kill if exceeded, check if total life time is exceeded.
//
// If exit is required the `shundownWorker` methods will receive options with `shutdownReason` property
// set and the name-sake property will contained the value exceeded.
mod.checkTimes = function()
{
    var now = Date.now();
    if (!this.running.size || !mod.maxRuntime > 0) return;
    var bad = [];
    for (const e of this.running) if (now - e.time > mod.maxRuntime) bad.push(e);

    // Stuck jobs can run much longer if we are still processing other small jobs
    if (bad.length) {
        if (this.running.size == bad.length) {
            logger.warn('checkLifetime:', 'jobs: exceeded max run time', mod.maxRuntime, bad);
            return jobs.exitWorker({ shutdownReason: "maxRuntime", maxRuntime: mod.maxRuntime });
        } else
        if (now - this.checkRuntime > mod.maxRuntime) {
            logger.warn('checkLifetime:', 'jobs: exceeded max run time but other jobs still running', mod.maxRuntime, bad);
        }
        this.checkRuntime = Date.now();
    }
}

mod.initWorker = function(options, callback)
{
    ipc.initWorker();

    setInterval(this.checkTimes.bind(this), 30000);

    // Randomize subscription when multiple workers start at the same time, some queue drivers use polling
    setTimeout(function() {
        mod.subscribeWorker();
        logger.log("initWorker:", mod.name, "started", "queue:", mod.subscribed, "maxRuntime:", mod.maxRuntime, "maxLifetime:", jobs.maxLifetime);
    }, lib.toNumber(mod.workerDelay) + lib.randomShort()/1000);

    if (typeof callback == "function") callback();
}

mod.subscribeWorker = function()
{
    for (const name in this.workerQueue) {
        if (/^[!-]/.test(name)) {
            this.unsubscribeQueue(name.substr(1));
            continue;
        }

        // Prevent subscription more than once to the same queue in case of invalid or nonexistent queues
        var q = queue.getQueue(name);
        if (this.subscribed.has(q.canonical(name))) continue;

        var procs = [];
        for (const i in this.workerQueue[name]) {
            var proc = lib.strSplit(this.workerQueue[name][i], ".");
            if (!core.modules[proc[0]] || typeof core.modules[proc[0]][proc[1]] != "function") {
                logger.error("subscribeWorker:", this.name, q.name, name, "invalid event proc:", proc);
                continue;
            }
            procs.push(core.modules[proc[0]][proc[1]].bind(core.modules[proc[0]]));
        }
        if (!procs.length) continue;
        var qopts = lib.objExtend({ queueName: name }, this.workerOptions[name]);
        queue.listen(qopts, this.processEvent.bind(this, name, procs));
        this.subscribed.add(q.canonical(name));
        logger.info("subscribeWorker:", this.name, q.name, name, this.workerQueue[name]);
    }
}

mod.unsubscribeQueue = function(name)
{
    const q = queue.getClient(name);
    if (!this.subscribed.delete(q.canonical(name))) return;
    queue.unlisten({ queueName: name });
    logger.info("unsubscribeQueue:", this.name, q.name, name);
}

mod.processEvent = function(name, procs, event, callback)
{
    var evt = { name, procs, event, time: Date.now() };
    this.running.add(evt);
    this.runTime = Date.now();
    logger.debug("processEvent:", mod.name, evt);

    lib.forEvery(procs, (proc, next) => {
        try {
            proc(event, (err) => {
                if (err) logger.error("processEvent:", mod.name, err, evt);
                this.runTime = Date.now();
                next();
            });
        } catch (err) {
            logger.error("processEvent:", mod.name, err, evt);
            next();
        }
    }, () => {
        this.running.delete(evt);
        this.runTime = Date.now();
        if (typeof callback == "function") callback();
    });
}

// Place an event into a queue by topic
mod.putEvent = function(topic, data, options)
{
    var msg = {
        topic: topic,
        mtime: Date.now(),
        role: core.role,
        pid: process.pid,
        ipaddr: core.ipaddr,
    }, n = 0;
    if (options) {
        for (const p of this.properties) {
            if (typeof options[p] != "undefined") msg[p] = options[p];
        }
    }
    msg.data = data;

    for (const q in this.routing) {
        if (this.routing[q].test(topic)) {
            if (typeof msg != "string") msg = lib.stringify(msg);
            queue.submit(msg, { queueName: q }, (err) => { if (err) logger.error("putEvent:", topic, err, msg) });
            n++;
        }
    }
    logger.debug("putEvent:", topic, "ignored", msg);
    return n;
}

// Return a queue name by the event handler
mod.getQueueByHandler = function(proc)
{
    for (const name in this.workerQueue) {
        if (lib.isFlag(this.workerQueue[name], proc)) return name;
    }
}

