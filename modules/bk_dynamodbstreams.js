//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const logger = require(__dirname + '/../lib/logger');
const lib = require(__dirname + '/../lib/lib');
const db = require(__dirname + '/../lib/db');
const aws = require(__dirname + '/../lib/aws');

const mod = {
    ttl: 86400*2,
};
module.exports = mod;

mod.processTable = function(options, callback)
{
    lib.series([
        function(next) {
            if (!options.table || !options.source_pool || !options.target_pool) {
                return next("table, source_pool and target_pool must be provided");
            }
            var started = Date.now();
            options = lib.objClone(options);
            db.getPool(options.source_pool).prepareOptions(options);
            aws.ddbProcessStream(options.table, options, mod.syncProcessor, (err) => {
                options.elapsed = Date.now() - started;
                logger.info("processTable:", mod.name, err, options);
                next(err);
            });
        },
    ], callback);
}

mod.syncProcessor = function(cmd, query, options, callback)
{
    switch (cmd) {
    case "stream":
        mod.processStream(query, options, callback);
        break;

    case "shards":
        mod.processShards(query, options, callback);
        break;

    case "shard":
        mod.processShard(query, options, callback);
        break;

    case "records":
        mod.processRecords(query, options, callback);
        break;
    }
}

// Get the last processed shard for the stream
mod.processStream = function(stream, options, callback)
{
    lib.series([
        function(next) {
            if (options.force) return next();
            db.get("bk_property", { name: stream.StreamArn }, options, (err, row) => {
                if (row && row.value) {
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
            if (options.force) return next();
            db.get("bk_property", { name: shard.ShardId }, options, (err, row) => {
                if (row && row.value) {
                    shard.SequenceNumber = row.value;
                    shard.ShardIteratorType = "AFTER_SEQUENCE_NUMBER";
                    logger.info("processShard:", mod.name, options.table, shard);
                }
                next(err);
            });
        },
    ], callback);
}

// Commit a batch of shards processed
mod.processShards = function(stream, options, callback)
{
    lib.series([
        function(next) {
            logger.info("processShards:", mod.name, options.table, stream.lastShardId, stream.shards.length);
            db.put("bk_property", { name: stream.StreamArn, value: stream.lastShardId, ttl: lib.now() + mod.ttl }, options, next);
        },
    ], callback);
}

// Commit a batch of shard records processed
mod.processRecords = function(result, options, callback)
{
    lib.series([
        function(next) {
            logger.info("processRecords:", mod.name, options.table, result.Shard, result.Records.length);
            var bulk = result.Records.map((x) => ({ op: x.eventName == "REMOVE" ? "del" : "put", obj: x.dynamodb.NewImage || x.dynamodb.Keys }));
            db.bulk(bulk, { pool: options.target_pool }, next);
        },
        function(next) {
            options.lastShardId = result.Shard.ShardId;
            options.lastSequenceNumber = result.LastSequenceNumber;
            db.put("bk_property", { name: options.lastShardId, value: options.lastSequenceNumber, ttl: lib.now() + mod.ttl }, options, next);
        },
    ], callback);
}

