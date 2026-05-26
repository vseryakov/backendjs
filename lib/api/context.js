/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const http = require("node:http")
const qs = require("querystring");
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
 * Request context to be used by the middleware, reuses some details from the original req/res
 * @param {IncomingMessage} req
 * @param {OutgoingMessage} res
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
 */

class RequestContext {
    reqID = `${process.pid}.${++_id >= _id_max ? (_id = 1) : _id}`
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
        this.#req = req;
        this.#res = res;
        this.setUrl(req?.url);
    }

    /**
      * Destroy the context, free memory and resources, call all destroy hooks
      */
    destroy() {
        if (this.#req) {
            delete this.#req.context;
        }

        this.emit("destroy");

        this.#req = "";
        this.#res = "";
        this.#user = "";
        this.#body = "";
        this.#query = "";
        this.#cookies = "";
        this.#var.clear();
        this.#var = "";
        this.#auth = "";
        this.#options = "";
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

        if (this.#req) {
            this.method = this.#req.method;
            if (this.url != this.#req.url) {
                this.#req.url = this.url;
            }
        }
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
                const proto = !this.#options.noproxy && this.#req?.headers?.['x-forwarded-proto'];
                this.#proto = lib.split(proto, ",")[0] || 'http';
            }
        }
        return this.#proto;
    }

    get ip() {
        this.#ip ??= this.#ips[0] || this.#req?.socket?.remoteAddress || '';
        return this.#ip;
    }

    get ips() {
        if (this.#ips === undefined) {
            this.#ips = lib.split(!this.#options.noproxy && this.#req?.headers?.['x-forwarded-for'], ",");
        }
        return this.#ips;
    }

    get host() {
        if (this.#host === undefined) {
            var host = !this.#options.noproxy && this.#req?.headers?.['x-forwarded-host'];

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
     */
    setCookie(name, value, options) {
        if (!this.#res || this.#res.headersSent) return

        const str = lib.toCookie(name, value, options);
        if (!str) return

        const cookies = this.#res.getHeader("Set-Cookie");
        this.#res.setHeader("Set-Cookie", Array.isArray(cookies) ? cookies.concat(str) :
                                          cookies ? [cookies, str] : [str]);
        logger.debug("setCookie:", "context", this, "C:", name, str);
    }

    /**
     * Generic store for arbitrary variables to keep in the context, not to be logged
     * @param {any} key - key name, it uses Map so any value can be used
     * @param {any} [value] - value to store, if no value just return current value if exists
     * @returns {any}
     */
    var(key, value) {
        if (value === undefined) {
            return this.#var.get(key);
        }
        this.#var.set(key, value);
    }

    /**
     * Add a handler for a hook
     * @param {string} hook - hook name
     * @param {function} callback
     * Supported hooks:
     *  - destroy - called when context is destroyed
     */
    on(hook, callback) {
        if (!lib.isFunc(callback)) return;
        if (!this.#hooks[hook]) this.#hooks[hook] = [];
        this.#hooks[hook].push(callback);
    }

    /**
     * Emit hooks by name
     * @param {string} hook
     * @param {any} [data]
     */
    emit(hook, data) {
        for (const i in this.#hooks[hook]) {
            try {
                this.#hooks[hook][i](this, data);
            } catch (e) {
                logger.error(hook, "context", e);
            }
        }
    }

    /**
     * Send final response with status and optional body
     * @param {number|string} status - resonse HTTP status
     * @param {string|Buffer} [body]
     * @param {string} [type] - content type
     */
    send(status, body, type) {
        if (!this.#res || this.#res.headersSent) return

        switch (lib.typeName(body)) {
        case "error":
            // Do not show runtime errors
            logger.error("send:", "context", this, "E:", status, lib.traceError(body), "B:", this.#body);
            body = lib.__(ERROR);
            break;

        case "null":
        case "undefined":
            break;

        case "buffer":
            this.#res.setHeader('content-length', body.length);
            break;

        case "string":
            this.#res.setHeader('content-length', Buffer.byteLength(body, 'utf8'));
            break;

        default:
            type = JSON_TYPE;
            body = lib.stringify(body);
            this.#res.setHeader('content-length', Buffer.byteLength(body, 'utf8'));
        }

        if (body && !type) {
            type = TEXT_TYPE;
        }

        status = http.STATUS_CODES[status] ? status : 200;

        if ((status >= 100 && status < 200) || (status == 204 || status == 304)) {
            this.#res.removeHeader('content-type')
            this.#res.removeHeader('content-length')
            this.#res.removeHeader('transfer-encoding')
            body = undefined;
        } else

        if (type) {
            this.#res.setHeader('content-type', type)
            this.#res.setHeader('x-content-type-options', 'nosniff')
        }

        this.#res.statusCode = status
        return this.#res.end(body);
    }

    /**
     * Send JSON response
     * @param {string|object|array} - body
     */
    json(body) {
        if (!this.#res || this.#res.headersSent) return

        body = typeof body == "string" ? body : lib.stringify(body ?? "");
        this.send(200, body, JSON_TYPE);
    }

    /**
     * Send redirect response
     * @param {string|number} status - 302...308
     * @param {string} url - location
     */
    redirect(status, url) {
        if (!this.#res || this.#res.headersSent) return

        url = lib.isString(url) || "/";

        this.#res.setHeader('location', !/[^\x00-\xFF]/.test(url) ? url : encodeURI(url))

        this.send(status >= 301 && status <= 308 ? status : 302, `Redirect to ${url}`);
    }

    [Symbol.toPrimitive](hint) {
        return this.reqID
    }

}

module.exports = RequestContext;
