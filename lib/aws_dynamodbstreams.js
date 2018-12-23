//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const logger = require(__dirname + '/logger');
const lib = require(__dirname + '/lib');
const aws = require(__dirname + '/aws');

aws.ddbShardRecordsCount = 250;
aws.ddbShardRecordsRetries = 25;
aws.ddbShardRecordsInterval = 50;
aws.ddbShardRecordsTimeout = 3000;
aws.ddbShardConcurrency = 3;

aws.queryDDBStreams = function(action, obj, options, callback)
{
    this._queryDDB("DynamoDBStreams_20120810", "streams.dynamodb", action, obj, options, callback);
}

aws.ddbListStreams = function(query, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (typeof query == "string") query = { table: query };
    var q = {
        ExclusiveStartStreamArn: query.streamArn || query.StreamArn,
        TableName: query.table || query.TableName,
        Limit: query.limit || query.Limit || (options && options.count),
    };
    var rc = { Streams: [] }
    lib.doWhilst(
        function(next) {
            aws.queryDDBStreams('ListStreams', q, options, function(err, res) {
                logger.debug("ddbstreams:", "ddbListStreams:", err, query, res);
                if (!err) {
                    q.ExclusiveStartStreamArn = res.LastEvaluatedStreamArn;
                    rc.Streams.push.apply(rc.Streams, res.Streams);
                }
                next(err);
            });
    },
    function() {
        return q.ExclusiveStartStreamArn;
    },
    function(err) {
        if (typeof callback == "function") callback(err, rc);
    });
}

aws.ddbDescribeStream = function(query, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (typeof query == "string") query = { streamArn: query };
    var q = {
        StreamArn: query.streamArn || query.StreamArn,
        ExclusiveStartShardId: query.shardId || query.ShardId,
        Limit: query.limit || query.Limit || (options && options.count),
    };
    var rc = { Shards: [] };
    lib.doWhilst(
        function(next) {
            aws.queryDDBStreams('DescribeStream', q, options, function(err, res) {
                logger.debug("ddbstreams:", "ddbDescribeStream:", err, query, res);
                if (!err) {
                    q.ExclusiveStartShardId = res.StreamDescription.LastEvaluatedShardId;
                    for (const p in res.StreamDescription) if (!rc[p]) rc[p] = res.StreamDescription[p];
                    rc.Shards.push.apply(rc.Shards, res.StreamDescription.Shards);
                }
                next(err);
            });
    },
    function() {
        return q.ExclusiveStartShardId;
    },
    function(err) {
        if (typeof callback == "function") callback(err, rc);
    });
}

aws.ddbGetShardIterator = function(query, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    var q = {
        StreamArn: query.streamArn || query.StreamArn,
        ShardId: query.shardId || query.ShardId,
        ShardIteratorType: query.latest ? "LATEST" :
                           query.oldest ? "TRIM_HORIZON" :
                           query.at ? "AT_SEQUENCE_NUMBER" :
                           query.after ? "AFTER_SEQUENCE_NUMBER" :
                           query.type || query.ShardIteratorType || "TRIM_HORIZON",
        SequenceNumber: query.sequence || query.SequenceNumber,
    };
    aws.queryDDBStreams('GetShardIterator', q, options, function(err, res) {
        logger.debug("ddbstreams:", "ddbGetShardIterator:", err, query, res);
        if (typeof callback == "function") callback(err, res);
    });
}

aws.ddbGetShardRecords = function(query, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    var q = {
        ShardIterator: query.shardIterator || query.ShardIterator || query.NextShardIterator,
        Limit: query.limit || query.Limit || (options && options.count) || this.ddbShardRecordsCount,
    };
    aws.queryDDBStreams('GetRecords', q, options, function(err, res) {
        logger.debug("ddbstreams:", "ddbGetRecords:", err, lib.arrayLength(res.Records), "records", res.NextShardIterator);
        if (!err) {
            for (var i in res.Records) {
                if (res.Records[i].dynamodb.Keys) res.Records[i].dynamodb.Keys = aws.fromDynamoDB(res.Records[i].dynamodb.Keys);
                if (res.Records[i].dynamodb.OldImage) res.Records[i].dynamodb.OldImage = aws.fromDynamoDB(res.Records[i].dynamodb.OldImage);
                if (res.Records[i].dynamodb.NewImage) res.Records[i].dynamodb.NewImage = aws.fromDynamoDB(res.Records[i].dynamodb.NewImage);
            }
        }
        if (typeof callback == "function") callback(err, res);
    });
}

