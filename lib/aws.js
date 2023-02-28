//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const util = require('util');
const url = require('url');
const path = require('path');
const fs = require('fs');
const logger = require(__dirname + '/logger');
const core = require(__dirname + '/core');
const lib = require(__dirname + '/lib');

//
// AWS Cloud API interface
//

var aws = {
    name: 'aws',
    args: [
        { name: "key", descr: "AWS access key" },
        { name: "secret", descr: "AWS access secret" },
        { name: "token", descr: "AWS security token" },
        { name: "region", descr: "AWS region", pass: 1 },
        { name: "zone", descr: "AWS availability zone" },
        { name: "meta", type: "bool", descr: "Retrieve instance metadata, 0 to disable" },
        { name: "sdk-profile", descr: "AWS SDK profile to use when reading credentials file" },
        { name: "sns-app-arn", descr: "SNS Platform application ARN to be used for push notifications" },
        { name: "key-name", descr: "AWS instance keypair name for remote job instances or other AWS commands" },
        { name: "elb-name", descr: "AWS ELB name to be registered with on start up or other AWS commands" },
        { name: "target-group", descr: "AWS ELB target group to be registered with on start up or other AWS commands" },
        { name: "elastic-ip", descr: "AWS Elastic IP to be associated on start" },
        { name: "host-name", type: "list", descr: "List of hosts to update in Route54 zone with the current private IP address, hosts must be in FQDN format, supports @..@ core.instance placeholders" },
        { name: "iam-profile", descr: "IAM instance profile name for instances or commands" },
        { name: "image-id", descr: "AWS image id to be used for instances or commands" },
        { name: "subnet-id", descr: "AWS subnet id to be used for instances or commands" },
        { name: "vpc-id", descr: "AWS VPC id to be used for instances or commands" },
        { name: "group-id", array: 1, descr: "AWS security group(s) to be used for instances or commands" },
        { name: "instance-type", descr: "AWS instance type to launch on demand" },
        { name: "account-id", descr: "AWS account id if not running on an instance" },
        { name: "eni-id", type: "list", descr: "AWS Elastic Network Interfaces to attach on start, format is: eni[:index],eni..." },
        { name: "config-parameters", descr: "Prefix for AWS Config Parameters Store to load and parse as config before initializing the database pools, example: /bkjs/config/" },
        { name: "set-parameters", type: "list", descr: "AWS Config Parameters Store to set on start, supports @..@ core.instance placeholders: format is: path:value,...." },
        { name: "conf-file", descr: "S3 url for config file to download on start" },
        { name: "conf-file-interval", type: "int", descr: "Load S3 config file every specified interval in minites" },
    ],
    meta: 1,
    metaHost: "169.254.169.254",
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
    regions: {},
    endpoints: {
        iam: "https://iam.amazonaws.com/",
        "iam-us-gov-west-1": "https://iam.us-gov.amazonaws.com/",
        "iam-us-gov-east-1": "https://iam.us-gov.amazonaws.com/",
    },
    retryCount: {
        ec2: 1, ssm: 3, sqs: 1, iam: 1, sts: 1, email: 1, monitoring: 1, autoscaling: 1, elasticloadbalancing: 3, sns: 1,
    },
    _sigCache: { map: {}, list: [] },
};

module.exports = aws;

// Initialization of metadata
aws.configure = function(options, callback)
{
    // Do not retrieve metadata if not running inside known processes
    if (options.noConfigure || !this.meta || core.platform != "linux" || !lib.isFlag(this.roles, core.role)) {
        if (this.key && !this.sdkProfile) return callback();
        return this.readCredentials(this.sdkProfile, (creds) => {
            for (const p in creds) aws[p] = creds[p];
            callback();
        });
    }

    lib.everySeries([
        function(next) {
            if (process.env.AWS_EC2_METADATA_DISABLED) return next();
            aws.getInstanceInfo(options, next);
        },
        function(next) {
            if (aws.key) return next();
            aws.readCredentials(aws.sdkProfile, (creds) => {
                for (const p in creds) aws[p] = creds[p];
                next();
            });
        },
        function(next) {
            core.modules.ipc.on('config:init', () => { aws.readConfig.bind(aws) });
            aws.readConfig(() => { next() });
        },
        function(next) {
            if (!aws.key || !aws.configParameters) return next();
            aws.ssmGetParametersByPath(aws.configParameters, (err, params) => {
                var argv = [];
                for (const i in params) argv.push("-" + params[i].Name.split("/").pop(), params[i].Value);
                core.parseArgs(argv, 0, "aws-config");
                next();
            });
        },
    ], callback, true);
}

