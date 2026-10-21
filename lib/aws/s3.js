/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
'use strict';

const { basename } = require("node:path");
const qs = require('node:querystring');
const stream = require("node:stream");
const logger = require(__dirname + '/../logger');
const lib = require(__dirname + '/../lib');
const aws = require(__dirname + '/../aws');
const api = require(__dirname + '/../api');

/**
 * Sign an S3 request and return the URL to send to the S3 server. `options.headers` is updated in place
 * with all headers required for signing.
 * @memberof module:aws
 * @method signS3
 * @param {string} [method=GET] - HTTP method
 * @param {string} bucket - S3 bucket name
 * @param {string} key - object key path without query parameters
 * @param {string|Buffer} body - request payload used for signing
 * @param {object} [options]
 * @param {string} [options.region] - AWS region, defaults to `aws.region` or `us-east-1`
 * @param {object} [options.headers] - request headers, updated in place with signing headers
 * @param {object} [options.query] - query parameters to include in the signed URL
 * @param {object} [options.credentials] - credentials to sign with, defaults to `aws`
 * @param {boolean} [options.no_dns] - disable DNS compatibility access,
 * `aws-flags` can be set with s3-no_dns as well to make it global
 * @param {boolean} [options.presign] - if set, append the signing params to the URL (presigned URL)
 * @param {number} [options.expires] - expiration seconds for a presigned URL
 * @param {boolean} [options.postfile] - payload is a file, use UNSIGNED-PAYLOAD
 * @param {string} [options.endpoint] - full endpoint url, only protocol and host are used
 * @param {string} [options.endpoint_host] - custom host, default is AWS region
 * @param {string} [options.endpoint_protocol] - http or https default
 * @returns {object} the object with the `url` property to be used by {@link module:lib.fetch}
 */
aws.signS3 = function(method, bucket, key, body, options)
{
    options = lib.objCreate({}, options);

    const credentials = options.credentials || this;

    const headers = options.headers = options.headers || lib.objCreate();

    const region = options.region || this.region || 'us-east-1';
    if (!headers["content-type"]) {
        headers["content-type"] = "binary/octet-stream";
    }

    // For text files to prevent encoding/decoding issues
    if (/text|html|xml|json/.test(headers["content-type"]) && !headers["content-type"].includes("charset=")) {
        headers["content-type"] += "; charset=utf-8";
    }

    options.no_escape = true;

    let path = aws.uriEscapePath(lib.isString(key, "/"));
    if (path[0] !== "/") path = "/" + path;

    // DNS compatible or not, use path-style if not for access otherwise virtual host style
    const dns = options.no_dns || lib.includes(aws.flags, "s3-no_dns") ? false :
                /^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(bucket);

    let host = options.endpoint_host;
    let proto = lib.isString(options.endpoint_protocol, "https:");

    if (options.endpoint) {
        const e = URL.parse(options.endpoint);
        if (e) {
            host = e.host;
            proto = e.protocol;
        }
    }

    if (!proto.endsWith(":")) {
        proto += ":";
    }
    options.protocol = proto;

    if (!host) {
        host = "s3" + (region !== "us-east-1" ? "-" + region : "") + ".amazonaws.com";
    }

    options.hostname = host;

    const port = host.indexOf(":");
    if (port > 0) {
        options.hostname = host.substr(0, port);
        options.port = lib.toNumber(host.substr(port + 1));
    }

    if (bucket) {
        if (dns) {
            options.hostname = host = bucket + "." + host;
        } else {
            path = "/" + bucket + path;
        }
    }

    const q = lib.objKeys(options.query).
                sort().
                map((x) => (aws.uriEscape(x) + (options.query[x] === null ? "" : "=" + aws.uriEscape(options.query[x])))).
                join("&");
    if (q) {
        path += "?" + q;
    }

    options.path = path;

    if (!headers["x-amz-content-sha256"]) {
        headers["x-amz-content-sha256"] = method !== "GET" &&
                (options.postfile || options.poststream) ? "UNSIGNED-PAYLOAD" :
                lib.hash(body || "", "sha256", "hex");
    }

    const expires = lib.toNumber(options.expires, { min: 0, dflt: 300, max: 604800 });
    if (expires) {
        headers["x-amz-expires"] = expires;
    }

    options.query = options.endpoint = options.endpoint_host = options.endpoint_protocol = undefined;

    options.method = method = method || "GET";

    const opts = aws.signQuery(region, "s3", host, method, path, body, headers, credentials, options);

    options.url = proto + "//" + host + opts.path;

    if (options.presign) {
        if (!q) options.url += "?";
        options.url += '&X-Amz-Date=' + opts.isoDate;
        options.url += '&X-Amz-Algorithm=AWS4-HMAC-SHA256';
        options.url += '&X-Amz-Credential=' + encodeURIComponent(opts.credential);
        options.url += '&X-Amz-SignedHeaders=' + encodeURIComponent(opts.signedHeaders);
        options.url += '&X-Amz-Signature=' + encodeURIComponent(opts.signature);
        if (expires) options.url += "&X-Amz-Expires=" + expires;
        if (credentials.token) options.url += '&X-Amz-Security-Token=' + encodeURIComponent(credentials.token);
    }
    logger.debug('signS3:', options, "SIGN:", opts);
    return options;
}

