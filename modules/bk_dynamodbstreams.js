//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const logger = require(__dirname + '/../lib/logger');
const core = require(__dirname + '/../lib/core');
const lib = require(__dirname + '/../lib/lib');
const db = require(__dirname + '/../lib/db');
const aws = require(__dirname + '/../lib/aws');
const jobs = require(__dirname + '/../lib/jobs');
const ipc = require(__dirname + '/../lib/ipc');

// Default parameters are for rare activity with long intervals, for very active tables the interval and timeout must be much smaller
const mod = {
    args: [
        { name: "tables", type: "list", onupdate: function() {if(ipc.role=="worker"&&core.role=="worker")this.subscribeWorker()}, descr: "Process streams for given tables in a worker process" },
        { name: "source-pool", descr: "DynamoDB pool for streams processing" },
        { name: "target-pool", descr: "A database pool where to sync streams" },
        { name: "options-(.+)", obj: "options", nocamel: 1, autotype: 1, descr: "Extra options to pass to jobs and DB calls" },
        { name: "max-jobs", type: "int", descr: "Max tables to run per process at the same time" },
        { name: "lock-ttl", type: "int", descr: "Lock timeout and the delay between lock attempts" },
        { name: "lock-type", descr: "Locking policy, stream or shard to avoid processing to the same resources" },
        { name: "auto-provision", descr: "To auto enable streams on each table set to  NEW_IMAGE | OLD_IMAGE | NEW_AND_OLD_IMAGES | KEYS_ONLY" },
        { name: "concurrency", type: "int", min: 1, descr: "Number of shards to process in parallel" },
        { name: "interval", type: "int", descr: "Interval in ms between stream processing" },
        { name: "interval-([a-z0-9_]+)", type: "int", obj: "intervals", strip: /interval-/, nocamel: 1, descr: "Interval in ms between stream processing by table name" },
        { name: "max-interval", type: "int", descr: "Maximum interval in ms between stream processing iterations, for cases when no shards are available or an error" },
        { name: "max-interval-([a-z0-9_]+)", type: "int", obj: "maxIntervals", strip: /max-interval-/, nocamel: 1, descr: "Maximum interval in ms between stream processing iterations by table name when no shards available or an error" },
        { name: "max-interval-([0-9]+)-([0-9]+)", type: "list", obj: "maxIntervalsByTime", make: "$1,$2", regexp: /^[0-9]+$/, reverse: 1, nocamel: 1, descr: "Maximum interval in ms between stream processing iterations when no shard or an error during the given hours range in 24h format, example: -bk_dynamodbstreams-max-intervals-1-8 30000" },
        { name: "retry-count", type: "int", min: 0, descr: "Number of times to read records from an open shard with no records, 0 forever" },
        { name: "retry-closed-count", type: "int", min: 1, descr: "Number of times to read records from a closed shard" },
        { name: "retry-timeout", type: "int", min: 500, descr: "Min timeout in ms between retries on empty records, exponential backoff is used" },
        { name: "retry-max-timeout", type: "int", min: 1000, descr: "Max timeout in ms on empty records, once reached the timeout is reset back to the min and exponential backoff starts again" },
    ],
    jobs: [],
    running: [],
    options: {
        nocache: 1,
        retryCount: 9,
        retryTimeout: 200,
        logger_error: { ResourceNotFoundException: "info", TrimmedDataAccessException: "info", ExpiredIteratorException: "info" },
    },
    ttl: 86400*2,
    lockTtl: 30000,
    retryCount: 3,
    retryTimeout: 1000,
    retryMaxTimeout: 5000,
    retryClosedCount: 100,
    concurrency: 10,
    interval: 5000,
    intervals: {},
    maxInterval: 10000,
    maxIntervals: {},
    maxIntervalsByTime: {},
    maxJobs: 5,
    skipCache: {},
    timers: {},
};
module.exports = mod;

mod.configureWorker = function(options, callback)
{
    setTimeout(function() { mod.subscribeWorker() }, lib.toNumber(jobs.workerDelay) + lib.randomShort()/1000);
    callback();
}

