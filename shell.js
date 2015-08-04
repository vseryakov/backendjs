//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var net = require('net');
var cluster = require('cluster');
var domain = require('domain');
var cron = require('cron');
var path = require('path');
var util = require('util');
var url = require('url');
var fs = require('fs');
var spawn = require('child_process').spawn;
var exec = require('child_process').exec;
var core = require(__dirname + '/core');
var lib = require(__dirname + '/lib');
var logger = require(__dirname + '/logger');
var db = require(__dirname + '/db');
var aws = require(__dirname + '/aws');
var ipc = require(__dirname + '/ipc');
var api = require(__dirname + '/api');
var app = require(__dirname + '/app');
var os = require('os');

var shell = {
    name: "shell",
}

module.exports = shell;

// Exit and write to the console a message or error message if non empty
shell.exit = function(err, msg)
{
    if (err) console.log(err);
    if (msg) console.log(msg);
    process.exit(err ? 1 : 0);
}

// Resolves a user from `obj.id` or `obj.login` params and return the record in the callback
shell.getUser = function(obj, callback)
{
    db.get("bk_account", { id: obj.id }, function(err, row) {
        if (err) exit(err);

        db.get("bk_auth", { login: row ? row.login : obj.login }, function(err, row) {
            if (err || !row) exit(err, "ERROR: no user found with this id: " + util.inspect(obj));
            callback(row);
        });
    });
}

// Returns an object with all command line params that do not start with dash(-), treat 2 subsequent parms without dashes as name value pair
shell.getQuery = function()
{
    var query = {};
    for (var i = process.argv.length - 1; i > 1; i -= 2) {
        var a = process.argv[i - 1][0], b = process.argv[i][0];
        if (a != '-' && b != '-') query[process.argv[i - 1]] = process.argv[i];
    }
    return query;
}

// Returns an object with all command line params starting with dash set with the value if the next param does not start with dash or 1,
// this is API query emulaton and only known API parameters will be set, all other config options must be handkled by each command separately
shell.getOptions = function()
{
    var query = {};
    for (var i = process.argv.length - 1; i > 1; i -= 2) {
        var a = process.argv[i - 1][0], b = process.argv[i][0];
        if (a == '-') query[process.argv[i - 1]] = b != '-' ? process.argv[i] : 1;
    }
    return api.getOptions({ query: query, options: { path: ["", "", ""], ops: {} } });
}

// Start REPL shell or execute any subcommand if specified in the command line.
// A subcommand may return special string to indicate how to treat the flow:
// - stop - stop processing commands and create REPL
// - continue - do not exit and continue processing other commands or end with REPL
// - all other values will result in returning from the run assuming the command will decide what to do, exit or continue running, no REPL is created
shell.run = function(options)
{
    var self = this;
    process.title = core.name + ": shell";

    logger.debug('startShell:', process.argv);

    core.runMethods("configureShell", options, function(err, opts) {
        if (opts.done) exit();

        for (var i = 1; i < process.argv.length; i++) {
            if (process.argv[i][0] != '-') continue;
            var name = lib.toCamel("cmd" + process.argv[i]);
            if (typeof self[name] != "function") continue;
            var rc = self[name](opts);
            if (rc == "stop") break;
            if (rc == "continue") continue;
            return;
        }
        ipc.initWorker();
        core.createRepl();
    });
}

// App version
shell.cmdShowInfo = function(options)
{
    var ver = core.appVersion.split(".");
    console.log('mode=' + core.runMode);
    console.log('name=' + core.appName);
    console.log('version=' + core.appVersion);
    console.log('major=' + (ver[0] || 0));
    console.log('minor=' + (ver[1] || 0));
    console.log('patch=' + (ver[2] || 0));
    console.log('ipaddr=' + core.ipaddr);
    console.log('network=' + core.network);
    console.log('subnet=' + core.subnet);
    console.log('domain=' + core.domain);
    this.exit();
}

// Run API server inside the shell
shell.cmdRunApi = function(options)
{
    api.init();
    return "continue";
}

