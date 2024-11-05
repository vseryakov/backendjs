//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const cluster = require('cluster');
const domain = require('domain');
const fs = require('fs');
const util = require('util');
const core = require(__dirname + '/core');
const lib = require(__dirname + '/lib');
const logger = require(__dirname + '/logger');
const ipc = require(__dirname + '/ipc');
const cache = require(__dirname + '/cache');
const metrics = require(__dirname + '/metrics');

// Job queue processor
//
// When launched with `jobs-workers` parameter equal or greater than 0, the master spawns a number of workers which subscribe to
// configured job queues or the default queue and listen for messages.
//
// A job message is an object that defines what method from which module to run with the options as the first argument and a callback as the second.
//
// Multiple job queues can be defined and processed at the same time.
//
// By default `local` and `worker` queues are always created and ready to be used, jobs sent to local always run inside the local process
// but jobs sent to worker queue will be run in a worker.
//
//
const mod = {
    name: "jobs",
    // Config parameters
    args: [
        { name: "workers", type: "number", min: -1, max: 32, descr: "How many worker processes to launch to process the job queue, -1 disables jobs, 0 means launch as many as the CPUs available" },
        { name: "worker-cpu-factor", type: "real", min: 0, descr: "A number to multiply the number of CPUs available to make the total number of workers to launch, only used if `workers` is 0" },
        { name: "worker-env", type: "map", logger: "warn", descr: "Environment to be passed to the worker via fork, see `cluster.fork`" },
        { name: "worker-delay", type: "int", descr: "Delay in milliseconds for a worker before it will start accepting jobs, for cases when other dependencies may take some time to start" },
        { name: "worker-queue", type: "list", onupdate: function() { if (ipc.role=="worker"&&core.role=="worker") this.subscribeWorker()}, descr: "Queue(s) to subscribe for workers, multiple queues can be processes at the same time, i.e. more than one job can run from different queues" },
        { name: "worker-options-(.+)", obj: "workerOptions", make: "$1", type: "json", descr: "Custom parameters by queue name, passed to `cache.subscribeQueue` on worker start, useful with channels, ex: `-jobs-worker-options-nats#events {\"count\":10}`" },
        { name: "max-runtime", type: "int", min: 0, descr: "Max number of seconds a job can run before being killed" },
        { name: "max-lifetime", type: "int", min: 0, descr: "Max number of seconds a worker can live, after that amount of time it will exit once all the jobs are finished, 0 means indefinitely" },
        { name: "shutdown-timeout", type: "int", min: 500, descr: "Max number of milliseconds to wait for the graceful shutdown sequence to finish, after this timeout the process just exits" },
        { name: "cron-queue", type: "list", min: 1, descr: "Default queue to use for cron jobs" },
        { name: "global-queue", type: "list", min: 1, descr: "Default queue for all jobs, the queueName is ignored" },
        { name: "global-ignore", type: "list", array: 1, descr: "Queue names which ignore the global setting, the queueName is used as usual, local and worker are ignored by default" },
        { name: "cron", type: "bool", descr: "Allow cron jobs to be executed from the local etc/crontab file or via config parameter" },
        { name: "schedule", type: "json", onupdate: function() { if (core.role == "master" && this.cron) this.scheduleCronjobs("config", this.schedule) }, logger: "error", descr: "Cron jobs to be scheduled, the JSON must be in the same format as crontab file, cron format by https://croner.56k.guru" },
        { name: "unique-queue", descr: "Default queue name to use for keeping track of unique jobs" },
        { name: "unique-ignore", type: "regexp", descr: "Ignore all unique parameters if a job's uniqueKey matches" },
        { name: "unique-set-ttl-([0-9]+)", type: "regexp", obj: "uniqueSetTtl", make: "$1", descr: "Override unique TTL to a new value if matches the unique key, ex: -jobs-unique-ttl-100 KEY" },
        { name: "unique-logger", descr: "Log level for unique error conditions" },
        { name: "retry-visibility-timeout", type: "map", maptype: "int", descr: "Visibility timeout by error code >= 500 for queues that support it" },
        { name: "task-ignore", type: "regexp", descr: "Ignore matched tasks" },
    ],

    jobRx: /^[a-z0-9_]+\.[a-z0-9_]+$/i,
    // List of running jobs for a worker
    runningJobs: [],
    exiting: 0,
    // Time of the last update on jobs and tasks
    runTime: 0,
    // Schedules cron jobs
    crontab: [],
    subscribed: new Set(),
    maxRuntime: 900,
    checkRuntime: 0,
    maxLifetime: 3600 * 12,
    shutdownTimeout: 10000,
    uniqueError: "non-unique condition",
    workers: -1,
    workerDelay: 500,
    workerQueue: [],
    workerCpuFactor: 2,
    workerArgs: [],
    workerEnv: {},
    workerOptions: {},
    globalIgnore: ["local", "worker"],
    properties: [
        "noWait", "noWaitTimeout",
        "noVisibility", "visibilityTimeout", "retryVisibilityTimeout",
        "stopOnError",
        "startTime", "endTime",
        "uniqueTtl", "uniqueKey", "uniqueKeep",
        "uniqueLogger", "uniqueDrop", "uniqueOnce",
        "maxRuntime"
    ],
    metrics: {
        que: new metrics.Histogram(),
        running: 0,
        err_count: 0,
    },
};

