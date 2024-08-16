//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const util = require('util');
const logger = require(__dirname + '/../logger');
const lib = require(__dirname + '/../lib');
const core = require(__dirname + '/../core');
const aws = require(__dirname + '/../aws');
const db = require(__dirname + '/../db');
const ipc = require(__dirname + '/../ipc');
const shell = core.modules.shell;

shell.help.push("-aws-s3-get -path PATH - retrieve a file from S3");
shell.help.push("-aws-s3-put -path PATH -file FILE - store a file to S3");
shell.help.push("-aws-s3-list -path PATH [-filter PATTERN] [-sort version|file|size|date|mtime] [-fmt obj|path] [-start NUM] [-count NUM] - list contents of a S3 folder");
shell.help.push("-aws-show-groups [-filter PATTERN] - show EC2 security groups");
shell.help.push("-aws-show-subnets [-filter PATTERN] - show VPC subnets");
shell.help.push("-aws-show-images [-filter PATTERN] [-owner O] [-self] [-arch ARCH] [-rootdev ebs|instance-store|*] [-devtype gp3|gp2|io1|standard|*] - show Amazon Linux AMIs (use %2A instead of *)");
shell.help.push("-aws-delete-image -filter PATTERN [-dry-run] - delete all AMIs that match the given name filter");
shell.help.push("-aws-create-image [-name NAME] [-descr DESCR] [-force] [-no-reboot] [-reboot] [-instance-id ID] [-dry-run] - create a new AMI from the instance by id or the current instance");
shell.help.push("-aws-launch-instances [-count NUM] [-image-name PATTERN] [-name NAME] [-group-name PATTERN] [-subnet-name PATTERN] [-subnet-split] [-subnet-each] [-user-data TEXT] [-target-group T] [-alarm-name NAME] [-host-name HOST] [-wait] [wait-timeout MSECS] [-wait-delay MSECS] [-dry-run] - start instance(s), the app name from the package.json is used as the base for all other resources unless explicitely defined in the command line");
shell.help.push("-aws-reboot-instances -filter PATTERN [-dry-run] - reboot instances by tag pattern");
shell.help.push("-aws-terminate-instances -filter PATTERN [-count NUM] [-dry-run] - terminate instances by tag pattern");
shell.help.push("-aws-show-instances [-filter PATTERN] [-col C] [-cols C,C...] - show running instances by tag pattern");
shell.help.push("-aws-show-tasks [-family F] [-col C] [-cols C,C...] - show running tasks by tag pattern");
shell.help.push("-aws-setup-ssh -group-name NAME [-close] [-dry-run]");
shell.help.push("-aws-create-launch-template-version -name NAME [-image-name *] [-version N] [-default] [-dry-run] - create a launch template version with the most recent AMI");
shell.help.push("-aws-check-cfn -file FILE - verify a CF template");
shell.help.push("-aws-create-cfn -name NAME -file FILE [-aws-region REGION] [-retain] [-wait] [-PARAM VALUE] ...");
shell.help.push("-aws-wait-cfn -name NAME [-aws-region REGION] - wait for the given CF stack to be completed");
shell.help.push("-aws-show-cfn-events -name NAME [-aws-region REGION] - show events for the given stack");
shell.help.push("-aws-create-queue -name NAME [-type production] [-worker-type TYPE] [-visibility-timeout 30] - create a SQS queue and refresh the config");
shell.help.push("-aws-create-cert -domain NAME [-star] [-email] [-arn ARN] [-wait N] - create a public SSL certificate from ACM, if -arn is given just update the Route53");
shell.help.push("-aws-show-cert -arn ARN - show a public SSL certificate from ACM");
shell.help.push("-aws-del-cert -arn ARN - delete a SSL certificate from ACM");
shell.help.push("-aws-manage-cert -arn ARN -elb ELB [-del] - add/remove a SSL cert(s) for the ELB");
shell.help.push("-aws-list-cert [-elb ELB] - show all public SSL certificates or for an ELB only");
shell.help.push("-aws-set-route53 -domain HOSTNAME [-current] [-filter PATTERN] [-type A|CNAME] [-ttl N] [-op OP] [-alias A] [-zoneId Z] [-value IPs] [-public] [-dry-run] - create/update/delete a Route53 record of specified type with IP/hostnames of all instances that satisfy the given filter, -public makes it use public IP/hostnames");
shell.help.push("-aws-get-route53 -zone ID | -domain DOMAIN [-rrset] - show details about specified zone");
shell.help.push("-aws-create-route53 -domain DOMAIN -elb NAME - create a new hosted zone if not exists, assign a domain to ELB by name if given");
shell.help.push("-aws-list-route53 - show all Route53 zones");
shell.help.push("-aws-show-logs -name NAME -filter PATTERN [-prefix STRPREFIX] [-streams NAMES] [-start HOURS] [-end HOURS] [-limit COUNT] [-timeout MS] [-verbose] - show event logs for the given group/streams");

// Check all names in the tag set for given name pattern(s), all arguments after 0 are checked
shell.awsCheckTags = function(obj, name)
{
    var tags = lib.objGet(obj, "tagSet.item", { list: 1 });
    if (!tags.length) return false;
    for (var i = 1; i < arguments.length; i++) {
        if (!arguments[i]) continue;
        var rx = new RegExp(String(arguments[i]), "i");
        if (tags.some((t) => (t.key == "Name" && rx.test(t.value)))) return true;
    }
    return false;
}

// Return matched subnet ids by availability zone and/or name pattern
shell.awsFilterSubnets = function(subnets, zone, name)
{
    return subnets.filter((x) => {
        if (zone && zone != x.availablityZone && zone != x.availabilityZone.split("-").pop()) return 0;
        return name ? shell.awsCheckTags(x, name) : 1;
    }).map((x) => (x.subnetId));
}

// Return Amazon AMIs for the given filter, sorted by create date in descending order
shell.awsSearchImages = function(options, callback)
{
    var query = {}, i = 1;

    if (options.owner) {
        var owner = lib.strSplit(options.owner);
        for (let i = 0; i < owner.length; i++) {
            query[`Owner.${i}`] = owner[i];
        }
    }
    if (options.filter) {
        query['Filter.1.Name'] = 'name';
        query['Filter.1.Value'] = options.filter;
        i++;
    }
    if (options.arch) {
        query[`Filter.${i}.Name`] = 'architecture';
        query[`Filter.${i}.Value`] = options.arch;
        i++;
    }
    if (options.rootdev) {
        query[`Filter.${i}.Name`] ='root-device-type';
        query[`Filter.${i}.Value`] = options.rootdev;
        i++;
    }
    if (options.devtype) {
        query[`Filter.${i}.Name`] = 'block-device-mapping.volume-type';
        query[`Filter.${i}.Value`] = options.devtype;
        i++;
    }
    if (options.dryrun) {
        logger.log("awsSearchImages:", query);
        return callback(null, []);
    }
    aws.queryEC2("DescribeImages", query, (err, rc) => {
        var images = lib.objGet(rc, "DescribeImagesResponse.imagesSet.item", { list: 1 });
        images.sort((a, b) => (b.creationDate.localeCompare(a.creationDate)));
        callback(err, images);
    });
}