/**
 * Make a low-level signed S3 request.
 * @memberof module:aws
 * @method queryS3
 * @param {string} bucket - S3 bucket name
 * @param {string} key - object key path without query parameters
 * @param {object} [options]
 * @param {string} [options.method] - HTTP method
 * @param {object} [options.query] - query parameters for the URL
 * @param {string|Buffer} [options.postdata] - data to send with POST/PUT
 * @param {string} [options.postfile] - path of a file to upload
 * @param {string} [options.poststream] - stream to upload
 * @param {number} [options.expires] - absolute time when the request expires
 * @param {object} [options.headers] - HTTP headers to send
 * @param {string} [options.file] - file name to save the downloaded contents to
 * @param {function} callback - `(err, request)`
 */
aws.queryS3 = function(bucket, key, options, callback)
{
    if (typeof options === "function") callback = options, options = null;

    const opts = this.signS3(options?.method, bucket, key, options.postdata, options);

    opts.retryCount ??= 3;
    opts.retryTimeout ??= 1000;
    opts.retryOnError ??= function() { return this.status === 503 || this.status === 500 }

    lib.fetch(opts, (err, rc) => {
        if ((rc.status < 200 || rc.status > 399) && rc.data) {
            err = aws.parseError(rc);
        }
        logger.logger(err ? "error" : "debug", "queryS3:", bucket, key, opts, err);
        lib.tryCall(callback, err, rc);
    });
}

/**
 * Async version of {@link module:aws.queryS3}
 * @return {object} - result as an object `{ ok, err, status, data, obj, request }` compatible with {@link module:lib.afetch}
 * @async
 * @memberof module:aws
 * @method aqueryS3
 */
aws.aqueryS3 = function(bucket, key, options)
{
    return new Promise((resolve, _reject) => {
        aws.queryS3(bucket, key, options, (err, request) => {
            resolve({ err, ok: request.ok, status: request.status, data: request.data, obj: request.obj, request })
        });
    });
}

/**
 * Retrieve a list of files from an S3 bucket, only objects under the given prefix are returned.
 * @memberof module:aws
 * @method s3List
 * @param {string} url - S3 URL/path (e.g. `s3://bucket/prefix` or `bucket/prefix`)
 * @param {object} [options]
 * @param {object} [options.query] - extra S3 list query parameters (e.g. `delimiter`)
 * @param {function} callback - `(err, rows, prefixes)`
 */
