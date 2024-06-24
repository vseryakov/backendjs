//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

var logger = require(__dirname + '/../logger');
var lib = require(__dirname + '/../lib');
var aws = require(__dirname + '/../aws');

// AWS ECS API request
aws.queryECS = function(action, obj, options, callback)
{
    this.queryService("ecs", "AmazonEC2ContainerServiceV20141113", action, obj, options, callback);
}

aws.ecsRunTask = function(options, callback)
{
    var req = {
        taskDefinition: options.task,
        count: options.count || 1,
        cluster: options.cluster,
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

    var overrides = {};
    if (options.cpu) {
        overrides.cpu = options.cpu;
    }
    if (options.memory) {
        overrides.memory = options.memory;
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

    if (options.publicIp || options.groupId || options.subnetId) {
        req.networkConfiguration = {
            awsvpcConfiguration: {
                assignPublicIp: options.publicIp ? "ENABLED": undefined,
                securityGroups: lib.isArray(lib.strSplitUnique(options.groupId), undefined),
                subnets: lib.isArray(lib.strSplitUnique(options.subnetId), undefined),
            }
        }
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
    }
    if (!lib.isEmpty(overrides)) {
        req.overrides = overrides;
    }

    logger.debug('eccRunTask:', this.name, req, "OPTS:", options);
    this.queryECS("RunTask", req, options, callback);
}


