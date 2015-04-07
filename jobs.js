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
var corelib = require(__dirname + '/corelib');
var logger = require(__dirname + '/logger');
var db = require(__dirname + '/db');
var aws = require(__dirname + '/aws');

// Job launcher and scheduler
var jobs = {
    // Config parameters
    args: [{ name: "max-workers", type: "number", min: 1, max: 32, descr: "Max number of worker processes to launch for jobs" },
           { name: "worker-args", type: "list", descr: "Node arguments for workers, for passing v8 options" },
           { name: "max-time", type: "number", min: 300, descr: "Max number of seconds a job can run before being killed, for instance mode only" },
           { name: "submit", type: "callback", callback: function(v) { if (core.role == "master") this.updateQueue(corelib.base64ToJson(v)) }, descr: "Job specification, JSON encoded as base64 of the job object" },
           { name: "name", type: "callback", callback: function(v) { if (core.role == "master") this.updateQueue(v) }, descr: "Job specification, a simple case when just a job name is used without any properties" },
           { name: "delay", type: "int", min: 0, descr: "Delay in milliseconds before starting the jobs passed via command line after the master process started" },
           { name: "tag", descr: "This server executes jobs that match this tag, if empty then execute all jobs, if not empty execute all that match current IP address and this tag" },
           { name: "queue", descr: "Name of the queue to process, this is a generic queue name that can be used by any queue provider" },
           { name: "count", descr: "How many jobs to execute at any iteration, this relates to the bk_queue queue processing only" },
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
    // Batch size
    count: 1,
    // Tag for jobs to process
    tag: '',
    // Delay before job start
    delay: 1000,
    // Max simultaneous jobs
    maxWorkers: 1,
    // Schedules cron jobs
    crontab: [],
    // Worker process arguments
    workerArgs: [],
};

module.exports = jobs;

// Run all jobs from the job spec at the same time, when the last job finishes and it is running in the worker process, the process terminates.
jobs.run = function(job)
{
    var self = this;

    function finish(err, name) {
        logger.debug('runJob:', 'finished', name, err || "");
        if (!self.jobs.length && cluster.isWorker) {
            core.runMethods("shutdownWorker", function() {
                logger.debug('jobs.run:', 'exit', name, err || "");
                process.exit(0);
            });
        }
    }

    for (var name in job) {
        // Skip special objects
        if (job[name] instanceof domain.Domain) continue;

        // Make report about unknown job, leading $ are used for same method miltiple times in the same job because property names are unique in the objects
        var spec = name.replace(/^[\$]+/g, "").split('.');
        var obj = spec[0] == "core" ? core : core.modules[spec[0]];
        if (!obj || !obj[spec[1]]) {
            logger.error('jobs.run:', "unknown method", name, 'job:', job);
            continue;
        }

        // Pass as first argument the options object, then callback
        var args = [ corelib.typeName(job[name]) == "object" ? job[name] : {} ];

        // The callback to finalize job execution
        (function (jname) {
            args.push(function(err) {
                self.time = Date.now();
                // Update process title with current job list
                var idx = self.jobs.indexOf(jname);
                if (idx > -1) self.jobs.splice(idx, 1);
                if (cluster.isWorker) process.title = core.name + ': worker ' + self.jobs.join(',');
                finish(err, jname);
            });
        })(name);

        var d = domain.create();
        d.on("error", args[1]);
        d.run(function() {
            obj[spec[1]].apply(obj, args);
            self.time = Date.now();
            self.jobs.push(name);
            if (cluster.isWorker) process.title = core.name + ': worker ' + self.jobs.join(',');
            logger.debug('jobs.run:', 'started', name, job[name] || "");
        });
    }
    // No jobs started or errors, just exit
    if (!self.jobs.length && cluster.isWorker) finish(null, "no jobs");
}

// Execute job in the background by one of the workers, object must be known exported module
// and method must be existing method of the given object. The method function must take options
// object as its first argument and callback as its second argument.
// More than one job can be specified, property of the object defines name for the job to run:
//
// Example:
//
//          { 'scraper.run': {}, 'server.shutdown': {} }
//
// If the same object.method must be executed several times, prepend subsequent jobs with $
//
// Example:
//
//          { 'scraper.run': { "arg": 1 }, '$scraper.run': { "arg": 2 }, '$$scraper.run': { "arg": 3 } }
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
//          { 'scraper.sync': { runafter: 'scraper.import' } }
//          { 'server.shutdown': { runafter: 'scraper.sync' } }
jobs.exec = function(job)
{
    var self = this;

    if (cluster.isWorker) return logger.error('exec: can be called from the master only', job);

    try {
        // Build job object with canonical name
        if (typeof job == "string") job = corelib.newObj(job, null);
        if (typeof job != "object") return logger.error('exec:', 'invalid job', job);

        // Do not exceed max number of running workers
        var workers = Object.keys(cluster.workers);
        if (workers.length >= self.maxWorkers) {
            self.queue.push(job);
            return logger.debug('jobs.exec:', 'max number of workers running:', self.maxWorkers, 'job:', job);
        }

        // Perform conditions check, any failed condition will reject the whole job
        for (var p in job) {
            var opts = job[p] || {};
            // Do not execute if we already have this job running
            if (self.jobs.indexOf(p) > -1 && !opts.runalways) {
                if (!opts.skipqueue) self.queue.push(job);
                return logger.debug('jobs.exec: already running', job);
            }

            // Condition for job, should not be any pending or running jobs
            if (opts.runlast) {
                if (self.jobs.length || self.queue.length) {
                    if (!opts.skipqueue) self.queue.push(job);
                    return logger.debug('jobs.exec:', 'other jobs still exist', job);
                }
            }

            // Check dependencies, only run when there is no dependent job in the running list
            if (opts.runone) {
                if (self.jobs.filter(function(x) { return x.match(opts.runone) }).length) {
                    if (!opts.skipqueue) self.queue.push(job);
                    return logger.debug('jobs.exec:', 'depending job still exists:', job);
                }
            }

            // Check dependencies, only run when there is no dependent job in the running or pending lists
            if (opts.runafter) {
                if (self.jobs.some(function(x) { return x.match(opts.runafter) }) ||
                    self.queue.some(function(x) { return Object.keys(x).some(function(y) { return y.match(opts.runafter); }); })) {
                    if (!opts.skipqueue) self.queue.push(job);
                    return logger.debug('jobs.exec:', 'depending job still exists:', job);
                }
            }
        }
    } catch(e) {
        logger.error('jobs.exec:', e, job);
        return false;
    }

    // Setup node args passed for each worker
    if (self.workerArgs) process.execArgv = self.workerArgs;

    self.time = Date.now();
    logger.debug('jobs.exec:', 'workers:', workers.length, 'job:', job);

    // Start a worker, send the job and wait when it finished
    var worker = cluster.fork();
    worker.on("error", function(e) {
        logger.error('jobs.exec:', e, job);
        worker = null;
    })
    worker.on('message', function(msg) {
        if (msg != "ready") return;
        worker.send(job);
        // Make sure we add new jobs after we successfully created a new worker
        self.jobs = self.jobs.concat(Object.keys(job));
    });
    worker.on("exit", function(code, signal) {
        logger.log('jobs.exec: finished:', worker.id, 'pid:', worker.process.pid, 'code:', code || 0, '/', signal || 0, 'job:',job);
        for (var p in job) {
            var idx = self.jobs.indexOf(p);
            if (idx > -1) self.jobs.splice(idx, 1);
        }
        worker = null;
    });
    return true;
}

// Remote mode, launch remote instance to perform scraping or other tasks
// By default, shutdown the instance after job finishes unless noshutdown:1 is specified in the options
jobs.launch = function(job, options, callback)
{
    if (!job) return;
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    if (typeof job == "string") job = corelib.newObj(job, null);
    if (!Object.keys(job).length) return logger.error('launchJob:', 'no valid jobs:', job);

    this.time = Date.now();
    job = corelib.cloneObj(job);
    logger.log('jobs.launch:', job, 'options:', options);

    // Common arguments for remote workers
    var args = ["-master", "-instance-job",
                "-backend-host", core.backendHost || "",
                "-backend-key", core.backendKey || "",
                "-backend-secret", core.backendSecret || "",
                "-jobs-submit", corelib.jsonToBase64(job) ];

    if (!options.noshutdown) {
        args.push("-jobs-submit", corelib.jsonToBase64({ 'server.shutdown': { runlast: 1 } }));
    }

    // Command line arguments for the instance, must begin with -
    for (var p in options) {
        if (p[0] != '-') continue;
        args.push(p, options[p])
    }
    options.UserData = args.map(function(x) { return String(x).replace(/ /g, '%20') }).join(" ");
    // Update tag name with current job
    var d = args.match(/\-jobname ([^ ]+)/i);
    if (d) options.instanceName = d[1];

    // Terminate after the job is done
    if (!options.InstanceInitiatedShutdownBehavior && !options.termnate && !options.stop) options.terminate = 1;

    aws.ec2RunInstances(options, callback);
    return true;
}

// Update the job queue with a job, can be an object or a string is in the format object/method/name/value/name/value....
// All spaces must be are replaced with %20 to be used in command line parameterrs
jobs.updateQueue = function(job)
{
    switch (corelib.typeName(job)) {
    case "object":
        if (Object.keys(job).length) return this.queue.push(job);
        break;

    case "string":
        job = job.trim();
        if (job) return this.queue.push(corelib.newObj(job, null));
        break;
    }
    logger.error("jobs.updateQueue:", "invalid job: ", job);
}

// Process pending jobs, submit to idle workers
jobs.execQueue = function()
{
    if (!this.queue.length) return;
    var job = this.queue.shift();
    if (job) this.exec(job);
}

// Create a new cron job, for remote jobs additional property args can be used in the object to define
// arguments for the instance backend process, properties must start with -
//
// If a job object contains the `tag` property, it will be submitted into the bk_queue for execution by that worker
//
// Example:
//
//          { "type": "server", "cron": "0 */10 * * * *", "job": "server.processQueue" },
//          { "type": "local", "cron": "0 10 7 * * *", "id": "processQueue", "job": "api.processQueue" }
//          { "type": "remote", "cron": "0 5 * * * *", "args": { "-workers": 2 }, "job": { "scraper.run": { "url": "host1" }, "$scraper.run": { "url": "host2" } } }
//          { "type": "local", "cron": "0 */10 * * * *", "tag": "host-12", "job": "server.processQueue" },
//
jobs.scheduleCronjob = function(spec, obj)
{
    var self = this;
    if (!spec || !obj || !obj.job) return;
    logger.debug('scheduleCronjob:', spec, obj);
    var cj = new cron.CronJob(spec, function() {
        // Submit a job via cron to a worker for execution
        if (this.job.tag) {
            self.updateDb(this.job);
        } else {
            self.execCronjob(this.job);
        }
    }, null, true);
    cj.job = obj;
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

// Perform execution according to the type
jobs.execCronjob = function(options, callback)
{
    var self = this;
    if (typeof callback != "function") callback = corelib.noop;
    if (corelib.typeName(options) != "object" || !options.job) options = { type: "error" };

    switch (options.type || "") {
    case "error":
        callback("Invalid job", true);
        break;

    case "request":
        core.sendRequest(options, function() { callback() });
        break;

    case 'remote':
        setImmediate(function() { self.launch(options.job, options.args); });
        callback(null, true);
        break;

    case "server":
        setImmediate(function() {
            var d = domain.create();
            d.on('error', function(err) { logger.error('scheduleJob:', options, err.stack); });
            d.add(options.job);
            d.run(function() { self.run(options.job); });
        });
        callback(null, true);
        break;

    default:
        setImmediate(function() { self.updateQueue(options.job); });
        callback(null, true);
        break;
    }
}

// Load crontab from JSON file as list of job specs:
// - type - local, remote, server
//      - local means spawn a worker to run the job function
//      - remote means launch an AWS instance
//      - server means run inside the master process, do not spawn a worker
// - cron - cron time interval spec: 'second' 'minute' 'hour' 'dayOfMonth' 'month' 'dayOfWeek'
// - job - a string as obj.method or an object with job name as property name and the value is an object with
//         additional options for the job passed as first argument, a job callback always takes options and callback as 2 arguments
// - args - additional arguments to be passed to the backend in the command line for the remote jobs
//
// Example:
//
//          [ { "type": "local", cron: "0 0 * * * *", job: "scraper.run" }, ..]
jobs.loadCronjobs = function()
{
    var self = this;

    var list = [];
    fs.readFile(core.path.etc + "/crontab", function(err, data) {
        if (data && data.length) list = corelib.jsonParse(data.toString(), { list: 1 });

        fs.readFile(core.path.etc + "/crontab.local", function(err, data) {
            if (data && data.length) list = list.concat(corelib.jsonParse(data.toString(), { list: 1 }));

            if (!list.length) return;
            self.crontab.forEach(function(x) { x.stop(); delete x; });
            self.crontab = [];
            list.forEach(function(x) {
                if (!x.type || !x.cron || !x.job || x.disabled) return;
                self.scheduleCronjob(x.cron, x);
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

// Submit job for execution, it will be saved in the server queue and the master or matched job server will pick it up later.
//
// The options can specify:
//  - tag - job name for execution, this can be used to run on specified servers by IP address or other tag asigned
//  - type - job type: local, remote, server
//  - stime - start time ofr the job, it will wait until this time is current to be processed
//  - etime - expiration time, after this this job is ignored
//  - job - an object with a job spec, for name-only job the object can look like { job: null }
//  - args - additional arguments for remote job to pass in the command line via user-data
jobs.updateDb = function(options, callback)
{
    if (!options || corelib.typeName(options) != "object" || !options.job) {
        logger.error('submitJob:', 'invalid job spec, must be an object:', options);
        return callback ? callback("invalid job") : null;
    }
    logger.debug('submitJob:', options);
    db.put("bk_queue", options, callback);
}

// Load submitted jobs for execution, it is run by the master process every `-server-jobs-interval` seconds.
// Requires connection to the PG database, how jobs appear in the table and the order of execution is not concern of this function,
// the higher level management tool must take care when and what to run and in what order.
//
jobs.processDb = function(options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {};

    var now = Date.now()
    db.select("bk_queue", {}, { count: self.count }, function(err, rows) {
        rows = rows.filter(function(x) {
            if (x.stime && x.stime < now) return 0;
            return !x.tag || x.tag == core.ipaddr || x.tag == self.tag;
        }).sort(function(a,b) { return a.mtime - b.mtime });

        corelib.forEachSeries(rows, function(row, next) {
            // Cleanup expired records
            if (row.etime && row.etime < now) {
                return db.del('bk_queue', row, function() { next() });
            }
            self.schedule(row, function(err, del) {
                if (del) return db.del('bk_queue', row, function() { next() });
                next();
            });
        }, function() {
            if (rows.length) logger.log('processQueue:', rows.length, 'jobs');
            if (callback) callback();
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
    var queue = options.queue || self.jobQueue;
    if (!queue) return callback ? callback() : null;

    aws.sqsReceiveMessage(queue, options, function(err, rows) {
        if (err) return callback ? callback(err) : null;
        corelib.forEachSeries(rows || [], function(item, next) {
            var job = corelib.jsonParse(item.Body, { obj: 1, error: 1 });
            if (job && row.job) self.schedule(row.type, row.job, row.args);

            aws.querySQS("DeleteMessage", { QueueUrl: queue, ReceiptHandle: item.ReceiptHandle }, function(err) {
                if (err) logger.error('processSQS:', err);
                next();
            });
        }, function() {
            if (callback) callback();
        });
    });
}
