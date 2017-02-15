//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var util = require('util');
var url = require('url');
var net = require('net');
var fs = require('fs');
var path = require('path');
var core = require(__dirname + '/core');
var lib = require(__dirname + '/lib');
var aws = require(__dirname + '/aws');
var db = require(__dirname + '/db');
var logger = require(__dirname + '/logger');

var pool = {
    name: "dynamodb",
    configOptions: {
        noJson: 1,
        strictTypes: 1,
        noConcat: 1,
        skipNull: { add: 1, put: 1 },
        noNulls: 1,
        emptyValue: "",
        retryCount: 8,
        retryTimeout: 100,
        httpTimeout: 250,
        concurrency: 3,
        requireCapacity: 1,
        cacheColumns: 1,        // need it for capacity
    },
    createPool: function(options) { return new Pool(options); }
}
module.exports = pool;

db.modules.push(pool);

function Pool(options)
{
    options.type = pool.name;
    db.Pool.call(this, options);
    this.configOptions = lib.objMerge(pool.configOptions, this.configOptions);
    this.dbprojections = {};
}
util.inherits(Pool, db.Pool);

Pool.prototype.describeTable = function(table, rc, schema)
{
    var self = this;
    if (!rc || !rc.Table) return;
    (rc.Table.AttributeDefinitions || []).forEach(function(x) {
        if (!schema.dbcolumns[table]) schema.dbcolumns[table] = {};
        var data_type = x.AttributeType == "N" ? "number" : x.AttributeType.length == 2 ? "array" : "text";
        schema.dbcolumns[table][x.AttributeName] = { data_type: data_type };
    });
    (rc.Table.KeySchema || []).forEach(function(x) {
        schema.dbcolumns[table][x.AttributeName].primary = 1;
        lib.objSet(schema.dbkeys, [table], x.AttributeName, { push: 1, unique: 1 });
        lib.objSet(schema.dbcapacity, [table, table], { read: rc.Table.ProvisionedThroughput.ReadCapacityUnits || 0, write: rc.Table.ProvisionedThroughput.WriteCapacityUnits || 0 });
    });
    (rc.Table.LocalSecondaryIndexes || []).forEach(function(x) {
        if (x.Projection && Array.isArray(x.Projection.NonKeyAttributes)) {
            lib.objSet(schema.dbprojections, [table, x.IndexName], x.Projection.NonKeyAttributes);
        }
        x.KeySchema.forEach(function(y) {
            lib.objSet(schema.dbindexes, [table, x.IndexName], y.AttributeName, { push: 1, unique: 1 });
            schema.dbcolumns[table][y.AttributeName].lsi = 1;
        });
    });
    (rc.Table.GlobalSecondaryIndexes || []).forEach(function(x) {
        if (x.Projection && Array.isArray(x.Projection.NonKeyAttributes)) {
            lib.objSet(schema.dbprojections, [table, x.IndexName], x.Projection.NonKeyAttributes);
        }
        x.KeySchema.forEach(function(y) {
            lib.objSet(schema.dbindexes, [table, x.IndexName], y.AttributeName, { push: 1, unique: 1 });
            schema.dbcolumns[table][y.AttributeName].gsi = 1;
        });
        lib.objSet(schema.dbcapacity, [table, x.IndexName], { read: rc.Table.ProvisionedThroughput.ReadCapacityUnits || 0, write: rc.Table.ProvisionedThroughput.WriteCapacityUnits || 0 });
    });
}

Pool.prototype.cacheColumns = function(options, callback)
{
    var self = this;
    options = lib.objClone(options, "endpoint", this.url);
    var tables = Array.isArray(options.tables) ? options.tables : [];
    var schema = { dbcolumns: {}, dbkeys: {}, dbindexes: {}, dbcapacity: {}, dbprojections: {} };

    lib.series([
      function(next) {
          if (tables && tables.length) return next();
          aws.ddbListTables(options, function(err, rc) {
              if (!err) tables = rc.TableNames;
              next(err);
          });
      },
      function(next) {
          lib.forEachLimit(tables, options.concurrency || self.configOptions.concurrency || core.concurrency, function(table, next) {
              aws.ddbDescribeTable(table, options, function(err, rc) {
                  if (err || rc.Table.TableStatus == "DELETING") return next();
                  self.describeTable(table, rc, schema);
                  next();
              });
          }, next);
      },
      function(next) {
          // Replace all at once
          for (var p in schema) self[p] = schema[p];
          next();
      },
    ], callback);
}

