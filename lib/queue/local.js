/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2024
 */

const modules = require(__dirname + '/../modules');
const lib = require(__dirname + "/../lib");
const Client = require(__dirname + "/client");

// Client that uses the local process or master process for jobs.

const client = {
    name: "local",

    create: function(options) {
        if (/^local:/.test(options?.url)) return new LocalClient(options);
    }
};
module.exports = client;

class LocalClient extends Client {

    constructor(options) {
        super(options);
        this.name = client.name;

        this.applyOptions();
        this.emit("ready");
    }

    listen(options, callback) {}

    submit(msg, options, callback) {
        setTimeout(modules.jobs.processJobMessage.bind(modules.jobs, "#local", msg), options?.delay);
        lib.tryCall(callback);
    }
}

