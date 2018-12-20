//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const util = require('util');
const url = require('url');
const path = require('path');
const fs = require('fs');
const os = require('os');
const logger = require(__dirname + '/logger');
const core = require(__dirname + '/core');
const lib = require(__dirname + '/lib');

var aws = {
    name: 'aws',
    args: [ { name: "key", descr: "AWS access key" },
            { name: "secret", descr: "AWS access secret" },
            { name: "token", descr: "AWS secuiry token" },
            { name: "region", descr: "AWS region", pass: 1 },
            { name: "zone", descr: "AWS availability zone" },
            { name: "sdk-profile", descr: "AWS SDK profile to use when reading credentials file" },
            { name: "ddb-read-capacity", type: "int", min: 0, descr: "Default DynamoDB read capacity for all tables" },
            { name: "ddb-write-capacity", type: "int", min: 0, descr: "Default DynamoDB write capacity for all tables" },
            { name: "ddb-shard-records-count", type: "int", min: 50, descr: "Default DynamoDB Streams process records count" },
            { name: "sns-app-arn", descr: "SNS Platform application ARN to be used for push notifications" },
            { name: "key-name", descr: "AWS instance keypair name for remote job instances or other AWS commands" },
            { name: "elb-name", descr: "AWS ELB name to be registered with on start up or other AWS commands" },
            { name: "target-group", descr: "AWS ELB target group to be registered with on start up or other AWS commands" },
            { name: "elastic-ip", descr: "AWS Elastic IP to be associated on start" },
            { name: "host-name", type: "list", descr: "List of hosts to update in Route54 zone with the current private IP address, hosts must be in FQDN format" },
            { name: "iam-profile", descr: "IAM instance profile name for instances or commands" },
            { name: "image-id", descr: "AWS image id to be used for instances or commands" },
            { name: "subnet-id", descr: "AWS subnet id to be used for instances or commands" },
            { name: "vpc-id", descr: "AWS VPC id to be used for instances or commands" },
            { name: "group-id", array: 1, descr: "AWS security group(s) to be used for instances or commands" },
            { name: "instance-type", descr: "AWS instance type to launch on demand" },
            { name: "account-id", descr: "AWS account id if not running on an instance" },
            { name: "eni-id", type: "list", descr: "AWS Elastic Network Interfaces to attach on start, format is: eni[:index],eni..." },
            { name: "parameters", type: "list", descr: "AWS Config Parameters Store to set on start: format is: path:value,...." },
    ],
    key: process.env.AWS_ACCESS_KEY_ID,
    secret: process.env.AWS_SECRET_ACCESS_KEY,
    token: process.env.AWS_SESSION_TOKEN,
    tokenExpiration: 0,
    amiProfile: "",
    // Current instance details
    instance: {},
    tags: [],
    // Known process roles that need instance metadata
    roles: ["shell","web","master","server","worker","process"],
    // Supported regions per service
    regions: {
        email: ["us-east-1","us-west-2","eu-west-1"],
        iam: ["us-east-1","us-gov-west-1"],
    },
    endpoints: {
        iam: "https://iam.amazonaws.com/",
        "iam-us-gov-west-1": "https://iam.us-gov.amazonaws.com/",
    },
    _sigCache: { map: {}, list: [] },
};

module.exports = aws;

