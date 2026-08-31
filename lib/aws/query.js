/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
'use strict';

const util = require('node:util');
const url = require('node:url');
const logger = require(__dirname + '/../logger');
const lib = require(__dirname + '/../lib');
const aws = require(__dirname + '/../aws');

/**
 * Internal wrapper around {@link module:lib.fetch} that applies per-service default retry settings.
 * @memberof module:aws
 * @method fetch
 * @param {string} url - request URL
 * @param {object} options - fetch options (endpoint, action, retryCount...)
 * @param {function} callback - `(err, request)`
 */
aws.fetch = function(url, options, callback)
{
    if (!options.retryCount) options.retryCount = this.retryCount[options.endpoint];
    if (!options.retryOnError && options.retryCount) options.retryOnError = aws.retryOnError;

    logger.debug(options.action, options.endpoint, url, options);
    lib.fetch(url, options, callback);
}

/**
 * Default retry predicate, called in the context of a request; retries on throttling/unavailable errors.
 * @memberof module:aws
 * @method retryOnError
 * @returns {boolean} true if the request should be retried
 */
aws.retryOnError = function()
{
    return /ServiceUnavailable|ThrottlingException|RequestThrottled/.test(this.data)
}

/**
 * Extract an Error object from a parsed AWS response, honouring `req.ignore_error`.
 * @memberof module:aws
 * @method parseError
 * @param {object} req - the request object with parsed `obj`, `status`, `data`
 * @returns {Error|undefined} the error, or undefined if ignored
 */
