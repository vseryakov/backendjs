//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var path = require('path');
var util = require('util');
var fs = require('fs');
var http = require('http');
var https = require('https');
var url = require('url');
var qs = require("qs");
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
//   - file - file name where to save response, in case of error response the error body will be saved as well, it uses sync file operations
//   - stream - a writable stream where to save data
//   - postdata - data to be sent with the request in the body
//   - postfile - file to be uploaded in the POST body, not as multipart
//   - postsize - file size to be uploaded if obtained separately
//   - noparse - do not parse known content types like json, xml
//   - chunked - post files using chunked encoding
//   - query - additional query parameters to be added to the url as an object or as encoded string
//   - sign - sign request with provided email/secret properties
//   - checksum - 1 if the body needs a checksum in the signature
//   - mtime - a Date or timestamp to be used in conditional requests
//   - conditional - add If-Modified-Since header using `params.mtime` if present or if `file` is given use file last modified timestamp, mtime
//   - httpTimeout - timeout in milliseconds afte which the request is borted if no data received
//   - retryCount - how many times to retry the request on error or timeout
//   - retryTimeout - timeout in milliseconds for retries, with every subsequent timeout it will be multiplied by 2
//   - retryOnError - retry request if received non 2xx response status,
//       if this is a function then it must return true in order to retry the request,
//       otherwise it is treated as a boolean value, if true then retry on all non-2xx responses
//   - noredirects - if true then do not follow redirect locations for 30-[1,2,3,7] statuses
// - callback will be called with the arguments:
//     first argument is error object if any
//     second is the params object itself with updated fields
//
// On end, the object params will contain the following updated properties:
//  - data if file was not specified, data will contain collected response body as string
//  - obj - if the content type is a known type like json or xml this property will hold a reference to the parsed document or null in case or parse error
//  - status - HTTP response status code
//  - mtime - Date object with the last modified time of the requested file
//  - size - size of the response body or file
//  - type - response content type
//
// Note: SIDE EFFECT: the params object is modified in place so many options will be changed/removed or added
core.httpGet = function(uri, params, callback)
{
    if (!(params instanceof HttpRequest)) {
        if (typeof params == "function") callback = params, params = null;
        logger.dev("httpNew:", uri, params);
        params = new HttpRequest(params);
    }

    params.init(uri);
    var opts = params.open(callback);
    if (!opts) return;

    var mod = opts.protocol == "https:" ? https : http;
    var req = mod.request(opts, function(res) {
      res.on("data", function(chunk) {
          params.onData(res, chunk);
      });

      res.on("end", function() {
          params.onEnd(res, callback);
      });

    }).on('error', function(err) {
        params.onError(err, callback);
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

function HttpRequest(options)
{
    for (var p in options) this[p] = options[p];
    return this;
}

HttpRequest.prototype.init = function(uri)
{
    var qtype = lib.typeName(this.query);
    switch (lib.typeName(uri)) {
    case "object":
        uri = url.format(uri);
        break;

    default:
        uri = String(uri);
        var q = qtype == "object" ? qs.stringify(this.query) : qtype == "string" ? this.query : "";
        if (!q) break;
        uri += (uri.indexOf("?") == -1 ? "?" : "") + (q[0] == "&" ? "" : "&") + q;
    }

    this.uri = uri;
    this.size = 0;
    this.err = null;
    this.fd = 0;
    this.status = 0;
    this.poststream = null;
    this.method = this.method || 'GET';
    this.headers = this.headers || {};
    this.data = this.binary ? new Buffer(0) : '';
    this.redirects = lib.toNumber(this.redirects, { min: 0 });
    this.retryCount = lib.toNumber(this.retryCount, { min: 0 });
    this.retryTimeout = lib.toNumber(this.retryTimeout, { min: 0, dflt: 250 });
    this.httpTimeout = lib.toNumber(this.httpTimeout, { min: 0, dflt: 60000 });
}

HttpRequest.prototype.open = function(callback)
{
    var opts = url.parse(this.uri);
    opts.method = this.method;
    opts.headers = this.headers;
    opts.agent = this.agent || null;
    opts.rejectUnauthorized = false;
    if (!opts.hostname) {
        opts.hostname = "localhost";
        opts.protocol = "http:";
        opts.port = core.port;
    }

    var cols = ["protocol","href","path","pathname","hostname","search"];
    for (var i in cols) this[cols[i]] = opts[cols[i]];

    // Use file name from the url when only the path is given
    if (this.file && this.file[this.file.length - 1] == "/") {
        this.file += path.basename(this.pathname);
    }

    if (!this.headers['user-agent']) {
        this.headers['user-agent'] = core.name + "/" + core.version + " " + core.appVersion;
    }
    if (this.method == "POST" && !this.headers["content-type"]) {
        this.headers["content-type"] = "application/x-www-form-urlencoded";
    }
    if (!this.headers['accept']) {
        this.headers['accept'] = '*/*';
    }

    if (!this.prepare(callback)) return null;

    // Set again if possibly changed
    for (var i in cols) this[cols[i]] = opts[cols[i]];

    logger.dev("httpOpen:", this.method, this.uri, this.postsize);

    return opts;
}

HttpRequest.prototype.prepare = function(callback)
{
    // Load matched cookies and restart with the cookie list in the params
    if (!this.prepareCookies(callback)) return;

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

HttpRequest.prototype.prepareCookies = function(callback)
{
    if (!this.cookies) return true;

    if (typeof this.cookies == "boolean" && this.hostname) {
        var self = this;
        core.cookieGet(this.hostname, function(err, cookies) {
            self.cookies = cookies;
            core.httpGet(self.uri, self, callback);
        });
        return;
    }
    // Cookie list already provided, just use it
    if (Array.isArray(this.cookies)) {
        this.headers["cookie"] = this.cookies.map(function(c) { return c.name+"="+c.value; }).join("; ");
    }
    return true;
}

HttpRequest.prototype.preparePost = function(callback)
{
    if (this.postdata) {
        switch (lib.typeName(this.postdata)) {
        case "string":
            if (!this.headers['content-length']) this.headers['content-length'] = Buffer.byteLength(this.postdata, 'utf8');
            break;
        case "buffer":
            if (!this.headers['content-length']) this.headers['content-length'] = this.postdata.length;
            break;
        case "object":
            this.postdata = lib.stringify(this.postdata);
            this.headers['content-type'] = "application/json";
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
            if (!this.postsize && !this.headers["content-length"]) {
                var self = this;
                fs.stat(this.postfile, function(err, stats) {
                    if (err) return callback(err, self);
                    self.mtime = stats.mtime.getTime();
                    self.postsize = stats.size;
                    core.httpGet(self.uri, self, callback);
                });
                return;
            }
            if (this.postsize) this.headers['content-length'] = this.postsize;
        }
        this.poststream = fs.createReadStream(this.postfile);
        this.poststream.on("error", function(err) { logger.error('httpGet: stream:', err.stack) });
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
            var self = this;
            fs.stat(this.file, function(err, stats) {
                if (!err && stats.size > 0) {
                    self.mtime = stats.mtime.getTime();
                    self.headers["if-modified-since"] = lib.toDate(self.mtime).toUTCString();
                }
                core.httpGet(self.uri, self, callback);
            });
            return;
        }
    }
    return true;
}

HttpRequest.prototype.onError = function(err, callback)
{
    if (!this.quiet) logger[this.retryCount ? "debug" : "error"]("httpGet:", "onerror:", err, this.toJSON(), typeof this.postdata == "string" ? this.postdata.substr(0, 512) : "");

    if (this.retryCount-- > 0) {
        setTimeout(core.httpGet.bind(core, this.uri, this, callback), this.retryTimeout *= 2);
    } else {
        if (typeof callback == "function") callback(err, this);
    }
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
    this.size += chunk.length
}

HttpRequest.prototype.writeStream = function(res, chunk)
{
    try {
        this.stream.write(chunk);
    } catch(e) {
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
    } catch(e) {
        this.err = e;
        res.req.abort();
    }
}

HttpRequest.prototype.onEnd = function(res, callback)
{
    this.close();

    this.headers = res.headers;
    this.status = res.statusCode;
    this.type = (res.headers['content-type'] || '').split(';')[0];
    this.mtime = res.headers.date ? lib.toDate(res.headers.date) : null;
    if (!this.size) this.size = lib.toNumber(res.headers['content-length'] || 0);

    // An array means we wanted to use cookies but did not have existing ones before the request, now we can save the ones we received
    if (Array.isArray(this.cookies)) {
        core.cookieSave(this.cookies, this.headers["set-cookie"], this.hostname);
    }

    // Retry the same request on status codes configured explicitely
    if ((this.status < 200 || this.status >= 400) &&
        ((typeof this.retryOnError == "function" && this.retryOnError.call(this)) || lib.toBool(this.retryOnError)) &&
        this.retryCount-- > 0) {
        setTimeout(core.httpGet.bind(core, this.uri, this, callback), this.retryTimeout *= 2);
        return;
    }
    if (this.checkRedirect(callback)) return;

    // If the contents are encrypted, decrypt before processing content type
    if (this.headers['content-encoding'] == "encrypted" && this.secret) {
        this.data = lib.decrypt(this.secret, this.data);
    }

    // Parse JSON and store in the params, set error if cannot be parsed, the caller will deal with it
    if (this.data && !this.noparse) {
        switch (this.type) {
        case "application/json":
        case "application/x-amz-json-1.0":
            var opts = { datatype: this.datatype, logger: this.datalogger };
            for (var p in this) if (p.substr(0, 5) == "json_") opts[p] = this[p];
            this.obj = lib.jsonParse(this.data, opts);
            break;

        case "text/xml":
        case "application/xml":
        case "application/rss+xml":
            for (var p in this) if (p.substr(0, 4) == "xml_") opts[p] = this[p];
            var opts = { datatype: this.datatype, logger: this.datalogger };
            this.obj = lib.xmlParse(this.data, opts);
            break;
        }
    }

    logger.debug("httpGet:", "done", this.toJSON());

    if (typeof callback == "function") callback(this.err, this);
}

HttpRequest.prototype.close = function()
{
    if (this.fd) {
        try { fs.closeSync(this.fd); } catch(e) {}
    }
    if (this.stream) {
        try { this.stream.end(this.onFinish); } catch(e) {}
    }
    this.fd = 0;
}

HttpRequest.prototype.toJSON = function()
{
    return {
        method: this.method,
        url: this.uri,
        size: this.size,
        status: this.status,
        type: this.type,
        retryCount: this.retryCount,
        retryTimeout: this.retryTimeout,
        retryOnError: this.retryOnError ? 1 : 0,
        file: this.file || "",
        mtime: this.mtime,
        location: this.headers.location || "",
    };
}

HttpRequest.prototype.checkRedirect = function(callback)
{
    switch (this.status) {
    case 301:
    case 302:
    case 303:
    case 307:
        if (this.noredirects) break;
        if (++this.redirects >= 10) break;
        var uri = this.headers.location || "";
        if (uri.indexOf("://") == -1) uri = this.uri.split("/").slice(0, 3).join("/") + uri;
        var cols = ['method','query','headers','postdata','postfile','poststream','sign','checksum'];
        for (var i in cols) delete this[cols[i]];
        if (this.cookies) this.cookies = true;
        core.httpGet(uri, this, callback);
        return true;
    }
}

// Return cookies that match given domain
core.cookieGet = function(domain, callback)
{
    var db = this.modules.db;
    var cookies = [];
    db.scan("bk_property", {}, { pool: db.local }, function(row, next) {
        if (!row.name.match(/^bk:cookie:/)) return next();
        var cookie = lib.jsonParse(row.value, { datatype: "obj" })
        if (cookie.expires <= Date.now()) return next();
        if (cookie.domain == domain) {
            cookies.push(cookie);
        } else
        if (cookie.domain.charAt(0) == "." && (cookie.domain.substr(1) == domain || domain.match(cookie.domain.replace(/\./g,'\\.') + '$'))) {
            cookies.push(cookie);
        }
        next();
    }, function(err) {
        logger.debug('cookieGet:', domain, cookies);
        if (callback) callback(err, cookies);
    });
}

// Save new cookies arrived in the request,
// merge with existing cookies from the jar which is a list of cookies before the request
core.cookieSave = function(cookiejar, setcookies, hostname, callback)
{
    var db = this.modules.db;
    var cookies = !setcookies ? [] : Array.isArray(setcookies) ? setcookies : String(setcookies).split(/[:](?=\s*[a-zA-Z0-9_\-]+\s*[=])/g);
    logger.debug('cookieSave:', cookiejar, 'SET:', cookies);
    cookies.forEach(function(cookie) {
        var parts = cookie.split(";");
        var pair = parts[0].match(/([^=]+)=((?:.|\n)*)/);
        if (!pair) return;
        var obj = { name: pair[1], value: pair[2], path: "", domain: "", secure: false, expires: Infinity };
        for (var i = 1; i < parts.length; i++) {
            pair = parts[i].match(/([^=]+)(?:=((?:.|\n)*))?/);
            if (!pair) continue;
            var key = pair[1].trim().toLowerCase();
            var value = pair[2];
            switch(key) {
            case "expires":
                obj.expires = value ? Number(lib.toDate(value)) : Infinity;
                break;

            case "path":
                obj.path = value ? value.trim() : "";
                break;

            case "domain":
                obj.domain = value ? value.trim() : "";
                break;

            case "secure":
                obj.secure = true;
                break;
            }
        }
        if (!obj.domain) obj.domain = hostname || "";
        var found = false;
        cookiejar.forEach(function(x, j) {
            if (x.path == obj.path && x.domain == obj.domain && x.name == obj.name) {
                if (obj.expires <= Date.now()) {
                    cookiejar[j] = null;
                } else {
                    cookiejar[j] = obj;
                }
                found = true;
            }
        });
        if (!found) cookiejar.push(obj);
    });
    lib.forEachSeries(cookiejar, function(rec, next) {
        if (!rec) return next();
        if (!rec.id) rec.id = lib.hash(rec.name + ':' + rec.domain + ':' + rec.path);
        db.put("bk_property", { name: "bk:cookie:" + rec.id, value: rec }, { pool: db.local }, function() { next() });
    }, callback);
}

