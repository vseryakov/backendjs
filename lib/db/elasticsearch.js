//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const url = require('url');
const util = require('util');
const core = require(__dirname + '/../core');
const lib = require(__dirname + '/../lib');
const db = require(__dirname + '/../db');
const logger = require(__dirname + '/../logger');

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
const pool = {
    name: "elasticsearch",
    type: "elasticsearch",
    configOptions: {
        docType: "_doc",
        defaultType: "text",
        defaultParams: {},
        scroll_timeout: "60000ms",
        retryCount: 5,
        retryTimeout: 100,
        retryOnConflict: 3,
        refreshInterval: 2000,
        refreshBackoff: 1.2,
        discoveryInterval: 300000,
        discoveryDelay: 500,
        bulkSize: 200,
        bulkRetryCount: 10,
        bulkRetryTimeout: 250,
        searchable: 1,
        shards: 5,
        date_detection: true,
        numeric_detection: true,
        distance: 10000,
        replicas: 1,
        cacheColumns: 1,
        clientNodes: 0,
        typesMap: {
            float: "float", real: "float",
            ttl: "long", counter: "long", random: "long",
            long: "long", bigint: "long", int: "integer",
            now: { type: "date", format: "epoch_millis" },
            mtime: { type: "date", format: "epoch_millis" },
            datetime: { type: "text" },
            bool: "boolean", keyword: "keyword", symbol: "keyword",
            text: "text", string: "text", json: "text",
            object: "object",
            array: "nested", obj: "nested",
            geohash: "geo_point", geopoint: "geo_point",
            email: { type: "text", analyzer: "keyword_lower" },
            keyword_lower: { type: "text", analyzer: "keyword_lower" },
            whitespace_lower: { type: "text", analyzer: "whitespace_lower" },
        },
        opsMap: { 'like%': 'begins_with', "=": "==", 'eq': '==', 'ne': '!=', 'le': '<=', 'lt': '<', 'ge': '>=', 'gt': '>' },
    },
    // Native query parameters for each operation
    _params: {
        index: ["op_type","version","version_type","routing","parent","timestamp","ttl","consistency","include_type_name",
                "retry_on_conflict","refresh","timeout","replication","wait_for_active_shards","pipeline"],
        del: ["version","routing","parent","consistency","refresh","timeout","replication"],
        delall: ["routing","conflicts","slices","scroll_size","refresh","wait_for_completion","wait_for_active_shards","timeout","scroll","requests_per_second","q"],
        get: ["version","fields","routing","realtime","preference","refresh","_source","_source_include","_source_exclude"],
        list: ["version","fields","routing","_source","_source_include","_source_exclude"],
        qs: ["default_field","default_operator","analyzer","quote_analyzer","allow_leading_wildcard",
             "enable_position_increments","fuzzy_max_expansions","fuzziness","fuzzy_prefix_length","fuzzy_transpositions",
             "phrase_slop","fields","auto_generate_phrase_queries","analyze_wildcard","max_determinized_states","minimum_should_match",
             "lenient","time_zone","quote_field_suffix","auto_generate_synonyms_phrase_query","all_fields"],
        query: ["search_type", "request_cache"],
        sql: ["format","delimiter"],
    },
    _mappings: ["index","store","boost","format","doc_values","null_value","normalizer","analyzer","search_analyzer","norms","fields","fielddata","similarity"],
    escapeRx: /([:+=&|><!(){}[\]^"~*?/\\-])/g,
    quoteRx: /[ @/]/,
    subfieldRx: /^([a-z0-9_]+:)(.+)/i,
    createPool: function(options) { return new Pool(options); }
};
module.exports = pool;

db.modules.push(pool);

function Pool(options)
{
    db.Pool.call(this, options, pool);
    this._nodes = [];
    setTimeout(this._getNodes.bind(this), this.configOptions.discoveryDelay || 500);
}
util.inherits(Pool, db.Pool);

Pool.prototype._getNodes = function(callback)
{
    if (this._nodesTimer === true) return;
    clearTimeout(this._nodesTimer);
    this._nodesTimer = true;
    this.doQuery("GET", "/_nodes", "", "", { quiet: 1, logger_db: "none" }, (err, data, params) => {
        if (err) logger.error("elasticsearch:", "getNodes:", err, this._nodes, params.toJSON());
        if (!err && typeof data?.nodes == "object") {
            var nodes = [];
            for (const p in data.nodes) {
                var node = data.nodes[p];
                if (!this._version) this._version = lib.toVersion(node.version);
                if (lib.isEmpty(node.roles) || (!this.configOptions.clientNodes && lib.isFlag(node.roles, "data"))) {
                    nodes.push(lib.objGet(node, "http.publish_address") || node.ip);
                }
            }
            this._nodes = lib.shuffle(nodes);
            // Pick a random node
            if (this._nodes.length) this._node = this._nodes[this._nodes.length - 1];
        }
        // Increase with every consequetive error
        this._nodesInterval = ((err ? this._nodesInterval : 0) || this.configOptions.refreshInterval) * (err ? this.configOptions.refreshBackoff : 1);
        var interval = !err && this._nodes.length ? this.configOptions.discoveryInterval || 300000 : this._nodesInterval;
        this._nodesTimer = setTimeout(this._getNodes.bind(this), interval);
        logger.debug("elasticsearch:", "getNodes:", this._node, this._version, "nodes:", this._nodes, "interval:", this._nodesInterval, interval);
        if (typeof callback == "function") callback();
    });
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

Pool.prototype._retryPrepare = function(params)
{
    params.retryNodes++;
    var node = this._nodes.shift();
    if (node) {
        this._nodes.push(node);
        // After we went over all nodes we try the default url again in case all nodes are replaced with new ones
        if (params.retryNodes > this._nodes.length) {
            params.retryNodes = 0;
            node = this.url;
        }
    } else {
        var servers = lib.strSplit(this.configOptions.servers);
        if (!this._servers || !this._servers.every((x) => (servers.indexOf(x) > -1))) this._servers = servers;
        node = this._servers.shift();
        if (node) this._servers.push(node);
    }
    // If no nodes yet we need to keep trying the default url assuming the server will be online soon or
    // it will resolve to some other running node via DNS balancing
    if (!node) node = this.url;
    this._node = node;
    params.nodeHost = this._getNodeUrl(node);
    params._uri = params.nodeHost + params.nodePath;
    logger.debug("elasticsearchRetry:", params.nodePath, "trying node:", this._node, "count:", params.retryCount, params.retryTotal, params.retryNodes, "nodes:", this._nodes, this._servers);
}

Pool.prototype.doQuery = function(method, path, postdata, query, options, callback)
{
    var self = this;
    var opts = {
        nodeHost: this._getNodeUrl(this._node),
        nodePath: (path[0] == "/" ? "" : "/") + path,
        method: method,
        postdata: postdata,
        query: query,
        datatype: "obj",
        quiet: options.quiet,
        headers: options.headers,
        retryCount: options.retryCount || this.configOptions.retryCount,
        retryTimeout: options.retryTimeout || this.configOptions.retryTimeout,
        retryOnError: function() { return this.status == 429 || this.status >= 500 },
        retryPrepare: function() { self._retryPrepare(this) },
        retryNodes: 0,
    };
    core.httpGet(opts.nodeHost + opts.nodePath, opts, function(err, params) {
        logger.logger(options.logger_db || "debug", "elasticsearchQuery:", params.elapsed, 'ms', opts, "hits:", params.obj?.hits?.hits?.length, err);
        if (params.obj && params.retryCount < params.retryTotal) {
            params.obj.retry_count = params.retryTotal - Math.min(0, params.retryCount);
        }
        if (err || !params.status || params.status >= 400) {
            if (!err) {
                var error = params.obj?.error;
                err = lib.newError({ message: (error ? lib.objDescr(error) : "") || (method + " Error " + params.status + " " + params.data),
                                       code: error?.type,
                                       status: params.status || 500
                                   });
                logger[options.quiet || params.status == 404 ? "debug": "error"]("elasticsearchQuery:", opts, "ERR:", params.status, params.data);
            } else {
                params.obj = null;
            }
        }
        callback(err, params.obj, params);
    });
}

Pool.prototype.prepareRow = function(req)
{
    switch (req.op) {
    case "search":
    case "select":
        // Always allow full text search across all columns
        if (!req.custom) req.custom = {};
        req.custom.q = { allow: 1 };
        break;
    }
}

Pool.prototype.convertError = function(table, op, err, options)
{
    if (err.status == 429) err.code = "OverCapacity";
    return err;
}

Pool.prototype.nextToken = function(client, req, rows)
{
    return req.options?.count && rows.length == req.options.count ? lib.toNumber(req.options.start) + lib.toNumber(req.options.count) : null;
}

Pool.prototype._getKey = function(keys, obj)
{
    return keys.filter((x) => (obj[x])).map((x) => (obj[x])).join("|");
}

Pool.prototype._escape = function(val, options, name)
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
    val = val !== null ? prefix + val : val;
    if (name && opts._fuzziness && opts._fuzziness[name]) val += "~" + opts._fuzziness[name];
    if (name && opts._boost && opts._boost[name]) val += "^" + opts._boost[name];
    return val;
}

Pool.prototype.parseQueryString = function(q, options)
{
    return lib.phraseSplit(q).map((y) => (this._escape(y, options))).join(" AND ");
}

Pool.prototype.getQueryString = function(req)
{
    return this.getQueryCondition(req);
}

Pool.prototype.getQueryCondition = function(req, obj, join)
{
    var options = req.options || lib.empty;
    var ops = options.ops || lib.empty;
    var jops = options.joinOps || lib.empty;
    var aliases = options.aliases || lib.empty;
    obj = obj || req.obj;

    return Object.keys(obj).map((x) => {
        var val = obj[x];
        if (typeof val == "undefined") return 0;
        var d = x.match(/^\$(or|and)/);
        if (d) {
            val = this.getQueryCondition(req, val, d[1]);
            if (val) val = "(" + val + ")";
            return val;
        }
        if (lib.isArray(val)) val = val.filter((x) => (!lib.isEmpty(x)));
        var op = ops[x] || (val === null ? "null" : "");
        if (typeof val == "string") {
            val = val.trim();
            if (!val && op != "null" && op != "not_null") return 0;
        }
        var jop = jops[x];
        if (aliases[x]) x = aliases[x];
        var n = x && x != "q" ? x + ":" : "";
        switch (op) {
        case "null":
            return lib.isArray(val) ? '(' + val.map((y) => (`(NOT _exists_:${x})`)).join(` ${jop || "AND"} `) + ')' : `(NOT _exists_:${x})`;

        case "not_null":
            return lib.isArray(val) ? '(' + val.map((y) => (`_exists_:${x}`)).join(` ${jop || "AND"} `) + ')' : "_exists_:" + x;

        case "!=":
        case "ne":
            return lib.isArray(val) ? '(' + val.map((y) => ("-" + n + this._escape(y, options, x))).join(` ${jop || "AND"} `) + ')' : '-' + n + this._escape(val, options, x);

        case ">":
        case "gt":
            return lib.isArray(val) ? '(' + val.map((y) => (n + ">" + this._escape(y, options, x))).join(` ${jop || "AND"} `) + ')' : n + '>' + this._escape(val, options, x);

        case "<":
        case "lt":
            return lib.isArray(val) ? '(' + val.map((y) => (n + "<" + this._escape(y, options, x))).join(` ${jop || "AND"} `) + ')' : n + '<' + this._escape(val, options, x);

        case ">=":
        case "ge":
            return lib.isArray(val) ? '(' + val.map((y) => (n + ">=" + this._escape(y, options, x))).join(` ${jop || "AND"} `) + ')' : n + '>=' + this._escape(val, options, x);

        case "<=":
        case "le":
            return lib.isArray(val) ? '(' + val.map((y) => (n + "<=" + this._escape(y, options, x))).join(` ${jop || "AND"} `) + ')' : n + '<=' + this._escape(val, options, x);

        case "in":
        case "all_in":
            if (lib.isEmpty(val)) break;
            return lib.isArray(val) ? '(' + val.map((y) => (n + this._escape(y, options, x))).join(` ${jop || op == "in" ? "OR" : "AND"} `) + ')' : n + this._escape(val, options, x);

        case "not_in":
            if (lib.isEmpty(val)) break;
            return lib.isArray(val) ? n + '(' + val.map((y) => ("NOT " + this._escape(y, options, x))).join(` ${jop || "AND"} `) + ')' : "NOT " + n + this._escape(val, options, x);

        case "between":
            if (lib.isEmpty(val)) break;
            return n + (val.length == 2 ? `[${this._escape(val[0], options, x)} TO ${this._escape(val[1], options, x)}]` : this._escape(val, options, x));

        case "not_between":
            if (lib.isEmpty(val)) break;
            return "NOT " + n + (val.length == 2 ? `[${this._escape(val[0], options, x)} TO ${this._escape(val[1], options, x)}]` : this._escape(val, options, x));

        case "begins_with":
            if (lib.isEmpty(val)) break;
            return lib.isArray(val) ? val.map((y, i) => (n + this._escape(y, options, x) + '*')).join(` ${jop || "AND"} `) : n + this._escape(val, options, x) + '*';

        case "not_begins_with":
            if (lib.isEmpty(val)) break;
            return lib.isArray(val) ? val.map((y, i) => (`NOT ${n}${this._escape(y, options, x)}*`)).join(` ${jop || "AND"} `) : `NOT ${n}${this._escape(val, options, x)}*`;

        case "like":
            if (lib.isEmpty(val)) break;
            return lib.isArray(val) ? val.map((y, i) => (n + this._escape(y, options, x) + '~')).join(` ${jop || "AND"} `) : n + this._escape(val, options, x) + '~';

        case "contains":
            if (lib.isEmpty(val)) break;
            return lib.isArray(val) ? val.map((y) => (`${n}*${this._escape(y, options, x)}*`)).join(` ${jop || "AND"} `) : `${n}*${this._escape(val, options, x)}*`;

        case "not_contains":
            if (lib.isEmpty(val)) break;
            return lib.isArray(val) ? n + '(' + val.map((y) => (`NOT *${this._escape(y, options, x)}*`)).join(` ${jop || "AND"} `) + ')' : `NOT ${n}*${this._escape(val, options, x)}*`;

        case "=":
        case "eq":
        default:
            if (val === "") break;
            return Array.isArray(val) ? val.map((y) => (n + this._escape(y, options, x))).join(` ${jop || "AND"} `) : n + this._escape(val, options, x);
        }
        return null;
    }).filter((x) => (x)).join(" " + (join || options.join || "AND").toUpperCase() + " ");
}

Pool.prototype.getGeoQuery = function(table, query, options)
{
    options.sort_names = ["distance"];
    var q = typeof query == "string" ? query : this.getQueryString({ table: table, obj: query, options: options });
    var n = options.geopoint_name || db.getFilteredColumns(table, { type: "geopoint" }, { list: 1 })[0] || "latlon";
    var ll = lib.isArray(options.latlon) ? [options.latlon[1], options.latlon[0]] :
             lib.isArray(options.lonlat) ? options.lonlat : [options.longitude, options.latitude];
    var d = options.distance || this.configOptions.distance;
    if (options.distance_unit && lib.isNumeric(d)) d += options.distance_unit;

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
                        distance: d,
                        [n]: ll,
                    }
                }
            }
        },
        sort: [
        {
            _geo_distance: {
                [n]: ll,
                order: options.desc ? "desc" : "asc",
                unit: options.distance_unit || "m",
                distance_type: options.distance_type || "plane"
            }
        }
        ]
    };
    options.no_next_token = 1;
    return query;
}

