//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const logger = require(__dirname + '/logger');
const core = require(__dirname + '/core');
const lib = require(__dirname + '/lib');
const aws = require(__dirname + '/aws');

core.describeArgs("aws", [
    { name: "ddb-shard-concurrency", type: "int", min: 1, descr: "DynamoDB Streams number of shards to process in parallel" },
    { name: "ddb-shard-records-count", type: "int", min: 10, descr: "DynamoDB Streams records count in a batch" },
    { name: "ddb-shard-retry-count", type: "int", min: 1, descr: "DynamoDB Streams number of times to read records from an open shard with no records" },
    { name: "ddb-shard-retry-closed-count", type: "int", min: 1, descr: "DynamoDB Streams number of times to read records from a closed shard" },
    { name: "ddb-shard-retry-timeout", type: "int", min: 50, descr: "DynamoDB Streams min timeout in ms between retries on empty records, exponential backoff is used" },
    { name: "ddb-shard-retry-max-timeout", type: "int", min: 50, descr: "DynamoDB Streams max timeout in ms on empty records, once reached the timeout is reset back to the min and exponential backoff starts again" },
]);

aws.ddbShardRecordsCount = 1000;
aws.ddbShardRetryCount = 50;
aws.ddbShardRetryTimeout = 1000;
aws.ddbShardRetryMaxTimeout = 3000;
aws.ddbShardRetryClosedCount = 150;
aws.ddbShardWaitTimeout = 900000;
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
                           query.type || query.ShardIteratorType ||
                           options.shardIteratorType || "TRIM_HORIZON",
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
        logger.debug("ddbstreams:", "ddbGetShardRecords:", err, lib.arrayLength(res.Records), "records", res.NextShardIterator);
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