module.exports = mod;

// Initialize jobs processing in the master process
mod.configureMaster = function(options, callback)
{
    if (options.noJobs || !core.isOk("jobs")) return callback();
    this.initServer(options, callback);
}

// Initialize a worker to be ready for jobs to execute, in instance mode setup timers to exit on no activity.
mod.configureWorker = function(options, callback)
{
    if (options.noJobs || this.workers < 0 || !core.isOk("jobs")) return callback();
    this.initWorker(options, callback);
}

// Perform graceful worker shutdown, to be used for workers restart
mod.shutdownWorker = function(options, callback)
{
    logger.log("shutdownWorker:", this.name, "queue:", this.workerQueue, "max-runtime:", this.maxRuntime, "max-lifetime:", this.maxLifetime, options);

    // Stop accepting messages from the queues
    for (const q of this.workerQueue) cache.unsubscribeQueue({ queueName: q });

    setTimeout(callback, options?.shutdownTimeout || this.shutdownTimeout);
}

// Perform graceful worker shutdown and then exit the process
mod.exitWorker = function(options)
{
    if (this.exiting++) return;
    core.runMethods("shutdownWorker", options, { parallel: 1, direct: 1 }, () => {
        process.exit(99);
    });
}

// Initialize a master that will manage jobs workers
mod.initServer = function(options, callback)
{
    // Setup background tasks from the crontab
    if (this.cron) {
        if (this.workers < 0) ipc.initWorker();
        this.loadCronjobs();
        if (this.schedule) this.scheduleCronjobs("config", this.schedule);
    }

    if (this.workers < 0) return typeof callback == "function" && callback();

    ipc.initServer();

    // Start queue monitors if needed
    for (const name of this.workerQueue) {
        cache.monitorQueue(lib.objExtend(mod.workerOptions[name], { queueName: name }));
    }

    // Launch the workers
    var workers = this.workers || Math.round(core.maxCPUs * (this.workerCpuFactor || 1));
    for (let i = 0; i < workers; i++) cluster.fork(this.workerEnv);

    logger.log("initServer:", this.name, "started", core.role, core.workerId || process.pid, "workers:", workers, "cron:", this.cron);
    if (typeof callback == "function") callback();
}

// Initialize a worker for processing jobs
mod.initWorker = function(options, callback)
{
    ipc.initWorker();

    setInterval(this.checkTimes.bind(this), 30000);

    // Mark a jobs for cancellation
    ipc.on('jobs:cancel', mod.markCancelled.bind(mod));

    // Restart signal from the master process
    ipc.on("worker:restart", () => {
        mod.exitWorker({ shutdownReason: "restart" });
    });

    // A job to process from the master (worker driver)
    ipc.on("worker:job", (msg) => {
        mod.processJobMessage("#worker", msg);
    });

    // Randomize subscription when multiple workers start at the same time, some queue drivers use polling
    setTimeout(() => {
        this.subscribeWorker();
        logger.log("initWorker:", this.name, "started", core.role, core.workerId || process.pid, "queue:", this.subscribed, "maxRuntime:", this.maxRuntime, "maxLifetime:", this.maxLifetime);
    }, lib.toNumber(this.workerDelay) + lib.randomShort()/1000);

    if (typeof callback == "function") callback();
}