// Launch instances by run mode and/or other criteria
shell.awsLaunchInstances = function(options, callback)
{
    var appName = shell.getArg("-app-name", options, core.appName);
    var appVersion = shell.getArg("-app-version", options, core.appVersion);

    var req = {
        name: shell.getArg("-name", options, appName + "-" + appVersion),
        count: shell.getArgInt("-count", options, 1),
        vpcId: shell.getArg("-vpc-id", options),
        instanceType: shell.getArg("-instance-type", options),
        imageId: shell.getArg("-image-id", options),
        subnetId: shell.getArg("-subnet-id", options),
        keyName: shell.getArg("-key-name", options),
        elasticIp: shell.getArg("-elastic-ip", options),
        publicIp: this.isArg("-public-ip", options),
        groupId: shell.getArg("-group-id", options),
        targetGroup: shell.getArg("-target-group", options),
        iamProfile: shell.getArg("-iam-profile", options),
        availabilityZone: shell.getArg("-availability-zone"),
        terminate: this.isArg("-terminate", options),
        launchTemplate: shell.getArg("-launch-template", options),
        metadata: this.isArg("-metadata", options),
        alarms: [],
        data: shell.getArg("-user-data", options),
        device: {
            name: shell.getArg("-dev-name", options, "/dev/xvda"),
            size: shell.getArg("-dev-size", options, 32),
            type: shell.getArg("-dev-type", options, "gp3"),
            iops: shell.getArgInt("-dev-iops", options),
            keep: this.isArg("-dev-keep", options),
            virtual: shell.getArg("-dev-virtual", options),
        }
    };

    logger.debug("awsLaunchInstances:", req);

    lib.series([
        function(next) {
            if (req.imageId) return next();
            var opts = {
                filter: shell.getArg("-image-name", options),
                owner: shell.getArg("-image-owner", options),
                arch: shell.getArg("-image-arch", options),
                rootdev: shell.getArg("-image-rootdev", options),
                devtype: shell.getArg("-image-devtype", options),
            };
            if (!opts.filter) return next("ERROR: -image-id or -image-name must be provided");
            shell.awsSearchImages(opts, (err, list) => {
                req.imageId = list[0]?.imageId;
                next(err ? err : !req.imageId ? "ERROR: AMI must be specified or discovered by filters" : null);
            });
        },
        function(next) {
            if (req.groupId) return next();
            var filter = shell.getArg("-group-name", options, appName + "|^default$");
            aws.ec2DescribeSecurityGroups({ filter: filter }, (err, rc) => {
                if (!err) req.groupId = rc.map((x) => (x.groupId));
                next(err);
            });
        },
        function(next) {
            var zone = shell.getArg("-zone");
            var filter = shell.getArg("-subnet-name", options);
            if (!zone && !filter) return next();
            var params = req.vpcId ? { "Filter.1.Name": "vpc-id", "Filter.1.Value": req.vpcId } : {};
            aws.queryEC2("DescribeSubnets", params, (err, rc) => {
                var subnets = lib.objGet(rc, "DescribeSubnetsResponse.subnetSet.item", { list: 1 });
                req.subnetId = shell.awsFilterSubnets(subnets, zone, filter)[0];
                next(err);
            });
        },
        function(next) {
            // Create CloudWatch alarms, find SNS topic by name
            var alarmName = shell.getArg("-alarm-name", options);
            if (!alarmName) return next();
            aws.snsListTopics((err, topics) => {
                var topic = new RegExp(alarmName, "i");
                topic = topics.filter((x) => (x.match(topic))).pop();
                if (!topic) return next(err);
                req.alarms.push({
                    metric: "CPUUtilization",
                    threshold: shell.getArgInt("-cpu-threshold", options, 80),
                    evaluationPeriods: shell.getArgInt("-periods", options, 3),
                    alarm: topic });
                req.alarms.push({
                    metric: "NetworkOut",
                    threshold: shell.getArgInt("-net-threshold", options, 10000000),
                    evaluationPeriods: shell.getArgInt("-periods", options, 3),
                    alarm: topic });
                req.alarms.push({
                    metric: "StatusCheckFailed",
                    threshold: 1,
                    evaluationPeriods: 2,
                    statistic: "Maximum",
                    alarm: topic });
                next(err);
            });
        },
        function(next) {
            if (shell.isArg("-wait", options)) {
                req.waitRunning = 1;
                req.waitTimeout = shell.getArgInt("-wait-timeout", options, 600000),
                req.waitDelay = shell.getArgInt("-wait-delay", options, 30000)
            }
            if (shell.isArg("-dry-run", options)) {
                logger.dump("awsLaunchInstances:", req);
                return next();
            }

            logger.debug("awsLaunchInstances:", req);

            aws.ec2RunInstances(req, (err, rc, info) => {
                for (const i of info.instances) {
                    console.log("EC2-Instance:", i.instanceId, i.privateIpAddress || "-", i.publicIpAddress || "-", i.architecture || "-", i.name || "-");
                }
                next(err);
            });
       },
    ], callback);
}

// Delete an AMI with the snapshot
shell.cmdAwsLaunchInstances = function(options)
{
    this.awsLaunchInstances(options, shell.exit);
}

shell.cmdAwsShowImages = function(options)
{
    options.owner = shell.getArg("-owner", options);
    options.filter = shell.getArg("-filter", options);
    options.rootdev = shell.getArg("-rootdev", options);
    options.devtype = shell.getArg("-devtype", options);
    options.arch = shell.getArg("-arch", options);
    options.dryrun = shell.isArg("-dry-run");
    if (shell.isArg("-self")) options.owner = "self";

    this.awsSearchImages(options, (err, images) => {
        if (!err) {
            images.forEach((x) => {
                console.log(x.imageId, x.name, x.architecture, x.creationDate, x.description);
            });
        }
        shell.exit(err);
    });
}

shell.cmdAwsShowGroups = function(options)
{
    options.filter = shell.getArg("-filter", options);
    options.name = shell.getArg("-name", options);

    aws.ec2DescribeSecurityGroups(options, (err, images) => {
        images.forEach((x) => {
            console.log(x.groupId, x.groupName, x.groupDescription);
        });
        shell.exit(err);
    });
}

