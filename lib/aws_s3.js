//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Feb 2012
//

var util = require('util');
var url = require('url');
var mime = require('mime');
var qs = require('qs');
var logger = require(__dirname + '/logger');
var core = require(__dirname + '/core');
var lib = require(__dirname + '/lib');
var aws = require(__dirname + '/aws');

// Sign S3 AWS request, returns url to be send to S3 server, options will have all updated headers to be sent as well
aws.signS3 = function(method, bucket, path, body, options)
{
    if (!options) options = {};
    if (!options.headers) options.headers = {};

    var region = options.region || this.region || 'us-east-1';
    if (!options.headers["content-type"]) options.headers["content-type"] = "binary/octet-stream; charset=utf-8";
    if (options.headers["content-type"] && options.headers["content-type"].indexOf("charset=") == -1) options.headers["content-type"] += "; charset=utf-8";

    // Run through the encoding so our signature match the real url sent by core.httpGet
    path = url.parse(path || "/").pathname;
    if (path[0] != "/") path = "/" + path;

    // DNS compatible or not, use path-style if not for access otherwise virtual host style
    var dns = bucket.match(/[a-z0-9][a-z0-9\-]*[a-z0-9]/) ? true : false;

    var host = (dns ? bucket + "." : "") + "s3" + (region != "us-east-1" ? "-" + region : "") + ".amazonaws.com";
    var uri = options.endpoint_protocol || 'http://' + host + (dns ? "" : "/" + bucket) + path;

    if (region != 'us-east-1') {
        if (!dns) path = "/" + bucket + path;
        var q = Object.keys(options.query || []).sort().map(function(x) {
            return aws.uriEscape(x) + (options.query[x] == null ? "" : "=" + aws.uriEscape(options.query[x]));
        });
        if (q) path += "?" + q;
        if (!options.headers["x-amz-content-sha256"]) options.headers["x-amz-content-sha256"] = lib.hash(body || "", "sha256", "hex");
        var opts = {};
        this.querySign(region, "s3", host, method || "GET", path, body, options.headers, opts);
        if (options.url) {
            uri += '&X-Amz-Date=' + opts.date;
            uri += '&X-Amz-Algorithm=AWS4-HMAC-SHA256';
            uri += '&X-Amz-Credential=' + opts.credential;
            uri += '&X-Amz-SignedHeaders=' + opts.signedHeaders;
            uri += '&X-Amz-Signature=' + opts.signature;
            if (options.expires) uri += "&X-Amz-Expires=" + options.expires;
            if (options.securityToken || this.securityToken) uri += '&X-Amz-Security-Token=' + (options.securityToken || this.securityToken);
        }
        logger.debug('signS3:', uri, lib.objDescr(options), "opts:", opts);
    } else {
        if (!options.headers["x-amz-date"]) options.headers["x-amz-date"] = (new Date()).toUTCString();
        if (options.securityToken || (!options.key && this.securityToken)) options.headers["x-amz-security-token"] = options.securityToken || this.securityToken;

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
        strSign += (bucket ? "/" + bucket : "") + path + (rc.length ? "?" : "") + rc.sort().join("&");
        var signature = lib.sign(options.secret || this.secret, strSign);
        options.headers["authorization"] = "AWS " + (options.key || this.key) + ":" + signature;

        // Build REST url
        if (options.url) {
            uri += url.format({ query: options.query });
            uri += (uri.indexOf("?") == -1 ? "?" : "") + '&AWSAccessKeyId=' + (options.key || this.key) + "&Signature=" + encodeURIComponent(signature);
            if (options.expires) uri += "&Expires=" + options.expires;
            if (options.securityToken || this.securityToken) uri += "&SecurityToken=" + (options.securityToken || this.securityToken);
        }
        logger.debug('signS3:', uri, lib.objDescr(options), "str:", strSign);
    }
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
    var uri = this.signS3(options.method, bucket, path, options.postdata, options);

    core.httpGet(uri, options, function(err, params) {
        if (params.status < 200 || params.status > 299) err = aws.parseError(params, options);
        if (typeof callback == "function") callback(err, params);
    });
}

// Retrieve a list of files from S3 bucket, only files inside the path will be returned
aws.s3List = function(path, options, callback)
{
    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {};

    options.query = options.query || {};
    var uri = this.s3ParseUrl(path);
    for (var p in uri.query) options.query[p] = uri.query[p];
    if (uri.path) options.query.prefix = uri.path;
    if (uri.key) options = lib.objClone(options, "key", uri.key, "secret", uri.secret);
    var rows = [], truncated = false, self = this;
    lib.doWhilst(
      function(next) {
          self.queryS3(uri.bucket, "", options, function(err, params) {
              if (err) return next(err);
              rows.push.apply(rows, lib.objGet(params.obj, "ListBucketResult.Contents", { list: 1 }));
              truncated = lib.toBool(params.obj.ListBucketResult.IsTruncated);
              options.query.marker = params.obj.ListBucketResult.NextMarker || rows.length ? rows[rows.length - 1].Key : "";
              next(err);
          });
      },
      function() {
          return truncated;
      }, function(err) {
          lib.tryCall(callback, err, rows);
      });
}

// Retrieve a file from S3 bucket, root of the path is a bucket, path can have a protocol prepended like s3://, it will be ignored
aws.s3GetFile = function(path, options, callback)
{
    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {};

    var uri = this.s3ParseUrl(path);
    if (uri.query) options.query = uri.query;
    if (uri.key) options = lib.objClone(options, "key", uri.key, "secret", uri.secret);
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
    if (uri.key) options = lib.objClone(options, "key", uri.key, "secret", uri.secret);
    logger.debug("s3PutFile:", uri, lib.objDescr(options));
    this.queryS3(uri.bucket, uri.path, options, callback);
}

// Parse an S3 URL and return an object with bucket and path
aws.s3ParseUrl = function(url)
{
    var rc = {};
    if (!url) return rc;
    url = url.split("?");
    // Remove the protocol part and leading slashes
    url[0] = url[0].replace(/(^.+\:\/\/|^\/+)/, "");
    var path = url[0].replace("//", "/").split("/");
    rc.bucket = path[0];
    // Access key and secret as auth
    var d = rc.bucket.match(/^([^:]+):([^@]+)@(.+)$/);
    if (d) {
        rc.key = d[1];
        rc.secret = d[2];
        rc.bucket = d[3];
    }
    rc.path = path.slice(1).join("/");
    if (url[1]) rc.query = qs.parse(url[1]);
    return rc;
}

