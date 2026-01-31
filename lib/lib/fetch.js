/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
const url = require("url");
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const qs = require("qs");
const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');

const REUSE_COLS = ["protocol","href","path","pathname","host","hostname","port","search"];

/**
 * Make requests using HTTP(S) and pass it to the callback if provided
 *
 * @param {string|object} uri - can be full URL or an object with property `url:`
 * @param {object|FetchOptions} [options] - customize request with options, see {@link module:lib.FetchOptions}
 * @param {function} [callback] - callback as (err, request) where request is {FetchOptions} object combined with input options and updated fields
 *
 * @example
 * lib.fetch("http://api.host.com/user/123", (err, req) => {
 *    if (req.status == 200) console.log(req.obj);
 * });
 *
 * @example <caption>get a file if not downloaded already</caption>
 * var file = "/tmp/logo.png";
 * lib.fetch("https://bucket.s2.amazonaws.com/logo.png", { file, conditional: 1 }, (err, req) => {
 *     if (req.status >= 200) ...
 * });
 * @example <caption>post JSON with authorization</caption>
 * var data = {
 *    postdata: { ... },
 *    headers: { Authorization: "Bearer " + jwt },
 *    retryCount: 3
 * };
 * lib.fetch("https://some.api.com/endpoint", data, (err, req) => {
 *     console.log(req.status, req.obj);
 * });
 * @memberof module:lib
 * @method fetch
 */
lib.fetch = function(uri, options, callback)
{
    logger.dev("fetch:", uri, options, callback);
    if (typeof options == "function") callback = options, options = null;
    if (!options && uri?.url) options = uri, uri = uri.url;

    if (!(options instanceof FetchOptions)) {
        logger.dev("httpNew:", uri, options, callback);
        options = new FetchOptions(options);
    }

    var opts = options.init(uri, callback);
    if (!opts) return;
    logger.dev("httpStart:", uri, opts);

    try {
        var mod = opts.protocol == "https:" ? https : http;
        var req = mod.request(opts, (res) => {
            if (!options.binary && !options.stream && !options.file) {
                res.setEncoding("utf8")
            }
            res.on("data", (chunk) => {
                options.onData(res, chunk);
            });
            res.on("end", () => {
                options.onEnd(res, callback);
            });
            res.on("close", () => {
                if (!res.complete) options.onEnd(res, callback);
            });
        });
        req.on('error', (err) => {
            options.onError(err, callback);
        });
        req.on("timeout", () => {
            req.destroy(lib.newError("timeout", 529, "ETIMEDOUT"));
        });
        req.once('response', () => {
          options.ip = req.socket?.localAddress;
        });
    } catch (e) {
        return options.onError(e, callback);
    }
    if (options.hardTimeout) {
        options._timer = setTimeout(() => { req.destroy(lib.newError("timeout", 529, "ETIMEDOUT")) }, options.hardTimeout);
    }
    if (options.postdata) {
        req.write(options.postdata);
    } else
    if (options.poststream) {
        options.poststream.pipe(req);
        return req;
    }
    req.end();
    return req;
}

