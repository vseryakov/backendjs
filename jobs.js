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
           { name: "worker-args", type: "list", descr: "Node arguments for workers, for passing v8 options" },
           { name: "max-time", type: "number", min: 300, descr: "Max number of seconds a job can run before being killed, for instance mode only" },
           { name: "submit", type: "callback", callback: function(v) { if (core.role == "master") this.updateQueue(lib.base64ToJson(v)) }, descr: "Job specification, JSON encoded as base64 of the job object" },
           { name: "name", type: "callback", callback: function(v) { if (core.role == "master") this.updateQueue(v) }, descr: "Job specification, a simple case when just a job name is used without any properties" },
           { name: "delay", type: "int", min: 0, descr: "Delay in milliseconds before starting the jobs passed via command line after the master process started" },
           { name: "tag", descr: "This server executes jobs that match this tag, if empty then execute all jobs, if not empty execute all that match current IP address and this tag" },
           { name: "count", descr: "How many jobs to execute at any iteration" },
           { name: "queue", descr: "Name of the queue to process, this is a generic queue name that can be used by any queue provider" },
           { name: "type", descr: "Queueing system to use for job processing, available options: db, sqs" },
           { name: "interval", type: "number", min: 0, descr: "Interval between executing job queue, must be set to enable jobs, 0 disables job processing, in seconds, min interval is 60 secs" } ],

    // Job waiting for the next avaialble worker
    queue: [],
    // List of jobs a worker is running or all jobs running
    jobs: [],
    // Time of the last update on jobs and workers
    time: 0,
    // Max number of seconds since the last job time before killing this job instance, for long running jobs it must update jobTime periodically
    maxTime: 3600,
    // Interval between jobs scheduler
    interval: 0,
    // Delay before job start
    delay: 1000,
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

// Make sure the job is valid and has all required fields, returns the job object or an error
jobs.verify = function(options)
{
    // Build job object with canonical name
    if (typeof options == "string") options = { job: lib.newObj(options, null) };
    if (!lib.isObject(options)) return new Error('invalid job: ' + options);
    if (typeof options.job == "string") options.job = lib.newObj(options.job, null);
    if (!Object.keys(options.job).length) return new Error('empty job:' + options);
    return options;
}

// Run all jobs from the job spec at the same time, when the last job finishes and it is running in the worker process, the process terminates.
jobs.run = function(options)
{
    var self = this;

    function done(err, name) {
        logger[err ? "error" : "debug"]('jobs.run:', 'finished', name || "", err || "");
        if (!self.jobs.length && cluster.isWorker) {
            core.runMethods("shutdownWorker", function() {
                logger.debug('jobs.run:', 'exit', name || "", err || "");
                process.exit(0);
            });
        }
    }

    if (!lib.isObject(options) || !lib.isObject(options.job)) return done('invalid job', options);

    for (var name in options.job) {
        var job = options[name];
        // Skip special objects
        if (job instanceof domain.Domain) continue;

        // Make report about unknown job, leading $ are used for same method miltiple times in the same job because property names are unique in the objects
        var spec = name.replace(/^[\$]+/g, "").split('.');
        var module = spec[0] == "core" ? core : core.modules[spec[0]];
        if (!module || !module[spec[1]]) {
            logger.error('jobs.run:', "unknown method", name, 'job:', job);
            continue;
        }

        // Pass as first argument the options object, then callback
        var args = [ lib.isObject(job) ? job : {} ];

        // The callback to finalize job execution
        (function (jname) {
            args.push(function(err) {
                self.time = Date.now();
                // Update process title with current job list
                var idx = self.jobs.indexOf(jname);
                if (idx > -1) self.jobs.splice(idx, 1);
                if (cluster.isWorker) process.title = core.name + ': worker ' + self.jobs.join(',');
                // Update the job queue
                if (options.finish) self.finish(options);
                done(err, jname);
            });
        })(name);

        var d = domain.create();
        d.on("error", args[1]);
        d.run(function() {
            module[spec[1]].apply(module, args);
            self.time = Date.now();
            self.jobs.push(name);
            if (cluster.isWorker) process.title = core.name + ': worker ' + self.jobs.join(',');
            logger.debug('jobs.run:', 'started', name, job || "");
        });
    }
    // No jobs started or errors, just exit
    if (!self.jobs.length && cluster.isWorker) done("no jobs", options);
}

