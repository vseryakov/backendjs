//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

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
    // Current instance details
    instance: {},
    tags: [],
    // Known process roles that need instance metadata
    roles: ["shell","web","master","server","worker","process"],
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
    if (core.instance.type != "aws") return callback();

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
    if (core.instance.type != "aws") return callback();

    var opts = lib.objClone(options, "retryCount", options.retryCount || 3, "retryOnError", 1);
    lib.everyParallel([
        function(next) {
            // Set new tag if not set yet or it follows our naming convention, reboot could have launched a new app version so we set it
            if (core.instance.tag && !/^([a-z]+)-(a-z)-([0-9.]+)$/i.test(core.instance.tag)) return next();
            aws.ec2CreateTags(core.instance.id, core.runMode + "-" + core.appName + "-" + core.appVersion, opts, next);
        },
        function(next) {
            if (!lib.isArray(aws.hostName) || !core.ipaddr) return next();
            logger.info("configureMaster:", aws.hostName, core.ipaddr, core.instance);
            lib.forEverySeries(aws.hostName, (host, next2) => {
                aws.route53Change(lib.toTemplate(host, [core.instance, core]), next2);
            }, next, true);
        },
        function(next) {
            if (!aws.elasticIp) return next();
            aws.getInstanceDetails((err) => {
                opts.subnetId = aws.SubnetId || aws.instance.subnetId;
                logger.info("configureMaster:", aws.elasticIp, opts);
                aws.ec2AssociateAddress(core.instance.id, aws.elasticIp, opts, next);
            });
        },
        function(next) {
            if (lib.isEmpty(aws.eniId)) return next();
            aws.getInstanceDetails((err) => {
                logger.info("configureMaster:", aws.eniId);
                aws.ec2AttachNetworkInterface(aws.eniId, aws.instance, options, next);
            });
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

// Process AWS alarms and state notifications, if such a job is pulled from SQS queue it is handled here and never get to the jobs.
// SNS alarms or EventBridge events must use a SQS qeue as the target.
aws.configureJob = function(options, callback)
{
    // AWS SNS notifications
    if (options.message.Type == "Notification" && options.message.TopicArn) {
        logger.debug("configureJob:", options);

        var alarm = lib.jsonParse(options.message.Message);
        if (!alarm) return callback("invalid message");

        alarm.alarmName = alarm.AlarmName || alarm.Trigger?.MetricName || alarm["detail-type"];
        alarm.subject = options.message.Subject;
        alarm.topicArn = options.message.TopicArn;
        core.runMethods("awsProcessNotification", alarm, { direct: true, parallel: true }, () => {
            callback({ status: 200 });
        });
        return;
    }

    // EC2/ECS instance status via EventBridge to a SQS queue
    if (lib.isFlag(["aws.ec2", "aws.ecs"], options.message.source) && options.message.detail) {
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
        core.runMethods(options.method, options.message, { direct: true, parallel: true }, () => {
            callback({ status: 200 });
        });
        return;
    }

    callback();
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

// AWS ECS API request
aws.queryECS = function(action, obj, options, callback)
{
    this.queryService("ecs", "AmazonEC2ContainerServiceV20141113", action, obj, options, callback);
}

// AWS ECR API request
aws.queryECR = function(action, obj, options, callback)
{
    this.queryService("ecr", "AmazonEC2ContainerRegistry_V20150921", action, obj, options, callback);
}

// Returns a tag value by key, default key is Name
aws.getTagValue = function(obj, key)
{
    if (!key) key = "Name";
    return lib.objGet(obj, "tagSet.item", { list: 1 }).filter((x) => (x.key == key)).map((x) => (x.value)).pop() || "";
}

require(__dirname + "/aws/meta")
require(__dirname + "/aws/query")
require(__dirname + "/aws/cw")
require(__dirname + "/aws/dynamodb")
require(__dirname + "/aws/ec2")
require(__dirname + "/aws/s3")
require(__dirname + "/aws/sns")
require(__dirname + "/aws/route53")
require(__dirname + "/aws/sqs")
require(__dirname + "/aws/ses")
require(__dirname + "/aws/other")