// Add a user
shell.cmdAccountAdd = function(options)
{
    var self = this;
    if (!core.modules.accounts) exit("accounts module not loaded");
    var query = this.getQuery();
    var opts = this.getOptions();
    if (core.isArg("-scramble")) opts.scramble = 1;
    if (query.login && !query.name) query.name = query.login;
    core.modules.accounts.addAccount({ query: query, account: { type: 'admin' } }, opts, function(err, data) {
        self.exit(err, data);
    });
}

// Delete a user and all its history according to the options
shell.cmdAccountUpdate = function(options)
{
    var self = this;
    if (!core.modules.accounts) this.exit("accounts module not loaded");
    var query = this.getQuery();
    var opts = this.getOptions();
    if (core.isArg("-scramble")) opts.scramble = 1;
    this.getUser(query, function(row) {
        core.modules.accounts.updateAccount({ account: row, query: query }, opts, function(err, data) {
            self.exit(err, data);
        });
    });
}

// Delete a user and all its history according to the options
shell.cmdAccountDel = function(options)
{
    var self = this;
    if (!core.modules.accounts) this.exit("accounts module not loaded");
    var query = this.getQuery();
    var opts = {};
    for (var i = 1; i < process.argv.length - 1; i += 2) {
        if (process.argv[i] == "-keep") opts[process.argv[i + 1]] = 1;
    }
    this.getUser(query, function(row) {
        core.modules.accounts.deleteAccount(row.id, opts, function(err, data) {
            self.exit(err, data);
        });
    });
}

// Update location
shell.cmdLocationPut = function(options)
{
    var self = this;
    if (!core.modules.locations) this.exit("locations module not loaded");
    var query = this.getQuery();
    this.getUser(query, function(row) {
        core.modules.locations.putLocation({ account: row, query: query }, {}, function(err, data) {
            self.exit(err, data);
        });
    });
}

// Run logwatcher and exit
shell.cmdLogWatch = function(options)
{
    var self = this;
    core.watchLogs(function(err) {
        self.exit(err);
    });
}

// Show all config parameters
shell.cmdDbGetConfig = function(options)
{
    var self = this;
    var opts = this.getQuery();
    var sep = core.getArg("-separator", "=");
    var fmt = core.getArg("-format");
    db.initConfig(opts, function(err, data) {
        if (fmt == "text") {
            for (var i = 0; i < data.length; i += 2) console.log(data[i].substr(1) + (sep) + data[ i + 1]);
        } else {
            console.log(JSON.stringify(data));
        }
        self.exit(err);
    });
}

// Show all tables
shell.cmdDbTtables = function(options)
{
    var sep = core.getArg("-separator", "\n");
    var tables = db.getPoolTables(db.pool, { names: 1 });
    console.log(tables.join(sep));
    this.exit(err);
}

// Show record that match the search criteria, return up to `-count N` records
shell.cmdDbSelect = function(options)
{
    var self = this;
    var query = this.getQuery();
    var opts = this.getOptions();
    var table = core.getArg("-table");
    var sep = core.getArg("-separator", "!");
    var fmt = core.getArg("-format");
    var cols = Object.keys(db.getColumns(table))
    db.select(table, query, opts, function(err, data) {
        if (data && data.length) {
            if (fmt == "text") {
                data.forEach(function(x) { console.log((cols || Object.keys(x)).map(function(y) { return x[y] }).join(sep)) });
            } else {
                data.forEach(function(x) { console.log(JSON.stringify(x)) });
            }
        }
        self.exit(err);
    });
}

// Show all records that match search criteria
shell.cmdDbScan = function(options)
{
    var self = this;
    var query = this.getQuery();
    var opts = this.getOptions();
    var table = core.getArg("-table");
    var sep = core.getArg("-separator", "!");
    var fmt = core.getArg("-format");
    var cols = Object.keys(db.getColumns(table));
    db.scan(table, query, opts, function(row, next) {
        if (fmt == "text") {
            console.log((cols || Object.keys(row)).map(function(y) { return row[y] }).join(sep));
        } else {
            console.log(JSON.stringify(row));
        }
        next();
    }, function(err) {
        self.exit(err);
    });
}