// Execute job in the background by one of the workers, object must be known exported module
// and method must be existing method of the given object. The method function must take options
// object as its first argument and callback as its second argument.
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
// Supported options by the server:
//  - skipqueue - in case of a duplicate or other condition when this job cannot be executed it is put back to
//      the waiting queue, this options if set to 1 makes the job to be ignored on error
//  - runalways - no checks for existing job wth the same name should be done
//  - runone - only run the job if there is no same running job, this options serializes similar jobs
//  - runlast - run when no more pending or running jobs
//  - runafter - specifies another job in canoncal form obj.method which must finish and not be pending in
//    order for this job to start, this implements chaining of jobs to be executed one after another
//    but submitted at the same time
//
//  Exampe: submit 3 jobs to run sequentially:
//
//          'scraper.import'
//          { job: 'scraper.sync', runafter: 'scraper.import' }
//          { job: 'server.shutdown', runafter: 'scraper.sync' }
jobs.runWorker = function(options)
{
    var self = this;

    if (cluster.isWorker) return logger.error('exec: can be called from the master only', options);

    try {
        options = this.verify(options);
        if (options instanceof Error) return callback(options);

        // Do not exceed max number of running workers
        var workers = Object.keys(cluster.workers);
        if (workers.length >= self.maxWorkers) {
            self.queue.push(options);
            return logger.debug('jobs.runWorker:', 'max number of workers running:', self.maxWorkers, 'job:', options);
        }

        // Perform conditions check, any failed condition will reject the whole job
        for (var p in options) {
            var opts = options[p] || {};
            // Do not execute if we already have this job running
            if (self.jobs.indexOf(p) > -1 && !opts.runalways) {
                if (!opts.skipqueue) self.queue.push(options);
                return logger.debug('jobs.runLocal: already running', options);
            }

            // Condition for job, should not be any pending or running jobs
            if (opts.runlast) {
                if (self.jobs.length || self.queue.length) {
                    if (!opts.skipqueue) self.queue.push(options);
                    return logger.debug('jobs.runWorker:', 'other jobs still exist', options);
                }
            }

            // Check dependencies, only run when there is no dependent job in the running list
            if (opts.runone) {
                if (self.jobs.filter(function(x) { return x.match(opts.runone) }).length) {
                    if (!opts.skipqueue) self.queue.push(options);
                    return logger.debug('jobs.runWorker:', 'depending job still exists:', options);
                }
            }

            // Check dependencies, only run when there is no dependent job in the running or pending lists
            if (opts.runafter) {
                if (self.jobs.some(function(x) { return x.match(opts.runafter) }) ||
                    self.queue.some(function(x) { return Object.keys(x).some(function(y) { return y.match(opts.runafter); }); })) {
                    if (!opts.skipqueue) self.queue.push(options);
                    return logger.debug('jobs.runWorker:', 'depending job still exists:', options);
                }
            }
        }
    } catch(e) {
        logger.error('jobs.runWorker:', e, options);
        return false;
    }

    // Setup node args passed for each worker
    if (self.workerArgs) process.execArgv = self.workerArgs;

    self.time = Date.now();
    logger.debug('jobs.runWorker:', 'workers:', workers.length, 'job:', options);

    // Start a worker, send the job and wait when it finished
    var worker = cluster.fork();
    worker.on("error", function(e) {
        logger.error('jobs.runWorker:', e, options);
        worker = null;
    })
    worker.on('message', function(msg) {
        if (msg != "ready") return;
        worker.send(options);
        // Make sure we add new jobs after we successfully created a new worker
        self.jobs = self.jobs.concat(Object.keys(options.job));
    });
    worker.on("exit", function(code, signal) {
        logger.log('jobs.exec: finished:', worker.id, 'pid:', worker.process.pid, 'code:', code || 0, '/', signal || 0, 'job:', options);
        for (var p in options.job) {
            var idx = self.jobs.indexOf(p);
            if (idx > -1) self.jobs.splice(idx, 1);
        }
        worker = null;
    });
    return true;
}

