//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var util = require('util');
var core = require(__dirname + '/../core');
var lib = require(__dirname + '/../lib');
var db = require(__dirname + '/../db');
var logger = require(__dirname + '/../logger');

// Create a database pool that works with the Riak database.
//
// By default the driver uses simple key-value mode of operations, to enable bucket-type mode
// pass bucketType in the `-db-riak-options`:
//
// To use maps for the object records set `useMaps` in the `-db-riak-options`
//
//      -db-riak-options '{ "bucketType": "bk", "useMaps": 1 }'
//
// In addition to the standard commands it can execute any Riak HTTP API directly
//
//      db.query({ op: "GET", text: "/buckets?buckets=true" }, { pool: "riak" }, lib.log)
//      db.query({ op: "POST", text: "/buckets/bucket/counter/name", obj: 1 }, { pool: "riak" }, lib.log)
//
var pool = {
    name: "riak",
    // Native query parameters for each operation
    query: {
        del: ["rw", "pr", "w", "dw", "pw"],
        get: ["r","pr","basic_quorum","notfound_ok","vtag"],
        put: ["w","dw","pw","returnbody"],
        select: ["return_terms","max_results","continuation"],
    },
    createPool: function(options) { return new Pool(options); }
};
module.exports = pool;

db.modules.push(pool);

function Pool(options)
{
    options.type = pool.name;
    db.Pool.call(this, options);
}
util.inherits(Pool, db.Pool);

Pool.prototype.doQuery = function(op, method, path, obj, options, callback)
{
    if (this.url == "default") this.url = "http://127.0.0.1:8098";
    var uri = this.url + path;
    var params = { method: method, postdata: method != "GET" ? obj : "", query: {}, datatype: "obj", headers: { "content-type": "application/json" } };
    if (pool.query[op]) pool.query[op].forEach(function(x) { if (options[x]) params.query[x] = options[x] });
    for (var p in options.headers) params.headers[p] = options.headers[p];

    core.httpGet(uri, params, function(err, params) {
        if (err) {
            logger.error("riak:", method, path, err);
            return callback(err, {});
        }
        err = null;
        obj = params.obj;
        if (params.status >= 400) {
            err = lib.newError({ message: params.data || (method + " Error: " + params.status), code: obj.error, status: params.status });
        }
        callback(err, obj, { context: params.headers['x-riak-vclock'] });
    });
}

Pool.prototype.getPath = function(table, key)
{
    if (this.bucketType) {
        return "/types/" + this.bucketType + "/buckets/" + table + (this.useMaps ? "/datatypes/" : "/keys/") + key.replace(/[\/]/g, "%2F");
    }
    return "/buckets/" + table + "/keys/" + key.replace(/[\/]/g, "%2F");
}

Pool.prototype.getValue = function(obj)
{
    if (this.bucketType && this.useMaps && obj.value) {
        var o = {};
        for (var p in obj.value) o[p.replace(/(_register|_flag|_counter)$/, "")] = obj[p];
        obj = o;
    }
    return obj;
}

Pool.prototype.toValue = function(obj, cols)
{
    if (this.bucketType && this.useMaps) {
        var o = { update: {} };
        for (var p in obj) o.update[p + (cols && cols[p] && cols[p].type == "counter" ? "_counter" : "_register")] = obj[p];
        obj = o;
    }
    return obj;
}

