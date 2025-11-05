/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const logger = require(__dirname + '/../logger');
const lib = require(__dirname + '/../lib');
const aws = require(__dirname + '/../aws');
const Client = require(__dirname + "/client");

/**
 * Queue client using AWS EventBridge.
 *
 * The URL must look like: `eventbridge://?[params]`.
 *
 * Examples:
 *
 *      -queue-events=eventbridge://
 *      -queue-events=eventbridge://?bk-endpoint=12345
 *      -queue-events=eventbridge://?bk-bus=mybus
 *      -queue-events=eventbridge://?bk-source=mysource
 */

const client = {
    name: "eventbridge",

    create: function(options) {
        if (/^eventbridge:\/\//.test(options?.url)) return new EventBridgeClient(options);
    }
};

module.exports = client;

class EventBridgeClient extends Client {

    constructor(options) {
        super(options);
        this.name = client.name;
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

