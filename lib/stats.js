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

const mod = {
    name: "stats",
    args: [
        { name: "interval", type: "int", descr: "Interval for process stats collection" },
        { name: "target", type: "json", descr: "Target options, one of file, url, db, log..." },
        { name: "roles", type: "list", descr: "Process roles that report stats only" },
    ],
    columns: {
        id: { keyword: 1, primary: 1 },                 // instance id or host
        ctime: { type: "mtime", primary: 2 },
        pid: { type: "int" },
        host: { keyword: 1 },
        tag: { keyword: 1 },
        zone: { keyword: 1 },
        ip: { keyword: 1 },
        role: { keyword: 1 },
        arch: { keyword: 1 },
        elu: { type: "number" },                         // event loop utilization as %
        pcpu: { type: "number" },                        // process cpu utilization as %
        pmem_p: { type: "number" },                      // process memory used as %
        pmem: { type: "bigint" },                        // process memory used in kb
        cpu: { type: "number" },                         // system cpu utilization as %
        mem: { type: "bigint" },                         // system memory used in kb
        mem_p: { type: "bigint" },                       // system memeory used as %
        rx: { type: "bigint" },                          // network kb received
        tx: { type: "bigint" },                          // network kb sent
        rx_r: { type: "number" },                        // network receive rate as kb per sec
        tx_r: { type: "number" },                        // network transmit rate as kb per sec
        rx_packets: { type: "bigint" },                  // received network packets
        tx_packets: { type: "bigint" },                  // transmitted network packets
        rx_errors: { type: "bigint" },                   // receive network errors
        tx_errors: { type: "bigint" },                   // transmit network error
        rx_dropped: { type: "bigint" },                  // dropped receive packets
        tx_dropped: { type: "bigint" },                  // dropped transmit packets
        areq_rate: { type: "number" },                   // API request rate per second
        areq_mean: { type: "number" },                   // API req mean rate
        areq_1m: { type: "number" },                     // API req rate for the last minute
        areq_5m: { type: "number" },                     // API req rate for the last 5 minutes
        ares_mean: { type: "number" },                   // API response time in ms
        ares_p50: { type: "number" },                    // API response time 50% percentile
        ares_p95: { type: "number" },                    // API response time 95% percentile
        ares_p99: { type: "number" },                    // API response time 99% percentile
        aque_mean: { type: "number" },                   // API request mean queue size
    },
    roles: [],
};
module.exports = mod;

mod.configure = function(options, callback)
{
    // Only enable table if configured
    if (this.target?.db) {
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
    stats.id = core.instance.id || stats.host;
    stats.tag = core.instance.tag;
    stats.zone = core.instance.zone;
    stats.ip = core.ipaddr;
    stats.arch = core.arch;

    // API stats if running
    if (api.app) {
        var m = api.metrics.toJSON();
        stats.areq_rate = lib.toNumber(m.api_req?.rate, { digits: 2 });
        stats.areq_mean = lib.toNumber(m.api_req?.rmean, { digits: 2 });
        stats.areq_1m = lib.toNumber(m.api_req?.r1m, { digits: 2 });
        stats.areq_5m = lib.toNumber(m.api_req?.r5m, { digits: 2 });
        stats.ares_mean = lib.toNumber(m.api_req?.hmean, { digits: 2 });
        stats.ares_p50 = lib.toNumber(m.api_req?.hmed, { digits: 2 });
        stats.ares_p95 = lib.toNumber(m.api_req?.hp95, { digits: 2 });
        stats.ares_p99 = lib.toNumber(m.api_req?.hp99, { digits: 2 });
        stats.aque_mean = lib.toNumber(m.api_que?.hmean, { digits: 2 });
    }

    lib.series([
        function(next) {
            lib.networkStats((err, net) => {
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