shell.cmdAwsShowSubnets = function(options)
{
    options.filter = shell.getArg("-filter", options);
    options.name = shell.getArg("-name", options);

    aws.ec2DescribeSubnets(options, (err, subnets) => {
        subnets.forEach((x) => {
            console.log(x.subnetId, x.cidrBlock, x.name, x.availabilityZone);
        });
        shell.exit(err);
    });
}

// Delete an AMI with the snapshot
shell.cmdAwsDeleteImage = function(options)
{
    var filter = shell.getArg("-filter", options);
    if (!filter || filter == "*") return shell.exit("-filter is required");
    var images = [];

    lib.series([
       function(next) {
           shell.awsSearchImages({ filter }, (err, list) => {
               if (!err) images = list;
               next(err);
           });
       },
       // Deregister existing image with the same name in the destination region
       function(next) {
           logger.log("DeregisterImage:", images);
           if (shell.isArg("-dry-run", options)) return next();
           lib.forEachSeries(images, function(img, next2) {
               aws.ec2DeregisterImage(img.imageId, { snapshots: 1 }, next2);
           }, next);
       },
    ], shell.exit);
}

// Create an AMI from the current instance of the instance by id
shell.cmdAwsCreateImage = function(options)
{
    options.name = shell.getArg("-name", options);
    options.prefix = shell.getArg("-prefix", options);
    options.descr = shell.getArg("-descr", options);
    options.instanceId = shell.getArg("-instance-id", options);
    options.noreboot = this.isArg("-no-reboot", options);
    options.reboot = this.isArg("-reboot", options);
    options.quiet = !this.isArg("-verbose", options);
    if (this.isArg("-dry-run", options)) return shell.exit(null, options);
    var imgId, imgState;

    lib.series([
        function(next) {
            aws.ec2CreateImage(options, (err, rc) => {
                imgId = lib.objGet(rc, "CreateImageResponse.imageId");
                if (err?.code == "InvalidAMIName.Duplicate" && shell.isArg("-force", options)) {
                    var d = err.message.match(/in use by AMI (ami-[0-9a-z]+)/);
                    if (d) return aws.ec2DeregisterImage(d[1], { snapshots: 1 }, next);
                }
                next(err);
            });
        },
        function(next) {
            if (imgId) return next();
            aws.ec2CreateImage(options, (err, rc) => {
                imgId = lib.objGet(rc, "CreateImageResponse.imageId");
                next(err);
            });
        },
        function(next) {
            if (!imgId || !shell.isArg("-wait", options)) return next();
            var running = 1;
            var interval = shell.getArgInt("-interval", options, 5000);
            var expires = Date.now() + shell.getArgInt("-timeout", options, 300000);

            lib.doWhilst(
                function(next) {
                    aws.queryEC2("DescribeImages", { "ImageId.1": imgId }, (err, rc) => {
                        if (err) return next(err);
                        var images = lib.objGet(rc, "DescribeImagesResponse.imagesSet.item", { list: 1 });
                        imgState = images.length && images[0].imageState;
                        running = imgState == "available" || Date.now() > expires ? 0 : 1;
                        setTimeout(next, running ? interval : 0);
                    });
                },
                function() {
                    return running;
                },
                next, true);
        },
    ], (err) => {
        if (imgId) console.log("EC2-AMI:", imgId, imgState);
        shell.exit(err);
    });
}

shell.cmdAwsCopyImage = function(options)
{
    var region = shell.getArg("-region", options);
    if (!region) return shell.exit("-region is required");
    var imageName = shell.getArg("-image-name", options, '*');
    var imageId;

    lib.series([
      function(next) {
          shell.awsSearchImages({ filter: imageName }, (err, list) => {
              if (!err && list.length == 1) {
                  imageId = list[0].imageId;
                  imageName = list[0].imageName;
              }
              next(err ? err : imageId ? "ERROR: AMI must be specified or discovered by filters" : null);
          });
      },
      // Deregister existing image with the same name in the destination region
      function(next) {
          aws.queryEC2("DescribeImages", { 'ImageId.1': imageId }, { region: region }, function(err, rc) {
              if (err) return next(err);
              var images = lib.objGet(rc, "DescribeImagesResponse.imagesSet.item", { list: 1 });
              if (!images.length) return next();
              logger.log("Will deregister existing AMI with the same name", region, images[0].imageName, images[0].imageId, "...");
              if (shell.isArg("-dry-run", options)) return next();
              aws.ec2DeregisterImage(images[0].imageId, { snapshots: 1, region: region }, next);
          });
      },
      function(next) {
          var req = { SourceRegion: aws.region || 'us-east-1', SourceImageId: imageId, Name: imageName };
          logger.log("CopyImage:", req)
          if (shell.isArg("-dry-run", options)) return next();
          aws.queryEC2("CopyImage", req, { region: region }, function(err, rc) {
              if (err) return next(err);
              var id = lib.objGet(rc, "CopyImageResponse.imageId");
              if (id) logger.log("CopyImage:", id);
              next();
          });
      },
    ], shell.exi);
}

// Reboot instances by run mode and/or other criteria
shell.cmdAwsRebootInstances = function(options)
{
    var instances = [];
    var filter = shell.getArg("-filter", options);
    if (!filter) return shell.exit("-filter is required");

    lib.series([
       function(next) {
           var req = { stateName: "running", tagName: filter };
           aws.ec2DescribeInstances(req, function(err, list) {
               instances = list.map(function(x) { return x.instanceId });
               next(err);
           });
       },
       function(next) {
           if (!instances.length) shell.exit("No instances found");
           var req = {};
           instances.forEach(function(x, i) { req["InstanceId." + (i + 1)] = x });
           logger.log("RebootInstances:", req)
           if (shell.isArg("-dry-run", options)) return next();
           aws.queryEC2("RebootInstances", req, next);
       },
    ], shell.exit);
}

// Terminate instances by run mode and/or other criteria
shell.cmdAwsTerminateInstances = function(options)
{
    var instances = [];
    var filter = shell.getArg("-filter", options);
    if (!filter) return shell.exit("-filter is required");

    lib.series([
       function(next) {
           var req = { stateName: "running", tagName: filter };
           aws.ec2DescribeInstances(req, function(err, list) {
               instances = list.map(function(x) { return x.instanceId });
               next(err);
           });
       },
       function(next) {
           if (!instances.length) shell.exit("No instances found");
           var req = {};
           instances.forEach(function(x, i) { req["InstanceId." + (i + 1)] = x });
           logger.log("TerminateInstances:", req)
           if (shell.isArg("-dry-run", options)) return next();
           aws.queryEC2("TerminateInstances", req, next);
       },
    ], shell.exit);
}

