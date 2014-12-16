//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Feb 2012
//

var util = require('util');
var http = require('http');
var url = require('url');
var qs = require('qs');
var fs = require('fs');
var os = require('os');
var mime = require('mime');
var cluster = require('cluster');
var logger = require(__dirname + '/logger');
var core = require(__dirname + '/core');
var utils = require(__dirname + '/build/Release/backend');
var xml2json = require('xml2json');

var aws = {
    name: 'aws',
    args: [ { name: "key", descr: "AWS access key" },
            { name: "secret", descr: "AWS access secret" },
            { name: "region", descr: "AWS region" },
            { name: "sdk-profile", descr: "AWS SDK profile to use when reading credentials file" },
            { name: "ddb-read-capacity", type: "int", min: 1, descr: "Default DynamoDB read capacity for all tables" },
            { name: "ddb-write-capacity", type: "int", min: 1, descr: "Default DynamoDB write capacity for all tables" },
            { name: "sns-app-arn", descr: "SNS Platform application ARN to be used for push notifications" },
            { name: "key-name", descr: "AWS instance keypair name for remote job instances" },
            { name: "elb-name", descr: "AWS ELB name to be registered with on start up" },
            { name: "iam-profile", descr: "IAM instance profile name" },
            { name: "image-id", descr: "AWS image id to be used for instances" },
            { name: "subnet-id", descr: "AWS subnet id to be used for instances" },
            { name: "group-id", array: 1, descr: "AWS security group(s) to be used for instances" },
            { name: "instance-type", descr: "AWS instance type for remote jobs launched on demand" },
    ],
    key: process.env.AWS_ACCESS_KEY_ID,
    secret: process.env.AWS_SECRET_ACCESS_KEY,
    instanceType: "t1.micro",
    tokenExpiration: 0,
    amiProfile: "",
    tags: [],

    // Translation map for operators
    opsMap: { 'like%': 'begins_with', '=': 'eq', '<=': 'le', '<': 'lt', '>=': 'ge', '>': 'gt' },
}

module.exports = aws;

// Initialization of metadata
aws.configure = function(options, callback)
{
    var self = this;
    // Do not retrieve metadata if not running inside important process
    if (os.platform() != "linux" || options.noInit || ["shell","web","master","worker"].indexOf(core.role) == -1) {
        if (!self.key) return self.readCredentials(self.sdkProfile, callback);
        return callback();
    }
    this.getInstanceInfo(function() {
        if (!self.key) return self.readCredentials(self.sdkProfile, callback);
        callback();
    });
}

// Execute on Web server startup
aws.configureServer = function(options, callback)
{
    var self = this;

    // Make sure we are running on EC2 instance
    if (!core.instance.id || !core.instance.image) return callback();
    core.series([
       function(next) {
           if (core.instance.tag) return next();
           self.ec2CreateTags(core.instance.id, core.runMode + "-" + core.appName + "-" + core.appVersion, function() { next() });
       },
       function(next) {
           if (!self.elbName) return next();
           self.elbRegisterInstances(self.elbName, core.instance.id, options, function() { next() });
       },
       ], callback);
}

// Read key and secret from the AWS SDK credentials file
aws.readCredentials = function(profile, callback)
{
    var self = this;
    if (typeof profile == "function") callback = profile, profile = null;
    fs.readFile(process.env.HOME + "/.aws/credentials", function(err, data) {
        if (data.length) {
            var state = 0, lines = data.toString().split("\n");
            for (var i = 0; i < lines.length; i++) {
                var x = lines[i].split("=");
                if (state == 0) {
                    if (x[0][0] == '[' && (!profile || profile == x[0].substr(1, x[0].length - 2))) state = 1;
                } else

                if (state == 1) {
                    if (x[0][0] == '[') break;
                    if (x[0].trim() == "aws_access_key_id" && x[1]) self.key = x[1].trim();
                    if (x[0].trim() == "aws_secret_access_key" && x[1]) self.secret = x[1].trim();
                    if (x[0].trim() == "region" && x[1]) self.region = x[1].trim();
                }
            }
            logger.debug('readCredentials:', self.key, self.secret);
        }
        callback();
    });
}

