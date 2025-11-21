/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const cluster = require('cluster');
const domain = require('domain');
const util = require('util');
const modules = require(__dirname + '/modules');
const app = require(__dirname + '/app');
const lib = require(__dirname + '/lib');
const logger = require(__dirname + '/logger');
const ipc = require(__dirname + '/ipc');
const queue = require(__dirname + '/queue');
const cache = require(__dirname + '/cache');
const metrics = require(__dirname + '/metrics');

/**
 * @module jobs
 */

const jobs = {
    name: "jobs",
    // Config parameters
    args: [
        { name: "cap-(.+)", type: "int", strip: "cap-", descr: "Capability parameters" },
        { name: "workers", type: "number", min: -1, max: 32, descr: "How many worker processes to launch to process the job queue, -1 disables jobs, 0 means launch as many as the CPUs available" },
        { name: "worker-cpu-factor", type: "real", min: 0, descr: "A number to multiply the number of CPUs available to make the total number of workers to launch, only used if `workers` is 0" },
        { name: "worker-env", type: "map", logger: "warn", descr: "Environment to be passed to the worker via fork, see `cluster.fork`" },
        { name: "worker-delay", type: "int", descr: "Delay in milliseconds for a worker before it will start accepting jobs, for cases when other dependencies may take some time to start" },
        { name: "worker-queue", type: "list", onupdate: function() { if (ipc.role=="worker"&&app.role=="worker") this.subscribeWorker()}, descr: "Queue(s) to subscribe for workers, multiple queues can be processes at the same time, i.e. more than one job can run from different queues" },
        { name: "worker-options-(.+)", obj: "workerOptions", make: "$1", type: "json", descr: "Custom parameters by queue name, passed to `queue.subscribeQueue` on worker start, useful with channels, ex: `-jobs-worker-options-nats#events {\"count\":10}`" },
        { name: "max-runtime", type: "int", min: 0, descr: "Max number of seconds a job can run before being killed" },
        { name: "max-lifetime", type: "int", min: 0, descr: "Max number of seconds a worker can live, after that amount of time it will exit once all the jobs are finished, 0 means indefinitely" },
        { name: "shutdown-timeout", type: "int", min: 500, descr: "Max number of milliseconds to wait for the graceful shutdown sequence to finish, after this timeout the process just exits" },
        { name: "cron-queue", type: "list", min: 1, descr: "Default queue to use for cron jobs" },
        { name: "global-queue", type: "list", min: 1, descr: "Default queue for all jobs, the queueName is ignored" },
        { name: "global-ignore", type: "list", array: 1, descr: "Queue names which ignore the global setting, the queueName is used as usual, local and worker are ignored by default" },
        { name: "cron", type: "bool", descr: "Allow cron jobs to be executed from the local etc/crontab file or via config parameter" },
        { name: "cron-file", descr: "File with cron jobs in JSON format" },
        { name: "schedule", type: "json", onupdate: function() { if (app.role == "master" && this.cron) this.scheduleCronjobs("config", this.schedule) }, logger: "error", descr: "Cron jobs to be scheduled, the JSON must be in the same format as crontab file, cron format by https://croner.56k.guru" },
        { name: "unique-cache", descr: "Default cache name to use for keeping track of unique jobs" },
        { name: "unique-ignore", type: "regexp", descr: "Ignore all unique parameters if a job's uniqueKey matches" },
        { name: "unique-set-ttl-([0-9]+)", type: "regexp", obj: "uniqueSetTtl", make: "$1", descr: "Override unique TTL to a new value if matches the unique key, ex: -jobs-unique-ttl-100 KEY" },
        { name: "unique-logger", descr: "Log level for unique error conditions" },
        { name: "retry-visibility-timeout", type: "map", maptype: "int", descr: "Visibility timeout by error code >= 500 for queues that support it" },
        { name: "task-ignore", type: "regexp", descr: "Ignore matched tasks" },
    ],

    jobRx: /^[a-z0-9_.]+\.[a-z0-9_]+$/i,
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

/**
 * Job queue processor
 *
 * When launched with `jobs-workers` parameter equal or greater than 0, the master spawns a number of workers which subscribe to
 * configured job queues or the default queue and listen for messages.
 *
 * A job message is an object that defines what method from which module to run with the options as the first argument and a callback as the second.
 *
 * Multiple job queues can be defined and processed at the same time.
 *
 * By default `local` and `worker` queues are always created and ready to be used, jobs sent to local always run inside the local process
 * but jobs sent to worker queue will be run in a worker.
 *
 * A job can be in the following formats:
 *
 *  ```"module.method"```
 *  ```{ job: { "module.method": {}, .... } }```
 *
 *  any task in string format "module.method" will be converted into { "module.method: {} } automatically
 *
 */

module.exports = jobs;

// Initialize jobs processing in the master process
jobs.configureMaster = function(options, callback)
{
    if (options.noJobs || !app.isOk("jobs")) return callback();
    this.initServer(options, callback);
}

// Initialize a worker to be ready for jobs to execute, in instance mode setup timers to exit on no activity.
jobs.configureWorker = function(options, callback)
{
    if (options.noJobs || this.workers < 0 || !app.isOk("jobs")) return callback();
    this.initWorker(options, callback);
}

jobs.shutdown = function(options, callback)
{
    clearInterval(jobs._checkTimer);
    lib.tryCall(callback);
}

// Perform graceful worker shutdown, to be used for workers restart
jobs.shutdownWorker = function(options, callback)
{
    logger.log("shutdownWorker:", this.name, "queue:", this.workerQueue, "max-runtime:", this.maxRuntime, "max-lifetime:", this.maxLifetime, options);

    // Stop accepting messages from the queues
    for (const q of this.workerQueue) queue.unlisten({ queueName: q });

    setTimeout(callback, options?.shutdownTimeout || this.shutdownTimeout);
}

// Perform graceful worker shutdown and then exit the process
jobs.exitWorker = function(options)
{
    if (this.exiting++) return;
    app.runMethods("shutdownWorker", options, { parallel: 1, direct: 1 }, () => {
        process.exit(99);
    });
}

// Initialize a master that will manage jobs workers
jobs.initServer = function(options, callback)
{
    // Setup background tasks from the crontab
    if (this.cron) {
        if (this.workers < 0) ipc.initWorker();
        this.loadCronjobs();
        if (this.schedule) {
            this.scheduleCronjobs("config", this.schedule);
        }
    }

    if (this.workers < 0) return typeof callback == "function" && callback();

    ipc.initServer();

    // Start queue monitors if needed
    for (const name of this.workerQueue) {
        queue.monitor(lib.objExtend(jobs.workerOptions[name], { queueName: name }));
    }

    // Launch the workers
    var workers = this.workers || Math.round(app.maxCPUs * (this.workerCpuFactor || 1));
    for (let i = 0; i < workers; i++) {
        cluster.fork(this.workerEnv);
    }

    logger.log("initServer:", this.name, "started", app.role, app.workerId || process.pid, "workers:", workers, "cron:", this.cron);

    if (typeof callback == "function") callback();
}

// Initialize a worker for processing jobs
jobs.initWorker = function(options, callback)
{
    ipc.initWorker();

    this._checkTimer = setInterval(this.checkTimes.bind(this), 30000);

    // Mark a jobs for cancellation
    ipc.on('jobs:cancel', jobs.markCancelled.bind(jobs));

    // Restart signal from the master process
    ipc.on("worker:restart", () => {
        jobs.exitWorker({ shutdownReason: "restart" });
    });

    // A job to process from the master (worker driver)
    ipc.on("worker:job", (msg) => {
        jobs.processJobMessage("#worker", msg);
    });

    // Randomize subscription when multiple workers start at the same time, some queue drivers use polling
    setTimeout(() => {
        this.subscribeWorker();
        logger.log("initWorker:", this.name, "started", app.role, app.workerId || process.pid, "queue:", this.subscribed, "maxRuntime:", this.maxRuntime, "maxLifetime:", this.maxLifetime);
    }, lib.toNumber(this.workerDelay) + lib.randomShort()/1000);

    if (typeof callback == "function") callback();
}

jobs.subscribeWorker = function()
{
    // Always use the default queue if nothing specified but a job worker is running
    if (!this.workerQueue.length) this.workerQueue.push("queue");

    for (const name of this.workerQueue) {
        // Unsubscribed if started with -
        if (/^[!-]/.test(name)) {
            this.unsubscribeQueue(name.substr(1));
            continue;
        }
        // Prevent subscription more than once to the same queue in case of invalid or nonexistent queues
        var q = queue.getQueue(name);
        if (this.subscribed.has(q.canonical(name))) continue;
        var qopts = lib.objExtend({ queueName: name }, this.workerOptions[name]);
        queue.listen(qopts, this.processJobMessage.bind(this, name));
        this.subscribed.add(q.canonical(name));
        logger.info("subscribeWorker:", this.name, q.name, name);
    }
}

jobs.unsubscribeQueue = function(name)
{
    const q = queue.getClient(name);
    if (!this.subscribed.delete(q.canonical(name))) return;
    queue.unlisten({ queueName: name });
    logger.info("unsubscribeQueue:", this.name, q.name, name);
}

jobs.processJobMessage = function(name, msg, next)
{
    if (typeof next != "function") next = lib.noop;
    var opts = { queue: name, message: msg, stopOnError: 1, direct: true, stime: Date.now() };
    app.runMethods("configureJob", opts, (err) => {
        if (err) return next(err);

        const _timer = queue.getQueue(name).metrics.start();
        jobs.runJob(opts.message, { queueName: name }, (err) => {
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
            app.runMethods("finishJob", opts, () => { next(err) });
            // Mark end of last message processed
            jobs.runTime = Date.now();
            jobs.checkTimes();
        });
    });
}

// Mark all running jobs with the cancel key, it is up to any job to check for cancel keys and exit
jobs.markCancelled = function(msg)
{
    if (!msg?.key) return;
    for (const job of this.runningJobs) {
        job.cancelKey = lib.toFlags("add", job.cancelKey, msg.key);
    }
    logger.info("markCancelled:", this.runningJobs.length, msg);
}

// Returns true if a cancel job key is set, this is called inside a job
jobs.isCancelled = function(key)
{
    if (!key) return this.exiting;
    for (const job of this.runningJobs) {
        if (lib.isFlag(job?.cancelKey, key)) return 1;
    }
    return this.exiting;
}

// Find the max runtime allowed in seconds
jobs.getMaxRuntime = function()
{
    return this.runningJobs.reduce((m, x) => (Math.max(m, x.maxRuntime || 0)), this.maxRuntime) * 1000;
}

// Return a list of unique job names currently running
jobs.getRunningJobs = function()
{
    var jobs = {};
    for (const job of this.runningJobs) {
        for (const p in job.job) jobs[p] = 1;
    }
    return Object.keys(jobs);
}

/**
 * Check how long we run a job and force kill if exceeded, check if total life time is exceeded.
 *
 * If exit is required the `shundownWorker` methods will receive options with `shutdownReason` property
 * set and the name-sake property will contained the value exceeded.
 */
jobs.checkTimes = function()
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
                    for (const job of badJobs) queue.unlisten(job, { queueName: job.jobQueue });
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
        if (this.maxLifetime > 0 && now - app.ctime + lib.randomShort() > this.maxLifetime * 1000) {
            logger.log('checkLifetime:', 'jobs: exceeded max life time', this.maxLifetime);
            return this.exitWorker({ shutdownReason: "maxLifetime", maxLifetime: this.maxLifetime * 1000 });
        }
    }
}

