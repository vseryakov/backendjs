//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const util = require("util");
const ipc = require(__dirname + "/../ipc");
const Client = require(__dirname + "/client");

// Client that uses the local process or master process for rate limiter.
// To enable cluster mode, i.e. master mode, provide `bk-cluster=1` in the url

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
    if (!this.options.cluster) {
        const msg = ipc.localLimiter(opts);
        callback(msg.consumed ? 0 : msg.delay, msg);
    } else {
        ipc.sendMsg("ipc:limiter", opts, (msg) => {
            callback(msg.consumed ? 0 : msg.delay, msg);
        });
    }
}