// Initialization of metadata
aws.configure = function(options, callback)
{
    // Do not retrieve metadata if not running inside known processes
    if (os.platform() != "linux" || options.noConfigure || this.roles.indexOf(core.role) == -1) {
        if (this.key && !this.sdkProfile) return callback();
        return this.readCredentials(this.sdkProfile, (creds) => {
            for (var p in creds) aws[p] = creds[p];
            callback();
        });
    }
    this.getInstanceInfo(function() {
        if (aws.key) return callback();
        aws.readCredentials(aws.sdkProfile, (creds) => {
            for (var p in creds) aws[p] = creds[p];
            callback();
        });
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
       function(next) {
           if (!aws.targetGroup) return next();
           aws.elb2RegisterInstances(aws.targetGroup, core.instance.id, opts, function() { next() });
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
            if (core.instance.tag && !String(core.instance.tag).match(/^([a-z]+)-(a-z)-([0-9.]+)$/i)) return next();
            aws.ec2CreateTags(core.instance.id, core.runMode + "-" + core.appName + "-" + core.appVersion, opts, () => { next() });
        },
        function(next) {
            opts.subnetId = aws.SubnetId || aws.instance.subnetId;
            if (!aws.elasticIp || !opts.subnetId) return next();
            logger.info("configureMaster:", aws.elasticIp, opts);
            aws.ec2AssociateAddress(core.instance.id, aws.elasticIp, opts, () => { next() });
        },
        function(next) {
            if (!lib.isArray(aws.hostName) || !core.ipaddr) return next();
            logger.info("configureMaster:", aws.hostName, core.ipaddr, core.instance);
            lib.forEachSeries(aws.hostName, (host, next2) => {
                aws.route53Change(lib.toTemplate(host, core.instance), () => { next2() });
            }, next);
        },
        function(next) {
            if (!lib.isArray(aws.eniId)) return next();
            logger.info("configureMaster:", aws.eniId, opts);
            var idx = 0;
            var enis = lib.objGet(aws.instance, "networkInterfaceSet.item", { list: 1 }).map((x) => (x.networkInterfaceId));
            lib.forEachSeries(aws.eniId, (eni, next2) => {
                eni = eni.split(":");
                idx = Math.max(lib.toNumber(eni[1]), idx + 1);
                if (lib.isFlag(enis, eni[0])) return next2();
                aws.queryEC2("DescribeNetworkInterfaces", { "NetworkInterfaceId.1": eni[0] }, opts, (err, rc) => {
                    rc = lib.objGet(rc, "DescribeNetworkInterfacesResponse.networkInterfaceSet.item");
                    if (!rc || rc.subnetId != aws.instance.subnetId) return next2();
                    var aid = lib.objGet(rc, "attachment.attachmentId");
                    var query = { InstanceId: core.instance.id, NetworkInterfaceId: eni[0], DeviceIndex: idx };
                    if (!aid) return aws.queryEC2("AttachNetworkInterface", query, opts, () => { next2() });
                    aws.queryEC2("DetachNetworkInterface", { AttachmentId: aid, Force: true }, opts, () => {
                        aws.queryEC2("AttachNetworkInterface", query, opts, () => { next2() });
                    });
                });
            }, () => { next() });
        },
        function(next) {
            if (!lib.isArray(aws.parameters)) return next();
            logger.info("configureMaster:", aws.parameters, opts);
            aws.ssmGetParametersByPath("/", opts, (err, params) => {
                lib.forEachSeries(aws.parameters, (param, next2) => {
                    param = param.split(":");
                    if (params.some((x) => (x.Name == param[0] && x.Value == param[1]))) return next2();
                    aws.querySSM("PutParameter", { Name: param[0], Type: "String", Value: param[1], Overwrite: true }, opts, () => { next2() });
                }, () => { next() });
            });
        },
    ], callback);
}

