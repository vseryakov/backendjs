/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
'use strict';

const logger = require('../logger');
const app = require("../app")
const lib = require('../lib');
const aws = require('../aws');

/**
 * AWS EC2 API request.
 * @memberof module:aws
 * @method queryEC2
 * @param {string} action - EC2 API action, e.g. `RunInstances`, `DescribeInstances`
 * @param {object} obj - API-specific request parameters
 * @param {object} [options] - request options passed to {@link module:aws.queryEndpoint}
 * @param {function} callback - `(err, data, request)`
 */
aws.queryEC2 = function(action, obj, options, callback)
{
    this.queryEndpoint("ec2", '2016-11-15', action, obj, options, callback);
}

/**
 * AWS EC2 API request, async version of {@link module:aws.queryEC2}.
 * @memberof module:aws
 * @method aqueryEC2
 * @async
 * @param {string} action - EC2 API action
 * @param {object} obj - API-specific request parameters
 * @param {object} [options] - request options
 * @returns {Promise<object>} - `{ err, data, request }`
 */
aws.aqueryEC2 = function(action, obj, options)
{
    return this.aqueryEndpoint("ec2", '2016-11-15', action, obj, options);
}

/**
 * AWS Elastic Load Balancing v2 (ALB/NLB) API request.
 * @memberof module:aws
 * @method queryELB2
 * @param {string} action - ELBv2 API action, e.g. `RegisterTargets`, `DescribeTargetGroups`
 * @param {object} obj - API-specific request parameters
 * @param {object} [options] - request options passed to {@link module:aws.queryEndpoint}
 * @param {function} callback - `(err, data, request)`
 */
aws.queryELB2 = function(action, obj, options, callback)
{
    this.queryEndpoint("elasticloadbalancing", '2015-12-01', action, obj, options, callback);
}

/**
 * Run AWS EC2 instances. Supports all native EC2 parameters when passed capitalized in options, plus
 * the simplified options below. The callback receives `(err, rc, info)` where `info` describes the
 * launched instances and post-launch tasks.
 * @memberof module:aws
 * @method ec2RunInstances
 * @param {object} options
 * @param {number} [options.min=1] - minimum number of instances to run
 * @param {number} [options.max=1] - maximum number of instances to run
 * @param {number} [options.count] - shortcut to set both min and max
 * @param {string} [options.imageId] - AMI id, defaults to `aws.imageId` or `options.ImageId`
 * @param {string} [options.instanceType] - instance type, defaults to `aws.instanceType` or `t4g.micro`
 * @param {string} [options.keyName] - key pair name, defaults to `aws.keyName`
 * @param {string} [options.data] - user data in clear text
 * @param {string} [options.file] - path to a file whose contents are used as user data (read synchronously)
 * @param {boolean} [options.terminate] - set shutdown behaviour to terminate
 * @param {boolean} [options.stop] - set shutdown behaviour to stop
 * @param {boolean} [options.noTerminate] - enable API termination protection
 * @param {string|string[]} [options.groupId] - one or more security group ids
 * @param {string} [options.ip] - static private IP address to assign
 * @param {boolean} [options.publicIp] - associate a public IP address
 * @param {string} [options.subnetId] - subnet id, defaults to `aws.subnetId`
 * @param {string} [options.availabilityZone] - availability zone, defaults to `aws.zone`
 * @param {string} [options.iamProfile] - IAM instance profile, defaults to `aws.iamProfile`
 * @param {string} [options.name] - `Name` tag, any `%i` is replaced with the instance index
 * @param {object} [options.tags] - additional tags as key:value
 * @param {string|string[]} [options.targetGroup] - ELB target group(s) to join after startup
 * @param {string} [options.elasticIp] - Elastic IP to associate after startup
 * @param {object[]} [options.alarms] - CloudWatch alarms to create, each item is options for {@link module:aws.cwPutMetricAlarm}
 * @param {object} [options.device] - BlockDeviceMapping spec: `{ name, size, type, iops, keep, virtual }`
 * @param {string|string[]} [options.metadata] - instance metadata options: `disabled`, `hops`, `tokens`, `tags`
 * @param {string} [options.launchTemplate] - launch template name (latest version); most other options are ignored
 * @param {boolean} [options.noWait] - return immediately without running post-launch tasks
 * @param {boolean} [options.waitRunning] - wait until the instance is in `running` state
 * @param {number} [options.waitTimeout] - how long to wait in ms for the instance to be runnable
 * @param {number} [options.waitDelay] - how often in ms to poll for status while waiting
 * @param {function} callback - `(err, rc, info)`
 */
