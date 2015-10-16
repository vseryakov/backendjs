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
var bklmdb = require("bkjs-lmdb");
var bkleveldb = require("bkjs-leveldb");

// Setup LMDB/LevelDB database driver, this is simplified driver which supports only basic key-value operations,
// table parameter is ignored, the object only supports the properties name and value in the record objects.
//
// Because this driver supports 2 databases it requires type to be specified, possible values are: `lmdb, leveldb`
//
// Options are passed to the LMDB low level driver as MDB_ flags according to http://symas.com/mdb/doc/ and
// as properties for LevelDB as described in http://leveldb.googlecode.com/svn/trunk/doc/index.html
//
// The LevelDB database can only be shared by one process so if no unique options.url is given, it will create a unique database using core.processId()
db.leveldbInitPool = function(options)
{
    var self = this;
    if (!options) options = {};
    if (!options.pool) options.pool = "leveldb";
    options.type = "leveldb";
    return this.lmdbInitPool(options);
}

db.lmdbInitPool = function(options)
{
    var self = this;
    if (!options) options = {};
    if (!options.pool) options.pool = "lmdb";
    if (!options.type) options.type = "lmdb"
    options.settings = { noJson: 1, noCacheColumns: 1, concurrency: options.concurrency || 3 };
    var pool = this.createPool(options);

    pool.nextToken = function(client, req, rows, opts) {
        if (opts.count > 0 && rows.length == opts.count) {
            var key = this.getKey(req.table, rows[rows.length - 1], { ops: {} }, 1);
            return key.substr(0, key.length - 1) + String.fromCharCode(key.charCodeAt(key.length - 1) + 1);
        }
        return null;
    }

    pool.getLevelDB = function(callback) {
        if (this.dbhandle) return callback(null, this.dbhandle);
        try {
            var path = core.path.spool + "/" + (this.url || ('ldb_' + core.processName()));
            new bkleveldb.Database(path, this.settings, function(err) {
                pool.dbhandle = this;
                callback(null, this);
            });
        } catch(e) {
            callback(e);
        }
    }
    pool.getLMDB = function(callback) {
        if (this.dbhandle) return callback(null, this.dbhandle);
        try {
            if (!this.settings.path) this.settings.path = core.path.spool;
            if (!this.settings.flags) this.settings.flags = bklmdb.MDB_CREATE;
            if (!this.settings.dbs) this.settings.dbs = 1;
            // Share same environment between multiple pools, each pool works with one db only to keep the API simple
            if (this.settings.env && this.settings.env instanceof bklmdb.Env) this.env = this.settings.env;
            if (!this.env) this.env = new bklmdb.Env(this.settings);
            new bklmdb.Database(this.env, { name: this.url, flags: this.settings.flags }, function(err) {
                pool.dbhandle = this;
                callback(err, this);
            });
        } catch(e) {
            callback(e);
        }
    }
    pool.acquire = function(callback) {
        switch (this.type) {
        case "lmdb": return this.getLMDB(callback);
        case "leveldb": return this.getLevelDB(callback);
        default: return callback();
        }
    }
    pool.getKeys = function(table, obj, opts, search) {
        var keys = self.getQueryForKeys(this.dbkeys[table] || [], obj);
        if (!search) return keys;
        for (var p in keys) {
            if (!opts.ops[p]) continue;
            switch (opts.ops[p]) {
            case "eq":
            case "begins_with":
            case "like%":
                break;

            default:
                delete keys[p];
            }
        }
        return keys;
    }
    pool.getKey = function(table, obj, opts, search) {
        var keys = this.getKeys(table, obj, opts, search);
        for (var p in keys) table += "|" + keys[p];
        return table;
    }
    pool.query = function(client, req, opts, callback) {
        var pool = this;
        var obj = req.obj;
        var table = req.table || "";
        var keys = this.dbkeys[table] || [];
        var cols = this.dbcolumns[table] || {};

        switch(req.op) {
        case "create":
        case "upgrade":
            callback(null, []);
            break;

        case "drop":
            client.select(table, table, opts, function(err, rows) {
                if (err || !rows.length) return callback(err, []);
                lib.forEachLimit(rows, opts.concurrency || 1, function(row, next) {
                    client.del(row.name, next);
                }, function(err) {
                    callback(err, []);
                });
            });
            break;

        case "get":
            var key = pool.getKey(table, obj, opts);
            var selected = self.getSelectedColumns(table, opts);
            client.get(key, function(err, row) {
                if (err || !row) return callback(err, []);
                row = lib.jsonParse(row);
                if (selected) row = selected.map(function(x) { return [x, row[x] ]}).reduce(function(x,y) { x[y[0]] = y[1]; return x }, {});
                callback(err, [row]);
            });
            break;

        case "select":
        case "search":
            var dbkeys = pool.getKeys(table, obj, opts, 1);
            var key = pool.getKey(table, obj, opts, 1);
            var selected = self.getSelectedColumns(table, opts);
            // Custom filter on other columns
            var other = Object.keys(obj).filter(function(x) { return x[0] != "_" && (keys.indexOf(x) == -1 || !dbkeys[x]) && typeof obj[x] != "undefined" });
            client.select(opts.start || key, key, { begins_with: 1, count: opts.count }, function(err, items) {
                if (err) return callback(err, []);
                var rows = [];
                items.forEach(function(row) {
                    row = lib.jsonParse(row.value);
                    if (!row) return;
                    if (selected) row = selected.map(function(x) { return [x, row[x] ]}).reduce(function(x,y) { x[y[0]] = y[1]; return x }, {});
                    rows.push(row);
                });
                if (other.length > 0) {
                    rows = self.filterRows(obj, rows, { keys: other, cols: cols, ops: opts.ops, typesMap: opts.typesMap });
                }
                if (rows.length && opts.sort) rows.sort(function(a,b) { return (a[opts.sort] - b[opts.sort]) * (opts.desc ? -1 : 1) });
                callback(null, rows);
            });
            break;

        case "list":
            var rc = [];
            var selected = self.getSelectedColumns(table, opts);
            lib.forEachSeries(obj, function(o, next) {
                var key = pool.getKey(table, o, opts);
                client.get(key, opts, function(err, row) {
                    if (row) {
                        row = lib.jsonParse(row);
                        if (selected) row = selected.map(function(x) { return [x, row[x] ]}).reduce(function(x,y) { x[y[0]] = y[1]; return x }, {});
                        rc.push(row);
                    }
                    next(err);
                });
            }, function(err) {
                callback(err, rc);
            });
            break;

        case "add":
            var key = pool.getKey(table, obj, opts);
            client.get(key, opts, function(err, item) {
                if (err) return callback(err, []);
                if (item) return callback(lib.newError("already exists"), []);
                client.put(key, JSON.stringify(obj), opts, function(err) {
                    callback(err, []);
                });
            });
            break;

        case "update":
            var key = pool.getKey(table, obj, opts);
            client.get(key, opts, function(err, item) {
                if (err) return callback(err, []);
                if (!item) return callback(null, []);
                item = lib.jsonParse(item);
                if (!item) item = obj; else for (var p in obj) item[p] = obj[p];
                client.put(key, JSON.stringify(item), opts, function(err) {
                    callback(err, []);
                });
            });
            break;

        case "put":
            var key = pool.getKey(table, obj, opts);
            client.put(key, JSON.stringify(obj), opts, function(err) {
                callback(err, []);
            });
            break;

        case "incr":
            var key = pool.getKey(table, obj, opts);
            var nums = lib.searchObj(opts.updateOps, { value: "incr", names: 1 });
            if (!nums.length) return callback();
            client.get(key, function(err, item) {
                if (err) return callback(err);
                item = lib.jsonParse(item);
                if (!item) item = obj; else nums.forEach(function(x) { item[x] = lib.toNumber(item[x]) + obj[x]; });
                client.put(key, JSON.stringify(item), function(err) {
                    callback(err, []);
                });
            });
            break;

        case "del":
            var key = pool.getKey(table, obj, opts);
            client.del(key, opts, function(err) {
                callback(err, []);
            });
            break;

        default:
            callback(lib.newError("invalid op"), []);
        }
    };
    return pool;
}


