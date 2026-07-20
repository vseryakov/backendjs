/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const stream = require('node:stream');
const http = require('node:http');
const https = require('node:https');
const qs = require("node:querystring");
const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');

const REUSE_COLS = ["protocol","href","path","pathname","host","hostname","port","search"];

var _id = 1;

/**
 * Make requests using HTTP(S) and pass it to the callback if provided
 *
 * @param {string} [url] - full URL for request
 * @param {object|FetchRequest} [options] - request options or existing FetchRequest to reuse, see {@link module:lib.FetchRequest},
 * either url or options must be provided or both, the url takes precedence over options.url
 * @param {function} [callback] - callback as (err, request) where request is a {FetchRequest} object combined with input options and updated fields
 * @return {object} - HTTP request
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
lib.fetch = function(url, options, callback)
{
    if (typeof options === "function") callback = options, options = null;

    if (typeof url !== "string") {
        if (typeof url?.url === "string" && typeof url === "object") {
            options = url;
            url = url.url;
        } else

        if (typeof options?.url === "string" && typeof options === "object") {
            url = options.url;
        }
    }

    const fetchReq = !(options instanceof FetchRequest) ? new FetchRequest(options) : options;

    const opts = fetchReq.init(url, callback);
    if (!opts) return;

    fetchReq.logger("dev", "new:");

    const mod = opts.protocol === "https:" ? https : http;
    let req;

    try {
        req = mod.request(opts, (res) => {
            fetchReq.onConnect(req, res);

            res.on("data", (chunk) => {
                fetchReq.onData(res, chunk);
            });

            res.on("end", () => {
                fetchReq.onEnd(res, callback);
            });

            res.on("close", () => {
                if (!res.complete) fetchReq.onEnd(res, callback);
                if (!req.complete && fetchReq.streaming) req.destroy();
            });
        });

        req.on('error', (err) => {
            fetchReq.onError(err, callback);
        });

        req.on("timeout", () => {
            req.destroy(lib.newError("timeout", 529, "ETIMEDOUT"));
        });

        req.once('response', () => {
          fetchReq.ip = req.socket?.localAddress;
        });
    } catch (err) {
        fetchReq.onError(err, callback);
        return req;
    }

    if (fetchReq.hardTimeout) {
        fetchReq._timer = setTimeout(() => {
            req.destroy(lib.newError("timeout", 529, "ETIMEDOUT"))
        }, fetchReq.hardTimeout);
    }

    if (fetchReq.postdata) {
        req.write(fetchReq.postdata);
    } else

    if (fetchReq.poststream) {
        stream.pipeline(fetchReq.poststream, req, (err) => {
            fetchReq.logger(err ? "error" : "dev", 'poststream:', err?.stack);
        });
        return req;
    }

    if (fetchReq.streaming) {
        req.flushHeaders();
    } else {
        req.end();
    }
    return req;
}

/**
 * Request object to support {@link module:lib.fetch}
 * @param {object} options - properties from FetchRequest
 *
 * @property {string} url - full URL where to make request
 * @property {string} method=GET - GET, POST, PUT, ...
 * @property {int} port - port to use for localhost if no full URI is provided
 * @property {object} headers - object with headers to pass to HTTP request, properties must be all lower case
 * @property {object} cookies - an object with cookies to send with request, if even empty rescookies will be set in the response
 * @property {object|string} query - additional query parameters to be added to the url as an object or as encoded string
 * @property {string|object|buffer} body - if method is GET it is used as query parameters otherwise same as postdata
 * @property {string|object|buffer} postdata - data to be sent with the request in the POST body as JSON
 * @property {object} formdata - data to be sent with the POST request as x-www-form-urlencoded, it uses node:querystring to stringify objects
 * @property {string} postfile - file to be uploaded in the POST body, not as multipart
 * @property {int} postsize - file size to be uploaded if obtained separately
 * @property {stream.Readable} poststream - a readable stream to stream content from
 * @property {object[]} multipart - an array of objects for multipart/form-data post, { name: "..", data: ".." [ file: ".."] }, for files a Buffer can be used in data
 * @property {string} file - file name where to save response, in case of error response the error body will be saved as well
 * @property {stream.Writable} stream - a writable stream where to save data
 * @property {boolean} noparse - do not parse known content types like json, xml
 * @property {boolean} chunked - post files using chunked encoding
 * @property {boolean} binary - return a Buffer with received data
 * @property {function} signer - a function to sign the request called as `signer(this)`
 * @property {boolean} streaming - if true do not issue req.end to allow more data top send
 * @property {Date|int} mtime - a Date or timestamp to be used in conditional requests
 * @property {boolean} conditional - add If-Modified-Since header using `options.mtime` if present or if `file` is given use file last modified timestamp, mtime
 * @property {int} httpTimeout - timeout in milliseconds after which the request is aborted if no data received
 * @property {int} hardTimeout - abort the request after this amount of time in ms, must be big enough to allow for all data to be received
 * @property {int} maxSize - if the content being downloaded becomes greater than this size the request will be aborted
 * @property {int} retryCount - how many times to retry the request on error or timeout
 * @property {int} retryTimeout - timeout in milliseconds for retries, with every subsequent timeout it will be multiplied by `retryMultiplier`
 * @property {boolean|function} retryOnError - retry request if received non 2xx response status,
 *       if this is a function then it must return true in order to retry the request, it runs in this context and passes this as well,
 *       otherwise it is treated as a boolean value, if truthy then retry on all non-2xx responses
 * @property {function} retryPrepare - a function(this) to be called before retrying, it can update any parameter, runs in this context and passes this as well,
 * retry will use: `origUrl`, `retryTimeout`, `retryMultiplier`
 * @property {int} errorCount - how many times to retry on aborted connections, default is retryCount
 * @property {boolean} raise - on not ok status raise an eror on return with JSON body if present or generic message
 * @property {boolean} noredirects - if true then do not follow redirect locations for 30-[1,2,3,7] statuses
 * @property {function} preparse -  a function to be called before parsing the xml/json content, called in the context of the http object
 * @property {string[]} passheaders -  a list of headers to be passed in redirects
 * @property {string} user - authorization user, if also `password`` is provided then it will use Basic authorization, if only user is provided then Bearer
 * @property {AbortSignal} signal - An AbortSignal that may be used to abort an ongoing request.
 * @property {number} maxHeaderSize - Optionally overrides the value of --max-http-header-size (the maximum length of response headers in bytes) for responses received from the server. Default: 16384 (16 KiB).
 * @property {boolean} setDefaultHeaders - Specifies whether or not to automatically add default headers such as Connection, Content-Length, Transfer-Encoding, and Host. If set to false then all necessary headers must be added manually. Defaults to true.
 * @property {boolean} setHost - Specifies whether or not to automatically add the Host header. If provided, this overrides setDefaultHeaders. Defaults to true.
 * @property {Array} uniqueHeaders - A list of request headers that should be sent only once. If the header's value is an array, the items will be joined using ; .
 * @property {boolean} joinDuplicateHeaders - It joins the field line values of multiple headers in a request with ,  instead of discarding the duplicates. See message.headers for more information. Default: false.
 * @property {string} localAddress - Local interface to bind for network connections.
 * @property {number} localPort - Local port to connect from.
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

class FetchRequest {
    id = process.pid + "." + _id++;
    done = 0;
    size = 0;
    err = null;
    fd = 0;
    status = 0;
    ok = false;
    date = null;
    obj = null;
    stime = Date.now();
    headers = Object.create(null);
    resheaders = Object.create(null);
    #options = Object.create(null);

    constructor(options)
    {
        options ??= "";

        this.url = this.origUrl = lib.isString(options.url);
        this.data = options.binary ? Buffer.alloc(0) : '';
        this.redirects = lib.toNumber(options.redirects, { min: 0 });
        this.retryCount = lib.toNumber(options.retryCount, { min: 0 });
        this.retryTimeout = lib.toNumber(options.retryTimeout, { min: 0, dflt: 500 });
        this.retryMultiplier = lib.toNumber(options.retryMultiplier, { min: 1, dflt: 2 });
        this.httpTimeout = lib.toNumber(options.httpTimeout, { min: 0, dflt: 60000 });
        this.hardTimeout = lib.toNumber(options.hardTimeout, { min: 0 });
        this.errorCount = lib.toNumber(options.errorCount, { min: 0, dflt: this.retryCount });

        this.method = options.method || "GET";
        this.query = options.query || this.method === "GET" && options.body;
        this.postdata = this.method === "GET" ? undefined : options.postdata || options.body;

        if (options.headers) {
            this.headers = Object.assign(this.headers, options.headers);
        }

        for (const p in options) {
            if (p === "__proto__") continue;
            this.#options[p] = options[p];
            this[p] ??= options[p];
        }
    }

    init(url, callback)
    {
        if (this.poststream && !stream.isReadable(this.poststream)) {
            return lib.tryCall(callback, lib.newError("invalid poststream", 400), this);
        }

        if (this.stream && !stream.isWritable(this.stream)) {
            return lib.tryCall(callback, lib.newError("invalid stream", 400), this);
        }

        url = lib.isString(url);
        if (url) {
            this.origUrl = url;
        } else {
            url = this.url;
        }

        let query = this.query;

        if (lib.isObject(query)) {
            for (const p in query) {
                if (query[p] === undefined) delete query[p];
            }
            query = qs.stringify(query);
        } else {
            query = lib.isString(query);
        }
        if (query) {
            if (!url.includes("?")) url += "?";
            if (url.includes("&")) url += "&";
            url += query;
        }
        // orig url + query parameters
        this.url = url;

        const u = URL.parse(this.url);
        if (!u) {
            return lib.tryCall(callback, lib.newError("invalid url", 400), this);
        }

        const opts = {};
        for (const c of REUSE_COLS) {
            opts[c] = u[c];
        }

        opts.path = opts.pathname + opts.search;
        opts.method = this.method;
        opts.headers = this.headers;
        opts.agent = this.agent || null;
        opts.rejectUnauthorized = this.rejectUnauthorized;
        opts.timeout = this.httpTimeout;
        opts.maxHeaderSize = this.maxHeaderSize;
        opts.setDefaultHeaders = this.setDefaultHeaders;
        opts.setHost = this.setHost;
        opts.uniqueHeaders = this.uniqueHeaders;
        opts.joinDuplicateHeaders = this.joinDuplicateHeaders;
        opts.localAddress = this.localAddress;
        opts.localPort = this.localPort;
        opts.signal = this.signal;

        for (const c of REUSE_COLS) {
            this[c] = opts[c];
        }

        // Use file name from the url when only the path is given
        if (this.file && this.file[this.file.length - 1] === "/") {
            this.file += path.basename(this.pathname);
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
            this.headers.cookie = lib.objKeys(this.cookies).map(x => `${x}=${lib.encodeURIComponent(this.cookies[x])}`).join("; ");
        }

        if (!this.prepare(callback)) return null;

        for (const p in this.headers) {
            const h = this.headers[p];
            if (lib.isEmpty(h) || /[\r\n]/.test(h)) delete this.headers[p];
        }

        // Set again if changed
        opts.method = this.method = this.method || "GET";
        for (const c of REUSE_COLS) {
            this[c] = opts[c];
        }
        return opts;
    }

    prepare(callback)
    {
        // Data to be sent over in the body
        if (!this.preparePost(callback)) return;

        // Conditional, time related
        if (!this.prepareConditional(callback)) return;

        if (typeof this.signer === "function") {
            this.signer.call(this, this);
        }

        return true;
    }

    preparePost(callback)
    {
        switch (lib.typeName(this.formdata)) {
        case "object":
        case "array":
            this.method = "POST";
            this.postdata = qs.stringify(this.formdata);
            this.headers['content-type'] = "application/x-www-form-urlencoded";
            this.formdata = undefined;
            break;
        }

        if (lib.isArray(this.multipart)) {
            this.method = "POST";
            this.boundary = lib.uuid();
            const buf = [];
            for (const i in this.multipart) {
                const part = this.multipart[i];
                if (!part?.name) continue;
                let data = `--${this.boundary}\r\nContent-Disposition: form-data; name="${part.name}"`;
                data += part.file ? `; filename="${path.basename(part.file)}"\r\n` : "\r\n";
                if (Buffer.isBuffer(part.data)) {
                    data += `Content-Type: ${part.type || "application/octet-stream"}\r\n\r\n`;
                    buf.push(Buffer.from(data));
                    buf.push(part.data);
                    buf.push(Buffer.from("\r\n"));
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
            if (this.method === "GET") {
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
            if (this.method === "GET") {
                this.method = "POST";
            }
            if (this.chunked) {
                this.headers['transfer-encoding'] = 'chunked';
            } else {
                if (typeof this.postsize !== "number") {
                    fs.stat(this.postfile, (err, stats) => {
                        if (err) return callback(err, this);

                        this.mtime = stats.mtime.getTime();
                        this.postsize = stats.size;
                        lib.fetch(this, callback);
                    });
                    return;
                }
                this.headers['content-length'] = this.postsize;

                if (!this.headers["content-type"]) {
                    this.headers["content-type"] = lib.getMimeType(this.postfile);
                }
            }
            this.poststream = fs.createReadStream(this.postfile);
        }
        return true;
    }

    prepareConditional(callback)
    {
        if (this.conditional) {
            this.conditional = undefined;
            if (this.mtime) {
                this.headers["if-modified-since"] = lib.toDate(this.mtime).toUTCString();
            } else

            if (this.file) {
                fs.stat(this.file, (err, stats) => {
                    if (!err && stats.size > 0) {
                        this.mtime = stats.mtime.getTime();
                        this.headers["if-modified-since"] = lib.toDate(this.mtime).toUTCString();
                    }
                    lib.fetch(this, callback);
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
        this.size += Buffer.isBuffer(chunk) ? chunk.length: Buffer.byteLength(chunk, "utf8");
        this.logger("dev", "onData:");

        if (this.maxSize > 0 && this.size > this.maxSize) {
            this._destroy(lib.newError("too large", 413, "toolarge"), "onData:");
        }
    }

    writeStream(res, chunk)
    {
        try {
            if (!this.stream.write(chunk)) {
                res.pause();
                this.stream.once("drain", () => { res.resume() });
            }
        } catch (err) {
            this._destroy(err, "writeStream:");
        }
    }

    writeFile(res, chunk)
    {
        try {
            if (!this.fd) {
                this.fd = fs.openSync(this.file, 'w');
            }
            if (this.fd) {
                res.pause();
                fs.write(this.fd, chunk, 0, chunk.length, null, (err) => {
                    if (!err) {
                        return res.resume();
                    }
                    this._destroy(err, "writeFile:");
                });
            }
        } catch (err) {
            this._destroy(err, "writeFile:");
        }
    }

    onConnect(req, res)
    {
        this._destroy = (err, name) => {
            this.logger("error", name, err);
            this.err = err;
            req.destroy();
        }

        if (!this.binary && !this.stream && !this.file) {
            res.setEncoding("utf8")
        }

        if (this.stream) {
            this.stream.once("error", this._destroy);
        }
    }

    onError(err, callback)
    {
        this.close();
        if (this.done) return;

        if (!this.quiet) {
            this.logger(this.errorCount ? "debug" : "error", "onError:", err);
        }

        if (this.errorCount-- > 0) {
            this.lastError = err;

            if (typeof this.retryPrepare === "function") {
                this.retryPrepare.call(this, this);
            }
            this.#retry(callback);
        } else {
            this.#options = undefined;
            err.status = this.status = this.done = 529;
            if (typeof callback === "function") callback(err, this);
        }
    }

    onEnd(res, callback)
    {
        this.close();
        if (this.done) return;
        this.logger("dev", "onEnd:", "postdata:", this.postdata);

        const headers = Object.assign(this.resheaders, res.headers);

        this.status = res.statusCode || 0;
        this.ok = this.status >= 200 && this.status < 300;
        this.type = (headers['content-type'] || '').split(';')[0];
        this.date = headers.date ? lib.toDate(headers.date) : null;
        if (!this.size) {
            this.size = lib.toNumber(headers['content-length']);
        }
        if (this.cookies) {
            this.rescookies = this.parseSetCookies(headers["set-cookie"]);
        }

        // Retry the same request on status codes configured explicitely
        if ((this.status < 200 || this.status >= 400) &&
            ((typeof this.retryOnError === "function" && this.retryOnError.call(this)) || lib.toBool(this.retryOnError)) &&
            this.retryCount-- > 0) {
            this.lastError = `${this.status}: ${this.data}`;

            if (!this.quiet) {
                this.logger("debug", "onEnd:", "retry:", this.retryTotal, this.retryCount, this.retryTimeout);
            }

            if (typeof this.retryPrepare === "function") {
                this.retryPrepare.call(this, this);
            }
            this.#retry(callback);
            this.done = this.status || 1;
            return;
        }

        if (this.checkRedirect(callback)) return;

        if (typeof this.preparse === "function") {
            this.preparse.call(this);
        }

        // Parse JSON and store in the options, set error if cannot be parsed, the caller will deal with it
        if (this.data && !this.noparse) {
            const opts = { datatype: this.data_type, logger: this.datalogger, url: this.url };
            switch (this.type) {
            case "text/json":
            case "application/json":
            case "application/x-amz-json-1.0":
            case "application/x-amz-json-1.1":
            case "application/problem+json":
                for (const p in this) if (p.substr(0, 5) === "json_") opts[p.substr(5)] = this[p];
                this.obj = lib.jsonParse(this.data, opts);
                break;

            case "text/xml":
            case "application/xml":
            case "application/rss+xml":
            case "application/problem+xml":
                for (const p in this) if (p.substr(0, 4) === "xml_") opts[p.substr(4)] = this[p];
                this.obj = lib.xmlParse(this.data, opts);
                break;
            }
        }
        this.logger("debug", "onEnd:", "elapsed:", this.elapsed, "data:", this.data);

        // Return an error on status
        if ((this.status < 200 || this.status > 299) && !this.err && this.raise) {
            if (this.obj?.message) {
                this.err = this.obj;
                this.err.status = this.status;
            } else
            if (!lib.isEmpty(this.obj)) {
                this.err = { message: lib.inspect(this.obj), status: this.status };
            } else {
                this.err = { message: "Error " + this.status + (this.data ? ": " + this.data : ""), status: this.status };
            }
            if (this.err.status === 429 && !this.err.code) this.err.code = "OverCapacity";
        }

        this.#options = undefined;
        this.done = 1;
        if (typeof callback === "function") callback(this.err, this);
    }

    close()
    {
        this.etime = Date.now();
        this.elapsed = this.etime - this.stime;
        clearTimeout(this._timer);
        this._timer = undefined;

        if (this.fd) {
            try {
                fs.closeSync(this.fd)
            } catch (e) {
                this.logger("warn", "close:", e)
            }
            this.fd = 0;
        }

        if (this.stream) {
            if (!this.stream.writableEnded) {
                try {
                    this.stream.end()
                } catch (e) {
                    this.logger("warn", "close:", e)
                }
            }
            this.stream.off("error", this._destroy);
            this.stream = undefined;
        }
        this._destroy = undefined;
    }

    logger(level, name, ...args) {
        logger.logger(level, name, "fetch", this.id, this.method, this.url, this.status, this.size, this.type, this.lastError, ...args);
    }

    #retry(callback) {
        const opts = this.#options;
        this.#options = undefined;
        opts.retryTotal = lib.toNumber(this.retryTotal) + 1;
        opts.retryCount = this.retryCount;
        opts.errorCount = this.errorCount;
        const delay = lib.objMult(this, "retryTimeout", this.retryMultiplier, "old");
        opts.retryTimeout = this.retryTimeout;
        setTimeout(lib.fetch.bind(null, this.origUrl, opts, callback), delay);
        this.logger("dev", "retry:", opts);
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
            let url = this.resheaders.location || "";
            if (url.indexOf("://") === -1) {
                url = this.url.split("/").slice(0, 3).join("/") + url;
            }

            const opts = this.#options;
            this.#options = undefined;

            if (this.status < 307) {
                opts.method = "GET";
                opts.query = opts.body = opts.postdata = undefined;
            }

            opts.redirects = this.redirects;
            opts.headers = Object.create(null);
            for (const i in this.passheaders) {
                opts.headers[this.passheaders[i]] = this.headers[this.passheaders[i]];
            }

            lib.fetch(url, opts, callback);
            return true;
        }
    }

    /**
     * Parse Set-Cookie header and return an object of cookies: { NAME: { value: VAL, secure: true, expires: N ... } }
     */
    parseSetCookies(header)
    {
        var cookies = {};
        header = Array.isArray(header) ? header.filter((x) => (typeof x === "string")) :
                 typeof header === "string" ? header.split(/[:](?=\s*[a-zA-Z0-9_-]+\s*[=])/g) : [];
        for (const item of header) {
            const parts = item.split(";");

            let pair = parts[0].match(/([^=]+)=((?:.|\n)*)/);
            if (!pair) continue;

            const name = pair[1].trim(), cookie = { value: pair[2] || "" };
            if (cookie.value.includes("%")) {
                cookie.value = lib.decodeURIComponent(cookie.value);
            }

            for (let i = 1; i < parts.length; i++) {
                pair = parts[i].match(/([^=]+)(?:=((?:.|\n)*))?/);
                if (!pair) continue;
                const key = pair[1].trim().toLowerCase();
                let value = pair[2]?.trim();
                if (value?.includes("%")) {
                    value = lib.decodeURIComponent(value);
                }
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
 * @param {string} url - can be full URL or an object with parts of the url, same format as in url.format
 * @param {object|FetchRequest} [options] - customize request with input options
 * @return {object} - result as an object `{ ok, err, status, data, obj, request }` where data/obj are properties
 *  from the request for convenience and quick access
 *
 * @example
 * const { ok, err, data } = await lib.afetch("http://api.host.com/file.txt");
 *
 * const { status, err, obj } = await lib.afetch("http://api.host.com/user/123");
 *
 * const { err, obj } = await lib.afetch({ url: "http://api.host.com/user/123", query: { t: 1 } });
 *
 * const { err, obj } = await lib.afetch({ url: "http://api.host.com/user/123", postdata: { name: "myname" } });
 *
 * const { err, status, request } = await lib.afetch({ url: "http://api.host.com/user/123", method: "PUT", body: { name: "myname" } });
 *
 * const { err } = = await lib.afetch("http://127.0.0.1:8000/upload", {
 *                        multipart: [ { name: "file", file: "files2.txt", data: Buffer.from("....") } ]
 *                   });
 * @method afetch
 * @memberOf module:lib
 * @async
 */
lib.afetch = function(url, options)
{
    return new Promise((resolve, _reject) => {
        lib.fetch(url, options, (err, request) => {
            resolve({ err, ok: request.ok, status: request.status, data: request.data, obj: request.obj, request });
        });
    });
}