function _badJob(jobspec)
{
    return lib.newError('Invalid job: ' + lib.objDescr(jobspec), 400, "InvalidJob");
}

jobs.isJob = function(jobspec)
{
    if (typeof jobspec == "string" && this.jobRx.test(jobspec)) jobspec = { job: { [jobspec]: {} } };
    if (!lib.isObject(jobspec)) return _badJob(jobspec);

    if (typeof jobspec.job == "string") jobspec.job = { [jobspec.job]: {} };

    if (lib.isObject(jobspec.job)) {
        if (!Object.keys(jobspec.job).every((y) => (jobs.jobRx.test(y)))) {
            return _badJob(jobspec);
        }
    } else {
        return _badJob(jobspec);
    }
    return jobspec;
}

// Apply special job properties from the options
jobs.checkOptions = function(jobspec, options)
{
    if (!jobspec || !options) return;
    for (const p of this.properties) {
        if (typeof jobspec[p] == "undefined" && typeof options[p] != "undefined") jobspec[p] = options[p];
    }
}

/**
 * Submit a job for execution, it will be saved in a queue and will be picked up later and executed.
 * The queue and the way how it will be executed depends on the configured queue. See `isJob` for
 * the format of the job objects.
 * @param {object} jobspec - an object with jobs to run
 * @param {object} [options]
 * @param {int} [options.uniqueTtl] - if greater than zero it defines number of milliseconds for this job to stay in the queue or run,
 * it creates a global lock using the job object as the hash key, no other job can be run until the ttl expires or the job
 * finished, non unique jobs will be kept in the queue and repeated later according to the `visibilityTimeout` setting.
 *
 * @param {int} [options.uniqueKey] - can define an alternative unique key for this job for cases when different jobs must be run sequentially
 *
 * @param {int} [options.uniqueKeep] - if true then keep the unique lock after the jobs finished, otherwise it is cleared
 *
 * @param {int} [options.uniqueDrop] - if true will make non-unique jobs to be silently dropped instead of keeping them in the queue
 *
 * @param {int} [options.logger] - defines the logger level which will be used to log when the job is finished, default is debug
 *
 * @param {int} [options.maxRuntime] - defines max number of seconds this job can run, if not specified then the queue default is used
 *
 * @param {int} [options.uniqueOnce] - if true than the visibility timeout is not kept alive while the job is running
 *
 * @param {int} [options.noWait] - will run the job and delete it from the queue immediately, not at the end, for one-off jobs
 *
 * @param {int} [options.noWaitTimeout] - number of seconds before deleting the job for one-off jobs but taking into account the uniqueKey and visibility timeout giving time
 *  to check for uniqueness and exit, can be used regardless of the noWait flag
 *
 * @param {int} [options.noVisibility] - will always delete messages after processing, ignore 600 errors as well
 *
 * @param {int} [options.visibilityTimeout] - custom timeout for how long to keep this job invisible, overrides the default timeout
 *
 * @param {int} [options.retryVisibilityTimeout] - an object with custom timeouts for how long to keep this job invisible by error status which results in keeping tasks in the queue for retry
 *
 * @param {int} [options.stopOnError] - will stop tasks processing on first error, otherwise all errors will be just logged. Errors with status >= 600 will
 *  stop the job regardless of this flag
 *
 * @param {int} [options.startTime] - job must start only after this date, if started sooner it will be put back into the queue
 * @param {int{} [options.endTime] - job must not start after this date
 *
 * @param {int} [options.delay] - is only supported by SQS currently, it delays the job execution for the specified amount of ms
 * @param {int} [options.dedup_ttl] - if set it defines number of ms to keep track of duplicate messages, it tries to preserver only-once behaviour. To make
 *  some queue to automatically use dedup mode it can be set in the queue options: `-queue[-NAME]-options-dedup_ttl 86400000`.
 *  Note: `uniqueTtl` settings take precedence and if present dedup is ignored.
 * @callback callback
 * @memberOf module:jobs
 * @method submitJob
 */
