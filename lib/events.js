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
        { name: "cap-(.+)", type: "int", strip: "cap-", descr: "Capability parameters" },
        { name: "worker-queue", obj: "worker-queue", type: "map", merge: 1, maptype: "list", onupdate: function() { if (ipc.role=="worker"&&app.role=="worker") this.subscribeWorker()}, descr: "Queues to subscribe for workers, same queues can be used at the same time with different functions and channels and consumers, event queue format is `queue@subject#group`", example: "events-worker-queue = ticket:ticket.processEvents, ticket@inbox#staff: ticket.processInboxEvents, ticket#staff: ticket.processStaffEvents" },
        { name: "worker-options-(.+)", obj: "workerOptions", make: "$1", type: "map", descr: "Custom parameters by queue name, passed to `queue.listen` on worker start, useful with channels", example: "-events-worker-options-ticket count:3,raw:1" },
        { name: "worker-delay", type: "int", descr: "Delay in milliseconds for a worker before it will start accepting jobs, for cases when other dependencies may take some time to start" },
        { name: "max-runtime", type: "int", min: 0, multiplier: 1000, descr: "Max number of seconds an event processing can run before being killed" },
        { name: "routing", obj: "routing", type: "map", merge: 1, maptype: "regexp", descr: "Routing map by event subject or type", example: "-events-routing redis:local.+, nats:.+, sqs:billing.+" },
        { name: "routing-options-(.+)", obj: "routingOptions", make: "$1", type: "map", merge: 1, descr: "Routing options by queue name, used by `putEvent` to merge with passed queue options", example: "-events-routing-options-nats groupName:group" },
        { name: "shutdown-timeout", type: "int", min: 500, descr: "Max number of milliseconds to wait for the graceful shutdown sequence to finish, after this timeout the process just exits" },
    ],
    subscribed: new Set(),
    running: new Set(),
    runTime: 0,
    maxRuntime: 60000,
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
 * This module implement simple event publishing and processing logic, useful for logging events for post-processing
 * by backendjs workers or by other systems using shared queues.
 *
 * All events will have the same structure:
 * ```js
 * {
 *    subject: "string",        // event subject
 *    data: { ... },            // event payload, must be an object
 *    id: "string",             // unique event id, auto-generated: lib.uuid()
 *    time: bigint,             // auto-generated: lib.clock()
 *    origin: "string",         // auto-generated: app.origin()
 *    sent: "string",           // sent queue name as queueName[@subject][#groupName]
 *    received: "string",       // revceived queue name as queueName[@subject][#groupName]
 *    seq: "int",               // sequence per queue: 1...N
 * }
 * ```
 *
 * Features support:
 * - publishing and processing: SQS, NATS
 * - publishing only: EventBridge, SNS
 *
 * If any of `events-worker-queue-XXX` parameters are defined then workers subscribe to configured event queues and listen for events.
 *
 *  Drivers like NATS support multiple consumers in the same queue using subject/group syntax:
 *
 * - `queueName@subject`
 * - `queueName#groupName`
 * - `queueName@subject#groupName`
 * - `groupName` property in the queue options can be used as a group as well
 *
 * Multiple event queues can be defined and processed at the same time.
 *
 * An event processing function takes 2 arguments, an event and callback to call on finish
 *
 * @example <caption>Create a stream</caption>
 *
 * nats stream add --subjects 'events,events@*' --defaults events
 *
 * @example <caption>Configured below in bkjs.conf: NATS server for events, routing by prefixes COMPANY-EVENT:
 * or USER-EVENT: and event processor for corresponding events</caption>
 *
 * queue-events = nats://
 *
 * events-routing = events@user:^EVENT.USER
 * events-worker-queue = events@user: mymod.syncUserEvents, events@user#log: mymod.logUserEvents
 *
 * events-routing = events@company:^EVENT.COMPANY
 * events-worker-queue = events@company: mymod.syncCompanyEvents
 *
 * @example <caption>
 * The module below logs all user events in the queue and defines an event processor function to sync such events with external service:
 *  - /user/... endpoints for managing users
 *  - mymod.syncUserEvents is an event processor function which is run by a worker process, it can run on a different host
 * </caption>
 *
 * const { app, api, lib, events } = require("backendjs");
 *
 * module.exports = {
 *     name: "mymod",
 *
 *     configureWeb(options, callback)
 *     {
 *         api.app.post(/^\/user\/(login|update|view)/, this.handleUsers);
 *
 *         callback();
 *     }
 *
 *     handleUsers(req, res) {
 *
 *        ... endpoint processing logic, assume req.user contains currently logged in user ...
 *
 *         const event = {
 *             type: req.params[0],
 *             id: req.user.id,
 *             name: req.user.name,
 *             access_time: Date.now()
 *         }
 *         events.putEvent("EVENT.USER." + req.params[0].toUpperCase(), event);
 *     }
 *
 *     syncUserEvents(event, callback)
 *     {
 *        ...
 *     }
 *
 *     logUserEvents(event, callback)
 *     {
 *         ...
 *     }
 * }
 *
 * app.start({ server: true });
 *
 * @example <caption>Start the server</caption>
 *
 * node mymod.js -jobs-workers 1
 *
 */

module.exports = events;

events.configureWorker = function(options, callback)
{
    if (!app.isOk("events", options)) return callback();
    this.initWorker(options, callback);
}

jobs.shutdown = function(options, callback)
{
    clearInterval(events._checkTimer);
    lib.tryCall(callback);
}