mod.subscribeWorker = function()
{
    // Always use the default queue if nothing specified but a job worker is running
    if (!this.workerQueue.length) this.workerQueue.push("queue");

    for (const name of this.workerQueue) {
        // Unsubscribed if started with -
        if (/^[!-]/.test(name)) {
            mod.unsubscribeQueue(name.substr(1));
            continue;
        }
        // Prevent subscription more than once to the same queue in case of invalid or nonexistent queues
        var q = cache.getQueue(name);
        if (this.subscribed.has(q.canonical(name))) continue;
        var qopts = lib.objExtend({ queueName: name }, this.workerOptions[name]);
        cache.subscribeQueue(qopts, this.processJobMessage.bind(this, name));
        this.subscribed.add(q.canonical(name));
        logger.info("subscribeWorker:", this.name, q.name, name);
    }
}

mod.unsubscribeQueue = function(name)
{
    const q = cache.getClient(name);
    if (!this.subscribed.delete(q.canonical(name))) return;
    cache.unsubscribeQueue({ queueName: name });
    logger.info("unsubscribeQueue:", this.name, q.name, name);
}

mod.processJobMessage = function(name, msg, next)
{
    if (typeof next != "function") next = lib.noop;
    var opts = { queue: name, message: msg, stopOnError: 1, direct: true, stime: Date.now() };
    core.runMethods("configureJob", opts, (err) => {
        if (err) return next(err);

        const _timer = cache.getQueue(name).metrics.que.start();
        mod.runJob(opts.message, { queueName: name }, (err) => {
            _timer.end();
            opts.error = err;
            opts.parallel = 1;
            opts.etime = Date.now();
            opts.elapsed = opts.etime - opts.stime;
            if (err) {
                logger.logger(err.status >= 600 ? err.logger || "warn" : !err.status || err.status < 200 || err.status > 299 ? "error" : "info", "endJob:", name, lib.traceError(err), opts.message, opts.elapsed, "ms");
            } else {
                logger.logger(opts.message.logger || "debug", "endJob:", name, opts.message, opts.elapsed, "ms");
            }
            core.runMethods("finishJob", opts, () => { next(err) });
            // Mark end of last message processed
            mod.runTime = Date.now();
            mod.checkTimes();
        });
    });
}

// Mark all running jobs with the cancel key, it is up to any job to check for cancel keys and exit
mod.markCancelled = function(msg)
{
    if (!msg?.key) return;
    for (const job of this.runningJobs) {
        job.cancelKey = lib.toFlags("add", job.cancelKey, msg.key);
    }
    logger.info("markCancelled:", this.runningJobs.length, msg);
}

// Returns true if a cancel job key is set, this is called inside a job
mod.isCancelled = function(key)
{
    if (!key) return this.exiting;
    for (const job of this.runningJobs) {
        if (lib.isFlag(job?.cancelKey, key)) return 1;
    }
    return this.exiting;
}

// Find the max runtime allowed in seconds
mod.getMaxRuntime = function()
{
    return this.runningJobs.reduce((m, x) => (Math.max(m, x.maxRuntime || 0)), this.maxRuntime) * 1000;
}

// Return a list of unique job names currently running
mod.getRunningJobs = function()
{
    var jobs = {};
    for (const job of this.runningJobs) {
        for (const p in job.job) jobs[p] = 1;
    }
    return Object.keys(jobs);
}

// Check how long we run a job and force kill if exceeded, check if total life time is exceeded.
//
// If exit is required the `shundownWorker` methods will receive options with `shutdownReason` property
// set and the name-sake property will contained the value exceeded.
mod.checkTimes = function()
{
    var now = Date.now();
    if (this.runningJobs.length) {
        var maxRuntime = this.getMaxRuntime();
        if (maxRuntime > 0) {
            var badJobs = this.runningJobs.filter((x) => (now - x.jobTime > maxRuntime));
            // Stuck jobs can run much longer if we are still processing other small jobs
            if (badJobs.length) {
                if (this.runningJobs.length == badJobs.length) {
                    logger.warn('checkLifetime:', 'jobs: exceeded max run time', maxRuntime, badJobs);

                    // Notify all queues about bad jobs to be dropped completely
                    for (const job of badJobs) cache.unpublishQueue(job, { queueName: job.jobQueue });
                    return this.exitWorker({ jobs: badJobs, shutdownReason: "maxRuntime", maxRuntime: maxRuntime });
                } else
                if (now - this.checkRuntime > maxRuntime) {
                    logger.warn('checkLifetime:', 'jobs: exceeded max run time but other jobs still running', maxRuntime, badJobs);
                }
                this.checkRuntime = Date.now();
            }
        }
    } else {
        // Idle mode, check max life time
        if (this.maxLifetime > 0 && now - core.ctime + lib.randomShort() > this.maxLifetime * 1000) {
            logger.log('checkLifetime:', 'jobs: exceeded max life time', this.maxLifetime);
            return this.exitWorker({ shutdownReason: "maxLifetime", maxLifetime: this.maxLifetime * 1000 });
        }
    }
}

