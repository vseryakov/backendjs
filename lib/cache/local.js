//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2024
//

const util = require("util");
const lib = require(__dirname + "/../lib");
const cache = require(__dirname + "/../cache");
const Client = require(__dirname + "/client");
const jobs = require(__dirname + "/../jobs");

// Client that uses the local process or master process for jobs or rate limiter.

const client = {
    name: "local",
};
module.exports = client;

cache.modules.push(client);

client.createClient = function(options)
{
    if (/^local:/.test(options?.url)) return new LocalClient(options);
}

function LocalClient(options)
{
    Client.call(this, options);
    this.applyOptions();
    this.emit("ready");
}

util.inherits(LocalClient, Client);

LocalClient.prototype.limiter = function(options, callback)
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
    const msg = cache.localLimiter(opts);
    callback(msg.consumed ? 0 : msg.delay, msg);
}

LocalClient.prototype.subscribeQueue = function(options, callback)
{
}

LocalClient.prototype.publishQueue = function(msg, options, callback)
{
    msg = lib.jsonParse(msg);
    setTimeout(jobs.processJobMessage.bind(jobs, "#local", msg), options?.delay);
    if (typeof callback == "function") callback();
}
