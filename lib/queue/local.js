//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2024
//

const core = require("../core");
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
        this.applyOptions();
        this.emit("ready");
    }

    listen(options, callback) {}

    submit(msg, options, callback) {
        msg = lib.jsonParse(msg);
        setTimeout(core.modules.jobs.processJobMessage.bind(core.modules.jobs, "#local", msg), options?.delay);
        lib.tryCall(callback);
    }
}