/**
 * Request object to support {@link module:lib.fetch}
 * @param {object} options - properties from FetchOptions
 *
 * @property {string} method - GET, POST, PUT, ...
 * @property {int} port - port to use for localhost if no full URI is provided
 * @property {object} headers - object with headers to pass to HTTP request, properties must be all lower case
 * @property {object} cookies - an object with cookies to send with request, if even empty rescookies will be set in the response
 * @property {object|string} query - additional query parameters to be added to the url as an object or as encoded string
 * @property {string|object|buffer} body - if method is GET it is used as query parameters otherwise same as postdata
 * @property {string|object|buffer} postdata - data to be sent with the request in the POST body as JSON
 * @property {string} file - file name where to save response, in case of error response the error body will be saved as well, it uses sync file operations
 * @property {object} stream - a writable stream where to save data
 * @property {object} formdata - data to be sent with the POST request as x-www-form-urlencoded
 * @property {string} postfile - file to be uploaded in the POST body, not as multipart
 * @property {int} postsize - file size to be uploaded if obtained separately
 * @property {string} posttype - content type for post data
 * @property {object[]} multipart - an array of objects for multipart/form-data post, { name: "..", data: ".." [ file: ".."] }, for files a Buffer can be used in data
 * @property {boolean} noparse - do not parse known content types like json, xml
 * @property {boolean} chunked - post files using chunked encoding
 * @property {object} qsopts - an object to be passed to `qs.stringify`
 * @property {function} signer - a function to sign the request signer(this)
 * @property {boolean} checksum - if true the body needs a checksum in the signature
 * @property {Date|int} mtime - a Date or timestamp to be used in conditional requests
 * @property {boolan} conditional - add If-Modified-Since header using `options.mtime` if present or if `file` is given use file last modified timestamp, mtime
 * @property {int} httpTimeout - timeout in milliseconds after which the request is aborted if no data received
 * @property {int} hardTimeout - abort the request after this amount of time in ms, must be big enough to allow for all data to be received
 * @property {int} maxSize - if the content being downloaded becomes greater than this size the request will be aborted
 * @property {int} retryCount - how many times to retry the request on error or timeout
 * @property {int} retryTimeout - timeout in milliseconds for retries, with every subsequent timeout it will be multiplied by `retryMultiplier`
 * @property {boolean|function} retryOnError - retry request if received non 2xx response status,
 *       if this is a function then it must return true in order to retry the request,
 *       otherwise it is treated as a boolean value, if true then retry on all non-2xx responses
 * @property {function} retryPrepare - a function to be called before retrying, it can update any parameter, most related: _uri, retryTimeout, retryMultiplier
 * @property {int} errorCount - how many times to retry on aborted connections, default is retryCount
 * @property {boolean} raise - on not ok status raise and eror on return with JSON body if present or generic message
 * @property {boolean} noredirects - if true then do not follow redirect locations for 30-[1,2,3,7] statuses
 * @property {function} preparse -  a function to be called before parsing the xml/json content, called in the context of the http object
 * @property {string[]} passheaders -  a list of headers to be passed in redirects
 * @property {string} user - authorization user, if also `password`` is provided then it will use Basic authorization, if only user is provided then Bearer
 * @property {string} data - response data if file was not specified
 * @property {object} obj - if the content type is a known type like json or xml this property will hold a reference to the parsed document or null in case or parse error
 * @property {int} status - HTTP response status code
 * @property {Date} date - Date object with the last modified time of the requested file
 * @property {object} resheaders - response headers as an object
 * @property {object} rescookies - parsed cookies from the response if request `cookies`` is not empty
 * @property {int} size - size of the response body or file
 * @property {string} type - response content type
 * @property {boolean} ok - true if the status is between 200 and 299
 */

class FetchOptions {

    constructor(options)
    {
        for (const p in options) this[p] = options[p];
    }

