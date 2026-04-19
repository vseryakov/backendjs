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
    if (!options.retryOnError && options.retryCount) options.retryOnError = aws.retryOnError;

    logger.debug(options.action, options.endpoint, url, options);
    lib.fetch(url, options, callback);
}

aws.retryOnError = function()
{
    return /ServiceUnavailable|ThrottlingException|RequestThrottled/.test(this.data)
}

aws.parseError = function(req)
{
    var err;
    if (req.obj) {
        var errors = req.obj.Response?.Errors?.Error;
        if (errors?.length && errors[0].Message) {
            err = lib.newError({ message: errors[0].Message, code: errors[0].Code, status: req.status });
        } else

        if (req.obj.ErrorResponse?.Error) {
            err = lib.newError({ message: req.obj.ErrorResponse.Error.Message, code: req.obj.ErrorResponse.Error.Code, status: req.status });
        } else

        if (req.obj.Error?.Message) {
            err = lib.newError({ message: req.obj.Error.Message, code: req.obj.Error.Code, status: req.status });
        } else

        if (req.obj.__type || req.obj.code) {
            const code = lib.split(req.obj.__type || req.obj.code, "#").pop();
            err = lib.newError({ message: req.obj.Message || req.obj.message, code, status: req.status });
        }
    }
    if (err && lib.isFunc(req.ignore_error?.test) && req.ignore_error.test(err?.code)) return;

    if (!err) {
        err = lib.newError({ message: "Error " + req.status + " " + req.data, status: req.status });
    }
    if (req.action) {
        err.action = req.action;
    }
    return err;
}

/**
 * Parse AWS response and try to extract error code and message, convert XML into an object.
 * @memberof module:aws
 * @method parseXMLResponse
 */