// Show running instances by run mode and/or other criteria
shell.cmdAwsShowInstances = function(options)
{
    var instances = [];
    var filter = shell.getArg("-filter", options);
    var col = shell.getArg("-col", options);
    var cols = lib.strSplit(shell.getArg("-cols", options, "id,az,priv,ip,arch,type,name"));

    lib.series([
        function(next) {
            var req = { stateName: "running", tagName: filter };
            aws.ec2DescribeInstances(req, (err, list) => {
                instances = list;
                next(err);
            });
        },
        function(next) {
            logger.debug("showInstances:", instances);
            var map = { priv: "privateIpAddress", ip: "ipAddress", id: "instanceId", type: "instanceType", name: "name", key: "keyName", arch: "architecture", az: "availabilityZone" }
            if (col) {
                console.log(instances.map((x) => (lib.objDescr(lib.objGet(x, map[col] || col)))).join(" "));
            } else {
                instances.forEach((x) => {
                    console.log(cols.map((col) => (lib.objDescr(lib.objGet(x, map[col] || col)))).join("\t"));
                });
            }
            next();
        },
    ], shell.exit);
}

// Show running tasks by run mode and/or other criteria
shell.cmdAwsShowTasks = function(options)
{
    lib.series([
        function(next) {
            var req = {
                cluster: shell.getArg("-cluster", options) || aws.ecsCluster,
                desiredStatus: shell.getArg("-status", options) || undefined,
                family: shell.getArg("-family", options) || undefined,
                serviceName: shell.getArg("-service", options) || undefined,
                startedBy: shell.getArg("-startedby", options) || undefined,
                nextToken: shell.getArg("-token", options) || undefined,
            };
            aws.queryECS("ListTasks", req, next);
        },
        function(next, rc) {
            if (rc.nextToken) console.log("nextToken: " + rc.nextToken);
            if (!rc?.taskArns?.length) return next();

            logger.debug("showTasks:", rc);
            var req = {
                cluster: shell.getArg("-cluster", options),
                tasks: rc.taskArns,
            };
            aws.ecsDescribeTasks(req, next);
        },
        function(next, rc) {
            logger.debug("showTasks:", rc);
            if (rc?.failures?.length) console.log("failures:", lib.objDescr(rc.failures))
            if (!rc?.tasks?.length) return next();

            var col = shell.getArg("-col", options);
            var cols = lib.strSplit(shell.getArg("-cols", options, "id,priv,az,cpu,memory,arch,name,family"));

            var map = { priv: "privateIpAddress", az: "availabilityZone", disk: "ephemeralStorage.sizeInGiB" }
            if (col) {
                console.log(rc.tasks.map((x) => (lib.objDescr(lib.objGet(x, map[col] || col)))).join(" "));
            } else {
                rc.tasks.forEach((x) => {
                    console.log(cols.map((col) => (lib.objDescr(lib.objGet(x, map[col] || col)))).join("\t"));
                });
            }
            next();
        },
    ], shell.exit);
}

// Open/close SSH access to the specified group for the current external IP address
shell.cmdAwsSetupSsh = function(options)
{
    var ip = "", groupId;
    var groupName = shell.getArg("-group-name", options);
    if (!groupName) return shell.exit("-group-name is required");

    lib.series([
       function(next) {
           aws.ec2DescribeSecurityGroups({}, function(err, rc) {
               if (!err && rc.length) groupId = rc[0];
               next(err);
           });
       },
       function(next) {
           if (!groupId) return next("No group is found for", groupName);
           core.httpGet("http://checkip.amazonaws.com", function(err, params) {
               if (err || params.status != 200) return next(err || params.data || "Cannot determine IP address");
               ip = params.data.trim();
               next();
           });
       },
       function(next) {
           var req = { GroupId: groupId,
               "IpPermissions.1.IpProtocol": "tcp",
               "IpPermissions.1.FromPort": 22,
               "IpPermissions.1.ToPort": 22,
               "IpPermissions.1.IpRanges.1.CidrIp": ip + "/32" };
           logger.log(req);
           if (shell.isArg("-dry-run", options)) return next();
           aws.queryEC2(shell.isArg("-close", options) ? "RevokeSecurityGroupIngress" : "AuthorizeSecurityGroupIngress", req, next);
       },
    ], shell.exit);
}

// Get file
shell.cmdAwsS3Get = function(options)
{
    var query = this.getQuery();
    var file = shell.getArg("-file", options);
    var uri = shell.getArg("-path", options);
    query.file = file || uri.split("?")[0].split("/").pop();
    aws.s3GetFile(uri, query, shell.exit);
}

// Put file
shell.cmdAwsS3Put = function(options)
{
    var query = this.getQuery();
    var path = shell.getArg("-path", options);
    var uri = shell.getArg("-file", options);
    aws.s3PutFile(uri, path, query, shell.exit);
}

// List folder
shell.cmdAwsS3List = function(options)
{
    var query = this.getQuery();
    var sort = shell.getArg("-sort", options);
    var desc = shell.getArg("-desc", options);
    var uri = shell.getArg("-path", options);
    var fmt = shell.getArg("-fmt", options);
    var filter = lib.toRegexp(shell.getArg("-filter", options));
    var start = shell.getArgInt("-start", options);
    var count = shell.getArgInt("-count", options);
    aws.s3List(uri, query, function(err, files) {
        if (err) shell.exit(err);
        files = files.filter(function(x) {
            if (x.Key.slice(-1) == "/") return 0;
            return filter.test(x.Key);
        }).map(function(x) {
            switch (fmt) {
            case "obj":
                return { file: x.Key, date: x.LastModified, mtime: lib.toDate(x.LastModified), size: x.Size };
            case "path":
                return x.Key;
            default:
                return x.Key.split("/").pop();
            }
        });
        switch (sort) {
        case "version":
            files = lib.sortByVersion(files, "file");
            break;
        case "size":
            files.sort(function(a, b) { return desc ? b.size - a.size : a.size - b.size });
            break;
        case "mtime":
            files.sort(function(a, b) { return desc ? b.mtime - a.mtime : a.mtime - b.mtime });
            break;
        case "date":
            files.sort(function(a, b) { return desc ? b.date < a.date : a.date < b.date });
            break;
        case "file":
        case "name":
            if (fmt == "obj") {
                files.sort(function(a, b) { return desc ? b.file < a.file : a.file < b.file });
            } else {
                files.sort(function(a, b) { return desc ? b < a : a < b });
            }
            break;
        }
        if (start) files = files.slice(start);
        if (count) files = files.slice(0, count);
        for (var i in files) console.log(files[i]);
        shell.exit();
    });
}

