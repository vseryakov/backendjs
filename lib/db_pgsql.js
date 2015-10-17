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
var bkpgsql = require("bkjs-pgsql");

// Setup PostgreSQL pool driver
db.pgsqlInitPool = function(options)
{
    var self = this;
    if (!options.pool) options.pool = "pgsql";
    options.settings = {
        typesMap: { real: "numeric", bigint: "bigint", smallint: "smallint", search: "tsvector" },
        noIfExists: 1,
        noReplace: 1,
        schema: ['public']
    };
    options.type = "pgsql";
    var pool = this.sqlInitPool(options);
    pool._handles = [];
    pool.bindValue = self.pgsqlBindValue;
    pool.cacheIndexes = self.pgsqlCacheIndexes;
    pool.open = function(callback) {
        var me = this;
        var client = pool._handles.pop();
        if (this.url == "default") this.url = "postgresql://postgres@127.0.0.1/" + self.dbName;
        if (!client) client = new bkpgsql.Database(this.url);
        client.connect(function(err) {
            if (err) {
                logger.error('pgsql: connect:', err);
                callback(err);
            } else {
                if (me.connect.blocking) client.setNonblocking(0);
                client.setNotify(function(msg) { logger.log('pgsql: notify:', msg) });
                callback(err, client);
            }
        });
    }
    pool.close = function(client, callback) {
        client.close(function() {
            if (typeof callback == "function") callback();
            pool._handles.push(client);
        });
    }
    pool.query = function(client, req, opts, callback) {
        return self.sqlQuery(client, req,opts, function(err, rows, info) {
            if (!err && req.op == "create") client.affected_rows = 1;
            callback(err, rows, info);
        });
    }
    // No REPLACE INTO support, do it manually
    pool.put = function(table, obj, opts, callback) {
        self.update(table, obj, opts, function(err, rows, info) {
            if (err || info.affected_rows) return callback ? callback(err, rows, info) : null;
            self.add(table, obj, opts, callback);
        });
    }
    pool.prepare = function(op, table, obj, opts) {
        switch (op) {
        case "create":
        case "upgrade":
            var req = self.sqlPrepare(op, table, obj, opts);
            if (!req.text.length) return req;
            // Prepare FTS triggers from the projection columns
            var cols = this.dbcolumns[table.toLowerCase()] || {}, rc = [];
            for (var p in cols) {
                if (cols[p].type == "search" && cols[p].projection) {
                    rc.push("DROP TRIGGER IF EXISTS " + table + "_" + p + "_trigger ON " + table + " CASCADE");
                    rc.push("CREATE TRIGGER " + table + "_" + p + "_trigger BEFORE INSERT OR UPDATE ON " + table + " FOR EACH ROW EXECUTE PROCEDURE tsvector_update_trigger(" + p + ", 'pg_catalog." + (cols[p].lang || "english") +"'," + lib.strSplit(cols[p].projection).join(",") + ")");
                }
            }
            if (Array.isArray(req.text)) req.text = req.text.concat(rc); else req.text += ";" + rc.join(";");
            return req;
        }
        return self.sqlPrepare(op, table, obj, opts);
    }
    return pool;
}

// Cache indexes using the information_schema
db.pgsqlCacheIndexes = function(options, callback)
{
    var self = this;

    self.acquire(function(err, client) {
        if (err) return callback ? callback(err, []) : null;

        client.query("SELECT t.relname as table, i.relname as index, indisprimary as pk, array_agg(a.attname ORDER BY a.attnum) as cols "+
                     "FROM pg_class t, pg_class i, pg_index ix, pg_attribute a, pg_catalog.pg_namespace n "+
                     "WHERE t.oid = ix.indrelid and i.oid = ix.indexrelid and a.attrelid = t.oid and n.oid = t.relnamespace and " +
                     "      a.attnum = ANY(ix.indkey) and t.relkind = 'r' and n.nspname not in ('pg_catalog', 'pg_toast') "+
                     "GROUP BY t.relname, i.relname, ix.indisprimary ORDER BY t.relname, i.relname", function(err, rows) {
            if (err) logger.error('cacheIndexes:', self.name, err);
            self.dbkeys = {};
            self.dbindexes = {};
            for (var i = 0; i < rows.length; i++) {
                if (rows[i].pk) {
                    self.dbkeys[rows[i].table] = rows[i].cols;
                } else {
                    self.dbindexes[rows[i].index] = rows[i].cols;
                }
            }
            self.release(client);
            if (callback) callback(err);
        });
    });
}

// Convert JS array into db PostgreSQL array format: {..}
db.pgsqlBindValue = function(val, info)
{
    function toArray(v) {
        return '{' + v.map(function(x) { return Array.isArray(x) ? toArray(x) : typeof x === 'undefined' || x === null ? 'NULL' : JSON.stringify(x); } ).join(',') + '}';
    }
    switch ((info && info.data_type) || (info && info.type) || "") {
    case "json":
        val = JSON.stringify(val);
        break;

    case "array":
        if (Buffer.isBuffer(val)) {
            var a = [];
            for (var i = 0; i < v.length; i++) a.push(v[i]);
            val = a.join(',');
        } else
        if (Array.isArray(val)) {
            val = toArray(val);
        }
        if (val && val[0] != "{") val = "{" + val + "}";
        break;

    default:
        if (Buffer.isBuffer(val)) val = val.toJSON();
        if (Array.isArray(val)) val = String(val);
    }
    return val;
}

