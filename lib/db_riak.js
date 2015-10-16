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
//      db.query({ op: "GET", text: "/buckets?buckets=true" }, { pool: "riak" }, db.showResult)
//      db.query({ op: "POST", text: "/buckets/bucket/counter/name", obj: 1 }, { pool: "riak" }, db.showResult)
//
db.riakInitPool = function(options)
{
    var self = this;
    if (!options) options = {};
    if (!options.pool) options.pool = "riak";

    options.type = "riak";
    options.url = url.format(u);
    var pool = this.createPool(options);

    // Native query parameters for each operation
    var _query = { del: ["rw", "pr", "w", "dw", "pw"],
                   get: ["r","pr","basic_quorum","notfound_ok","vtag"],
                   put: ["w","dw","pw","returnbody"],
                   select: ["return_terms","max_results","continuation"], };

    function query(op, method, path, obj, opts, callback) {
        if (pool.url == "default") pool.url = "http://127.0.0.1:8098";
        var uri = pool.url + path;
        var params = { method: method, postdata: method != "GET" ? obj : "", query: {}, headers: { "content-type": "application/json" } };
        if (_query[op]) _query[op].forEach(function(x) { if (opts[x]) params.query[x] = opts[x] });
        for (var p in opts.headers) params.headers[p] = opts.headers[p];

        core.httpGet(uri, params, function(err, params) {
            if (err) {
                logger.error("riak:", method, path, err);
                return callback(err, {});
            }
            var err = null;
            obj = lib.jsonParse(params.data, { obj: 1 });
            if (params.status >= 400) {
                err = lib.newError({ message: params.data || (method + " Error: " + params.status), code: obj.error, status: params.status });
            }
            callback(err, obj, { context: params.headers['x-riak-vclock'] });
        });
    }

    function getPath(table, key) {
        if (pool.bucketType) {
            return "/types/" + pool.bucketType + "/buckets/" + table + (pool.useMaps ? "/datatypes/" : "/keys/") + key.replace(/[\/]/g, "%2F");
        }
        return "/buckets/" + table + "/keys/" + key.replace(/[\/]/g, "%2F");
    }
    function getValue(obj) {
        if (pool.bucketType && pool.useMaps && obj.value) {
            var o = {};
            for (var p in obj.value) o[p.replace(/(_register|_flag|_counter)$/, "")] = obj[p];
            obj = o;
        }
        return obj;
    }
    function toValue(obj, cols) {
        if (pool.bucketType && pool.useMaps) {
            var o = { update: {} };
            for (var p in obj) o.update[p + (cols && cols[p] && cols[p].type == "counter" ? "_counter" : "_register")] = obj[p];
            obj = o;
        }
        return obj;
    }

    pool.query = function(client, req, opts, callback) {
        var keys = self.getKeys(req.table, opts);
        var key = keys.filter(function(x) { return req.obj[x] }).map(function(x) { return req.obj[x] }).join("|");

        switch (req.op) {
        case "create":
        case "upgrade":
            return callback(null, []);

        case "get":
            var path = getPath(req.table, key);
            query("get", "GET", path, "", opts, function(err, res, info) {
                if (err) return callback(err.status == 404 ? null : err, []);
                callback(null, [ getValue(res) ], info);
            });
            break;

        case "select":
            opts.return_terms = "true";
            if (opts.count) opts.max_results = opts.count;
            if (opts.start) opts.continuation = opts.start;

            // Custom filter on other columns
            var cols = self.getColumns(req.table, opts);
            var other = Object.keys(req.obj).filter(function(x) { return x[0] != "_" && keys.indexOf(x) == -1 && typeof req.obj[x] != "undefined" });
            var opts2 = { keys: other, cols: cols, ops: opts.ops, typesMap: opts.typesMap };
            var filter = function(item) { return other.length > 0 ? self.filterRows(req.obj, [ item ], opts2).length : 1; }

            var path = "/buckets/" + req.table + "/index/" + (opts.sort || "primary_bin") + "/" + key.replace(/[\/]/g, "%2F");

            // Matching the beginning of the primary key
            if (keys.some(function(x) { return opts.ops[x] == "begins_with" })) {
                path += "/" + key.substr(0, key.length - 1) + String.fromCharCode(key.charCodeAt(key.length - 1) + 1);
            }
            query("select", "GET", path, "", opts, function(err, res) {
                if (err) return callback(err, []);
                var rows = [];
                lib.forEachLimit(res.keys, opts.concurrency || core.concurrency, function(key, next) {
                    var path = getPath(req.table, key);
                    query("get", "GET", path, "", opts, function(err, res, info) {
                        if (err && err.status != 404) return next(err);
                        res = getValue(res);
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
            lib.forEachLimit(ids, opts.concurrency || core.concurrency, function(key, next) {
                var path = getPath(req.table, key);
                query("get", "GET", path, "", opts, function(err, res, info) {
                    if (err && err.status != 404) return next(err);
                    if (!err) rows.push(getValue(res));
                    next();
                });
            }, function(err) {
                callback(err, rows);
            });
            break;

        case "add":
        case "put":
            // Index by the hash property
            opts.headers = { "x-riak-index-primary_bin": key };
            if (opts.context) opts.headers['x-riak-vclock'] = opts.context;
            var cols = self.getColumns(req.table, opts);
            var path = getPath(req.table, key);
            query("put", "PUT", path, toValue(req.obj, cols), opts, function(err, res) {
                callback(err, [], res);
            });
            break;

        case "incr":
        case "update":
            // Index by the hash property
            opts.headers = { "x-riak-index-primary_bin": key };
            if (opts.context) opts.headers['x-riak-vclock'] = opts.context;
            var cols = self.getColumns(req.table, opts);
            var path = getPath(req.table, key);
            if (pool.bucketType && pool.useMaps) {
                query("put", "PUT", key, toValue(req.obj, cols), opts, function(err, res) {
                    callback(err, [], res);
                });
                break;
            }
            query("get", "GET", path, "", opts, function(err, res, info) {
                if (err) return callback(err, []);
                for (var p in res) {
                    if (opts.updateOps && opts.updateOps[p] == "incr") {
                        req.obj[p] = lib.toNumber(res[p]) + lib.toNumber(req.obj[p]);
                    } else
                    if (!req.obj[p]) {
                        req.obj[p] = res[p];
                    }
                }
                if (info && info.context) opts.headers['x-riak-vclock'] = info.context;
                query("put", "PUT", key, req.obj, opts, function(err, res) {
                    callback(err, [], res);
                });
            });
            break;

        case "del":
            var path = getPath(req.table, key);
            query("del", "DELETE", path, "", opts, function(err, res) {
                callback(err, [], res);
            });
            break;

        default:
            query("", req.op, req.text, req.obj, opts, function(err, res) {
                callback(err, res);
            });
        }
    }

    return pool;
}
