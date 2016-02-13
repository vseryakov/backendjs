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
var lib = require(__dirname + '/lib');
var bkutils = require('bkjs-utils');

var aws = {
    name: 'aws',
    args: [ { name: "key", descr: "AWS access key" },
            { name: "secret", descr: "AWS access secret" },
            { name: "region", descr: "AWS region" },
            { name: "zone", descr: "AWS availability zone" },
            { name: "sdk-profile", descr: "AWS SDK profile to use when reading credentials file" },
            { name: "ddb-read-capacity", type: "int", min: 1, descr: "Default DynamoDB read capacity for all tables" },
            { name: "ddb-write-capacity", type: "int", min: 1, descr: "Default DynamoDB write capacity for all tables" },
            { name: "sns-app-arn", descr: "SNS Platform application ARN to be used for push notifications" },
            { name: "key-name", descr: "AWS instance keypair name for remote job instances or other AWS commands" },
            { name: "elb-name", descr: "AWS ELB name to be registered with on start up or other AWS commands" },
            { name: "elastic-ip", descr: "AWS Elastic IP to be associated on start" },
            { name: "iam-profile", descr: "IAM instance profile name for instances or commands" },
            { name: "image-id", descr: "AWS image id to be used for instances or commands" },
            { name: "subnet-id", descr: "AWS subnet id to be used for instances or commands" },
            { name: "vpc-id", descr: "AWS VPC id to be used for instances or commands" },
            { name: "group-id", array: 1, descr: "AWS security group(s) to be used for instances or commands" },
            { name: "instance-type", descr: "AWS instance type to launch on demand" },
    ],
    key: process.env.AWS_ACCESS_KEY_ID,
    secret: process.env.AWS_SECRET_ACCESS_KEY,
    instanceType: "t1.micro",
    tokenExpiration: 0,
    amiProfile: "",
    instance: {},
    tags: [],
};

module.exports = aws;

// Initialization of metadata
aws.configure = function(options, callback)
{
    // Do not retrieve metadata if not running inside important process
    if (os.platform() != "linux" || options.noConfigure || ["shell","web","master","worker"].indexOf(core.role) == -1) {
        if (!this.key) return this.readCredentials(this.sdkProfile, callback);
        return callback();
    }
    var self = this;
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

    var opts = lib.cloneObj(options, "retryCount", options.retryCount || 3, "retryOnError", 1);
    lib.parallel([
       function(next) {
           // Set new tag if not set yet or it follows our naming convention, reboot could have launched a new app version so we set it
           if (core.instance.tag && !String(core.instance.tag).match(/^([a-z]+)-(a-z)-([0-9\.]+)$/i)) return next();
           self.ec2CreateTags(core.instance.id, core.runMode + "-" + core.appName + "-" + core.appVersion, opts, function() { next() });
       },
       function(next) {
           if (!self.elbName) return next();
           self.elbRegisterInstances(self.elbName, core.instance.id, opts, function() { next() });
       },
       function(next) {
           if (!self.elasticIp) return next();
           opts.subnetId = self.SubnetId || self.instance.subnetId;
           if (!opts.subnetId) return next();
           self.ec2AssociateAddress(core.instance.id, self.elasticIp, opts, function() { next() });
       },
    ], callback);
}

// Read key and secret from the AWS SDK credentials file, if no profile is given in the config or command line only tge default peofile
// will be loaded.
aws.readCredentials = function(profile, callback)
{
    var self = this;
    if (typeof profile == "function") callback = profile, profile = null;

    fs.readFile(process.env.HOME + "/.aws/credentials", function(err, data) {
        if (data && data.length) {
            var state = 0, lines = data.toString().split("\n");
            for (var i = 0; i < lines.length; i++) {
                var x = lines[i].split("=");
                if (state == 0) {
                    if (!profile) profile = "default";
                    if (x[0][0] == '[' && profile == x[0].substr(1, x[0].length - 2)) state = 1;
                } else

                if (state == 1) {
                    if (x[0][0] == '[') break;
                    if (x[0].trim() == "aws_access_key_id" && x[1] && !self.key) self.key = x[1].trim();
                    if (x[0].trim() == "aws_secret_access_key" && x[1] && !self.secret) self.secret = x[1].trim();
                    if (x[0].trim() == "region" && x[1] && !self.region) self.region = x[1].trim();
                }
            }
            logger.debug('readCredentials:', self.region, self.key, self.secret);
        }
        if (typeof callback == "function") callback();
    });
}

