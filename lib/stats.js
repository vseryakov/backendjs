//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const core = require(__dirname + '/core');
const lib = require(__dirname + '/lib');
const logger = require(__dirname + '/logger');
const db = require(__dirname + '/db');
const api = require(__dirname + '/api');
const fs = require("fs");

// Collects metrics about host and processes like CPU, memory, network, API rates...
// All metrics are stored in a single object and sent to the confgured destination
//
// To use Elasticsearch run `bkjs es-prepare-stats -table bk_stats` in order to
// map @timestamp for Kibana and make all strings as keywords for aggregations.
// Then set in config `stats-target={ "url": "http://localhost:9200/bk_stats/_doc/" }`

const mod = {
    name: "stats",
    args: [
        { name: "interval", type: "int", descr: "Interval for process stats collection" },
        { name: "target", type: "json", descr: "Target options, one of file, url, db, log..." },
        { name: "roles", type: "list", descr: "Process roles that report stats only" },
    ],
    columns: {
        timestamp: { type: "mtime" },
        id: { keyword: 1 },                                 // instance/task id
        pid: { type: "int" },
        host: { keyword: 1 },
        tag: { keyword: 1 },
        zone: { keyword: 1 },
        ip: { keyword: 1 },
        role: { keyword: 1 },
        arch: { keyword: 1 },
        eventloop_util: { type: "number" },                 // event loop utilization as %
        proc_cpu_util: { type: "number" },                  // process cpu utilization as %
        proc_mem_util: { type: "number" },                  // process memory used as %
        proc_mem_rss: { type: "bigint" },                   // process memory used in bytes
        host_cpu_util: { type: "number" },                  // system cpu utilization as %
        host_mem_util: { type: "bigint" },                  // system memory used as %
        host_mem_used: { type: "bigint" },                  // system memory used in bytes
        net_rx_bytes: { type: "bigint" },                   // network bytes received
        net_tx_bytes: { type: "bigint" },                   // network bytes sent
        net_rx_rate: { type: "number" },                    // network receive rate as bytes per sec
        net_tx_rate: { type: "number" },                    // network transmit rate as bytes per sec
        net_rx_packets: { type: "bigint" },                 // received network packets
        net_tx_packets: { type: "bigint" },                 // transmitted network packets
        net_rx_errors: { type: "bigint" },                  // receive network errors
        net_tx_errors: { type: "bigint" },                  // transmit network error
        net_rx_dropped: { type: "bigint" },                 // dropped receive packets
        net_tx_dropped: { type: "bigint" },                 // dropped transmit packets
        api_req_rate: { type: "number" },                   // API request rate per second
        api_req_rate_mean: { type: "number" },              // API req mean rate
        api_req_rate_m1: { type: "number" },                // API req rate for the last minute
        api_req_rate_m5: { type: "number" },                // API req rate for the last 5 minutes
        api_req_rate_m15: { type: "number" },               // API req rate for the last 15 minutes
        api_que_size: { type: "number" },                   // API request queue size
        api_que_size_p50: { type: "number" },               // API resquest queue size 50% percentile
        api_res_time: { type: "number" },                   // API response time in ms
        api_res_time_p50: { type: "number" },               // API response time 50% percentile
        api_res_time_p95: { type: "number" },               // API response time 95% percentile
        api_res_time_p99: { type: "number" },               // API response time 99% percentile
    },
    roles: [],
};
module.exports = mod;

mod.configure = function(options, callback)
{
    // Only enable table if configured
    if (this.target?.db) {
        this.columns.pkey = { type: "uuid", primary: 1 };
        this.tables = {
            [this.target.db]: this.columns
        }
    }

    callback();
}

mod.configureModule = function(options, callback)
{
    setTimeout(() => {

        this._runtime = this._errors = 0;
        this._timer = setInterval(this.run.bind(this), 5000);

    }, lib.randomInt(100, 5000));

    callback();
}

mod.run = function()
{
    if (this._running) return;
    if (this.roles.length && !this.roles.includes(core.role)) return;
    var now = Date.now();
    if (!this.interval || now - this._runtime < this.interval) return;

    this._running = 1;
    this._runtime = now;
    this.collect((err, stats) => {
        if (!this.target) return;

        this.send(this.target, stats, (err) => {
            this._running = 0;
            this._stats = stats;
            this._error = err;
            this._errors = err ? this.errors + 1 : 0;
        });
    });
}

// Collect process stats
mod.collect = function(options, callback)
{
    if (typeof options == "function") callback = options, options = {};

    if (!options) options = {};

    // Basic sys/process stats
    var stats = options.stats = lib.processStats();

    // Dimensions
    stats.role = core.role;
    stats.host = core.hostName;
    stats.arch = core.arch;
    stats.ip = core.ipaddr;
    stats.id = core.instance.id;
    stats.tag = core.instance.tag;
    stats.zone = core.instance.zone;

    // API stats if running
    if (api.app) {
        var req = api.metrics.req.toJSON();
        var que = api.metrics.que.toJSON();
        stats.api_req_rate = req.meter.rate;
        stats.api_req_rate_mean = req.meter.mean;
        stats.api_req_rate_m1 = req.meter.m1;
        stats.api_req_rate_m5 = req.meter.m5;
        stats.api_req_rate_m15 = req.meter.m15;
        stats.api_res_time = req.histogram.mean;
        stats.api_res_time_p50 = req.histogram.med;
        stats.api_res_time_p95 = req.histogram.p95;
        stats.api_res_time_p99 = req.histogram.p99;
        stats.api_que_size = que.mean;
        stats.api_que_size_p50 = que.med;
        for (const p in api.metrics) {
            if (typeof api.metrics[p] == "number" && p.endsWith("_count")) {
                stats["api_" + p] = api.metrics[p];
            }
        }
    }

    lib.series([
        function(next) {
            lib.networkStats(core.instance.netdev, (err, net) => {
                Object.assign(stats, net);
                next();
            });
        },
        function(next) {
            core.runMethods("bkCollectStats", options, { direct: 1 }, () => {
                logger.debug("collect:", mod.name, options);
                next(null, stats);
            });
        }
    ], callback, true);
}

mod.send = function(target, stats, callback)
{
    if (typeof callback != "function") callback = lib.noop;

    if (!target || !stats) return callback();

    if (target.url) {
        var url = lib.toTemplate(target.url, stats);
        var opts = lib.objExtend({ method: "POST", retryCount: 2, retryOnError: 1 }, target.options);
        if (opts.posdata) {
            opts.postdata = lib.toTemplate(opts.postdata, { stats, target });
        } else {
            opts.postdata = stats;
        }
        return core.httpGet(url, opts, callback);
    }

    if (target.log) {
        logger.logger(target.log, "stats:", stats);
        return callback();
    }

    if (target.file) {
        return fs.appendFile(target.file, lib.stringify(stats) + "\n", callback);
    }

    if (target.db) {
        return db.add(target.db, stats, { pool: target.pool, no_columns: 1 }, callback);
    }

    callback();
}

