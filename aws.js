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
var xml2json = require('xml2json');

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
    tags: [],
    ddbDefaultCapacity: 25,

    // DynamoDB reserved keywords
    ddbReserved: {
        ABORT: 1, ABSOLUTE: 1, ACTION: 1, ADD: 1, AFTER: 1, AGENT: 1, AGGREGATE: 1, ALL: 1, ALLOCATE: 1, ALTER: 1, ANALYZE: 1, AND: 1, ANY: 1, ARCHIVE: 1, ARE: 1, ARRAY: 1, AS: 1, ASC: 1,
        ASCII: 1, ASENSITIVE: 1, ASSERTION: 1, ASYMMETRIC: 1, AT: 1, ATOMIC: 1, ATTACH: 1, ATTRIBUTE: 1, AUTH: 1, AUTHORIZATION: 1, AUTHORIZE: 1, AUTO: 1, AVG: 1, BACK: 1,
        BACKUP: 1, BASE: 1, BATCH: 1, BEFORE: 1, BEGIN: 1, BETWEEN: 1, BIGINT: 1, BINARY: 1, BIT: 1, BLOB: 1, BLOCK: 1, BOOLEAN: 1, BOTH: 1, BREADTH: 1,
        BUCKET: 1, BULK: 1, BY: 1, BYTE: 1, CALL: 1, CALLED: 1, CALLING: 1, CAPACITY: 1, CASCADE: 1, CASCADED: 1, CASE: 1, CAST: 1, CATALOG: 1, CHAR: 1, CHARACTER: 1, CHECK: 1,
        CLASS: 1, CLOB: 1, CLOSE: 1, CLUSTER: 1, CLUSTERED: 1, CLUSTERING: 1, CLUSTERS: 1, COALESCE: 1, COLLATE: 1, COLLATION: 1, COLLECTION: 1, COLUMN: 1, COLUMNS: 1, COMBINE: 1,
        COMMENT: 1, COMMIT: 1, COMPACT: 1, COMPILE: 1, COMPRESS: 1, CONDITION: 1, CONFLICT: 1, CONNECT: 1, CONNECTION: 1, CONSISTENCY: 1, CONSISTENT: 1, CONSTRAINT: 1,
        CONSTRAINTS: 1, CONSTRUCTOR: 1, CONSUMED: 1, CONTINUE: 1, CONVERT: 1, COPY: 1, CORRESPONDING: 1, COUNT: 1, COUNTER: 1, CREATE: 1, CROSS: 1, CUBE: 1, CURRENT: 1, CURSOR: 1, CYCLE: 1,
        DATA: 1, DATABASE: 1, DATE: 1, DATETIME: 1, DAY: 1, DEALLOCATE: 1, DEC: 1, DECIMAL: 1, DECLARE: 1, DEFAULT: 1, DEFERRABLE: 1, DEFERRED: 1, DEFINE: 1, DEFINED: 1, DEFINITION: 1,
        DELETE: 1, DELIMITED: 1, DEPTH: 1, DEREF: 1, DESC: 1, DESCRIBE: 1, DESCRIPTOR: 1, DETACH: 1, DETERMINISTIC: 1, DIAGNOSTICS: 1, DIRECTORIES: 1, DISABLE: 1, DISCONNECT: 1,
        DISTINCT: 1, DISTRIBUTE: 1, DO: 1, DOMAIN: 1, DOUBLE: 1, DROP: 1, DUMP: 1, DURATION: 1, DYNAMIC: 1, EACH: 1, ELEMENT: 1, ELSE: 1, ELSEIF: 1, EMPTY: 1, ENABLE: 1, END: 1, EQUAL: 1,
        EQUALS: 1, ERROR: 1, ESCAPE: 1, ESCAPED: 1, EVAL: 1, EVALUATE: 1, EXCEEDED: 1, EXCEPT: 1, EXCEPTION: 1, EXCEPTIONS: 1, EXCLUSIVE: 1, EXEC: 1, EXECUTE: 1, EXISTS: 1, EXIT: 1, EXPLAIN: 1,
        EXPLODE: 1, EXPORT: 1, EXPRESSION: 1, EXTENDED: 1, EXTERNAL: 1, EXTRACT: 1, FAIL: 1, FALSE: 1, FAMILY: 1, FETCH: 1, FIELDS: 1, FILE: 1, FILTER: 1, FILTERING: 1, FINAL: 1,
        FINISH: 1, FIRST: 1, FIXED: 1, FLATTERN: 1, FLOAT: 1, FOR: 1, FORCE: 1, FOREIGN: 1, FORMAT: 1, FORWARD: 1, FOUND: 1, FREE: 1, FROM: 1, FULL: 1, FUNCTION: 1, FUNCTIONS: 1,
        GENERAL: 1, GENERATE: 1, GET: 1, GLOB: 1, GLOBAL: 1, GO: 1, GOTO: 1, GRANT: 1, GREATER: 1, GROUP: 1, GROUPING: 1, HANDLER: 1, HASH: 1, HAVE: 1, HAVING: 1, HEAP: 1, HIDDEN: 1, HOLD: 1,
        HOUR: 1, IDENTIFIED: 1, IDENTITY: 1, IF: 1, IGNORE: 1, IMMEDIATE: 1, IMPORT: 1, IN: 1, INCLUDING: 1, INCLUSIVE: 1, INCREMENT: 1, INCREMENTAL: 1, INDEX: 1, INDEXED: 1,
        INDEXES: 1, INDICATOR: 1, INFINITE: 1, INITIALLY: 1, INLINE: 1, INNER: 1, INNTER: 1, INOUT: 1, INPUT: 1, INSENSITIVE: 1, INSERT: 1, INSTEAD: 1, INT: 1, INTEGER: 1, INTERSECT: 1,
        INTERVAL: 1, INTO: 1, INVALIDATE: 1, IS: 1, ISOLATION: 1, ITEM: 1, ITEMS: 1, ITERATE: 1, JOIN: 1, KEY: 1, KEYS: 1, LAG: 1, LANGUAGE: 1, LARGE: 1, LAST: 1, LATERAL: 1, LEAD: 1,
        LEADING: 1, LEAVE: 1, LEFT: 1, LENGTH: 1, LESS: 1, LEVEL: 1, LIKE: 1, LIMIT: 1, LIMITED: 1, LINES: 1, LIST: 1, LOAD: 1, LOCAL: 1, LOCALTIME: 1, LOCALTIMESTAMP: 1,
        LOCATION: 1, LOCATOR: 1, LOCK: 1, LOCKS: 1, LOG: 1, LOGED: 1, LONG: 1, LOOP: 1, LOWER: 1, MAP: 1, MATCH: 1, MATERIALIZED: 1, MAX: 1, MAXLEN: 1, MEMBER: 1, MERGE: 1, METHOD: 1,
        METRICS: 1, MIN: 1, MINUS: 1, MINUTE: 1, MISSING: 1, MOD: 1, MODE: 1, MODIFIES: 1, MODIFY: 1, MODULE: 1, MONTH: 1, MULTI: 1, MULTISET: 1, NAME: 1, NAME: 1, NAMES: 1, NATIONAL: 1, NATURAL: 1,
        NCHAR: 1, NCLOB: 1, NEW: 1, NEXT: 1, NO: 1, NONE: 1, NOT: 1, NULL: 1, NULLIF: 1, NUMBER: 1, NUMERIC: 1, OBJECT: 1, OF: 1, OFFLINE: 1, OFFSET: 1, OLD: 1, ON: 1, ONLINE: 1, ONLY: 1,
        OPAQUE: 1, OPEN: 1, OPERATOR: 1, OPTION: 1, OR: 1, ORDER: 1, ORDINALITY: 1, OTHER: 1, OTHERS: 1, OUT: 1, OUTER: 1, OUTPUT: 1, OVER: 1, OVERLAPS: 1, OVERRIDE: 1, OWNER: 1,
        PAD: 1, PARALLEL: 1, PARAMETER: 1, PARAMETERS: 1, PARTIAL: 1, PARTITION: 1, PARTITIONED: 1, PARTITIONS: 1, PATH: 1, PERCENT: 1, PERCENTILE: 1, PERMISSION: 1,
        PERMISSIONS: 1, PIPE: 1, PIPELINED: 1, PLAN: 1, POOL: 1, POSITION: 1, PRECISION: 1, PREPARE: 1, PRESERVE: 1, PRIMARY: 1, PRIOR: 1, PRIVATE: 1, PRIVILEGES: 1, PROCEDURE: 1,
        PROCESSED: 1, PROJECT: 1, PROJECTION: 1, PROPERTY: 1, PROVISIONING: 1, PUBLIC: 1, PUT: 1, QUERY: 1, QUIT: 1, QUORUM: 1, RAISE: 1, RANDOM: 1, RANGE: 1, RANK: 1, RAW: 1, READ: 1,
        READS: 1, REAL: 1, REBUILD: 1, RECORD: 1, RECURSIVE: 1, REDUCE: 1, REF: 1, REFERENCE: 1, REFERENCES: 1, REFERENCING: 1, REGEXP: 1, REGION: 1, REINDEX: 1, RELATIVE: 1, RELEASE: 1,
        REMAINDER: 1, RENAME: 1, REPEAT: 1, REPLACE: 1, REQUEST: 1, RESET: 1, RESIGNAL: 1, RESOURCE: 1, RESPONSE: 1, RESTORE: 1, RESTRICT: 1, RESULT: 1, RETURN: 1, RETURNING: 1,
        RETURNS: 1, REVERSE: 1, REVOKE: 1, RIGHT: 1, ROLE: 1, ROLES: 1, ROLLBACK: 1, ROLLUP: 1, ROUTINE: 1, ROW: 1, ROWS: 1, RULE: 1, RULES: 1, SAMPLE: 1, SATISFIES: 1,
        SAVE: 1, SAVEPOINT: 1, SCAN: 1, SCHEMA: 1, SCOPE: 1, SCROLL: 1, SEARCH: 1, SECOND: 1, SECTION: 1, SEGMENT: 1, SEGMENTS: 1, SELECT: 1, SELF: 1, SEMI: 1, SENSITIVE: 1, SEPARATE: 1,
        SEQUENCE: 1, SERIALIZABLE: 1, SESSION: 1, SET: 1, SETS: 1, SHARD: 1, SHARE: 1, SHARED: 1, SHORT: 1, SHOW: 1, SIGNAL: 1, SIMILAR: 1, SIZE: 1, SKEWED: 1, SMALLINT: 1, SNAPSHOT: 1,
        SOME: 1, SOURCE: 1, SPACE: 1, SPACES: 1, SPARSE: 1, SPECIFIC: 1, SPECIFICTYPE: 1, SPLIT: 1, SQL: 1, SQLCODE: 1, SQLERROR: 1, SQLEXCEPTION: 1, SQLSTATE: 1, SQLWARNING: 1, START: 1,
        STATE: 1, STATIC: 1, STATUS: 1, STORAGE: 1, STORE: 1, STORED: 1, STREAM: 1, STRING: 1, STRUCT: 1, STYLE: 1, SUB: 1, SUBMULTISET: 1, SUBPARTITION: 1, SUBSTRING: 1, SUBTYPE: 1,
        SUM: 1, SUPER: 1, SYMMETRIC: 1, SYNONYM: 1, SYSTEM: 1, TABLE: 1, TABLESAMPLE: 1, TEMP: 1, TEMPORARY: 1, TERMINATED: 1, TEXT: 1, THAN: 1, THEN: 1, THROUGHPUT: 1, TIME: 1,
        TIMESTAMP: 1, TIMEZONE: 1, TINYINT: 1, TO: 1, TOKEN: 1, TOTAL: 1, TOUCH: 1, TRAILING: 1, TRANSACTION: 1, TRANSFORM: 1, TRANSLATE: 1, TRANSLATION: 1, TREAT: 1, TRIGGER: 1, TRIM: 1,
        TRUE: 1, TRUNCATE: 1, TTL: 1, TUPLE: 1, TYPE: 1, UNDER: 1, UNDO: 1, UNION: 1, UNIQUE: 1, UNIT: 1, UNKNOWN: 1, UNLOGGED: 1, UNNEST: 1, UNPROCESSED: 1, UNSIGNED: 1, UNTIL: 1, UPDATE: 1,
        UPPER: 1, URL: 1, USAGE: 1, USE: 1, USER: 1, USERS: 1, USING: 1, UUID: 1, VACUUM: 1, VALUE: 1, VALUED: 1, VALUES: 1, VARCHAR: 1, VARIABLE: 1, VARIANCE: 1, VARINT: 1, VARYING: 1, VIEW: 1,
        VIEWS: 1, VIRTUAL: 1, VOID: 1, WAIT: 1, WHEN: 1, WHENEVER: 1, WHERE: 1, WHILE: 1, WINDOW: 1, WITH: 1, WITHIN: 1, WITHOUT: 1, WORK: 1, WRAPPED: 1, WRITE: 1, YEAR: 1, ZONE: 1,
    },
};

