/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

/**
  * @module api/csrf
  */

const lib = require(__dirname + '/../lib');
const api = require(__dirname + '/../api');
const logger = require(__dirname + '/../logger');

const mod =

/**
 * ## Method 1: Origin/Sec-Fetch-Site headers
 *
 * In this mode `api-csrf-origins` and/or `api-csrf-sec-fetch-XXX` config parameters must be configured
 *
 * ## Method 2: Double Cookie mode
 *
 * Must be configured via `api-csrf-check-path` at least
 *
 * CSRF token format: TYPE,RANDOM_INT,EXPIRE_MS,[UID]
 *
 * type is
 *  - h for header
 *  - c for cookie
 *
 * Implements double cookie protection using HTTP and cookie tokens, both must be present. This means a web app must
 * handle the HTTP header, store and return in all API requests.
 *
 * In addition a token may contain the user id which must be the same for logged in users.
 *
 * It must be configured to be used, by default no paths are set
 *
 * @example <caption>Only allow specific origins</caption>
 * api-csrf-origins = https://example.com, https:/api.host.com
 *
 * @example <caption>Only allow same-site Sec-Fetch-Site for /api</caption>
 * api-csrf-sec-fetch-same-site = ^/api/
 *
 * @example <caption>Only allow same-origin Sec-Fetch-Site</caption>
 * api-csrf-sec-fetch-same-origin = ^/
 *
 * @example <caption>enable public CSRF token, this token will be returned later to make sure a user came from the sire, not from email</caption>
 * api-csrf-pub-path = ^/pub/$
 *
 * @example <caption>On all account access set new token</caption>
 * api-csrf-set-path = ^/account/get$
 *
 * @example <caption>Verify token for logout, i.e. will refuse to logout if not valid</caption>
 * api-csrf-check-path = ^/logout/
 *
 */

module.exports = {
    name: "api.csrf",
    args: [
        { name: "err-(.+)", descr: "Error messages for various cases" },
        { name: "origin-(.+)", obj: "origin", make: "$1", type: "regexpobj", nocamel: 1, descr: "Regexp for URLs to by allowed by origin", example: "api-csrf-origin-http://app.host.com = ^/account" },
        { name: "sec-fetch-(.+)", obj: "secFetch", make: "$1", type: "regexpobj", nocamel: 1, descr: "Regexp for URLs to use specific Sec-Fetch-Site header validation by: same-origin, same-site, cross-site, none", example: "api-csrf-sec-fetch-cross-site = ^/webhook\napi-csrf-sec-fetch-same-origin = ^/" },
        { name: "check-path", type: "regexpobj", descr: "Regexp for URLs to check and set CSRF token for allowed methods" },
        { name: "set-path", type: "regexpobj", descr: "Regexp for URLs to set CSRF token for all methods, token type(user|pub) is based on the current session, can be used to set initial token" },
        { name: "pub-path", type: "regexpobj", descr: "Regexp for URLs to set public CSRF token for all methods only if no valid CSRF token detected, to be used for initial token for public endpoints" },
        { name: "skip-method", type: "regexp", descr: "Do not check for CSRF token for specified methods" },
        { name: "skip-status", type: "regexp", descr: "Do not return CSRF token for specified status codes" },
        { name: "header", descr: "Name for the CSRF double cookie mode header" },
        { name: "secret", descr: "Secret for CSRF double cookie mode encryption" },
        { name: "age", type: "int", min: 0, descr: "CSRF token age in milliseconds" },
        { name: "same-site", descr: "Session SameSite option, for CSRF double cookie based authentication" },
        { name: "secure", type: "bool", descr: "Set CSRF double cookie Secure flag" },
    ],
    sameSite: "strict",
    secure: true,
    skipMethod: /^(GET|HEAD|OPTIONS|TRACE)$/i,
    skipStatus: /^(5|3|401|403|404|417)/,

    /** @var {string} - Header name
     * @default
     */
    header: "x-csrf-token",

    /** @var {int} - Default token age in ms
     * @default
     */
    age: 3600000,

    errInvalidCsrf: "Authentication failed",
};

const _secFetchSiteValues = ['same-origin', 'same-site', 'none', 'cross-site'];

/**
 * Validate CSRF protection
 * @param {IncomingRequest} req
 * @param {object} [options]
 * @returns {undefinded|object} - an error object if not valid
 * @memberof module:aws/csrf
 * @method check
 */
mod.check = function(req, options)
{
    if (this.origin || this.secFetch) {
        return this.checkOrigin(req, options);
    }
    return this.checkToken(req, options);
}

/**
 * Verify Origin and Sec-Fetch-Site headers
 * @param {IncomingRequest} req
 * @returns {undefinded|object} - an error object if not valid
 * @memberof module:aws/csrf
 * @method checkOrigin
 */
