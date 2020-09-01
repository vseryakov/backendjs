//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

var util = require('util');
var logger = require(__dirname + '/logger');
var core = require(__dirname + '/core');
var lib = require(__dirname + '/lib');
var aws = require(__dirname + '/aws');

// AWS EC2 API request
aws.queryEC2 = function(action, obj, options, callback)
{
    this.queryEndpoint("ec2", '2016-11-15', action, obj, options, callback);
}

// AWS ELB API request
aws.queryELB = function(action, obj, options, callback)
{
    this.queryEndpoint("elasticloadbalancing", '2012-06-01', action, obj, options, callback);
}

aws.queryELB2 = function(action, obj, options, callback)
{
    this.queryEndpoint("elasticloadbalancing", '2015-12-01', action, obj, options, callback);
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
//  - noPrepare - even with additional tasks specified do not wai but return the context for aws.ec2PrepareInstance
//  - waitTimeout - how long to wait in ms for instance to be runnable
//  - waitDelay  - now often in ms to poll for status while waiting
//  - waitRunning - if 1 then wait for instance to be in running state, this is implied also by elbName, name, elasticIp properties in the options
//  - name - assign a tag to the instance as `Name:`, any occurences of %i will be replaced with the instance index
//  - tags - additional tags to be assigned, an object with key:value
//  - elbName - join elastic balancer after the startup
//  - targetGroup - join ELB target group after the startup
//  - elasticIp - asociate with the given Elastic IP address after the start
//  - iamProfile - IAM profile to assign for instance credentials, if not given use aws.iamProfile or options['IamInstanceProfile.Name'] attribute
//  - availabilityZone - availability zone, if not given use aws.zone or options['Placement.AvailabilityZone'] attribute
//  - subnetId - subnet id, if not given use aws.subnetId or options.SubnetId attribute
//  - alarms - a list with CloudWatch alarms to create for the instance, each value of the object represent an object with options to be
//      passed to the cwPutMetricAlarm method.
//
// The callback will take 3 arguments: callback(err, rc, info) where info will contain properties that can be used by `aws.ec2PrepareInstance
aws.ec2RunInstances = function(options, callback)
{
    if (typeof options == "function") callback = options, options = {};

    var req = {
        MinCount: lib.toNumber(options.min || options.count, { dflt: 1, min: 1 }),
        MaxCount: lib.toNumber(options.max || options.count, { dflt: 1, min: 1 }),
        ImageId: options.imageId || this.imageId,
        InstanceType: options.instanceType || this.instanceType || "t2.micro",
        KeyName: options.keyName || this.keyName || "",
        UserData: options.data ? Buffer.from(options.data).toString("base64") : "",
    };

    if (options.stop) req.InstanceInitiatedShutdownBehavior = "stop";
    if (options.terminate) req.InstanceInitiatedShutdownBehavior = "terminate";
    if (options.iamProfile || this.iamProfile) req["IamInstanceProfile.Name"] = options.iamProfile || this.iamProfile;
    if (options.subnetId || this.subnetId) {
        if (!options["SecurityGroupId.0"]) {
            const groups = lib.strSplitUnique(options.groupId || this.groupId || []);
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
            const groups = lib.strSplitUnique(options.groupId || this.groupId || []);
            groups.forEach(function(x, i) { req["SecurityGroupId." + i] = x; });
        }
        if (options.ip) {
            req.PrivateIpAddress = options.ip;
        }
    }
    if (!req.SubnetId && !req["NetworkInterface.0.SubnetId"]) {
        if (options.availabilityZone || this.zone) req["Placement.AvailabilityZone"] = options.availabilityZone || this.zone;
    }
    if (options.file) {
        req.UserData = lib.readFileSync(options.file).toString("base64");
    }
    // Prepare instance context
    var info = {
        name: options.name && options.name.indexOf("%i") > -1 ? options.name : null,
        subnetId: req.SubnetId || req["NetworkInterface.0.SubnetId"],
        tags: null,
        elbName: options.elbName,
        targetGroup: options.targetGroup,
        elasticIp: options.elasticIp,
        alarms: lib.isArray(options.alarms),
    };
    for (var p in options) if (/^(retry|region|credentials|endpoint)/.test(p)) info[p] = options[p];

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

    logger.debug('runInstances:', this.name, req, options, info);
    this.queryEC2("RunInstances", req, options, function(err, rc) {
        if (err) return lib.tryCall(callback, err);

        info.instances = lib.objGet(rc, "RunInstancesResponse.instancesSet.item", { list: 1 });
        if (!info.instances.length) return lib.tryCall(callback, err, rc, info);
        info.instanceId = info.instances[0].instanceId;

        // Dont wait for instance if no additional tasks requested
        if (options.noWait || !(options.waitRunning || info.name || info.tags || info.elasticIp || info.elbName || info.targetGroup || info.alarms)) {
            return lib.tryCall(callback, err, rc, info);
        }
        aws.ec2AfterRunInstances(info, (err) => {
            lib.tryCall(callback, err, rc, info);
        });
    });
}

// Perform the final tasks after an instance has been launched like wait for status, assign Elastic IP or tags..
aws.ec2AfterRunInstances = function(options, callback)
{
    lib.series([
        function(next) {
            lib.forEach(options.instances, function(item, next2) {
                aws.ec2WaitForInstance(item.instanceId, "running", options, next2);
            }, next);
        },
        function(next) {
            // Set tag name for all instances
            if (!options.name && !options.tags) return next();
            lib.forEachSeries(options.instances, function(item, next2) {
                if (options.name) options.tags.Name = options.name.replace("%i", lib.toNumber(item.amiLaunchIndex) + 1);
                aws.ec2CreateTags(item.instanceId, null, options, next2);
            }, next);
        },
        function(next) {
            // Add to the ELB
            if (!options.elbName) return next();
            if (!lib.isArray(options.instances)) return next();
            aws.elbRegisterInstances(options.elbName, options.instances.map(function(x) { return x.instanceId }), options, next);
        },
        function(next) {
            // Add to the ELB
            if (!options.targetGroup) return next();
            if (!lib.isArray(options.instances)) return next();
            aws.elb2RegisterInstances(options.targetGroup, options.instances.map(function(x) { return x.instanceId }), options, next);
        },
        function(next) {
            // Elastic IP
            if (!options.elasticIp) return next();
            aws.ec2AssociateAddress(options.instanceId, options.elasticIp, options, next);
        },
        function(next) {
            // CloudWatch alarms
            if (!lib.isArray(options.alarms)) return next();
            lib.forEachSeries(options.instances, function(item, next2) {
                lib.forEachSeries(options.alarms, function(alarm, next3) {
                    alarm.dimensions = { InstanceId: item.instanceId };
                    if (alarm.name) alarm.name = alarm.name.replace("%i", item.instanceId);
                    aws.cwPutMetricAlarm(aws.copyCredentials(alarm, options), next3);
                }, next2);
            }, next);
        },
    ], callback);
}

// Check an instance status and keep waiting until it is equal what we expect or timeout occurred.
// The `status` can be one of: pending | running | shutting-down | terminated | stopping | stopped
// The options can specify the following:
//  - waitTimeout - how long to wait in ms until give up, default is 30 secs
//  - waitDelay - how long in ms between polls
aws.ec2WaitForInstance = function(instanceId, status, options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    options = lib.objClone(options, "retryOnError", 1);
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
          aws.queryEC2("DescribeInstances", params, options, function(err, rc) {
              if (err) return next(err);
              instance = lib.objGet(rc, "DescribeInstancesResponse.reservationSet.item.instancesSet.item");
              state = instance ? instance.instanceState.name : "";
              setTimeout(next, num++ ? options.waitDelay : 0);
          });
      },
      function() {
          return state != status && Date.now() < expires;
      },
      function(err) {
        lib.tryCall(callback, err, instance);
      });
}

