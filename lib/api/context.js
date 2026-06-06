/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const util = require("node:util")
const http = require("node:http")
const stream = require("node:stream")
const qs = require("querystring");
const fs = require("node:fs");
const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');

const JSON_TYPE = "application/json; charset=utf-8"
const TEXT_TYPE = "text/plain; charset=utf-8"
const ERROR = "Internal error occurred, please try again later"

var _id = 0;
const _id_max = Number.MAX_SAFE_INTEGER/100000;

class UserContext {
    constructor(user) {
        for (const p in user) {
            if (p == "secret") {
                Object.defineProperty(this, p, { value: user[p], writable: true, enumerable: false });
            } else {
                this[p] = user[p];
            }
        }
    }
    toJSON() { return { id: this.id, name: this.name, roles: this.roles } }
    [Symbol.toPrimitive]() { return this.id }
}

/**
 * The Context object is instantiated for each request and is automatically destroyed after request is done. It wraps access to all request/response
 * runtime properties and supports returning properly formatted responses.
 *
 * @param {IncomingMessage} req
 * @param {OutgoingMessage} res
 * @param {object} [options]
 * @param {boolean} [options.trustProxy] - trus proxy headers
 * @class
 * - url - full url
 * - ip - cached IP address
 * - host - cached host header from the request
 * - hostname - cached host header without port
 * - location - hostname + path
 * - domain - domain part from the host
 * - path - path from url
 * - paths - an array with the path split by /, leading empty item removed
 * - search - query part from url, no ?
 * - contentType - Content-Type header value with mime-type only
 * - trace - X-Ray/Fake trace object
 * - user - set if authenticated
 * - params - current route's parsed params
 */

class RequestContext {
    reqID = `R${process.pid}.C${++_id >= _id_max ? (_id = 1) : _id}`
    time = Date.now()
    method
    url = "/"
    path = "/"
    paths
    search

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
    #req
    #res
    #auth
    #var = new Map()
    #options = {}
    #hooks = {}

    constructor(req, res, options) {
        for (const p in options) {
            this.#options[p] = options[p];
        }
        this.#res = res;
        if (req) {
            this.setUrl(req.url);
            this.#req = req;
            this.method = req.method;
            req.context = this;
        }
    }

    /**
      * Destroy the context, free memory and resources, call all destroy hooks
      */
    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;

        this.emit("destroy");

