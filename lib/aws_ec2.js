//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Feb 2012
//

var util = require('util');
var logger = require(__dirname + '/logger');
var core = require(__dirname + '/core');
var lib = require(__dirname + '/lib');
var aws = require(__dirname + '/aws');

// AWS EC2 API request
aws.queryEC2 = function(action, obj, options, callback)
{
    this.queryEndpoint("ec2", '2015-10-01', action, obj, options, callback);
}

// AWS ELB API request
aws.queryELB = function(action, obj, options, callback)
{
    this.queryEndpoint("elasticloadbalancing", '2012-06-01', action, obj, options, callback);
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
//  - availabilityZone - availability zone, if not given use aws.zone or options['Placement.AvailabilityZone'] attribute
//  - subnetId - subnet id, if not given use aws.subnetId or options.SubnetId attribute
//  - alarms - a list with CloudWatch alarms to create for the instance, each value of the object represent an object with options to be
//      passed to the cwPutMetricAlarm method.
aws.ec2RunInstances = function(options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = {};

    var retries = options.retryCount || 3;
    var req = {
        MinCount: options.min || options.count || 1,
        MaxCount: options.max || options.count || 1,
        ImageId: options.imageId || this.imageId,
        InstanceType: options.instanceType || this.instanceType || "t2.micro",
        KeyName: options.keyName || this.keyName || "",
        UserData: options.data ? new Buffer(options.data).toString("base64") : "",
    };

    if (options.stop) req.InstanceInitiatedShutdownBehavior = "stop";
    if (options.terminate) req.InstanceInitiatedShutdownBehavior = "terminate";
    if (options.iamProfile || this.iamProfile) req["IamInstanceProfile.Name"] = options.iamProfile || this.iamProfile;
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
    if (!req.SubnetId && !req["NetworkInterface.0.SubnetId"]) {
        if (options.availabilityZone || this.zone) req["Placement.AvailabilityZone"] = options.availabilityZone || this.zone;
    }
    if (options.file) {
        req.UserData = lib.readFileSync(options.file).toString("base64");
    }
    if (options.name && options.name.indexOf("%i") == -1) {
        req["TagSpecification.1.ResourceType"] = "instance";
        req["TagSpecification.1.Tag.1.Key"] = "Name";
        req["TagSpecification.1.Tag.1.Value"] = options.name;
    }
    // To make sure we launch exatly one instance
    if (options.retryOnError && options.retryCount) req.ClientToken = lib.uuid();

    logger.debug('runInstances:', this.name, req, options);
    this.queryEC2("RunInstances", req, options, function(err, obj) {
        if (err) return callback && callback(err);

        // Instances list
        var items = lib.objGet(obj, "RunInstancesResponse.instancesSet.item", { list: 1 });
        if (!items.length) return callback && callback(err, obj);

        // Dont wait for instance if no additional tasks requested
        if (!options.waitRunning &&
            !options.name &&
            !options.elbName &&
            !options.elasticIp &&
            (!Array.isArray(options.alarms) || !options.alarms.length)) {
            return callback && callback(err, obj);
        }
        var instanceId = items[0].instanceId;

        lib.series([
           function(next) {
               self.ec2WaitForInstance(instanceId, "running", { waitTimeout: 300000, waitDelay: 5000, retryCount: retries }, next);
           },
           function(next) {
               // Set tag name for all instances
               if (!options.name) return next();
               lib.forEachSeries(items, function(item, next2) {
                   var n = lib.objGet(item, "tagSet.item", { list: 1 }).filter(function(x) { return x.key == "Name" }).map(function(x) { return x.value }).pop();
                   if (n == options.name) return next();
                   self.ec2CreateTags(item.instanceId, options.name.replace("%i", lib.toNumber(item.amiLaunchIndex) + 1), { retryCount: retries, retryOnError: 1 }, next2);
               }, next);
           },
           function(next) {
               // Add to the ELB
               if (!options.elbName) return next();
               self.elbRegisterInstances(options.elbName, items.map(function(x) { return x.instanceId }), { retryCount: retries, retryOnError: 1 }, next);
           },
           function(next) {
               // Elastic IP
               if (!options.elasticIp) return next();
               self.ec2AssociateAddress(instanceId, options.elasticIp, { subnetId: req.SubnetId || req["NetworkInterface.0.SubnetId"], retryCount: retries, retryOnError: 1 },next);
           },
           function(next) {
               // CloudWatch alarms
               if (!Array.isArray(options.alarms)) return next();
               lib.forEachSeries(items, function(item, next2) {
                   lib.forEachSeries(options.alarms, function(alarm, next3) {
                       alarm.dimensions = { InstanceId: item.instanceId };
                       alarm.retryCount = retries;
                       alarm.retryOnError = 1;
                       self.cwPutMetricAlarm(alarm, next3);
                   }, next2);
               }, next);
           },
        ], function() {
            if (callback) callback(err, obj);
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

    var state = "", num = 0, expires = Date.now() + (options.waitTimeout || 60000);
    var opts = { retryCount: options.retryCount || 3, retryOnError: 1 };
    lib.doWhilst(
      function(next) {
          self.queryEC2("DescribeInstances", { 'Filter.1.Name': 'instance-id', 'Filter.1.Value.1': instanceId }, opts, function(err, rc) {
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

// Describe instances according to the query filters, returns a list with instances, the following properties
// can be used:
//  - vpcId - VPC to get instances from
//  - instanceId - list of instances to show only
//  - tagName - filter by tag name(s)
//  - groupName - filter by group name(s)
//  - stateName - instances state(s)
//  - filters - an object with filters to send as is
//
aws.ec2DescribeInstances = function(options, callback)
{
    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {};

    var i = 1, req = {}, map = { vpcId: "vpc-id", stateName: "instance-state-name", tagName: "tag:Name", groupName: "group-name" };

    if (options.instanceId) {
        lib.strSplit(options.instanceId).forEach(function(x, j) { req["InstanceId." + (j + 1)] = x });
    }
    for (var p in map) {
        if (options[p]) {
            req["Filter." + i + ".Name"] = map[p];
            lib.strSplit(options[p]).forEach(function(x, j) { req["Filter." + i + ".Value." + (j + 1)] = x; });
            i++;
        }
    }
    for (var p in options.filters) {
        req["Filter." + i + ".Name"] = p;
        lib.strSplit(options.filters[p]).forEach(function(x, j) { req["Filter." + i + ".Value." + (j + 1)] = x; });
        i++;
    }
    logger.debug("ec2DescribeInstances:", req);
    aws.queryEC2("DescribeInstances", req, function(err, rc) {
        var list = lib.objGet(rc, "DescribeInstancesResponse.reservationSet.item", { list: 1 });
        list = list.map(function(x) {
            x = lib.objGet(x, "instancesSet.item");
            x.name = lib.objGet(x, "tagSet.item", { list: 1 }).filter(function(x) { return x.key == "Name" }).map(function(x) { return x.value }).pop();
            return x;
        });
        lib.tryCall(callback, err, list);
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

    var params = { InstanceId: instanceId, AllowReassociation: true };
    if (options.subnetId) {
        // Already known
        if (options.AllocationId) {
            return self.queryEC2("AssociateAddress", params, options, callback);
        }
        // Get the allocation id
        self.queryEC2("DescribeAddresses", { 'PublicIp.1': elasticIp }, options, function(err, obj) {
            params.AllocationId = lib.objGet(obj, "DescribeAddressesResponse.addressesSet.item.allocationId");
            if (!params.AllocationId) err = lib.newError({ message: "EIP not found", name: "EC2", code: elasticIp });
            if (err) return callback ? callback(err) : null;
            self.queryEC2("AssociateAddress", params, options, callback);
        });
    } else {
        params.PublicIp = elasticIp;
        self.queryEC2("AssociateAddress", params, options, callback);
    }
}

// Create an EBS image from the instance given or the current instance running
aws.ec2CreateImage = function(options, callback)
{
    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {};

    var req = { InstanceId: options.instanceId, Name: options.name || (core.appName + "-" + core.appVersion), NoReboot: true };
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