jobs.submitJob = function(jobspec, options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    jobspec = this.isJob(jobspec);
    if (util.types.isNativeError(jobspec)) {
        return lib.tryCall(callback, jobspec);
    }

    var qname = options?.queueName;

    /*
     * We deal with queue lists here due to the round-robin processing, cannot call getClient multiple
     * times with a list because it returns the next queue with every call, so we get the next queue here
     * and pass just the name
     */
    if (this.globalQueue && !lib.isFlag(this.globalIgnore, qname)) {
        qname = this.globalQueue;
    }
    var q = queue.getQueue(qname);

    // Ignore duplicate messages
    var ttl = lib.toNumber(q.options.dedup_ttl || options?.dedup_ttl);
    if (ttl > 0) {
        jobspec.dedup = `${ttl}-${lib.uuid()}`;
    }

    // Keep track where the job is originated
    jobspec.origin = `${app.role}:${process.pid}:${app.ipaddr}:${app.instance.tag || ""}:${Date.now()}`;
    logger.debug("submitJob:", jobspec, "OPTS:", options, "Q:", q.name);
    this.checkOptions(jobspec, options);

    // Use global timeouts if not specified
    if (lib.isEmpty(jobspec.retryVisibilityTimeout) && this.retryVisibilityTimeout) {
        jobspec.retryVisibilityTimeout = this.retryVisibilityTimeout;
    }
    // Queue unique ttl
    if (lib.isEmpty(jobspec.uniqueTtl) && q.options.uniqueTtl) {
        jobspec.uniqueTtl = q.options.uniqueTtl;
    }

    options = Object.assign({}, options, { queueName: q.queueName });
    queue.submit(jobspec, options, callback);
}

