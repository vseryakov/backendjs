//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var net = require('net');
var cluster = require('cluster');
var domain = require('domain');
var cron = require('cron');
var path = require('path');
var util = require('util');
var url = require('url');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;
var exec = require('child_process').exec;
var core = require(__dirname + '/core');
var lib = require(__dirname + '/lib');
var logger = require(__dirname + '/logger');
var db = require(__dirname + '/db');
var aws = require(__dirname + '/aws');
var ipc = require(__dirname + '/ipc');
var server = require(__dirname + '/server');

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
           { name: "worker-env", type: "json", descr: "Environment to be passed to the worker via fork, see `cluster.fork`" },
           { name: "max-runtime", type: "int", min: 300, descr: "Max number of seconds a job can run before being killed" },
           { name: "max-lifetime", type: "int", min: 0, descr: "Max number of seconds a worker can live, after that amount of time it will exit once all the jobs are finished, 0 means indefinitely" },
           { name: "shutdown-timeout", type: "int", min: 500, descr: "Max number of milliseconds to wait for the graceful shutdown sequence to finish, after this timeout the process just exits" },
           { name: "worker-queue", type: "list", array: 1, onupdate: function() {if(ipc.role=="worker")this.subscribeWorker()}, descr: "Queue(s) to subscribe for workers, multiple queues can be processes at the same time, i.e. more than one job can run from different queues" },
           { name: "cron-queue", descr: "Default queue to use for cron jobs" },
           { name: "unique-queue", descr: "Default queue name to use for keeping track of unique jobs" },
           { name: "cron", type: "bool", descr: "Allow cron jobs to be executed from the local etc/crontab file or via config parameter" },
           { name: "schedule", type: "json", onupdate: function() { if(core.role == "master" && this.cron) this.scheduleCronjobs("config", this.schedule) }, logger: "error", descr: "Cron jobs to be scheduled, the JSON must be in the same format as crontab file" },
    ],

    // List of running jobs for a worker
    jobs: [],
    running: [],
    cancelled: {},
    exiting: 0,
    // Time of the last update on jobs and tasks
    runTime: 0,
    // Schedules cron jobs
    crontab: [],
    cronQueue: "",
    selfQueue: "#self",
    subscribed: [],
    maxRuntime: 900,
    maxLifetime: 3600,
    shutdownTimeout: 3000,
    uniqueError: "non-unique condition",
    workers: -1,
    workerQueue: [],
    workerCpuFactor: 2,
    workerArgs: [],
    workerEnv: {},
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
    logger.log("shutdownWorker:", "queue:", this.workerQueue, "maxRuntime:", this.maxRuntime, "maxLifetime:", this.maxLifetime);

    // Stop accepting messages from the queue
    this.workerQueue.forEach(function(q) {
        ipc.unlisten({ queueName: q });
    });

    // Give some time for a running job to exit by itself
    var timer = setInterval(function() {
        if (jobs.running.length && Date.now() - jobs.runTime < jobs.shutdownTimeout * 0.9) return;
        clearInterval(timer);
        callback();
    }, jobs.shutdownTimeout/10);
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

    // Start queue monitor if needed
    ipc.monitor(options);

    // Graceful restart of all workers
    process.on('SIGUSR2', function() {
        ipc.sendMsg("worker:restart");
    });

    // Restart if any worker dies, keep the worker pool alive
    cluster.on("exit", function(worker, code, signal) {
        logger.log('initServer:', core.role, 'worker terminated:', worker.id, 'pid:', worker.process.pid || "", "code:", code || "", 'signal:', signal || "");
        if (!server.exiting) cluster.fork();
    });

    // Listen for worker messages, keep track of tasks in the master
    ipc.on('jobs:started', function(msg, worker) {
        cluster.workers[worker.id].taskName = msg.name;
        cluster.workers[worker.id].taskTime = Date.now();
    });
    ipc.on('jobs:stopped', function(msg, worker) {
        cluster.workers[worker.id].taskName = "";
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
        if (!jobs.running.some(function(x) { return x == msg.name })) return;
        jobs.cancelled[msg.name] = 1;
        logger.info("jobs:cancel:", msg.name);
    });

    // Randomize subscription when multiple workers start at the same time, some queue drivers use polling
    setTimeout(function() {
        jobs.subscribeWorker();
        logger.log("initWorker:", "started", cluster.isWorker ? cluster.worker.id : process.pid, "queue:", jobs.subscribed, "maxRuntime:", jobs.maxRuntime, "maxLifetime:", jobs.maxLifetime);
    }, lib.randomShort()/1000);

    if (typeof callback == "function") callback();
}

