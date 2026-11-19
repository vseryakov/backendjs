 /*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
'use strict';

const app = require(__dirname + '/app');
const lib = require(__dirname + '/lib');
const logger = require(__dirname + '/logger');
const db = require(__dirname + '/db');
const fs = require("node:fs");

/**
 * @module stats
 */

const mod =

/**
 * Collects metrics about host and processes like CPU, memory, network, API rates...
 * All metrics are stored in a single object and sent to the confgured destination
 *
 * To enable stats collection set stats-interval to period in milliseconds.
 *
 * To use Elasticsearch run
 *     bkjs es-prepare-stats -table bk_stats
 *
 * Then set in config `stats-target={ "url": "http://localhost:9200/bk_stats/_doc/", "headers": {...} }`
 *
 * To send to OpenTelemetry collector via OTLP/HTTP JSON collector(Grafana):
 *
 * ```
 * stats-interval = 30
 * stats-target={ "otlp": "http://localhost:4318/v1/metrics", "headers": { "authorization": "..." }, "options": {} }
 * ```
 *
 * Or directly to Prometheus
 *
 * stats-target={ "otlp": "http://localhost:9090/api/v1/otlp/v1/metrics" }
 *
 */

module.exports = {
    name: "stats",

    /**
     * @var {ConfigOptions[]}
     * @default
     */
    args: [
        { name: "flags", type: "list", descr: "Feature flags" },
        { name: "interval", type: "int", descr: "Interval for process stats collection in ms" },
        { name: "target", type: "json", descr: "Target options, one of otlp, file, url, log..." },
        { name: "roles", type: "list", descr: "Process roles that report stats only" },
        { name: "filter", obj: "filter", type: "map", map_type: "regexp", merge: 1, not_empty: 1, descr: "For each metric prefix provide regexp to keep only matched stats", example: "-stats-filter db_dynamodb" },
    ],
    columns: {
        timestamp: { type: "mtime" },
        id: { keyword: 1, label: "Instance/task ID" },
        pid: { type: "int", label: "Process pid" },
        host: { keyword: 1, label: "Full hostname name" },
        hostname: { keyword: 1, label: "Host name" },
        tag: { keyword: 1, label: "Instance tag" },
        zone: { keyword: 1, label: "Availability zone" },
        ip: { keyword: 1, label: "IP address" },
        role: { keyword: 1, label: "Process role" },
        arch: { keyword: 1, label: "System architecture" },

        collect_time: { type: "number", label: "Collect duration in ms", unit: "ms" },
        eventloop_util: { type: "number", label: "Event loop utilization as %", unit: "%" },

        proc_cpu_util: { type: "number", label: "Process cpu utilization as %", unit: "%" },
        proc_mem_util: { type: "number", label: "Process memory used as %", unit: "%" },
        proc_mem_rss: { type: "bigint", label: "Process memory used in bytes", unit: "By" },
        proc_heap_total: { type: "bigint", label: "Number of bytes V8 has allocated for the heap", unit: "By" },
        proc_heap_used: { type: "bigint", label: "Number of bytes currently being used by V8’s JavaScript objects", unit: "By" },
        proc_heap_malloc: { type: "bigint", label: "Number of bytes allocated through malloc by V8", unit: "By" },
        proc_heap_external: { type: "bigint", label: "Number of bytes for array buffers and external strings", unit: "By" },
        proc_heap_native: { type: "bigint", label: "Number of the top-level contexts currently active" },
        proc_heap_detached: { type: "bigint", label: "Number of contexts that were detached and not yet garbage collected" },
        proc_heap_new_space: { type: "bigint", label: "Number of bytes for new objects", unit: "By" },
        proc_heap_old_space: { type: "bigint", label: "Number of bytes for old objects", unit: "By" },
        proc_gc_count: { type: "bigint", label: "Number of GC runs" },
        proc_gc_time: { type: "bigint", label: "GC run time", unit: "ms" },

        host_cpu_util: { type: "number", label: "System cpu utilization as %", unit: "%" },
        host_mem_util: { type: "number", label: "System memory used as %", unit: "%" },
        host_mem_used: { type: "bigint", label: "System memory used in bytes", unit: "By" },

        net_rx_bytes: { type: "bigint", label: "Network bytes received", stat: "sum" },
        net_tx_bytes: { type: "bigint", label: "Network bytes sent", stat: "sum" },
        net_rx_rate: { type: "number", label: "Network receive rate as bytes per sec", unit: "By/s" },
        net_tx_rate: { type: "number", label: "Network transmit rate as bytes per sec", unit: "By/s" },
        net_rx_packets: { type: "bigint", label: "Received network packets", stat: "sum" },
        net_tx_packets: { type: "bigint", label: "Transmitted network packets", stat: "sum" },
        net_rx_errors: { type: "bigint", label: "Receive network errors", stat: "sum" },
        net_tx_errors: { type: "bigint", label: "Transmit network error", stat: "sum" },
        net_rx_dropped: { type: "bigint", label: "Dropped receive packets", stat: "sum" },
        net_tx_dropped: { type: "bigint", label: "Dropped transmit packets", stat: "sum" },

        api_200_count: { type: "number", label: "API requests with 200 status", stat: "sum" },
        api_400_count: { type: "number", label: "API requests with 400 status", stat: "sum" },
        api_401_count: { type: "number", label: "API requests with 401 status", stat: "sum" },
        api_403_count: { type: "number", label: "API requests with 403 status", stat: "sum" },
        api_404_count: { type: "number", label: "API requests with 404 status", stat: "sum" },
        api_409_count: { type: "number", label: "API requests with 409 status", stat: "sum" },
        api_417_count: { type: "number", label: "API requests with 417 status", stat: "sum" },
        api_429_count: { type: "number", label: "API requests with 429 status", stat: "sum" },
        api_bad_count: { type: "number", label: "API requests with 4XX status", stat: "sum" },
        api_err_count: { type: "number", label: "API requests with 5XX status", stat: "sum" },
        api_req_rate: { type: "number", label: "API request rate per second", unit: "req/s" },
        api_que_size: { type: "number", label: "API request queue size", stat: "sum" },
        api_res_time: { type: "number", label: "API response time in ms", unit: "ms" },

        jobs_que_size: { type: "number", label: "Jobs running queue size", stat: "sum" },
        jobs_err_count: { type: "number", label: "Jobs errors", stat: "sum" },
        jobs_task_count: { type: "number", label: "Jobs tasks executed", stat: "sum" },
        jobs_run_time: { type: "number", label: "Jobs running time", unit: "ms" },

        cache_default_req_count: { type: "number", label: "Cache request count", stat: "sum" },
        cache_default_req_rate: { type: "number", label: "Cache request rate", unit: "req/s" },
        cache_default_res_time: { type: "number", label: "Cache response time", unit: "ms" },

        "cache.count": { type: "number", label: "Cache request count", stat: "sum" },
        "cache.rate": { type: "number", label: "Cache request rate", unit: "req/s" },
        "cache.time": { type: "number", label: "Cache response time", unit: "ms" },

        queue_default_req_count: { type: "number", label: "Queue jobs count", stat: "sum" },
        queue_default_req_rate: { type: "number", label: "Queue job request rate", unit: "req/s" },
        queue_default_res_time: { type: "number", label: "Queue job run time", unit: "ms" },

        "queue.count": { type: "number", label: "Queue jobs count", stat: "sum" },
        "queue.rate": { type: "number", label: "Queue job request rate", unit: "req/s" },
        "queue.time": { type: "number", label: "Queue job run time", unit: "ms" },

        db_dynamodb_req_count: { type: "number", label: "DB pool queries executed", stat: "sum" },
        db_dynamodb_res_time: { type: "number", label: "DB pool query response time", unit: "ms" },
        db_dynamodb_que_size: { type: "number", label: "DB pool query queue size", stat: "sum" },

        "db.pool.count": { type: "number", label: "DB pool queries executed", stat: "sum" },
        "db.pool.time": { type: "number", label: "DB pool query response time", unit: "ms" },
        "db.pool.size": { type: "number", label: "DB pool query queue size", stat: "sum" },

        db_dynamodb_default_read_count: { type: "number", label: "DB pool table read count", stat: "sum" },
        db_dynamodb_default_read_rate: { type: "number", label: "DB pool table read rate", unit: "req/s" },
        db_dynamodb_default_write_count: { type: "number", label: "DB pool table write count", stat: "sum" },
        db_dynamodb_default_write_rate: { type: "number", label: "DB pool table write rate", unit: "req/s" },

        "db.table.count": { type: "number", label: "DB pool table r/w count", stat: "sum" },
        "db.table.rate": { type: "number", label: "DB pool table r/w ate", unit: "req/s" },

    },

    otlpMap: {
        "db.pool.{type}": /^db_(?<pool>[a-z0-9]+)_(?<op>[^_]+)_(?<type>[^_]+)$/,
        "queue.{type}": /^queue_(?<queue>.+)_(?<op>[^_]+)_(?<type>[^_]+)$/,
        "cache.{type}": /^cache_(?<cache>.+)_(?<op>[^_]+)_(?<type>[^_]+)$/,
        "db.table.{type}": /^db_(?<pool>[a-z0-9]+)_(?<table>.+)_(?<op>[^_]+)_(?<type>[^_]+)$/,
    },

    roles: [],
    retryCount: 2,

};