// Convert into recognizable error codes
Pool.prototype.convertError = function(table, op, err, options)
{
    switch (op) {
    case "get":
        if (err.message == "The provided key element does not match the schema") err.code = "NotFound";
        break;
    case "add":
    case "put":
        if (err.code == "ConditionalCheckFailedException") err.code = "AlreadyExists";
        break;
    case "incr":
    case "update":
    case "del":
        if (err.code == "ConditionalCheckFailedException") err.code = "NotFound";
        break;
    }
    return err;
}

// Simulate query as in SQL driver but performing AWS call, text will be a table name and values will be request options
Pool.prototype.query = function(client, req, options, callback)
{
    if (!req.options || !req.options.__bk) req.options = lib.objClone(req.options);
    req.options.endpoint = req.options.endpoint || this.url;
    req.options.retryCount = this.configOptions.retryCount;
    req.options.retryTimeout = this.configOptions.retryTimeout;
    req.options.httpTimeout = this.configOptions.httpTimeout;
    switch(req.op) {
    case "create":
        this.queryCreate(client, req, callback);
        break;

    case "upgrade":
        this.queryUpgrade(client, req, callback);
        break;

    case "drop":
        this.queryDrop(client, req, callback);
        break;

    case "get":
        this.queryGet(client, req, callback);
        break;

    case "select":
    case "search":
        this.queryPrepareSelect(client, req, callback);
        break;

    case "list":
        this.queryList(client, req, callback);
        break;

    case "add":
        this.queryAdd(client, req, callback);
        break;

    case "put":
        this.queryPut(client, req, callback);
        break;

    case "incr":
    case "update":
        this.queryUpdate(client, req, callback);
        break;

    case "del":
        this.queryDel(client, req, callback);
        break;

    case "bulk":
        this.queryBulk(client, req, callback);
        break;

    default:
        logger.debug("query:", this.name, req);
        callback(lib.newError("invalid op: " + req.op), []);
    }
}

Pool.prototype.queryCreate = function(client, req, callback)
{
    var self = this;
    var local = {}, global = {}, attrs = {}, projections = {};
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
        if (name.length < 3) name = "i_" + name;
        // Index starts with the same hash, local unless explicitly defined as global
        if (idx.length == 2 && idx[0] == hash && !req.obj[idx[1]].global) {
            local[name] = lib.objNew(idx[0], 'HASH', idx[1], 'RANGE');
        } else
        // Global if does not start with the primary hash
        if (idx.length == 2) {
            global[name] = lib.objNew(idx[0], 'HASH', idx[1], 'RANGE');
        } else {
            global[name] = lib.objNew(idx[0], 'HASH');
        }
        idx.forEach(function(y) { attrs[y] = 1 });
        var p = Object.keys(req.obj).filter(function(x, i) {
            if (idx.indexOf(x) > -1 || keys.indexOf(x) > -1) return 0;
            return req.obj[x]["projection" + n] ||
                    (req.obj[x].projections && !Array.isArray(req.obj[x].projections)) ||
                    (Array.isArray(req.obj[x].projections) && req.obj[x].projections.indexOf(lib.toNumber(n)) > -1);
        });
        if (p.length) projections[name] = p;
    });

    // All native properties for options from the key columns
    Object.keys(attrs).forEach(function(x) {
        attrs[x] = lib.isNumericType(req.obj[x].type) ? "N" : "S";
        for (var p in req.obj[x].dynamodb) req.options[p] = req.obj[x].dynamodb[p];
    });

    req.options.keys = keys;
    req.options.local = local;
    req.options.global = global;
    req.options.projections = projections;
    var ctable = req.table.substr(0,1).toUpperCase() + req.table.substr(1);
    var cap = lib.strSplit(this.configOptions["capacity" + ctable], ",", { datatype: "int" });
    req.options.readCapacity = req.options.readCapacity || this.configOptions["readCapacity" + ctable] || cap[0] || this.configOptions.readCapacity;
    req.options.writeCapacity = req.options.writeCapacity || this.configOptions["writeCapacity" + ctable] || cap[1] || cap[0] || this.configOptions.writeCapacity;
    // Wait long enough for the table to be active
    if (typeof req.options.waitTimeout == "undefined") req.options.waitTimeout = 60000;
    aws.ddbCreateTable(req.table, attrs, req.options, function(err, item) {
        if (!err) client.affected_rows = 1;
        // Create table columns for cases when describeTable never called or errored, for example Rate limit
        // happened during the cacheColumns stage
        if (item && item.TableDescription && !self.dbindexes[req.table]) {
            self.describeTable(req.table, { Table: item.TableDescription }, self);
        }
        callback(err, [], item);
    });
}

