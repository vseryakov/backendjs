//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var dns = require('dns');
var util = require('util');
var logger = require(__dirname + '/logger');
var core = require(__dirname + '/core');
var lib = require(__dirname + '/lib');
var ipc = require(__dirname + "/ipc");
var Client = require(__dirname + "/ipc_client");

// Cache/queue client based on Redis server using https://github.com/NodeRedis/node_redis
//
// To support more than one master Redis server in the client:
//
//    ipc-cache=redis://host1?bk-servers=host2,host3
//    ipc-cache-backup=redis://host2
//    ipc-cache-backup-options-max_attempts=3
//
// To support sentinels:
//
//    ipc-cache=redis://host1?bk-servers=host1,host3&bk-max_attempts=3&bk-sentinel-servers=host2,host3
//    ipc-cache-backup=redis://host2
//    ipc-cache-backup-options-sentinel-servers=host1,host2
//    ipc-cache-backup-options-sentinel-max_attempts=5

module.exports = IpcRedisClient;

function IpcRedisClient(url, options)
{
    Client.call(this, url, options);
    this.options.servers = lib.strSplitUnique(this.options.servers);
    if (this.options.servers.length) {
        var h = (this.hostname || "127.0.0.1") + ":" + (this.port || this.options.port || 6379);
        if (this.options.servers.indexOf(h) == -1) this.options.servers.push(h);
    }
    this.initClient("client", this.hostname, this.port);
    this.initSentinel();
}
util.inherits(IpcRedisClient, Client);

IpcRedisClient.prototype.close = function()
{
    Client.prototype.close.call(this);
    if (this.client) this.client.quit();
    if (this.sentinel) this.sentinel.end(true);
}

IpcRedisClient.prototype.stats = function(options, callback)
{
    this.client.info(function(e,v) {
        v = lib.strSplit(v, "\n").filter(function(x) { return x.indexOf(":") > -1 }).map(function(x) { return x.split(":") }).reduce(function(x,y) { x[y[0]] = y[1]; return x }, {});
        callback(e, v);
    });
}

IpcRedisClient.prototype.keys = function(pattern, callback)
{
    this.client.keys(pattern || "*", callback);
}

IpcRedisClient.prototype.clear = function(pattern, callback)
{
    var self = this;
    if (pattern) {
        this.client.keys(pattern, function(e, keys) {
            for (var i in keys) {
                self.client.del(keys[i], lib.noop);
            }
            lib.tryCall(e, callback);
        });
    } else {
        this.client.flushall(callback);
    }
}

IpcRedisClient.prototype.get = function(key, options, callback)
{
    if (Array.isArray(key)) {
        this.client.mget(key, callback);
    } else
    if (options && options.set) {
        var ttl = (options && lib.toNumber(options.ttl)) || lib.toNumber(this.options.ttl);
        if (ttl > 0) {
            this.client.multi().getset(key, options.set).expire(key, Math.ceil(ttl/1000)).exec(callback);
        } else {
            this.client.get(key, options.set, "NX", callback);
        }
    } else {
        this.client.get(key, callback);
    }
}

IpcRedisClient.prototype.put = function(key, val, options, callback)
{
    var ttl = (options && lib.toNumber(options.ttl)) || lib.toNumber(this.options.ttl);
    if (ttl > 0) {
        this.client.setex([key, Math.ceil(ttl/1000), val], callback || lib.noop);
    } else {
        this.client.set([key, val], callback || lib.noop);
    }
}

IpcRedisClient.prototype.incr = function(key, val, options, callback)
{
    var ttl = (options && lib.toNumber(options.ttl)) || lib.toNumber(this.options.ttl);
    if (ttl > 0) {
        this.client.multi().incrby(key, val).expire(key, Math.ceil(ttl/1000)).exec(function(e, v) {
            lib.tryCall(callback, e, v[0]);
        });
    } else {
        this.client.incrby(key, val, callback);
    }
}

IpcRedisClient.prototype.del = function(key, options, callback)
{
    this.client.del(key, callback || lib.noop);
}

IpcRedisClient.prototype.initClient = function(name, host, port)
{
    var opts = this.options[name] || this.options;
    host = String(host).split(":");
    // For reconnect or failover to work need retry policy
    if (opts.servers.length > 1 || this.sentinel) {
        var connect_timeout = opts.connect_timeout || 86400000;
        var retry_max_delay = opts.retry_max_delay || 60000;
        var max_attempts = opts.max_attempts || 10;
        var self = this;
        opts.retry_strategy = function(options) {
            logger.dev("initClient:", options);
            if (options.total_retry_time > connect_timeout || options.attempt > max_attempts) {
                setTimeout(self.onError.bind(self, self.name, { code: 'CONNECTION_BROKEN', message: opts.error && opts.error.message }), 100);
                return undefined;
            }
            return Math.max(200, Math.min(options.attempt * 200, retry_max_delay));
        }
    }
    var Redis = require("redis");
    var client = new Redis.createClient(host[1] || port || opts.port || 6379, host[0] || "127.0.0.1", opts);
    client.on("error", this.onError.bind(this, name));

    switch (name) {
    case "sentinel":
        client.on('pmessage', this.onSentinelMessage.bind(this));
        client.on("ready", this.onSentinelConnect.bind(this));
        break;

    default:
        client.on("ready", this.emit.bind(this, "ready"));
        client.on("message", this.onMessage.bind(this, name));
        client.on("connect", this.onConnect.bind(this, name));
    }

    if (this[name]) this[name].end(true);
    this[name] = client;
    logger.debug("initClient:", name, this.url, "connecting:", host, port);
}