module.exports = aws;

// Initialization of metadata
aws.configure = function(options, callback)
{
    var self = this;
    if (typeof callback != "function") callback = lib.noop;
    // Do not retrieve metadata if not running inside important process
    if (os.platform() != "linux" || options.noConfigure || ["shell","web","master","worker"].indexOf(core.role) == -1) {
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
    if (typeof callback != "function") callback = lib.noop;

    // Make sure we are running on EC2 instance
    if (!core.instance.id || !core.instance.image) return callback();
    lib.series([
       function(next) {
           // Set new tag if not set yet or it follows our naming convention, reboot could have launched a new app version so we set it
           if (core.instance.tag && !String(core.instance.tag).match(/^([a-z]+)-(a-z)-([0-9\.]+)$/i)) return next();
           self.ec2CreateTags(core.instance.id, core.runMode + "-" + core.appName + "-" + core.appVersion, function() { next() });
       },
       function(next) {
           if (!self.elbName) return next();
           self.elbRegisterInstances(self.elbName, core.instance.id, options, function() { next() });
       },
       ], callback);
}

// Read key and secret from the AWS SDK credentials file, if no profile is given in the config or command line only tge default peofile
// will be loaded.
aws.readCredentials = function(profile, callback)
{
    var self = this;
    if (typeof profile == "function") callback = profile, profile = null;
    if (typeof callback != "function") callback = lib.noop;

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
        callback();
    });
}