    init(uri, callback)
    {
        this._done = 0;
        this._uri = uri;

        switch (lib.typeName(uri)) {
        case "object":
            uri = url.format(uri);
            break;

        default:
            uri = String(uri);
            var query = this.query;
            if (!query && this.body && this.method == "GET") {
                query = this.query = this.body;
                delete this.body;
            }
            query = lib.isString(query) || lib.isObject(query) && qs.stringify(query, this.qsopts);
            if (query) {
                uri += (uri.includes("?") ? "" : "?") + (query[0] == "&" ? "" : "&") + query;
            }
        }

        this.uri = uri;
        this.size = 0;
        this.err = null;
        this.fd = 0;
        this.status = 0;
        this.ok = false;
        this.date = null;
        this.obj = null;
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

        this.poststream = null;
        this.postdata = this.postdata || this.body;
        delete this.body;

        var opts = {};

        var u = URL.parse(this.uri);
        if (u) {
            for (const c of REUSE_COLS) {
                opts[c] = u[c];
            }
        }

        opts.path = opts.pathname + opts.search;
        opts.method = this.method;
        opts.headers = this.headers;
        opts.agent = this.agent || null;
        opts.rejectUnauthorized = false;
        opts.timeout = this.httpTimeout;

        for (const c of REUSE_COLS) {
            this[c] = opts[c];
        }
        for (const p in this.headers) {
            if (lib.isEmpty(this.headers[p])) delete this.headers[p];
        }

        // Use file name from the url when only the path is given
        if (this.file && this.file[this.file.length - 1] == "/") {
            this.file += path.basename(this.pathname);
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

        // Set again if changed
        opts.method = this.method = this.method || "GET";
        for (const c of REUSE_COLS) {
            this[c] = opts[c];
        }

        logger.dev("httpOpen:", this.method, this.uri, "HDR:", this.headers, "POST:", this.postsize, this.postdata);

        return opts;
    }

    prepare(callback)
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

    preparePost(callback)
    {
        switch (lib.typeName(this.formdata)) {
        case "object":
        case "array":
            this.method = "POST";
            this.postdata = qs.stringify(this.formdata, this.qsopts);
            this.headers['content-type'] = "application/x-www-form-urlencoded";
            delete this.formdata;
            break;
        }

        if (lib.isArray(this.multipart)) {
            this.method = "POST";
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
            this.postdata = Buffer.concat(buf);
            this.headers["content-type"] = `multipart/form-data; boundary=${this.boundary}`;
            this.headers['content-length'] = this.postdata.length;
        } else

        if (this.postdata) {
            if (!this.method) {
                this.method = "POST";
            }
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
            if (!this.method || this.method == "GET") {
                this.method = "POST";
            }
            if (this.chunked) {
                this.headers['transfer-encoding'] = 'chunked';
            } else {
                if (typeof this.postsize != "number") {
                    fs.stat(this.postfile, (err, stats) => {
                        if (err) return callback(err, this);
                        this.mtime = stats.mtime.getTime();
                        this.postsize = stats.size;
                        lib.fetch(this.uri, this, callback);
                    });
                    return;
                }
                this.headers['content-length'] = this.postsize;
            }
            this.poststream = fs.createReadStream(this.postfile);
            this.poststream.on("error", (err) => {
                logger.error('httpStream:', err.stack)
            });
        }
        return true;
    }

    prepareConditional(callback)
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
                    lib.fetch(this.uri, this, callback);
                });
                return;
            }
        }
        return true;
    }

    onData(res, chunk)
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
        logger.dev("httpData:", this.toJSON());
        if (this.maxSize > 0 && this.size > this.maxSize) res.req.abort();
    }

    writeStream(res, chunk)
    {
        try {
            this.stream.write(chunk);
        } catch (e) {
            this.err = e;
            res.req.abort();
        }
    }

    writeFile(res, chunk)
    {
        try {
            if (!this.fd && res.statusCode >= 200 && res.statusCode < 300) {
                this.fd = fs.openSync(this.file, 'w');
            }
            if (this.fd) {
                fs.writeSync(this.fd, chunk, 0, chunk.length, null);
            }
        } catch (e) {
            logger.error("httpWriteFile:", e, this.toJSON());
            this.err = e;
            res.req.abort();
        }
    }

    onError(err, callback)
    {
        this.close();
        if (this._done) return;
        if (!this.quiet) logger.logger(this.errorCount ? "debug" : "error", "httpError:", err, this.toJSON({ query: 1, postdata: 256, data: 256 }));

        if (this.errorCount-- > 0) {
            this.lastError = err;
            if (typeof this.retryPrepare == "function") this.retryPrepare.call(this);
            setTimeout(lib.fetch.bind(null, this._uri, this, callback), lib.objMult(this, "retryTimeout", this.retryMultiplier, "old"));
            if (this.warnTimeout && this.retryTimeout >= this.warnTimeout) logger.warn("httpRetry:", err, this.toJSON({ query: 1, postdata: 256, data: 256 }));
        } else {
            err.status = this.status = this._done = 529;
            if (typeof callback == "function") callback(err, this);
        }
    }

    onEnd(res, callback)
    {
        this.close();
        if (this._done) return;
        logger.dev("httpEnd:", this.toJSON({ postdata: 256, data: 256 }));

        var headers = this.resheaders = res.headers || {};
        this.status = res.statusCode || 0;
        this.ok = this.status >= 200 && this.status < 300;
        this.type = (headers['content-type'] || '').split(';')[0];
        this.date = headers.date ? lib.toDate(headers.date) : null;
        if (!this.size) this.size = lib.toNumber(headers['content-length'] || 0);
        if (this.cookies) this.rescookies = this.parseCookies(headers["set-cookie"]);

        // Retry the same request on status codes configured explicitely
        if ((this.status < 200 || this.status >= 400) &&
            ((typeof this.retryOnError == "function" && this.retryOnError.call(this)) || lib.toBool(this.retryOnError)) &&
            this.retryCount-- > 0) {
            this.lastError = `${this.status}: ${this.data}`;
            if (!this.quiet) logger.debug("httpRetry:", this.toJSON({ query: 1, postdata: 256, data: 256 }));
            if (typeof this.retryPrepare == "function") this.retryPrepare.call(this);
            setTimeout(lib.fetch.bind(null, this._uri, this, callback), lib.objMult(this, "retryTimeout", this.retryMultiplier, "old"));
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

        // Parse JSON and store in the options, set error if cannot be parsed, the caller will deal with it
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

        // Return an error on status
        if ((this.status < 200 || this.status > 299) && !this.err && this.raise) {
            if (this.obj?.message) {
                this.err = this.obj;
                this.err.status = this.status;
            } else
            if (!lib.isEmpty(this.obj)) {
                this.err = { message: lib.objDescr(this.obj), status: this.status };
            } else {
                this.err = { message: "Error " + this.status + (this.data ? ": " + this.data : ""), status: this.status };
            }
            if (this.err.status == 429 && !this.err.code) this.err.code = "OverCapacity";
        }


        this._done = 1;
        if (typeof callback == "function") callback(this.err, this);
    }

    close()
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

    /**
     * Return a simplified object for logging purposes
     */
    toJSON(options)
    {
        var rc = {
            role: this.role,
            method: this.method,
            url: this.uri,
            _uri: this._uri,
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

    checkRedirect(callback)
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
            var cols = ['method','query','postdata','postfile','poststream','signer','checksum'];
            for (const c of cols) delete this[c];
            var headers = {};
            for (const i in this.passheaders) headers[this.passheaders[i]] = this.headers[this.passheaders[i]];
            this.headers = headers;
            lib.fetch(uri, this, callback);
            return true;
        }
    }

    /**
     * Parse Set-Cookie header and return an object of cookies: { NAME: { value: VAL, secure: true, expires: N ... } }
     */
    parseCookies(header)
    {
        var cookies = {};
        header = Array.isArray(header) ? header.filter((x) => (typeof x == "string")) :
                 typeof header == "string" ? header.split(/[:](?=\s*[a-zA-Z0-9_-]+\s*[=])/g) : [];
        for (const p of header) {
            const parts = p.split(";");
            let pair = parts[0].match(/([^=]+)=((?:.|\n)*)/);
            if (!pair) continue;
            const name = pair[1], cookie = { value: pair[2] || "" };
            for (let i = 1; i < parts.length; i++) {
                pair = parts[i].match(/([^=]+)(?:=((?:.|\n)*))?/);
                if (!pair) continue;
                const key = pair[1].trim().toLowerCase();
                const value = pair[2] && pair[2].trim();
                switch (key) {
                case "expires":
                    if (value) cookie.expires = lib.toMtime(value);
                    break;

                case "path":
                case "domain":
                    if (value) cookie[key] = value;
                    break;

                case "samesite":
                    if (value) cookie.sameSite = value;
                    break;

                case "secure":
                    cookie.secure = true;
                    break;

                case "httponly":
                    cookie.httpOnly = true;
                    break;
                }
            }
            cookies[name] = cookie;
        }
        return cookies;
    }

}

/**
 * Async/await version of {@link module:lib.fetch}, never rejects meaning no exceptions
 * @param {string} uri - can be full URL or an object with parts of the url, same format as in url.format
 * @param {object|FetchOptions} [options] - customize request
 * @return {object} - result as an object `{ err, data, obj, req }` where data/obj are properties fro the req for convenience
 *
 * @example
 * const { err, data } = await lib.afetch("http://api.host.com/file.txt");
 * const { err, obj } = await lib.afetch("http://api.host.com/user/123");
 * const { err, obj } = await lib.afetch({ url: "http://api.host.com/user/123", query: { t: 1 } });
 * const { err, obj } = await lib.afetch({ url: "http://api.host.com/user/123", postdata: { name: "myname" } });
 * const { err, obj } = await lib.afetch({ url: "http://api.host.com/user/123", method: "PUT", body: { name: "myname" } });
 * @method afetch
 * @memberOf module:lib
 * @async
 */
lib.afetch = function(uri, options)
{
    return new Promise((resolve, reject) => {
        lib.fetch(uri, options, (err, req) => {
            resolve({ err, data: req.data, obj: req.obj, req });
        });
    });
}