// Make AWS request, return parsed response as Javascript object or null in case of error
aws.queryAWS = function(proto, method, host, path, obj, callback)
{
    var self = this;

    var sigValues = [];
    var curTime = new Date();
    var formattedTime = curTime.toISOString().replace(/\.[0-9]+Z$/, 'Z');
    sigValues.push(["AWSAccessKeyId", this.key]);
    sigValues.push(["SignatureMethod", "HmacSHA256"]);
    sigValues.push(["SignatureVersion", "2"]);
    sigValues.push(["Timestamp", formattedTime]);
    if (this.securityToken) sigValues.push(["SecurityToken", this.securityToken]);

    // Mix in the primary request parameters
    for (var p in obj) {
        if (typeof obj[p] != "undefined") sigValues.push([p, obj[p]]);
    }
    var strSign = "", query = "", postdata = "";

    function encode(str) {
        str = encodeURIComponent(str);
        var efunc = function(m) { return m == '!' ? '%21' : m == "'" ? '%27' : m == '(' ? '%28' : m == ')' ? '%29' : m == '*' ? '%2A' : m; }
        return str.replace(/[!'()*]/g, efunc);
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
        try { params.obj = xml2json.toJson(params.data, { object: true }); } catch(e) { err = e; params.status += 1000 };
        if (params.status != 200) {
            var errors = core.objGet(params.obj, "Response.Errors.Error", { list: 1 });
            if (errors.length && errors[0].Message) err = core.newError({ message: errors[0].Message, name: obj.Action || "AWS", code: errors[0].Code, status: params.status });
            if (!err) err = core.newError({ message: "Error: " + params.data, name: obj.Action || "AWS", status: params.status });
            logger.error('queryAWS:', query, err);
            return callback ? callback(err, params.obj) : null;
        }
        logger.debug('queryAWS:', query, params.obj);
        if (callback) callback(err, params.obj);
    });
}

// AWS EC2 API request
aws.queryEC2 = function(action, obj, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = {};
    var req = { Action: action, Version: '2014-05-01' };
    var region = this.region  || 'us-east-1';
    for (var p in obj) req[p] = obj[p];
    // All capitalized options are passed as is and take priority because they are in native format
    for (var p in options) if (p[0] >= 'A' && p[0] <= 'Z') req[p] = options[p];

    this.queryAWS(self.proto || options.proto || 'https://', 'POST', 'ec2.' + region + '.amazonaws.com', '/', req, callback);
}

// AWS ELB API request
aws.queryELB = function(action, obj, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = {};
    var req = { Action: action, Version: '2012-06-01' };
    var region = this.region  || 'us-east-1';
    for (var p in obj) req[p] = obj[p];
    // All capitalized options are passed as is and take priority because they are in native format
    for (var p in options) if (p[0] >= 'A' && p[0] <= 'Z') req[p] = options[p];
    this.queryAWS(self.proto || options.proto || 'https://', 'POST', 'elasticloadbalancing.' + region + '.amazonaws.com', '/', req, callback);
}

// AWS SQS API request
aws.querySQS = function(action, queue, obj, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = {};
    var req = { Action: action, Version: '2012-11-05' };
    var region = this.region  || 'us-east-1';
    for (var p in obj) req[p] = obj[p];
    // All capitalized options are passed as is and take priority because they are in native format
    for (var p in options) if (p[0] >= 'A' && p[0] <= 'Z') req[p] = options[p];
    this.queryAWS(self.proto || options.proto || 'https://', 'POST', 'sqs.' + region + '.amazonaws.com', '/', req, callback);
}

// AWS SNS API request
aws.querySNS = function(action, obj, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = {};
    var req = { Action: action, Version: '2010-03-31' };
    var region = this.region  || 'us-east-1';
    for (var p in obj) req[p] = obj[p];
    // All capitalized options are passed as is and take priority because they are in native format
    for (var p in options) if (p[0] >= 'A' && p[0] <= 'Z') req[p] = options[p];
    this.queryAWS(self.proto || options.proto || 'https://', 'POST', 'sns.' + region + '.amazonaws.com', '/', req, callback);
}

// AWS SES API request
aws.querySES = function(action, obj, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = {};
    var req = { Action: action, Version: '2010-12-01' };
    var region = this.region  || 'us-east-1';
    for (var p in obj) req[p] = obj[p];
    // All capitalized options are passed as is and take priority because they are in native format
    for (var p in options) if (p[0] >= 'A' && p[0] <= 'Z') req[p] = options[p];
    this.queryAWS(self.proto || options.proto || 'https://', 'POST', 'ses.' + region + '.amazonaws.com', '/', req, callback);
}

// Build version 4 signature headers
aws.querySign = function(service, host, method, path, body, headers)
{
    var self = this;
    var now = new Date();
    var date = now.toISOString().replace(/[:\-]|\.\d{3}/g, '');
    var datetime = date.substr(0, 8);
    var region = this.region  || 'us-east-1';

    headers['Host'] = host;
    headers['X-Amz-Date'] = date;
    if (body && !headers['content-type']) headers['content-type'] = 'application/x-www-form-urlencoded; charset=utf-8';
    if (body && !headers['content-length']) headers['content-length'] = Buffer.byteLength(body, 'utf8');
    if (this.securityToken) headers["x-amz-security-token"] = this.securityToken;

    function trimAll(header) { return header.toString().trim().replace(/\s+/g, ' '); }
    var credString = [ datetime, region, service, 'aws4_request' ].join('/');
    var pathParts = path.split('?', 2);
    var signedHeaders = Object.keys(headers).map(function(key) { return key.toLowerCase(); }).sort().join(';');
    var canonHeaders = Object.keys(headers).sort(function(a, b) { return a.toLowerCase() < b.toLowerCase() ? -1 : 1; }).map(function(key) { return key.toLowerCase() + ':' + trimAll(String(headers[key])); }).join('\n');
    var canonString = [ method, pathParts[0] || '/', pathParts[1] || '', canonHeaders + '\n', signedHeaders, core.hash(body || '', "sha256", "hex")].join('\n');

    var strToSign = [ 'AWS4-HMAC-SHA256', date, credString, core.hash(canonString, "sha256", "hex") ].join('\n');
    var kDate = core.sign('AWS4' + this.secret, datetime, "sha256", "binary");
    var kRegion = core.sign(kDate, region, "sha256", "binary");
    var kService = core.sign(kRegion, service, "sha256", "binary");
    var kCredentials = core.sign(kService, 'aws4_request', "sha256", "binary");
    var sig = core.sign(kCredentials, strToSign, "sha256", "hex");
    headers['Authorization'] = [ 'AWS4-HMAC-SHA256 Credential=' + this.key + '/' + credString, 'SignedHeaders=' + signedHeaders, 'Signature=' + sig ].join(', ');
}

// DynamoDB requests
aws.queryDDB = function (action, obj, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = {};
    var start = Date.now();
    var region = this.region  || 'us-east-1';
    var uri = options.db && options.db.match(/^https?:\/\//) ? options.db : ((self.proto || options.proto || 'http://') + 'dynamodb.' + region + '.amazonaws.com/');
    var version = '2012-08-10';
    var target = 'DynamoDB_' + version.replace(/\-/g,'') + '.' + action;
    var headers = { 'content-type': 'application/x-amz-json-1.0; charset=utf-8', 'x-amz-target': target };
    var req = url.parse(uri);
    // All capitalized options are passed as is and take priority because they are in native format
    for (var p in options) if (p[0] >= 'A' && p[0] <= 'Z') obj[p] = options[p];
    var json = JSON.stringify(obj);

    logger.debug('queryDDB:', action, uri, 'obj:', obj, 'options:', options, 'item:', obj);

    this.querySign("dynamodb", req.hostname, "POST", req.path, json, headers);
    core.httpGet(uri, { method: "POST", postdata: json, headers: headers }, function(err, params) {
        if (err) {
            logger.error("queryDDB:", self.key, action, obj, err);
            return callback ? callback(err, {}) : null;
        }

        // Reply is always JSON but we dont take any chances
        try { params.json = JSON.parse(params.data); } catch(e) { err = e; params.status += 1000; }
        if (params.status != 200) {
            // Try several times
            if (options.retries > 0 && (params.status == 500 || params.data.match(/(ProvisionedThroughputExceededException|ThrottlingException)/))) {
                options.retries--;
                logger.error('queryDDB:', action, obj, err || params.data);
                return setTimeout(function() { self.queryDDB(action, obj, options, callback); }, options.timeout);
            }
            // Report about the error
            if (!err) {
                err = new Error(params.json.message || params.json.Message || (action + " Error"));
                err.code = (params.json.__type || params.json.code).split('#').pop();
            }
            logger[options.silence_error || err.code == "ConditionalCheckFailedException" ? "debug" : "error"]('queryDDB:', action, obj, err || params.data);
            return callback ? callback(err, {}) : null;
        }
        logger.debug('queryDDB:', action, 'finished:', Date.now() - start, 'ms', params.json.Item ? 1 : (params.json.Count || 0), 'rows', params.json.ConsumedCapacity || "");
        if (callback) callback(err, params.json || {});
    });
}

// Sign S3 AWS request, returns url to be send to S3 server, options will have all updated headers to be sent as well
aws.signS3 = function(method, bucket, key, options)
{
    var self = this;
    if (!options) options = {};
    if (!options.headers) options.headers = {};

    var curTime = new Date().toUTCString();
    var region = options.region || this.region || 'us-east-1';
    if (!options.headers["x-amz-date"]) options.headers["x-amz-date"] = curTime;
    if (!options.headers["content-type"]) options.headers["content-type"] = "binary/octet-stream; charset=utf-8";
    if (options.headers["content-type"] && options.headers["content-type"].indexOf("charset=") == -1) options.headers["content-type"] += "; charset=utf-8";
    if (options.securityToken || this.securityToken) options.headers["x-amz-security-token"] = options.securityToken || this.securityToken;

    // Construct the string to sign and query string
    var strSign = (method || "GET") + "\n" + (options.headers['content-md5']  || "") + "\n" + (options.headers['content-type'] || "") + "\n" + (options.expires || "") + "\n";

    // Amazon canonical headers
    var hdrs = [];
    for (var p in options.headers) {
        if (/X-AMZ-/i.test(p)) {
            var value = options.headers[p];
            if (value instanceof Array) value = value.join(',');
            hdrs.push(p.toString().toLowerCase() + ':' + value);
        }
    }
    if (hdrs.length) strSign += hdrs.sort().join('\n') + "\n";
    // Split query string for subresources, supported are:
    var resources = ["acl", "lifecycle", "location", "logging", "notification", "partNumber", "policy", "requestPayment", "torrent",
                     "uploadId", "uploads", "versionId", "versioning", "versions", "website", "cors",
                     "delete",
                     "response-content-type", "response-content-language", "response-expires",
                     "response-cache-control", "response-content-disposition", "response-content-encoding" ];
    var rc = [];
    for (p in options.query) {
        p = p.toLowerCase();
        if (resources.indexOf(p) != -1) rc.push(p + (options.query[p] == null ? "" : "=" + options.query[p]));
    }

    // Run through the encoding so our signature match the real url sent by core.httpGet
    key = url.parse(key).pathname;

    strSign += (bucket ? "/" + bucket : "") + (key[0] != "/" ? "/" : "") + key + (rc.length ? "?" : "") + rc.sort().join("&");
    var signature = core.sign(options.secret || this.secret, strSign);
    options.headers["authorization"] = "AWS " + (options.key || this.key) + ":" + signature;

    // DNS compatible or not, use path-style if not for access otherwise virtual host style
    var dns = bucket.match(/[a-z0-9][a-z0-9\-]*[a-z0-9]/) ? true : false;

    var uri = (self.proto || options.proto || 'http://');
    uri += dns ? bucket + "." : "";
    uri += "s3" + (region != "us-east-1" ? "-" + region : "") + ".amazonaws.com";
    uri += dns ? "" : "/" + bucket;
    uri += (key[0] != "/" ? "/" : "") + key;
    uri += url.format({ query: options.query });

    // Build REST url
    if (options.url) {
        uri += (uri.indexOf("?") == -1 ? "?" : "") + '&AWSAccessKeyId=' + this.key + "&Signature=" + encodeURIComponent(signature);
        if (options.expires) uri += "&Expires=" + options.expires;
        if (options.securityToken || this.securityToken) uri += "&SecurityToken=" + (options.securityToken || this.securityToken);
    }
    logger.debug('signS3:', uri, options, "str:", strSign);
    return uri;
}

// S3 requests
// Options may contain the following properties:
// - method - HTTP method
// - query - query parameters for the url as an object
// - postdata - any data to be sent with POST
// - postfile - file to be uploaded to S3 bucket
// - expires - absolute time when this request is expires
// - headers - HTTP headers to be sent with request
// - file - file name where to save downloaded contents
aws.queryS3 = function(bucket, path, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {};

    var uri = this.signS3(options.method, bucket, path, options);
    core.httpGet(uri, options, function(err, params) {
        if (err || params.status != 200) return callback ? callback(err || core.newError({ message: "Error: " + params.status, name: "S3", status : params.status}), params.data) : null;
        if (callback) callback(err, params);
    });
}

// Retrieve a file from S3 bucket, root of the path is a bucket, path can have a protocol prepended like s3://, it will be ignored
aws.s3GetFile = function(path, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {};
    var uri = self.s3ParseUrl(path);
    if (uri.query) options.query = uri.query;
    aws.queryS3(uri.bucket, uri.path, options, callback);
}

// Upload a file to S3 bucket, `file` can be a Buffer or a file name
aws.s3PutFile = function(path, file, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {};

    options.method = "PUT";
    if (!options.headers) options.headers = {};
    if (options.acl) options.headers['x-amz-acl'] = options.acl;
    if (options.contentType) options.headers['content-type'] = options.contentType;
    if (!options.headers['content-type']) options.headers['content-type'] = mime.lookup(file);
    options[Buffer.isBuffer(file) ? 'postdata' : 'postfile'] = file;
    var uri = self.s3ParseUrl(path);
    if (uri.query) options.query = uri.query;
    aws.queryS3(uri.bucket, uri.path, options, callback);
}

// Parse an S3 URL and return an object with bucket and path
aws.s3ParseUrl = function(url)
{
    var rc = {}
    url = url.split("?");
    // Remove the protocol part and leading slashes
    url[0] = url[0].replace(/(^.+\:\/\/|^\/+)/, "");
    var path = url[0].split("/");
    rc.bucket = path[0];
    rc.path = path.slice(1).join("/");
    if (url[1]) rc.query = qs.parse(url[1]);
    return rc;
}

// Run AWS instances, supports all native EC2 parameters with first capital letter but also accepts simple parameters in the options:
//  - min - min number of instances to run, default 1
//  - max - max number of instances to run, default 1
//  - imageId - AMI id, use aws.imageId if not given or options.ImageId attribute
//  - instanceType - instance type, use aws.instanceType if not given or options.InstanceType attribute
//  - keyName - Keypair, use aws.keyName if not given or options.KeyName attribute
//  - data - user data, in clear text
//  - terminate - set instance initiated shutdown behaviour to terminate
//  - stop - set instance initiated shutdown behaviour to stop
//  - groupId - one group id or an array with security group ids
//  - ip - a static private IP adress to assign
//  - publicIp - associate with a public IP address
//  - file - pass contents of a file as user data, contents are read using sync method
//  - waitTimeout - how long to wait in ms for instance to be runnable
//  - waitDelay  - now often in ms to poll for status while waiting
//  - waitRunning - if 1 then wait for instance to be in running state, this is implied also by elbName, name, elasticIp properties in the options
//  - name - assign a tag to the instance as Name:
//  - elbName - join elastic balancer after the startup
//  - elasticIp - asociate with the given Elastic IP address after the start
//  - iamProfile - IAM profile to assign for instance credentials, if not given use aws.iamProfile or options['IamInstanceProfile.Name'] attribute
//  - availZone - availability zone, if not given use aws.availZone or options['Placement.AvailabilityZone'] attribute
//  - subnetId - subnet id, if not given use aws.subnetId or options.SubnetId attribute
aws.ec2RunInstances = function(options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = {};

    var req = { MinCount: options.min || options.count || 1,
                MaxCount: options.max || options.count || 1,
                ImageId: options.imageId || this.imageId,
                InstanceType: options.instanceType || this.instanceType,
                KeyName: options.keyName || this.keyName || "",
                UserData: options.data ? new Buffer(options.data).toString("base64") : "" };

    if (options.stop) req.InstanceInitiatedShutdownBehavior = "stop";
    if (options.terminate) req.InstanceInitiatedShutdownBehavior = "terminate";
    if (options.iamProfile || this.iamProfile) req["IamInstanceProfile.Name"] = options.iamProfile || this.iamProfile;
    if (options.availZone || this.availZone) req["Placement.AvailabilityZone"] = options.availZone || this.availZone;
    if (options.subnetId || this.subnetId) {
        if (!options["SecurityGroupId.0"]) {
            var groups = core.strSplitUnique(options.groupId || this.groupId || []);
            groups.forEach(function(x, i) { req["NetworkInterface.0.SecurityGroupId." + i] = x; });
            if (groups.length) {
                req["NetworkInterface.0.DeviceIndex"] = 0;
                req["NetworkInterface.0.SubnetId"] = options.subnetId || this.subnetId;
            }
        }
        if (options.ip) {
            req["NetworkInterface.0.DeviceIndex"] = 0;
            req["NetworkInterface.0.PrivateIpAddress"] = options.ip;
            req["NetworkInterface.0.SubnetId"] = options.subnetId || this.subnetId;
        }
        if (options.publicIp) {
            req["NetworkInterface.0.DeviceIndex"] = 0;
            req["NetworkInterface.0.AssociatePublicIpAddress"] = true;
            req["NetworkInterface.0.SubnetId"] = options.subnetId || this.subnetId;
        }
        if (typeof req["NetworkInterface.0.DeviceIndex"] == "undefined") {
            req.SubnetId = options.subnetId || this.subnetId;
        }
    } else {
        if (!options["SecurityGroupId.0"]) {
            var groups = core.strSplitUnique(options.groupId || this.groupId || []);
            groups.forEach(function(x, i) { req["SecurityGroupId." + i] = x; });
        }
        if (options.ip) {
            req.PrivateIpAddress = ip;
        }
    }
    if (options.file) req.UserData = core.readFileSync(options.file).toString("base64");

    logger.debug('runInstances:', this.name, req, options);
    this.queryEC2("RunInstances", req, options, function(err, obj) {
        if (err) return callback ? callback(err) : null;

        // Instances list
        var items = core.objGet(obj, "RunInstancesResponse.instancesSet.item", { list: 1 });
        if (!items.length) return callback ? callback(err, obj) : null;

        // Dont wait for instance to be running
        if (!options.waitRunning && !options.name && !options.elbName && !options.elasticIp) {
            return callback ? callback(err, obj) : null;
        }
        var instanceId = items[0].instanceId;

        core.series([
           function(next) {
               self.ec2WaitForInstance(instanceId, "running", { waitTimeout: 300000, waitDelay: 5000 }, next);
           },
           function(next) {
               // Set tag name for all instances
               if (!options.name) return next();
               core.forEachSeries(items, function(item, next2) {
                   self.ec2CreateTags(item.instanceId, options.name, next2);
               }, next);
           },
           function(next) {
               // Add to the ELB
               if (!options.elbName) return next();
               self.elbRegisterInstances(options.elbName, items.map(function() { return x.instanceId }), next);
           },
           function(next) {
               // Elastic IP
               if (!options.elasticIp) return next();
               self.ec2AssociateAddress(instanceId, options.elasticIp, { subnetId: req.SubnetId || req["NetworkInterface.0.SubnetId"] }, next);
           },
           ], function() {
                if (callback) callback(err, obj);
        });
    });
}

// Check an instance status and keep waiting until it is equal what we expect or timeout occured.
// The `status` can be one of: pending | running | shutting-down | terminated | stopping | stopped
// The options can specify the following:
//  - waitTimeout - how long to wait in ms until give up, default is 30 secs
//  - waitDelay - how long in ms between polls
aws.ec2WaitForInstance = function(instanceId, status, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = {};

    var state = "", num = 0, expires = Date.now() + (options.waitTimeout || 60000);
    core.doWhilst(
      function(next) {
          self.queryEC2("DescribeInstances", { 'Filter.1.Name': 'instance-id', 'Filter.1.Value.1': instanceId }, function(err, rc) {
              if (err) return next(err);
              state = core.objGet(rc, "DescribeInstancesResponse.reservationSet.item.instancesSet.item.instanceState.name");
              setTimeout(next, num++ ? (options.waitDelay || 5000) : 0);
          });
      },
      function() {
          return state != status && Date.now() < expires;
      },
      callback);
}

// Create tags for a resource. Options may contain tags property which is an object with tag key and value
//
// Example
//
//      aws.ec2CreateTags("i-1234","My Instance", { tags: { tag2 : "val2", tag3: "val3" } } )
//
aws.ec2CreateTags = function(id, name, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = {};

    var tags = {}, i = 2;
    tags["ResourceId.1"] = id;
    tags["Tag.1.Key"] = 'Name';
    tags["Tag.1.Value"] = name;

    // Additional tags
    for (var p in options.tags) {
        tags["ResourceId." + i] = id;
        tags["Tag." + i + ".Key"] = p;
        tags["Tag." + i + ".Value"] = options[p];
        i++;
    }
    self.queryEC2("CreateTags", tags, options, callback);
}

// Associate an Elastic IP with an instance. Default behaviour is to reassociate if the EIP is taken.
// The options can specify the following:
//  - subnetId - required for instances in VPC, allocation id will be retrieved for the given ip address automatically
aws.ec2AssociateAddress = function(instanceId, elasticIp, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = {};

    var params = { InstanceId: instanceId, PublicIp: elasticIp, AllowReassociation: true };
    if (options.subnetId) {
        // Already known
        if (options.AllocationId) {
            return self.queryEC2("AssociateAddress", params, options, callback);
        }
        // Get the allocation id
        self.queryEC2("DescribeAddresses", { 'PublicIp.1': elasticIp }, function(err, obj) {
            params.AllocationId = core.objGet(obj, "DescribeAddressesResponse.AddressesSet.item.allocationId");
            if (!params.AllocationId) err = core.newError({ message: "EIP not found", name: "EC2", code: elasticIp });
            if (err) return callback ? callback(err) : null;
            self.queryEC2("AssociateAddress", params, options, callback);
        });
    } else {
        self.queryEC2("AssociateAddress", params, options, callback);
    }
}

// Deregister an AMI by id. If `options.snapshots` is set, then delete all snapshots for this image as well
aws.ec2DeregisterImage = function(ami_id, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = {};

    // Not deleting snapshots, just deregister
    if (!options.snapshots) return self.queryEC2("DeregisterImage", { ImageId: ami_id }, callback);

    // Pull the image meta data and delete all snapshots
    self.queryEC2("DescribeImages", { 'ImageId.1': ami_id }, function(err, rc) {
        if (err) return callback(err);

        var items = core.objGet(rc, "DescribeImagesResponse.imagesSet.item", { list: 1 });
        if (!items.length) return callback(core.newError({ message: "no AMI found", name: ami_id }));

        var volumes = core.objGet(items[0], "blockDeviceMapping.item", { list : 1 });
        self.queryEC2("DeregisterImage", { ImageId: ami_id }, function(err) {
            if (err) return callback(err);

            core.forEachSeries(volumes, function(vol, next) {
                if (!vol.ebs || !vol.ebs.snapshotId) return next();
                self.queryEC2("DeleteSnapshot", { SnapshotId: vol.ebs.snapshotId }, next);
            }, callback)
        });
    });
}

// Retrieve instance meta data
aws.getInstanceMeta = function(path, callback)
{
    var self = this;
    core.httpGet("http://169.254.169.254" + path, { httpTimeout: 100, quiet: true }, function(err, params) {
        logger.debug('getInstanceMeta:', path, params.status, params.data, err || "");
        if (callback) callback(err, params.status == 200 ? params.data : "");
    });
}

// Retrieve instance credentials using EC2 instance profile and setup for AWS access
aws.getInstanceCredentials = function(callback)
{
    if (!this.amiProfile) return callback ? callback() : null;

    var self = this;
    self.getInstanceMeta("/latest/meta-data/iam/security-credentials/" + self.amiProfile, function(err, data) {
        if (!err && data) {
            var obj = core.jsonParse(data, { obj: 1 });
            if (obj.Code === 'Success') {
                self.key = obj.AccessKeyId;
                self.secret = obj.SecretAccessKey;
                self.securityToken = obj.Token;
                self.tokenExpiration = core.toDate(obj.Expiration).getTime();
            }
        }
        // Poll every ~5mins
        if (!self.tokenTimer) {
            self.tokenTimer = setInterval(function() { self.getInstanceCredentials() }, 258 * 1000);
        }
        if (callback) callback(err);
    });
}

// Retrieve instance launch index from the meta data if running on AWS instance
aws.getInstanceInfo = function(callback)
{
    var self = this;

    core.series([
        function(next) {
            self.getInstanceMeta("/latest/meta-data/instance-id", function(err, data) {
                if (!err && data) core.instance.id = data;
                next(err);
            });
        },
        function(next) {
            self.getInstanceMeta("/latest/meta-data/ami-id", function(err, data) {
                if (!err && data) core.instance.image = data;
                next(err);
            });
        },
        function(next) {
            self.getInstanceMeta("/latest/meta-data/ami-launch-index", function(err, data) {
                if (!err && data) core.instance.index = core.toNumber(data);
                next(err);
            });
        },
        function(next) {
            self.getInstanceMeta("/latest/user-data", function(err, data) {
                if (!err && data) core.parseArgs(utils.strSplit(data, " ", '"\''));
                next(err);
            });
        },
        function(next) {
            self.getInstanceMeta("/latest/meta-data/placement/availability-zone/", function(err, data) {
                if (!err && data) self.zone = data;
                if (self.zone && !core.instance.zone) core.instance.zone = self.zone;
                if (self.zone && !core.instance.region) core.instance.region = self.zone.slice(0, -1);
                if (!self.region && data) self.region = data.slice(0, -1);
                next(err);
            });
        },
        function(next) {
            self.getInstanceMeta("/latest/meta-data/iam/security-credentials/", function(err, data) {
                if (!err && data) self.amiProfile = data;
                next(err);
            });
        },
        function(next) {
            // If access key is configured then skip profile meta
            if (self.key) return next();
            self.getInstanceCredentials(next);
        },
        function(next) {
            if (!self.secret || !core.instance.id) return next();
            self.queryEC2("DescribeTags", { 'Filter.1.Name': 'resource-id', 'Filter.1.Value': core.instance.id }, function(err, tags) {
                if (!err) self.tags = core.objGet(tags, "DescribeTagsResponse.tagSet.item", { list: 1 });
                if (!core.instance.tag) core.instance.tag = self.tags.filter(function(x) { return x.key == "Name" }).map(function(x) { return x.value }).join(",");
                next();
            });
        },
        ], function(err) {
            logger.debug('getInstanceInfo:', self.name, core.instance, 'profile:', self.amiProfile, 'expire:', self.tokenExpiration, err || "");
            if (callback) callback();
    });
}

// Register an instance(s) with ELB, instance can be one id or a list of ids
aws.elbRegisterInstances = function(name, instance, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    var params = { LoadBalancerName: name };
    if (!Array.isArray(instance)) instance = [ instance ];
    instance.forEach(function(x, i) { params["Instances.member." + (i+1) + ".InstanceId"] = x; });
    this.queryELB("RegisterInstancesWithLoadBalancer", params, options, callback);
}

// Deregister an instance(s) from ELB, instance can be one id or a list of ids
aws.elbDeregisterInstances = function(name, instance, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    var params = { LoadBalancerName: name };
    if (!Array.isArray(instance)) instance = [ instance ];
    instance.forEach(function(x, i) { params["Instances.member." + (i+1) + ".InstanceId"] = x; });
    this.queryELB("DeregisterInstancesWithLoadBalancer", params, options, callback);
}

// Receive message(s) from the SQS queue, the callback will receive a list with messages if no error.
// The following options can be specified:
//  - count - how many messages to receive
//  - timeout - how long to wait, this is for Long Poll
//  - visibilityTimeout - the duration (in seconds) that the received messages are hidden from subsequent retrieve requests after being retrieved by a ReceiveMessage request.
aws.sqsReceiveMessage = function(url, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    var params = { QueueUrl: url };
    if (options.count) params.MaxNumberOfMessages = options.count;
    if (options.visibilityTimeout) params.VisibilityTimeout = options.visibilityTimeout;
    if (options.timeout) params.WaitTimeSeconds = options.timeout;
    this.querySQS("ReceiveMessage", params, options, function(err, obj) {
        var rows = [];
        if (!err) rows = core.objGet(obj, "ReceiveMessageResponse.ReceiveMessageResult.Message", { list: 1 });
        if (callback) callback(err, rows);
    });
}

// Send a message to the SQS queue.
// The options can specify the following:
//  - delay - pass as DelaySeconds parameter
//  - attrs - an object with additional message attributes to send, use only string, numbers or binary values, all other types will be converted into strings
aws.sqsSendMessage = function(url, body, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    var params = { QueueUrl: url, MessageBody: body };
    if (options.delay) params.DelaySeconds = options.delay;
    if (options.attrs) {
        var n = 1;
        for (var p in options.attrs) {
            var type = typeof options.attrs[p] == "number" ? "Number" : typeof options.attrs[p] == "string" ? "String" : "Binary";
            params["MessageAttribute." + n + ".Name"] = p;
            params["MessageAttribute." + n + ".Value." + type + "Value"] = options.attrs[p];
            params["MessageAttribute." + n + ".Value.DataType"] = type;
            n++;
        }
    }
    this.querySQS("SendMessage", params, options, function(err, obj) {
        var rows = [];
        if (!err) rows = core.objGet(obj, "ReceiveMessageResponse.ReceiveMessageResult.Message", { list: 1 });
        if (callback) callback(err, rows);
    });
}

// Creates an endpoint for a device and mobile app on one of the supported push notification services, such as GCM and APNS.
//
// The following properties can be specified in the options:
//   - appArn - an application ARN to be used for push notifications, if not passed, global `-sns-app-arn` will be used.
//   - data - a user data to be associated with the endpoint arn
//
// All capitalized properties in the options will be pased as is. The callback will be called with an error if any and the endpoint ARN
aws.snsCreatePlatformEndpoint = function(token, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    var params = { PlatformApplicationArn: options.appArn || self.snsAppArn, Token: token };
    if (options.data) params.CustomUserData = options.data;

    this.querySNS("CreatePlatformEndpoint", params, options, function(err, obj) {
        var arn = null;
        if (!err) arn = core.objGet(obj, "CreatePlatformEndpointResponse.CreatePlatformEndpointResult.EndpointArn", { str: 1 });
        if (callback) callback(err, arn);
    });
}

// Sets the attributes for an endpoint for a device on one of the supported push notification services, such as GCM and APNS.
//
// The following properties can be specified in the options:
//  - token - a device token for the notification service
//  - data - a user data to be associated with the endpoint arn
//  - enabled - true or false to enable/disable the deliver of notifications to this endpoint
aws.snsSetEndpointAttributes = function(arn, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    var params = { EndpointArn: arn }, n = 1;
    if (options.data) params["Attributes.entry." + (n++) + ".CustomUserData"] = options.data;
    if (options.token) params["Attributes.entry." + (n++) + ".Token"] = options.token;
    if (options.enabled) params["Attributes.entry." + (n++) + ".Enabled"] = options.enabled;
    this.querySNS("SetEndpointAttributes", params, options, callback);
}

// Deletes the endpoint from Amazon SNS.
aws.snsDeleteEndpoint = function(arn, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    var params = { EndpointArn: arn };
    this.querySNS("DeleteEndpoint", params, options, callback);
}

// Sends a message to all of a topic's subscribed endpoints or to a mobile endpoint.
// If msg is an object, then it will be pushed as JSON.
// The options may take the following properties:
//  - subject - optional subject to be included in the message if the target supports it
aws.snsPublish = function(arn, msg, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    var params = { TargetArn: arn, Message: msg };
    if (typeof msg != "string") {
        params.Message = JSON.stringify(msg);
        params.MessageStructure = "json";
    }
    if (options.subject) params.Subject = options.subject;

    this.querySNS("Publish", params, options, callback);
}

// Creates a topic to which notifications can be published. The callback returns topic ARN on success.
aws.snsCreateTopic = function(name, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    var params = { Name: name };
    this.querySNS("CreateTopic", params, options, function(err, obj) {
        var arn = null;
        if (!err) arn = core.objGet(obj, "CreateTopicResponse.CreateTopicResult.TopicArn", { str: 1 });
        if (callback) callback(err, arn);
    });
}

// Updates the topic attributes.
// The following options can be used:
//  - name - new topic name
//  - policy - an object with access policy
//  - deliveryPolicy - an object with delivery attributes, can specify all or only the ones that needed to be updated
aws.snsSetTopicAttributes = function(arn, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    var params = { TopicArn: arn };
    if (options.name) {
        params.AttrributeName = "DisplayName";
        params.AttributeValue = options.name;
    } else
    if (options.policy) {
        params.AttrributeName = "Policy";
        params.AttributeValue = JSON.stringify(options.policy);
    } else
    if (options.deliveryPolicy) {
        params.AttrributeName = "DeliveryPolicy";
        params.AttributeValue = JSON.stringify(options.deliveryPolicy);
    } else {
        var policy = null;
        ["minDelayTarget", "maxDelayTarget", "numRetries", "numMaxDelayRetries", "backoffFunction"].forEach(function(x) {
            if (typeof options[x] == "undefined") return;
            if (!policy) policy = {};
            if (!policy.defaultHealthyRetryPolicy) policy.defaultHealthyRetryPolicy = {};
            policy.defaultHealthyRetryPolicy[x] = options[x];
        });
        if (options.maxReceivesPerSecond) {
            if (!policy) policy = {};
            policy.defaultThrottlePolicy = { maxReceivesPerSecond: options.maxReceivesPerSecond };
        }
        if (options.disableSubscriptionOverrides) {
            if (!policy) policy = {};
            policy.disableSubscriptionOverrides = options.disableSubscriptionOverrides;
        }
        if (policy && options.protocol) {
            params.AttrributeName = "DeliveryPolicy";
            params.AttributeValue = JSON.stringify(core.newObj(options.protocol, policy));
        }
    }

    this.querySNS("SetTopicAttributes", params, options, callback);
}

// Deletes the topic from Amazon SNS.
aws.snsDeleteTopic = function(arn, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    var params = { TopicArn: arn };
    this.querySNS("DeleteTopic", params, options, callback);
}

// Creates a topic to which notifications can be published. The callback returns topic ARN on success, if the topic requires
// confirmation the arn returned will bt null and a token will be sent to the endpoint for confirmation.
aws.snsSubscribe = function(arn, endpoint, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    // Detect the protocol form the ARN
    if (!options.protocol && typeof endpoint == "string") {
        if (endpoint.match(/^https?\:\/\//)) options.protocol = endpoint.substr(0, 4); else
        if (endpoint.match(/^arn\:aws\:/)) options.protocol = "sqs"; else
        if (endpoint.match(/^[^ ]@[^ ]+$/)) options.protocol = "email"; else
        if (endpoint.match(/[0-9-]+/)) options.protocol = "sms"; else
        options.protocol = "application";
    }

    var params = { TopicARN: arn, Protocol: options.protocol, Endpoint: endpoint };
    this.querySNS("Subscribe", params, options, function(err, obj) {
        var arn = null;
        if (!err) arn = core.objGet(obj, "SubscribeResponse.SubscribeResult.SubscriptionArn", { str: 1 });
        if (callback) callback(err, arn);
    });
}

// Verifies an endpoint owner's intent to receive messages by validating the token sent to the
// endpoint by an earlier Subscribe action. If the token is valid, the action creates a new subscription
// and returns its Amazon Resource Name (ARN) in the callback.
aws.snsConfirmSubscription = function(arn, token, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    var params = { TopicARN: arn, Token: token };
    this.querySNS("ConfirmSubscription", params, options, function(err, obj) {
        var arn = null;
        if (!err) arn = core.objGet(obj, "SubscribeResponse.SubscribeResult.SubscriptionArn", { str: 1 });
        if (callback) callback(err, arn);
    });
}

// Updates the subscription attributes.
// The following options can be used:
//  - name - new topic name
//  - deliveryPolicy - an object with delivery attributes, can specify all or only the ones that needed to be updated
//  - minDelayTarget - update delivery policy by attribute name
//  - maxDelayTarget
//  - numRetries
//  - numMaxDelayRetries
//  - backoffFunction - one of linear|arithmetic|geometric|exponential
//  - maxReceivesPerSecond
aws.snsSetSubscriptionAttributes = function(arn, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    var params = { TopicArn: arn };
    if (options.deliveryPolicy) {
        params.AttrributeName = "DeliveryPolicy";
        params.AttributeValue = JSON.stringify(options.deliveryPolicy);
    } else {
        var policy = null;
        ["minDelayTarget", "maxDelayTarget", "numRetries", "numMaxDelayRetries", "backoffFunction"].forEach(function(x) {
            if (typeof options[x] == "undefined") return;
            if (!policy) policy = {};
            if (!policy.healthyRetryPolicy) policy.healthyRetryPolicy = {};
            policy.healthyRetryPolicy[x] = options[x];
        });
        if (options.maxReceivesPerSecond) {
            if (!policy) policy = {};
            policy.throttlePolicy = { maxReceivesPerSecond: options.maxReceivesPerSecond };
        }
        if (policy) {
            params.AttrributeName = "DeliveryPolicy";
            params.AttributeValue = JSON.stringify(policy);
        }
    }

    this.querySNS("SetSubscriptionAttributes", params, options, callback);
}

// Creates a topic to which notifications can be published. The callback returns topic ARN on success.
aws.snsUnsubscribe = function(arn, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    var params = { Name: name };
    this.querySNS("Unsubscribe", params, options, callback);
}

// Send an email via SES
// The following options supported:
//  - from - an email to use in the From: header
//  - cc - list of email to use in CC: header
//  - bcc - list of emails to use in Bcc: header
//  - replyTo - list of emails to ue in ReplyTo: header
//  - returnPath - email where to send bounces
//  - charset - charset to use, default is UTF-8
//  - html - if set the body is sent as MIME HTML
aws.sesSendEmail = function(to, subject, body, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    var params = { "Message.Subject.Data": subject, "Message.Subject.Charset": options.charset || "UTF-8" };
    params["Message.Body." + (options.html ? "Html" : "Text") + ".Data"] = body;
    params["Message.Body." + (options.html ? "Html" : "Text") + ".Charset"] = options.charset || "UTF-8";
    params["Source"] = options.from || core.email;
    core.strSplit(to).forEach(function(x, i) { params["Destination.ToAddresses.member." + (i + 1)] = x; })
    if (options.cc) core.strSplit(options.cc).forEach(function(x, i) { params["Destination.CcAddresses.member." + (i + 1)] = x; })
    if (options.bcc) core.strSplit(options.bcc).forEach(function(x, i) { params["Destination.BccAddresses.member." + (i + 1)] = x; })
    if (options.replyTo) core.strSplit(options.replyTo).forEach(function(x, i) { params["ReplyToAddresses.member." + (i + 1)] = x; })
    if (options.returnPath) params["ReturnPath"] = options.returnPath;
    this.querySES("SendEmail", params, options, callback);
}

// Send raw email
// The following options accepted:
//  - to - list of email addresses to use in RCPT TO
//  - from - an email to use in from header
aws.sesSendRawEmail = function(body, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    var params = { "RawMessage.Data": body };
    if (options.from) params["Source"] = options.from;
    if (options.to) core.strSplit(options.to).forEach(function(x, i) { params["Destinations.member." + (i + 1)] = x; })
    this.querySES("SendRawEmail", params, options, callback);
}

// Convert a Javascript object into DynamoDB object
aws.toDynamoDB = function(value, level)
{
    var self = this;
    switch (core.typeName(value)) {
    case 'null':
        return { "NULL": 'true' };

    case 'boolean':
        return { "BOOL": value.toString() };

    case 'number':
        return { "N": value.toString() };

    case 'buffer':
        return { "B": value.toString("base64") };

    case "date":
        return { "N": Math.round(value.getTime()/1000) };

    case 'array':
        var types = { number: 0, string: 0 };
        for (var i = 0; i < value.length; i++) types[typeof value[i]]++;
        if (types["number"] == value.length) return { "NS": value };
        if (types["string"] == value.length) return { "SS": value };
        return { "L": value };

    case 'object':
        if (level) return { "M" : value };
        var obj = {};
        for (var p in value) {
            if (typeof value[p] == 'undefined') continue;
            if (Array.isArray(value[p]) && !value[p].length) continue;
            obj[p] = self.toDynamoDB(value[p], 1);
        }
        return obj;

    default:
        return { "S": String(value) };
    }
}

// Convert a DynamoDB object into Javascript object
aws.fromDynamoDB = function(value)
{
    var self = this;
    switch (core.typeName(value)) {
    case 'array':
        return value.map(function(x) { return self.fromDynamoDB(x) });

    case 'object':
        var res = {};
        for (var i in value) {
            if (!value.hasOwnProperty(i)) continue;
            if (value[i]['BOOL'])
                res[i] = core.toBool(value[i]['BOOL']);
            else
            if (value[i]['NULL'])
                res[i] = null;
            else
            if (value[i]['L'])
                res[i] = value[i]['L'];
            else
            if (value[i]['M'])
                res[i] = value[i]['M'];
            else
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
        return res;

    default:
        return value;
    }
}

// Build query or scan filter objects for the given object, all properties in the obj are used
aws.queryFilter = function(obj, options)
{
    var self = this;
    var filter = {};
    var ops = ["between","null","not_null", "not null","in","contains","not_contains", "not contains","ne","eq","le","lt","ge","gt"];

    for (var name in obj) {
        var val = obj[name];
        var op = (options.ops || {})[name] || "eq";
        if (this.opsMap[op]) op = this.opsMap[op];
        if (val == null) op = "null";
        // A value with its own operator
        if (core.typeName(val) == "object") {
            var keys = Object.keys(val);
            if (keys.length == 1 && ops.indexOf(keys[0].toLowerCase()) > -1) {
                op = keys[0];
                val = val[op];
            }
        }

        var cond = { ComparisonOperator: op.toUpperCase().replace(' ', '_') }
        switch (cond.ComparisonOperator) {
        case 'BETWEEN':
            if (val.length < 2) continue;
            cond.AttributeValueList = [ this.toDynamoDB(val[0]), this.toDynamoDB(val[1]) ];
            break;

        case 'NULL':
            break;

        case 'NOT_NULL':
            break;

        case 'IN':
            if (Array.isArray(val)) {
                cond.AttributeValueList = [];
                val.forEach(function(x) { cond.AttributeValueList.push(self.toDynamoDB(x));});
            } else {
                cond.AttributeValueList = [ this.toDynamoDB(val) ];
            }
            break;

        case 'CONTAINS':
        case 'NOT_CONTAINS':
        case 'NE':
        case 'EQ':
        case 'LE':
        case 'LT':
        case 'GE':
        case 'GT':
        case 'BEGINS_WITH':
            if (!val && ["string","object","undefined"].indexOf(typeof val) > -1) continue;
            cond.AttributeValueList = [ this.toDynamoDB(val) ];
            break;
        }
        filter[name] = cond;
    }
    return filter;
}

// Return list of tables in .TableNames property of the result
//
// Example:
//
//          { TableNames: [ name, ...] }
aws.ddbListTables = function(options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {};
    this.queryDDB('ListTables', {}, options, callback);
}

// Return table definition and parameters in the result structure with property of the given table name
//
// Example:
//
//          { name: { AttributeDefinitions: [], KeySchema: [] ...} }
aws.ddbDescribeTable = function(name, options, callback)
{
    var self = this;
    var params = { TableName: name };
    this.queryDDB('DescribeTable', params, options, function(err, rc) {
        logger.debug('DescribeTable:', name, rc);
        if (callback) callback(err, rc);
    });
}

// Create a table
// - attrs can be an array in native DDB JSON format or an object with name:type properties, type is one of S, N, NN, NS, BS
// - keys can be an array in native DDB JSON format or an object with name:keytype properties, keytype is one of HASH or RANGE value in the same format as for primary keys
// - options may contain any valid native property if it starts with capital letter and the following:
//   - waitTimeout - number of milliseconds to wait for ACTIVE status
//   - waitDelay - how often to pool for table status, default is 250ms
//   - local - an object with each property for a local secondary index name defining key format the same way as for primary keys, all Uppercase properties are added to the top index object
//   - global - an object for global secondary indexes, same format as for local indexes
//   - projection - an object with index name and list of projected properties to be included in the index or "ALL" for all properties, if omitted then default KEYS_ONLY is assumed
//   - readCapacity - read capacity units for provisioned throughput
//   - writeCapacity - write capacity units
//
//
// Example:
//
//          ddbCreateTable('users', { id:'S',mtime:'N',name:'S'},
//                                  { id:'HASH',name:'RANGE'},
//                                  { local: { mtime: { mtime: "HASH" } },
//                                    global: { name: { name: 'HASH', ProvisionedThroughput: { ReadCapacityUnits: 50 } } },
//                                    projection: { mtime: ['gender','age'],
//                                                  name: ['name','gender'] },
//                                    readCapacity: 10,
//                                    writeCapacity: 10 });
aws.ddbCreateTable = function(name, attrs, keys, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {};
    var params = { TableName: name,
                   AttributeDefinitions: [],
                   KeySchema: [],
                   ProvisionedThroughput: { ReadCapacityUnits: options.readCapacity || self.ddbReadCapacity || 10,
                                            WriteCapacityUnits: options.writeCapacity || self.ddbWriteCapacity || 5 }};

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
    ["local","global"].forEach(function(t) {
        for (var n in options[t]) {
            var idx = options[t][n];
            var iname = (n.length > 2 ? '' : '_') + n;
            var index = { IndexName: iname, KeySchema: [] };
            for (var p in idx) {
                if (p[0] >= 'A' && p[0] <= 'Z') {
                    index[p] = idx[p];
                } else {
                    index.KeySchema.push({ AttributeName: p, KeyType: String(idx[p]).toUpperCase() })
                }
            }
            if (options.projection && options.projection[n]) {
                index.Projection = { ProjectionType: Array.isArray(options.projection[n]) ? "INCLUDE" : String(options.projection[n]).toUpperCase() };
                if (index.Projection.ProjectionType == "INCLUDE") index.Projection.NonKeyAttributes = options.projection[n];
            } else {
                index.Projection = { ProjectionType: "KEYS_ONLY" };
            }
            switch (t) {
            case "local":
                if (!params.LocalSecondaryIndexes) params.LocalSecondaryIndexes = [];
                params.LocalSecondaryIndexes.push(index);
                break;
            case "global":
                if (!index.ProvisionedThroughput) index.ProvisionedThroughput = {};
                if (!index.ProvisionedThroughput.ReadCapacityUnits) index.ProvisionedThroughput.ReadCapacityUnits = params.ProvisionedThroughput.ReadCapacityUnits;
                if (!index.ProvisionedThroughput.WriteCapacityUnits) index.ProvisionedThroughput.WriteCapacityUnits = params.ProvisionedThroughput.WriteCapacityUnits;
                if (!params.GlobalSecondaryIndexes) params.GlobalSecondaryIndexes = [];
                params.GlobalSecondaryIndexes.push(index);
                break;
            }
        }
    });

    this.queryDDB('CreateTable', params, options, function(err, item) {
        if (err) return callback(err, item);

        // Wait because DynamoDB cannot create multiple tables at once especially with indexes
        options.waitStatus = "CREATING";
        self.ddbWaitForTable(name, item, options, callback);
    });
}

// Remove a table from the database
aws.ddbDeleteTable = function(name, options, callback)
{
    var self = this;
    var params = { TableName: name };
    this.queryDDB('DeleteTable', params, options, function(err, item) {
        if (err) return callback(err, item);
        options.waitStatus = "DELETING";
        self.ddbWaitForTable(name, item, options, callback);
    });
}

// Call the callback after specified period of time or when table status become different from the given waiting status.
// if options.waitTimeout is not specified calls the callback immediately. options.waitStatus is checked if given and keeps waiting
// while the status is equal to it. options.waitDelay can be specified how often to request new status, default is 250ms.
aws.ddbWaitForTable = function(name, item, options, callback)
{
    var self = this;
    if (!options.waitTimeout) return callback(null, item);

    var expires = Date.now() + options.waitTimeout;
    var status = item.TableDescription.TableStatus;
    core.whilst(
      function() {
          return status == options.waitStatus && Date.now() < expires;
      },
      function(next) {
          self.ddbDescribeTable(name, options, function(err, rc) {
              if (err) return next(err);
              status = rc.Table.TableStatus;
              setTimeout(next, options.waitDelay || 1000);
          });
      },
      function(err) {
          callback(err, item);
      });
}

// Update tables provisioned throughput settings, options is used instead of table name so this call can be used directly in the cron jobs to adjust
// provisionined throughput on demand.
// Options must provide the following properties:
//  - name - table name
//  - readCapacity -
//  - writeCapacity - new povisioned throughtput settings
//
// Example of crontab job in etc/crontab:
//
//              [
//              { "type": "server", "cron": "0 0 1 * * *", "job": { "aws.ddbUpdateTable": { "name": "bk_account", "readCapacity": 1000, "writeCapacity": 1000 } } },
//              { "type": "server", "cron": "0 0 6 * * *", "job": { "aws.ddbUpdateTable": { "name": "bk_account", "readCapacity": 2000, "writeCapacity": 2000 } } }
//              ]
//
aws.ddbUpdateTable = function(options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};
    var params = { TableName: options.name, ProvisionedThroughput: { ReadCapacityUnits: options.readCapacity, WriteCapacityUnits: options.writeCapacity } };
    this.queryDDB('UpdateTable', params, options, callback);
}

// Put or add an item
// - item is an object, type will be inferred from the native js type.
// - options may contain any valid native property if it starts with capital letter or special properties:
//    - expected - an object with column names to be used in Expected clause and value as null to set condition to { Exists: false } or
//          any other exact value to be checked against which corresponds to { Exists: true, Value: value }
//    - expr - condition expression
//    - values - an object with values map to be used for in the update and/or condition expressions, to be used
//          for ExpressionAttributeValues parameters
//    - names - an object with a map to be used for attribute names in condition and update expressions, to be used
//          for ExpressionAttributeNames parameter
//
// Example:
//
//          ddbPutItem("users", { id: 1, name: "john", mtime: 11233434 }, { expected: { name: null } })
//
aws.ddbPutItem = function(name, item, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {};
    var params = { TableName: name, Item: self.toDynamoDB(item) };
    // Sugar-candy syntax for expected values
    for (var p in options.expected) {
        if (!params.Expected) params.Expected = {};
        if (options.expected[p] == null) {
            params.Expected[p] = { Exists: false };
        } else {
            params.Expected[p] = { Value: self.toDynamoDB(options.expected[p]) };
        }
    }
    if (options.expr) {
        params.ConditionExpression = options.expr;
    }
    if (options.names) {
        params.ExpressionAttributeNames = self.toDynamoDB(options.names);
    }
    if (options.values) {
        params.ExpressionAttributeValues = self.toDynamoDB(options.values);
    }
    if (options.returning) {
        params.ReturnValues = options.returning;
    }
    this.queryDDB('PutItem', params, options, function(err, rc) {
        rc.Item = rc.Attributes ? self.fromDynamoDB(rc.Attributes) : {};
        if (callback) callback(err, rc);
    });
}

// Update an item
// - keys is an object with primary key attributes name and value.
// - item is an object with properties where value can be:
//      - number/string/array - action PUT, replace or add new value
//      - null/empty string - action DELETE
// - item can be a string with Update expression
// - options may contain any valid native property if it starts with capital letter or special properties:
//      - expr - condition expression
//      - values - an object with values map to be used for in the update and/or condition expressions, to be used
//          for ExpressionAttributeValues parameters
//      - names - an object with a map to be used for attribute names in condition and update expressions, to be used
//          for ExpressionAttributeNames parameter
//      - ops - an object with operators to be used for properties if other than PUT
//      - expected - an object with column names to be used in Expected clause and value as null to set condition to { Exists: false } or
//          any other exact value to be checked against which corresponds to { Exists: true, Value: value }. If it is an object then it is treated as
//          { op: value } and options.ops is ignored otherwise the conditional comparison operator is taken from options.ops the same way as for queries.
//
// Example:
//
//          ddbUpdateItem("users", { id: 1, name: "john" }, { gender: 'male', icons: '1.png' }, { op: { icons: 'ADD' }, expected: { id: 1 }, ReturnValues: "ALL_NEW" })
//          ddbUpdateItem("users", { id: 1, name: "john" }, { gender: 'male', icons: '1.png' }, { op: { icons: 'ADD' }, expected: { id: null } })
//          ddbUpdateItem("users", { id: 1, name: "john" }, { gender: 'male', icons: '1.png', num: 1 }, { op: { num: 'ADD', icons: 'ADD' }, expected: { id: null, num: { gt: 0 } } })
//
aws.ddbUpdateItem = function(name, keys, item, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {};
    var params = { TableName: name, Key: {} };
    for (var p in keys) {
        params.Key[p] = self.toDynamoDB(keys[p]);
    }
    // Sugar-candy syntax for expected values
    if (options.expected) {
        params.Expected = this.queryFilter(options.expected, options);
    }
    if (options.expr) {
        params.ConditionExpression = options.expr;
    }
    if (options.names) {
        params.ExpressionAttributeNames = self.toDynamoDB(options.names);
    }
    if (options.values) {
        params.ExpressionAttributeValues = self.toDynamoDB(options.values);
    }
    if (typeof item == "string") {
        params.UpdateExpression = item;
    } else
    if (typeof item == "object") {
        params.AttributeUpdates = {};
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

                case "string":
                    if (!item[p]) {
                        params.AttributeUpdates[p] = { Action: 'DELETE' };
                        break;
                    }

                default:
                    params.AttributeUpdates[p] = { Action: (options.ops || {})[p] || 'PUT' };
                    params.AttributeUpdates[p].Value = self.toDynamoDB(item[p], 1);
                    break;
            }
        }
    }
    this.queryDDB('UpdateItem', params, options, function(err, rc) {
        rc.Item = rc.Attributes ? self.fromDynamoDB(rc.Attributes) : {};
        if (callback) callback(err, rc);
    });
}

// Delete an item from a table
// - keys is an object with name: value for hash/range attributes
// - options may contain any valid native property if it starts with capital letter and the following special options:
//      - expr - condition expression
//      - values - an object with values map to be used for in the update and/or condition expressions, to be used
//          for ExpressionAttributeValues parameters
//      - names - an object with a map to be used for attribute names in condition and update expressions, to be used
//          for ExpressionAttributeNames parameter
//
// Example:
//
//          ddbDeleteItem("users", { id: 1, name: "john" }, {})
//
aws.ddbDeleteItem = function(name, keys, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {};
    var params = { TableName: name, Key: {} };
    for (var p in keys) {
        params.Key[p] = self.toDynamoDB(keys[p]);
    }
    if (options.expr) {
        params.ConditionExpression = options.expr;
    }
    if (options.names) {
        params.ExpressionAttributeNames = self.toDynamoDB(options.names);
    }
    if (options.values) {
        params.ExpressionAttributeValues = self.toDynamoDB(options.values);
    }
    this.queryDDB('DeleteItem', params, options, function(err, rc) {
        rc.Item = rc.Attributes ? self.fromDynamoDB(rc.Attributes) : {};
        if (callback) callback(err, rc);
    });
}

// Update items from the list at the same time
// - items is a list of objects with table name as property and list of operations, an operation can be PutRequest or DeleteRequest
// - options may contain any valid native property if it starts with capital letter.
//
// Example:
//
//          { table: [ { PutRequest: { id: 1, name: "tt" } }, ] }
aws.ddbBatchWriteItem = function(items, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {};
    var params = { RequestItems: {} };
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
}

// Retrieve all items for given list of keys
// - items is an object with table name as property name and list of options for GetItem request
// - options may contain any valid native property if it starts with capital letter.
//
// Example:
//
//          { users: { keys: [{ id: 1, name: "john" },{ id: .., name: .. }], select: ['name','id'], consistent: true }, ... }
aws.ddbBatchGetItem = function(items, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {};
    var params = { RequestItems: {} };
    for (var p in items) {
        var obj = {};
        obj.Keys = items[p].keys.map(function(x) { return self.toDynamoDB(x); });
        if (items[p].select) obj.AttributesToGet = core.strSplit(items[p].select);
        if (items[p].consistent) obj.ConsistentRead = true;
        params.RequestItems[p] = obj;
    }
    this.queryDDB('BatchGetItem', params, options, function(err, rc) {
        for (var p in rc.Responses) {
            rc.Responses[p] = self.fromDynamoDB(rc.Responses[p]);
        }
        if (callback) callback(err, rc);
    });
}


// Retrieve one item by primary key
//  - keys - an object with primary key attributes name and value.
//  - select - list of columns to return, otherwise all columns will be returned
//  - options may contain any native property allowed in the request or special properties:
//    - consistent - set consistency level for the request
//    - projection - projection expression
//    - names - an object with a map to be used for attribute names in condition and update expressions, to be used
//        for ExpressionAttributeNames parameter
// Example:
//
//       ddbGetItem("users", { id: 1, name: "john" }, { select: 'id,name' })
//
aws.ddbGetItem = function(name, keys, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {};
    var params = { TableName: name, Key: {} };
    if (options.select) {
        params.AttributesToGet = core.strSplit(options.select);
    }
    if (options.names) {
        params.ExpressionAttributeNames = self.toDynamoDB(options.names);
    }
    if (options.projection) {
        params.ProjectionExpression = options.projection;
    }
    if (options.consistent) {
        params.ConsistentRead = true;
    }
    for (var p in keys) {
        params.Key[p] = self.toDynamoDB(keys[p]);
    }
    this.queryDDB('GetItem', params, options, function(err, rc) {
        rc.Item = rc.Item ? self.fromDynamoDB(rc.Item) : null;
        if (callback) callback(err, rc);
    });
}

// Query on a table, return all matching items
// - condition is an object with name: value pairs, by default EQ opeartor is used for comparison
// - options may contain any valid native property if it starts with capital letter or special property:
//      - start - defines starting primary key when paginating, can be a string/number for hash or an object with hash/range properties
//      - consistent - set consistency level for the request
//      - select - list of attributes to get only
//      - total - return number of matching records
//      - count - limit number of record in result
//      - desc - descending order
//      - sort - index name to use, indexes are named the same as the corresponding column, with index primary keys for Keycondition will be used
//      - ops - an object with operators to be used for properties if other than EQ.
//      - keys - list of primary key columns, if there are other properties in the condition then they will be
//               put into QueryFilter instead of KeyConditions. If keys is absent, all properties in the condition are treated as primary keys.
//      - projection - projection expression
//      - values - an object with values map to be used for in the update and/or condition expressions, to be used
//          for ExpressionAttributeValues parameters
//      - names - an object with a map to be used for attribute names in condition and update expressions, to be used
//          for ExpressionAttributeNames parameter
//      - expr - filtering expression
//
// Example:
//
//          aws.ddbQueryTable("users", { id: 1, name: "john" }, { select: 'id,name', ops: { name: 'gt' } })
//          aws.ddbQueryTable("users", { id: 1, name: "john", status: "ok" }, { keys: ["id"], select: 'id,name', ops: { name: 'gt' } })
//          aws.ddbQueryTable("users", { id: 1 }, { expr: "status=:s", values: { s: "status" } })
//
aws.ddbQueryTable = function(name, condition, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {};
    var params = { TableName: name, KeyConditions: {} };
    if (options.names) {
        params.ExpressionAttributeNames = self.toDynamoDB(options.names);
    }
    if (options.values) {
        params.ExpressionAttributeValues = self.toDynamoDB(options.values);
    }
    if (options.projection) {
        params.ProjectionExpression = options.projection;
    }
    if (options.expr) {
        params.FilterExpression = options.expr;
    }
    if (options.consistent) {
        params.ConsistentRead = true;
    }
    if (options.start) {
        params.ExclusiveStartKey = self.toDynamoDB(options.start);
    }
    if (options.sort) {
        params.IndexName = (options.sort.length > 2 ? '' : '_') + options.sort;
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
    if (Array.isArray(options.keys)) {
        var keys = Object.keys(condition).filter(function(x) { return options.keys.indexOf(x) > -1}).reduce(function(x,y) {x[y] = condition[y]; return x; }, {});
        var filter = Object.keys(condition).filter(function(x) { return options.keys.indexOf(x) == -1}).reduce(function(x,y) {x[y] = condition[y]; return x; }, {});
        params.KeyConditions = this.queryFilter(keys, options);
        params.QueryFilter = this.queryFilter(filter, options);
    } else {
        params.KeyConditions = this.queryFilter(condition, options);
    }

    this.queryDDB('Query', params, options, function(err, rc) {
        rc.Items = rc.Items ? self.fromDynamoDB(rc.Items) : [];
        if (callback) callback(err, rc);
    });
}

// Scan a table for all matching items
// - condition is an object with name: value pairs or a string with FilterExpression
// - options may contain any valid native property if it starts with capital letter or special property:
//      - start - defines starting primary key
//      - ops - an object with operators to be used for properties if other than EQ.
//      - projection - projection expression
//      - values - an object with values map to be used for in the update and/or condition expressions, to be used
//          for ExpressionAttributeValues parameters
//      - names - an object with a map to be used for attribute names in condition and update expressions, to be used
//          for ExpressionAttributeNames parameter
//
// Example:
//
//          aws.ddbScanTable("users", { id: 1, name: 'a' }, { ops: { name: 'gt' }})
//          aws.ddbScanTable("users", "id=:id AND name=:name", { values: { id: 1, name: 'a' } });
//
aws.ddbScanTable = function(name, condition, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {};
    var params = { TableName: name, ScanFilter: {} };
    if (options.projection) {
        params.ProjectionExpression = options.projection;
    }
    if (options.names) {
        params.ExpressionAttributeNames = self.toDynamoDB(options.names);
    }
    if (options.values) {
        params.ExpressionAttributeValues = self.toDynamoDB(options.values);
    }
    if (options.consistent) {
        params.ConsistentRead = true;
    }
    if (options.start) {
        params.ExclusiveStartKey = self.toDynamoDB(options.start);
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
    if (typeof condition == "string") {
        params.FilterExpression = options.filterExpr;
    } else {
        params.ScanFilter = this.queryFilter(condition, options)
    }

    this.queryDDB('Scan', params, options, function(err, rc) {
        rc.Items = rc.Items ? self.fromDynamoDB(rc.Items) : [];
        if (callback) callback(err, rc);
    });
}