        this.#req = "";
        this.#res = "";
        this.#user = "";
        this.#body = "";
        this.#query = "";
        this.#cookies = "";
        this.#auth = "";
        this.#options = "";
        this.#hooks = "";
        this.#var.clear();
    }

    /**
    * Replace current request path including updating request options. It is used in routing and vhosting.
    * @param {string} [url] - new full request url, if new url has no ? then the original search is preserved
    */
    setUrl(url) {
        if (!lib.isString(url)) return;

        if (this.url) {
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
        this.paths = this.path.split("/").shift();

        // Reset computed getters
        this.#location = undefined;
        if (q) this.#query = undefined;

        logger.debug("setUrl:", "context", this)
    }

    get req() {
        return this.#req;
    }

    get res() {
        return this.#res;
    }

    get query() {
        this.#query ??= qs.parse(this.search);
        return this.#query;
    }

    get body() {
        return this.#body;
    }

    set body(body) {
        this.#body = body;
    }

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

    get ip() {
        this.#ip ??= this.#ips?.[0] || this.#req?.socket?.remoteAddress || '';
        return this.#ip;
    }

    get ips() {
        if (this.#ips === undefined) {
            this.#ips = lib.split(!this.#options.trustProxy && this.#req?.headers?.['x-forwarded-for'], ",");
        }
        return this.#ips;
    }

    get host() {
        if (this.#host === undefined) {
            var host = !this.#options.trustProxy && this.#req?.headers?.['x-forwarded-host'];

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

    get domain() {
        this.#domain ??= lib.domain(this.host);
        return this.#domain;
    }

    get location() {
        this.#location ??= this.host + this.path;
        return this.#location;
    }

    get user() {
        return this.#user;
    }

    set user(user) {
        if (user?.id) {
            this.#user = new UserContext(user);
            this.userId = user.id;
        } else {
            this.#user = undefined;
            delete this.userId
        }
        logger.debug("setUser:", "context", this)
    }

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
    * Parse Authorization header
    * @returns {object} { type, token, user, password }
    */
    get auth() {
        if (this.#auth === undefined) {
            const rc = {};
            let auth = this.#req?.headers?.authorization;
            if (auth) {
                let idx = auth.indexOf(" ");
                if (idx > -1) {
                    rc.type = auth.substr(0, idx);
                    rc.token = auth.substr(idx + 1);
                } else {
                    rc.token = auth;
                }

                if (rc.type == "Basic") {
                    auth = Buffer.from(rc.token, 'base64').toString();
                    idx = auth.indexOf(':');
                    if (idx > -1) {
                        rc.user = auth.substr(0, idx);
                        rc.password = auth.substr(idx + 1);
                    } else {
                        rc.user = auth;
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
        try {
            this.#res.setHeader(name, value);
        } catch (err) {
            logger.error("setHeader:", "context", this, "HDR:", name, "=", value, "ERR:", err);
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
     * Add a handler for a hook
     * @param {string} hook - hook name
     * @param {function} callback
     * @returns {this}
     * Supported hooks:
     *  - destroy - called when context is destroyed
     *  - error - fatal error occured
     *  - authenticated - user password verified
     *  - unauthenticated - user password failed
     *  - authorized - user access verified
     *  - unauthorized - user access denied
     */
    on(hook, callback) {
        if (!lib.isFunc(callback)) return this;
        if (!this.#hooks[hook]) this.#hooks[hook] = [];
        this.#hooks[hook].push(callback);
        return this;
    }

    /**
     * Emit hooks by name, promises are resolved awaited
     * @param {string} hook
     * @param {any} [data]
     * @async
     */
    async emit(hook, data) {
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
            await Promise.allSettled(pending);
        }
    }

    /**
     * @returns {boolean} true if the response has been closed, destroyed, written...
     */
    get closed() {
        const status = !this.#res || this.#res.headersSent || this.#res.writableEnded;
        if (status) logger.debug("send:", "context", this, "closed", this.#res?.headersSent, this.#res?.writableEnded);
        return status;
    }

    /**
     * Send final response with status and optional body
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
            body = lib.__(ERROR);
            status = 500;
            this.setHeader('content-length', Buffer.byteLength(body, 'utf8'));
            break;

        case "null":
        case "undefined":
            this.setHeader('content-length', 0);
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

        if ((status >= 100 && status < 200) || (status == 204 || status == 304)) {
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
     * Send error if not empty or the data as JSON
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

        body = typeof body == "string" ? body : lib.stringify(body ?? "");
        return this.send(200, body, JSON_TYPE);
    }

    /**
     * Send redirect response
     * @param {string|number} status - 302...308
     * @param {string} url - location
     * @returns {this}
     */
    redirect(status, url) {
        if (this.closed) return this

        url = lib.isString(url) || "/";

        this.#res.setHeader('location', !/[^\x00-\xFF]/.test(url) ? url : encodeURI(url))

        return this.send(status >= 301 && status <= 308 ? status : 302, `Redirect to ${url}`);
    }

    /**
     * Wrapper around fs.stat, handles index file in case if the file points to a directory
     * @param {string} file
     * @param {object} options
     * @param {function} callback
     */
    stat(file, options, callback) {
        fs.stat(file, (err, stat) => {
            if (!err && stat?.isDirectory()) {
                if (!options?.index) {
                    return callback({ code: 'ENOENT', message: 'no index found' });
                }
                file += "/" + options.index;
                return fs.stat(file, (err, stat) => {
                    if (!err) stat.file = file;
                    callback(err, stat);
                });
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
     * @param {string} [options.index] - index file to use for directories
     * @param {number} [options.start] - file start offset
     * @param {number} [options.end] - file end offset
     * @param {function} [next] - next middleware if not found
     * @returns {this}
     */
    sendFile(file, options, next) {
        if (this.closed) return this;

        file = lib.sanitizePath(options?.root, file);
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

                const unmodifiedSince = lib.toMtime(this.#req.headers['if-unmodified-since'])
                if (unmodifiedSince && stat.mtime > unmodifiedSince) {
                    return this.send(412)
                }

                if (options?.maxAge > 0) {
                    this.setHeader("cache-control", 'public, max-age=' + Math.floor(options.maxAge / 1000));
                } else

                if (options?.noCache) {
                    this.setHeader("cache-control", "max-age=0, no-cache, no-store");
                }

                if (options?.lastModified) {
                    this.setHeader('last-modified', stat.mtime.toUTCString());
                }

                const modifiedSince = lib.toMtime(this.#req.headers['if-modified-since'])
                if (modifiedSince) {
                    const cache = this.#req.headers['cache-control'];
                    if (stat.mtime <= modifiedSince && !/no-cache/.test(cache)) {
                        return this.send(304);
                    }
                }

                const mimeType = lib.getMimeType(file);
                this.setHeader('Content-Type', mimeType || 'application/octet-stream')

                const opts = {};
                let length = stat.size;

                if (options?.start > 0) {
                    opts.start = options?.start;
                    length = Math.max(0, length - opts.start);

                    if (options?.end > 0) {
                        length = Math.max(length, options.end - opts.start + 1);
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

    [Symbol.toPrimitive](hint) {
        return this.reqID
    }

}

module.exports = RequestContext;
