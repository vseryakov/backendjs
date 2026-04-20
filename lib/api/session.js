/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

/**
  * @module api/session
  */

const lib = require(__dirname + '/../lib');
const api = require(__dirname + '/../api');
const logger = require(__dirname + '/../logger');
const cache = require(__dirname + '/../cache');

const mod =

/**
 * Session cookies support
 */


module.exports = {
    name: "api.session",
    args: [
        { name: "disabled", type: "bool", descr: "Disable cookie session support, all requests must be signed for Web clients" },
        { name: "cache", descr: "Cache name for session control" },
        { name: "age", type: "int", min: 0, descr: "Session age in milliseconds, for cookie based authentication" },
        { name: "same-site", descr: "Session SameSite option, for cookie based authentication" },
        { name: "secure", type: "bool", descr: "Set cookie Secure flag" },
        { name: "cookie-(.+)", obj: "session-cookie", type: "map", nocamel: 1, descr: "Cookie values for requests that match beginning of the path", example: "-api-session-cookie-/testing secure:false,sameSite:None" },
        { name: "secret", descr: "Cookies secret" },
        { name: "header", descr: "Header to use for signature" },
    ],

    /**
     * @var {string} - header name to keep signature
     * @default
     */
    header: "bk-signature",

    // Web session age
    age: 86400 * 14 * 1000,
    sameSite: "strict",
    secure: true,
    cookie: {},
};


/**
 * Find a closest cookie by host/domain/path, longest takes precedence, returns found cookie merged with the options
 * @param {Request} req
 * @param {Object} [options]
 * @returns {Object}
 * @memberof module:api/session
 * @method makeCookie
 */
mod.makeCookie = function(req, options)
{
    if (!req._sessionCookie) {
        var path = "", host = "";
        for (const p in this.cookie) {
            if (p[0] == "/") {
                if (req.options.path.startsWith(p) && p.length > path.length) {
                    path = p;
                }
            } else
            if ((p === req.options.hostname || p === req.options.host || p === req.options.domain) && p.length > host.length) {
                host = p;
            }
        }
        if (path) req._sessionCookie = Object.assign({}, this.cookie[path]);
        if (host) req._sessionCookie = Object.assign(req._sessionCookie || {}, this.cookie[host]);
    }
    return Object.assign(options || {}, req._sessionCookie);
}

/**
 * Return named encrypted signature cookie value
 * @param {Request} req
 * @param {string} name - cookie name
 * @memberof module:api/session
 * @method getCookie
 */
mod.getCookie = function(req, name)
{
    var value = api.getCookie(req, name);
    return value && lib.base64ToJson(value, mod.secret || api.tokenSecret);
}

/**
 * Set a cookie by name and domain, the value is always encrypted
 * @param {Request} req
 * @param {string} name
 * @param {string|Object} value
 * @param {Object} [options]
 * @memberof module:api/session
 * @method setCookie
 */
mod.setCookie = function(req, name, value, options)
{
    if (!req?.res || !name) return;
    value = value ? lib.jsonToBase64(value, mod.secret || api.tokenSecret) : "";
    var opts = this.makeCookie(req, {
        httpOnly: true,
        path: options?.path ?? "/",
        secure: options?.secure ?? this.secure,
        sameSite: options?.sameSite ?? this.sameSite,
    });
    if (value) {
        opts.maxAge = options?.age ?? this.age;
    } else {
        opts.expires = new Date(1);
    }
    req.res.cookie(name, value, opts);
    logger.debug("setCookie:", mod.name, name, opts);
}

/**
 * Setup session cookies or access token for automatic authentication without signing, req must be complete with all required
 * properties after successful authorization.
 * @param {Request} req
 * @param {function} [callback]
 * @memberof module:api/session
 * @method setup
 */
mod.setup = function(req, callback)
{
    req.options.session = req.user?.login && req.user?.secret && req.headers ? true : false;

    var hooks = api.hooks.find('sig', req.method, req.options.path || req.path);
    logger.debug("setup:", mod.name, hooks.length, "hooks", req.options);

    if (!hooks.length) {
        if (req.options.session) this.create(req, req.options);
        return lib.tryCall(callback);
    }

    lib.forEachSeries(hooks, (hook, next) => {
        hook.callback.call(api, req, req.user, null, next);
    }, (sig) => {
        if (!sig) {
            if (req.options.session) this.create(req, req.options);
        }
        lib.tryCall(callback);
    }, true);
}


/**
 * Parse session cookies or headers for valid signature, if the signature successfully recognized it is saved in the request as `req.signature`,
 * it always returns a signature object, a new one or existing
 * @param {Object} req
 * @returns {Object} - signature Object
 * @memberof module:api/session
 * @method parse
 */
mod.parse = function(req)
{
    if (!req.signature?.signature) {
        var sig = api.signature.parse(req, req.headers?.[this.header]);
        if (!sig) {
            sig = api.signature.parse(req, this.getCookie(req, this.header));
            if (sig) sig.source = "s";
        }
        if (sig) {
            req.signature = api.signature.fromRequest(req, sig);
        }
    }
    logger.debug("parse:", mod.name, req.signature, "H:", req.headers);
    return req.signature;
}

/**
 * Create a session cookie for the request
 * @param {Request} req
 * @param {Object} [options]
 * @memberof module:api/session
 * @method create
 */
mod.create = function(req, options)
{
    var sig = api.signature.create(req.user?.login, req.user?.secret, { host: req.headers.host, version: 2, expires: options?.sessionAge || this.age });
    if (!this.disabled) {
        this.setCookie(req, this.header, sig.value);
    }
    return sig;
}

/**
 * Clear session cookie for the request
 * @param {Request} req
 * @memberof module:api/session
 * @method clear
 */
mod.clear = function(req)
{
    this.save(req.signature, -Date.now());

    if (!this.disabled) {
        this.setCookie(req, this.header, "");
    }
}

/**
 * Return saved signature from the cache
 * @param {Object} sig
 * @param {function} callback
 * @memberof module:api/session
 * @method check
 */
mod.check = function(sig, callback)
{
    if (this.disabled || !this.age || !sig?.signature) return lib.tryCall(callback);
    cache.get(`SIG:${sig.login}:${sig.signature}`, { cacheName: this.cache }, (err, val) => {
        logger.debug("check:", mod.name, sig, "VAL:", val);
        lib.tryCall(callback, err, val);
    });
}

/**
 * Save given signature and value in the cache, to handle expired or revoked signatures
 * @param {Object} sig
 * @param {any} val
 * @param {function} [callback]
 * @memberof module:api/session
 * @method save
 */
mod.save = function(sig, val, callback)
{
    if (typeof val == "function") callback = val, val = 0;
    if (this.disabled || !this.age || !sig?.signature) return lib.tryCall(callback);
    logger.debug("save:", mod.name, sig, "VAL:", val);
    cache.put(`SIG:${sig.login}:${sig.signature}`, val || Date.now(), { cacheName: this.cache, ttl: this.age }, callback);
}
