//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var util = require('util');
var core = require(__dirname + '/../core');
var lib = require(__dirname + '/../lib');
var db = require(__dirname + '/../db');
var logger = require(__dirname + '/../logger');
var mongodb = require('mongodb');

var pool = {
    name: "mongodb",
    settings: {
        jsonColumns: true,
        skipNull: { add: 1, put: 1 },
        w: 1,
        safe: true
    },
    createPool: function(options) { return new Pool(options); }
};
module.exports = pool;

db.modules.push(pool);

function Pool(options)
{
    if (!lib.isPositive(options.max)) options.max = 25;
    options.settings = lib.mergeObj(pool.settings, options.settings);
    options.type = pool.name;
    db.Pool.call(this, options);
}
util.inherits(Pool, db.Pool)

Pool.prototype.open = function(callback)
{
    if (this.url == "default") this.url = "mongodb://127.0.0.1";
    mongodb.MongoClient.connect(this.url, this.connect, function(err, db) {
        if (err) logger.error('mongodbOpen:', err);
        if (callback) callback(err, db);
    });
}

Pool.prototype.close = function(client, callback)
{
    client.close(callback);
}

Pool.prototype.cacheColumns = function(options, callback)
{
    var self = this;
    this.acquire(function(err, client) {
        if (err) return callback(err);
        self.dbcolumns = {};
        client.listCollections({}).toArray(function(err, items) {
            for (var i = 0; i < items.length; i++) {
                var x = items[i].name.split(".");
                if (x.length != 2) continue;
                if (!self.dbcolumns[x[1]]) self.dbcolumns[x[1]] = {};
                self.dbcolumns[x[1]]['_id'] = { primary: 1 };
            }
            self.release(client);
            callback(err);
        });
    });
}

