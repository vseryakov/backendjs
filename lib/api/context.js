/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
'use strict';

const util = require("node:util")
const path = require("node:path")
const http = require("node:http")
const stream = require("node:stream")
const qs = require("node:querystring");
const fs = require("node:fs");
const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');

const JSON_TYPE = "application/json; charset=utf-8"
const TEXT_TYPE = "text/plain; charset=utf-8"
const ERROR = "Internal error occurred, please try again later"
const ENCODINGS = {
    br: '.br',
    zstd: '.zst',
    gzip: '.gz',
};

var _id = 0;
const _id_max = Number.MAX_SAFE_INTEGER/100000;
const _empty = Object.freeze({})

class UserContext {
    constructor(user) {
        for (const p in user) {
            switch (p) {
            case "id":
            case "name":
            case "roles":
                this[p] = user[p];
                break;

            default:
                Object.defineProperty(this, p, { value: user[p], writable: true, enumerable: false });
            }
        }
    }
    toJSON() { return { id: this.id, name: this.name, roles: this.roles } }
    [Symbol.toPrimitive]() { return this.id }
}

/**
 * The Context object is instantiated for each request and is automatically destroyed after request is done,
 * all middleware and routing is using the context.
 *
 * It wraps access to all request/response runtime properties and supports returning properly formatted responses.
 *
 * @param {IncomingMessage} req
 * @param {OutgoingMessage} res
 * @param {object} [options]
 * @param {boolean} [options.trustProxy] - trus proxy headers
 * @class
 */

class RequestContext {

    /** @var {string} - semi-unique request ID, per process */
    reqID = `R${process.pid}.C${++_id >= _id_max ? (_id = 1) : _id}`

    /** @var {number} - request creation timestamp */
    time = Date.now()

    /** @var {string} - HTTP method */
    method

    /** @var {string} - full request url from the IncomingMessage */
    url

    /** @var {string} - request path only */
    path = "/"

    /** @var {string[]} - an array with the path split by /, leading empty item removed */
    paths

    /** @var {string} - query part from url, without leading question mark */
    search

    /** @var {string} - when user is set this property will contain user.id */
    userId

    /** @var {{id:string, exp:number}} - parsed or created session */
    session

    #user
    #query
    #body
    #ip
    #ips
    #host
    #proto
    #hostname
    #location
    #domain
    #contentType
    #cookies
    #params = _empty
    #req
    #res
    #auth
    #var = new Map()
    #options = Object.create(null)
    #hooks = Object.create(null)

    constructor(req, res, options) {
        for (const p in options) {
            this.#options[p] = options[p];
        }
        if (req) {
            this.#req = req;
            this.method = req.method;
            this.setUrl(req.url);
            req.context = this;
        }
        if (res) {
            this.#res = res;
            res.context = this;
        }
    }

    /**
      * Destroy the context, free memory and resources, call all destroy hooks, async hooks should expect properties being empty
      */
    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;

        logger.dev("destroy:", "context", this);

        this.emit("destroy");

        if (this.#req) {
            delete this.#req.context;
        }
        if (this.#res) {
            delete this.#res.context;
        }

