/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const path = require("path");
const qs = require('qs');
const http = require('http');
const https = require('https');
const logger = require(__dirname + '/../logger');
const app = require(__dirname + '/../app');
const lib = require(__dirname + '/../lib');
const aws = require(__dirname + '/../aws');

/**
 * Sign S3 AWS request, returns url to be send to S3 server, options will have all updated headers to be sent as well
 * @memberof module:aws
 */
aws.signS3 = function(method, bucket, path, body, options)
{
    if (!options) options = {};
    if (!options.headers) options.headers = {};

    var region = options.region || this.region || 'us-east-1';
    if (!options.headers["content-type"]) options.headers["content-type"] = "binary/octet-stream";
    // For text files to prevent encoding/decoding issues
    if (/text|html|xml|json/.test(options.headers["content-type"]) &&
        options.headers["content-type"].indexOf("charset=") == -1) {
        options.headers["content-type"] += "; charset=utf-8";
    }

    // Run through the encoding so our signature match the real url sent by app.fetch
    if (typeof path != "string") path = String(path);
    if (path[0] != "/") path = "/" + path;
    var key = URL.parse("file:" + (path || "/"))?.pathname;

    // DNS compatible or not, use path-style if not for access otherwise virtual host style
    var dns = /[a-z0-9][a-z0-9-]*[a-z0-9]/.test(bucket) ? true : false;

    var host = (dns ? bucket + "." : "") + "s3" + (region != "us-east-1" ? "-" + region : "") + ".amazonaws.com";
    var uri = (options.endpoint_protocol || "https") + "://" + host + (dns ? "" : "/" + bucket) + key;
    var credentials = options.credentials || this;

    if (!dns) path = "/" + bucket + path;
    var q = Object.keys(options.query || []).sort().map((x) => (aws.uriEscape(x) + (options.query[x] == null ? "" : "=" + aws.uriEscape(options.query[x])))).join("&");
    if (q) path += "?" + q;
    if (!options.headers["x-amz-content-sha256"]) {
        options.headers["x-amz-content-sha256"] = method != "GET" && options.postfile ? "UNSIGNED-PAYLOAD" : lib.hash(body || "", "sha256", "hex");
    }
    var opts = {};
    this.querySign(region, "s3", host, method || "GET", path, body, options.headers, options.credentials, opts);
    if (options.url) {
        uri += '&X-Amz-Date=' + opts.date;
        uri += '&X-Amz-Algorithm=AWS4-HMAC-SHA256';
        uri += '&X-Amz-Credential=' + opts.credential;
        uri += '&X-Amz-SignedHeaders=' + opts.signedHeaders;
        uri += '&X-Amz-Signature=' + opts.signature;
        if (options.expires) uri += "&X-Amz-Expires=" + options.expires;
        if (credentials.token) uri += '&X-Amz-Security-Token=' + credentials.token;
    }
    logger.debug('signS3:', uri, options, "opts:", opts);
    return uri;
}

/**
 * S3 requests
 * Options may contain the following properties:
 * - method - HTTP method
 * - query - query parameters for the url as an object
 * - postdata - any data to be sent with POST
 * - postfile - file to be uploaded to S3 bucket
 * - expires - absolute time when this request is expires
 * - headers - HTTP headers to be sent with request
 * - file - file name where to save downloaded contents
 * @memberof module:aws
 * @method queryS3
 */
aws.queryS3 = function(bucket, path, options, callback)
{
    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {};

    if (!options.retryCount) options.retryCount = 3;
    if (!options.retryTimeout) options.retryTimeout = 1000;
    options.retryOnError = function() { return this.status == 503 || this.status == 500 }
    var uri = this.signS3(options.method, bucket, path, options.postdata, options);

    lib.fetch(uri, options, (err, params) => {
        if ((params.status < 200 || params.status > 299) && params.data) err = aws.parseError(params, options);
        if (err) err.path = path;
        lib.tryCall(callback, err, params);
    });
}

/**
 * Retrieve a list of files from S3 bucket, only files inside the path will be returned
 * @memberof module:aws
 */
aws.s3List = function(path, options, callback)
{
    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {};

    options.query = options.query || {};
    var uri = this.s3ParseUrl(path);
    for (const p in uri.query) options.query[p] = uri.query[p];
    if (uri.path) options.query.prefix = uri.path;
    if (uri.key) options = lib.objClone(options, { credentials: { key: uri.key, secret: uri.secret } });
    options.query['list-type'] = 2;
    var rows = [], prefixes = [], truncated = false;

    lib.doWhilst(
      function(next) {
          aws.queryS3(uri.bucket, "", options, (err, params) => {
              if (err) return next(err);
              rows.push.apply(rows, lib.objGet(params.obj, "ListBucketResult.Contents", { list: 1 }));
              prefixes.push.apply(prefixes, lib.objGet(params.obj, "ListBucketResult.CommonPrefixes", { list: 1 }).map((x) => (x.Prefix.replace(uri.path, ""))));
              truncated = lib.toBool(params.obj.ListBucketResult.IsTruncated);
              options.query['continuation-token'] = params.obj.ListBucketResult.NextContinuationToken || "";
              next(err);
          });
      },
      function() {
          return truncated;
      }, (err) => {
          lib.tryCall(callback, err, rows, prefixes);
      }, true);
}

/**
 * Retrieve a file from S3 bucket, root of the path is a bucket, path can have a protocol prepended like s3://, it will be ignored
 * @memberof module:aws
 */
