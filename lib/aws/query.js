/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const util = require('util');
const url = require('url');
const logger = require(__dirname + '/../logger');
const lib = require(__dirname + '/../lib');
const aws = require(__dirname + '/../aws');

aws.fetch = function(url, options, callback)
{
    if (!options.retryCount) options.retryCount = this.retryCount[options.endpoint];
    if (!options.retryOnError && options.retryCount) options.retryOnError = 1;
    lib.fetch(url, options, callback);
}

aws.parseError = function(params, options)
{
    var err;
    if (params.obj) {
        var errors = params.obj.Response?.Errors?.Error;
        if (errors?.length && errors[0].Message) {
            err = lib.newError({ message: errors[0].Message, code: errors[0].Code, status: params.status });
        } else
        if (params.obj.ErrorResponse?.Error) {
            err = lib.newError({ message: params.obj.ErrorResponse.Error.Message, code: params.obj.ErrorResponse.Error.Code, status: params.status });
        } else
        if (params.obj.Error?.Message) {
            err = lib.newError({ message: params.obj.Error.Message, code: params.obj.Error.Code, status: params.status });
        } else
        if (params.obj.__type) {
            err = lib.newError({ message: params.obj.Message || params.obj.message, code: params.obj.__type, status: params.status });
        }
    }
    if (!err) {
        err = lib.newError({ message: "Error " + params.status + " " + params.data, status: params.status });
    }
    if (params.action) {
        err.action = params.action;
    }
    if (options?.ignore_error > 0 || lib.isFlag(options?.ignore_error, err.code)) err = null;
    return err;
}

/**
 * Parse AWS response and try to extract error code and message, convert XML into an object.
 * @memberof module:aws
 * @method parseXMLResponse
 */
aws.parseXMLResponse = function(err, params, options, callback)
{
    if (!err && params.data) {
        if (!params.obj) {
            params.obj = lib.xmlParse(params.data);
        }
        if (params.status < 200 || params.status >= 400) {
            err = this.parseError(params, options);
        }
        logger.logger(err ? options?.logger_error || "error" : "debug", "queryAWS:", params.href, params.search, params.Action, params.obj, err, params.toJSON());
    }
    if (typeof callback == "function") callback(err, params.obj);
}

