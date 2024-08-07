//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2024
//

const util = require("util");
const lib = require(__dirname + "/../lib");
const ipc = require(__dirname + "/../ipc");
const Client = require(__dirname + "/client");
const jobs = require(__dirname + "/../jobs");

// Client that uses the local process or master process for jobs or rate limiter.

const client = {
    name: "local",
};
module.exports = client;

ipc.modules.push(client);

client.createClient = function(url, options)
{
    if (/^local:/.test(url)) return new IpcLocalClient(url, options);
}

function IpcLocalClient(url, options)
{
    Client.call(this, url, options);
    this.applyOptions();
    this.emit("ready");
}

util.inherits(IpcLocalClient, Client);

IpcLocalClient.prototype.limiter = function(options, callback)
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
    const msg = ipc.localLimiter(opts);
    callback(msg.consumed ? 0 : msg.delay, msg);
}

IpcLocalClient.prototype.subscribeQueue = function(options, callback)
{
}

IpcLocalClient.prototype.publishQueue = function(msg, options, callback)
{
    msg = lib.jsonParse(msg);
    setTimeout(jobs.processJobMessage.bind(jobs, "#local", msg), options?.delay);
    if (typeof callback == "function") callback();
}
