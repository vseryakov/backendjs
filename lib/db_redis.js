//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var util = require('util');
var url = require('url');
var net = require('net');
var fs = require('fs');
var path = require('path');
var domain = require('domain');
var cluster = require('cluster');
var os = require('os');
var core = require(__dirname + '/../core');
var corelib = require(__dirname + '/../corelib');
var db = require(__dirname + '/../db');
var logger = require(__dirname + '/../logger');
var utils = require(__dirname + '/../build/Release/backend');
var redis = require('redis');


// Redis database pool, uses Hash to store the records
db.redisInitPool = function(options)
{
    var self = this;
    if (!options) options = {};
    if (!options.pool) options.pool = "redis";
    if (!options.concurrency) options.concurrency = 2;

    options.type = "redis";
    options.dboptions = { noJson: 1 };
    var pool = this.createPool(options);

    pool.get = function(callback) {
        var err = null;
        if (!this.redis) {
            try {
                this.redis = redis.createClient(this.dbinit.port, this.db, this.dbinit);
                this.redis.on("error", function(err) { logger.error('redis:', err) });
            } catch(e) {
                err = e;
            }
        }
        callback(err, this.redis);
    }

    pool.close = function(cient, callback) {
        client.quit();
        if (callback) callback();
    }

    pool.getKeys = function(table, obj, opts, search) {
        var keys = self.getQueryForKeys(this.dbkeys[table] || [], obj);
        if (!search) return keys;
        for (var p in keys) {
            if (!opts.ops[p]) continue;
            switch (opts.ops[p]) {
            case "eq":
            case "begins_with":
            case "like%":
                break;

            default:
                delete keys[p];
            }
        }
        return keys;
    }

    pool.getKey = function(table, obj, opts, search) {
        var key = table;
        var keys = this.getKeys(table, obj, opts, search);
        for (var p in keys) key += "|" + keys[p];
        if (search) key += key == table ? "|*" : "*";
        return key;
    }

    pool.getItem = function(client, table, obj, opts, callback) {
        var key = this.getKey(table, obj, opts);
        var cols = self.getSelectedColumns(table, opts);
        if (cols) {
            client.hmget(key, cols, function(err, vals) {
                if (!vals) vals = [];
                vals = [ cols.map(function(x,i) { return [x, vals[i]] }).reduce(function(x, y) { x[y[0]] = y[1]; return x }, {}) ];
                callback(err, vals);
            })
        } else {
            client.hgetall(key, function(err, val) {
                if (val) val = [ val ]; else val = [];
                callback(err, val);
            });
        }
    }
    pool.getList = function(client, table, obj, opts, callback) {
        if (!obj.length) return callback(null, []);
        var keys = this.dbkeys[table || ""] || [];

        // If we have a list of strings, split into objects by primary key
        if (typeof obj[0] == "string") {
            obj = obj.map(function(x) {
                return x.split("|").slice(1).map(function(x,i) { return [x, keys[i]] }).reduce(function(x,y) { x[y[1]] = y[0]; return x }, {});
            });
        }
        // If only want primary keys then return as is
        if (opts.select && corelib.strSplit(opts.select).every(function(x) { return keys.indexOf(x)>-1 })) {
            return callback(null, obj);
        }
        var rows = [];
        corelib.forEachLimit(obj, opts.concurrency || this.concurrency, function(item, next) {
            pool.getItem(client, table, item, opts, function(err, val) {
                if (!err && val.length) rows.push(val[0]);
                next(err);
            });
        }, function(err) {
            callback(err, rows);
        });
    }

    pool.query = function(client, req, opts, callback) {
        var obj = req.obj;
        var table = req.table || "";
        var keys = this.dbkeys[table] || [];
        var cols = this.dbcolumns[table] || {};

        switch (req.op) {
        case "drop":
            client.keys(table + "|*", function(err, list) {
                if (err || !list.length) return callback(err, []);
                corelib.forEachLimit(list, opts.concurrency || pool.concurrency, function(key, next) {
                    client.del(key, next);
                }, function(err) {
                    callback(err, []);
                });
            });
            return;

        case "get":
            this.getItem(client, table, obj, opts, callback);
            return;

        case "select":
            var dbkeys = this.getKeys(table, obj, opts, 1);
            var args = [ opts.start || 0, "MATCH", this.getKey(table, obj, opts, 1)];
            if (opts.count) args.push("COUNT", opts.count);
            // Custom filter on other columns
            var other = Object.keys(obj).filter(function(x) { return x[0] != "_" && (keys.indexOf(x) == -1 || !dbkeys[x]) && typeof obj[x] != "undefined" });
            var filter = function(items) {
                if (other.length > 0) items = self.filterColumns(obj, items, { keys: other, cols: cols, ops: opts.ops, typesMap: opts.typesMap });
                return items;
            }
            var rows = [];
            var count = opts.count || 0;
            corelib.doWhilst(
                function(next) {
                    client.send_command("SCAN", args, function(err, reply) {
                        if (err) return next(err);
                        pool.getList(client, table, reply[1], opts, function(err, items) {
                            items = filter(items);
                            rows.push.apply(rows, items);
                            client.next_token = args[0] = corelib.toNumber(reply[0]);
                            count -= items.length;
                            if (opts.count) args[4] = count;
                            next(err);
                        });
                    });
                },
                function() {
                    return client.next_token || (opts.count && count > 0);
                },
                function(err) {
                    if (rows.length && opts.sort) rows.sort(function(a,b) { return (a[opts.sort] - b[opts.sort]) * (opts.desc ? -1 : 1) });
                    callback(err, rows);
            });
            return;

        case "list":
            this.getList(client, table, obj, opts, callback);
            return;

        case "add":
            var key = this.getKey(table, obj, opts);
            client.exists(key, function(err, yes) {
                if (yes) return callback(new Error("already exists"), []);
                client.hmset(key, obj, function(err) {
                    callback(err, []);
                });
            });
            return;

        case "put":
            var key = this.getKey(table, obj, opts);
            client.hmset(key, obj, function(err) {
                callback(err, []);
            });
            return;

        case "update":
            var key = this.getKey(table, obj, opts);
            client.exists(key, function(err, yes) {
                if (!yes) return callback(null, []);
                client.hmset(key, obj, function(err) {
                    callback(err, []);
                });
            });
            return;

        case "del":
            var key = this.getKey(table, obj, opts);
            client.del(key, function(err) {
               callback(err, []);
            });
            return;

        case "incr":
            var key = this.getKey(table, obj, opts);
            var nums = (opts.counter || []).filter(function(x) { return keys.indexOf(x) == -1 }).map(function(x) { return { name: x, value: obj[x] } });
            corelib.forEachLimit(nums, opts.concurrency || this.concurrency, function(num, next) {
                client.hincrby(key, num.name, num.value, next);
            }, function(err) {
                callback(err, []);
            });
            return;

        default:
            return callback(null, []);
        }
    }

    return pool;
}
