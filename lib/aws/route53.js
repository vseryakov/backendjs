//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const logger = require(__dirname + '/../logger');
const core = require(__dirname + '/../core');
const lib = require(__dirname + '/../lib');
const aws = require(__dirname + '/../aws');

// Make a request to Route53 service
aws.queryRoute53 = function(method, path, data, options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    var headers = { "content-type": "text/xml; charset=UTF-8" };
    var opts = this.queryOptions(method, data, headers, options);
    opts.region = 'us-east-1';
    opts.endpoint = "route53";
    opts.signer = this.querySigner;
    this.httpGet("https://route53.amazonaws.com/2013-04-01" + path, opts, function(err, params) {
        aws.parseXMLResponse(err, params, options, callback);
    });
}

// List all zones
aws.route53List = function(options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    var marker, zones = [];
    lib.doWhilst(
        function(next) {
            aws.queryRoute53("GET", "/hostedzone" + (marker ? "?marker=" + marker : ""), "", (err, rc) => {
                if (err) return next(err);
                zones.push.apply(zones, lib.objGet(rc, "ListHostedZonesResponse.HostedZones.HostedZone", { list: 1 }));
                marker = lib.objGet(rc, "ListHostedZonesResponse.NextMarker");
                next();
           });
       },
       function() {
           return marker;
       },
       function(err) {
           callback(err, zones);
       });
}

// Return a zone by domain or id
aws.route53Get = function(options, callback)
{
    if (options.zone) {
        aws.queryRoute53("GET", "/hostedzone/" + options.zone, "", callback);
    } else
    if (typeof options.name == "string") {
        var name = options.name + ".";
        aws.route53List((err, zones) => {
            var zone = zones.filter((x) => (x.Name == name)).pop();
            if (!zone) return callback(err, zone);
            aws.queryRoute53("GET", zone.Id, "", callback);
        });
    } else {
        callback();
    }
}

// Create or update a host in the Route53 database.
// - `names` is a host name to be set with the current IP address or a list with objects in the format
//       [ { name: "..", value: "1.1.1.1", type: "A", ttl: 300 } ...]
//
// The `options` may contain the following:
//  - type - default record type, A
//  - ttl - default TTL, 300 seconds
//  - op - an operation, default is UPSERT
aws.route53Change = function(names, options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    if (!Array.isArray(names)) names = [ names ];

    aws.route53List(function(err, zones) {
        lib.forEachSeries(names, function(host, next) {
            if (typeof host != "object") {
                host = { name: host, value: core.ipaddr };
            }
            var type = host.type || (options && options.type) || "A";
            var domain = lib.strSplit(host.name, ".").slice(1).join(".") + ".";
            var zoneId = zones.filter(function(x) { return x.Name == domain }).map(function(x) { return x.Id }).pop();
            if (!zoneId) {
                if (!options || !options.quiet) err = lib.newError("zone not found for " + host.name);
                return callback && callback(err);
            }
            var values = Array.isArray(host.value) ? host.value : [host.value];
            var alias = host.alias || (options && options.alias), req;
            if (alias) {
                req = '<?xml version="1.0" encoding="UTF-8"?>' +
                        '<ChangeResourceRecordSetsRequest xmlns="https://route53.amazonaws.com/doc/2013- 04-01/">' +
                        ' <ChangeBatch>' +
                        '  <Changes>' +
                        '   <Change>' +
                        '    <Action>' + (options && options.op || "UPSERT") + '</Action>' +
                        '    <ResourceRecordSet>' +
                        '     <Name>' + host.name + '</Name>' +
                        '     <Type>' + type + '</Type>' +
                        '     <AliasTarget>' +
                        '      <HostedZoneId>' + (host.zoneId || zoneId) + '</HostedZoneId>' +
                        '      <DNSName>' + alias + '</DNSName>' +
                        '      <EvaluateTargetHealth>' (host.healthCheck ? 'true' : 'false') + '</EvaluateTargetHealth>' +
                        '     </AliasTarget>' +
                        (options && options.healthCheckId ?
                        '     <HealthCheckId>' + options.healthCheckId + '</HealthCheckId>' : '') +
                        '    </ResourceRecordSet>' +
                        '   </Change>' +
                        '  </Changes>' +
                        ' </ChangeBatch>' +
                        '</ChangeResourceRecordSetsRequest>';
            } else {
                req = '<?xml version="1.0" encoding="UTF-8"?>' +
                        '<ChangeResourceRecordSetsRequest xmlns="https://route53.amazonaws.com/doc/2013-04-01/">' +
                        '<ChangeBatch>' +
                        ' <Changes>' +
                        '  <Change>' +
                        '   <Action>' + (options && options.op || "UPSERT") + '</Action>' +
                        '   <ResourceRecordSet>' +
                        '    <Name>' + host.name + '</Name>' +
                        '    <Type>' + type + '</Type>' +
                        '    <TTL>' + (host.ttl || (options && options.ttl) || 300) + '</TTL>' +
                        '    <ResourceRecords>' +
                        values.map(function(x) { return '<ResourceRecord><Value>' + x + '</Value></ResourceRecord>' }).join("") +
                        '    </ResourceRecords>' +
                        (options && options.healthCheckId ?
                             '<HealthCheckId>' + options.healthCheckId + '</HealthCheckId>' : '') +
                        '   </ResourceRecordSet>' +
                        '  </Change>' +
                        ' </Changes>' +
                        '</ChangeBatch>' +
                        '</ChangeResourceRecordSetsRequest>';
            }
            logger.dev("route53Change:", req);
            aws.queryRoute53("POST", zoneId + "/rrset", req, function(err, rc) {
                if (options && options.quiet) err = null;
                next(err);
            });
        }, callback, true);
    });
}

