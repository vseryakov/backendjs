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
        index: ["op_type","version","version_type","routing","parent","timestamp","ttl","consistency","retry_on_conflict","refresh","timeout","replication"],
        del: ["version","routing","parent","consistency","refresh","timeout","replication"],
        get: ["version","fields","routing","realtime","preference","refresh","_source","_source_include","_source_exclude"],
        select: ["version","analyzer","analyze_wildcard","default_operator","df","explain","fields","from","ignore_unavailable",
            "allow_no_indices","expand_wildcards","indices_boost","lenient","local","lowercase_expanded_terms","preference","q",
            "routing","request_cache","scroll","scroll_id","search_type","size","sort","_source","_source_include","_source_exclude","stats",
            "suggest_field","suggest_mode","suggest_size","suggest_text","timeout","terminate_after","track_scores","query_cache"],
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
    var uri = this.url == "default" ? "http://127.0.0.1:9200/" + db.dbName : this.url;
    var params = { method: method, postdata: obj, query: {}, datatype: "obj" };
    if (pool.query[op]) pool.query[op].forEach(function(x) { if (options[x]) params.query[x] = options[x] });
    if (path[0] == "/") {
        uri = uri.split("/").slice(0, -1).join("/") + path;
    } else {
        uri += "/" + path;
    }
    core.httpGet(uri, params, function(err, params) {
        if (err) {
            logger.debug("elasticsearch:", method, uri, "OBJ:", params.obj, "ERR:", err);
            return callback(err, {});
        }
        err = null;
        var rc = params.obj;
        if (params.status >= 400) {
            err = lib.newError({ message: (rc.error && rc.error.reason) || (method + " Error: " + params.status), code: rc.error && rc.error.type, status: params.status });
            logger.debug("elasticsearch:", method, uri, params.query, "OBJ:", obj, "ERR:", rc);
        }
        callback(err, rc);
    });
}

Pool.prototype.nextToken = function(client, req, rows, options)
{
    return options.count && rows.length == options.count ? lib.toNumber(options.start) + lib.toNumber(options.count) : null;
}

Pool.prototype._getKey = function(keys, obj)
{
    return keys.filter(function(x) { return obj[x] }).map(function(x) { return obj[x] }).join("|").replace(/[\/]/g, "%2F")
}

