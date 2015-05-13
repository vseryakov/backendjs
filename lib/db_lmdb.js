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
    if (!options.concurrency) options.concurrency = 3;
    options.settings = { noJson: 1, noCacheColumns: 1 };
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
            if (!lib.exists(this, "create_if_missing")) options.create_if_missing = true;
            var path = core.path.spool + "/" + (options.url || ('ldb_' + core.processName()));
            new utils.LevelDB(path, options, function(err) {
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
            if (!options.path) options.path = core.path.spool;
            if (!options.flags) options.flags = utils.MDB_CREATE;
            if (!options.dbs) options.dbs = 1;
            // Share same environment between multiple pools, each pool works with one db only to keep the API simple
            if (options.env && options.env instanceof utils.LMDBEnv) this.env = options.env;
            if (!this.env) this.env = new utils.LMDBEnv(options);
            new utils.LMDB(this.env, { name: options.url, flags: options.flags }, function(err) {
                pool.dbhandle = this;
                callback(err, this);
            });
        } catch(e) {
            callback(e);
        }
    }
    pool.get = function(callback) {
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
                lib.forEachLimit(rows, opts.concurrency || pool.concurrency, function(row, next) {
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
                    rows = self.filterColumns(obj, rows, { keys: other, cols: cols, ops: opts.ops, typesMap: opts.typesMap });
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
                if (item) return callback(new Error("already exists"), []);
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
            var nums = (opts.counter || []).filter(function(x) { return keys.indexOf(x) == -1 });
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
            callback(new Error("invalid op"), []);
        }
    };
    return pool;
}

// Create a database pool that works with nanomsg server, all requests will be forwarded to the nanomsg socket,
// the server can be on the same machine or on the remote, 2 nanomsg socket types are supported: NN_PUSH or NN_REQ.
// In push mode no replies are expected, only sending db updates, in Req mode the server will reply on 'get' command only,
// all other commands work as in push mode. Only 'get,put,del,incr' comamnd are supported, add,update will be sent as put, LevelDB or LMDB
// on the other side only support simple key-value operations.
// Options can define the following:
// - socket - nanomsg socket type, default is utils.NN_PUSH, can be utils.NN_REQ
db.nndbInitPool = function(options)
{
    var self = this;
    if (!options) options = {};
    if (!options.pool) options.pool = "nndb";

    options.type = "nndb";
    var pool = this.createPool(options);

    pool.get = function(callback) {
        if (this.sock) return callback(null, this);

        try {
            if (typeof options.socket == "string") options.socket = backend[options.socket];
            this.sock = new utils.NNSocket(utils.AF_SP, options.socket || utils.NN_PUSH);
            this.sock.connect(options.db);
        } catch(e) {
            return callback(e, this);
        }
        // Request socket needs a callback handler, reply comes as JSON with id property
        if (this.sock.type == utils.NN_REQ) {
            this.socknum = 1;
            this.callbacks = {};
            this.sock.setCallback(function(err, msg) { lib.runCallback(pool.callbacks, msg); });
        }
        return callback(null, this);
    }

    pool.query = function(client, req, opts, callback) {
        if (typeof req.obj == "string") req.obj = { name: req.obj, value: "" };
        var obj = { op: req.op, name: req.obj.name, value: req.obj.value || "" };

        switch (req.op) {
        case "get":
        case "select":
            if (this.sock.type != utils.NN_REQ) return callback(null, []);

            obj.id = this.socknum++;
            lib.deferCallback(this.callbacks, obj, function(msg) { callback(null, msg.value) });
            this.sock.send(JSON.stringify(obj));
            return;

        case "add":
        case "update":
        case "put":
        case "del":
        case "incr":
            this.sock.send(JSON.stringify(obj));

        default:
            return callback(null, []);
        }
    }

    return pool;
}

