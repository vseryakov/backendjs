//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const cluster = require('cluster');
const domain = require('domain');
const cron = require('cron');
const fs = require('fs');
const util = require('util');
const core = require(__dirname + '/core');
const lib = require(__dirname + '/lib');
const logger = require(__dirname + '/logger');
const ipc = require(__dirname + '/ipc');
const server = require(__dirname + '/server');

// Job queue processor
//
// When launched with `jobs-workers` parameter equal or greater than 0, the master spawns a number of workers which subscribe to
// configured job queues or the default queue and listen for messsges.
// A job message is an object that defines what method from which module to run with the options as the first argument and a callback as the second.
//
// Multiple job queues can be defined and processed at the same time.
//
//
var jobs = {
    // Config parameters
    args: [{ name: "workers", type: "number", min: -1, max: 32, descr: "How many worker processes to launch to process the job queue, -1 disables jobs, 0 means launch as many as the CPUs available" },
           { name: "worker-cpu-factor", type: "real", min: 0, descr: "A number to multiply the number of CPUs available to make the total number of workers to launch, only used if `workers` is 0" },
           { name: "worker-args", type: "list", descr: "Node arguments for workers, for passing v8 jobspec, see `process`" },
           { name: "worker-env", type: "json", logger: "warn", descr: "Environment to be passed to the worker via fork, see `cluster.fork`" },
           { name: "worker-delay", type: "int", descr: "Delay in milliseconds for a worker before it will start accepting jobs, for cases when other dependencies may take some time to start" },
           { name: "max-runtime", type: "int", min: 0, descr: "Max number of seconds a job can run before being killed" },
           { name: "max-lifetime", type: "int", min: 0, descr: "Max number of seconds a worker can live, after that amount of time it will exit once all the jobs are finished, 0 means indefinitely" },
           { name: "shutdown-timeout", type: "int", min: 500, descr: "Max number of milliseconds to wait for the graceful shutdown sequence to finish, after this timeout the process just exits" },
           { name: "worker-queue", type: "list", onupdate: function() { if (ipc.role=="worker"&&core.role=="worker") this.subscribeWorker()}, descr: "Queue(s) to subscribe for workers, multiple queues can be processes at the same time, i.e. more than one job can run from different queues" },
           { name: "worker-queue-options-(.+)", obj: "workerOptions", make: "$1", type: "json", descr: "Custom parameters by queue name, passed to `ipc.subscribeQueue` on worker start, useful with channels, ex: `-jobs-worker-queue-options-nats#events {\"count\":10}`" },
           { name: "cron-queue", type: "list", min: 1, descr: "Default queue to use for cron jobs" },
           { name: "global-queue", type: "list", min: 1, descr: "Default queue for all jobs, the queueName is ignored" },
           { name: "global-ignore", type: "list", descr: "Queue names which ignore the global setting, the queueName is used as usual" },
           { name: "cron", type: "bool", descr: "Allow cron jobs to be executed from the local etc/crontab file or via config parameter" },
           { name: "schedule", type: "json", onupdate: function() { if (core.role == "master" && this.cron) this.scheduleCronjobs("config", this.schedule) }, logger: "error", descr: "Cron jobs to be scheduled, the JSON must be in the same format as crontab file" },
           { name: "unique-queue", descr: "Default queue name to use for keeping track of unique jobs" },
           { name: "unique-ignore", type: "regexp", descr: "Ignore all unique parameters if a job's uniqueKey matches" },
    ],

    jobRx: /^[a-z0-9_]+\.[a-z0-9_]+$/i,
    // List of running jobs for a worker
    runningJobs: [],
    runningTasks: [],
    cancelled: {},
    exiting: 0,
    // Time of the last update on jobs and tasks
    runTime: 0,
    // Schedules cron jobs
    crontab: [],
    selfQueue: "#self",
    subscribed: [],
    maxRuntime: 900,
    checkRuntime: 0,
    maxLifetime: 3600 * 12,
    shutdownTimeout: 30000,
    uniqueError: "non-unique condition",
    workers: -1,
    workerDelay: 500,
    workerQueue: [],
    workerCpuFactor: 2,
    workerArgs: [],
    workerEnv: {},
    workerOptions: {},
    properties: [
        "noWait", "noWaitTimeout",
        "noVisibility", "visibilityTimeout", "retryVisibilityTimeout", "retryVisibilityStatus",
        "stopOnError",
        "startTime", "endTime",
        "uniqueTtl", "uniqueKey", "uniqueKeep",
        "uniqueLogger", "uniqueDrop", "uniqueTag", "uniqueOnce",
        "maxRuntime"
    ],
};