mod.shutdownWorker = function(options, callback)
{
    this.exiting = 1;
    var timer = setInterval(function() {
        if (mod.jobs.length > 0 && mod.exiting++ < 10) return;
        clearInterval(timer);
        callback();
    }, this.jobs.length ? 1000 : 0);
}

mod.subscribeWorker = function(options)
{
    if (!this.sourcePool || !this.targetPool) return;

    for (const i in this.tables) {
        var table = this.tables[i];
        if (table[0] == "-") {
            jobs.cancelTask(mod.name, { tag: table.substr(1) });
        } else {
            if (lib.isFlag(this.jobs, table)) continue;
            this.runJob({ table: table, source_pool: this.sourcePool, target_pool: this.targetPool, job: true });
        }
    }
}

mod.lock = function(key, query, options, callback)
{
    if (options.lockSkip) return callback(null, 1);
    ipc.lock(mod.name + ":" + key, { ttl: mod.lockTtl, queueName: jobs.uniqueQueue }, (err, locked) => {
        if (locked) {
            mod.timers[key] = setInterval(function() {
                ipc.lock(mod.name + ":" + key, { ttl: mod.lockTtl, queueName: jobs.uniqueQueue, set: 1 });
            }, mod.lockTtl * 0.9);
            mod.timers[key].mtime = Date.now();
        } else {
            clearInterval(mod.timers[key]);
            delete mod.timers[key];
        }
        callback(err, locked);
    });
}

mod.unlock = function(key, query, options, callback)
{
    if (!this.timers[key]) return callback();
    clearInterval(this.timers[key]);
    delete this.timers[key];
    ipc.unlock(mod.name + ":" + key, { queueName: jobs.uniqueQueue }, callback);
}

mod.isRunning = function(options)
{
    return !mod.exiting && !jobs.exiting && !jobs.isCancelled(mod.name, options.table);
}

mod.processTable = function(options, callback)
{
    if (!options.table || !options.source_pool || !options.target_pool) {
        return lib.tryCall(callback, "table, source_pool and target_pool must be provided", options);
    }
    options = lib.objMerge(options, this.options);
    db.getPool(options.source_pool).prepareOptions(options);
    var stream = { table: options.table, shardId: options.lastShardId, lastShardId: options.lastShardId };
    this.processStream(stream, options, (err) => {
       lib.tryCall(callback, err, stream);
    });
}

mod.runJob = function(options, callback)
{
    if (!options.table || !options.source_pool || !options.target_pool) {
        return lib.tryCall(callback, "table, source_pool and target_pool must be provided", options);
    }
    options = lib.objMerge(options, this.options);
    db.getPool(options.source_pool).prepareOptions(options);
    logger.info("runJob:", mod.name, "started:", options);
    this.jobs.push(options.table);
    var stream = { table: options.table };
    lib.doWhilst(
        function(next) {
            var interval = mod.intervals[options.table] || mod.interval;
            var maxInterval = mod.maxIntervals[options.table] || mod.maxInterval;
            for (const p in mod.maxIntervalsByTime) {
                if (lib.isTimeRange(mod.maxIntervalsByTime[p][0], mod.maxIntervalsByTime[p][1])) {
                    maxInterval = Math.max(p, options.maxInterval);
                }
            }
            if (mod.maxJobs > 0 && mod.running.length >= mod.maxJobs) {
                return setTimeout(next, maxInterval);
            }
            mod.lock(options.table, stream, options, (err, locked) => {
                if (!locked) return setTimeout(next, maxInterval);
                mod.running.push(options.table);
                stream.shards = stream.error = 0;
                mod.processStream(stream, options, (err) => {
                    if (err) logger.error("runJob:", mod.name, stream, err);
                    lib.arrayRemove(mod.running, options.table);
                    mod.unlock(options.table, stream, options, () => {
                        setTimeout(next, !stream.StreamArn || stream.error || !stream.shards ? maxInterval : interval);
                    });
                });
            });
        },
        function() {
            return mod.isRunning(options);
        },
        (err) => {
            logger.logger(err ? "error": "info", "runJob:", mod.name, "finished:", err, options);
            lib.arrayRemove(mod.jobs, options.table);
            lib.tryCall(callback, err);
        });
}

