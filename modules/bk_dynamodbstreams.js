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
        { name: "tables", type: "list", descr: "Process streams for given tables in a worker process" },
        { name: "source-pool", descr: "DynamoDB pool for streams processing" },
        { name: "target-pool", descr: "A database pool where to sync streams" },
    ],
    running: [],
    ttl: 86400*2,
    lockTtl: 30000,
};
module.exports = mod;

mod.processTable = function(table, options, callback)
{
    aws.ddbProcessStream(table, options, this.syncProcessor, callback);
}

mod.configureWorker = function(options, callback)
{
    for (const i in this.tables) {
        this.runJob({ table: this.tables[i], source_pool: this.source_pool, target_pool: this.target_pool, job: true }, (err, rc) => {
            logger.logger(err ? "error": "info", "processTable:", mod.name, rc);
        });
    }
    callback();
}

mod.shutdownWorker = function(options, callback)
{
    this.exiting = 1;
    var timer = setInterval(function() {
        if (mod.running.length > 0 && mod.exiting++ < 10) return;
        clearInterval(timer);
        callback();
    }, this.running.length ? 500 : 0);
}

mod.runJob = function(options, callback)
{
    if (!options.table || !options.source_pool || !options.target_pool) {
        return lib.tryCall(callback, "table, source_pool and target_pool must be provided", options);
    }
    options = lib.objClone(options, "logger_error", { ResourceNotFoundException: "debug" });
    db.getPool(options.source_pool).prepareOptions(options);

    var stream = { table: options.table };
    lib.doWhilst(
        function(next) {
            mod.jobProcessor(stream, options, next);
        },
        function() {
            return mod.syncProcessor("running", stream, options);
        },
        callback);
}

mod.jobProcessor = function(stream, options, callback)
{
    var timer;
    lib.everySeries([
        function(next) {
            mod.running.push(options.table);
            ipc.lock(mod.name + ":" + stream.table, { ttl: mod.lockTtl, queueName: jobs.uniqueQueue }, next);
        },
        function(next, err, locked) {
            if (!locked) return next();
            timer = setInterval(function() {
                ipc.lock(mod.name + ":" + stream.table, { ttl: mod.lockTtl, queueName: jobs.uniqueQueue, set: 1 });
            }, mod.lockTtl * 0.9);
            next();
        },
        function(next) {
            if (!timer) return next();
            aws.ddbProcessStream(stream, options, mod.syncProcessor, next);
        },
        function(next) {
            if (!timer) return next();
            clearInterval(timer);
            ipc.unlock(mod.name + ":" + stream.table, { queueName: jobs.uniqueQueue }, next);
        },
        function(next) {
            lib.arrayRemove(mod.running, options.table);
            setTimeout(next, !stream.StreamArn || !timer ? mod.lockTtl : 1000);
        },
    ], callback);
}

mod.syncProcessor = function(cmd, query, options, callback)
{
    switch (cmd) {
    case "running":
        return !this.exiting && !jobs.exiting && !jobs.isCancelled(mod.name, query.table);

    case "stream":
        return mod.processStream(query, options, callback);

    case "shard":
        return mod.processShard(query, options, callback);

    case "records":
        return mod.processRecords(query, options, callback);
    }
}

// Get the last processed shard for the stream
mod.processStream = function(stream, options, callback)
{
    lib.series([
        function(next) {
            db.get("bk_property", { name: stream.StreamArn }, options, (err, row) => {
                if (row && row.value && !options.force) {
                    stream.ShardId = row.value;
                    logger.info("processStream:", mod.name, options.table, stream);
                }
                next(err);
            });
        },
    ], callback);
}

// Get the last processed sequence for the shard
mod.processShard = function(shard, options, callback)
{
    lib.series([
        function(next) {
            db.get("bk_property", { name: shard.ShardId }, options, (err, row) => {
                if (row && row.value && !options.force) {
                    shard.SequenceNumber = row.value;
                    shard.ShardIteratorType = "AFTER_SEQUENCE_NUMBER";
                    logger.info("processShard:", mod.name, options.table, shard);
                }
                next(err);
            });
        },
    ], callback);
}

// Commit a batch of shard records processed
mod.processRecords = function(result, options, callback)
{
    lib.series([
        function(next) {
            logger.info("processRecords:", mod.name, options.table, result.Shard, result.LastSequenceNumber, result.Records.length, "records");
            var bulk = result.Records.map((x) => ({ op: x.eventName == "REMOVE" ? "del" : "put", table: options.table, obj: x.dynamodb.NewImage || x.dynamodb.Keys }));
            db.bulk(bulk, { pool: options.target_pool }, next);
        },
        function(next) {
            options.lastShardId = result.Shard.ShardId;
            options.lastSequenceNumber = result.LastSequenceNumber;
            db.put("bk_property", { name: options.lastShardId, value: options.lastSequenceNumber, ttl: lib.now() + mod.ttl }, options, next);
        },
    ], callback);
}

