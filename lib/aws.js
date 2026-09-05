/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
'use strict';

const modules = require(__dirname + '/modules');
const logger = require(__dirname + '/logger');
const app = require(__dirname + '/app');
const lib = require(__dirname + '/lib');

/**
 * @module aws
 */

const aws =

/**
 * AWS API interface, uses API directly for each service, JSON is returned as is but XML repsonses are converted
 * using `fast-xml-parser` into objects.
 *
 * Supports local AWS SDK credentials files and sessions
 *
 * When AWS environment is detected the {@link module:app.env} will be filled automatically.
 *
 * @example
 *
 * # aws login
 *
 * # bin/bksh -aws-sdk-profile default
 *
 * > aws.queryS3("", "/", (err, rc) => {
 *     console.log(rc?.ListAllMyBucketsResult?.Buckets)
 * })
 */

module.exports = {
    name: 'aws',

    /**
     * @var {ConfigOptions[]}
     * @default
     */
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
        { name: "target-group", descr: "AWS ELB target group to be registered with on start up or other AWS commands" },
        { name: "elastic-ip", descr: "AWS Elastic IP to be associated on start" },
        { name: "host-name", type: "list", descr: "List of hosts to update in Route54 zone with the current private IP address, hosts must be in FQDN format, supports @..@ app.env placeholders" },
        { name: "iam-profile", descr: "IAM instance profile name for instances or commands" },
        { name: "image-id", descr: "AWS image id to be used for instances or commands" },
        { name: "subnet-id", descr: "AWS subnet id to be used for instances or commands" },
        { name: "vpc-id", descr: "AWS VPC id to be used for instances or commands" },
        { name: "group-id", array: 1, descr: "AWS security group(s) to be used for instances or commands" },
        { name: "public-ip", type: "bool", descr: "AWS public IP option for instances or commands" },
        { name: "ecs-cluster", descr: "AWS ECS cluster to use as default" },
        { name: "instance-type", descr: "AWS instance type to launch on demand" },
        { name: "metadata-options", type: "list", descr: "Default instance metadata options" },
        { name: "account-id", descr: "AWS account id if not running on an instance" },
        { name: "eni-id", type: "list", descr: "AWS Elastic Network Interfaces to attach on start, format is: eni[:index],eni..." },
        { name: "config-parameters", descr: "Prefix for AWS Systems Manager parameters to load and parse as config before initializing the database pools", example: "/bkjs/config/" },
        { name: "config-secrets", type: "list", descr: "AWS Secrets Manager filters to load and parse as config before initializing the database pools, supports @..@ app.env placeholders in filters", example: "production,production-@tag@,production-@role@" },
        { name: "config-s3-file", descr: "S3 url for config file to download on start, may include @placeholders@ to refer properties from app.env" },
        { name: "config-s3-interval", type: "int", descr: "Load S3 config file every specified interval in minites" },
    ],

    meta: 1,
    metaHost: "169.254.169.254",
    key: process.env.AWS_ACCESS_KEY_ID,
    secret: process.env.AWS_SECRET_ACCESS_KEY,
    token: process.env.AWS_SESSION_TOKEN,
    tokenExpiration: 0,
    // Current instance details
    instance: {},
    tags: [],
    // Known process roles that need instance metadata
    roles: ["shell","web","server","worker","node"],
    // Supported regions per service
    regions: {
        route53domains: ["us-east-1"]
    },
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

/**
 * Module initialization hook. Detects the AWS environment, retrieves EC2/ECS instance
 * metadata and credentials, reads local SDK credentials for the configured profile and
 * loads remote config (S3/SSM/Secrets Manager).
 * @memberof module:aws
 * @method configure
 * @param {object} options
 * @param {function} callback
 */
aws.configure = function(options, callback)
{
    lib.everySeries([
        function(next) {
            if (!aws.meta || app.platform !== "linux" || !lib.includes(aws.roles, app.role)) return next();
            if (process.env.AWS_EC2_METADATA_DISABLED) return next();
            aws.getInstanceInfo(options, next);
        },

        function(next) {
            if (aws.key || !aws.sdkProfile) return next();
            aws.readCredentials(aws.sdkProfile, (_err, creds) => {
                for (const p in creds) aws[p] = creds[p];
                next();
            });
        },

        function(next) {
            modules.ipc.on('config:init', aws.readConfig.bind(aws));
            aws.readConfig(next);
        },

    ], callback, true);
}