// Execute on Web server startup
aws.configureServer = function(options, callback)
{
    // Make sure we are running on EC2 instance
    if (!core.instance.id || !core.instance.image) return callback();

    lib.everyParallel([
       function(next) {
           if (!aws.elbName) return next();
           aws.elbRegisterInstances(aws.elbName, core.instance.id, next);
       },
       function(next) {
           if (!aws.targetGroup) return next();
           aws.elb2RegisterInstances(aws.targetGroup, core.instance.id, next);
       },
    ], callback, true);
}

// Execute on master server startup
aws.configureMaster = function(options, callback)
{
    // Make sure we are running on EC2 instance
    if (!core.instance.id || !core.instance.image) return callback();

    var opts = lib.objClone(options, "retryCount", options.retryCount || 3, "retryOnError", 1);
    lib.everyParallel([
        function(next) {
            // Set new tag if not set yet or it follows our naming convention, reboot could have launched a new app version so we set it
            if (core.instance.tag && !String(core.instance.tag).match(/^([a-z]+)-(a-z)-([0-9.]+)$/i)) return next();
            aws.ec2CreateTags(core.instance.id, core.runMode + "-" + core.appName + "-" + core.appVersion, opts, next);
        },
        function(next) {
            opts.subnetId = aws.SubnetId || aws.instance.subnetId;
            if (!aws.elasticIp || !opts.subnetId) return next();
            logger.info("configureMaster:", aws.elasticIp, opts);
            aws.ec2AssociateAddress(core.instance.id, aws.elasticIp, opts, next);
        },
        function(next) {
            if (!lib.isArray(aws.hostName) || !core.ipaddr) return next();
            logger.info("configureMaster:", aws.hostName, core.ipaddr, core.instance);
            lib.forEverySeries(aws.hostName, (host, next2) => {
                aws.route53Change(lib.toTemplate(host, [core.instance, core]), next2);
            }, next, true);
        },
        function(next) {
            if (!lib.isArray(aws.eniId)) return next();
            logger.info("configureMaster:", aws.eniId, opts);
            var idx = 0;
            var enis = lib.objGet(aws.instance, "networkInterfaceSet.item", { list: 1 }).map((x) => (x.networkInterfaceId));
            lib.forEverySeries(aws.eniId, (eni, next2) => {
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
                        aws.queryEC2("AttachNetworkInterface", query, opts, next2);
                    });
                });
            }, next, true);
        },
        function(next) {
            if (!lib.isArray(aws.setParameters)) return next();
            logger.info("configureMaster:", aws.setParameters, opts);
            var params = aws.setParameters.reduce((x, y) => {
                y = y.split(":");
                y[1] = lib.toTemplate(y[1], [core.instance, core]);
                if (y[1]) x[y[0]] = y[1];
                return x;
            }, {});
            aws.querySSM("GetParameters", { Names: Object.keys(params) }, opts, (err, rc) => {
                for (const i in rc.Parameters) {
                    if (params[rc.Parameters[i].Name] == rc.Parameters[i].Value) delete params[rc.Parameters[i].Name];
                }
                lib.forEverySeries(Object.keys(params), (name, next2) => {
                    aws.querySSM("PutParameter", { Name: name, Type: "String", Value: params[name], Overwrite: true }, opts, next2);
                }, next, true);
            });
        },
    ], callback, true);
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