IpcRedisClient.prototype.onConnect = function(name)
{
    logger.debug("onConnect:", name, this.url, "connected", this[name].address);
    this.emit("connect");
}

IpcRedisClient.prototype.onMessage = function(name, channel, msg)
{
    logger.dev("onMessage:", name, channel, msg);
    this.emit(channel, msg);
}

IpcRedisClient.prototype.onError = function(name, err)
{
    logger.error("onError:", name, err);
    if (err.code == 'CONNECTION_BROKEN') {
        this.emit("disconnect");
        var opts = this.options[name] || this.options;
        var host = opts.servers.shift();
        if (!host) return;
        opts.servers.push(host);
        logger.debug("disconnect:", name, this.url, "trying", host, "of", opts.servers);
        setTimeout(this.initClient.call(this, name, host), opts.reconnect_timeout || 50);
    }
}

IpcRedisClient.prototype.initSentinel = function()
{
    var options = this.options.sentinel;
    if (!options) return;
    options.servers = lib.strSplitUnique((options.servers || "") + "," + (this.options.host || ""));
    // Need at least one server for reconnect to work
    if (!options.servers.length) options.servers.push("");
    options.no_ready_check = false;
    options.enable_offline_queue = false;
    options.port = options.port || 26379;
    options.name = options.name || "redis";
    this.initClient("sentinel", options.servers[0]);
}

IpcRedisClient.prototype.onSentinelMessage = function(pattern, channel, msg)
{
    logger.debug("onSentinelMessage:", this.url, channel, msg)

    if (channel[0] == "+" || channel[0] == "-") channel = channel.substr(1);
    switch(channel) {
    case "reset-master":
        this.onSentinelConnect();
        break;

    case "sentinel":
        msg = lib.strSplit(msg, " ");
        if (!msg[1] || msg[5] != this.options.sentinel.name) break;
        if (this.options.sentinel.servers.indexOf(msg[1]) == -1) this.options.sentinel.servers.push(msg[1]);
        break;

    case 'switch-master':
        msg = lib.strSplit(msg, ' ');
        if (!msg[3] || msg[0] != this.options.sentinel.name) break;
        if (this.client && this.client.address == msg[3] + ":" + msg[4]) break;
        logger.error("onSentinelMessage:", "switch-master:", this.url, msg);
        this.initClient("client", msg[3], msg[4]);
        break;
    }
}

IpcRedisClient.prototype.onSentinelConnect = function()
{
    var self = this;
    logger.debug("onSentinelConnect:", this.url, this.options.sentinel);

    lib.series([
      function(next) {
          self.sentinel.punsubscribe(next);
      },
      function(next) {
          self.sentinel.send_command("SENTINEL", ["sentinels", self.options.sentinel.name], function(err, args) {
              if (err) return next(err);
              logger.debug("onSentinelConnect:", "sentinels", args);
              var servers = [];
              (Array.isArray(args) && Array.isArray(args[0]) ? args : []).forEach(function(x) {
                  var ip = "";
                  for (var i = 0; i < x.length - 1; i+= 2) {
                      if (x[i] == "ip") ip = x[i+1];
                      if (x[i] == "port") ip += ":" + x[i+1];
                  }
                  if (ip) servers.push(ip);
              });
              if (servers.indexOf(self.sentinel.address) == -1) servers.push(self.sentinel.address);
              if (servers.length) self.options.sentinel.servers = servers;
              next();
          });
      },
      function(next) {
          self.sentinel.send_command("SENTINEL", ["get-master-addr-by-name", self.options.sentinel.name], function(err, args) {
              if (err) return next(err);
              logger.debug("onSentinelConnect:", "master", args);
              var m = args[0] + ":" + args[1];
              if (self.options.servers.indexOf(m) == -1) self.options.servers.push(m);
              var h = self.client && self.client.connected && self.client.connection_options.host || self.hostname;
              var p = self.client && self.client.connected && self.client.connection_options.port || self.port || self.options.port || 6379;
              // Avoid reseting connections to the same server, have to compare IPs
              if (!/^[0-9\.]+$/.test(h)) {
                  dns.lookup(h, function(e, ip) {
                      if (ip) h = ip;
                      if (args[0] != h || args[1] != p) self.initClient("client", args[0], args[1]);
                      next();
                  });
              } else {
                  if (args[0] != h || args[1] != p) self.initClient("client", args[0], args[1]);
                  next();
              }
          });
      },
      function(next) {
          self.sentinel.psubscribe('*', next);
      },
    ], function(err) {
        if (!err) return;
        logger.error("onSentinelConnect:", self.url, err);
        if (self.sentinel.connected) setTimeout(self.onSentinelConnect.bind(self), self.options.sentinel.retry_timeout || 500);
    });
}