/**
 * Primary server startup hook, only runs on an AWS instance. Updates Route53 host records,
 * associates the configured Elastic IP, attaches configured ENIs and registers the instance
 * with the configured ELB target group.
 * @memberof module:aws
 * @method configureServer
 * @param {object} options
 * @param {function} callback
 */
aws.configureServer = function(options, callback)
{
    // Make sure we are running on EC2 instance
    if (app.env.type !== "aws") return callback();

    const opts = lib.clone(options, { retryCount: options.retryCount || 3, retryOnError: 1 });
    lib.everyParallel([
        function(next) {
            if (!lib.isArray(aws.hostName) || !app.ipaddr) return next();
            logger.info("configureServer:", aws.hostName, app.ipaddr, app.env);
            lib.forEverySeries(aws.hostName, (host, next2) => {
                aws.route53Change(lib.toTemplate(host, [app.env, app]), next2);
            }, next, true);
        },

        function(next) {
            if (!aws.elasticIp) return next();
            aws.getInstanceDetails((_err) => {
                opts.subnetId = aws.SubnetId || aws.instance.subnetId;
                logger.info("configureServer:", aws.elasticIp, opts);
                aws.ec2AssociateAddress(app.env.id, aws.elasticIp, opts, next);
            });
        },

        function(next) {
            if (lib.isEmpty(aws.eniId)) return next();
            aws.getInstanceDetails((_err) => {
                logger.info("configureServer:", aws.eniId);
                aws.ec2AttachNetworkInterface(aws.eniId, aws.instance, options, next);
            });
        },

        function(next) {
            if (!aws.targetGroup) return next();
            aws.queryELB2("DescribeTargetGroups", { "TargetGroupArns.member.1": aws.targetGroup }, (_err, rc) => {
                var group = rc?.DescribeTargetGroupsResponse?.DescribeTargetGroupsResult?.TargetGroups?.member;
                logger.info("configureServer:", aws.targetGroup, group);
                if (!group?.TargetType) return next();
                aws.elb2RegisterInstances(aws.targetGroup, group?.TargetType === "ip" ? app.ipaddr: app.env.id, next);
            });
        },

    ], callback, true);
}

/**
 * Process AWS alarms and state notifications, if such a job is pulled from SQS queue it is handled here and never get to the jobs.
 * SNS alarms or EventBridge events must use a SQS qeue as the target.
 * @memberof module:aws
 * @method configureJob
 */
aws.configureJob = function(options, callback)
{
    // AWS SNS notifications
    if (options.message.Type === "Notification" && options.message.TopicArn) {
        logger.debug("configureJob:", options);

        const alarm = lib.jsonParse(options.message.Message);
        if (!alarm) return callback("invalid message");

        alarm.alarmName = alarm.AlarmName || alarm.Trigger?.MetricName || alarm["detail-type"];
        alarm.subject = options.message.Subject;
        alarm.topicArn = options.message.TopicArn;
        app.runMethods("awsProcessNotification", alarm, { direct: true, parallel: true }, () => {
            callback({ status: 200 });
        });
        return;
    }

    // EC2/ECS instance status via EventBridge to a SQS queue
    if (lib.includes(["aws.ec2", "aws.ecs"], options.message.source) && options.message.detail) {
        logger.debug("configureJob:", options);

        switch (options.message["detail-type"]) {
        case "EC2 Instance State-change Notification":
            options.message.state = options.message.detail.state;
            options.message.instanceId = options.message.detail["instance-id"];
            options.method = "awsProcessInstanceStateChange";
            break;

        case "ECS Task State Change":
            options.message.state = options.message.detail.lastStatus;
            options.message.taskId = options.message.detail.taskArn.split("/").pop();
            options.method = "awsProcessTaskStateChange";
            break;

        default:
            options.method = `awsProcess${options.message.source.split(".").pop().toUpperCase()}Event`;
            break;
        }
        app.runMethods(options.method, options.message, { direct: true, parallel: true }, () => {
            callback({ status: 200 });
        });
        return;
    }

    callback();
}

require(__dirname + "/aws/meta")
require(__dirname + "/aws/query")
require(__dirname + "/aws/cw")
require(__dirname + "/aws/dynamodb")
require(__dirname + "/aws/ec2")
require(__dirname + "/aws/ecs")
require(__dirname + "/aws/s3")
require(__dirname + "/aws/sns")
require(__dirname + "/aws/route53")
require(__dirname + "/aws/sqs")
require(__dirname + "/aws/ses")
require(__dirname + "/aws/ssm")
require(__dirname + "/aws/other")
require(__dirname + "/aws/lambda");