mod.configureModule = function(_options, callback)
{
    mod._runtime = mod._errors = 0;
    mod._timer = setInterval(this.run.bind(mod), lib.randomInt(4000, 5000));

    callback();
}

mod.shutdown = function(_options, callback)
{
    clearInterval(mod._timer);
    mod._timer = undefined;
    lib.tryCall(callback);
}

mod.run = function()
{
    if (mod._running) return;
    if (mod.roles.length && !mod.roles.includes(app.role)) return;
    const now = Date.now();

    if (!mod.interval || now - mod._runtime < mod.interval) return;

    mod._running = 1;
    mod._runtime = now;
    mod.collect((_err, stats) => {
        stats.collect_time = Date.now() - mod._runtime;

        if (!mod.target) {
            mod._running = 0;
            return;
        }

        mod.send(mod.target, stats, (err) => {
            mod._running = 0;
            mod._stats = stats;
            mod._error = err;
            mod._errors = err ? mod._errors + 1 : 0;
        });
    });
}

// Collect process stats
mod.collect = function(options, callback)
{
    if (typeof options === "function") callback = options, options = {};

    if (!options) options = {};

    // Basic sys/process stats
    const stats = options.stats = lib.cpuStats();
    Object.assign(stats, lib.memoryStats());
    Object.assign(stats, lib.heapStats());

    // GC stats if enabled
    const gc = lib.gcStats(lib.includes(mod.flags, "gc"));
    stats.proc_gc_count = gc.count;
    stats.proc_gc_time = gc.time;

    // Dimensions
    stats.role = app.role;
    stats.host = app.host;
    stats.hostname = app.hostName;
    stats.arch = app.arch;
    stats.ip = app.ipaddr;
    stats.id = app.env.id;
    stats.tag = app.env.tag;
    stats.zone = app.env.zone;

    lib.parallel([
        (next) => {
            if (!lib.includes(mod.flags, "net")) return next();
            lib.networkStats(app.env.netdev, (_err, net) => {
                Object.assign(stats, net);
                next(null, stats);
            });
        },
        (next) => {
            app.runMethods("configureCollectStats", options, { sync: 1 }, () => {
                logger.debug("collect:", mod.name, options);
                next(null, stats);
            });
        }
    ], callback);
}