// Retrieve instance meta data
aws.getInstanceMeta = function(path, callback)
{
    var self = this;
    if (typeof callback != "function") callback = lib.noop;
    core.httpGet("http://169.254.169.254" + path, { httpTimeout: 100, quiet: true, retryCount: 2, retryTimeout: 100 }, function(err, params) {
        logger.debug('getInstanceMeta:', path, params.status, params.data, err || "");
        callback(err, params.status == 200 ? params.data : "");
    });
}

// Retrieve instance credentials using EC2 instance profile and setup for AWS access
aws.getInstanceCredentials = function(callback)
{
    if (!this.amiProfile) return typeof callback == "function" && callback();

    var self = this;
    self.getInstanceMeta("/latest/meta-data/iam/security-credentials/" + self.amiProfile, function(err, data) {
        if (!err && data) {
            var obj = lib.jsonParse(data, { obj: 1 });
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
    if (typeof callback != "function") callback = lib.noop;

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
                if (!err && data && data[0] != "#") core.parseArgs(bkutils.strSplit(data, " ", '"\''));
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
                if (!err) self.tags = lib.objGet(tags, "DescribeTagsResponse.tagSet.item", { list: 1 });
                if (!core.instance.tag) core.instance.tag = self.tags.filter(function(x) { return x.key == "Name" }).map(function(x) { return x.value }).join(",");
                next();
            });
        },
        ], function(err) {
            logger.debug('getInstanceInfo:', self.name, core.instance, 'profile:', self.amiProfile, 'expire:', self.tokenExpiration, err || "");
            callback();
    });
}

// Parse AWS response and try to extract error code and message, convert XML into an object.
aws.parseXMLResponse = function(err, params, options, callback)
{
    if (typeof callback != "function") callback = lib.noop;
    if (err || !params.data) return callback(err);
    try { params.obj = xml2json.toJson(params.data, { object: true }); } catch(e) { err = e; params.status += 1000 };
    if (params.status != 200) {
        var errors = lib.objGet(params.obj, "Response.Errors.Error", { list: 1 });
        if (errors.length && errors[0].Message) {
            err = lib.newError({ message: errors[0].Message, code: errors[0].Code, status: params.status });
        } else
        if (params.obj.Error && params.obj.Error.Message) {
            err = lib.newError({ message: params.obj.Error.Message, code: params.obj.Error.Code, status: params.status });
        }
        if (!err) err = lib.newError({ message: "Error: " + params.data, status: params.status });
        logger.logger((options && options.logger_error) || "error", 'queryAWS:', params.href, params.search, params.Action || "", err);
        return callback(err, params.obj);
    }
    logger.debug('queryAWS:', params.href, params.search, params.Action || "", params.obj);
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
    for (var p in options) if (p[0] >= 'A' && p[0] <= 'Z') req[p] = options[p];
    return req;
}

aws.queryOptions = function(method, data, headers, options)
{
    return {
        method: method || options.method || "POST",
        postdata: data,
        headers: headers,
        quiet: options.quiet,
        retryCount: options.retryCount,
        retryTimeout: options.retryTimeout,
        retryOnErrorStatus: options.retryOnErrorStatus,
        httpTimeout: options.httpTimeout
    };
}

