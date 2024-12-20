//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const logger = require(__dirname + '/../logger');
const lib = require(__dirname + '/../lib');
const aws = require(__dirname + '/../aws');

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
        Limit: query.limit || query.Limit || (options && options.count) || 100,
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
        ExclusiveStartShardId: query.shardId || query.ShardId || query.ExclusiveStartShardId,
        Limit: query.limit || query.Limit || (options && options.count) || 100,
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
        Limit: query.limit || query.Limit || (options && options.count) || 1000,
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

