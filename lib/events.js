/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2021
 */

const modules = require(__dirname + '/modules');
const logger = require(__dirname + '/logger');
const app = require(__dirname + '/app');
const lib = require(__dirname + '/lib');
const ipc = require(__dirname + '/ipc');
const queue = require(__dirname + '/queue');
const jobs = require(__dirname + '/jobs');

/**
 * @module events
 */

const events = {
    name: "events",
    args: [
        { name: "worker-queue-(.+)", obj: "worker-queue", type: "list", onupdate: function() { if (ipc.role=="worker"&&app.role=="worker") this.subscribeWorker()}, descr: "Queues to subscribe for workers, same queues can be used at the same time with different functions and channels and consumers, event queue format is `queue#channel@consumer`, ex: -events-worker-queue-ticket ticket.processEvents, -events-worker-queue-ticket#inbox@staff ticket.processInboxEvents, -events-worker-queue-ticket@staff ticket.processStaffEvents" },
        { name: "worker-options-(.+)", obj: "workerOptions", make: "$1", type: "map", descr: "Custom parameters by queue name, passed to `queue.listen` on worker start, useful with channels, ex: `-events-worker-options-ticket count:3,raw:1`" },
        { name: "worker-delay", type: "int", descr: "Delay in milliseconds for a worker before it will start accepting jobs, for cases when other dependencies may take some time to start" },
        { name: "max-runtime", type: "int", min: 0, multiplier: 1000, descr: "Max number of seconds an event processing can run before being killed" },
        { name: "routing", obj: "routing", type: "map", merge: 1, maptype: "regexp", descr: 'Routing map by event subject or type, ex: `-events-routing redis:local.+,nats:.+,sqs:billing.+' },
        { name: "routing-options-(.+)", obj: "routingOptions", make: "$1", type: "map", merge: 1, descr: "Routing options by queue name, used by `putEvent` to merge with passed queue options, ex: `-events-routing-options-sqs groupKey:id`" },
        { name: "shutdown-timeout", type: "int", min: 500, descr: "Max number of milliseconds to wait for the graceful shutdown sequence to finish, after this timeout the process just exits" },
    ],
    subscribed: new Set(),
    running: new Set(),
    runTime: 0,
    maxRuntime: 60,
    checkRuntime: 0,
    shutdownTimeout: 50,
    workerDelay: 0,
    workerQueue: {},
    workerOptions: {},
    routing: {},
    routingOptions: {},
};

/**
 * Event queue processor
 *
 * If any of `events-worker-queue-XXX` parameters are defined then workers subscribe to configured event queues and listen for events.
 *
 * Each event queue can run multiple functions idependently but will ack/nack for all functions so to deal with replay dups it is advised to
 * split between multiple consumers using the syntax: `queue#channel@consumer`
 *
 * Multiple event queues can be defined and processed at the same time.
 *
 * An event processing function takes 2 arguments, an event and callback to call on finish
 */

module.exports = events;

events.configureWorker = function(options, callback)
{
    if (!app.isOk("events", options)) return callback();
    this.initWorker(options, callback);
}

// Perform graceful worker shutdown, to be used for workers restart
events.shutdownWorker = function(options, callback)
{
    logger.log("shutdownWorker:", events.name, "queue:", this.subscribed, "max-runtime:", this.maxRuntime, "max-lifetime:", jobs.maxLifetime, options);

    clearInterval(events._checkTimer);

    // Stop accepting messages from the queues
    for (const q in this.workerQueue) queue.unlisten({ queueName: q });

    setTimeout(callback, options?.shutdownTimeout || this.shutdownTimeout);
}

/**
 * Check how long we run a job and force kill if exceeded, check if total life time is exceeded.
 *
 * If exit is required the `shundownWorker` methods will receive options with `shutdownReason` property
 * set and the name-sake property will contained the value exceeded.
 */