// Retrieve instance meta data
aws.getInstanceMeta = function(path, callback)
{
    core.httpGet("http://169.254.169.254" + path, { httpTimeout: 100, quiet: true, retryOnError: function() { return this.status >= 400 && this.status != 404 }, retryCount: 2, retryTimeout: 100 }, function(err, params) {
        logger.debug('getInstanceMeta:', path, params.status, params.data, err || "");
        if (typeof callback == "function") callback(err, params.status == 200 ? params.data : "");
    });
}

// Retrieve instance credentials using EC2 instance profile and setup for AWS access
aws.getInstanceCredentials = function(callback)
{
    if (!this.amiProfile) return typeof callback == "function" && callback();

    var self = this;
    this.getInstanceMeta("/latest/meta-data/iam/security-credentials/" + self.amiProfile, function(err, data) {
        if (!err && data) {
            var obj = lib.jsonParse(data, { datatype: "obj" });
            if (obj.Code === 'Success') {
                self.key = obj.AccessKeyId;
                self.secret = obj.SecretAccessKey;
                self.securityToken = obj.Token;
                self.tokenExpiration = lib.toDate(obj.Expiration).getTime();
            }
        }
        // Refresh if not set or expire soon
        var timeout = Math.min(self.tokenExpiration - Date.now(), 3600000);
        if (timeout <= 15000) timeout = 500; else timeout -= 15000;
        logger.debug("getInstanceCredentials:", self.key, lib.strftime(self.tokenExpiration), "interval:", lib.toDuration(self.tokenExpiration - Date.now()), "timeout:", timeout);
        setTimeout(self.getInstanceCredentials.bind(self), timeout);

        if (typeof callback == "function") callback(err);
    });
}