aws.s3List = function(url, options, callback)
{
    if (typeof options === "function") callback = options, options = {};
    options = lib.objCreate({}, options);

    options.query = options.query || {};

    const s3 = aws.s3ParseUrl(url);
    if (s3.endpoint) options.endpoint = s3.endpoint;
    if (s3.pathname) options.query.prefix = s3.pathname;
    if (s3.key) options.credentials = { key: s3.key, secret: s3.secret };
    if (s3.bucket) options.query['list-type'] = 2;
    const rows = [], prefixes = [];
    let truncated = false;

    lib.doWhilst(
      function(next) {
          aws.queryS3(s3.bucket, "", options, (err, rc) => {
              if (err) return next(err);
              if (s3.bucket) {
                  rows.push.apply(rows, lib.objGet(rc.obj, "ListBucketResult.Contents", { list: 1 }));
                  prefixes.push.apply(prefixes, lib.objGet(rc.obj, "ListBucketResult.CommonPrefixes", { list: 1 }).
                                                         map((x) => (x.Prefix.replace(s3.pathname, ""))));
                  truncated = lib.toBool(rc.obj?.ListBucketResult?.IsTruncated);
                  options.query['continuation-token'] = rc.obj?.ListBucketResult?.NextContinuationToken || "";
              } else {
                  rows.push.apply(rows, lib.objGet(rc.obj, "ListAllMyBucketsResult.Buckets.Bucket", { list: 1 }));
                  truncated = rc.obj?.ListAllMyBucketsResult?.ContinuationToken;
                  options.query['continuation-token'] = truncated;
              }
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
 * Retrieve a file from an S3 bucket; the root of the path is the bucket, an `s3://` prefix is ignored.
 * @memberof module:aws
 * @method s3GetFile
 * @param {string} url - S3 URL/path (e.g. `s3://bucket/key` or `bucket/key`)
 * @param {object} [options] - see {@link module:aws.queryS3}, e.g. `file` to save to disk
 * @param {function} callback - `(err, request)`
 */
aws.s3GetFile = function(url, options, callback)
{
    if (typeof options === "function") callback = options, options = {};
    options = lib.objCreate({}, options);

    const s3 = aws.s3ParseUrl(url);
    if (s3.endpoint) options.endpoint = s3.endpoint;
    if (s3.query) options.query = s3.query;
    if (s3.key) options.credentials = { key: s3.key, secret: s3.secret };
    aws.queryS3(s3.bucket, s3.pathname, options, (err, rc) => {
        if (rc.status === 200) {
            // A weird case when noSuchKey returned with status 200 as JSON
            if (/^"?<\?xml version=[\s\S]+<Error><Code>/.test(rc.data)) {
                if (rc.data[0] === '"') rc.data = lib.jsonParse(rc.data);
                if (!rc.obj) rc.obj = lib.xmlParse(rc.data);
                err = aws.parseError(rc);
                if (err) err.status = 404;
            }
        }
        lib.tryCall(callback, err, rc);
    });
}

/**
 * Upload a file to an S3 bucket.
 * @memberof module:aws
 * @method s3PutFile
 * @param {string} url - S3 URL/path (e.g. `s3://bucket/key` or `bucket/key`)
 * @param {string|Buffer|Stream} source - a Buffer with contents or a path to a local file or a stream
 * @param {object} [options]
 * @param {string} [options.acl] - canned ACL, sets `x-amz-acl`
 * @param {string} [options.contentType] - object content type
 * @param {function} callback - `(err, request)`
 */
aws.s3PutFile = function(url, source, options, callback)
{
    if (typeof options === "function") callback = options, options = {};
    options = lib.objCreate({}, options);

    options.method = "PUT";
    if (!options.headers) options.headers = {};
    if (options.acl) options.headers['x-amz-acl'] = options.acl;
    if (options.contentType) options.headers['content-type'] = options.contentType;

    options[Buffer.isBuffer(source) ? 'postdata' :
            stream.isReadable(source) ? "poststream": 'postfile'] = source;

    const s3 = aws.s3ParseUrl(url);
    if (s3.endpoint) options.endpoint = s3.endpoint;
    if (s3.query) options.query = s3.query;
    if (s3.key) options.credentials = { key: s3.key, secret: s3.secret };
    logger.debug("s3PutFile:", s3, options);
    aws.queryS3(s3.bucket, s3.pathname, options, callback);
}

/**
 * Copy an existing S3 object to a new location.
 * @memberof module:aws
 * @method s3CopyFile
 * @param {string} url - destination S3 URL (e.g. `s3://bucket/key` or `bucket/key`)
 * @param {string} source - source object as `bucket/path` or `s3://bucket/path`
 * @param {object} [options]
 * @param {string} [options.acl] - canned ACL for the copy
 * @param {string} [options.contentType] - content type, defaults to the mime type of the path
 * @param {function} callback - `(err, request)`
 */
aws.s3CopyFile = function(url, source, options, callback)
{
    if (typeof options === "function") callback = options, options = {};
    options = lib.objCreate({}, options);

    options.method = "PUT";
    if (!options.headers) options.headers = {};

    const src = aws.s3ParseUrl(source);

    options.headers["x-amz-copy-source"] = encodeURIComponent(src.bucket + "/" + src.pathname);
    if (options.acl) options.headers['x-amz-acl'] = options.acl;
    if (options.contentType) options.headers['content-type'] = options.contentType;
    if (!options.headers['content-type']) options.headers['content-type'] = lib.getMimeType(src.pathname);

    const s3 = aws.s3ParseUrl(url);
    if (s3.endpoint) options.endpoint = s3.endpoint;
    if (s3.query) options.query = s3.query;
    if (s3.key) options.credentials = { key: s3.key, secret: s3.secret };

    logger.debug("s3CopyFile:", s3, options);
    aws.queryS3(s3.bucket, s3.pathname, options, (err, rc) => {
        if (rc.status === 200 && rc.obj?.Error) {
            err = aws.parseError(rc);
        }
        lib.tryCall(callback, err, rc);
    });
}

/**
 * Parse an S3 URL into its components, formats supported:
 * - https?://endpoint/bucket/key...
 * - s3://bucket/key...
 * - bucket/key....
 * @memberof module:aws
 * @method s3ParseUrl
 * @param {string} url - an S3 URL/path
 * @returns {object} `{ bucket, path, pathname, [query], [endpoint] }`
 */
aws.s3ParseUrl = function(url)
{
    var rc = { bucket: "", path: "", pathname: "" };
    if (!lib.isString(url)) return rc;

    // Endpoint detection
    let d = url.match(/^https?:\/\/([^/]+)\//);
    if (d) {
        rc.endpoint = d[0];
        url = url.substr(d[0].length);
    }

    if (url.startsWith("s3:")) {
        d = url.match(/^s3:\/\/([^/]+)(\/|\/.+)?$/);
    } else {
        d = url.match(/^([^/]+)(\/|\/.+)?$/);
    }
    if (d) {
        rc.bucket = d[1];
        rc.path = rc.pathname = lib.isString(d[2]).substr(1);
    }

    const q = rc.path.indexOf("?");
    if (q > -1) {
        rc.pathname = rc.path.substr(0, q);
        rc.query = qs.parse(rc.path.substr(q + 1));
    }

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
 * @param {string} url - S3 url, bucket and path
 * @param {Object} [options] - Controls how the object is fetched and how the HTTP response is produced.
 * @param {int} [options.httpTimeout] - cancel if no data after this timeout
 * @param {Object} [options.headers] - Extra headers to send to S3 (commonly used for `Range`).
 * @param {boolean} [options.attachment] - If true, sets `Content-Disposition` to attachment (usually derived from filename).
 * @param {function(err)} [callback] Called when proxying finishes or fails.
 *  - `err` is set on any S3/stream/response error.
 */
aws.s3Proxy = function(res, url, options, callback)
{
    if (typeof options === "function") callback = options, options = null;

    options = lib.objCreate({}, options);

    const s3 = aws.s3ParseUrl(url);
    if (s3.endpoint) options.endpoint = s3.endpoint;
    if (s3.query) options.query = s3.query;
    if (s3.key) options.credentials = { key: s3.key, secret: s3.secret };

    options.stream = res;

    if (options.attachment) {
        options.proxyHeaders = {
            "content-disposition": api.getContentDisposition(lib.isString(options.attachment, basename(s3.pathname)))
        };
    }

    aws.queryS3(s3.bucket, s3.pathname, options, callback);
}