events.checkTimes = function()
{
    var now = Date.now();
    if (!this.running.size || !events.maxRuntime > 0) return;
    var bad = [];
    for (const e of this.running) if (now - e.time > events.maxRuntime) bad.push(e);

    // Stuck jobs can run much longer if we are still processing other small jobs
    if (bad.length) {
        if (this.running.size == bad.length) {
            logger.warn('checkLifetime:', 'jobs: exceeded max run time', events.maxRuntime, bad);
            return jobs.exitWorker({ shutdownReason: "maxRuntime", maxRuntime: events.maxRuntime });
        } else
        if (now - this.checkRuntime > events.maxRuntime) {
            logger.warn('checkLifetime:', 'jobs: exceeded max run time but other jobs still running', events.maxRuntime, bad);
        }
        this.checkRuntime = Date.now();
    }
}

events.initWorker = function(options, callback)
{
    ipc.initWorker(options);

    events._checkTimer = setInterval(this.checkTimes.bind(this), 30000);

    // Randomize subscription when multiple workers start at the same time, some queue drivers use polling
    setTimeout(() => {
        events.subscribeWorker();
        logger.log("initWorker:", events.name, "started", "queue:", events.subscribed, "maxRuntime:", events.maxRuntime, "maxLifetime:", jobs.maxLifetime);
    }, events.workerDelay);

    if (typeof callback == "function") callback();
}

events.subscribeWorker = function()
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
        for (const proc of this.workerQueue[name]) {
            var parts = proc.split('.');
            var path = parts.slice(0, -1).join(".");
            var method = parts.at(-1);
            var context = modules[path];

            if (!context || typeof context[method] != "function") {
                logger.error("subscribeWorker:", this.name, q.name, name, "invalid event proc:", proc);
                continue;
            }
            procs.push(context[method].bind(context));
        }
        if (!procs.length) continue;
        var qopts = lib.objExtend({ queueName: name }, this.workerOptions[name]);
        queue.listen(qopts, this.processEvent.bind(this, name, procs));
        this.subscribed.add(q.canonical(name));
        logger.info("subscribeWorker:", this.name, q.name, name, this.workerQueue[name]);
    }
}

events.unsubscribeQueue = function(name)
{
    const q = queue.getClient(name);
    if (!this.subscribed.delete(q.canonical(name))) return;
    queue.unlisten({ queueName: name });
    logger.info("unsubscribeQueue:", this.name, q.name, name);
}

events.processEvent = function(name, procs, event, callback)
{
    var evt = { name, procs, event, time: Date.now() };
    this.running.add(evt);
    this.runTime = Date.now();
    logger.debug("processEvent:", events.name, evt);

    lib.forEvery(procs, (proc, next) => {
        try {
            proc(event, (err) => {
                if (err) logger.error("processEvent:", events.name, err, evt);
                this.runTime = Date.now();
                next();
            });
        } catch (err) {
            logger.error("processEvent:", events.name, err, evt);
            next();
        }
    }, () => {
        this.running.delete(evt);
        this.runTime = Date.now();
        if (typeof callback == "function") callback();
    });
}

/**
 * Place an event into a queue by subject and type
 * @param {string} subject - event subject, topic, ID, ...
 * @param {object} data - an object to be placed as the `data` property
 * @param {object} [options] - queue specific properties
 * @returns {int} - number of queues the event was sent to, -1 on error
 * @memberof module:events
 * @method putEvent
 */
events.putEvent = function(subject, data, options)
{
    var msg, n = 0;

    if (typeof subject != "string" || typeof data != "object") {
        logger.error("putEvent:", "invalid", subject, data);
        return -1;
    }

    for (const q in this.routing) {
        if (this.routing[q].test(subject)) {
            if (!msg) {
                msg = Object.assign({}, {
                    subject,
                    data,
                    id: lib.uuid(),
                    time: lib.clock(),
                    source: app.instance.tag + "/" + app.role + "/" + app.ipaddr + "/" + process.pid,
                });
            }
            options = Object.assign({}, this.routingOptions[q], options, { queueName: q.queueName });
            queue.submit(msg, options, (err) => { if (err) logger.error("putEvent:", subject, err, msg) });
            n++;
        }
    }
    return n;
}