module.exports = jobs;

// Initialize jobs processing in the master process
jobs.configureMaster = function(options, callback)
{
    this.initServer(options, callback);
}

// Initialize a worker to be ready for jobs to execute, in instance mode setup timers to exit on no activity.
jobs.configureWorker = function(options, callback)
{
    if (this.workers < 0) return callback();
    this.initWorker(options, callback);
}

// Perform graceful worker shutdown, to be used for workers restart
jobs.shutdownWorker = function(options, callback)
{
    logger.log("shutdownWorker:", "queue:", this.workerQueue, "max-runtime:", this.maxRuntime, "max-lifetime:", this.maxLifetime, options);

    // Stop accepting messages from the queues
    this.workerQueue.forEach(function(q) {
        ipc.unsubscribeQueue({ queueName: q });
    });

    // Give some time for a running job to exit by itself
    var timer = setInterval(function() {
        if (jobs.runningTasks.length && Date.now() - jobs.runTime < jobs.shutdownTimeout * 0.9) return;
        clearInterval(timer);
        callback();
    }, jobs.shutdownTimeout/10);
}

// Perform graceful worker shutdown and then exit the process
jobs.exitWorker = function(options)
{
    if (this.exiting++) return;
    setTimeout(function() { process.exit(99) }, this.shutdownTimeout * 2);
    core.runMethods("shutdownWorker", options, function() {
        process.exit(0);
    });
}

// Initialize a master that will manage jobs workers
jobs.initServer = function(options, callback)
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
        ipc.monitorQueue(lib.objExtend(jobs.workerOptions[name], "queueName", name));
    }

    // Graceful restart of all workers
    process.on('SIGUSR2', function() {
        ipc.sendMsg("worker:restart");
    });

    // Restart if any worker dies, keep the worker pool alive
    cluster.on("exit", function(worker, code, signal) {
        logger.log('initServer:', core.role, 'worker terminated:', worker.id, 'pid:', worker.process.pid || "", "code:", code || "", 'signal:', signal || "");
        if (!server.exiting) lib.checkRespawn(() => { cluster.fork() });
    });

    ipc.on('jobs:cancel', function(msg, worker) {
        jobs.cancelTask(msg.name, msg);
    });

    // Arguments passed to the v8 engine
    if (this.workerArgs.length) process.execArgv = this.workerArgs;

    // Launch the workers
    var workers = this.workers || Math.round(core.maxCPUs * (this.workerCpuFactor || 1));
    for (var i = 0; i < workers; i++) cluster.fork(this.workerEnv);

    logger.log("initServer:", core.role, "started", "workers:", workers, "cron:", this.cron);
    if (typeof callback == "function") callback();
}

// Initialize a worker for processing jobs
jobs.initWorker = function(options, callback)
{
    ipc.initWorker();

    setInterval(this.checkTimes.bind(this), 30000);

    // Mark a task for cancellation
    ipc.on('jobs:cancel', function(msg, worker) {
        if (!msg.name || !jobs.runningTasks.some((x) => (x.substr(0, msg.name.length) == msg.name))) return;
        jobs.cancelled[jobs._taskName(msg.name, msg.tag)] = 1;
        logger.info("jobs:cancel:", msg);
    });

    // Randomize subscription when multiple workers start at the same time, some queue drivers use polling
    setTimeout(function() {
        jobs.subscribeWorker();
        logger.log("initWorker:", "started", cluster.isWorker ? cluster.worker.id : process.pid, "queue:", jobs.subscribed, "maxRuntime:", jobs.maxRuntime, "maxLifetime:", jobs.maxLifetime);
    }, lib.toNumber(jobs.workerDelay) + lib.randomShort()/1000);

    if (typeof callback == "function") callback();
}