Pool.prototype.query = function(client, req, options, callback)
{
    var self = this;
    var table = req.table;
    var obj = req.obj;
    var dbcols = this.dbcolumns[table] || {};

    switch(req.op) {
    case "create":
    case "upgrade":
        var keys = [];
        var cols = lib.searchObj(obj, { name: 'primary', sort: 1, flag: 1 });
        var koptions = lib.mergeObj(options, { unique: true, background: true });
        // Merge with mongo properties from the column, primary key properties also applied for the collection as well
        Object.keys(cols).forEach(function(x) { for (var p in obj[x].mongodb) options[p] = obj[x].mongodb[p]; });
        keys.push({ cols: cols, options: koptions });

        ["", "1", "2", "3", "4", "5"].forEach(function(n) {
            var cols = lib.searchObj(obj, { name: "unique" + n, sort: 1, flag: 1 });
            var uoptions = lib.mergeObj(options, { name: Object.keys(cols).join('_'), unique: true, background: true });
            Object.keys(cols).forEach(function(x) { for (var p in obj[x].mongodb) uoptions[p] = obj[x].mongodb[p]; });

            if (Object.keys(cols).length) keys.push({ cols: cols, options: uoptions });
            cols = lib.searchObj(obj, { name: "index" + n, sort: 1, flag: 1 });
            var ioptions = lib.mergeObj(options, { name: Object.keys(cols).join('_'), background: true });
            Object.keys(cols).forEach(function(x) { for (var p in obj[x].mongodb) ioptions[p] = obj[x].mongodb[p]; });
            if (Object.keys(cols).length) keys.push({ cols: cols, options: ioptions });
        });

        client.createCollection(table, options, function(err, item) {
            if (err) return callback(err, []);

            lib.forEachSeries(keys, function(idx, next) {
                client.ensureIndex(table, idx.cols, idx.options, function(err, iname) {
                    if (err) logger.error('db.create:', idx, err);
                    if (iname) client.affected_rows = 1;
                    next();
                });
            }, function(err) {
                callback(err, []);
            });
        });
        break;

    case "drop":
        client.dropCollection(table, function(err) {
            callback(err, []);
        });
        break;

    case "get":
        var collection = client.collection(table);
        var fields = db.getSelectedColumns(table, options);
        options.fields = (fields || Object.keys(dbcols)).reduce(function(x,y) { x[y] = 1; return x }, {});
        var keys = db.getSearchQuery(table, obj, options);
        collection.findOne(keys, options, function(err, item) {
            callback(err, item ? [item] : []);
        });
        break;

    case "select":
    case "search":
        var old = this.saveOptions(options, 'sort', 'skip', 'limit');
        var collection = client.collection(table);
        var fields = db.getSelectedColumns(table, options);
        options.fields = (fields || Object.keys(dbcols)).reduce(function(x,y) { x[y] = 1; return x }, {});
        if (options.start) options.skip = options.start;
        if (options.count) options.limit = options.count;
        if (typeof options.sort == "string") options.sort = [[options.sort,options.desc ? -1 : 1]];
        var o = this.queryCondition(obj, options);
        logger.debug('select:', this.name, o, keys, options);
        collection.find(o, options).toArray(function(err, rows) {
            self.restoreOptions(options, old);
            callback(err, rows);
        });
        break;

    case "list":
        var collection = client.collection(table);
        var fields = db.getSelectedColumns(table, options);
        options.fields = (fields || Object.keys(dbcols)).reduce(function(x,y) { x[y] = 1; return x }, {});
        var name = Object.keys(obj[0])[0];
        var o = {};
        o[name] = {};
        o[name]['$in'] = obj.map(function(x) { return x[name] } );
        collection.find(o, options).toArray(function(err, rows) {
            callback(err, rows);
        });
        break;

    case "add":
        var collection = client.collection(table);
        collection.insert(obj, options, function(err, rc, info) {
            if (!info) info = {};
            if (!err) info.affected_rows = rc.result.n;
            callback(err, [], info);
        });
        break;

    case "put":
        options.upsert = true;

    case "incr":
    case "update":
        var collection = client.collection(table);
        var keys = db.getSearchQuery(table, obj, options);
        var o = obj, i = {}, q = {};
        if (options.updateOps) {
            for (var p in options.updateOps) {
                if (options.updateOps[p] == "incr") {
                    if (keys[p]) continue;
                    i[p] = lib.toNumber(obj[p]);
                    delete o[p];
                }
            }
        }
        if (options.expected) {
            var e = this.queryCondition(options.expected, options);
            for (var p in e) if (!keys[p]) keys[p] = e[p];
        }
        if (Object.keys(o).length) q["$set"] = o;
        if (Object.keys(i).length) q["$inc"] = i;
        collection.update(keys, q, options, function(err, rc, info) {
            if (!info) info = {};
            if (!err) info.affected_rows = rc.result.n;
            callback(err, [], info);
        });
        break;

    case "del":
        var collection = client.collection(table);
        var keys = db.getSearchQuery(table, obj, options);
        collection.remove(keys, options, function(err, rc, info) {
            if (!info) info = {};
            if (!err) info.affected_rows = rc.result.n;
            callback(err, [], info);
        });
        break;

    default:
        callback(lib.newError("invalid op"), []);
    }
}

Pool.prototype.queryCondition = function(obj, options)
{
    var o = {};
    for (var p in obj) {
        if (p[0] == '_') continue;
        switch (options.ops && options.ops[p]) {
        case "regexp":
            o[p] = { '$regex': obj[p] };
            break;

        case "between":
            var val = lib.strSplit(obj[p]);
            if (val.length == 2) {
                o[p] = { '$gte': val[0], '$lte': val[1] };
            } else {
                o[p] = obj[p];
            }
            break;

        case "like%":
        case "begins_with":
            o[p] = { '$regex': "^" + obj[p] };
            break;

        case "in":
            o[p] = { '$in': lib.strSplit(obj[p]) };
            break;

        case ">":
        case "gt":
            o[p] = { '$gt': obj[p] };
            break;

        case "<":
        case "lt":
            o[p] = { '$lt': obj[p] };
            break;

        case ">=":
        case "ge":
            o[p] = { '$gte': obj[p] };
            break;

        case "<=":
        case "le":
            o[p] = { '$lte': obj[p] };
            break;

        case "ne":
        case "!=":
        case "<>":
            o[p] = { '$ne': obj[p] };
            break;

        case "eq":
            o[p] = obj[p];
            break;

        default:
            if (typeof obj[p] == "string" && !obj[p]) break;
            o[p] = obj[p];
        }
    }
    return o;
}

Pool.prototype.nextToken = function(client, req, rows, options)
{
    return options.count && rows.length == options.count ? lib.toNumber(options.start) + lib.toNumber(options.count) : null;
}
