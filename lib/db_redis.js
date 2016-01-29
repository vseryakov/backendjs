//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var util = require('util');
var core = require(__dirname + '/../core');
var lib = require(__dirname + '/../lib');
var db = require(__dirname + '/../db');
var logger = require(__dirname + '/../logger');
var redis = require('redis');

// Redis database pool, uses Hash to store the records
var pool = {
    name: "redis",
    poolOptions: {
        noJson: 1,
        concurrency: 5,
        sep: "^",
    },
    createPool: function(options) { return new Pool(options); }
};
module.exports = pool;

db.modules.push(pool);

function Pool(options)
{
    if (!lib.isPositive(options.max)) options.max = 25;
    options.type = pool.name;
    db.Pool.call(this, options);
    this.poolOptions = lib.mergeObj(this.poolOptions, pool.poolOptions);
}
util.inherits(Pool, db.Pool);

Pool.prototype.open = function(callback)
{
    try {
        if (this.url == "default") this.url = "127.0.0.1";
        var h = this.url.split(":");
        var port = h[1] || this.connectOptions.port || 6379;
        var host = h[0];
        var client = redis.createClient(port, host, this.connectOptions);
        client.on("error", function(err) { logger.error('redis:', err) });
        callback(null, client);
    } catch(err) {
        callback(err);
    }
}

Pool.prototype.close = function(client, callback)
{
    client.quit();
    if (callback) callback();
}

