//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var path = require('path');
var util = require('util');
var fs = require('fs');
var http = require('http');
var url = require('url');
var core = require(__dirname + '/../core');
var lib = require(__dirname + '/../lib');
var logger = require(__dirname + '/../logger');

// Downloads file using HTTP and pass it to the callback if provided
//
// - uri can be full URL or an object with parts of the url, same format as in url.format
// - params can contain the following options:
//   - method - GET, POST
//   - headers - object with headers to pass to HTTP request, properties must be all lower case
//   - cookies - a list with cookies or a boolean to load cookies from the db
//   - file - file name where to save response, in case of error response the error body will be saved as well
//   - postdata - data to be sent with the request in the body
//   - postfile - file to be uploaded in the POST body, not as multipart
//   - postsize - file size to be uploaded if obtained separately
//   - chunked - post files using chunked encoding
//   - query - additional query parameters to be added to the url as an object or as encoded string
//   - sign - sign request with provided email/secret properties
//   - mtime - a Date or timestamp to be used in conditional requests
//   - conditional - add If-Modified-Since header using `params.mtime` if present or if `file` is given use file last modified timestamp, mtime
//   - httpTimeout - timeout in milliseconds afte which the request is borted if no data received
//   - retryCount - how many time to retry the request on error or timeout
//   - retryTimeout - timeout in milliseconds for retries, with every subsequent timeout it will be multiplied by 2
//   - retryOnError - also retry request if received non 2xx response status, if this is an array it should contain a list of status codes
//      on which to retry, otherwise retry on all non-2xx responses
//   - noredirects - if true then do not follow redirect locations for 30-[1,2,3,7] statuses
// - callback will be called with the arguments:
//     first argument is error object if any
//     second is params object itself with updated fields
//     third is the HTTP response object
// On end, the object params will contain the following updated properties:
//  - data if file was not specified, data will contain collected response body as string
//  - status - HTTP response status code
//  - mtime - Date object with the last modified time of the requested file
//  - size - size of the response body or file
// Note: SIDE EFFECT: params object is modified in place so many options will be changed/removed or added
core.httpGet = function(uri, params, callback)
{
    var self = this;
    if (typeof params == "function") callback = params, params = null;
    if (typeof callback != "function") callback = lib.noop;
    if (!params) params = {};

    var options = this.httpInit(uri, params);
    if (!this.httpPrepare(uri, params, options, callback)) return;

    var mod = uri.indexOf("https://") == 0 ? https : http;
    var req = mod.request(options, function(res) {
      logger.dev("httpGet:", "started", options.method, 'headers:', options.headers, params)

      res.on("data", function(chunk) {
          self.httpOnData(res, params, chunk);
      });

      res.on("end", function() {
          self.httpOnEnd(res, params, callback);
      });

    }).on('error', function(err) {
        self.httpOnError(err, params, options, callback);
    });

    if (params.httpTimeout) {
        req.setTimeout(params.httpTimeout, function() { req.abort(); });
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

core.httpInit = function(uri, params)
{
    params.size = 0;
    params.err = null;
    params.fd = 0;
    params.status = 0;
    params.poststream = null;
    params.redirects = lib.toNumber(params.redirects, { min: 0 });
    params.retryCount = lib.toNumber(params.retryCount, { min: 0 });
    params.retryTimeout = lib.toNumber(params.retryTimeout, { min: 0, dflt: 250 });
    params.httpTimeout = lib.toNumber(params.httpTimeout, { min: 0, dflt: 60000 });
    params.data = params.binary ? new Buffer(0) : '';

    var qtype = lib.typeName(params.query);
    switch (lib.typeName(uri)) {
    case "object":
        uri = url.format(uri);
        break;

    default:
        uri = String(uri);
        var q = url.format({ query: qtype == "object" ? params.query: null, search: qtype == "string" ? params.query: null });
        uri += uri.indexOf("?") == -1 ? q : q.substr(1);
        break;
    }

    var options = url.parse(uri);
    options.method = params.method || 'GET';
    options.headers = params.headers || {};
    options.agent = params.agent || null;
    options.rejectUnauthorized = false;

    if (!options.hostname) {
        options.hostname = "localhost";
        options.port = core.port;
        options.protocol = "http:";
    }

    params.uri = uri;
    params.href = options.href;
    params.pathname = options.pathname;
    params.hostname = options.hostname;
    params.search = options.search;

    // Use file name from the url when only the path is given
    if (params.file && params.file[params.file.length - 1] == "/") {
        params.file += path.basename(options.pathname);
    }

    if (!options.headers['user-agent']) {
        options.headers['user-agent'] = this.name + "/" + this.version + " " + this.appVersion;
    }
    if (options.method == "POST" && !options.headers["content-type"]) {
        options.headers["content-type"] = "application/x-www-form-urlencoded";
    }
    if (!options.headers['accept']) {
        options.headers['accept'] = '*/*';
    }

    return options;
}

core.httpPrepare = function(uri, params, options, callback)
{
    // Load matched cookies and restart with the cookie list in the params
    if (!this.httpPrepareCookies(uri, params, options, callback)) return;

    // Data to be sent over in the body
    if (!this.httpPreparePost(uri, params, options, callback)) return;

    // Conditional, time related
    if (!this.httpPrepareConditional(uri, params, options, callback)) return;

    // Make sure our data is not corrupted
    if (params.checksum) {
        options.checksum = params.postdata ? lib.hash(params.postdata) : null;
    }
    if (typeof params.signer == "function") {
        params.signer.call(params, options);
    }
    return true;
}

core.httpPrepareCookies = function(uri, params, options, callback)
{
    if (!params.cookies) return true;

    if (typeof params.cookies == "boolean" && options.hostname) {
        var self = this;
        this.cookieGet(options.hostname, function(cookies) {
            params.cookies = cookies;
            self.httpGet(uri, params, callback);
        });
        return;
    }
    // Cookie list already provided, just use it
    if (Array.isArray(params.cookies)) {
        options.headers["cookie"] = params.cookies.map(function(c) { return c.name+"="+c.value; }).join("; ");
    }
    return true;
}

core.httpPreparePost = function(uri, params, options, callback)
{
    if (params.postdata) {
        switch (lib.typeName(params.postdata)) {
        case "string":
            if (!options.headers['content-length']) options.headers['content-length'] = Buffer.byteLength(params.postdata, 'utf8');
            break;
        case "buffer":
            if (!options.headers['content-length']) options.headers['content-length'] = params.postdata.length;
            break;
        case "object":
            params.postdata = JSON.stringify(params.postdata);
            options.headers['content-type'] = "application/json";
            options.headers['content-length'] = Buffer.byteLength(params.postdata, 'utf8');
            break;
        default:
            params.postdata = String(params.postdata);
            options.headers['content-length'] = Buffer.byteLength(params.postdata, 'utf8');
        }
    } else
    if (params.postfile) {
        if (options.method == "GET") options.method = "POST";
        if (params.chunked) {
            options.headers['transfer-encoding'] = 'chunked';
        } else {
            if (!params.postsize && !options.headers["content-length"]) {
                var self = this;
                fs.stat(params.postfile, function(err, stats) {
                    if (err) return callback(err, params);
                    params.mtime = stats.mtime.getTime();
                    params.postsize = stats.size;
                    self.httpGet(uri, params, callback);
                });
                return;
            }
            if (params.postsize) options.headers['content-length'] = params.postsize;
        }
        params.poststream = fs.createReadStream(params.postfile);
        params.poststream.on("error", function(err) { logger.error('httpGet: stream:', params.postfile, err) });
    }
    return true;
}

core.httpPrepareConditional = function(uri, params, options, callback)
{
    if (params.conditional) {
        delete params.conditional;
        if (params.mtime) {
            options.headers["if-modified-since"] = lib.toDate(params.mtime).toUTCString();
        } else

        if (params.file) {
            var self = this;
            fs.stat(params.file, function(err, stats) {
                if (!err && stats.size > 0) {
                    params.mtime = stats.mtime.getTime();
                    options.headers["if-modified-since"] = lib.toDate(params.mtime).toUTCString();
                }
                self.httpGet(uri, params, callback);
            });
            return;
        }
    }
    return true;
}

core.httpOnError = function(err, params, options, callback)
{
    if (!params.quiet) logger[params.retryCount ? "debug" : "error"]("httpGet:", "onerror:", params.uri, 'file:', params.file || "", 'retry:', params.retryCount, params.retryTimeout, 'timeout:', params.httpTimeout, 'size;', params.size, err, lib.objDescr(options), lib.objDescr(params, { length: 128 }));

    if (params.retryCount-- > 0) {
        setTimeout(this.httpGet.call(this, uri, params, callback), params.retryTimeout *= 2);
    } else {
        callback(err, params, {});
    }
}

core.httpOnData = function(res, params, chunk)
{
    logger.dev("httpGet:", "data", 'size:', chunk.length, '/', params.size, "status:", res.statusCode, 'file:', params.file || '');

    if (params.stream) {
        try {
            params.stream.write(chunk);
        } catch(e) {
            if (!params.quiet) logger.error('httpGet:', "stream:", e);
            params.err = e;
            res.req.abort();
        }
    } else
    if (params.file) {
        try {
            if (!params.fd && res.statusCode >= 200 && res.statusCode < 300) {
                params.fd = fs.openSync(params.file, 'w');
            }
            if (params.fd) {
                fs.writeSync(params.fd, chunk, 0, chunk.length, null);
            }
        } catch(e) {
            if (!params.quiet) logger.error('httpGet:', "file:", params.file, e);
            params.err = e;
            res.req.abort();
        }
    } else
    if (params.binary) {
        params.data = Buffer.concat([params.data, chunk]);
    } else {
        params.data += chunk.toString();
    }
    params.size += chunk.length
}

core.httpOnEnd = function(res, params, callback)
{
    // Array means we wanted to use cookies just did not have existing before the request, now we can save the ones we received
    if (Array.isArray(params.cookies)) {
        this.cookieSave(params.cookies, res.headers["set-cookie"], params.hostname);
    }
    params.headers = res.headers;
    params.status = res.statusCode;
    params.type = (res.headers['content-type'] || '').split(';')[0];
    params.mtime = res.headers.date ? lib.toDate(res.headers.date) : null;
    if (!params.size) params.size = lib.toNumber(res.headers['content-length'] || 0);
    if (params.fd) try { fs.closeSync(params.fd); } catch(e) {}
    if (params.stream) try { params.stream.end(params.onfinish); } catch(e) {}
    params.fd = 0;

    logger.dev("httpGet:", "end", res.req.method, "url:", params.uri, "size:", params.size, "status:", params.status, 'type:', params.type, 'location:', res.headers.location || '', 'retry:', params.retryCount, params.retryTimeout);

    // Retry the same request on status codes configured explicitely
    if ((res.statusCode < 200 || res.statusCode >= 400) &&
        ((Array.isArray(params.retryOnError) && params.retryOnError.indexOf(res.statusCode) > -1) || lib.toNumber(params.retryOnError)) &&
        params.retryCount-- > 0) {
        setTimeout(this.httpGet.bind(this, uri, params, callback), params.retryTimeout *= 2);
        return;
    }
    // Redirection
    if (this.httpCheckRedirect(res, params, callback)) return;

    logger.debug("httpGet:", "done", res.req.method, "url:", params.uri, "size:", params.size, "status:", res.statusCode, 'type:', params.type);

    callback(params.err, params, res);
}

core.httpCheckRedirect = function(res, params, callback)
{
    switch (res.statusCode) {
    case 301:
    case 302:
    case 303:
    case 307:
        if (params.noredirects) break;
        if (++params.redirects >= 10) break;
        var uri2 = res.headers.location || "";
        if (uri2.indexOf("://") == -1) uri2 = params.uri.split("/").slice(0, 3).join("/") + uri2;

        ['method','query','headers','postdata','postfile','poststream','sign','checksum'].forEach(function(x) { delete params[x] });
        if (params.cookies) params.cookies = true;
        this.httpGet(uri2, params, callback);
        return true;
    }
}

// Make a HTTP request using `httpGet` with ability to sign requests and returne parsed JSON payload as objects.
//
// The POST request is made, if data is an object, it is converted into string.
//
// Returns params as in `httpGet` with .json property assigned with an object from parsed JSON response.
//
// *When used with API endpoints, the `backend-host` parameter must be set in the config or command line to the base URL of the backend,
// like http://localhost:8000, this is when `uri` is relative URL. Absolute URLs do not need this parameter.*
//
// Special parameters for options:
// - url - url if options is first argument
// - login - login to use for access credentials instead of global credentials
// - secret - secret to use for access instead of global credentials
// - proxy - used as a proxy to backend, handles all errors and returns .status and .json to be passed back to API client
// - checksum - calculate checksum from the data
// - anystatus - keep any HTTP status, dont treat as error if not between 200 and 299
// - obj - return just result object, not the whole params
core.sendRequest = function(options, callback)
{
    var self = this;
    if (!options) options = {};
    if (typeof options == "string") options = { url: options };
    if (typeof options.sign == "undefined") options.sign = true;
    // Sign request using internal backend credentials
    if (options.sign) {
        if (!options.login) options.login = self.backendLogin;
        if (!options.secret) options.secret = self.backendSecret;
        options.signer = function(opts) {
            var headers = this.modules.api.createSignature(this.login, this.secret, opts.method, opts.hostname, opts.path, { type: opts.headers['content-type'], checksum: opts.checksum });
            for (var p in headers) opts.headers[p] = headers[p];
        }
    }

    // Relative urls resolve against global backend host
    if (typeof options.url == "string" && options.url.indexOf("://") == -1) {
        options.url = (self.backendHost || "http://localhost:" + this.port) + options.url;
    }
    var db = self.modules.db;

    this.httpGet(options.url, lib.cloneObj(options), function(err, params, res) {
        // If the contents are encrypted, decrypt before processing content type
        if ((options.headers || {})['content-encoding'] == "encrypted") {
            params.data = lib.decrypt(options.secret, params.data);
        }
        // Parse JSON and store in the params, set error if cannot be parsed, the caller will deal with it
        if (params.data) {
            switch (params.type) {
            case "application/json":
                try { params.obj = JSON.parse(params.data); } catch(e) { err = e; }
                break;

            case "text/xml":
            case "application/xml":
                try { params.obj = xml2json.toJson(params.data, { object: true }); } catch(e) { err = e }
                break;
            }
        }
        if (!params.obj) params.obj = {};
        if ((params.status < 200 || params.status >= 300) && !err && !options.anystatus) {
            err = lib.newError({ message: util.format("ResponseError: %d: %j", params.status, params.obj), name: "HTTP", status: params.status });
        }
        if (typeof callback == "function") callback(err, options.obj ? params.obj : params, options.obj ? null : res);
    });
}