// Make sure the job is valid and has all required fields, returns a normalized job object or an error, the jobspec
// must be in the following formats:
//
//        "module.method"
//        { job: { "module.method": {}, .... } }
//
// any task in string format "module.method" will be converted into { "module.method: {} } automatically
//
mod._badJob = function(jobspec)
{
    return lib.newError('Invalid job: ' + lib.objDescr(jobspec), 400, "InvalidJob");
}

mod.isJob = function(jobspec)
{
    if (typeof jobspec == "string" && this.jobRx.test(jobspec)) jobspec = { job: { [jobspec]: {} } };
    if (!lib.isObject(jobspec)) return this._badJob(jobspec);

    if (typeof jobspec.job == "string") jobspec.job = { [jobspec.job]: {} };

    if (lib.isObject(jobspec.job)) {
        if (!Object.keys(jobspec.job).every((y) => (mod.jobRx.test(y)))) {
            return this._badJob(jobspec);
        }
    } else {
        return this._badJob(jobspec);
    }
    return jobspec;
}

// Apply special job properties from the options
mod.checkOptions = function(jobspec, options)
{
    if (!jobspec || !options) return;
    for (const p of this.properties) {
        if (typeof jobspec[p] == "undefined" && typeof options[p] != "undefined") jobspec[p] = options[p];
    }
}

// Submit a job for execution, it will be saved in a queue and will be picked up later and executed.
// The queue and the way how it will be executed depends on the configured queue. See `isJob` for
// the format of the job objects.
//
// `jobspec.uniqueTtl` if greater than zero it defines number of milliseconds for this job to stay in the queue or run,
// it creates a global lock using the job object as the hash key, no other job can be run until the ttl expires or the job
// finished, non unique jobs will be kept in the queue and repeated later according to the `visibilityTimeout` setting.
//
// `jobspec.uniqueKey` can define an alternative unique key for this job for cases when different jobs must be run sequentially
//
// `jobspec.uniqueKeep` if true then keep the unique lock after the jobs finished, otherwise it is cleared
//
// `jobspec.uniqueDrop` if true will make non-unique jobs to be silently dropped instead of keeping them in the queue
//
// `jobspec.logger` defines the logger level which will be used to log when the job is finished, default is debug
//
// `jobspec.maxRuntime` defines max number of seconds this job can run, if not specified then the queue default is used
//
// `jobspec.uniqueOnce` if true than the visibility timeout is not kept alive while the job is running
//
// `jobspec.noWait` will run the job and delete it from the queue immediately, not at the end, for one-off jobs
//
// `jobspec.noWaitTimeout` number of seconds before deleting the job for one-off jobs but taking into account the uniqueKey and visibility timeout giving time
//  to check for uniqueness and exit, can be used regardless of the noWait flag
//
// `jobspec.noVisibility` will always delete messages after processing, ignore 600 errors as well
//
// `jobspec.visibilityTimeout` custom timeout for how long to keep this job invisible, overrides the default timeout
//
// `jobspec.retryVisibilityTimeout` an object with custom timeouts for how long to keep this job invisible by error status which results in keeping tasks in the queue for retry
//
// `jobspec.stopOnError` will stop tasks processing on first error, otherwise all errors will be just logged. Errors with status >= 600 will
//  stop the job regardless of this flag
//
// `jobspec.startTime` and/or `jobspec.endTime` will define the time period during whihc this job is allowed to run, if
//  outside the period it will be dropped
//
// `options.delay` is only supported by SQS currently, it delays the job execution for the specified amount of ms
//
// `options.dedup_ttl` - if set it defines number of ms to keep track of duplicate messages, it tries to preserver only-once behaviour. To make
//  some queue to automatically use dedup mode it can be set in the queue options: `-queue[-NAME]-options-dedup_ttl 86400000`.
//  Note: `uniqueTtl` settings take precedence and if present dedup is ignored.
//
mod.submitJob = function(jobspec, options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    jobspec = this.isJob(jobspec);
    if (util.types.isNativeError(jobspec)) {
        return lib.tryCall(callback, jobspec);
    }

    var qname = options?.queueName;

    // We deal with queue lists here due to the round-robin processing, cannot call getClient multiple
    // times with a list because it returns the next queue with every call, so we get the next queue here
    // and pass just the name
    if (this.globalQueue && !lib.isFlag(this.globalIgnore, qname)) {
        qname = this.globalQueue;
    }
    var queue = cache.getQueue(qname);

    // Ignore duplicate messages
    var ttl = lib.toNumber(queue.options.dedup_ttl || options?.dedup_ttl);
    if (ttl > 0) {
        jobspec.dedup = `${ttl}-${lib.uuid()}`;
    }

    // Keep track where the job is originated
    jobspec.origin = `${core.role}:${process.pid}:${core.ipaddr}:${core.instance.tag || ""}:${Date.now()}`;
    logger.debug("submitJob:", jobspec, "OPTS:", options);
    this.checkOptions(jobspec, options);

    // Use global timeouts if not specified
    if (lib.isEmpty(jobspec.retryVisibilityTimeout) && this.retryVisibilityTimeout) {
        jobspec.retryVisibilityTimeout = this.retryVisibilityTimeout;
    }
    // Queue unique ttl
    if (lib.isEmpty(jobspec.uniqueTtl) && queue.options.uniqueTtl) {
        jobspec.uniqueTtl = queue.options.uniqueTtl;
    }

    options = lib.objClone(options, "queueName", queue.queueName);
    cache.publishQueue(jobspec, options, callback);
}