aws.ddbProcessShardRecords = function(shard, options, processcallback, callback)
{
    lib.series([
        function(next) {
            // Retrieve the last processed sequence to continue
            processcallback("shard", shard, options, next);
        },
        function(next) {
            if (shard.SequenceNumberRange.EndingSequenceNumber &&
                shard.SequenceNumber >= shard.SequenceNumberRange.EndingSequenceNumber) {
                return next();
            }
            aws.ddbGetShardIterator(shard, options, (err, res) => {
                if (err && err.code == "ResourceNotFoundException") err = null;
                next(err, res);
            });
        },
        function(next, it) {
            if (!it || !it.ShardIterator) return next();
            var retries = (options && options.retries) || aws.ddbShardRecordsRetries;
            var interval = (options && options.interval) || aws.ddbShardRecordsInterval;
            var timeout = (options && options.timeout) || aws.ddbShardRecordsTimeout;
            var empty = 0;
            lib.doWhilst(
                function(next2) {
                    aws.ddbGetShardRecords(it, options, function(err, res) {
                        if (err) return next2(err);
                        it.ShardIterator = res.NextShardIterator;
                        if (!res.Records.length && it.ShardIterator) {
                            // Do not continiously poll empty active shards, exit to restart later
                            if (!processcallback("running", shard, options)) return next();
                            if (!shard.SequenceNumberRange.EndingSequenceNumber && retries > 0 && empty > retries) return next();
                            return setTimeout(next2, (empty++ * interval) % timeout);
                        }
                        empty = 0;
                        // Pass shard and sequence to the callback
                        res.Shard = shard;
                        res.LastSequenceNumber = lib.arrayLength(res.Records) ? res.Records[res.Records.length - 1].dynamodb.SequenceNumber :
                                                 shard.SequenceNumberRange.EndingSequenceNumber || null;
                        // Process records and save last sequence if necessary
                        processcallback("records", res, options, next2);
                    });
                },
                function() {
                    return it.ShardIterator && processcallback("running", shard, options);
                },
                next);
        },
    ], callback);
}

aws.ddbProcessStreamShards = function(stream, options, processcallback, callback)
{
    lib.series([
        function(next) {
            aws.ddbDescribeStream(stream, options, next);
        },
        function(next, info) {
            var concurrency = (options && options.concurrency) || aws.ddbShardConcurrency;
            var pids = [], sids = [], obj = {};
            info.Shards.forEach((x, y) => {
                if (pids.indexOf(x.ParentShardId) == -1) pids.push(x.ParentShardId);
                sids.push(x.ShardId);
                obj[x.ShardId] = x;
                x.StreamArn = stream.StreamArn;
            });
            var shards = pids.sort().concat(sids).map((x) => (obj[x] || { ShardId: x, StreamArn: stream.StreamArn, SequenceNumberRange: {} }));
            lib.forEachLimit(shards, concurrency, (shard, next2) => {
                if (!processcallback("running", stream, options)) return next();
                aws.ddbProcessShardRecords(shard, options, processcallback, next2);
            }, next);
        },
    ], callback);
}

aws.ddbProcessStream = function(table, options, processcallback, callback)
{
    var stream;
    lib.series([
        function(next) {
            aws.ddbListStreams(table, options, (err, res) => {
                stream = res.Streams[0];
                next(err);
            });
        },
        function(next) {
            if (!stream) return next();
            // Retrieve last processed shard(s)
            processcallback("stream", stream, options, next);
        },
        function(next) {
            if (!stream) return next();
            aws.ddbProcessStreamShards(stream, options, processcallback, next);
        },
    ], callback);
}


