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
var mongodb = require('mongodb');


// MongoDB pool
db.mongodbInitPool = function(options)
{
    var self = this;
    if (!options) options = {};
    if (!options.pool) options.pool = "mongodb";

    options.type = "mongodb";
    options.settings = { jsonColumns: true, skipNull: { add: 1, put: 1 } };
    if (!lib.isPositive(options.max)) options.max = 25;
    var pool = this.createPool(options);

    pool.open = function(callback) {
        if (this.url == "default") this.url = "mongodb://127.0.0.1";
        mongodb.MongoClient.connect(this.url, this.connect, function(err, db) {
            if (err) logger.error('mongodbOpen:', err);
            if (callback) callback(err, db);
        });
    }
    pool.close = function(client, callback) {
        client.close(callback);
    }
    pool.cacheColumns = function(opts, callback) {
        var pool = this;
        pool.get(function(err, client) {
            if (err) return callback(err);
            pool.dbcolumns = {};
            pool.dbindexes = {};
            pool.dbkeys = {};
            client.collectionNames(function(err, items) {
                (items || []).forEach(function(x) {
                    x = x.name.split(".");
                    if (x.length != 2) return;
                    if (!pool.dbcolumns[x[1]]) pool.dbcolumns[x[1]] = {};
                    pool.dbcolumns[x[1]]['_id'] = { primary: 1 };
                });
                client.indexInformation(null, {full:true}, function(err, items) {
                    (items || []).forEach(function(x) {
                        var n = x.ns.split(".").pop();
                        if (x.key._id) return;
                        if (x.unique) {
                            if (!pool.dbkeys[n]) pool.dbkeys[n] = [];
                            pool.dbkeys[n] = Object.keys(x.key);
                        } else {
                            if (!pool.dbindexes[n]) pool.dbindexes[n] = [];
                            pool.dbindexes[n] = Object.keys(x.key);
                        }
                    });
                    pool.release(client);
                    callback(err);
                });
            });
        });
    }
    pool.query = function(client, req, opts, callback) {
        var pool = this;
        var table = req.text;
        var obj = req.obj;
        var dbcols = pool.dbcolumns[table] || {};
        var dbkeys = pool.dbkeys[table] || [];
        // Default write concern
        if (!opts.w) opts.w = 1;
        opts.safe = true;

        switch(req.op) {
        case "create":
        case "upgrade":
            var keys = [];
            var cols = lib.searchObj(obj, { name: 'primary', sort: 1, flag: 1 });
            var kopts = lib.mergeObj(opts, { unique: true, background: true });
            // Merge with mongo properties from the column, primary key properties also applied for the collection as well
            Object.keys(cols).forEach(function(x) { for (var p in obj[x].mongodb) opts[p] = obj[x].mongodb[p]; });
            keys.push({ cols: cols, opts: kopts });

            ["", "1", "2", "3", "4", "5"].forEach(function(n) {
                var cols = lib.searchObj(obj, { name: "unique" + n, sort: 1, flag: 1 });
                var uopts = lib.mergeObj(opts, { name: Object.keys(cols).join('_'), unique: true, background: true });
                Object.keys(cols).forEach(function(x) { for (var p in obj[x].mongodb) uopts[p] = obj[x].mongodb[p]; });

                if (Object.keys(cols).length) keys.push({ cols: cols, opts: uopts });
                cols = lib.searchObj(obj, { name: "index" + n, sort: 1, flag: 1 });
                var iopts = lib.mergeObj(opts, { name: Object.keys(cols).join('_'), background: true });
                Object.keys(cols).forEach(function(x) { for (var p in obj[x].mongodb) iopts[p] = obj[x].mongodb[p]; });
                if (Object.keys(cols).length) keys.push({ cols: cols, opts: iopts });
            });

            client.createCollection(table, opts, function(err, item) {
                if (err) return callback(err, []);

                lib.forEachSeries(keys, function(idx, next) {
                    client.ensureIndex(table, idx.cols, idx.opts, function(err, iname) {
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
            var fields = self.getSelectedColumns(table, opts);
            opts.fields = (fields || Object.keys(dbcols)).reduce(function(x,y) { x[y] = 1; return x }, {});
            var keys = self.getSearchQuery(table, obj, opts);
            collection.findOne(keys, opts, function(err, item) {
                callback(err, item ? [item] : []);
            });
            break;

        case "select":
        case "search":
            var old = pool.saveOptions(opts, 'sort', 'skip', 'limit');
            var collection = client.collection(table);
            var fields = self.getSelectedColumns(table, opts);
            opts.fields = (fields || Object.keys(dbcols)).reduce(function(x,y) { x[y] = 1; return x }, {});
            if (opts.start) opts.skip = opts.start;
            if (opts.count) opts.limit = opts.count;
            if (typeof opts.sort == "string") opts.sort = [[opts.sort,opts.desc ? -1 : 1]];
            var o = {};
            for (var p in obj) {
                if (p[0] == '_') continue;
                switch (opts.ops[p]) {
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
            logger.debug('select:', pool.name, o, keys);
            collection.find(o, opts).toArray(function(err, rows) {
                pool.restoreOptions(opts, old);
                callback(err, rows);
            });
            break;

        case "list":
            var collection = client.collection(table);
            var fields = self.getSelectedColumns(table, opts);
            opts.fields = (fields || Object.keys(dbcols)).reduce(function(x,y) { x[y] = 1; return x }, {});
            var name = Object.keys(obj[0])[0];
            var o = {};
            o[name] = {};
            o[name]['$in'] = obj.map(function(x) { return x[name] } );
            collection.find(o, opts).toArray(function(err, rows) {
                callback(err, rows);
            });
            break;

        case "add":
            var collection = client.collection(table);
            collection.insert(obj, opts, function(err, rc) {
                callback(err, []);
            });
            break;

        case "put":
            opts.upsert = true;

        case "incr":
        case "update":
            var collection = client.collection(table);
            var keys = self.getSearchQuery(table, obj, opts);
            var o = obj, i = {}, q = {};
            (opts.counter || []).forEach(function(x) {
                if (keys[x]) return;
                i[x] = lib.toNumber(obj[x]);
                delete o[x];
            });
            if (opts.expected) {
                for (var p in opts.expected) if (!keys[p]) keys[p] = opts.expected[p];
            }
            if (Object.keys(o).length) q["$set"] = o;
            if (Object.keys(i).length) q["$inc"] = i;
            collection.update(keys, q, opts, function(err, rc, info) {
                if (!err) client.affected_rows = rc;
                callback(err, []);
            });
            break;

        case "del":
            var collection = client.collection(table);
            var keys = self.getSearchQuery(table, obj, opts);
            collection.remove(keys, opts, function(err, rc, info) {
                if (!err) client.affected_rows = rc;
                callback(err, []);
            });
            break;

        default:
            callback(lib.newError("invalid op"), []);
        }
    };
    pool.nextToken = function(client, req, rows, opts) {
        return opts.count && rows.length == opts.count ? lib.toNumber(opts.start) + lib.toNumber(opts.count) : null;
    }
    return pool;
}

