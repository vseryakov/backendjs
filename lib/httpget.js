//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

var path = require('path');
var fs = require('fs');
var http = require('http');
var https = require('https');
var url = require('url');
var qs = require("qs");
var core = require(__dirname + '/core');
var lib = require(__dirname + '/lib');
var logger = require(__dirname + '/logger');

module.exports = httpGet;

// Downloads file using HTTP and pass it to the callback if provided
//
// - uri can be full URL or an object with parts of the url, same format as in url.format
// - params can contain the following options:
//   - method - GET, POST
//   - headers - object with headers to pass to HTTP request, properties must be all lower case
//   - cookies - an object with cookies to send with request, if even empty rescookies will be set in the response
//   - file - file name where to save response, in case of error response the error body will be saved as well, it uses sync file operations
//   - stream - a writable stream where to save data
//   - formdata - date to be sent with the request as x-www-form-urlencoded
//   - postdata - data to be sent with the request in the body as JSON
//   - postfile - file to be uploaded in the POST body, not as multipart
//   - postsize - file size to be uploaded if obtained separately
//   - posttype - content type for post data
//   - multipart - an array of objects for multipart/form-data post, { name: "..", data: ".." [ file: ".."] }, for files a Buffer can be used in data
//   - noparse - do not parse known content types like json, xml
//   - chunked - post files using chunked encoding
//   - qsopts - an object to be passed to `qs.stringify`
//   - query - additional query parameters to be added to the url as an object or as encoded string
//   - sign - sign request with provided email/secret properties
//   - checksum - 1 if the body needs a checksum in the signature
//   - mtime - a Date or timestamp to be used in conditional requests
//   - conditional - add If-Modified-Since header using `params.mtime` if present or if `file` is given use file last modified timestamp, mtime
//   - httpTimeout - timeout in milliseconds after which the request is aborted if no data received
//   - hardTimeout - abort the request after this amount of time in ms, must be big enough to allow for all data to be received
//   - maxSize - if the content being downloaded becomes greater than this size the request will be aborted
//   - retryCount - how many times to retry the request on error or timeout
//   - retryTimeout - timeout in milliseconds for retries, with every subsequent timeout it will be multiplied by `retryMultiplier`
//   - retryOnError - retry request if received non 2xx response status,
//       if this is a function then it must return true in order to retry the request,
//       otherwise it is treated as a boolean value, if true then retry on all non-2xx responses
//   - retryPrepare - a function to be called before retrying, it can update any parameter, most related: _uri, retryTimeout, retryMultiplier
//   - errorCount - how many times to retry on aborted connections, default is retryCount
//   - noredirects - if true then do not follow redirect locations for 30-[1,2,3,7] statuses
//   - preparse -  a function to be called before parsing the xml/json content, called in the context of the http object
//   - passheaders -  a list of headers to be passed in redirects
//   - user - authorization user, if also `password`` is provided then it will use Basic authorization, if only user is provided then Bearer
// - callback will be called with the arguments:
//     first argument is error object if any
//     second is the params object itself with updated fields
//
// On end, the object params will contain the following updated properties:
//  - data if file was not specified, data will contain collected response body as string
//  - obj - if the content type is a known type like json or xml this property will hold a reference to the parsed document or null in case or parse error
//  - status - HTTP response status code
//  - date - Date object with the last modified time of the requested file
//  - resheaders - response headers as an object
//  - rescookies - parsed cookies from the response if request `cookies`` is not empty
//  - size - size of the response body or file
//  - type - response content type
//
// Note: SIDE EFFECT: the params object is modified in place so many options will be changed/removed or added
function httpGet(uri, params, callback)
{
    logger.dev("httpGet:", core.role, uri, params, callback);
    if (typeof params == "function") callback = params, params = null;

    if (!(params instanceof HttpRequest)) {
        logger.dev("httpNew:", core.role, uri, params, callback);
        params = new HttpRequest(params);
    }

    params.init(uri);
    var opts = params.open(callback);
    if (!opts) return;

    try {
        var mod = opts.protocol == "https:" ? https : http;
        var req = mod.request(opts, (res) => {
            if (!this.binary) res.setEncoding("utf8")
            res.on("data", (chunk) => {
                params.onData(res, chunk);
            });
            res.on("end", () => {
                params.onEnd(res, callback);
            });
            res.on("close", () => {
                if (!res.complete) params.onEnd(res, callback);
            });
        });
        req.on('error', (err) => {
            params.onError(err, callback);
        });
        req.on("timeout", () => {
            req.destroy(lib.newError("timeout", 529, "ETIMEDOUT"));
        });
        req.once('response', () => {
          params.ip = req.socket?.localAddress;
        });
    } catch (e) {
        return params.onError(e, callback);
    }
    if (params.hardTimeout) {
        params._timer = setTimeout(() => { req.destroy(lib.newError("timeout", 529, "ETIMEDOUT")) }, params.hardTimeout);
    }
    if (params.postdata) {
        req.write(params.postdata);
    } else
    if (params.poststream) {
        params.poststream.pipe(req);
        return req;
    }
    req.end();
    return req;
}

