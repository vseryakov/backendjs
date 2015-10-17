//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var util = require('util');
var core = require(__dirname + '/../core');
var lib = require(__dirname + '/../lib');
var db = require(__dirname + '/../db');
var logger = require(__dirname + '/../logger');

// Create a database pool that works with ElasticSearch server, the db pool connection url must include the index for all tables, like http://127.0.0.1:9200/billing,
// if not given the default database name will be used.
var pool = {
    name: "elasticsearch",
    settings: {
        noJson: 1,
        noCacheColumns: 1,
        noJoinColumns: 1,
        strictTypes: 1
    },
    // Native query parameters for each operation
    query: {
        index: ["op_type","version","routing","parent","timestamp","ttl","consistency","refresh","timeout","replication"],
        del: ["version","routing","parent","consistency","refresh","timeout","replication"],
        get: ["version","fields","routing","realtime","preference","refresh","_source","_source_include","_source_exclude"],
        select: ["version","analyzer","analyze_wildcard","default_operator","df","explain","fields","from","ignore_unavailable",
            "allow_no_indices","expand_wildcards","indices_boost","lenient","lowercase_expanded_terms","preference","q",
            "routing","scroll","scroll_id","search_type","size","sort","_source","_source_include","_source_exclude","stats","local",
            "terminate_after","suggest_field","suggest_mode","suggest_size","suggest_text","timeout","track_scores","query_cache"],
        list: ["version","fields","routing","_source","_source_include","_source_exclude"]
    },
    createPool: function(options) { return new Pool(options); }
};
module.exports = pool;

db.modules.push(pool);

function Pool(options)
{
    options.type = pool.name;
    options.settings = lib.mergeObj(pool.settings, options.settings);
    db.Pool.call(this, options);
}
util.inherits(Pool, db.Pool);

Pool.prototype.doQuery = function(op, method, path, obj, options, callback)
{
    if (this.url == "default") this.url = "http://127.0.0.1:9200/" + db.dbName;
    var uri = this.url + path;
    var params = { method: method, postdata: obj, query: {} };
    if (pool.query[op]) pool.query[op].forEach(function(x) { if (options[x]) params.query[x] = options[x] });

    core.httpGet(uri, params, function(err, params) {
        if (err) {
            logger.error("elasticsearch:", method, path, err);
            return callback(err, {});
        }
        err = null;
        obj = lib.jsonParse(params.data, { obj: 1 });
        if (params.status >= 400) {
            err = lib.newError({ message: obj.reason || (method + " Error: " + params.status), code: obj.error, status: params.status });
        }
        callback(err, obj);
    });
}

Pool.prototype.nextToken = function(client, req, rows, options)
{
    return options.count && rows.length == options.count ? lib.toNumber(options.start) + lib.toNumber(options.count) : null;
}

Pool.prototype.query = function(client, req, options, callback)
{
    var self = this;
    var keys = db.getKeys(req.table, options);
    var dbcols = this.dbcolumns[req.table] || {};

    switch (req.op) {
    case "select":
    case "search":
        if (typeof req.obj == "string") {
            options.q = req.obj;
            req.obj = "";
        } else
        if (lib.isObject(req.obj)) {
            if (lib.isObject(req.obj.query)) {
                // Native JSON request
            } else {
                options.q = Object.keys(req.obj).map(function(x) {
                    var val = req.obj[x];
                    var op = options.ops[x];
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

        var path = "/" + req.table +  "/" + (options.op || "_search");
        if (options.count) options.size = options.count;
        if (options.select) options.fields = String(options.select);
        if (options.sort_timeout) options.scroll = lib.toNumber(options.sort_timeout);
        if (options.sort === null && !options.search_type) {
            options.search_type = "scan";
            if (!options.scroll) options.scroll = 60000;
        }
        if (options.start) {
            if (lib.isNumeric(options.start)) {
                options.from = options.start;
            } else
            if (lib.isObject(options.start)) {
                options.op = "scroll";
                options.scroll_id = options.start.id;
                if (!options.scroll) options.scroll = options.start.scroll;
                path = "/_search/scroll";
            }
        }
        options.sort = db.getSortingColumn(req.table, options);

        this.doQuery("select", "POST", path, req.obj, options, function(err, res) {
            if (err) return callback(err, []);
            if (res._scroll_id) res.next_token = { id: res._scroll_id, scroll: options.scroll };
            var rows = [];
            if (res.hits) {
                rows = res.hits.hits.map(function(x) { return x._source || x.fields || {} });
                delete res.hits.hits;
            }
            // Scrolling scan, first response has no data
            if (res._scroll_id && options.search_type == "scan" && !options.op && !options.start) {
                options.start = res.next_token;
                self.query(client, req, options, callback);
            } else {
                if (res._scroll_id && !rows.length) res.next_token = null;
                callback(null, rows, res);
            }
        });
        break;

    case "list":
        if (options.count) options.searchSize = options.count;
        if (options.select) options.fields = String(options.select);
        var ids = req.obj.map(function(x) { return Object.keys(x).map(function(y) { return x[y]}).join("|") });
        var path = "/" + req.table +  "/_mget";
        this.doQuery("list", "GET", path, { ids: ids }, options, function(err, res) {
            if (err) return callback(err, []);
            var rows = res.docs ? res.docs.map(function(x) { return x._source || x.fields || {} }) : [];
            delete res.docs;
            callback(null, rows, res);
        });
        break;

    case "get":
        var path = "/" + req.table +  "/" + keys.filter(function(x) { return req.obj[x] }).map(function(x) { return req.obj[x] }).join("|").replace(/[\/]/g, "%2F");
        if (options.select) options.fields = String(options.select);
        this.doQuery("get", "GET", path, "", options, function(err, res) {
            if (err) return callback(err, []);
            callback(null, [ res._source || res.fields || {} ], res);
        });
        break;

    case "add":
        options.op_type = "create";
    case "put":
    case "incr":
    case "update":
        var path = "/" + req.table +  "/" + keys.filter(function(x) { return req.obj[x] }).map(function(x) { return req.obj[x] }).join("|").replace(/[\/]/g, "%2F");
        this.doQuery("index", "PUT", path, req.obj, options, function(err, res) {
            if (!err) res.affected_rows = 1;
            if (err && err.status == 409) err.code = "AlreadyExists";
            callback(err, [], res);
        });
        break;

    case "del":
        var path = "/" + req.table +  "/" + keys.filter(function(x) { return req.obj[x] }).map(function(x) { return req.obj[x] }).join("|").replace(/[\/]/g, "%2F");
        this.doQuery("del", "DELETE", path, "", options, function(err, res) {
            if (!err) res.affected_rows = 1;
            if (err && err.status == 404) err = null;
            callback(err, [], res);
        });
        break;

    default:
        callback(null, []);
    }

}