// Run all tasks in the job object
mod.runJob = function(jobspec, options, callback)
{
    var queue = options?.queueName;

    logger.debug("runJob:", queue, jobspec);

    jobspec = this.isJob(jobspec);
    if (util.types.isNativeError(jobspec)) {
        return lib.tryCall(callback, jobspec);
    }
    var timer, ttl, key;

    lib.series([
        function(next) {
            // Make sure we do not have this job in the queue
            ttl = lib.toNumber(jobspec.uniqueTtl, { min: 0 });
            if (ttl && lib.testRegexp(jobspec.uniqueKey, mod.uniqueIgnore)) ttl = 0;
            if (ttl && mod.uniqueSetTtl) {
                // Managing throughput by changing ttl
                for (const p in mod.uniqueSetTtl) {
                    if (lib.testRegexp(jobspec.uniqueKey, mod.uniqueSetTtl[p])) {
                        ttl = lib.toNumber(p);
                        break;
                    }
                }
            }
            if (!ttl) {
                // Use dedup if present, simulate unique properties
                if (jobspec.dedup) {
                    ttl = lib.toNumber(jobspec.dedup);
                    jobspec.uniqueKey = jobspec.dedup;
                    jobspec.uniqueDrop = jobspec.uniqueKeep = jobspec.uniqueOnce = 1;
                }
                if (!ttl) return next();
            }
            key = jobspec.uniqueKey = jobspec.uniqueKey || lib.hash(lib.stringify(jobspec.job), "sha256");
            cache.lock("JOB:" + key, { ttl: ttl, queueName: mod.uniqueQueue }, (err, locked) => {
                // If the queue service is down keep all messages in the queue until it is up again
                if (!locked) {
                    if (!err && jobspec.uniqueDrop) {
                        logger.logger(jobspec.uniqueLogger || mod.uniqueLogger || "info", "runJob:", "dropped", queue, jobspec);
                        ipc.emitMsg("jobs:dropped", { job: jobspec, queueName: queue });
                        return lib.tryCall(callback, { status: 200, message: "dropped" });
                    }
                    err = { status: 600, message: err || mod.uniqueError, logger: jobspec.uniqueLogger || mod.uniqueLogger || "debug" };
                    ipc.emitMsg("jobs:nolock", { job: jobspec, queueName: queue, err: err });
                } else
                if (!err && !jobspec.uniqueOnce) {
                    // Keep the lock active while the job is running
                    timer = setInterval(function() {
                        cache.lock("JOB:" + key, { ttl: ttl, queueName: mod.uniqueQueue, set: 1 });
                    }, Math.max(ttl * 0.7, 1000));
                }
                logger.debug("runJob:", queue, cache.getQueue(mod.uniqueQueue).name, "locked:", locked, "ttl:", ttl, "key:", key, "JOB:", jobspec)
                next(err);
            });
        },
        function(next) {
            ipc.emitMsg("jobs:started", { job: jobspec, queueName: queue });

            jobspec.jobQueue = queue;
            jobspec.jobTime = Date.now();
            mod.runningJobs.push(jobspec);
            if (cluster.isWorker) process.title = `${core.name}: worker ${mod.getRunningJobs()}`;

            lib.forEvery(Object.keys(jobspec.job), (task, next2) => {
                mod._runTask(task, jobspec, options, (err) => {
                    // Stop the task, have to wait till all subtasks stop to avoid race conditions.
                    // All 600 errors are propagated regardless of the flag
                    if (!jobspec.error || err?.status >= 600) jobspec.error = err;
                    next2();
                });
            }, () => {
                var idx = mod.runningJobs.indexOf(jobspec);
                if (idx > -1) mod.runningJobs.splice(idx, 1);
                if (cluster.isWorker) process.title = `${core.name}: worker ${mod.getRunningJobs()}`;

                clearInterval(timer);
                if (ttl && key && !jobspec.uniqueKeep) {
                    cache.unlock("JOB:" + key, { queueName: mod.uniqueQueue });
                }
                ipc.emitMsg("jobs:stopped", { job: jobspec, queueName: queue });

                next(jobspec.error);
            });
        },
    ], callback, true);
}