aws.ec2RunInstances = function(options, callback)
{
    if (typeof options === "function") callback = options, options = {};

    var req = {
        MinCount: lib.toNumber(options.min || options.count, { dflt: 1, min: 1 }),
        MaxCount: lib.toNumber(options.max || options.count, { dflt: 1, min: 1 }),
    };

    if (options.launchTemplate) {

        req["LaunchTemplate.LaunchTemplateName"] = options.launchTemplate;
        req["LaunchTemplate.Version"] = "$Latest";

    } else {

        req.ImageId = options.imageId || this.imageId;
        req.InstanceType = options.instanceType || this.instanceType || "t4g.micro";
        req.KeyName = options.keyName || this.keyName;
        req["IamInstanceProfile.Name"] = options.iamProfile || this.iamProfile;

        if (options.data) req.UserData = Buffer.from(options.data).toString("base64");
        if (options.stop) req.InstanceInitiatedShutdownBehavior = "stop";
        if (options.terminate) req.InstanceInitiatedShutdownBehavior = "terminate";
        if (options.noTerminate) req.DisableApiTermination = true;

        lib.split(options.metadata || this.metadataOptions, null, { unique: 1 }).forEach((x) => {
            switch (x) {
            case "disabled":
                req["MetadataOptions.HttpEndpoint"] = "disabled";
                break;
            case "hops":
                req["MetadataOptions.HttpPutResponseHopLimit"] = 2;
                break;
            case "tokens":
                req["MetadataOptions.HttpTokens"] = "required";
                break;
            case "tags":
                req["MetadataOptions.InstanceMetadataTags"] = "enabled";
                break;
            }
        });

        let groups = lib.split(options.groupId || this.groupId, null, { unique: 1 });
        let subnetId = lib.split(options.subnetId || this.subnetId)[0];

        if (options.ip) {
            if (subnetId) {
                req["NetworkInterface.0.DeviceIndex"] = 0;
                req["NetworkInterface.0.PrivateIpAddress"] = options.ip;
                req["NetworkInterface.0.SubnetId"] = subnetId;
                groups.forEach((x, i) => { req["NetworkInterface.0.SecurityGroupId." + i] = x; });
                groups = [];
                subnetId = "";
            } else {
                req.PrivateIpAddress = options.ip;
            }
        }
        if (options.publicIp || this.publicIp) {
            req["NetworkInterface.0.DeviceIndex"] = 0;
            req["NetworkInterface.0.AssociatePublicIpAddress"] = true;
            if (subnetId) {
                req["NetworkInterface.0.SubnetId"] = subnetId;
                subnetId = "";
            }
            if (options.ip) {
                req["NetworkInterface.0.PrivateIpAddress"] = options.ip;
                req.PrivateIpAddress = undefined;
            }
            groups.forEach((x, i) => { req["NetworkInterface.0.SecurityGroupId." + i] = x; });
            groups = [];
        }

        if (options.availabilityZone) {
            req["Placement.AvailabilityZone"] = options.availabilityZone;
        }

        if (subnetId) {
            req.SubnetId = subnetId;
        }

        groups.forEach((x, i) => { req["SecurityGroupId." + i] = x; });

        if (options.file) {
            req.UserData = lib.readFileSync(options.file).toString("base64");
        }

        if (options.device?.size || options.device?.virtual) {
            req['BlockDeviceMapping.1.DeviceName'] = options.device.name;
            if (options.device.virtual) {
                req["BlockDeviceMapping.1.VirtualName="] = options.device.virtual;
            } else {
                req['BlockDeviceMapping.1.Ebs.VolumeSize'] = options.device.size;
                req['BlockDeviceMapping.1.Ebs.VolumeType'] = options.device.type;
                if (options.device.iops) req['BlockDeviceMapping.1.Ebs.Iops'] = options.device.iops;
                if (options.device.keep) req["BlockDeviceMapping.3.Ebs.DeleteOnTermination"] = false;
            }
        }
    }

    // Prepare instance context
    var info = {
        name: options.name?.includes("%i") ? options.name : null,
        subnetId: req.SubnetId || req["NetworkInterface.0.SubnetId"],
        tags: null,
        targetGroup: options.targetGroup,
        elasticIp: options.elasticIp,
        alarms: lib.isArray(options.alarms),
        instances: [],
    };
    for (const p in options) if (/^(retry|region|credentials|endpoint)/.test(p)) info[p] = options[p];

    // Only a single tag can be assigned on launch
    if (options.name && !info.name) {
        req["TagSpecification.1.ResourceType"] = "instance";
        req["TagSpecification.1.Tag.1.Key"] = "Name";
        req["TagSpecification.1.Tag.1.Value"] = options.name;
    } else {
        lib.objKeys(options.tags).forEach((x, i) => {
            if (!i) {
                req["TagSpecification.1.ResourceType"] = "instance";
                req["TagSpecification.1.Tag.1.Key"] = x;
                req["TagSpecification.1.Tag.1.Value"] = options.tags[x];
            } else {
                if (!info.tags) info.tags = {};
                info.tags[x] = options.tags[x];
            }
        });
    }

    // To make sure we launch exactly one instance
    if (options.retryOnError && options.retryCount) req.ClientToken = lib.uuid();

    logger.debug('ec2RunInstances:', this.name, req, "OPTS:", options, "INFO:", info);
    this.queryEC2("RunInstances", req, options, (err, rc) => {
        if (err) return lib.tryCall(callback, err, rc, info);

        info.instances = lib.objGet(rc, "RunInstancesResponse.instancesSet.item", { list: 1 }).map(aws.ec2PrepareInstance);
        if (!info.instances.length) return lib.tryCall(callback, err, rc, info);

        info.instanceId = info.instances[0].instanceId;

        // Dont wait for instance if no additional tasks requested
        if (options.noWait || !(options.waitRunning || info.name || info.tags || info.elasticIp || info.targetGroup || info.alarms)) {
            return lib.tryCall(callback, err, rc, info);
        }
        aws.ec2AfterRunInstances(info, (err) => {
            lib.tryCall(callback, err, rc, info);
        });
    });
}