Pool.prototype._getTerm = function(str)
{
    return str ? str.indexOf(" ") > -1 ? '"' + str + '"' : str : "";
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
                    if (typeof val == "undefined") return 0;
                    if (x != "q" && !dbcols[x]) return 0;
                    if (typeof val == "string") val = val.trim();
                    var op = options.ops[x] || (val === null ? "ne" : "");
                    var n = x && x != "q" ? x + ":" : "";
                    switch (op) {
                    case "ne": return n + '-' + val;
                    case "gt": return n + '>' + val;
                    case "lt": return n + '<' + val;
                    case "ge": return n + '>=' + val;
                    case "le": return n + '<=' + val;
                    case "in": return n + (Array.isArray(val) ? '(' + val.join(" OR ") + ')' : val);
                    case "between": return n + (val.length == 2 ? '[' + val[0] + ' TO ' + val[1] + ']' : val);
                    case "begins_with": return Array.isArray(val) ? val.map(function(y) { return n + y + '*' }).join(" AND ") : n + val + '*';
                    case "contains": return Array.isArray(val) ? val.map(function(y) { return n + '*' + y + '*' }).join(" AND ") : n + '*' + val + '*';
                    case "not_contains": return Array.isArray(val) ? val.map(function(y) { return n + '>' + y }).join(" AND ") : n + '>' + val;
                    default: return Array.isArray(val) ? val.map(function(y) { return n + '"' + y + '"' }).join(" AND ") : n + val;
                    }
                }).filter(function(x) {
                    return x;
                }).join(options.or ? " OR " : " AND ");
                req.obj = "";
            }
        } else {
            return callback(null, []);
        }

        var method = "POST";
        var path = req.table +  "/" + (options.op || "_search");
        if (options.count) options.size = options.count;
        if (options.select) options.fields = String(options.select);
        if (options.sort_timeout) options.scroll = lib.toNumber(options.sort_timeout) + "ms";
        if (options.start) {
            if (lib.isNumeric(options.start)) {
                options.from = options.start;
            } else
            if (lib.isObject(options.start)) {
                options.scroll_id = options.start.id;
                if (!options.scroll) options.scroll = options.start.scroll;
                path = "/_search/scroll";
                method = "GET";
            }
        }
        options.sort = db.getSortingColumn(req.table, options);
        if (options.sort && options.desc) options.sort += ":desc";

        this.doQuery("select", method, path, req.obj, options, function(err, res) {
            if (err) return callback(err, []);
            if (res._scroll_id) res.next_token = { id: res._scroll_id, scroll: options.scroll };
            var rows = [];
            if (res.hits) {
                rows = res.hits.hits.map(function(x) { return x._source || x.fields || {} });
                delete res.hits.hits;
            }
            if (res._scroll_id && !rows.length) res.next_token = null;
            callback(null, rows, res);
        });
        break;

    case "list":
        if (options.count) options.searchSize = options.count;
        if (options.select) options.fields = String(options.select);
        var ids = req.obj.map(function(x) { return self._getKey(Object.keys(x), x) });
        var path = req.table +  "/_mget";
        this.doQuery("list", "GET", path, { ids: ids }, options, function(err, res) {
            if (err) return callback(err, []);
            var rows = res.docs ? res.docs.map(function(x) { return x._source || x.fields || {} }) : [];
            delete res.docs;
            callback(null, rows, res);
        });
        break;

    case "get":
        var path = req.table +  "/" + this._getKey(keys, req.obj);
        if (options.select) options.fields = String(options.select);
        this.doQuery("get", "GET", path, "", options, function(err, res) {
            if (err) return callback(err, []);
            callback(null, [ res._source || res.fields || {} ], res);
        });
        break;

    case "add":
        options.op_type = "create";
    case "put":
        var path = req.table +  "/" + this._getKey(keys, req.obj);
        this.doQuery("index", "PUT", path, req.obj, options, function(err, res) {
            if (!err) res.affected_rows = 1;
            if (err && err.status == 409) err.code = "AlreadyExists";
            callback(err, [], res);
        });
        break;

    case "incr":
    case "update":
        var path = req.table +  "/" + this._getKey(keys, req.obj) + "/_update";
        if (!options.noscript && lib.isObject(options.updateOps) && Object.keys(options.updateOps).length) {
            var query = { script: { inline: "", params: {} }, scripted_upsert: true, upsert: {} };
            for (var p in req.obj) {
                switch (options.updateOps && options.updateOps[p]) {
                case "incr":
                    query.script.inline += "if (!ctx._source." + p + ") ctx._source." + p + " = " + p + " else ctx._source." + p + " += " + p + ";";
                    query.script.params[p] = req.obj[p];
                    query.upsert[p] = 0;
                    break;
                case "remove":
                    query.script.inline += "ctx._source.remove(\"" + p + "\");";
                    break;
                default:
                    query.script.inline += "ctx._source." + p + " = " + p + ";";
                    query.script.params[p] = req.obj[p];
                }
            }
        } else {
            var query = { doc: req.obj  };
            if (options.upsert) query.doc_as_upsert = true;
        }
        if (typeof options.retry_on_conflict == "undefined") options.retry_on_conflict = 3;
        if (options.returning == "*") query.fields = ["_source"];

        this.doQuery("index", "POST", path, query, options, function(err, res) {
            if (!err) res.affected_rows = 1;
            if (err && err.status == 409) err.code = "AlreadyExists";
            if (err && err.status == 404) err.code = "NotFound";
            callback(err, [], res);
        });
        break;

    case "del":
        var path = req.table +  "/" + this._getKey(keys, req.obj);
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

