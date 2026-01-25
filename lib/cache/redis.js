/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const logger = require(__dirname + '/../logger');
const lib = require(__dirname + '/../lib');
const CacheClient = require(__dirname + "/client");
const redis = require("redis");

const scripts = {
        sget: [
            "redis.replicate_commands()",
            "local val = redis.call(KEYS[2], KEYS[1]);",
            "local ttl = tonumber(KEYS[3]);",
            "if KEYS[2] == 'spop' and ttl > 0 then",
            "  while (val) do",
            "    if redis.call('exists', val .. '#') == 0 then break; end;",
            "    val = redis.call('spop', KEYS[1]);",
            "  end;",
            "  if val then redis.call('psetex', val .. '#', ttl, ''); end;",
            "end;",
            "local size = redis.call('scard', KEYS[1]);",
            "return {val,size};",
        ].join("\n"),

        limiter: [
            "local name = KEYS[1];",
            "local rate = tonumber(KEYS[2]);",
            "local max = tonumber(KEYS[3]);",
            "local interval = tonumber(KEYS[4]);",
            "local now = tonumber(KEYS[5]);",
            "local ttl = tonumber(KEYS[6]);",
            "local reset = tonumber(KEYS[7]);",
            "local multi = tonumber(KEYS[8]);",
            "local count = tonumber(redis.call('HGET', name, 'c'));",
            "local mtime = tonumber(redis.call('HGET', name, 'm'));",
            "local lastint = tonumber(redis.call('HGET', name, 'i'));",
            "if multi and lastint then",
            "   interval = lastint;",
            "end;",
            "if not mtime then",
            "   count = max;",
            "   mtime = now;",
            "end;",
            "if now < mtime then",
            "   mtime = now - interval;",
            "end;",
            "local elapsed = now - mtime;",
            "if count < max then",
            "   count = math.min(max, count + rate * (elapsed / interval));",
            "   redis.call('HSET', name, 'c', count);",
            "end;",
            "redis.call('HSET', name, 'm', now);",
            "local total = redis.call('HINCRBY', name, 't', 1);",
            "if ttl > 0 then",
            "   redis.call('PEXPIRE', name, ttl);",
            "end;",
            "if count < 1 then",
            "   if multi and multi ~= 0 then",
            "      interval = math.min(30000000000, interval * math.abs(multi));",
            "      redis.call('HSET', name, 'i', interval);",
            "   end;",
            "   if reset > 0 then",
            "      redis.call('DEL', name);",
            "   end;",
            "   return {interval - elapsed,count,total,elapsed,interval};",
            "else",
            "   if reset > 1 and total >= reset then",
            "      redis.call('DEL', name);",
            "   else",
            "      redis.call('HSET', name, 'c', count - 1);",
            "      if multi and multi < 0 then",
            "          redis.call('HDEL', name, 'i');",
            "      end;",
            "   end;",
            "   return {0,count,total,elapsed,interval};",
            "end"
        ].join(""),

        getset: [
            "local v = redis.call('get', KEYS[1]);",
            "if not v then",
            "   redis.call('set', KEYS[1], KEYS[3]);",
            "   local ttl = tonumber(KEYS[2]);",
            "   if ttl > 0 then",
            "      redis.call('pexpire', KEYS[1], ttl);",
            "   end;",
            "end;",
            "return v;",
        ].join(""),

        setmax: [
            "local v = tonumber(redis.call('get', KEYS[1]));",
            "if not v or v < tonumber(KEYS[2]) then",
            "   redis.call('set', KEYS[1], KEYS[2]);",
            "   local ttl = tonumber(KEYS[3]);",
            "   if ttl > 0 then",
            "      redis.call('pexpire', KEYS[1], ttl);",
            "   end;",
            "end;",
            "return v;",
        ].join(""),

        hmsetmax: [
            "local v = tonumber(redis.call('hget', KEYS[1], KEYS[2]));",
            "if not v or v < tonumber(KEYS[3]) then",
            "   redis.call('hmset', KEYS[1], KEYS[2], KEYS[3]);",
            "   local ttl = tonumber(KEYS[4]);",
            "   if ttl > 0 then",
            "      redis.call('pexpire', KEYS[1], ttl);",
            "   end;",
            "end;",
            "return v;",
        ].join(""),

        lock: [
            "local ttl = tonumber(KEYS[2]);",
            "if tonumber(KEYS[4]) == 1 then",
            "   redis.call('set', KEYS[1], KEYS[3]);",
            "   if ttl > 0 then",
            "      redis.call('pexpire', KEYS[1], ttl);",
            "   end;",
            "end;",
            "local v = redis.call('setnx', KEYS[1], KEYS[3]);",
            "if v == 1 and ttl > 0 then",
            "   redis.call('pexpire', KEYS[1], ttl);",
            "end;",
            "return v;",
        ].join(""),

};