// Describe security groups, optionally if `options.filter` regexp is provided then limit the result to the matched groups only,
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

// Describe instances according to the query filters, returns a list with instances, the following properties
// can be used:
//  - vpcId - VPC to get instances from
//  - instanceId - list of instances to show only
//  - tagName - filter by tag name(s)
//  - tagKey - filter by tag key(s)
//  - groupName - filter by group name(s)
//  - stateName - instances state(s)
//  - filters - an object with filters to send as is
//
aws.ec2DescribeInstances = function(options, callback)
{
    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {};

    var i = 1, req = {}, map = { vpcId: "vpc-id", stateName: "instance-state-name", tagName: "tag:Name", tagKey: "tag-key", groupName: "group-name" };

    if (options.instanceId) {
        lib.strSplit(options.instanceId).forEach(function(x, j) { req["InstanceId." + (j + 1)] = x });
    }
    for (const p in map) {
        if (!options[p]) continue;
        req["Filter." + i + ".Name"] = map[p];
        lib.strSplit(options[p]).forEach(function(x, j) { req["Filter." + i + ".Value." + (j + 1)] = x; });
        i++;
    }
    for (const p in options.filters) {
        req["Filter." + i + ".Name"] = p;
        lib.strSplit(options.filters[p]).forEach(function(x, j) { req["Filter." + i + ".Value." + (j + 1)] = x; });
        i++;
    }
    logger.debug("ec2DescribeInstances:", req);
    this.queryEC2("DescribeInstances", req, options, function(err, rc) {
        var token = lib.objGet(rc, "DescribeInstancesResponse.nextToken");
        lib.tryCall(callback, err, aws.ec2ParseInstances(rc), token);
    });
}

// Pare DescribeInstances results and return a list of instances as a plain list
aws.ec2ParseInstances = function(rc)
{
    var list = [];
    lib.objGet(rc, "DescribeInstancesResponse.reservationSet.item", { list: 1 }).forEach((x) => {
        lib.objGet(x, "instancesSet.item", { list: 1 }).forEach((y) => {
            y.name = lib.objGet(y, "tagSet.item", { list: 1 }).filter((t) => (t.key == "Name")).map((t) => (t.value)).pop();
            list.push(y);
        });
    });
    return list;
}