jobs.subscribeWorker = function()
{
    // Always use the default queue if nothing specified but a job worker is running
    if (!this.workerQueue.length) this.workerQueue.push("queue");

    this.workerQueue.forEach((name) => {
        // Unsubscribed if started with -
        if (name[0] == "-" || name[0] == "!") {
            jobs.unsubscribeQueue(name.substr(1));
            return;
        }
        // Prevent subscription more than once to the same queue in case of invalid or nonexistent queues
        var q = ipc.getQueue(name);
        if (jobs.subscribed.indexOf(q.canonical(name)) > -1) return;
        jobs.subscribed.push(q.canonical(name));

        logger.info("subscribeWorker:", q.name, name);
        ipc.subscribeQueue(lib.objExtend(jobs.workerOptions[name], "queueName", name), jobs.processJobMessage.bind(jobs, name));

        q.on("closed", () => {
            jobs.unsubscribeQueue(name);
            if (jobs._subscribeTimer) clearTimeout(jobs._subscribeTimer);
            jobs._subscribeTimer = setTimeout(jobs.subscribeWorker.bind(jobs), 1000);
        });
    });
}

jobs.unsubscribeQueue = function(name)
{
    const q = ipc.getClient(name);
    var idx = this.subscribed.indexOf(q.canonical(name));
    if (idx == -1) return;
    this.subscribed.splice(idx, 1);
    ipc.unsubscribeQueue({ queueName: name });
    logger.info("unsubscribeQueue:", q.name, name);
}

jobs.processJobMessage = function(name, msg, next)
{
    if (typeof next != "function") next = lib.noop;
    var opts = { queue: name, message: msg, stopOnError: 1, direct: true, stime: Date.now() };
    core.runMethods("configureJob", opts, (err) => {
        if (err) return next(err);
        jobs.runJob(opts.message, { queueName: name }, (err) => {
            opts.error = err;
            opts.parallel = 1;
            opts.etime = Date.now();
            opts.elapsed = opts.etime - opts.stime;
            if (!err) logger.logger(opts.message.logger || "debug", "endJob:", name, opts.message, opts.elapsed, "ms");
            if (err) logger.logger(err.status == 600 ? err.logger || "warn" : err.status != 200 ? "error" : "info", "endJob:", name, lib.traceError(err), opts.message, opts.elapsed, "ms");
            core.runMethods("finishJob", opts, () => { next(err) });
            // Mark end of last message processed
            jobs.runTime = Date.now();
            jobs.checkTimes();
        });
    });
}

// Returns true if a task with given name must be cancelled, this flag is set from the jobs master and
// stoppable tasks must check it from time to time to terminate gracefully
jobs.isCancelled = function(name, tag)
{
    return this.cancelled[jobs._taskName(name, tag)] || this.cancelled[name];
}

// Send cancellation request to a worker or all workers, this has to be called from the jobs master.
// `options.workers` can be a single worker id or a list of worker ids, if not given the request will be sent to all workers for the current process cluster.
// `options.tag` is an opaque data that will be used to verifying which task should be cancelled, without it all tasks with given name will be cancelled.
jobs.cancelTask = function(name, options)
{
    if (!cluster.isMaster) return;
    var workers = options && options.workers;
    if (!workers) workers = Object.keys(cluster.workers);
    if (!Array.isArray(workers)) workers = [ workers ];
    for (var i in workers) {
        logger.info("cancelTask:", workers[i], name, options)
        if (cluster.workers[workers[i]]) {
            cluster.workers[workers[i]].send(ipc.newMsg("jobs:cancel", { name: name, tag: options && options.tag || "" }));
        }
    }
}

// Find the max runtime allowed in seconds
jobs.getMaxRuntime = function()
{
    return this.runningJobs.reduce((m, x) => (Math.max(m, x.maxRuntime || 0)), this.maxRuntime) * 1000;
}

