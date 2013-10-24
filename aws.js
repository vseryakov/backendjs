//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Feb 2012
//

var util = require('util');
var http = require('http');
var url = require('url');
var fs = require('fs');
var os = require('os');
var cluster = require('cluster');
var logger = require(__dirname + '/logger');
var core = require(__dirname + '/core');
var printf = require('printf');
var async = require('async');
var cheerio = require('cheerio');
var xml2json = require('xml2json');

var aws = {
    name: 'aws',
    args: [ "key", "secret", "region", "keypair", "image", "instance", "dynamodb-host", { name: "nometadata", type: "bool" }],
    region: 'us-east-1',
    instance: "t1.micro",

    // Initialization to be run inside core.init in master mode only
    initModule: function(next) {
        if (!this.nometadata) this.getInstanceInfo(next); else next();
    },

    // Make AWS request, return parsed response as Javascript object or null in case of error
    queryAWS: function(proto, method, host, path, obj, callback) {
        var curTime = new Date();
        var formattedTime = core.strftime(curTime, "%Y-%m-%dT%H:%M:%SZ", true);
        var sigValues = new Array();
        sigValues.push(["AWSAccessKeyId", this.key]);
        sigValues.push(["SignatureMethod", "HmacSHA256"]);
        sigValues.push(new Array("SignatureVersion", "2"));
        sigValues.push(["Timestamp", formattedTime]);

        // Mix in the additional parameters. params must be an Array of tuples as for sigValues above
        for (var p in obj) {
            sigValues.push([p, obj[p]]);
        }
        var strSign = "", query = "", postdata = "";

        function encode(str) {
            str = encodeURIComponent(str);
            var efunc = function(m) { return m == '!' ? '%21' : m == "'" ? '%27' : m == '(' ? '%28' : m == ')' ? '%29' : m == '*' ? '%2A' : m; }
            return str.replace(/[!'()*~]/g, efunc);
        }

        sigValues.sort();
        strSign = method + "\n" + host + "\n" + path + "\n";
        for (var i = 0; i < sigValues.length; i++) {
            var item = (i ? "&" : "") + sigValues[i][0] + "=" + encode(sigValues[i][1]);
            strSign += item;
            query += item;
        }
        query += "&Signature=" + encodeURIComponent(core.sign(this.secret, strSign, 'sha256'));
        if (method == "POST") postdata = query, query = "";

        core.httpGet(proto + host + path + '?' + query, { method: method, postdata: postdata }, function(err, params) {
            if (err || !params.data) return callback ? callback(err) : null;
            var obj = null;
            try { obj = xml2json.toJson(params.data, { object: true }); } catch(e) { err = e }
            if (logger.level || params.status != 200) logger.log('queryAWS:', query, util.inspect(obj, true, null));
            if (callback) callback(err, obj);
        });
    },

    // AWS EC2 API parameters
    queryEC2: function(action, obj, callback) {
        var req = { Action: action, Version: '2012-12-01' };
        for (var p in obj) req[p] = obj[p];
        this.queryAWS('http://', 'POST', 'ec2.' + this.region + '.amazonaws.com', '/', req, callback);
    },

    // Build version 4 signature headers
    querySign: function(service, host, method, path, body, headers) {
        var now = new Date();
        var date = now.toISOString().replace(/[:\-]|\.\d{3}/g, '');
        var datetime = date.substr(0, 8);

        headers['Host'] = host;
        headers['X-Amz-Date'] = date;
        if (body && !headers['content-type']) headers['content-type'] = 'application/x-www-form-urlencoded; charset=utf-8';
        if (body && !headers['content-length']) headers['content-length'] = body.length;

        function trimAll(header) { return header.toString().trim().replace(/\s+/g, ' '); }
        var credString = [ datetime, this.region, service, 'aws4_request' ].join('/');
        var pathParts = path.split('?', 2);
        var signedHeaders = Object.keys(headers).map(function(key) { return key.toLowerCase(); }).sort().join(';');
        var canonHeaders = Object.keys(headers).sort(function(a, b) { return a.toLowerCase() < b.toLowerCase() ? -1 : 1; }).map(function(key) { return key.toLowerCase() + ':' + trimAll(String(headers[key])); }).join('\n');
        var canonString = [ method, pathParts[0] || '/', pathParts[1] || '', canonHeaders + '\n', signedHeaders, core.hash(body || '', "sha256", "hex")].join('\n');

        var strToSign = [ 'AWS4-HMAC-SHA256', date, credString, core.hash(canonString, "sha256", "hex") ].join('\n');
        var kDate = core.sign('AWS4' + this.secret, datetime, "sha256", "binary");
        var kRegion = core.sign(kDate, this.region, "sha256", "binary");
        var kService = core.sign(kRegion, service, "sha256", "binary");
        var kCredentials = core.sign(kService, 'aws4_request', "sha256", "binary");
        var sig = core.sign(kCredentials, strToSign, "sha256", "hex");
        headers['Authorization'] = [ 'AWS4-HMAC-SHA256 Credential=' + this.key + '/' + credString, 'SignedHeaders=' + signedHeaders, 'Signature=' + sig ].join(', ');
    },

    // DynamoDB requests
    queryDDB: function (action, obj, options, callback) {
        if (typeof options == "function") callback = options, options = {};
        var start = core.mnow();
        var uri = options.db || ('https://dynamodb.' + this.region + '.amazonaws.com/');
        var version = '2012-08-10';
        var target = 'DynamoDB_' + version.replace(/\-/g,'') + '.' + action;
        var req = url.parse(uri);
        var json = JSON.stringify(obj);
        var headers = { 'content-type': 'application/x-amz-json-1.0; charset=utf-8', 'x-amz-target': target };
        logger.debug('queryDDB:', uri, 'action:', action, 'obj:', obj, 'options:', options);
        
        this.querySign("dynamodb", req.hostname, "POST", req.path, json, headers);
        core.httpGet(uri, { method: "POST", postdata: json, headers: headers }, function(err, params) {
            if (err) return callback ? callback(err, {}) : null;
            // Reply is always JSON but we dont take any chances
            try { params.json = JSON.parse(params.data); } catch(e) { err = e; params.status += 1000; }
            if (params.status != 200) {
                logger.error('queryDDB:', action, util.inspect(obj, null, null), err || params.data);
                // Try several times
                if (options.retries > 0 && (params.status == 500 || params.data.match(/(ProvisionedThroughputExceededException|ThrottlingException|ThrottlingException)/))) {
                    options.retries--;
                    return setTimeout(function() { self.queryDDB(action, obj, options, callback); }, options.timeout);
                }
                // Report about the error
                if (!err) err = new Error(params.json.__type + ": " + (params.json.message || params.json.Message));
                return callback ? callback(err, {}) : null;
            }
            logger.log('queryDDB:', action, core.mnow() - start, 'ms', params.json.Item ? 1 : (params.json.Count || 0), 'rows', util.inspect(obj, null, null));
            if (callback) callback(err, params.json);
        });
    },

    // Run AWS instances with given arguments in user-data
    runInstances: function(count, args, callback) {
        var self = this;

        if (!this.image) return callback ? callback(new Error("no imageId configured"), obj) : null;
        
        var req = { MinCount: count,
                    MaxCount: count,
                    ImageId: this.image,
                    InstanceType: this.instance,
                    KeyName: this.keypair,
                    InstanceInitiatedShutdownBehavior: "terminate",
                    UserData: new Buffer(args).toString("base64") };

        logger.log('runInstances:', this.name, 'count:', count, 'ami:', this.image, 'key:', this.keypair, 'args:', args);
        this.queryEC2("RunInstances", req, function(err, obj) {
            logger.elog(err, 'runInstances:', self.name, util.inspect(obj, true, null));
            // Update tag name with current job
            if (obj && obj.RunInstancesResponse && obj.RunInstancesResponse.instancesSet) {
                var item = obj.RunInstancesResponse.instancesSet.item;
                if (!Array.isArray(item)) item = [ item ];
                var d = args.match(/\-jobname ([^ ]+)/i);
                // Update tags with delay to allow instances appear in the system
                if (d) setTimeout(function() {
                    item.forEach(function(x) { self.queryEC2("CreateTags", { "ResourceId.1": x.instanceId, "Tag.1.Key": 'Name', "Tag.1.Value": d[1] }); });
                }, 15000);
            }
            if (callback) callback(err, obj);
        });
    },

    // Retrieve instance meta data
    getInstanceMeta: function(path, callback) {
        core.httpGet("http://169.254.169.254" + path, { httpTimeout: 100, quiet: true }, function(err, params) {
            logger.debug('getInstanceMeta:', path, params.data, err || "");
            if (callback) callback(err, params.data);
        });
    },

    // Retrieve instance launch index from the meata data if running on AWS instance
    getInstanceInfo: function(callback) {
        var self = this;

        self.getInstanceMeta("/latest/meta-data/ami-launch-index", function(err, idx) {
            if (!err && idx) core.instanceIndex = core.toNumber(idx);
            self.getInstanceMeta("/latest/meta-data/instance-id", function(err2, id) {
                if (!err2 && id) core.instanceId = id;
                logger.log('getInstanceInfo:', self.name, 'id:', core.instanceId, 'index:', core.instanceIndex, '/', idx, err || err2 || "");
                if (callback) callback();
            });
        });
    },

    toDynamoDB: function(value, level) {
        switch (core.typeName(value)) {
        case 'number':
            return { "N": value.toString() };

        case 'buffer':
            return { "B": value.toString("base64") };

        case 'array':
            var obj = {}, arr = [], type = '';
            for (var i = 0; i < value.length; ++i) {
                if (!value[i] && typeof value[i] != 'number') continue;
                if (Array.isArray(value[i]) && !value[i].length) continue;
                arr[i] = String(value[i]);
                if (!type) type = core.typeName(value[i]);
            }
            obj[type == "number" ? "NS": type == "buffer" ? "BS" : "SS"] = arr;
            return obj;

        case "date":
            return { "N": Math.round(value.getTime()/1000) };
            
        case 'object':
            if (level) return { "S" : JSON.stringify(value) };
            var obj = {};
            for (var i in value) {
                if (!value[i] && typeof value[i] != 'number') continue;
                if (Array.isArray(value[i]) && !value[i].length) continue;
                obj[i] = this.toDynamoDB(value[i], level || 1);
            }
            return obj;
            
        default:
            return { "S": String(value) };
        }
    },

    fromDynamoDB: function(value) {
        var self = this;
        switch (core.typeName(value)) {
        case 'array':
            return value.map(function(x) { return self.fromDynamoDB(x) });

        case 'object':
            var res = {};
            for (var i in value) {
                if (value.hasOwnProperty(i)) {
                    if (value[i]['S'])
                        res[i] = value[i]['S'];
                    else
                    if (value[i]['SS'])
                        res[i] = value[i]['SS'];
                    else
                    if (value[i]['B'])
                        res[i] = new Buffer(value[i]['B'], "base64");
                    else
                    if (value[i]['BS']) {
                        res[i] = [];
                        for (var j = 0; j < value[i]['BS'].length; j ++) {
                            res[i][j] = new Buffer(value[i]['BS'][j], "base64");
                        }
                    } else
                    if (value[i]['N'])
                        res[i] = parseFloat(value[i]['N']);
                    else
                    if (value[i]['NS']) {
                        res[i] = [];
                        for (var j = 0; j < value[i]['NS'].length; j ++) {
                            res[i][j] = parseFloat(value[i]['NS'][j]);
                        }
                    }
                }
            }
            return res;

        default:
            return value;
        }
    },

    // Return list of tables in .TableNames property of the result
    // Example: { TableNames: [ name, ...] }
    ddbListTables: function(options, callback) {
        if (typeof options == "function") callback = options, options = {};
        if (!options) options = {};
        this.queryDDB('ListTables', {}, options, callback);
    },

    // Return table definition and parameters in the result structure with property of the given table name
    // Example: { name: { AttributeDefinitions: [], KeySchema: [] ...} }
    ddbDescribeTable: function(name, options, callback) {
        var params = { TableName: name };
        this.queryDDB('DescribeTable', params, options, function(err, rc) {
            logger.debug('DescribeTable:', name, util.inspect(rc, null, null));
            if (callback) callback(err, rc);
        });
    },

    // Create a table
    // - attrs can be an array in native DDB JSON format or an object with name:type properties, type is one of S, N, NN, NS, BS
    // - keys can be an array in native DDB JSON format or an object with name:keytype properties, keytype is one of HASH or RANGE
    // - indexes can be an array in native DDB JSON format or an object with each property for an index name and
    //   value in the same format as for primary keys, additional property _projection defines projection type for an index.
    // - options may contain any valid native property if it starts with capital letter.
    // Example: ddbCreateTable('users', {id:'S',mtime:'N',name:'S'}, {id:'HASH',name:'RANGE'}, {mtime:{mtime:"HASH",_projection:"ALL"}}, {ReadCapacityUnits:1,WriteCapacityUnits:1});
    ddbCreateTable: function(name, attrs, keys, indexes, options, callback) {
        if (typeof options == "function") callback = options, options = {};
        if (!options) options = {};
        var params = { "TableName": name, "AttributeDefinitions": [], "KeySchema": [], "ProvisionedThroughput": {"ReadCapacityUnits": options.ReadCapacityUnits || 10, "WriteCapacityUnits": options.WriteCapacityUnits || 5 }};
        
        if (Array.isArray(attrs) && attrs.length) {
            params.AttributeDefinitions = attrs;
        } else {
            for (var p in attrs) {
                params.AttributeDefinitions.push({ AttributeName: p, AttributeType: String(attrs[p]).toUpperCase() })
            }
        }
        if (Array.isArray(keys) && keys.length) {
            params.KeySchema = attrs;
        } else {
            for (var p in keys) {
                params.KeySchema.push({ AttributeName: p, KeyType: String(keys[p]).toUpperCase() })
            }
        }
        if (Array.isArray(indexes) && indexes.length) {
            params.LocalSecondaryIndexes = indexes;
        } else {
            for (var n in indexes) {
                var idx = indexes[n];
                var index = { IndexName: n, KeySchema: [] };
                for (var p in idx) {
                    index.KeySchema.push({ AttributeName: p, KeyType: String(idx[p]).toUpperCase() })
                }
                if (idx._projection) {
                    index.Projection = { ProjectionType: Array.isArray(idx._projection) ? "INLCUDE" : String(idx._projection).toUpperCase() };
                    if (index.Projection.ProjectionType == "INLCLUDE") index.Projection.NonKeyAttributes = idx._projection;
                } else {
                    index.Projection = { ProjectionType: "KEYS_ONLY" };
                }
                if (!params.LocalSecondaryIndexes) params.LocalSecondaryIndexes = [];
                params.LocalSecondaryIndexes.push(index);
            }
        }
        for (var p in options) {
            if (p[0] >= 'A' && p[0] <= 'Z') params[p] = options[p];
        }

        this.queryDDB('CreateTable', params, options, callback);
    },

    ddbDeleteTable: function(name, options, callback) {
        var params = { TableName: name };
        this.queryDDB('DeleteTable', params, options, callback);
    },

    ddbUpdateTable: function(name, rlimit, wlimit, options, callback) {
        var params = {"TableName": name, "ProvisionedThroughput": {"ReadCapacityUnits":rlimit,"WriteCapacityUnits":wlimit } };
        this.queryDDB('UpdateTable', params, options, callback);
    },

    // Retrieve one item by primary key
    // - keys - an object with primary key attributes name and value.
    // - select - list of columns to return, otherwise all columns will be returned
    // - options may contain any native property allowed in the request or special properties:
    //   - consistent - set consistency level for the request
    // Example: ddbGetItem("users", { id: 1, name: "john" }, { select: 'id,name' })
    ddbGetItem: function(name, keys, options, callback) {
        var self = this;
        if (typeof options == "function") callback = options, options = {};
        if (!options) options = {};
        var params = { TableName: name, Key: {} };
        for (var p in options) {
            if (p[0] >= 'A' && p[0] <= 'Z') params[p] = options[p];
        }
        if (options.select) {
            params.AttributesToGet = core.strSplit(options.select);
        }
        if (options.consistent) {
            params.ConsistentRead = true;
        }
        for (var p in keys) {
            params.Key[p] = self.toDynamoDB(keys[p]);
        }
        this.queryDDB('GetItem', params, options, function(err, rc) {
            rc.Item = rc.Item ? self.fromDynamoDB(rc.Item) : {};
            if (callback) callback(err, rc);
        });
    },

    // Put or add an item
    // - item is an object, type will be inferred from the native js type.
    // - options may contain any valid native property if it starts with capital letter or special properties:
    //   - expected - an object with column names to be used in Expected clause and value as null to set condition to { Exists: false } or 
    //     any other exact value to be checked against which corresponds to { Exists: true, Value: value }
    // Example: ddbPutItem("users", { id: 1, name: "john", mtime: 11233434 }, { expected: { name: null } })
    ddbPutItem: function(name, item, options, callback) {
        var self = this;
        if (typeof options == "function") callback = options, options = {};
        if (!options) options = {};
        var params = { TableName: name, Item: self.toDynamoDB(item) };
        for (var p in options) {
            if (p[0] >= 'A' && p[0] <= 'Z') params[p] = options[p];
        }
        // Sugar-candy syntax for expected values
        for (var p in options.expected) {
            if (!params.Expected) params.Expected = {};
            if (options.expected[p] == null) {
                params.Expected[p] = { Exists: false };
            } else {
                params.Expected[p] = { Value: self.toDynamoDB(options.expected[p]) };
            }
        }
        this.queryDDB('PutItem', params, options, function(err, rc) {
            rc.Item = rc.Attributes ? self.fromDynamoDB(rc.Attributes) : {};
            if (callback) callback(err, rc);
        });
    },

    // Update an item
    // - keys is an object with primary key attributes name and value.
    // - item is an object with properties where value can be:
    //    - number/string/array - implies PUT action,
    //    - null - action DELETE
    //    - object in the form: { ADD: val } or { DELETE: val }
    // - options may contain any valid native property if it starts with capital letter or special properties:
    //   - expected - an object with column names to be used in Expected clause and value as null to set condition to { Exists: false } or 
    //     any other exact value to be checked against which corresponds to { Exists: true, Value: value }
    // Example: ddbUpdateItem("users", { id: 1, name: "john" }, { gender: 'male' }, { expected: { id: 1 } })
    ddbUpdateItem: function(name, keys, item, options, callback) {
        var self = this;
        if (typeof options == "function") callback = options, options = {};
        if (!options) options = {};
        var params = { TableName: name, Key: {}, AttributeUpdates: {} };
        for (var p in options) {
            if (p[0] >= 'A' && p[0] <= 'Z') params[p] = options[p];
        }
        for (var p in keys) {
            params.Key[p] = self.toDynamoDB(keys[p]);
        }
        // Sugar-candy syntax for expected values
        for (var p in options.expected) {
            if (!params.Expected) params.Expected = {};
            if (options.expected[p] == null) {
                params.Expected[p] = { Exists: false };
            } else {
                params.Expected[p] = { Value: self.toDynamoDB(options.expected[p]) };
            }
        }
        for (var p in item) {
            if (params.Key[p]) continue;
            switch (core.typeName(item[p])) {
                case 'null':
                case 'undefined':
                    params.AttributeUpdates[p] = { Action: 'DELETE' };
                    break;
                case 'array':
                    if (!item[p].length) {
                        params.AttributeUpdates[p] = { Action: 'DELETE' };
                        break;
                    }
                case 'string':
                case 'number':
                    params.AttributeUpdates[p] = { Action: 'PUT', Value: self.toDynamoDB(item[p]) };
                    break;
                case 'object':
                    if (item[p].ADD) { 
                        params.AttributeUpdates[p] = { Action: 'ADD', Value: self.toDynamoDB(item[p]) };
                    } else
                    if (item[p].DELETE) { 
                        params.AttributeUpdates[p] = { Action: 'DELETE' };
                        if (item[p] !== null) params.AttributeUpdates[p].Value = self.toDynamoDB(item[p]); 
                    }
                    break;
            }
        }
        this.queryDDB('UpdateItem', params, options, function(err, rc) {
            rc.Item = rc.Attributes ? self.fromDynamoDB(rc.Attributes) : {};
            if (callback) callback(err, rc);
        });
    },

    // Delete an item from a table
    // - keys is an object with name: value for hash/range attributes
    // - options may contain any valid native property if it starts with capital letter.
    // Example: ddbDeleteItem("users", { id: 1, name: "john" }, {})
    ddbDeleteItem: function(name, keys, options, callback) {
        var self = this;
        if (typeof options == "function") callback = options, options = {};
        if (!options) options = {};
        var params = { TableName: name, Key: {} };
        for (var p in options) {
            if (p[0] >= 'A' && p[0] <= 'Z') params[p] = options[p];
        }
        for (var p in keys) {
            params.Key[p] = self.toDynamoDB(keys[p]);
        }
        this.queryDDB('DeleteItem', params, options, function(err, rc) {
            rc.Item = rc.Attributes ? self.fromDynamoDB(rc.Attributes) : {};
            if (callback) callback(err, rc);
        });
    },

    // Update items from the list at the same time
    // - items is a list of objects with table name as property and list of operations, an operation can be PutRequest or DeleteRequest
    // - options may contain any valid native property if it starts with capital letter.
    // Example: { table: [ { PutRequest: { id: 1, name: "tt" } }, ] }
    ddbBatchWriteItem: function(items, options, callback) {
        var self = this;
        if (typeof options == "function") callback = options, options = {};
        if (!options) options = {};
        var params = { RequestItems: {} };
        for (var p in options) {
            if (p[0] >= 'A' && p[0] <= 'Z') params[p] = options[p];
        }
        for (var p in items) {
            params.RequestItems[p] = [];
            items[p].forEach(function(x) {
                var obj = {};
                for (var m in x) {
                    obj[m] = { Item: self.toDynamoDB(x[m]) };
                }
                params.RequestItems[p].push(obj);
            });
        }
        this.queryDDB('BatchWriteItem', params, options, function(err, rc) {
            rc.Item = rc.Attributes ? self.fromDynamoDB(rc.Attributes) : {};
            if (callback) callback(err, rc);
        });
    },

    // Retrieve all items for given list of keys
    // - items is list of objects with table name as property name and list of options for GetItem request
    // - options may contain any valid native property if it starts with capital letter.
    // Example: { users: [ { keys: { id: 1, name: "john" }, select: ['name','id'], consistent: true }, ...] }
    ddbBatchGetItem: function(items, options, callback) {
        var self = this;
        if (typeof options == "function") callback = options, options = {};
        if (!options) options = {};
        var params = { RequestItems: {} };
        for (var p in options) {
            if (p[0] >= 'A' && p[0] <= 'Z') params[p] = options[p];
        }
        for (var p in items) {
            if (!params.RequestItems[p]) params.RequestItems[p] = [];
            items[p].forEach(function(x) {
                var obj = {};
                obj.Keys = self.toDynamoDB(obj.keys);
                if (x.select) obj.AttributesToGet = core.strSplit(x.select);
                if (x.consistent) obj.ConsistentRead = true;
                params.RequestItems[p].push(obj);
            });
        }
        this.queryDDB('BatchGetItem', params, options, function(err, rc) {
            rc.Responses = rc.Responses ? self.fromDynamoDB(rc.Responses) : [];
            if (callback) callback(err, rc);
        });
    },

    // Query on a table, return all matching items
    // - keys is an object with name: value pairs for key condition
    // - options may contain any valid native property if it starts with capital letter or special property:
    //   - start or page - defines starting primary key when paginating
    //   - consistent - set consistency level for the request
    //   - select - list of attributes to get only
    //   - total - return number of matching records
    //   - count - limit number of record in result
    //   - desc - descending order
    //   - sort - index name to use, indexes are named the same as the corresponding column
    // Example: ddbQueryTable("users", { id: 1, name: "john" }, { select: 'id,name' })
    ddbQueryTable: function(name, keys, options, callback) {
        var self = this;
        if (typeof options == "function") callback = options, options = {};
        if (!options) options = {};
        var params = { TableName: name, KeyConditions: {} };
        for (var p in options) {
            if (p[0] >= 'A' && p[0] <= 'Z') params[p] = options[p];
        }
        if (options.consistent) {
            params.ConsistentRead = true;
        }
        if (options.start || options.page) {
            params.ExclusiveStartKey = self.toDynamoDB(options.start || options.page);
        }
        if (options.sort) {
            params.IndexName = options.sort;
        }
        if (options.desc) {
            params.ScanIndexForward = false;
        }
        if (options.select) {
            params.AttributesToGet = core.strSplit(options.select);
        }
        if (options.count) {
            params.Limit = options.count;
        }
        if (options.total) {
            params.Select = "COUNT";
        }
        if (condition) {
            for (var name in condition) {
                var args = condition[name];
                if (!Array.isArray(args) || args.length < 2) args = [ 'eq', args ];
                var op = { AttributeValueList: [], ComparisonOperator: args[0].toUpperCase() }
                switch (args[0].toLowerCase()) {
                case 'between':
                    if (args.length < 3) continue;
                    op.AttributeValueList.push(self.toDynamoDB(args[1]));
                    op.AttributeValueList.push(self.toDynamoDB(args[2]));
                    break;

                case 'eq':
                case 'le':
                case 'lt':
                case 'ge':
                case 'gt':
                case 'begins_with':
                    op.AttributeValueList.push(self.toDynamoDB(args[1]));
                    break;
                }
                params.KeyConditions[name] = op;
            }
        }
        this.queryDDB('Query', params, options, function(err, rc) {
            rc.Items = rc.Items ? self.fromDynamoDB(rc.Items) : [];
            if (callback) callback(err, rc);
        });
    },

    // Scan a table for all matching items
    // - condition is an object with name: value pairs for EQ condition or name: [op, value] for other conditions
    // - options may contain any valid native property if it starts with capital letter or special property:
    //   - start - defines starting primary key
    // Example: ddbScanTable("users", { id: 1, name: ['gt', 'a'] }, {})
    ddbScanTable: function(name, condition, options, callback) {
        var self = this;
        if (typeof options == "function") callback = options, options = {};
        if (!options) options = {};
        var params = { TableName: name, ScanFilter: {} };
        for (var p in options) {
            if (p[0] >= 'A' && p[0] <= 'Z') params[p] = options[p];
        }
        if (options.start) {
            params.ExclusiveStartKey = self.toDynamoDB(options.start);
        }
        if (condition) {
            for (var name in condition) {
                var args = condition[name];
                if (!Array.isArray(args) || args.length < 2) args = [ 'eq', args ];
                var op = { AttributeValueList: [], ComparisonOperator: args[0].toUpperCase() }
                switch (args[0].toLowerCase()) {
                case 'between':
                    if (args.length < 3) continue;
                    op.AttributeValueList.push(self.toDynamoDB(args[1]));
                    op.AttributeValueList.push(self.toDynamoDB(args[2]));
                    break;

                case 'eq':
                case 'le':
                case 'lt':
                case 'ge':
                case 'gt':
                case 'begins_with':
                    op.AttributeValueList.push(self.toDynamoDB(args[1]));
                    break;
                }
                params.ScanFilter[name] = op;
            }
        }
        this.queryDDB('Scan', params, options, function(err, rc) {
            rc.Items = rc.Items ? self.fromDynamoDB(rc.Items) : [];
            if (callback) callback(err, rc);
        });
    },

}

module.exports = aws;
core.addContext('aws', aws);