Pool.prototype._getQuery = function(name, options)
{
    return pool._params[name].reduce((x, y) => {
        if (options[y]) x[y] = options[y]; else
        if (this.configOptions.defaultParams[y]) x[y] = this.configOptions.defaultParams[y];
        return x;
    }, {});
}

Pool.prototype._buildCondition = function(req, obj, expected, join)
{
    var ops = req.options.ops || lib.empty;
    var aliases = req.options.aliases || lib.empty;
    var expr = [];
    for (const p in expected) {
        var op = ops[p] || "==";
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
            expr.push(not + `ctx._source.containsKey('${n}')`);
            break;
        case "in":
        case "not_in":
            if (!Array.isArray(val)) break;
            expr.push(`(${not}ctx._source.containsKey('${n}') || ${not}params._${p}.contains(ctx._source.${n}))`);
            obj.script.params["_" + p] = val;
            break;
        case "between":
            if (!Array.isArray(val) || val.length != 2) break;
            expr.push(`(!ctx._source.containsKey('${n}') || ctx._source.${n} < + _${p} || ctx._source.${n} > __${p}))`);
            obj.script.params["_" + p] = val[0];
            obj.script.params["__" + p] = val[1];
            break;
        case "begins_with":
        case "not_begins_with":
            expr.push(`(${not}ctx._source.containsKey('${n}') || ${not}ctx._source.${n}.startsWith(params._${p}))`);
            obj.script.params["_" + p] = val;
            break;
        case "contains":
        case "not_contains":
            expr.push(`(${not}ctx._source.containsKey('${n}') || ${not}ctx._source.${n}.contains(params._${p}))`);
            obj.script.params["_" + p] = val;
            break;
        case "!=":
        case ">":
        case "<":
        case ">=":
        case "<=":
        case "==":
            expr.push(`(!ctx._source.containsKey('${n}') || !(ctx._source.${n} ${op} params._${p}))`);
            obj.script.params["_" + p] = val;
            break;
        }
    }
    return expr.join(" " + (join == "or" || join == "OR" ? "||" : "&&") + " ");
}

