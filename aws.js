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
    args: [ "key", "secret", "region", "keypair", "image", "instance", { name: "nometadata", type: "bool" }],
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
        var uri = 'https://dynamodb.' + this.region + '.amazonaws.com/';
        var version = '2012-08-10';
        var target = 'DynamoDB_' + version.replace(/\-/g,'') + '.' + action;
        var req = url.parse(uri);
        var json = JSON.stringify(obj);
        var headers = { 'content-type': 'application/x-amz-json-1.0; charset=utf-8',
                        'x-amz-target': target };
        this.querySign("dynamodb", req.hostname, "POST", req.path, json, headers);
        core.httpGet(uri, { method: "POST", postdata: json, headers: headers }, function(err, params) {
            if (err) return (callback ? callback(err) : null);
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
                return (callback ? callback(err) : null);
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

    ddbListTables: function(options, callback) {
        if (typeof options == "function") callback = options, options = {};
        if (!options) options = {};
        this.queryDDB('ListTables', options, callback);
    },

    ddbDescribeTable: function(name, callback) {
        var params = { TableName: name };
        this.queryDDB('DescribeTable', params, callback);
    },

    // Attributes can be an array in native DDB JSON format or an object with name:type properties
    // Keys can be an array in native DDB JSON format or an object with name:keytype properties
    // Indexes can be an array in native DDB JSON format or an object with each property as index name and
    // value as an object with property name for range attribute and value for projection type
    // Example: ddbCreateTable('test', {id:'S',mtime:'N',name:'S'}, {id:'HASH',mtime:'RANGE'}, {name:{name:'ALL'}}, {ReadCapacityUnits:1,WriteCapacityUnits:1});
    ddbCreateTable: function(name, attrs, keys, indexes, options, callback) {
        if (typeof options == "function") callback = options, options = {};
        if (!options) options = {};
        var params = { "TableName": name, "AttributeDefinitions": [], "KeySchema": [], "ProvisionedThroughput": {"ReadCapacityUnits": options.ReadCapacityUnits || 10, "WriteCapacityUnits": options.WriteCapacityUnits || 5 }};
        if (Array.isArray(attrs)) {
            params.AttributeDefinitions = attrs;
        } else {
            for (var p in attrs) {
                params.AttributeDefinitions.push({ AttributeName: p, AttributeType: String(attrs[p]).toUpperCase() })
            }
        }
        if (Array.isArray(keys)) {
            params.KeySchema = attrs;
        } else {
            for (var p in keys) {
                params.KeySchema.push({ AttributeName: p, KeyType: String(keys[p]).toUpperCase() })
            }
        }
        if (Array.isArray(indexes)) {
            params.LocalSecondaryIndexes = indexes;
        } else {
            for (var p in indexes) {
                var idx = indexes[p];
                for (var i in idx) {
                    if (!params.LocalSecondaryIndexes) params.LocalSecondaryIndexes = [];
                    var project = { ProjectionType: Array.isArray(idx[i]) ? "INLCUDE" : String(idx[i]).toUpperCase() };
                    if (project.ProjectionType == "INLCLUDE") project.NonKeyAttributes = idx[i];
                    params.LocalSecondaryIndexes.push({ IndexName: p, KeySchema: [ schema[0], { AttributeName: i, KeyType: "RANGE" }], Projection: project })
                }
            }
        }
        for (var p in options) {
            if (p[0] >= 'A' && p[0] <= 'Z') params[p] = options[p];
        }

        this.queryDDB('CreateTable', params, callback);
    },

    ddbDeleteTable: function(name, callback) {
        var params = { TableName: name };
        this.queryDDB('DeleteTable', params, callback);
    },

    ddbUpdateTable: function(name, rlimit, wlimit, callback) {
        var params = {"TableName": name, "ProvisionedThroughput": {"ReadCapacityUnits":rlimit,"WriteCapacityUnits":wlimit } };
        this.queryDDB('UpdateTable', params, callback);
    },

    // keys is an object with key attributes name and value,
    // options may contain any native property allowed in the request
    ddbGetItem: function(name, keys, options, callback) {
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
        this.queryDDB('GetItem', params, function(err, rc) {
            if (rc && rc.Item) rc.Item = self.fromDynamoDB(rc.Item);
            if (callback) callback(err, rc);
        });
    },

    // item is an object, type will be inferred from the native js type
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
        this.queryDDB('PutItem', params, function(err, rc) {
            if (rc && rc.Attributes) rc.Item = self.fromDynamoDB(rc.Attributes);
            if (callback) callback(err, rc);
        });
    },

    // item is an object with properties where value can be:
    //  - number/string/array - action PUT,
    //  - null - action DELETE
    //  - object in the form: { ADD: val } or { DELETE: val }
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
        this.queryDDB('UpdateItem', params, function(err, rc) {
            if (rc && rc.Attributes) rc.Item = self.fromDynamoDB(rc.Attributes);
            if (callback) callback(err, rc);
        });
    },

    // keys is an object with name: value for hash/range attributes
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
        this.queryDDB('DeleteItem', params, function(err, rc) {
            if (rc && rc.Attributes) rc.Item = self.fromDynamoDB(rc.Attributes);
            if (callback) callback(err, rc);
        });
    },

    // Format of items: { table: [ { PutRequest: { id: 1, name: "tt" } }, ] }
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
        this.queryDDB('BatchWriteItem', params, function(err, rc) {
            if (rc && rc.Attributes) rc.Item = self.fromDynamoDB(rc.Attributes);
            if (callback) callback(err, rc);
        });
    },

    // Format of items: { table: [ { Keys: { id: 1, name: "tt" }, AttributesToGet: ['name'], ConsistentRead: true }, ] }
    ddbBatchGetItem: function(items, options, callback) {
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
                for (var m in x) obj[m] = x[m];
                obj.Keys = self.toDynamoDB(obj.Keys);
                params.RequestItems[p].push(obj);
            });
        }
        this.queryDDB('BatchGetItem', params, function(err, rc) {
            if (rc && rc.Responses) rc.Responses = self.fromDynamoDB(rc.Responses);
            if (callback) callback(err, rc);
        });
    },

    // condition is an object with name: value for EQ condition or name: [op, value] for other conditions
    ddbQueryTable: function(name, condition, options, callback) {
        var self = this;
        if (typeof options == "function") callback = options, options = {};
        if (!options) options = {};
        var params = { TableName: name, KeyConditions: {} };
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
                params.KeyConditions[name] = op;
            }
        }
        this.queryDDB('Query', params, function(err, rc) {
            if (rc && rc.Items) rc.Items = self.fromDynamoDB(rc.Items);
            if (callback) callback(err, rc);
        });
    },

    // condition is an object like in Query action
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
        this.queryDDB('Scan', params, function(err, rc) {
            if (rc && rc.Items) rc.Items = self.fromDynamoDB(rc.Items);
            if (callback) callback(err, rc);
        });
    },

}

module.exports = aws;
core.addContext('aws', aws);
