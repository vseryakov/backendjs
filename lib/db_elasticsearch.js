//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var url = require('url');
var util = require('util');
var core = require(__dirname + '/core');
var lib = require(__dirname + '/lib');
var db = require(__dirname + '/db');
var logger = require(__dirname + '/logger');

// Create a database pool that works with ElasticSearch server, only the hostname and port will be used, by default each table
// is stored in its own index.
//
// To combine different tables in the same index define the index mapping: `-db-elasticsearch-pool-options-index-table-INDEX_NAME=TABLES_REGEXP`,
// for example: `-db-elasticsearch-pool-options-index-table-users=(account|auth)` to place all account tables into the index `users`.
//
// To define shards and replicas per index:
//  - `-db-elasticsearch-pool-options-shards-INDEX_NAME=NUM`
//  - `-db-elasticsearch-pool-options-replicas-INDEX_NAME=NUM`
//
// To support multiple seed nodes a parameter `-db-elasticsearch-pool-options-servers=1.1.1.1,2.2.2.2` can be specified, if the primary node
// fails it will switch to other configured nodes. To control the switch retries and timeout there are options:
//  - `-db-elasticsearch-pool-options-retry-count=3`
//  - `-db-elasticsearch-pool-options-retry-timeout=250`
//
// On successful connect to any node the driver retrieves full list of nodes in the cluster and switches to a random node, this happens
// every `discovery-interval` in milliseconds, default is 1h, it can be specified as `-db-elasticserch-pool-options-discovery-interval=300000`
//
var pool = {
    name: "elasticsearch",
    configOptions: {
        noJson: 1,
        strictTypes: 1,
        sort_timeout: "60000ms",
        retryCount: 3,
        refreshInterval: 2000,
        refreshBackoff: 1.2,
        discoveryInterval: 3600000,
        discoveryDelay: 500,
        searchable: 1,
        shards: 5,
        replicas: 2,
        typesMap: {
            float: "float", real: "float",
            bigint: "long", int: "integer",
            now: { type: "date", format: "epoch_millis" },
            mtime: { type: "date", format: "epoch_millis" },
            bool: "boolean",
            text: "string", string: "string", json: "string",
            array: "nested", object: "object",
            geohash: "geo_point", geopoint: "geo_point",
        },
    },
    // Native query parameters for each operation
    query: {
        index: ["op_type","version","version_type","routing","parent","timestamp","ttl","consistency","retry_on_conflict","refresh","timeout","replication"],
        del: ["version","routing","parent","consistency","refresh","timeout","replication"],
        get: ["version","fields","routing","realtime","preference","refresh","_source","_source_include","_source_exclude"],
        select: ["version","analyzer","analyze_wildcard","default_operator","df","explain","fields","from","ignore_unavailable",
            "allow_no_indices","expand_wildcards","indices_boost","lenient","local","lowercase_expanded_terms","preference","q",
            "routing","request_cache","scroll","scroll_id","search_type","size","sort","order","_source","_source_include","_source_exclude","stats",
            "suggest_field","suggest_mode","suggest_size","suggest_text","timeout","terminate_after","track_scores","query_cache"],
        list: ["version","fields","routing","_source","_source_include","_source_exclude"]
    },
    escapeRx: /([+=&|><!(){}\[\]^"~*?:/\\-])/g,
    createPool: function(options) { return new Pool(options); }
};
module.exports = pool;

db.modules.push(pool);

pool.parsePoolOptions = function(val, options)
{
    if (options.keys[2] && options.keys[2].indexOf("index-table-") == 0) {
        options.name = options.keys[2].split("-").slice(-1);
        options.obj += ".indexTable";
        options.type = "regexp";
        options.make = "";
    }
}

function Pool(options)
{
    options.type = pool.name;
    db.Pool.call(this, options);
    this.configOptions = lib.mergeObj(this.configOptions, pool.configOptions);
    this._errors = {};
    this._nodes = [];
    setTimeout(this._getNodes.bind(this), this.configOptions.discoveryDelay || 500);
}
util.inherits(Pool, db.Pool);

Pool.prototype._getNodes = function()
{
    var self = this;
    clearTimeout(this._nodesTimer);
    this.doQuery("", "", "GET", "/_nodes", "", { quiet: 1 }, function(err, data, params) {
        if (err) logger.error("elasticsearch:", "getNodes:", err, self._nodes, params.toJSON());
        if (!err && data && typeof data.nodes == "object") {
            var nodes = Object.keys(data.nodes).filter(function(x) {
                // Do not use dedicated master nodes
                var attrs = data.nodes[x].attributes;
                return !attrs || !(attrs.data == "false" && attrs.master == "true");
            }).map(function(x) {
                return data.nodes[x].http_address;
            }).concat(self.url);
            self._nodes = lib.shuffle(nodes);
            // Pick a random node
            if (self._nodes.length) self._node = self._nodes[self._nodes.length - 1];
        }
        // Increase with every consequetive error
        self._nodesInterval = ((err ? self._nodesInterval : 0) || self.configOptions.refreshInterval) * (err ? self.configOptions.refreshBackoff : 1);
        var interval = !err && self._nodes.length ? self.configOptions.discoveryInterval || 300000 : self._nodesInterval;
        self._nodesTimer = setTimeout(self._getNodes.bind(self), interval);
        logger.debug("elasticsearch:", "getNodes:", self._node, "nodes:", self._nodes, "interval:", self._nodesInterval, interval);
    });
}

Pool.prototype._nextNode = function(err, params)
{
    if (!this._errors[this._node]) this._errors[this._node] = 0;
    if (err || (params.retryTotal > 0 && params.retryCount <= 0)) {
        this._errors[this._node]++;
        if (params.retryNode + 1 < this._nodes.length) {
            var node = this._nodes.shift();
            if (node) {
                this._nodes.push(node);
            } else {
                this._servers = lib.strSplit(this.configOptions.servers);
                node = this._servers.shift();
                if (node) this._servers.push(node);
            }
            if (node) {
                this._node = node;
                logger.debug("elasticsearch:", this.url, "trying", this._node, "of", this._nodes, this._servers, "count:", params.nextCount);
                return true;
            }
        }
    } else {
        // Trigger nodes update on server available again
        if (this._errors[this._node] > 1) this._getNodes();
        this._errors[this._node] = 0;
    }
}

Pool.prototype._getNodeUrl = function(node, table)
{
    if (!node) node = this.url;
    if (node == "default") node = "http://127.0.0.1:9200";
    if (!node.match(/^https?:/)) node = "http://" + node;
    var h = url.parse(node);
    if (!this._node) this._node = h.host;
    return [ h.protocol + "//" + h.host, this._getIndex(table) ];
}

Pool.prototype._getIndex = function(table)
{
    if (!table) return;
    var tables = this.configOptions.indexTable;
    for (var p in tables) {
        if (table.match(tables[p])) return p;
    }
    return table;
}

Pool.prototype.doQuery = function(op, table, method, path, obj, options, callback)
{
    var self = this;
    var opts = {
        method: method,
        postdata: obj,
        query: {},
        datatype: "obj",
        quiet: options.quiet,
        retryCount: options.retryCount || this.configOptions.retryCount,
        retryTimeout: options.retryTimeout || this.configOptions.retryTimeout,
        retryOnError: function() { return !this.status || this.status == 429 || this.status >= 500 },
        retryNode: options.retryNode || 0,
    };
    if (pool.query[op]) {
        pool.query[op].forEach(function(x) { if (options[x]) opts.query[x] = options[x] });
    }
    var uri = this._getNodeUrl(this._node, table);
    if (path[0] == "/") {
        uri = uri[0] + path;
    } else {
        uri = uri[0] + "/" + uri[1] + "/" + path;
    }
    logger.dev("elasticsearch:", op, table, uri, opts);
    core.httpGet(uri, opts, function(err, params) {
        if (self._nextNode(err, params)) {
            opts.retryNode++;
            return self.doQuery(op, table, method, path, obj, opts, callback);
        }
        if (err || !params.status || params.status >= 400) {
            if (!err) {
                var error = params.obj && params.obj.error;
                err = lib.newError({ message: (error ? lib.objDescr(error) : "") || (method + " Error " + params.status + " " + params.data),
                                       code: error && error.type,
                                       status: params.status || 500
                                   });
                logger.debug("elasticsearch:", op, table, method, uri, params.query, "OBJ:", obj, "ERR:", err, params.data);
            } else {
                params.obj = null;
            }
        }
        callback(err, params.obj, params);
    });
}

Pool.prototype.nextToken = function(client, req, rows)
{
    return req.options && req.options.count && rows.length == req.options.count ? lib.toNumber(req.options.start) + lib.toNumber(req.options.count) : null;
}

Pool.prototype._getKey = function(keys, obj)
{
    return keys.filter(function(x) { return obj[x] }).map(function(x) { return obj[x] }).join("|").replace(/[\/]/g, "%2F")
}

Pool.prototype._escape = function(val, options)
{
    switch (typeof val) {
    case "number":
    case "boolean":
        break;
    case "string":
        if (options && options.noescape) break;
        val = val.replace(pool.escapeRx, '\\$1');
        if (val == "OR" || val == "AND" || val.indexOf(" ") > -1) val = '"' + val + '"';
        break;
    default:
        val = null;
    }
    return val;
}

Pool.prototype.queryString = function(req)
{
    var self = this;
    var options = req.options || lib.empty;
    var ops = options.ops || lib.empty;
    var dbcols = req.columns || db.getColumns(req.table, req.options);

    return Object.keys(req.obj).map(function(x) {
        var val = req.obj[x];
        if (typeof val == "undefined") return 0;
        if (x != "q" && !dbcols[x]) return 0;
        if (typeof val == "string") val = val.trim();
        var op = ops[x] || (val === null ? "ne" : "");
        var n = x && x != "q" ? x + ":" : "";
        switch (op) {
        case "null": return "_missing_:" + x;
        case "not_null": return "_exists_:" + x;
        case "!=":
        case "ne": return n + '-' + self._escape(val, options);
        case ">":
        case "gt": return n + '>' + self._escape(val, options);
        case "<":
        case "lt": return n + '<' + self._escape(val, options);
        case ">=":
        case "ge": return n + '>=' + self._escape(val, options);
        case "<=":
        case "le": return n + '<=' + self._escape(val, options);
        case "in": return (Array.isArray(val) ? '(' + val.map(function(y) { return n + self._escape(y, options) }).join(" OR ") + ')' : n + self._escape(val, options));
        case "between": return n + (val.length == 2 ? '[' + self._escape(val[0], options) + ' TO ' + self._escape(val[1], options) + ']' : self._escape(val, options));
        case "begins_with": return Array.isArray(val) ? val.map(function(y, i) { return n + self._escape(y, options) + '*' }).join(" AND ") : n + self._escape(val, options) + '*';
        case "contains": return Array.isArray(val) ? val.map(function(y) { return n + '*' + self._escape(y, options) + '*' }).join(" AND ") : n + '*' + self._escape(val, options) + '*';
        case "not_contains": return Array.isArray(val) ? val.map(function(y) { return n + '>' + self._escape(y, options) }).join(" AND ") : n + '>' + self._escape(val, options);
        case "=":
        case "eq":
        default: return Array.isArray(val) ? val.map(function(y) { return n + self._escape(y, options) }).join(" AND ") : n + self._escape(val, options);
        }
    }).filter(function(x) {
        return x;
    }).join(options.or ? " OR " : " AND ");
}

Pool.prototype.cacheColumns = function(options, callback)
{
    var self = this;
    this.doQuery("", "", "GET", "/_mappings", "", this.configOptions, function(err, data, params) {
        if (err || !data) return callback(err);
        var dbcolumns = {};
        var dbindexes = {}
        for (var db in data) {
            if (!dbindexes[db]) dbindexes[db] = {};
            for (var table in data[db].mappings) {
                dbindexes[db][table] = 1;
                if (!dbcolumns[table]) dbcolumns[table] = {};
                var properties = data[db].mappings[table].properties;
                for (var c in properties) {
                    if (!dbcolumns[table][c]) dbcolumns[table][c] = {};
                    var col = properties[c];
                    for (var p in col) {
                        if (p == "type" && col[p] == "string") continue;
                        dbcolumns[table][c][p] = col[p];
                    }
                }
            }
        }
        self.dbcolumns = dbcolumns;
        self.dbindexes = dbindexes;
        callback();
    });
}

Pool.prototype.query = function(client, req, options, callback)
{
    var self = this;
    if (!req.options || !req.options.__bk) req.options = lib.cloneObj(req.options);
    var keys = db.getKeys(req.table, req.options);
    var dbcols = req.columns || db.getColumns(req.table, req.options);

    switch (req.op) {
    case "create":
        var ecols = this.dbcolumns[req.table];
        var eindex = this._getNodeUrl(self._node, req.table)[1];
        var properties = {}, missing = 0;
        for (var p in req.obj) {
            // All native properties goes as is
            if (req.obj[p].elasticsearch) {
                properties[p] = req.obj[p].elasticsearch;
            } else {
                var t = req.obj[p].join ? "string" : this.configOptions.typesMap[req.obj[p].type];
                if (t) properties[p] = typeof t == "object" ? t : { type: t };
            }
            if (properties[p] && !(ecols && ecols[p])) missing++;
        }
        if (!this.dbindexes[eindex]) {
            this.dbcolumns[req.table] = properties;
            this.dbindexes[eindex] = lib.newObj(req.table, 1)
            var query = {
                settings: {
                    number_of_shards: this.configOptions[lib.toCamel("shards-" + eindex)] || this.configOptions.shards,
                    number_of_replicas: this.configOptions[lib.toCamel("replicas-" + eindex)] || this.configOptions.replicas
                },
                mappings: {}
            };
            query.mappings[req.table] = { properties: properties };
            return this.doQuery("", req.table, "POST", "", query, this.configOptions, callback);
        }
        if (missing) {
            return this.doQuery("", req.table, "PUT", "_mappings/" + req.table, { properties: properties }, this.configOptions, callback);
        }
        callback();
        break;

    case "drop":
        // Only if one index per table or single table regexp
        var name = this._getIndex(req.table);
        if (name != req.table || !name.match(/^[a-zA-Z0-9_]+$/)) return callback();
        this.doQuery("", req.table, "DELETE", "", {}, this.configOptions, callback);
        break;

    case "select":
    case "search":
        if (typeof req.obj == "string") {
            req.options.q = req.obj;
            req.obj = "";
        } else
        if (lib.isObject(req.obj)) {
            if (lib.isObject(req.obj.query)) {
                // Native JSON request
            } else {
                if (req.obj.q) req.obj.q = lib.phraseSplit(req.obj.q);
                req.options.q = this.queryString(req);
                req.obj = "";
            }
        } else {
            return callback();
        }

        var method = "POST";
        var path = req.table +  "/" + (req.options.op || "_search");
        if (req.options.count) req.options.size = req.options.count;
        if (req.options.select) req.options.fields = String(req.options.select);
        if (req.options.sort_timeout) req.options.scroll = lib.toNumber(req.options.sort_timeout) + "ms"; else
        if (req.options.fullscan) req.options.scroll = this.configOptions.sort_timeout;
        if (req.options.start) {
            if (lib.isNumeric(req.options.start)) {
                req.options.from = req.options.start;
            } else
            if (lib.isObject(req.options.start) && req.options.start.scroll_id && req.options.start.scroll) {
                req.options.scroll_id = req.options.start.id;
                if (!options.scroll) req.options.scroll = req.options.start.scroll;
                path = req.table +  "/_search/scroll";
                method = "GET";
            }
        }
        req.options.sort = db.getSortingColumn(req.table, req.options);
        if (req.options.sort && req.options.desc) req.options.sort += ":desc";

        this.doQuery("select", req.table, method, path, req.obj, req.options, function(err, res) {
            if (err && err.status == 404) err = null;
            if (err || !res) return callback(err, []);
            if (res._scroll_id) res.next_token = { scroll_id: res._scroll_id, scroll: req.options.scroll };
            var rows = [];
            if (res.hits) {
                rows = res.hits.hits.map(function(x) {
                    if (Array.isArray(req.options.sort_names) && Array.isArray(x.sort)) {
                        for (var i = 0; i < req.options.sort_names.length; i++) x._source[req.options.sort_names[i]] = x.sort[i];
                    }
                    return x._source || x.fields || {};
                });
                delete res.hits.hits;
            }
            if (res._scroll_id && !rows.length) res.next_token = null;
            callback(null, rows, res);
        });
        break;

    case "list":
        var path = req.table +  "/_mget";
        if (req.options.count) req.options.searchSize = req.options.count;
        if (req.options.select) req.options.fields = String(req.options.select);
        var ids = [];
        for (var i in req.obj) ids.push(this._getKey(Object.keys(req.obj[i]), req.obj[i]));
        this.doQuery("list", req.table, "GET", path, { ids: ids }, req.options, function(err, res) {
            if (err && err.status == 404) err = null;
            if (err || !res) return callback(err, []);
            var rows = res.docs ? res.docs.map(function(x) { return x._source || x.fields || {} }) : [];
            delete res.docs;
            callback(null, rows, res);
        });
        break;

    case "get":
        var path = req.table +  "/" + this._getKey(keys, req.obj);
        if (req.options.select) options.fields = String(req.options.select);
        this.doQuery("get", req.table, "GET", path, "", req.options, function(err, res) {
            if (err && err.status == 404) err = null;
            if (err || !res) return callback(err, []);
            callback(null, [ res._source || res.fields || {} ], res);
        });
        break;

    case "add":
        req.options.op_type = "create";
    case "put":
        var path = req.table +  "/" + this._getKey(keys, req.obj);
        this.doQuery("index", req.table, "PUT", path, req.obj, req.options, function(err, res) {
            if (!err && res) res.affected_rows = 1;
            if (err && err.status == 409) err.code = "AlreadyExists";
            callback(err, [], res);
        });
        break;

    case "incr":
    case "update":
        var path = req.table +  "/" + this._getKey(keys, req.obj) + "/_update";
        if (!req.options.noscript && lib.isObject(req.options.updateOps) && Object.keys(req.options.updateOps).length) {
            var query = { script: { inline: "", params: {} }, scripted_upsert: true, upsert: {} };
            for (var p in req.obj) {
                switch (req.options.updateOps && req.options.updateOps[p]) {
                case "incr":
                    query.script.inline += "if(!ctx._source." + p + ") ctx._source." + p + " = " + p + " else ctx._source." + p + " += " + p + ";";
                    query.script.params[p] = req.obj[p];
                    query.upsert[p] = 0;
                    break;
                case "add":
                case "append":
                    var v = Array.isArray(req.obj[p]) ? req.obj[p] : [ req.obj[p] ];
                    for (var i in v) {
                        query.script.inline += "if(!ctx._source." + p + ") ctx._source." + p + " = [" + p + i + "] else if(!ctx._source." + p + ".contains(" + p + i + ")) ctx._source." + p + " += " + p + i + ";";
                        query.script.params[p + i] = v[i];
                    }
                    query.upsert[p] = 0;
                    break;
                case "del":
                    var v = Array.isArray(req.obj[p]) ? req.obj[p] : [ req.obj[p] ];
                    for (var i in v) {
                        query.script.inline += "if(ctx._source." + p + ") ctx._source." + p + ".remove(" + p + i + ");";
                        query.script.params[p + i] = v[i];
                    }
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
            if (req.options.upsert) query.doc_as_upsert = true;
        }
        if (typeof req.options.retry_on_conflict == "undefined") req.options.retry_on_conflict = 3;
        if (req.options.returning == "*") query.fields = ["_source"];

        this.doQuery("index", req.table, "POST", path, query, req.options, function(err, res) {
            if (!err && res) res.affected_rows = 1;
            if (err && err.status == 409) err.code = "AlreadyExists";
            if (err && err.status == 404) err.code = "NotFound";
            callback(err, [], res);
        });
        break;

    case "del":
        var path = req.table +  "/" + this._getKey(keys, req.obj);
        this.doQuery("del", req.table, "DELETE", path, "", req.options, function(err, res) {
            if (!err && res) res.affected_rows = 1;
            if (err && err.status == 404) err = null;
            callback(err, [], res);
        });
        break;

    default:
        callback();
    }

}

