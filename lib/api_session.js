//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const lib = require(__dirname + '/lib');
const api = require(__dirname + '/api');
const logger = require(__dirname + '/logger');
const ipc = require(__dirname + '/ipc');

// Return named encrypted cookie
api.getSessionCookie = function(req, name)
{
    var value = req.cookies && req.cookies[name];
    return value && lib.base64ToJson(value, this.accessTokenSecret);
}

// Set a cookie by name and domain, the value is always encrypted
api.setSessionCookie = function(req, name, value)
{
    if (!name) return "";
    value = value ? lib.jsonToBase64(value, this.accessTokenSecret) : "";
    var opts = { path: "/", httpOnly: true };
    if (value) {
        opts.maxAge = this.sessionAge;
    } else {
        opts.expires = new Date(1);
    }
    if (this.sessionSameSite) opts.SameSite = this.sessionSameSite;
    for (const p in this.sessionDomain) {
        if (this.sessionDomain[p].test(req.options.path)) {
            opts.domain = p;
            break;
        }
    }
    req.res.cookie(name, value, opts);
}

// Setup session cookies or access token for automatic authentication without signing, req must be complete with all required
// properties after successful authorization.
api.handleSessionSignature = function(req, callback)
{
    var options = this.getOptions(req);
    options.accesstoken = options.accesstoken && req.account && req.account.login && req.account.secret && req.headers ? true : false;
    options.session = options.session && req.account && req.account.login && req.account.secret && req.headers ? true : false;
    var hooks = this.findHook('sig', req.method, req.path);
    logger.debug("handleSessionSignature:", hooks.length, "hooks", options);

    if (!hooks.length) {
        if (options.accesstoken) this.createAccessTokenSignature(req, options);
        if (options.session) this.createSessionSignature(req, options);
        return lib.tryCall(callback);
    }

    lib.forEachSeries(hooks, function(hook, next) {
        hook.callback.call(api, req, req.account, null, next);
    }, (sig) => {
        if (!sig) {
            if (options.accesstoken) this.createAccessTokenSignature(req, options);
            if (options.session) this.createSessionSignature(req, options);
        }
        lib.tryCall(callback);
    });
}

api.createSessionSignature = function(req, options)
{
    var sig = this.createSignature(req.account.login, req.account.secret, "", req.headers.host, "", { version: 2, expires: options && options.sessionAge || this.sessionAge });
    if (!this.noSession) this.setSessionCookie(req, this.signatureHeaderName, sig[this.signatureHeaderName]);
    return sig;
}

api.clearSessionSignature = function(req)
{
    this.saveSessionSignature(req.signature, -Date.now());

    if (req.account) {
        delete req.account[this.accessTokenName];
        delete req.account[this.accessTokenName + '-age'];
    }
    if (!this.noSession) {
        this.setSessionCookie(req, this.signatureHeaderName, "");
    }
}

api.checkSessionSignature = function(sig, callback)
{
    if (this.noSession || !this.sessionAge || !sig || !sig.signature) return lib.tryCall(callback);
    ipc.get(`SIG:${sig.login}:${sig.signature}`, { cacheName: this.sessionCache }, callback);
}

api.saveSessionSignature = function(sig, val, callback)
{
    if (typeof val == "function") callback = val, val = 0;
    if (this.noSession || !this.sessionAge || !sig || !sig.signature) return lib.tryCall(callback);
    ipc.put(`SIG:${sig.login}:${sig.signature}`, val || Date.now(), { cacheName: this.sessionCache, ttl: this.sessionAge }, callback);
}