shell.cmdAwsCheckCfn = function(options)
{
    var file = shell.getArg("-file", options);
    if (!file) return shell.exit("ERROR: -file is required");

    var body = lib.readFileSync(file, { logger: "error" });
    if (!body) return shell.exit("ERROR: Resources must be specified in the template");

    aws.queryCFN("ValidateTemplate", { TemplateBody: body }, shell.exit);
}

shell.cmdAwsCreateCfn = function(options)
{
    var name = shell.getArg("-name", options);
    if (!name) return shell.exit("ERROR: -name is required");
    var file = shell.getArg("-file", options);
    if (!file) return shell.exit("ERROR: -file is required");

    var body = lib.readFileSync(file, { json: 1, logger: "error" });
    if (!body.Resources) return shell.exit("ERROR: Resources must be specified in the template");

    // Mark all resources as Retain so when deleting the stack all resource will still be active and can be configured separately
    if (shell.isArg("-retain", options)) {
        Object.keys(body.Resources).forEach((x) => {
            body.Resources[x].DeletionPolicy = "Retain";
        });
    }
    var req = { StackName: name };

    // Assign parameters
    Object.keys(body.Parameters).forEach((x, i) => {
        var val = shell.getArg('-' + x, options, body.Parameters[x].Default).trim();
        if (!val && lib.toNumber(body.Parameters[x].MinLength)) shell.exit("ERROR: -" + x + " is required");
        if (!val) return;
        req['Parameters.member.' + (i + 1) + '.ParameterKey'] = x;
        req['Parameters.member.' + (i + 1) + '.ParameterValue'] = val;
    });
    for (var p in body.Resources) {
        if (body.Resources[p].Type.startsWith("AWS::IAM::")) {
            req["Capabilities.member.1"] = "CAPABILITY_NAMED_IAM";
            break;
        }
    }
    if (shell.isArg("-disable-rollback")) req.DisableRollback = true;
    if (shell.isArg("-rollback")) req.OnFailure = "ROLLBACK";
    if (shell.isArg("-delete")) req.OnFailure = "DELETE";
    if (shell.isArg("-do-nothing")) req.OnFailure = "DO_NOTHING";

    var role = shell.getArg("-role-arn", options);
    if (role) req.RoleARN = role;
    var policy = shell.getArg("-policy-url", options);
    if (policy) req.StackPolicyURL = policy;

    shell.getArgList("-tags", options).forEach((x, i) => {
        req['Tags.member.' + (i + 1)] = x;
    });

    logger.log(req)
    if (shell.isArg("-dry-run", options)) return shell.exit();

    req.TemplateBody = JSON.stringify(body)
    aws.queryCFN("CreateStack", req, (err, rc) => {
        if (err) return shell.exit(err);

        logger.dump(rc);
        if (!shell.isArg("-wait", options)) return shell.exit();
        shell.cmdAwsWaitCfn(options, (err) => {
            if (err) return shell.cmdAwsShowCfnEvents(options);
            shell.exit();
        });
    });
}

shell.cmdAwsWaitCfn = function(options, callback)
{
    var name = shell.getArg("-name", options);
    if (!name) return shell.exit("ERROR: -name is required");
    var timeout = shell.getArgInt("-timeout", options, 1800);
    var interval = shell.getArgInt("-interval", options, 60);

    var num = 0, expires = Date.now() + timeout * 1000, stacks = [], status = "";
    var complete = ["CREATE_COMPLETE","CREATE_FAILED",
                    "ROLLBACK_COMPLETE","ROLLBACK_FAILED",
                    "DELETE_COMPLETE","DELETE_FAILED",
                    "UPDATE_COMPLETE","UPDATE_FAILED",
                    "UPDATE_ROLLBACK_COMPLETE","UPDATE_ROLLBACK_FAILED"];

    lib.series([
      function(next) {
          // Wait for all instances to register or exit after timeout
          lib.doWhilst(
            function(next2) {
                aws.queryCFN("DescribeStacks", { StackName: name }, function(err, rc) {
                    if (err) return next2(err);
                    stacks = lib.objGet(rc, "DescribeStacksResponse.DescribeStacksResult.Stacks.member", { list: 1 })
                    if (stacks.length > 0) status = stacks[0].StackStatus;
                    setTimeout(next2, num++ == 0 ? 0 : interval*1000);
                });
            },
            function() {
                if (status) logger.log("Status: ", name, status);
                return complete.indexOf(status) == -1 && Date.now() < expires;
            },
            next, true);
      },
      function(next) {
          logger.log(util.inspect(stacks, { depth: null }));
          next(status.match(/(CREATE|DELETE|UPDATE)_COMPLETE/) ? null :
              (status.match(/CREATING$/) ? "Timeout waiting for completion, start again to continue" :
                                           "Error waiting for completion: " + status));
      },
    ], function(err) {
        if (typeof callback == "function") return callback(err)
        shell.exit(err)
    })
}

shell.cmdAwsShowCfnEvents = function(options)
{
    var name = shell.getArg("-name", options);
    if (!name) return shell.exit("ERROR: -name is required");

    var token;

    lib.doWhilst(
      function(next) {
          aws.queryCFN("DescribeStackEvents", { StackName: name, NextToken: token }, function(err, rc) {
              if (err) return next(err);
              token = lib.objGet(rc, "DescribeStackEventsResponse.DescribeStackEventsResult.NextToken");
              var events = lib.objGet(rc, "DescribeStackEventsResponse.DescribeStackEventsResult.StackEvents.member", { list: 1 });
              events.forEach(function(x) {
                  console.log(x.Timestamp, x.ResourceType, x.LogicalResourceId, x.PhysicalResourceId, x.ResourceStatus, x.ResourceStatusReason || "");
              });
              next();
          });
      },
      function() {
          return token;
      },
      shell.exit);
}

