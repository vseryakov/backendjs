//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var util = require('util');
var url = require('url');
var net = require('net');
var fs = require('fs');
var path = require('path');
var core = require(__dirname + '/../core');
var lib = require(__dirname + '/../lib');
var aws = require(__dirname + '/../aws');
var db = require(__dirname + '/../db');
var logger = require(__dirname + '/../logger');

var pool = {
    name: "dynamodb",
    settings: {
        noJson: 1,
        strictTypes: 1,
        noConcat: 1,
        skipNull: { add: 1, put: 1 },
        retryCount: 7,
        retryTimeout: 25,
        httpTimeout: 250
    },
    createPool: function(options) { return new Pool(options); }
}
module.exports = pool;

db.modules.push(pool);

function Pool(options)
{
    options.type = pool.name;
    options.settings = lib.mergeObj(pool.settings, options.settings);
    db.Pool.call(this, options);
}
util.inherits(Pool, db.Pool);

Pool.prototype.describeTable = function(table, rc)
{
    var self = this;
    if (!rc || !rc.Table) return;
    (rc.Table.AttributeDefinitions || []).forEach(function(x) {
        if (!self.dbcolumns[table]) self.dbcolumns[table] = {};
        var db_type = x.AttributeType == "N" ? "number" : x.AttributeType.length == 2 ? "array" : "text";
        self.dbcolumns[table][x.AttributeName] = { db_type: db_type, data_type: x.AttributeType };
    });
    (rc.Table.KeySchema || []).forEach(function(x) {
        if (!self.dbkeys[table]) self.dbkeys[table] = [];
        self.dbkeys[table].push(x.AttributeName);
        self.dbcolumns[table][x.AttributeName].primary = 1;
        self.dbcolumns[table][x.AttributeName].readCapacity =  rc.Table.ProvisionedThroughput.ReadCapacityUnits || 0;
        self.dbcolumns[table][x.AttributeName].writeCapacity = rc.Table.ProvisionedThroughput.WriteCapacityUnits || 0;
    });
    (rc.Table.LocalSecondaryIndexes || []).forEach(function(x) {
        if (Array.isArray(x.Projection.NonKeyAttributes)) {
            lib.objSet(self.dbprojections, [table, x.IndexName], x.Projection.NonKeyAttributes);
        }
        x.KeySchema.forEach(function(y) {
            lib.objSet(self.dbindexes, [table, x.IndexName], y.AttributeName, { push: 1 });
            self.dbcolumns[table][y.AttributeName].index = 1;
        });
    });
    (rc.Table.GlobalSecondaryIndexes || []).forEach(function(x) {
        if (Array.isArray(x.Projection.NonKeyAttributes)) {
            lib.objSet(self.dbprojections, [table, x.IndexName], x.Projection.NonKeyAttributes);
        }
        x.KeySchema.forEach(function(y) {
            lib.objSet(self.dbindexes, [table, x.IndexName], y.AttributeName, { push: 1 });
            self.dbcolumns[table][y.AttributeName].index = 1;
            self.dbcolumns[table][y.AttributeName].global = 1;
        });
    });
}

Pool.prototype.cacheColumns = function(options, callback)
{
    var self = this;
    options.endpoint = this.url;

    aws.ddbListTables(options, function(err, rc) {
        if (err) return callback(err);
        self.dbkeys = {};
        self.dbcolumns = {};
        self.dbindexes = {};
        self.dbprojections = {};

        lib.forEachLimit(rc.TableNames, 2, function(table, next) {
            aws.ddbDescribeTable(table, options, function(err, rc) {
                if (err || rc.Table.TableStatus == "DELETING") return next();
                self.describeTable(table, rc);
                next();
            });
        }, callback);
    });
}