// Send a cancellation request for given key to all workers
mod.cancelJob = function(key, callback)
{
    ipc.broadcast(core.name + ":worker", ipc.newMsg("jobs:cancel", { key: key }), callback);
}

// Execute a task by name, the `options` will be passed to the function as the first argument, calls the callback on finish or error
mod._runTask = function(name, jobspec, options, callback)
{
    var task = jobspec.job[name];

    if (this.taskIgnore && this.taskIgnore.test(name)) {
        logger.error("runTask:", options?.queueName, name, "task ignored", task, "RX:",this.taskIgnore);
        return callback(lib.newError("Task ignored: " + name, 499, "TaskIgnored"));
    }

    var method = name.split('.');
    var module = method[0] == "core" ? core : core.modules[method[0]];
    if (!module || typeof module[method[1]] != "function") {
        logger.error("runTask:", options?.queueName, name, "unknown method", task);
        return callback(lib.newError("Unknown method: " + name, 499, "UnknownMethod"));
    }
    if (!lib.isObject(task)) task = {};

    this.metrics.running++;

    var d = domain.create();
    d.on("error", (err) => {
        mod._finishTask(err, name, jobspec, options, callback);
    });
    d.run(function() {
        logger.debug('runTask:', 'started', name, task);
        mod.runTime = Date.now();
        ipc.emitMsg("jobs:task:started", { name: name, job: task, queueName: options?.queueName });

        module[method[1]](task, (err) => {
            mod._finishTask(err, name, jobspec, options, callback);
        });
    });
}

// Complete task execution, cleanup and update the status
mod._finishTask = function(err, name, jobspec, options, callback)
{
    var task = jobspec.job[name];

    if (err && !(err.status >= 200 && err.status < 300)) {
        mod.metrics.err_count++;
        logger.logger(err.status >= 400 || util.types.isNativeError(err) ? "error" : "info", 'endTask:', options.queueName, name, lib.traceError(err), task);
    } else {
        logger.debug('endTask:', options.queueName, name, err, task);
    }
    this.metrics.que.update(Date.now() - jobspec.jobTime);
    this.metrics.running--;
    this.runTime = Date.now();

    ipc.emitMsg("jobs:task:stopped", { name: name, job: task, queueName: options.queueName, err: err });
    callback(err);
}