Pool.prototype.queryUpgrade = function(client, req, callback)
{
    var self = this;
    var global = {};
    ["","1","2","3","4","5"].forEach(function(n) {
        var idx = Object.keys(req.obj).filter(function(x, i) { return req.obj[x]["index" + n]; }).
                         sort(function(a,b) { return req.obj[a]["index" + n] - req.obj[b]["index" + n] }).
                         filter(function(x, i) { return i < 2 });
        if (!idx.length) return;
        var name = idx.join("_");
        if (name.length < 3) name = "i_" + name;
        if (self.dbindexes[req.table] && self.dbindexes[req.table][name]) return;
        var add = {};
        idx.forEach(function(x) {
            if (req.obj[x].readCapacity) add.readCapacity = req.obj[x].readCapacity;
            if (req.obj[x].writeCapacity) add.writeCapacity = req.obj[x].writeCapacity;
            add[x] = lib.isNumericType(req.obj[x].type) ? "N" : "S";
        });
        add.projection = Object.keys(req.obj).filter(function(x, i) {
            if (x == idx[0] || x == idx[1]) return 0;
            return (req.obj[x].projections && !Array.isArray(req.obj[x].projections)) ||
                    (Array.isArray(req.obj[x].projections) && req.obj[x].projections.indexOf(lib.toNumber(n)) > -1);
        });
        global[name] = add;
    });
    if (!Object.keys(global).length) return callback(null, []);

    req.options.name = req.table;
    req.options.add = global;
    aws.ddbUpdateTable(req.options, function(err, item) {
        if (!err) client.affected_rows = 1;
        callback(err, [], item);
    });
}

Pool.prototype.queryDrop = function(client, req, callback)
{
    if (typeof req.options.waitTimeout == "undefined") req.options.waitTimeout = 60000;
    aws.ddbDeleteTable(req.table, req.options, function(err) {
        callback(err, []);
    });
}

Pool.prototype.queryGet = function(client, req, callback)
{
    var keys = db.getSearchQuery(req.table, req.obj, { noempty: 1 });
    if (!Object.keys(keys).length) return callback();
    req.options.select = db.getSelectedColumns(req.table, req.options);
    aws.ddbGetItem(req.table, keys, req.options, function(err, rc) {
        if (!err && rc.ConsumedCapacity) rc.consumed_capacity = rc.ConsumedCapacity.CapacityUnits;
        callback(err, rc.Item ? [rc.Item] : [], rc);
    });
}