shell.cmdAwsCreateLaunchTemplateVersion = function(options, callback)
{
    var appName = shell.getArg("-app-name", options, core.appName);
    var appVersion = shell.getArg("-app-version", options, core.appVersion);
    var name = shell.getArg("-name", options);
    var version = shell.getArgInt("-version", options);
    var imageId = shell.getArg("-image-id", options);
    var tmpl, image;

    lib.series([
        function(next) {
            if (shell.isArg("-new")) return next();
            var opts = {
                LaunchTemplateName: name,
                "LaunchTemplateVersion.1": version || "$Latest",
            };
            aws.queryEC2("DescribeLaunchTemplateVersions", opts, (err, rc) => {
                if (!err) tmpl = lib.objGet(rc, "DescribeLaunchTemplateVersionsResponse.launchTemplateVersionSet.item");
                next(err);
            });
        },
        function(next) {
            if (imageId) return next();
            var filter = shell.getArg("-image-name", options);
            if (!filter) return next();
            shell.awsSearchImages({ filter }, (err, list) => {
                if (!err && list.length == 1) image = list[0];
                next(err);
            });
        },
        function(next) {
            var opts = {
                LaunchTemplateName: name,
                VersionDescription: image ? image.name : appName + "-" + appVersion,
            };
            if (tmpl) opts.SourceVersion = tmpl.versionNumber;

            if (image && !imageId) imageId = image.imageId;
            if (imageId && tmpl?.launchTemplateData?.imageId != imageId) {
                opts["LaunchTemplateData.ImageId"] = imageId;
            }

            var type = shell.getArg("-instance-type", options);
            if (type && tmpl?.launchTemplateData?.instanceType != type) {
                opts["LaunchTemplateData.InstanceType"] = type;
            }

            var key = shell.getArg("-key-name", options);
            if (key && tmpl?.LaunchTemplateData?.keyName != key) {
                opts["LaunchTemplateData.KeyName"] = key;
            }

            var profile = shell.getArg("-iam-profile", options);
            if (profile && (!tmpl?.LaunchTemplateData?.IamInstanceProfile || tmpl.LaunchTemplateData.IamInstanceProfile.name != profile)) {
                opts["LaunchTemplateData.IamInstanceProfile.Name"] = profile;
            }

            var eth0 = lib.objGet(tmpl?.LaunchTemplateData, "networkInterfaceSet.item", { list: 1 }).filter((x) => (x.deviceIndex == 0)).pop();
            var pub = lib.toBool(shell.getArg("-public-ip", options));
            if (pub && (!eth0 || lib.toBool(eth0.associatePublicIpAddress) != pub)) {
                opts["LaunchTemplateData.NetworkInterface.1.AssociatePublicIpAddress"] = pub;
                opts["LaunchTemplateData.NetworkInterface.1.DeviceIndex"] = "0";
            }

            var groups = lib.strSplit(shell.getArg("-group-id", options)).sort();
            if (lib.isArray(groups) && (!eth0 || lib.objGet(eth0, "groupSet.groupId", { list: 1 }).sort().join(",") != groups.join(","))) {
                opts["LaunchTemplateData.NetworkInterface.1.DeviceIndex"] = "0";
                groups.forEach((x, i) => { opts["LaunchTemplateData.NetworkInterface.1.SecurityGroupId." + (i + 1)] = x });
            }

            var dname = shell.getArg("-dev-name", options, "/dev/xvda");
            var dsize = shell.getArg("-dev-size", options);
            var dtype = shell.getArg("-dev-type", options, "gp3");
            var iops = shell.getArgInt("-dev-iops", options);
            var dev = lib.objGet(tmpl?.LaunchTemplateData, "blockDeviceMappingSet.item", { list: 1 }).filter((x) => (x.deviceName == dname)).pop();
            if (dsize && (!dev || !dev.ebs || dev.ebs.volumeSize != dsize || dev.ebs.volumeType != dtype || (iops && dev.ebs.iops != iops))) {
                opts['LaunchTemplateData.BlockDeviceMappings.1.Ebs.VolumeSize'] = dsize;
                opts['LaunchTemplateData.BlockDeviceMappings.1.Ebs.VolumeType'] = dtype;
                opts['LaunchTemplateData.BlockDeviceMappings.1.DeviceName'] = dname;
                if (iops) opts['LaunchTemplateData.BlockDeviceMappings.1.Ebs.Iops'] = iops;
            }

            if (tmpl) logger.dump("TEMPLATE:", tmpl);
            if (image) logger.dump("IMAGE:", image)
            logger.dump("CreateLaunchTemplateVersion:", opts);

            if (shell.isArg("-dry-run", options)) return next();
            if (Object.keys(opts).length == 3) return next();
            opts.region = shell.getArg("-region");
            aws.queryEC2(shell.isArg("-new") ? "CreateLaunchTemplate" : "CreateLaunchTemplateVersion", opts, (err, rc) => {
                if (!err) {
                    tmpl = lib.objGet(rc, "CreateLaunchTemplateVersionResponse.launchTemplateVersion");
                    logger.dump("CreateLaunchTemplateVersionResponse:", tmpl);
                }
                next(err);
            });
        },
        function(next) {
            if (!tmpl?.versionNumber) return next();
            if (shell.isArg("-dry-run", options)) return next();
            if (!shell.isArg("-default", options)) return next();
            var opts = {
                LaunchTemplateName: name,
                SetDefaultVersion: tmpl.versionNumber,
            };
            aws.queryEC2("ModifyLaunchTemplate", opts, next);
        },
    ], (err) => {
        if (!err) console.log("EC2-TEMPLATE:", name, tmpl?.versionNumber);
        if (typeof callback == "function") return callback(err);
        shell.exit(err);
    });
}

shell.cmdAwsShowLogs = function(options, callback)
{
    var name = shell.getArg("-name", options);
    if (!name) return shell.exit("ERROR: -name is required");
    var stime = shell.getArgInt("-start", options, 1) * 3600000;
    var etime = shell.getArgInt("-end", options) * 3600000;
    var verbose = this.isArg("-verbose");

    var q = {
        name: name,
        stime: Date.now() - stime,
        etime: Date.now() - etime,
        filter: shell.getArg("-filter", options),
        prefix: shell.getArg("-prefix", options),
        timeout: shell.getArgInt("-timeout", options),
        limit: shell.getArgInt("-limit", options, 100),
        names: lib.strSplit(shell.getArg("-streams", options)),
    };
    aws.cwlFilterLogEvents(q, (err, rc) => {
        for (const i in rc.events) {
            console.log(verbose ? rc.events[i] : rc.events[i].message);
        }
        shell.exit(err);
    });
}

shell.cmdAwsCreateQueue = function(options, callback)
{
    var name = shell.getArg("-name", options);
    if (!name) return shell.exit("ERROR: -name is required");

    lib.series([
        function(next) {
            var q = {
                QueueName: name,
            }
            var n = 1;
            for (const a of ["VisibilityTimeout", "DelaySeconds", "FifoQueue", "ContentBasedDeduplication"]) {
                var v = shell.getArg("-" + lib.toUncamel(a), options);
                if (!v) continue;
                q["Attribute." + n + ".Name"] = a;
                q["Attribute." + n + ".Value"] = v;
                n++;
            }
            aws.querySQS("CreateQueue", q, next);
        },
        function(next, rc) {
            var type = shell.getArg("-type", options, "production");
            var url = lib.objGet(rc, "CreateQueueResponse.CreateQueueResult.QueueUrl");
            console.log("CreateQueue:", url);
            db.put("bk_config", { type: type, name: `ipc-queue-${name.replace(/[^a-z0-9]/ig, "")}`, value: url }, next);
        },
        function(next) {
            ipc.sendBroadcast("config:init");
            setTimeout(next, 3000);
        },
        function(next) {
            ipc.sendBroadcast("queue:check");
            setTimeout(next, 1000);
        },
        function(next, rc) {
            // Add to a job worker queue
            var type = shell.getArg("-worker-type", options);
            if (!type) return next();
            db.get("bk_config", { type: type, name: `jobs-worker-queue` }, (err, row) => {
                var queue = lib.toFlags("add", lib.strSplit(row?.value), name);
                console.log("CreateQueue:", type, queue);
                db.put("bk_config", { type: type, name: `jobs-worker-queue`, value: queue }, (err) => {
                   if (!err) ipc.sendBroadcast("config:init");
                   next(err);
                });
            });
        },
    ], shell.exit.bind(shell));
}

