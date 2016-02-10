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
var core = require(__dirname + '/../lib/core');
var lib = require(__dirname + '/../lib/lib');
var db = require(__dirname + '/../lib/db');
var logger = require(__dirname + '/../lib/logger');

var pool = {
    name: "cassandra",
    configOptions: {
        typesMap: { json: "text", real: "double", counter: "counter", bigint: "bigint" },
        opsMap: { begins_with: "begins_with" },
        sqlPlaceholder: "?",
        strictTypes: 1,
        noCoalesce: 1,
        ifExpected: 1,
        noConcat: 1,
        noDefaults: 1,
        noAuto: 1,
        noNulls: 1,
        noLengths: 1,
        noReplace: 1,
        noBetween: 1,
        noJson: 1,
        noCustomKey: 1,
        noCompositeIndex: 1,
        noMultiSQL: 1
    },
    createPool: function(options) { return new Pool(options); }
};
module.exports = pool;

db.modules.push(pool);

function Pool(options)
{
    options.type = pool.name;
    db.SqlPool.call(this, options);
    this.configOptions = lib.mergeObj(this.configOptions, pool.configOptions);
}
util.inherits(Pool, db.SqlPool)

Pool.prototype.open = function(callback)
{
    var self = this;
    if (this.url == "default") this.url = "cassandra://cassandra:cassandra@127.0.0.1/" + db.dbName;
    var hosts = lib.strSplit(this.url).map(function(x) { return url.parse(x); });
    if (!hosts.length) return callback(lib.newError("no server provider"));

    var opts = { contactPoints: hosts.map(function(x) { return x.host }), keyspace: hosts[0].path.substr(1) };
    for (var p in this.connectOptions) opts[p] = this.connectOptions[p];
    if (opts.user && opts.password) {
        opts.authProvider = new cassandra.auth.PlainTextAuthProvider(opts.user, opts.pasword);
    } else
    if (hosts[0].auth) {
        opts.authProvider = new cassandra.auth.PlainTextAuthProvider(hosts[0].auth.split(':')[0], hosts[0].auth.split(':')[1]);
    }
    var cassandra = require('cassandra-driver');
    var client = new cassandra.Client(opts);
    client.query = function() { self.doQuery.apply(client, arguments) }
    client.on('error', function(err) { logger.error('cassandra:', err); });
    callback(null, client);
}

Pool.prototype.doQuery = function(text, values, options, callback)
{
    var self = this;
    this.execute(text, values ? lib.cloneObj(values) : null, options, function(err, result) {
        if (err) return callback(err, []);
        var rows = [];
        if (result && result.rows) {
            for (var i = 0; i < result.rows.length; i++) {
                var obj = {};
                result.rows[i].forEach(function(value, name) {
                    obj[name] = value;
                });
                rows.push(obj);
            }
            if (options && options.rowfilter) {
                rows = options.rowfilter(rows);
                delete options.rowfilter;
            }
            if (options && options.rowsort) {
                rows = options.rowsort(rows);
                delete options.rowsort;
            }
        }
        self.affected_rows = 1;
        callback(err, rows);
    });
}

// No REPLACE INTO support but UPDATE creates new record if no primary key exists
Pool.prototype.put = function(table, obj, options, callback)
{
    db.update(table, obj, options, callback);
}

Pool.prototype.close = function(client, callback)
{
    client.shutdown(callback);
}