// Run all tasks in the job object
jobs.runJob = function(jobspec, options, callback)
{
    var q = options?.queueName;

    logger.debug("runJob:", q, jobspec);

    jobspec = this.isJob(jobspec);
    if (util.types.isNativeError(jobspec)) {
        return lib.tryCall(callback, jobspec);
    }
    var timer, ttl, key;

    lib.series([
        function(next) {
            // Make sure we do not have this job in the queue
            ttl = lib.toNumber(jobspec.uniqueTtl, { min: 0 });
            if (ttl && lib.testRegexp(jobspec.uniqueKey, jobs.uniqueIgnore)) ttl = 0;
            if (ttl && jobs.uniqueSetTtl) {
                // Managing throughput by changing ttl
                for (const p in jobs.uniqueSetTtl) {
                    if (lib.testRegexp(jobspec.uniqueKey, jobs.uniqueSetTtl[p])) {
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
            cache.lock("JOB:" + key, { ttl: ttl, cacheName: jobs.uniqueCache }, (err, locked) => {
                // If the queue service is down keep all messages in the queue until it is up again
                if (!locked) {
                    if (!err && jobspec.uniqueDrop) {
                        logger.logger(jobspec.uniqueLogger || jobs.uniqueLogger || "info", "runJob:", "dropped", q, jobspec);
                        ipc.emitMsg("jobs:dropped", { job: jobspec, queueName: q });
                        return lib.tryCall(callback, { status: 200, message: "dropped" });
                    }
                    err = { status: 600, message: err || jobs.uniqueError, logger: jobspec.uniqueLogger || jobs.uniqueLogger || "debug" };
                    ipc.emitMsg("jobs:nolock", { job: jobspec, queueName: q, err: err });
                } else
                if (!err && !jobspec.uniqueOnce) {
                    // Keep the lock active while the job is running
                    timer = setInterval(function() {
                        cache.lock("JOB:" + key, { ttl: ttl, cacheName: jobs.uniqueCache, set: 1 });
                    }, Math.max(ttl * 0.7, 1000));
                }
                logger.debug("runJob:", q, cache.getCache(jobs.uniqueCache).name, "locked:", locked, "ttl:", ttl, "key:", key, "JOB:", jobspec)
                next(err);
            });
        },
        function(next) {
            ipc.emitMsg("jobs:started", { job: jobspec, queueName: q });

            jobspec.jobQueue = q;
            jobspec.jobTime = Date.now();
            jobs.runningJobs.push(jobspec);
            if (cluster.isWorker) process.title = `${app.id}: worker ${jobs.getRunningJobs()}`;

            lib.forEvery(Object.keys(jobspec.job), (task, next2) => {
                _runTask(task, jobspec, options, (err) => {
                    // Stop the task, have to wait till all subtasks stop to avoid race conditions.
                    // All 600 errors are propagated regardless of the flag
                    if (!jobspec.error || err?.status >= 600) jobspec.error = err;
                    next2();
                });
            }, () => {
                var idx = jobs.runningJobs.indexOf(jobspec);
                if (idx > -1) jobs.runningJobs.splice(idx, 1);
                if (cluster.isWorker) process.title = `${app.id}: worker ${jobs.getRunningJobs()}`;

                clearInterval(timer);
                if (ttl && key && !jobspec.uniqueKeep) {
                    cache.unlock("JOB:" + key, { cacheName: jobs.uniqueCache });
                }
                ipc.emitMsg("jobs:stopped", { job: jobspec, queueName: q });

                next(jobspec.error);
            });
        },
    ], callback, true);
}

// Send a cancellation request for given key to all workers
jobs.cancelJob = function(key, callback)
{
    ipc.broadcast(":worker", ipc.newMsg("jobs:cancel", { key: key }), callback);
}

// Execute a task by name, the `options` will be passed to the function as the first argument, calls the callback on finish or error
function _runTask(name, jobspec, options, callback)
{
    var job = jobspec.job[name];

    if (jobs.taskIgnore && jobs.taskIgnore.test(name)) {
        logger.error("runTask:", options?.queueName, name, "task ignored", job, "RX:", jobs.taskIgnore);
        return callback(lib.newError("Task ignored: " + name, 499, "TaskIgnored"));
    }

    var parts = name.split('.');
    var path = parts.slice(0, -1).join(".");
    var method = parts.at(-1);
    var context = modules[path];

    if (!context || typeof context[method] != "function") {
        logger.error("runTask:", options?.queueName, name, "unknown method", job);
        return callback(lib.newError("Unknown method: " + name, 499, "UnknownMethod"));
    }
    if (!lib.isObject(job)) job = {};

    this.metrics.running++;

    var d = domain.create();
    d.on("error", (err) => {
        _finishTask(err, name, jobspec, options, callback);
    });
    d.run(function() {
        logger.debug('runTask:', 'started', name, job);
        jobs.runTime = Date.now();
        ipc.emitMsg("jobs:task:started", { name, job, queueName: options?.queueName });

        context[method](job, (err) => {
            _finishTask(err, name, jobspec, options, callback);
        });
    });
}

// Complete task execution, cleanup and update the status
function _finishTask(err, name, jobspec, options, callback)
{
    var job = jobspec.job[name];

    if (err && !(err.status >= 200 && err.status < 300)) {
        jobs.metrics.err_count++;
        logger.logger(err.status >= 400 || util.types.isNativeError(err) ? "error" : "info", 'endTask:', options.queueName, name, lib.traceError(err), job);
    } else {
        logger.debug('endTask:', options.queueName, name, err, job);
    }
    jobs.metrics.que.update(Date.now() - jobspec.jobTime);
    jobs.metrics.running--;
    jobs.runTime = Date.now();

    ipc.emitMsg("jobs:task:stopped", { name, job, queueName: options.queueName, err });
    callback(err);
}

// Jobs run time stats
jobs.configureCollectStats = function(options)
{
    var que = this.metrics.que.toJSON({ reset: 1 });
    if (que?.count) {
        options.stats.jobs_que_size = this.metrics.running;
        options.stats.jobs_err_count = metrics.take(this.metrics, "err_count");
        options.stats.jobs_task_count = que.count;
        options.stats.jobs_run_time = que.med;
    }
}
