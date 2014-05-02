//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var net = require('net');
var cluster = require('cluster');
var cron = require('cron');
var path = require('path');
var util = require('util');
var fs = require('fs');
var spawn = require('child_process').spawn;
var exec = require('child_process').exec;
var core = require(__dirname + '/core');
var logger = require(__dirname + '/logger');
var db = require(__dirname + '/db');
var aws = require(__dirname + '/aws');
var os = require('os');
var stream = require('stream');
var async = require('async');
var printf = require('printf');
var proxy = require('http-proxy');

var server = {
    // Watcher process status
    child: null,
    // Aditional processes to kill on exit
    pids: [],
    exiting: false,
    // Delay (ms) before restarting the server
    restartDelay: 1000,
    // Redefined in case of log file
    stdout: null,
    stderr: null,

    // Crash throttling
    crashInterval: 3000,
    crashDelay: 30000,
    crashCount: 3,
    crashTime: null,
    crashEvents: 0,

    // Job waiting for the next avaialble worker
    queue: [],
    // List of jobs a worker is running or all jobs running
    jobs: [],
    // Time of the last update on jobs and workers
    jobTime: 0,
    // Interval between jobs scheduler
    jobsInterval: 180000,
    // Schedules cron jobs
    crontab: [],
    // Default jobs host to be executed
    jobsTag: os.hostname().split('.').shift(),

    // Number of workers or web servers to launch
    maxWorkers: 1,
    maxProcesses: 1,
    maxJobs: 1,

    // How long to be in idle state and shutdown, for use in instances
    idleTime: 120,

    // Config parameters
    args: [{ name: "max-processes", type: "number", min: 1, max: 4, descr: "Max processes to launch for servers" },
           { name: "max-workers", type: "number", min: 1, max: 4, descr: "Max number of worker processes to launch for jobs" },
           { name: "idle-time", type: "number", descr: "If set and no jobs are submitted the backend will be shutdown, for instance mode only" },
           { name: "crash-delay", type: "number", max: 30000, descr: "Delay between respawing the crashed process" },
           { name: "restart-delay", type: "number", max: 30000, descr: "Delay between respawning the server after changes" },
           { name: "job", type: "callback", value: "queueJob", descr: "Job specification, JSON encoded as base64 of the job object" },
           { name: "jobs-tag", descr: "This server executes jobs that match this tag, cannot be empty, default is current hostname" },
           { name: "max-jobs", descr: "How many jobs to execute at any iteration, this relates to the bk_jobs queue only" },
           { name: "jobs-interval", type: "number", descr: "Interval between executing job queue, 0 disables job processing, min interval is 60 secs" } ],
};

module.exports = server;

// Start the server process, call the callback to perform some initialization before launchng any server, just after core.init
server.start = function()
{
    var self = this;

    logger.debug("server: start", process.argv);

    // Parse all params and load config file
    core.init(function() {
        process.title = core.name + ": process";

        // REPL shell
        if (process.argv.indexOf("-shell") > 0) {
            core.context.api.initTables(function(err) { core.createRepl(); });
            return;
        }

        // Go to background
        if (process.argv.indexOf("-daemon") > 0) {
            return self.startDaemon();
        }

        // Graceful shutdown, kill all children processes
        process.once('exit', function() {
            self.exiting = true;
            if (self.child) self.child.kill('SIGTERM');
            self.pids.forEach(function(p) { process.kill(p) });
        });

        process.once('SIGTERM', function () {
            self.exiting = true;
            process.exit(0);
        });

        // Watch monitor for modified source files
        if (process.argv.indexOf("-watch") > 0) {
            self.startWatcher();
        } else

        // Start server monitor, it will watch the process and restart automatically
        if (process.argv.indexOf("-monitor") > 0) {
            self.startMonitor();
        } else

        // Master server
        if (process.argv.indexOf("-master") > 0) {
            self.startMaster();
        } else

        // Backend Web server
        if (process.argv.indexOf("-web") > 0) {
            self.startWeb();
        } else

        // HTTP proxy
        if (process.argv.indexOf("-proxy") > 0) {
            self.startProxy();
        }
    });
}

