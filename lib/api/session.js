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
    ],

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
            if ((p === req.options.host || p === req.options.domain) && p.length > host.length) {
                host = p;
            }
        }
        if (path) req._sessionCookie = Object.assign({}, this.cookie[path]);
        if (host) req._sessionCookie = Object.assign(req._sessionCookie || {}, this.cookie[host]);
    }
    return Object.assign(options || {}, req._sessionCookie);
}

/**
 * Return named encrypted signature cookie, uses {@link module:api/signature.header}
 * @param {Request} req
 * @memberof module:api/session
 * @method getCookie
 */
mod.getCookie = function(req)
{
    var value = req.cookies && req.cookies[api.signature.header];
    return value && lib.base64ToJson(value, api.accessTokenSecret);
}

/**
 * Set a cookie by name and domain, the value is always encrypted
 * @param {Request} req
 * @param {string} name
 * @param {string|Object} value
 * @memberof module:api/session
 * @method setCookie
 */
mod.setCookie = function(req, name, value)
{
    if (!req?.res || !name) return "";
    value = value ? lib.jsonToBase64(value, api.accessTokenSecret) : "";
    var opts = this.makeCookie(req, {
        path: "/",
        httpOnly: true,
        secure: this.secure,
        sameSite: this.sameSite,
    });
    if (value) {
        opts.maxAge = this.age;
    } else {
        opts.expires = new Date(1);
    }
    req.res.cookie(name, value, opts);
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
    var hooks = api.hooks.find('sig', req.method, req.path);
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
 * Create a session cookie for the request
 * @param {Request} req
 * @param {Object} [options]
 * @memberof module:api/session
 * @method create
 */
mod.create = function(req, options)
{
    var sig = api.signature.create(req.user?.login, req.user?.secret, { host: req.headers.host, version: 2, expires: options?.sessionAge || this.age });
    if (!this.disabled) this.setCookie(req, sig.header, sig.value);
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
        this.setCookie(req, api.signature.header, "");
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
