/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
'use strict';

const lib = require(__dirname + '/../lib');
const aws = require(__dirname + '/../aws');
const db = require(__dirname + '/../db');
const logger = require(__dirname + '/../logger');
const DbPool = require(__dirname + '/pool');

exports.defaults = {
    type: "dynamodb",
    config: {
        features: {
            json: 1,
            list: 1,
            custom: 1,
            counter: 1,
            bulk: 50,
            limit: 25,
            batch: 100,
            not_null: 1,
        },
        concurrency: 3,
        opsMap: { "!=": "<>", "": "=", eq: "=", ne: "<>", lt: "<", le: "<=", gt: ">", ge: ">=" }
    },
}

/**
 * Create a database pool that works with AWS DynamoDB
 *
 */

class DynamoDBPool extends DbPool {

    constructor(options)
    {
        super(options, exports.defaults);

        this.dbcapacity = {};
        this.dbprojections = {};

        for (const table in db.tables) {
            const { keys, local, global, projections } = this.prepareCreate(db.tables[table]);
            this.dbkeys[table] = keys;
            if (!lib.isEmpty(projections)) {
                this.dbprojections[table] = projections;
            }
            for (const i in local) {
                if (!this.dbcolumns[table]) this.dbcolumns[table] = {};
                for (const p in local[i]) {
                    lib.objSet(this.dbcolumns[table], [p, "lsi"], 1);
                }
            }
            Object.assign(local, global);
            if (!lib.isEmpty(local)) {
                this.dbindexes[table] = Object.keys(local).reduce((a, b) => { a[b] = Object.keys(local[b]); return a }, {});
            }
        }
    }

    _parseTable(table, rc, schema)
    {
        if (!rc?.Table) return;
        (rc.Table.AttributeDefinitions || []).forEach(function(x) {
            if (!schema.dbcolumns[table]) schema.dbcolumns[table] = {};
            const data_type = x.AttributeType === "N" ? "number" : x.AttributeType.length === 2 ? "array" : "text";
            schema.dbcolumns[table][x.AttributeName] = { data_type };
        });
        (rc.Table.KeySchema || []).forEach(function(x) {
            schema.dbcolumns[table][x.AttributeName].primary = 1;
            lib.objSet(schema.dbkeys, [table], x.AttributeName, { push: 1, unique: 1 });
            lib.objSet(schema.dbcapacity, [table, table], { read: rc.Table.ProvisionedThroughput?.ReadCapacityUnits || 0,
                write: rc.Table.ProvisionedThroughput?.WriteCapacityUnits || 0 });
        });
        (rc.Table.LocalSecondaryIndexes || []).forEach(function(x) {
            if (x.Projection && Array.isArray(x.Projection.NonKeyAttributes)) {
                lib.objSet(schema.dbprojections, [table, x.IndexName], x.Projection.NonKeyAttributes);
            }
            (x.KeySchema || []).forEach(function(y) {
                lib.objSet(schema.dbindexes, [table + "_" + x.IndexName], y.AttributeName, { push: 1, unique: 1 });
                schema.dbcolumns[table][y.AttributeName].lsi = 1;
            });
        });
        (rc.Table.GlobalSecondaryIndexes || []).forEach(function(x) {
            if (x.Projection && Array.isArray(x.Projection.NonKeyAttributes)) {
                lib.objSet(schema.dbprojections, [table, x.IndexName], x.Projection.NonKeyAttributes);
            }
            (x.KeySchema || []).forEach(function(y) {
                lib.objSet(schema.dbindexes, [table + "_" + x.IndexName], y.AttributeName, { push: 1, unique: 1 });
                schema.dbcolumns[table][y.AttributeName].gsi = 1;
            });
            lib.objSet(schema.dbcapacity, [table, x.IndexName], { read: x.ProvisionedThroughput?.ReadCapacityUnits || 0,
              write: x.ProvisionedThroughput?.WriteCapacityUnits || 0 });
        });
    }

    exists(table)
    {
        return !!this.dbcolumns[aws.ddbTable(table)];
    }