mod.send = function(target, stats, callback)
{
    if (typeof callback !== "function") callback = lib.noop;

    if (!target || !stats) return callback();

    for (const p in stats) {
        // By default do not store 0 to minimize storage (ES)
        if ((stats[p] === 0 && !target.otlp) ||
            stats[p] < 0 ||
            lib.isEmpty(stats[p])) {
            delete stats[p];
            continue;
        }
        // Keep only relevant metrics
        for (const f in mod.filter) {
            if (p.startsWith(f) && mod.filter[f] && !mod.filter[f].test(p)) {
                delete stats[p];
                break;
            }
        }
    }

    if (target.log) {
        logger.logger(target.log, "stats:", stats);
    }

    let url = target.url || target.otlp;

    if (url) {
        url = lib.toTemplate(url, stats);
        const opts = lib.objCreate({
            method: "POST",
            retryCount: mod.retryCount,
            retryOnError: 1,
            noutf8: true
        }, target.options);

        if (target.otlp) {
            opts.postdata = mod.toOTLP(stats);
            if (target.log) {
                logger.logger(target.log, "otlp:", opts.postdata);
            }
        } else

        if (opts.postdata) {
            opts.postdata = lib.toTemplate(opts.postdata, { stats, target });
        } else {
            opts.postdata = stats;
        }
        opts.headers = target.headers;
        return lib.fetch(url, opts, callback);
    }

    if (target.file) {
        return fs.appendFile(target.file, lib.stringify(stats) + "\n", callback);
    }

    callback();
}