Pool.prototype.query = function(client, req, options, callback)
{
    var self = this;
    var keys = db.getKeys(req.table, options);
    var key = keys.filter(function(x) { return req.obj[x] }).map(function(x) { return req.obj[x] }).join("|");

    switch (req.op) {
    case "create":
    case "upgrade":
        return callback(null, []);

    case "get":
        var path = this.getPath(req.table, key);
        this.doQuery("get", "GET", path, "", options, function(err, res, info) {
            if (err) return callback(err.status == 404 ? null : err, []);
            callback(null, [ self.getValue(res) ], info);
        });
        break;

    case "select":
        options.return_terms = "true";
        if (options.count) options.max_results = options.count;
        if (options.start) options.continuation = options.start;

        // Custom filter on other columns
        var cols = db.getColumns(req.table, options);
        var other = Object.keys(req.obj).filter(function(x) { return x[0] != "_" && keys.indexOf(x) == -1 && typeof req.obj[x] != "undefined" });
        var options2 = { keys: other, cols: cols, ops: options.ops, typesMap: options.typesMap || this.configOptions.typesMap };
        var filter = function(item) { return other.length > 0 ? db.filterRows(req.obj, [ item ], options2).length : 1; }

        var path = "/buckets/" + req.table + "/index/" + (options.sort || "primary_bin") + "/" + key.replace(/[\/]/g, "%2F");

        // Matching the beginning of the primary key
        if (keys.some(function(x) { return options.ops[x] == "begins_with" })) {
            path += "/" + key.substr(0, key.length - 1) + String.fromCharCode(key.charCodeAt(key.length - 1) + 1);
        }
        this.doQuery("select", "GET", path, "", options, function(err, res) {
            if (err) return callback(err, []);
            var rows = [];
            lib.forEachLimit(res.keys, options.concurrency || core.concurrency, function(key, next) {
                var path = self.getPath(req.table, key);
                self.doQuery("get", "GET", path, "", options, function(err, res, info) {
                    if (err && err.status != 404) return next(err);
                    res = self.getValue(res);
                    if (!err && filter(res)) rows.push(res);
                    next();
                });
            }, function(err) {
                client.next_token = res.continuation;
                callback(err, rows);
            });
        });
        break;

    case "list":
        var ids = req.obj.map(function(x) { return keys.map(function(y) { return x[y] || "" }).join("|"); });
        var rows = [];
        lib.forEachLimit(ids, options.concurrency || core.concurrency, function(key, next) {
            var path = self.getPath(req.table, key);
            self.doQuery("get", "GET", path, "", options, function(err, res, info) {
                if (err && err.status != 404) return next(err);
                if (!err) rows.push(self.getValue(res));
                next();
            });
        }, function(err) {
            callback(err, rows);
        });
        break;

    case "add":
    case "put":
        // Index by the hash property
        options.headers = { "x-riak-index-primary_bin": key };
        if (options.context) options.headers['x-riak-vclock'] = options.context;
        var cols = db.getColumns(req.table, options);
        var path = self.getPath(req.table, key);
        this.doQuery("put", "PUT", path, self.toValue(req.obj, cols), options, function(err, res) {
            callback(err, [], res);
        });
        break;

    case "incr":
    case "update":
        // Index by the hash property
        options.headers = { "x-riak-index-primary_bin": key };
        if (options.context) options.headers['x-riak-vclock'] = options.context;
        var cols = db.getColumns(req.table, options);
        var path = self.getPath(req.table, key);
        if (this.bucketType && this.useMaps) {
            this.doQuery("put", "PUT", key, self.toValue(req.obj, cols), options, function(err, res) {
                callback(err, [], res);
            });
            break;
        }
        this.doQuery("get", "GET", path, "", options, function(err, res, info) {
            if (err) return callback(err, []);
            for (var p in res) {
                if (options.updateOps && options.updateOps[p] == "incr") {
                    req.obj[p] = lib.toNumber(res[p]) + lib.toNumber(req.obj[p]);
                } else
                    if (!req.obj[p]) {
                        req.obj[p] = res[p];
                    }
            }
            if (info && info.context) options.headers['x-riak-vclock'] = info.context;
            self.doQuery("put", "PUT", key, req.obj, options, function(err, res) {
                callback(err, [], res);
            });
        });
        break;

    case "del":
        var path = self.getPath(req.table, key);
        this.doQuery("del", "DELETE", path, "", options, function(err, res) {
            callback(err, [], res);
        });
        break;

    default:
        this.doQuery("", req.op, req.text, req.obj, options, function(err, res) {
            callback(err, res);
        });
    }
}
