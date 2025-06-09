//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const url = require('url');
const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');
const api = require(__dirname + '/../api');

const mod = {
    name: "api.signature",
    args: [
        { name: "header", descr: "Header name to sotee signature" },
        { name: "age", type: "int", descr: "Max age for request signature in milliseconds, how old the API signature can be to be considered valid, the 'expires' field in the signature must be less than current time plus this age, this is to support time drifts" },
    ],
    header: "bk-signature",
    rx: /^([^|]+)\|([^|]*)\|([^|]+)\|([^|]+)\|([^|]+)\|([^|]*)\|([^|]*)/,
};
module.exports = mod;

// Returns a new signature object with all required properties filled form the request object
mod.fromRequest = function(req, options)
{
    var rc = { version: 1, expires: 0, now: Date.now() };
    var url = (req.signatureUrl || req.url || "/").split("?");
    rc.path = url[0];
    rc.query = url[1] || "";
    rc.method = req.method || "";
    rc.host = lib.toString(req.headers.host).split(':').shift().toLowerCase();
    rc.type = lib.toString(req.headers['content-type']).toLowerCase();
    return Object.assign(rc, options);
}

// Parse incoming request for signature and return all pieces wrapped in an object, this object will be used by `verifySignature` function.
//
// If the signature successfully recognized it is saved in the request as `req.signature`,
// it always returns a signature object, a new one or existing
mod.get = function(req)
{
    if (req.signature) return req.signature;

    var sig = this.fromRequest(req);
    var signature = req.query[this.header] || req.headers[this.header] || "";
    if (!signature) {
        signature = api.session.getCookie(req);
        if (signature) sig.source = "s";
    }
    delete req.query[this.header];

    if (signature) {
        var d = signature.match(this.rx);
        if (d) {
            sig.version = lib.toNumber(d[1]);
            if (d[2]) sig.tag = d[2].trim().substr(0, api.users.maxLength * 2);
            if (d[3]) sig.login = d[3].trim().substr(0, api.users.maxLength);
            if (d[4]) sig.signature = d[4];
            sig.expires = lib.toNumber(d[5]);
            sig.checksum = d[6] || "";
            req.signature = sig;
        }
    }
    return sig;
}

// Returns true if the signature `sig` matches given user secret. `user` object must be a `bk_user` record.
mod.verify = function(req, sig, user, callback)
{
    // Verify the signature
    var secret = user.secret;
    var query = (sig.query || "").split("&").sort().filter((x) => (!x.startsWith(this.header))).join("&");

    if (sig.version < 0) {
        api.users.checkSecret(user, sig.secret, (err) => {
            if (err) logger.debug("verify:", mod.name, 'failed', err, sig, user);
            callback(err ? null : sig);
        });
        return;
    }

    switch (sig.version) {
    case 2:
    case 3:
        sig.str = sig.version + "\n" + (sig.tag || "") + "\n" + sig.login + "\n*\n" + lib.domainName(sig.host) + "\n/\n*\n" + sig.expires + "\n*\n*\n";
        sig.hash = lib.sign(secret, sig.str, "sha256");
        break;

    case 4:
        sig.str = sig.version + "\n" + (sig.tag || "") + "\n" + sig.login + "\n" + sig.method + "\n" + sig.host + "\n" + sig.path + "\n" + query + "\n" + sig.expires + "\n" + sig.type + "\n" + sig.checksum + "\n";
        sig.hash = lib.sign(secret, sig.str, "sha256");
        break;

    default:
        sig.hash = NaN;
        var hooks = this.findHook('sig', sig.method, sig.path);
        if (hooks.length) {
            lib.forEachSeries(hooks, (hook, next) => {
                hook.callback(req, user, sig, next);
            }, (rc) => {
                if (!rc) logger.debug("verify:", mod.name, 'failed', sig, user);
                callback(rc);
            }, true);
            return;
        }
    }

    if (!lib.timingSafeEqual(sig.signature, sig.hash)) {
        logger.debug('verify:', mod.name, 'failed', sig, user);
        sig = null;
    }
    callback(sig);
}

// Create secure signature for an HTTP request. Returns an object with HTTP headers to be sent in the response.
//
// The options may contains the following:
//  - host or hostname - request host
//  - url - path and query params as full URL
//  - path - request path
//  - query - an object with query params
//  - method - GET, POST, ...
//  - expires is absolute time in milliseconds when this request will expire, default is 30 seconds from now
//  - version a version number defining how the signature will be signed
//  - type or contentType - content-type header, may be omitted
//  - tag - a custom tag, vendor specific, opaque to the bkjs, can be used for passing additional user or session information
//  - checksum - SHA1 digest of the whole content body, may be omitted
//  - query - on object with query parameters to use instead of parameters in the uri
//
// Returns:
// - value - signature string to be returned
// - header - HTTP header or cookie name to be used
//
mod.create = function(login, secret, options)
{
    if (!login || !secret) return {};
    if (!options) options = {};
    var ver = options.version || 4;
    var method = lib.toString(options.method);
    // Internal use only
    if (ver < 0) return rc;
    var now = Date.now();
    var expires = lib.toNumber(options.expires, { dflt: 30000 }) + lib.randomInt(0, 1000);
    if (expires < now) expires += now;
    var tag = String(options.tag || "");
    var ctype = lib.toString(options.contentType || options.type).toLowerCase();
    var checksum = lib.toString(options.checksum);
    var hostname = lib.toString(options.host || options.hostname).split(":").shift().toLowerCase();
    var q = lib.toString(options.path || options.url || "/").split("?");
    var path = q[0];
    var query = options.query || q[1] || "";
    if (typeof query == "object") query = url.format({ query: options.query });
    query = query.split("&").sort().filter((x) => (x)).join("&");
    var rc = {}, str, hmac;
    switch (ver) {
    case 2:
    case 3:
        path = "/";
        method = query = "*";
        rc.domain = hostname = lib.domainName(hostname);
        rc.maxAge = Math.floor((expires - now)/1000);
        rc.expires = expires;
        rc.path = path;
        str = ver + '\n' + tag + '\n' + lib.toString(login) + "\n" + method + "\n" + hostname + "\n" + path + "\n" + query + "\n" + expires + "\n*\n*\n";
        hmac = lib.sign(secret, str, "sha256")
        break;

    case 4:
    default:
        str = ver + '\n' + tag + '\n' + lib.toString(login) + "\n" + method + "\n" + hostname + "\n" + path + "\n" + query + "\n" + expires + "\n" + ctype + "\n" + checksum + "\n";
        hmac = lib.sign(secret, str, "sha256")
    }
    rc.header = this.header;
    rc.value = ver + '|' + tag + '|' + lib.toString(login) + '|' + hmac + '|' + expires + '|' + checksum + '|';
    logger.debug('create:', mod.name, rc);
    return rc;
}