function HttpRequest(options)
{
    for (const p in options) this[p] = options[p];
    return this;
}

HttpRequest.prototype.init = function(uri)
{
    this._done = 0;
    this._uri = uri;
    var qtype = lib.typeName(this.query);
    switch (lib.typeName(uri)) {
    case "object":
        uri = url.format(uri);
        break;

    default:
        uri = String(uri);
        var q = qtype == "object" ? qs.stringify(this.query, this.qsopts) : qtype == "string" ? this.query : "";
        if (!q) break;
        uri += (uri.indexOf("?") == -1 ? "?" : "") + (q[0] == "&" ? "" : "&") + q;
    }

    this.uri = uri;
    this.size = 0;
    this.err = null;
    this.fd = 0;
    this.status = 0;
    this.poststream = null;
    this.date = null;
    this.obj = null;
    this.method = this.method || 'GET';
    this.headers = this.headers || {};
    this.resheaders = {};
    this.stime = Date.now();
    this.data = this.binary ? Buffer.alloc(0) : '';
    this.redirects = lib.toNumber(this.redirects, { min: 0 });
    this.retryCount = lib.toNumber(this.retryCount, { min: 0 });
    this.retryTotal = this.retryTotal || this.retryCount;
    this.retryTimeout = lib.toNumber(this.retryTimeout, { min: 0, dflt: 500 });
    this.retryMultiplier = lib.toNumber(this.retryMultiplier, { min: 1, dflt: 2 });
    this.httpTimeout = lib.toNumber(this.httpTimeout, { min: 0, dflt: 60000 });
    this.hardTimeout = lib.toNumber(this.hardTimeout, { min: 0 });
    this.warnTimeout = lib.toNumber(this.warnTimeout, { min: 0, dflt: 30000 });
    this.errorCount = lib.toNumber(this.errorCount, { min: 0, dflt: this.retryCount });
}

HttpRequest.prototype.open = function(callback)
{
    var opts = url.parse(this.uri);
    opts.method = this.method;
    opts.headers = this.headers;
    opts.agent = this.agent || null;
    opts.rejectUnauthorized = false;
    opts.timeout = this.httpTimeout;
    if (!opts.hostname) {
        opts.hostname = "localhost";
        opts.protocol = "http:";
        opts.port = core.port;
    }

    var cols = ["protocol","href","path","pathname","host","hostname","search"];
    for (const i in cols) this[cols[i]] = opts[cols[i]];
    for (const p in this.headers) if (lib.isEmpty(this.headers[p])) delete this.headers[p];

    // Use file name from the url when only the path is given
    if (this.file && this.file[this.file.length - 1] == "/") {
        this.file += path.basename(this.pathname);
    }

    if (!this.headers['user-agent']) {
        this.headers['user-agent'] = core.name + "/" + core.version + " " + core.appVersion;
    }
    if (this.method == "POST" && !this.headers["content-type"]) {
        this.headers["content-type"] = this.posttype || "application/x-www-form-urlencoded";
    }
    if (!this.headers.accept) {
        this.headers.accept = '*/*';
    }
    if (this.user) {
        if (this.password) {
            this.headers.authorization = "Basic " + Buffer.from(this.user + ":" + this.password).toString("base64");
        } else {
            this.headers.authorization = "Bearer " + this.user;
        }
    }
    if (this.cookies) {
        this.headers.cookie = lib.objKeys(this.cookies).map((x) => (x + "=" + this.cookies[x])).join("; ");
    }

    if (!this.prepare(callback)) return null;
    opts.method = this.method;

    // Set again if possibly changed
    for (const i in cols) this[cols[i]] = opts[cols[i]];

    logger.dev("httpOpen:", core.role, this.method, this.uri, "HDR:", this.headers, "POST:", this.postsize, this.postdata);

    return opts;
}

