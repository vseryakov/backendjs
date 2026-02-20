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
 * @param {object} options
 * @param {int} [options.count] config property specifies how messages to process at the same time, default is 1.
 *
 * @param {int} [options.interval] config property defines in ms how often to check for new messages after processing a message, i.e. after a messages processed
 * it can poll immediately or after this amount of time, default is 1000 milliseconds.
 *
 * @param {int} [options.retryInterval] config property defines in ms how often to check for new messages after an error or no data, i.e. on empty
 * pool when no messages are processed it can poll immediately or after this amount of time, default is 5000 mulliseconds.
 *
 * @param {int} [options.visibilityTimeout] property specifies how long the messages being processed stay hidden, in milliseconds.
 *
 * @param {int} [options.timeout] property defines how long to wait for new messages, i.e. the long poll, in milliseconds
 *
 * @param {int} [options.retryCount] and `retryTimeout` define how many times to retry failed AWS HTTP requests, default is 5 times starting
 *  with the backoff starting at 500 milliseconds.
 *
 * @param {int} [options.startTime] property which is the time in the future when a message must be actually processed there,
 *  The scheduling is implemented using AWS `visibilityTimeout` feature, keep scheduled messages hidden until the actual time.
 *
 * @param {int} [options.maxTimeout] which defines in milliseconds the max time a messsage can stay invisible while waiting
 * for its scheduled date, default is 6 hours, the AWS max is 12 hours.
 *
 * @example
 *
 * queue-messages=sqs://messages?bk-interval=60000
 * queue-messages=sqs://sqs.us-east-1.amazonaws.com/123456/messages?bk-visibilityTimeout=300&bk-count=2
 *
 * @memberOf module:queue
 */

class SQSClient extends QueueClient {

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
        this.options.visibilityTimeout = lib.toNumber(this.options.visibilityTimeout, { min: 0 });
        if (this.options.visibilityTimeout < 1000) this.options.visibilityTimeout *= 1000;
        this.options.count = lib.toNumber(this.options.count, { dflt: 0, min: 1, max: 10 });
        this.options.interval = lib.toNumber(this.options.interval, { dflt: 1000, min: 0 });
        this.options.retryInterval = lib.toNumber(this.options.retryInterval, { dflt: 1000, min: 0 });
        this.options.maxTimeout = lib.toNumber(this.options.maxTimeout, { dflt: 3600000*6, min: 60000 });
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

    poll(options) {
        if (!this.url) return;

        var url = this.url;
        var chan = this.channel(options);

        aws.sqsReceiveMessage(url, this.options, (err, items) => {
            if (err) return this.schedule(options, this.options.retyInterval);

            var processed = 0;
            lib.forEach(items, (item, next) => {
                let vtimer, done, body = item.Body || "";
                // JSON is assumed in the body, if not send it as is
                if (body[0] != "{") body = Buffer.from(body, "base64").toString();
                var msg = lib.jsonParse(body, { url: url, datatype: "obj", logger: "error", handle: item.ReceiptHandle }) || body;
                logger.debug("poll:", this.name, chan, "MSG:", msg, "ITEM:", item);

                // Check message timestamps if not ready yet then keep it hidden
                if (msg.endTime > 0 && msg.endTime < Date.now()) {
                    logger.info("poll:", this.name, chan, "expired", item.MessageId, msg);
                    aws.querySQS("DeleteMessage", { QueueUrl: url, ReceiptHandle: item.ReceiptHandle }, this.options, () => { next() });
                    return;
                }
                if (msg.startTime > 0 && msg.startTime - Date.now() > this.options.interval) {
                    let timeout = msg.startTime - Date.now();
                    if (timeout > this.options.maxTimeout) timeout = this.options.maxTimeout;
                    logger.info("poll:", this.name, chan, timeout, "scheduled", item.MessageId, msg);
                    const req = { QueueUrl: url, ReceiptHandle: item.ReceiptHandle, VisibilityTimeout: Math.round(timeout/1000) };
                    aws.querySQS("ChangeMessageVisibility", req, this.options, () => { next() });
                    return;
                }
                // Delete immediately, this is a one-off message not to be handled or repeated
                if (msg.noWait) {
                    aws.querySQS("DeleteMessage", { QueueUrl: url, ReceiptHandle: item.ReceiptHandle }, this.options);
                } else
                // Delay deletion in case checks need to be done for uniqueness or something else
                if (msg.noWaitTimeout > 0) {
                    setTimeout(() => {
                        if (done) return;
                        msg.noWait = 1;
                        aws.querySQS("DeleteMessage", { QueueUrl: url, ReceiptHandle: item.ReceiptHandle }, this.options);
                    }, msg.noWaitTimeout * 1000);
                } else {
                    // Update visibility now and while the job is running
                    const vtimeout = msg.visibilityTimeout > 0 ? msg.visibilityTimeout : this.options.visibilityTimeout;
                    if (vtimeout) {
                        Object.defineProperty(msg, "__receiptHandle", { enumerable: false, value: item.ReceiptHandle });
                        const req = { QueueUrl: url, ReceiptHandle: item.ReceiptHandle, VisibilityTimeout: Math.round(vtimeout * 1.1 / 1000) };
                        if (msg.visibilityTimeout > 0) aws.querySQS("ChangeMessageVisibility", req, this.options);
                        vtimer = setInterval(() => {
                            if (done) return;
                            aws.querySQS("ChangeMessageVisibility", req, this.options, (err) => {
                                logger.debug("poll:", this.name, chan, "keepalive", item.MessageId, msg);
                                if (err) clearInterval(vtimer);
                            });
                        }, vtimeout * 0.8);
                    }
                }
                processed++;
                // Not processed events will be back in the queue after visibility timeout automatically
                if (!this.emit(chan, msg, (err) => {
                    if (done) return;
                    done = 1;
                    clearInterval(vtimer);
                    logger.debug("poll:", this.name, chan, item.MessageId, err, msg);
                    // Retain the message only in case of known fatal errors, otherwise delete it after processing, any other error
                    // is considered as undeliverable due to corruption or invalid message format...
                    if (!msg.noVisibility && (err?.status >= 500 || msg.noWait)) {
                        const timeout = lib.toNumber(msg.retryVisibilityTimeout && msg.retryVisibilityTimeout[err?.status]);
                        if (err && timeout > 0) {
                            const req = { QueueUrl: url, ReceiptHandle: item.ReceiptHandle, VisibilityTimeout: Math.round(timeout/1000) };
                            return aws.querySQS("ChangeMessageVisibility", req, this.options, () => { next() });
                        }
                        return next();
                    }
                    aws.querySQS("DeleteMessage", { QueueUrl: url, ReceiptHandle: item.ReceiptHandle }, this.options, () => { next() });
                })) {
                    done = 1;
                    clearInterval(vtimer);
                    next();
                }
            }, () => {
                this.schedule(options, processed ? this.options.interval : this.options.retryInterval);
            });
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
        if (!msg.__receiptHandle) return lib.tryCall(callback);
        aws.querySQS("DeleteMessage", { QueueUrl: this.url, ReceiptHandle: msg.__receiptHandle }, this.options, callback);
    }
}

module.exports = SQSClient;