// Perform graceful worker shutdown, to be used for workers restart
events.shutdownWorker = function(options, callback)
{
    logger.log("shutdownWorker:", events.name, "queue:", this.subscribed, "max-runtime:", this.maxRuntime, "max-lifetime:", jobs.maxLifetime, options);

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
    if (!this.running.size || !events.maxRuntime > 0) return;

    const now = Date.now(), bad = [];
    for (const e of this.running) if (now - e.time > events.maxRuntime) bad.push(e);

    // Stuck jobs can run much longer if we are still processing other small jobs
    if (bad.length) {
        if (this.running.size == bad.length) {
            logger.warn('checkLifetime:', 'events: exceeded max run time', events.maxRuntime, bad);
            return jobs.exitWorker({ shutdownReason: "maxRuntime", maxRuntime: events.maxRuntime });
        } else
        if (now - this.checkRuntime > events.maxRuntime) {
            logger.warn('checkLifetime:', 'events: exceeded max run time but other jobs still running', events.maxRuntime, bad);
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
        const q = queue.getQueue(name);
        const sub = q.subscription(name);
        if (this.subscribed.has(sub)) continue;

        const procs = [];
        for (const proc of this.workerQueue[name]) {
            const parts = proc.split('.');
            const path = parts.slice(0, -1).join(".");
            const method = parts.at(-1);
            const context = modules[path];

            if (!context || typeof context[method] != "function") {
                logger.error("subscribeWorker:", this.name, q.name, name, "invalid event proc:", proc);
                continue;
            }
            procs.push(context[method].bind(context));
        }
        if (!procs.length) continue;

        const qopts = Object.assign({ queueName: name }, this.workerOptions[name]);
        queue.listen(qopts, this.processEvent.bind(this, sub, procs));
        this.subscribed.add(sub);
        logger.info("subscribeWorker:", this.name, q.name, sub, this.workerQueue[name]);
    }
}

events.unsubscribeQueue = function(name)
{
    const q = queue.getClient(name);
    const sub = q.subscription(name);
    if (!this.subscribed.delete(sub)) return;
    queue.unlisten({ queueName: name });
    logger.info("unsubscribeQueue:", this.name, q.name, sub);
}

events.processEvent = function(subscription, procs, event, callback)
{
    const task = { time: Date.now(), subscription, event, procs };
    logger.debug("processEvent:", events.name, task);

    this.running.add(task);
    this.runTime = Date.now();

    event.received = subscription;

    lib.forEvery(procs, (proc, next) => {
        try {
            proc(event, (err) => {
                if (err) logger.error("processEvent:", events.name, err, task);
                this.runTime = Date.now();
                next();
            });
        } catch (err) {
            logger.error("processEvent:", events.name, err, task);
            this.runTime = Date.now();
            next();
        }
    }, () => {
        this.running.delete(task);
        this.runTime = Date.now();
        if (typeof callback == "function") callback();
    });
}

/**
 * Place an event into a queue by subject and type
 * @param {string} subject - event subject, topic, ID, ...
 * @param {object|Array} data - an object to be placed as the `data` property
 * @param {object} [options] - queue specific properties
 * @param {function} [callback] - (err, data) - where data is a list of objects with event, error status and
 * options sent to each queue: { err, event, options }, it is empty if nothing was sent.
 * @memberof module:events
 * @method putEvent
 * @example
 * events.putEvent("USER-LOGIN", { id: ..., name: ... })
 *
 * events.putEvent("ORDER-SHIPPED", { id: ... })
 *
 * events.putEvent("social.post.like", { id: ..., liked: ... }, (err, data) => {
 *     if (!err) {
 *         console.log("Sent:", data?.filter(x => !x.err))
 *         console.log("Errors:", data?.filter(x => x.err))
 *     }
 * })
 */
events.putEvent = function(subject, data, options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    if (!lib.isString(subject)) {
        return lib.tryCall(callback, { status: 400, message: "missing subject" });
    }

    data = lib.isArray(data) || lib.isObject(data);
    if (!data) {
        return lib.tryCall(callback, { status: 400, message: "missing data" });
    }

    var msg, queues = [], result = [], seq = 1;

    for (const queueName in this.routing) {
        if (!this.routing[queueName].test(subject)) continue;
        if (!msg) {
            msg = Object.assign({}, {
                subject,
                data,
                id: lib.uuid(),
                time: lib.clock(),
                origin: app.origin(),
            });
        }
        queues.push(Object.assign({}, this.routingOptions[queueName], options, { queueName }));
    }

    lib.forEvery(queues, (opts, next) => {
        const event = Object.assign({}, msg, { sent: opts.queueName, seq: seq++ });
        queue.submit(event, opts, (err) => {
            logger.logger(err ? "error" : "debug", "putEvent:", err, "MSG:", msg, "OPTS:", opts);
            result.push({ event, options: opts, err });
            next();
        });
    }, (err) => {
        lib.tryCall(callback, err, result);
    }, true);
}

/**
 * Async version of {@link module:events.putEvent}
 * @param {string} subject - event subject, topic, ID, ...
 * @param {object} data - an object to be placed as the `data` property
 * @param {object} [options] - queue specific properties
 * @Returns {object} - { err, data }
 * @memberof module:events
 * @method aputEvent
 * @example
 * const { err, data } = await events.aputEvent("USER-LOGIN", { id: ..., name: ... })
 * console.log("Sent to:", data.map(x => x.event))
 * @async
 */
events.aputEvent = async function(subject, data, options)
{
    return new Promise((resolve, reject) => {
        events.putEvent(subject, data, options, (err, data) => {
            resolve({ err, data });
        });
    })
}