HttpRequest.prototype.prepare = function(callback)
{
    // Data to be sent over in the body
    if (!this.preparePost(callback)) return;

    // Conditional, time related
    if (!this.prepareConditional(callback)) return;

    // Make sure our data is not corrupted
    if (this.checksum) {
        this.checksum = this.postdata ? lib.hash(this.postdata) : null;
    }
    if (typeof this.signer == "function") {
        this.signer.call(this);
    }
    return true;
}

HttpRequest.prototype.preparePost = function(callback)
{
    switch (lib.typeName(this.formdata)) {
    case "object":
    case "array":
        this.method = "POST";
        this.postdata = qs.stringify(this.formdata, this.qsopts);
        this.headers['content-type'] = "application/x-www-form-urlencoded";
        break;
    }
    if (lib.isArray(this.multipart)) {
        this.boundary = lib.uuid();
        var buf = [];
        for (const i in this.multipart) {
            var part = this.multipart[i];
            if (!part || !part.name) continue;
            var data = `--${this.boundary}\r\nContent-Disposition: form-data; name="${part.name}"`;
            data += part.file ? `; filename="${path.basename(part.file)}"\r\n` : "\r\n";
            if (Buffer.isBuffer(part.data)) {
                data += `Content-Type: ${part.type || "application/octet-stream"}\r\n\r\n`;
                buf.push(Buffer.from(data));
                buf.push(part.data);
                buf.push(Buffer.from(`\r\n`));
            } else {
                data += `\r\n${part.data || ""}\r\n`;
                buf.push(Buffer.from(data));
            }
        }
        buf.push(Buffer.from(`--${this.boundary}--`));
        this.method = "POST";
        this.postdata = Buffer.concat(buf);
        this.headers["content-type"] = `multipart/form-data; boundary=${this.boundary}`;
        this.headers['content-length'] = this.postdata.length;
    } else
    if (this.postdata) {
        switch (lib.typeName(this.postdata)) {
        case "string":
            this.headers['content-length'] = Buffer.byteLength(this.postdata, 'utf8');
            break;
        case "buffer":
            this.headers['content-length'] = this.postdata.length;
            break;
        case "object":
        case "array":
            this.postdata = lib.stringify(this.postdata);
            this.headers['content-type'] = "application/json; charset=utf-8";
            this.headers['content-length'] = Buffer.byteLength(this.postdata, 'utf8');
            break;
        default:
            this.postdata = String(this.postdata);
            this.headers['content-length'] = Buffer.byteLength(this.postdata, 'utf8');
        }
    } else
    if (this.postfile) {
        if (this.method == "GET") this.method = "POST";
        if (this.chunked) {
            this.headers['transfer-encoding'] = 'chunked';
        } else {
            if (typeof this.postsize != "number") {
                fs.stat(this.postfile, (err, stats) => {
                    if (err) return callback(err, this);
                    this.mtime = stats.mtime.getTime();
                    this.postsize = stats.size;
                    httpGet(this.uri, this, callback);
                });
                return;
            }
            this.headers['content-length'] = this.postsize;
        }
        this.poststream = fs.createReadStream(this.postfile);
        this.poststream.on("error", function(err) { logger.error('httpStream:', err.stack) });
    }
    return true;
}

