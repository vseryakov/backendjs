/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const lib = require(__dirname + '/../lib');
const aws = require(__dirname + '/../aws');

/**
 * AWS SQS API request
 * @memberOf module:aws
 * @method querySQS
 */
aws.querySQS = function(action, obj, options, callback)
{
    this.queryEndpoint("sqs", '2012-11-05', action, obj, options, callback);
}

/**
 * Receive message(s) from the SQS queue, the callback will receive a list with messages if no error.
 * @param {string} url - queue URL
 * @param {string} body - body contens
 * @param {object} [options]
 * @param {number} [options.count] - how many messages to receive
 * @param {number} [options.timeout] - how long to wait, in milliseconds, this is for Long Poll
 * @param {number} [options.visibilityTimeout] - the duration (in milliseconds) that the received messages are hidden from subsequent retrieve requests
 * @param {string} [options.attempt] - request attempt id for FIFO queues after being retrieved by a ReceiveMessage request.
 * @param {function} [callback] as (err, rows) with received items
 * @memberOf module:aws
 * @method sqsReceiveMessage
 */
aws.sqsReceiveMessage = function(url, options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    var params = { QueueUrl: url };
    if (options) {
        if (options.count) params.MaxNumberOfMessages = lib.toNumber(options.count, { min: 0, max: 10 });
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
 * @param {string} url - queue URL
 * @param {string} body - body contens
 * @param {object} [options]
 * @param {number} [options.delay] - how long to delay this message in milliseconds
 * @param {string} [options.groupName] - a group name for FIFO queues
 * @param {string} [options.dedupId] - deduplication id for FIFO queues
 * @param {object} [options.attrs] - an object with additional message attributes to send, use only string, numbers or binary values,
 *  all other types will be converted into strings
 * @param {function} [callback]
 * @memberOf module:aws
 * @method sqsSendMessage
 */
aws.sqsSendMessage = function(url, body, options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    var params = { QueueUrl: url, MessageBody: body };
    if (options) {
        if (options.delay > 999) params.DelaySeconds = Math.round(options.delay/1000);
        if (options.groupName) params.MessageGroupId = options.groupNme;
        if (options.dedupId) params.MessageDeduplicationId = options.dedupId;
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
