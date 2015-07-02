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

// Job launcher and scheduler
var jobs = {
    // Config parameters
    args: [{ name: "max-workers", type: "number", min: 1, max: 32, descr: "Max number of worker processes to launch for jobs" },
           { name: "worker-args", type: "list", descr: "Node arguments for workers, for passing v8 jobspec" },
           { name: "max-time", type: "number", min: 300, descr: "Max number of seconds a job can run before being killed, for instance mode only" },
           { name: "idle-time", type: "number", min: 0, descr: "If set and no jobs are submitted during this period in seconds of time the instance will be shutdown, for instance mode only" },
           { name: "submit", type: "callback", callback: function(v) { if (core.role == "master") this.submitPending(lib.base64ToJson(v)) }, descr: "Job specification, JSON encoded as base64 of the job object" },
           { name: "name", type: "callback", callback: function(v) { if (core.role == "master") this.submitPending(v) }, descr: "Job specification, a simple case when just a job name is used without any properties" },
           { name: "tag", descr: "This server executes jobs that match this tag, if empty then execute all jobs, if not empty execute all that match current IP address and this tag" },
           { name: "count", descr: "How many jobs to execute at any iteration" },
           { name: "queue", descr: "Name of the queue to process, this is a generic queue name that can be used by any queue provider" },
           { name: "type", descr: "Queueing system to use for job processing, available jobspec: db, sqs" },
           { name: "interval", type: "number", min: 5, dflt: 60, descr: "Interval between processing the job queue, in seconds, i.e. how often to check an external queue for pending jobs" },
           { name: "pending-interval", type: "number", min: 1, dflt: 5, descr: "Interval between processing the local pending queue, in seconds, i.e. how often to submit jobs for execution to workers from the pending list, this list is kept in memory in the master process" },
           { name: "waitTimeout", type: "number", min: 0, dflt: 5, descr: "How long in seconds to wait for new jobs from a queue" },
           { name: "visibilityTimeout", type: "number", min: 0, descr: "How long in seconds to keep retrieved jobs hidden, if not deleted it will be available again for subsequent retrieve requests" },
           { name: "no-cron", type: "bool", descr: "Disable cron jobs, crontab will be ignored" },
           { name: "cron", type: "callback", callback: function(v) { if (!this.noCron) this.parseCronjobs("config", v) }, descr: "An array with crontab objects, similar to etc/crontab but loaded from the config" },
    ],

    type: "none",
    // Jobs waiting for the next avaialble worker
    pending: [],
    // List of running jobs for a worker or all jobs running for a master
    running: [],
    // Time of the last update on jobs and tasks
    runTime: 0,
    // How long to be in idle state and shutdown, for use in instances
    idleTime: 60,
    // Max number of seconds since the last job time before killing this job instance, for long running jobs it must update jobs.runTime periodically
    maxTime: 3600,
    // Interval for queue processing
    interval: 60,
    // Interval for pending list processing
    pendingInterval: 5,
    // Batch size
    count: 1,
    // Max simultaneous jobs
    maxWorkers: 1,
    // Schedules cron jobs
    crontab: [],
    // Worker process arguments
    workerArgs: [],
};

module.exports = jobs;

// Initialize jobs processing in the master process
jobs.configureMaster = function(options, callback)
{
    var self = this;

    // Setup background tasks from the crontab
    if (!this.noCron) this.loadCronjobs();

    this._jobsTimer = setInterval(this.processJob.bind(this), this.interval * 1000);
    this._pendingTimer = setInterval(this.processPending.bind(this), this.pendingInterval * 1000);

    // Check idle time, if no jobs running for a long time shutdown the server, this is for instance mode mostly
    setInterval(function() {
        if (core.instance.job && self.idleTime > 0 && !Object.keys(cluster.workers).length && Date.now() - self.runTime > self.idleTime*1000) {
            logger.log('configureMaster:', 'jobs: idle:', self.idleTime);
            self.shutdown();
        }
    }, 30000);

    callback();
}

// Make sure a job worker does not run indefinitely
jobs.configureWorker = function(options, callback)
{
    var self = this;

    setInterval(function() {
        var now = Date.now()
        // Check idle time, exit worker if no jobs submitted
        if (self.idleTime > 0 && !self.jobs.length && now - self.runTime > self.idleTime*1000) {
            logger.log('configureWorker:', 'jobs: idle: no more jobs to run', self.idleTime);
            process.exit(0);
        }
        // Check how long we run and force kill if exceeded
        if (now - self.runTime > self.maxTime*1000) {
            logger.log('configureWorker:', 'jobs: time: exceeded max run time', self.maxTime);
            process.exit(0);
        }
    }, 30000);

    callback();
}