aws.parseXMLResponse = function(err, req, callback)
{
    if (!err && req.data) {
        if (!req.obj) {
            req.obj = lib.xmlParse(req.data);
        }
        if (req.status < 200 || req.status >= 400) {
            err = this.parseError(req);
        }
    }
    logger.logger(err ? req.logger_error || "error" : "debug", req.action, req.endpoint, req.toJSON(), err);
    if (typeof callback == "function") callback(err, req.obj);
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
aws.getServiceCredentials = function(obj, options)
{
    for (const p in options) {
        if (/^(region|endpoint|credentials|endpoint_(protocol|host|path))$/.test(p)) {
            obj[p] = options[p];
        }
    }
    return obj;
}

// Return options object for the lib.fetch from obj and options
aws.getServiceOptions = function(obj, options)
{
    return {
        method: obj?.method || options?.method || "POST",
        query: obj?.query || options?.query,
        qsopts: options?.qsopts,
        postdata: obj?.postdata,
        headers: obj?.headers || {},
        quiet: options?.quiet,
        logger_error: obj?.logger_error || options?.logger_error,
        ignore_error: obj?.ignore_error || options?.ignore_error,
        retryCount: obj?.retryCount || options?.retryCount,
        retryTimeout: obj?.retryTimeout || options?.retryTimeout,
        retryOnError: obj?.retryOnError || options?.retryOnError,
        httpTimeout: obj?.httpTimeout || options?.httpTimeout,
        credentials: obj?.credentials || options?.credentials,
        signer: obj?.signer || this.signer,
        action: obj?.action,
        service: obj?.service,
        endpoint: obj?.endpoint,
        region: obj?.region,
    };
}


/**
 * Build AWS Signature Version 4 headers for a request.
 *
 * Populates/overwrites required signing headers in `headers` (e.g. `host`, `x-amz-date`,
 * optional `content-type`, `content-length`, `x-amz-security-token`) and sets
 * `headers.Authorization`. If `options` is provided, signing details are also written into it.
 *
 * @memberof module:aws
 * @method signQuery
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
aws.signQuery = function(region, service, host, method, path, body, headers, credentials, options)
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

// It is called in the context of a http request
aws.signer = function()
{
    aws.signQuery(this.region, this.service || this.endpoint, this.hostname, this.method, this.path, this.postdata, this.headers, this.credentials);
}

/**
 * AWS generic query interface
 * @param {string} endpoint - AWS service endpoint (e.g. 'ec2', 'email')
 * @param {string} version - Service version (e.g. `2011-01-02`)
 * @param {string} action - API-specific action to perform (e.g., `DescribeStacks`, `CreateStack`).
 * @param {Object} obj - API-specific parameters as an object.
 * @param {Object} options - Optional configuration object, all capitalized options are passed as is and take
 * priority because they are in native format
 * @param {string} [options.region] - AWS region (e.g., `"us-east-1"`).
 * @param {string} [options.endpoint] - custom endpoint for local env or alternatives
 * @param {number} [options.retryTimeout] - Request timeout in milliseconds.
 * @param {number} [options.retryCount] - Max request retries
 * @param {Function} callback - Callback function with:
 *   signature `(err, data)` where:
 *   - `err`: Error object if request fails.
 *   - `data`: Response object from AWS.

 * @memberof module:aws
 * @method queryEndpoint
 */
aws.queryEndpoint = function(endpoint, version, action, obj, options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    // Limit to the suppported region per endpoint
    const region = this.getServiceRegion(endpoint, options?.region || this.region || 'us-east-1');

    // Specific endpoint url if it is different from the common endpoint.region.amazonaws.com
    const u = URL.parse(lib.isString(options.endpoint) ||
                        lib.isString(this.endpoints[endpoint + "-" + region]) ||
                        lib.isString(this.endpoints[endpoint]));

    const protocol = options?.endpoint_protocol || u?.protocol || 'https';
    const host = options?.endpoint_host || u?.host || (endpoint + '.' + region + '.amazonaws.com');
    const pathname = options?.endpoint_path || u?.pathanme || '/';

    const req = Object.assign({ Action: action, Version: version }, obj);

    for (const p in options) {
        if (p[0] >= 'A' && p[0] <= 'Z') req[p] = options[p];
    }

    const body = [];
    for (const p in req) {
        if (req[p] !== undefined && req[p] !== null && req[p] !== "") {
            body.push(p + "=" + lib.encodeURIComponent(req[p]));
        }
    }

    const opts = this.getServiceOptions({ region, action, endpoint, postdata: body.sort().join("&") }, options);

    this.fetch(url.format({ protocol, host, pathname }), opts, (err, rc) => {
        aws.parseXMLResponse(err, rc, callback);
    });
}

/**
 * Executes an AWS service query for the specified action
 * @memberof module:aws
 * @method queryService
 * @param {object} req
 * @param {string} req.endpoint - AWS service endpoint (e.g., 'asm', 'ecr', ...)
 * @param {string} [req.service] - AWS service to use in the Signature, default is to use endpoint, (e.g. "ses")
 * @param {string} [req.target] - Namespace for the AWS service API (e.g., 'AmazonSSM', 'CertificateManager'),
 * this is sent in the X-Amz-Target header
 * @param {string} [req.action] - AWS API action to perform (e.g., 'PutItem', 'GetItem')
 * @param {string} [req.path] - custom path to use in the request url
 * @param {boolean} [req.native] - capitalized properties from options will be set in the obj, original object is not changed
 * @param {Object} obj - Request body object containing action parameters
 * @param {Object} [options] - Optional configuration options:
 *   - region {string} AWS region, overrides library/default region
 *   - [other fetch options] (retryTimeout, retryCount, etc., see {@link module:lib.fetch})
 * @param {Function} callback - Callback function with signature:  (err, obj, request) where
 *   - err contains the error (if any)
 *   - obj {Object} Parsed API response object
 *   - request - full reques object from lib.fetch
 * @example
 * aws.queryService({
 *     endpoint: "ecs",
 *     target: "AmazonEC2ContainerServiceV20141113",
 *     action: 'DescribeTasks' },
 *    { cluster: 'MyCluster' }, (err, response) => { ... });
 */
aws.queryService = function(req, obj, options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    const region = this.getServiceRegion(req.endpoint, options?.region || this.region || 'us-east-1');

    // Specific endpoint url if it is different from the common endpoint.region.amazonaws.com
    const u = URL.parse(lib.isString(options?.endpoint) ||
                        lib.isString(this.endpoints[req.endpoint + "-" + region]) ||
                        lib.isString(this.endpoints[req.endpoint]));

    const protocol = options?.endpoint_protocol || u?.protocol || 'https';
    const host = options?.endpoint_host || u?.host || (req.endpoint + '.' + region + '.amazonaws.com');
    const pathname = req.path || options?.endpoint_path || u?.pathanme || '/';

    const headers = req.headers || {};

    if (!headers['content-type']) {
        headers['content-type'] = 'application/x-amz-json-1.1; charset=utf-8'
    }
    if (req.target && req.action) {
        headers['x-amz-target'] = req.target + "." + req.action;
    }

    // All capitalized options are passed as is and take priority because they are in native format
    if (req.native) {
        const req = obj;
        for (const p in options) {
            if (p[0] >= 'A' && p[0] <= 'Z') {
                if (req === obj) obj = Object.assign({}, obj);
                obj[p] = options[p];
            }
        }
    }

    const opts = this.getServiceOptions(Object.assign({ region, headers, postdata: lib.stringify(obj) }, req), options);

    this.fetch(url.format({ protocol, host, pathname }), opts, (err, rc) => {
        if (rc.status < 200 || rc.status >= 399) err = aws.parseError(rc);
        logger.logger(err ? rc.logger_error || "error" : "debug", rc.action, rc.endpoint, rc.toJSON(), err);
        if (typeof callback == "function") callback(err, rc.obj, rc);
    });
}
