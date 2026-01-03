/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const logger = require(__dirname + '/../logger');
const app = require(__dirname + '/../app');
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
    this.fetch("https://route53.amazonaws.com/2013-04-01" + path, opts, (err, params) => {
        aws.parseXMLResponse(err, params, options, callback);
    });
}

aws.queryRoute53Domains = function(action, obj, options, callback)
{
    aws.queryService("route53domains", "Route53Domains_v20140515", action, obj, options, callback);
}

aws.route53Create = function(options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    var req = `<CreateHostedZoneRequest xmlns="https://route53.amazonaws.com/doc/2013-04-01/">
               <CallerReference>${Date.now()}</CallerReference>
               <Name>${options.name}</Name>
               </CreateHostedZoneRequest>`;

    aws.queryRoute53("POST", "/hostedzone", req, callback);
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

/**
 * Create or update a host in the Route53 database.
 * - `names` is a host name to be set with the current IP address or a list with objects in the format
 *       [ { name: "..", value: "1.1.1.1", type: "A", ttl: 300, zoneId: "Id", alias: "dnsname", hostedzone: "/hostedzone/id" } ...]
 *
 * The `options` may contain the following:
 *  - type - default record type, A
 *  - ttl - default TTL, 300 seconds
 *  - op - an operation, default is UPSERT
 */
aws.route53Change = function(names, options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    if (!Array.isArray(names)) names = [ names ];
    var zones = [];

    lib.series([
        function(next) {
            if (names.every((x) => (x?.hostedzone))) return next();
            aws.route53List((err, rc) => {
                zones = rc;
                next(err);
            });
        },
        function(next) {
            lib.forEachSeries(names, (host, next2) => {
                if (!host) return next2();
                if (typeof host == "string") {
                    host = { name: host, value: app.ipaddr };
                }
                var type = host.type || options?.type || "A";
                var domain = lib.split(host.name, ".").slice(-2).join(".") + ".";
                var hostedzone = host.hostedzone || zones.filter((x) => (x.Name == domain)).map((x) => (x.Id)).pop();
                if (!hostedzone) {
                    return next(options?.quiet ? null : lib.newError("zone not found for " + host.name));
                }
                var values = Array.isArray(host.value) ? host.value : [host.value];
                var alias = host.alias || options?.alias, req;
                if (alias) {
                    req = '<?xml version="1.0" encoding="UTF-8"?>' +
                    '<ChangeResourceRecordSetsRequest xmlns="https://route53.amazonaws.com/doc/2013-04-01/">' +
                    ' <ChangeBatch>' +
                    '  <Changes>' +
                    '   <Change>' +
                    '    <Action>' + (options?.op || "UPSERT") + '</Action>' +
                    '    <ResourceRecordSet>' +
                    '     <Name>' + host.name + '</Name>' +
                    '     <Type>' + type + '</Type>' +
                    '     <AliasTarget>' +
                    '      <HostedZoneId>' + host.zoneId + '</HostedZoneId>' +
                    '      <DNSName>' + alias + '</DNSName>' +
                    '      <EvaluateTargetHealth>' + (host.healthCheck ? 'true' : 'false') + '</EvaluateTargetHealth>' +
                    '     </AliasTarget>' +
                    (options?.healthCheckId ?
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
                    '   <Action>' + (options?.op || "UPSERT") + '</Action>' +
                    '   <ResourceRecordSet>' +
                    '    <Name>' + host.name + '</Name>' +
                    '    <Type>' + type + '</Type>' +
                    '    <TTL>' + (host.ttl || options?.ttl || 300) + '</TTL>' +
                    '    <ResourceRecords>' +
                    values.map((x) => ('<ResourceRecord><Value>' + x + '</Value></ResourceRecord>')).join("") +
                    '    </ResourceRecords>' +
                    (options?.healthCheckId ?
                    '    <HealthCheckId>' + options.healthCheckId + '</HealthCheckId>' : '') +
                    '   </ResourceRecordSet>' +
                    '  </Change>' +
                    ' </Changes>' +
                    '</ChangeBatch>' +
                    '</ChangeResourceRecordSetsRequest>';
                }
                logger.dev("route53Change:", req);
                aws.queryRoute53("POST", hostedzone + "/rrset", req, (err, rc) => {
                    if (options?.quiet) err = null;
                    next2(err, rc);
                });
            }, next, true);
        },
    ], callback);
}