function convCert(cert)
{
    if (cert) {
        for (const p of ["CreatedAt", "IssuedAt", "NotBefore", "NotAfter"]) cert[p] = lib.strftime(cert[p]*1000);
    }
    return cert;
}

shell.cmdAwsShowCert = function(options, callback)
{
    var arn = shell.getArg("-arn", options);
    if (!arn) return shell.exit("ERROR: -arn is required");

    if (!arn.includes(":")) arn = `arn:aws:acm:${aws.region}:${aws.accountId}:certificate/${arn}`;

    aws.queryACM("DescribeCertificate", { CertificateArn: arn }, (err, rc) => {
        shell.exit(err, convCert(rc?.Certificate));
    });
}

shell.awsGetCertListener = function(options, callback)
{
    lib.series([
        function(next) {
            aws.queryELB2("DescribeLoadBalancers", { "Names.member.1": options.elb }, (err, rc) => {
                var b = rc?.DescribeLoadBalancersResponse?.DescribeLoadBalancersResult?.LoadBalancers?.member;
                next(err, b?.LoadBalancerArn);
            });
        },
        function(next, arn) {
            aws.queryELB2("DescribeListeners", { LoadBalancerArn: arn }, (err, rc) => {
                var l = rc?.DescribeListenersResponse?.DescribeListenersResult?.Listeners?.member?.filter((x) => (x.Protocol == 'HTTPS')).pop();
                next(err, l?.ListenerArn, arn);
            });
        },
    ], callback)
}

shell.cmdAwsListCert = function(options, callback)
{
    var status = lib.strSplit(shell.getArg("-status", options, "ISSUED"));
    var elb = shell.getArg("-elb", options), list = [];

    lib.series([
        function(next) {
            aws.listCertificates({ status: status }, (err, rc) => {
                if (rc?.length) {
                    list = rc;
                    if (!elb) {
                        list.sort((a, b) => (a.DomainName.localeCompare(b.DomainName)));
                        for (const i in rc) console.log(rc[i].DomainName, lib.objDescr(convCert(rc[i])));
                    }
                }
                next(err);
            });
        },
        function(next) {
            if (!elb) return next();
            shell.awsGetCertListener({ elb: elb }, next);
        },
        function(next, listener) {
            if (!listener) return next();
            console.log("ELB:", elb, listener);
            aws.queryELB2("DescribeListenerCertificates", { ListenerArn: listener }, (err, rc) => {
                if (!err) {
                    var l = rc?.DescribeListenerCertificatesResponse?.DescribeListenerCertificatesResult?.Certificates?.member;
                    if (l?.length) {
                        for (const c of list) {
                            for (const m of l) {
                                if (m.CertificateArn == c.CertificateArn) {
                                    m.DomainName = c.DomainName;
                                    break;
                                }
                                m.DomainName = m.DomainName || "";
                            }
                        }
                        l.sort((a, b) => (a.DomainName.localeCompare(b.DomainName)));
                        for (const i in l) {
                            console.log(l[i].DomainName, l[i].CertificateArn, l[i].IsDefault === "true" ? "Default" : "");
                        }
                    }
                    console.log("TOTAL: ", l?.length || 0);
                }
                next(err);
            });
        }
    ], shell.exit);
}

shell.cmdAwsManageCert = function(options, callback)
{
    var arn = shell.getArg("-arn", options);
    if (!arn) return shell.exit("ERROR: -arn is required");

    var elb = shell.getArg("-elb", options);
    if (!elb) return shell.exit("ERROR: -elb is required");

    this.awsManageCert({ arn, elb }, shell.exit);
}

shell.awsManageCert = function(options, callback)
{
    lib.series([
        function(next) {
            shell.awsGetCertListener({ elb: options.elb }, next);
        },
        function(next, listener) {
            if (!listener) return next("HTTPS listener not found");
            console.log("ELB:", listener);
            var req = {
                ListenerArn: listener,
            };
            var i = 1;
            for (let a of lib.strSplit(options.arn)) {
                if (!a.includes(":")) a = `arn:aws:acm:${aws.region}:${aws.accountId}:certificate/${a}`;
                req[`Certificates.member.${i++}.CertificateArn`] = a;
            }
            var action = shell.isArg("-del", options) ? "RemoveListenerCertificates" : "AddListenerCertificates";
            aws.queryELB2(action, req, next);
        },
    ], callback);
}

shell.cmdAwsCreateCert = function(options, callback)
{
    var domain = shell.getArg("-domain", options);
    if (!domain) return shell.exit("ERROR: -domain is required");

    var arn = shell.getArg("-arn", options);
    var elb = shell.getArg("-elb", options);
    var wait = shell.getArgInt("-wait", options, 900000);
    var cert, cname, ready;

    lib.series([
        function(next) {
            if (arn) return next();
            var req = {
                DomainName: domain,
                ValidationMethod: shell.isArg("-email") ? "EMAIL" : "DNS",
                IdempotencyToken: shell.getArg("-it", options, core.name),
            };
            if (shell.isArg("-star")) {
                req.SubjectAlternativeNames = ["*." + domain];
            }
            aws.queryACM("RequestCertificate", req, (err, rc) => {
                arn = rc?.CertificateArn;
                logger.dump("ARN:", domain, arn);
                setTimeout(next, 3000, err);
            });
        },
        function(next) {
            if (!arn.includes(":")) arn = `arn:aws:acm:${aws.region}:${aws.accountId}:certificate/${arn}`;
            var s = Date.now();

            lib.doWhilst(
                function(next2) {
                    aws.queryACM("DescribeCertificate", { CertificateArn: arn }, (err, rc) => {
                        cert = rc?.Certificate;
                        if (!err && cert) {
                            cname = cert.DomainValidationOptions.
                                filter((x) => (x.DomainName == domain && x.ValidationMethod == "DNS")).
                                map((x) => (x.ResourceRecord))[0];
                        }
                        setTimeout(next2, err || cname ? 0 : 5000, err);
                    });
                },
                function() {
                    return !cname && Date.now() - s < wait
                },
                next, true);
        },
        function(next) {
            if (!cname) return next();
            logger.dump("DNS:", cert.CertificateArn, cname);
            aws.route53Change({ name: cname.Name, type: cname.Type, value: cname.Value }, next);
        },
        function(next) {
            if (!cname) return next();

            var s = Date.now();
            lib.doWhilst(
                function(next2) {
                    aws.queryACM("DescribeCertificate", { CertificateArn: arn }, (err, rc) => {
                        cert = rc?.Certificate;
                        if (!err && cert) {
                            ready = cert.DomainValidationOptions.filter((x) => (x.ValidationStatus == 'SUCCESS')).length;
                        }
                        setTimeout(next2, err || ready ? 0 : 30000, err);
                    });
                },
                function() {
                    return !ready && Date.now() - s < wait
                },
                next, true);
        },
        function(next) {
            if (!ready || !elb) {
                if (!cname) return next();
                return shell.exit(`TIMEOUT: rerun again as:`, `bksh -no-db -aws-create-cert -domain ${domain} -elb ${elb} -arn ${arn.split("/").pop()}`);
            }
            shell.awsManageCert({ arn: cert.CertificateArn, elb: elb }, next);
        },
    ], (err) => {
        shell.exit(err, cert);
    });
}

