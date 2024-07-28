//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2024
//

const cluster = require("cluster");
const util = require("util");
const lib = require(__dirname + "/../lib");
const ipc = require(__dirname + "/../ipc");
const Client = require(__dirname + "/client");
const jobs = require(__dirname + "/../jobs");

// Client that uses master process rate limiter and workers for jobs.

const client = {
    name: "worker",
};
module.exports = client;

ipc.modules.push(client);

client.createClient = function(url, options)
{
    if (/^worker:/.test(url)) return new IpcWorkerClient(url, options);
}

function IpcWorkerClient(url, options)
{
    Client.call(this, url, options);
    this.qworker = 0;
    this.applyOptions();
    this.emit("ready");
}

util.inherits(IpcWorkerClient, Client);

IpcWorkerClient.prototype.limiter = function(options, callback)
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

IpcWorkerClient.prototype.subscribeQueue = function(options, callback)
{
}

IpcWorkerClient.prototype.publishQueue = function(msg, options, callback)
{
    msg = lib.jsonParse(msg);

    if (cluster.isMaster) {
        var keys = Object.keys(cluster.workers);
        if (keys.length) {
            msg.__op = "worker:job";
            cluster.workers[keys[this.qworker++ % keys.length]].send(msg);
            return typeof callback == "function" && callback();
        }
    }
    setTimeout(jobs.processJobMessage.bind(jobs, "#local", msg), options?.delay);
    if (typeof callback == "function") callback();
}