aws.parseError = function(req)
{
    var err;

    if (req.obj) {
        const error = req.obj.Response?.Errors?.Error;
        if (error?.Message) {
            err = lib.newError({ message: error.Message, code: error.Code || error.Type, status: req.status });
        } else

        if (req.obj.ErrorResponse?.Error?.Message) {
            const { Message, Code, Type } = req.obj.ErrorResponse.Error;
            err = lib.newError({ message: Message, code: Code || Type, status: req.status });
        } else

        if (req.obj.Error?.Message) {
            const { Message, Code, Type } = req.obj.Error;
            err = lib.newError({ message: Message, code: Code || Type, status: req.status });
        } else

        if (req.obj.__type || req.obj.Type || req.obj.code) {
            const code = lib.split(req.obj.__type || req.obj.Type || req.obj.code, "#").pop();
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
    logger.dev("parseError:", aws.name, req, err);
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
    req.logger(err ? req.logger_error || "error" : "debug", "queryEndpoint:", req.postdata, req.data);
    if (typeof callback === "function") callback(err, req.obj, req);
}

/**
 * URI-escape a string per AWS Signature V4 rules.
 * @memberof module:aws
 * @method uriEscape
 * @param {string} str - string to escape
 * @returns {string} the escaped string
 */
aws.uriEscape = function(str)
{
    str = encodeURIComponent(str);
    str = str.replace(/[^A-Za-z0-9_.~\-%]+/g, escape);
    return str.replace(/[!'()*]/g, (ch) => ('%' + ch.charCodeAt(0).toString(16).toUpperCase()));
}

/**
 * URI-escape each segment of a path per AWS Signature V4 rules.
 * @memberof module:aws
 * @method uriEscapePath
 * @param {string} path - the path to escape
 * @returns {string} the escaped path
 */
aws.uriEscapePath = function(path)
{
    return path ? String(path).split('/').map(aws.uriEscape).join('/') : "/";
}

/**
 * Return a region supported by the service, falling back to the first supported region if needed.
 * @memberof module:aws
 * @method getServiceRegion
 * @param {string} service - service endpoint name
 * @param {string} region - desired region
 * @returns {string} the region to use
 */
aws.getServiceRegion = function(service, region)
{
    return this.regions[service] && this.regions[service].indexOf(region) === -1 ? this.regions[service][0] : region;
}

/**
 * Copy region/endpoint/credentials properties from options into the target object.
 * @memberof module:aws
 * @method getServiceCredentials
 * @param {object} obj - destination object
 * @param {object} options - source options
 * @returns {object} the destination object
 */
aws.getServiceCredentials = function(obj, options)
{
    for (const p in options) {
        if (/^(region|endpoint|credentials|endpoint_(protocol|host|path))$/.test(p)) {
            obj[p] = options[p];
        }
    }
    return obj;
}

/**
 * Build a {@link module:lib.fetch} options object by merging service request fields and user options.
 * @memberof module:aws
 * @method getServiceOptions
 * @param {object} obj - service request descriptor
 * @param {object} options - user options
 * @returns {object} the fetch options
 */
aws.getServiceOptions = function(obj, options)
{
    return {
        method: obj?.method || options?.method || "POST",
        query: obj?.query || options?.query,
        postdata: obj?.postdata,
        headers: obj?.headers || Object.create(null),
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
    const now = util.types.isDate(options?.now) ? options.now : new Date();
    const isoDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const date = isoDate.substr(0, 8);

    if (!credentials) credentials = this;

    headers.host = host;
    headers['x-amz-date'] = isoDate;
    if (body && !headers['content-type']) headers['content-type'] = 'application/x-www-form-urlencoded; charset=utf-8';
    if (body && !lib.toNumber(headers['content-length'])) headers['content-length'] = Buffer.byteLength(body, 'utf8');
    if (credentials.token) headers["x-amz-security-token"] = credentials.token;
    delete headers.Authorization;

    function trimAll(header) { return header.toString().trim().replace(/\s+/g, ' '); }
    const hash = headers["x-amz-content-sha256"] || lib.hash(body || '', "sha256", "hex");
    const credStr = [ date, region, service, 'aws4_request' ].join('/');
    const pathParts = path.split('?', 2);
    const signedHeaders = Object.keys(headers).map((key) => (key.toLowerCase())).sort().join(';');
    const canonHeaders = Object.keys(headers).sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1)).map((key) => (key.toLowerCase() + ':' + trimAll(String(headers[key])))).join('\n');
    const canonStr = [ method, this.uriEscapePath(pathParts[0]), pathParts[1] || '', canonHeaders + '\n', signedHeaders, hash].join('\n');
    const strToSign = [ 'AWS4-HMAC-SHA256', isoDate, credStr, lib.hash(canonStr, "sha256", "hex") ].join('\n');

    const sigKey = lib.sign(credentials.secret, credentials.key + "," + credStr, "sha256", "hex");
    let kCredentials = this._sigCache.map[sigKey];
    if (!kCredentials) {
        const kDate = lib.sign('AWS4' + credentials.secret, date, "sha256", "binary");
        const kRegion = lib.sign(kDate, region, "sha256", "binary");
        const kService = lib.sign(kRegion, service, "sha256", "binary");
        kCredentials = lib.sign(kService, 'aws4_request', "sha256", "binary");
        this._sigCache.map[sigKey] = kCredentials;
        this._sigCache.list.push(sigKey);
        if (this._sigCache.list.length > 25) delete this._sigCache.map[this._sigCache.list.shift()];
    }
    const sig = lib.sign(kCredentials, strToSign, "sha256", "hex");
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
 * Default request signer, called in the context of an HTTP request to apply Signature V4 headers.
 * @memberof module:aws
 * @method signer
 */
aws.signer = function()
{
    aws.signQuery(this.region || aws.region, this.service || this.endpoint, this.hostname, this.method, this.path, this.postdata, this.headers, this.credentials);
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
 *   signature `(err, data, request)` where:
 *   - `err`: Error object if request fails.
 *   - `data`: Response object from AWS.
 *   - `request`: Full fetch Request object
 * @memberof module:aws
 * @method queryEndpoint
 */
aws.queryEndpoint = function(endpoint, version, action, obj, options, callback)
{
    if (typeof options === "function") callback = options, options = null;

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
 * Async version of {@link module:aws.queryEndpoint}
 * @returns {Promise(object)} - { err, data, request }
 * @async
 * @memberof module:aws
 * @method aqueryEndpoint
 */
aws.aqueryEndpoint = function(endpoint, version, action, obj, options)
{
    return new Promise((resolve, _reject) => {
        aws.queryEndpoint(endpoint, version, action, obj, options, (err, data, request) => {
            resolve({ err, data, request })
        })
    })
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
 * @param {string} [req.json] - amz-json version, default is 1.1, old services use 1.0
 * @param {Object} obj - Request body object containing action parameters
 * @param {Object} [options] - Optional configuration options:
 *   - region {string} AWS region, overrides library/default region
 *   - [other fetch options] (retryTimeout, retryCount, etc., see {@link module:lib.fetch})
 * @param {Function} callback - Callback function with signature:  (err, obj, request) where
 *   - err contains the error (if any)
 *   - obj {Object} Parsed API response object
 *   - request - full request object from lib.fetch
 * @example
 * aws.queryService({
 *     endpoint: "ecs",
 *     target: "AmazonEC2ContainerServiceV20141113",
 *     action: 'DescribeTasks' },
 *    { cluster: 'MyCluster' }, (err, response) => { ... });
 */
aws.queryService = function(req, obj, options, callback)
{
    if (typeof options === "function") callback = options, options = null;

    const region = this.getServiceRegion(req.endpoint, options?.region || this.region || 'us-east-1');

    // Specific endpoint url if it is different from the common endpoint.region.amazonaws.com
    const u = URL.parse(lib.isString(options?.endpoint) ||
                        lib.isString(this.endpoints[req.endpoint + "-" + region]) ||
                        lib.isString(this.endpoints[req.endpoint]));

    const protocol = options?.endpoint_protocol || u?.protocol || 'https';
    const host = options?.endpoint_host || u?.host || (req.endpoint + '.' + region + '.amazonaws.com');
    const pathname = req.path || options?.endpoint_path || u?.pathanme || '/';

    const headers = req.headers || Object.create(null);

    if (!headers['content-type']) {
        headers['content-type'] = `application/x-amz-json-${req.json || 1.1}; charset=utf-8`
    }
    if (req.target && req.action) {
        headers['x-amz-target'] = req.target + "." + req.action;
    }

    // All capitalized options are passed as is and take priority because they are in native format
    if (req.native) {
        for (const p in options) {
            if (p[0] >= 'A' && p[0] <= 'Z') {
                obj[p] = options[p];
            }
        }
    }
    const opts = this.getServiceOptions(Object.assign({ region, headers, postdata: lib.stringify(obj) }, req), options);

    this.fetch(url.format({ protocol, host, pathname }), opts, (err, rc) => {
        if (rc.status < 200 || rc.status >= 399) err = aws.parseError(rc);
        rc.logger(err ? rc.logger_error || "error" : "debug", "queryService:", err, "postdata:", rc.postdata, "data:", rc.data);
        if (typeof callback === "function") callback(err, rc.obj, rc);
    });
}

/**
 * Async version of {@link module:aws.queryService}
 * @returns {Promise(object)} - { err, data, request }
 * @async
 * @memberof module:aws
 * @method aqueryService
 */
aws.aqueryService = function(req, obj, options)
{
    return new Promise((resolve, _reject) => {
        aws.queryService(req, obj, options, (err, data, request) => {
            resolve({ err, data, request })
        })
    })
}