/**
 * Cache client based on Redis server using https://github.com/NodeRedis/node_redis3
 * @param {object} options
 * @param {bolean|int|object} [options.tls] will use TLS to connect to Redis servers, this is required for RedisCache Serverless
 *
 * @example
 * cache-redis=redis://host1
 * cache-redis-options-enable_offline_queue=1000
 * cache-redis=redis://host1?bk-visibilityTimeout=30000&bk-count=2
 *
 * @memberOf module:cache
 */

class RedisClient extends CacheClient {

    constructor(options) {
        super(options);
        this.name = "redis";
        this.applyOptions();
        this.client = this.connect(this.hostname, this.port);
    }

    close() {
        super.close();
        if (this.client) this.client.quit();
        delete this.client;
        delete this.options.retry_strategy;
    }

    applyOptions(options) {
        super.applyOptions(options);
        this.options.enable_offline_queue = lib.toBool(this.options.enable_offline_queue);
        this.options.retry_max_delay = lib.toNumber(this.options.retry_max_delay, { min: 1000, dflt: 30000 });
        this.options.max_attempts = lib.toNumber(this.options.max_attempts, { min: 0 });
    }

    connect(host, port) {
        host = String(host).split(":");
        // For reconnect or failover to work need retry policy
        this.options.retry_strategy = (options) => {
            logger.logger(options.attempt == 2 ? "error": "dev", "connect:", this.url, options);
            if (this.options.max_attempts > 0 && options.attempt > this.options.max_attempts) undefined;
            return Math.min(options.attempt * 200, this.options.retry_max_delay);
        }
        if (this.options.tls === true || this.options.tls === 1) {
            this.options.tls = {};
        }
        var client = new redis.createClient(host[1] || port || this.options.port || 6379, host[0] || "127.0.0.1", this.options);
        client.on("error", (err) => { logger.error("redis:", this.cacheName, this.url, err) });
        client.on("ready", this.emit.bind(this, "ready"));
        logger.debug("connect:", this.url, host, port, this.options);
        return client;
    }

    stats(options, callback) {
        var rc = {};
        this.client.info((err, str) => {
            lib.split(str, "\n").filter((x) => (x.indexOf(":") > -1)).forEach((x) => {
                x = x.split(":");
                rc[x[0]] = x[1];
            });
            lib.tryCall(callback, err, rc);
        });
    }

    clear(pattern, callback) {
        if (pattern) {
            this.client.keys(pattern, (e, keys) => {
                for (var i in keys) {
                    this.client.del(keys[i], lib.noop);
                }
                lib.tryCall(callback, e);
            });
        } else {
            this.client.flushall(callback);
        }
    }

    get(key, options, callback) {
        if (options.listName) {
            if (key == "*") {
                if (options.del) {
                    this.client.spop(options.listName, 9999999999, callback);
                } else {
                    this.client.smembers(options.listName, callback);
                }
            } else
            if (!key) {
                this.client.eval(scripts.sget, 3, options.listName, options.del ? "spop" : "srandmember", lib.toNumber(options.ttl), callback);
            } else {
                this.client.sismember(options.listName, key, callback);
            }
        } else
        if (options.mapName) {
            if (key == "*") {
                this.client.hgetall(options.mapName, callback);
            } else
            if (Array.isArray(key)) {
                this.client.hmget(options.mapName, key, callback);
            } else {
                this.client.hget(options.mapName, key, callback);
            }
        } else
        if (Array.isArray(key)) {
            this.client.mget(key, callback);
        } else
        if (options.set) {
            var ttl = lib.toNumber(options.ttl) || lib.toNumber(this.options.ttl);
            this.client.eval(scripts.getset, 3, key, ttl, options.set, callback);
        } else {
            this.client[options.del ? "getdel" : "get"](key, callback);
        }
    }

    put(key, val, options, callback) {
        var ttl = lib.toNumber(options.ttl) || lib.toNumber(this.options.ttl);
        switch (typeof val) {
        case "boolean":
        case "number":
        case "string":
            break;
        default:
            if (!(options.mapName && (!key || key == "*")) && !(options.listName && Array.isArray(val))) {
                val = lib.stringify(val);
            }
        }
        if (options.listName) {
            if (lib.isEmpty(val)) return lib.tryCall(callback);
            const multi = this.client.multi();
            multi.sadd(options.listName, val);
            multi.scard(options.listName);
            if (ttl > 0) multi.pexpire(options.listName, ttl);
            multi.exec(callback);
        } else

        if (options.mapName) {
            if (options.setmax) {
                this.client.eval(scripts.hmsetmax, 4, options.mapName, key, val, ttl, callback);
            } else {
                const multi = this.client.multi();
                if (!key || key == "*") {
                    multi.hmset(options.mapName, val);
                } else {
                    multi.hmset(options.mapName, key, val);
                }
                if (ttl > 0) multi.pexpire(options.mapName, ttl);
                multi.exec(callback);
            }
        } else {
            if (options.setmax) {
                this.client.eval(scripts.setmax, 3, key, val, ttl, callback);
            } else
            if (ttl > 0) {
                this.client.psetex([key, ttl, val], callback || lib.noop);
            } else {
                this.client.set([key, val], callback || lib.noop);
            }
        }
    }