// Read key and secret from the AWS SDK credentials file, if no profile is given in the config or command line only the default peofile
// will be loaded.
aws.readCredentials = function(profile, callback)
{
    if (typeof profile == "function") callback = profile, profile = null;

    fs.readFile((process.env.HOME || process.env.BKJS_HOME) + "/.aws/credentials", function(err, data) {
        var creds = {};
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
                    if (x[0].trim() == "aws_access_key_id" && x[1]) creds.key = x[1].trim();
                    if (x[0].trim() == "aws_secret_access_key" && x[1]) creds.secret = x[1].trim();
                    if (x[0].trim() == "region" && x[1]) creds.region = x[1].trim();
                }
            }
            if (creds.key && creds.secret) creds.profile = profile;
            logger.debug('readCredentials:', creds);
        }
        if (typeof callback == "function") callback(creds);
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
                aws.token = obj.Token;
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
            aws.getInstanceMeta("/latest/dynamic/instance-identity/document", function(err, data) {
                if (!err && data) {
                    data = lib.jsonParse(data, { datatype: "obj", logger: "error" });
                    core.instance.type = "aws";
                    core.instance.id = data.instanceId;
                    core.instance.image = data.imageId;
                    core.instance.instanceType = data.instanceType;
                    core.instance.region = data.region;
                    core.instance.zone = data.availabilityZone;
                    aws.accountId = data.accountId;
                    aws.zone = data.availabilityZone;
                    if (!aws.region) aws.region = data.region;
                }
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
        if (params.obj.ErrorResponse && params.obj.ErrorResponse.Error) {
            err = lib.newError({ message: params.obj.ErrorResponse.Error.Message, code: params.obj.ErrorResponse.Error.Code, status: params.status });
        } else
        if (params.obj.Error && params.obj.Error.Message) {
            err = lib.newError({ message: params.obj.Error.Message, code: params.obj.Error.Code, status: params.status });
        } else
        if (params.obj.__type) {
            err = lib.newError({ message: params.obj.Message || params.obj.message, code: params.obj.__type, status: params.status });
        }
    }
    if (!err) {
        err = lib.newError({ message: "Error " + params.status + " " + params.data, status: params.status });
    }
    if (options && options.ignore_error) {
        if (!lib.isArray(options.ignore_error) || lib.isFlag(options.ignore_error, err.code)) err = null;
    }
    return err;
}