// Remote mode, launch remote instance to perform scraping or other tasks
// By default, shutdown the instance after job finishes unless noshutdown:1 is specified in the options
jobs.runRemote = function(options, callback)
{
    if (typeof callback != "function") callback = lib.noop;
    options = this.verify(options);
    if (options instanceof Error) return callback(options);

    this.time = Date.now();
    job = lib.cloneObj(job);
    logger.log('jobs.runRemote:', options);

    // Common arguments for remote workers
    var args = ["-master", "-instance-job",
                "-backend-host", core.backendHost || "",
                "-backend-key", core.backendKey || "",
                "-backend-secret", core.backendSecret || "",
                "-jobs-submit", lib.jsonToBase64(job) ];

    if (!options.noshutdown) {
        args.push("-jobs-submit", lib.jsonToBase64({ 'server.shutdown': { runlast: 1 } }));
    }

    // Command line arguments for the instance, must begin with -
    for (var p in options.args) {
        if (p[0] == '-') args.push(p, options[p])
    }
    options.UserData = args.map(function(x) { return String(x).replace(/ /g, '%20') }).join(" ");
    // Update tag name with current job
    var d = args.match(/\-jobname ([^ ]+)/i);
    if (d) options.instanceName = d[1];

    // Terminate after the job is done
    if (!options.InstanceInitiatedShutdownBehavior && !options.termnate && !options.stop) options.terminate = 1;

    aws.ec2RunInstances(options, callback);
}

// Submit a job for execution according to the type
jobs.submit = function(options, callback)
{
    var self = this;
    if (typeof callback != "function") callback = lib.noop;
    if (!lib.isObject(options) || !options.job) return callback(new Error("invalid job"));

    // Ignore expired jobs
    if (options.etime && options.etime < Date.now()) return callback(new Error("expired job"));

    switch (options.type || "") {
    case "cron":
        options.type = "worker";
        self.scheduleCronjob(options);
        break;

    case "queue":
        // Submit the job to a worker for execution later
        options.type = "worker";
        self.updateDb(options);
        break;

    case "request":
        core.sendRequest(options);
        break;

    case 'remote':
        setImmediate(function() { self.runRemote(options); });
        break;

    case "server":
        setImmediate(function() {
            var d = domain.create();
            d.on('error', function(err) { logger.error('schedule:', options, err.stack); });
            d.add(options);
            d.run(function() { self.run(options); });
        });
        break;

    default:
        setImmediate(function() { self.updateQueue(options); });
        break;
    }
    callback();
}

// Finish and mark or delete a job after the successfull execution, this is supposed to be called by
// the jobs that handle completion, by default new job pulled from te database is deleted on successful schedule.
// The options is the same job object that was passed to the `jobs.submit`.
jobs.finish = function(options, callback)
{
    if (typeof callback != "function") callback = lib.noop;
    if (!lib.isObject(options)) return callback(new Error('invalid job'));

    logger.debug('finish:', options);
    switch (options.queueType) {
    case "sqs":
        if (options.sqsQueue && options.sqsReceiptHandle) {
            return aws.querySQS("DeleteMessage", { QueueUrl: options.sqsQueue, ReceiptHandle: options.sqsReceiptHandle }, callback);
        }
        break;

    default:
        if (options.id) {
            return db.del("bk_queue", options, callback);
        }
    }
    callback();
}

// Update the job queue with a job, can be an object or a string in the format object.method
// All spaces must be are replaced with %20 to be used in command line parameterrs
jobs.updateQueue = function(options)
{
    switch (lib.typeName(options)) {
    case "string":
        options = { job: lib.newObj(options, null) };

    case "object":
        if (options.job) return this.queue.push(options);
        break;
    }
    logger.error("jobs.updateQueue:", "invalid job: ", options);
}

// Periodically pull submitted jobs from the Db or other queue system and send it to execution. The primary goal for this
// job system is to execute cron jobs, o.e. jobs to be executed periodically based on time or other condition but NOT to
// be used for demand jobs from a web process for example.
jobs.processQueue = function(options, callback)
{
    switch (this.type) {
    case "sqs":
        this.processSQS(options, callback);
        break;
    default:
        this.processDb(options, callback);
    }
}

