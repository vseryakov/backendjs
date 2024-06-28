//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const util = require('util');
const url = require('url');
const logger = require(__dirname + '/../logger');
const core = require(__dirname + '/../core');
const lib = require(__dirname + '/../lib');
const aws = require(__dirname + '/../aws');

aws.httpGet = function(url, options, callback)
{
    if (!options.retryCount) options.retryCount = this.retryCount[options.endpoint];
    if (!options.retryOnError && options.retryCount) options.retryOnError = 1;
    core.httpGet(url, options, callback);
}

aws.parseError = function(params, options)
{
    var err;
    if (params.obj) {
        var errors = lib.objGet(params.obj, "Response.Errors.Error", { list: 1 });
        if (errors.length && errors[0].Message) {
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
    if (options?.ignore_error) {
        if (!lib.isArray(options.ignore_error) || lib.isFlag(options.ignore_error, err.code)) err = null;
    }
    return err;
}

// Parse AWS response and try to extract error code and message, convert XML into an object.
aws.parseXMLResponse = function(err, params, options, callback)
{
    if (!err && params.data) {
        if (!params.obj) params.obj = lib.xmlParse(params.data);
        if (params.status < 200 || params.status >= 400) {
            err = this.parseError(params, options);
            if (err) logger.errorWithOptions(err, options, 'queryAWS:', params.Action, err, params.toJSON(options?.debug_error));
        } else {
            logger.debug('queryAWS:', params.href, params.search, params.Action || "", params.obj, params.toJSON());
        }
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

// Build version 4 signature headers
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

// Return a request object ready to be sent to AWS, properly formatted
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

// Make AWS request, return parsed response as Javascript object or null in case of error
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
    this.httpGet(url.format({ protocol: proto, host: host, pathname: path }), opts, (err, params) => {
        // For error logging about the current request
        params.Action = obj;
        aws.parseXMLResponse(err, params, options, callback);
    });
}

// AWS generic query interface
aws.queryEndpoint = function(service, version, action, obj, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    // Limit to the suppported region per endpoint
    var region = this.getServiceRegion(service, options?.region || this.region || 'us-east-1');
    // Specific endpoint url if it is different from the common endpoint.region.amazonaws.com
    var e = options?.endpoint ? url.parse(String(options.endpoint)) :
            this.endpoints[service + "-" + region] ? url.parse(this.endpoints[service + "-" + region]) :
            this.endpoints[service] ? url.parse(this.endpoints[service]) :
            lib.empty;
    var proto = options?.endpoint_protocol || e.protocol || 'https';
    var host = options?.endpoint_host || (e.host || e.hostname) || (service + '.' + region + '.amazonaws.com');
    var path = options?.endpoint_path || (e.path || e.pathanme) || '/';
    var req = this.queryPrepare(action, version, obj, options);
    this.queryAWS(region, service, proto, host, path, req, options, callback);
}

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
    this.httpGet(`https://${endpoint}.${opts.region}.amazonaws.com/`, opts, function(err, params) {
        if (params.status != 200) err = aws.parseError(params, options);
        if (typeof callback == "function") callback(err, params.obj);
    });
}