// Read and apply config from S3 bucket
aws.readConfig = function(callback)
{
    var interval = this.confFileInterval > 0 ? this.confFileInterval * 60000 + lib.randomShort() : 0;
    lib.deferInterval(this, interval, "config", this.readConfig.bind(this));
    if (!/^s3:\/\//.test(this.confFile)) return lib.tryCall(callback);
    aws.s3GetFile(this.confFile, { httpTimeout: 1000 }, (err, rc) => {
        logger.debug("readConfig:", this.confFile, "status:", rc.status, "length:", rc.size);
        if (rc.status == 200) {
            core.parseConfig(rc.data, 0, "aws-s3");
        }
        lib.tryCall(callback, rc.status == 200 ? null : { status: rc.status });
    });
}

// Retrieve instance meta data
aws.getInstanceMeta = function(path, callback)
{
    var opts = {
        noparse: 1,
        httpTimeout: 200,
        quiet: true,
        retryCount: 2,
        retryTimeout: 100,
        errorCount: 0,
        retryOnError: function() { return this.status >= 400 && this.status != 404 && this.status != 529 },
    };
    if (!lib.rxUrl.test(path)) path = `http://${this.metaHost}${path}`;
    if (this.metaToken) opts.headers = { "X-aws-ec2-metadata-token": this.metaToken };

    core.httpGet(path, opts, (err, params) => {
        if ([200, 404, 529].indexOf(params.status) == -1) logger.error('getInstanceMeta:', path, params.status, params.data, err);
        if (typeof callback == "function") callback(err, params.status == 200 ? params.data : "");
    });
}

aws.getInstanceMetaToken = function(callback)
{
    var opts = {
        method: "PUT",
        headers: { "X-aws-ec2-metadata-token-ttl-seconds": 21600 },
        noparse: 1,
        httpTimeout: 200,
        quiet: true,
        retryCount: 3,
        retryTimeout: 100,
        retryOnError: function() { return this.status >= 400 && this.status != 404 && this.status != 529 },
    }
    core.httpGet(`http://${aws.metaHost}/latest/api/token`, opts, (err, params) => {
        if ([200, 529].indexOf(params.status) == -1) logger.error('getInstanceMetaToken:', params.uri, params.status, params.data, err);
        if (params.status == 200) {
            if (params.data) aws.metaToken = params.data;
        } else {
            aws.metaRetries = lib.toNumber(aws.metaRetries) + 1;
            if (aws.metaRetries > 2) params.status = 0;
        }
        if (params.status == 200 || params.status >= 500) {
            var timeout = params.status == 200 ? 21000000 : 1000 * aws.metaRetries;
            clearTimeout(aws._metaTimer);
            aws._metaTimer = setTimeout(aws.getInstanceMetaToken.bind(aws), timeout);
        }
        if (typeof callback == "function") callback(err, params.status == 200 ? params.data : "");
    });
}

// Retrieve instance credentials using EC2 instance profile and setup for AWS access
aws.getInstanceCredentials = function(path, callback)
{
    if (typeof path == "function") callback = path, path = null;

    lib.series([
        function(next) {
            if (path || aws.amiProfile) return next();
            aws.getInstanceMeta("/latest/meta-data/iam/security-credentials/", (err, data) => {
                if (!err && data) aws.amiProfile = data;
                next(err);
            });
        },
        function(next) {
            if (!path) path = "/latest/meta-data/iam/security-credentials/" + aws.amiProfile;
            aws.getInstanceMeta(path, (err, data) => {
                if (!err && data) {
                    var obj = lib.jsonParse(data, { datatype: "obj", logger: "info" });
                    if (obj.AccessKeyId && obj.SecretAccessKey) {
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
                clearTimeout(aws._credTimer);
                aws._credTimer = setTimeout(aws.getInstanceCredentials.bind(aws, path), timeout);
                next(err);
            });
        },
    ], callback, true);

}

// Retrieve instance launch index from the meta data if running on AWS instance
aws.getInstanceInfo = function(options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    if (process.env.AWS_EXECUTION_ENV == "AWS_ECS_FARGATE") {
        aws.metaHost = "169.254.170.2";
        aws.region = core.instance.region = process.env.AWS_DEFAULT_REGION || process.env.AWS_REGION;
        return aws.getInstanceCredentials(process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI || process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI, callback);
    }

    lib.series([
        function(next) {
            aws.getInstanceMetaToken(() => { next() });
        },
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
            aws.getInstanceMeta("/latest/user-data", function(err, data) {
                if (!err && data && data[0] == "-") core.parseArgs(lib.phraseSplit(data), 0, "aws-meta");
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
            var opts = { retryCount: 3 }
            aws.queryEC2("DescribeInstances", { 'Filter.1.Name': 'instance-id', 'Filter.1.Value.1': core.instance.id }, opts, function(err, rc) {
                if (!err) aws.instance = lib.objGet(rc, "DescribeInstancesResponse.reservationSet.item.instancesSet.item", { obj: 1 });
                if (!err) aws.tags = lib.objGet(aws.instance, "tagSet.item", { list: 1 });
                if (!core.instance.tag) core.instance.tag = aws.tags.filter(function(x) { return x.key == "Name" }).map(function(x) { return x.value }).join(",");
                next();
            });
        },
    ], function(err) {
        logger.debug('getInstanceInfo:', aws.name, aws.key, core.instance, 'profile:', aws.amiProfile, 'expire:', aws.tokenExpiration, err || "");
        if (typeof callback == "function") callback();
    }, true);
}

aws.httpGet = function(url, options, callback)
{
    if (!options.retryCount) options.retryCount = this.retryCount[options.endpoint];
    if (!options.retryOnError && options.retryCount) options.retryOnError = 1;
    core.httpGet(url, options, callback);
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
    if (params.action) {
        err.action = params.action;
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
            if (err) logger.errorWithOptions(err, options, 'queryAWS:', params.Action, err, params.toJSON(options && options.debug_error));
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
    return path ? String(path).split('/').map(aws.uriEscape).join('/') : "/";
}

// Build version 4 signature headers
aws.querySign = function(region, service, host, method, path, body, headers, credentials, options)
{
    if (!credentials) credentials = this;
    var now = util.types.isDate(options && options.now) ? options.now : new Date();
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
    var signedHeaders = Object.keys(headers).map((key) => (key.toLowerCase())).sort().join(';');
    var canonHeaders = Object.keys(headers).sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1)).map((key) => (key.toLowerCase() + ':' + trimAll(String(headers[key])))).join('\n');
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
        query: options.query,
        qsopts: options.qsopts,
        postdata: data,
        headers: headers,
        quiet: options.quiet,
        retryCount: options.retryCount,
        retryTimeout: options.retryTimeout,
        retryOnError: options.retryOnError,
        httpTimeout: options.httpTimeout,
        credentials: options.credentials,
    };
}

// It is called in the context of a http request
aws.querySigner = function()
{
    aws.querySign(this.region, this.endpoint, this.hostname, this.method, this.path, this.postdata, this.headers, this.credentials);
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
    opts.action = obj.Action;
    logger.debug(opts.action, host, path, opts);
    this.httpGet(url.format({ protocol: proto, host: host, pathname: path }), opts, function(err, params) {
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
    // Limit to the suppported region per endpoint
    var region = this.getServiceRegion(service, options.region || this.region || 'us-east-1');
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

// Check for supported regions per service, return the first one if the given region is not supported
aws.getServiceRegion = function(service, region)
{
    return this.regions[service] && this.regions[service].indexOf(region) == -1 ? this.regions[service][0] : region;
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

aws.queryService = function(endpoint, target, action, obj, options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    var headers = { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': target + "." + action };
    var opts = this.queryOptions("POST", lib.stringify(obj), headers, options);
    opts.region = options && options.region || this.region || 'us-east-1';
    opts.action = action;
    opts.endpoint = endpoint;
    opts.signer = this.querySigner;
    logger.debug(opts.action, opts);
    this.httpGet(`https://${endpoint}.${opts.region}.amazonaws.com/`, opts, function(err, params) {
        if (params.status != 200) err = aws.parseError(params, options);
        if (typeof callback == "function") callback(err, params.obj);
    });
}

// Make a request to the Rekognition service
aws.queryRekognition = function(action, obj, options, callback)
{
    this.queryService("rekognition", "RekognitionService", action, obj, options, callback);
}

// AWS SSM API request
aws.querySSM = function(action, obj, options, callback)
{
    this.queryService("ssm", "AmazonSSM", action, obj, options, callback);
}

// AWS ACM API request
aws.queryACM = function(action, obj, options, callback)
{
    this.queryService("acm", "CertificateManager", action, obj, options, callback);
}

// AWS Comprehend API request
aws.queryComprehend = function(action, obj, options, callback)
{
    this.queryService("comprehend", "Comprehend_20171127", action, obj, options, callback);
}

// AWS Transcribe API request
aws.queryTranscribe = function(action, obj, options, callback)
{
    this.queryService("transcribe", "Transcribe", action, obj, options, callback);
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
//  - attempt - request attempt id for FIFO queues
//  after being retrieved by a ReceiveMessage request.
aws.sqsReceiveMessage = function(url, options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    var params = { QueueUrl: url };
    if (options) {
        if (options.count) params.MaxNumberOfMessages = options.count;
        if (options.visibilityTimeout > 999) params.VisibilityTimeout = Math.round(options.visibilityTimeout/1000);
        if (options.timeout > 999) params.WaitTimeSeconds = Math.round(options.timeout/1000);
        if (options.attempt) params.ReceiveRequestAttemptId = options.attempt;
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
//  - group - a group id for FIFO queues
//  - unique - deduplication id for FIFO queues
//  - attrs - an object with additional message attributes to send, use only string, numbers or binary values,
//  all other types will be converted into strings
aws.sqsSendMessage = function(url, body, options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    var params = { QueueUrl: url, MessageBody: body };
    if (options) {
        if (options.delay > 999) params.DelaySeconds = Math.round(options.delay/1000);
        if (options.group) params.MessageGroupId = options.group;
        if (options.unique) params.MessageDeduplicationId = options.unique;
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

require(__dirname + "/aws/cw")
require(__dirname + "/aws/dynamodb")
require(__dirname + "/aws/ec2")
require(__dirname + "/aws/s3")
require(__dirname + "/aws/sns")
require(__dirname + "/aws/route53")

