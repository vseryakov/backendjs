/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const logger = require(__dirname + '/../logger');
const lib = require(__dirname + '/../lib');
const aws = require(__dirname + '/../aws');
const QueueClient = require(__dirname + "/client");

/**
 * Queue client using AWS SQS, full queue url can be used or just the name as sqs://queuename
 *
 * @param {int} [options.timeout] property defines how long to wait for new messages, i.e. the long poll, in milliseconds
 *
 * @param {int} [options.retryCount] and `retryTimeout` define how many times to retry failed AWS HTTP requests, default is 5 times starting
 *  with the backoff starting at 500 milliseconds.
 *
 * @example
 *
 * queue-messages=sqs://messages?bk-interval=60000
 * queue-messages=sqs://sqs.us-east-1.amazonaws.com/123456/messages?bk-visibilityTimeout=300&bk-count=2
 *
 * @memberOf module:queue
 */

class SQSQueueClient extends QueueClient {

    constructor(options) {
        super(options);
        this.name = "sqs";
        this.applyOptions();

        if (!/amazonaws.com/.test(this.url)) {
            this.url = "";
            aws.querySQS("GetQueueUrl", { QueueName: this.hostname }, this.options, (err, data) => {
                if (err) return;
                this.url = data?.GetQueueUrlResponse?.GetQueueUrlResult?.QueueUrl;
                this.emit("ready");
            });
        } else {
            this.url = "https" + this.url.substr(3);
            this.emit("ready");
        }
        // Retrieve and apply SQS queue attributes
        if (!this.options.visibilityTimeout && this.options.sqs) {
            this.stats({}, (err, rc) => {
                if (err) return;
                this.options.visibilityTimeout = lib.toNumber(rc.VisibilityTimeout) * 1000;
            })
        }
    }

    applyOptions(options) {
        super.applyOptions(options);
        this.options.timeout = lib.toNumber(this.options.timeout, { dflt: 20000, min: 0 });
        this.options.retryCount = lib.toNumber(this.options.retryCount, { dflt: 5, min: 0 });
        this.options.retryTimeout = lib.toNumber(this.options.retryTimeout, { dflt: 250, min: 0 });
        this.options.retryOnError = lib.toBool(this.options.retryOnError, { dflt: 1 });
    }

    stats(options, callback) {
        aws.querySQS("GetQueueAttributes", { QueueUrl: this.url, 'AttributeName.1': "All" }, this.options, (err, rc) => {
            if (!err) {
                rc = lib.objGet(rc, "GetQueueAttributesResponse.GetQueueAttributesResult.Attribute", { list: 1 }).reduce((x, y) => {
                    x[y.Name] = y.Value;
                    return x;
                }, {});
                rc.queueCount = lib.toNumber(rc.ApproximateNumberOfMessages);
                rc.queueRunning = lib.toNumber(rc.ApproximateNumberOfMessagesNotVisible);
            }
            lib.tryCall(callback, err, rc);
        });
    }

    submit(job, options, callback) {
        logger.dev("submit:", this.url, job, options);
        var opts = this.options;
        if (options.region || options.delay) {
            opts = lib.clone(this.options, { region: options.region, delay: options.delay });
        }
        if (/\.fifo$/.test(this.url)) {
            if (opts === this.options) opts = lib.clone(this.options);
            if (options.groupKey) {
                opts.group = lib.objGet(job, options.groupKey);
            } else {
                opts.group = options.group || options.uniqueKey || this.queueName;
            }
            opts.unique = options.unique;
        }
        if (typeof job != "string") job = lib.stringify(job);
        aws.sqsSendMessage(this.url, Buffer.from(job).toString("base64"), opts, callback);
    }

    drop(msg, options, callback) {
        if (!msg.__queueMessageId) return lib.tryCall(callback);
        this._poll_del(options, { id: msg.__queueMessageId }, callback);
    }

    purge(options, callback) {
        aws.querySQS("PurgeQueue", { QueueUrl: this.url }, this.options, callback);
    }

    _poll_get(options, callback) {

        aws.sqsReceiveMessage(this.url, this.options, (err, items) => {
            if (!err) {
                items = items.map(item => ({
                    data: item.Body,
                    id: item.ReceiptHandle,
                    msgId: item.MessageId
                }));
            }
            callback(err, items);
        });
    }

    _poll_update(options, item, visibilityTimeout, callback) {
        const req = {
            QueueUrl: this.url,
            ReceiptHandle: item.id,
            VisibilityTimeout: Math.round(visibilityTimeout/1000)
        };
        aws.querySQS("ChangeMessageVisibility", req, this.options, callback);
    }

    _poll_del(options, item, callback) {
        const req = {
            QueueUrl: this.url,
            ReceiptHandle: item.id
        };
        aws.querySQS("DeleteMessage", req, this.options, callback);
    }

}

module.exports = SQSQueueClient;