Pool.prototype.prepare = function(req)
{
    switch (op) {
    case "search":
    case "select":
        req.options = lib.cloneObj(req.options);
        // Cannot search by non primary keys
        var keys = db.getKeys(req.table);
        var cols = req.columns || db.getColumns(req.table);
        var lastKey = keys[keys.length - 1], lastOps = req.options.ops && req.options.ops[lastKey];

        // Install custom filter if we have other columns in the keys
        var other = Object.keys(req.obj).filter(function(x) { return x[0] != "_" && keys.indexOf(x) == -1 && typeof req.obj[x] != "undefined" });
        // Custom filter function for in-memory filtering of the results using non-indexed properties
        if (other.length) req.options.rowfilter = function(rows) {
            return db.filterRows(obj, rows, { keys: other, cols: cols, ops: req.options.ops, typesMap: req.options.typesMap || this.configOptions.typesMap });
        }
        req.options.keys = keys;

        // Sorting is limited to the second part of the composite key so we will do it in memory
        if (req.options.sort && (keys.length < 2 || keys[1] != req.options.sort)) {
            var sort = req.options.sort;
            req.options.rowsort = function(rows) { return rows.sort(function(a,b) { return (a[sort] - b[sort])*(req.options.desc?-1:1) }) }
            req.options.sort = null;
        }

        // Pagination, start must be a token returned by the previous query
        if (Array.isArray(req.options.start) && typeof req.options.start[0] == "object") {
            req.obj = lib.cloneObj(req.obj);
            req.options.ops[lastKey] = req.options.desc ? "lt" : "gt";
            req.options.start.forEach(function(x) { for (var p in x) req.obj[p] = x[p]; });
        }
        logger.debug('select:', pool.name, req.options.keys, req.options.sort, other);

        db.sqlPrepare(req);
        if (lastOps) req.options.ops[lastKey] = lastOps;
        if (!req.obj[keys[0]]) req.text += " ALLOW FILTERING";
        return;

    case "add":
    case "incr":
    case "put":
    case "update":
        req.options.hints = [];
        break;
    }
    db.sqlPrepare(req);
}

Pool.prototype.bindValue = function(value, info, options)
{
    if (options.hints) options.hints.push(options.typesMap[info && info.type] || (info && info.type) || "text");
    return value;
}

Pool.prototype.cacheColumns = function(options, callback)
{
    var self = this;

    this.acquire(function(err, client) {
        if (err) return callback(err, []);

        client.query("SELECT * FROM system.schema_columns WHERE keyspace_name=?", [client.keyspace], options, function(err, rows) {
            rows.sort(function(a,b) { return a.component_index - b.component_index });
            seld.dbcolumns = {};
            self.dbkeys = {};
            self.dbindexes = {};
            for (var i = 0; i < rows.length; i++) {
                if (!self.dbcolumns[rows[i].columnfamily_name]) self.dbcolumns[rows[i].columnfamily_name] = {};
                var data_type = rows[i].validator.replace(/[\(\)]/g,".").split(".").pop().replace("Type", "").toLowerCase();
                // Set data type to collection type, use type for items
                var d = rows[i].validator.match(/(ListType|SetType|MapType)/);
                if (d) data_type = d[1].replace("Type", "").toLowerCase() + " " + data_type;
                var col = { id: i, data_type: data_type };
                switch(rows[i].type) {
                case "regular":
                    if (!rows[i].index_name) break;
                    if (!self.dbindexes[rows[i].index_name]) self.dbindexes[rows[i].index_name] = [];
                    self.dbindexes[rows[i].index_name].push(rows[i].column_name);
                    break;
                case "partition_key":
                    if (!self.dbkeys[rows[i].columnfamily_name]) self.dbkeys[rows[i].columnfamily_name] = [];
                    self.dbkeys[rows[i].columnfamily_name].unshift(rows[i].column_name);
                    if (col) col.primary = true;
                    break;
                case "clustering_key":
                    if (!self.dbkeys[rows[i].columnfamily_name]) self.dbkeys[rows[i].columnfamily_name] = [];
                    self.dbkeys[rows[i].columnfamily_name].push(rows[i].column_name);
                    if (col) col.primary = true;
                    break;
                }
                self.dbcolumns[rows[i].columnfamily_name][rows[i].column_name] = col;
            }
            self.release(client);
            callback(err);
        });
    });
}

Pool.prototype.nextToken = function(client, req, rows)
{
    if (req.options && req.options.count > 0 && rows.length == req.options.count) {
        var keys = db.getKeys(req.table);
        return keys.map(function(x) { return lib.newObj(x, rows[rows.length-1][x]) });
    }
    return null;
}