mod.checkOrigin = function(req, options)
{
    if (req._csrfOrigin) return;

    if (lib.testRegexp(req.method, mod.skipMethod)) return;

    const path = req.options.path;
    const origin = req.header('origin');
    if (!origin ||
        !(lib.testRegexpObj(path, mod.origin?.[origin]) ||
            origin === URL.parse(req.options.origin)?.origin)) {
        logger.debug("checkOrigin:", mod.name, req.options, "HDR:", req.headers, "CONF:", mod.origin);
        return { status: 403, message: mod.errInvalidCsrf, code: "NOORIGIN" };
    }

    const secFetchSite = req.header('sec-fetch-site');
    if (!secFetchSite ||
        !_secFetchSiteValues.includes(secFetchSite) ||
        !(secFetchSite === "same-origin" || lib.testRegexpObj(path, mod.secFetch?.[secFetchSite]))) {
        logger.debug("checkSecFetchSite:", mod.name, req.options, "HDR:", req.headers, "CONF:", mod.secFetch);
        return { status: 403, message: mod.errInvalidCsrf, code: "NOSECFETCHSITE" };
    }
    req._csrfOrigin = 1;
}

/**
 * Return HTTP CSRF token, can be used in templates or forms, the cookie token will reuse the same token
 * @param {IncomingRequest} req
 * @returns {string}
 * @memberof module:api/csrf
 * @method getToken
 */
mod.getToken = function(req)
{
    if (req && !req.csrfToken) {
        req._csrfToken = `,${lib.randomInt()},${Date.now() + this.age},${!req._csrfPublic && req.user?.id || ""}`;
        req.csrfToken = lib.encrypt(this.secret || api.accessTokenSecret, "h" + req._csrfToken);
        logger.debug("getToken:", mod.name, "new", req.options, "T:", req._csrfToken, "E:", !!req.csrfToken);
    }
    return req?.csrfToken;
}

/**
 * Returns .ok == false if CSRF token verification fails, both header and cookie are checked and retuned as .h and .c
 * @param {IncomingRequest} req
 * @returns {object} as { ok, h, c }
 * @memberof module:api/csrf
 * @method verifyToken
 */
mod.verifyToken = function(req)
{
    var secret = this.secret || api.accessTokenSecret;
    var ok, h = req.headers?.[this.header] || req.query?.[this.header] || req.body?.[this.header];
    h = lib.decrypt(secret, h).split(",");

    var c, cookie = req.cookies && req.cookies[this.header];

    if (cookie && h[0] === "h" && lib.toNumber(h[2]) > Date.now() && (!h[3] || h[3] === req.user?.id)) {
        c = lib.decrypt(secret, cookie).split(",");

        if (c[0] === "c" && lib.toNumber(c[2]) > Date.now() && (!c[3] || c[3] === req.user?.id)) {
            // When using many tabs tokens may get out of sync but both must be valid user tokens
            ok = h[1] === c[1] || (req.user?.id && req.user?.id === h[3] && h[3] === c[3]);
        }
    }
    return { ok, h, c };
}

/**
 * For configured endpoints check for a token or Origin/Sec-Fetch-Site and fail if not present or invalid
 * @param {IncomingRequest} req
 * @param {object} [options]
 * @returns {undefinded|object} - an error object if not valid
 * @memberof module:api/csrf
 * @method checkToken
 */
mod.checkToken = function(req, options)
{
    if (lib.testRegexpObj(req.options.path, this.checkPath)) {
        if (options?.force || !lib.testRegexp(req.method, this.skipMethod)) {
            var t = this.verifyToken(req);
            if (!t.ok) {
                logger.debug("checkToken:", mod.name, "bad:", req.options, "T:", t, "HDR:", req.headers, "Q:", req.query);
                return { status: 403, message: this.errInvalidCsrf, code: "NOCSRF" };
            }
            logger.debug("checkToken:", mod.name, "ok", req.options, "T:", t);
        }
    } else {
        var set = lib.testRegexpObj(req.options.path, this.setPath);
        if (!set) {
            // Set public tokens if no valid tokens are present
            if (!lib.testRegexpObj(req.options.path, this.pubPath)) return;
            if (this.verifyToken(req).ok) return;
            req._csrfPublic = 1;
        }
    }

    // Set header/cookie at the time of sending HTTP headers so user id is included in the token if present.
    api.registerPreHeaders(req, (req, res, status) => {
        if (req.csrfToken === false || lib.testRegexp(status, this.skipStatus)) return;

        res.header(this.header, this.getToken(req));
        var csrfToken = lib.encrypt(this.secret || api.accessTokenSecret, "c" + req._csrfToken);
        var opts = api.session.makeCookie(req, {
            httpOnly: true,
            maxAge: mod.age,
            secure: this.secure,
            sameSite: this.sameSite,
        });
        res.cookie(this.header, csrfToken, opts);
    });
}

/**
 * Reset CSRF tokens from cookies and headers
 * @param {IncomingRequest} req
 * @memberof module:api/csrf
 * @method clearToken
 */
mod.clearToken = function(req)
{
    if (!req?.res || !mod.checkPath) return;
    req.csrfToken = false;

    var opts = api.session.makeCookie(req, {
        expires: new Date(1),
        httpOnly: true,
        sameSite: "strict",
        secure: true
    });
    req.res.cookie(this.header, "", opts);
    req.res.header(this.header, req.csrfToken);
}