/**
 * Perform post-launch tasks for instances started by {@link module:aws.ec2RunInstances}: wait for the
 * running state, assign Name/tags, register with ELB target groups, associate an Elastic IP and create
 * CloudWatch alarms.
 * @memberof module:aws
 * @method ec2AfterRunInstances
 * @param {object} options - the `info` context produced by {@link module:aws.ec2RunInstances}
 * @param {function} callback
 */
aws.ec2AfterRunInstances = function(options, callback)
{
    lib.series([
        function(next) {
            // Wait for and update with most recent info about the instance
            lib.forEach(options.instances, (item, next2) => {
                aws.ec2WaitForInstance(item.instanceId, "running", options, (err, rc) => {
                    if (!err && rc?.instanceId) Object.assign(item, rc);
                    next2(err);
                });
            }, next);
        },
        function(next) {
            // Set tag name for all instances
            if (!options.name && !options.tags) return next();
            lib.forEach(options.instances, (item, next2) => {
                if (options.name) options.tags.Name = options.name.replace("%i", lib.toNumber(item.amiLaunchIndex) + 1);
                aws.ec2CreateTags(item.instanceId, null, options, next2);
            }, next);
        },
        function(next) {
            // Add to the ELB
            if (!options.targetGroup) return next();
            if (!lib.isArray(options.instances)) return next();
            var ids = options.instances.map((x) => (x.instanceId));
            lib.forEachSeries(lib.split(options.targetGroup), (group, next2) => {
                aws.elb2RegisterInstances(group, ids, options, next2);
            }, next);
        },
        function(next) {
            // Elastic IP
            if (!options.elasticIp) return next();
            aws.ec2AssociateAddress(options.instanceId, options.elasticIp, options, next);
        },
        function(next) {
            // CloudWatch alarms
            if (!lib.isArray(options.alarms)) return next();
            lib.forEachSeries(options.instances, (item, next2) => {
                lib.forEachSeries(options.alarms, (alarm, next3) => {
                    alarm.dimensions = { InstanceId: item.instanceId };
                    if (alarm.name) alarm.name = alarm.name.replace("%i", item.instanceId);
                    aws.cwPutMetricAlarm(aws.getServiceCredentials(alarm, options), next3);
                }, next2);
            }, next);
        },
    ], callback);
}

