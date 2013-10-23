//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

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

var server = {
    // Watcher process status
    child: null,
    // Aditional processes to kill on exit
    pids: [],
    exiting: false,
    // Delay (ms) before restarting the server
    restartDelay: 2000,
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
    // Schedules cron jobs
    crontab: [],

    // Filter to allow only subset of jobs to run, regex
    jobsAllow: null,
    jobsDisallow: null,
    jobsInterval: 180000,

    // Number of workers or web servers to launch
    maxWorkers: 1,
    maxProcesses: 1,

    // How long to be in idle state and shutdown, for use in instances
    idleTime: 120,

    // Config parameters
    args: [{ name: "max-processes", type: "number", min: 1, max: 4 }, 
           { name: "max-workers", type: "number", min: 1, max: 4 }, 
           { name: "idle-time", type: "number" }, 
           { name: "crash-delay", type: "number", max: 30000 }, 
           { name: "restart-delay", type: "number", max: 30000 },
           { name: "job", type: "callback", value: "queueJob" },
           { name: "jobs-primary", type: "bool" },
           { name: "jobs-interval", type: "number", min: 60000, max: 900000 },
           { name: "jobs-allow", type: "regexp" },
           { name: "jobs-disallow", type: "regexp" }],
    
    // Start the server process
    start: function() {
        var self = this;

        // Parse all params and load config file
        core.init(function() { 
            process.title = core.name + ": process";
            
            // Go to background
            if (process.argv.indexOf("-daemon") > 0) {
                self.startDaemon();
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
                core.initModules(function() { self.startMaster(); });
            } else

            // Backend Web server
            if (process.argv.indexOf("-web") > 0) {
                self.startWeb();
            }
        });
    },

    // Start process monitor, running as root
    startMonitor: function() {
        process.title = core.name + ': monitor';
        core.role = 'monitor';

        this.startProcess();

        // Monitor server tasks
        setInterval(function() {
            try {
                core.watchLogs();
            } catch(e) {
                logger.errro('monitor:', e);
            }
        }, 300000);
    },

    // Setup worker environment
    startMaster: function() {
        var self = this;

        // Mark the time we started for calculating idle times properly
        self.jobTime = core.now();

        if (cluster.isMaster) {
            core.role = 'master';
            process.title = core.name + ': master';
            
            // Start web master process with web workers
            this.startWebProcess();

            // REPL command prompt over TCP
            if (core.argv.indexOf("-repl") > 0) core.startRepl(core.replPort, core.replBind);

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
            setInterval(function() { self.processJobs() }, self.jobsInterval);

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
    },

    // Create Express server, setup worker environment, call supplied callback to set initial environment
    startWeb: function(callback) {
        var self = this;

        // Setup IPC communication
        core.ipcInit();

        if (cluster.isMaster) {
            core.role = 'server';
            process.title = core.name + ': server';

            // REPL command prompt over TCP
            if (core.argv.indexOf("-repl") > 0) core.startRepl(core.replPort, core.replBind);

            // Worker process to handle all web requests
            for (var i = 0; i < this.maxProcesses; i++) {
                cluster.fork();
            }

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

            // Init API environment
            core.context.api.init(function(err) {
                core.dropPrivileges();
            });
            
            logger.log('startWeb:', core.role, 'version:', core.version, 'home:', core.home, 'port:', core.port, core.bind, 'uid:', process.getuid(), 'gid:', process.getgid(), 'pid:', process.pid)
        }
    },

    // Spawn web server from the master as a separate master with web workers, it i sused when web and master processes are running on the same server
    startWebProcess: function() { 
        if (core.argv.indexOf("-web") == -1) return;
        var params = [];
        var val = core.getArg("-web-port", core.port);
        if (val) params.push("-port", val);
        val = core.getArg("-web-bind");
        if (val) params.push("-bind", val);
        val = core.getArg("-web-repl-port");
        if (val) params.push("-repl-port", val);
        val = core.getArg("-web-repl-bind");
        if (val) params.push("-repl-bind", val);
        
        var child = this.spawnProcess(params, ["-port", "-bind", "-repl-port", "-repl-bind", "-master" ], { stdio: 'inherit' });
        this.pids.push(child.pid);
        child.on('exit', function (code, signal) {
            logger.log('process terminated:', 'pid:', this.pid, name, 'code:', code, 'signal:', signal);
            // Make sure all web servers are down before restating to avoid EADDRINUSE error condition
            core.killBackend("web", function() {
                self.respawn(function() { self.startWebProcess(); });
            });
        });
        child.unref();
    },

    // Restart process with the same arguments and setup as a monitor for the spawn child
    startProcess: function() {
        var self = this;
        this.child = this.spawnProcess();
        // Pass child output to the console
        this.child.stdout.on('data', function(data) {
            util.print(data);
        })
        this.child.stderr.on('data', function(error) {
            util.print(error);
        })
        // Restart if dies or exits
        this.child.on('exit', function (code, signal) {
            logger.log('process terminated:', 'code:', code, 'signal:', signal);
            core.killBackend("", function() {
                self.respawn(function() {
                    self.startProcess();
                });
            });
        });
        process.stdin.pipe(this.child.stdin);
        logger.log('startProcess:', 'version:', core.version, 'home:', core.home, 'port:', core.port, 'uid:', process.getuid(), 'gid:', process.getgid(), 'pid:', process.pid)
    },

    // Watch source files for modifications and restart
    startWatcher: function() {
        logger.debug('startWatcher:', core.watchdirs);
        var self = this;
   
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
    },

    // Create daemon from the current process, restart node with -daemon removed in the background
    startDaemon: function() {
        // Avoid spawning loop, skip daemon flag
        var argv = process.argv.slice(1).filter(function(x) { return x != "-daemon"; });

        this.errlog = new stream.Stream();
        this.errlog.writable = true;
        this.errlog.write = function(data) { logger.error(data); return true; }

        spawn(process.argv[0], argv, { stdio: [ 'ignore', errlog, errlog ], detached: true });
        process.exit(0);
    },

    // Sleep and keep a worker busy
    sleep: function(options, callback) {
        if (typeof options == "function") callback = options, options = null;
        if (!options) options = {};
        setTimeout(function() {
            logger.log('sleep:', options);
            if (callback) callback();
        }, options.timeout || 30000);
    },

    // Shutdown the system immediately, mostly to be used in the remote jobs as the last task
    shutdown: function(options, callback) {
        if (typeof options == "function") callback = options, options = null;
        if (!options) options = {};
        
        logger.log('shutdown:', 'server');
        core.watchLogs(function() {
            setTimeout(function() { core.shutdown(); }, options.timeout || 30000);
        });
    },

    // If respawning too fast, delay otherwise schedule new process after short timeout
    respawn: function(callback) {
        if (this.exiting) return;
        var now = new Date();
        if (this.crashTime && now.getTime() - this.crashTime.getTime() < this.crashInterval*(this.crashCount+1)) {
            if (this.crashCount && this.crashEvents >= this.crashCount) {
                logger.log('respawn:', 'throttling for', this.crashDelay, 'after', this.crashEvents, 'crashes in ', now.getTime() - this.crashTime.getTime(), 'ms');
                this.crashEvents = 0;
                this.crashTime = now;
                return setTimeout(callback, this.crashDelay);
            }
            this.crashEvents++;
        } else {
            this.crashEvents = 0;
        }
        this.crashTime = now;
        setTimeout(callback, this.crashInterval);
    },

    // Start new process reusing global process arguments, args will be added and args in the skip list will be removed
    spawnProcess: function(args, skip, opts) {
        if (this.exiting) return;
        // Arguments to skip when launchng new process
        if (!skip) skip = [];
        skip.push("-daemon");
        skip.push("-watch");
        skip.push("-monitor");
        // Remove arguments we should not pass to the process
        var argv = process.argv.slice(1).filter(function(x) { return skip.indexOf(x) == -1; });
        if (Array.isArray(args)) argv = argv.concat(args);
        logger.debug('spawnProcess:', argv, skip);
        return spawn(process.argv[0], argv, opts);
    },

    // Run a job
    runJob: function(job) {
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
    },

    // Execute job in the background by one of the workers, object must be known exported module, like catalog, netflix, rovi..
    // and method must be existing method of the given object. The method function must take callback as its first argument.
    // More than one job can be specified, property of the object defines name for the job to run: { 'imdb.sync': {}, 'server.shutdown': {} }
    // Supported options by the server:
    // - runalways - no checks for existing job wth the same name should be done
    // - runlast - run when no more pending or running jobs
    // - runafter - specifies another job in canoncal form obj.method which must finish and not be pending in
    //              order for this job to start, this implements chaining of jobs to be executed one after another
    //              but submitted at the same time
    //              Exampe: submit 3 jobs to run sequentially:
    //                'amazon.import'
    //                { 'imdb.sync': { runafter: 'amazon.import' } }
    //                { 'server.shutdown': { runafter: 'imdb.sync' } }
    execJob: function(job) {
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
    },

    // Remote mode, launch remote instance to perform scraping or other tasks
    // By default shutdown the instance after job finishes
    launchJob: function(job, options, callback) {
        if (!job) return;
        if (typeof options == "function") callback = options, options = null;
        if (!options) options = {};
        
        if (typeof job == "string") job = core.newObj(job, null);
        if (!Object.keys(job).length) return logger.error('launchJob:', 'no valid jobs:', job);
        job = core.clone(job);

        // Default btime flag for all jobs
        var btime = core.sqlTime();
        for (var p in job) {
            if (!job[p]) job[p] = {};
            if (typeof job[p].btime == "undefined") job[p].btime = btime;
        }

        this.jobTime = core.now();
        logger.log('launchJob:', util.inspect(job, true, null), options);

        // Common arguments for remote workers
        var args = ["-master", "-instance",
                    "-db", core.backendDb || "",
                    "-backend-host", core.backendHost || "",
                    "-backend-key", core.backendKey || "",
                    "-backend-secret", core.backendSecret || "",
                    "-jobname", Object.keys(job).join(","),
                    "-job", new Buffer(JSON.stringify(job)).toString("base64") ];
        
        if (!options.noshutdown) {
            args.push("-job", new Buffer(JSON.stringify({ 'server.shutdown': { runlast: 1 } })).toString("base64"));
        }
        
        // Launch arguments for the backend, must begin with -
        for (var p in options) {
            if (p[0] != '-') continue;
            args.push(p, options[p])
        }
        aws.runInstances(1, args.map(function(x) { return String(x).replace(/ /g, '%20') }).join(" "), callback);
        return true;
    },

    // Run a job, the string is in the format:
    // object/method/name/value/name/value....
    // All spaces must be are replaced with %20 to be used in command line parameterrs
    queueJob: function(job) {
        if (!job) return;
        switch (core.typeName(job)) {
        case "object":
            this.queue.push(job);
            break;

        case "string":
            try {
                this.queue.push(JSON.parse(new Buffer(job, "base64").toString()));
            } catch(e) {
                logger.error('queueJob:', e, job);
            }
            break;
        }
    },

    // Process pending jobs, submit to idle workers
    execQueue: function() {
        if (!this.queue.length) return;
        var job = this.queue.shift();
        if (!job) return;
        this.execJob(job);
    },

    // Create new cron job
    scheduleCronjob: function(spec, obj) {
        var self = this;
        var job = self.checkJob('local', obj.job);
        if (!job) return;
        logger.debug('scheduleCronjob:', spec, util.inspect(obj, true, null));
        var cj = new cron.CronJob(spec, function() {
            if (this.host) {
                self.submitJob({ type: this.type, host: this.host, job: job }); 
            } else {
                self.doJob(this.type, job);
            }
        }, null, true);
        cj.type = obj.type;
        cj.host = obj.host;
        this.crontab.push(cj);
    },

    // Create new cron job to be run on a drone in the cloud, for th remote jobs additonal property args can be use din the cron object to define 
    // arguments to the instance backend process, properties must start with -
    scheduleLaunchjob: function(spec, obj) {
        var self = this;
        var job = self.checkJob('remote', obj.job);
        if (!job) return;
        logger.debug('scheduleLaunchjob:', spec, util.inspect(obj, true, null));
        var cj = new cron.CronJob(spec, function() { self.doJob(this.type, job, obj.args)  }, null, true);
        cj.type = obj.type;
        this.crontab.push(cj);
    },

    // Perform execution according to type
    doJob: function(type, job, options) {
        var self = this;
        switch (type) {
        case 'remote':
            setImmediate(function() { self.launchJob(job, options); });
            break;

        case "server":
            setImmediate(function() { self.runJob(job); });
            break;
            
        default:
            setImmediate(function() { self.queueJob(job); });
            break;
        }
    },
    
    // Verify job structure and permissions and return as object
    checkJob: function(type, job) {
        if (typeof job == "string") job = core.newObj(job, null);
        if (typeof job != "object") return null;
        job = core.clone(job);
        for (var p in job) if (!this.allowJob(type, p)) delete job[p];
        if (!Object.keys(job).length) return null;
        return job;
    },

    // Return true if given job can be run on this server, type is local or remote and will be prepended to the job spec so
    // the regexp can use the full spec or parts of it like : local.imdb.sync or remote.imdb.sync
    allowJob: function(type, name) {
        var job = type + '.' + name;
        if ((this.jobsDisallow && this.jobsDisallow.test(job)) || (this.jobsAllow && !this.jobsAllow.test(job))) {
            logger.debug("allowJob:", "no", type, name, "rx:", this.jobsDisallow, this.jobsAllow);
            return false;
        }
        logger.debug("allowJob:", "yes", type, name);
        return true;
    },

    // Load crontab from JSON file as list of job specs:
    // [ { "type": "local", cron: "0 0 * * * *", job: "imdb.sync" }, ..]
    // Cron format: 'second', 'minute', 'hour', 'dayOfMonth', 'month', 'dayOfWeek';
    loadSchedules: function() {
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
                        switch (x.type) {
                        case "remote":
                            self.scheduleLaunchjob(x.cron, x);
                            break;

                        default:
                            self.scheduleCronjob(x.cron, x);
                            break;
                        }
                    });
                }
                logger.log("loadSchedules:", self.crontab.length, "schedules");
            } catch(e) {
                logger.log('loadSchedules:', e, data);
            }
        });
    },

    // Submit job for execution, it will be saved in the server queue and the master will pick it up later
    submitJob: function(options, callback) {
        if (!options || !options.job) return logger.error('submitJob:', 'invalid job spec:', options);
        var job = JSON.stringify(options.job);
        db.insert("backend_jobs", { job: job, type: options.type, host: options.host, id: core.hash(job), mtime: core.now() }, { pool: core.dbPool, nocolumns: 1 }, function() {
            if (callback) callback();
        });
    },

    // Run submitted jobs, usually called from the crontab file in case of shared database, requires connection to the PG database
    // To run it from crontab add line(to run every 5 mins): 
    //    { type: "server", cron: "0 */5 * * * *", job: "server.processJobs" } 
    processJobs: function(options, callback) {
        var self = this;
        if (typeof options == "function") callback = options, options = {};
        var hosts = [os.hostname(), os.hostname().split('.')[0]];
        // Primary job servers, run all jobs with empty host
        if (this.jobsPrimary) hosts.push("");
        db.select("backend_jobs", { host: hosts }, { keys: ['host'], pool: core.dbPool }, function(err, rows) {
            async.forEachSeries(rows, function(row, next) {
                try { 
                    self.doJob(row.type, JSON.parse(row.job));
                } catch(e) {
                    logger.error('processJobs:', e, row);
                }
                db.remove('backend_jobs', row, { pool: core.dbPool }, function() { next() });
            }, function() {
                if (rows.length) logger.log('processJobs:', rows.length, 'jobs');
                if (callback) callback();
            });
        });
    }
}

module.exports = server;
core.addContext('server', server);
