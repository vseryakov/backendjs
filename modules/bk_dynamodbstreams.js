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

const mod = {
    args: [
        { name: "tables", type: "list", onupdate: function() {if(core.role=="worker")this.subscribeWorker()}, descr: "Process streams for given tables in a worker process" },
        { name: "source-pool", descr: "DynamoDB pool for streams processing" },
        { name: "target-pool", descr: "A database pool where to sync streams" },
        { name: "auto-provision", descr: "To auto enable streams on each table set to  NEW_IMAGE | OLD_IMAGE | NEW_AND_OLD_IMAGES | KEYS_ONLY" },
        { name: "interval", type: "int", descr: "Interval in ms between stream shard processing" },
        { name: "interval-([a-z0-9_]+)", type: "int", obj: "intervals", strip: /interval-/, nocamel: 1, descr: "Interval in ms between stream shard processing by table name" },
        { name: "max-interval", type: "int", descr: "Maximum interval in ms between stream shard processing, for cases when no shards are available" },
        { name: "max-interval-([a-z0-9_]+)", type: "int", obj: "maxIntervals", strip: /max-interval-/, nocamel: 1, descr: "Maximum interval in ms between stream shard processing by table name, for cases when no shards are available" },
        { name: "lock-ttl", type: "int", descr: "Lock timeout and the delay between lock attempts" },
        { name: "lock-type", descr: "Locking policy, stream or shard to avoid processing to the same resources" },
        { name: "max-timeout-([0-9]+)-([0-9]+)", type: "list", obj: "periodTimeouts", make: "$1,$2", regexp: /^[0-9]+$/, reverse: 1, nocamel: 1, descr: "Max timeout on empty records during the given hours range in 24h format, example: -bk_dynamodbstreams-max-timeout-1-8 30000" },
        { name: "max-timeout-([a-z0-9_]+)", type: "int", obj: "maxTimeouts", strip: /max-timeout-/, nocamel: 1, descr: "Max timeout on empty records by table, example: -bk_dynamodbstreams-max-timeout-table_name 30000" },
    ],
    jobs: [],
    ttl: 86400*2,
    lockTtl: 30000,
    lockType: "stream",
    interval: 3000,
    intervals: {},
    maxInterval: 10000,
    periodTimeouts: {},
    maxTimeouts: {},
    maxIntervals: {},
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

mod.processTable = function(options, callback)
{
    if (!options.table || !options.source_pool || !options.target_pool) {
        return lib.tryCall(callback, "table, source_pool and target_pool must be provided", options);
    }
    db.getPool(options.source_pool).prepareOptions(options);
    var stream = { table: options.table };
    aws.ddbProcessStream(stream, options, this.syncProcessor, (err) => {
       lib.tryCall(callback, err, stream);
    });
}

mod.runJob = function(options, callback)
{
    if (!options.table || !options.source_pool || !options.target_pool) {
        return lib.tryCall(callback, "table, source_pool and target_pool must be provided", options);
    }
    logger.info("runJob:", mod.name, "started", options);
    options = lib.objClone(options, "logger_error", { ResourceNotFoundException: "info", TrimmedDataAccessException: "info", ExpiredIteratorException: "info" });
    db.getPool(options.source_pool).prepareOptions(options);
    this.jobs.push(options.table);
    var stream = { table: options.table };
    lib.doWhilst(
        function(next) {
            options.maxInterval = mod.maxIntervals[options.table] || mod.maxInterval;
            options.shardRetryMaxTimeout = mod.maxTimeouts[options.table] || 0;
            for (var p in mod.periodTimeouts) {
                if (lib.isTimeRange(mod.periodTimeouts[p][0], mod.periodTimeouts[p][1])) {
                    options.shardRetryMaxTimeout = Math.max(p, options.shardRetryMaxTimeout);
                }
            }
            stream.shards = stream.error = 0;
            aws.ddbProcessStream(stream, options, mod.syncProcessor, (err) => {
                if (err) logger.error("runJob:", mod.name, stream, err);
                if (stream.error) logger.debug("runJob:", mod.name, stream);
                setTimeout(next, !stream.StreamArn || stream.error ? options.maxInterval*2 :
                                 !stream.shards ? options.maxInterval :
                                 mod.intervals[options.table] || mod.interval);
            });
        },
        function() {
            return mod.syncProcessor("running", stream, options);
        },
        (err) => {
            logger.logger(err ? "error": "info", "runJob:", mod.name, "finished:", err, options);
            lib.arrayRemove(mod.jobs, options.table);
            lib.tryCall(callback, err);
        });
}

mod.lock = function(key, query, options, callback)
{
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

mod.syncProcessor = function(cmd, req, options, callback)
{
    logger.debug("syncProcessor:", mod.name, cmd, req);
    switch (cmd) {
    case "running":
        return !mod.exiting && !jobs.exiting && !jobs.isCancelled(mod.name, req.table || options.table);

    case "shard-check":
        return !mod.skipCache[options.table + req.ShardId];

    case "stream-prepare":
        return mod.processStreamPrepare(req, options, callback);

    case "stream-start":
        return mod.processStreamStart(req, options, callback);

    case "stream-end":
        return mod.processStreamEnd(req, options, callback);

    case "shard-start":
        return mod.processShardStart(req, options, callback);

    case "shard-end":
        return mod.processShardEnd(req, options, callback);

    case "records":
        return mod.processRecords(req, options, callback);
    }
}

mod.processStreamPrepare = function(req, options, callback)
{
    lib.series([
        function(next) {
            if (!mod.autoProvision) return next();
            if (req.Stream.StreamArn) return next();
            aws.ddbDescribeTable(options.table, options, next);
        },
        function(next, descr) {
            if (!descr || !descr.Table) return next();
            if (descr.Table.LatestStreamArn) return next();
            logger.debug("processStreamPrepare:", mod.name, options.table, req.Stream, descr);
            aws.ddbUpdateTable({ name: options.table, stream: mod.autoProvision, endpoint: options.endpoint }, next);
        },
    ], callback);
}

mod.processStreamStart = function(req, options, callback)
{
    lib.series([
        function(next) {
            logger.debug("processStreamStart:", mod.name, options.table, req.Stream);
            if (mod.lockType != "stream") return next();
            mod.lock(options.table, req.Stream, options, (err, locked) => {
                if (!err && !locked) err = "not-locked";
                next(err);
            });
        },
    ], callback);
}

mod.processStreamEnd = function(req, options, callback)
{
    lib.series([
        function(next) {
            logger.debug("processStreamEnd:", mod.name, options.table, req.Stream);
            if (mod.lockType != "stream") return next();
            mod.unlock(options.table, req.Stream, options, next);
        },
    ], callback);
}

// Get the last processed sequence for the shard
mod.processShardStart = function(req, options, callback)
{
    lib.series([
        function(next) {
            if (mod.skipCache[options.table + req.Shard.ShardId]) return next("unknown");
            if (mod.lockType != "shard") return next();
            mod.lock(options.table + req.Shard.ShardId, req.Shard, options, (err, locked) => {
                if (!err && !locked) err = "not-locked";
                next(err);
            });
        },
        function(next) {
            db.get("bk_property", { name: options.table + req.Shard.ShardId }, options, (err, row) => {
                if (row && row.value && !options.force) {
                    req.Shard.SequenceNumber = row.value;
                    req.Shard.ShardIteratorType = "AFTER_SEQUENCE_NUMBER";
                    logger.debug("processShardStart:", mod.name, options.table, req.Shard, req.Stream);
                }
                next(err);
            });
        },
    ], callback);
}

mod.processShardEnd = function(req, options, callback)
{
    lib.series([
        function(next) {
            if (mod.lockType != "shard") return next();
            mod.unlock(options.table + req.Shard.ShardId, req.Shard, options, next);
        },
        function(next) {
            if (!req.Shard.error) {
                lib.objIncr(req.Stream, "shards");
            } else {
                // Skip unknown or stale shards
                if (req.Shard.error === "skip" ||
                    req.Shard.error === "unknown" ||
                    (req.Shard.error.code == "ResourceNotFoundException" && req.Shard.error.action == "GetShardIterator")) {
                    mod.skipCache[options.table + req.Shard.ShardId] = Date.now();
                }
            }
            logger.debug("processShardEnd:", mod.name, options.table, req.Shard, req.Stream);
            next();
        },
    ], callback);
}

// Commit a batch of shard records processed
mod.processRecords = function(req, options, callback)
{
    lib.series([
        function(next) {
            if (!req.Records.length) return next();
            lib.objIncr(options, "records", req.Records.length);
            lib.objIncr(req.Stream, "records", req.Records.length);
            logger.info("processRecords:", mod.name, options.table, req.Shard, req.LastSequenceNumber, req.Records.length, "records");
            var bulk = req.Records.map((x) => ({ op: x.eventName == "REMOVE" ? "del" : "put", table: options.table, obj: x.dynamodb.NewImage || x.dynamodb.Keys, ddb: x.dynamodb }));
            db.bulk(bulk, { pool: options.target_pool }, next);
        },
        function(next, errors) {
            for (const i in errors) logger.warn("processRecords:", mod.name, errors[i]);
            if (!req.LastSequenceNumber) return next();
            options.lastShardId = req.Shard.ShardId;
            options.lastSequenceNumber = req.LastSequenceNumber;
            db.put("bk_property", { name: options.table + options.lastShardId, value: options.lastSequenceNumber, ttl: lib.now() + mod.ttl }, options, next);
        },
    ], callback);
}