    incr(key, val, options, callback) {
        var ttl = lib.toNumber(options.ttl) || lib.toNumber(this.options.ttl);
        var isO = lib.isObject(val);
        var map = options.mapName || isO && key;
        if (map) {
            const multi = this.client.multi();
            if (options.returning == "old") multi.hgetall(map);
            if (typeof val == "number") {
                multi.hincrby(map, key, val);
            } else {
                for (const k in val) {
                    if (typeof val[k] == "number") {
                        multi.hincrby(map, k, val[k]);
                    } else {
                        multi.hset(map, k, val[k]);
                    }
                }
            }
            if (ttl > 0) multi.pexpire(map, ttl);
            if (["new", "*"].includes(options.returning)) multi.hgetall(map);
            multi.exec(callback);

        } else

        if (isO && !key) {
            const ttls = options.ttl || "", vals = [];
            const multi = this.client.multi();
            let y = 0;
            for (const k in val) {
                if (typeof val[k] == "number") {
                    multi.incrby(k, val[k]);
                } else {
                    multi.set(k, val[k]);
                }
                const t = lib.toNumber(ttls[k]) || ttl;
                vals.push(y);
                if (t > 0) {
                    multi.pexpire(k, t);
                    y++;
                }
                y++;
            }
            if (options.returning) {
                multi.exec((e, v) => {
                    if (!e) v = vals.map((x) => v[x]);
                    if (callback) callback(e, v);
                });
            } else {
                multi.exec(callback);
            }

        } else

        if (lib.isArray(key)) {
            val = lib.toNumber(val);
            const ttls = options.ttl || "", vals = [];
            const multi = this.client.multi();
            for (let i = 0, y = 0; i < key.length; i++, y++) {
                multi.incrby(key[i], val);
                const t = lib.toNumber(ttls[i]) || ttl;
                vals.push(y);
                if (t > 0) {
                    multi.pexpire(key[i], t);
                    y++;
                }
            }
            if (options.returning) {
                multi.exec((e, v) => {
                    if (!e) v = vals.map((x, i) => v[x]);
                    if (callback) callback(e, v);
                });
            } else {
                multi.exec(callback);
            }

        } else {
            if (ttl > 0) {
                this.client.multi().
                incrby(key, lib.toNumber(val)).
                pexpire(key, ttl).
                exec((e, v) => {
                    if (callback) callback(e, v && v[0]);
                });
            } else {
                this.client.incrby(key, lib.toNumber(val), callback);
            }
        }
    }

    del(key, options, callback) {
        if (options.listName) {
            this.client.srem(options.listName, key, callback || lib.noop)
        } else
        if (options.mapName) {
            if (key == "*") {
                this.client.del(options.mapName, callback || lib.noop)
            } else {
                this.client.hdel(options.mapName, key, callback || lib.noop)
            }
        } else {
            this.client.del(key, callback || lib.noop);
        }
    }

    lock(name, options, callback) {
        var ttl = lib.toNumber(options.ttl);
        var set = lib.toBool(options.set);
        this.client.eval(scripts.lock, 4, name, ttl, process.pid, set ? 1 : 0, callback);
    }

    unlock(name, options, callback) {
        this.client.del(name, callback || lib.noop);
    }

    limiter(options, callback) {
        this.client.eval(scripts.limiter, 8,
            options.name,
            options.rate,
            options.max,
            options.interval,
            Date.now(),
            options.ttl,
            options.reset,
            options.multiplier,
            (err, rc) => {
                rc = rc || lib.empty;
                if (err) logger.error("limiter:", this.url, lib.traceError(err));
                callback(lib.toNumber(rc[0]), {
                    cacheName: this.cacheName,
                    delay: lib.toNumber(rc[0]),
                    count: lib.toNumber(rc[1]),
                    total: lib.toNumber(rc[2]),
                    elapsed: lib.toNumber(rc[3]),
                    interval: lib.toNumber(rc[4]),
                });
            });
    }

}

module.exports = RedisClient;