aws.ddbProcessShardRecords = function(stream, shard, options, processcallback, callback)
{
    lib.everySeries([
        function(next) {
            // Retrieve the last processed sequence to continue
            processcallback("shard-start", { Stream: stream, Shard: shard }, options, next);
        },
        function(next, err) {
            if (err) return next(err);
            if (shard.SequenceNumberRange.EndingSequenceNumber &&
                shard.SequenceNumber >= shard.SequenceNumberRange.EndingSequenceNumber) {
                return next("skip");
            }
            aws.ddbGetShardIterator(shard, options, next);
        },
        function(next, err, it) {
            if (err || !it || !it.ShardIterator) return next(err);
            var retries = lib.toNumber(options && options.shardRetryCount) || aws.ddbShardRetryCount;
            var retriesClosed = lib.toNumber(options && options.shardRetryClosedCount) || aws.ddbShardRetryClosedCount;
            var timeout = lib.toNumber(options && options.shardRetryTimeout) || aws.ddbShardRetryTimeout;
            var maxTimeout = lib.toNumber(options && options.shardRetryMaxTimeout) || aws.ddbShardRetryMaxTimeout;
            shard.retries = 0;
            shard.timeout = timeout;
            lib.doWhilst(
                function(next2) {
                    aws.ddbGetShardRecords(it, options, function(err, res) {
                        // These errors mean we have to close the shard and save the last sequence number, with other errors we have to retry later
                        if (err && !/ResourceNotFoundException|TrimmedDataAccessException/.test(err.code)) return next2(err);
                        res.Records = lib.isArray(res.Records, []);
                        it.ShardIterator = res.NextShardIterator;
                        // Do not continiously poll empty active shards, exit to restart later
                        if (!res.Records.length && it.ShardIterator) {
                            if (!processcallback("running", shard, options)) return next();

                            // For closed shards, after all retries record the sequence so we will skip it next time
                            if (shard.SequenceNumberRange.EndingSequenceNumber) {
                                if (shard.retries++ <= retriesClosed) {
                                    return setTimeout(next2, timeout);
                                }
                                logger.info("ddbProcessShardRecords:", "eof", shard);
                            } else {
                                if (shard.retries++ > retries) return next();
                                // Keep trying active shard with backoff
                                setTimeout(next2, lib.toClamp(shard.timeout, timeout, maxTimeout));
                                if (shard.timeout >= maxTimeout) shard.timeout = timeout; else shard.timeout *= 2;
                                return;
                            }
                        }
                        shard.retries = 0;
                        shard.timeout = timeout;
                        // Pass shard and sequence to the callback
                        res.Stream = stream;
                        res.Shard = shard;
                        res.LastSequenceNumber = res.Records.length ? res.Records[res.Records.length - 1].dynamodb.SequenceNumber :
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
        function(next, err) {
            shard.error = err;
            processcallback("shard-end", { Stream: stream, Shard: shard }, options, next);
        },
    ], callback);
}

function _prepareShards(info, stream, options, processcallback)
{
    var shards = { list: [], map: {}, deps: {}, running: [] };

    info.Shards.forEach((x) => {
        // Exclude already processed shards
        if (!processcallback("shard-check", x, options)) return;
        x.StreamArn = stream.StreamArn;
        shards.map[x.ShardId] = x;
        if (x.ParentShardId && !shards.map[x.ParentShardId]) {
            shards.map[x.ParentShardId] = { ShardId: x.ParentShardId, StreamArn: x.StreamArn, SequenceNumberRange: {} };
        }
    });
    shards.list = Object.keys(shards.map).sort();
    // For each shard keep all dependencies including parent's dependencies in one list for fast checks
    function deps(s, p) {
        if (!shards.map[p].ParentShardId) return;
        shards.deps[s] = lib.toFlags("add", shards.deps[s], shards.map[p].ParentShardId);
        deps(s, shards.map[p].ParentShardId);
    }
    for (const p in shards.map) deps(p, p);
    return shards;
}

function _processShards(shards, stream, options, processcallback, callback)
{
    var opts = {
        max: options && options.concurrency || aws.ddbShardConcurrency,
        interval: aws.ddbShardRetryTimeout,
        timeout: aws.ddbShardWaitTimeout,
    };
    lib.forEachItem(opts,
        function(next) {
            if (!shards.list.length || !processcallback("running", stream, options)) return next(null);
            // Return next available shard which has no parents in the list and none of the parents are running
            for (var i = 0; i < shards.list.length; i++) {
                var sid = shards.list[i];
                if (!lib.isFlag(shards.running, shards.deps[sid]) && !lib.isFlag(shards.list, shards.deps[sid])) {
                    shards.list.splice(i, 1);
                    return next(shards.map[sid]);
                }
            }
            next();
        },
        function(shard, next) {
            shards.running.push(shard.ShardId);
            aws.ddbProcessShardRecords(stream, shard, options, processcallback, () => {
                lib.arrayRemove(shards.running, shard.ShardId);
                next();
            });
        }, callback);
}

aws.ddbProcessStreamShards = function(stream, options, processcallback, callback)
{
    lib.everySeries([
        function(next) {
            processcallback("stream-start", { Stream: stream }, options, next);
        },
        function(next, err) {
            if (err) return next(err);
            aws.ddbDescribeStream(stream, options, next);
        },
        function(next, err, shards) {
            if (err) return next(err);
            shards = _prepareShards(shards, stream, options, processcallback);
            logger.info("ddbProcessStreamShards:", stream, shards.list.length, "shards");
            _processShards(shards, stream, options, processcallback, (err) => {
                logger.logger(err || shards.list.length ?"error" : "debug", "ddbProcessStreamShards:", err, stream, shards);
                next();
            });
        },
        function(next, err) {
            stream.error = err;
            processcallback("stream-end", { Stream: stream }, options, next);
        },
    ], callback);
}

aws.ddbProcessStream = function(stream, options, processcallback, callback)
{
    lib.series([
        function(next) {
            if (typeof stream == "string") stream = { table: stream };
            processcallback("stream-prepare", { Stream: stream }, options, next);
        },
        function(next) {
            if (stream.StreamArn) return next();
            aws.ddbListStreams(stream, options, (err, res) => {
                if (!err) {
                    lib.objExtend(stream, res.Streams[0]);
                }
                next(err);
            });
        },
        function(next) {
            if (!stream.StreamArn) return next();
            aws.ddbProcessStreamShards(stream, options, processcallback, next);
        },
    ], callback);
}


