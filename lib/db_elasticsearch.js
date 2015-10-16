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

// Create a database pool that works with ElasticSearch server, the db pool connection url must include the index for all tables, like http://127.0.0.1:9200/billing,
// if not given the default database name will be used.
db.elasticsearchInitPool = function(options)
{
    var self = this;
    if (!options) options = {};
    if (!options.pool) options.pool = "elasticsearch";

    options.type = "elasticsearch";
    options.settings = { noJson: 1, noCacheColumns: 1, noJoinColumns: 1, strictTypes: 1 };
    var pool = this.createPool(options);

    // Native query parameters for each operation
    var _query = { index: ["op_type","version","routing","parent","timestamp","ttl","consistency","refresh","timeout","replication"],
                   del: ["version","routing","parent","consistency","refresh","timeout","replication"],
                   get: ["version","fields","routing","realtime","preference","refresh","_source","_source_include","_source_exclude"],
                   select: ["version","analyzer","analyze_wildcard","default_operator","df","explain","fields","from","ignore_unavailable",
                            "allow_no_indices","expand_wildcards","indices_boost","lenient","lowercase_expanded_terms","preference","q",
                            "routing","scroll","scroll_id","search_type","size","sort","_source","_source_include","_source_exclude","stats","local",
                            "terminate_after","suggest_field","suggest_mode","suggest_size","suggest_text","timeout","track_scores","query_cache"],
                   list: ["version","fields","routing","_source","_source_include","_source_exclude"] };

    function query(op, method, path, obj, opts, callback) {
        if (pool.url == "default") pool.url = "http://127.0.0.1:9200/" + db.dbName;
        var uri = pool.url + path;
        var params = { method: method, postdata: obj, query: {} };
        if (_query[op]) _query[op].forEach(function(x) { if (opts[x]) params.query[x] = opts[x] });

        core.httpGet(uri, params, function(err, params) {
            if (err) {
                logger.error("elasticsearch:", method, path, err);
                return callback(err, {});
            }
            var err = null;
            obj = lib.jsonParse(params.data, { obj: 1 });
            if (params.status >= 400) {
                err = lib.newError({ message: obj.reason || (method + " Error: " + params.status), code: obj.error, status: params.status });
            }
            callback(err, obj);
        });
    }

    pool.nextToken = function(client, req, rows, opts) {
        return opts.count && rows.length == opts.count ? lib.toNumber(opts.start) + lib.toNumber(opts.count) : null;
    }

    pool.query = function(client, req, opts, callback) {
        var keys = self.getKeys(req.table, opts);
        var dbcols = pool.dbcolumns[req.table] || {};

        switch (req.op) {
        case "select":
        case "search":
            if (typeof req.obj == "string") {
                opts.q = req.obj;
                req.obj = "";
            } else
            if (lib.isObject(req.obj)) {
                if (lib.isObject(req.obj.query)) {
                    // Native JSON request
                } else {
                    opts.q = Object.keys(req.obj).map(function(x) {
                        var val = req.obj[x];
                        var op = opts.ops[x];
                        switch (op) {
                        case "in": return x + ':' + (Array.isArray(val) ? '(' + val.map(function(y) { return '"' + y + '"' }).join(" OR ") + ')' : val);
                        case "ne": return x + ':-"' + val + '"';
                        case "gt": return x + ':>' + val;
                        case "lt": return x + ':<' + val;
                        case "ge": return x + ':>=' + val;
                        case "le": return x + ':<=' + val;
                        case "between": return x + ':' + (val.length == 2 ? '["' + val[0] + '" TO "' + val[1] + '"]' : val);
                        case "begins_with": return x + ':"' + val + '*"';
                        case "contains": return x + ':"*' + val + '*"';
                        case "not_contains": return x + ':>' + val;
                        default: return x + ':"' + val + '"';
                        }
                    }).join(" AND ");
                    req.obj = "";
                }
            } else {
                return callback(null, []);
            }

            var path = "/" + req.table +  "/" + (opts.op || "_search");
            if (opts.count) opts.size = opts.count;
            if (opts.select) opts.fields = String(opts.select);
            if (opts.sort_timeout) opts.scroll = lib.toNumber(opts.sort_timeout);
            if (opts.sort === null && !opts.search_type) {
                opts.search_type = "scan";
                if (!opts.scroll) opts.scroll = 60000;
            }
            if (opts.start) {
                if (lib.isNumeric(opts.start)) {
                    opts.from = opts.start;
                } else
                if (lib.isObject(opts.start)) {
                    opts.op = "scroll";
                    opts.scroll_id = opts.start.id;
                    if (!opts.scroll) opts.scroll = opts.start.scroll;
                    path = "/_search/scroll";
                }
            }
            opts.sort = db.getSortingColumn(req.table, opts);

            query("select", "POST", path, req.obj, opts, function(err, res) {
                if (err) return callback(err, []);
                if (res._scroll_id) res.next_token = { id: res._scroll_id, scroll: opts.scroll };
                var rows = [];
                if (res.hits) {
                    rows = res.hits.hits.map(function(x) { return x._source || x.fields || {} });
                    delete res.hits.hits;
                }
                // Scrolling scan, first response has no data
                if (res._scroll_id && opts.search_type == "scan" && !opts.op && !opts.start) {
                    opts.start = res.next_token;
                    pool.query(client, req, opts, callback);
                } else {
                    if (res._scroll_id && !rows.length) res.next_token = null;
                    callback(null, rows, res);
                }
            });
            break;

        case "list":
            if (opts.count) opts.searchSize = opts.count;
            if (opts.select) opts.fields = String(opts.select);
            var ids = req.obj.map(function(x) { return Object.keys(x).map(function(y) { return x[y]}).join("|") });
            var path = "/" + req.table +  "/_mget";
            query("list", "GET", path, { ids: ids }, opts, function(err, res) {
                if (err) return callback(err, []);
                var rows = res.docs ? res.docs.map(function(x) { return x._source || x.fields || {} }) : [];
                delete res.docs;
                callback(null, rows, res);
            });
            break;

        case "get":
            var path = "/" + req.table +  "/" + keys.filter(function(x) { return req.obj[x] }).map(function(x) { return req.obj[x] }).join("|").replace(/[\/]/g, "%2F");
            if (opts.select) opts.fields = String(opts.select);
            query("get", "GET", path, "", opts, function(err, res) {
                if (err) return callback(err, []);
                callback(null, [ res._source || res.fields || {} ], res);
            });
            break;

        case "add":
            opts.op_type = "create";
        case "put":
        case "incr":
        case "update":
            var path = "/" + req.table +  "/" + keys.filter(function(x) { return req.obj[x] }).map(function(x) { return req.obj[x] }).join("|").replace(/[\/]/g, "%2F");
            query("index", "PUT", path, req.obj, opts, function(err, res) {
                if (!err) res.affected_rows = 1;
                if (err && err.status == 409) err.code = "AlreadyExists";
                callback(err, [], res);
            });
            break;

        case "del":
            var path = "/" + req.table +  "/" + keys.filter(function(x) { return req.obj[x] }).map(function(x) { return req.obj[x] }).join("|").replace(/[\/]/g, "%2F");
            query("del", "DELETE", path, "", opts, function(err, res) {
                if (!err) res.affected_rows = 1;
                if (err && err.status == 404) err = null;
                callback(err, [], res);
            });
            break;

        default:
            callback(null, []);
        }
    }

    return pool;
}

