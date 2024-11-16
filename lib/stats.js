//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const core = require(__dirname + '/core');
const lib = require(__dirname + '/lib');
const logger = require(__dirname + '/logger');
const db = require(__dirname + '/db');
const fs = require("fs");

// Collects metrics about host and processes like CPU, memory, network, API rates...
// All metrics are stored in a single object and sent to the confgured destination
//
// To use Elasticsearch run
//     bkjs es-prepare-stats -table bk_stats
// Then set in config `stats-target={ "url": "http://localhost:9200/bk_stats/_doc/" }`

const mod = {
    name: "stats",
    args: [
        { name: "flags", type: "list", descr: "Feature flags" },
        { name: "interval", type: "int", descr: "Interval for process stats collection" },
        { name: "target", type: "json", descr: "Target options, one of file, url, log..." },
        { name: "roles", type: "list", descr: "Process roles that report stats only" },
        { name: "filter", obj: "filter", type: "map", maptype: "regexp", merge: 1, noempty: 1, descr: "For each metric prefix provide regexp to keep only matched stats, ex: -stats-filter db:dynamodb" },
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
        eventloop_util: { type: "number", label: "Event loop utilization as %" },
        proc_cpu_util: { type: "number", label: "Process cpu utilization as %" },
        proc_mem_util: { type: "number", label: "Process memory used as %" },
        proc_mem_rss: { type: "bigint", label: "Process memory used in bytes" },
        proc_heap_total: { type: "bigint", label: "Number of bytes V8 has allocated for the heap" },
        proc_heap_used: { type: "bigint", label: "Number of bytes currently being used by V8’s JavaScript objects" },
        proc_heap_malloc: { type: "bigint", label: "Number of bytes allocated through malloc by V8" },
        proc_heap_external: { type: "bigint", label: "Number of bytes for array buffers and external strings" },
        proc_heap_native: { type: "bigint", label: "Number of the top-level contexts currently active" },
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
        api_400_count: { type: "number", label: "API requests with 400 status", stat: "sum" },
        api_401_count: { type: "number", label: "API requests with 401 status", stat: "sum" },
        api_403_count: { type: "number", label: "API requests with 403 status", stat: "sum" },
        api_404_count: { type: "number", label: "API requests with 404 status", stat: "sum" },
        api_409_count: { type: "number", label: "API requests with 409 status", stat: "sum" },
        api_417_count: { type: "number", label: "API requests with 417 status", stat: "sum" },
        api_429_count: { type: "number", label: "API requests with 429 status", stat: "sum" },
        api_bad_count: { type: "number", label: "API requests with 4XX status", stat: "sum" },
        api_err_count: { type: "number", label: "API requests with 5XX status", stat: "sum" },
        api_req_rate: { type: "number", label: "API request rate per second" },
        api_que_size: { type: "number", label: "API request queue size", stat: "sum" },
        api_res_time: { type: "number", label: "API response time in ms" },
        jobs_que_size: { type: "number", label: "Jobs running queue siae", stat: "sum" },
        jobs_err_count: { type: "number", label: "Jobs errors", stat: "sum" },
        jobs_task_count: { type: "number", label: "Jobs tasks executed", stat: "sum" },
        jobs_run_time: { type: "number", label: "Jobs running time" },
        cache_default_req_count: { type: "number", label: "Cache request count", stat: "sum" },
        cache_default_req_rate: { type: "number", label: "Cache request rate" },
        cache_default_res_time: { type: "number", label: "Cache response time " },
        queue_default_req_count: { type: "number", label: "Queue jobs count", stat: "sum" },
        queue_default_req_rate: { type: "number", label: "Queue job request rate" },
        queue_default_res_time: { type: "number", label: "Queue job run time" },
        db_dynamodb_req_count: { type: "number", label: "DB pool queries executed", stat: "sum" },
        db_dynamodb_res_time: { type: "number", label: "DB pool query response time" },
        db_dynamodb_que_size: { type: "number", label: "DB pool query queue size", stat: "sum" },
        db_dynamodb_default_read_count: { type: "number", label: "DB pool table read count", stat: "sum" },
        db_dynamodb_default_read_rate: { type: "number", label: "DB pool table read rate" },
        db_dynamodb_default_write_count: { type: "number", label: "DB pool table write count", stat: "sum" },
        db_dynamodb_default_write_rate: { type: "number", label: "DB pool table write rate" },
    },
    roles: [],
};
module.exports = mod;

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
        stats.stats_time = Date.now() - this._runtime;

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
    var stats = options.stats = lib.cpuStats();
    Object.assign(stats, lib.memoryStats());
    Object.assign(stats, lib.heapStats());

    // GC stats if enabled
    var gc = lib.gcStats(lib.isFlag(this.flags, "gc"));
    stats.proc_gc_count = gc.count;
    stats.proc_gc_time = gc.time;

    // Dimensions
    stats.role = core.role;
    stats.host = core.host;
    stats.hostname = core.hostName;
    stats.arch = core.arch;
    stats.ip = core.ipaddr;
    stats.id = core.instance.id;
    stats.tag = core.instance.tag;
    stats.zone = core.instance.zone;

    lib.parallel([
        function(next) {
            if (!lib.isFlag(mod.flags, "net")) return next();
            lib.networkStats(core.instance.netdev, (err, net) => {
                Object.assign(stats, net);
                next(null, stats);
            });
        },
        function(next) {
            core.runMethods("bkCollectStats", options, { sync: 1 }, () => {
                logger.debug("collect:", mod.name, options);
                next(null, stats);
            });
        }
    ], callback);
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

    callback();
}

mod.queryElasticsearch = function(options, callback)
{
    var tsize = options.tsize || 50;
    var ssize = options.ssize || undefined;
    var tags = lib.strSplit(options.tags);
    var groups = lib.strSplit(options.groups);
    var interval = lib.toNumber(options.interval) || 60000;
    var age = lib.toNumber(options.age) || 300000;
    var timedelta = lib.toNumber(options.timedelta);
    var since = lib.toMtime(options.since, Date.now() - age - timedelta);
    var before = lib.toMtime(options.before, Date.now() - timedelta);
    var fields = lib.strSplit(options.fields);
    var columns = Object.assign({}, options.columns);

    if (!fields.length || !groups.length) {
        return callback({ status: 400, message: "groups and fields must be provided" })
    }

    var q = {
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
        if (!err) {
            var data = {}, timestamps = [];
            if (!options.raw) {
                for (const t of info.aggregations.stats.buckets) {
                    data[t.key] = {};
                    for (const f of fields) {
                        const col = columns[f], blen = t.fields.buckets.length - 1, trim = col?.trim || options.trim;
                        let sum = 0, ndocs = 0, key = f;
                        const d = t.fields.buckets.map((x, i) => {
                            let v = x[f] && x[f].value || 0;
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
                                if (typeof col?.min == "number" && v < col.min) v = col.min; else
                                if (typeof col?.max == "number" && v > col.max) v = col.max;
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
