/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const fs = require('fs');
const logger = require(__dirname + '/../logger');
const app = require(__dirname + '/../app');
const lib = require(__dirname + '/../lib');
const aws = require(__dirname + '/../aws');

/**
 * Read key and secret from the AWS SDK credentials file, if no profile is given in the config or command line only the default peofile
 * will be loaded.
 */
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
            app.parseConfig(rc.data, 0, "aws-s3");
        }
        lib.tryCall(callback, rc.status == 200 ? null : { status: rc.status });
    });
}

// Retrieve instance meta data
aws.getInstanceMeta = function(path, options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    var opts = lib.objExtend({
        noparse: 1,
        httpTimeout: 200,
        quiet: true,
        retryCount: 2,
        retryTimeout: 100,
        errorCount: 0,
        retryOnError: function() { return this.status >= 400 && this.status != 404 && this.status != 529 },
    }, options);

    if (!lib.rxUrl.test(path)) path = `http://${this.metaHost}${path}`;
    if (this.metaToken) opts.headers = { "X-aws-ec2-metadata-token": this.metaToken };

    app.fetch(path, opts, (err, params) => {
        if ([200, 404, 529].indexOf(params.status) == -1) logger.error('getInstanceMeta:', path, params.status, params.data, err);
        if (typeof callback == "function") callback(err, params.status == 200 ? params.obj || params.data : "");
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
    app.fetch(`http://${aws.metaHost}/latest/api/token`, opts, (err, params) => {
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
            if (path || aws.iamProfile) return next();
            aws.getInstanceMeta("/latest/meta-data/iam/security-credentials/", (err, data) => {
                if (!err && data) aws.iamProfile = data;
                next(err);
            });
        },

        function(next) {
            if (!path) path = "/latest/meta-data/iam/security-credentials/" + aws.iamProfile;
            aws.getInstanceMeta(path, (err, data) => {
                if (!err && data) {
                    var obj = lib.jsonParse(data, { datatype: "obj", logger: "info" });
                    if (obj.AccessKeyId && obj.SecretAccessKey) {
                        aws.key = obj.AccessKeyId;
                        aws.secret = obj.SecretAccessKey;
                        aws.token = obj.Token;
                        aws.tokenExpiration = lib.toDate(obj.Expiration).getTime();
                        logger.debug("getInstanceCredentials:", app.role, aws.key, lib.strftime(aws.tokenExpiration), "interval:", lib.toDuration(aws.tokenExpiration - Date.now()));
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

    lib.series([
        function(next) {
            // ECS containers do not use instance metadata
            var uri = process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI || process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI;
            if (!uri) return next();

            app.instance.type = "aws";
            aws.metaHost = "169.254.170.2";
            aws.region = app.instance.region = process.env.AWS_DEFAULT_REGION || process.env.AWS_REGION;

            aws.getInstanceCredentials(uri, (err) => {
                aws.getTaskDetails(() => {
                    logger.debug('getInstanceInfo:', aws.name, app.instance, err);
                    return typeof callback == "function" && callback();
                });
            });
        },

        function(next) {
            aws.getInstanceMetaToken(() => { next() });
        },

        function(next) {
            aws.getInstanceMeta("/latest/dynamic/instance-identity/document", (err, data) => {
                if (!err && data) {
                    data = lib.jsonParse(data, { datatype: "obj", logger: "error" });
                    app.instance.type = "aws";
                    app.instance.id = data.instanceId;
                    app.instance.image = data.imageId;
                    app.instance.instance_type = data.instanceType;
                    app.instance.region = data.region;
                    app.instance.zone = data.availabilityZone;
                    aws.accountId = data.accountId;
                    aws.zone = data.availabilityZone;
                    if (!aws.region) aws.region = data.region;
                }
                next(err);
            });
        },

        function(next) {
            if (aws.keyName) return next();
            aws.getInstanceMeta("/latest/meta-data/public-keys/", (err, data) => {
                if (!err && data) aws.keyName = data.substr(2);
                next();
            });
        },

        function(next) {
            // If access key is configured then skip profile meta
            if (aws.key) return next();
            aws.getInstanceCredentials(next);
        },

        function(next) {
            if (app.instance.tag) return next();
            aws.getInstanceMeta("/latest/meta-data/tags/instance/Name", (err, data) => {
                if (!err && data) app.instance.tag = data;
                next(err);
            });
        },

        function(next) {
            if (app.instance.tag || !aws.secret || !app.instance.id) return next();
            aws.getInstanceDetails(next);
        },

    ], (err) => {
        logger.debug('getInstanceInfo:', aws.name, app.instance, 'profile:', aws.iamProfile, 'expire:', aws.tokenExpiration, err);
        if (typeof callback == "function") callback();
    }, true);
}

// Get the current instance details if not retrieved already in `aws.instance`
aws.getInstanceDetails = function(options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    if (aws.instance?.instanceId == app.instance.id) {
        return lib.tryCall(callback, null, aws.instance);
    }
    aws.ec2DescribeInstances({ instanceId: app.instance.id, retryCount: 3 }, (err, list) => {
        if (!err && list.length) {
            aws.instance = list[0];
            app.instance.tag = aws.instance.name;
        }
        lib.tryCall(callback, err, aws.instance);
    });
}

// If running inside ECS pulls the task details
aws.getTaskDetails = function(options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    var uri = process.env.ECS_CONTAINER_METADATA_URI_V4;
    if (!uri) return lib.tryCall(callback, null, aws.task);

    aws.getInstanceMeta(`${uri}/task`, { noparse: 0 }, (err, rc) => {
        if (!err && rc) {
            aws.task = rc;
            var arn = lib.strSplit(rc.TaskARN, /[:/]/);
            aws.accountId = arn[4];
            app.instance.task = rc.Family;
            app.instance.task_id = arn.at(-1);
            app.instance.service = rc.ServiceName;
            app.instance.zone = aws.zone = rc.AvailabilityZone;

            for (const i in rc.Containers) {
                const c = rc.Containers[i];
                if (c.KnownStatus == "RUNNING") {
                    app.instance.container = c.DockerName;
                    app.instance.container_id = c.DockerId;
                    app.instance.container_image = lib.strSplit(c.Image, "/").pop();
                    for (const j in c.Networks) {
                        if (c.Networks[j].NetworkMode == "awsvpc") {
                            app.instance.ip = String(c.Networks[j].IPv4Addresses);
                            app.instance.netdev = "eth" + c.Networks[j].AttachmentIndex;
                            break;
                        }
                    }
                    break;
                }
            }
        }
        lib.tryCall(callback, err, aws.task);
    });
}
