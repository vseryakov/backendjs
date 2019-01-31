//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const logger = require(__dirname + '/../lib/logger');
const lib = require(__dirname + '/../lib/lib');
const db = require(__dirname + '/../lib/db');
const aws = require(__dirname + '/../lib/aws');
const jobs = require(__dirname + '/../lib/jobs');
const ipc = require(__dirname + '/../lib/ipc');

const mod = {
    args: [
        { name: "tables", type: "list", onupdate: function() {if(ipc.role=="worker")this.subscribeWorker()}, descr: "Process streams for given tables in a worker process" },
        { name: "source-pool", descr: "DynamoDB pool for streams processing" },
        { name: "target-pool", descr: "A database pool where to sync streams" },
        { name: "lock-ttl", type: "int", descr: "Lock timeout and the delay between lock attempts" },
        { name: "lock-type", descr: "Locking policy, stream or shard to avoid processing to the same resources" },
        { name: "max-timeout-([0-9]+)-([0-9]+)", type: "list", obj: "periodTimeouts", make: "$1,$2", regexp: /^[0-9]+$/, reverse: 1, nocamel: 1, descr: "Max timeout on empty records during the given hours range in 24h format, example: -bk_dynamodbstreams-max-timeout-1-8 30000" },
        { name: "max-timeout-([a-z0-9_]+)", type: "int", obj: "maxTimeouts", strip: /max-timeout-/, nocamel: 1, descr: "Max timeout on empty records by table, example: -bk_dynamodbstreams-max-timeout-table_name 30000" },
    ],
    jobs: [],
    ttl: 86400*2,
    lockTtl: 30000,
    lockType: "stream",
    periodTimeouts: {},
    maxTimeouts: {},
    shardCache: {},
};
module.exports = mod;

mod.processTable = function(table, options, callback)
{
    aws.ddbProcessStream(table, options, this.syncProcessor, callback);
}

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
            options.shardRetryMaxTimeout = mod.maxTimeouts[options.table] || 0;
            for (var p in mod.periodTimeouts) {
                if (lib.isTimeRange(mod.periodTimeouts[p][0], mod.periodTimeouts[p][1])) {
                    options.shardRetryMaxTimeout = Math.max(p, options.shardRetryMaxTimeout);
                }
            }
            stream.shards = 0;
            aws.ddbProcessStream(stream, options, mod.syncProcessor, () => {
                setTimeout(next, !stream.StreamArn || !stream.shards ? mod.lockTtl : 1000);
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
    ipc.lock(mod.name + ":" + query[key], { ttl: mod.lockTtl, queueName: jobs.uniqueQueue }, (err, locked) => {
        if (locked) {
            query.lockTimer = setInterval(function() {
                ipc.lock(mod.name + ":" + query[key], { ttl: mod.lockTtl, queueName: jobs.uniqueQueue, set: 1 });
            }, mod.lockTtl * 0.9);
        } else {
            delete query.lockTimer;
        }
        callback(err, locked);
    });
}

mod.unlock = function(key, query, options, callback)
{
    if (!query.lockTimer) return callback();
    clearInterval(query.lockTimer);
    delete query.lockTimer;
    ipc.unlock(mod.name + ":" + query[key], { queueName: jobs.uniqueQueue }, callback);
}

mod.syncProcessor = function(cmd, req, options, callback)
{
    logger.debug("syncProcessor:", mod.name, cmd, req);
    switch (cmd) {
    case "running":
        return !mod.exiting && !jobs.exiting && !jobs.isCancelled(mod.name, req.table || options.table);

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

mod.processStreamStart = function(req, options, callback)
{
    lib.series([
        function(next) {
            if (mod.lockType != "stream") return next();
            mod.lock("table", req.Stream, options, (err, locked) => {
                if (!err && !locked) return setTimeout(next, 1000, "not-locked");
                next(err);
            });
        },
    ], callback);
}

mod.processStreamEnd = function(req, options, callback)
{
    lib.series([
        function(next) {
            if (mod.lockType != "stream") return next();
            mod.unlock("table", req.Stream, options, next);
        },
    ], callback);
}

// Get the last processed sequence for the shard
mod.processShardStart = function(req, options, callback)
{
    lib.series([
        function(next) {
            if (mod.shardCache[req.Shard.ShardId]) return next("unknown");
            if (mod.lockType != "shard") return next();
            mod.lock("ShardId", req.Shard, options, (err, locked) => {
                if (!err && !locked) err = "not-locked";
                next(err);
            });
        },
        function(next) {
            db.get("bk_property", { name: req.Shard.ShardId }, options, (err, row) => {
                if (row && row.value && !options.force) {
                    req.Shard.SequenceNumber = row.value;
                    req.Shard.ShardIteratorType = "AFTER_SEQUENCE_NUMBER";
                    logger.debug("processShard:", mod.name, options.table, req.Shard);
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
            mod.unlock("ShardId", req.Shard, options, next);
        },
        function(next) {
            if (!req.Shard.error) {
                req.Stream.shards++;
            } else {
                // Skip unknown or stale shards
                if (req.Shard.error.code == "ResourceNotFoundException" && req.Shard.error.action == "GetShardIterator") {
                    mod.shardCache[req.Shard.ShardId] = Date.now();
                }
            }
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
            logger.info("processRecords:", mod.name, options.table, req.Shard, req.LastSequenceNumber, req.Records.length, "records");
            var bulk = req.Records.map((x) => ({ op: x.eventName == "REMOVE" ? "del" : "put", table: options.table, obj: x.dynamodb.NewImage || x.dynamodb.Keys }));
            db.bulk(bulk, { pool: options.target_pool }, next);
        },
        function(next, errors) {
            for (const i in errors) logger.warn("processRecords:", mod.name, errors[i]);
            if (!req.LastSequenceNumber) return next();
            options.lastShardId = req.Shard.ShardId;
            options.lastSequenceNumber = req.LastSequenceNumber;
            db.put("bk_property", { name: options.lastShardId, value: options.lastSequenceNumber, ttl: lib.now() + mod.ttl }, options, next);
        },
    ], callback);
}