// Convert into human readable messages
Pool.prototype.convertError = function(table, op, err, options)
{
    switch (op) {
    case "add":
    case "put":
        if (err.code == "ConditionalCheckFailedException") return lib.newError({ message: "Record already exists", code: "AlreadyExists", status: 409 });
        break;
    case "incr":
    case "update":
    case "del":
        if (err.code == "ConditionalCheckFailedException") return lib.newError({ message: "Record not found", code: "NotFound", status: 404 });
        break;
    }
    return err;
}

// Simulate query as in SQL driver but performing AWS call, text will be a table name and values will be request options
Pool.prototype.query = function(client, req, options, callback)
{
    options.endpoint = this.url;

    switch(req.op) {
    case "create":
        this.queryCreate(client, req, options, callback);
        break;

    case "upgrade":
        this.queryUpgrade(client, req, options, callback);
        break;

    case "drop":
        this.queryDrop(client, req, options, callback);
        break;

    case "get":
        this.queryGet(client, req, options, callback);
        break;

    case "select":
    case "search":
        this.queryPrepareSelect(client, req, options, callback);
        break;

    case "list":
        this.queryList(client, req, options, callback);
        break;

    case "add":
        this.queryAdd(client, req, options, callback);
        break;

    case "put":
        this.queryPut(client, req, options, callback);
        break;

    case "incr":
    case "update":
        this.queryUpdate(client, req, options, callback);
        break;

    case "del":
        this.queryDel(client, req, options, callback);
        break;

    default:
        logger.debug("query:", this.name, req);
        callback(lib.newError("invalid op: " + req.op), []);
    }
}

Pool.prototype.queryCreate = function(client, req, options, callback)
{
    var self = this;
    var local = {}, global = {}, attrs = {}, projection = {};
    var keys = Object.keys(req.obj).filter(function(x, i) { return req.obj[x].primary }).
                      sort(function(a,b) { return req.obj[a].primary - req.obj[b].primary }).
                      filter(function(x, i) { return i < 2 }).
                      map(function(x) { attrs[x] = 1; return x });
    var hash = keys[0];
    ["","1","2","3","4","5"].forEach(function(n) {
        var idx = Object.keys(req.obj).filter(function(x) { return req.obj[x]["index" + n]; }).
                         sort(function(a,b) { return req.obj[a]["index" + n] - req.obj[b]["index" + n] }).
                         filter(function(x, i) { return i < 2 });
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
        var p = Object.keys(req.obj).filter(function(x, i) { return req.obj[x].projections || req.obj[x]["projection" + n]; });
        if (p.length) projection[name] = p;
    });

    // All native properties for options from the key columns
    Object.keys(attrs).forEach(function(x) {
        attrs[x] = lib.isNumericType(req.obj[x].type) ? "N" : "S";
        for (var p in req.obj[x].dynamodb) options[p] = req.obj[x].dynamodb[p];
    });

    var old = this.saveOptions(options, 'keys','local','global','projection');
    options.keys = keys;
    options.local = local;
    options.global = global;
    options.projection = projection;
    // Wait long enough for the table to be active
    if (typeof options.waitTimeout == "undefined") options.waitTimeout = 60000;
    aws.ddbCreateTable(req.table, attrs, options, function(err, item) {
        if (!err) client.affected_rows = 1;
        self.restoreOptions(options, old);
        // Create table columns for cases when describeTable never called or errored, for example Rate limit
        // happened during the cacheColumns stage
        if (item && item.TableDescription && !self.dbindexes[req.table]) {
            self.describeTable(req.table, { Table: item.TableDescription });
        }
        callback(err, [], item);
    });
}