aws.uriEscape = function(str)
{
    str = encodeURIComponent(str);
    str = str.replace(/[^A-Za-z0-9_.~\-%]+/g, escape);
    return str.replace(/[!'()*]/g, (ch) => ('%' + ch.charCodeAt(0).toString(16).toUpperCase()));
}

aws.uriEscapePath = function(path)
{
    return path ? String(path).split('/').map(aws.uriEscape).join('/') : "/";
}

// Check for supported regions per service, return the first one if the given region is not supported
aws.getServiceRegion = function(service, region)
{
    return this.regions[service] && this.regions[service].indexOf(region) == -1 ? this.regions[service][0] : region;
}

// Copy all credentials properties from the options into the obj
aws.copyCredentials = function(obj, options)
{
    for (var p in options) {
        if (/^(region|endpoint|credentials|endpoint_(protocol|host|path))$/.test(p)) obj[p] = options[p];
    }
    return obj;
}

/**
 * Build AWS Signature Version 4 headers for a request.
 *
 * Populates/overwrites required signing headers in `headers` (e.g. `host`, `x-amz-date`,
 * optional `content-type`, `content-length`, `x-amz-security-token`) and sets
 * `headers.Authorization`. If `options` is provided, signing details are also written into it.
 *
 * @memberof module:aws
 * @method querySign
 * @param {string} region AWS region (e.g. `us-east-1`).
 * @param {string} service AWS service name (e.g. `s3`, `ec2`, `execute-api`).
 * @param {string} host Request host (e.g. `s3.amazonaws.com` or `bucket.s3.us-east-1.amazonaws.com`).
 * @param {string} method HTTP method (e.g. `GET`, `POST`, `PUT`, `DELETE`).
 * @param {string} path Request path, may include query string (e.g. `/path` or `/path?a=1&b=2`).
 * @param {string|Buffer|null} body Request payload. If provided, will be hashed for signing and may
 * set `content-type`/`content-length` if missing.
 * @param {Object.<string,string|number|boolean>} headers Mutable headers object to sign; updated in-place.
 * @param {Object} [credentials] AWS credentials to use; defaults to `aws` when not provided.
 * @param {string} credentials.key AWS access key id.
 * @param {string} credentials.secret AWS secret access key.
 * @param {string} [credentials.token] AWS session token (for temporary credentials); sets `x-amz-security-token`.
 * @param {Object} [options] Optional output/input options.
 * @param {Date} [options.now] Overrides current time used for signing.
 * @param {string} [options.signedHeaders] Output: semicolon-separated list of signed header names.
 * @param {string} [options.credential] Output: credential scope string (`<accessKeyId>/<scope>`).
 * @param {string} [options.canonStr] Output: canonical request string used for signing.
 * @param {string} [options.signature] Output: computed signature hex string.
 * @returns {void}
 */
aws.querySign = function(region, service, host, method, path, body, headers, credentials, options)
{
    if (!credentials) credentials = this;
    var now = util.types.isDate(options?.now) ? options.now : new Date();
    var isoDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    var date = isoDate.substr(0, 8);

    headers.host = host;
    headers['x-amz-date'] = isoDate;
    if (body && !headers['content-type']) headers['content-type'] = 'application/x-www-form-urlencoded; charset=utf-8';
    if (body && !lib.toNumber(headers['content-length'])) headers['content-length'] = Buffer.byteLength(body, 'utf8');
    if (credentials.token) headers["x-amz-security-token"] = credentials.token;
    delete headers.Authorization;

    function trimAll(header) { return header.toString().trim().replace(/\s+/g, ' '); }
    var hash = headers["x-amz-content-sha256"] || lib.hash(body || '', "sha256", "hex");
    var credStr = [ date, region, service, 'aws4_request' ].join('/');
    var pathParts = path.split('?', 2);
    var signedHeaders = Object.keys(headers).map((key) => (key.toLowerCase())).sort().join(';');
    var canonHeaders = Object.keys(headers).sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1)).map((key) => (key.toLowerCase() + ':' + trimAll(String(headers[key])))).join('\n');
    var canonStr = [ method, this.uriEscapePath(pathParts[0]), pathParts[1] || '', canonHeaders + '\n', signedHeaders, hash].join('\n');
    var strToSign = [ 'AWS4-HMAC-SHA256', isoDate, credStr, lib.hash(canonStr, "sha256", "hex") ].join('\n');

    var sigKey = lib.sign(credentials.secret, credentials.key + "," + credStr, "sha256", "hex");
    var kCredentials = this._sigCache.map[sigKey];
    if (!kCredentials) {
        var kDate = lib.sign('AWS4' + credentials.secret, date, "sha256", "binary");
        var kRegion = lib.sign(kDate, region, "sha256", "binary");
        var kService = lib.sign(kRegion, service, "sha256", "binary");
        kCredentials = lib.sign(kService, 'aws4_request', "sha256", "binary");
        this._sigCache.map[sigKey] = kCredentials;
        this._sigCache.list.push(sigKey);
        if (this._sigCache.list.length > 25) delete this._sigCache.map[this._sigCache.list.shift()];
    }
    var sig = lib.sign(kCredentials, strToSign, "sha256", "hex");
    headers.Authorization = [ 'AWS4-HMAC-SHA256 Credential=' + credentials.key + '/' + credStr, 'SignedHeaders=' + signedHeaders, 'Signature=' + sig ].join(', ');
    if (options) {
        options.date = isoDate;
        options.signedHeaders = signedHeaders;
        options.credential = credentials.key + '/' + credStr;
        options.canonStr = canonStr;
        options.signature = sig;
    }
}

/**
 * Return a request object ready to be sent to AWS, properly formatted.
 *
 * Builds a base request with `{ Action, Version }`, copies all enumerable properties from `obj`,
 * then overlays any `options` properties whose names start with an uppercase letter (A-Z).
 * Uppercase `options` keys take priority and overwrite same-named keys from `obj`.
 * `options` keys are only applied if their value is not `undefined`, `null`, or an empty string.
 *
 * @function queryPrepare
 * @param {string} action - AWS API action name (e.g. `"DescribeInstances"`).
 * @param {string} version - AWS API version string (e.g. `"2016-11-15"`).
 * @param {Object<string, *>} obj - Request parameters to include in the AWS query.
 * @param {Object<string, *>} [options] - Extra parameters; any keys starting with A-Z are copied as-is and override `obj`.
 * @returns {Object<string, *>} Request object ready to be sent to AWS.
 */
aws.queryPrepare = function(action, version, obj, options)
{
    var req = { Action: action, Version: version };
    for (const p in obj) req[p] = obj[p];
    // All capitalized options are passed as is and take priority because they are in native format
    for (const p in options) {
        if (p[0] >= 'A' && p[0] <= 'Z' && typeof options[p] != "undefined" && options[p] !== null && options[p] !== "") {
            req[p] = options[p];
        }
    }
    return req;
}

aws.queryOptions = function(method, data, headers, options)
{
    return {
        method: method || options?.method || "POST",
        query: options?.query,
        qsopts: options?.qsopts,
        postdata: data,
        headers: headers,
        quiet: options?.quiet,
        retryCount: options?.retryCount,
        retryTimeout: options?.retryTimeout,
        retryOnError: options?.retryOnError,
        httpTimeout: options?.httpTimeout,
        credentials: options?.credentials,
    };
}

// It is called in the context of a http request
aws.querySigner = function()
{
    aws.querySign(this.region, this.endpoint, this.hostname, this.method, this.path, this.postdata, this.headers, this.credentials);
}

