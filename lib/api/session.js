/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const lib = require(__dirname + '/../lib');
const api = require(__dirname + '/../api');
const logger = require(__dirname + '/../logger');
const cache = require(__dirname + '/../cache');

const mod = {
    name: "api.session",
    args: [
        { name: "disabled", type: "bool", descr: "Disable cookie session support, all requests must be signed for Web clients" },
        { name: "cache", descr: "Cache name for session control" },
        { name: "age", type: "int", min: 0, descr: "Session age in milliseconds, for cookie based authentication" },
        { name: "same-site", descr: "Session SameSite option, for cookie based authentication" },
        { name: "secure", type: "bool", descr: "Set cookie Secure flag" },
        { name: "cookie-(.+)", obj: "session-cookie", type: "map", maptype: "auto", nocamel: 1, descr: "Cookie values for requests that match beginning of the path, ex -api-session-cookie-/testing secure:false,sameSite:None" },
    ],

    // Web session age
    age: 86400 * 14 * 1000,
    sameSite: "strict",
    secure: true,
    cookie: {},
};
module.exports = mod;

// Find a closest cookie by host/domain/path, longest takes precedence, returns found cookie merged with the options
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

// Return named encrypted cookie
mod.getCookie = function(req)
{
    var value = req.cookies && req.cookies[api.signature.header];
    return value && lib.base64ToJson(value, api.accessTokenSecret);
}

// Set a cookie by name and domain, the value is always encrypted
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

mod.create = function(req, options)
{
    var sig = api.signature.create(req.user?.login, req.user?.secret, { host: req.headers.host, version: 2, expires: options?.sessionAge || this.age });
    if (!this.disabled) this.setCookie(req, sig.header, sig.value);
    return sig;
}

mod.clear = function(req)
{
    this.save(req.signature, -Date.now());

    if (!this.disabled) {
        this.setCookie(req, api.signature.header, "");
    }
}

mod.check = function(sig, callback)
{
    if (this.disabled || !this.age || !sig?.signature) return lib.tryCall(callback);
    cache.get(`SIG:${sig.login}:${sig.signature}`, { cacheName: this.cache }, (err, val) => {
        logger.debug("check:", mod.name, sig, "VAL:", val);
        lib.tryCall(callback, err, val);
    });
}

mod.save = function(sig, val, callback)
{
    if (typeof val == "function") callback = val, val = 0;
    if (this.disabled || !this.age || !sig?.signature) return lib.tryCall(callback);
    logger.debug("save:", mod.name, sig, "VAL:", val);
    cache.put(`SIG:${sig.login}:${sig.signature}`, val || Date.now(), { cacheName: this.cache, ttl: this.age }, callback);
}