Pool.prototype.queryPrepareSelect = function(client, req, callback)
{
    var self = this;
    var dbattrs;
    var dbkeys = db.getKeys(req.table);
    var dbindexes = this.dbindexes[req.table] || db.indexes[req.table] || lib.empty;
    var dbprojections = this.dbprojections[req.table] || lib.empty;

    // Sorting by the default range key is default
    if (req.options.sort && req.options.sort == dbkeys[1]) req.options.sort = null;
    if (req.options.sort && req.options.sort.length < 3) req.options.sort = "i_" + req.options.sort;

    // Use primary keys from the secondary index
    if (req.options.sort) {
        // Use index by name, mostly global indexes
        if (dbindexes[req.options.sort]) {
            dbkeys = dbindexes[req.options.sort];
            dbattrs = dbprojections[req.options.sort];
        } else {
            // Local sorting order by range key
            for (var p in dbindexes) {
                var idx = dbindexes[p];
                if (idx && idx.length == 2 && (idx[0] == req.options.sort || idx[1] == req.options.sort)) {
                    req.options.sort = p;
                    dbkeys = dbindexes[p];
                    dbattrs = dbprojections[p];
                    break;
                }
            }
        }
    } else
    // Find a global index if any hash key for it provided
    if (!req.obj[dbkeys[0]] && !req.options.fullscan) {
        for (var p in dbindexes) {
            var idx = dbindexes[p];
            if (idx && idx.length == 2 && req.obj[idx[0]]) {
                req.options.sort = p;
                dbkeys = dbindexes[p];
                dbattrs = dbprojections[p];
                break;
            }
        }
    }

    // Query based on the keys, remove attributes that are not in the projection
    var join = (req.columns[dbkeys[0]] || lib.empty).join;
    req.options.keys = !req.options.sort ? Object.keys(req.obj) : Object.keys(req.obj).filter(function(x) {
        return (req.columns[x] && req.columns[x].primary) || dbkeys.indexOf(x) > -1 || (dbattrs && dbattrs.indexOf(x) > -1);
    }).filter(function(x) {
        return x != dbkeys[0] && Array.isArray(join) && join.indexOf(x) > -1 ? 0 : 1;
    });

    var query = db.getSearchQuery(req.table, req.obj, req.options);

    // Operation depends on the primary keys in the query, for Scan we can let the DB to do all the filtering
    var op = typeof query[dbkeys[0]] != "undefined" && !req.options.fullscan ? 'ddbQueryTable' : 'ddbScanTable';

    req.options.keys = dbkeys;
    req.options.attrs = dbattrs;
    this.queryRunSelect(op, client, req, query, function(err, rows, info) {
        callback(err, rows, info);
    })
}

Pool.prototype.queryRunSelect = function(op, client, req, query, callback)
{
    // Capacity rate limiter
    var inFilter, inKey;

    // Scans explicitely disabled
    if (op == 'ddbScanTable' && req.options.noscan) {
        logger.info('select:', 'dynamodb', req.table, op, req.options.sort, 'query:', query, 'keys:', req.options.keys, 'attrs:', req.options.attrs, "NO EMPTY SCANS ENABLED");
        return callback(null, []);
    }

    var cap = req.options.capacity || db.getCapacity(req.table, { useCapacity: req.options.useCapacity || "read", factorCapacity: req.options.factorCapacity || 0.9 });
    req.options.ReturnConsumedCapacity = "TOTAL";

    logger.debug('select:', 'dynamodb', req.table, req.options.sort, 'query:', query, 'keys:', req.options.keys, 'attrs:', req.options.attrs, 'count:', req.options.count, 'cap:', cap.rateCapacity, cap.useCapacity);

    var dbkeys = db.getKeys(req.table);
    for (var p in req.options.ops) {
        // IN is not supported for key condition, move it into the query
        if (req.options.ops[p] == "in" && (p == req.options.keys[1] || p == dbkeys[1])) {
            if (Array.isArray(query[p])) {
                if (query[p].length == 1) {
                    delete req.options.ops[p];
                    query[p] = query[p][0];
                } else {
                    inKey = p;
                    inFilter = query[p];
                    delete query[p];
                }
            }
        }
        // Full can on multiple hash keys
        if (req.options.ops[p] == "in" && (p == req.options.keys[0] || p == dbkeys[0])) op = 'ddbScanTable';
        // Noop for a hash key
        if (req.options.ops[p] && op == "ddbQueryTable" && (p == req.options.keys[0] || p == dbkeys[0])) req.options.ops[p] = '';
    }
    // Make sure we have valid start key
    if (req.options.start) {
        for (var i in dbkeys) {
            if (!req.options.start[dbkeys[i]]) {
                delete req.options.start;
                break;
            }
        }
    }

    req.options.select = db.getSelectedColumns(req.table, req.options);
    var rows = [], info = { consumed_capacity: 0, total: 0 };
    // Keep retrieving items until we reach the end or our limit
    lib.doWhilst(
       function(next) {
           aws[op](req.table, query, req.options, function(err, item) {
               if (req.options.total) {
                   if (!rows.length) rows.push({ count: 0 });
                   rows[0].count += item.Count;
               } else {
                   if (inFilter) item.Items = item.Items.filter(function(x) { return inFilter.indexOf(x[inKey]) > -1 });
                   rows.push.apply(rows, item.Items);
               }
               client.next_token = item.LastEvaluatedKey ? aws.fromDynamoDB(item.LastEvaluatedKey) : null;
               req.options.count -= item.Items.length;
               // Deal with abrupt stops, no way to know but only to retry
               if (!err && !item.Count && req.options.scanRetry > 0 && op == 'ddbScanTable') {
                   logger.info("ddbScanTable:", "retry:", req.options.start, cap);
                   req.options.scanRetry--;
                   client.next_token = req.options.start;
                   return db.checkCapacity(cap, next);
               }
               if (!err && item.ConsumedCapacity) {
                   info.consumed_capacity += item.ConsumedCapacity.CapacityUnits;
                   if (cap) return db.checkCapacity(cap, item.ConsumedCapacity.CapacityUnits, next);
               }
               next(err);
           });
       },
       function() {
           if (client.next_token == null || req.options.count <= 0) return false;
           req.options.start = client.next_token;
           return true;
       }, function(err) {
           callback(err, rows, info);
       });
}

