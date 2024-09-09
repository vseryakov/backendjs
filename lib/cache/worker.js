//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2024
//

const cluster = require("cluster");
const util = require("util");
const lib = require(__dirname + "/../lib");
const ipc = require(__dirname + "/../ipc");
const cache = require(__dirname + "/../cache");
const Client = require(__dirname + "/client");

// Client that uses master process rate limiter and workers for jobs.

const client = {
    name: "worker",
};
module.exports = client;

cache.modules.push(client);

client.createClient = function(options)
{
    if (/^worker:/.test(options?.url)) return new WorkerClient(options);
}

function WorkerClient(options)
{
    Client.call(this, options);
    this.qworker = 0;
    this.applyOptions();
    this.emit("ready");
}

util.inherits(WorkerClient, Client);

WorkerClient.prototype.limiter = function(options, callback)
{
    var opts = {
        name: options.name,
        rate: options.rate,
        max: options.max,
        interval: options.interval,
        expire: options.ttl > 0 ? Date.now() + options.ttl : 0,
        reset: options.reset,
        multiplier: options.multiplier,
        queueName: this.queueName,
    };
    ipc.sendMsg("ipc:limiter", opts, (msg) => {
        callback(msg.consumed ? 0 : msg.delay, msg);
    });
}

WorkerClient.prototype.subscribeQueue = function(options, callback)
{
}

WorkerClient.prototype.publishQueue = function(msg, options, callback)
{
    var err;

    msg = lib.jsonParse(msg);

    if (cluster.isMaster) {
        var keys = Object.keys(cluster.workers);
        if (keys.length) {
            msg.__op = "worker:job";
            try {
                cluster.workers[keys[this.qworker++ % keys.length]].send(msg)
            } catch (e) { err = e }
        } else {
            err = { status: 404, message: "no workers available", role: cache.role }
        }
    } else {
        err = { status: 400, message: "not a master", role: cache.role };
    }
    if (typeof callback == "function") callback(err);
}

