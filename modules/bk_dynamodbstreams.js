//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const util = require('util');
const core = require(__dirname + '/../lib/core');
const lib = require(__dirname + '/../lib/lib');
const logger = require(__dirname + '/../lib/logger');
const db = require(__dirname + '/../lib/db');
const aws = require(__dirname + '/../lib/aws');

const mod = {

};
module.exports = mod;

mod.processTable = function(options, callback)
{
    if (!options.table || !options.pool || !options.target_pool) {
        return lib.tryCall(callback, "table, pool and target_pool must be provided");
    }
    options = lib.objClone(options);
    db.getPool(options.pool).prepareOptions(options);
    aws.ddbProcessStream(options.table, options, mod.syncProcessor, callback);
}

mod.syncProcessor = function(cmd, query, options, callback)
{
    switch (cmd) {
    case "stream":
        mod.processStream(query, options, callback);
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
    db.get("bk_property", { name: stream.StreamArn }, options, (err, row) => {
        if (row) {
            stream.ShardId = row.value;
        }
        callback(err);
    });
}

// Get the last processed sequence for the shard
mod.processShard = function(shard, options, callback)
{
    lib.series([
        function(next) {
            db.put("bk_property", { name: shard.StreamArn, value: shard.ShardId, ttl: Date.now() + 86400 }, options, next);
        },
        function(next) {
            db.get("bk_property", { name: shard.ShardId }, options, (err, row) => {
                if (row) {
                    shard.SequenceNumber = row.value;
                }
                shard.ShardIteratorType = shard.SequenceNumber ? "AFTER_SEQUENCE_NUMBER" : "TRIM_HORIZON";
                next(err);
            });
        },
    ], callback);
}

mod.processRecords = function(result, options, callback)
{
    lib.series([
        function(next) {
            var bulk = result.Records.map((x) => ({ op: x.eventName == "REMOVE" ? "del" : "put", obj: x.dynamodb.NewImage || x.dynamodb.Keys }));
            db.bulk(bulk, { pool: options.target_pool }, next);
        },
        function(next) {
            var seq = result.Records[result.Records.length - 1].dynamodb.SequenceNumber;
            db.put("bk_property", { name: result.ShardId, value: seq, ttl: Date.now() + 86400 }, options, next);
        },
    ], callback);
}