shell.cmdAwsDelCert = function(options, callback)
{
    var arn = shell.getArg("-arn", options);
    if (!arn) return shell.exit("ERROR: -arn is required");
    if (!arn.includes(":")) arn = `arn:aws:acm:${aws.region}:${aws.accountId}:certificate/${arn}`;

    aws.queryACM("DescribeCertificate", { CertificateArn: arn }, shell.exit);
}

// Update a Route53 record with IP/names of all instances specified by the filter or with manually provided values
shell.cmdAwsSetRoute53 = function(options)
{
    var name = shell.getArg("-domain", options);
    if (!name) return shell.exit("ERROR: -domain must be specified and must be a full host name")
    var current = this.isArg("-current", options);
    var filter = shell.getArg("-filter", options);
    var values = lib.strSplit(shell.getArg("-value", options));
    var type = shell.getArg("-type", options, "A");

    lib.series([
        function(next) {
            if (current || !filter) return next();
            var public = shell.isArg("-public", options);
            var req = { stateName: "running", tagName: filter };
            aws.ec2DescribeInstances(req, (err, list) => {
                if (err) return next(err);''
                values = list.map((x) => {
                    switch (type) {
                    case "A":
                        return public ? x.ipAddress || x.publicIpAddress : x.privateIpAddress;
                    case "CNAME":
                        return public ? x.publicDnsName : x.privateDnsName;
                    }
                    return 0;
                }).filter((x) => (x));
                next();
            });
        },
        function(next) {
            var host = lib.toTemplate(name, core.instance);
            if (current) {
                console.log("CHANGE:", name, host, values, core.ipaddr);
                if (shell.isArg("-dry-run", options)) return next();
                return aws.route53Change(host, next);
            }
            var ttl = shell.getArg("-ttl", options);
            var op = shell.getArg("-op", options);
            var alias = shell.getArg("-alias", options);
            var zoneId = shell.getArg("-zoneId", options);
            if (!values.length && !alias) return next();
            var rr = { op: op, name: host, type: type, ttl: ttl, value: values, alias: alias, zoneId: zoneId }
            console.log("CHANGE:", name, rr);
            if (shell.isArg("-dry-run", options)) return next();
            aws.route53Change(rr, next);
       },
    ], shell.exit);
}

shell.cmdAwsListRoute53 = function(options)
{
    aws.route53List((err, zones) => {
        for (const z of zones) console.log(z.Id, z.Name.slice(0, -1), z.ResourceRecordSetCount);
        shell.exit(err);
    });
}

shell.cmdAwsGetRoute53 = function(options)
{
    aws.route53Get({ zone: shell.getArg("-zone", options), name: shell.getArg("-domain", options) }, (err, rc) => {
        var zone = rc?.GetHostedZoneResponse?.HostedZone?.Id;
        if (zone) {
            shell.log(rc.GetHostedZoneResponse);
        }
        if (!zone || !this.isArg("-rrset")) return shell.exit(err);

        aws.queryRoute53("GET", `${zone}/rrset`, "", (err, rc) => {
            if (!err) {
                lib.objGet(rc, "ListResourceRecordSetsResponse.ResourceRecordSets.ResourceRecordSet", { list: 1 }).forEach((x) => {
                    if (x.ResourceRecords?.ResourceRecord?.Value) {
                        x.ResourceRecords = x.ResourceRecords.ResourceRecord.Value;
                    } else
                    if (Array.isArray(x.ResourceRecords?.ResourceRecord)) {
                        x.ResourceRecords = x.ResourceRecords.ResourceRecord.map((x) => (x.Value));
                    }
                    shell.log(x);
                });
            }
            shell.exit(err);
        });
    });
}

// Create a new domain if does not exist, assign an ELB alias to a hosted zone
shell.cmdAwsCreateRoute53 = function(options)
{
    var name = shell.getArg("-domain", options);
    if (!name) return shell.exit("ERROR: -domain must be specified")
    var elb = shell.getArg("-elb", options);
    if (!elb) return shell.exit("ERROR: -elb is required");
    var dnsname, hostedzone, zoneId;

    lib.series([
        function(next) {
            aws.route53Get({ name: name }, (err, rc) => {
                hostedzone = rc?.GetHostedZoneResponse?.HostedZone?.Id;
                if (rc) shell.log(rc.GetHostedZoneResponse);
                next(err);
            });
        },
        function(next) {
            if (hostedzone) return next();
            if (shell.isArg("-dry-run", options)) return next();
            aws.route53Create({ name: name }, (err, rc) => {
                hostedzone = rc?.CreateHostedZoneResponse?.HostedZone?.Id;
                if (!err) shell.log(rc?.CreateHostedZoneResponse);
                next(err);
            });
        },
        function(next) {
            aws.queryELB2("DescribeLoadBalancers", { "Names.member.1": elb }, (err, rc) => {
                var b = rc?.DescribeLoadBalancersResponse?.DescribeLoadBalancersResult?.LoadBalancers?.member;
                dnsname = b?.DNSName;
                zoneId = b?.CanonicalHostedZoneId;
                next(err);
            });
        },
        function(next) {
            console.log("CHANGE:", name, hostedzone, elb, dnsname, zoneId);
            if (shell.isArg("-dry-run", options)) return next();
            aws.route53Change({ hostedzone: hostedzone, name: name, alias: dnsname, zoneId: zoneId }, next);
        },
    ], shell.exit);
}
