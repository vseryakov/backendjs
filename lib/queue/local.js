/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2024
 */

const modules = require(__dirname + '/../modules');
const lib = require(__dirname + "/../lib");
const QueueClient = require(__dirname + "/client");

/**
 * Client that uses the local process or server process for jobs.
 * @memberOf module:queue
 */

class LocalClient extends QueueClient {

    constructor(options) {
        super(options);
        this.name = "local";

        this.applyOptions();
        this.emit("ready");
    }

    listen(options, callback) {}

    submit(msg, options, callback) {
        setTimeout(modules.jobs.processJobMessage.bind(modules.jobs, "#local", msg), options?.delay);
        lib.tryCall(callback);
    }
}

module.exports = LocalClient;