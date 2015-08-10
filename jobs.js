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

// Job launcher and scheduler
var jobs = {
    // Config parameters
    args: [{ name: "workers", type: "number", min: -1, max: 32, descr: "How many worker processes to launch to process the job queue, -1 disables jobs, 0 means launch as many as CPUs available" },
           { name: "worker-cpu-factor", type: "real", min: 0, descr: "A number to multiply the number of CPUs available to make the total number of workers to launch, only used if `workers` is 0" },
           { name: "worker-args", type: "list", descr: "Node arguments for workers, for passing v8 jobspec, see `process`" },
           { name: "worker-env", type: "json", descr: "Environment to be passed to the worker via fork, see `cluster.fork`" },
           { name: "max-runtime", type: "int", min: 300, descr: "Max number of seconds a job can run before being killed" },
           { name: "max-lifetime", type: "int", min: 0, descr: "Max number of seconds a worker can live, after that amount of time it will exit once all the jobs are finished, 0 means indefinitely" },
           { name: "shutdown-timeout", type: "int", min: 0, descr: "Max number of milliseconds to wait for the graceful shutdown sequence to finish, after this timeout the process just exits" },
           { name: "queue", descr: "Default queue to use for jobs" },
           { name: "cron-queue", descr: "Default queue to use for cron jobs" },
           { name: "channel", descr: "Name of the channel where to publish/receive jobs" },
           { name: "cron", type: "bool", descr: "Load cron jobs from the local etc/crontab file, requires -jobs flag" },
    ],

    // List of running jobs for a worker
    running: [],
    exiting: 0,
    // Time of the last update on jobs and tasks
    runTime: 0,
    // Schedules cron jobs
    crontab: [],
    channel: "jobs",
    queue: "",
    cronQueue: "",
    maxRuntime: 900,
    maxLifetime: 86400,
    shutdownTimeout: 1000,
    workers: -1,
    workerCpuFactor: 0,
    workerArgs: [],
    workerEnv: {},
};

module.exports = jobs;

// Initialize jobs processing in the master process
jobs.configureMaster = function(options, callback)
{
    if (this.workers < 0) return callback();
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
    var self = this;
    logger.log("shutdownWorker:", "queue:", this.queue, this.channel, "maxRuntime:", this.maxRuntime, "maxLifetime:", this.maxLifetime);

    // Stop accepting messages from the queue
    ipc.unsubscribe(this.channel, { queueName: this.queue });
    // Wait until the current job is processed and confirmed
    var timer = setInterval(function() {
        if (self.running.length || Date.now() - self.runTime < 50) return;
        clearInterval(timer);
        callback();
    }, 50);
}

// Initialize a master that will manage jobs workers
jobs.initServer = function(options, callback)
{
    var self = this;

    ipc.initServer();

    // Start queue monitor if needed
    ipc.monitor(options);

    // Setup background tasks from the crontab
    if (this.cron) this.loadCronjobs();

    // Restart if any worker dies, keep the worker pool alive
    cluster.on("exit", function(worker, code, signal) {
        logger.log('initServer:', core.role, 'worker terminated:', worker.id, 'pid:', worker.process.pid || "", "code:", code || "", 'signal:', signal || "");
        if (!server.exiting) cluster.fork();
    });

    // Graceful restart of all workers
    process.on('SIGUSR2', function() {
        ipc.sendMsg("worker:restart");
    });

    // Arguments passed to the v8 engine
    if (this.workerArgs.length) process.execArgv = this.workerArgs;

    // Launch the workers
    var workers = this.workers || (core.maxCPUs * (this.workerCpuFactor || 1));
    for (var i = 0; i < workers; i++) cluster.fork(this.workerEnv);

    logger.log("jobs:", core.role, "started", "workers:", workers, "cron:", this.cron);
    if (typeof callback == "function") callback();
}

