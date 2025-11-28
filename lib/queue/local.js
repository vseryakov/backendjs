/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2024
 */

const modules = require(__dirname + '/../modules');
const lib = require(__dirname + "/../lib");
const QueueClient = require(__dirname + "/client");

const localClient = {
    name: "local",

    create: function(options) {
        if (/^local:/.test(options?.url)) return new LocalClient(options);
    }
};
module.exports = localClient;

/**
 * Client that uses the local process or server process for jobs.
 * @memberOf module:queue
 */

class LocalClient extends QueueClient {

    constructor(options) {
        super(options);
        this.name = localClient.name;

        this.applyOptions();
        this.emit("ready");
    }

    listen(options, callback) {}

    submit(msg, options, callback) {
        setTimeout(modules.jobs.processJobMessage.bind(modules.jobs, "#local", msg), options?.delay);
        lib.tryCall(callback);
    }
}