Pool.prototype.queryList = function(client, req, callback)
{
    var info = { consumed_capacity: 0 }, rows = [], breq = {};
    // Capacity rate limiter
    var cap = req.options.capacity || db.getCapacity(req.table, { useCapacity: req.options.useCapacity || "read", factorCapacity: req.options.factorCapacity });
    req.options.ReturnConsumedCapacity = "TOTAL";

    // Keep retrieving items until we reach the end or our limit
    lib.doWhilst(
       function(next) {
           var list = req.obj.slice(0, 100);
           req.obj = req.obj.slice(100);
           if (!list.length) return next();
           breq[req.table] = { keys: list, select: db.getSelectedColumns(req.table, req.options), consistent: req.options.consistent };
           delete req.options.RequestItems;
           aws.ddbBatchGetItem(breq, req.options, function(err, item) {
               if (err) return callback(err, []);
               // Keep retrieving items until we get all items from this batch
               var moreKeys = item.UnprocessedKeys || null;
               rows.push.apply(rows, item.Responses && item.Responses[req.table] || lib.emptylist);
               lib.whilst(
                   function() {
                       return moreKeys && Object.keys(moreKeys).length;
                   },
                   function(next2) {
                       req.options.RequestItems = moreKeys;
                       aws.ddbBatchGetItem({}, req.options, function(err, item) {
                           moreKeys = item.UnprocessedKeys || null;
                           rows.push.apply(rows, item.Responses[req.table] || lib.emptylist);
                           if (!err && item.ConsumedCapacity) {
                               info.consumed_capacity += item.ConsumedCapacity.CapacityUnits;
                               if (cap) return db.checkCapacity(cap, item.ConsumedCapacity.CapacityUnits, next2);
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

Pool.prototype.queryAdd = function(client, req, callback)
{
    var self = this;
    var dbkeys = db.getKeys(req.table);
    req.options.expected = dbkeys.map(function(x) { return x }).reduce(function(x,y) { x[y] = null; return x }, {});
    if (req.options.useCapacity || req.options.capacity) req.options.ReturnConsumedCapacity = "TOTAL";
    aws.ddbPutItem(req.table, req.obj, req.options, function(err, rc) {
        if (!rc) rc = {};
        if (!err) rc.affected_rows = 1;
        if (!err && rc.ConsumedCapacity) rc.consumed_capacity = rc.ConsumedCapacity.CapacityUnits;
        callback(err, rc.Item ? [rc.Item] : [], rc);
    });
}

Pool.prototype.queryPut = function(client, req, callback)
{
    if (req.options.useCapacity || req.options.capacity) req.options.ReturnConsumedCapacity = "TOTAL";
    aws.ddbPutItem(req.table, req.obj, req.options, function(err, rc) {
        if (!rc) rc = {};
        if (!err) rc.affected_rows = 1;
        if (!err && rc.ConsumedCapacity) rc.consumed_capacity = rc.ConsumedCapacity.CapacityUnits;
        callback(err, rc.Item ? [rc.Item] : [], rc);
    });
}

Pool.prototype.queryUpdate = function(client, req, callback)
{
    var self = this;
    var keys = db.getSearchQuery(req.table, req.obj);
    if (req.op == "update" && !req.options.upsert) {
        if (req.options.expected) {
            for (var p in keys) if (!req.options.expected[p]) req.options.expected[p] = keys[p];
        } else
            if (!req.options.Expected && !req.options.expr && !req.options.ConditionExpression) req.options.expected = keys;
    }
    if (req.options.updateOps) {
        if (!lib.isObject(req.options.action)) req.options.action = {};
        for (var p in req.options.updateOps) {
            if (req.options.updateOps[p] == "set") req.options.action[p] = 'SET'; else
            if (req.options.updateOps[p] == "incr") req.options.action[p] = 'ADD'; else
            if (req.options.updateOps[p] == "add") req.options.action[p] = 'ADD'; else
            if (req.options.updateOps[p] == "del") req.options.action[p] = 'DELETE'; else
            if (req.options.updateOps[p] == "append") req.options.action[p] = 'APPEND'; else
            if (req.options.updateOps[p] == "prepend") req.options.action[p] = 'PREPEND'; else
            if (req.options.updateOps[p] == "not_exists") req.options.action[p] = 'NOT_EXISTS';
        }
    }
    if (req.options.useCapacity || req.options.capacity) req.options.ReturnConsumedCapacity = "TOTAL";
    aws.ddbUpdateItem(req.table, keys, req.obj, req.options, function(err, rc) {
        if (!rc) rc = {};
        if (!err) rc.affected_rows = 1;
        if (!err && rc.ConsumedCapacity) rc.consumed_capacity = rc.ConsumedCapacity.CapacityUnits;
        if (err && err.code == "ConditionalCheckFailedException") err = null;
        callback(err, rc.Item ? [rc.Item] : [], rc);
    });
}

Pool.prototype.queryDel = function(client, req, callback)
{
    var keys = db.getSearchQuery(req.table, req.obj);
    if (req.options.useCapacity || req.options.capacity) req.options.ReturnConsumedCapacity = "TOTAL";
    if (req.options.expected) {
        for (var p in keys) if (!req.options.expected[p]) req.options.expected[p] = keys[p];
    } else {
        if (!req.options.Expected && !req.options.expr && !req.options.ConditionExpression) req.options.expected = keys;
    }
    aws.ddbDeleteItem(req.table, keys, req.options, function(err, rc) {
        if (!rc) rc = {};
        if (!err) rc.affected_rows = 1;
        if (!err && rc.ConsumedCapacity) rc.consumed_capacity = rc.ConsumedCapacity.CapacityUnits;
        if (err && err.code == "ConditionalCheckFailedException") err = null;
        callback(err, rc.Item ? [rc.Item] : [], rc);
    });
}

Pool.prototype.queryBulk = function(client, req, callback)
{
    var info = { consumed_capacity: 0 }, rows = [], breq = {};
    // Capacity rate limiter
    var cap = req.options.capacity || db.getCapacity(req.table, { useCapacity: req.options.useCapacity || "write", factorCapacity: req.options.factorCapacity });
    req.options.ReturnConsumedCapacity = "TOTAL";

    // Keep sending items until we reach the end or our limit
    lib.doWhilst(
       function(next) {
           var list = req.obj.slice(0, 25);
           req.obj = req.obj.slice(25);
           if (!list.length) return next();
           breq = {};
           for (var i in list) {
               switch (list[i].op) {
               case "add":
               case "put":
               case "del":
                   if (!breq[list[i].table]) breq[list[i].table] = [];
                   breq[list[i].table].push(lib.objNew(list[i].op, list[i].obj));
                   break;
               default:
                   rows.push(["ignored",list[i]]);
                   continue;
               }
           }
           delete req.options.RequestItems;
           aws.ddbBatchWriteItem(breq, req.options, function(err, item) {
               if (err) return callback(err, []);
               // Keep retrieving items until we get all items from this batch
               var moreItems = item.UnprocessedItems || null;
               lib.whilst(
                   function() {
                       return moreItems && Object.keys(moreItems).length;
                   },
                   function(next2) {
                       req.options.RequestItems = moreItems;
                       aws.ddbBatchWriteItem({}, req.options, function(err, item) {
                           moreItems = item.UnprocessedKeys || null;
                           if (!err && item.ConsumedCapacity) {
                               info.consumed_capacity += item.ConsumedCapacity.CapacityUnits;
                               if (cap) return db.checkCapacity(cap, item.ConsumedCapacity.CapacityUnits, next2);
                           }
                           next2(err);
                       });
               }, next);
           });
       },
       function() {
           return req.obj.length > 0;
       },
       function(err) {
           callback(err, rows, info);
       });
}