// Start process monitor, running as root
server.startMonitor = function()
{
    process.title = core.name + ': monitor';
    core.role = 'monitor';

    this.startProcess();

    // Monitor server tasks
    setInterval(function() {
        try {
            core.watchLogs();
        } catch(e) {
            logger.error('monitor:', e);
        }
    }, 300000);
}

// Setup worker environment
server.startMaster = function()
{
    var self = this;

    // Mark the time we started for calculating idle times properly
    self.jobTime = core.now();

    if (cluster.isMaster) {
        core.role = 'master';
        process.title = core.name + ': master';

        // Start other master processes
        if (process.argv.indexOf("-web") > -1) this.startWebProcess();
        if (process.argv.indexOf("-proxy") > -1) this.startWebProxy();

        // REPL command prompt over TCP
        if (core.replPort) self.startRepl(core.replPort, core.replBind);

        // Setup background tasks
        this.loadSchedules();

        // Watch config directory for changes
        fs.watch(core.path.etc, function (event, filename) {
            logger.debug('watcher:', event, filename);
            switch (filename) {
            case "crontab":
                core.setTimeout(filename, function() { self.loadSchedules(); }, 5000);
                break;
            }
        });

        // Maintenance tasks
        setInterval(function() {
            // Submit pending jobs
            self.execQueue();

            // Check idle time, if no jobs running for a long time shutdown the server, this is for instance mode mostly
            if (core.instance && self.idleTime > 0 && !Object.keys(cluster.workers).length && core.now() - self.jobTime > self.idleTime) {
                logger.log('startMaster:', 'idle:', self.idleTime);
                self.shutdown();
            }
        }, 30000);

        // Primary jobs
        if (self.jobsInterval >= 60000) setInterval(function() { self.processJobs() }, self.jobsInterval);

        // API related initialization
        core.context.api.initMasterServer();

        logger.log('startMaster:', 'version:', core.version, 'home:', core.home, 'port:', core.port, 'uid:', process.getuid(), 'gid:', process.getgid(), 'pid:', process.pid)
    } else {
        core.role = 'worker';
        process.title = core.name + ': worker';

        process.on("message", function(job) {
            logger.log('startWorker:', 'pid:', process.pid, 'job:', util.inspect(job, null, null));
            self.runJob(job);
        });

        // Maintenance tasks
        setInterval(function() {
            // Check idle time, exit worker if no jobs submitted
            if (self.idleTime > 0 && !self.jobs.length && core.now() - self.jobTime > self.idleTime) {
                logger.log('startWorker:', 'idle:', self.idleTime);
                process.exit(0);
            }
        }, 30000);

        process.send('ready');

        logger.log('startWorker:', 'id:', cluster.worker.id, 'version:', core.version, 'home:', core.home, 'uid:', process.getuid(), 'gid:', process.getgid(), 'pid:', process.pid);
    }
    core.dropPrivileges();
}

// Create Express server, setup worker environment, call supplied callback to set initial environment
server.startWeb = function(callback)
{
    var self = this;

    if (cluster.isMaster) {
        core.role = 'server';
        process.title = core.name + ': server';

        // Setup IPC communication
        core.ipcInitServer();

        // REPL command prompt over TCP
        if (core.replPortWeb) self.startRepl(core.replPortWeb, core.replBindWeb);

        // Create tables and spawn Web workers
        core.context.api.initTables(function(err) {
            for (var i = 0; i < self.maxProcesses; i++) {
                cluster.fork();
            }
        });

        // API related initialization
        core.context.api.initWebServer();

        // Frontend server tasks
        setInterval(function() {
            // Make sure we have all workers running
            var workers = Object.keys(cluster.workers);
            for (var i = 0; i < this.maxProcesses - workers.length; i++) {
                cluster.fork();
            }
        }, 5000);

        // Restart if any worker dies, keep the worker pool alive
        cluster.on("exit", function(worker, code, signal) {
            logger.log('web worker: died:', worker.id, 'pid:', worker.process.pid || "", "code:", code || "", 'signal:', signal || "");
            self.respawn(function() { cluster.fork(); });
        });
        logger.log('startWeb:', 'master', 'version:', core.version, 'home:', core.home, 'port:', core.port, 'uid:', process.getuid(), 'gid:', process.getgid(), 'pid:', process.pid)

    } else {
        core.role = 'web';
        process.title = core.name + ": web"

        // Setup IPC communication
        core.ipcInitClient();

        // Init API environment
        core.context.api.init(function(err) {
            core.dropPrivileges();
        });

        logger.log('startWeb:', core.role, 'version:', core.version, 'home:', core.home, 'port:', core.port, core.bind, 'uid:', process.getuid(), 'gid:', process.getgid(), 'pid:', process.pid);
    }
}