// Check how long we run a job and force kill if exceeded, check if total life time is exceeded.
//
// If exit is required the `shundownWorker` methods will receive options with `shutdownReason` property
// set and the name-sake property will contained the value exceeded.
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
                    for (const job of badJobs) ipc.unpublishQueue(job, { queueName: job.jobQueue });
                    return this.exitWorker({ shutdownReason: "maxRuntime", maxRuntime: maxRuntime });
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
//        { job: "module.method" }
//        { job: { "module.method": {}, .... } }
//        { job: [ "module.method", { "module.method": {} ... } ...] }
//
// any task in string format "module.method" will be converted into { "module.method: {} } automatically
//
jobs._badJob = function(jobspec)
{
    return lib.newError('Invalid job: ' + lib.objDescr(jobspec), 400, "InvalidJob");
}

jobs.isJob = function(jobspec)
{
    if (typeof jobspec == "string" && this.jobRx.test(jobspec)) jobspec = { job: { [jobspec]: {} } };
    if (!lib.isObject(jobspec)) return this._badJob(jobspec);

    if (typeof jobspec.job == "string") jobspec.job = { [jobspec.job]: {} };

    if (lib.isObject(jobspec.job)) {
        if (!Object.keys(jobspec.job).every(function(y) { return jobs.jobRx.test(y) })) {
            return this._badJob(jobspec);
        }
    } else

    if (Array.isArray(jobspec.job)) {
        var job = jobspec.job.filter(function(x) {
            if (typeof x == "string" && jobs.jobRx.test(x)) return true;
            if (lib.isObject(x) && Object.keys(x).every(function(y) { return jobs.jobRx.test(y) })) return true;
            return false;
        }).map(function(x) {
            return typeof x == "string" ? { [x]: {} } : x;
        });
        if (!job.length) return this._badJob(jobspec);
        jobspec.job = job;
    } else {
        return this._badJob(jobspec);
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
// `jobspec.uniqueTag` defines additional tag to be used for job cancelling, for cases when multiple jobs are running with the same method
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
// `jobspec.retryVisibilityTimeout` custom timeout for how long to keep this job invisible in case of errors >= 500 which results in keeping tasks in the queue for retry
//
// `jobspec.retryVisibilityStatus` apply retryVisibilityTimeout only if this code is specified, this can be a list with multiple codes
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
//  some queue to automatically use dedup mode it can be set in the queue options: `-ipc-queue[-NAME]-options-dedup_ttl 86400000`.
//  Note: `uniqueTtl` settings take precedence and if present dedup is ignored.
//
// Special queue name: `jobs.selfQueue` is reserved to run the job immediately inside the current process,
// it will call the `runJob` directly, this is useful in cases when already inside a worker and instead of submitting a new job
// just run it directly. Any queue can be configured to run in `selfQueue` by setting `-ipc-queue[-NAME]-options-self-queue 1`.
//
jobs.submitJob = function(jobspec, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    jobspec = this.isJob(jobspec);
    if (util.isError(jobspec)) return lib.tryCall(callback, jobspec);

    // We deal with queue lists here due to the round-robin processing, cannot call getClient multiple
    // times with a list because it returns the next queue with every call, so we get the next queue here
    // and pass just the name
    var n = options && options.queueName;
    if (this.globalQueue && !lib.isFlag(this.globalIgnore, n)) n = this.globalQueue;
    var q = ipc.getQueue(n);

    // Ignore duplicate messages
    var ttl = lib.toNumber(q.options.dedup_ttl || options && options.dedup_ttl);
    if (ttl > 0) {
        jobspec.dedup = `${ttl}-${lib.uuid()}`;
    }

    // Keep track where the job is originated
    jobspec.origin = core.role + ":" + process.pid + ":" + core.ipaddr;
    logger.debug("submitJob:", jobspec, "OPTS:", options);
    this.checkOptions(jobspec, options);

    if (q.options.selfQueue && core.role == "worker") {
        setTimeout(function() {
            jobs.runJob(jobspec, options, callback)
        }, options && options.delay || 0);
    } else {
        options = lib.objClone(options, "queueName", q.queueName);
        ipc.publishQueue(jobspec, options, callback);
    }
}

// Run all tasks in the job object
jobs.runJob = function(jobspec, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = lib.empty;
    logger.debug("runJob:", options.queueName, jobspec);

    jobspec = this.isJob(jobspec);
    if (util.isError(jobspec)) return lib.tryCall(callback, jobspec);
    if (lib.toBool(jobspec.disabled)) return lib.tryCall(callback);
    var timer, ttl, key;

    lib.series([
        function(next) {
            // Make sure we do not have this job in the queue
            ttl = lib.toNumber(jobspec.uniqueTtl, { min: 0 });
            if (ttl && lib.testRegexp(jobspec.uniqueKey, jobs.uniqueIgnore)) ttl = 0;
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
            ipc.lock("JOB:" + key, { ttl: ttl, queueName: jobs.uniqueQueue }, function(err, locked) {
                // If the queue service is down keep all messages in the queue until it is up again
                if (!locked) {
                    if (!err && jobspec.uniqueDrop) {
                        logger.logger(jobspec.uniqueLogger || "info", "runJob:", "dropped", options.queueName, jobspec);
                        ipc.emitMsg("jobs:dropped", { job: jobspec, queueName: options.queueName });
                        return lib.tryCall(callback, { status: 200, message: "dropped" });
                    }
                    err = { status: 600, message: err || jobs.uniqueError, logger: jobspec.uniqueLogger || "info" };
                    ipc.emitMsg("jobs:nolock", { job: jobspec, queueName: options.queueName, err: err });
                } else
                if (!jobspec.uniqueOnce) {
                    // Keep the lock active while the job is running
                    timer = setInterval(function() {
                        ipc.lock("JOB:" + key, { ttl: ttl, queueName: jobs.uniqueQueue, set: 1 });
                    }, Math.max(ttl * 0.7, 1000));
                }
                logger.debug("runJob:", options.queueName, ipc.getQueue(jobs.uniqueQueue).name, "locked:", locked, "ttl:", ttl, "key:", key, "JOB:", jobspec)
                next(err);
            });
        },
        function(next) {
            ipc.emitMsg("jobs:started", { job: jobspec, queueName: options.queueName });
            jobs._runJob(jobspec, options, function(err) {
                clearInterval(timer);
                if (ttl && key && !jobspec.uniqueKeep) {
                    ipc.unlock("JOB:" + key, { queueName: jobs.uniqueQueue });
                }
                ipc.emitMsg("jobs:stopped", { job: jobspec, queueName: options.queueName, err: err });
                next(err);
            });
        },
    ], callback, true);
}

// Sequentially execute all tasks in the list, run all subtasks in parallel
jobs._runJob = function(jobspec, options, callback)
{
    jobspec.jobTime = Date.now();
    jobspec.jobQueue = options.queueName;
    this.runningJobs.push(jobspec);
    var tasks = Array.isArray(jobspec.job) ? jobspec.job : [ jobspec.job ];
    lib.forEachSeries(tasks, (task, next) => {
        if (!lib.isObject(task)) return next();
        var error;
        lib.forEvery(Object.keys(task), function(name, next2) {
            jobs.runTask(name, task[name], options, (err) => {
                // Stop the task, have to wait till all subtasks stop to avoid race conditions.
                // All 600 errors are propagated regardless of the flag
                if (err && (jobspec.stopOnError || err.status >= 600)) {
                    if (!error || err.status >= 600) error = err;
                }
                next2();
            });
        }, () => {
           next(error);
        });
    }, (err) => {
        var idx = jobs.runningJobs.indexOf(jobspec);
        if (idx > -1) jobs.runningJobs.splice(idx, 1);
        callback(err);
    });
}

// Execute a task by name, the `options` will be passed to the function as the first argument, calls the callback on finish or error
jobs.runTask = function(name, jobspec, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = lib.empty;

    var method = name.split('.');
    var module = method[0] == "core" ? core : core.modules[method[0]];
    if (!module || typeof module[method[1]] != "function") {
        logger.error("runTask:", options.queueName, name, "unknown method", jobspec);
        return typeof callback == "function" && callback(lib.newError("Unknown method: " + name, 500, "UnknownMethod"));
    }
    if (!lib.isObject(jobspec)) jobspec = {};

    var d = domain.create();
    d.on("error", function(err) {
        jobs._finishTask(err, name, jobspec, options, callback);
    });
    d.run(function() {
        logger.debug('runTask:', 'started', name, jobspec);
        jobs.runningTasks.push(jobs._taskName(name, jobspec.uniqueTag));
        jobs.runTime = Date.now();
        if (cluster.isWorker) process.title = core.name + ': worker ' + jobs.runningTasks.join(',');
        ipc.emitMsg("jobs:task:started", { name: name, job: jobspec, queueName: options.queueName });
        module[method[1]](jobspec, function(err) {
            jobs._finishTask(err, name, jobspec, options, callback);
        });
    });
}

jobs._taskName = function(name, tag)
{
    return name + (tag ? ":" + tag : "");
}

// Complete task execution, cleanup and update the status
jobs._finishTask = function(err, name, jobspec, options, callback)
{
    logger.logger(err && err.status >= 400 ? "error" : err && err.status != 200 ? "info" : "debug", 'endTask:', options.queueName, name, lib.traceError(err), jobspec);
    this.runTime = Date.now();
    // Update process title with current job list
    var taskname = jobs._taskName(name, jobspec.uniqueTag);
    delete this.cancelled[taskname];
    lib.arrayRemove(this.runningTasks, taskname);
    if (cluster.isWorker) process.title = core.name + ': worker ' + this.runningTasks.join(',');
    ipc.emitMsg("jobs:task:stopped", { name: name, job: jobspec, queueName: options.queueName, err: err });
    lib.tryCall(callback, err);
}

// Create a new cron job, for remote jobs additional property args can be used in the object to define
// arguments for the instance backend process, properties must start with -
//
// Example:
//
//          { "cron": "0 */10 * * * *", "job": "server.processQueue" },
//          { "cron": "0 */30 * * * *", "job": { "server.processQueue": { name: "queue1" } } },
//          { "cron": "0 5 * * * *", "job": [ { "scraper.run": { "url": "host1" } }, { "scraper.run": { "url": "host2" } } ] }
//
jobs.scheduleCronjob = function(jobspec)
{
    jobspec = this.isJob(jobspec);
    if (util.isError(jobspec)) {
        logger.error("scheduleCronjob:", "invalid", jobspec);
        return false;
    }
    if (lib.toBool(jobspec.disabled)) return false;
    logger.debug('scheduleCronjob:', jobspec);
    try {
        var cj = new cron.CronJob(jobspec.cron, function() {
            jobs.submitJob(this.jobspec, { queueName: jobspec.queueName || jobs.cronQueue });
        }, null, true);
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
jobs.scheduleCronjobs = function(type, list)
{
    if (!Array.isArray(list)) return 0;
    this.crontab = this.crontab.filter(function(x) {
        if (x.jobspec._type != type) return 1;
        x.stop();
        return 0;
    });
    var n = 0
    list.forEach(function(x) {
        x._type = type;
        if (jobs.scheduleCronjob(x)) n++;
    });
    return n;
}

// Load crontab from JSON file as list of job specs:
// - cron - cron time interval spec: 'second' 'minute' 'hour' 'dayOfMonth' 'month' 'dayOfWeek'
// - job - a string as obj.method or an object with job name as property name and the value is an object with
//    additional jobspec for the job passed as first argument, a job callback always takes jobspec and callback as 2 arguments
// - disabled - disable the job but keep in the cron file, it will be ignored
// - queueName - name of the queue where to submit this job, if not given it uses cron-queue
// - uniqueTtl - defines that this job must be the only one in the queue for the number of milliseconds specified, after that
//    time another job with the same arguments can be submitted.
//
// Example:
//
//          [ { cron: "0 0 * * * *", job: "scraper.run" }, ..]
jobs.loadCronjobs = function()
{
    fs.readFile(core.path.etc + "/crontab", function(err, data) {
        jobs.parseCronjobs("crontab", data);

        fs.readFile(core.path.etc + "/crontab.local", function(err, data) {
            jobs.parseCronjobs("crontab.local", data);
        });
    });

    // Watch config directory for changes
    if (this.cronWatcher) return;
    this.cronWatcher = fs.watch(core.path.etc, function (event, filename) {
        if (filename && filename.match(/crontab/)) core.setTimeout(filename, function() { jobs.loadCronjobs(); }, 5000);
    });
}

// Parse a JSON data with cron jobs and schedule for the given type, this can be used to handle configuration properties
jobs.parseCronjobs = function(type, data)
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
