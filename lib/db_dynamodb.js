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
var aws = require(__dirname + '/../aws');
var db = require(__dirname + '/../db');
var logger = require(__dirname + '/../logger');
var utils = require(__dirname + '/../build/Release/backend');

// Setup DynamoDB database driver
db.dynamodbInitPool = function(options)
{
    var self = this;
    if (!options) options = {};
    if (!options.pool) options.pool = "dynamodb";

    options.type = "dynamodb";
    options.max = options.max || 500;
    options.dboptions = { noUpgrade: 1, noJson: 1, strictTypes: 1, skipNull: { add: 1, put: 1 } };
    var pool = this.createPool(options);

    pool.cacheColumns = function(opts, callback) {
        var pool = this;
        var options = { db: pool.db };

        aws.ddbListTables(options, function(err, rc) {
            if (err) return callback ? callback(err) : null;
            pool.dbkeys = {};
            pool.dbcolumns = {};
            pool.dbindexes = {};
            lib.forEachLimit(rc.TableNames, 3, function(table, next) {
                aws.ddbDescribeTable(table, options, function(err, rc) {
                    if (err) return next(err);
                    rc.Table.AttributeDefinitions.forEach(function(x) {
                        if (!pool.dbcolumns[table]) pool.dbcolumns[table] = {};
                        var db_type = x.AttributeType == "N" ? "number" : x.AttributeType.length == 2 ? "array" : "text";
                        pool.dbcolumns[table][x.AttributeName] = { db_type: db_type, data_type: x.AttributeType };
                    });
                    rc.Table.KeySchema.forEach(function(x) {
                        if (!pool.dbkeys[table]) pool.dbkeys[table] = [];
                        pool.dbkeys[table].push(x.AttributeName);
                        pool.dbcolumns[table][x.AttributeName].primary = 1;
                        pool.dbcolumns[table][x.AttributeName].readCapacity =  rc.Table.ProvisionedThroughput.ReadCapacityUnits || 0;
                        pool.dbcolumns[table][x.AttributeName].writeCapacity = rc.Table.ProvisionedThroughput.WriteCapacityUnits || 0;
                    });
                    (rc.Table.LocalSecondaryIndexes || []).forEach(function(x) {
                        x.KeySchema.forEach(function(y) {
                            lib.objSet(pool.dbindexes, [table, x.IndexName], y.AttributeName, { push: 1 });
                            pool.dbcolumns[table][y.AttributeName].index = 1;
                        });
                    });
                    (rc.Table.GlobalSecondaryIndexes || []).forEach(function(x) {
                        x.KeySchema.forEach(function(y) {
                            lib.objSet(pool.dbindexes, [table, x.IndexName], y.AttributeName, { push: 1 });
                            pool.dbcolumns[table][y.AttributeName].index = 1;
                            pool.dbcolumns[table][y.AttributeName].global = 1;
                        });
                    });
                    next();
                });
            }, callback);
        });
    }

    // Convert into human readable messages
    pool.convertError = function(table, op, err, opts) {
        switch (op) {
        case "add":
        case "put":
            if (err.code == "ConditionalCheckFailedException") return lib.newError({ message: "Record already exists", code: "ExpectedCondition", status: 409 });
            break;
        case "incr":
        case "update":
            if (err.code == "ConditionalCheckFailedException") return lib.newError({ message: "Record not found", code: "ExpectedCondition", status: 406 });
            break;
        }
        return err;
    }

    // Simulate query as in SQL driver but performing AWS call, text will be a table name and values will be request options
    pool.query = function(client, req, opts, callback) {
        var pool = this;
        var table = req.text;
        var obj = req.obj;
        var dbcols = pool.dbcolumns[table] || {};
        var dbkeys = pool.dbkeys[table] || [];
        opts.db = pool.db;

        switch(req.op) {
        case "create":
            var local = {}, global = {}, attrs = {}, projection = {};
            var keys = Object.keys(obj).filter(function(x, i) { return obj[x].primary }).
                              sort(function(a,b) { return obj[a].primary - obj[b].primary }).
                              filter(function(x, i) { return i < 2 }).
                              map(function(x, i) { return [ x, i ? 'RANGE' : 'HASH' ] }).
                              reduce(function(x,y) { attrs[y[0]] = 1; x[y[0]] = y[1]; return x }, {});
            var hash = Object.keys(keys)[0];

            ["","1","2","3","4","5"].forEach(function(n) {
                var idx = Object.keys(obj).filter(function(x, i) { return obj[x]["index" + n]; }).sort(function(a,b) { return obj[a]["index" + n] - obj[b]["index" + n] });
                if (!idx.length) return;
                var name = idx.join("_");
                // Index starts with the same hash, local
                if (idx.length == 2 && idx[0] == hash) {
                    local[name] = lib.newObj(idx[0], 'HASH', idx[1], 'RANGE');
                } else
                // Global if does not start with the primary hash
                if (idx.length == 2) {
                    global[name] = lib.newObj(idx[0], 'HASH', idx[1], 'RANGE');
                } else {
                    global[name] = lib.newObj(idx[0], 'HASH');
                }
                idx.forEach(function(y) { attrs[y] = 1 });
                var p = Object.keys(obj).filter(function(x, i) { return obj[x]["projection" + n]; });
                if (p.length) projection[name] = p;
            });

            // All native properties for options from the key columns
            Object.keys(attrs).forEach(function(x) {
                attrs[x] = ["int","bigint","double","real","counter"].indexOf(obj[x].type || "text") > -1 ? "N" : "S";
                for (var p in obj[x].dynamodb) opts[p] = obj[x].dynamodb[p];
            });

            opts.local = local;
            opts.global = global;
            opts.projection = projection;
            // Wait long enough for the table to be active, currently used by DynamoDB only
            if (typeof opts.waitTimeout == "undefined") opts.waitTimeout = 60000;
            aws.ddbCreateTable(table, attrs, keys, opts, function(err, item) {
                callback(err, [], item);
            });
            break;

        case "upgrade":
            callback(null, []);
            break;

        case "drop":
            aws.ddbDeleteTable(table, opts, function(err) {
                callback(err, []);
            });
            break;

        case "get":
            var keys = self.getSearchQuery(table, obj);
            opts.select = self.getSelectedColumns(table, opts);
            aws.ddbGetItem(table, keys, opts, function(err, item) {
                callback(err, item.Item ? [item.Item] : [], item);
            });
            break;

        case "select":
        case "search":
            // Save the original values of the options
            var old = pool.saveOptions(opts, 'sort', 'keys', 'select', 'start', 'count');
            // Sorting by the default range key is default
            if (opts.sort && opts.sort == dbkeys[1]) opts.sort = null;
            // Use primary keys from the secondary index
            if (opts.sort) {
                // Use index by name, mostly global indexes
                if (pool.dbindexes[table] && pool.dbindexes[table][opts.sort]) {
                    dbkeys = pool.dbindexes[table][opts.sort];
                } else {
                    // Local sorting order by range key
                    for (var p in pool.dbindexes[table]) {
                        var idx = pool.dbindexes[table][p];
                        if (idx && idx.length == 2 && idx[1] == opts.sort) {
                            opts.sort = p;
                            dbkeys = pool.dbindexes[table][p];
                            break;
                        }
                    }
                }
            }
            var keys = Object.keys(obj);
            // If we have other key columns we have to use custom filter
            var other = keys.filter(function(x) { return x[0] != "_" && dbkeys.indexOf(x) == -1 && typeof obj[x] != "undefined" });
            // Query based on the keys
            keys = self.getSearchQuery(table, obj, { keys: keys });
            // Operation depends on the primary keys in the query, for Scan we can let the DB to do all the filtering
            var op = typeof keys[dbkeys[0]] != "undefined" && !opts.fullscan ? 'ddbQueryTable' : 'ddbScanTable';
            logger.debug('select:', 'dynamodb', op, keys, dbkeys, opts.sort, opts.count, opts.noscan);

            // Scans explicitely disabled
            if (op == 'ddbScanTable' && opts.noscan) return callback(null, []);

            opts.keys = dbkeys;
            // IN is not supported for key condition, move it in the query
            for (var p in opts.ops) {
                if (opts.ops[p] == "in" && p == dbkeys[1]) opts.keys = [ dbkeys[0] ];
                if (opts.ops[p] == "in" && p == dbkeys[0]) op = 'ddbScanTable';
            }
            opts.select = self.getSelectedColumns(table, opts);
            var rows = [];
            // Keep retrieving items until we reach the end or our limit
            lib.doWhilst(
               function(next) {
                   aws[op](table, keys, opts, function(err, item) {
                       if (opts.total) item.Items.push({ count: item.Count });
                       rows.push.apply(rows, item.Items);
                       client.next_token = item.LastEvaluatedKey ? aws.fromDynamoDB(item.LastEvaluatedKey) : null;
                       opts.count -= item.Items.length;
                       next(err);
                   });
               },
               function() {
                   if (client.next_token == null || opts.count <= 0) return false;
                   opts.start = client.next_token;
                   return true;
               },
               function(err) {
                   pool.restoreOptions(opts, old);
                   callback(err, rows);
               });
            break;

        case "list":
            var req = {};
            var rows = [];
            // Keep retrieving items until we reach the end or our limit
            lib.doWhilst(
               function(next) {
                   var list = obj.slice(0, 100);
                   obj = obj.slice(100);
                   if (!list.length) return next();
                   req[table] = { keys: list, select: self.getSelectedColumns(table, opts), consistent: opts.consistent };
                   aws.ddbBatchGetItem(req, opts, function(err, item) {
                       if (err) return callback(err, []);
                       // Keep retrieving items until we get all items from this batch
                       var moreKeys = item.UnprocessedKeys || null;
                       rows.push.apply(rows, item.Responses[table] || []);
                       lib.whilst(
                           function() {
                               return moreKeys && Object.keys(moreKeys).length;
                           },
                           function(next2) {
                               opts.RequestItems = moreKeys;
                               aws.ddbBatchGetItem({}, opts, function(err, item) {
                                   moreKeys = item.UnprocessedKeys || null;
                                   rows.push.apply(rows, item.Responses[table] || []);
                                   next2(err);
                               });
                       }, function(err) {
                           next(err);
                       });
                   });
               },
               function() {
                   return obj.length > 0;
               },
               function(err) {
                   callback(err, rows);
               });
            break;

        case "add":
            opts.expected = (pool.dbkeys[table] || []).map(function(x) { return x }).reduce(function(x,y) { x[y] = null; return x }, {});
            aws.ddbPutItem(table, obj, opts, function(err, rc) {
                callback(err, rc && rc.Item ? [rc.Item] : [], rc);
            });
            break;

        case "put":
            aws.ddbPutItem(table, obj, opts, function(err, rc) {
                callback(err, rc && rc.Item ? [rc.Item] : [], rc);
            });
            break;

        case "incr":
        case "update":
            var keys = self.getSearchQuery(table, obj);
            if (req.op == "update") {
                if (opts.expected) {
                    for (var p in keys) if (!opts.expected[p]) opts.expected[p] = keys[p];
                } else
                    if (!opts.Expected && !opts.expr && !opts.ConditionExpression) opts.expected = keys;
            }
            if (opts.counter) {
                if (!opts.action) opts.action = {};
                opts.counter.forEach(function(x) { opts.action[x] = 'ADD'; });
            }
            aws.ddbUpdateItem(table, keys, obj, opts, function(err, rc) {
                if (!err) client.affected_rows = 1;
                if (err && err.code == "ConditionalCheckFailedException") err = null;
                callback(err, rc && rc.Item ? [rc.Item] : [], rc);
            });
            break;

        case "del":
            var keys = self.getSearchQuery(table, obj);
            aws.ddbDeleteItem(table, keys, opts, function(err, rc) {
                if (!err) client.affected_rows = 1;
                if (err && err.code == "ConditionalCheckFailedException") err = null;
                callback(err, rc && rc.Item ? [rc.Item] : [], rc);
            });
            break;

        default:
            callback(new Error("invalid op"), []);
        }
    };
    return pool;
}