// Spawn web server from the master as a separate master with web workers, it is used when web and master processes are running on the same server
server.startWebProcess = function()
{
    var child = this.spawnProcess([], [ "-master", "-proxy" ], { stdio: 'inherit' });
    this.pids.push(child.pid);
    child.on('exit', function (code, signal) {
        logger.log('process terminated:', 'pid:', this.pid, 'code:', code, 'signal:', signal);
        // Make sure all web servers are down before restarting to avoid EADDRINUSE error condition
        core.killBackend("web", 'SIGKILL', function() {
            self.respawn(function() { self.startWebProcess(); });
        });
    });
    child.unref();
}

// Spawn web proxy from the master as a separate master with web workers
server.startWebProxy = function()
{
    var child = this.spawnProcess([ "-db-no-pools" ], ["-master", "-web" ], { stdio: 'inherit' });
    this.pids.push(child.pid);
    child.on('exit', function (code, signal) {
        logger.log('process terminated:', 'pid:', this.pid, 'code:', code, 'signal:', signal);
        // Make sure all web servers are down before restating to avoid EADDRINUSE error condition
        core.killBackend("proxy", "SIGKILL", function() {
            self.respawn(function() { self.startWebProxy(); });
        });
    });
    child.unref();
}

// Start http proxy as standalone server process
server.startProxy = function()
{
    var self = this;
    var config = null;

    core.role = 'proxy';
    process.title = core.name + ": proxy"

    try { config = JSON.parse(fs.readFileSync(path.join(core.path.etc, "proxy")).toString()); } catch (e) { logger.error('startProxy:', e); }
    if (!config) return logger.error('startProxy:', 'no config file');

    if (config.https) {
        Object.keys(config.https).forEach(function (key) {
            try { config.https[key] = fs.readFileSync(path.join(core.path.etc, config.https[key])); } catch(e) { logger.error('startProxy:', e) }
        });
    }
    try { self.proxy = proxy.createServer(config).listen(core.proxyPort, core.proxyBind); } catch(e) { logger.error('startProxy:', e); };
}

// Restart process with the same arguments and setup as a monitor for the spawn child
server.startProcess = function()
{
    var self = this;
    self.child = this.spawnProcess();
    // Pass child output to the console
    self.child.stdout.on('data', function(data) {
        util.print(data);
    })
    self.child.stderr.on('data', function(error) {
        util.print(error);
    })
    // Restart if dies or exits
    self.child.on('exit', function (code, signal) {
        logger.log('process terminated:', 'code:', code, 'signal:', signal);
        core.killBackend("", function() {
            self.respawn(function() {
                self.startProcess();
            });
        });
    });
    process.stdin.pipe(this.child.stdin);
    logger.log('startProcess:', core.role, 'version:', core.version, 'home:', core.home, 'port:', core.port, 'uid:', process.getuid(), 'gid:', process.getgid(), 'pid:', process.pid);
}

// Watch source files for modifications and restart
server.startWatcher = function()
{
    var self = this;
    core.role = 'watcher';
    process.title = core.name + ": watcher";

    if (core.watchdirs.indexOf(__dirname) == -1) core.watchdirs.push(__dirname);
    logger.debug('startWatcher:', core.watchdirs);
    core.watchdirs.forEach(function(dir) {
        core.watchFiles(dir, /\.js$/, function(file) {
            if (self.watchTimer) clearTimeout(self.watchTimer);
            self.watchTimer = setTimeout(function() {
                logger.log('watcher:', 'restarting', self.child.pid);
                if (self.child) self.child.kill(); else self.startProcess();
            }, self.restartDelay);
        });
    });
    this.startProcess();
}