/**
 * Poll an instance status until it matches the expected value or the timeout expires.
 * @memberof module:aws
 * @method ec2WaitForInstance
 * @param {string} instanceId - the instance id
 * @param {string} status - desired state: pending | running | shutting-down | terminated | stopping | stopped
 * @param {object} [options]
 * @param {number} [options.waitTimeout=300000] - how long to wait in ms before giving up
 * @param {number} [options.waitDelay=10000] - delay in ms between polls
 * @param {function} callback - `(err, instance)`
 */
aws.ec2WaitForInstance = function(instanceId, status, options, callback)
{
    if (typeof options === "function") callback = options, options = null;

    options = lib.clone(options, { retryOnError: 1 });
    options.retryCount = lib.toNumber(options.retryCount, { min: 3 });
    options.retryTimeout = lib.toNumber(options.retryTimeout, { min: 500 });
    options.waitDelay = lib.toNumber(options.waitDelay, { dflt: 10000, min: 5000 });

    var state = "", instance, num = 0;
    var expires = Date.now() + lib.toNumber(options.waitTimeout, { dflt: 300000, min: 30000 });
    var params = {
        'Filter.1.Name': 'instance-id',
        'Filter.1.Value.1': instanceId,
    };
    lib.doWhilst(
      function(next) {
          aws.queryEC2("DescribeInstances", params, options, (err, rc) => {
              if (err) return next(err);
              instance = aws.ec2PrepareInstance(lib.objGet(rc, "DescribeInstancesResponse.reservationSet.item.instancesSet.item"));
              state = instance?.instanceState?.name;
              logger.debug("ec2WaitForInstance:", instanceId, instance?.instanceState);
              setTimeout(next, num++ ? options.waitDelay : 0);
          });
      },
      function() {
          return state !== status && Date.now() < expires;
      },
      function(err) {
        lib.tryCall(callback, err, instance);
      }, true);
}

/**
 * Describe EC2 security groups and return the list to the callback.
 * @memberof module:aws
 * @method ec2DescribeSecurityGroups
 * @param {object} [options]
 * @param {string} [options.vpcId] - limit to a VPC, defaults to `aws.vpcId`
 * @param {string|string[]} [options.name] - filter by group name(s)
 * @param {RegExp} [options.filter] - regexp to further filter groups by name
 * @param {function} callback - `(err, groups)`
 */
aws.ec2DescribeSecurityGroups = function(options, callback)
{
    if (typeof options === "function") callback = options, options = {};
    if (!options) options = {};

    var req = options.vpcId || this.vpcId ? { "Filter.1.Name": "vpc-id", "Filter.1.Value": options.vpcId || this.vpcId } : {};
    if (options.name) {
        lib.split(options.name).forEach((x, i) => {
            req["Filter." + (i + 2) + ".Name"] = "group-name";
            req["Filter." + (i + 2) + ".Value"] = x;
        });
    }

    this.queryEC2("DescribeSecurityGroups", req, options, (err, rc) => {
        if (err) return typeof callback === "function" && callback(err);

        var groups = lib.objGet(rc, "DescribeSecurityGroupsResponse.securityGroupInfo.item", { list: 1 });
        // Filter by name regexp
        if (options.filter) {
            groups = groups.filter((x) => (x.groupName.match(options.filter)));
        }
        if (typeof callback === "function") callback(err, groups);
    });
}

/**
 * Describe VPC subnets and return the list to the callback.
 * @memberof module:aws
 * @method ec2DescribeSubnets
 * @param {object} [options]
 * @param {string} [options.vpcId] - limit to a VPC, defaults to `aws.vpcId`
 * @param {string} [options.zone] - filter by availability zone
 * @param {string|string[]} [options.subnetId] - specific subnet id(s)
 * @param {RegExp} [options.filter] - regexp to filter subnets by Name tag
 * @param {function} callback - `(err, subnets)`
 */
