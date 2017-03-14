//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Feb 2012
//

var util = require('util');
var http = require('http');
var url = require('url');
var path = require('path');
var qs = require('qs');
var fs = require('fs');
var os = require('os');
var mime = require('mime');
var cluster = require('cluster');
var logger = require(__dirname + '/logger');
var core = require(__dirname + '/core');
var lib = require(__dirname + '/lib');

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
            { name: "host-name", type: "list", descr: "List of hosts to update in Route54 zone with the current private IP address, hosts must be in FQDN format" },
            { name: "iam-profile", descr: "IAM instance profile name for instances or commands" },
            { name: "image-id", descr: "AWS image id to be used for instances or commands" },
            { name: "subnet-id", descr: "AWS subnet id to be used for instances or commands" },
            { name: "vpc-id", descr: "AWS VPC id to be used for instances or commands" },
            { name: "group-id", array: 1, descr: "AWS security group(s) to be used for instances or commands" },
            { name: "instance-type", descr: "AWS instance type to launch on demand" },
    ],
    key: process.env.AWS_ACCESS_KEY_ID,
    secret: process.env.AWS_SECRET_ACCESS_KEY,
    tokenExpiration: 0,
    amiProfile: "",
    // Current instance details
    instance: {},
    tags: [],
    // Known process roles that need instance metadata
    roles: ["shell","web","master","server","worker","process"],
    // Supported regions per service
    regions: { email: ["us-east-1","us-west-2","eu-west-1"] },
    _sigCache: { map: {}, list: [] },
};

module.exports = aws;

// Initialization of metadata
aws.configure = function(options, callback)
{
    // Do not retrieve metadata if not running inside known processes
    if (os.platform() != "linux" || options.noConfigure || this.roles.indexOf(core.role) == -1) {
        if (!this.key) return this.readCredentials(this.sdkProfile, callback);
        return callback();
    }
    this.getInstanceInfo(function() {
        if (!aws.key) return aws.readCredentials(aws.sdkProfile, callback);
        callback();
    });
}

// Execute on Web server startup
aws.configureServer = function(options, callback)
{
    // Make sure we are running on EC2 instance
    if (!core.instance.id || !core.instance.image) return callback();

    var opts = lib.objClone(options, "retryCount", options.retryCount || 3, "retryOnError", 1);
    lib.parallel([
       function(next) {
           if (!aws.elbName) return next();
           aws.elbRegisterInstances(aws.elbName, core.instance.id, opts, function() { next() });
       },
    ], callback);
}

// Execute on master server startup
aws.configureMaster = function(options, callback)
{
    // Make sure we are running on EC2 instance
    if (!core.instance.id || !core.instance.image) return callback();

    var opts = lib.objClone(options, "retryCount", options.retryCount || 3, "retryOnError", 1);
    lib.parallel([
       function(next) {
           // Set new tag if not set yet or it follows our naming convention, reboot could have launched a new app version so we set it
           if (core.instance.tag && !String(core.instance.tag).match(/^([a-z]+)-(a-z)-([0-9\.]+)$/i)) return next();
           aws.ec2CreateTags(core.instance.id, core.runMode + "-" + core.appName + "-" + core.appVersion, opts, function() { next() });
       },
       function(next) {
           opts.subnetId = aws.SubnetId || aws.instance.subnetId;
           if (!aws.elasticIp || !opts.subnetId) return next();
           aws.ec2AssociateAddress(core.instance.id, aws.elasticIp, opts, function() { next() });
       },
       function(next) {
           if (!aws.hostName || !core.ipaddr) return next();
           aws.route53Change(aws.hostName, function() { next() });
       },
    ], callback);
}

// Read key and secret from the AWS SDK credentials file, if no profile is given in the config or command line only tge default peofile
// will be loaded.
aws.readCredentials = function(profile, callback)
{
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
                    if (x[0].trim() == "aws_access_key_id" && x[1] && !aws.key) aws.key = x[1].trim();
                    if (x[0].trim() == "aws_secret_access_key" && x[1] && !aws.secret) aws.secret = x[1].trim();
                    if (x[0].trim() == "region" && x[1] && !aws.region) aws.region = x[1].trim();
                }
            }
            logger.debug('readCredentials:', aws.region, aws.key, aws.secret);
        }
        if (typeof callback == "function") callback();
    });
}

