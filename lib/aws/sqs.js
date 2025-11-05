/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const lib = require(__dirname + '/../lib');
const aws = require(__dirname + '/../aws');

// AWS SQS API request
aws.querySQS = function(action, obj, options, callback)
{
    this.queryEndpoint("sqs", '2012-11-05', action, obj, options, callback);
}

/**
 * Receive message(s) from the SQS queue, the callback will receive a list with messages if no error.
 * The following options can be specified:
 *  - count - how many messages to receive
 *  - timeout - how long to wait, in milliseconds, this is for Long Poll
 *  - visibilityTimeout - the duration (in milliseconds) that the received messages are hidden from subsequent retrieve requests
 *  - attempt - request attempt id for FIFO queues
 *  after being retrieved by a ReceiveMessage request.
 */
aws.sqsReceiveMessage = function(url, options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    var params = { QueueUrl: url };
    if (options) {
        if (options.count) params.MaxNumberOfMessages = options.count;
        if (options.visibilityTimeout > 999) params.VisibilityTimeout = Math.round(options.visibilityTimeout/1000);
        if (options.timeout > 999) params.WaitTimeSeconds = Math.round(options.timeout/1000);
        if (options.attempt) params.ReceiveRequestAttemptId = options.attempt;
    }
    this.querySQS("ReceiveMessage", params, options, function(err, obj) {
        var rows = [];
        if (!err) rows = lib.objGet(obj, "ReceiveMessageResponse.ReceiveMessageResult.Message", { list: 1 });
        if (typeof callback == "function") callback(err, rows);
    });
}

/**
 * Send a message to the SQS queue.
 * The options can specify the following:
 *  - delay - how long to delay this message in milliseconds
 *  - group - a group id for FIFO queues
 *  - unique - deduplication id for FIFO queues
 *  - attrs - an object with additional message attributes to send, use only string, numbers or binary values,
 *  all other types will be converted into strings
 */
aws.sqsSendMessage = function(url, body, options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    var params = { QueueUrl: url, MessageBody: body };
    if (options) {
        if (options.delay > 999) params.DelaySeconds = Math.round(options.delay/1000);
        if (options.group) params.MessageGroupId = options.group;
        if (options.unique) params.MessageDeduplicationId = options.unique;
        if (options.attrs) {
            var n = 1;
            for (var p in options.attrs) {
                var type = typeof options.attrs[p] == "number" ? "Number" : typeof options.attrs[p] == "string" ? "String" : "Binary";
                params["MessageAttribute." + n + ".Name"] = p;
                params["MessageAttribute." + n + ".Value." + type + "Value"] = options.attrs[p];
                params["MessageAttribute." + n + ".Value.DataType"] = type;
                n++;
            }
        }
    }
    this.querySQS("SendMessage", params, options, function(err, obj) {
        var rows = [];
        if (!err) rows = lib.objGet(obj, "ReceiveMessageResponse.ReceiveMessageResult.Message", { list: 1 });
        if (typeof callback == "function") callback(err, rows);
    });
}