// Make sure the job is valid and has all required fields, returns the job object or an error, the jobspec
// must be in the for format: { job: { "module.method": {}, .... } } or a simple case as a string "module.method"
jobs.verify = function(jobspec)
{
    // Build job object with canonical name
    if (typeof jobspec == "string") jobspec = { job: lib.newObj(jobspec, null) };
    if (!lib.isObject(jobspec) || !lib.isObject(jobspec.job)) return lib.newError('invalid job: ' + jobspec);
    if (!Object.keys(jobspec.job).length) return lib.newError('empty job:' + jobspec);
    return jobspec;
}

// Do not exceed max number of running workers
jobs.isReady = function()
{
    return Object.keys(cluster.workers).length < this.maxWorkers;
}

// Run all jobs from the job spec at the same time, when the last job finishes and it is running in the worker process, the process terminates.
jobs.run = function(jobspec)
{
    var self = this;

    function done(err, name) {
        logger[err ? "error" : "debug"]('jobs.run:', 'finished', name || "", util.isError(err) ? err.stack : (err || ""));
        if (self.running.length) return;
        lib.series([
           function(next) {
               if (!jobspec.finishJob) return next();
               clearInterval(jobspec._hideJobInterval);
               if (!err || (err.status && err.status >= 500)) self.finishJob(jobspec, function() { next() });
           },
           function(next) {
               if (!cluster.isWorker) return next();
               core.runMethods("shutdownWorker", function() { next() });
           },
           ], function() {
               logger.debug('run:', 'jobs; exit', name || "", err || "");
               process.exit(0);
           });
    }

    if (!lib.isObject(jobspec) || !lib.isObject(jobspec.job)) return done(lib.newError('invalid job', 500), jobspec);

    // Keep the job hidden while processing
    if (jobspec.hideJobInterval >= 1000) {
        jobspec._hideJobInterval = setInterval(function() { self.hideJob(jobspec); }, jobspec.hideJobInterval);
    }

    for (var name in jobspec.job) {
        var task = jobspec.job[name];
        // Skip special objects
        if (task instanceof domain.Domain) continue;

        // Make report about unknown job, leading $ are used for same method miltiple times in the same job because property names are unique in the objects
        var spec = name.replace(/^[\$]+/g, "").split('.');
        var module = spec[0] == "core" ? core : core.modules[spec[0]];
        if (!module || !module[spec[1]]) {
            logger.error('run:', "jobs: unknown method", name, 'job:', job);
            continue;
        }

        // Pass as first argument the jobspec object, then callback
        var args = [ lib.isObject(task) ? task : {} ];

        // The callback to finalize job execution
        (function (jname) {
            args.push(function(err) {
                self.runTime = Date.now();
                // Update process title with current job list
                var idx = self.running.indexOf(jname);
                if (idx > -1) self.running.splice(idx, 1);
                if (cluster.isWorker) process.title = core.name + ': worker ' + self.running.join(',');
                done(err, jname);
            });
        })(name);

        var d = domain.create();
        d.on("error", args[1]);
        d.run(function() {
            module[spec[1]].apply(module, args);
            self.runTime = Date.now();
            self.running.push(name);
            if (cluster.isWorker) process.title = core.name + ': worker ' + self.running.join(',');
            logger.debug('run:', 'jobs: started', name, task || "");
        });
    }
    // No jobs started or errors, just exit
    if (!this.running.length && cluster.isWorker) done(lib.newError("no jobs specified", 500), jobspec);
}