mod.processStream = function(stream, options, callback)
{
    lib.everySeries([
        function(next) {
            if (stream.StreamArn) return next();
            aws.ddbDescribeTable(options.table, options, next);
        },
        function(next, err, descr) {
            if (err || stream.StreamArn) return next(err);
            if (!descr.Table || descr.Table.TableStatus == "UPDATING") return next();
            if (descr.Table.StreamSpecification && descr.Table.StreamSpecification.StreamEnabled) {
                stream.StreamArn = descr.Table.LatestStreamArn;
                return next();
            }
            if (!mod.autoProvision) return next();
            logger.debug("processStream:", mod.name, "provision:", options.table, mod.autoProvision, stream);
            aws.ddbUpdateTable({ name: options.table, stream: mod.autoProvision }, next);
        },
        function(next, err) {
            if (err || !stream.StreamArn) return next(err);
            // Get the last completed shard to skip already processed shards
            db.get("bk_property", { name: stream.StreamArn }, options, (err, row) => {
                if (row && row.value && !(options.force || options.stream_force || options.stream_force_once)) {
                    stream.shardId = stream.lastShardId = row.value;
                }
                delete options.stream_force_once;
                next(err);
            });
        },
        function(next, err) {
            if (err || !stream.StreamArn) return next(err);
            mod.getStreamShards(stream, options, (err, shards) => {
                mod.processStreamShards(stream, shards, options, next);
            });
        },
    ], callback);
}

mod.getStreamShards = function(stream, options, callback)
{
    var shards = { queue: [], map: {}, deps: {} };

    aws.ddbDescribeStream(stream, options, (err, info) => {
        info.Shards.forEach((x) => {
            if (x.ParentShardId && !shards.map[x.ParentShardId]) {
                var parent = { ShardId: x.ParentShardId, SequenceNumberRange: {} };
                if (!mod.skipCache[options.table + x.ParentShardId]) shards.map[x.ParentShardId] = parent;
            }
            if (!mod.skipCache[options.table + x.ShardId]) shards.map[x.ShardId] = x;
        });
        shards.queue = Object.keys(shards.map).sort();
        // For each shard produce all dependencies including parent's dependencies in one list for fast checks
        for (const shard in shards.map) {
            var parent = shards.map[shard].ParentShardId;
            while (parent) {
                if (!shards.deps[shard]) shards.deps[shard] = [];
                shards.deps[shard].push(parent);
                parent = shards.map[parent] && shards.map[parent].ParentShardId;
            }
        }
        callback(err, shards);
    });
}

mod.processStreamShards = function(stream, shards, options, callback)
{
    logger.debug("processStreamShards:", this.name, stream, shards);

    shards.running = [];
    lib.forEachItem({ max: this.concurrency, interval: this.retryTimeout, timeout: 900000 },
        function(next) {
            if (!shards.queue.length || !mod.isRunning(options)) return next(null);
            // Return next available shard which has no parents in the list and none of the parents are running
            for (var i = 0; i < shards.queue.length; i++) {
                var shard = shards.queue[i];
                if (!lib.isFlag(shards.running, shards.deps[shard]) && !lib.isFlag(shards.queue, shards.deps[shard])) {
                    shards.queue.splice(i, 1);
                    return next(shards.map[shard]);
                }
            }
            next();
        },
        function(shard, next) {
            shards.running.push(shard.ShardId);
            logger.debug("processStreamShards:", mod.name, options.table, stream, shard, "running:", shards.running);
            mod.processShardRecords(stream, shard, options, () => {
                lib.arrayRemove(shards.running, shard.ShardId);
                next();
            });
        }, callback);
}

