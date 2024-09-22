//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const core = require(__dirname + '/core');
const lib = require(__dirname + '/lib');
const logger = require(__dirname + '/logger');
const db = require(__dirname + '/db');
const api = require(__dirname + '/api');
const jobs = require(__dirname + '/jobs');
const cache = require(__dirname + '/cache');
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
        eventloop_util: { type: "number", label: "Event loop utilization as %" },
        proc_cpu_util: { type: "number", label: "Process cpu utilization as %" },
        proc_mem_util: { type: "number", label: "Process memory used as %" },
        proc_mem_rss: { type: "bigint", label: "Process memory used in bytes" },
        host_cpu_util: { type: "number", label: "System cpu utilization as %" },
        host_mem_util: { type: "bigint", label: "System memory used as %" },
        host_mem_used: { type: "bigint", label: "System memory used in bytes" },
        jobs_count: { type: "bigint", label: "Jobs running" },
        net_rx_bytes: { type: "bigint", label: "Network bytes received" },
        net_tx_bytes: { type: "bigint", label: "Network bytes sent" },
        net_rx_rate: { type: "number", label: "Network receive rate as bytes per sec" },
        net_tx_rate: { type: "number", label: "Network transmit rate as bytes per sec" },
        net_rx_packets: { type: "bigint", label: "Received network packets" },
        net_tx_packets: { type: "bigint", label: "Transmitted network packets" },
        net_rx_errors: { type: "bigint", label: "Receive network errors" },
        net_tx_errors: { type: "bigint", label: "Transmit network error" },
        net_rx_dropped: { type: "bigint", label: "Dropped receive packets" },
        net_tx_dropped: { type: "bigint", label: "Dropped transmit packets" },
        api_req_rate: { type: "number", label: "API request rate per second" },
        api_req_rate_m5: { type: "number", label: "API req rate for the last 5 minutes" },
        api_req_rate_m15: { type: "number", label: "API req rate for the last 15 minutes" },
        api_que_size: { type: "number", label: "API request queue size" },
        api_que_size_p50: { type: "number", label: "API resquest queue size 50% percentile" },
        api_res_time: { type: "number", label: "API response time in ms" },
        api_res_time_p50: { type: "number", label: "API response time 50% percentile" },
        api_res_time_p95: { type: "number", label: "API response time 95% percentile" },
        api_res_time_p99: { type: "number", label: "API response time 99% percentile" },
        jobs_que_size: { type: "number", label: "Jobs running" },
        jobs_err_count: { type: "number", label: "Jobs errors" },
        jobs_task_count: { type: "number", label: "Jobs tasks executed" },
        jobs_run_time: { type: "number", label: "Jobs running time" },
        jobs_run_time_p50: { type: "number", label: "Jobs running time 50% percentile" },
        jobs_run_time_p95: { type: "number", label: "Jobs running time 95% percentile" },
        cache_unique_req_count: { type: "number", label: "Cache request count" },
        cache_unique_req_rate: { type: "number", label: "Cache request rate" },
        cache_unique_req_rate_m5: { type: "number", label: "Cache request rate the last 5 minutes" },
        cache_unique_req_rate_m15: { type: "number", label: "Cache request rate the last 15 minutes" },
        cache_unique_res_time: { type: "number", label: "Cache response time " },
        cache_unique_res_time_p50: { type: "number", label: "Cache response time 50% percentile" },
        cache_unique_res_time_p95: { type: "number", label: "Cache response time 95% percentile" },
        queue_unique_req_count: { type: "number", label: "Queue jobs count" },
        queue_unique_req_rate: { type: "number", label: "Queue job request rate" },
        queue_unique_req_rate_m5: { type: "number", label: "Queue job request rate the last 5 mintues" },
        queue_unique_req_rate_m15: { type: "number", label: "Queue job request rate the last 5 mintues" },
        queue_unique_res_time: { type: "number", label: "Queue job run time" },
        queue_unique_res_time_p50: { type: "number", label: "Queue job run time 50% percentile" },
        queue_unique_res_time_p95: { type: "number", label: "Queue job run time 95% percentile" },
        db_dynamodb_req_count: { type: "number", label: "DB pool queries executed" },
        db_dynamodb_req_rate_m5: { type: "number", label: "DB pool query rate for the last 5 mins" },
        db_dynamodb_req_rate_m15: { type: "number", label: "DB pool query rate for the last 15 mins" },
        db_dynamodb_res_time: { type: "number", label: "DB pool query response time" },
        db_dynamodb_res_time_p50: { type: "number", label: "DB pool query response time 50% percentile" },
        db_dynamodb_res_time_p95: { type: "number", label: "DB pool query response time 95% percentile" },
        db_dynamodb_que_size: { type: "number", label: "DB pool query queue size" },
        db_dynamodb_que_size_p50: { type: "number", label: "DB pool query queue size time 50% percentile" },
        db_dynamodb_que_size_p95: { type: "number", label: "DB pool query queue size time 50% percentile" },
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
        stats.api_req_count = req.meter.count;
        stats.api_req_rate = req.meter.rate;
        stats.api_req_rate_m5 = req.meter.m5;
        stats.api_req_rate_m15 = req.meter.m15;
        stats.api_res_time = req.histogram.mean;
        stats.api_res_time_p50 = req.histogram.med;
        stats.api_res_time_p95 = req.histogram.p95;
        stats.api_que_size = que.mean;
        stats.api_que_size_p50 = que.med;
        stats.api_que_size_p95 = que.p95;
        for (const p in api.metrics) {
            if (typeof api.metrics[p] == "number" && p.endsWith("_count")) {
                stats["api_" + p] = api.metrics[p];
            }
        }
    }

    // Jobs run time stats
    que = jobs.metrics.que.toJSON();
    stats.jobs_que_size = jobs.metrics.running;
    stats.jobs_err_count = jobs.metrics.err_count;
    stats.jobs_task_count = que.count;
    stats.jobs_run_time = que.mean;
    stats.jobs_run_time_p50 = que.med;
    stats.jobs_run_time_p95 = que.p95;

    // Cache clients
    for (let q in cache.clients) {
        const m = core.modules.metrics.toJSON(cache.clients[q].metrics);
        q = cache.clients[q].queueName;
        if (m.req?.meter?.count) {
            stats["cache_" + q + "_req_count"] = m.req.meter.count;
            stats["cache_" + q + "_req_rate"] = m.req.meter.rate;
            stats["cache_" + q + "_req_rate_m5"] = m.req.meter.m5;
            stats["cache_" + q + "_req_rate_m15"] = m.req.meter.m15;
            stats["cache_" + q + "_res_time"] = m.req.histogram.mean;
            stats["cache_" + q + "_res_time_p50"] = m.req.histogram.med;
            stats["cache_" + q + "_res_time_p95"] = m.req.histogram.p95;
        }
        if (m.que?.meter?.count) {
            stats["queue_" + q + "_req_count"] = m.que.meter.count;
            stats["queue_" + q + "_req_rate"] = m.que.meter.rate;
            stats["queue_" + q + "_req_rate_m5"] = m.que.meter.m5;
            stats["queue_" + q + "_req_rate_m15"] = m.que.meter.m15;
            stats["queue_" + q + "_res_time"] = m.que.histogram.mean;
            stats["queue_" + q + "_res_time_p50"] = m.que.histogram.med;
            stats["queue_" + q + "_res_time_p95"] = m.que.histogram.p95;
        }
    }

    // DB pools and tables
    for (let pool in db.pools) {
        pool = db.pools[pool];
        const m = core.modules.metrics.toJSON(pool.metrics);
        if (!m.req?.meter) continue;

        for (const p in m) {
            if (typeof m[p] == "number" && p.endsWith("_count")) {
                stats["db_" + pool.name + "_" + p] = m[p];
            }
        }
        stats["db_" + pool.name + "_req_count"] = m.req.meter.count;
        stats["db_" + pool.name + "_req_rate"] = m.req.meter.rate;
        stats["db_" + pool.name + "_req_rate_m5"] = m.req.meter.m5;
        stats["db_" + pool.name + "_req_rate_m15"] = m.req.meter.m15;
        stats["db_" + pool.name + "_res_time"] = m.req.histogram.mean;
        stats["db_" + pool.name + "_res_time_p50"] = m.req.histogram.med;
        stats["db_" + pool.name + "_res_time_p95"] = m.req.histogram.p95;
        stats["db_" + pool.name + "_que_size"] = m.que?.mean;
        stats["db_" + pool.name + "_que_size_p50"] = m.que?.med;
        stats["db_" + pool.name + "_que_size_p95"] = m.que?.p95;
        stats["db_" + pool.name + "_cache_time"] = m.cache?.mean;
        stats["db_" + pool.name + "_cache_time_p50"] = m.cache?.med;
        for (const p in m.tables) {
            stats["db_" + pool.name + "_" + p + "_read_count"] = m.tables[p].read?._count;
            stats["db_" + pool.name + "_" + p + "_read_rate"] = m.tables[p].read?.currentRate();
            stats["db_" + pool.name + "_" + p + "_write_count"] = m.tables[p].write?._count;
            stats["db_" + pool.name + "_" + p + "_write_rate"] = m.tables[p].write?.currentRate();
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

    for (const p in stats) {
        if (stats[p] === 0 || lib.isEmpty(stats[p])) delete stats[p];
    }

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

mod.queryElasticsearch = function(options, callback)
{
    var nterms = options.nterms || 50;
    var tags = lib.strSplit(options.tags);
    var groups = lib.strSplit(options.groups);
    var age = lib.toNumber(options.age) || 300000;
    var since = lib.toMtime(options.since, Date.now() - age);
    var before = lib.toMtime(options.before, Date.now());
    var interval = lib.toNumber(options.interval) || 60000;
    var fields = lib.strSplit(options.fields);

    if (!fields.length || !groups.length) {
        return callback({ status: 400, message: "groups and fields must be provided" })
    }

    var q = {
        size: 0,
        query: {
            query_string: {
                 query: `timestamp:>=${since} AND timestamp:<${before}`
            }
        },
        aggs: {
            stats: {
                aggs: {
                    fields: {
                        histogram: {
                            field: "timestamp",
                            interval: interval
                        },
                        aggs: {
                        }
                    }
                }
            }
        }
    }

    if (tags.length) {
        q.query.query_string.query += ` AND (${tags.map((x) => (`tag:${x}`)).join(" OR ")})`;
    }

    if (groups.length > 1) {
        q.aggs.stats.multi_terms = {
            size: nterms,
            terms: groups.map((x) => ({ field: x }))
        }
    } else {
        q.aggs.stats.terms = {
            size: nterms,
            field: groups[0],
        }
    }

    for (const f of fields) {
        q.aggs.stats.aggs.fields.aggs[f] = {
            avg: {
                field: f
            }
        }
    }

    db.search(options.table || "bk_stats", q, { pool: options.pool, count: options.count }, (err, rows, info) => {
        if (!err) {
            var groups = {}, timeline = [];
            if (!options.raw) {
                for (const t of info.aggregations.stats.buckets) {
                    groups[t.key] = {};
                    for (const f of fields) {
                        groups[t.key][f] = t.fields.buckets.map((x) => (x[f] && x[f].value || 0));

                        if (!timeline.length) {
                            timeline = t.fields.buckets.map((x) => (x.key));
                        }
                    }
                }
            }
        }
        callback(err, { groups, timeline, info, rows });
    });

}