Pool.prototype.queryUpgrade = function(client, req, options, callback)
{
    var self = this;
    var global = {};
    ["","1","2","3","4","5"].forEach(function(n) {
        var idx = Object.keys(req.obj).filter(function(x, i) { return req.obj[x]["index" + n]; }).
                         sort(function(a,b) { return req.obj[a]["index" + n] - req.obj[b]["index" + n] }).
                         filter(function(x, i) { return i < 2 });
        if (!idx.length) return;
        var name = idx.join("_");
        if (self.dbindexes[req.table] && self.dbindexes[req.table][name]) return;
        var add = { projection: [] };
        idx.forEach(function(x) {
            if (req.obj[x].readCapacity) add.readCapacity = req.obj[x].readCapacity;
            if (req.obj[x].writeCapacity) add.writeCapacity = req.obj[x].writeCapacity;
            add.projection = Object.keys(req.obj).filter(function(x, i) { return req.obj[x].projections || req.obj[x]["projection" + n]; });
            add[x] = lib.isNumericType(req.obj[x].type) ? "N" : "S";
        });
        global[name] = add;
    });
    if (!Object.keys(global).length) return callback(null, []);
    var old = this.saveOptions(options, 'name','add');
    options.name = req.table;
    options.add = global;
    aws.ddbUpdateTable(options, function(err, item) {
        if (!err) client.affected_rows = 1;
        self.restoreOptions(options, old);
        callback(err, [], item);
    });
}

Pool.prototype.queryDrop = function(client, req, options, callback)
{
    if (typeof options.waitTimeout == "undefined") options.waitTimeout = 60000;
    aws.ddbDeleteTable(req.table, options, function(err) {
        callback(err, []);
    });
}

Pool.prototype.queryGet = function(client, req, options, callback)
{
    var keys = db.getSearchQuery(req.table, req.obj);
    if (!Object.keys(keys).length) return callback();
    options.select = db.getSelectedColumns(req.table, options);
    aws.ddbGetItem(req.table, keys, options, function(err, rc) {
        if (!err && rc.ConsumedCapacity) rc.consumed_capacity = rc.ConsumedCapacity.CapacityUnits;
        callback(err, rc.Item ? [rc.Item] : [], rc);
    });
}

Pool.prototype.queryPrepareSelect = function(client, req, options, callback)
{
    var self = this;
    var dbattrs, dbkeys = this.dbkeys[req.table] || [];
    // Save the original values of the options
    var old = this.saveOptions(options, 'sort', 'keys', 'select', 'start', 'count');
    // Sorting by the default range key is default
    if (options.sort && options.sort == dbkeys[1]) options.sort = null;
    // Use primary keys from the secondary index
    if (options.sort) {
        // Use index by name, mostly global indexes
        if (this.dbindexes[req.table] && this.dbindexes[req.table][options.sort]) {
            dbkeys = this.dbindexes[req.table][options.sort];
            dbattrs = this.dbprojections[req.table] && this.dbprojections[req.table][options.sort];
        } else {
            // Local sorting order by range key
            for (var p in this.dbindexes[req.table]) {
                var idx = this.dbindexes[req.table][p];
                if (idx && idx.length == 2 && (idx[0] == options.sort || idx[1] == options.sort)) {
                    options.sort = p;
                    dbkeys = this.dbindexes[req.table][p];
                    dbattrs = this.dbprojections[req.table] && this.dbprojections[req.table][p];
                    break;
                }
            }
        }
    } else
    // Find a global index if any hash key for it provided
    if (!req.obj[dbkeys[0]]) {
        for (var p in this.dbindexes[req.table]) {
            var idx = this.dbindexes[req.table][p];
            if (idx && idx.length == 2 && req.obj[idx[0]]) {
                options.sort = p;
                dbkeys = this.dbindexes[req.table][p];
                dbattrs = this.dbprojections[req.table] && this.dbprojections[req.table][p];
                break;
            }
        }
    }

    // Query based on the keys, remove attributes that are not in the projection
    options.keys = !dbattrs ? Object.keys(req.obj) : Object.keys(req.obj).filter(function(x) { return dbkeys.indexOf(x) > -1 || dbattrs.indexOf(x) > -1 });
    var query = db.getSearchQuery(req.table, req.obj, options);

    // Operation depends on the primary keys in the query, for Scan we can let the DB to do all the filtering
    var op = typeof query[dbkeys[0]] != "undefined" && !options.fullscan ? 'ddbQueryTable' : 'ddbScanTable';
    logger.debug('select:', 'dynamodb', req.table, op, query, dbkeys, dbattrs, options.sort, options.count, options.noscan, op == 'ddbScanTable' && options.noscan ? "NO EMPTY SCANS ENABLED" : "");

    // Scans explicitely disabled
    if (op == 'ddbScanTable' && options.noscan) return callback(null, []);

    options.keys = dbkeys;
    this.queryRunSelect(op, client, req, query, options, function(err, rows, info) {
        self.restoreOptions(options, old);
        callback(err, rows, info);
    })
}

