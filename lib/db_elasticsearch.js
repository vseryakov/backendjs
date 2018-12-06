//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
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
        docType: "_doc",
        defaultType: "text",
        strictTypes: 1,
        scroll_timeout: "60000ms",
        retryCount: 3,
        retryOnConflict: 3,
        refreshInterval: 2000,
        refreshBackoff: 1.2,
        discoveryInterval: 300000,
        discoveryDelay: 500,
        searchable: 1,
        shards: 5,
        distance: 10000,
        replicas: 1,
        typesMap: {
            float: "float", real: "float",
            bigint: "long", int: "integer",
            now: { type: "date", format: "epoch_millis" },
            mtime: { type: "date", format: "epoch_millis" },
            datetime: { type: "text" },
            bool: "boolean", keyword: "keyword",
            text: "text", string: "text", json: "text",
            object: "object",
            array: "nested", obj: "nested",
            geohash: "geo_point", geopoint: "geo_point",
            email: { type: "text", analyzer: "email" },
            keyword_lower: { type: "text", analyzer: "keyword_lower" },
            whitespace_lower: { type: "text", analyzer: "whitespace_lower" },
        },
        opsMap: { 'like%': 'begins_with', "=" : "==", 'eq': '==', 'ne': '!=', 'le': '<=', 'lt': '<', 'ge': '>=', 'gt': '>' },
    },
    // Native query parameters for each operation
    _params: {
        index: ["op_type","version","version_type","routing","parent","timestamp","ttl","consistency",
                "retry_on_conflict","refresh","timeout","replication","wait_for_active_shards","pipeline"],
        del: ["version","routing","parent","consistency","refresh","timeout","replication"],
        delall: ["routing","conflicts","slices","scroll_size","refresh","wait_for_completion","wait_for_active_shards","timeout","scroll","requests_per_second","q"],
        get: ["version","fields","routing","realtime","preference","refresh","_source","_source_include","_source_exclude"],
        list: ["version","fields","routing","_source","_source_include","_source_exclude"],
        q: ["version","analyzer","analyze_wildcard","default_operator","df","explain","fields","from","ignore_unavailable",
            "allow_no_indices","expand_wildcards","indices_boost","lenient","local","lowercase_expanded_terms","preference","q",
            "routing","request_cache","scroll","scroll_id","search_type","size","sort","order","_source","_source_include","_source_exclude","stats",
            "suggest_field","suggest_mode","suggest_size","suggest_text","timeout","terminate_after","track_scores","query_cache"],
        qs: ["default_field","default_operator","analyzer","quote_analyzer","allow_leading_wildcard",
             "enable_position_increments","fuzzy_max_expansions","fuzziness","fuzzy_prefix_length","fuzzy_transpositions",
             "phrase_slop","boost","auto_generate_phrase_queries","analyze_wildcard","max_determinized_states","minimum_should_match",
             "lenient","time_zone","quote_field_suffix","auto_generate_synonyms_phrase_query","all_fields"],
        query: ["search_type", "request_cache"],
    },
    escapeRx: /([:+=&|><!(){}\[\]^"~*?/\\-])/g,
    quoteRx: /[ @]/,
    subfieldRx: /^([a-z0-9_]+:)(.+)/i,
    createPool: function(options) { return new Pool(options); }
};
module.exports = pool;

db.modules.push(pool);

function Pool(options)
{
    options.type = pool.name;
    db.Pool.call(this, options);
    this.configOptions = lib.objMerge(pool.configOptions, this.configOptions);
    this._errors = {};
    this._nodes = [];
    this._version = 5;
    setTimeout(this._getNodes.bind(this), this.configOptions.discoveryDelay || 500);
}
util.inherits(Pool, db.Pool);

Pool.prototype._getNodes = function(callback)
{
    if (this._nodesTimer === true) return;
    var self = this;
    clearTimeout(this._nodesTimer);
    this._nodesTimer = true;
    this.doQuery("GET", "/_nodes", "", "", { quiet: 1 }, function(err, data, params) {
        if (err) logger.error("elasticsearch:", "getNodes:", err, self._nodes, params.toJSON());
        if (!err && data && typeof data.nodes == "object") {
            var nodes = Object.keys(data.nodes).filter(function(x) {
                // Only use data nodes
                return lib.isFlag(data.nodes[x].roles, "data") ||
                       lib.toBool(lib.objGet(data.nodes[x], "settings.node.data")) ||
                       lib.toBool(lib.objGet(data.nodes[x], "attributes.data"));
            }).map(function(x) {
                self._version = lib.toVersion(data.nodes[x].version);
                return data.nodes[x].http_address ||
                       lib.objGet(data.nodes[x], "http.publish_address") ||
                       data.nodes[x].ip;
            }).concat(self.url);
            self._nodes = lib.shuffle(nodes);
            // Pick a random node
            if (self._nodes.length) self._node = self._nodes[self._nodes.length - 1];
        }
        // Increase with every consequetive error
        self._nodesInterval = ((err ? self._nodesInterval : 0) || self.configOptions.refreshInterval) * (err ? self.configOptions.refreshBackoff : 1);
        var interval = !err && self._nodes.length ? self.configOptions.discoveryInterval || 300000 : self._nodesInterval;
        self._nodesTimer = setTimeout(self._getNodes.bind(self), interval);
        logger.debug("elasticsearch:", "getNodes:", self._node, self._version, "nodes:", self._nodes, "interval:", self._nodesInterval, interval);
        if (typeof callback == "function") callback();
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

Pool.prototype._getNodeUrl = function(node)
{
    if (!node) node = this.url;
    if (node == "default") node = "http://127.0.0.1:9200";
    if (!lib.rxUrl.test(node)) node = "http://" + node;
    var h = url.parse(node);
    if (!h.port) h.host += ":9200";
    if (!this._node) this._node = h.host;
    return h.protocol + "//" + h.host;
}

Pool.prototype.doQuery = function(method, path, postdata, query, options, callback)
{
    var self = this;
    var opts = {
        method: method,
        postdata: postdata,
        query: query,
        datatype: "obj",
        quiet: options.quiet,
        retryCount: options.retryCount || this.configOptions.retryCount,
        retryTimeout: options.retryTimeout || this.configOptions.retryTimeout,
        retryOnError: function() { return !this.status || this.status == 429 || this.status >= 500 },
        retryNode: options.retryNode || 0,
        headers: options.headers,
    };
    var uri = this._getNodeUrl(this._node) + (path[0] == "/" ? "" : "/") + path;
    logger.debug("doQuery:", "elasticsearch:", this._version, uri, opts);
    core.httpGet(uri, opts, function(err, params) {
        if (self._nextNode(err, params)) {
            opts.retryNode++;
            return self.doQuery(method, path, postdata, query, opts, callback);
        }
        if (err || !params.status || params.status >= 400) {
            if (!err) {
                var error = params.obj && params.obj.error;
                err = lib.newError({ message: (error ? lib.objDescr(error) : "") || (method + " Error " + params.status + " " + params.data),
                                       code: error && error.type,
                                       status: params.status || 500
                                   });
                logger[options.quiet || params.status == 404 ? "debug": "error"]("elasticsearch:", method, uri, params.query, "OBJ:", postdata, "ERR:", params.status, params.data);
            } else {
                params.obj = null;
            }
        }
        callback(err, params.obj, params);
    });
}

Pool.prototype.convertError = function(table, op, err, options)
{
    if (err.status == 429) err.code = "OverCapacity";
    return err;
}

Pool.prototype.nextToken = function(client, req, rows)
{
    return req.options && req.options.count && rows.length == req.options.count ? lib.toNumber(req.options.start) + lib.toNumber(req.options.count) : null;
}

Pool.prototype._getKey = function(keys, obj)
{
    return keys.filter(function(x) { return obj[x] }).map(function(x) { return lib.encodeURIComponent(obj[x]) }).join("|");
}

Pool.prototype._escape = function(val, options)
{
    var prefix = "";
    var opts = options || lib.empty;

    switch (typeof val) {
    case "number":
    case "boolean":
        break;
    case "string":
        if (!opts.noescape) {
            if (opts.subfields) {
                var d = val.match(pool.subfieldRx);
                if (d) {
                    prefix = d[1];
                    val = d[2];
                }
            }
            val = val.replace(pool.escapeRx, '\\$1');
        }
        if (val == "OR" || val == "AND" || val == "NOT" || pool.quoteRx.test(val)) val = '"' + val + '"';
        break;
    default:
        val = null;
    }
    return val !== null ? prefix + val : val;
}

Pool.prototype.getQueryString = function(req)
{
    return this.getQueryCondition(req);
}

Pool.prototype.getQueryCondition = function(req, obj, join)
{
    var self = this;
    var options = req.options || lib.empty;
    var cols = req.columns || db.getColumns(req.table, req.options);
    var ops = options.ops || lib.empty;
    obj = obj || req.obj;

    return Object.keys(obj).map(function(x) {
        var val = obj[x];
        if (typeof val == "undefined") return 0;
        var d = x.match(/^\$(or|and)/);
        if (d) {
            val = self.getQueryCondition(req, val, d[1]);
            if (val) val = "(" + val + ")";
            return val;
        }
        if (x != "q" && !cols[x]) return 0;
        if (typeof val == "string") val = val.trim();
        var op = ops[x] || (val === null ? "ne" : "");
        var n = x && x != "q" ? x + ":" : "";
        switch (op) {
        case "null": return "_missing_:" + x;
        case "not_null": return "_exists_:" + x;
        case "!=":
        case "ne": return '-' + n + self._escape(val, options);
        case ">":
        case "gt": return n + '>' + self._escape(val, options);
        case "<":
        case "lt": return n + '<' + self._escape(val, options);
        case ">=":
        case "ge": return n + '>=' + self._escape(val, options);
        case "<=":
        case "le": return n + '<=' + self._escape(val, options);
        case "in": return !lib.isEmpty(val) ? (lib.isArray(val) ? '(' + val.map(function(y) { return n + self._escape(y, options) }).join(" OR ") + ')' : n + self._escape(val, options)) : "";
        case "not_in": return !lib.isEmpty(val) ? (lib.isArray(val) ? n + '(' + val.map(function(y) { return "NOT " + self._escape(y, options) }).join(" AND ") + ')' : "NOT " + n + self._escape(val, options)) : "";
        case "between": return !lib.isEmpty(val) ? n + (val.length == 2 ? '[' + self._escape(val[0], options) + ' TO ' + self._escape(val[1], options) + ']' : self._escape(val, options)) : "";
        case "begins_with": return !lib.isEmpty(val) ? lib.isArray(val) ? val.map(function(y, i) { return n + self._escape(y, options) + '*' }).join(" AND ") : n + self._escape(val, options) + '*' : "";
        case "contains": return !lib.isEmpty(val) ? lib.isArray(val) ? val.map(function(y) { return n + '*' + self._escape(y, options) + '*' }).join(" AND ") : n + '*' + self._escape(val, options) + '*' : "";
        case "not_contains": return !lib.isEmpty(val) ? (lib.isArray(val) ? n + '(' + val.map(function(y) { return "NOT *" + self._escape(y, options) + '*' }).join(" AND ") + ')' : "NOT " + n + '*' + self._escape(val, options)) + '*': "";
        case "=":
        case "eq":
        default: return Array.isArray(val) ? val.map(function(y) { return n + self._escape(y, options) }).join(" AND ") : n + self._escape(val, options);
        }
    }).filter(function(x) {
        return x;
    }).join(" " + (join || options.join || "AND").toUpperCase() + " ");
}

Pool.prototype.getGeoQuery = function(table, query, options)
{
    options.sort_names = ["distance"];
    var q = this.getQueryString({ table: table, obj: query, options: options });
    query = {
        query: {
            bool: {
                must: {
                    query_string: {
                        query: q
                    }
                },
                filter: {
                    geo_distance: {
                        distance: options.distance || this.configOptions.distance,
                        latlon: [options.longitude, options.latitude]
                    }
                }
            }
        },
        sort: [
        {
            _geo_distance: {
                latlon: [options.longitude, options.latitude],
                order: "asc",
                unit: "m",
                distance_type: "plane"
            }
        }
        ]
    };
    options.no_next_token = 1;
    return query;
}

Pool.prototype._getQuery = function(name, options)
{
    return pool._params[name].reduce(function(x, y) {
        if (options[y]) x[y] = options[y];
        return x;
    }, {});
}

Pool.prototype._buildCondition = function(req, obj, expected, join)
{
    var ops = req.options.ops || lib.empty;
    var aliases = req.options.aliases || lib.empty;
    var expr = [];
    for (var p in expected) {
        var op = ops[p] || "=";
        var val = expected[p];
        var d = p.match(/^\$(or|and)/);
        if (d) {
            var e = this._buildCondition(req, obj, val, d[1] == "or" ? "||" : "");
            if (e) expr.push("(" + e + ")");
            continue;
        }
        if (this.configOptions.opsMap[op]) op = this.configOptions.opsMap[op];
        var n = aliases[p] || p;
        if (val === null) op = "null";
        var not = op.substr(0, 4) == "not_" ? "" : "!";
        switch (op) {
        case "null":
        case "not_null":
            expr.push(not + "ctx._source.containsKey('" + n + "')");
            break;
        case "in":
        case "not_in":
            if (!Array.isArray(val)) break;
            expr.push("(" + not + "ctx._source.containsKey('" + n + "') || " + not + "params._" + p + ".contains(ctx._source." + n + "))");
            obj.script.params["_" + p] = val;
            break;
        case "between":
            if (!Array.isArray(val) || val.length != 2) break;
            expr.push("(!ctx._source.containsKey('" + n + "') || ctx._source." + n + " < + _" + p + " || ctx._source." + n + " > __" + p + "))");
            obj.script.params["_" + p] = val[0];
            obj.script.params["__" + p] = val[1];
            break;
        case "begins_with":
        case "not_begins_with":
            expr.push("(" + not + "ctx._source.containsKey('" + n + "') || " + not + "ctx._source." + n + ".startsWith(params._" + p + "))");
            obj.script.params["_" + p] = val;
            break;
        case "contains":
        case "not_contains":
            expr.push("(" + not + "ctx._source.containsKey('" + n + "') || " + not + "ctx._source." + n + ".contains(params._" + p + "))");
            obj.script.params["_" + p] = val;
            break;
        case "!=":
        case ">":
        case "<":
        case ">=":
        case "<=":
        case "==":
            expr.push("(!ctx._source.containsKey('" + n + "') || !(ctx._source." + n + " " + op + " params._" + p + "))");
            obj.script.params["_" + p] = val;
            break;
        }
    }
    return expr.join(" " + (join == "or" || join == "OR" ? "||" : "&&") + " ");
}

Pool.prototype._getUpdate = function(req)
{
    var keys = db.getKeys(req.table, req.options);
    var cols = req.columns || db.getColumns(req.table);
    if (req.options && (!lib.isEmpty(req.options.updateOps) || !lib.isEmpty(req.options.expected))) {
        var updateOps = req.options.updateOps || lib.empty;
        var obj = { script: { source: "", params: {} }, scripted_upsert: true, upsert: {} };
        var expr = this._buildCondition(req, obj, req.options.expected, req.options.expectedJoin);
        if (expr) obj.script.source = "if(" + expr + ")ctx.op=\"none\";";
        for (var p in req.obj) {
            var val = req.obj[p], v;
            switch (updateOps[p]) {
            case "incr":
            case "append":
                obj.script.source += "if(!ctx._source.containsKey('" + p + "') || ctx._source." + p + "==null) ctx._source." + p + " = params." + p + "; else ctx._source." + p + " += params." + p + ";";
                obj.script.params[p] = val;
                obj.upsert[p] = 0;
                break;
            case "add":
                v = Array.isArray(val) ? val : [ val ];
                for (const i in v) {
                    obj.script.source += "if(!ctx._source.containsKey('" + p + "') || ctx._source." + p + "==null) ctx._source." + p + " = [params." + p + i + "]; else if(!ctx._source." + p + ".contains(params." + p + i + ")) ctx._source." + p + ".add(params." + p + i + ");";
                    obj.script.params[p + i] = v[i];
                }
                obj.upsert[p] = [];
                break;
            case "del":
                v = Array.isArray(val) ? val : [ val ];
                for (const i in v) {
                    obj.script.source += "if(ctx._source.containsKey('" + p + "') && ctx._source." + p + ".indexOf(params." + p + i + ")>-1) ctx._source." + p + ".remove(ctx._source." + p + ".indexOf(params." + p + i + "));";
                    obj.script.params[p + i] = v[i];
                }
                break;
            case "remove":
                obj.script.source += "ctx._source.remove('" + p + "');";
                break;
            default:
                if (cols[p] && cols[p].type == "json" && typeof val != "string") val = lib.stringify(val);
                if (keys.indexOf(p) == -1) {
                    obj.script.source += "ctx._source." + p + " = params." + p + ";";
                    obj.script.params[p] = val;
                }
                obj.upsert[p] = val;
            }
        }
    } else {
        var obj = { doc: req.obj };
        if (req.options && req.options.upsert) obj.doc_as_upsert = true;
    }
    return obj;
}

Pool.prototype.cacheColumns = function(options, callback)
{
    var self = this;
    this.doQuery("GET", "/_mappings", "", "", this.configOptions, function(err, data, params) {
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
                        if (p == "type" && col[p] == "text") continue;
                        dbcolumns[table][c][p] = col[p];
                    }
                }
            }
        }
        self.dbcolumns = dbcolumns;
        self.dbindexes = dbindexes;
        callback();
    });
    setTimeout(this._getNodes.bind(this), this.configOptions.discoveryDelay || 500);
}