// Start command prompt on TCP socket, context can be an object with properties assigned with additional object to be accessible in the shell
server.startRepl = function(port, bind)
{
    var self = this;
    var repl = net.createServer(function(socket) {
        self.repl = core.createRepl({ prompt: '> ', input: socket, output: socket, terminal: true, useGlobal: false });
        self.repl.on('exit', function() { socket.end(); })
        self.repl.context.socket = socket;
    });
    repl.on('error', function(err) {
       logger.error('startRepl:', err);
    });
    repl.listen(port, bind || '0.0.0.0');
    logger.log('startRepl:', core.role, 'port:', port, 'bind:', bind || '0.0.0.0');
}

// Create daemon from the current process, restart node with -daemon removed in the background
server.startDaemon = function()
{
	var self = this;
    // Avoid spawning loop, skip daemon flag
    var argv = process.argv.slice(1).filter(function(x) { return x != "-daemon"; });
    var log = "ignore";

    try {
        log = fs.openSync(core.errFile, 'a');
    } catch(e) {
        logger.error('daemon:', e);
    }
    // Allow clients to write to it otherwise there will be no messages written if no permissions
    if (process.getuid() == 0) core.chownSync(core.errFile);

    spawn(process.argv[0], argv, { stdio: [ 'ignore', log, log ], detached: true });
    process.exit(0);
}

// Sleep and keep a worker busy
server.sleep = function(options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};
    setTimeout(function() {
        logger.log('sleep:', options);
        if (callback) callback();
    }, options.timeout || 30000);
}

// Shutdown the system immediately, mostly to be used in the remote jobs as the last task
server.shutdown = function(options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    logger.log('shutdown:', 'server');
    core.watchLogs(function() {
        setTimeout(function() { core.shutdown(); }, options.timeout || 30000);
    });
}

// If respawning too fast, delay otherwise schedule new process after short timeout
server.respawn = function(callback)
{
	var self = this;
    if (self.exiting) return;
    var now = new Date();
    if (self.crashTime && now.getTime() - self.crashTime.getTime() < self.crashInterval*(self.crashCount+1)) {
        if (self.crashCount && this.crashEvents >= this.crashCount) {
            logger.log('respawn:', 'throttling for', self.crashDelay, 'after', self.crashEvents, 'crashes in ', now.getTime() - this.crashTime.getTime(), 'ms');
            self.crashEvents = 0;
            self.crashTime = now;
            return setTimeout(callback, self.crashDelay);
        }
        self.crashEvents++;
    } else {
        self.crashEvents = 0;
    }
    self.crashTime = now;
    setTimeout(callback, self.crashInterval);
}

// Start new process reusing global process arguments, args will be added and args in the skip list will be removed
server.spawnProcess = function(args, skip, opts)
{
    if (this.exiting) return;
    // Arguments to skip when launchng new process
    if (!skip) skip = [];
    skip.push("-daemon");
    skip.push("-watch");
    skip.push("-monitor");
    // Remove arguments we should not pass to the process
    var argv = process.argv.slice(1).filter(function(x) { return skip.indexOf(x) == -1; });
    if (Array.isArray(args)) argv = argv.concat(args);
    logger.debug('spawnProcess:', argv, 'skip:', skip);
    return spawn(process.argv[0], argv, opts);
}

