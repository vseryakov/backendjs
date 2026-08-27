/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
'use strict';

const logger = require(__dirname + '/../logger');
const lib = require(__dirname + '/../lib');
const aws = require(__dirname + '/../aws');

/**
 * AWS ECS (Elastic Container Service) API request.
 * @memberof module:aws
 * @method queryECS
 * @param {string} action - ECS API action, e.g. `RunTask`, `DescribeTasks`
 * @param {object} obj - API-specific request parameters
 * @param {object} [options] - request options passed to {@link module:aws.queryService}
 * @param {function} callback - `(err, data, request)`
 */
aws.queryECS = function(action, obj, options, callback)
{
    this.queryService({ endpoint: "ecs", target: "AmazonEC2ContainerServiceV20141113", action }, obj, options, callback);
}

/**
 * AWS ECS API request, async version of {@link module:aws.queryECS}.
 * @memberof module:aws
 * @method aqueryECS
 * @async
 * @param {string} action - ECS API action
 * @param {object} obj - API-specific request parameters
 * @param {object} [options] - request options
 * @returns {Promise<object>} - `{ err, data, request }`
 */
aws.aqueryECS = function(action, obj, options)
{
    return this.aqueryService({ endpoint: "ecs", target: "AmazonEC2ContainerServiceV20141113", action }, obj, options);
}

/**
 * Describe ECS tasks, augmenting each returned task via {@link module:aws.ecsPrepareTask}.
 * @memberof module:aws
 * @method ecsDescribeTasks
 * @param {object} options
 * @param {string} [options.cluster] - cluster name, defaults to `aws.ecsCluster`
 * @param {string|string[]} options.tasks - task id(s) or ARN(s) to describe
 * @param {function} callback - `(err, rc)`
 */
aws.ecsDescribeTasks = function(options, callback)
{
    var req = {
        cluster: options.cluster || this.ecsCluster,
        tasks: lib.split(options.tasks),
        include: ["TAGS"],
    };
    aws.queryECS("DescribeTasks", req, (err, rc) => {
        for (const i in rc.tasks) aws.ecsPrepareTask(rc.tasks[i]);
        lib.tryCall(callback, err, rc);
    });
}

/**
 * Normalize a raw ECS task object: extracts `id`, `name`, `arch`, `family`, private IP and subnet from
 * the task's containers, attachments and attributes. Returns the same object.
 * @memberof module:aws
 * @method ecsPrepareTask
 * @param {object} task - raw task object from an ECS response
 * @returns {object} the augmented task object
 */
aws.ecsPrepareTask = function(task)
{
    task.id = task.taskArn.split("/").pop();
    task.name = task.containers[0].name;
    var attrs = lib.isArray(task.attributes, []);
    for (const a of attrs) {
        if (a.name === 'ecs.cpu-architecture') task.arch = a.value;
    }
    for (const i in task.attachments) {
        if (task.attachments[i].type === "ElasticNetworkInterface") {
            const details = lib.isArray(task.attachments[i].details, []);
            for (const d of details) {
                if (d.name === 'privateIPv4Address') task.privateIpAddress = d.value; else
                if (d.name === 'subnetId') task.subnetId = d.value;
            }

        }
    }
    if (task.group?.startsWith("family:")) {
        task.family = task.group.substr(7);
    } else {
        task.family = task.taskDefinitionArn.split(/[:/]/).at(-2);
    }
    return task;
}

/**
 * Run an ECS task, supports native ECS request properties plus the simplified options below.
 * @memberof module:aws
 * @method ecsRunTask
 * @param {object} options
 * @param {string} options.task - task definition family or ARN
 * @param {number} [options.count=1] - number of tasks to run
 * @param {string} [options.cluster] - cluster name, defaults to `aws.ecsCluster`
 * @param {string} [options.launchType] - `EC2` or `FARGATE`
 * @param {string} [options.provider] - capacity provider name (shortcut for capacityProviderStrategy)
 * @param {string} [options.group] - task group
 * @param {boolean} [options.publicIp] - assign a public IP (awsvpc networking)
 * @param {string|string[]} [options.groupId] - security group id(s), defaults to `aws.groupId`
 * @param {string|string[]} [options.subnetId] - subnet id(s), defaults to `aws.subnetId`
 * @param {number} [options.cpu] - task/container CPU override
 * @param {number} [options.memory] - task/container memory override
 * @param {number} [options.disk] - ephemeral storage size in GiB
 * @param {string} [options.role] - task role ARN
 * @param {string} [options.execRole] - execution role ARN
 * @param {string} [options.container] - container name to apply overrides to
 * @param {object} [options.env] - environment variables as name:value for the container
 * @param {string[]} [options.files] - S3 URLs of environment files for the container
 * @param {object} [options.tags] - task tags
 * @param {function} callback
 */
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
        network.securityGroups = lib.split(options.groupId || this.groupId, null, { unique: 1 });
    }
    if (options.subnetId || this.subnetId) {
        network.subnets = lib.split(options.subnetId || this.subnetId, null, { unique: 1 });
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
        const co = { name: options.container };
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

/**
 * Enable or disable ECS task scale-in protection for the current task, using the ECS agent endpoint.
 * No-op when not running inside ECS.
 * @memberof module:aws
 * @method ecsTaskProtection
 * @param {object} [options]
 * @param {number} [options.minutes] - >0 enables protection for the given minutes, <=0 disables it, omit to just query state
 * @param {function} callback
 */
aws.ecsTaskProtection = function(options, callback)
{
    if (typeof options === "function") callback = options, options = null;
    if (!process.env.ECS_AGENT_URI) return lib.tryCall(callback);

    var url = process.env.ECS_AGENT_URI + "/task-protection/v1/state";
    var postdata = options?.minutes > 0 ? { ProtectionEnabled: true, ExpiresInMinutes: options.minutes } :
                   options?.minutues <= 0 ? { ProtectionEnabled: false } : undefined;

    aws.fetch(url, { method: postdata ? "PUT" : "GET", obj: 1, postdata }, callback);
}