Pool.prototype._getUpdate = function(req)
{
    if (lib.isEmpty(req.obj)) return;
    var keys = db.getKeys(req.table, req.options), obj;
    var cols = db.getColumns(req.table, req.options);
    if (!lib.isEmpty(req.options.updateOps) || !lib.isEmpty(req.options.expected)) {
        obj = { script: { source: "", params: {} } };
        if (req.options.upsert) {
            obj.scripted_upsert = true;
            obj.upsert = {};
        }
        const updateOps = req.options.updateOps || lib.empty;
        const expr = this._buildCondition(req, obj, req.options.expected, req.options.expectedJoin || "or");
        if (expr) obj.script.source = `if(${expr}){ctx.op="noop";return;}`;
        for (const p in req.obj) {
            let val = req.obj[p], op = updateOps[p], prop = p, param = p, src = "_source";
            if (val === null || val === "") op = "remove";

            // Handle dotted columns as nested maps
            if (p.includes(".")) {
                param = p.split(".");
                for (let i = 0; i < param.length - 1; i++) {
                    obj.script.source += `if(!ctx.${src}.containsKey('${param[i]}') || ctx.${src}.${param[i]}==null) ctx.${src}.${param[i]} = new HashMap();`;
                    src += "." + param[i];
                }
                prop = param[param.length - 1];
                param = param.join("");
            }

            switch (op) {
            case "incr":
            case "append":
                obj.script.source += `if(!ctx.${src}.containsKey('${prop}') || ctx.${src}.${prop}==null) ctx.${src}.${prop}=params.${param}; else ctx.${src}.${prop}+=params.${param};`;
                obj.script.params[param] = val;
                if (req.options.upsert) lib.objSet(obj.upsert, p, 0);
                break;

            case "add":
                val = Array.isArray(val) ? val : [ val ];
                for (const i in val) {
                    obj.script.source += `if(!ctx.${src}.containsKey('${prop}') || ctx.${src}.${prop}==null) ctx.${src}.${prop}=[params.${param}${i}]; else if(!ctx.${src}.${prop}.contains(params.${param}${i})) ctx.${src}.${prop}.add(params.${param}${i});`;
                    obj.script.params[param + i] = val[i];
                }
                if (req.options.upsert) lib.objSet(obj.upsert, p, []);
                break;

            case "del":
                val = Array.isArray(val) ? val : [ val ];
                for (const i in val) {
                    obj.script.source += `if(ctx.${src}.containsKey('${prop}') && ctx.${src}.${prop}.indexOf(params.${param}${i})>-1) ctx.${src}.${prop}.remove(ctx.${src}.${prop}.indexOf(params.${param}${i}));`;
                    obj.script.params[param + i] = val[i];
                }
                break;

            case "unset":
            case "remove":
                obj.script.source += `ctx._source.remove('${param}');`;
                break;

            default:
                if (cols[p] && cols[p].type == "json" && typeof val != "string") val = lib.stringify(val);
                if (!keys.includes(p)) {
                    obj.script.source += `ctx._source.${p} = params.${param};`;
                    obj.script.params[param] = val;
                }
                if (req.options.upsert) lib.objSet(obj.upsert, p, val);
            }
        }
        if (!obj.script.source) return;
    } else {
        obj = { doc: req.obj };
        if (!this.configOptions.keepEmpty) {
            for (const p in req.obj) if (req.obj[p] === "") req.obj[p] = null;
        }
        if (req.options.upsert) obj.doc_as_upsert = true;
    }
    return obj;
}