// Initialize a worker for processing jobs
jobs.initWorker = function(options, callback)
{
    var self = this;

    ipc.initWorker();

    setInterval(this.checkTimes.bind(this), 30000);

    // Randomize subscription when multiple workers start at the same time, some queue drivers use polling
    setTimeout(function() {
        ipc.subscribe(self.channel, { queueName: self.queue }, function(msg, next) {
            self.runJob(msg, function(err) {
                logger[err ? "error" : "info"]("runJob:", "finished", (err && err.stack) || err || "", lib.objDescr(msg));
                if (typeof next == "function") next(err);
                // Mark end of last message processed
                self.runTime = Date.now();
                self.checkTimes();
            });
        });
        logger.log("initWorker:", "started", "queue:", self.queue, self.channel, "maxRuntime:", self.maxRuntime, "maxLifetime:", self.maxLifetime);
    }, lib.randomShort()/100);

    if (typeof callback == "function") callback();
}

// Perform graceful worker shutdown and then exit the process
jobs.exitWorker = function(options)
{
    if (this.exiting++) return;
    var timeout = setTimeout(function() { process.exit(99) }, this.shutdownTimeout);
    core.runMethods("shutdownWorker", function() {
        clearTimeout(timeout);
        process.exit(0);
    });
}

// Check how long we run a job and force kill if exceeded, check if total life time is exceeded
jobs.checkTimes = function()
{
    if (this.running.length && Date.now() - this.runTime > this.maxRuntime * 1000) {
        logger.warn('checkLifetime:', 'jobs: exceeded max run time', this.maxRuntime);
        this.exitWorker();
    } else

    if (!this.running.length && this.maxLifetime > 0 && Date.now() - core.ctime > this.maxLifetime * 1000) {
        logger.log('checkLifetime:', 'jobs: exceeded max life time', this.maxLifetime);
        this.exitWorker();
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

    if (typeof jobspec == "string" && jobspec.match(rx)) jobspec = { job: lib.newObj(jobspec, null) };
    if (!lib.isObject(jobspec)) return lib.newError("invalid job:" + lib.objDescr(jobspec), 500);

    if (typeof jobspec.job == "string") jobspec.job = lib.newObj(jobspec.job, null);

    if (lib.isObject(jobspec.job)) {
        if (!Object.keys(jobspec.job).every(function(y) { return y.match(rx) })) return lib.newError('invalid job: ' + lib.objDescr(jobspec), 500);
    } else

    if (Array.isArray(jobspec.job)) {
        var job = jobspec.job.filter(function(x) {
            if (typeof x == "string" && x.match(rx)) return true;
            if (lib.isObject(x) && Object.keys(x).every(function(y) { return y.match(rx) })) return true;
            return false;
        }).map(function(x) {
            return typeof x == "string" ? lib.newObj(x, null) : x;
        });
        if (!job.length) return lib.newError('invalid job: ' + lib.objDescr(jobspec), 500);
        jobspec.job = job;
    } else {
        return lib.newError('invalid job: ' + lib.objDescr(jobspec), 500);
    }
    return jobspec;
}

// Submit a job for execution, it will be saved in a queue and will be picked up later and executed.
// The queue and the way how it will be executed depends on the configured queue.
jobs.submitJob = function(jobspec, options, callback)
{
    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {};
    jobspec = this.isJob(jobspec);
    if (util.isError(jobspec)) return typeof callback == "function" && callback(jobspec);
    if (this.queue) options = lib.cloneObj(options, "queueName", this.queue);

    logger.debug("submitJob:", jobspec, options);
    ipc.publish(this.channel, jobspec, options, callback);
}

// Run all tasks in the job object, all errors will be just logged, but if `noerrors` is defined in the top
// level job object then the whole job will stop on first error returned by any task.
jobs.runJob = function(jobspec, callback)
{
    var self = this;
    logger.info("runJob:", "started", lib.objDescr(jobspec));

    jobspec = this.isJob(jobspec);
    if (util.isError(jobspec)) return typeof callback == "function" && callback(jobspec);

    var tasks = Array.isArray(jobspec.job) ? jobspec.job : [ jobspec.job ];

    // Sequentially execute all tasks in the list, run all subtasks in parallel
    lib.forEachSeries(tasks, function(task, next) {
        if (!lib.isObject(task)) return next();

        lib.forEach(Object.keys(task), function(name, next2) {
            self.runTask(name, task[name], function(err) {
                next2(err && jobspec.noerrors ? err : null);
            });
        }, next);
    }, callback);
}

// Execute a task by name, the `options` will be passed to the function as the first argument, calls the callback on finish or error
jobs.runTask = function(name, options, callback)
{
    var self = this;
    var method = name.split('.');
    var module = method[0] == "core" ? core : core.modules[method[0]];
    if (!module || typeof module[method[1]] != "function") {
        logger.error("runTask:", "unknown method", name, lib.objDescr(options));
        return callback(lib.newError("unknown method: " + name, 500));
    }
    if (!lib.isObject(options)) options = {};

    function done(err) {
        logger[err ? "error" : "info"]('runTask:', 'finished', name, util.isError(err) ? err.stack : (err || ""));
        self.runTime = Date.now();
        // Update process title with current job list
        var idx = self.running.indexOf(name);
        if (idx > -1) self.running.splice(idx, 1);
        if (cluster.isWorker) process.title = core.name + ': worker ' + self.running.join(',');
        callback(err);
    }

    var d = domain.create();
    d.on("error", done);
    d.run(function() {
        logger.info('runTask:', 'started', name, options);
        self.runTime = Date.now();
        self.running.push(name);
        if (cluster.isWorker) process.title = core.name + ': worker ' + self.running.join(',');
        module[method[1]](options, done);
    });
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
    var self = this;
    if (!lib.isObject(jobspec) || !jobspec.cron || !jobspec.job || jobspec.disabled) return false;
    logger.debug('scheduleCronjob:', jobspec);
    try {
        var cj = new cron.CronJob(jobspec.cron, function() { self.submitJob(this.job, { queueName: self.cronQueue }); }, null, true);
        cj.job = jobspec;
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
    var self = this;
    if (!list.length) return 0;
    self.crontab.forEach(function(x) {
        if (x.job._type != type) return;
        x.stop();
        delete x;
    });
    var n = 0;
    list.forEach(function(x) {
        x._type = type;
        n += self.scheduleCronjob(x);
    });
    return n;
}

// Load crontab from JSON file as list of job specs:
// - cron - cron time interval spec: 'second' 'minute' 'hour' 'dayOfMonth' 'month' 'dayOfWeek'
// - job - a string as obj.method or an object with job name as property name and the value is an object with
//         additional jobspec for the job passed as first argument, a job callback always takes jobspec and callback as 2 arguments
// - disabled - disable the job but keep in the cron file, it will be ignored
//
// Example:
//
//          [ { cron: "0 0 * * * *", job: "scraper.run" }, ..]
jobs.loadCronjobs = function()
{
    var self = this;

    var list = [];
    fs.readFile(core.path.etc + "/crontab", function(err, data) {
        self.parseCronjobs("crontab", data);

        fs.readFile(core.path.etc + "/crontab.local", function(err, data) {
            self.parseCronjobs("crontab.local", data);
        });
    });

    // Watch config directory for changes
    if (this.cronWatcher) return;
    this.cronWatcher = fs.watch(core.path.etc, function (event, filename) {
        if (filename && filename.match(/crontab/)) core.setTimeout(filename, function() { self.loadCronjobs(); }, 5000);
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
    var n = this.scheduleCronjobs(type, lib.jsonParse(data, { list: 1, error: 1 }));
    logger.info("parseCronjobs:", type, n, "jobs");
}
