/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
'use strict';

const lib = require(__dirname + '/../lib');
const aws = require(__dirname + '/../aws');

/**
 * AWS SQS (Simple Queue Service) API request.
 * @memberOf module:aws
 * @method querySQS
 * @param {string} action - SQS API action, e.g. `SendMessage`, `ReceiveMessage`
 * @param {object} obj - API-specific request parameters
 * @param {object} [options] - request options passed to {@link module:aws.queryEndpoint}
 * @param {function} callback - `(err, data, request)`
 */
aws.querySQS = function(action, obj, options, callback)
{
    aws.queryService({ endpoint: "sqs", target: "AmazonSQS", action, json: "1.0" }, obj, options, callback);
}

/**
 * AWS SQS API request, async version of {@link module:aws.querySQS}.
 * @memberOf module:aws
 * @method aquerySQS
 * @async
 * @param {string} action - SQS API action
 * @param {object} obj - API-specific request parameters
 * @param {object} [options] - request options
 * @returns {Promise<object>} - `{ err, data, request }`
 */
aws.aquerySQS = function(action, obj, options)
{
    return aws.aqueryService({ endpoint: "sqs", target: "AmazonSQS", action }, obj, options);
}

/**
 * Receive message(s) from an SQS queue, the callback will receive a list of messages if no error.
 * @param {string} url - queue URL
 * @param {object} [options]
 * @param {number} [options.count] - how many messages to receive
 * @param {number} [options.timeout] - how long to wait, in milliseconds, this is for Long Poll
 * @param {number} [options.visibilityTimeout] - the duration (in milliseconds) that the received messages are hidden from subsequent retrieve requests
 * @param {string} [options.attemptId] - request attempt id for FIFO queues after being retrieved by a ReceiveMessage request.
 * @param {function} [callback] as (err, rows) with received items
 * @memberOf module:aws
 * @method sqsReceiveMessage
 */
aws.sqsReceiveMessage = function(url, options, callback)
{
    if (typeof options === "function") callback = options, options = null;

    const params = { QueueUrl: url };
    if (options) {
        if (options.count) params.MaxNumberOfMessages = lib.toNumber(options.count, { min: 0, max: 10 });
        if (options.visibilityTimeout > 999) params.VisibilityTimeout = Math.round(options.visibilityTimeout/1000);
        if (options.timeout > 999) params.WaitTimeSeconds = Math.round(options.timeout/1000);
        if (options.attemptId) params.ReceiveRequestAttemptId = options.attemptId;
    }
    aws.querySQS("ReceiveMessage", params, options, (err, obj) => {
        if (typeof callback === "function") {
            callback(err, lib.isArray(obj?.Messages, []));
        }
    });
}

function _setParams(params, options)
{
    if (options) {
        if (options.delay > 999) params.DelaySeconds = Math.round(options.delay/1000);
        if (options.groupId) params.MessageGroupId = options.groupName;
        if (options.deduplicationId) params.MessageDeduplicationId = options.deduplicationId;
        if (options.attrs) {
            params.MessageAttributes = {};
            for (const p in options.attrs) {
                const type = typeof options.attrs[p] === "number" ? "Number" :
                             typeof options.attrs[p] === "string" ? "String" : "Binary";
                params.MessageAttributes[p] = {
                    [type + "Value"]: options.attrs[p],
                    DataType: type,
                }
            }
        }
    }
    return params;
}

/**
 * Send a message to the SQS queue.
 * The options can specify the following:
 * @param {string} url - queue URL
 * @param {string} body - body contents
 * @param {object} [options]
 * @param {number} [options.delay] - how long to delay this message in milliseconds
 * @param {string} [options.groupId] - a group name for FIFO queues
 * @param {string} [options.deduplicationId] - deduplication id for FIFO queues
 * @param {object} [options.attrs] - an object with additional message attributes to send, use only string, numbers or binary values,
 *  all other types will be converted into strings
 * @param {function} [callback]
 * @memberOf module:aws
 * @method sqsSendMessage
 */
aws.sqsSendMessage = function(url, body, options, callback)
{
    if (typeof options === "function") callback = options, options = null;

    const params = _setParams({ QueueUrl: url, MessageBody: body }, options);

    aws.querySQS("SendMessage", params, options, callback);
}

/**
 * Send a batch of messages to the SQS queue.
 * The options can specify the following:
 * @param {string} url - queue URL
 * @param {object[]} messages - messages to send
 * @param {object} messages.body - bodsy contents
 * @param {number} [messages.delay] - how long to delay this message in milliseconds
 * @param {string} [messages.groupId] - a group name for FIFO queues
 * @param {string} [messages.deduplicationId] - deduplication id for FIFO queues
 * @param {object} [messages.attrs] - an object with additional message attributes to send, use only string, numbers or binary values,
 *  all other types will be converted into strings
 * @param {function} [callback]
 * @memberOf module:aws
 * @method sqsSendMessageBatch
 */
aws.sqsSendMessageBatch = function(url, messages, options, callback)
{
    if (typeof options === "function") callback = options, options = null;

    const params = { QueueUrl: url, Entries: [] };

    for (const msg of lib.isAray(messages, [])) {
        if (!msg?.body) continue;
        params.Entries.push(_setParams({ MessageBody: msg.body }, msg));
    }
    if (!params.Entries.length) return lib.tryCall(callback);

    this.querySQS("SendMessageBatch", params, options, callback);
}
