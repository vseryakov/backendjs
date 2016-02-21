//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Feb 2012
//

var util = require('util');
var url = require('url');
var mime = require('mime');
var logger = require(__dirname + '/logger');
var core = require(__dirname + '/core');
var lib = require(__dirname + '/lib');
var aws = require(__dirname + '/aws');

// Sign S3 AWS request, returns url to be send to S3 server, options will have all updated headers to be sent as well
aws.signS3 = function(method, bucket, path, options)
{
    if (!options) options = {};
    if (!options.headers) options.headers = {};

    var curTime = new Date().toUTCString();
    var region = options.region || this.region || 'us-east-1';
    if (!options.headers["x-amz-date"]) options.headers["x-amz-date"] = curTime;
    if (!options.headers["content-type"]) options.headers["content-type"] = "binary/octet-stream; charset=utf-8";
    if (options.headers["content-type"] && options.headers["content-type"].indexOf("charset=") == -1) options.headers["content-type"] += "; charset=utf-8";
    if (options.securityToken || this.securityToken) options.headers["x-amz-security-token"] = options.securityToken || this.securityToken;

    // Construct the string to sign and query string
    var strSign = (method || "GET") + "\n" + (options.headers['content-md5']  || "") + "\n" + (options.headers['content-type'] || "") + "\n" + (options.expires || "") + "\n";

    // Amazon canonical headers
    var hdrs = [];
    for (var p in options.headers) {
        if (/X-AMZ-/i.test(p)) {
            var value = options.headers[p];
            if (value instanceof Array) value = value.join(',');
            hdrs.push(p.toString().toLowerCase() + ':' + value);
        }
    }
    if (hdrs.length) strSign += hdrs.sort().join('\n') + "\n";
    // Split query string for subresources, supported are:
    var resources = ["acl", "lifecycle", "location", "logging", "notification", "partNumber", "policy", "requestPayment", "torrent",
                     "uploadId", "uploads", "versionId", "versioning", "versions", "website", "cors",
                     "delete",
                     "response-content-type", "response-content-language", "response-expires",
                     "response-cache-control", "response-content-disposition", "response-content-encoding" ];
    var rc = [];
    for (p in options.query) {
        p = p.toLowerCase();
        if (resources.indexOf(p) != -1) rc.push(p + (options.query[p] == null ? "" : "=" + options.query[p]));
    }

    // Run through the encoding so our signature match the real url sent by core.httpGet
    path = url.parse(path || "/").pathname;

    strSign += (bucket ? "/" + bucket : "") + (path[0] != "/" ? "/" : "") + path + (rc.length ? "?" : "") + rc.sort().join("&");
    var signature = lib.sign(options.secret || this.secret, strSign);
    options.headers["authorization"] = "AWS " + (options.key || this.key) + ":" + signature;

    // DNS compatible or not, use path-style if not for access otherwise virtual host style
    var dns = bucket.match(/[a-z0-9][a-z0-9\-]*[a-z0-9]/) ? true : false;

    var uri = options.endpoint_protocol || 'http://';
    uri += dns ? bucket + "." : "";
    uri += "s3" + (region != "us-east-1" ? "-" + region : "") + ".amazonaws.com";
    uri += dns ? "" : "/" + bucket;
    uri += (path[0] != "/" ? "/" : "") + path;

    // Build REST url
    if (options.url) {
        uri += url.format({ query: options.query });
        uri += (uri.indexOf("?") == -1 ? "?" : "") + '&AWSAccessKeyId=' + (options.key || this.key) + "&Signature=" + encodeURIComponent(signature);
        if (options.expires) uri += "&Expires=" + options.expires;
        if (options.securityToken || this.securityToken) uri += "&SecurityToken=" + (options.securityToken || this.securityToken);
    }
    logger.debug('signS3:', uri, options, "str:", strSign);
    return uri;
}

// S3 requests
// Options may contain the following properties:
// - method - HTTP method
// - query - query parameters for the url as an object
// - postdata - any data to be sent with POST
// - postfile - file to be uploaded to S3 bucket
// - expires - absolute time when this request is expires
// - headers - HTTP headers to be sent with request
// - file - file name where to save downloaded contents
aws.queryS3 = function(bucket, path, options, callback)
{
    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {};

    if (!options.retryCount) options.retryCount = 3;
    options.retryOnError = function() { return (this.status < 200 || this.status > 299) && this.status != 404 }
    var uri = this.signS3(options.method, bucket, path, options);

    core.httpGet(uri, options, function(err, params) {
        if (params.status < 200 || params.status > 299) err = aws.parseError(params, options);
        if (typeof callback == "function") callback(err, params);
    });
}

// Retrieve a file from S3 bucket, root of the path is a bucket, path can have a protocol prepended like s3://, it will be ignored
aws.s3GetFile = function(path, options, callback)
{
    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {};

    var uri = this.s3ParseUrl(path);
    if (uri.query) options.query = uri.query;
    this.queryS3(uri.bucket, uri.path, options, callback);
}

// Upload a file to S3 bucket, `file` can be a Buffer or a file name
aws.s3PutFile = function(path, file, options, callback)
{
    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {};

    options.method = "PUT";
    if (!options.headers) options.headers = {};
    if (options.acl) options.headers['x-amz-acl'] = options.acl;
    if (options.contentType) options.headers['content-type'] = options.contentType;
    if (!options.headers['content-type']) options.headers['content-type'] = mime.lookup(path);
    options[Buffer.isBuffer(file) ? 'postdata' : 'postfile'] = file;
    var uri = this.s3ParseUrl(path);
    if (uri.query) options.query = uri.query;
    logger.debug("s3PutFile:", uri, typeof file);
    this.queryS3(uri.bucket, uri.path, options, callback);
}

// Parse an S3 URL and return an object with bucket and path
aws.s3ParseUrl = function(url)
{
    var rc = {}
    url = url.split("?");
    // Remove the protocol part and leading slashes
    url[0] = url[0].replace(/(^.+\:\/\/|^\/+)/, "");
    var path = url[0].replace("//", "/").split("/");
    rc.bucket = path[0];
    rc.path = path.slice(1).join("/");
    if (url[1]) rc.query = qs.parse(url[1]);
    return rc;
}