HttpRequest.prototype.prepareConditional = function(callback)
{
    if (this.conditional) {
        delete this.conditional;
        if (this.mtime) {
            this.headers["if-modified-since"] = lib.toDate(this.mtime).toUTCString();
        } else

        if (this.file) {
            fs.stat(this.file, (err, stats) => {
                if (!err && stats.size > 0) {
                    this.mtime = stats.mtime.getTime();
                    this.headers["if-modified-since"] = lib.toDate(this.mtime).toUTCString();
                }
                httpGet(this.uri, this, callback);
            });
            return;
        }
    }
    return true;
}

HttpRequest.prototype.onData = function(res, chunk)
{
    if (this.stream) {
        this.writeStream(res, chunk);
    } else
    if (this.file) {
        this.writeFile(res, chunk);
    } else
    if (this.binary) {
        this.data = Buffer.concat([this.data, chunk]);
    } else {
        this.data += chunk.toString();
    }
    this.size += chunk.length;
    logger.dev("httpData:", core.role, this.toJSON());
    if (this.maxSize > 0 && this.size > this.maxSize) res.req.abort();
}

HttpRequest.prototype.writeStream = function(res, chunk)
{
    try {
        this.stream.write(chunk);
    } catch (e) {
        this.err = e;
        res.req.abort();
    }
}

HttpRequest.prototype.writeFile = function(res, chunk)
{
    try {
        if (!this.fd && res.statusCode >= 200 && res.statusCode < 300) {
            this.fd = fs.openSync(this.file, 'w');
        }
        if (this.fd) {
            fs.writeSync(this.fd, chunk, 0, chunk.length, null);
        }
    } catch (e) {
        logger.error("httpWriteFile:", core.role, e, this.toJSON());
        this.err = e;
        res.req.abort();
    }
}

HttpRequest.prototype.onError = function(err, callback)
{
    this.close();
    if (this._done) return;
    if (!this.quiet) logger.logger(this.errorCount ? "debug" : "error", "httpError:", err, this.toJSON({ query: 1, postdata: 256, data: 256 }));

    if (this.errorCount-- > 0) {
        this.lastError = err;
        if (typeof this.retryPrepare == "function") this.retryPrepare.call(this);
        setTimeout(httpGet.bind(null, this._uri, this, callback), lib.objMult(this, "retryTimeout", this.retryMultiplier, "old"));
        if (this.warnTimeout && this.retryTimeout >= this.warnTimeout) logger.warn("httpRetry:", err, this.toJSON({ query: 1, postdata: 256, data: 256 }));
    } else {
        err.status = this.status = this._done = 529;
        if (typeof callback == "function") callback(err, this);
    }
}

