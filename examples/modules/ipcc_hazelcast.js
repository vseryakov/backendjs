//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

var util = require('util');
var path = require('path');
var logger = require(__dirname + '/../lib/logger');
var core = require(__dirname + '/../lib/core');
var lib = require(__dirname + '/../lib/lib');
var ipc = require(__dirname + "/../lib/ipc");
var Client = require(__dirname + "/../lib/ipc_client");

// Cache client based on HazelCast server using https://github.com/hazelcast/hazelcast-nodejs-client
//
// To support more than one server use either one:
//
//     ipc-cache=hazelcast://host?bk-servers=host2,host3
//
//     ipc-cache=memcache://host1
//     ipc-cache-options-servers=host1,host2
//
// To pass module specific options:
//
//     ipc-cache-options-map-name=defaultMap
//     ipc-cache-options-map-prefix=|
//

var client = {
    name: "hazelcast",
};
module.exports = client;

ipc.modules.push(client);

client.createClient = function(url, options)
{
    if (/^hazelcast:/.test(url)) return new HazelCastClient(url, options);
}

function HazelCastClient(url, options)
{
    var self = this;
    Client.call(this, url, options);
    this.options.servers = lib.strSplitUnique(this.options.servers);
    var h = (this.hostname || "127.0.0.1") + ":" + (this.port || this.options.port || 5701);
    if (this.options.servers.indexOf(h) == -1) this.options.servers.unshift(h);
    if (!this.options.mapName) this.options.mapName = core.name;

    var HazelClient = require('hazelcast-client');
    var cfg = new HazelClient.Config.ClientConfig();
    cfg.networkConfig.addresses = this.options.servers.map(function(x) {
        x = x.split(":");
        return new HazelClient.Address(x[0], lib.toNumber(x[1], { dflt: 5701 }));
    });
    cfg.properties['hazelcast.logging'] = {
        levels: ['error','warn','info','debug','dev'],
        log: function(level, className, message, info) {
            logger.logger(this.levels[level], "hazelcast:", className, message, info);
        }
    };
    HazelClient.Client.newHazelcastClient(cfg).then(function(client) {
        self.client = client;
        self.emit("ready");
    }).catch(function(err) {
        logger.error("hazelcast:", err, cfg);
        self.emit("error", err);
    });
}
util.inherits(HazelCastClient, Client);

HazelCastClient.prototype.close = function()
{
    Client.prototype.close.call(this);
    this.client.shutdown();
}

HazelCastClient.prototype.stats = function(options, callback)
{
    this.client.stats(callback);
}

HazelCastClient.prototype.clear = function(pattern, callback)
{
    var map = this.client.getMap(this.options.mapName);
    map.clear().then(function() {
        lib.tryCall(callback);
    }).catch(callback || lib.noop);
}

HazelCastClient.prototype._getMap = function(key)
{
    var name = this.options.mapName;
    if (this.options.mapPrefix) {
        var i = key.indexOf(this.options.mapPrefix);
        if (i > 0) name = key.substr(0, i);
    }
    return this.client.getMap(name);
}

HazelCastClient.prototype.get = function(key, options, callback)
{
    var map = this._getMap(key);
    if (Array.isArray(key)) {
        map.getAll(key).then(function(data) {
            if (Array.isArray(data)) data = data.map(function(x) { return x[1] });
            lib.tryCall(callback, null, data);
        }).catch(callback);
    } else {
        map.get(key).then(function(data) {
            if (data === null && options && options.set) {
                var ttl = options && lib.isNumber(options.ttl) ? options.ttl : lib.isNumber(this.options.ttl) ? this.options.ttl : 0;
                map.putIfAbsent(key, options.set, ttl > 0 ? ttl : -1).then(function() {
                    lib.tryCall(callback);
                }).catch(callback || lib.noop);
            } else {
                lib.tryCall(callback, null, data);
            }
        }).catch(callback);
    }
}

HazelCastClient.prototype.put = function(key, val, options, callback)
{
    var map = this._getMap(key);
    var ttl = options && lib.isNumber(options.ttl) ? options.ttl : lib.isNumber(this.options.ttl) ? this.options.ttl : 0;
    map.put(key, val, ttl > 0 ? ttl : -1).then(function() {
        lib.tryCall(callback);
    }).catch(callback || lib.noop);
}

HazelCastClient.prototype.incr = function(key, val, options, callback)
{
    var long = this.client.getAtomicLong(key);
    long.addAndGet(key, lib.toNumber(val)).then(function(data) {
        lib.tryCall(callback, data);
    }).catch(callback || lib.noop);
}

HazelCastClient.prototype.del = function(key, options, callback)
{
    var map = this._getMap(key);
    map.delete(key).then(function() {
        lib.tryCall(callback)
    }).catch(callback || lib.noop);
}

HazelCastClient.prototype.subscribe = function(channel, options, callback)
{
    Client.prototype.subscribe.call(this, channel, options, callback);
    var topic = this.client.getReliableTopic(channel);
    var self = this;
    this.listenerId = topic.addMessageListener(function(msg) {
        self.emit(channel, msg.messageObject);
    });
}

HazelCastClient.prototype.unsubscribe = function(channel, options, callback)
{
    Client.prototype.unsubscribe.call(this, channel, options, callback);
    var topic = this.client.getReliableTopic(channel);
    if (this.listenerId) topic.removeMessageListener(this.listenerId);
    delete this.listenerId;
}

HazelCastClient.prototype.publish = function(channel, msg, options, callback)
{
    var topic = this.client.getReliableTopic(channel);
    this.client.publish(msg).then(function() {
        lib.tryCall(callback)
    }).catch(callback || lib.noop);
}