// Retrieve instance meta data
aws.getInstanceMeta = function(path, callback)
{
    var opts = { httpTimeout: 100, quiet: true, retryCount: 2, retryTimeout: 100, retryOnError: function() { return this.status >= 400 && this.status != 404 } };
    core.httpGet("http://169.254.169.254" + path, opts, function(err, params) {
        logger[[200, 404].indexOf(params.status) == -1 ? "error": "debug"]('getInstanceMeta:', path, params.status, params.data, err || "");
        if (typeof callback == "function") callback(err, params.status == 200 ? params.data : "");
    });
}

// Retrieve instance credentials using EC2 instance profile and setup for AWS access
aws.getInstanceCredentials = function(callback)
{
    if (!this.amiProfile) return typeof callback == "function" && callback();

    this.getInstanceMeta("/latest/meta-data/iam/security-credentials/" + this.amiProfile, function(err, data) {
        if (!err && data) {
            var obj = lib.jsonParse(data, { datatype: "obj" });
            if (obj.Code === 'Success') {
                aws.key = obj.AccessKeyId;
                aws.secret = obj.SecretAccessKey;
                aws.securityToken = obj.Token;
                aws.tokenExpiration = lib.toDate(obj.Expiration).getTime();
                logger.debug("getInstanceCredentials:", core.role, aws.key, lib.strftime(aws.tokenExpiration), "interval:", lib.toDuration(aws.tokenExpiration - Date.now()));
            }
        }
        // Refresh if not set or expire soon
        var timeout = Math.min(aws.tokenExpiration - Date.now(), 3600000);
        timeout = timeout < 300000 ? 30000 : timeout <= 30000 ? 1000 : timeout - 300000;
        setTimeout(aws.getInstanceCredentials.bind(aws), timeout);
        if (typeof callback == "function") callback(err);
    });
}

// Retrieve instance launch index from the meta data if running on AWS instance
aws.getInstanceInfo = function(callback)
{
    lib.series([
        function(next) {
            aws.getInstanceMeta("/latest/meta-data/instance-id", function(err, data) {
                if (!err && data) core.instance.id = data, core.instance.type = "aws";
                next(err);
            });
        },
        function(next) {
            aws.getInstanceMeta("/latest/meta-data/ami-id", function(err, data) {
                if (!err && data) core.instance.image = data;
                next(err);
            });
        },
        function(next) {
            aws.getInstanceMeta("/latest/meta-data/ami-launch-index", function(err, data) {
                if (!err && data && lib.toNumber(data)) core.instance.index = lib.toNumber(data);
                next(err);
            });
        },
        function(next) {
            aws.getInstanceMeta("/latest/user-data", function(err, data) {
                if (!err && data && data[0] == "-") core.parseArgs(lib.phraseSplit(data));
                next(err);
            });
        },
        function(next) {
            aws.getInstanceMeta("/latest/meta-data/placement/availability-zone/", function(err, data) {
                if (!err && data) aws.zone = data;
                if (aws.zone && !core.instance.zone) core.instance.zone = aws.zone;
                if (aws.zone && !core.instance.region) core.instance.region = aws.zone.slice(0, -1);
                if (!aws.region && data) aws.region = data.slice(0, -1);
                next(err);
            });
        },
        function(next) {
            aws.getInstanceMeta("/latest/meta-data/iam/security-credentials/", function(err, data) {
                if (!err && data) aws.amiProfile = data;
                next(err);
            });
        },
        function(next) {
            // If access key is configured then skip profile meta
            if (aws.key) return next();
            aws.getInstanceCredentials(next);
        },
        function(next) {
            if (!aws.secret || !core.instance.id) return next();
            var opts = { retryCount: 2, retryOnError: 1 }
            aws.queryEC2("DescribeInstances", { 'Filter.1.Name': 'instance-id', 'Filter.1.Value.1': core.instance.id }, opts, function(err, rc) {
                if (!err) aws.instance = lib.objGet(rc, "DescribeInstancesResponse.reservationSet.item.instancesSet.item", { obj: 1 });
                if (!err) aws.tags = lib.objGet(aws.instance, "tagSet.item", { list: 1 });
                if (!core.instance.tag) core.instance.tag = aws.tags.filter(function(x) { return x.key == "Name" }).map(function(x) { return x.value }).join(",");
                next();
            });
        },
    ], function(err) {
        logger.debug('getInstanceInfo:', aws.name, aws.key, lib.objDescr(core.instance), 'profile:', aws.amiProfile, 'expire:', aws.tokenExpiration, err || "");
        if (typeof callback == "function") callback();
    });
}