// Parse AWS response and try to extract error code and message, convert XML into an object.
aws.parseXMLResponse = function(err, params, options, callback)
{
    if (!err && params.data) {
        if (!params.obj) params.obj = lib.xmlParse(params.data);
        if (params.status != 200) {
            err = this.parseError(params, options);
            if (err) {
                var log = options.quiet ? "debug" : options.logger_error;
                if (lib.isObject(log)) log = log[err.code] || log["*"];
                var e = log == "notice" || log == "info" ? { status: err.status, code: err.code, message: err.message } : err;
                logger.logger(log, 'queryAWS:', lib.objDescr(params.Action), e, params.toJSON());
            }
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
aws.querySign = function(region, service, host, method, path, body, headers, credentials, options)
{
    if (!credentials) credentials = this;
    var now = util.isDate(options && options.now) ? options.now : new Date();
    var isoDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    var date = isoDate.substr(0, 8);

    headers.host = host;
    headers['x-amz-date'] = isoDate;
    if (body && !headers['content-type']) headers['content-type'] = 'application/x-www-form-urlencoded; charset=utf-8';
    if (body && !lib.toNumber(headers['content-length'])) headers['content-length'] = Buffer.byteLength(body, 'utf8');
    if (credentials.token) headers["x-amz-security-token"] = credentials.token;
    delete headers.Authorization;

    function trimAll(header) { return header.toString().trim().replace(/\s+/g, ' '); }
    var hash = headers["x-amz-content-sha256"] || lib.hash(body || '', "sha256", "hex");
    var credStr = [ date, region, service, 'aws4_request' ].join('/');
    var pathParts = path.split('?', 2);
    var signedHeaders = Object.keys(headers).map(function(key) { return key.toLowerCase(); }).sort().join(';');
    var canonHeaders = Object.keys(headers).sort(function(a, b) { return a.toLowerCase() < b.toLowerCase() ? -1 : 1; }).map(function(key) { return key.toLowerCase() + ':' + trimAll(String(headers[key])); }).join('\n');
    var canonStr = [ method, this.uriEscapePath(pathParts[0]), pathParts[1] || '', canonHeaders + '\n', signedHeaders, hash].join('\n');
    var strToSign = [ 'AWS4-HMAC-SHA256', isoDate, credStr, lib.hash(canonStr, "sha256", "hex") ].join('\n');

    var sigKey = lib.sign(credentials.secret, credentials.key + "," + credStr, "sha256", "hex");
    var kCredentials = this._sigCache.map[sigKey];
    if (!kCredentials) {
        var kDate = lib.sign('AWS4' + credentials.secret, date, "sha256", "binary");
        var kRegion = lib.sign(kDate, region, "sha256", "binary");
        var kService = lib.sign(kRegion, service, "sha256", "binary");
        kCredentials = lib.sign(kService, 'aws4_request', "sha256", "binary");
        this._sigCache.map[sigKey] = kCredentials;
        this._sigCache.list.push(sigKey);
        if (this._sigCache.list.length > 25) delete this._sigCache.map[this._sigCache.list.shift()];
    }
    var sig = lib.sign(kCredentials, strToSign, "sha256", "hex");
    headers.Authorization = [ 'AWS4-HMAC-SHA256 Credential=' + credentials.key + '/' + credStr, 'SignedHeaders=' + signedHeaders, 'Signature=' + sig ].join(', ');
    if (options) {
        options.date = isoDate;
        options.signedHeaders = signedHeaders;
        options.credential = credentials.key + '/' + credStr;
        options.canonStr = canonStr;
        options.signature = sig;
    }
}

// Return a request object ready to be sent to AWS, properly formatted
aws.queryPrepare = function(action, version, obj, options)
{
    var req = { Action: action, Version: version };
    for (const p in obj) req[p] = obj[p];
    // All capitalized options are passed as is and take priority because they are in native format
    for (const p in options) if (p[0] >= 'A' && p[0] <= 'Z' && typeof options[p] != "undefined" && options[p] !== null && options[p] !== "") req[p] = options[p];
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
        credentials: options.credentials,
    };
}

// It is called in the context of a http request
aws.querySigner = function()
{
    aws.querySign(this.region, this.endpoint, this.hostname, this.method, this.pathname, this.postdata, this.headers, this.credentials);
}

// Make AWS request, return parsed response as Javascript object or null in case of error
aws.queryAWS = function(region, service, proto, host, path, obj, options, callback)
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
    opts.endpoint = service;
    opts.signer = this.querySigner;

    core.httpGet(url.format({ protocol: proto, host: host, pathname: path }), opts, function(err, params) {
        // For error logging about the current request
        params.Action = obj;
        aws.parseXMLResponse(err, params, options, callback);
    });
}

// AWS generic query interface
aws.queryEndpoint = function(service, version, action, obj, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = lib.empty;
    var region = options.region || this.region || 'us-east-1';
    // Limit to the suppported region per endpoint
    if (this.regions[service] && this.regions[service].indexOf(region) == -1) region = this.regions[service][0];
    // Specific endpoint url if it is different from the common endpoint.region.amazonaws.com
    var e = options.endpoint ? url.parse(String(options.endpoint)) :
            this.endpoints[service + "-" + region] ? url.parse(this.endpoints[service + "-" + region]) :
            this.endpoints[service] ? url.parse(this.endpoints[service]) :
            lib.empty;
    var proto = options.endpoint_protocol || e.protocol || 'https';
    var host = options.endpoint_host || (e.host || e.hostname) || (service + '.' + region + '.amazonaws.com');
    var path = options.endpoint_path || (e.path || e.pathanme) || '/';
    var req = this.queryPrepare(action, version, obj, options);
    this.queryAWS(region, service, proto, host, path, req, options, callback);
}

// Copy all credentials properties from the options into the obj
aws.copyCredentials = function(obj, options)
{
    for (var p in options) {
        if (/^(region|endpoint|credentials|endpoint_(protocol|host|path))$/.test(p)) obj[p] = options[p];
    }
    return obj;
}

// AWS SQS API request
aws.querySQS = function(action, obj, options, callback)
{
    this.queryEndpoint("sqs", '2012-11-05', action, obj, options, callback);
}

// AWS AIM API request
aws.queryIAM = function(action, obj, options, callback)
{
    this.queryEndpoint("iam", '2010-05-08', action, obj, options, callback);
}

// AWS STS API request
aws.querySTS = function(action, obj, options, callback)
{
    this.queryEndpoint("sts", '2011-06-15', action, obj, options, callback);
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
    opts.region = options && options.region || this.region || 'us-east-1';
    opts.endpoint = "rekognition";
    opts.signer = this.querySigner;
    core.httpGet("https://rekognition." + opts.region + ".amazonaws.com/", opts, function(err, params) {
        if (params.status != 200) err = aws.parseError(params, options);
        if (typeof callback == "function") callback(err, params.obj);
    });
}

// AWS SSM API request
aws.querySSM = function(action, obj, options, callback)
{
    var headers = { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': "AmazonSSM." + action };
    var opts = this.queryOptions("POST", lib.stringify(obj), headers, options);
    opts.region = options && options.region || this.region || 'us-east-1';
    opts.endpoint = "ssm";
    opts.signer = this.querySigner;
    core.httpGet("https://ssm." + opts.region + ".amazonaws.com/", opts, function(err, params) {
        if (params.status != 200) err = aws.parseError(params, options);
        if (typeof callback == "function") callback(err, params.obj);
    });
}

// AWS CloudWatch Log API request
aws.queryCWL = function(action, obj, options, callback)
{
    var headers = { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': "Logs_20140328." + action };
    var opts = this.queryOptions("POST", lib.stringify(obj), headers, options);
    opts.region = options && options.region || this.region || 'us-east-1';
    opts.endpoint = "logs";
    opts.signer = this.querySigner;
    core.httpGet("https://logs." + opts.region + ".amazonaws.com/", opts, function(err, params) {
        if (params.status != 200) err = aws.parseError(params, options);
        if (typeof callback == "function") callback(err, params.obj);
    });
}

// AWS ACM API request
aws.queryACM = function(action, obj, options, callback)
{
    var headers = { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': "CertificateManager." + action };
    var opts = this.queryOptions("POST", lib.stringify(obj), headers, options);
    opts.region = options && options.region || this.region || 'us-east-1';
    opts.endpoint = "acm";
    opts.signer = this.querySigner;
    core.httpGet("https://acm." + opts.region + ".amazonaws.com/", opts, function(err, params) {
        if (params.status != 200) err = aws.parseError(params, options);
        if (typeof callback == "function") callback(err, params.obj);
    });
}

// Returns a tag value by key, default key is Name
aws.getTagValue = function(obj, key)
{
    if (!key) key = "Name";
    return lib.objGet(obj, "tagSet.item", { list: 1 }).filter((x) => (x.key == key)).map((x) => (x.value)).pop() || "";
}

// Assume a role and return new credentials that can be used in other API calls
aws.stsAssumeRole = function(options, callback)
{
    var params = {
        RoleSessionName: options.name || core.name,
        RoleArn: options.role,
    };
    this.querySTS("AssumeRole", params, options, (err, obj) => {
        if (!err) {
            obj = lib.objGet(obj, "AssumeRoleResponse.AssumeRoleResult");
            obj.credentials = {
                key: obj.Credentials.AccessKeyId,
                secret: obj.Credentials.SecretAccessKey,
                token: obj.Credentials.SessionToken,
                expiration: lib.toDate(obj.Credentials.Expiration).getTime(),
            };
            delete obj.Credentials;
        }
        if (typeof callback == "function") callback(err, obj);
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
    params.Source = options.from || core.emailFrom || ("admin@" + core.domain);
    lib.strSplit(to).forEach(function(x, i) { params["Destination.ToAddresses.member." + (i + 1)] = x; })
    if (options.cc) lib.strSplit(options.cc).forEach(function(x, i) { params["Destination.CcAddresses.member." + (i + 1)] = x; })
    if (options.bcc) lib.strSplit(options.bcc).forEach(function(x, i) { params["Destination.BccAddresses.member." + (i + 1)] = x; })
    if (options.replyTo) lib.strSplit(options.replyTo).forEach(function(x, i) { params["ReplyToAddresses.member." + (i + 1)] = x; })
    if (options.returnPath) params.ReturnPath = options.returnPath;
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
        if (options.from) params.Source = options.from;
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

    var ops = { ">=": "GreaterThanOrEqualToThreshold", ">": "GreaterThanThreshold", "<": "LessThanThreshold", "<=": "LessThanOrEqualToThreshold" };
    var metric = options.metric || "CPUUtilization";
    var namespace = options.namespace || "AWS/EC2";

    var params = {
        AlarmName: options.name || (namespace + ": " + metric + " " + lib.objDescr(options.dimensions)),
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

// Publishes metric data points to Amazon CloudWatch.
// The argumernts specify the following:
//  - namespace - custome namespace, cannot start with `AWS`
//  - data - an object with metric data:
//    { metricName: value }, ...
//    { metricName: {
//           value: Number,
//           dimension1: name1,
//           ..
//        },
//    }, ...
//    { metricName: {
//           value: [min, max, sum, sample],
//           dimension1: ...
//        },
//    }, ...
//
// The options can specify the following:
// - storageResolution - 1 if tyo use 1 second resolution
// - timestamp - ms to be used as the timestamp instead of the current time
//
aws.cwPutMetricData = function(namespace, data, options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    var params = {
        Namespace: namespace,
    }
    var i = 1;
    for (var p in data) {
        var val = data[p];
        params["MetricData.member." + i + ".MetricName"] = p;
        if (typeof val == "number" || typeof val == "string") {
            params["MetricData.member." + i + ".Value"] = val;
        } else {
            var j = 1;
            if (lib.isArray(val.value)) {
                params["MetricData.member." + i + ".StatisticValues.Minimum"] = val.value[0];
                params["MetricData.member." + i + ".StatisticValues.Maximum"] = val.value[1];
                params["MetricData.member." + i + ".StatisticValues.Sum"] = val.value[2];
                params["MetricData.member." + i + ".StatisticValues.SampleCount"] = val.value[3];
            } else {
                params["MetricData.member." + i + ".Value"] = val.value;
            }
            for (var d in val) {
                if (d == "value") continue;
                params["MetricData.member." + i + ".Dimensions.member." + j + ".Name"] = d;
                params["MetricData.member." + i + ".Dimensions.member." + j + ".Value"] = val[d];
                j++;
            }
        }
        if (options && options.storageResolution) {
            params["MetricData.member." + i + ".StorageResolution"] = 1;
        }
        if (options && options.timestamp > 0) {
            params["MetricData.member." + i + ".Timestamp"] = lib.toDate(options.timestamp).toISOString();
        }
        i++;
    }
    this.queryCW("PutMetricData", params, options, callback);
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
            var alias = host.alias || (options && options.alias), req;
            if (alias) {
                req = '<?xml version="1.0" encoding="UTF-8"?>' +
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
                req = '<?xml version="1.0" encoding="UTF-8"?>' +
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
        const req = {
            Image: {
                Bytes: name.toString("base64")
            }
        };
        aws.queryRekognition("DetectLabels", req, options, callback);
    } else
    if (name && options && options.bucket) {
        const req = {
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
            const req = {
                Image: {
                    Bytes: data.toString("base64")
                }
            };
            aws.queryRekognition("DetectLabels", req, options, callback);
        });
    } else {
        name = url.parse(String(name));
        if (name.pathname && name.pathname[0] == "/") name.pathname = name.pathname.substr(1);
        const req = {
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
