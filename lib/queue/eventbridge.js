/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const logger = require(__dirname + '/../logger');
const lib = require(__dirname + '/../lib');
const aws = require(__dirname + '/../aws');
const QueueClient = require(__dirname + "/client");

const eventbridgeClient = {
    name: "eventbridge",

    create: function(options) {
        if (/^eventbridge:\/\//.test(options?.url)) return new EventBridgeClient(options);
    }
};
module.exports = eventbridgeClient;

/**
 * Queue client using AWS EventBridge.
 *
 * The URL must look like: `eventbridge://?[params]`.
 *
 * @example
 *
 *      -queue-events=eventbridge://
 *      -queue-events=eventbridge://?bk-endpoint=12345
 *      -queue-events=eventbridge://?bk-bus=mybus
 *      -queue-events=eventbridge://?bk-source=mysource
 * @memberOf module:queue
 */

class EventBridgeClient extends QueueClient {

    constructor(options) {
        super(options);
        this.name = eventbridgeClient.name;
        this.applyOptions();
        this.emit("ready");
    }

    submit(events, options, callback) {
        logger.dev("submit:", this.url, events, options);

        var entries = [];
        if (!Array.isArray(events)) events = [events];
        for (const event of events) {
            if (!event) continue;
            entries.push({
                Source: options.source || this.options.source || this.queueName,
                DetailType: event.topic || options.topic || this.options.topic,
                Details: lib.stringify(event),
                EventBusName: options.eventBusName || this.options.bus,
                TraceHeader: options.traceHeader,
            });
        }

        aws.queryEvents("PutEvents", { EndpointId: this.options.endpoint, Entries: entries }, options, callback);
    }
}