// Save all tables to the specified directory or the server home
shell.cmdDbBackup = function(options)
{
    var self = this;
    var opts = this.getOptions();
    var query = this.getQuery();
    var root = core.getArg("-path");
    var filter = core.getArg("-filter");
    var tables = lib.strSplit(core.getArg("-tables"));
    if (!tables.length) tables = db.getPoolTables(db.pool, { names: 1 });
    lib.forEachSeries(tables, function(table, next) {
        file = path.join(root, table +  ".json");
        fs.writeFileSync(file, "");
        db.scan(table, query, opts, function(row, next2) {
            if (filter && app[filter]) app[filter](table, row);
            fs.appendFileSync(file, JSON.stringify(row) + "\n");
            next2();
        }, next);
    }, function(err) {
        logger.info("dbBackup:", root, tables, opts);
        self.exit(err);
    });
}

// Restore tables
shell.cmdDbRestore = function(options)
{
    var self = this;
    var opts = this.getOptions();
    var root = core.getArg("-path");
    var filter = core.getArg("-filter");
    var tables = lib.strSplit(core.getArg("-tables"));
    var files = lib.findFileSync(root, { depth: 1, types: "f", include: /\.json$/ });
    if (core.isArg("-drop")) opts.drop = 1;
    if (core.isArg("-continue")) opts.continue = 1;
    opts.errors = 0;
    lib.forEachSeries(files, function(file, next3) {
        var table = path.basename(file, ".json");
        if (tables.length && tables.indexOf(table) == -1) return next3();
        var cap = db.getCapacity(table);
        opts.readCapacity = cap.readCapacity;
        opts.writeCapacity = cap.writeCapacity;
        lib.series([
            function(next) {
                if (!opts.drop) return next();
                db.drop(table, opts, next);
            },
            function(next) {
                if (!opts.drop) return next();
                setTimeout(next, opts.timeout || 500);
            },
            function(next) {
                if (!opts.drop) return next();
                db.create(table, db.getTableProperties(table, opts), opts, next);
            },
            function(next) {
                if (!opts.drop) return next();
                setTimeout(next, options.timeout || 500);
            },
            function(next) {
                if (!opts.drop) return next();
                db.cacheColumns(opts, next);
            },
            function(next) {
                lib.forEachLine(file, opts, function(line, next2) {
                    var row = lib.jsonParse(line, { error: 1 });
                    if (!row) return next2(opts.continue ? null : "ERROR: parse error, line: " + opts.lines);
                    if (filter && app[filter]) app[filter](table, row);
                    db.put(table, row, opts, function(err) {
                        if (err && !opts.continue) return next2(err);
                        if (err) opts.errors++;
                        db.checkCapacity(cap, next2);
                    });
                }, next);
            }], next3);
    }, function(err) {
        logger.info("dbRestore:", root, tables || files, opts);
        self.exit(err);
    });
}

// Put config entry
shell.cmdDbGet = function(options)
{
    var self = this;
    var query = this.getQuery();
    var opts = this.getOptions();
    var table = core.getArg("-table");
    var sep = core.getArg("-separator", "!");
    var fmt = core.getArg("-format");
    var cols = Object.keys(db.getColumns(table))
    db.get(table, query, opts, function(err, data) {
        if (data) {
            if (fmt == "text") {
                console.log((cols || Object.keys(data)).map(function(y) { return x[y] }).join(sep))
            } else {
                console.log(JSON.stringify(data));
            }
        }
        self.exit(err);
    });
}

// Put config entry
shell.cmdDbPut = function(options)
{
    var self = this;
    var query = this.getQuery();
    var opts = this.getOptions();
    var table = core.getArg("-table");
    db.put(table, query, opts, function(err, data) {
        self.exit(err);
    });
}

// Delete a recprd
shell.cmdDbDel = function(options)
{
    var self = this;
    var query = this.getQuery();
    var opts = this.getOptions();
    var table = core.getArg("-table");
    db.del(table, query, opts, function(err, data) {
        self.exit(err);
    });
}

// Delete all records
shell.cmdDbDelAll = function(options)
{
    var self = this;
    var query = this.getQuery();
    var opts = this.getOptions();
    var table = core.getArg("-table");
    db.delAll(table, query, opts, function(err, data) {
        self.exit(err);
    });
}

// Drop a table
shell.cmdDbDrop = function(options)
{
    var self = this;
    var opts = this.getOptions();
    var table = core.getArg("-table");
    db.drop(table, opts, function(err, data) {
        self.exit(err);
    });
}