// Execute a job in the background by one of the workers, a job to run is specified with the following spec: `module.method`.
//
// The module must refer to a known exported module and method must be existing method of the given object. The method function must take a job
// object as its first argument and callback as its second argument.
//
// More than one job can be specified, property of the object defines name for the job to run:
//
// Example:
//
//          { job: { 'scraper.run': {}, 'server.shutdown': {} } }
//
// If the same object.method must be executed several times, prepend subsequent jobs with $
//
// Example:
//
//          { job: { 'scraper.run': { "arg": 1 }, '$scraper.run': { "arg": 2 }, '$$scraper.run': { "arg": 3 } } }
//
// Supported properties by the server:
//  - skipqueue - in case of a duplicate or other condition when this job cannot be executed it will be put back to
//      the waiting queue, if set to 1 it makes the job to be ignored on error
//  - runalways - no checks for existing job with the same name should be done
//  - runone - only run the job if there is no same running job, this property serializes jobs with the same name
//  - runlast - run when no more pending or running jobs
//  - runafter - specifies another job in canoncal form `obj.method` which must finish and not be pending in
//    order for this job to start, this implements chaining of jobs to be executed one after another
//    but submitted at the same time
//
//  Exampe: submit 3 jobs to run sequentially:
//
//          'scraper.import'
//          { job: 'scraper.sync', runafter: 'scraper.import' }
//          { job: 'server.shutdown', runafter: 'scraper.sync' }
jobs.runWorker = function(jobspec)
{
    var self = this;

    if (cluster.isWorker) return logger.error('exec: can be called from the master only', jobspec);

    try {
        jobspec = this.verify(jobspec);
        if (util.isError(jobspec)) return logger.error("runWorker:", jobspec);

        // Do not exceed max number of running workers
        if (!this.isReady()) {
            this.pending.push(jobspec);
            return logger.debug('jobs.runWorker:', 'max number of workers running:', this.maxWorkers, 'job:', jobspec);
        }

        // Perform conditions check, any failed condition will reject the whole job
        for (var p in jobspec) {
            var opts = jobspec[p] || {};
            // Do not execute if we already have this job running
            if (this.running.indexOf(p) > -1 && !opts.runalways) {
                if (!opts.skipqueue) this.pending.push(jobspec);
                return logger.debug('runWorker: already running', jobspec);
            }

            // Condition for job, should not be any pending or running jobs
            if (opts.runlast) {
                if (this.running.length || this.pending.length) {
                    if (!opts.skipqueue) this.pending.push(jobspec);
                    return logger.debug('runWorker:', 'other jobs still exist', jobspec);
                }
            }

            // Check dependencies, only run when there is no dependent job in the running list
            if (opts.runone) {
                if (this.running.filter(function(x) { return x.match(opts.runone) }).length) {
                    if (!opts.skipqueue) this.pending.push(jobspec);
                    return logger.debug('runWorker:', 'depending job still exists:', jobspec);
                }
            }

            // Check dependencies, only run when there is no dependent job in the running or pending lists
            if (opts.runafter) {
                if (this.running.some(function(x) { return x.match(opts.runafter) }) ||
                    this.pending.some(function(x) { return Object.keys(x).some(function(y) { return y.match(opts.runafter); }); })) {
                    if (!opts.skipqueue) this.pending.push(jobspec);
                    return logger.debug('runWorker:', 'depending job still exists:', jobspec);
                }
            }
        }
    } catch(e) {
        logger.error('runWorker:', e, jobspec);
        return false;
    }

    // Setup node args passed for each worker
    if (this.workerArgs) process.execArgv = this.workerArgs;

    this.runTime = Date.now();
    logger.debug('runWorker:', jobspec);

    // Start a worker, send the job and wait when it finished
    var worker = cluster.fork();
    worker.on("error", function(e) {
        logger.error('runWorker:', e, jobspec);
        worker = null;
    })
    worker.on('message', function(msg) {
        if (msg != "ready") return;
        worker.send(jobspec);
        // Make sure we add new jobs after we successfully created a new worker
        self.running = self.running.concat(Object.keys(jobspec.job));
    });
    worker.on("exit", function(code, signal) {
        logger.info('runWorker:', 'finished:', worker.id, 'pid:', worker.process.pid, 'code:', code || 0, '/', signal || 0, 'job:', jobspec);
        for (var p in jobspec.job) {
            var idx = self.running.indexOf(p);
            if (idx > -1) self.running.splice(idx, 1);
        }
        worker = null;
    });
    return true;
}