jobs.subscribeWorker = function()
{
    if (!this.workerQueue.length) this.workerQueue.push("");

    this.workerQueue.forEach(function(name) {
        // Unsubscribed if started with -
        if (name[0] == "-") {
            name = name.substr(1);
            var q = ipc.getQueue(name);
            var idx = jobs.subscribed.indexOf(name);
            if (idx == -1) return;
            logger.info("initWorker:", "unsubscribe from queue", name, q.host);
            jobs.subscribed.splice(idx, 1);
            ipc.unlisten({ queueName: name });
            return;
        }
        // Prevent subscription more than once to the same queue in case of invalid or nonexistent queues
        var q = ipc.getQueue(name);
        if (jobs.subscribed.indexOf(name) > -1) return;
        jobs.subscribed.push(name);

        logger.info("initWorker:", "subscribe to queue", name, q.host);
        ipc.listen({ queueName: name }, function(msg, next) {
            var opts = { message: msg, queue: name };
            core.runMethods("configureJob", opts, function() {
                jobs.runJob(opts.message, { queueName: name }, function(err) {
                    logger[err && err.status == 600 ? "warn" : err && err.status != 200 ? "error" : "info"]("runJob:", "finished", name, lib.traceError(err), lib.objDescr(msg));
                    if (typeof next == "function") next(err);
                    // Mark end of last message processed
                    jobs.runTime = Date.now();
                    jobs.checkTimes();
                });
            });
        });
    });
}

// Perform graceful worker shutdown and then exit the process
jobs.exitWorker = function(options)
{
    if (this.exiting++) return;
    var timeout = setTimeout(function() { process.exit(99) }, this.shutdownTimeout * 2);
    core.runMethods("shutdownWorker", function() {
        process.exit(0);
    });
}

// Returns true if a task with given name must be cancelled, this flag is set from the jobs master and
// stoppable tasks must check it from time to time to terminate gracefully
jobs.isCancelled = function(name)
{
    return this.cancelled[name];
}

// Send cancellation request to a worker or all workers, this has to be called from the jobs master. `workers` can be a single worker id or a list of worker ids,
// if not given the request will be sent to all workers for the current process cluster.
jobs.cancelTask = function(name, workers)
{
    if (!cluster.isMaster) return;
    if (!workers) workers = Object.keys(cluster.workers);
    if (!Array.isArray(workers)) workers = [ workers ];
    for (var i in workers) {
        logger.info("cancelTask:", workers[i], name)
        if (cluster.workers[workers[i]]) cluster.workers[workers[i]].send(ipc.newMsg("jobs:cancel", { name: name }));
    }
}

// Find the max runtime allowed in seconds
jobs.getMaxRuntime = function()
{
    var secs = this.maxRuntime;
    this.jobs.forEach(function(x) { if (x.maxRuntime > secs) secs = x.maxRuntime; });
    return secs;
}