// Retrieve instance launch index from the meta data if running on AWS instance
aws.getInstanceInfo = function(callback)
{
    var self = this;

    lib.series([
        function(next) {
            self.getInstanceMeta("/latest/meta-data/instance-id", function(err, data) {
                if (!err && data) core.instance.id = data, core.instance.type = "aws";
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
                if (!err && data) core.instance.index = lib.toNumber(data);
                next(err);
            });
        },
        function(next) {
            self.getInstanceMeta("/latest/user-data", function(err, data) {
                if (!err && data && data[0] == "-") core.parseArgs(bkutils.strSplit(data, " ", '"\''));
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
            var opts = { retryCount: 2, retryOnError: 1 }
            self.queryEC2("DescribeInstances", { 'Filter.1.Name': 'instance-id', 'Filter.1.Value.1': core.instance.id }, opts, function(err, rc) {
                if (!err) self.instance = lib.objGet(rc, "DescribeInstancesResponse.reservationSet.item.instancesSet.item", { obj: 1 });
                if (!err) self.tags = lib.objGet(self.instance, "tagSet.item", { list: 1 });
                if (!core.instance.tag) core.instance.tag = self.tags.filter(function(x) { return x.key == "Name" }).map(function(x) { return x.value }).join(",");
                next();
            });
        },
    ], function(err) {
        logger.debug('getInstanceInfo:', self.name, core.instance, 'profile:', self.amiProfile, 'expire:', self.tokenExpiration, err || "");
        if (typeof callback == "function") callback();
    });
}

// Parse AWS response and try to extract error code and message, convert XML into an object.
aws.parseXMLResponse = function(err, params, options, callback)
{
    if (typeof callback != "function") callback = lib.noop;
    if (err || !params.data) return callback(err);
    if (!params.obj) params.obj = lib.xmlParse(params.data);
    if (params.obj === null) params.status += 1000;
    if (params.status != 200) {
        var errors = lib.objGet(params.obj, "Response.Errors.Error", { list: 1 });
        if (errors.length && errors[0].Message) {
            err = lib.newError({ message: errors[0].Message, code: errors[0].Code, status: params.status });
        } else
        if (params.obj.Error && params.obj.Error.Message) {
            err = lib.newError({ message: params.obj.Error.Message, code: params.obj.Error.Code, status: params.status });
        }
        if (!err) err = lib.newError({ message: "Error: " + params.data, status: params.status });
        logger.logger((options && options.logger_error) || "error", 'queryAWS:', params.href, params.search, params.Action || "", err, params.toJSON());
        return callback(err, params.obj);
    }
    logger.debug('queryAWS:', params.href, params.search, params.Action || "", params.obj, params.toJSON());
    callback(err, params.obj);
}

// Build version 4 signature headers
aws.querySign = function(region, service, host, method, path, body, headers)
{
    var self = this;
    var now = new Date();
    var date = now.toISOString().replace(/[:\-]|\.\d{3}/g, '');
    var datetime = date.substr(0, 8);

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
    var canonString = [ method, pathParts[0] || '/', pathParts[1] || '', canonHeaders + '\n', signedHeaders, lib.hash(body || '', "sha256", "hex")].join('\n');

    var strToSign = [ 'AWS4-HMAC-SHA256', date, credString, lib.hash(canonString, "sha256", "hex") ].join('\n');
    var kDate = lib.sign('AWS4' + this.secret, datetime, "sha256", "binary");
    var kRegion = lib.sign(kDate, region, "sha256", "binary");
    var kService = lib.sign(kRegion, service, "sha256", "binary");
    var kCredentials = lib.sign(kService, 'aws4_request', "sha256", "binary");
    var sig = lib.sign(kCredentials, strToSign, "sha256", "hex");
    headers['Authorization'] = [ 'AWS4-HMAC-SHA256 Credential=' + this.key + '/' + credString, 'SignedHeaders=' + signedHeaders, 'Signature=' + sig ].join(', ');
}

// Return a request object ready to be sent to AWS, properly formatted
aws.queryPrepare = function(action, version, obj, options)
{
    var req = { Action: action, Version: version };
    for (var p in obj) req[p] = obj[p];
    // All capitalized options are passed as is and take priority because they are in native format
    for (var p in options) if (p[0] >= 'A' && p[0] <= 'Z' && typeof options[p] != "undefined" && options[p] !== null && options[p] !== "") req[p] = options[p];
    return req;
}

aws.queryOptions = function(method, data, headers, options)
{
    if (!options) options = lib.empty;
    return {
        method: method || options.method || "POST",
        postdata: data,
        headers: headers,
        quiet: options.quiet || options.silence_error || options.ignore_error,
        retryCount: options.retryCount,
        retryTimeout: options.retryTimeout,
        retryOnError: options.retryOnError,
        httpTimeout: options.httpTimeout,
    };
}

// Make AWS request, return parsed response as Javascript object or null in case of error
aws.queryAWS = function(region, endpoint, proto, host, path, obj, options, callback)
{
    var self = this;

    var headers = {}, params = [], query = "";
    for (var p in obj) {
        if (typeof obj[p] != "undefined" && obj[p] !== null && obj[p] !== "") params.push([p, obj[p]]);
    }
    params.sort();
    for (var i = 0; i < params.length; i++) {
        query += (i ? "&" : "") + params[i][0] + "=" + lib.encodeURIComponent(params[i][1]);
    }
    this.querySign(region, endpoint, host, "POST", path, query, headers);

    core.httpGet(url.format({ protocol: proto, host: host, pathname: path }), this.queryOptions("POST", query, headers, options), function(err, params) {
        // For error logging about the current request
        params.Action = obj;
        self.parseXMLResponse(err, params, options, callback);
    });
}

// AWS generic query interface
aws.queryEndpoint = function(endpoint, version, action, obj, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = lib.empty;
    var region = options.region || this.region  || 'us-east-1';
    var e = options.endpoint ? url.parse(options.endpoint) : null;
    var proto = options.endpoint_protocol || (e && e.protocol) || 'https';
    var host = options.endpoint_host || (e && e.host) || (endpoint + '.' + region + '.amazonaws.com');
    var path = options.endpoint_path || (e && e.hostname) || '/';
    var req = this.queryPrepare(action, version, obj, options);
    this.queryAWS(region, endpoint, proto, host, path, req, options, callback);
}


// AWS SQS API request
aws.querySQS = function(action, obj, options, callback)
{
    this.queryEndpoint("sqs", '2012-11-05', action, obj, options, callback);
}

// AWS SNS API request
aws.querySNS = function(action, obj, options, callback)
{
    this.queryEndpoint("sns", '2010-03-31', action, obj, options, callback);
}

// AWS SES API request
aws.querySES = function(action, obj, options, callback)
{
    this.queryEndpoint("email", '2010-12-01', action, obj, options, callback);
}

// AWS CFN API request
aws.queryCFN = function(action, obj, options, callback)
{
    this.queryEndpoint("cloudformation", '2010-05-15', action, obj, options, callback);
}

// AWS CloudWatch API request
aws.queryCW = function(action, obj, options, callback)
{
    this.queryEndpoint("monitoring", '2010-08-01', action, obj, options, callback);
}

// AWS Elastic Cache API request
aws.queryElastiCache = function(action, obj, options, callback)
{
    this.queryEndpoint("elasticache", '2014-09-30', action, obj, options, callback);
}

// AWS Autoscaling API request
aws.queryAS = function(action, obj, options, callback)
{
    this.queryEndpoint("autoscaling", '2011-01-01', action, obj, options, callback);
}

// Make a request to Route53 service
aws.queryRoute53 = function(method, path, data, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = lib.empty;

    var curTime = new Date().toUTCString();
    var uri = "https://route53.amazonaws.com/2013-04-01" + path;
    var headers = { "x-amz-date": curTime, "content-type": "text/xml; charset=UTF-8", "content-length": data.length };
    headers["X-Amzn-Authorization"] = "AWS3-HTTPS AWSAccessKeyId=" + this.key + ",Algorithm=HmacSHA1,Signature=" + lib.sign(this.secret, curTime);

    core.httpGet(uri, this.query.options(method, data, headers, options), function(err, params) {
        self.parseXMLResponse(err, params, options, callback);
    });
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
    if (typeof callback != "function") callback = lib.noop;
    if (!options) options = {};

    var params = { QueueUrl: url };
    if (options.count) params.MaxNumberOfMessages = options.count;
    if (options.visibilityTimeout) params.VisibilityTimeout = options.visibilityTimeout;
    if (options.timeout) params.WaitTimeSeconds = options.timeout;
    this.querySQS("ReceiveMessage", params, options, function(err, obj) {
        var rows = [];
        if (!err) rows = lib.objGet(obj, "ReceiveMessageResponse.ReceiveMessageResult.Message", { list: 1 });
        callback(err, rows);
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
    if (typeof callback != "function") callback = lib.noop;
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
        if (!err) rows = lib.objGet(obj, "ReceiveMessageResponse.ReceiveMessageResult.Message", { list: 1 });
        callback(err, rows);
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
    if (typeof callback != "function") callback = lib.noop;
    if (!options) options = {};

    var params = { PlatformApplicationArn: options.appArn || self.snsAppArn, Token: token };
    if (options.data) params.CustomUserData = options.data;

    this.querySNS("CreatePlatformEndpoint", params, options, function(err, obj) {
        var arn = null;
        if (!err) arn = lib.objGet(obj, "CreatePlatformEndpointResponse.CreatePlatformEndpointResult.EndpointArn", { str: 1 });
        callback(err, arn);
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
    if (typeof callback != "function") callback = lib.noop;
    if (!options) options = {};

    var params = { Name: name };
    this.querySNS("CreateTopic", params, options, function(err, obj) {
        var arn = null;
        if (!err) arn = lib.objGet(obj, "CreateTopicResponse.CreateTopicResult.TopicArn", { str: 1 });
        callback(err, arn);
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
    if (typeof callback != "function") callback = lib.noop;
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
            params.AttributeValue = JSON.stringify(lib.newObj(options.protocol, policy));
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
// confirmation the arn returned will be null and a token will be sent to the endpoint for confirmation.
aws.snsSubscribe = function(arn, endpoint, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (typeof callback != "function") callback = lib.noop;
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
        if (!err) arn = lib.objGet(obj, "SubscribeResponse.SubscribeResult.SubscriptionArn", { str: 1 });
        callback(err, arn);
    });
}

// Verifies an endpoint owner's intent to receive messages by validating the token sent to the
// endpoint by an earlier Subscribe action. If the token is valid, the action creates a new subscription
// and returns its Amazon Resource Name (ARN) in the callback.
aws.snsConfirmSubscription = function(arn, token, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (typeof callback != "function") callback = lib.noop;
    if (!options) options = {};

    var params = { TopicARN: arn, Token: token };
    this.querySNS("ConfirmSubscription", params, options, function(err, obj) {
        var arn = null;
        if (!err) arn = lib.objGet(obj, "SubscribeResponse.SubscribeResult.SubscriptionArn", { str: 1 });
        callback(err, arn);
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

// Creates a topic to which notifications can be published. The callback returns topic ARN on success.
aws.snsListTopics = function(options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    var params = {};
    this.querySNS("ListTopics", params, options, function(err, rc) {
        var list = lib.objGet(rc, "ListTopicsResponse.ListTopicsResult.Topics.member", { list: 1 });
        if (typeof callback == "function") return callback(err, list.map(function(x) { return x.TopicArn }));
    });
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
    lib.strSplit(to).forEach(function(x, i) { params["Destination.ToAddresses.member." + (i + 1)] = x; })
    if (options.cc) lib.strSplit(options.cc).forEach(function(x, i) { params["Destination.CcAddresses.member." + (i + 1)] = x; })
    if (options.bcc) lib.strSplit(options.bcc).forEach(function(x, i) { params["Destination.BccAddresses.member." + (i + 1)] = x; })
    if (options.replyTo) lib.strSplit(options.replyTo).forEach(function(x, i) { params["ReplyToAddresses.member." + (i + 1)] = x; })
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
    if (options.to) lib.strSplit(options.to).forEach(function(x, i) { params["Destinations.member." + (i + 1)] = x; })
    this.querySES("SendRawEmail", params, options, callback);
}

// Creates or updates an alarm and associates it with the specified Amazon CloudWatch metric.
// The options specify the following:
//  - name - alarm name, if not specified metric name and dimensions will be used to generate alarm name
//  - metric - metric name, default is `CPUUtilization`
//  - namespace - AWS namespace, default is `AWS/EC2`
//  - op - comparison operator, one of => | <= | > | < | GreaterThanOrEqualToThreshold | GreaterThanThreshold | LessThanThreshold | LessThanOrEqualToThreshold. Default is `>=`.
//  - statistic - one of SampleCount | Average | Sum | Minimum | Maximum, default is `Average`
//  - period - collection period in seconds, default is `60`
//  - evaluationPeriods - the number of periods over which data is compared to the specified threshold, default is `15`
//  - threshold - the value against which the specified statistic is compared, default is `90`
//  - ok - ARN(s) to be notified on OK state
//  - alarm - ARN(s) to be notified on ALARM state
//  - insufficient_data - ARN(s) to be notified on INSUFFICIENT_DATA state
//  - dimensions - the dimensions for the alarm's associated metric.
aws.cwPutMetricAlarm = function(options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    var ops = { ">=" : "GreaterThanOrEqualToThreshold", ">": "GreaterThanThreshold", "<": "LessThanThreshold", "<=": "LessThanOrEqualToThreshold" };
    var metric = options.metric || "CPUUtilization";
    var namespace = options.namespace || "AWS/EC2";

    var params = {
        AlarmName: options.name || (namespace + ": " + metric + " " + JSON.stringify(options.dimensions || "").replace(/["{}]/g, "")),
        MetricName: metric,
        Namespace: namespace,
        ComparisonOperator: ops[options.op] || options.op || "GreaterThanOrEqualToThreshold",
        Period: options.period || 60,
        EvaluationPeriods: options.evaluationPeriods || 15,
        Threshold: options.threshold || 90,
        Statistic: options.statistic || "Average"
    }
    var i = 1;
    for (var p in options.dimensions) {
        params["Dimensions.member." + i + ".Name"] = p;
        params["Dimensions.member." + i + ".Value"] = options.dimensions[p];
        i++;
    }
    lib.strSplit(options.ok).forEach(function(x, i) { params["OKActions.member." + (i + 1)] = x; });
    lib.strSplit(options.alarm).forEach(function(x, i) { params["AlarmActions.member." + (i + 1)] = x; });
    lib.strSplit(options.insufficient_data).forEach(function(x, i) { params["InsufficientDataActions.member." + (i + 1)] = x; });

    this.queryCW("PutMetricAlarm", params, options, callback);
}

// Return metrics for the given query, the options can be specified:
//  - name - a metric name
//  - namespace - limit by namespace: AWS/AutoScaling, AWS Billing, AWS/CloudFront, AWS/DynamoDB, AWS/ElastiCache, AWS/EBS, AWS/EC2, AWS/ELB, AWS/ElasticMapReduce, AWS/Kinesis, AWS/OpsWorks, AWS/Redshift, AWS/RDS, AWS/Route53, AWS/SNS, AWS/SQS, AWS/SWF, AWS/StorageGateway
aws.cwListMetrics = function(options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    var params = {};
    if (options.name) params.MetricName = options.name;
    if (options.namespace) params.Namespace = options.namespace;
    var i = 1;
    for (var p in options.dimensions) {
        params["Dimensions.member." + i + ".Name"] = p;
        params["Dimensions.member." + i + ".Value"] = options.dimensions[p];
        i++;
    }
    this.queryCW("ListMetrics", params, options, function(err, rc) {
        var rows = lib.objGet(rc, "ListMetricsResponse.ListMetricsResult.Metrics.member", { list: 1 });
        if (typeof callback == "function") callback(err, rows);
    });
}

