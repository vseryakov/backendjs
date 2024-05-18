//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const lib = require(__dirname + '/../lib');
const api = require(__dirname + '/../api');
const logger = require(__dirname + '/../logger');
const ipc = require(__dirname + '/../ipc');

// Find a closest cookie by host/domain/path, longest takes precedence, returns found cookie merged with the options
api.makeSessionCookie = function(req, options)
{
    if (!req._sessionCookie) {
        var path = "", host = "";
        for (const p in this.sessionCookie) {
            if (p[0] == "/") {
                if (req.options.path.startsWith(p) && p.length > path.length) {
                    path = p;
                }
            } else
            if ((p === req.options.host || p === req.options.domain) && p.length > host.length) {
                host = p;
            }
        }
        if (path) req._sessionCookie = Object.assign({}, this.sessionCookie[path]);
        if (host) req._sessionCookie = Object.assign(req._sessionCookie || {}, this.sessionCookie[host]);
    }
    return Object.assign(options || {}, req._sessionCookie);
}

// Return named encrypted cookie
api.getSessionCookie = function(req, name)
{
    var value = req.cookies && req.cookies[name];
    return value && lib.base64ToJson(value, this.accessTokenSecret);
}

// Set a cookie by name and domain, the value is always encrypted
api.setSessionCookie = function(req, name, value)
{
    if (!req?.res || !name) return "";
    value = value ? lib.jsonToBase64(value, this.accessTokenSecret) : "";
    var opts = api.makeSessionCookie(req, {
        path: "/",
        httpOnly: true,
        secure: this.sessionSecure,
        sameSite: this.sessionSameSite,
    });
    if (value) {
        opts.maxAge = this.sessionAge;
    } else {
        opts.expires = new Date(1);
    }
    req.res.cookie(name, value, opts);
}

// Setup session cookies or access token for automatic authentication without signing, req must be complete with all required
// properties after successful authorization.
api.handleSessionSignature = function(req, callback)
{
    var options = this.getOptions(req);
    options.session = options.session && req.account?.login && req.account?.secret && req.headers ? true : false;
    var hooks = this.findHook('sig', req.method, req.path);
    logger.debug("handleSessionSignature:", hooks.length, "hooks", options);

    if (!hooks.length) {
        if (options.session) this.createSessionSignature(req, options);
        return lib.tryCall(callback);
    }

    lib.forEachSeries(hooks, function(hook, next) {
        hook.callback.call(api, req, req.account, null, next);
    }, (sig) => {
        if (!sig) {
            if (options.session) this.createSessionSignature(req, options);
        }
        lib.tryCall(callback);
    }, true);
}

api.createSessionSignature = function(req, options)
{
    var sig = this.createSignature(req.account.login, req.account.secret, "", req.headers.host, "", { version: 2, expires: options?.sessionAge || this.sessionAge });
    if (!this.noSession) this.setSessionCookie(req, this.signatureHeaderName, sig[this.signatureHeaderName]);
    return sig;
}

api.clearSessionSignature = function(req)
{
    this.saveSessionSignature(req.signature, -Date.now());

    if (!this.noSession) {
        this.setSessionCookie(req, this.signatureHeaderName, "");
    }
}

api.checkSessionSignature = function(sig, callback)
{
    if (this.noSession || !this.sessionAge || !sig?.signature) return lib.tryCall(callback);
    ipc.get(`SIG:${sig.login}:${sig.signature}`, { cacheName: this.sessionCache }, (err, val) => {
        logger.debug("checkSessionSignature:", sig, "VAL:", val);
        lib.tryCall(callback, err, val);
    });
}

api.saveSessionSignature = function(sig, val, callback)
{
    if (typeof val == "function") callback = val, val = 0;
    if (this.noSession || !this.sessionAge || !sig?.signature) return lib.tryCall(callback);
    logger.debug("saveSessionSignature:", sig, "VAL:", val);
    ipc.put(`SIG:${sig.login}:${sig.signature}`, val || Date.now(), { cacheName: this.sessionCache, ttl: this.sessionAge }, callback);
}