// Convert stats into OTLP JSON metrics, strings become resource attributes, counters are sent as cumulative sums
mod.toOTLP = function(stats)
{
    // stats.timestamp is in ms, OTLP needs ns
    const now = stats.timestamp > 0 ?
                      String(BigInt(stats.timestamp*1000)*1000n) :
                      lib.clockn().toString();

    if (!mod._otlpstart) mod._otlpstart = now;
    if (!mod._otlpsums) mod._otlpsums = lib.objCreate();

    const resource = [
        { key: "service.name", value: { stringValue: app.env.tag || app.env.app } },
        { key: "service.version", value: { stringValue: app.env.version } },
        { key: "service.instance.id", value: { stringValue: app.env.id } },
        { key: "process.pid", value: { intValue: app.env.pid } },
    ];
    const metrics = lib.objCreate();

    for (const p in stats) {
        let val = stats[p];
        if (p === "timestamp" || p === "pid") continue;

        if (typeof val !== "number") {
            resource.push({ key: p, value: { stringValue: String(val) } });
            continue;
        }

        let col = mod.columns[p];
        const point = { timeUnixNano: now };

        let name = p.replace(/_/g, ".");
        for (const n in mod.otlpMap) {
            const d = mod.otlpMap[n]?.exec(p);
            if (!d) continue;
            name = n;
            for (const key in d.groups) {
                const v = `{${key}}`;
                if (name.includes(v)) {
                    name = name.replace(v, d.groups[key]);
                    continue;
                }
                point.attributes = point.attributes || [];
                point.attributes.push({ key, value: { stringValue: d.groups[key] } });
            }
            col = mod.columns[name];
            break;
        }

        // Counters are reset every interval, Prometheus rejects delta sums so send running totals as cumulative
        if (name.endsWith(".count")) {
            val = mod._otlpsums[p] = (mod._otlpsums[p] || 0) + val;
            point.startTimeUnixNano = mod._otlpstart;
        }
        if (col?.type === "bigint" || col?.type === "int") {
            point.asInt = String(Math.round(val));
        } else {
            point.asDouble = val;
        }

        // Mapped stats with the same name are data points of the same metric
        if (metrics[name]) {
            (metrics[name].sum || metrics[name].gauge).dataPoints.push(point);
            continue;
        }
        const m = metrics[name] = { name };
        if (col?.label) {
            m.description = col.label;
            m.unit = col.unit;
        }

        if (col && !m.unit) {
            m.unit = name.endsWith(".time") ? "ms":
                     name.endsWith(".rate") ? "req/s":
                     name.endsWith(".util") ? "%": undefined;
        }

        if (name.endsWith(".count")) {
            m.sum = { aggregationTemporality: 2, isMonotonic: true, dataPoints: [point] };
        } else {
            m.gauge = { dataPoints: [point] };
        }
    }

    return {
        resourceMetrics: [{
            resource: {
                attributes: resource
            },
            scopeMetrics: [
                {
                    scope: {
                        name: app.env.app,
                        version: app.env.version
                    },
                    metrics: Object.values(metrics)
                }
            ]
        }]
    };
}