// Run all jobs from the job spec at the same time, when the last job finishes and it is running in the worker process, the process
// terminates.
server.runJob = function(job)
{
    var self = this;

    for (var name in job) {
        var args = [];
        // Pass as first argument the options object, then callback
        if (core.typeName(job[name]) == "object" && Object.keys(job[name]).length) args.push(job[name]);

        // The callback to finalize job execution
        (function (jname) {
            args.push(function() {
                self.jobTime = core.now();
                // Update process title with current job list
                var idx = self.jobs.indexOf(jname);
                if (idx > -1) self.jobs.splice(idx, 1);
                if (cluster.isWorker) process.title = core.name + ': worker ' + self.jobs.join(',');

                logger.log('runJob:', 'finished', jname);
                if (!self.jobs.length && cluster.isWorker) process.exit(0);
            });
        })(name);
        // Make report about unknown job, leading $ are used for same method miltiple times in the same job because
        // method names are unique in the object
        var spec = name.replace(/^[\$]+/g, "").split('.');
        var obj = core.context[spec[0]];
        if (!obj || !obj[spec[1]]) {
            logger.error('runJob:', name, "unknown method in", job);
            if (core.role == "worker") process.exit(1);
            continue;
        }
        self.jobTime = core.now();
        self.jobs.push(name);
        if (cluster.isWorker) process.title = core.name + ': worker ' + self.jobs.join(',');
        logger.log('runJob:', 'started', name, job[name] || "");
        obj[spec[1]].apply(obj, args);
    }
}

