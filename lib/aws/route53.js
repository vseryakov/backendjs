/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
'use strict';

const logger = require(__dirname + '/../logger');
const app = require(__dirname + '/../app');
const lib = require(__dirname + '/../lib');
const aws = require(__dirname + '/../aws');

/**
 * Make a request to the Route53 REST API.
 * @memberof module:aws
 * @method queryRoute53
 * @param {string} method - HTTP method, e.g. `GET`, `POST`
 * @param {string} path - request path appended to the Route53 API base URL
 * @param {string} postdata - XML request body
 * @param {object} [options] - request options
 * @param {function} callback - `(err, data, request)`
 */
aws.queryRoute53 = function(method, path, postdata, options, callback)
{
    if (typeof options === "function") callback = options, options = null;

    var headers = { "content-type": "text/xml; charset=UTF-8" };
    var opts = this.getServiceOptions({ endpoint: "route53", region: "us-east-1", method, postdata, headers }, options);
    this.fetch("https://route53.amazonaws.com/2013-04-01" + path, opts, (err, rc) => {
        aws.parseXMLResponse(err, rc, callback);
    });
}

/**
 * AWS Route53 Domains API request.
 * @memberof module:aws
 * @method queryRoute53Domains
 * @param {string} action - Route53 Domains API action, e.g. `ListDomains`, `RegisterDomain`
 * @param {object} obj - API-specific request parameters
 * @param {object} [options] - request options passed to {@link module:aws.queryService}
 * @param {function} callback - `(err, data, request)`
 */
aws.queryRoute53Domains = function(action, obj, options, callback)
{
    aws.queryService({ endpoint: "route53domains", target: "Route53Domains_v20140515", action }, obj, options, callback);
}

/**
 * Create a Route53 hosted zone.
 * @memberof module:aws
 * @method route53Create
 * @param {object} options
 * @param {string} options.name - domain name for the new hosted zone
 * @param {function} callback
 */
aws.route53Create = function(options, callback)
{
    if (typeof options === "function") callback = options, options = null;

    var req = `<CreateHostedZoneRequest xmlns="https://route53.amazonaws.com/doc/2013-04-01/">
               <CallerReference>${Date.now()}</CallerReference>
               <Name>${options.name}</Name>
               </CreateHostedZoneRequest>`;

    aws.queryRoute53("POST", "/hostedzone", req, callback);
}


/**
 * List all Route53 hosted zones (handles pagination).
 * @memberof module:aws
 * @method route53List
 * @param {object} [options]
 * @param {function} callback - `(err, zones)`
 */
aws.route53List = function(options, callback)
{
    if (typeof options === "function") callback = options, options = null;

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

/**
 * Return a hosted zone by id or domain name.
 * @memberof module:aws
 * @method route53Get
 * @param {object} options
 * @param {string} [options.zone] - hosted zone id
 * @param {string} [options.name] - domain name to look up the zone by
 * @param {function} callback
 */
aws.route53Get = function(options, callback)
{
    if (options.zone) {
        aws.queryRoute53("GET", "/hostedzone/" + options.zone, "", callback);
    } else

    if (typeof options.name === "string") {
        const name = options.name + ".";
        aws.route53List((err, zones) => {
            var zone = zones.filter((x) => (x.Name === name)).pop();
            if (!zone) return callback(err, zone);
            aws.queryRoute53("GET", zone.Id, "", callback);
        });
    } else {
        callback();
    }
}

/**
 * Create or update DNS records in Route53.
 * @memberof module:aws
 * @method route53Change
 * @param {string|object|object[]} names - a host name to set to the current IP, or record object(s) in the form
 *   `{ name, value, type, ttl, zoneId, alias, hostedzone, healthCheck }`
 * @param {object} [options]
 * @param {string} [options.type=A] - default record type
 * @param {number} [options.ttl=300] - default TTL in seconds
 * @param {string} [options.op=UPSERT] - change action (UPSERT | CREATE | DELETE)
 * @param {string} [options.alias] - default alias DNS name
 * @param {string} [options.healthCheckId] - health check id to attach
 * @param {boolean} [options.quiet] - suppress errors (e.g. zone not found)
 * @param {function} callback
 */
aws.route53Change = function(names, options, callback)
{
    if (typeof options === "function") callback = options, options = null;

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
                if (typeof host === "string") {
                    host = { name: host, value: app.ipaddr };
                }
                var type = host.type || options?.type || "A";
                var domain = lib.split(host.name, ".").slice(-2).join(".") + ".";
                var hostedzone = host.hostedzone || zones.filter((x) => (x.Name === domain)).map((x) => (x.Id)).pop();
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