    cacheColumns(_client, options, callback)
    {
        options = lib.clone(options, {
            endpoint: this.url,
            endpoint_protocol: options?.endpoint_protocol || this.config.endpoint_protocol,
            region: options?.region || this.config.region,
            concurrency: options?.concurrency || this.config.concurrency || db.concurrency,
        });
        const schema = { dbcolumns: {}, dbkeys: {}, dbindexes: {}, dbcapacity: {}, dbprojections: {} };

        lib.series([
            (next) => {
                aws.ddbListTables(options, (err, rc) => {
                    next(err, rc.TableNames);
                });
            },
            (next, tables) => {
                lib.forEachLimit(tables, options.concurrency, (table, next) => {
                    aws.ddbDescribeTable(table, options, (err, rc) => {
                        if (err || rc.Table.TableStatus === "DELETING") return next();
                        this._parseTable(table, rc, schema);
                        next();
                    });
                }, next, true);
            },
            (next) => {
                // Replace all at once
                for (const p in schema) this[p] = schema[p];
                next();
            },
        ], callback, true);
    }

    // Convert into recognizable error codes
    convertError(req, err)
    {
        switch (req.op) {
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
            if (err.code === "ConditionalCheckFailedException") err.code = "NotFound";
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

    prepareOptions(options)
    {
        options.region = options.region || this.config.region;
        options.endpoint = options.endpoint || this.url;
        options.endpoint_protocol = options.endpoint_protocol || this.config.endpoint_protocol;
        options.retryCount = options.retryCount || this.config.retryCount;
        options.retryTimeout = this.config.retryTimeout;
        options.httpTimeout = this.config.httpTimeout;
    }

    // Simulate query as in SQL driver but performing AWS call, text will be a table name and values will be request options
    query(client, req, callback)
    {
        this.prepareOptions(req.options);
        switch (req.op) {
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

        case "sql":
            this.querySql(client, req, callback);
            break;

        default:
            callback(lib.newError("invalid op: " + req.op), []);
        }
    }

    prepareCreate(table)
    {
        var local = {}, global = {}, attrs = {}, projections = {};

        var indexes = db.getIndexColumns(table);

        var keys = indexes.primary?.slice(0, 2).map(x => { attrs[x] = 1; return x }) || [];

        var hash = keys[0];

        for (const type in indexes) {
            if (type[0] === "p") continue;
            const index = indexes[type].slice(0, 2);
            let name = index.join("_");
            if (name.length < 3) name = "i_" + name;

            // Index starts with the same hash, local unless explicitly defined as global
            if (index.length === 2 && index[0] === hash && !table[index[0]]._$dynamodb?.global) {
                local[name] = { [index[0]]: 'HASH', [index[1]]: 'RANGE' };
            } else

            // Global if does not start with the primary hash
            if (index.length === 2) {
                global[name] = { [index[0]]: 'HASH', [index[1]]: 'RANGE' };
            } else {
                global[name] = { [index[0]]: 'HASH' };
            }
            index.forEach((y) => { attrs[y] = 1 });

            projections[name] = table[index[0]]._$dynamodb?.["projections" + type.replace(/[^0-9]/, "")];
        }
        return { keys, local, global, attrs, projections };
    }

    queryCreate(client, req, callback)
    {
        const { keys, local, global, attrs, projections } = this.prepareCreate(req.query);

        // All native properties for options from the key columns
        Object.keys(attrs).forEach((x) => {
            attrs[x] = !req.query[x].join && lib.rxNumericType.test(req.query[x].type) ? "N" : "S";
            for (const p in req.query[x]._$dynamodb) {
                req.options[p] = req.query[x]._$dynamodb[p];
            }
        });
        req.options.keys = keys;
        req.options.local = local;
        req.options.global = global;
        req.options.projections = projections;
        var ctable = req.table.substr(0,1).toUpperCase() + req.table.substr(1);
        var cap = lib.split(this.config["capacity" + ctable], ",", { data_type: "int" });
        req.options.readCapacity = req.options.readCapacity || this.config["readCapacity" + ctable] || cap[0] || this.config.readCapacity;
        req.options.writeCapacity = req.options.writeCapacity || this.config["writeCapacity" + ctable] || cap[1] || cap[0] || this.config.writeCapacity;
        // Wait long enough for the table to be active
        if (typeof req.options.waitTimeout === "undefined") req.options.waitTimeout = 60000;

        var rc;
        lib.series([
            (next) => {
                aws.ddbCreateTable(req.table, attrs, req.options, (err, item) => {
                    rc = item;
                    // Create table columns for cases when describeTable never called or errored, for example Rate limit
                    // happened during the cacheColumns stage
                    if (item?.TableDescription && !this.dbindexes[req.table]) {
                        this._parseTable(req.table, { Table: item.TableDescription }, this);
                    }
                    next(err);
                });
            },
            (next) => {
                // Manage TTL column
                req.options.attribute = Object.keys(req.query).filter((x) => (req.query[x].type === "ttl")).pop();
                if (!req.options.attribute) return next();
                aws.ddbDescribeTimeToLive(req.table, req.options, (err, item) => {
                    if (err || item.TimeToLiveDescription.TimeToLiveStatus === "ENABLED") return next(err);
                    req.options.enabled = 1;
                    req.options.name = req.table;
                    aws.ddbUpdateTimeToLive(req.options, next);
                });
            },
        ], (err) => {
            callback(err, [], rc);
        }, true);
    }

    queryUpgrade(client, req, callback)
    {
        var global = {}, rc;
        var table = aws.ddbTable(req.table);
        var indexes = db.getIndexColumns(req.query);

        for (const type in indexes) {
            if (type[0] === "p") continue;
            const index = indexes[type].slice(0, 2);

            let name = index.join("_");
            if (name.length < 3) name = "i_" + name;

            if (this.dbindexes?.[table + "_" + name]) continue;

            const add = {}, cap = this.dbcapacity?.[table]?.[table] || lib.empty;

            index.forEach(x => {
                const ddb = req.query[x]._$dynamodb;
                if (ddb?.readCapacity) add.readCapacity = ddb.readCapacity;
                if (ddb?.writeCapacity) add.writeCapacity = ddb.writeCapacity;
                if (!add.readCapacity && cap.read) add.readCapacity = cap.read;
                if (!add.writeCapacity && cap.write) add.writeCapacity = cap.write;
                add[x] = !req.query[x].join && lib.rxNumericType.test(req.query[x].type) ? "N" : "S";
            });
            add.projection = req.query[index[0]]._$dynamodb?.["projections" + type.replace(/[^0-9]/, "")];

            global[name] = add;
        }

        lib.series([
            function(next) {
                if (!Object.keys(global).length) return next();
                req.options.name = table;
                req.options.add = global;
                aws.ddbUpdateTable(req.options, (err, item) => {
                    rc = item;
                    next(err);
                });
            },
            function(next) {
                // Manage TTL column
                req.options.attribute = Object.keys(req.query).filter((x) => (req.query[x].type === "ttl")).pop();
                if (!req.options.attribute) return next();
                aws.ddbDescribeTimeToLive(table, req.options, (err, item) => {
                    if (err || item.TimeToLiveDescription.TimeToLiveStatus === "ENABLED") return next(err);
                    req.options.enabled = 1;
                    req.options.name = table;
                    aws.ddbUpdateTimeToLive(req.options, next);
                });
            },
        ], (err) => {
            callback(err, [], rc);
        }, true);
    }

    queryDrop(_client, req, callback)
    {
        if (typeof req.options.waitTimeout === "undefined") req.options.waitTimeout = 60000;
        aws.ddbDeleteTable(req.table, req.options, (err, rc) => {
            callback(err, [], rc);
        });
    }

    queryGet(_client, req, callback)
    {
        var keys = db.getQueryForKeys(req.keys, req.query);
        if (!Object.keys(keys).length) return callback();
        aws.ddbGetItem(req.table, keys, req.options, (err, rc) => {
            if (!err && rc.ConsumedCapacity) rc.consumed_capacity = rc.ConsumedCapacity.CapacityUnits;
            callback(err, rc.Item ? [rc.Item] : [], rc);
        });
    }

    queryPrepareSelect(client, req, callback)
    {
        var dbkeys = req.keys;
        var dbindexes = this.dbindexes[req.table] || db.indexes[req.table] || lib.empty;

        // Sorting by the default range key is default
        if (req.options.sort && req.options.sort === dbkeys[1]) {
            req.options.sort = null;
        }
        if (req.options.sort && req.options.sort.length < 3) {
            req.options.sort = "i_" + req.options.sort;
        }

        // Use primary keys from the secondary index
        if (req.options.sort) {
            // Use index by name, mostly global indexes
            if (dbindexes[req.options.sort]) {
                dbkeys = dbindexes[req.options.sort];
            } else {
                // Local sorting order by range key
                for (const p in dbindexes) {
                    const idx = dbindexes[p];
                    if (idx && idx.length === 2 && (idx[0] === req.options.sort || idx[1] === req.options.sort)) {
                        req.options.sort = p;
                        dbkeys = dbindexes[p];
                        break;
                    }
                }
            }
        } else

        // Find a global index if any hash key for it provided, prefer index with hash and sort values
        if (!req.query[dbkeys[0]] && !req.options.fullscan) {
            let dbmax = 0;
            for (const p in dbindexes) {
                const idx = dbindexes[p];
                if (!idx || !req.query[idx[0]]) continue;
                const max = idx[1] && req.query[idx[1]] !== undefined ? 2 : 1;
                if (max < dbmax) continue;
                req.options.sort = p;
                dbkeys = dbindexes[p];
                dbmax = max;
            }
        }

        var query = db.getQueryForKeys(dbkeys, req.query);

        // Operation depends on the primary keys in the query, for Scan we can let the DB to do all the filtering
        var op = query[dbkeys[0]] !== undefined && !req.options.fullscan ? 'ddbQueryTable' : 'ddbScanTable';

        this.queryRunSelect(op, client, req, dbkeys, query, callback);
    }

    queryRunSelect(op, client, req, keys, query, callback)
    {
        // Capacity rate limiter
        var inFilter, inKey, inList, inListKey;

        // Scans explicitely disabled
        if (op === 'ddbScanTable' && req.options.noscan) {
            logger.info('select:', this.name, req.table, op, keys, 'QUERY:', query, "OPTS:", req.options, "NO EMPTY SCANS ENABLED");
            return callback(null, []);
        }

        var cap = req.options.capacity || db.getCapacity(req.table, { useCapacity: req.options.useCapacity || "read", factorCapacity: req.options.factorCapacity || 0.9 });

        req.options.ReturnConsumedCapacity = "TOTAL";
        if (!req.options.count) {
            req.options.count = this.config.selectSize;
        }

        logger.debug('select:', this.name, req.table, op, keys, 'QUERY:', query, "OPTS:", req.options, 'CAP:', cap.rateCapacity, cap.useCapacity);

        for (const p in req.options.ops) {
            // IN is not supported for key condition, move it into the query
            if (req.options.ops[p] === "in" && (p === keys[1] || p === req.keys[1])) {
                if (Array.isArray(query[p])) {
                    if (query[p].length === 1) {
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
            if (req.options.ops[p] === "in" && lib.isArray(query[p]) && (p === keys[0] || p === req.keys[0])) {
                if (query[p].length === 1) {
                    query[p] = query[p][0];
                    delete req.options.ops[p];
                } else {
                    op = 'ddbScanTable';
                }
            }
            // Noop for a hash key
            if (req.options.ops[p] && op === "ddbQueryTable" && (p === keys[0] || (!req.options.sort && p === req.keys[0]))) {
                req.options.ops[p] = '';
            }
            // Large IN lists, iterate, only one at a time
            if (req.options.ops[p] === "in" && lib.arrayLength(query[p]) > 100 && !inList) {
                inListKey = p;
                inList = query[p].slice(0);
                query[p] = inList.splice(0, 99);
            }
        }
        // Make sure we have valid start key
        if (req.options.start) {
            for (const key of keys) {
                if (!req.options.start[key]) {
                    req.options.start = undefined;
                    break;
                }
            }
        }

        req.options.keys = keys;

        var rows = [], info = { consumed_capacity: 0, total: 0, retry_count: 0 };
        // Keep retrieving items until we reach the end or our limit
        lib.doWhilst(
            function(next) {
                aws[op](req.table, query, req.options, (err, item) => {
                    if (req.options.total) {
                        if (!rows.length) {
                            rows.push({ count: 0 });
                        }
                        rows[0].count += item.Count;
                    } else {
                        if (inFilter) {
                            item.Items = item.Items.filter(x => (inFilter.includes(x[inKey])));
                        }
                        rows.push.apply(rows, item.Items);
                    }
                    if (item.retry_count) {
                        info.retry_count += item.retry_count;
                    }
                    client.next_token = item.LastEvaluatedKey ? aws.fromDynamoDB(item.LastEvaluatedKey) : null;
                    req.options.count -= item.Items.length;

                    // Deal with abrupt stops, no way to know but only to retry
                    if (!err && !item.Count && req.options.scanRetry > 0 && op === 'ddbScanTable') {
                        logger.info("ddbScanTable:", "retry:", req.options.start, cap);
                        req.options.scanRetry--;
                        client.next_token = req.options.start;
                        return db.checkCapacity(cap, next);
                    }

                    if (!err && item.ConsumedCapacity) {
                        info.consumed_capacity += item.ConsumedCapacity.CapacityUnits;
                        if (cap) {
                            return db.checkCapacity(cap, item.ConsumedCapacity.CapacityUnits, next);
                        }
                    }
                    next(err);
                });
            },

            function() {
                if (client.next_token === null || req.options.count <= 0) {
                    if (inList?.length) {
                        query[inListKey] = inList.splice(0, 99);
                        return true;
                    }
                    return false;
                }
                req.options.start = client.next_token;
                return true;
            }, (err) => {
                callback(err, rows, info);
            }, true);
    }

    queryList(_client, req, callback)
    {
        var info = { consumed_capacity: 0, retry_count: 0 }, rows = [];
        // Capacity rate limiter
        var cap = req.options.capacity || db.getCapacity(req.table, { useCapacity: req.options.useCapacity || "read", factorCapacity: req.options.factorCapacity });
        req.options.ReturnConsumedCapacity = "TOTAL";

        // Keep retrieving items until we reach the end or our limit
        var dbkeys = req.keys, chunks = [];
        var batchSize = req.config?.features?.batch || 100;
        for (let i = 0; i < req.query.length; i+= batchSize) {
            chunks.push(req.query.slice(i, i + batchSize).filter((x) => (dbkeys.every((y) => (x[y] !== "")))));
        }

        lib.forEachLimit(chunks, req.options.concurrency, (chunk, next) => {
            const batch = {
                [req.table]: {
                    keys: chunk,
                    select: db.getSelectedColumns(req),
                    consistent: req.options.consistent
                }
            };
            aws.ddbBatchGetItem(batch, req.options, (err, item) => {
                if (item.retry_count) info.retry_count += item.retry_count;
                if (err) return next(err);

                rows.push.apply(rows, item?.Responses[req.table] || lib.emptylist);

                // Keep retrieving items until we get all items from this batch
                var moreKeys = item.UnprocessedKeys || null;
                lib.whilst(
                    () => (moreKeys && Object.keys(moreKeys).length),

                    (next2) => {
                        const opts = lib.clone(req.options);
                        opts.RequestItems = moreKeys;
                        aws.ddbBatchGetItem({}, opts, (err, item) => {
                            if (item.retry_count) info.retry_count += item.retry_count;
                            if (err) return next2(err);
                            rows.push.apply(rows, item.Responses[req.table] || lib.emptylist);
                            moreKeys = item.UnprocessedKeys || null;
                            if (item.ConsumedCapacity) {
                                info.consumed_capacity += item.ConsumedCapacity.CapacityUnits;
                                if (cap) {
                                    return db.checkCapacity(cap, item.ConsumedCapacity.CapacityUnits, next2);
                                }
                            }
                            next2();
                        });
                    },
                    next, true);
            });
        },
        function(err) {
            callback(err, rows, info);
     }, true);
    }

    queryAdd(_client, req, callback)
    {
        req.options.query = req.keys.reduce((x,y) => { x[y] = null; return x }, {});
        if (req.options.useCapacity || req.options.capacity) req.options.ReturnConsumedCapacity = "TOTAL";
        aws.ddbPutItem(req.table, req.query, req.options, (err, rc) => {
            if (!rc) rc = {};
            if (!err) rc.affected_rows = 1;
            if (!err && rc.ConsumedCapacity) rc.consumed_capacity = rc.ConsumedCapacity.CapacityUnits;
            callback(err, rc.Item ? [rc.Item] : [], rc);
        });
    }

    queryPut(_client, req, callback)
    {
        if (req.options.useCapacity || req.options.capacity) req.options.ReturnConsumedCapacity = "TOTAL";
        aws.ddbPutItem(req.table, req.query, req.options, (err, rc) => {
            if (!rc) rc = {};
            if (!err) rc.affected_rows = 1;
            if (!err && rc.ConsumedCapacity) rc.consumed_capacity = rc.ConsumedCapacity.CapacityUnits;
            callback(err, rc.Item ? [rc.Item] : [], rc);
        });
    }

    queryUpdate(_client, req, callback)
    {
        var keys = db.getQueryForKeys(req.keys, req.query);
        if (req.op === "update" && !req.options.upsert) {
            if (req.options.query) {
                for (const p in keys) if (!req.options.query[p]) req.options.query[p] = keys[p];
            } else
            if (!req.options.Expected && !req.options.expr && !req.options.ConditionExpression) {
                req.options.query = keys;
            }
        }
        if (req.options.useCapacity || req.options.capacity) req.options.ReturnConsumedCapacity = "TOTAL";
        aws.ddbUpdateItem(req.table, keys, req.query, req.options, (err, rc) => {
            if (!rc) rc = {};
            if (!err) rc.affected_rows = 1;
            if (!err && rc.ConsumedCapacity) rc.consumed_capacity = rc.ConsumedCapacity.CapacityUnits;
            if (err && err.code === "ConditionalCheckFailedException") err = null;
            callback(err, rc.Item ? [rc.Item] : [], rc);
        });
    }

    queryDel(_client, req, callback)
    {
        var keys = db.getQueryForKeys(req.keys, req.query);
        if (req.options.useCapacity || req.options.capacity) req.options.ReturnConsumedCapacity = "TOTAL";
        if (req.options.query) {
            for (var p in keys) if (!req.options.query[p]) req.options.query[p] = keys[p];
        } else {
            if (!req.options.Expected && !req.options.expr && !req.options.ConditionExpression) req.options.query = keys;
        }
        aws.ddbDeleteItem(req.table, keys, req.options, (err, rc) => {
            if (!rc) rc = {};
            if (!err) rc.affected_rows = 1;
            if (!err && rc.ConsumedCapacity) rc.consumed_capacity = rc.ConsumedCapacity.CapacityUnits;
            if (err && err.code === "ConditionalCheckFailedException") err = null;
            callback(err, rc.Item ? [rc.Item] : [], rc);
        });
    }

    queryBulk(_client, req, callback)
    {
        var info = { consumed_capacity: 0, retry_count: 0, _size: req.query.length, _retries: 0 }, errors = [];
        var cap = req.options.capacity || db.getCapacity(req.table, { useCapacity: req.options.useCapacity || "write", factorCapacity: req.options.factorCapacity });
        var bulkSize = req.config?.features?.bulk || 50;
        var count = lib.toNumber(cap.writeCapacity || bulkSize, { min: 2, max: bulkSize });
        var breq, moreItems, objs = req.query;
        req.options.ReturnConsumedCapacity = "TOTAL";

        // Keep sending items until we reach the end or our limit
        lib.doWhilst(
            function(next) {
                breq = {};
                req.options.RequestItems = undefined;
                if (moreItems) {
                    req.options.RequestItems = moreItems;
                } else {
                    const list = objs.slice(0, count);
                    objs = objs.slice(count);
                    if (!list.length) return next();
                    for (var i in list) {
                        if (list[i].error) {
                            errors.push(list[i]);
                            continue;
                        }
                        switch (list[i].op) {
                        case "del":
                            list[i].query = db.getQueryForKeys(req.keys, list[i].obj);
                        case "put":
                            if (!breq[list[i].table]) breq[list[i].table] = [];
                            breq[list[i].table].push({ [list[i].op]: list[i].query });
                            break;
                        default:
                            list[i].error = "NotSupported";
                            errors.push(list[i]);
                        }
                    }
                }
                if (!Object.keys(breq).length) return next();

                aws.ddbBatchWriteItem(breq, req.options, (err, rc) => {
                    if (err) return callback(err, []);

                    var consumed = lib.toNumber(rc.ConsumedCapacity?.CapacityUnits);
                    info.consumed_capacity += consumed;
                    info._retries++;
                    if (rc.retry_count) info.retry_count += rc.retry_count;
                    moreItems = !lib.isEmpty(rc.UnprocessedKeys) ? rc.UnprocessedKeys : null;
                    if (!moreItems && !req.query.length) return next();
                    db.checkCapacity(cap, consumed, next);
                });
            },
            function() {
                return info._retries < info._size && (moreItems || objs.length > 0);
            },
            function(err) {
                if (!err) info.affected_rows = info._size - errors.length;
                req.options.RequestItems = undefined;
                callback(err, errors, info);
            }, true);
    }

    queryTransact(_client, req, callback)
    {
        var info = { consumed_capacity: 0, count: req.query.length };
        var cap = req.options.capacity || db.getCapacity(req.table, { useCapacity: req.options.useCapacity || "write", factorCapacity: req.options.factorCapacity });
        var count = lib.toNumber(cap.writeCapacity || req.config?.features?.bulk, { min: 2, max: req.config?.features?.bulk });
        var objs = req.query, list;
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
                        x.options.query = req.keys.reduce((x,y) => { x[y] = null; return x }, {});
                        break;
                    case "incr":
                    case "update":
                        x.keys = db.getQueryForKeys(x.keys, x.query);
                        if (x.op === "update" && !x.options.upsert) {
                            if (x.options.query) {
                                for (const p in x.keys) {
                                    if (!x.options.query[p]) x.options.query[p] = x.keys[p];
                                }
                            } else
                            if (!x.options.Expected && !x.options.expr && !x.options.ConditionExpression) {
                                x.options.query = x.keys;
                            }
                        }
                        break;
                    case "del":
                        x.query = db.getQueryForKeys(x.keys, x.query);
                        break;
                    }
                    x.columns = undefined;
                    x.orig = undefined;
                });
                aws.ddbTransactWriteItems(list, req.options, (err, rc) => {
                    if (err) {
                        if (err.code === "TransactionCanceledException") {
                            const d = err.message.match(/reasons \[([^\]])\]/);
                            if (d) {
                                rc = d[1].split(",").map((msg, i) => {
                                    if (!msg || msg === "None") return 0;
                                    list[i].error = msg.trim();
                                    return list[i];
                                }).filter(x => x);
                            }
                        }
                        return callback(err, rc);
                    }

                    var consumed = lib.toNumber(rc?.ConsumedCapacity?.CapacityUnits);
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
            }, true);
    }

    querySql(client, req, callback)
    {
        req.options.params = lib.isArray(req.values);
        aws.ddbExecuteStatement(req.text, req.options, (err, rc) => {
           if (!err) client.next_token = rc.NextToken;
           callback(err, lib.isArray(rc.Items, []), {});
       });
    }

}

exports.Pool = DynamoDBPool;

