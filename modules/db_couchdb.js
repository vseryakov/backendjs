//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var util = require('util');
var core = require(__dirname + '/../core');
var lib = require(__dirname + '/../lib');
var db = require(__dirname + '/../db');
var logger = require(__dirname + '/../logger');

// Create a database pool that works with CouchDB server.
//
// In addition to the standard commands it can execute any CouchDB HTTP API directly
//
//      db.query({ op: "GET", text: "/db/url" }, { pool: "couchdb" }, lib.log)
//      db.query({ op: "PUT", text: "/db/url", obj: { a: 1 b: 2 } }, { pool: "couchdb" }, lib.log)
//
var pool = {
    name: "couchdb",
    query: {
        get : ["attachments","att_encoding_info","atts_since","conflicts","deleted_conflicts","latest","local_seq","meta","open_revs","rev","revs","revs_info"],
        select: ["conflicts","descending","endkey","end_key","endkey_docid","end_key_doc_id","group","group_level","include_docs","attachments","att_encoding_info",
            "inclusive_end","key","limit","reduce","skip","stale","startkey","start_key","startkey_docid","start_key_doc_id","update_seq"],
        put: ["batch"],
        del: ["rev", "batch"]
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
    if (this.url == "default") this.url = "http://127.0.0.1:5984/" + db.dbName;
    var uri = this.url + "/" + path;
    var params = { method: method, postdata: method != "GET" ? obj : "", query: {} };
    if (pool.query[op]) pool.query[op].forEach(function(x) { if (options[x]) params.query[x] = options[x] });

    core.httpGet(uri, params, function(err, params) {
        if (err) {
            logger.error("couchdb:", method, path, err);
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

Pool.prototype.query = function(client, req, options, callback)
{
    var self = this;
    var keys = db.getKeys(req.table, options);
    var key = req.table + "|" + keys.filter(function(x) { return req.obj[x] }).map(function(x) { return req.obj[x] }).join("|");

    switch (req.op) {
    case "create":
    case "upgrade":
        var views = {}, changed = 0;
        var cols = Object.keys(lib.searchObj(req.obj, { name: 'primary', sort: 1, flag: 1 }));
        if (cols.length) views.primary = cols;

        ["", "1", "2", "3", "4", "5"].forEach(function(n) {
            var cols = Object.keys(lib.searchObj(req.obj, { name: "unique" + n, sort: 1, flag: 1 }));
            if (cols.length) views[cols.join("_")] = cols;
            cols = Object.keys(lib.searchObj(req.obj, { name: "index" + n, sort: 1, flag: 1 }));
            if (cols.length) views[cols.join("_")] = cols;
        });

        this.doQuery("get", "GET", "_design/" + req.table, "", {}, function(err, res) {
            if (err && err.status != 404) return callback(err);
            if (!res || !res.views) res = { id: "_design/" + req.table, language: "javascript", views: {} }, changed = 1;
            Object.keys(views).forEach(function(view) {
                if (res.views[view]) return;
                var cols = views[view];
                res.views[view] = { map: "function(doc) { if (" + cols.map(function(x) { return "doc." + x }).join(" && ") + ") emit(" + (cols.map(function(x) { return "doc." + x }).join("+'|'+")) + ", doc); }" };
                changed = 1;
            });
            if (!changed) return callback(err, []);
            self.doQuery("put", "PUT", "_design/" + req.table, res, {}, function(err, res) {
                callback(err, []);
            });
        });
        break;

    case "get":
        key = key.replace(/[\/]/g, "%2F");
        this.doQuery("get", "GET", key, "", options, function(err, res) {
            if (err) return callback(err.status == 404 ? null : err, []);
            callback(null, [ res ]);
        });
        break;

    case "select":
        if (options.desc) options.descending = true;
        if (options.count) options.limit = options.count;
        if (options.start) options.skip = options.start;
        options.startkey = key;
        // Matching the beginning of the primary key
        if (keys.some(function(x) { return options.ops[x] == "begins_with" })) {
            options.endkey = key.substr(0, key.length - 1) + String.fromCharCode(key.charCodeAt(key.length - 1) + 1);
        }
        // Custom filter on other columns
        var cols = db.getColumns(req.table, options);
        var other = Object.keys(req.obj).filter(function(x) { return x[0] != "_" && keys.indexOf(x) == -1 && typeof req.obj[x] != "undefined" });
        var options2 = { keys: other, cols: cols, ops: options.ops, typesMap: options.typesMap };
        var filter = function(items) { return other.length > 0 ? self.filterRows(req.obj, items, options2) : items; }

        this.doQuery("select", "GET", "_design/" + req.table + "/_view/" + (options.sort || "primary"), "", options, function(err, res) {
            if (err) return callback(err, []);
            callback(null, filter(res.rows.map(function(x) { return x.value })));
        });
        break;

    case "list":
        var ids = req.obj.map(function(x) { return req.table + "|" + keys.map(function(y) { return x[y] || "" }).join("|"); });
        var rows = [];
        lib.forEachLimit(ids, options.concurrency || core.concurrency, function(key, next) {
            key = key.replace(/[\/]/g, "%2F");
            self.doQuery("get", "GET", key, "", options, function(err, res) {
                if (err && err.status != 404) return next(err);
                if (!err) rows.push(res);
                next();
            });
        }, function(err) {
            callback(err, rows);
        });
        break;

    case "add":
    case "put":
        req.obj._id = key;
        this.doQuery("put", "POST", "", req.obj, options, function(err, res) {
            callback(err, [], res);
        });
        break;

    case "incr":
    case "update":
        req.obj._id = key;
        key = key.replace(/[\/]/g, "%2F");
        // Not a full document, retrieve the latest revision
        if (req.obj._rev && req.obj._id) {
            this.doQuery("PUT", key, req.obj, options, function(err, res) {
                callback(err, [], res);
            });
        } else {
            this.doQuery("get", "GET", key, "", options, function(err, res) {
                if (err) return callback(err, []);
                for (var p in res) {
                    if (options.updateOps && options.updateOps[x] == "incr") {
                        req.obj[p] = lib.toNumber(res[p]) + lib.toNumber(req.obj[p]);
                    } else
                    if (!req.obj[p]) {
                        req.obj[p] = res[p];
                    }
                }
                self.doQuery("put", "PUT", key, req.obj, options, function(err, res) {
                    callback(err, [], res);
                });
            });
        }
        break;

    case "del":
        key = key.replace(/[\/]/g, "%2F");
        this.doQuery("del", "DELETE", key, "", options, function(err, res) {
            callback(err, [], res);
        });
        break;

    default:
        this.doQuery("", req.op, req.text, req.obj, options, function(err, res) {
            callback(err, res);
        });
    }
}
