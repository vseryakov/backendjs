/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2024
 */

const cluster = require("cluster");
const lib = require(__dirname + "/../lib");
const QueueClient = require(__dirname + "/client");

/**
 * Client that uses primary process rate limiter and workers for jobs.
 * @memberOf module:queue
 */

class WorkerClient extends QueueClient {

    constructor(options) {
        super(options);
        this.name = "worker";
        this.qworker = 0;
        this.applyOptions();
        this.emit("ready");
    }

    listen(options, callback) {}

    submit(msg, options, callback) {
        var err;

        if (cluster.isPrimary) {
            var workers = lib.getWorkers({ worker_type: null })
            if (workers.length) {
                msg.__op = "worker:job";
                try {
                    workers[this.qworker++ % workers.length].send(msg);
                } catch (e) { err = e }
            } else {
                err = { status: 404, message: "no workers available" }
            }
        } else {
            err = { status: 400, message: "not a primary process" };
        }
        if (typeof callback == "function") callback(err);
    }

}

module.exports = WorkerClient;
