//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var util = require('util');
var core = require(__dirname + '/../lib/core');
var lib = require(__dirname + '/../lib/lib');
var db = require(__dirname + '/../lib/db');
var logger = require(__dirname + '/../lib/logger');

// Setup LMDB/LevelDB database driver, this is simplified driver which supports only basic key-value operations,
// table parameter is ignored, the object only supports the properties name and value in the record objects.
//
// Because this driver supports 2 databases it requires type to be specified, possible values are: `lmdb, leveldb`
//
// Options are passed to the LMDB low level driver as MDB_ flags according to http://symas.com/mdb/doc/ and
// as properties for LevelDB as described in http://leveldb.googlecode.com/svn/trunk/doc/index.html
//
// The LevelDB database can only be shared by one process so if no unique options.url is given, it will create a unique database using core.processId()
var pool = {
    name: "lmdb",
    configOptions: { noJson: 1, concurrency: 3 },
    createPool: function(options) { return new Pool(options); }
};
module.exports = pool;

db.modules.push(pool);
db.modules.push(lib.cloneObj(pool, "name", "leveldb"))

function Pool(options)
{
    options.type = pool.name;
    db.Pool.call(this, options);
    this.configOptions = lib.mergeObj(this.configOptions, pool.configOptions);
}
util.inherits(Pool, db.Pool);

Pool.prototype.nextToken = function(client, req, rows)
{
    if (req.options && req.options.count > 0 && rows.length == req.options.count) {
        var key = this.getKey(req.table, rows[rows.length - 1], { ops: {} }, 1);
        return key.substr(0, key.length - 1) + String.fromCharCode(key.charCodeAt(key.length - 1) + 1);
    }
    return null;
}

Pool.prototype.getLevelDB = function(callback)
{
    var self = this;
    if (this.dbhandle) return callback(null, this.dbhandle);
    try {
        var path = core.path.spool + "/" + (this.url || ('ldb_' + core.processName()));
        var bkleveldb = require("bkjs-leveldb");
        new bkleveldb.Database(path, this.configOptions, function(err) {
            self.dbhandle = this;
            callback(null, this);
        });
    } catch(e) {
        callback(e);
    }
}

Pool.prototype.getLMDB = function(callback)
{
    var self = this;
    if (this.dbhandle) return callback(null, this.dbhandle);
    try {
        if (!this.v.path) this.configOptions.path = core.path.spool;
        if (!this.configOptions.configOptions) this.configOptions.flags = bklmdb.MDB_CREATE;
        if (!this.configOptions.dbs) this.configOptions.dbs = 1;
        // Share same environment between multiple pools, each pool works with one db only to keep the API simple
        if (this.configOptions.env && this.configOptions.env instanceof bklmdb.Env) this.env = this.configOptions.env;
        if (!this.env) this.env = new bklmdb.Env(this.configOptions);
        var bklmdb = require("bkjs-lmdb");
        new bklmdb.Database(this.env, { name: this.url, flags: this.configOptions.flags }, function(err) {
            self.dbhandle = this;
            callback(err, this);
        });
    } catch(e) {
        callback(e);
    }
}

Pool.prototype.acquire = function(callback)
{
    switch (this.type) {
    case "lmdb": return this.getLMDB(callback);
    case "leveldb": return this.getLevelDB(callback);
    default: return callback();
    }
}

Pool.prototype.getKeys = function(table, obj, options, search)
{
    var keys = db.getQueryForKeys(this.dbkeys[table] || [], obj);
    if (!search) return keys;
    for (var p in keys) {
        if (!options.ops[p]) continue;
        switch (options.ops[p]) {
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

Pool.prototype.getKey = function(table, obj, options, search)
{
    var keys = db.getKeys(table, obj, options, search);
    for (var p in keys) table += "|" + keys[p];
    return table;
}

Pool.prototype.query = function(client, req, options, callback)
{
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
        client.select(table, table, options, function(err, rows) {
            if (err || !rows.length) return callback(err, []);
            lib.forEachLimit(rows, options.concurrency || 1, function(row, next) {
                client.del(row.name, next);
            }, function(err) {
                callback(err, []);
            });
        });
        break;

    case "get":
        var key = this.getKey(table, obj, options);
        var selected = db.getSelectedColumns(table, options);
        client.get(key, function(err, row) {
            if (err || !row) return callback(err, []);
            row = lib.jsonParse(row);
            if (selected) row = selected.map(function(x) { return [x, row[x] ]}).reduce(function(x,y) { x[y[0]] = y[1]; return x }, {});
            callback(err, [row]);
        });
        break;

    case "select":
    case "search":
        var dbkeys = this.getKeys(table, obj, options, 1);
        var key = this.getKey(table, obj, options, 1);
        var selected = db.getSelectedColumns(table, options);
        // Custom filter on other columns
        var other = Object.keys(obj).filter(function(x) { return x[0] != "_" && (keys.indexOf(x) == -1 || !dbkeys[x]) && typeof obj[x] != "undefined" });
        client.select(options.start || key, key, { begins_with: 1, count: options.count }, function(err, items) {
            if (err) return callback(err, []);
            var rows = [];
            items.forEach(function(row) {
                row = lib.jsonParse(row.value);
                if (!row) return;
                if (selected) row = selected.map(function(x) { return [x, row[x] ]}).reduce(function(x,y) { x[y[0]] = y[1]; return x }, {});
                rows.push(row);
            });
            if (other.length > 0) {
                rows = db.filterRows(obj, rows, { keys: other, cols: cols, ops: options.ops, typesMap: options.typesMap || this.configOptions.typesMap });
            }
            if (rows.length && options.sort) rows.sort(function(a,b) { return (a[options.sort] - b[options.sort]) * (options.desc ? -1 : 1) });
            callback(null, rows);
        });
        break;

    case "list":
        var rc = [];
        var selected = db.getSelectedColumns(table, options);
        lib.forEachSeries(obj, function(o, next) {
            var key = self.getKey(table, o, options);
            client.get(key, options, function(err, row) {
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
        var key = this.getKey(table, obj, options);
        client.get(key, options, function(err, item) {
            if (err) return callback(err, []);
            if (item) return callback(lib.newError("already exists"), []);
            client.put(key, JSON.stringify(obj), options, function(err) {
                callback(err, []);
            });
        });
        break;

    case "update":
        var key = this.getKey(table, obj, options);
        client.get(key, options, function(err, item) {
            if (err) return callback(err, []);
            if (!item) return callback(null, []);
            item = lib.jsonParse(item);
            if (!item) item = obj; else for (var p in obj) item[p] = obj[p];
            client.put(key, JSON.stringify(item), options, function(err) {
                callback(err, []);
            });
        });
        break;

    case "put":
        var key = this.getKey(table, obj, options);
        client.put(key, JSON.stringify(obj), options, function(err) {
            callback(err, []);
        });
        break;

    case "incr":
        var key = this.getKey(table, obj, options);
        var nums = lib.searchObj(options.updateOps, { hasvalue: "incr", names: 1 });
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
        var key = this.getKey(table, obj, options);
        client.del(key, options, function(err) {
            callback(err, []);
        });
        break;

    default:
        callback(lib.newError("invalid op"), []);
    }
};


