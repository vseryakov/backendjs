/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */


const url = require('url');
const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');
const api = require(__dirname + '/../api');

/**
  * @module api/signature
  */

const mod =

/**
 * Authentication signature implementation
 *
 * All requests to the API server must be signed with user login/secret pair.

 * The algorithm how to sign HTTP requests (Version 1, 2):
 *  - Split url to path and query parameters with "?"
 *  - Split query parameters with "&"
 *  - ignore parameters with empty names
 *  - Sort list of parameters alphabetically
 *  - Join sorted list of parameters with "&"
 *     - Make sure all + are encoded as "%2B"
 *  - Form canonical string to be signed as the following:
 *     - Line1: The signature version
 *     - Line2: The application tag or other opaque data
 *     - Line3: The login name
 *     - Line4: The HTTP method(GET), followed by a newline.
 *     - Line5: The host name, lowercase, followed by a newline.
 *     - Line6: The request URI (/), followed by a newline.
 *     - Line7: The sorted and joined query parameters as one string, followed by a newline.
 *     - Line8: The expiration value in milliseconds, required, followed by a newline
 *     - Line9: The Content-Type HTTP header, lowercase, optional, followed by a newline
 *     - Line10: The SHA1 checksum of the body content, optional, for JSON and other forms of requests not supported by query parameters
 *  - Computed HMAC-SHA1 digest from the canonical string and encode it as BASE64 string, preserve trailing = if any
 *  - Form the signature HTTP header as the following:
 *     - The header string consist of multiple fields separated by pipe |
 *        - Field1: Signature version:
 *           - version 1, obsolete, do not use first 3 lines in the canonical string
 *           - version 2,3 to be used in session cookies only
 *           - version 4
 *        - Field2: Application tag or other app specific data
 *        - Field3: user login or whatever it might be in the login column
 *        - Field4: HMAC-SHA digest from the canonical string, version 1 uses SHA1, other SHA256
 *        - Field5: expiration value in milliseconds, same as in the canonical string
 *        - Field6: SHA1 checksum of the body content, optional, for JSON and other forms of requests not supported by query parameters
 *        - Field7: empty, reserved for future use

 * The resulting signature is sent as HTTP header **bk-signature** in in the query.

 */

module.exports = {
    name: "api.signature",
    args: [
        { name: "header", descr: "Header/query name to use for signature" },
        { name: "age", type: "int", descr: "Max age for request signature in milliseconds, how old the API signature can be to be considered valid, the 'expires' field in the signature must be less than current time plus this age, this is to support time drifts" },
        { name: "max-length", type: "int", descr: "Max login and tag length" },
    ],
    maxLength: 140,

    /**
     * @var {string} - header name to keep signature
     * @default
     */
    header: "bk-signature",
    rx: /^([^|]+)\|([^|]*)\|([^|]+)\|([^|]+)\|([^|]+)\|([^|]*)\|([^|]*)/,
};


/**
 * Returns a new signature object with all required properties filled form the request object
 * @param {object} req
 * @param {object} [options] - properties to put in the signature object
 * @returns {object}
 * @method fromRequest
 * @memberOf module:api/signature
 */
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

/**
 * Parse incoming request for signature and return all pieces wrapped in an object, this object will be used by `verifySignature` function.
 *
 * If the signature successfully recognized it is saved in the request as `req.signature`,
 * it always returns a signature object, a new one or existing
 * @param {Request} req - HTTP incoming request
 * @returns {object}
 * @memberOf module:api/signature
 * @method get
 */
mod.get = function(req)
{
    if (req.signature) return req.signature;

    var sig = this.fromRequest(req);
    var signature = req.query[this.header] || req.headers[this.header] || "";
    if (!signature) {
        var cookie = req.cookies && req.cookies[this.header];
        if (cookie) signature = lib.base64ToJson(cookie, api.accessTokenSecret);
        if (signature) sig.source = "s";
    }
    delete req.query[this.header];

    if (signature) {
        var d = signature.match(this.rx);
        if (d) {
            sig.version = lib.toNumber(d[1]);
            if (d[2]) sig.tag = d[2].trim().substr(0, mod.maxLength * 2);
            if (d[3]) sig.login = d[3].trim().substr(0, mod.maxLength);
            if (d[4]) sig.signature = d[4];
            sig.expires = lib.toNumber(d[5]);
            sig.checksum = d[6] || "";
            req.signature = sig;
        }
    }
    return sig;
}

/**
 * Returns non-empty signature if `sig` matches given user secret. `user` object must be a `bk_user` record.
 * @param {Request} req - HTTP incoming request
 * @param {object} sig - parsed signature to verify
 * @param {object} user - a user record with hashed password
 * @param {function} callback - function(signature)
 * @memberOf module:api/signature
 * @method verify
 */
mod.verify = function(req, sig, user, callback)
{
    // Verify the signature
    var secret = user?.secret;
    var query = (sig.query || "").split("&").sort().filter((x) => (!x.startsWith(this.header))).join("&");

    if (sig.version < 0) {
        lib.checkSecret(secret, sig.secret, (err, ok) => {
            if (!ok) logger.debug("verify:", mod.name, 'failed', err, sig, user);
            callback(ok && sig);
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
        var hooks = api.hooks.find('sig', sig.method, sig.path);
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

/**
 * Create secure signature for an HTTP request. Returns an object with HTTP headers to be sent in the response.
 * @param {string} login
 * @param {string} secret
 * @param {object} [options]
 * @param {string} [options.host] - request host
 * @param {string} [options.hostname] - request host
 * @param {string} [options.url] - path and query params as full URL
 * @param {string} [options.path] - request path
 * @param {string} [options.method] - GET, POST, ...
 * @param {string} [options.expires] is absolute time in milliseconds when this request will expire, default is 30 seconds from now
 * @param {string} [options.version] a version number defining how the signature will be signed
 * @param {string} [options.type] - content-type header, may be omitted
 * @param {string} [options.contentType] - content-type header, may be omitted
 * @param {string} [options.tag] - a custom tag, vendor specific, opaque to the bkjs, can be used for passing additional user or session information
 * @param {string} [options.checksum] - SHA1 digest of the whole content body, may be omitted
 * @param {string} [options.query] - on object with query parameters to use instead of parameters in the uri
 *
 * @returns {object} in format:
 * - value - signature string to be returned
 * - header - HTTP header or cookie name to be used
 * @memberOf module:api/signature
 * @method create
 */
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
    var hostname = lib.toString(options.hostname || options.host).split(":").shift().toLowerCase();
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