HttpRequest.prototype.onEnd = function(res, callback)
{
    this.close();
    if (this._done) return;
    logger.dev("httpEnd:", this.toJSON({ postdata: 256, data: 256 }));

    var headers = this.resheaders = res.headers || {};
    this.status = res.statusCode || 0;
    this.type = (headers['content-type'] || '').split(';')[0];
    this.date = headers.date ? lib.toDate(headers.date) : null;
    if (!this.size) this.size = lib.toNumber(headers['content-length'] || 0);
    if (this.cookies) this.rescookies = core.parseCookies(headers["set-cookie"]);

    // Retry the same request on status codes configured explicitely
    if ((this.status < 200 || this.status >= 400) &&
        ((typeof this.retryOnError == "function" && this.retryOnError.call(this)) || lib.toBool(this.retryOnError)) &&
        this.retryCount-- > 0) {
        this.lastError = `${this.status}: ${this.data}`;
        if (!this.quiet) logger.debug("httpRetry:", this.toJSON({ query: 1, postdata: 256, data: 256 }));
        if (typeof this.retryPrepare == "function") this.retryPrepare.call(this);
        setTimeout(httpGet.bind(null, this._uri, this, callback), lib.objMult(this, "retryTimeout", this.retryMultiplier, "old"));
        if (this.warnTimeout && this.retryTimeout >= this.warnTimeout) logger.warn("httpRetry:", this.toJSON({ query: 1, postdata: 256, data: 256 }));
        this._done = this.status || 1;
        return;
    }
    if (this.checkRedirect(callback)) return;

    // If the contents are encrypted, decrypt before processing content type
    if (headers['content-encoding'] == "encrypted" && this.secret) {
        this.data = lib.decrypt(this.secret, this.data);
    }

    if (typeof this.preparse == "function") this.preparse.call(this);

    // Parse JSON and store in the params, set error if cannot be parsed, the caller will deal with it
    if (this.data && !this.noparse) {
        var opts = { datatype: this.datatype, logger: this.datalogger, url: this.uri };
        switch (this.type) {
        case "text/json":
        case "application/json":
        case "application/x-amz-json-1.0":
        case "application/x-amz-json-1.1":
        case "application/problem+json":
            for (const p in this) if (p.substr(0, 5) == "json_") opts[p.substr(5)] = this[p];
            this.obj = lib.jsonParse(this.data, opts);
            break;

        case "text/xml":
        case "application/xml":
        case "application/rss+xml":
        case "application/problem+xml":
            for (const p in this) if (p.substr(0, 4) == "xml_") opts[p.substr(4)] = this[p];
            this.obj = lib.xmlParse(this.data, opts);
            break;
        }
    }
    logger.debug("httpDone:", this.toJSON());

    this._done = 1;
    if (typeof callback == "function") callback(this.err, this);
}

HttpRequest.prototype.close = function()
{
    this.etime = Date.now();
    this.elapsed = this.etime - this.stime;
    clearTimeout(this._timer);
    delete this._timer;
    if (this.fd) {
        try { fs.closeSync(this.fd); } catch (e) {}
        this.fd = 0;
    }
    if (this.stream) {
        try { this.stream.end(this.onFinish); } catch (e) {}
        delete this.stream;
    }
}

HttpRequest.prototype.toJSON = function(options)
{
    var rc = {
        role: core.role,
        method: this.method,
        url: this.uri,
        status: this.status,
        size: this.size,
        type: this.type,
        elapsed: this.elapsed,
        retryTotal: this.retryTotal,
        retryCount: this.retryCount,
        retryTimeout: this.retryTimeout,
        retryOnError: this.retryOnError ? 1 : 0,
        errorCount: this.errorCount,
        httpTimeout: this.httpTimeout,
        lastError: this.lastError,
        date: this.date,
    };
    if (this.ip) rc.ip = this.ip;
    if (this.file) rc.file = this.file;
    if (this.resheaders.location) rc.location = this.resheaders.location;
    if (options) {
        if (options.postdata > 0 && typeof this.postdata == "string") {
            rc.postdata = this.postdata.substr(0, options.postdata);
        }
        if (options.query) rc.query = this.query;
        if (options.data > 0 && typeof this.data == "string") {
            rc.data = this.data.substr(0, options.data);
        }
        if (options.obj && this.obj) rc.obj = this.obj;
        for (const p in options.headers) rc[options.headers[p]] = this.headers[options.headers[p]];
        for (const p in options.resheaders) rc[options.resheaders[p]] = this.resheaders[options.resheaders[p]];
    }
    return rc;
}

HttpRequest.prototype.checkRedirect = function(callback)
{
    switch (this.status) {
    case 301:
    case 302:
    case 303:
    case 307:
    case 308:
        if (this.noredirects) break;
        if (++this.redirects >= 10) break;
        var uri = this.resheaders.location || "";
        if (uri.indexOf("://") == -1) uri = this.uri.split("/").slice(0, 3).join("/") + uri;
        var cols = ['method','query','postdata','postfile','poststream','sign','checksum'];
        for (const c of cols) delete this[c];
        var headers = {};
        for (const i in this.passheaders) headers[this.passheaders[i]] = this.headers[this.passheaders[i]];
        this.headers = headers;
        httpGet(uri, this, callback);
        return true;
    }
}

