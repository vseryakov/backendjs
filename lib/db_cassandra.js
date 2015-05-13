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
var utils = require(__dirname + '/../build/Release/backend');
var helenus = require('helenus');

// Cassandra pool
db.cassandraInitPool = function(options)
{
    var self = this;
    if (!options) options = {};
    if (!options.pool) options.pool = "cassandra";
    options.type = "cassandra";
    options.settings = { typesMap: { json: "text", real: "double", counter: "counter", bigint: "bigint" },
                          opsMap: { begins_with: "begins_with" },
                          sqlPlaceholder: "?",
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
                          noMultiSQL: 1 };
    var pool = this.sqlInitPool(options);
    pool.cacheColumns = self.cassandraCacheColumns;
    pool.open = function(callback) {
        if (this.url == "default") this.url = "cassandra://cassandra:cassandra@127.0.0.1/" + db.dbName;
        var hosts = lib.strSplit(this.url).map(function(x) { return url.parse(x); });
        var  client = new helenus.ConnectionPool({ hosts: hosts.map(function(x) { return x.host }),
                                              keyspace: hosts[0].path.substr(1),
                                              user: hosts[0].auth ? hosts[0].auth.split(':')[0] : null,
                                              password: hosts[0].auth ? hosts[0].auth.split(':')[1] : null });
        client.query = this.cassandraQuery;
        client.on('error', function(err) { logger.error('cassandra:', err); });
        client.connect(function(err, keyspace) {
            if (err) logger.error('cassandraOpen:', err);
            if (callback) callback(err, client);
        });
    }
    // No REPLACE INTO support but UPDATE creates new record if no primary key exists
    pool.put = function(table, obj, opts, callback) {
        self.update(table, obj, opts, callback);
    };
    pool.nextToken = function(client, req, rows, opts) {
        if (opts.count > 0 && rows.length == opts.count) {
            var keys = this.dbkeys[req.table] || [];
            return keys.map(function(x) { return lib.newObj(x, rows[rows.length-1][x]) });
        }
        return null;
    }
    pool.close = function(client, callback) {
        client.close(callback);
    }
    pool.prepare = function(op, table, obj, opts) {
        switch (op) {
        case "search":
        case "select":
            // Cannot search by non primary keys
            var keys = this.dbkeys[table.toLowerCase()] || [];
            var cols = this.dbcolumns[table.toLowerCase()] || {};
            // Save original properties, restore on exit to keep options unmodified for the caller
            var old = pool.saveOptions(opts, 'keys', 'sort');
            var lastKey = keys[keys.length - 1], lastOps = opts.ops[lastKey];

            // Install custom filter if we have other columns in the keys
            var other = Object.keys(obj).filter(function(x) { return x[0] != "_" && keys.indexOf(x) == -1 && typeof obj[x] != "undefined" });
            // Custom filter function for in-memory filtering of the results using non-indexed properties
            if (other.length) opts.rowfilter = function(rows) { return self.filterColumns(obj, rows, { keys: other, cols: cols, ops: opts.ops, typesMap: options.typesMap }); }
            opts.keys = keys;

            // Sorting is limited to the second part of the composite key so we will do it in memory
            if (opts.sort && (keys.length < 2 || keys[1] != opts.sort)) {
                var sort = opts.sort;
                opts.rowsort = function(rows) { return rows.sort(function(a,b) { return (a[sort] - b[sort])*(opts.desc?-1:1) }) }
                opts.sort = null;
            }

            // Pagination, start must be a token returned by the previous query
            if (Array.isArray(opts.start) && typeof opts.start[0] == "object") {
                obj = lib.cloneObj(obj);
                opts.ops[lastKey] = opts.desc ? "lt" : "gt";
                opts.start.forEach(function(x) { for (var p in x) obj[p] = x[p]; });
            }
            logger.debug('select:', pool.name, opts.keys, opts.sort, other);

            var req = self.sqlPrepare(op, table, obj, opts);
            pool.restoreOptions(opts, old);
            if (lastOps) opts.ops[lastKey] = lastOps;
            return req;
        }
        return self.sqlPrepare(op, table, obj, opts);
    }
    return pool;
}

db.cassandraQuery = function(text, values, options, callback)
{
    var self = this;
    if (typeof values == "function") callback = values, values = null, options = null;
    if (typeof options == "function") callback = options, options = null;
    try {
        this.cql(text, lib.cloneObj(values), function(err, results) {
            if (err || !results) return callback(err, []);
            var rows = [];
            results.forEach(function(row) {
                var obj = {};
                row.forEach(function(name, value, ts, ttl) {
                    obj[name] = value;
                    if (ts) obj["_timestamp"] = ts;
                    if (ttl) obj["_ttl"] = ttl;
                    if (name == ['[applied]']) self.affected_rows = value ? 1 : 0;
                });
                rows.push(obj);
            });
            if (options && options.rowfilter) {
                rows = options.rowfilter(rows);
                delete options.rowfilter;
            }
            if (options && options.rowsort) {
                rows = options.rowsort(rows);
                delete options.rowsort;
            }
            callback(err, rows);
        });
    } catch(e) {
        callback(e, []);
    }
}

db.cassandraCacheColumns = function(options, callback)
{
    var self = this;

    self.get(function(err, client) {
        if (err) return callback(err, []);

        client.query("SELECT * FROM system.schema_columns WHERE keyspace_name = ?", [client.keyspace], function(err, rows) {
            rows.sort(function(a,b) { return a.component_index - b.component_index });
            self.dbcolumns = {};
            self.dbindexes = {};
            self.dbkeys = {};
            for (var i = 0; i < rows.length; i++) {
                if (!self.dbcolumns[rows[i].columnfamily_name]) self.dbcolumns[rows[i].columnfamily_name] = {};
                var data_type = rows[i].validator.replace(/[\(\)]/g,".").split(".").pop().replace("Type", "").toLowerCase();
                var db_type = "";
                switch (data_type) {
                case "decimal":
                case "float":
                case "int32":
                case "long":
                case "double":
                case "countercolumn":
                    db_type = "number";
                    break;

                case "boolean":
                    db_type = "bool";
                    break;

                case "date":
                case "timestamp":
                    db_type = "date";
                    break;
                }
                // Set data type to collection type, use type for items
                var d = rows[i].validator.match(/(ListType|SetType|MapType)/);
                if (d) data_type = d[1].replace("Type", "").toLowerCase() + ":" + data_type;
                var col = { id: i, db_type: db_type, data_type: data_type };
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