        this.#req = _empty;
        this.#res = _empty;
        this.#user = _empty;
        this.#body = _empty;
        this.#query = _empty;
        this.#cookies = _empty;
        this.#auth = _empty;
        this.#params = _empty;
        this.#options = _empty;
        this.#hooks = _empty;
        this.#var.clear();
    }

    /**
    * Replace current request path including updating request options. It is used in routing and vhosting.
    * @param {string} [url] - new full request url, if new url has no ? then the original search is preserved
    * @returns {this}
    */
    setUrl(url) {
        if (!lib.isString(url)) return this;

        if (this.url && this.url !== url) {
            this.orig = {
                url: this.url,
                path: this.path,
                search: this.search,
            }
        }
        this.url = url;
        const q = this.url.indexOf("?");
        this.search = q > -1 ? this.url.substr(q + 1) : this.orig?.search ?? "";
        this.path = q > -1 ? this.url.substr(0, q) : this.url;
        this.paths = this.path.split("/").slice(1);

        // Reset computed getters
        this.#location = undefined;
        this.#query = undefined;

        logger.debug("setUrl:", "context", this)
        return this;
    }

    /**
     * Current request
     * @type {IncomingMessage}
     */
    get req() {
        return this.#req;
    }

    /**
     * Current response
     * @type {OutgoingMessage}
     */
    get res() {
        return this.#res;
    }

    /**
     * Query object
     * @type {object}
     */
    get query() {
        this.#query ??= qs.parse(this.search);
        return this.#query;
    }

    /**
     * Body object
     * @type {undefined|string|object|Buffer}
     */
    get body() {
        return this.#body;
    }

    set body(body) {
        this.#body = body;
    }

    /**
     * Route named or wildcard params from the path
     * @type {object}
     */
    get params() {
        return this.#params;
    }

    set params(data) {
        if (data && typeof data === "object") {
            this.#params = data;
        }
    }

    /**
     * Current protocol without colon, ex. http, https, if options.trustProxy is true uses proxy headers
     * @type {string}
     */
    get proto() {
        if (this.#proto === undefined) {
            if (this.#req?.socket?.encrypted) {
                this.#proto = "https"
            } else {
                const proto = this.#options.trustProxy && this.#req?.headers?.['x-forwarded-proto'];
                this.#proto = lib.split(proto, ",")[0] || 'http';
            }
        }
        return this.#proto;
    }

    /**
     * Current IP address, if options.trustProxy is true uses proxy headers
     * @type {string}
     */
    get ip() {
        this.#ip ??= this.ips?.[0] || this.#req?.socket?.remoteAddress || '';
        return this.#ip;
    }

    /**
     * List of all IP addresses from the proxy headers
     * @type {string[]}
     */
    get ips() {
        if (this.#ips === undefined) {
            this.#ips = lib.split(this.#options.trustProxy && this.#req?.headers?.['x-forwarded-for'], ",");
        }
        return this.#ips;
    }

    /**
     * Current host header, if options.trustProxy is true uses proxy headers
     * @type {string}
     */
    get host() {
        if (this.#host === undefined) {
            let host = this.#options.trustProxy && this.#req?.headers?.['x-forwarded-host'];

            if (!host && this.#req?.httpVersionMajor >= 2) {
                host = this.#req?.headers?.[':authority'];
            }
            if (!host) {
                host = this.#req?.headers?.host || "";
            }
            if (host) {
                const comma = host.indexOf(',');
                if (comma > -1) {
                    host = host.substring(0, comma).trim();
                }
            }
            this.#host = host.toLowerCase();
        }
        return this.#host;
    }

    /**
     * Current host name without port
     * @type {string}
     */
    get hostname() {
        if (this.#hostname === undefined) {
            const host = this.host;
            // IPv6 literal support
            const offset = host[0] === '[' ? host.indexOf(']') + 1 : 0;
            const colon = host.indexOf(':', offset);
            this.#hostname = colon !== -1 ? host.substring(0, colon) : host;
        }
        return this.#hostname;
    }

    /**
     * Domain name from the current hostname
     * @type {string}
     */
    get domain() {
        this.#domain ??= lib.domain(this.host);
        return this.#domain;
    }

    /**
     * Full location as host/path
     * @type {string}
     */
    get location() {
        this.#location ??= this.host + this.path;
        return this.#location;
    }

    /**
     * Currrent authenticated user, on set property `userId` is created for faster access,
     * it is not cleared on reseting the user to be logged by access logger
     * @type {object}
     */
    get user() {
        return this.#user;
    }

    set user(user) {
        if (user?.id) {
            this.#user = new UserContext(user);
            this.userId = user.id;
        } else {
            this.#user = undefined;
        }
        logger.debug("setUser:", "context", this, this.#user)
    }

    /**
     * Content type form the header, only MIME type, eg. text/json
     * @type {string}
     */
    get contentType() {
        if (this.#contentType === undefined) {
            let contentType = this.#req?.headers?.["content-type"] || "";
            const sep = contentType.indexOf(";");
            if (sep > -1) {
                contentType = contentType.substr(0, sep).trim();
            }
            this.#contentType = contentType;
        }
        return this.#contentType;
    }

    /**
    * Parse and return Authorization header as an object
    * - type - first word, Basic, Bearer or other type
    * - token - the value after type field, for Basic type the value is decoded from base64
    * - user - for type Basic it is the user name part before :
    * - password - for type Basic it is the second part after :
    * @type {{ type:string, token:string, user:string, password:string }}
    */
    get auth() {
        if (this.#auth === undefined) {
            const rc = Object.create(null);
            const auth = this.#req?.headers?.authorization;
            if (auth) {
                let idx = auth.indexOf(" ");
                if (idx > -1) {
                    rc.type = auth.substr(0, idx);
                    Object.defineProperty(rc, "token", { value: auth.substr(idx + 1) });
                } else {
                    Object.defineProperty(rc, "token", { value: auth });
                }

                if (rc.type === "Basic") {
                    const token = Buffer.from(rc.token, 'base64').toString();
                    idx = token.indexOf(':');
                    if (idx > -1) {
                        Object.defineProperty(rc, "user", { value: token.substr(0, idx) });
                        Object.defineProperty(rc, "password", { value: token.substr(idx + 1) });
                    } else {
                        Object.defineProperty(rc, "user", { value: token });
                    }
                }
            }
            this.#auth = rc;
        }
        return this.#auth;
    }

    /**
     * No-exceptions version of res.setHeader
     * @param {string} name
     * @param {any} value
     * @returns {this}
     */
    setHeader(name, value) {
        if (!this.#res || this.#res.headersSent) return this;

        try {
            this.#res.setHeader(name, value);
        } catch (err) {
            logger.error("setHeader:", "context", this, "HDR:", name, "=", value, "ERR:", err);
        }
        return this;
    }

    /**
     * No-exceptions version of res.appendHeader
     * @param {string} name
     * @param {string|string[]} value
     * @returns {this}
     */
    appendHeader(name, value) {
        if (!this.#res || this.#res.headersSent) return this;

        try {
            this.#res.appendHeader(name, value);
        } catch (err) {
            logger.error("appendHeader:", "context", this, "HDR:", name, "=", value, "ERR:", err);
        }
        return this;
    }

    /**
    * Return a cookie value by name from the reauest
    * @param {string} name - cookie name
    * @returns {string|undefined} value
    */
    cookie(name) {
        this.#cookies ??= lib.parseCookies(this.#req?.headers?.cookie);
        return this.#cookies[name];
    }


    /**
     * Add cookies to response's Set-Cookies
     * @param {string} name - cookie name
     * @param {string} value - cookie value
     * @param {object} [options] - cookie options for {@link module:lib.toCookie}
     * @returns {this}
     */
    setCookie(name, value, options) {
        if (!this.#res || this.#res.headersSent) return this;

        const str = lib.toCookie(name, value, options);
        if (!str) return this;

        const cookies = this.#res.getHeader("Set-Cookie");
        this.setHeader("Set-Cookie", Array.isArray(cookies) ? cookies.concat(str) :
                                     cookies ? [cookies, str] : [str]);
        logger.dev("setCookie:", "context", this, "SET:", name, str);
        return this;
    }

    /**
     * Generic store for arbitrary variables to keep in the context, not to be logged
     * @param {any} key - key name, it uses Map so any value can be used
     * @param {any} [value] - value to store, if no value just return current value if exists
     * @returns {any} - old value
     */
    var(key, value) {
        const old = this.#var.get(key)
        if (value !== undefined) {
            this.#var.set(key, value);
        }
        return old;
    }

    /**
     * Add a handler for a hook, this is similar to event emmiters
     * @param {string} hook - hook name
     * @param {function} callback (context, data)
     * @returns {this}
     * Supported hooks:
     *  - destroy - called when context is destroyed
     *  - error - fatal error occured
     */
    on(hook, callback) {
        if (!lib.isFunc(callback)) return this;
        if (!this.#hooks[hook]) this.#hooks[hook] = [];
        this.#hooks[hook].push(callback);
        return this;
    }

    /**
     * Emit hooks by name, promises are resolved but not awaited,
     * all listeners are executed in the order of registration
     * @param {string} hook
     * @param {any} [data]
     * @example <caption>DB op will finish in the background</caption>
     *
     * context.on("event", async (ctx, data) => {
     *     await db.update(......)
     *     console.log("done!")
     * })
     *
     * context.emit("event", data)
     * ...
     * 'done!'
     *
     */
    emit(hook, data) {
        const pending = [];
        for (const i in this.#hooks[hook]) {
            try {
                const res = this.#hooks[hook][i](this, data);
                if (util.types.isPromise(res)) {
                    pending.push(res);
                }
            } catch (e) {
                logger.error(hook, "context", this, "ERR:", e);
            }
        }
        if (pending.length) {
            Promise.allSettled(pending).then(lib.none);
        }
    }

    /**
     * @var {boolean} - true if the response has been closed, destroyed, written...
     */
    get closed() {
        const status = !this.#res || this.#res.headersSent || this.#res.writableEnded;
        if (status) logger.debug("send:", "context", this, "closed", this.#res?.headersSent, this.#res?.writableEnded);
        return status;
    }

    /**
     * Send final response with status and optional body.
     * NOTE: After this call the context becomes empty (calls destroy on response end), all properties are reset.
     * @param {number|string} status - resonse HTTP status
     * @param {string|Buffer} [body]
     * @param {string} [type] - content type
     * @returns {this}
     */
    send(status, body, type) {
        if (this.closed) return this

        switch (lib.typeName(body)) {
        case "error":
            // Do not show runtime errors
            logger.error("send:", "context", this, "ERR:", status, lib.traceError(body), "BODY:", this.#body);
            type = JSON_TYPE;
            body = lib.stringify({ status: 500, message: lib.__(ERROR) });
            status = 500;
            this.setHeader('content-length', Buffer.byteLength(body, 'utf8'));
            break;

        case "null":
        case "undefined":
            if (!this.#res.getHeader("transfer-encoding")) {
                this.setHeader('content-length', 0);
            }
            break;

        case "buffer":
            this.setHeader('content-length', body.length);
            break;

        case "string":
            this.setHeader('content-length', Buffer.byteLength(body, 'utf8'));
            break;

        default:
            type = JSON_TYPE;
            body = lib.stringify(body);
            this.setHeader('content-length', Buffer.byteLength(body, 'utf8'));
        }

        if (body && !type) {
            type = TEXT_TYPE;
        }

        status = http.STATUS_CODES[status] ? status : 200;

        if ((status >= 100 && status < 200) || (status === 204 || status === 304)) {
            this.#res.removeHeader('content-type')
            this.#res.removeHeader('content-length')
            this.#res.removeHeader('content-range')
            this.#res.removeHeader('content-language')
            this.#res.removeHeader('transfer-encoding')
            body = undefined;
        } else

        if (this.method === "HEAD") {
            body = undefined;
        } else

        if (type) {
            this.setHeader('content-type', type)
            this.setHeader('x-content-type-options', 'nosniff')
        }

        logger.dev("send:", "context", this, "end", status, type, body?.length);

        this.#res.statusCode = status
        return this.#res.end(body);
    }

    /**
     * Send error if not empty or the data as JSON, uses send
     * @param {undefined|object|Error} - err
     * @param {string|object|array} - body if no error
     * @returns {this}
     */
    reply(err, data) {
        if (this.closed) return this;

        if (err) {
            return this.send(err.status || 500, err, JSON_TYPE);
        }
        return this.json(data);
    }

    /**
     * Send JSON response
     * @param {string|object|array} - body
     * @returns {this}
     */
    json(body) {
        if (this.closed) return this

        body = typeof body === "string" ? body : lib.stringify(body ?? "");
        return this.send(200, body, JSON_TYPE);
    }

    /**
     * Send redirect response
     * @param {string|number} status - 301...308
     * @param {string} url - location
     * @returns {this}
     */
    redirect(status, url) {
        if (this.closed) return this

        url = lib.isString(url) || "/";

        this.setHeader('location', !/[^\x00-\xFF]/.test(url) ? url : encodeURI(url))

        return this.send(status >= 301 && status <= 308 ? status : 302, `Redirect to ${url}`);
    }

    /**
     * Wrapper around fs.stat, handles index file in case if the file points to a directory and precompressed encoding
     * @param {string} file
     * @param {object} [options] - same as in {@link RequestContext.sendFile}
     * @param {string} [options.index] - index file to use for directories
     * @param {regexp} [options.precompressed] - if path matched serve precompressed file if exists
     * @param {string} [options.encoding=gzip] - precompressed encoding type: gzip, br, zstd
     * @param {function} callback
     */
    stat(file, options, callback) {
        fs.stat(file, (err, stat) => {
            if (err) {
                return callback(err, stat);
            }

            if (stat?.isDirectory()) {
                if (!options?.index) {
                    return callback({ code: 'ENOENT', message: 'no index found' });
                }
                file += "/" + options.index;
                return fs.stat(file, (err, stat) => {
                    if (!err) stat.file = file;
                    callback(err, stat);
                });
            } else

            if (util.types.isRegExp(options?.precompressed) && options.precompressed.test(file)) {
                const encoding = options.encoding || "gzip";

                if (lib.split(this.#req.headers['accept-encoding']).includes(encoding)) {
                    file += ENCODINGS[encoding];

                    return fs.stat(file, (err, stat2) => {
                        if (err) {
                            return callback(null, stat);
                        }

                        stat2.file = file;
                        this.setHeader('Content-Encoding', encoding);
                        this.appendHeader('Vary', 'Accept-Encoding');
                        callback(err, stat2);
                    });
                }
            }

            callback(err, stat);
        });
    }

    /**
     * Stream a file to response, close on error or finish
     * @param {string} file
     * @param {object} [options]
     * @param {string} [options.root] - root directory
     * @param {number} [options.maxAge] - file cache age in ms
     * @param {boolean} [options.noCache] - return no-cache header
     * @param {boolean} [options.lastModified] - send Last-Modified header
     * @param {number} [options.start] - file start offset
     * @param {number} [options.end] - file end offset
     * @param {boolean} [options.etag] - generate and check weak etag
     * @param {string} [options.index] - index file to use for directories
     * @param {regexp} [options.precompressed] - if path matched serve precompressed file if exists
     * @param {string} [options.encoding=gzip] - precompressed encoding type: gzip, br, zstd
     * @param {function} [next] - next middleware if not found
     * @returns {this}
     */
    sendFile(file, options, next) {
        if (this.closed) return this;

        file = lib.validatePath(options?.root, file);
        if (!file) {
            return this.send(403, "invalid path");
        }
        if (file.endsWith("/") && options?.index) {
            file += options.index;
        }

        this.stat(file, options, (err, stat) => {
            logger.dev("sendFile:", "context", this, file, options, "STAT:", stat, "ERR:", err);

            try {
                if (err) {
                    if (err.code === 'ENOENT') {
                        return lib.isFunc(next) ? next() : this.send(404, "not found");
                    }
                    return this.reply(err);
                }

                if (options?.lastModified) {
                    this.setHeader('last-modified', stat.mtime.toUTCString());
                }

                if (options?.noCache) {

                    this.setHeader("cache-control", "max-age=0, no-cache, no-store");

                } else {

                    if (options?.maxAge >= 0) {
                        this.setHeader("cache-control", 'public, max-age=' + Math.floor(options.maxAge / 1000));
                    }

                    if (options?.etag) {

                        let etag = this.#res.getHeader("etag");
                        if (!etag) {
                            etag = `W/"${lib.toBase62(stat.mtime.getTime())}-${lib.toBase62(stat.size)}"`;
                            this.setHeader("etag", etag);
                        }

                        const _etag = etag.replace(/^W\//, "");

                        const ifNoneMatch = this.#req.headers['if-none-match'];
                        if (ifNoneMatch && lib.split(ifNoneMatch).find(x => _etag === x.replace(/^W\//, ""))) {
                            return this.send(304);
                        }

                        if (!etag.startsWith("W/")) {
                            const ifMatch = this.#req.headers['if-match'];
                            if (ifMatch && !lib.split(ifMatch).find(x => etag === x)) {
                                return this.send(412)
                            }
                        }
                    }

                    const unmodifiedSince = Math.floor(lib.toMtime(this.#req.headers['if-unmodified-since'])/1000)
                    if (unmodifiedSince && Math.floor(stat.mtimeMs/1000) > unmodifiedSince) {
                        return this.send(412)
                    }

                    const modifiedSince = Math.floor(lib.toMtime(this.#req.headers['if-modified-since'])/1000)
                    if (modifiedSince) {
                        if (Math.floor(stat.mtimeMs/1000) <= modifiedSince && !options?.noCache) {
                            return this.send(304);
                        }
                    }
                }

                const mimeType = lib.getMimeType(file);
                this.setHeader('Content-Type', mimeType || 'application/octet-stream')

                const opts = {};
                let length = stat.size;

                if (options?.start > 0) {
                    opts.start = options?.start;
                    length = Math.max(0, length - opts.start);

                    if (options?.end > opts.start) {
                        length = Math.min(length, options.end - opts.start + 1);
                    }
                    opts.end = Math.max(opts.start, opts.start + length - 1);
                }

                this.setHeader('content-length', length);

                stream.pipeline(fs.createReadStream(stat.file || file, opts), this.#res, (err) => {
                    if (err) logger.error("sendFile:", "context", this, file, options, "ERR:", err);
                });
            } catch (e) {
                this.reply(e);
            }
        });

        return this;
    }

    /**
    * Replace placeholders in the given text with details fron the context
    * @param {string} text - it may contain placeholders in the form: @name@:
    * - HOST - full host name from header
    * - IP - remote IP address
    * - DOMAIN - domain from the hostname
    * - PATH - full path
    * - PATH[1-9] - path starting from given index till the end, eg.: /a/b/c/d, PATH2 will be b/c/d
    * - URL - full url
    * - BASE - basename from the path no extention
    * - FILE - base file name with extention
    * - DIR - directory name only
    * - SUBDIR - last part of the directory path
    * - EXT - file extention
    * - SEARCH - search from the full url
    * @return {string} all known placeholders are replaced
    */
    format(text) {
        return text.replace(/@(HOST|IP|DOMAIN|PATH([1-9])?|URL|BASE|FILE|DIR|SUBDIR|EXT|SEARCH)@/g, (_, m) => {
            switch (m.substr(0, 2)) {
            case "HO": return this.host;
            case "IP": return this.ip;
            case "DO": return this.domain;
            case "PA": return m[4] > 0 ? this.paths.slice(m[4] - 1).join("/") : this.path;
            case "UR": return this.url;
            case "BA": return path.basename(this.path).split(".").shift();
            case "FI": return path.basename(this.path);
            case "DI": return path.dirname(this.path);
            case "SU": return path.dirname(this.path).split("/").pop();
            case "EX": return path.extname(this.path);
            case "SE": return this.search;
            }
        });
    }

    [Symbol.toPrimitive](_hint) {
        return this.reqID
    }

}

module.exports = RequestContext;
