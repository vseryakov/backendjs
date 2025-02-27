//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2024
//

const cluster = require("cluster");
const lib = require(__dirname + "/../lib");
const Client = require(__dirname + "/client");

// Client that uses master process rate limiter and workers for jobs.

const client = {
    name: "worker",

    create: function(options) {
        if (/^worker:/.test(options?.url)) return new WorkerClient(options);
    }
};
module.exports = client;

class WorkerClient extends Client {

    constructor(options) {
        super(options);
        this.name = client.name;
        this.qworker = 0;
        this.applyOptions();
        this.emit("ready");
    }

    listen(options, callback) {}

    submit(msg, options, callback) {
        var err;

        msg = lib.jsonParse(msg);

        if (cluster.isMaster) {
            var workers = lib.getWorkers({ worker_type: null })
            if (workers.length) {
                msg.__op = "worker:job";
                try {
                    workers[this.qworker++ % workers.length].send(msg)
                } catch (e) { err = e }
            } else {
                err = { status: 404, message: "no workers available" }
            }
        } else {
            err = { status: 400, message: "not a master" };
        }
        if (typeof callback == "function") callback(err);
    }

}


