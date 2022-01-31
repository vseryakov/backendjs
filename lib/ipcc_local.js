//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const util = require("util");
const ipc = require(__dirname + "/ipc");
const Client = require(__dirname + "/ipc_client");

// Client that uses the master process for rate limiter
module.exports = client;

var client = {
    name: "local",
};

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
    var opts = { name: options.name, rate: options.rate, max: options.max, interval: options.interval, expire: options.ttl > 0 ? Date.now() + options.ttl : 0, reset: options.reset };
    ipc.sendMsg("ipc:limiter", opts, (msg) => {
        callback(msg.consumed ? 0 : msg.delay, { queueName: this.queueName, delay: msg.delay, count: msg.count, total: msg.total, elapsed: msg.elapsed });
    });
}