aws.ec2DescribeSubnets = function(options, callback)
{
    if (typeof options === "function") callback = options, options = {};
    if (!options) options = {};

    var req = options.vpcId || this.vpcId ? { "Filter.1.Name": "vpc-id", "Filter.1.Value": options.vpcId || this.vpcId } : {}, i = 2;
    if (options.zone) {
        req[`Filter.${i}.Name`] = "availability-zone";
        req[`Filter.${i}.Value`] = options.zone;
        i++;
    }
    if (options.subnetId) {
        lib.split(options.subnetId).forEach((x, i) => {
            req["SubnetId." + (i + 1)] = x;
        });
    }

    aws.queryEC2("DescribeSubnets", req, options, (err, rc) => {
        var subnets = lib.objGet(rc, "DescribeSubnetsResponse.subnetSet.item", { list: 1 }).map((x) => {
            x.tags = lib.objGet(x, "tagSet.item", { list: 1 });
            x.name = x.tags.filter((t) => (t.key === "Name")).map((t) => (t.value)).pop();
            return x;
        });
        // Filter by name regexp
        if (options.filter) {
            subnets = subnets.filter((x) => (x.name?.match(options.filter)));
        }
        if (typeof callback === "function") callback(err, subnets);
    });
}

/**
 * Describe instances according to the query filters, returns a list of instances.
 * @memberof module:aws
 * @method ec2DescribeInstances
 * @param {object} [options]
 * @param {string} [options.vpcId] - VPC to get instances from
 * @param {string|string[]} [options.instanceId] - restrict to specific instance id(s)
 * @param {string|string[]} [options.tagName] - filter by Name tag value(s)
 * @param {string|string[]} [options.tagKey] - filter by tag key(s)
 * @param {string|string[]} [options.groupName] - filter by security group name(s)
 * @param {string|string[]} [options.stateName] - filter by instance state(s)
 * @param {object} [options.filters] - additional raw EC2 filters as name:value(s)
 * @param {function} callback - `(err, list, nextToken)`
 */
aws.ec2DescribeInstances = function(options, callback)
{
    if (typeof options === "function") callback = options, options = {};
    if (!options) options = {};

    var i = 1, req = {}, map = { vpcId: "vpc-id", stateName: "instance-state-name", tagName: "tag:Name", tagKey: "tag-key", groupName: "group-name" };

    if (options.instanceId) {
        lib.split(options.instanceId).forEach((x, j) => { req["InstanceId." + (j + 1)] = x });
    }
    for (const p in map) {
        if (!options[p]) continue;
        req["Filter." + i + ".Name"] = map[p];
        lib.split(options[p]).forEach((x, j) => { req["Filter." + i + ".Value." + (j + 1)] = x; });
        i++;
    }
    for (const p in options.filters) {
        req["Filter." + i + ".Name"] = p;
        lib.split(options.filters[p]).forEach((x, j) => { req["Filter." + i + ".Value." + (j + 1)] = x; });
        i++;
    }
    logger.debug("ec2DescribeInstances:", req);
    this.queryEC2("DescribeInstances", req, options, function(err, rc) {
        var token = lib.objGet(rc, "DescribeInstancesResponse.nextToken");
        var list = [];
        lib.objGet(rc, "DescribeInstancesResponse.reservationSet.item", { list: 1 }).forEach((x) => {
            lib.objGet(x, "instancesSet.item", { list: 1 }).forEach((y) => {
                list.push(aws.ec2PrepareInstance(y));
            });
        });
        lib.tryCall(callback, err, list, token);
    });
}

/**
 * Normalize a raw EC2 instance object: flatten `tagSet` into `tags`, extract the `name` from the Name
 * tag and the `availabilityZone` from placement. Returns the same object.
 * @memberof module:aws
 * @method ec2PrepareInstance
 * @param {object} obj - raw instance object from an EC2 response
 * @returns {object} the augmented instance object
 */
aws.ec2PrepareInstance = function(obj)
{
    if (obj) {
        obj.tags = lib.objGet(obj, "tagSet.item", { list: 1 });
        obj.name = obj.tags.filter((t) => (t.key === "Name")).map((t) => (t.value)).pop();
        obj.availabilityZone = obj.placement?.availabilityZone;
    }
    return obj;
}

/**
 * Create tags for a resource.
 * @memberof module:aws
 * @method ec2CreateTags
 * @param {string} id - resource id, e.g. instance id
 * @param {string|string[]|object} name - a string (sets the Name tag), an array of `[key, value, ...]` pairs, or an object of key:value tags
 * @param {object} [options]
 * @param {object} [options.tags] - additional tags as key:value
 * @param {function} callback
 * @example
 *      aws.ec2CreateTags("i-1234", "My Instance", { tags: { tag2: "val2", tag3: "val3" } })
 *      aws.ec2CreateTags("i-1234", { tag2: "val2", tag3: "val3" })
 *      aws.ec2CreateTags("i-1234", [ "tag2", "val2", "tag3", "val3" ])
 */