// Remote mode, launch remote instance to perform scraping or other tasks
// By default, shutdown the instance after job finishes unless noshutdown:1 is specified in the jobspec
jobs.runRemote = function(jobspec, callback)
{
    jobspec = this.verify(jobspec);
    if (util.isError(jobspec)) return typeof callback == "function" && callback(jobspec);

    this.runTime = Date.now();
    jobspec = lib.cloneObj(jobspec);
    logger.info('runRemote:', jobspec);

    // Common arguments for remote workers
    var args = ["-master", "-instance-job", "-jobs-submit", lib.jsonToBase64(jobspec) ];

    if (!jobspec.noshutdown) {
        args.push("-jobs-submit", lib.jsonToBase64({ 'server.shutdown': { runlast: 1 } }));
    }

    // Command line arguments for the instance, must begin with -
    for (var p in jobspec.args) {
        if (p[0] == '-') args.push(p, jobspec[p])
    }
    jobspec.UserData = args.map(function(x) { return String(x).replace(/ /g, '%20') }).join(" ");
    // Use first job name as the instance tag
    jobspec.instanceName = Object.keys(jobspec.job)[0];

    // Terminate after the job is done
    if (!jobspec.InstanceInitiatedShutdownBehavior && !jobspec.terminate && !jobspec.stop) jobspec.terminate = 1;

    aws.ec2RunInstances(jobspec, callback);
}

// Place a job in the local pending queue to be processed later.
jobs.submitPending = function(jobspec)
{
    switch (lib.typeName(jobspec)) {
    case "string":
        jobspec = { job: lib.newObj(jobspec, null) };

    case "object":
        if (!lib.isObject(jobspec.job)) break;
        this.pending.push(jobspec);
        return;
    }
    logger.error("submitPending:", "invalid task: ", jobspec);
}

// Process pending jobs, submit to idle workers
jobs.processPending = function()
{
    if (!this.pending.length) return;
    var job = this.pending.shift();
    if (job) this.runWorker(job);
}

// Create a new cron job, for remote jobs additional property args can be used in the object to define
// arguments for the instance backend process, properties must start with -
//
// Example:
//
//          { "type": "server", "cron": "0 */10 * * * *", "job": "server.processQueue" },
//          { "type": "worker", "cron": "0 10 7 * * *", "id": "processQueue", "job": "api.processQueue" }
//          { "type": "remote", "cron": "0 5 * * * *", "args": { "-workers": 2 }, "job": { "scraper.run": { "url": "host1" }, "$scraper.run": { "url": "host2" } } }
//          { "type": "worker", "cron": "0 */10 * * * *", "job": "server.processQueue" },
//          { "type": "queue", "cron": "0 */30 * * * *", "job": "server.processSQS" },
//
jobs.scheduleCronjob = function(jobspec)
{
    var self = this;
    if (!lib.isObject(jobspec) || !jobspec.cron || !jobspec.job || jobspec.disabled) return false;
    logger.debug('scheduleCronjob:', jobspec);
    try {
        var cj = new cron.CronJob(jobspec.cron, function() { self.runJob(this.job); }, null, true);
        cj.job = jobspec;
        this.crontab.push(cj);
        return true;
    } catch(e) {
        logger.error("scheduleCronjob:", e, jobspec);
        return false;
    }
}

// Schedule a list of cron jobs, types is used to cleanup previous jobs for the same type for cases when
// a new list needs to replace the existing jobs. Empty list does nothing, to eset the jobs for the partivular type and
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

// Execute a cronjob by id now, it must have been scheduled already and id property must be specified in the crontab
// When REPL is activated on the master server with -repl-port then connecting to the running master server via telnet it is possible to execute
// cron jobs manually
//
//  Example:
//
//      // Start the backend with repl-port like `bkjs run-backend -repl-port 2080`
//
//      # telnet localhost 2080
//      > server.runCronjob("processQueue")
//
jobs.runCronjob = function(id)
{
    this.crontab.forEach(function(x) {
       if (x.job && x.job.id == id) x._callback();
    });
}

// Load crontab from JSON file as list of job specs:
// - type - worker, remote, server, queue
//      - worker means spawn a worker to run the job function
//      - remote means launch an AWS instance
//      - server means run inside the master process, do not spawn a worker
//      - queue means put this job object into the database tobe processed by a worker
// - cron - cron time interval spec: 'second' 'minute' 'hour' 'dayOfMonth' 'month' 'dayOfWeek'
// - job - a string as obj.method or an object with job name as property name and the value is an object with
//         additional jobspec for the job passed as first argument, a job callback always takes jobspec and callback as 2 arguments
// - args - additional arguments to be passed to the backend in the command line for the remote jobs
// - disabled - disable the job but keep in the cron file, it will be ignored
//
// Example:
//
//          [ { "type": "local", cron: "0 0 * * * *", job: "scraper.run" }, ..]
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
        if (filename == "crontab") core.setTimeout(filename, function() { self.loadCronjobs(); }, 5000);
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