// Create tags for a resource.
// The name is a string, an array or an object with tags. The options also may contain tags property which is an object with tag key and value
//
// Example
//
//      aws.ec2CreateTags("i-1234","My Instance", { tags: { tag2 : "val2", tag3: "val3" } } )
//      aws.ec2CreateTags("i-1234", { tag2: "val2", tag3: "val3" })
//      aws.ec2CreateTags("i-1234", [ "tag2", "val2", "tag3", "val3" ])
//
aws.ec2CreateTags = function(id, name, options, callback)
{
    if (typeof options == "function") callback = options, options = null;

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
    if (options && options.tags) {
        for (const p in options.tags) {
            tags["Tag." + i + ".Key"] = p;
            tags["Tag." + i + ".Value"] = String(options.tags[p]);
            i++;
        }
    }
    if (i == 1) return lib.tryCall(callback);
    this.queryEC2("CreateTags", tags, options, callback);
}

// Associate an Elastic IP with an instance. Default behaviour is to reassociate if the EIP is taken.
// The options can specify the following:
//  - subnetId - required for instances in VPC, allocation id will be retrieved for the given ip address automatically
aws.ec2AssociateAddress = function(instanceId, elasticIp, options, callback)
{
     if (typeof options == "function") callback = options, options = {};

    var params = { InstanceId: instanceId, AllowReassociation: true };
    if (options.subnetId) {
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

// Create an EBS image from the instance given or the current instance running
aws.ec2CreateImage = function(options, callback)
{
    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {};

    var req = {
        InstanceId: options.instanceId,
        Name: `${options.prefix || ""}${options.name || (core.appName + "-" + core.appVersion)}`,
        NoReboot: true
    };
    if (options.reboot) req.NoReboot = false;
    if (options.noreboot) req.NoReboot = true;
    if (options.descr) req.Description = options.descr;

    // If creating image from the current instance then no reboot
    if (!req.InstanceId && core.instance.type == "aws") req.InstanceId = core.instance.id;

    this.queryEC2("CreateImage", req, options, callback);
}

// Deregister an AMI by id. If `options.snapshots` is set, then delete all snapshots for this image as well
aws.ec2DeregisterImage = function(ami_id, options, callback)
{
    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {};

    // Not deleting snapshots, just deregister
    if (!options.snapshots) return this.queryEC2("DeregisterImage", { ImageId: ami_id }, options, callback);

    // Pull the image meta data and delete all snapshots
    this.queryEC2("DescribeImages", { 'ImageId.1': ami_id }, options, function(err, rc) {
        if (err) return callback ? callback(err) : null;

        var items = lib.objGet(rc, "DescribeImagesResponse.imagesSet.item", { list: 1 });
        if (!items.length) return calback ? callback(lib.newError({ message: "no AMI found", name: ami_id })) : null;

        var volumes = lib.objGet(items[0], "blockDeviceMapping.item", { list : 1 });
        aws.queryEC2("DeregisterImage", { ImageId: ami_id }, options, function(err) {
            if (err) return callback ? callback(err) : null;

            lib.forEachSeries(volumes, function(vol, next) {
                if (!vol.ebs || !vol.ebs.snapshotId) return next();
                aws.queryEC2("DeleteSnapshot", { SnapshotId: vol.ebs.snapshotId }, options, next);
            }, callback)
        });
    });
}

// Register an instance(s) with ELB, instance can be one id or a list of ids
aws.elbRegisterInstances = function(name, instance, options, callback)
{
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
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    var params = { LoadBalancerName: name };
    if (!Array.isArray(instance)) instance = [ instance ];
    instance.forEach(function(x, i) { params["Instances.member." + (i+1) + ".InstanceId"] = x; });
    this.queryELB("DeregisterInstancesWithLoadBalancer", params, options, callback);
}

// Register an instance(s) with ELB, instance can be one id or a list of ids
aws.elb2RegisterInstances = function(target, instance, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    var params = { TargetGroupArn: target };
    if (!Array.isArray(instance)) instance = [ instance ];
    instance.forEach(function(x, i) { params["Target.member." + (i+1) + ".Id"] = x; });
    this.queryELB2("RegisterTargets", params, options, callback);
}

// Run a shell command
aws.ssmSendCommand = function(cmds, instances, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    var params = {
        DocumentName: "AWS-RunShellScript",
        InstanceIds: Array.isArray(instances) ? instances : [instances],
        Parameters: { commands: Array.isArray(cmds) ? cmds : [cmds] }
    };
    this.querySSM("SendCommand", params, options, callback);
}

// Return a command details
aws.ssmWaitForCommand = function(cmdId, instanceId, options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    options = lib.objClone(options, "retryOnError", 1);
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
          return lib.isFlag(status, output.Status) && Date.now() < expires;
      },
      function(err) {
          lib.tryCall(callback, err, output);
      });
}

aws.ssmGetParametersByPath = function(path, options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    var list = [];
    var q = { Path: path, Recursive: true };
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
      });
}