aws.ec2CreateTags = function(id, name, options, callback)
{
    if (typeof options === "function") callback = options, options = null;

    var tags = { "ResourceId.1": id }, i = 1;
    switch (lib.typeName(name)) {
    case "string":
        tags["Tag.1.Key"] = 'Name';
        tags["Tag.1.Value"] = name;
        i++;
        break;

    case "array":
        for (let j = 0; j < name.length - 1; j += 2) {
            tags["Tag." + i + ".Key"] = name[j];
            tags["Tag." + i + ".Value"] = String(name[j + 1]);
            i++;
        }
        break;

    case "object":
        for (const p in name) {
            tags["Tag." + i + ".Key"] = p;
            tags["Tag." + i + ".Value"] = String(name[p]);
            i++;
        }
        break;
    }
    // Additional tags
    if (options?.tags) {
        for (const p in options.tags) {
            tags["Tag." + i + ".Key"] = p;
            tags["Tag." + i + ".Value"] = String(options.tags[p]);
            i++;
        }
    }
    if (i === 1) return lib.tryCall(callback);
    this.queryEC2("CreateTags", tags, options, callback);
}

/**
 * Associate an Elastic IP with an instance, reassociating if the EIP is already taken.
 * @memberof module:aws
 * @method ec2AssociateAddress
 * @param {string} instanceId - the instance id
 * @param {string} elasticIp - the Elastic IP public address
 * @param {object} [options]
 * @param {string} [options.subnetId] - required for VPC instances; the allocation id is looked up automatically
 * @param {string} [options.AllocationId] - use a known allocation id and skip the lookup
 * @param {function} callback
 */
aws.ec2AssociateAddress = function(instanceId, elasticIp, options, callback)
{
     if (typeof options === "function") callback = options, options = null;

    var params = { InstanceId: instanceId, AllowReassociation: true };
    if (options?.subnetId) {
        // Already known
        if (options.AllocationId) {
            return this.queryEC2("AssociateAddress", params, options, callback);
        }
        // Get the allocation id
        this.queryEC2("DescribeAddresses", { 'PublicIp.1': elasticIp }, options, function(err, obj) {
            params.AllocationId = lib.objGet(obj, "DescribeAddressesResponse.addressesSet.item.allocationId");
            if (!params.AllocationId) err = lib.newError({ message: "EIP not found", name: "EC2", code: elasticIp });
            if (err) return callback ? callback(err) : null;
            aws.queryEC2("AssociateAddress", params, options, callback);
        });
    } else {
        params.PublicIp = elasticIp;
        this.queryEC2("AssociateAddress", params, options, callback);
    }
}

/**
 * Create an EBS-backed AMI from the given instance or the current running instance.
 * @memberof module:aws
 * @method ec2CreateImage
 * @param {object} [options]
 * @param {string} [options.instanceId] - source instance id, defaults to the current instance when on AWS
 * @param {string} [options.name] - image name, defaults to the app version
 * @param {string} [options.prefix] - prefix prepended to the image name
 * @param {string} [options.descr] - image description
 * @param {boolean} [options.reboot] - allow reboot during image creation (default is no reboot)
 * @param {boolean} [options.noreboot] - explicitly disable reboot
 * @param {function} callback
 */
aws.ec2CreateImage = function(options, callback)
{
    if (typeof options === "function") callback = options, options = null;

    var req = {
        InstanceId: options?.instanceId,
        Name: `${options?.prefix || ""}${options?.name || app.version.replace("/", "-")}`,
        NoReboot: true
    };
    if (options?.reboot) req.NoReboot = false;
    if (options?.noreboot) req.NoReboot = true;
    if (options?.descr) req.Description = options.descr;
    if (!req.InstanceId && app.env.type === "aws") req.InstanceId = app.env.id;

    this.queryEC2("CreateImage", req, options, callback);
}