Pool.prototype.query = function(client, req, options, callback)
{
    var self = this;
    var keys = db.getKeys(req.table, req.options);
    var dbcols = req.columns || db.getColumns(req.table, req.options);
    var path, query, obj, docType = this.configOptions.docType || req.table;

    switch (req.op) {
    case "create":
        var ecols = this.dbcolumns[req.table];
        var properties = {}, missing = 0;
        for (var p in req.obj) {
            // All native properties goes as is
            if (req.obj[p].elasticsearch) {
                properties[p] = lib.objClone(req.obj[p].elasticsearch);
            } else {
                var t = req.obj[p].join ? "text" : this.configOptions.typesMap[req.obj[p].type];
                if (t) properties[p] = typeof t == "object" ? t : { type: t };
            }
            if (!properties[p]) continue;
            if (!properties[p].type) properties[p].type = this.configOptions.defaultType;
            if (req.obj[p].raw) properties[p].fields = { raw: { type: "keyword" } };
            if (req.obj[p].analyzer) properties[p].analyzer = req.obj[p].analyzer;
            if (!(ecols && ecols[p])) missing++;
        }
        if (!this.dbindexes[req.table]) {
            this.dbcolumns[req.table] = properties;
            this.dbindexes[req.table] = lib.objNew(req.table, 1);
            query = {
                settings: {
                    number_of_shards: this.configOptions[lib.toCamel("shards-" + req.table)] || this.configOptions.shards,
                    number_of_replicas: this.configOptions[lib.toCamel("replicas-" + req.table)] || this.configOptions.replicas,
                    analysis: {
                        filter: {
                            email: {
                                type: "pattern_capture",
                                preserve_original: true,
                                patterns: [ "([^@]+)", "@(.+)" ]
                            }
                        },
                        analyzer: {
                            email: {
                                tokenizer: "uax_url_email",
                                filter: [ "email", "lowercase", "unique" ]
                            },
                            keyword_lower: {
                                type: "custom",
                                tokenizer: "keyword",
                                filter: "lowercase"
                            },
                            whitespace_lower: {
                                type: "custom",
                                tokenizer: "whitespace",
                                filter: "lowercase"
                            }
                        }
                    }
                },
                mappings: {},
            };
            query.mappings[docType] = { properties: properties };

            lib.series([
                function(next) {
                    if (self._version) return next();
                    self._getNodes(next);
                },
                function(next) {
                    self.doQuery("PUT", req.table, query, "", self.configOptions, next);
                },
            ], callback);
            return;
        }
        if (missing) {
            return this.doQuery("PUT", req.table + "/_mappings/" + docType, { properties: properties }, "", this.configOptions, callback);
        }
        callback();
        break;

    case "drop":
        // Only if one index per table or single table regexp
        this.doQuery("DELETE", req.table, {}, "", this.configOptions, callback);
        break;

    case "select":
    case "search":
        var method = "POST", opts;
        path = req.table + "/" + (req.options.op || "_search");
        query = this._getQuery("query", req.options);
        if (lib.isObject(req.obj)) {
            if (lib.isObject(req.obj.query)) {
                // Native JSON request
                obj = req.obj;
                opts = obj;
            } else {
                if (req.obj.q) req.obj.q = lib.phraseSplit(req.obj.q);
                obj = {
                    query: {
                        query_string: this._getQuery("qs", req.options),
                    }
                };
                obj.query.query_string.query = this.getQueryString(req);
                opts = obj;
            }
        } else
        // Already formatted query string
        if (typeof req.obj == "string") {
            query = this._getQuery("q", req.options);
            query.q = req.obj;
            opts = query;
        } else {
            return callback();
        }
        if (req.options.count > 0) opts.size = req.options.count;
        if (req.options.total) opts.size = 0;
        if (req.options.select) opts._source = lib.strSplit(req.options.select);
        if (req.options.scroll_timeout > 0) query.scroll = lib.toNumber(req.options.scroll_timeout) + "ms"; else
        if (req.options.fullscan) query.scroll = this.configOptions.scroll_timeout;
        if (req.options.start) {
            if (Array.isArray(req.options.start)) {
                obj.search_after = req.options.start;
            } else
            if (lib.isNumeric(req.options.start)) {
                opts.from = req.options.start;
            } else
            if (lib.isObject(req.options.start) && req.options.start.scroll_id && req.options.start.scroll) {
                query.scroll_id = req.options.start.scroll_id;
                if (!options.scroll) query.scroll = req.options.start.scroll;
                path = req.table + "/" + docType + "/_search/scroll";
                method = "GET";
            }
        }
        // Pass a string, or a list of strings/formatted sorting objects
        if (req.options.sort) {
            var sort = lib.strSplit(req.options.sort).map((x) => {
                if (!x) return null;
                if (typeof x == "object") return x;
                if (typeof x != "string") return null;
                if (x[0] == "_") return x;
                var col = dbcols[x];
                if (col) return col.raw ? x + ".raw" : x;
                // Combined index for NoSQL style indexers, use the last hash column only
                if (x.indexOf("_") > -1) {
                    x = x.split("_").pop();
                    if (col) return col.raw ? x + ".raw" : x;
                }
                return null;
            }).filter((x) => (x));
            if (sort.length) {
                if (!Array.isArray(opts.sort)) opts.sort = [];
                if (obj) {
                    for (var i in sort) {
                        if (req.options.desc) {
                            var o = typeof sort[i] == "string" ? lib.objNew(sort[i], {}) : sort[i];
                            for (const p in o) o[p].order = "desc";
                            opts.sort.push(o);
                        } else {
                            opts.sort.push(sort[i]);
                        }
                    }
                } else {
                    opts.sort.push(sort + (req.options.desc ? ":desc" : ""));
                }
            }
            if (req.options.sort == "random") {
                opts.sort = { _script: { script: "Math.random()", type: "number", order: "asc" } };
            }
        }

        this.doQuery(method, path, obj, query, req.options, function(err, res) {
            if (err && err.status == 404) err = null;
            if (err || !res) return callback(err, []);
            if (res._scroll_id) res.next_token = { scroll_id: res._scroll_id, scroll: query.scroll };
            var rows = [];
            if (res.hits) {
                if (!res._scroll_id &&
                    !req.options.no_next_token &&
                    Array.isArray(opts.sort) &&
                    res.hits.hits.length == opts.size) {
                    res.next_token = res.hits.hits[res.hits.hits.length - 1].sort;
                }
                rows = res.hits.hits.map(function(x) {
                    if (Array.isArray(req.options.sort_names) && Array.isArray(x.sort)) {
                        for (var i = 0; i < req.options.sort_names.length; i++) x._source[req.options.sort_names[i]] = x.sort[i];
                    }
                    return x._source || x.fields || {};
                });
                if (!res.count) res.count = res.hits.total;
                if (!req.options.debug) delete res.hits.hits;
            }
            if (req.options.total) rows = [{ count: res.count }];
            if (res._scroll_id && !rows.length) res.next_token = null;
            callback(null, rows, res);
        });
        break;

    case "list":
        path = req.table + "/" + docType + "/_mget";
        query = this._getQuery("list", req.options);
        if (req.options.count) query.searchSize = req.options.count;
        if (req.options.select) query._source = lib.strSplit(req.options.select);
        var ids = [];
        for (var i in req.obj) ids.push(this._getKey(Object.keys(req.obj[i]), req.obj[i]));
        this.doQuery("GET", path, { ids: ids }, query, req.options, function(err, res) {
            if (err && err.status == 404) err = null;
            if (err || !res) return callback(err, []);
            var rows = res.docs ? res.docs.map(function(x) { return x._source || x.fields || {} }) : [];
            if (!req.options.debug) delete res.docs;
            callback(null, rows, res);
        });
        break;

    case "get":
        path = req.table + "/" + docType + "/" + this._getKey(keys, req.obj);
        query = this._getQuery("get", req.options);
        if (req.options.select) query.fields = String(req.options.select);
        this.doQuery("GET", path, obj, query, req.options, function(err, res) {
            if (err && err.status == 404) err = null;
            if (err || !res) return callback(err, []);
            callback(null, [ res._source || res.fields || {} ], res);
        });
        break;

    case "add":
        req.options.op_type = "create";
    case "put":
        path = req.table + "/" + docType + "/" + this._getKey(keys, req.obj);
        query = this._getQuery("index", req.options);
        this.doQuery("PUT", path, req.obj, query, req.options, function(err, res) {
            if (!err && res) res.affected_rows = 1;
            if (err && err.status == 409) err.code = "AlreadyExists";
            callback(err, [], res);
        });
        break;

    case "incr":
    case "update":
        path = req.table + "/" + docType + "/" + this._getKey(keys, req.obj) + "/_update";
        query = this._getQuery("index", req.options);
        obj = this._getUpdate(req);
        if (req.options.returning == "*") obj.fields = ["_source"];
        if (typeof req.options.retry_on_conflict == "undefined") query.retry_on_conflict = this.configOptions.retryOnConflict;
        this.doQuery("POST", path, obj, query, req.options, function(err, res) {
            if (!err && res) res.affected_rows = 1;
            if (err && err.status == 409) err.code = "AlreadyExists";
            if (err && err.status == 404) err.code = "NotFound";
            callback(err, [], res);
        });
        break;

    case "del":
        path = req.table + "/" + docType + "/" + this._getKey(keys, req.obj);
        query = this._getQuery("del", req.options);
        this.doQuery("DELETE", path, obj, query, req.options, function(err, res) {
            if (!err && res) res.affected_rows = 1;
            if (err && err.status == 404) err = null;
            callback(err, [], res);
        });
        break;

    case "delall":
        path = req.table + "/_delete_by_query";
        query = this._getQuery("delall", req.options);
        if (lib.isObject(req.obj)) {
            if (lib.isObject(req.obj.query)) {
                obj = req.obj;
            } else {
                if (req.obj.q) req.obj.q = lib.phraseSplit(req.obj.q);
                obj = {
                    query: {
                        query_string: this._getQuery("qs", req.options),
                    }
                };
                obj.query.query_string.query = this.getQueryString(req);
            }
        } else
        if (typeof req.obj == "string") {
            query.q = req.obj;
        }
        this.doQuery("POST", path, obj, query, req.options, function(err, res) {
            if (!err && res) res.affected_rows = res.deleted;
            callback(err, [], res);
        });
        break;

    case "bulk":
        var data = "", item, meta;
        for (var i in req.obj) {
            item = req.obj[i];
            keys = db.getKeys(item.table, item.options);
            meta = { _id: this._getKey(keys, item.obj), _index: item.table, _type: this.configOptions.docType || item.table };
            switch (item.op) {
            case "add":
                data += lib.stringify({ create: meta }) + "\n";
                data += lib.stringify(item.obj) + "\n";
                break;
            case "put":
                data += lib.stringify({ index: meta }) + "\n";
                data += lib.stringify(item.obj) + "\n";
                break;
            case "incr":
            case "update":
                if (!item.options || typeof req.options.retry_on_conflict != "number") meta._retry_on_conflict = this.configOptions.retryOnConflict;
                data += lib.stringify({ update: meta }) + "\n";
                data += lib.stringify(this._getUpdate(item)) + "\n";
                break;
            case "del":
                data += lib.stringify({ delete: meta }) + "\n";
                break;
            }
        }
        if (!data) return callback();
        options.headers = { "content-type": "application/json" };
        this.doQuery("POST", "/_bulk", data, "", options, function(err, res) {
            var info = [];
            if (!err && res) {
                for (var i in res.items) {
                    if (res.items[i].status >= 400) info.push([res.items[i].result, res.items[i]]);
                }
            }
            callback(err, info);
        });
        break;

    default:
        callback();
    }
}

Pool.prototype.delAll = function(table, query, options, callback)
{
    var req = db.prepare("delall", table, query, options);
    db.query(req, req.options, callback);
}