// Create a new cron job, for remote jobs additional property args can be used in the object to define
// arguments for the instance backend process, properties must start with -
//
// Example:
//
//          { "cron": "0 */10 * * * *", "croner": { maxRun: 3 }, job": "server.processQueue" },
//          { "cron": "0 */30 * * * *", "job": { "server.processQueue": { name: "queue1" } } },
//          { "cron": "0 5 * * * *", "job": [ { "scraper.run": { "url": "host1" } }, { "scraper.run": { "url": "host2" } } ] }
//
mod.scheduleCronjob = function(jobspec)
{
    jobspec = this.isJob(jobspec);
    if (util.types.isNativeError(jobspec)) {
        logger.error("scheduleCronjob:", "invalid", jobspec);
        return false;
    }
    if (lib.toBool(jobspec.disabled)) {
        return false;
    }
    logger.debug('scheduleCronjob:', jobspec);
    try {
        if (!this.croner) this.croner = require('croner');
        var cj = new this.croner.Cron(jobspec.cron, jobspec.croner || {}, (job) => {
            mod.submitJob(job.jobspec, { queueName: job.jobspec.queueName || mod.cronQueue }, (err) => {
                if (err) logger.error("scheduleCronjob:", err, job.jobspec);
            });
        });
        cj.jobspec = jobspec;
        this.crontab.push(cj);
        return true;
    } catch (e) {
        logger.error("scheduleCronjob:", e, jobspec);
        return false;
    }
}

// Schedule a list of cron jobs, types is used to cleanup previous jobs for the same type for cases when
// a new list needs to replace the existing jobs. Empty list does nothing, to reset the jobs for the particular type and
// empty invalid jobs must be passed, like: ```[ {} ]```
//
// Returns number of cron jobs actually scheduled.
mod.scheduleCronjobs = function(type, list)
{
    if (!Array.isArray(list)) return 0;
    this.crontab = this.crontab.filter((cj) => {
        if (cj.jobspec._type != type) return 1;
        cj.stop();
        return 0;
    });
    var n = 0
    list.forEach((js) => {
        js._type = type;
        if (mod.scheduleCronjob(js)) n++;
    });
    return n;
}

// Load crontab from JSON file as list of job specs:
// - cron - cron time interval spec: 'second' 'minute' 'hour' 'dayOfMonth' 'month' 'dayOfWeek'
// - croner - optional object with additional properties for the Croner object
// - job - a string as obj.method or an object with job name as property name and the value is an object with
//    additional jobspec for the job passed as first argument, a job callback always takes jobspec and callback as 2 arguments
// - disabled - disable the job but keep in the cron file, it will be ignored
// - queueName - name of the queue where to submit this job, if not given it uses cron-queue
// - uniqueTtl - defines that this job must be the only one in the queue for the number of milliseconds specified, after that
//    time another job with the same arguments can be submitted.
//
// The expressions used by Croner(https://croner.56k.guru) are very similar to those of Vixie Cron, but with a few additions and changes as outlined below:
//
// ┌──────────────── (optional) second (0 - 59)
// │ ┌────────────── minute (0 - 59)
// │ │ ┌──────────── hour (0 - 23)
// │ │ │ ┌────────── day of month (1 - 31)
// │ │ │ │ ┌──────── month (1 - 12, JAN-DEC)
// │ │ │ │ │ ┌────── day of week (0 - 6, SUN-Mon)
// │ │ │ │ │ │       (0 to 6 are Sunday to Saturday; 7 is Sunday, the same as 0)
// │ │ │ │ │ │
// * * * * * *
//
// Example:
//
//          [ { cron: "0 0 * * * *", job: "scraper.run" }, ..]
//
mod.loadCronjobs = function()
{
    fs.readFile(core.path.etc + "/crontab", (err, data) => {
        mod.parseCronjobs("crontab", data);

        fs.readFile(core.path.etc + "/crontab.local", (err, data) => {
            mod.parseCronjobs("crontab.local", data);
        });
    });

    // Watch config directory for changes
    if (this.cronWatcher) return;
    this.cronWatcher = fs.watch(core.path.etc, (event, filename) => {
        if (/crontab/.test(filename)) core.setTimeout(filename, mod.loadCronjobs.bind(mod), 5000);
    });
}

// Parse a JSON data with cron jobs and schedule for the given type, this can be used to handle configuration properties
mod.parseCronjobs = function(type, data)
{
    if (Buffer.isBuffer(data)) data = data.toString();
    if (typeof data != "string" || !data.length) return;
    var hash = lib.hash(data);
    if (!this._hash) this._hash = {};
    if (this._hash[type] == hash) return;
    this._hash[type] = hash;
    var n = this.scheduleCronjobs(type, lib.jsonParse(data, { datatype: "list", logger: "error" }));
    logger.info("parseCronjobs:", type, n, "jobs");
}