// Run or schedule a job according to the type
jobs.runJob = function(jobspec, callback)
{
    jobspec = this.verify(jobspec);
    if (util.isError(jobspec)) return typeof callback == "function" && callback(jobspec);

    // Ignore expired jobs
    if (jobspec.etime && jobspec.etime < Date.now()) return typeof callback == "function" && callback(lib.newError("expired job"));

    switch (jobspec.type || "") {
    case "cron":
        jobspec.type = "worker";
        this.scheduleCronjob(jobspec);
        break;

    case "queue":
        // Submit the job to a worker for execution later, this is for moving jobs from one queue type to another
        jobspec.type = "worker";
        this.submitJob(jobspec);
        break;

    case "request":
        // Send a job via HTTP to a remote location
        core.sendRequest(jobspec, callback);
        return;

    case 'remote':
        // Launch an instance
        setImmediate(this.runRemote.bind(this, jobspec));
        break;

    case "server":
        var self = this;
        setImmediate(function() {
            var d = domain.create();
            d.on('error', function(err) { logger.error('runJob:', jobspec, err.stack); });
            d.add(jobspec);
            d.run(function() { self.run(jobspec); });
        });
        break;

    default:
        // Put into local task queue to be processed by a worker
        setImmediate(this.submitPending.bind(this, jobspec));
        break;
    }
    if (typeof callback == "function") callback();
}

// Periodically pull submitted jobs from the Db or other queue system and send it to execution. The primary goal for this
// job system is to execute cron jobs, i.e. jobs to be executed periodically based on time or other condition but NOT to
// be used for on-demand jobs from a web process for example.
//
// It is run by the master process every `-server-jobs-interval` seconds.
//
// For `db` type, it requires connection to the database, how jobs appear in the table and the order of execution is not concern of this function,
// the higher level management tool must take care when and what to run and in what order.
// If `tag` has been set then only jobs with such tag will be pulled by this master.
//
// By default a job pulled from any queue is deleted as soon as it is scheduled for execution. To disable this a property `finishJob` can be set in the job spec object
// to keep the job message in the queue until the worker is finished.
//
// On exit the worker will call `finishJob` automatically which will delete the job from the queue if no errors occurred. In case of an error the job will be
// deleted only if the error status is >= 500, all other errors are considered runtime and will keep the job in the queue for possible troubleshooting or repeating
// the processing.
//
// For SQS queues if `finishJob` is specified a worker will periodically call `hideJob` to keep the message hidden while processing, the interval is derived from
// the `visibilityTimeout`.
//
// The options can specify:
//  - queue - SQS queue ARN, if not specified the `-server-job-queue` will be used
//  - timeout - how long to wait for job messages, seconds, if not specified then used `-jobs-wait-timeout` config parameter
//  - count - how many jobs to receive, if not specified then it uses `-jobs-count` config parameter
//  - visibilityTimeout - The duration in seconds that the received messages are hidden from subsequent retrieve requests
//     after being retrieved by a ReceiveMessage request, if not specified then it uses `-jobs-visibility-timeout` config parameter.
//  - tag - retrieve jobs with this tag only from the queue
//
jobs.processJob = function(options, callback)
{
    if (this._processJob || !this.isReady()) return;
    var self = this;
    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {};
    if (typeof callback != "function") callback = lib.noop;

    switch (this.type) {
    case "sqs":
        var queue = options.queue || self.jobQueue;
        if (!queue) return callback();
        if (!options.count) options.count = self.count || 1;
        if (!options.timeout) options.timeout = self.waitTimeout || 5;
        if (!options.visibilityTimeout) options.visibilityTimeout = self.visibilityTimeout || 0;
        this._processJob = 1;
        aws.sqsReceiveMessage(queue, options, function(err, rows) {
            if (err) return callback(err);
            lib.forEachSeries(rows || [], function(item, next) {
                var jobspec = lib.jsonParse(item.Body, { obj: 1, error: 1 });
                jobspec.queueType = "sqs";
                jobspec.sqsQueue = queue;
                jobspec.sqsReceiptHandle = item.ReceiptHandle;
                if (jobspec.finishJob) jobspec.hideJobInterval = Math.round(options.visibilityTimeout * 1000 * 0.9);
                self.runJob(jobspec, function(err) {
                    if (err) logger.error("processSQS:", err, jobspec)
                    if (err || !jobspec.finishJob) self.finishJob(jobspec);
                    next();
                });
            }, function(err) {
                delete self._processJob;
                if (err) logger.error("processSQS:", err);
                if (rows.length) logger.info('processSQS:', rows.length, 'jobs');
                callback(err);
            });
        });
        break;

    case "db":
        this._processJob = 1;
        db.select("bk_queue", { tag: this.tag, status: null }, { ops: { status: "null" }, count: options.count || self.count }, function(err, rows) {
            lib.forEachSeries(rows, function(row, next) {
                var jobspec = row.data;
                jobspec.dbId = row.id;
                jobspec.queueType = "db";
                self.runJob(jobspec, function(err) {
                    if (err) logger.error("processDb:", err, jobspec)
                    if (err || !jobspec.finishJob) self.finishJob(jobspec); else self.hideJob(jobspec);
                    next();
                });
            }, function(err) {
                delete self._processJob;
                if (err) logger.error("processDb:", err);
                if (rows.length) logger.info('processQueue:', rows.length, 'jobs');
                callback(err);
            });
        });
        break;
    }
}