/**
 * Deregister an AMI by id, optionally deleting its snapshots.
 * @memberof module:aws
 * @method ec2DeregisterImage
 * @param {string} ami_id - the AMI id
 * @param {object} [options]
 * @param {boolean} [options.snapshots] - also delete all EBS snapshots associated with the image
 * @param {function} callback
 */
aws.ec2DeregisterImage = function(ami_id, options, callback)
{
    if (typeof options === "function") callback = options, options = null;

    // Not deleting snapshots, just deregister
    if (!options?.snapshots) return this.queryEC2("DeregisterImage", { ImageId: ami_id }, options, callback);

    // Pull the image meta data and delete all snapshots
    this.queryEC2("DescribeImages", { 'ImageId.1': ami_id }, options, (err, rc) => {
        if (err) return callback ? callback(err) : null;

        var items = lib.objGet(rc, "DescribeImagesResponse.imagesSet.item", { list: 1 });
        if (!items.length) return callback ? callback(lib.newError({ message: "no AMI found", name: ami_id })) : null;

        var volumes = lib.objGet(items[0], "blockDeviceMapping.item", { list: 1 });
        aws.queryEC2("DeregisterImage", { ImageId: ami_id }, options, function(err) {
            if (err) return callback ? callback(err) : null;

            lib.forEachSeries(volumes, (vol, next) => {
                if (!vol.ebs?.snapshotId) return next();
                aws.queryEC2("DeleteSnapshot", { SnapshotId: vol.ebs.snapshotId }, options, next);
            }, callback)
        });
    });
}

/**
 * Attach the given ENIs to an instance (detaching first if already attached elsewhere).
 * @memberof module:aws
 * @method ec2AttachNetworkInterface
 * @param {string[]} eniId - list of ENI ids, each optionally as `eni-id:index` where index is the device index
 * @param {object} instance - target instance object (must contain `instanceId` and `subnetId`)
 * @param {object} [options]
 * @param {function} callback
 */
aws.ec2AttachNetworkInterface = function(eniId, instance, options, callback)
{
    var idx = 0;
    var enis = lib.objGet(instance, "networkInterfaceSet.item", { list: 1 }).map((x) => (x.networkInterfaceId));
    lib.forEverySeries(eniId, (eni, next) => {
        if (!instance?.instanceId) return next({ status: 400, message: "Invalid instance" })
        eni = eni.split(":");
        idx = Math.max(lib.toNumber(eni[1]), idx + 1);
        if (lib.includes(enis, eni[0])) return next();
        aws.queryEC2("DescribeNetworkInterfaces", { "NetworkInterfaceId.1": eni[0] }, options, (_err, rc) => {
            rc = lib.objGet(rc, "DescribeNetworkInterfacesResponse.networkInterfaceSet.item");
            if (!rc || rc.subnetId !== instance.subnetId) return next();
            var aid = lib.objGet(rc, "attachment.attachmentId");
            var query = { InstanceId: instance.instanceId, NetworkInterfaceId: eni[0], DeviceIndex: idx };
            if (!aid) {
                return aws.queryEC2("AttachNetworkInterface", query, options, () => { next() });
            }
            aws.queryEC2("DetachNetworkInterface", { AttachmentId: aid, Force: true }, options, () => {
                aws.queryEC2("AttachNetworkInterface", query, options, next);
            });
        });
    }, callback, true);
}

/**
 * Register instance(s) with an ELBv2 target group.
 * @memberof module:aws
 * @method elb2RegisterInstances
 * @param {string} target - target group ARN
 * @param {string|string[]} instance - one id/IP or a list of instance ids or IP addresses
 * @param {object} [options]
 * @param {function} callback
 */
aws.elb2RegisterInstances = function(target, instance, options, callback)
{
    if (typeof options === "function") callback = options, options = null;

    var params = { TargetGroupArn: target };
    if (!Array.isArray(instance)) instance = [ instance ];
    instance.forEach((x, i) => {
        params["Target.member." + (i+1) + ".Id"] = x;
    });
    this.queryELB2("RegisterTargets", params, options, callback);
}

/**
 * Deregister instance(s) from an ELBv2 target group.
 * @memberof module:aws
 * @method elb2DeregisterInstances
 * @param {string} target - target group ARN
 * @param {string|string[]} instance - one id or a list of instance ids/IP addresses
 * @param {object} [options]
 * @param {function} callback
 */