// Send API request
shell.cmdSendRequest = function(options)
{
    var self = this;
    var query = this.getQuery();
    var url = core.getArg("-url");
    var id = core.getArg("-id");
    var login = core.getArg("-login");
    this.getUser({ id: id, login: login }, function(row) {
        core.sendRequest({ url: url, login: row.login, secret: row.secret, query: query }, function(err, params) {
            self.exit(err, params.obj);
        });
    });
}

// Check all arguments starting with the second for matching tags
function checkTags(obj)
{
    var tags = lib.objGet(obj, "tagSet.item", { list: 1 });
    for (var i = 1; i < arguments.length; i++) {
        var name = arguments[i].toLowerCase();
        if (tags.some(function(t) { return t.key == "Name" && t.value.toLowerCase().split("-")[0] == name.toLowerCase(); })) return true;
    }
    return false;
}

// Auto detect subnets by name or mode
function getSubnets(subnets, zone)
{
    return subnets.filter(function(x) {
        if (zone && zone != x.availabilityZone.split("-").pop()) return 0;
        return checkTags(x, subnetName, mode);
    }).map(function(x) {
        return x.subnetId;
    });
}

function getInstances(rc)
{
    var list = lib.objGet(rc, "DescribeInstancesResponse.reservationSet.item", { obj: 1 });
    list = lib.objGet(list, "instancesSet.item", { list: 1 });
    list.forEach(function(x) {
        x.name = lib.objGet(x, "tagSet.item", { list: 1 }).filter(function(x) { return x.key == "Name" }).map(function(x) { return x.value }).pop();
    });
    return list;
}

// Find group ids from the given group name(s)
function getGroups(name, next)
{
    var req = aws.vpcId ? { "Filter.1.Name": "vpc-id", "Filter.1.Value": aws.vpcId } : {};
    aws.queryEC2("DescribeSecurityGroups", req, function(err, rc) {
        if (err) return next(err);
        var groups = lib.objGet(rc, "DescribeSecurityGroupsResponse.securityGroupInfo.item", { list: 1 });
        // Find a groups by run name
        groups.forEach(function(x) {
            if (name.some(function(y) { return x.groupName.toLowerCase() == y || checkTags(x, y); })) groupId.push(x.groupId);
        });
        next(null, groups);
    });
}

// Retrieve all AMIs for the current name
function getImages(name, next)
{
    aws.queryEC2("DescribeImages", { 'Owner.0': 'self', 'Filter.1.Name': 'name', 'Filter.1.Value': name }, function(err, rc) {
        if (err) return next(err);
        var images = lib.objGet(rc, "DescribeImagesResponse.imagesSet.item", { list: 1 });
        // Sort by version in descending order
        images.sort(function(a, b) { return a.name > b.name ? -1 : a.name < b.name ? 1 : 0; });
        next(null, images);
    });
}

// Return amazon amis for the current region, HVM type
function getAmazonAmis(next)
{
    aws.queryEC2("DescribeImages",
                 { 'Owner.0': 'amazon',
                   'Filter.1.Name': 'name', 'Filter.1.Value': 'amzn-ami-hvm-*',
                   'Filter.2.Name': 'architecture', 'Filter.2.Value': 'x86_64',
                   'Filter.3.Name': 'root-device-type', 'Filter.3.Value': 'ebs',
                 }, function(err, rc) {
        if (err) return next(err);
        var images = lib.objGet(rc, "DescribeImagesResponse.imagesSet.item", { list: 1 });
        images.sort(function(a, b) { return a.name < b.name ? 1 : a.name > b.name ? -1 : 0 });
        next(null, images);
    });
}

// Wait until instance count
function getElbCount(name, equal, total, next)
{
    var running = 1, count = 0, expires = Date.now() + timeout * 1000

    lib.doWhilst(
        function(next2) {
            aws.queryELB("DescribeInstanceHealth", { LoadBalancerName: name }, function(err, rc) {
                if (err) return next2(err);
                count = lib.objGet(rc, "DescribeInstanceHealthResponse.DescribeInstanceHealthResult.InstanceStates.member", { list: 1 }).filter(function(x) { return x.State == "InService"}).length;
                logger.log("getElbCount:", name, "checking(" + (equal ? "=" : "<>") + "):", "in-service", count, "out of", total);
                if (equal) {
                    running = total == count && Date.now() < expires;
                } else {
                    running = total != count && Date.now() < expires;
                }
                setTimeout(next2, running ? interval*1000 : 0);
            });
        },
        function() {
            return running;
        },
        function(err) {
            next(err, total, count);
        });
}