// Submit a job for execution, it will be saved in a queue and will be picked up later and executed. The queue and the way how it will be executed depends on the
// configured queue.
//
// The jobspec can specify the following properties:
//  - id - unique job id or UUID will be generated
//  - tag - if there are multiple known workers this tag will dedicate this job to such worker
jobs.submitJob = function(jobspec, options, callback)
{
    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {};
    jobspec = this.verify(jobspec);
    if (util.isError(jobspec)) return typeof callback == "function" && callback(jobspec);

    logger.debug('submitJob:', this.type, jobspec);
    switch (this.type) {
    case "sqs":
        var queue = jobspec.queue || this.jobQueue;
        if (!queue) return callback(lib.newError("jobs queue is not configured"));
        aws.sqsSendMessage(queue, JSON.stringify(jobspec), options, callback);
        break;

    case "db":
        db.put("bk_queue", { id: options.id || lib.uuid(), tag: options.tag, data: jobspec }, callback);
        break;

    default:
        if (typeof callback == "function") callback(lib.newError('no queue configured', 500));
    }
}

// Finish and mark or delete a job after the successfull execution, this is supposed to be called by
// the jobs that handle completion, by default a job pulled from the queue is deleted on successful schedule.
// The jobspec is the same job object that was passed to the `jobs.submit`.
jobs.finishJob = function(jobspec, callback)
{
    if (!lib.isObject(jobspec)) return typeof callback == "function" && callback(lib.newError('invalid job'));

    logger.debug('finishJob:', jobspec);
    switch (jobspec.queueType) {
    case "sqs":
        if (jobspec.sqsQueue && jobspec.sqsReceiptHandle) {
            return aws.querySQS("DeleteMessage", jobspec.sqsQueue, { ReceiptHandle: jobspec.sqsReceiptHandle }, callback);
        }
        break;

    case "db":
        if (jobspec.dbId) {
            return db.del("bk_queue", { id: jobspec.dbId }, callback);
        }
        break;
    }
    if (typeof callback == "function") callback();
}

// To keep a job from receiveing by other job processors this is used to hide it while it is being run.
// Depending on the queue type different properties can be used:
//  - visibilityTimeout - how long in seconds the message must be hidden in the SQS queue type, if not specified 30 seconds will be set
//  - status - set status to this value for the DB queue type, if not specified `hidden` status would be set
//
// It is safe to call this from any task, if no special properties are detected that can be used to communicate with a queue it will be silently ignored.
jobs.hideJob = function(jobspec, callback)
{
    if (!lib.isObject(jobspec)) return typeof callback == "function" && callback(lib.newError('invalid job'));

    logger.debug('hideJob:', jobspec);
    switch (jobspec.queueType) {
    case "sqs":
        if (jobspec.sqsQueue && jobspec.sqsReceiptHandle) {
            var query = {
                ReceiptHandle: jobspec.sqsReceiptHandle,
                VisibilityTimeout: lib.toNumber(jobspec.visibilityTimeout, { dflt: 30, min: 0, max: 43200 })
            };
            return aws.querySQS("ChangeMessageVisibility", jobspec.sqsQueue, query, callback);
        }
        break;

    case "db":
        if (jobspec.dbId) {
            return db.update("bk_queue", { id: jobspec.dbId, status: jobspec.status || "hidden" }, callback);
        }
        break;
    }
    if (typeof callback == "function") callback();
}
