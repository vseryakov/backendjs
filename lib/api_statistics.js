//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var os = require('os');
var path = require('path');
var util = require('util');
var fs = require('fs');
var http = require('http');
var url = require('url');
var core = require(__dirname + '/core');
var lib = require(__dirname + '/lib');
var api = require(__dirname + '/api');
var logger = require(__dirname + '/logger');
var db = require(__dirname + '/db');
var ipc = require(__dirname + '/ipc');
var metrics = require(__dirname + '/metrics');

// Setup statistics collections
api.initStatistics = function()
{
    var self = this;
    // Add some delay to make all workers collect not at the same time
    var delay = lib.randomShort();

    self.getStatistics();
    setInterval(function() { self.getStatistics(); }, self.collectInterval * 1000);
    setInterval(function() { self.sendStatistics() }, self.collectSendInterval * 1000 - delay);

    logger.debug("initStatistics:", "delay:",  delay, "interval:", self.collectInterval, self.collectSendInterval);
}

// Updates metrics with the current values and returns an object ready to be saved in the database, i.e. flattened ito one object
// where all property names of the complex objects are combined into one name separated by comma.
api.getStatistics = function(options)
{
    var self = this;
    var now = Date.now();
    var cpus = os.cpus();
    this.cpuUtil = cpus.reduce(function(n, cpu) { return n + (cpu.times.user / (cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq)); }, 0);
    this.loadAvg = os.loadavg();
    this.memoryUsage = process.memoryUsage();
    // Cache stats are always behind
    ipc.stats(function(data) { self.metrics.cache = data });
    this.metrics.mtime = now;
    this.metrics.app = core.appName + "/" + core.appVersion;
    this.metrics.ip = core.ipaddr;
    this.metrics.pid = process.pid;
    this.metrics.ctime = core.ctime;
    this.metrics.cpus = core.maxCPUs;
    this.metrics.mem = os.totalmem();
    this.metrics.instance = core.instance.id;
    this.metrics.worker = core.workerId || '0';
    this.metrics.id = core.ipaddr + '-' + process.pid;
    this.metrics.latency = lib.busyTimer("get");
    this.metrics.Histogram('rss').update(this.memoryUsage.rss);
    this.metrics.Histogram('heap').update(this.memoryUsage.heapUsed);
    this.metrics.Histogram('avg').update(this.loadAvg[2]);
    this.metrics.Histogram('free').update(os.freemem());
    this.metrics.Histogram("util").update(this.cpuUtil * 100 / cpus.length);
    this.metrics.pool = db.getPool().metrics;

    // Convert into simple object with all deep properties using names concatenated with dots
    var obj = lib.objFlatten(this.metrics.toJSON(), { separator: '_' });

    // Clear all counters to make a snapshot and start over, this way in the monitoring station it is only needd to be summed up without
    // tracking any other states, the naming convention is to use _0 for snapshot counters.
    if (options && options.clear) this.metrics.reset(/\_0$/);
    return obj;
}

// Send collected statistics to the collection server, `backend-host` must be configured and possibly `backend-login` and `backend-secret` in case
// the system API is secured, the user can be any valid user registered in the bk_auth table.
api.sendStatistics = function()
{
    var self = this;

    if (!self.collectHost) return {};

    var obj = this.getStatistics({ clear: 1 });

    lib.series([
      function(next) {
          // Using local db connection, this is usefull in case of distributed database where there is no
          // need for the collection ost in the middle.
          if (self.collectHost != "pool") return next();
          self.saveStatistics(obj, { silent_error: self.collectQuiet}, next);
      },
      function(next) {
          // Send to the collection host for storing in the special database or due to security restrictions when
          // only HTTP is open and authentication is required
          if (!self.collectHost.match(/^https?:/)) return next();
          core.sendRequest({ url: self.collectHost, method: "POST", postdata: obj, quiet: self.collectQuiet }, function(err) {
              logger.debug("sendStatistics:", self.collectHost, self.collectErrors, err || "");
              next(err);
          });
      },
    ], function(err) {
        if (!err) {
            self.collectErrors = self.collectQuiet = 0;
        } else {
            // Stop reporting about collection errors
            if (++self.collectErrors > 3) self.collectQuiet = 1;
        }
    });
    return obj;
}

// Save collected statistics in the bk_collect table, this can be called via API or directly by the backend, this wrapper
// is supposed to be overrriden by the application with additional logic how the statistics is saved. Columns in the bk_collect table
// must be defined for any metrics to be saved, use api.describeTable with additional columns from the api.metrics object in additional to the default ones.
//
// Example, add pool cache stats to the table
//
//          api.describeTable({ bk_collect: { pool_cache_rmean: { type: "real" },
//                                            pool_cache_hmean: { type: "real" } });
//
api.saveStatistics = function(obj, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {};
    options.pool = self.collectPool;
    options.skip_null = true;
    db.add("bk_collect", obj, options, callback);
}

// Calculate statistics for a period of time, query and options must confirm to the db.select conventions.
api.calcStatistics = function(query, options, callback)
{
    var self = this;
    if (typeof optinons == "function") callback = options, options = null;
    if (!options) options = {};
    // Default sample interval
    if (!options.interval) options.interval = 300000;

    db.select("bk_collect", query, options, function(err, rows) {
        var series = {}, totals = {};
        rows.forEach(function(x) {
            var avg = {}, agg = {};
            // Extract properties to be shown by type
            for (var p in x) {
                if (typeof x[p] != "number") continue;
                if (p.slice(p.length - 2) == "_0") {
                    agg[p] = x[p];
                } else {
                    avg[p] = x[p];
                }
            }

            // Aggregate by specified interval
            var mtime = Math.round(x.mtime/options.interval)*options.interval;
            if (!series[mtime]) {
                series[mtime] = {};
                totals[mtime] = {};
            }
            for (var y in avg) {
                if (!totals[mtime][y]) totals[mtime][y] = 0;
                if (!series[mtime][y]) series[mtime][y] = 0;
                totals[mtime][y]++;
                series[mtime][y] += avg[y];
            }
            for (var y in agg) {
                if (!series[mtime][y]) series[mtime][y] = 0;
                series[mtime][y] += agg[y];
            }
        });
        rows = [];
        Object.keys(series).sort().forEach(function(x) {
            var obj = { mtime: lib.toNumber(x) };
            for (var y in series[x]) {
                if (totals[x][y]) series[x][y] /= totals[x][y];
                obj[y] = series[x][y];
            }
            rows.push(obj);
        });
        callback(null, rows);
    });
}