// Check how long we run a job and force kill if exceeded, check if total life time is exceeded
jobs.checkTimes = function()
{
    if (this.running.length) {
        var maxRuntime = this.getMaxRuntime();
        if (Date.now() - this.runTime > maxRuntime * 1000) {
            logger.warn('checkLifetime:', 'jobs: exceeded max run time', maxRuntime, this.jobs);
            return this.exitWorker();
        }
    } else

    if (!this.jobs.length) {
        // Idle mode, check max life time
        if (this.maxLifetime > 0 && Date.now() - core.ctime > this.maxLifetime * 1000) {
            logger.log('checkLifetime:', 'jobs: exceeded max life time', this.maxLifetime);
            return this.exitWorker();
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
jobs.isJob = function(jobspec)
{
    var rx = /^[a-z0-9_]+\.[a-z0-9_]+$/i;

    if (typeof jobspec == "string" && jobspec.match(rx)) jobspec = { job: lib.objNew(jobspec, null) };
    if (!lib.isObject(jobspec)) return lib.newError("invalid job:" + lib.objDescr(jobspec));

    if (typeof jobspec.job == "string") jobspec.job = lib.objNew(jobspec.job, null);

    if (lib.isObject(jobspec.job)) {
        if (!Object.keys(jobspec.job).every(function(y) { return y.match(rx) })) return lib.newError('invalid job: ' + lib.objDescr(jobspec));
    } else

    if (Array.isArray(jobspec.job)) {
        var job = jobspec.job.filter(function(x) {
            if (typeof x == "string" && x.match(rx)) return true;
            if (lib.isObject(x) && Object.keys(x).every(function(y) { return y.match(rx) })) return true;
            return false;
        }).map(function(x) {
            return typeof x == "string" ? lib.objNew(x, null) : x;
        });
        if (!job.length) return lib.newError('invalid job: ' + lib.objDescr(jobspec));
        jobspec.job = job;
    } else {
        return lib.newError('invalid job: ' + lib.objDescr(jobspec));
    }
    return jobspec;
}

// Submit a job for execution, it will be saved in a queue and will be picked up later and executed.
// The queue and the way how it will be executed depends on the configured queue. See `isJob` for
// the format of the job objects.
//
// if 'jobspec.uniqueTtl` is greater than zero it defines number of milliseconds for this job to stay in the queue or run,
// it creates a global lock using the job object as the hash key, no other job can be run until the ttl expires or the job
// finished, non unique jobs will be kept in the queue and repeated later according to the `visibilityTimeeout` setting.
//
// if 'jobspec.uniqueDrop` if true will make non-unique jobs to be silently dropped instead of keeping them in the queue
//
// Special queueName: `jobs.selfQueue` is reserved to run the job immediately inside the current process,
// it will call the `runJob` directly, this is useful in cases when already inside a worker and instead of submitting a new job
// just run it directly.
jobs.submitJob = function(jobspec, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    jobspec = this.isJob(jobspec);
    if (util.isError(jobspec)) return lib.tryCall(callback, jobspec);
    // Keep track where the job is originated
    jobspec.origin = core.role + ":" + process.pid + ":" + core.ipaddr;
    logger.debug("submitJob:", jobspec, options);
    if (options && options.queueName == jobs.selfQueue) {
        return setTimeout(function() {
            jobs.runJob(jobspec, options, callback)
        }, options && options.delay || 0);
    }
    ipc.submit(jobspec, options, callback);
}

// Run all tasks in the job object, all errors will be just logged, but if `noerrors` is defined in the top
// level job object then the whole job will stop on first error returned by any task.
jobs.runJob = function(jobspec, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = lib.empty;
    logger.info("runJob:", "started", options.queueName, typeof jobspec == "string" ? jobspec : lib.objDescr(jobspec));

    jobspec = this.isJob(jobspec);
    if (util.isError(jobspec)) return lib.tryCall(callback, jobspec);
    if (lib.toBool(jobspec.disabled)) return lib.tryCall(callback);

    lib.series([
      function(next) {
          // Make sure we do not have this job in the queue
          if (lib.toNumber(jobspec.uniqueTtl) <= 0) return next();
          jobspec.uniqueKey = "JOB:" + lib.hash(lib.stringify(jobspec.job));
          ipc.lock(jobspec.uniqueKey, { ttl: jobspec.uniqueTtl, queueName: jobs.uniqueQueue }, function(err, locked) {
              // If the queue service is down keep all messages in the queue until it is up again
              if (!locked) {
                  if (!err && jobspec.uniqueDrop) {
                      logger.info("runJob:", "dropped", options.queueName, lib.objDescr(jobspec));
                      return lib.tryCall(callback);
                  }
                  err = { status: 600, message: err || jobs.uniqueError };
              }
              next(err);
          });
      },
      function(next) {
          jobs._runJob(jobspec, options, function(err) {
              if (jobspec.uniqueKey) ipc.unlock(jobspec.uniqueKey, { queueName: jobs.uniqueQueue });
              next(err);
          });
      },
    ], callback);
}

// Sequentially execute all tasks in the list, run all subtasks in parallel
jobs._runJob = function(jobspec, options, callback)
{
    this.jobs.push(jobspec);
    var tasks = Array.isArray(jobspec.job) ? jobspec.job : [ jobspec.job ];
    lib.forEachSeries(tasks, function(task, next) {
        if (!lib.isObject(task)) return next();
        lib.forEach(Object.keys(task), function(name, next2) {
            jobs.runTask(name, task[name], options, function(err) {
                next2(err && jobspec.noerrors ? err : null);
            });
        }, next);
    }, function(err) {
        var idx = jobs.jobs.indexOf(jobspec);
        if (idx > -1) jobs.jobs.splice(idx, 1);
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
        logger.error("runTask:", options.queueName, name, "unknown method", lib.objDescr(jobspec));
        return typeof callback == "function" && callback(lib.newError("unknown method: " + name, 500));
    }
    if (!lib.isObject(jobspec)) jobspec = {};

    var d = domain.create();
    d.on("error", function(err) {
        jobs._finishTask(err, name, jobspec, options, callback);
    });
    d.run(function() {
        logger.info('runTask:', 'started', name, lib.objDescr(jobspec));
        jobs.runTime = Date.now();
        jobs.running.push(name);
        if (cluster.isWorker) process.title = core.name + ': worker ' + jobs.running.join(',');
        ipc.sendMsg("jobs:started", { name: name });
        module[method[1]](jobspec, function(err) {
            jobs._finishTask(err, name, jobspec, options, callback);
        });
    });
}

// Complete task execution, cleanup and update the status
jobs._finishTask = function(err, name, jobspec, options, callback)
{
    logger[err && err.status != 200 ? "error" : "info"]('finishTask:', options.queueName, name, lib.traceError(err), lib.objDescr(jobspec, { length: 512, count: 10 }));
    this.runTime = Date.now();
    // Update process title with current job list
    delete this.cancelled[name];
    var idx = this.running.indexOf(name);
    if (idx > -1) this.running.splice(idx, 1);
    if (cluster.isWorker) process.title = core.name + ': worker ' + this.running.join(',');
    ipc.sendMsg("jobs:stopped", { name: name });
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
    } catch(e) {
        logger.error("scheduleCronjob:", e, lib.objDescr(jobspec));
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
    if (!Array.isArray(list) || !list.length) return 0;
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
    var list = [];
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
