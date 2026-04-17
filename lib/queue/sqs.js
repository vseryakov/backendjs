/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const lib = require(__dirname + '/../lib');
const aws = require(__dirname + '/../aws');
const QueueClient = require(__dirname + "/client");

/**
 * Queue client using AWS SQS, full queue url can be used or just the name as sqs://queuename
 *
 * @param {int} [options.timeout] property defines how long to wait for new messages, i.e. the long poll, in milliseconds
 *
 * @param {int} [options.visibilityTimeout] property specifies how long the messages being processed stay hidden, in milliseconds.
 * **Because SQS operates in seconds the timeout less than 1000 is rounded to 1 second.**
 *
 * @example
 *
 * queue-messages=sqs://messages?bk-pollInterval=60000
 * queue-messages=sqs://sqs.us-east-1.amazonaws.com/123456/messages?bk-visibilityTimeout=3000&bk-queueCount=2
 *
 * @memberOf module:queue
 */

class SQSQueueClient extends QueueClient {

    constructor(options) {
        super(options);
        this.name = "sqs";
        this.applyOptions();

        if (!/amazonaws.com/.test(this.url)) {
            aws.querySQS("GetQueueUrl", { QueueName: this.hostname }, this.options, (err, data) => {
                if (err) return;
                this.url = data?.GetQueueUrlResponse?.GetQueueUrlResult?.QueueUrl;
                this.emit("ready");
            });
        } else {
            this.url = "https" + this.url.substr(3);
            this.emit("ready");
        }
    }

    applyOptions(options) {
        super.applyOptions(options);
        this.options.timeout = lib.toNumber(this.options.timeout, { dflt: 20000, min: 0 });
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
        var opts = this.options;
        if (options.region || options.delay) {
            opts = Object.assign({}, this.options, { region: options.region, delay: options.delay });
        }
        if (this.url.endsWith(".fifo")) {
            if (opts === this.options) {
                opts = Object.assign({}, this.options);
            }
            opts.groupName = this.group(options) || options.uniqueKey || this.queueName;
            opts.dedupId = options.dedupId;
        }
        if (typeof job != "string") job = lib.stringify(job);
        aws.sqsSendMessage(this.url, Buffer.from(job).toString("base64"), opts, callback);
    }

    purge(options, callback) {
        aws.querySQS("PurgeQueue", { QueueUrl: this.url }, this.options, callback);
    }

    poll(options) {
        this._poll_run(options);
    }

    _poll_get(options, callback) {

        const opts = {
            timeout: this.options.timeout,
            count: this.options.queueCount,
            visibilityTimeout: this.options.visibilityTimeout,
        };

        aws.sqsReceiveMessage(this.url, opts, (err, items) => {
            if (!err) {
                items = items.map(item => ({
                    data: item.Body,
                    msgId: item.MessageId,
                    id: item.ReceiptHandle,
                }));
            }
            callback(err, items);
        });
    }

    _poll_update(options, item, visibilityTimeout, callback) {
        const req = {
            QueueUrl: this.url,
            ReceiptHandle: item.id,
            VisibilityTimeout: Math.ceil(visibilityTimeout/1000)
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