// Execute job in the background by one of the workers, object must be known exported module
// and method must be existing method of the given object. The method function must take options
// object as its first argument and callback as its second argument.
// More than one job can be specified, property of the object defines name for the job to run:
// Example: { 'scraper.run': {}, 'server.shutdown': {} }
// If the same object.method must be executed several times, prepend subsequent jobs with $
// Example: { 'scraper.run': { "arg": 1 }, '$scraper.run': { "arg": 2 }, '$$scraper.run': { "arg": 3 } }
// Supported options by the server:
// - runalways - no checks for existing job wth the same name should be done
// - runlast - run when no more pending or running jobs
// - runafter - specifies another job in canoncal form obj.method which must finish and not be pending in
//   order for this job to start, this implements chaining of jobs to be executed one after another
//   but submitted at the same time
//   Exampe: submit 3 jobs to run sequentially:
//                'scraper.import'
//                { 'scraper.sync': { runafter: 'scraper.import' } }
//                { 'server.shutdown': { runafter: 'scraper.sync' } }
server.execJob = function(job)
{
    var self = this;

    if (cluster.isWorker) return logger.error('exec: can be called from the master only', job);

    // Build job object with canonical name
    if (typeof job == "string") job = core.newObj(job, null);
    if (typeof job != "object") return logger.error('exec:', 'invalid job', job);

    // Do not exceed max number of running workers
    var workers = Object.keys(cluster.workers);
    if (workers.length >= self.maxWorkers) {
        self.queue.push(job);
        return logger.debug('execJob:', 'max number of workers running:', self.maxWorkers, 'job:', job);
    }

    // Perform conditions check, any failed condition will reject the whole job
    for (var p in job) {
        var opts = job[p] || {};
        // Do not execute if we already have this job running
        if (self.jobs.indexOf(p) > -1 && !opts.runalways) {
            if (!opts.skipqueue) self.queue.push(job);
            return logger.debug('execJob: already running', job);
        }

        // Condition for job, should not be any pending or running jobs
        if (opts.runlast) {
            if (self.jobs.length || self.queue.length) {
                if (!opts.skipqueue) self.queue.push(job);
                return logger.debug('execJob:', 'other jobs still exist', job);
            }
        }

        // Check dependencies, only run when there is no dependent job in the running list
        if (opts.runone) {
            if (self.jobs.filter(function(x) { return x.match(opts.runone) }).length) {
                if (!opts.skipqueue) self.queue.push(job);
                return logger.debug('execJob:', 'depending job still exists:', job);
            }
        }

        // Check dependencies, only run when there is no dependent job in the running or pending lists
        if (opts.runafter) {
            if (self.jobs.some(function(x) { return x.match(opts.runafter) }) ||
                self.queue.some(function(x) { return Object.keys(x).some(function(y) { return y.match(opts.runafter); }); })) {
                if (!opts.skipqueue) self.queue.push(job);
                return logger.debug('execJob:', 'depending job still exists:', job);
            }
        }
    }

    self.jobTime = core.now();
    logger.log('execJob:', 'workers:', workers.length, 'job:', util.inspect(job, null, null))

    // Start a worker, send the job and wait when it finished
    var worker = cluster.fork();
    worker.on("error", function(e) {
        logger.error('execJob:', e, job);
        worker = null;
    })
    worker.on('message', function(msg) {
        if (msg != "ready") return;
        worker.send(job);
        // Make sure we add new jobs after we successfully created a new worker
        self.jobs = self.jobs.concat(Object.keys(job));
    });
    worker.on("exit", function(code, signal) {
        logger.log('execJob: finished:', worker.id, 'pid:', worker.process.pid, 'code:', code || 0, '/', signal || 0, 'job:', util.inspect(job, null, null));
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
server.launchJob = function(job, options, callback)
{
	var self = this;
    if (!job) return;
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    if (typeof job == "string") job = core.newObj(job, null);
    if (!Object.keys(job).length) return logger.error('launchJob:', 'no valid jobs:', job);
    job = core.cloneObj(job);

    // Default btime flag for all jobs
    var btime = core.sqlTime();
    for (var p in job) {
        if (!job[p]) job[p] = {};
        if (typeof job[p].btime == "undefined") job[p].btime = btime;
    }

    self.jobTime = core.now();
    logger.log('launchJob:', util.inspect(job, true, null), options);

    // Common arguments for remote workers
    var args = ["-master", "-instance",
                "-backend-host", core.backendHost || "",
                "-backend-key", core.backendKey || "",
                "-backend-secret", core.backendSecret || "",
                "-server-jobname", Object.keys(job).join(","),
                "-server-job", core.toBase64(job) ];

    if (!options.noshutdown) {
        args.push("-server-job", core.toBase64({ 'server.shutdown': { runlast: 1 } }));
    }

    // Command line arguments for the instance, must begin with -
    for (var p in options) {
        if (p[0] != '-') continue;
        args.push(p, options[p])
    }
    aws.runInstances(1, args.map(function(x) { return String(x).replace(/ /g, '%20') }).join(" "), callback);
    return true;
}

// Run a job, the string is in the format:
// object/method/name/value/name/value....
// All spaces must be are replaced with %20 to be used in command line parameterrs
server.queueJob = function(job)
{
    if (!job) return;
    switch (core.typeName(job)) {
    case "object":
        this.queue.push(job);
        break;

    case "string":
    	var o = core.toJson(job);
    	if (!o) logger.error('queueJob:', 'invalid job', job);
    	this.queue.push(o);
        break;
    }
}

// Process pending jobs, submit to idle workers
server.execQueue = function()
{
    if (!this.queue.length) return;
    var job = this.queue.shift();
    if (!job) return;
    this.execJob(job);
}

// Create a new cron job, for remote jobs additonal property args can be used in the cron object to define
// arguments to the instance backend process, properties must start with -
//
// Example:
//
//          { "type": "server", "cron": "0 */10 * * * *", "job": "server.processJobs" },
//          { "type": "local", "cron": "0 10 7 * * *", "id": "processQueue", "job": "api.processQueue" }
//          { "type": "remote", "cron": "0 5 * * * *", "args": { "-workers": 2 }, "job": { "scraper.run": { "url": "host1" }, "$scraper.run": { "url": "host2" } } }
server.scheduleCronjob = function(spec, obj)
{
    var self = this;
    var job = self.checkJob('local', obj.job);
    if (!job) return;
    logger.debug('scheduleCronjob:', spec, util.inspect(obj, true, null));
    var cj = new cron.CronJob(spec, function() {
        if (this.job.host && !this.job.id && !this.job.tag) {
            self.submitJob({ type: this.job.type, host: this.job.host, job: this.job.job });
        } else {
            self.doJob(this.job.type, this.job.job, this.job.args);
        }
        // Remove from the jobs queue on launch
        if (this.job.id && this.job.tag) {
            db.del('bk_jobs', this.job, function() { next() });
        }
    }, null, true);
    cj.job = { type: obj.type, host: obj.host, id: obj.id, tag: obj.tag, args: obj.args, job: job };
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
server.runCronjob = function(id)
{
    this.crontab.forEach(function(x) {
       if (x.job && x.job.id == id) x._callback();
    });
}

// Perform execution according to type
server.doJob = function(type, job, options)
{
    var self = this;
    switch (type) {
    case 'remote':
        setImmediate(function() { self.launchJob(job, options); });
        break;

    case "server":
        setImmediate(function() {
            try { self.runJob(job); } catch(e) { logger.error('doJob:', e, e.stack); }
        });
        break;

    default:
        setImmediate(function() { self.queueJob(job); });
        break;
    }
}

// Verify job structure and permissions and return as an object if the job is a string
server.checkJob = function(type, job)
{
    if (typeof job == "string") job = core.newObj(job, null);
    if (typeof job != "object") return null;
    if (!Object.keys(job).length) return null;
    return core.cloneObj(job);
}

// Load crontab from JSON file as list of job specs:
// - type - local, remote, server
//      - local means spawn a worker to run the job function
//      - remote means launch an AWS instance
//      - server means run inside the master process, do not spawn a worker
// - cron - cron time interval spec: 'second' 'minute' 'hour' 'dayOfMonth' 'month' 'dayOfWeek'
// - job - a string as obj.method or an object with job name as property name and the value is an object with
//         additional options for the job passed as first argument, a job callback always takes options and callback as 2 arguments
// - args - additional arguments passwed to the backend in the command line for the remote jobs
//
// Example:
//
//          [ { "type": "local", cron: "0 0 * * * *", job: "scraper.run" }, ..]
server.loadSchedules = function()
{
    var self = this;

    fs.readFile("etc/crontab", function(err, data) {
        if (err || !data || !data.length) return;
        data = data.toString();
        try {
            var list = JSON.parse(data);
            if (Array.isArray(list)) {
                self.crontab.forEach(function(x) { x.stop(); delete x; });
                self.crontab = [];
                list.forEach(function(x) {
                    if (!x.type || !x.cron || !x.job || x.disabled) return;
                    self.scheduleCronjob(x.cron, x);
                });
            }
            logger.log("loadSchedules:", self.crontab.length, "schedules");
        } catch(e) {
            logger.log('loadSchedules:', e, data);
        }
    });
}

// Submit job for execution, it will be saved in the server queue and the master will pick it up later
// options can specify:
// - tag - job tag for execution, default is current jobTag, this can be used to run on specified servers only
// - job - an object with job spec
// - type - job type: local, remote, server
server.submitJob = function(options, callback)
{
    var self = this;
    if (!options || core.typeName(options.job) != "object") return logger.error('submitJob:', 'invalid job spec, must be an object:', options);
    logger.debug('submitJob:', options);
    db.put("bk_jobs", { id: options.tag || self.jobsTag, tag: core.hash(options.job), job: options.job, cron: options.cron, args: options.args, type: options.type }, function() {
        if (callback) callback();
    });
}

// Run submitted jobs, usually called from the crontab file in case of shared database, requires connection to the PG database
// To run it from crontab add line(to run every 5 mins):
//          { type: "server", cron: "0 */5 * * * *", job: "server.processJobs" }
server.processJobs = function(options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = {};

    db.select("bk_jobs", { id: this.jobsTag }, { count: this.maxJobs }, function(err, rows) {
        async.forEachSeries(rows, function(row, next) {
            try {
                if (row.job.cron) {
                    self.scheduleCronjob(row.cron, row);
                } else {
                    self.doJob(row.type, row.job);
                }
            } catch(e) {
                logger.error('processJobs:', e, row);
            }
            // Cron jobs will be removed on launch
            if (!row.job.cron) {
                db.del('bk_jobs', row, function() { next() });
            }
        }, function() {
            if (rows.length) logger.log('processJobs:', rows.length, 'jobs');
            if (callback) callback();
        });
    });
}

// Run main server if we execute this as standalone program
if (!module.parent) {
    require('backendjs').server.start();
}