aws.parseError = function(params, options)
{
    var err;
    if (params.obj) {
        var errors = lib.objGet(params.obj, "Response.Errors.Error", { list: 1 });
        if (errors.length && errors[0].Message) {
            err = lib.newError({ message: errors[0].Message, code: errors[0].Code, status: params.status });
        } else
        if (params.obj.Error && params.obj.Error.Message) {
            err = lib.newError({ message: params.obj.Error.Message, code: params.obj.Error.Code, status: params.status });
        }
    }
    if (!err) err = lib.newError({ message: "Error " + params.status + " " + params.data, status: params.status });
    return err;
}

// Parse AWS response and try to extract error code and message, convert XML into an object.
aws.parseXMLResponse = function(err, params, options, callback)
{
    if (!err && params.data) {
        if (!params.obj) params.obj = lib.xmlParse(params.data);
        if (params.status != 200) {
            err = this.parseError(params, options);
            logger.logger((options && options.logger_error) || "error", 'queryAWS:', lib.objDescr(params.Action), err, params.toJSON());
        } else {
            logger.debug('queryAWS:', params.href, params.search, params.Action || "", params.obj, params.toJSON());
        }
    }
    if (typeof callback == "function") callback(err, params.obj);
}

aws.uriEscape = function(str)
{
    str = encodeURIComponent(str);
    str = str.replace(/[^A-Za-z0-9_.~\-%]+/g, escape);
    return str.replace(/[!'()*]/g, function(ch) { return '%' + ch.charCodeAt(0).toString(16).toUpperCase() });
}

aws.uriEscapePath = function(path)
{
    return path ? String(path).split('/').map(function(p) { return aws.uriEscape(p) }).join('/') : "/";
}

// Build version 4 signature headers
aws.querySign = function(region, service, host, method, path, body, headers, options)
{
    var now = util.isDate(options && options.now) ? options.now : new Date();
    var isoDate = now.toISOString().replace(/[:\-]|\.\d{3}/g, '');
    var date = isoDate.substr(0, 8);

    headers['Host'] = host;
    headers['X-Amz-Date'] = isoDate;
    if (body && !headers['content-type']) headers['content-type'] = 'application/x-www-form-urlencoded; charset=utf-8';
    if (body && !lib.toNumber(headers['content-length'])) headers['content-length'] = Buffer.byteLength(body, 'utf8');
    if (this.securityToken) headers["x-amz-security-token"] = this.securityToken;
    delete headers.Authorization;

    function trimAll(header) { return header.toString().trim().replace(/\s+/g, ' '); }
    var credStr = [ date, region, service, 'aws4_request' ].join('/');
    var pathParts = path.split('?', 2);
    var signedHeaders = Object.keys(headers).map(function(key) { return key.toLowerCase(); }).sort().join(';');
    var canonHeaders = Object.keys(headers).sort(function(a, b) { return a.toLowerCase() < b.toLowerCase() ? -1 : 1; }).map(function(key) { return key.toLowerCase() + ':' + trimAll(String(headers[key])); }).join('\n');
    var canonStr = [ method, this.uriEscapePath(pathParts[0]), pathParts[1] || '', canonHeaders + '\n', signedHeaders, lib.hash(body || '', "sha256", "hex")].join('\n');
    var strToSign = [ 'AWS4-HMAC-SHA256', isoDate, credStr, lib.hash(canonStr, "sha256", "hex") ].join('\n');

    var sigKey = lib.sign(this.secret, this.key + "," + credStr, "sha256", "hex");
    var kCredentials = this._sigCache.map[sigKey];
    if (!kCredentials) {
        var kDate = lib.sign('AWS4' + this.secret, date, "sha256", "binary");
        var kRegion = lib.sign(kDate, region, "sha256", "binary");
        var kService = lib.sign(kRegion, service, "sha256", "binary");
        kCredentials = lib.sign(kService, 'aws4_request', "sha256", "binary");
        this._sigCache.map[sigKey] = kCredentials;
        this._sigCache.list.push(sigKey);
        if (this._sigCache.list.length > 25) delete this._sigCache.map[this._sigCache.list.shift()];
    }
    var sig = lib.sign(kCredentials, strToSign, "sha256", "hex");
    headers['Authorization'] = [ 'AWS4-HMAC-SHA256 Credential=' + this.key + '/' + credStr, 'SignedHeaders=' + signedHeaders, 'Signature=' + sig ].join(', ');
    if (options) {
        options.date = isoDate;
        options.signedHeaders = signedHeaders;
        options.credential = this.key + '/' + credStr;
        options.canonStr = canonStr;
        options.signature = sig;
    }
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
        quiet: options.quiet,
        retryCount: options.retryCount || 1,
        retryTimeout: options.retryTimeout,
        retryOnError: options.retryOnError || 1,
        httpTimeout: options.httpTimeout,
    };
}

// It is called in the context of a http request
aws.querySigner = function()
{
    aws.querySign(this.region, this.endpoint, this.hostname, this.method, this.pathname, this.postdata, this.headers);
}

// Make AWS request, return parsed response as Javascript object or null in case of error
aws.queryAWS = function(region, endpoint, proto, host, path, obj, options, callback)
{
    var headers = {}, params = [], postdata = "";
    for (var p in obj) {
        if (typeof obj[p] != "undefined" && obj[p] !== null && obj[p] !== "") params.push([p, obj[p]]);
    }
    params.sort();
    for (var i = 0; i < params.length; i++) {
        postdata += (i ? "&" : "") + params[i][0] + "=" + lib.encodeURIComponent(params[i][1]);
    }
    var opts = this.queryOptions("POST", postdata, headers, options);
    opts.region = region;
    opts.endpoint = endpoint;
    opts.signer = this.querySigner;

    core.httpGet(url.format({ protocol: proto, host: host, pathname: path }), opts, function(err, params) {
        // For error logging about the current request
        params.Action = obj;
        aws.parseXMLResponse(err, params, options, callback);
    });
}

// AWS generic query interface
aws.queryEndpoint = function(endpoint, version, action, obj, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = lib.empty;
    var region = options.region || this.region  || 'us-east-1';
    if (this.regions[endpoint] && this.regions[endpoint].indexOf(region) == -1) region = this.regions[endpoint][0];
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
    if (typeof options == "function") callback = options, options = null;

    var headers = { "content-type": "text/xml; charset=UTF-8" };
    var opts = this.queryOptions(method, data, headers, options);
    opts.region = 'us-east-1';
    opts.endpoint = "route53";
    opts.signer = this.querySigner;
    core.httpGet("https://route53.amazonaws.com/2013-04-01" + path, opts, function(err, params) {
        aws.parseXMLResponse(err, params, options, callback);
    });
}

// Make a request to the Rekognition service
aws.queryRekognition = function(action, obj, options, callback)
{
    var headers = { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': "RekognitionService." + action };
    var opts = this.queryOptions("POST", lib.stringify(obj), headers, options);
    opts.region = options && options.region || this.region  || 'us-east-1';
    opts.endpoint = "rekognition";
    opts.signer = this.querySigner;
    core.httpGet("https://rekognition." + opts.region + ".amazonaws.com/", opts, function(err, params) {
        if (params.status != 200) err = aws.parseError(params, options);
        if (typeof callback == "function") callback(err, params.obj);
    });
}

// Receive message(s) from the SQS queue, the callback will receive a list with messages if no error.
// The following options can be specified:
//  - count - how many messages to receive
//  - timeout - how long to wait, in milliseconds, this is for Long Poll
//  - visibilityTimeout - the duration (in milliseconds) that the received messages are hidden from subsequent retrieve requests
//  after being retrieved by a ReceiveMessage request.
aws.sqsReceiveMessage = function(url, options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    var params = { QueueUrl: url };
    if (options) {
        if (options.count) params.MaxNumberOfMessages = options.count;
        if (options.visibilityTimeout > 999) params.VisibilityTimeout = Math.round(options.visibilityTimeout/1000);
        if (options.timeout > 999) params.WaitTimeSeconds = Math.round(options.timeout/1000);
    }
    this.querySQS("ReceiveMessage", params, options, function(err, obj) {
        var rows = [];
        if (!err) rows = lib.objGet(obj, "ReceiveMessageResponse.ReceiveMessageResult.Message", { list: 1 });
        if (typeof callback == "function") callback(err, rows);
    });
}

// Send a message to the SQS queue.
// The options can specify the following:
//  - delay - how long to delay this message in milliseconds
//  - attrs - an object with additional message attributes to send, use only string, numbers or binary values,
//  all other types will be converted into strings
aws.sqsSendMessage = function(url, body, options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    var params = { QueueUrl: url, MessageBody: body };
    if (options) {
        if (options.delay > 999) params.DelaySeconds = Math.round(options.delay/1000);
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
    }
    this.querySQS("SendMessage", params, options, function(err, obj) {
        var rows = [];
        if (!err) rows = lib.objGet(obj, "ReceiveMessageResponse.ReceiveMessageResult.Message", { list: 1 });
        if (typeof callback == "function") callback(err, rows);
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
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = lib.empty;

    var params = { "Message.Subject.Data": subject, "Message.Subject.Charset": options.charset || "UTF-8" };
    params["Message.Body." + (options.html ? "Html" : "Text") + ".Data"] = body;
    params["Message.Body." + (options.html ? "Html" : "Text") + ".Charset"] = options.charset || "UTF-8";
    params["Source"] = options.from || core.emailFrom || ("admin" + "@" + core.domain);
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
    if (typeof options == "function") callback = options, options = null;

    var params = { "RawMessage.Data": body };
    if (options) {
        if (options.from) params["Source"] = options.from;
        if (options.to) lib.strSplit(options.to).forEach(function(x, i) { params["Destinations.member." + (i + 1)] = x; })
    }
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
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = lib.empty;

    var ops = { ">=" : "GreaterThanOrEqualToThreshold", ">": "GreaterThanThreshold", "<": "LessThanThreshold", "<=": "LessThanOrEqualToThreshold" };
    var metric = options.metric || "CPUUtilization";
    var namespace = options.namespace || "AWS/EC2";

    var params = {
        AlarmName: options.name || (namespace + ": " + metric + " " + lib.stringify(options.dimensions || "").replace(/["{}]/g, "")),
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

// Create or update a host in the Route53 database.
// - `names` is a host name to be set with the current IP address or a list with objects in the format
//       [ { name: "..", value: "1.1.1.1", type: "A", ttl: 300 } ...]
//
// The `options` may contain the following:
//  - type - default record type, A
//  - ttl - default TTL, 300 seconds
//  - op - an operation, default is UPSERT
aws.route53Change = function(names, options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    if (!Array.isArray(names)) names = [ names ];

    aws.queryRoute53("GET", "/hostedzone", "", function(err, rc) {
        var zones = lib.objGet(rc, "ListHostedZonesResponse.HostedZones.HostedZone", { list: 1 });

        lib.forEachSeries(names, function(host, next) {
            if (typeof host != "object") {
                host = { name: host, value: core.ipaddr };
            }
            var type = host.type || (options && options.type) || "A";
            var domain = lib.strSplit(host.name, ".").slice(1).join(".") + ".";
            var zoneId = zones.filter(function(x) { return x.Name == domain }).map(function(x) { return x.Id }).pop();
            if (!zoneId) {
                if (!options || !options.quiet) err = lib.newError("zone not found for " + host);
                return callback && callback(err);
            }
            var values = Array.isArray(host.value) ? host.value : [host.value];
            var alias = host.alias || (options && options.alias);
            if (alias) {
                var req = '<?xml version="1.0" encoding="UTF-8"?>' +
                        '<ChangeResourceRecordSetsRequest xmlns="https://route53.amazonaws.com/doc/2013- 04-01/">' +
                        ' <ChangeBatch>' +
                        '  <Changes>' +
                        '   <Change>' +
                        '    <Action>' + (options && options.op || "UPSERT") + '</Action>' +
                        '    <ResourceRecordSet>' +
                        '     <Name>' + host.name + '</Name>' +
                        '     <Type>' + type + '</Type>' +
                        '     <AliasTarget>' +
                        '      <HostedZoneId>' + (host.zoneId || zoneId) + '</HostedZoneId>' +
                        '      <DNSName>' + alias + '</DNSName>' +
                        '      <EvaluateTargetHealth>' (host.healthCheck ? 'true' : 'false') + '</EvaluateTargetHealth>' +
                        '     </AliasTarget>' +
                        (options && options.healthCheckId ?
                        '     <HealthCheckId>' + options.healthCheckId + '</HealthCheckId>' : '') +
                        '    </ResourceRecordSet>' +
                        '   </Change>' +
                        '  </Changes>' +
                        ' </ChangeBatch>' +
                        '</ChangeResourceRecordSetsRequest>';
            } else {
                var req = '<?xml version="1.0" encoding="UTF-8"?>' +
                        '<ChangeResourceRecordSetsRequest xmlns="https://route53.amazonaws.com/doc/2013-04-01/">' +
                        '<ChangeBatch>' +
                        ' <Changes>' +
                        '  <Change>' +
                        '   <Action>' + (options && options.op || "UPSERT") + '</Action>' +
                        '   <ResourceRecordSet>' +
                        '    <Name>' + host.name + '</Name>' +
                        '    <Type>' + type + '</Type>' +
                        '    <TTL>' + (host.ttl || (options && options.ttl) || 300) + '</TTL>' +
                        '    <ResourceRecords>' +
                        values.map(function(x) { return '<ResourceRecord><Value>' + x + '</Value></ResourceRecord>' }).join("") +
                        '    </ResourceRecords>' +
                        (options && options.healthCheckId ?
                             '<HealthCheckId>' + options.healthCheckId + '</HealthCheckId>' : '') +
                        '   </ResourceRecordSet>' +
                        '  </Change>' +
                        ' </Changes>' +
                        '</ChangeBatch>' +
                        '</ChangeResourceRecordSetsRequest>';
            }
            logger.dev("route53Change:", req);
            aws.queryRoute53("POST", zoneId + "/rrset", req, function(err, rc) {
                if (options && options.quiet) err = null;
                next(err);
            });
        }, callback);
    });
}

// Detect image featires using AWS Rekognition service, the `name` can be a Buffer, a local file or an url to the S3 bucket. In the latter case
// the url can be just apath to the file inside a bucket if `options.bucket` is specified, otherwise it must be a public S3 url with the bucket name
// to be the first part of the host name. For CDN/CloudFront cases use the `option.bucket` option.
aws.detectLabels = function(name, options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    if (Buffer.isBuffer(name)) {
        var req = {
            Image: {
                Bytes: name.toString("base64")
            }
        };
        aws.queryRekognition("DetectLabels", req, options, callback);
    } else
    if (name && options && options.bucket) {
        var req = {
            Image: {
                S3Object: {
                    Bucket: options.bucket,
                    Name: name[0] == "/" ? name.substr(1) : name
                }
            }
        };
        aws.queryRekognition("DetectLabels", req, options, callback);
    } else
    if (name && name[0] == "/") {
        fs.readFile(path.join(core.path.images, path.normalize(name)), function(err, data) {
            if (err) return callback && callback(err);
            var req = {
                Image: {
                    Bytes: data.toString("base64")
                }
            };
            aws.queryRekognition("DetectLabels", req, options, callback);
        });
    } else {
        name = url.parse(String(name));
        if (name.pathname && name.pathname[0] == "/") name.pathname = name.pathname.substr(1);
        var req = {
            Image: {
                S3Object: {
                    Bucket: name.hostname && name.hostname.split(".")[0],
                    Name: name.pathname
                }
            }
        };
        if (!req.Image.S3Object.Bucket || !req.Image.S3Object.Name) return callback && callback({ status: 404, message: "invalid image" });
        aws.queryRekognition("DetectLabels", req, options, callback);
    }
}