aws.elb2DeregisterInstances = function(target, instance, options, callback)
{
    if (typeof options === "function") callback = options, options = null;

    var params = { TargetGroupArn: target };
    if (!Array.isArray(instance)) instance = [ instance ];
    instance.forEach((x, i) => {
        params["Target.member." + (i+1) + ".Id"] = x;
    });
    this.queryELB2("DeregisterTargets", params, options, callback);
}

/**
 * Run a shell command on instances via SSM (AWS-RunShellScript document).
 * @memberof module:aws
 * @method ssmSendCommand
 * @param {string|string[]} cmds - one command or a list of commands to run
 * @param {string|string[]} instances - one instance id or a list of instance ids
 * @param {object} [options]
 * @param {function} callback
 */
aws.ssmSendCommand = function(cmds, instances, options, callback)
{
    if (typeof options === "function") callback = options, options = null;
    var params = {
        DocumentName: "AWS-RunShellScript",
        InstanceIds: Array.isArray(instances) ? instances : [instances],
        Parameters: { commands: Array.isArray(cmds) ? cmds : [cmds] }
    };
    this.querySSM("SendCommand", params, options, callback);
}

/**
 * Poll an SSM command invocation until it finishes (leaves Pending/InProgress/Delayed) or times out.
 * @memberof module:aws
 * @method ssmWaitForCommand
 * @param {string} cmdId - the SSM command id
 * @param {string} instanceId - the instance id
 * @param {object} [options]
 * @param {number} [options.waitTimeout=60000] - how long to wait in ms
 * @param {number} [options.waitDelay=1000] - delay in ms between polls
 * @param {function} callback - `(err, output)`
 */
aws.ssmWaitForCommand = function(cmdId, instanceId, options, callback)
{
    if (typeof options === "function") callback = options, options = null;

    options = lib.clone(options, { retryOnError: 1 });
    options.retryCount = lib.toNumber(options.retryCount, { min: 3 });
    options.retryTimeout = lib.toNumber(options.retryTimeout, { min: 500 });
    options.waitDelay = lib.toNumber(options.waitDelay, { dflt: 1000, min: 500 });
    var expires = Date.now() + lib.toNumber(options.waitTimeout, { dflt: 60000, min: 100 });
    var output = {}, num = 0, status = ["Pending","InProgress","Delayed"];
    var params = {
        CommandId: cmdId,
        InstanceId: instanceId,
    };
    lib.doWhilst(
        function(next) {
            aws.querySSM("GetCommandInvocation", params, options, (err, rc) => {
              if (err) return next(err);
              output = rc || {};
              setTimeout(next, num++ ? options.waitDelay : 0);
          });
      },
      function() {
          return lib.includes(status, output.Status) && Date.now() < expires;
      },
      function(err) {
          lib.tryCall(callback, err, output);
      }, true);
}

/**
 * Retrieve information about one or more parameters under a specified level in a
 * hierarchy from AWS System Manager
 * @param {string} path - The hierarchy for the parameter. Hierarchies start with a forward slash (/). The hierarchy is the
 * parameter name except the last part of the parameter. For the API call to succeed, the last part of the parameter name can't be in the path.
 * A parameter name hierarchy can have a maximum of 15 levels. Here is an example of a hierarchy: /Finance/Prod/IAD/WinServ2016/license33
 * @param {object} [options]
 * @param {object[]} [options.filters] - { Key: string, Option: string, Values: string[] }
 *  - Key can be Type, KeyId, and Label
 *  - Option can be Equal or BeginsWith, for Label only Equals
 *  - Values a list of strings to matche
 * @param {function} callback
 * @memberof module:aws
 * @method ssmGetParametersByPath
 */
aws.ssmGetParametersByPath = function(path, options, callback)
{
    if (typeof options === "function") callback = options, options = null;

    var list = [];
    var q = { Path: path, Recursive: true };
    if (options.filters) q.ParameterFilters = options.filters;

    lib.doWhilst(
        function(next) {
            aws.querySSM("GetParametersByPath", q, options, (err, rc) => {
              if (!err) {
                  q.NextToken = rc.NextToken;
                  list.push.apply(list, rc.Parameters);
              }
              next(err);
          });
      },
      function() {
          return q.NextToken;
      },
      function(err) {
          lib.tryCall(callback, err, list);
      }, true);
}