mod.processShardRecords = function(stream, shard, options, callback)
{
    lib.everySeries([
        function(next) {
            if (mod.skipCache[options.table + shard.ShardId]) return next("skip");
            db.get("bk_property", { name: options.table + shard.ShardId }, options, (err, row) => {
                if (row && row.value && !(options.force || options.shard_force || options.shard_force_once)) {
                    shard.sequence = row.value;
                    shard.after = 1;
                }
                delete options.shard_force_once;
                next(err);
            });
        },
        function(next, err) {
            if (err) return next(err);
            if (shard.SequenceNumberRange.EndingSequenceNumber &&
                shard.SequenceNumberRange.EndingSequenceNumber == shard.sequence) {
                return next("skip");
            }
            var q = lib.objClone(shard, "StreamArn", stream.StreamArn);
            aws.ddbGetShardIterator(q, options, (err, it) => {
                if (err || !it.ShardIterator) return next(err);
                mod.readShardRecords(stream, shard, it, options, next);
            });
        },
        function(next, err) {
            logger.debug("processShardRecords:", mod.name, options.table, stream, shard, err);
            if (err) {
                if (err === "skip" || (err.code == "ResourceNotFoundException" && err.action == "GetShardIterator")) {
                    mod.skipCache[options.table + shard.ShardId] = Date.now();
                }
                return next();
            }
            // This is a trimmed parent shard, do not try it again after the first time
            if (!shard.SequenceNumberRange.StartingSequenceNumber) {
                mod.skipCache[options.table + shard.ShardId] = Date.now();
            }
            lib.objIncr(stream, "shards");

            // Keep the last closed shard id for the next iteration so we can retrieve only latest shards, need to keep
            // the parent shard so we can be sure we will process all new children shards appeared after this pass.
            if (shard.SequenceNumberRange.EndingSequenceNumber && shard.ParentShardId > (stream.lastShardId || "")) {
                stream.lastShardId = shard.ParentShardId;
                return db.put("bk_property", { name: stream.StreamArn, value: stream.lastShardId, ttl: lib.now() + mod.ttl }, options, next);
            }
            next();
        },
    ], callback);
}

mod.readShardRecords = function(stream, shard, it, options, callback)
{
    var retries = 0, timeout = this.retryTimeout;
    var count = shard.SequenceNumberRange.EndingSequenceNumber ? this.retryClosedCount : this.retryCount;

    lib.doWhilst(
        function(next) {
            aws.ddbGetShardRecords(it, options, function(err, res) {
                it.ShardIterator = res.NextShardIterator;
                // These errors mean we have to close the shard and save the last sequence number, with other errors we have to retry
                if (err && !/ResourceNotFoundException|TrimmedDataAccessException/.test(err.code)) return next(err);
                res.Records = lib.isArray(res.Records, []);
                if (!res.Records.length && it.ShardIterator) {
                    if (!mod.isRunning(options)) return next();
                    logger.debug("readShardRecords:", mod.name, stream, shard, "retry:", retries, timeout);
                    setTimeout(next, lib.toClamp(timeout, mod.retryTimeout, mod.retryMaxTimeout));
                    if (timeout >= mod.retryMaxTimeout) timeout = mod.retryTimeout; else timeout *= 2;
                } else {
                    retries = 0;
                    timeout = mod.retryTimeout;
                    shard.lastSequenceNumber = res.Records.length ? res.Records[res.Records.length - 1].dynamodb.SequenceNumber :
                                               shard.SequenceNumberRange.EndingSequenceNumber || null;
                    mod.syncShardRecords(stream, shard, res.Records, options, next);
                }
            });
        },
        function() {
            // Do not continiously poll empty active shards if the retry count is set
            return it.ShardIterator && mod.isRunning(options) && (count > 0 && ++retries < count);
        },
        callback);
}

// Commit a batch of shard records processed
mod.syncShardRecords = function(stream, shard, records, options, callback)
{
    lib.series([
        function(next) {
            if (!records.length) return next();
            lib.objIncr(stream, "records", records.length);
            logger.info("syncShardRecords:", mod.name, options.table, shard, records.length, "records", options.debug ? records : undefined);
            var bulk = records.map((x) => ({ op: x.eventName == "REMOVE" ? "del" : "put", table: options.table, obj: x.dynamodb.NewImage || x.dynamodb.Keys, ddb: x.dynamodb }));
            db.bulk(bulk, { pool: options.target_pool }, next);
        },
        function(next, errors) {
            for (const i in errors) logger.warn("syncShardRecords:", mod.name, errors[i]);
            if (!shard.lastSequenceNumber) return next();
            db.put("bk_property", { name: options.table + shard.ShardId, value: shard.lastSequenceNumber, ttl: lib.now() + mod.ttl }, options, next);
        },
    ], callback);
}