Pool.prototype.getKeys = function(table, obj, options, search)
{
    var keys = db.getQueryForKeys(db.getKeys(table, options), obj);
    if (!search || !options.ops) return keys;
    for (var p in keys) {
        if (!options.ops[p]) continue;
        switch (options.ops[p]) {
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

Pool.prototype.getKey = function(table, obj, options, search)
{
    var key = table;
    var keys = this.getKeys(table, obj, options, search);
    for (var p in keys) key += this.poolOptions.sep + keys[p];
    if (search) key += key == table ? this.poolOptions.sep + "*" : "*";
    return key;
}

Pool.prototype.getItem = function(client, table, obj, options, callback)
{
    var key = this.getKey(table, obj, options);
    var cols = db.getSelectedColumns(table, options);
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

Pool.prototype.getList = function(client, table, obj, options, callback)
{
    var self = this;
    if (!obj.length) return callback(null, []);
    var keys = db.getKeys(table, options);

    // If we have a list of strings, split into objects by primary key
    if (typeof obj[0] == "string") {
        obj = obj.map(function(x) {
            return x.split(self.poolOptions.sep).slice(1).map(function(x,i) { return [x, keys[i]] }).reduce(function(x,y) { x[y[1]] = y[0]; return x }, {});
        });
    }
    // If only want primary keys then return as is
    if (options.select && lib.strSplit(options.select).every(function(x) { return keys.indexOf(x)>-1 })) {
        return callback(null, obj);
    }
    var rows = [];
    lib.forEachLimit(obj, options.concurrency || this.poolOptions.concurrency, function(item, next) {
        self.getItem(client, table, item, options, function(err, val) {
            if (!err && val.length) rows.push(val[0]);
            next(err);
        });
    }, function(err) {
        callback(err, rows);
    });
}

Pool.prototype.query = function(client, req, options, callback)
{
    var self = this;
    var obj = req.obj;
    var table = req.table || "";
    var keys = db.getKeys(table, options);
    var cols = req.columns || db.getColumns(table, options);
    options = options || lib.empty;

    switch (req.op) {
    case "drop":
        client.keys(table + this.poolOptions.sep + "*", function(err, list) {
            if (err || !list.length) return callback(err, []);
            lib.forEachLimit(list, options.concurrency || self.poolOptions.concurrency, function(key, next) {
                client.del(key, next);
            }, function(err) {
                callback(err, []);
            });
        });
        return;

    case "get":
        this.getItem(client, table, obj, options, callback);
        return;

    case "select":
        var dbkeys = this.getKeys(table, obj, options, 1);
        var args = [ options.start || 0, "MATCH", this.getKey(table, obj, options, 1)];
        if (options.count) args.push("COUNT", options.count);
        // Custom filter on other columns
        var other = Object.keys(obj).filter(function(x) { return x[0] != "_" && (keys.indexOf(x) == -1 || !dbkeys[x]) && typeof obj[x] != "undefined" });
        var filter = function(items) {
            if (other.length > 0) items = db.filterRows(obj, items, { keys: other, cols: cols, ops: options.ops, typesMap: options.typesMap || self.poolOptions.typesMap });
            return items;
        }
        var rows = [];
        var count = options.count || 0;
        lib.doWhilst(
            function(next) {
                client.send_command("SCAN", args, function(err, reply) {
                    if (err) return next(err);
                    self.getList(client, table, reply[1], options, function(err, items) {
                        items = filter(items);
                        rows.push.apply(rows, items);
                        client.next_token = args[0] = lib.toNumber(reply[0]);
                        count -= items.length;
                        if (options.count > 0) args[4] = count;
                        next(err);
                    });
                });
            },
            function() {
                return client.next_token && (!options.count || count > 0);
            },
            function(err) {
                if (rows.length && options.sort) rows.sort(function(a,b) { return (a[options.sort] - b[options.sort]) * (options.desc ? -1 : 1) });
                callback(err, rows);
        });
        return;

    case "list":
        this.getList(client, table, obj, options, callback);
        return;

    case "add":
        var key = this.getKey(table, obj, options);
        client.watch(key, function(err) {
            if (err) return callback(err);
            client.exists(key, function(err, yes) {
                if (err || yes) return client.unwatch(function() { callback(err || lib.newError("already exists"), []); });
                client.multi().hmset(key, obj).exec(function(err, rc) {
                    if (!err && !rc) err = lib.newError("already exists");
                    callback(err, [], { affected_rows: err ? 0 : 1 });
                });
            });
        });
        return;

    case "put":
        var key = this.getKey(table, obj, options);
        client.hmset(key, obj, function(err) {
            callback(err, []);
        });
        return;

    case "update":
        var key = this.getKey(table, obj, options), expected;
        client.watch(key, function(err) {
            if (err) return callback(err);
            if (options.expected) {
                var expected = Object.keys(options.expected);
                client.hmget(key, expected, function(err, vals) {
                    if (err || !vals) return client.unwatch(function() { callback(err, []); });
                    for (var i = 0; i < expected.length; i++) {
                        if (vals[i] != options.expected[expected[i]]) return client.unwatch(function() { callback(null, []); });
                    }
                    client.multi().hmset(key, obj).exec(function(err, rc) {
                        callback(err, [], { affected_rows: err || !rc ? 0 : 1 });
                    });
                });
            } else {
                client.exists(key, function(err, yes) {
                    if (err || !yes) return client.unwatch(function() { callback(err, []); });
                    client.multi().hmset(key, obj).exec(function(err, rc) {
                        callback(err, [], { affected_rows: err || !rc ? 0 : 1 });
                    });
                });
            }
        });
        return;

    case "del":
        var key = this.getKey(table, obj, options);
        client.del(key, function(err) {
           callback(err, [], { affected_rows: err ? 0 : 1 });
        });
        return;

    case "incr":
        var key = this.getKey(table, obj, options);
        var nums = lib.searchObj(options.updateOps, { value: "incr", names: 1 }).map(function(x) { return { name: x, value: obj[x] } });
        var multi = client.multi();
        for (var i = 0; i < nums.length; i++) {
            multi.hincrby(key, nums[i].name, nums[i].value);
        }
        multi.exec(function(err) {
            callback(err, [], { affected_rows: err ? 0 : 1 });
        });
        return;

    default:
        return callback(null, []);
    }
}

