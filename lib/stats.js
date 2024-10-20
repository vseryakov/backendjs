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
        { name: "flags", type: "list", descr: "Feature flags" },
        { name: "interval", type: "int", descr: "Interval for process stats collection" },
        { name: "target", type: "json", descr: "Target options, one of file, url, db, log..." },
        { name: "roles", type: "list", descr: "Process roles that report stats only" },
        { name: "filter", obj: "filter", type: "map", maptype: "regexp", merge: 1, noempty: 1, descr: "For each metric prefix provide regexp to keep only matched stats, ex: -stats-filter db:dynamodb" },
    ],
    columns: {
        timestamp: { type: "mtime" },
        id: { keyword: 1, label: "Instance/task ID" },
        pid: { type: "int", label: "Process pid" },
        host: { keyword: 1, label: "Host name" },
        tag: { keyword: 1, label: "Instance tag" },
        zone: { keyword: 1, label: "Availability zone" },
        ip: { keyword: 1, label: "IP address" },
        role: { keyword: 1, label: "Process role" },
        arch: { keyword: 1, label: "System architecture" },
        eventloop_util: { type: "number", label: "Event loop utilization as %" },
        proc_cpu_util: { type: "number", label: "Process cpu utilization as %" },
        proc_mem_util: { type: "number", label: "Process memory used as %" },
        proc_mem_rss: { type: "bigint", label: "Process memory used in bytes" },
        proc_heap_total: { type: "bigint", label: "Number of bytes V8 has allocated for the heap" },
        proc_heap_used: { type: "bigint", label: "Number of bytes currently being used by V8’s JavaScript objects" },
        proc_heap_malloc: { type: "bigint", label: "Number of bytes allocated through malloc by V8" },
        proc_heap_external: { type: "bigint", label: "Number of bytes for array buffers and external strings" },
        proc_heap_contexts: { type: "bigint", label: "Number of the top-level contexts currently active" },
        proc_heap_detached: { type: "bigint", label: "Number of contexts that were detached and not yet garbage collected" },
        proc_heap_new_space: { type: "bigint", label: "Number of bytes for new objects" },
        proc_heap_old_space: { type: "bigint", label: "Number of bytes for old objects" },
        proc_gc_count: { type: "bigint", label: "Number of GC runs" },
        proc_gc_time: { type: "bigint", label: "GC run time" },
        host_cpu_util: { type: "number", label: "System cpu utilization as %" },
        host_mem_util: { type: "bigint", label: "System memory used as %" },
        host_mem_used: { type: "bigint", label: "System memory used in bytes" },
        net_rx_bytes: { type: "bigint", label: "Network bytes received", stat: "sum" },
        net_tx_bytes: { type: "bigint", label: "Network bytes sent", stat: "sum" },
        net_rx_rate: { type: "number", label: "Network receive rate as bytes per sec" },
        net_tx_rate: { type: "number", label: "Network transmit rate as bytes per sec" },
        net_rx_packets: { type: "bigint", label: "Received network packets", stat: "sum" },
        net_tx_packets: { type: "bigint", label: "Transmitted network packets", stat: "sum" },
        net_rx_errors: { type: "bigint", label: "Receive network errors", stat: "sum" },
        net_tx_errors: { type: "bigint", label: "Transmit network error", stat: "sum" },
        net_rx_dropped: { type: "bigint", label: "Dropped receive packets", stat: "sum" },
        net_tx_dropped: { type: "bigint", label: "Dropped transmit packets", stat: "sum" },
        api_200_count: { type: "number", label: "API requests with 200 status", stat: "sum" },
        api_400_count: { type: "number", label: "API requests with 200 status", stat: "sum" },
        api_401_count: { type: "number", label: "API requests with 200 status", stat: "sum" },
        api_403_count: { type: "number", label: "API requests with 200 status", stat: "sum" },
        api_404_count: { type: "number", label: "API requests with 200 status", stat: "sum" },
        api_bad_count: { type: "number", label: "API requests with 4XX status", stat: "sum" },
        api_err_count: { type: "number", label: "API requests with 5XX status", stat: "sum" },
        api_large_count: { type: "number", label: "API requests with too large status", stat: "sum" },
        api_req_rate: { type: "number", label: "API request rate per second" },
        api_req_rate_m5: { type: "number", label: "API req rate for the last 5 mins" },
        api_req_rate_m15: { type: "number", label: "API req rate for the last 15 mins" },
        api_que_size: { type: "number", label: "API request queue size", stat: "sum" },
        api_que_size_p50: { type: "number", label: "API resquest queue size 50% percentile", stat: "sum" },
        api_res_time: { type: "number", label: "API response time in ms" },
        api_res_time_p50: { type: "number", label: "API response time 50% percentile" },
        api_res_time_p95: { type: "number", label: "API response time 95% percentile" },
        api_res_time_p99: { type: "number", label: "API response time 99% percentile" },
        jobs_que_size: { type: "number", label: "Jobs running", stat: "sum" },
        jobs_err_count: { type: "number", label: "Jobs errors", stat: "sum" },
        jobs_task_count: { type: "number", label: "Jobs tasks executed", stat: "sum" },
        jobs_run_time: { type: "number", label: "Jobs running time" },
        jobs_run_time_p50: { type: "number", label: "Jobs running time 50% percentile" },
        jobs_run_time_p95: { type: "number", label: "Jobs running time 95% percentile" },
        cache_default_req_count: { type: "number", label: "Cache request count", stat: "sum" },
        cache_default_req_rate: { type: "number", label: "Cache request rate" },
        cache_default_req_rate_m5: { type: "number", label: "Cache request rate the last 5 mins" },
        cache_default_req_rate_m15: { type: "number", label: "Cache request rate the last 15 mins" },
        cache_default_res_time: { type: "number", label: "Cache response time " },
        cache_default_res_time_p50: { type: "number", label: "Cache response time 50% percentile" },
        cache_default_res_time_p95: { type: "number", label: "Cache response time 95% percentile" },
        queue_default_req_count: { type: "number", label: "Queue jobs count", stat: "sum" },
        queue_default_req_rate: { type: "number", label: "Queue job request rate" },
        queue_default_req_rate_m5: { type: "number", label: "Queue job request rate the last 5 mins" },
        queue_default_req_rate_m15: { type: "number", label: "Queue job request rate the last 5 mins" },
        queue_default_res_time: { type: "number", label: "Queue job run time" },
        queue_default_res_time_p50: { type: "number", label: "Queue job run time 50% percentile" },
        queue_default_res_time_p95: { type: "number", label: "Queue job run time 95% percentile" },
        db_dynamodb_req_count: { type: "number", label: "DB pool queries executed", stat: "sum" },
        db_dynamodb_req_rate_m5: { type: "number", label: "DB pool query rate for the last 5 mins" },
        db_dynamodb_req_rate_m15: { type: "number", label: "DB pool query rate for the last 15 mins" },
        db_dynamodb_res_time: { type: "number", label: "DB pool query response time" },
        db_dynamodb_res_time_p50: { type: "number", label: "DB pool query response time 50% percentile" },
        db_dynamodb_res_time_p95: { type: "number", label: "DB pool query response time 95% percentile" },
        db_dynamodb_que_size: { type: "number", label: "DB pool query queue size", stat: "sum" },
        db_dynamodb_que_size_p50: { type: "number", label: "DB pool query queue size time 50% percentile", stat: "sum" },
        db_dynamodb_que_size_p95: { type: "number", label: "DB pool query queue size time 50% percentile", stat: "sum" },
        db_dynamodb_default_read_count: { type: "number", label: "DB pool table read count", stat: "sum" },
        db_dynamodb_default_read_rate: { type: "number", label: "DB pool table read rate" },
        db_dynamodb_default_write_count: { type: "number", label: "DB pool table write count", stat: "sum" },
        db_dynamodb_default_write_rate: { type: "number", label: "DB pool table write rate" },
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

    // GC stats if enabled
    var gc = lib.gcStats(lib.isFlag(this.flags, "gc"));
    stats.proc_gc_count = gc.count;
    stats.proc_gc_time = gc.time;

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
    if (que?.count) {
        stats.jobs_que_size = jobs.metrics.running;
        stats.jobs_err_count = jobs.metrics.err_count;
        stats.jobs_task_count = que.count;
        stats.jobs_run_time = que.mean;
        stats.jobs_run_time_p50 = que.med;
        stats.jobs_run_time_p95 = que.p95;
    }

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
        if (!m.req?.meter?.count) continue;

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

    lib.parallel([
        function(next) {
            lib.networkStats(core.instance.netdev, (err, net) => {
                Object.assign(stats, net);
                next(null, stats);
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

    // Keep only relevant metrics
    for (const p in stats) {
        if (stats[p] === 0 || stats[p] < 0 || lib.isEmpty(stats[p])) {
            delete stats[p];
            continue;
        }
        for (const f in this.filter) {
            if (p.startsWith(f) && this.filter[f] && !this.filter[f].test(p)) {
                delete stats[p];
                break;
            }
        }
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
    var columns = options.columns || lib.empty;

    if (!fields.length || !groups.length) {
        return callback({ status: 400, message: "groups and fields must be provided" })
    }

    logger.debug("queryElasticsearch:", mod.name, options);

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
        const a = columns[f]?.stat || this.columns[f]?.stat || "avg";
        q.aggs.stats.aggs.fields.aggs[f] = {
            [a]: {
                field: f
            }
        }
    }

    db.search(options.table || "bk_stats", q, { pool: options.pool, count: options.count }, (err, rows, info) => {
        if (!err) {
            var values = {}, timestamps = [];
            if (!options.raw) {
                for (const t of info.aggregations.stats.buckets) {
                    values[t.key] = {};
                    for (const f of fields) {
                        const mult = columns[f]?.mult || this.columns[f]?.mult;
                        const incr = columns[f]?.incr || this.columns[f]?.incr;
                        let sum = 0;
                        const v = t.fields.buckets.map((x) => {
                            x = x[f] && x[f].value || 0;
                            if (mult) x *= mult; else
                            if (incr) x += incr;
                            sum += x;
                            return x;
                        });
                        if (sum || options.zeros) values[t.key][f] = v;

                        if (!timestamps.length) {
                            timestamps = t.fields.buckets.map((x) => (x.key));
                        }
                    }
                }
            }
        }
        callback(err, { values, timestamps, info, rows });
    });

}