aws.s3GetFile = function(path, options, callback)
{
    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {};

    var uri = this.s3ParseUrl(path);
    if (uri.query) options.query = uri.query;
    if (uri.key) options = lib.objClone(options, { credentials: { key: uri.key, secret: uri.secret } });
    this.queryS3(uri.bucket, uri.path, options, (err, rc) => {
        if (rc.status == 200) {
            // A weird case when noSuchKey returned with status 200 as JSON
            if (/^"?<\?xml version=[\s\S]+<Error><Code>/.test(rc.data)) {
                if (rc.data[0] == '"') rc.data = lib.jsonParse(rc.data);
                if (!rc.obj) rc.obj = lib.xmlParse(rc.data);
                err = aws.parseError(rc);
                if (err) err.status = 404;
            }
        }
        lib.tryCall(callback, err, rc);
    });
}

/**
 * Upload a file to S3 bucket, `file` can be a Buffer or a file name
 * @memberof module:aws
 */
aws.s3PutFile = function(path, file, options, callback)
{
    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {};

    options.method = "PUT";
    if (!options.headers) options.headers = {};
    if (options.acl) options.headers['x-amz-acl'] = options.acl;
    if (options.contentType) options.headers['content-type'] = options.contentType;
    if (!options.headers['content-type']) options.headers['content-type'] = app.mime.lookup(path);
    options[Buffer.isBuffer(file) ? 'postdata' : 'postfile'] = file;
    var uri = this.s3ParseUrl(path);
    if (uri.query) options.query = uri.query;
    if (uri.key) options = lib.objClone(options, { credentials: { key: uri.key, secret: uri.secret } });
    logger.debug("s3PutFile:", uri, options);
    this.queryS3(uri.bucket, uri.path, options, callback);
}

/**
 * Copy existing S3 file, source must be in the format `bucket/path`
 * @memberof module:aws
 */
aws.s3CopyFile = function(path, source, options, callback)
{
    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {};

    options.method = "PUT";
    if (!options.headers) options.headers = {};
    options.headers["x-amz-copy-source"] = String(source).replace("s3://", "");
    if (options.acl) options.headers['x-amz-acl'] = options.acl;
    if (options.contentType) options.headers['content-type'] = options.contentType;
    if (!options.headers['content-type']) options.headers['content-type'] = app.mime.lookup(path);
    var uri = this.s3ParseUrl(path);
    if (uri.query) options.query = uri.query;
    if (uri.key) options = lib.objClone(options, { credentials: { key: uri.key, secret: uri.secret } });
    logger.debug("s3CopyFile:", uri, options);
    this.queryS3(uri.bucket, uri.path, options, callback);
}

/**
 * Parse an S3 URL and return an object with bucket and path
 * @memberof module:aws
 */
aws.s3ParseUrl = function(link)
{
    var rc = {};
    if (!link) return rc;
    link = link.split("?");
    // Remove the protocol part and leading slashes
    link[0] = link[0].replace(/(^.+:\/\/|^\/+)/, "");
    var path = link[0].replace("//", "/").split("/");
    rc.bucket = path[0];
    // Access key and secret as auth
    var d = rc.bucket.match(/^([^:]+):([^@]+)@(.+)$/);
    if (d) {
        rc.key = d[1];
        rc.secret = d[2];
        rc.bucket = d[3];
    }
    rc.path = path.slice(1).join("/");
    if (link[1]) rc.query = qs.parse(link[1]);
    return rc;
}

/**
 * Proxy (stream) an object from an S3 bucket into an existing HTTP response.
 *
 * Typically used to serve/download S3-hosted files through your app:
 * it fetches `file` from `bucket` (optionally using request options like range/content-type/etc)
 * and pipes the S3 response directly into `res`, preserving status/headers as appropriate.
 *
 * @memberof module:aws
 * @function s3Proxy
 *
 * @param {http.ServerResponse} res Node.js HTTP response object to write to. The S3 object data is streamed into it.
 * @param {string} bucket S3 bucket name that contains the object.
 * @param {string} file S3 object key (path inside the bucket).
 * @param {Object} [options] Controls how the object is fetched and how the HTTP response is produced.
 * @param {Object} [options.headers] Extra headers to send to S3 (commonly used for `Range`).
 * @param {boolean} [options.attachment] If true, sets `Content-Disposition` to attachment (usually derived from filename).
 * @param {function(Error=):void} [callback] Called when proxying finishes or fails.
 *  - `err` is set on any S3/stream/response error.
 */
aws.s3Proxy = function(res, bucket, file, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    var opts = lib.objClone(options);
    var params = URL.parse(this.signS3("GET", bucket, file, "", opts)) || {};
    params.headers = opts.headers;
    var mod = params.protocol == "https:" ? https : http;
    var s3req = mod.request(params, (s3res) => {
        if (options.attachment) {
            var fname = typeof options.attachment == "string" ? options.attachment : path.basename(file);
            s3res.headers["Content-Disposition"] = "attachment; filename=" + fname;
        }
        res.writeHead(s3res.statusCode, s3res.headers);
        s3res.pipe(res, { end: true });
    }).on("error", (err) => {
        logger.error('s3Proxy:', bucket, file, err);
        s3req.abort();
    }).on("close", () => {
        lib.tryCall(null, callback);
    });
    s3req.setTimeout(options.httpTimeout || 10000, () => { s3req.abort() });
    s3req.end();
}