// Make AWS request, return parsed response as Javascript object or null in case of error
aws.queryAWS = function(region, endpoint, proto, host, path, obj, options, callback)
{
    var self = this;

    var headers = {}, params = [], query = "";
    for (var p in obj) {
        if (typeof obj[p] != "undefined") params.push([p, obj[p]]);
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
    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {};
    var region = options.region || this.region  || 'us-east-1';
    var e = options.endpoint ? url.parse(options.endpoint) : null;
    var proto = options.endpoint_protocol || (e && e.protocol) || 'https';
    var host = options.endpoint_host || (e && e.host) || (endpoint + '.' + region + '.amazonaws.com');
    var path = options.endpoint_path || (e && e.hostname) || '/';
    var req = this.queryPrepare(action, version, obj, options);
    this.queryAWS(region, endpoint, proto, host, path, req, options, callback);
}

// AWS EC2 API request
aws.queryEC2 = function(action, obj, options, callback)
{
    this.queryEndpoint("ec2", '2014-05-01', action, obj, options, callback);
}

// AWS ELB API request
aws.queryELB = function(action, obj, options, callback)
{
    this.queryEndpoint("elasticloadbalancing", '2012-06-01', action, obj, options, callback);
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
    this.queryEndpoint("ses", '2010-12-01', action, obj, options, callback);
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

// Make a request to Route53 service
aws.queryRoute53 = function(method, path, data, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {};

    var curTime = new Date().toUTCString();
    var uri = "https://route53.amazonaws.com/2013-04-01" + path;
    var headers = { "x-amz-date": curTime, "content-type": "text/xml; charset=UTF-8", "content-length": data.length };
    headers["X-Amzn-Authorization"] = "AWS3-HTTPS AWSAccessKeyId=" + this.key + ",Algorithm=HmacSHA1,Signature=" + lib.sign(this.secret, curTime);

    core.httpGet(uri, this.query.options(method, data, headers, options), function(err, params) {
        self.parseXMLResponse(err, params, options, callback);
    });
}

// DynamoDB requests
aws.queryDDB = function (action, obj, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = {};
    if (typeof callback != "function") callback = lib.noop;
    if (!options) options = {};
    var start = Date.now();
    var region = options.region || this.region  || 'us-east-1';
    if (options.endpoint && options.endpoint.match(/[a-z][a-z]-[a-z]+-[1-9]/)) region = options.endpoint;
    var uri = options.endpoint && options.endpoint.match(/^https?:\/\//) ? options.endpoint : ((options.endpoint_protocol || 'http://') + 'dynamodb.' + region + '.amazonaws.com/');
    var version = '2012-08-10';
    var target = 'DynamoDB_' + version.replace(/\-/g,'') + '.' + action;
    var headers = { 'content-type': 'application/x-amz-json-1.0; charset=utf-8', 'x-amz-target': target };
    var req = url.parse(uri);
    // All capitalized options are passed as is and take priority because they are in native format
    for (var p in options) if (p[0] >= 'A' && p[0] <= 'Z') obj[p] = options[p];
    var json = JSON.stringify(obj);

    logger.debug('queryDDB:', action, uri, 'obj:', obj, 'options:', options, 'item:', obj);

    this.querySign(region, "dynamodb", req.hostname, "POST", req.path, json, headers);
    core.httpGet(uri, this.queryOptions("POST", json, headers, options), function(err, params) {
        // Reply is always JSON but we dont take any chances
        if (params.data) {
            try { params.json = JSON.parse(params.data); } catch(e) { err = e; params.status += 1000; }
        }
        if (params.status != 200) {
            // Try several times, special cases or if err is not empty
            if ((err || params.status == 500 || params.data.match(/(ProvisionedThroughputExceededException|ThrottlingException)/)) && options.retryCount-- > 0) {
                options.retryTimeout *= 3;
                logger.debug('queryDDB:', action, obj, err || params.data, 'retrying:', options.retryCount, options.retryTimeout);
                return setTimeout(function() { self.queryDDB(action, obj, options, callback); }, options.retryTimeout);
            }
            // Report about the error
            if (!err) {
                err = lib.newError(params.json.message || params.json.Message || (action + " Error"));
                err.code = (params.json.__type || params.json.code).split('#').pop();
            }
            logger[options.silence_error || err.code == "ConditionalCheckFailedException" ? "debug" : "error"]('queryDDB:', action, obj, err || params.data);
            return callback(err, {});
        }
        logger.debug('queryDDB:', action, 'finished:', Date.now() - start, 'ms', params.json.Item ? 1 : (params.json.Count || 0), 'rows', params.json.ConsumedCapacity || "");
        callback(err, params.json || {});
    });
}

// Sign S3 AWS request, returns url to be send to S3 server, options will have all updated headers to be sent as well
aws.signS3 = function(method, bucket, path, options)
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
    path = url.parse(path || "/").pathname;

    strSign += (bucket ? "/" + bucket : "") + (path[0] != "/" ? "/" : "") + path + (rc.length ? "?" : "") + rc.sort().join("&");
    var signature = lib.sign(options.secret || this.secret, strSign);
    options.headers["authorization"] = "AWS " + (options.key || this.key) + ":" + signature;

    // DNS compatible or not, use path-style if not for access otherwise virtual host style
    var dns = bucket.match(/[a-z0-9][a-z0-9\-]*[a-z0-9]/) ? true : false;

    var uri = options.endpoint_protocol || 'http://';
    uri += dns ? bucket + "." : "";
    uri += "s3" + (region != "us-east-1" ? "-" + region : "") + ".amazonaws.com";
    uri += dns ? "" : "/" + bucket;
    uri += (path[0] != "/" ? "/" : "") + path;

    // Build REST url
    if (options.url) {
        uri += url.format({ query: options.query });
        uri += (uri.indexOf("?") == -1 ? "?" : "") + '&AWSAccessKeyId=' + (options.key || this.key) + "&Signature=" + encodeURIComponent(signature);
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
    if (typeof callback != "function") callback = lib.noop;
    if (!options) options = {};

    var uri = this.signS3(options.method, bucket, path, options);
    core.httpGet(uri, options, function(err, params) {
        if (err || params.status != 200) return callback(err || lib.newError({ message: "Error: " + params.status, name: "S3", status : params.status }), params);
        if (options.json) return self.parseXMLResponse(err, params, options, callback);
        callback(err, params);
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
    if (!options.headers['content-type']) options.headers['content-type'] = mime.lookup(path);
    options[Buffer.isBuffer(file) ? 'postdata' : 'postfile'] = file;
    var uri = self.s3ParseUrl(path);
    if (uri.query) options.query = uri.query;
    logger.debug("s3PutFile:", uri, typeof file);
    aws.queryS3(uri.bucket, uri.path, options, callback);
}

// Parse an S3 URL and return an object with bucket and path
aws.s3ParseUrl = function(url)
{
    var rc = {}
    url = url.split("?");
    // Remove the protocol part and leading slashes
    url[0] = url[0].replace(/(^.+\:\/\/|^\/+)/, "");
    var path = url[0].replace("//", "/").split("/");
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
//  - name - assign a tag to the instance as `Name:`, any occurences of %i will be replaced with the instance index
//  - elbName - join elastic balancer after the startup
//  - elasticIp - asociate with the given Elastic IP address after the start
//  - iamProfile - IAM profile to assign for instance credentials, if not given use aws.iamProfile or options['IamInstanceProfile.Name'] attribute
//  - availZone - availability zone, if not given use aws.availZone or options['Placement.AvailabilityZone'] attribute
//  - subnetId - subnet id, if not given use aws.subnetId or options.SubnetId attribute
//  - alarms - a list with CloudWatch alarms to create for the instance, each value of the object represent an object with options to be
//      passed to the cwPutMetricAlarm method.
aws.ec2RunInstances = function(options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = {};
    if (typeof callback != "function") callback = lib.noop;

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
            var groups = lib.strSplitUnique(options.groupId || this.groupId || []);
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
            var groups = lib.strSplitUnique(options.groupId || this.groupId || []);
            groups.forEach(function(x, i) { req["SecurityGroupId." + i] = x; });
        }
        if (options.ip) {
            req.PrivateIpAddress = ip;
        }
    }
    if (options.file) req.UserData = lib.readFileSync(options.file).toString("base64");

    logger.debug('runInstances:', this.name, req, options);
    this.queryEC2("RunInstances", req, options, function(err, obj) {
        if (err) return callback(err);

        // Instances list
        var items = lib.objGet(obj, "RunInstancesResponse.instancesSet.item", { list: 1 });
        if (!items.length) return callback ? callback(err, obj) : null;

        // Dont wait for instance if no additional tasks requested
        if (!options.waitRunning &&
            !options.name &&
            !options.elbName &&
            !options.elasticIp &&
            (!Array.isArray(options.alarms) || !options.alarms.length)) {
            return callback(err, obj);
        }
        var instanceId = items[0].instanceId;

        lib.series([
           function(next) {
               self.ec2WaitForInstance(instanceId, "running", { waitTimeout: 300000, waitDelay: 5000 }, next);
           },
           function(next) {
               // Set tag name for all instances
               if (!options.name) return next();
               lib.forEachSeries(items, function(item, next2) {
                   self.ec2CreateTags(item.instanceId, options.name.replace("%i", lib.toNumber(item.amiLaunchIndex) + 1), next2);
               }, next);
           },
           function(next) {
               // Add to the ELB
               if (!options.elbName) return next();
               self.elbRegisterInstances(options.elbName, items.map(function(x) { return x.instanceId }), next);
           },
           function(next) {
               // Elastic IP
               if (!options.elasticIp) return next();
               self.ec2AssociateAddress(instanceId, options.elasticIp, { subnetId: req.SubnetId || req["NetworkInterface.0.SubnetId"] }, next);
           },
           function(next) {
               // CloudWatch alarms
               if (!Array.isArray(options.alarms)) return next();
               lib.forEachSeries(items, function(item, next2) {
                   lib.forEachSeries(options.alarms, function(alarm, next3) {
                       alarm.dimensions = { InstanceId: item.instanceId }
                       self.cwPutMetricAlarm(alarm, next3);
                   }, next2);
               }, next);
           },
           ], function() {
                callback(err, obj);
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
    if (typeof callback != "function") callback = lib.noop;

    var state = "", num = 0, expires = Date.now() + (options.waitTimeout || 60000);
    lib.doWhilst(
      function(next) {
          self.queryEC2("DescribeInstances", { 'Filter.1.Name': 'instance-id', 'Filter.1.Value.1': instanceId }, function(err, rc) {
              if (err) return next(err);
              state = lib.objGet(rc, "DescribeInstancesResponse.reservationSet.item.instancesSet.item.instanceState.name");
              setTimeout(next, num++ ? (options.waitDelay || 5000) : 0);
          });
      },
      function() {
          return state != status && Date.now() < expires;
      },
      callback);
}

// Describe securty groups, optionally if `options.filter` regexp is provided then limit the result to the matched groups only,
// return list of groups to the callback
aws.ec2DescribeSecurityGroups = function(options, callback)
{
    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {};

    var req = this.vpcId ? { "Filter.1.Name": "vpc-id", "Filter.1.Value": this.vpcId } : {};
    if (options.name) {
        lib.strSplit(options.name).forEach(function(x, i) {
            req["Filter." + (i + 2) + ".Name"] = "group-name";
            req["Filter." + (i + 2) + ".Value"] = x;
        });
    }

    this.queryEC2("DescribeSecurityGroups", req, options, function(err, rc) {
        if (err) return typeof callback == "function" && callback(err);

        var groups = lib.objGet(rc, "DescribeSecurityGroupsResponse.securityGroupInfo.item", { list: 1 });
        // Filter by name regexp
        if (options.filter) {
            groups = groups.filter(function(x) { return x.groupName.match(options.filter) });
        }
        if (typeof callback == "function") callback(err, groups);
    });
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
        self.queryEC2("DescribeAddresses", { 'PublicIp.1': elasticIp }, options, function(err, obj) {
            params.AllocationId = lib.objGet(obj, "DescribeAddressesResponse.AddressesSet.item.allocationId");
            if (!params.AllocationId) err = lib.newError({ message: "EIP not found", name: "EC2", code: elasticIp });
            if (err) return callback ? callback(err) : null;
            self.queryEC2("AssociateAddress", params, options, callback);
        });
    } else {
        self.queryEC2("AssociateAddress", params, options, callback);
    }
}

// Create an EBS image from the instance given or the current instance running
aws.ec2CreateImage = function(options, callback)
{
    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {};

    var req = { InstanceId: options.instanceId, Name: options.name || (core.appName + "-" + core.appVersion) };
    if (options.noreboot) req.NoReboot = true;
    if (options.reboot) req.NoReboot = false;
    if (options.descr) req.Description = options.descr;

    // If creating image from the current inddtance then no reboot
    if (!req.InstanceId && core.instance.type == "aws") req.InstanceId = core.instance.id, req.NoReboot = true;

    this.queryEC2("CreateImage", req, options, callback);
}

// Deregister an AMI by id. If `options.snapshots` is set, then delete all snapshots for this image as well
aws.ec2DeregisterImage = function(ami_id, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {};

    // Not deleting snapshots, just deregister
    if (!options.snapshots) return self.queryEC2("DeregisterImage", { ImageId: ami_id }, options, callback);

    // Pull the image meta data and delete all snapshots
    self.queryEC2("DescribeImages", { 'ImageId.1': ami_id }, options, function(err, rc) {
        if (err) return callback ? callback(err) : null;

        var items = lib.objGet(rc, "DescribeImagesResponse.imagesSet.item", { list: 1 });
        if (!items.length) return calback ? callback(lib.newError({ message: "no AMI found", name: ami_id })) : null;

        var volumes = lib.objGet(items[0], "blockDeviceMapping.item", { list : 1 });
        self.queryEC2("DeregisterImage", { ImageId: ami_id }, options, function(err) {
            if (err) return callback ? callback(err) : null;

            lib.forEachSeries(volumes, function(vol, next) {
                if (!vol.ebs || !vol.ebs.snapshotId) return next();
                self.queryEC2("DeleteSnapshot", { SnapshotId: vol.ebs.snapshotId }, options, next);
            }, callback)
        });
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

// Convert a Javascript object into DynamoDB object
aws.toDynamoDB = function(value, level)
{
    switch (lib.typeName(value)) {
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
        if (!value.length) return level ? { "L": value } : value;
        var types = { number: 0, string: 0 };
        for (var i = 0; i < value.length; i++) types[typeof value[i]]++;
        if (types.number == value.length) return { "NS": value };
        if (types.string == value.length) return { "SS": value };
        var res = [];
        for (var i in value) {
            if (typeof value[i] != 'undefined') res.push(this.toDynamoDB(value[i], 1));
        }
        return level ? { "L": res } : res;

    case 'object':
        var res = {};
        for (var p in value) {
            if (typeof value[p] != 'undefined') res[p] = this.toDynamoDB(value[p], 1);
        }
        return level ? { "M" : res } : res;

    default:
        return { "S": String(value) };
    }
}

// Convert a DynamoDB object into Javascript object
aws.fromDynamoDB = function(value, level)
{
    switch (lib.typeName(value)) {
    case 'array':
        var res = [];
        for (var i in value) {
            res.push(this.fromDynamoDB(value[i], level));
        }
        return res;

    case 'object':
        if (level) {
            for (var p in value) {
                switch(p) {
                case 'NULL':
                    return null;
                case 'BOOL':
                    return lib.toBool(value[p]);
                case 'L':
                    return this.fromDynamoDB(value[p], 1);
                case 'M':
                    return this.fromDynamoDB(value[p]);
                case 'S':
                case 'SS':
                    return value[p];
                case 'B':
                    return new Buffer(value[i]['B'], "base64");
                case 'BS':
                    var res = [];
                    for (var j = 0; j < value[p].length; j ++) {
                        res[j] = new Buffer(value[p][j], "base64");
                    }
                    return res;
                case 'N':
                    return lib.toNumber(value[p]);
                case 'NS':
                    var res = [];
                    for (var j = 0; j < value[p].length; j ++) {
                        res[j] = lib.toNumber(value[p][j]);
                    }
                    return res;
                }
            }
            return null;
        } else {
            var res = {};
            for (var p in value) {
                if (!value.hasOwnProperty(p)) continue;
                res[p] = this.fromDynamoDB(value[p], 1);
            }
            return res;
        }

    default:
        return value;
    }
}

// Build query or scan filter objects for the given object, all properties in the obj are used
aws.queryFilter = function(obj, options)
{
    var self = this;
    var filter = {};
    var opsMap = { 'like%': 'begins_with', '=': 'eq', '<=': 'le', '<': 'lt', '>=': 'ge', '>': 'gt' };
    if (!options.ops) options.ops = {};

    for (var name in obj) {
        var val = obj[name];
        var op = options.ops[name] || "eq";
        if (opsMap[op]) op = opsMap[op];
        if (val == null) op = "null";

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
                if (!val.length) continue;
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

// Build a condition expression for the given object, all properties in the obj are used
aws.queryExpression = function(obj, options)
{
    var opsMap = { "!=": "<>", eq: "=", ne: "<>", lt: "<", le: ",=", gt: ">", ge: ">=" };
    if (!options.ops) options.ops = {};
    var v = 0, n = 0, values = {}, expr = [], names = {};

    for (var name in obj) {
        var val = obj[name];
        var op = options.ops[name] || "eq";
        if (opsMap[op]) op = opsMap[op];
        if (val == null) op = "null";
        if (this.ddbReserved[name.toUpperCase()]) {
            names["#n" + n] = name;
            name = "#n" + n++;
        }

        switch (op) {
        case 'not_between':
        case 'not between':
        case 'between':
            if (val.length < 2) continue;
            expr.push((op[0] == 'n' ? "not " : "") + name + " between " + " :v" + v + " and :v" + (v + 1));
            values[":v" + v++] = val[0];
            values[":v" + v++] = val[1];
            break;

        case 'not_null':
        case 'not null':
            expr.push("attribute_exists(" + name + ")");
            break;

        case 'null':
            expr.push("attribute_not_exists(" + name + ")");
            break;

        case 'not in':
        case 'not_in':
        case 'in':
            if (Array.isArray(val)) {
                if (!val.length) break;
                var vals = [];
                for (var i = 0; i < val.length; i++) {
                    if (!val[i]) continue;
                    vals.push(":v" + v);
                    values[":v" + v++] = val[i];
                }
                if (!vals.length) break;
                expr.push((op[0] == 'n' ? "not " : "") + name + " in (" + vals + ")");
            } else
            if (val) {
                expr.push(name + " " + (op[0] == 'n' ? "<>" : "=") + " :v" + n);
                values[":v" + v++] = val;
            }
            break;

        case 'not_contains':
        case 'not contains':
            expr.push("not contains(" + name + "," + " :v" + v + ")");
            values[":v" + v++] = val;
            break;

        case 'contains':
            expr.push("contains(" + name + "," + " :v" + v + ")");
            values[":v" + v++] = val;
            break;

        case '=':
        case '<>':
        case '>':
        case '>=':
        case '<':
        case '<=':
            expr.push(name + " " + op + " :v" + v);
            values[":v" + v++] = val;
            break;

        case 'like%':
        case 'begins_with':
            if (!val && ["string","object","number","undefined"].indexOf(typeof val) > -1) continue;
            expr.push("begins_with(" + name + "," + " :v" + v + ")");
            values[":v" + v++] = val;
            break;
        }
    }
    if (!expr.length) return null;
    var rc = { expr: expr.join(" " + (options.join || "and") + " ") };
    if (n) rc.names = names;
    if (v) rc.values = values;
    return rc;
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
    if (typeof callback != "function") callback = lib.noop;
    var params = { TableName: name };
    this.queryDDB('DescribeTable', params, options, function(err, rc) {
        logger.debug('DescribeTable:', name, rc);
        callback(err, rc);
    });
}

// Create a table
// - attrs can be an array in native DDB JSON format or an object with name:type properties, type is one of S, N, NN, NS, BS
// - options may contain any valid native property if it starts with capital letter and the following:
//   - waitTimeout - number of milliseconds to wait for ACTIVE status
//   - waitDelay - how often to pool for table status, default is 250ms
//   - keys is an array of column ids used for the primary key or a string with the hash key. if omitted, the first attribute will be used for the primary key
//   - local - an object with each property for a local secondary index name defining key format the same way as for primary keys, all Uppercase properties are added to the top index object
//   - global - an object for global secondary indexes, same format as for local indexes
//   - projection - an object with index name and list of projected properties to be included in the index or "ALL" for all properties, if omitted then default KEYS_ONLY is assumed
//   - readCapacity - read capacity units for provisioned throughput
//   - writeCapacity - write capacity units
//
//
// Example:
//
//          ddbCreateTable('users', { id: 'S', mtime: 'N', name: 'S'},
//                                  { keys: ["id", "name"],
//                                    local: { mtime: { mtime: "HASH" } },
//                                    global: { name: { name: 'HASH', ProvisionedThroughput: { ReadCapacityUnits: 50 } } },
//                                    projection: { mtime: ['gender','age'],
//                                                  name: ['name','gender'] },
//                                    readCapacity: 10,
//                                    writeCapacity: 10 });
aws.ddbCreateTable = function(name, attrs, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = {};
    if (typeof callback != "function") callback = lib.noop;
    if (!options) options = {};
    var params = { TableName: name,
                   AttributeDefinitions: [],
                   KeySchema: [],
                   ProvisionedThroughput: { ReadCapacityUnits: options.readCapacity || self.ddbReadCapacity || self.ddbDefaultCapacity,
                                            WriteCapacityUnits: options.writeCapacity || self.ddbWriteCapacity || self.ddbDefaultCapacity }};

    if (Array.isArray(attrs) && attrs.length) {
        params.AttributeDefinitions = attrs;
    } else {
        for (var p in attrs) {
            params.AttributeDefinitions.push({ AttributeName: p, AttributeType: String(attrs[p]).toUpperCase() });
        }
    }
    if (Array.isArray(options.keys)) {
        options.keys.forEach(function(x, i) {
            params.KeySchema.push({ AttributeName: x, KeyType: !i ? "HASH" : "RANGE" });
        });
    } else
    if (typeof options.keys == "string" && options.keys) {
        params.KeySchema.push({ AttributeName: options.keys, KeyType: "HASH" });
    }
    if (!params.KeySchema.length) {
        params.KeySchema.push({ AttributeName: params.AttributeDefinitions[0].AttributeName, KeyType: "HASH" });
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
        if (err || options.nowait) return callback(err, err ? { TableDescription: params } : item);

        // Wait because DynamoDB cannot create multiple tables at once especially with indexes
        options.waitStatus = "CREATING";
        self.ddbWaitForTable(name, item, options, callback);
    });
}

// Update tables provisioned throughput settings, options is used instead of table name so this call can be used directly in the cron jobs to adjust
// provisionined throughput on demand.
// Options must provide the following properties:
//  - name - table name
//  - readCapacity -
//  - writeCapacity - new povisioned throughtput settings
//  - add - an object with indexes to create
//  - del - delete a global secondary index by name, a string or a list with multiple indexes
//  - update - an object with indexes to update
//
//  Example
//
//              aws.ddbUpdateTable({ name: "users", add: { name_id: { name: "S", id: 'N', readCapacity: 20, writeCapacity: 20, projection: ["mtime","email"] } })
//              aws.ddbUpdateTable({ name: "users", add: { name: { name: "S", readCapacity: 20, writeCapacity: 20, projection: ["mtime","email"] } })
//              aws.ddbUpdateTable({ name: "users", del: "name" })
//              aws.ddbUpdateTable({ name: "users", update: { name: { readCapacity: 10, writeCapacity: 10 } })
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
    var params = { TableName: options.name };
    if (options.readCapacity && options.writeCapacity) {
        params.ProvisionedThroughput = { ReadCapacityUnits: options.readCapacity, WriteCapacityUnits: options.writeCapacity };
    }
    if (options.add) {
        if (!params.AttributeDefinitions) params.AttributeDefinitions = [];
        if (!params.GlobalSecondaryIndexUpdates) params.GlobalSecondaryIndexUpdates = [];
        for (var name in options.add) {
            var obj = options.add[name];
            if (name.length <= 2) name = "i_" + name;
            var index = { IndexName: name,
                          KeySchema: [],
                          Projection: { ProjectionType: "KEYS_ONLY" },
                          ProvisionedThroughput: { ReadCapacityUnits: options.readCapacity || self.ddbReadCapacity || 10,
                                                   WriteCapacityUnits: options.writeCapacity || self.ddbWriteCapacity/2 || 5 }
            };
            for (var p in obj) {
                if (lib.isEmpty(obj[p])) continue;
                switch (p) {
                case "readCapacity":
                    index.ProvisionedThroughput.ReadCapacityUnits = obj[p];
                    break;
                case "writeCapacity":
                    index.ProvisionedThroughput.WriteCapacityUnits = obj[p];
                    break;
                case "projection":
                    index.Projection = { ProjectionType: Array.isArray(obj[p]) ? "INCLUDE" : String(obj[p]).toUpperCase() };
                    if (index.Projection.ProjectionType == "INCLUDE") index.Projection.NonKeyAttributes = obj[p];
                    break;
                default:
                    index.KeySchema.push({ AttributeName: p, KeyType: index.KeySchema.length ? "RANGE" : "HASH" })
                    params.AttributeDefinitions.push({ AttributeName: p, AttributeType: obj[p] || "S" });
                }
            }
            params.GlobalSecondaryIndexUpdates.push({ Create: index });
        }
    } else

    if (options.del) {
        if (!params.GlobalSecondaryIndexUpdates) params.GlobalSecondaryIndexUpdates = [];
        lib.strSplit(options.del).forEach(function(x) {
            params.GlobalSecondaryIndexUpdates.push({ Delete: { IndexName: x } });
        });
    } else

    if (options.update) {
        if (!params.GlobalSecondaryIndexUpdates) params.GlobalSecondaryIndexUpdates = [];
        for (var p in options.update) {
            var idx = { Update: { IndexName: p, ProvisionedThroughput: {} } };
            idx.ProvisionedThroughput.ReadCapacityUnits = options.update[p].readCapacity;
            idx.ProvisionedThroughput.WriteCapacityUnits = options.update[p].writeCapacity;
            params.GlobalSecondaryIndexUpdates.push(idx);
        }
    }

    this.queryDDB('UpdateTable', params, options, callback);
}

// Remove a table from the database.
// By default the callback will ba callled only after the table is deleted, specifying `options.nowait` will return immediately
aws.ddbDeleteTable = function(name, options, callback)
{
    var self = this;
    var params = { TableName: name };
    this.queryDDB('DeleteTable', params, options, function(err, item) {
        if (err || options.nowait) return callback(err, item);
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
    if (typeof callback != "function") callback = lib.noop;
    if (!options.waitTimeout) return callback(null, item);

    var expires = Date.now() + options.waitTimeout;
    var status = item.TableDescription.TableStatus;
    options = lib.cloneObj(options);
    options.silence_error = 1;
    lib.whilst(
      function() {
          return status == options.waitStatus && Date.now() < expires;
      },
      function(next) {
          self.ddbDescribeTable(name, options, function(err, rc) {
              if (err) {
                  // Table deleted, does not exist anymore
                  if (err.code == "ResourceNotFoundException" && options.waitStatus == "DELETING") {
                      status = err = null;
                  }
                  return next(err);
              }
              status = rc.Table.TableStatus;
              setTimeout(next, options.waitDelay || 1000);
          });
      },
      function(err) {
          callback(err, item);
      });
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
//    - returning - values to be returned on success, * means ALL_NEW
//
// Example:
//
//          ddbPutItem("users", { id: 1, name: "john", mtime: 11233434 }, { expected: { name: null } })
//
aws.ddbPutItem = function(name, item, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = {};
    if (typeof callback != "function") callback = lib.noop;
    if (!options) options = {};
    var params = { TableName: name, Item: self.toDynamoDB(item) };
    if (options.expected) {
        var expected = this.queryExpression(options.expected, options);
        if (expected) {
            params.ConditionExpression = expected.expr;
            if (expected.names) params.ExpressionAttributeNames = expected.names;
            if (expected.values) params.ExpressionAttributeValues = self.toDynamoDB(expected.values);
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
        params.ReturnValues = options.returning == "*" ? "ALL_NEW" : options.returning;
    }
    this.queryDDB('PutItem', params, options, function(err, rc) {
        rc.Item = rc.Attributes ? self.fromDynamoDB(rc.Attributes) : {};
        callback(err, rc);
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
//      - action - an object with operators to be used for properties, one of the: SET, REMOVE, DELETE, ADD, APPEND, PREPEND, NOT_EXISTS
//      - expected - an object with column to be used in ConditionExpression, value null means an attrobute does not exists,
//          any other value to be checked against using regular compare rules. The conditional comparison operator is taken
//          from `options.ops` the same way as for queries.
//      - returning - values to be returned on success, * means ALL_NEW
//
// Example:
//
//          ddbUpdateItem("users", { id: 1, name: "john" }, { gender: 'male', icons: '1.png' }, { action: { icons: 'ADD' }, expected: { id: 1 }, ReturnValues: "ALL_NEW" })
//          ddbUpdateItem("users", { id: 1, name: "john" }, { gender: 'male', icons: '1.png' }, { action: { icons: 'ADD' }, expected: { id: null } })
//          ddbUpdateItem("users", { id: 1, name: "john" }, { gender: 'male', icons: '1.png', num: 1 }, { action: { num: 'ADD', icons: 'ADD' }, expected: { id: null, num: 0 }, ops: { num: "gt" } })
//
aws.ddbUpdateItem = function(name, keys, item, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = {};
    if (typeof callback != "function") callback = lib.noop;
    if (!options) options = {};
    var params = { TableName: name, Key: {} };
    for (var p in keys) {
        params.Key[p] = self.toDynamoDB(keys[p]);
    }
    if (options.expected) {
        var expected = this.queryExpression(options.expected, options);
        if (expected) {
            params.ConditionExpression = expected.expr;
            if (expected.names) params.ExpressionAttributeNames = expected.names;
            if (expected.values) params.ExpressionAttributeValues = self.toDynamoDB(expected.values);
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
        params.ReturnValues = options.returning == "*" ? "ALL_NEW" : options.returning;
    }
    if (typeof item == "string") {
        params.UpdateExpression = item;
    } else
    if (typeof item == "object") {
        var c = 0, d = 0, names = {}, values = {}, actions = { SET: [], REMOVE: [], ADD: [], DELETE: [] };
        for (var p in item) {
            if (params.Key[p]) continue;
            var val = item[p], colname = p;
            if (this.ddbReserved[p.toUpperCase()]) {
                names["#c" + c] = p;
                p = "#c" + c++;
            }
            switch (lib.typeName(val)) {
                case 'null':
                case 'undefined':
                    actions.REMOVE.push(p);
                    break;

                case 'array':
                    if (!val.length) {
                        actions.REMOVE.push(p)
                        break;
                    }

                case "string":
                    if (!val) {
                        actions.REMOVE.push(p);
                        break;
                    }

                default:
                    var op = (options.action && options.action[colname]) || 'SET';
                    switch (op) {
                    case "ADD":
                    case "DELETE":
                        actions[op].push(p + " " + ":d" + d);
                        values[":d" + d++] = val;
                        break;

                    case "REMOVE":
                        actions.REMOVE.push(p);
                        break;

                    case "APPEND":
                        actions.SET.push(p + "=list_append(" + p + ",:d" + d + ")");
                        values[":d" + d++] = val;
                        break;

                    case "PREPEND":
                        actions.SET.push(p + "=list_append(:d" + d + "," + p + ")");
                        values[":d" + d++] = val;
                        break;

                    case "NOT_EXISTS":
                        actions.SET.push(p + "=if_not_exists(" + p + ",:d" + d + ")");
                        values[":d" + d++] = val;
                        break;

                    default:
                        if (!actions[op]) break;
                        actions[op].push(p + "= :d" + d);
                        values[":d" + d++] = val;
                    }
                    break;
            }
            params.UpdateExpression = "";
            for (var p in actions) {
                var expr = actions[p].join(",");
                if (expr) params.UpdateExpression += " " + p + " " + expr;
            }
            if (c) {
                if (!params.ExpressionAttributeNames) params.ExpressionAttributeNames = {};
                for (var p in names) params.ExpressionAttributeNames[p] = names[p];
            }
            if (d) {
                if (!params.ExpressionAttributeValues) params.ExpressionAttributeValues = {};
                for (var p in values) params.ExpressionAttributeValues[p] = this.toDynamoDB(values[p], 1);
            }
        }
    }
    this.queryDDB('UpdateItem', params, options, function(err, rc) {
        rc.Item = rc.Attributes ? self.fromDynamoDB(rc.Attributes) : {};
        callback(err, rc);
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
//      - returning - values to be returned on success, * means ALL_OLD
//
// Example:
//
//          ddbDeleteItem("users", { id: 1, name: "john" }, {})
//
aws.ddbDeleteItem = function(name, keys, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = {};
    if (typeof callback != "function") callback = lib.noop;
    if (!options) options = {};
    var params = { TableName: name, Key: {} };
    for (var p in keys) {
        params.Key[p] = self.toDynamoDB(keys[p]);
    }
    if (options.expected) {
        var expected = this.queryExpression(options.expected, options);
        if (expected) {
            params.ConditionExpression = expected.expr;
            if (expected.names) params.ExpressionAttributeNames = expected.names;
            if (expected.values) params.ExpressionAttributeValues = self.toDynamoDB(expected.values);
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
        params.ReturnValues = options.returning == "*" ? "ALL_OLD" : options.returning;
    }
    this.queryDDB('DeleteItem', params, options, function(err, rc) {
        rc.Item = rc.Attributes ? self.fromDynamoDB(rc.Attributes) : {};
        callback(err, rc);
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
    if (typeof callback != "function") callback = lib.noop;
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
        callback(err, rc);
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
    if (typeof callback != "function") callback = lib.noop;
    if (!options) options = {};
    var params = { RequestItems: {} };
    for (var p in items) {
        var obj = {};
        obj.Keys = items[p].keys.map(function(x) { return self.toDynamoDB(x); });
        if (items[p].select) obj.AttributesToGet = lib.strSplit(items[p].select);
        if (items[p].consistent) obj.ConsistentRead = true;
        params.RequestItems[p] = obj;
    }
    this.queryDDB('BatchGetItem', params, options, function(err, rc) {
        for (var p in rc.Responses) {
            rc.Responses[p] = self.fromDynamoDB(rc.Responses[p]);
        }
        callback(err, rc);
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
    if (typeof callback != "function") callback = lib.noop;
    if (!options) options = {};
    var params = { TableName: name, Key: {} };
    if (options.select) {
        params.AttributesToGet = lib.strSplit(options.select);
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
        callback(err, rc);
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
    if (typeof callback != "function") callback = lib.noop;
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
        params.AttributesToGet = lib.strSplit(options.select);
    }
    if (options.count) {
        params.Limit = options.count;
    }
    if (options.total) {
        params.Select = "COUNT";
    }
    if (typeof condition == "string") {
        params.KeyConditionExpression = condition;
    } else
    if (Array.isArray(options.keys)) {
        var keys = Object.keys(condition).filter(function(x) { return options.keys.indexOf(x) > -1}).reduce(function(x,y) {x[y] = condition[y]; return x; }, {});
        var filter = Object.keys(condition).filter(function(x) { return options.keys.indexOf(x) == -1}).reduce(function(x,y) {x[y] = condition[y]; return x; }, {});
        params.KeyConditions = this.queryFilter(keys, options);
        params.QueryFilter = this.queryFilter(filter, options);
    } else
    if (lib.isObject(options.keys)) {
        params.KeyConditionExpression = this.queryExpression(options.keys, options);
    } else {
        params.KeyConditions = this.queryFilter(condition, options);
    }

    this.queryDDB('Query', params, options, function(err, rc) {
        rc.Items = rc.Items ? self.fromDynamoDB(rc.Items) : [];
        callback(err, rc);
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
    if (typeof callback != "function") callback = lib.noop;
    if (!options) options = {};
    var params = { TableName: name, ScanFilter: {} };
    if (options.projection) {
        params.ProjectionExpression = options.projection;
    }
    if (options.names) {
        params.ExpressionAttributeNames = self.toDynamoDB(options.names);
    }
    if (options.sort) {
        params.IndexName = (options.sort.length > 2 ? '' : '_') + options.sort;
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
        params.AttributesToGet = lib.strSplit(options.select);
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
        callback(err, rc);
    });
}