mod.queryElasticsearch = function(options, callback)
{
    var tsize = options.tsize || 50;
    var ssize = options.ssize || undefined;
    var tags = lib.split(options.tags);
    var groups = lib.split(options.groups);
    var interval = lib.toNumber(options.interval) || 60000;
    var age = lib.toNumber(options.age) || 300000;
    var timedelta = lib.toNumber(options.timedelta);
    var since = lib.toMtime(options.since, Date.now() - age - timedelta);
    var before = lib.toMtime(options.before, Date.now() - timedelta);
    var fields = lib.split(options.fields);
    var columns = Object.assign({}, options.columns);

    if (!fields.length || !groups.length) {
        return callback({ status: 400, message: "groups and fields must be provided" })
    }

    const q = {
        size: 0,
        query: {
            query_string: {
                 query: `timestamp:>=${since} AND timestamp:<=${before}`
            }
        },
        aggs: {
            stats: {
                aggs: {
                    fields: {
                        date_histogram: {
                            field: "timestamp",
                            min_doc_count: options.min_doc_count,
                            calendar_interval: options.unit || undefined,
                            fixed_interval: options.unit ? undefined : `${Math.round(interval/1000)}s`,
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
            size: tsize,
            shard_size: ssize,
            terms: groups.map((x) => ({ field: x }))
        }
    } else {
        q.aggs.stats.terms = {
            size: tsize,
            shard_size: ssize,
            field: groups[0],
        }
    }

    for (const f of fields) {
        const stat = columns[f]?.stat || this.columns[f]?.stat || "avg";
        if (!columns[f]) columns[f] = {};
        const col = Object.assign(columns[f], this.columns[f]);

        // methods: rescale_0_1, rescale_0_100, percent_of_sum, mean, zscore, softmax
        if (col.norm) {
            q.aggs.stats.aggs.fields.aggs["_" + f] = {
                [stat]: {
                    field: f
                }
            }
            q.aggs.stats.aggs.fields.aggs[f] = {
                normalize: {
                    buckets_path: "_" + f,
                    method: col.norm,
                }
            }
        } else
        if (col.diff) {
            q.aggs.stats.aggs.fields.aggs["_" + f] = {
                [stat]: {
                    field: f
                }
            }
            q.aggs.stats.aggs.fields.aggs[f] = {
                serial_diff: {
                    buckets_path: "_" + f,
                    lag: col.diff_lag || 1,
                }
            }
        } else {
            q.aggs.stats.aggs.fields.aggs[f] = {
                [stat]: {
                    field: f
                }
            }
        }
    }

    logger.debug("queryElasticsearch:", mod.name, options, "Q:", q);

    db.search(options.table || "bk_stats", q, { pool: options.pool, count: options.count }, (err, rows, info) => {
        var data = {}, timestamps = [];
        if (!err) {
            if (!options.raw) {
                for (const t of info.aggregations.stats.buckets) {
                    data[t.key] = {};
                    for (const f of fields) {
                        const col = columns[f], blen = t.fields.buckets.length - 1, trim = col?.trim || options.trim;
                        let sum = 0, ndocs = 0, key = f;
                        const d = t.fields.buckets.map((x, i) => {
                            let v = x[f]?.value || 0;
                            if (i < blen) {
                                ndocs += x.doc_count || 0;
                            } else
                            if (trim > 0) {
                                // Ignore the last value if number of docs is less than given threshold due to not enough data yet
                                x.trim = x.doc_count*100/(ndocs/blen);
                                if (x.trim < trim) return "";
                            }
                            if (col) {
                                if (col?.mult) v *= col.mult; else
                                if (col?.div) v /= col.div; else
                                if (col?.incr) v += col.incr;
                                if (v < 0 && col?.diff && col?.diff > 0) v = 0;
                                if (typeof col?.min === "number" && v < col.min) v = col.min; else
                                if (typeof col?.max === "number" && v > col.max) v = col.max;
                                if (col?.abs) v = Math.abs(v);
                                if (col?.key) key = col.key;
                            }
                            sum += v;
                            return v;
                        });
                        if (sum || options.zeros) data[t.key][key] = d;

                        if (!timestamps.length) {
                            timestamps = t.fields.buckets.map((x) => (x.key));
                        }
                    }
                }
            }
        }
        callback(err, { data, timestamps, info, rows });
    });

}