// Delete an AMI with the snapshot
shell.deleteAmi = function(callback)
{
    core.init(function() {
        lib.series([
           function(next) {
               if (imageId) return next();
               getImages(amiName + '*', next);
           },
           function(next) {
               if (imageId) return next();
               // Exact image by name and version
               imageId = images.filter(function(x) { return x.name == amiName + '-' + amiVersion }).map(function(x) { return x.imageId }).pop();
               // Take the latest image and set actual version
               if (!imageId && images.length) {
                   imageId = images[0].imageId;
                   amiName = images[0].name.split("-")[0];
                   amiVersion = images[0].name.split("-").slice(1).join("-");
               }
               next();
           },
           // Deregister existing image with the same name in the destination region
           function(next) {
               logger.log("DeregisterImage:", aws.region, amiName, amiVersion, imageId);
               if (core.isArg("-dry-run")) return next();
               aws.ec2DeregisterImage(imageId, { snapshots: 1 }, next);
           },
           ], callback);
    });
}

// Launch instances by run mode and/or other criteria
shell.launchInstances = function(callback)
{
    core.init(function() {
        // Replace current region to be consistent with the rest of the commands, this is the same as -aws-region
        if (region) aws.region = region;
        if (count <= 0) count = 1;
        var alarms = [];

        lib.series([
           function(next) {
               if (imageId) return next();
               getImages(amiName + '*', next);
           },
           function(next) {
               if (imageId) return next();
               // Exact name or the latest version
               imageId = images.filter(function(x) { return x.name == amiName + '-' + amiVersion }).map(function(x) { return x.imageId }).pop();
               if (!imageId && images.length) imageId = images[0].imageId;
               next();
           },
           function(next) {
               if (subnetId) return next();
               var req = vpcId ? { "Filter.1.Name": "vpc-id", "Filter.1.Value": vpcId } : {};
               aws.queryEC2("DescribeSubnets", req, function(err, rc) {
                   subnets = lib.objGet(rc, "DescribeSubnetsResponse.subnetSet.item", { list: 1 });
                   next(err);
               });
           },
           function(next) {
               if (groupId.length) return next();
               getGroups(next);
           },
           function(next) {
               // Verify load balancer name
               if (!elbName) return next();
               aws.queryELB("DescribeLoadBalancers", {}, function(err, rc) {
                   if (err) return next(err);
                   elbs = lib.objGet(rc, "DescribeLoadBalancersResponse.DescribeLoadBalancersResult.LoadBalancerDescriptions.member", { list: 1 });
                   if (!elbs.some(function(x) { return x.LoadBalancerName == mode })) elbName = "";
                   next();
               });
           },
           function(next) {
               // Create CloudWatch alarms, production must have alerts setup
               if (!core.isArg("-alerts") && mode != "production") return next();
               aws.snsListTopics(function(err, topics) {
                   var topic = new RegExp(core.getArg("-alerts", "alerts"), "i");
                   topic = topics.filter(function(x) { return x.match(topic); }).pop();
                   if (!topic) return next(err);
                   alarms.push({ metric:"CPUUtilization", threshold:cpuThreshold, evaluationPeriods:period, alarm:topic });
                   alarms.push({ metric:"NetworkOut", threshold:netThreshold, evaluationPeriods:period, alarm:topic });
                   alarms.push({ metric:"StatusCheckFailed", threshold:1, evaluationPeriods:5, statistic: "Maximum", alarm:topic });
                   next(err);
               });
           },
           function(next) {
               // No data, assume webapp image which accepts Java properties and need the run mode
               userData = userData.replace(/^['"]+|['"]+$/g, "");
               if (userData[0] != "#") {
                   userData += " -Drun.mode=" + mode;
                   lib.strSplit(appName).forEach(function(x) {
                       if (x) userData += " -jar " + x + (version ? "-" + version : "") + ".jar";
                   });
               }
               if (subnetId) {
                   subnets.push(subnetId);
               } else
               // All subnets will have same amount of instances
               if (core.isArg("-all-subnets")) {
                   subnets = getSubnets();
               } else
               // Spread all instances between all subnets
               if (core.isArg("-spread-subnets")) {
                   subnets = getSubnets();
                   if (count <= subnets.length) {
                       subnets = subnets.slice(0, count);
                   } else {
                       var n = subnets.length;
                       for (var i = count - n; i > 0; i--) subnets.push(subnets[i % n]);
                   }
                   count = 1;
               } else {
                   // Random subnet
                   subnets = getSubnets();
                   subnets = [ subnets[lib.randomInt(0, subnets.length - 1)] ];
               }

               if (!imageId || !subnets.length) return next2("ERROR: AMI and subnet must be specified or discovered by run mode");

               lib.forEachLimit(subnets, subnets.length, function(subnet, next2) {
                   var req = { count: count, instanceType: instanceType, imageId: imageId, subnetId: subnet,
                               keyName: keyName, elbName: elbName, groupId: groupId, iamProfile: iamProfile,
                               data: userData, terminate: 1, name: tagName, alarms: alarms };
                   logger.log("RunInstances:", req);
                   if (core.isArg("-dry-run")) return next2();

                   aws.ec2RunInstances(req, function(err, rc) {
                       if (err) return next2(err);
                       instances = instances.concat(lib.objGet(rc, "RunInstancesResponse.instancesSet.item", { list: 1 }));
                       next2();
                   });
               }, next);
           },
           function(next) {
               if (instances.length) logger.log(instances.map(function(x) { return [ x.instanceId, x.privateIpAddress || "" ] }));
               if (!core.isArg("-wait")) return next();
               if (instances.length != 1) return next();
               aws.ec2WaitForInstance(instances[0].instanceId, "running", { waitTimeout: timeout*1000, waitDelay: interval*1000 }, next);
           },
           ], callback);
    });
}

// Reboot instances by run mode and/or other criteria
shell.cmdAwsRebootInstances = function(callback)
{
    var instances = [];
    var count = core.getArgInt("-count");
    var filter = core.getArg("-filter");
    if (!filter) shell.exit("-filter is required");

    lib.series([
       function(next) {
           var req = { "Filter.1.Name": "instance-state-name", "Filter.1.Value.1": "running", "Filter.2.Name": "tag:Name", "Filter.2.Value.1": filter };
           logger.debug("RebootInstances:", req)
           aws.queryEC2("DescribeInstances", req, function(err, rc) {
               instances = getInstances(rc).map(function(x) { return x.instanceId });
               next(err);
           });
       },
       function(next) {
           if (!instances.length) exit("No instances found");
           var req = {};
           instances.forEach(function(x, i) { req["InstanceId." + (i + 1)] = x });
           logger.log("RebootInstances:", req)
           if (core.isArg("-dry-run")) return next();
           aws.queryEC2("RebootInstances", req, next);
       },
       ], callback);
}

// Terminate instances by run mode and/or other criteria
shell.cmdAwsTerminateInstances = function(callback)
{
    var instances = [];
    var count = core.getArgInt("-count");
    var filter = core.getArg("-filter");
    if (!filter) shell.exit("-filter is required");

    lib.series([
       function(next) {
           var req = { "Filter.1.Name": "instance-state-name", "Filter.1.Value.1": "running", "Filter.2.Name": "tag:Name", "Filter.2.Value.1": filter };
           logger.debug("terminateInstances:", req)
           aws.queryEC2("DescribeInstances", req, function(err, rc) {
               instances = getInstances(rc).map(function(x) { return x.instanceId });
               if (count) instances = instances.slice(0, count);
               next(err);
           });
       },
       function(next) {
           if (!instances.length) exit("No instances found");
           var req = {};
           instances.forEach(function(x, i) { req["InstanceId." + (i + 1)] = x });
           logger.log("TerminateInstances:", req)
           if (core.isArg("-dry-run")) return next();
           aws.queryEC2("TerminateInstances", req, next);
       },
       ], callback);
}

// Show running instances by run mode and/or other criteria
shell.cmdAwsShowInstances = function(callback)
{
    var instances = [];
    var ip = core.isArg("-ip");
    var filter = core.getArg("-filter");

    lib.series([
       function(next) {
           var req = { "Filter.1.Name": "tag:Name", "Filter.1.Value.1": filter || "*",
                       "Filter.2.Name": "instance-state-name", "Filter.2.Value.1": "running", }
           logger.debug("showInstances:", req);
           aws.queryEC2("DescribeInstances", req, function(err, rc) {
               instances = getInstances(rc);
               next(err);
           });
       },
       function(next) {
           if (ip) {
               console.log(instances.map(function(x) { return x.privateIpAddress }).join(" "));
           } else {
               instances.forEach(function(x) { console.log(x.instanceId, x.privateIpAddress, x.name); });
           }
           next();
       },
       ], callback);
}

// Check ELB for running instances
shell.checkElb = function(callback)
{
    core.init(function() {
        if (region) aws.region = region;

        lib.series([
           function(next) {
               aws.queryELB("DescribeInstanceHealth", { LoadBalancerName: elbName }, function(err, rc) {
                   if (err) return next(err);
                   instances = lib.objGet(rc, "DescribeInstanceHealthResponse.DescribeInstanceHealthResult.InstanceStates.member", { list: 1 });
                   next();
               });
           },
           function(next) {
               var req = {};
               instances.forEach(function(x, i) { req["InstanceId." + (i + 1)] = x.InstanceId });
               aws.queryEC2("DescribeInstances", req, function(err, rc) {
                   var list = getInstances(rc);
                   list.forEach(function(row) {
                       instances.forEach(function(x) {
                           if (x.InstanceId == row.instanceId) x.name = row.name;
                       });
                   });
                   next(err);
               });
           },
           function(next) {
               if (core.isArg("-dry-run")) logger.log(instances);
               // Show all instances or only for the specified version
               instances = instances.filter(function(x) {
                   return (x.name && x.State == 'InService' && (!version || x.name.match("-" + version + "$")));
               });
               instances.forEach(function(x) { logger.log(Object.keys(x).map(function(y) { return x[y] }).join(" | ")) });
               next();
           },
           ], callback);
    });
}

// Reboot instances in the ELB, one by one
shell.rebootElb = function(callback)
{
    var total = 0;
    if (!elbName) exit("ERROR: -elb-name must be specified")

    core.init(function() {
        if (region) aws.region = region;

        lib.series([
           function(next) {
               aws.queryELB("DescribeInstanceHealth", { LoadBalancerName: elbName }, function(err, rc) {
                   if (err) return next(err);
                   instances = lib.objGet(rc, "DescribeInstanceHealthResponse.DescribeInstanceHealthResult.InstanceStates.member", { list: 1 }).filter(function(x) { return x.State == "InService" });
                   total = instances.length;
                   next();
               });
           },
           function(next) {
               // Reboot first instance
               if (!instances.length) return next();
               var req = { "InstanceId.1": instances[0].InstanceId };
               instances.shift();
               logger.log("RebootELB:", elbName, "restarting:", req)
               if (core.isArg("-dry-run")) return next();
               aws.queryEC2("RebootInstances", req, next);
           },
           function(next) {
               // Wait until one instance is out of service
               getElbCount(1, total, next);
           },
           function(next) {
               // Wait until all instances in service again
               getElbCount(0, total, next);
           },
           function(next) {
               // Reboot the rest
               if (!instances.length) return next();
               var req = {};
               instances.forEach(function(x, i) { req["InstanceId." + (i + 1)] = x.InstanceId });
               logger.log("RebootELB:", elbName, 'restarting:', req)
               if (core.isArg("-dry-run")) return next();
               aws.queryEC2("RebootInstances", req, next);
           },
           ], callback);
    });
}

// Deploy new version in the ELB, terminate the old version
shell.replaceElb = function(callback)
{
    var total = 0, oldInstances = [], newInstances = [], oldInService = [];
    if (!elbName) exit("ERROR: -elb-name must be specified")

    core.init(function() {
        if (region) aws.region = region;

        lib.series([
           function(next) {
               aws.queryELB("DescribeInstanceHealth", { LoadBalancerName: elbName }, function(err, rc) {
                   if (err) return next(err);
                   oldInstances = lib.objGet(rc, "DescribeInstanceHealthResponse.DescribeInstanceHealthResult.InstanceStates.member", { list: 1 });
                   oldInService = oldInstances.filter(function(x) { return x.State == "InService" });
                   next();
               });
           },
           function(next) {
               logger.log("ReplaceELB:", elbName, 'running:', oldInstances)
               // Launch new instances
               shell.launchInstances(next);
           },
           function(next) {
               newInstances = instances;
               if (core.isArg("-dry-run")) return next();
               // Wait until all instances are online
               getElbCount(0, oldInService.length + newInstances.length, function(err, total, count) {
                   if (!err && count != total) err = "Timeout waiting for instances";
                   next(err);
               })
           },
           function(next) {
               // Terminate old instances
               if (!oldInstances.length) return next();
               var req = {};
               oldInstances.forEach(function(x, i) { req["InstanceId." + (i + 1)] = x.InstanceId });
               logger.log("ReplaceELB:", elbName, 'terminating:', req)
               if (core.isArg("-dry-run")) return next();
               aws.queryEC2("TerminateInstances", req, next);
           },
           ], callback);
    });
}

// Open/close SSH access to the specified group for the current external IP address
shell.cmdAwsSetupSsh = function(callback)
{
    core.init(function() {
        var ip = "";

        lib.series([
           function(next) {
               getGroups(next);
           },
           function(next) {
               if (!groupId.length) return next("No group is found for", groupName);
               core.httpGet("http://checkip.amazonaws.com", function(err, params) {
                   if (err || params.status != 200) return next(err || params.data || "Cannot determine IP address");
                   ip = params.data.trim();
                   next();
               });
           },
           function(next) {
               var req = { GroupId: groupId[0],
                           "IpPermissions.1.IpProtocol": "tcp",
                           "IpPermissions.1.FromPort": 22,
                           "IpPermissions.1.ToPort": 22,
                           "IpPermissions.1.IpRanges.1.CidrIp": ip + "/32" };
               logger.log(req);
               if (core.isArg("-dry-run")) return next();
               aws.queryEC2(core.isArg("-close") ? "RevokeSecurityGroupIngress" : "AuthorizeSecurityGroupIngress", req, next);
           },
           ], callback);
    });
}

// Launch an instance and setup it with provisioning script
shell.AwsSetupInstance = function(callback)
{
    var images = [];

    var file = core.getArg("-file");

    lib.series([
       function(next) {
           if (aws.imageId) return next();
           getAmazonAmis(function(err, list) {
               if (list) images = list;
               next(err);
           });
       },
       function(next) {
           if (aws.imageId) return next();
           if (images.length) aws.imageId = images[0].imageId;
           next(aws.imageId ? null : "Cannot find Amazon AMI to launch");
       },
       function(next) {
           if (!file) return next();
           userData = "#cloud-config\n" +
                       "write_files:\n" +
                       "  - encoding: b64\n" +
                       "    content: " + Buffer(lib.readFileSync(file)).toString("base64") + "\n" +
                       "    path: /tmp/app.sh\n" +
                       "    owner: ec2-user:root\n" +
                       "    permissions: '0755'\n" +
                       "runcmd:\n" +
                       "  - /tmp/app.sh\n";
           shell.launchInstances(next);
       },
       ], callback);
}

shell.cmdAwsShowImages = function(name, callback)
{
    getImages(name + "*", function(err) {
        images.forEach(function(x) {
            console.log(x.imageId, x.name);
        });
        callback(err);
    });
}

// Get file
shell.cmdAwsS3Get = function(options)
{
    var self = this;
    var query = this.getQuery();
    var file = core.getArg("-file");
    var uri = core.getArg("-path");
    query.file = file || uri.split("?")[0].split("/").pop();
    aws.s3GetFile(uri, query, function(err, data) {
        self.exit(err, data);
    });
}

// Put file
shell.cmdAwsS3Put = function(options)
{
    var self = this;
    var query = this.getQuery();
    var path = core.getArg("-path");
    var uri = core.getArg("-file");
    aws.s3PutFile(uri, file, query, function(err, data) {
        self.exit(err, data);
    });
}

