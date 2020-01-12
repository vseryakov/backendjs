//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const util = require('util');
const core = require(__dirname + '/core');
const lib = require(__dirname + '/lib');
const aws = require(__dirname + '/aws');
const db = require(__dirname + '/db');
const logger = require(__dirname + '/logger');

const pool = {
    name: "dynamodb",
    configOptions: {
        noJson: 1,
        strictTypes: 1,
        noConcat: 1,
        skipNull: { add: /.*/, put: /.*/ },
        skipEmpty: { add: /^(list|set)$/, put: /^(list|set)$/ },
        noNulls: 1,
        epochTtl: 1,
        emptyValue: "",
        concurrency: 3,
        requireCapacity: 1,
        cacheColumns: 1,        // need it for capacity
        maxIndexes: 20,
        batchSize: 100,
        bulkSize: 25,
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

Pool.prototype._parseTable = function(table, rc, schema)
{
    if (!rc || !rc.Table) return;
    (rc.Table.AttributeDefinitions || []).forEach(function(x) {
        if (!schema.dbcolumns[table]) schema.dbcolumns[table] = {};
        var data_type = x.AttributeType == "N" ? "number" : x.AttributeType.length == 2 ? "array" : "text";
        schema.dbcolumns[table][x.AttributeName] = { data_type: data_type };
    });
    (rc.Table.KeySchema || []).forEach(function(x) {
        schema.dbcolumns[table][x.AttributeName].primary = 1;
        lib.objSet(schema.dbkeys, [table], x.AttributeName, { push: 1, unique: 1 });
        lib.objSet(schema.dbcapacity, [table, table], { read: rc.Table.ProvisionedThroughput && rc.Table.ProvisionedThroughput.ReadCapacityUnits || 0,
                                                        write: rc.Table.ProvisionedThroughput && rc.Table.ProvisionedThroughput.WriteCapacityUnits || 0 });
    });
    (rc.Table.LocalSecondaryIndexes || []).forEach(function(x) {
        if (x.Projection && Array.isArray(x.Projection.NonKeyAttributes)) {
            lib.objSet(schema.dbprojections, [table, x.IndexName], x.Projection.NonKeyAttributes);
        }
        (x.KeySchema || []).forEach(function(y) {
            lib.objSet(schema.dbindexes, [table, x.IndexName], y.AttributeName, { push: 1, unique: 1 });
            schema.dbcolumns[table][y.AttributeName].lsi = 1;
        });
    });
    (rc.Table.GlobalSecondaryIndexes || []).forEach(function(x) {
        if (x.Projection && Array.isArray(x.Projection.NonKeyAttributes)) {
            lib.objSet(schema.dbprojections, [table, x.IndexName], x.Projection.NonKeyAttributes);
        }
        (x.KeySchema || []).forEach(function(y) {
            lib.objSet(schema.dbindexes, [table, x.IndexName], y.AttributeName, { push: 1, unique: 1 });
            schema.dbcolumns[table][y.AttributeName].gsi = 1;
        });
        lib.objSet(schema.dbcapacity, [table, x.IndexName], { read: x.ProvisionedThroughput && x.ProvisionedThroughput.ReadCapacityUnits || 0,
                                                              write: x.ProvisionedThroughput && x.ProvisionedThroughput.WriteCapacityUnits || 0 });
    });
}

Pool.prototype.cacheColumns = function(options, callback)
{
    var self = this;
    options = lib.objClone(options, "endpoint", this.url,
                                    "endpoint_protocol", options.endpoint_protocol || this.configOptions.endpoint_protocol,
                                    "region", options.region || this.configOptions.region,
                                    "concurrency", options.concurrency || this.configOptions.concurrency || core.concurrency);
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
          lib.forEachLimit(tables, options.concurrency, function(table, next) {
              aws.ddbDescribeTable(table, options, function(err, rc) {
                  if (err || rc.Table.TableStatus == "DELETING") return next();
                  self._parseTable(table, rc, schema);
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
        if (err.message === "The provided key element does not match the schema") err.code = "NotFound";
        break;
    case "add":
    case "put":
        if (err.code === "ConditionalCheckFailedException") err.code = "AlreadyExists";
        break;
    case "incr":
    case "update":
    case "del":
        if (err.code == "ConditionalCheckFailedException") err.code = "NotFound";
        break;
    case "select":
    case "search":
        if (err.message === "The provided starting key is invalid") err.code = "NotMatched"; else
        if (err.message === "The provided starting key is outside query boundaries based on provided conditions") err.code = "NotMatched";
        break;
    }
    if (err.code === "ProvisionedThroughputExceededException") err.code = "OverCapacity";
    return err;
}

Pool.prototype.prepareOptions = function(options)
{
    options.region = options.region || this.configOptions.region;
    options.endpoint = options.endpoint || this.url;
    options.endpoint_protocol = options.endpoint_protocol || this.configOptions.endpoint_protocol;
    options.retryCount = options.retryCount || this.configOptions.retryCount;
    options.retryTimeout = this.configOptions.retryTimeout;
    options.httpTimeout = this.configOptions.httpTimeout;
}

// Simulate query as in SQL driver but performing AWS call, text will be a table name and values will be request options
Pool.prototype.query = function(client, req, options, callback)
{
    this.prepareOptions(req.options);
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
        if (req.options.transaction) {
            this.queryTransact(client, req, callback);
        } else {
            this.queryBulk(client, req, callback);
        }
        break;

    default:
        callback(lib.newError("invalid op: " + req.op), []);
    }
}

Pool.prototype.queryCreate = function(client, req, callback)
{
    var self = this;
    var local = {}, global = {}, attrs = {}, projections = {}, rc;
    var keys = Object.keys(req.obj).filter(function(x, i) { return req.obj[x].primary }).
                      sort(function(a,b) { return req.obj[a].primary - req.obj[b].primary }).
                      filter(function(x, i) { return i < 2 }).
                      map(function(x) { attrs[x] = 1; return x });
    var hash = keys[0];
    (new Array(this.configOptions.maxIndexes)).fill(0, 0).forEach(function(u, n) {
        n = n || "";
        var idx = Object.keys(req.obj).filter(function(x) { return req.obj[x]["index" + n]; }).
                         sort(function(a,b) { return req.obj[a]["index" + n] - req.obj[b]["index" + n] }).
                         filter(function(x, i) { return i < 2 });
        if (!idx.length) return;
        var name = idx.join("_");
        if (name.length < 3) name = "i_" + name;
        // Index starts with the same hash, local unless explicitly defined as global
        if (idx.length == 2 && idx[0] == hash && !req.obj[idx[1]].global) {
            local[name] = { [idx[0]]: 'HASH', [idx[1]]: 'RANGE' };
        } else
        // Global if does not start with the primary hash
        if (idx.length == 2) {
            global[name] = { [idx[0]]: 'HASH', [idx[1]]: 'RANGE' };
        } else {
            global[name] = { [idx[0]]: 'HASH' };
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
        attrs[x] = !req.obj[x].join && lib.isNumericType(req.obj[x].type) ? "N" : "S";
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

    lib.series([
        function(next) {
            aws.ddbCreateTable(req.table, attrs, req.options, function(err, item) {
                rc = item;
                if (!err) client.affected_rows = 1;
                // Create table columns for cases when describeTable never called or errored, for example Rate limit
                // happened during the cacheColumns stage
                if (item && item.TableDescription && !self.dbindexes[req.table]) {
                    self._parseTable(req.table, { Table: item.TableDescription }, self);
                }
                next(err);
            });
        },
        function(next) {
            // Manage TTL column
            req.options.attribute = Object.keys(req.obj).filter((x) => (req.obj[x].type == "ttl")).pop();
            if (!req.options.attribute) return next();
            aws.ddbDescribeTimeToLive(req.table, req.options, (err, item) => {
                if (err || item.TimeToLiveDescription.TimeToLiveStatus == "ENABLED") return next(err);
                req.options.enabled = 1;
                req.options.name = req.table;
                aws.ddbUpdateTimeToLive(req.options, next);
            });
        },
    ], (err) => {
        callback(err, [], rc);
    });
}

Pool.prototype.queryUpgrade = function(client, req, callback)
{
    var self = this;
    var global = {}, rc;
    (new Array(this.configOptions.maxIndexes)).fill(0, 0).forEach(function(u, n) {
        n = n || "";
        var idx = Object.keys(req.obj).filter(function(x, i) { return req.obj[x]["index" + n]; }).
                         sort(function(a,b) { return req.obj[a]["index" + n] - req.obj[b]["index" + n] }).
                         filter(function(x, i) { return i < 2 });
        if (!idx.length) return;
        var name = idx.join("_");
        if (name.length < 3) name = "i_" + name;
        if (self.dbindexes[req.table] && self.dbindexes[req.table][name]) return;
        var add = {}, cap = self.dbcapacity[req.table] && self.dbcapacity[req.table][req.table] || lib.empty;
        idx.forEach(function(x) {
            if (req.obj[x].readCapacity) add.readCapacity = req.obj[x].readCapacity;
            if (req.obj[x].writeCapacity) add.writeCapacity = req.obj[x].writeCapacity;
            if (!add.readCapacity && cap.read) add.readCapacity = cap.read;
            if (!add.writeCapacity && cap.write) add.writeCapacity = cap.write;
            add[x] = !req.obj[x].join && lib.isNumericType(req.obj[x].type) ? "N" : "S";
        });
        add.projection = Object.keys(req.obj).filter(function(x, i) {
            if (x == idx[0] || x == idx[1]) return 0;
            return (req.obj[x].projections && !Array.isArray(req.obj[x].projections)) ||
                    (Array.isArray(req.obj[x].projections) && req.obj[x].projections.indexOf(lib.toNumber(n)) > -1);
        });
        global[name] = add;
        return;
    });

    lib.series([
        function(next) {
            if (!Object.keys(global).length) return next();
            req.options.name = req.table;
            req.options.add = global;
            aws.ddbUpdateTable(req.options, function(err, item) {
                rc = item;
                if (!err) client.affected_rows = 1;
                next(err);
            });
        },
        function(next) {
            // Manage TTL column
            req.options.attribute = Object.keys(req.obj).filter((x) => (req.obj[x].type == "ttl")).pop();
            if (!req.options.attribute) return next();
            aws.ddbDescribeTimeToLive(req.table, req.options, (err, item) => {
                if (err || item.TimeToLiveDescription.TimeToLiveStatus == "ENABLED") return next(err);
                req.options.enabled = 1;
                req.options.name = req.table;
                aws.ddbUpdateTimeToLive(req.options, next);
            });
        },
    ], (err) => {
        callback(err, [], rc);
    });
}

Pool.prototype.queryDrop = function(client, req, callback)
{
    if (typeof req.options.waitTimeout == "undefined") req.options.waitTimeout = 60000;
    aws.ddbDeleteTable(req.table, req.options, function(err, rc) {
        callback(err, [], rc);
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
    var dbattrs, dbmax;
    var dbkeys = db.getKeys(req.table);
    var dbindexes = this.dbindexes[req.table] || db.indexes[req.table] || lib.empty;
    var dbprojections = this.dbprojections[req.table] || lib.empty;
    var dbcolumns = this.dbcolumns[req.table] || lib.empty;
    var columns = db.getColumns(req.table, req.options);

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
    // Find a global index if any hash key for it provided, prefer index with hash and sort values
    if (!req.obj[dbkeys[0]] && !req.options.fullscan) {
        for (const p in dbindexes) {
            const idx = dbindexes[p];
            if (!idx || !req.obj[idx[0]]) continue;
            const max = idx[1] && req.obj[idx[1]] ? 2 : 1;
            if (dbmax && max < dbmax) continue;
            req.options.sort = p;
            dbkeys = dbindexes[p];
            dbattrs = dbprojections[p];
            dbmax = max;
        }
    }

    // Query based on the keys, remove attributes that are not in the projection
    var join = (columns[dbkeys[0]] || lib.empty).join;
    req.options.keys = !req.options.sort ? Object.keys(req.obj) : Object.keys(req.obj).filter(function(x) {
        return (columns[x] && columns[x].primary) || dbkeys.indexOf(x) > -1 || (dbattrs && dbattrs.indexOf(x) > -1);
    }).filter(function(x) {
        return x != dbkeys[0] && Array.isArray(join) && join.indexOf(x) > -1 ? 0 : 1;
    });

    var query = db.getSearchQuery(req.table, req.obj, req.options);

    // Operation depends on the primary keys in the query, for Scan we can let the DB to do all the filtering
    var op = typeof query[dbkeys[0]] != "undefined" && !req.options.fullscan ? 'ddbQueryTable' : 'ddbScanTable';

    // Remove not projected columns if it is a GSI, LSI supports main table columns
    var select = db.getSelectedColumns(req.table, req.options);
    if (select && dbattrs) {
        var lsi = req.options.sort && dbkeys.every((x) => (dbcolumns[x].lsi));
        select = lsi ? req.options.select.filter((x) => (columns[x])) :
                       req.options.select.filter((x) => ((columns[x] && columns[x].primary) || dbkeys.indexOf(x) > -1 || dbattrs.indexOf(x) > -1));
    }
    req.options.select = select;
    req.options.keys = dbkeys;
    req.options.attrs = dbattrs;
    this.queryRunSelect(op, client, req, query, function(err, rows, info) {
        callback(err, rows, info);
    })
}

Pool.prototype.queryRunSelect = function(op, client, req, query, callback)
{
    // Capacity rate limiter
    var inFilter, inKey, inList, inListKey;

    // Scans explicitely disabled
    if (op == 'ddbScanTable' && req.options.noscan) {
        logger.info('select:', 'dynamodb', req.table, op, req.options.sort, 'query:', query, 'keys:', req.options.keys, 'attrs:', req.options.attrs, "NO EMPTY SCANS ENABLED");
        return callback(null, []);
    }

    var cap = req.options.capacity || db.getCapacity(req.table, { useCapacity: req.options.useCapacity || "read", factorCapacity: req.options.factorCapacity || 0.9 });
    req.options.ReturnConsumedCapacity = "TOTAL";

    logger.debug('select:', 'dynamodb', op, req.table, req.options.sort, 'query:', query, 'keys:', req.options.keys, 'attrs:', req.options.attrs, 'count:', req.options.count, 'cap:', cap.rateCapacity, cap.useCapacity);

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
        // Full scan on multiple hash keys
        if (req.options.ops[p] == "in" && lib.isArray(query[p]) && (p == req.options.keys[0] || p == dbkeys[0])) op = 'ddbScanTable';
        // Noop for a hash key
        if (req.options.ops[p] && op == "ddbQueryTable" && (p == req.options.keys[0] || (!req.options.sort && p == dbkeys[0]))) req.options.ops[p] = '';
        // Large IN lists, iterate, only one at a time
        if (req.options.ops[p] == "in" && lib.arrayLength(query[p]) > 100 && !inList) {
            inListKey = p;
            inList = query[p].slice(0);
            query[p] = inList.splice(0, 99);
        }
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
    if (!req.options.count) delete req.options.count;
    var rows = [], info = { consumed_capacity: 0, total: 0, retry_count: 0 };
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
                if (item.retry_count) info.retry_count += item.retry_count;
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
            if (client.next_token == null || req.options.count <= 0) {
                if (inList && inList.length) {
                    query[inListKey] = inList.splice(0, 99);
                    return true;
                }
                return false;
            }
            req.options.start = client.next_token;
            return true;
        }, function(err) {
            callback(err, rows, info);
        });
}

Pool.prototype.queryList = function(client, req, callback)
{
    var info = { consumed_capacity: 0, retry_count: 0 }, rows = [];
    // Capacity rate limiter
    var cap = req.options.capacity || db.getCapacity(req.table, { useCapacity: req.options.useCapacity || "read", factorCapacity: req.options.factorCapacity });
    req.options.ReturnConsumedCapacity = "TOTAL";

    // Keep retrieving items until we reach the end or our limit
    var chunks = [];
    for (let i = 0; i < req.obj.length; i+= this.configOptions.batchSize) chunks.push(req.obj.slice(i, i + this.configOptions.batchSize));

    lib.forEachLimit(chunks, req.options.concurrency, (chunk, next) => {
        const batch = { [req.table]: { keys: chunk, select: db.getSelectedColumns(req.table, req.options), consistent: req.options.consistent } };
        aws.ddbBatchGetItem(batch, req.options, function(err, item) {
            if (item.retry_count) info.retry_count += item.retry_count;
            if (err) return next(err);
            rows.push.apply(rows, item.Responses && item.Responses[req.table] || lib.emptylist);
            // Keep retrieving items until we get all items from this batch
            var moreKeys = item.UnprocessedKeys || null;
            lib.whilst(
                function() {
                    return moreKeys && Object.keys(moreKeys).length;
                },
                function(next2) {
                    const opts = lib.objClone(req.options);
                    opts.RequestItems = moreKeys;
                    aws.ddbBatchGetItem({}, opts, function(err, item) {
                        if (item.retry_count) info.retry_count += item.retry_count;
                        if (err) return next2(err);
                        rows.push.apply(rows, item.Responses[req.table] || lib.emptylist);
                        moreKeys = item.UnprocessedKeys || null;
                        if (item.ConsumedCapacity) {
                            info.consumed_capacity += item.ConsumedCapacity.CapacityUnits;
                            if (cap) return db.checkCapacity(cap, item.ConsumedCapacity.CapacityUnits, next2);
                        }
                        next2();
                    });
                },
                next);
        });
    },
    function(err) {
       callback(err, rows, info);
    });
}

Pool.prototype.queryAdd = function(client, req, callback)
{
    req.options.expected = db.getKeys(req.table).map(function(x) { return x }).reduce(function(x,y) { x[y] = null; return x }, {});
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
    var keys = db.getSearchQuery(req.table, req.obj);
    if (req.options.noupsert || (req.op == "update" && !req.options.upsert)) {
        if (req.options.expected) {
            for (const p in keys) if (!req.options.expected[p]) req.options.expected[p] = keys[p];
        } else
            if (!req.options.Expected && !req.options.expr && !req.options.ConditionExpression) req.options.expected = keys;
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
    var info = { consumed_capacity: 0, retry_count: 0, _size: req.obj.length, _retries: 0 }, rows = [];
    var cap = req.options.capacity || db.getCapacity(req.table, { useCapacity: req.options.useCapacity || "write", factorCapacity: req.options.factorCapacity });
    var count = lib.toClamp(cap.writeCapacity || this.configOptions.bulkSize, 2, this.configOptions.bulkSize);
    var breq, moreItems, objs = req.obj;
    req.options.ReturnConsumedCapacity = "TOTAL";

    // Keep sending items until we reach the end or our limit
    lib.doWhilst(
        function(next) {
            breq = {};
            delete req.options.RequestItems;
            if (moreItems) {
                req.options.RequestItems = moreItems;
            } else {
                var list = objs.slice(0, count);
                objs = objs.slice(count);
                if (!list.length) return next();
                for (var i in list) {
                    if (list[i].errstatus) {
                        rows.push(list[i]);
                        continue;
                    }
                    switch (list[i].op) {
                    case "del":
                        list[i].obj = db.getKeys(list[i].table).reduce((x,y) => { x[y] = list[i].obj[y]; return x }, {});
                    case "put":
                        if (!breq[list[i].table]) breq[list[i].table] = [];
                        breq[list[i].table].push({ [list[i].op]: list[i].obj });
                        break;
                    default:
                        rows.push(lib.objExtend(list[i], { errstatus: "NotSupported" }, { del: /^(orig|options)/ }));
                    }
                }
            }
            if (!Object.keys(breq).length) return next();
            aws.ddbBatchWriteItem(breq, req.options, function(err, item) {
                if (err) return callback(err, []);
                var consumed = lib.toNumber(item.ConsumedCapacity && item.ConsumedCapacity.CapacityUnits);
                info.consumed_capacity += consumed;
                info._retries++;
                if (item.retry_count) info.retry_count += item.retry_count;
                moreItems = !lib.isEmpty(item.UnprocessedKeys) ? item.UnprocessedKeys : null;
                if (!moreItems && !req.obj.length) return next();
                db.checkCapacity(cap, consumed, next);
            });
        },
        function() {
            return info._retries < info._size && (moreItems || objs.length > 0);
        },
        function(err) {
            if (!err) info.affected_rows = info._size - rows.length;
            delete req.options.RequestItems;
            callback(err, rows, info);
    });
}

Pool.prototype.queryTransact = function(client, req, callback)
{
    var info = { consumed_capacity: 0, count: req.obj.length };
    var cap = req.options.capacity || db.getCapacity(req.table, { useCapacity: req.options.useCapacity || "write", factorCapacity: req.options.factorCapacity });
    var count = lib.toClamp(cap.writeCapacity || this.configOptions.bulkSize, 2, this.configOptions.bulkSize);
    var objs = req.obj, list;
    req.options.ReturnConsumedCapacity = "TOTAL";

    // Keep sending items until we reach the end or our limit
    lib.doWhilst(
        function(next) {
            list = objs.slice(0, count);
            objs = objs.slice(count);
            if (!list.length) return next();
            list.forEach((x) => {
                switch (x.op) {
                case "add":
                    x.options.expected = db.getKeys(x.table).map(function(x) { return x }).reduce(function(x,y) { x[y] = null; return x }, {});
                    break;
                case "incr":
                case "update":
                    x.keys = db.getSearchQuery(x.table, x.obj);
                    if (x.options.noupsert || (x.op == "update" && !x.options.upsert)) {
                        if (x.options.expected) {
                            for (const p in x.keys) if (!x.options.expected[p]) x.options.expected[p] = x.keys[p];
                        } else
                        if (!x.options.Expected && !x.options.expr && !x.options.ConditionExpression) x.options.expected = x.keys;
                    }
                    break;
                case "del":
                    x.obj = db.getSearchQuery(x.table, x.obj);
                    break;
                }
                delete x.columns;
                delete x.orig;
            });
            aws.ddbTransactWriteItems(list, req.options, function(err, item) {
                if (err) return callback(err, item);
                var consumed = lib.toNumber(item.ConsumedCapacity && item.ConsumedCapacity.CapacityUnits);
                info.consumed_capacity += consumed;
                db.checkCapacity(cap, consumed, next);
            });
        },
        function() {
            return objs.length > 0;
        },
        function(err) {
            if (!err) info.affected_rows = info.count;
            callback(err, [], info);
    });
}