Pool.prototype.queryRunSelect = function(op, client, req, query, options, callback)
{
    // Capacity rate limiter
    if (options.useCapacity || options.capacity) {
        var cap = options.capacity || db.getCapacity(req.table, { useCapacity: options.useCapacity, factorCapacity: options.factorCapacity });
        options.ReturnConsumedCapacity = "TOTAL";
    }
    for (var p in options.ops) {
        // IN is not supported for key condition, move it in the query
        if (options.ops[p] == "in" && p == options.keys[1]) options.keys = [ options.keys[0] ];
        if (options.ops[p] == "in" && p == options.keys[0]) op = 'ddbScanTable';
        // Noop for a hash key
        if (options.ops[p] && p == options.keys[0] && op == "ddbQueryTable") options.ops[p] = '';
    }
    options.select = db.getSelectedColumns(req.table, options);
    var rows = [], info = { consumed_capacity: 0, total: 0 };
    // Keep retrieving items until we reach the end or our limit
    lib.doWhilst(
       function(next) {
           aws[op](req.table, query, options, function(err, item) {
               if (options.total) {
                   if (!rows.length) rows.push({ count: 0 });
                   rows[0].count += item.Count;
               } else {
                   rows.push.apply(rows, item.Items);
               }
               client.next_token = item.LastEvaluatedKey ? aws.fromDynamoDB(item.LastEvaluatedKey) : null;
               options.count -= item.Items.length;
               if (!err && item.ConsumedCapacity) {
                   info.consumed_capacity += item.ConsumedCapacity.CapacityUnits;
                   if (options.useCapacity) return db.checkCapacity(cap, item.ConsumedCapacity.CapacityUnits, next);
               }
               next(err);
           });
       },
       function() {
           if (client.next_token == null || options.count <= 0) return false;
           options.start = client.next_token;
           return true;
       }, function(err) {
           callback(err, rows, info);
       });
}

Pool.prototype.queryList = function(client, req, options, callback)
{
    var info = { consumed_capacity: 0 }, rows = [], breq = {};
    // Capacity rate limiter
    if (options.useCapacity > 0 || options.capacity) {
        var cap = options.capacity || db.getCapacity(req.table, { useCapacity: options.useCapacity, factorCapacity: options.factorCapacity });
        options.ReturnConsumedCapacity = "TOTAL";
    }
    // Keep retrieving items until we reach the end or our limit
    lib.doWhilst(
       function(next) {
           var list = req.obj.slice(0, 100);
           req.obj = req.obj.slice(100);
           if (!list.length) return next();
           breq[req.table] = { keys: list, select: db.getSelectedColumns(req.table, options), consistent: options.consistent };
           aws.ddbBatchGetItem(breq, options, function(err, item) {
               if (err) return callback(err, []);
               // Keep retrieving items until we get all items from this batch
               var moreKeys = item.UnprocessedKeys || null;
               rows.push.apply(rows, item.Responses[req.table] || []);
               lib.whilst(
                   function() {
                       return moreKeys && Object.keys(moreKeys).length;
                   },
                   function(next2) {
                       options.RequestItems = moreKeys;
                       aws.ddbBatchGetItem({}, options, function(err, item) {
                           moreKeys = item.UnprocessedKeys || null;
                           rows.push.apply(rows, item.Responses[req.table] || []);
                           if (!err && item.ConsumedCapacity) {
                               info.consumed_capacity += item.ConsumedCapacity.CapacityUnits;
                               if (options.useCapacity) return db.checkCapacity(cap, item.ConsumedCapacity.CapacityUnits, next2);
                           }
                           next2(err);
                       });
               }, function(err) {
                   next(err);
               });
           });
       },
       function() {
           return req.obj.length > 0;
       },
       function(err) {
           callback(err, rows, info);
       });
}