/**
 * Make AWS request, return parsed response as Javascript object or null in case of error
 * @memberof module:aws
 * @method queryAWS
 * @param {string} region - The AWS region (e.g., 'us-east-1').
 * @param {string} service - The AWS service name (e.g., 's3', 'ec2').
 * @param {string} proto - The protocol to use (e.g., 'https:', 'http:').
 * @param {string} host - The hostname for the request.
 * @param {string} path - The path for the request.
 * @param {object} obj - The object containing key-value pairs to be sent as parameters.
 * @param {object} options - Additional options for the query.
 * @param {function} callback - The callback function to handle the response.
 */
aws.queryAWS = function(region, service, proto, host, path, obj, options, callback)
{
    var headers = {}, params = [], postdata = "";
    for (var p in obj) {
        if (typeof obj[p] != "undefined" && obj[p] !== null && obj[p] !== "") params.push([p, obj[p]]);
    }
    params.sort();
    for (var i = 0; i < params.length; i++) {
        postdata += (i ? "&" : "") + params[i][0] + "=" + lib.encodeURIComponent(params[i][1]);
    }
    var opts = this.queryOptions("POST", postdata, headers, options);
    opts.region = region;
    opts.endpoint = service;
    opts.signer = this.querySigner;
    opts.action = obj.Action;
    logger.debug(opts.action, host, path, opts);
    this.fetch(url.format({ protocol: proto, host: host, pathname: path }), opts, (err, params) => {
        // For error logging about the current request
        params.Action = obj;
        aws.parseXMLResponse(err, params, options, callback);
    });
}

/**
 * AWS generic query interface
 * @param {string} service - AWS service name
 * @param {string} version - Service version
 * @param {string} action - API-specific action to perform (e.g., `DescribeStacks`, `CreateStack`).
 * @param {Object} obj - API-specific parameters as an object.
 * @param {Object} options - Optional configuration object
 * @param {string} [options.region] - AWS region (e.g., `"us-east-1"`).
 * @param {number} [options.retryTimeout] - Request timeout in milliseconds.
 * @param {number} [options.retryCount] - Max request retries
 * @param {Function} callback - Callback function with:
 *   signature `(err, data)` where:
 *   - `err`: Error object if request fails.
 *   - `data`: Response object from AWS.

 * @memberof module:aws
 * @method queryEndpoint
 */
aws.queryEndpoint = function(service, version, action, obj, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    // Limit to the suppported region per endpoint
    var region = this.getServiceRegion(service, options?.region || this.region || 'us-east-1');
    // Specific endpoint url if it is different from the common endpoint.region.amazonaws.com
    var e = options?.endpoint ? URL.parse(String(options.endpoint)) :
            this.endpoints[service + "-" + region] ? url.parse(this.endpoints[service + "-" + region]) :
            this.endpoints[service] ? URL.parse(this.endpoints[service]) :
            lib.empty;
    var proto = options?.endpoint_protocol || e?.protocol || 'https';
    var host = options?.endpoint_host || (e?.host || e?.hostname) || (service + '.' + region + '.amazonaws.com');
    var path = options?.endpoint_path || (e?.path || e?.pathanme) || '/';
    var req = this.queryPrepare(action, version, obj, options);
    this.queryAWS(region, service, proto, host, path, req, options, callback);
}

/**
 * Executes an AWS service query for the specified action
 * @memberof module:aws
 * @method queryService
 * @param {string} endpoint - AWS service endpoint (e.g., 'asm', 'ecr', ...)
 * @param {string} target - Namespace for the AWS service API (e.g., 'AmazonSSM', 'CertificateManager')
 * @param {string} action - AWS API action to perform (e.g., 'PutItem', 'GetItem')
 * @param {Object} obj - Request body object containing action parameters
 * @param {Object} [options] - Optional configuration options:
 *   - region {string} AWS region, overrides library/default region
 *   - [other fetch options] (retryTimeout, retryCount, etc., see {@link module:lib.fetch})
 * @param {Function} callback - Callback function with signature:
 *   (err, response) where err contains the error (if any) and response contains:
 *   - status {number} HTTP status code
 *   - obj {Object} Parsed API response object or entire raw response
 * @example
 * aws.queryService("ecs", "AmazonEC2ContainerServiceV20141113", 'DescribeTasks', {
 *     cluster: 'MyCluster',
 *   }, (err, response) => { ... });
 */
aws.queryService = function(endpoint, target, action, obj, options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    var headers = { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': target + "." + action };
    var opts = this.queryOptions("POST", lib.stringify(obj), headers, options);
    opts.region = this.getServiceRegion(endpoint, options?.region || this.region || 'us-east-1');
    opts.action = action;
    opts.endpoint = endpoint;
    opts.signer = this.querySigner;
    logger.debug(opts.action, opts);
    this.fetch(`https://${endpoint}.${opts.region}.amazonaws.com/`, opts, (err, params) => {
        if (params.status != 200) err = aws.parseError(params, options);
        if (typeof callback == "function") callback(err, params.obj);
    });
}