// Process pending jobs, submit to idle workers
jobs.checkQueue = function()
{
    if (!this.queue.length) return;
    var job = this.queue.shift();
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
jobs.scheduleCronjob = function(options)
{
    var self = this;
    if (!lib.isObject(options) || !options.cron || !options.job || !options.type || options.disabled) return;
    logger.debug('scheduleCronjob:', options);
    var cj = new cron.CronJob(options.cron, function() { self.submit(this.job); }, null, true);
    cj.job = options;
    this.crontab.push(cj);
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
//         additional options for the job passed as first argument, a job callback always takes options and callback as 2 arguments
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
        if (data && data.length) list = lib.jsonParse(data.toString(), { list: 1 });

        fs.readFile(core.path.etc + "/crontab.local", function(err, data) {
            if (data && data.length) list = list.concat(lib.jsonParse(data.toString(), { list: 1 }));

            if (!list.length) return;
            self.crontab.forEach(function(x) { x.stop(); delete x; });
            self.crontab = [];
            list.forEach(function(x) {
                self.scheduleCronjob(x);
            });
            logger.log("loadCronjobs:", self.crontab.length, "schedules");
        });
    });

    // Watch config directory for changes
    if (this.cronWatcher) return;
    this.cronWatcher = fs.watch(core.path.etc, function (event, filename) {
        if (filename == "crontab") core.setTimeout(filename, function() { self.loadCronjobs(); }, 5000);
    });
}

// Submit job for execution, it will be saved in the server queue and the master or job worker will pick it up later.
//
// The options properties:
//  - id - unique job id or UUID will be generated
//  - tag - if there are multiple known workers this tag will dedicate this job to such worker
//  - data - a full job object, cannot be empty
jobs.updateDb = function(options, callback)
{
    if (!lib.isObject(options) || !lib.isObject(options.data)) return typeof callback == "function" && callback(new Error("invalid job"));
    if (!options.id) options.id = lib.uuid();
    logger.debug('updateDb:', options);
    db.put("bk_queue", options, callback);
}

// Load submitted jobs for execution, it is run by the master process every `-server-jobs-interval` seconds.
// Requires connection to the database, how jobs appear in the table and the order of execution is not concern of this function,
// the higher level management tool must take care when and what to run and in what order.
// If `tag` has been set then only jobs with such tag will be pulled by this instance.
//
// If a job object contain sa property `finish` then it is responsibility of a worker to call `jobs.finish` so the job
// will be deleted from the queue. By default all jobs pulled from the db are deleted just after submition for execution.
//
jobs.processDb = function(options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {};
    if (typeof callback != "function") callback = lib.noop;

    var now = Date.now()
    db.select("bk_queue", { tag: this.tag, status: null }, { ops: { status: "null" }, count: options.count || self.count }, function(err, rows) {
        lib.forEachSeries(rows, function(row, next) {
            var job = row.data;
            job.id = row.id;
            self.submit(job, function(err) {
                if (err) logger.error("processDb:", err, job)
                if (err || !job.finish) self.finish(job); else db.update("bk_queue", { id: job.id, status: "running" });
                next();
            });
        }, function(err) {
            if (err) logger.error("processDb:", err);
            if (rows.length) logger.log('processQueue:', rows.length, 'jobs');
            callback(err);
        });
    });
}

// Process AWS SQS queue for any messages and execute jobs, a job object must be in the same format as for the cron jobs.
//
// The options can specify:
//  - queue - SQS queue ARN, if not specified the `-server-job-queue` will be used
//  - timeout - how long to wait for messages, seconds, default is 5
//  - count - how many jobs to receive, if not specified use `-api-max-jobs` config parameter
//  - visibilityTimeout - The duration in seconds that the received messages are hidden from subsequent retrieve requests
//     after being retrieved by a ReceiveMessage request.
//
jobs.processSQS = function(options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {};
    if (typeof callback != "function") callback = lib.noop;

    var queue = options.queue || self.jobQueue;
    if (!queue) return callback();
    if (!options.count) options.count = self.count || 1;

    aws.sqsReceiveMessage(queue, options, function(err, rows) {
        if (err) return callback ? callback(err) : null;
        lib.forEachSeries(rows || [], function(item, next) {
            var job = lib.jsonParse(item.Body, { obj: 1, error: 1 });
            job.queueType = "sqs";
            job.sqsQueue = queue;
            job.sqsReceiptHandle = item.ReceiptHandle;
            self.submit(job, function(err) {
                if (err) logger.error("processSQS:", err, job)
                if (err || !job.finish) self.finish(job);
                next();
            });
        }, function(err) {
            if (err) logger.error("processSQS:", err);
            if (rows.length) logger.log('processSQS:', rows.length, 'jobs');
            callback(err);
        });
    });
}