Pool.prototype.queryAdd = function(client, req, options, callback)
{
    var self = this;
    var dbkeys = this.dbkeys[req.table] || [];
    var old = this.saveOptions(options, 'expected');
    options.expected = (this.dbkeys[req.table] || []).map(function(x) { return x }).reduce(function(x,y) { x[y] = null; return x }, {});
    if (options.useCapacity || options.capacity) options.ReturnConsumedCapacity = "TOTAL";
    aws.ddbPutItem(req.table, req.obj, options, function(err, rc) {
        self.restoreOptions(options, old);
        if (!rc) rc = {};
        if (!err) rc.affected_rows = 1;
        if (!err && rc.ConsumedCapacity) rc.consumed_capacity = rc.ConsumedCapacity.CapacityUnits;
        callback(err, rc.Item ? [rc.Item] : [], rc);
    });
}

Pool.prototype.queryPut = function(client, req, options, callback)
{
    if (options.useCapacity || options.capacity) options.ReturnConsumedCapacity = "TOTAL";
    aws.ddbPutItem(req.table, req.obj, options, function(err, rc) {
        if (!rc) rc = {};
        if (!err) rc.affected_rows = 1;
        if (!err && rc.ConsumedCapacity) rc.consumed_capacity = rc.ConsumedCapacity.CapacityUnits;
        callback(err, rc.Item ? [rc.Item] : [], rc);
    });
}

Pool.prototype.queryUpdate = function(client, req, options, callback)
{
    var self = this;
    var old = this.saveOptions(options, 'expected');
    var keys = db.getSearchQuery(req.table, req.obj);
    if (req.op == "update") {
        if (options.expected) {
            for (var p in keys) if (!options.expected[p]) options.expected[p] = keys[p];
        } else
            if (!options.Expected && !options.expr && !options.ConditionExpression) options.expected = keys;
    }
    if (options.updateOps) {
        if (!lib.isObject(options.action)) options.action = {};
        for (var p in options.updateOps) {
            if (options.updateOps[p] == "incr") options.action[p] = 'ADD'; else
            if (options.updateOps[p] == "append") options.action[p] = 'APPEND'; else
            if (options.updateOps[p] == "prepend") options.action[p] = 'PREPEND'; else
            if (options.updateOps[p] == "not_exists") options.action[p] = 'NOT_EXISTS';
        }
    }
    if (options.useCapacity || options.capacity) options.ReturnConsumedCapacity = "TOTAL";
    aws.ddbUpdateItem(req.table, keys, req.obj, options, function(err, rc) {
        if (!rc) rc = {};
        if (!err) rc.affected_rows = 1;
        if (!err && rc.ConsumedCapacity) rc.consumed_capacity = rc.ConsumedCapacity.CapacityUnits;
        if (err && err.code == "ConditionalCheckFailedException") err = null;
        self.restoreOptions(options, old);
        callback(err, rc.Item ? [rc.Item] : [], rc);
    });
}

Pool.prototype.queryDel = function(client, req, options, callback)
{
    var keys = db.getSearchQuery(req.table, req.obj);
    if (options.useCapacity || options.capacity) options.ReturnConsumedCapacity = "TOTAL";
    options.expected = keys;
    aws.ddbDeleteItem(req.table, keys, options, function(err, rc) {
        if (!rc) rc = {};
        if (!err) rc.affected_rows = 1;
        if (!err && rc.ConsumedCapacity) rc.consumed_capacity = rc.ConsumedCapacity.CapacityUnits;
        if (err && err.code == "ConditionalCheckFailedException") err = null;
        callback(err, rc.Item ? [rc.Item] : [], rc);
    });
}
