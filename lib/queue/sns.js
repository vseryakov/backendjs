/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const logger = require(__dirname + '/../logger');
const aws = require(__dirname + '/../aws');
const QueueClient = require(__dirname + "/client");


/**
 * Queue client using AWS SNS.
 *
 * The URL must look like: `sns://ARN`.
 *
 * @example
 *
 * queue-events=sns://
 * queue-events=sns://topic
 *
 * @memberOf module:queue
 */

class SNSClient extends QueueClient {

    constructor(options) {
        super(options);
        this.name = "sns";
        this.applyOptions();
        this.emit("ready");
    }

    submit(event, options, callback) {
        logger.dev("submit:", this.url, event, options);

        var arn = `arn:aws:sns:${options.region || aws.region}:${this.options.account || aws.accountId}:${options.topic || this.hostname}`;
        aws.snsPublish(arn, event, callback);
    }
}

module.exports = SNSClient;
