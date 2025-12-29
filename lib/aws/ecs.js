/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const logger = require(__dirname + '/../logger');
const lib = require(__dirname + '/../lib');
const aws = require(__dirname + '/../aws');

/**
 * AWS ECS API request
 * @memberof module:aws
 */
aws.queryECS = function(action, obj, options, callback)
{
    this.queryService("ecs", "AmazonEC2ContainerServiceV20141113", action, obj, options, callback);
}

aws.ecsDescribeTasks = function(options, callback)
{
    var req = {
        cluster: options.cluster || this.ecsCluster,
        tasks: lib.strSplit(options.tasks),
        include: ["TAGS"],
    };
    aws.queryECS("DescribeTasks", req, (err, rc) => {
        for (const i in rc.tasks) aws.ecsPrepareTask(rc.tasks[i]);
        lib.tryCall(callback, err, rc);
    });
}

aws.ecsPrepareTask = function(task)
{
    task.id = task.taskArn.split("/").pop();
    task.name = task.containers[0].name;
    var attrs = lib.isArray(task.attributes, []);
    for (const a of attrs) {
        if (a.name == 'ecs.cpu-architecture') task.arch = a.value;
    }
    for (const i in task.attachments) {
        if (task.attachments[i].type == "ElasticNetworkInterface") {
            var details = lib.isArray(task.attachments[i].details, []);
            for (const d of details) {
                if (d.name == 'privateIPv4Address') task.privateIpAddress = d.value; else
                if (d.name == 'subnetId') task.subnetId = d.value;
            }

        }
    }
    if (task.group && task.group.startsWith("family:")) {
        task.family = task.group.substr(7);
    } else {
        task.family = task.taskDefinitionArn.split(/[:/]/).at(-2);
    }
    return task;
}

aws.ecsRunTask = function(options, callback)
{
    var req = {
        taskDefinition: options.task,
        count: options.count || 1,
        cluster: options.cluster || this.ecsCluster,
        clientToken: options.clientToken,
        enableExecuteCommand: options.enableExecuteCommand,
        enableECSManagedTags: options.enableECSManagedTags,
        group: options.group,
        launchType: options.launchType,
        capacityProviderStrategy: options.provider ? [{ capacityProvider: options.provider }] : options.capacityProviderStrategy,
        networkConfiguration: options.networkConfiguration,
        platformVersion: options.platformVersion,
        propagateTags: options.propagateTags,
        referenceId: options.referenceId,
        startedBy: options.startedBy,
        tags: options.tags,
        placementStrategy: options.placementStrategy,
        placementConstraints: options.placementConstraints,
        volumeConfigurations: options.volumeConfigurations,
    };

    var network = {};
    if (options.publicIp || this.publicIp) {
        network.assignPublicIp = "ENABLED";
    }
    if (options.groupId || this.groupId) {
        network.securityGroups = lib.strSplit(options.groupId || this.groupId, null, { unique: 1 });
    }
    if (options.subnetId || this.subnetId) {
        network.subnets = lib.strSplit(options.subnetId || this.subnetId, null, { unique: 1 });
    }
    if (!lib.isEmpty(network)) {
        req.networkConfiguration = { awsvpcConfiguration: network };
    }

    var overrides = {};
    if (options.cpu) {
        overrides.cpu = String(options.cpu);
    }
    if (options.memory) {
        overrides.memory = String(options.memory);
    }
    if (options.disk) {
        overrides.ephemeralStorage = { sizeInGiB: options.disk };
    }
    if (options.role) {
        overrides.taskRoleArn = options.role;
    }
    if (options.execRole) {
        overrides.executionRoleArn = options.execRole;
    }

    if (options.container) {
        var co = { name: options.container };
        overrides.containerOverrides = [co];
        if (options.env) {
            co.environment = [];
            for (const p in options.env) {
                co.environment.push({ name: p, value: options.env[p] });
            }
        }
        if (lib.isArray(options.files)) {
            co.environmentFiles = options.files.map((x) => ({ type: "s3", value: x }));
        }
        if (options.cpu) {
            co.cpu = lib.toNumber(options.cpu);
        }
        if (options.memory) {
            co.memory = lib.toNumber(options.memory);
        }
    }
    if (!lib.isEmpty(overrides)) {
        req.overrides = overrides;
    }

    logger.debug('eccRunTask:', this.name, req, "OPTS:", options);
    this.queryECS("RunTask", req, options, callback);
}

aws.ecsTaskProtection = function(options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!process.env.ECS_AGENT_URI) return lib.tryCall(callback);

    var url = process.env.ECS_AGENT_URI + "/task-protection/v1/state";
    var postdata = options?.minutes > 0 ? { ProtectionEnabled: true, ExpiresInMinutes: options.minutes } :
                   options?.minutues <= 0 ? { ProtectionEnabled: false } : undefined;

    aws.fetch(url, { method: postdata ? "PUT" : "GET", obj: 1, postdata }, callback);
}

