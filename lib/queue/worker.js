/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2024
 */
'use strict';

const modules = require(__dirname + '/../modules');
const cluster = require("node:cluster");
const lib = require(__dirname + "/../lib");
const QueueClient = require(__dirname + "/client");

/**
 * Client that uses primary process rate limiter, pub/sub events and workers for jobs.
 * @memberOf module:queue
 */

class WorkerQueueClient extends QueueClient {

    constructor(options) {
        super(options);
        this.name = "worker";
        this.qworker = 0;
        this.applyOptions();
        this.emit("ready");
    }

    subscribe(subject, _options, callback) {
        super.subscribe(subject, _options, callback);

        modules.ipc.on(subject, (msg) => {
            this.emit(subject, msg);
        });
    }

    publish(subject, msg, _options, callback) {
        modules.ipc.sendMsg("ipc:broadcast", { subject, msg });
        lib.tryCall(callback);
    }

    listen(_options, _callback) {}

    submit(msg, _options, callback) {
        var err;

        if (cluster.isPrimary) {
            const workers = lib.getWorkers({ worker_type: null })
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
        lib.tryCall(callback, err);
    }

}

module.exports = WorkerQueueClient;