Pool.prototype.cacheColumns = function(options, callback)
{
    var docType = this.configOptions.docType;
    this.doQuery("GET", "/_mappings", "", "", this.configOptions, (err, data, params) => {
        if (err || !data) return callback(err);
        const dbcolumns = {}, dbindexes = {};
        for (const table in data) {
            if (!dbindexes[table]) dbindexes[table] = 1;
            if (!data[table].mappings) continue;
            if (!dbcolumns[table]) dbcolumns[table] = {};
            const properties = data[table].mappings.properties || data[table].mappings && data[table].mappings[docType] && data[table].mappings[docType].properties;
            for (const c in properties) {
                if (!dbcolumns[table][c]) dbcolumns[table][c] = {};
                const col = properties[c];
                for (const p in col) {
                    if (p == "type" && col[p] == "text") continue;
                    dbcolumns[table][c][p] = col[p];
                }
            }
        }
        this.dbcolumns = dbcolumns;
        this.dbindexes = dbindexes;
        callback();
    });
    setTimeout(this._getNodes.bind(this), this.configOptions.discoveryDelay || 500);
}

Pool.prototype.query = function(client, req, options, callback)
{
    var self = this;
    var keys = db.getKeys(req.table, req.options);
    var dbcols = db.getColumns(req.table, req.options);
    var path, query, obj;

    switch (req.op) {
    case "create":
    case "upgrade":
        var ecols = this.dbcolumns[req.table];
        var properties = {}, missing = 0, o;
        for (var p in req.obj) {
            o = req.obj[p];
            if (req.op == "upgrade" && ecols && ecols[p]) continue;
            // All native properties goes as is
            if (o.elasticsearch) {
                properties[p] = lib.objClone(o.elasticsearch);
            } else
            // Predefined properties with types and other field params
            if (o.params && o.type == "object") {
                properties[p] = { properties: {} };
                for (const f in o.params) {
                    properties[p].properties[f] = { type: this.configOptions.typesMap[o.params[f].type] || this.configOptions.defaultType };
                    for (const m in this._mappings) {
                       if (o.params[f][m]) properties[p].properties[f][m] = o.params[f][m];
                    }
                }
            } else {
                // Just the type mapping
                var t = o.join ? "text" : this.configOptions.typesMap[o.type] || this.configOptions.defaultType;
                if (t) properties[p] = typeof t == "object" ? t : { type: t };
            }
            if (!properties[p]) continue;
            if (!properties[p].type && !properties[p].properties) {
                properties[p].type = this.configOptions.typesMap[o.type] || this.configOptions.defaultType;
            }
            if (req.op == "upgrade" && properties[p].type == "text") {
                delete properties[p];
                continue;
            }
            if (o.keyword) properties[p].type = "keyword";
            if (o.raw) properties[p].fields = { raw: { type: "keyword" } };
            if (o.analyzer) properties[p].analyzer = o.analyzer;
            if (!(ecols && ecols[p])) missing++;
        }
        if (!this.dbindexes[req.table]) {
            this.dbcolumns[req.table] = properties;
            this.dbindexes[req.table] = 1;
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
                        normalizer: {
                            keyword_lower: {
                                type: "custom",
                                char_filter: [],
                                filter: ["lowercase", "asciifolding"]
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
                mappings: {
                    date_detection: this.configOptions.date_detection,
                    numeric_detection: this.configOptions.numeric_detection,
                },
            };
            query.mappings.properties = properties;

            lib.series([
                function(next) {
                    if (self._version) return next();
                    self._getNodes(next);
                },
                function(next) {
                    self.doQuery("PUT", req.table, query, "", self.configOptions, next);
                },
            ], callback, true);
            return;
        }
        if (missing) {
            return this.doQuery("PUT", req.table + "/_mappings", { properties: properties }, "", this.configOptions, callback);
        }
        callback();
        break;

    case "drop":
        // Only if one index per table or single table regexp
        this.doQuery("DELETE", req.table, "", "", this.configOptions, callback);
        break;

    case "sql":
        path = "/_sql";
        query = this._getQuery("sql", req.options);
        obj = { query: req.text };
        if (req.options.filter) obj.filter = req.options.filter;
        if (lib.isArray(req.values)) obj.params = req.values;
        if (req.options.count > 0) obj.fetch_size = req.options.count;
        if (req.options.multi) obj.field_multi_value_leniency = true;
        if (req.options.columnar) obj.columnar = true;
        if (req.options.translate) path += "/translate";
        this.doQuery("POST", path, obj, query, req.options, (err, res) => {
            if (err?.status == 404) err = null;
            if (err || !res) return callback(err, []);
            var rows = lib.isArray(res.rows, []).map((x) => (x.reduce((r, v, i) => { r[res.columns[i].name] = v; return r }, {})));
            if (!req.options.no_next_token) res.next_token = res.cursor;
            if (!req.options.debug) delete res.rows;
            callback(err, rows, res);
        });
        break;

    case "select":
    case "search":
        var method = "POST", opts;
        path = req.table + "/" + (req.options.op || "_search");
        query = this._getQuery("query", req.options);
        if (lib.isObject(req.obj)) {
            if (req.obj.aggs || req.obj.aggregations || req.obj.query) {
                // Native JSON request
                obj = req.obj;
                opts = obj;
            } else {
                if (req.obj.q) req.obj.q = lib.phraseSplit(req.obj.q, req.options.splitOptions);
                if (lib.isObject(req.options.filter)) {
                    obj = {
                        query: {
                            bool: {
                                must: {
                                    query_string: {
                                        query: this._getQuery("qs", req.options),
                                    }
                                },
                                filter: req.options.filter
                            }
                        },
                    };
                    obj.query.bool.must.query_string.query = this.getQueryString(req);
                    if (!obj.query.bool.must.query_string.query) delete obj.query.bool.must.query_string;
                } else {
                    obj = {
                        query: {
                            query_string: this._getQuery("qs", req.options),
                        }
                    };
                    obj.query.query_string.query = this.getQueryString(req);
                    if (!obj.query.query_string.query) delete obj.query;
                    if (req.options.noscan && lib.isEmpty(obj)) {
                        logger.info('select:', this.name, req, "NO EMPTY SCANS ENABLED");
                        return callback();
                    }
                }
                opts = obj;
            }
        } else
        // Already formatted query string
        if (typeof req.obj == "string" && req.obj) {
            obj = {
                query: {
                    query_string: this._getQuery("qs", req.options),
                }
            };
            obj.query.query_string.query = req.obj;
            opts = obj;
        } else {
            return callback();
        }

        if (req.options.random_score) {
            obj = {
                query: {
                    function_score: {
                        query: obj.query,
                        random_score: {},
                    }
                }
            }
            opts = obj;
        }

        if (req.options.count > 0) opts.size = req.options.count;
        if (req.options.select) opts._source = lib.strSplit(req.options.select);
        if (req.options.scroll_timeout > 0) query.scroll = lib.toNumber(req.options.scroll_timeout) + "ms"; else
        if (req.options.fullscan) query.scroll = this.configOptions.scroll_timeout;
        if (req.options.explain) query.explain = true;
        if (req.options.start) {
            if (Array.isArray(req.options.start)) {
                obj.search_after = req.options.start;
            } else
            if (lib.isNumeric(req.options.start)) {
                opts.from = req.options.start;
            } else
            if (lib.isObject(req.options.start) && req.options.start.scroll_id && req.options.start.scroll) {
                for (const p in query) delete query[p];
                for (const p in opts) delete opts[p];
                query.scroll_id = req.options.start.scroll_id;
                if (!options.scroll) query.scroll = req.options.start.scroll;
                path = "/_search/scroll";
                method = "GET";
            }
        }
        // Pass a string, or a list of strings/formatted sorting objects
        if (req.options.sort) {
            var sort = lib.strSplit(req.options.sort).map((x) => {
                if (!x) return null;
                if (typeof x == "object") return x;
                if (typeof x != "string") return null;
                if (x[0] == "_") {
                    if (x == "_random") {
                        return { _script: { script: "Math.random()", type: "number", order: "asc" } };
                    }
                    return x;
                }
                let desc;
                if (x[0] == "!") {
                    desc = 1;
                    x = x.substr(1);
                }
                const col = dbcols[x];
                if (col) {
                    if (desc) {
                        return col.raw ? { [x + ".raw"]: { order: "desc" } } : { [x]: { order: "desc" } };
                    }
                    return col.raw ? x + ".raw" : x;
                }
                // Nested object
                if (x.indexOf(".") > -1) {
                    var y = x.split(".");
                    if (dbcols[y[0]]) {
                        return desc ? { [x]: { order: "desc" } } : x;
                    }
                }
                return null;
            }).filter((x) => (x));
            if (sort.length) {
                if (!Array.isArray(opts.sort)) opts.sort = [];
                for (const i in sort) {
                    if (req.options.desc || req.options.sort_missing) {
                        const o = typeof sort[i] == "string" ? { [sort[i]]: {} } : sort[i];
                        for (const p in o) {
                            if (req.options.desc) o[p].order = "desc";
                            if (req.options.sort_missing && !/_score|_doc/.test(p)) o[p].missing = req.options.sort_missing;
                        }
                        opts.sort.push(o);
                    } else {
                        opts.sort.push(sort[i]);
                    }
                }
            }
            if (req.options.sort == "random") {
                opts.sort = { _script: { script: "Math.random()", type: "number", order: "asc" } };
            }
        }
        if (req.options.total) {
            path = req.table + "/_count";
            delete opts.sort;
        }
        if (req.options.track_total_hits && obj.query) {
            obj.track_total_hits = true;
        }

        this.doQuery(method, path, obj, query, req.options, (err, res) => {
            if (err?.status == 404) {
                logger.info("elasticsearchQuery:", "notfound:", path, obj, query, err);
                err = null;
            }
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
                rows = res.hits.hits.map((x) => {
                    if (Array.isArray(req.options.sort_names) && Array.isArray(x.sort)) {
                        for (var i = 0; i < req.options.sort_names.length; i++) x._source[req.options.sort_names[i]] = x.sort[i];
                    }
                    return x._source || x.fields || {};
                });
                if (!res.total) res.total = res.hits.total ? res.hits.total > 0 ? res.hits.total : res.hits.total.value || 0 : 0;
                if (!req.options.debug) delete res.hits.hits;
            }
            if (req.options.info_query) res.query = obj.query;
            if (req.options.total) rows = [{ count: res.count }];
            if (res._scroll_id) {
                if (!rows.length || (req.options.limit > 0 && req.options.limit_count + rows.length >= req.options.limit)) {
                    this.doQuery("DELETE", "/_search/scroll", { scroll_id: res._scroll_id }, "", this.configOptions, lib.noop);
                    res.next_token = null;
                }
            }
            callback(null, rows, res);
        });
        break;

    case "list":
        path = req.table + "/_mget";
        query = this._getQuery("list", req.options);
        if (req.options.select) query._source = lib.strSplit(req.options.select).join(",");
        var ids = [];
        for (const i in req.obj) ids.push(this._getKey(Object.keys(req.obj[i]), req.obj[i]));
        this.doQuery("GET", path, { ids: ids }, query, req.options, (err, res) => {
            if (err?.status == 404) err = null;
            if (err || !res) return callback(err, []);
            var rows = res.docs ? res.docs.map((x) => (x._source || x.fields || {})) : [];
            if (!req.options.debug) delete res.docs;
            callback(null, rows, res);
        });
        break;

    case "get":
        path = req.table + "/" + this.configOptions.docType + "/" + lib.escape(this._getKey(keys, req.obj));
        query = this._getQuery("get", req.options);
        if (req.options.select) query.fields = String(req.options.select);
        this.doQuery("GET", path, obj, query, req.options, (err, res) => {
            if (err?.status == 404) err = null;
            if (err || !(res?._source || res?.fields)) return callback(err, []);
            callback(null, [ res._source || res.fields ], res);
        });
        break;

    case "add":
        req.options.op_type = "create";
    case "put":
        path = req.table + "/" + this.configOptions.docType + "/" + lib.escape(this._getKey(keys, req.obj));
        query = this._getQuery("index", req.options);
        this.doQuery("PUT", path, req.obj, query, req.options, (err, res) => {
            if (!err && res) res.affected_rows = 1;
            if (err?.status == 409) err.code = "AlreadyExists";
            callback(err, [], res);
        });
        break;

    case "incr":
        req.options.upsert = true;
    case "update":
        path = req.table + "/_update/" + lib.escape(this._getKey(keys, req.obj));
        query = this._getQuery("index", req.options);
        obj = this._getUpdate(req);
        if (!obj) return callback(null, [], {});
        if (req.options.returning == "*") obj._source = true;
        if (typeof req.options.retry_on_conflict == "undefined") query.retry_on_conflict = this.configOptions.retryOnConflict;
        this.doQuery("POST", path, obj, query, req.options, (err, res) => {
            if (!err && res?.result == "updated") res.affected_rows = 1;
            if (err?.status == 404) err = null;
            if (err?.status == 409) err.code = "AlreadyExists";
            callback(err, [], res);
        });
        break;

    case "del":
        path = req.table + "/" + this.configOptions.docType + "/" + lib.escape(this._getKey(keys, req.obj));
        query = this._getQuery("del", req.options);
        this.doQuery("DELETE", path, obj, query, req.options, (err, res) => {
            if (!err && res) res.affected_rows = 1;
            if (err?.status == 404) err = null;
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
                if (!obj.query.query_string.query) obj.query = { match_all: {} };
            }
        } else
        if (typeof req.obj == "string") {
            query.q = req.obj;
        }
        this.doQuery("POST", path, obj, query, req.options, (err, res) => {
            if (!err && res) res.affected_rows = res.deleted;
            callback(err, [], res);
        });
        break;

    case "bulk":
        var info = { retry_count: 0, _size: req.obj.length, _retries: 0, _timeout: this.configOptions.bulkRetryTimeout };
        var bulk = req.obj, bulkSize = req.options.bulkSize || this.configOptions.bulkSize;
        var map = {}, errors = [];
        lib.doWhilst(
            function(next) {
                var item, meta, data = "";
                var batch = bulk.slice(0, bulkSize);
                bulk = bulk.slice(bulkSize);
                if (!batch.length) return next();
                for (const i in batch) {
                    item = batch[i];
                    if (item.errstatus) {
                        errors.push(item);
                        continue;
                    }
                    keys = db.getKeys(item.table, item.options);
                    meta = { _id: self._getKey(keys, item.obj), _index: item.table };
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
                        if (!item.options || typeof req.options.retry_on_conflict != "number") {
                            meta.retry_on_conflict = self.configOptions.retryOnConflict;
                        }
                        var d = self._getUpdate(item);
                        if (!d) {
                            item.errstatus = 404;
                            errors.push(item);
                            break;
                        }
                        data += lib.stringify({ update: meta }) + "\n";
                        data += lib.stringify(d) + "\n";
                        break;
                    case "del":
                        data += lib.stringify({ delete: meta }) + "\n";
                        break;
                    }
                    map[meta._id] = item;
                }
                if (!data) return next();
                options.headers = { "content-type": "application/json" };
                self.doQuery("POST", "/_bulk", data, "", options, (err, res) => {
                    if (!err && res) {
                        var retry, item;
                        for (const i in res.items) {
                            item = res.items[i].create || res.items[i].index || res.items[i].update || res.items[i].delete;
                            if (item?.status >= 400 && map[item._id]) {
                                if (item.status == 429) {
                                    bulk.unshift(map[item._id]);
                                    retry = 1;
                                } else {
                                    errors.push(lib.objExtend(map[item._id], { _id: item._id, errstatus: item.status, errmsg: item.error && item.error.reason }, { del: /^(orig|options)/ }));
                                }
                            }
                        }
                        if (res.retry_count) info.retry_count += res.retry_count;
                        if (retry) {
                            info._retries++;
                            return setTimeout(next, lib.objMult(info, "_timeout", 2, "old"));
                        }
                    }
                    next(err);
                });
            },
            function() {
                return info._retries < self.configOptions.bulkRetryCount && bulk.length > 0;
            },
            function(err) {
                if (!err) info.affected_rows = info._size - errors.length;
                callback(err, errors, info);
        }, true);
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

