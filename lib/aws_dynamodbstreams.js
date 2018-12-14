//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const logger = require(__dirname + '/logger');
const lib = require(__dirname + '/lib');
const aws = require(__dirname + '/aws');

aws.ddbShardRecordsCount = 250;

aws.queryDDBStreams = function(action, obj, options, callback)
{
    this._queryDDB("DynamoDBStreams_20120810", "streams.dynamodb", action, obj, options, callback);
}

aws.ddbListStreams = function(query, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    var q = {
        ExclusiveStartStreamArn: query.streamArn || query.StreamArn,
        TableName: query.table || query.TableName,
        Limit: query.limit || query.Limit || (options && options.count),
    };
    var rc = { Streams: [] }
    lib.doWhilst(
        function(next) {
            aws.queryDDBStreams('ListStreams', q, options, function(err, res) {
                logger.debug("ddbstreams:", "ddbListStreams:", err, res);
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
                logger.debug("ddbstreams:", "ddbDescribeStream:", err, res);
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
                           query.type || query.ShardIteratorType,
        SequenceNumber: query.sequence || query.SequenceNumber,
    };
    aws.queryDDBStreams('GetShardIterator', q, options, function(err, res) {
        logger.debug("ddbstreams:", "ddbGetShardIterator:", err, res);
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
        logger.debug("ddbstreams:", "ddbGetRecords:", err, lib.arrayLength(res.Records), "records");
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

aws.ddbProcessShardRecords = function(query, options, processcallback, callback)
{
    lib.series([
        function(next) {
            // Retrieve the last processed sequence to continue, it must set the iterator type
            processcallback("shard", query, options, next);
        },
        function(next) {
            aws.ddbGetShardIterator(query, options, next);
        },
        function(next, it) {
            lib.doWhilst(
                function(next) {
                    aws.ddbGetShardRecords(it, options, function(err, res) {
                        if (err) return next(err);
                        it.ShardIterator = res.NextShardIterator;
                        if (!res.Records.length) return next();
                        // Pass shard and sequence to the callback and keep track how many have been processed
                        res.ShardId = query.ShardId;
                        res.LastSequenceNumber = res.Records[res.Records.length - 1].dynamodb.SequenceNumber;
                        lib.objIncr(query, "_count", res.Records.length);
                        query._sequence = res.LastSequenceNumber;
                        // Process records and save last sequence if necessary
                        processcallback("records", res, options, next);
                    });
                },
                function() {
                    return it.ShardIterator;
                },
                (err) => {
                    logger.info("ddbProcessShardRecords:", err, query);
                    next(err);
                });
        },
    ], callback);
}

aws.ddbProcessStreamShards = function(query, options, processcallback, callback)
{
    lib.series([
        function(next) {
            aws.ddbDescribeStream(query, options, next);
        },
        function(next, stream) {
            var shards = stream.Shards.reduce((x, y) => (lib.toFlags("add", x, y.ParentShardId)), []).
                         concat(stream.Shards.map((x) => (x.ShardId)));
            logger.info("ddbProcessStreamShards:", shards);
            shards = shards.map((x) => ({ ShardId: x, StreamArn: stream.StreamArn }));
            lib.forEachLimit(shards, options.concurrency, (shard, next) => {
                aws.ddbProcessShardRecords(shard, options, processcallback, () => { next() });
            }, next);
        },
    ], callback);
}

aws.ddbProcessStream = function(table, options, processcallback, callback)
{
    var stream;
    lib.series([
        function(next) {
            aws.ddbListStreams({ table: table }, options, (err, res) => {
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


