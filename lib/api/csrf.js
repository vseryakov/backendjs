/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const lib = require(__dirname + '/../lib');
const api = require(__dirname + '/../api');
const logger = require(__dirname + '/../logger');

/**
 * CSRF token format: TYPE,RANDOM_INT,EXPIRE_MS,[UID]
 *
 * `type`` is `h` for header or `c`` for cookie
 *
 * Implements double cookie protection using HTTP and cookie tokens, both must be present.
 *
 * In addition a token may contain the user id which must be the same as logged in user.
 */

const mod = {
    name: "api.csrf",
    args: [
        { name: "err-(.+)", descr: "Error messages for various cases" },
        { name: "set-path", type: "regexpobj", descr: "Regexp for URLs to set CSRF token for all methods, token type(user|pub) is based on the current session" },
        { name: "pub-path", type: "regexpobj", descr: "Regexp for URLs to set public CSRF token only if no valid CSRF token detected" },
        { name: "check-path", type: "regexpobj", descr: "Regexp for URLs to set CSRF token for skip methods and verify for others" },
        { name: "skip-method", type: "regexp", descr: "Do not check for CSRF token for specified methods" },
        { name: "skip-status", type: "regexp", descr: "Do not return CSRF token for specified status codes" },
        { name: "header", descr: "Name for the CSRF header" },
        { name: "secret", descr: "Secret for encryption" },
        { name: "age", type: "int", min: 0, descr: "CSRF token age in milliseconds" },
        { name: "same-site", descr: "Session SameSite option, for cookie based authentication" },
        { name: "secure", type: "bool", descr: "Set cookie Secure flag" },
    ],
    sameSite: "strict",
    secure: true,
    setPath: {},
    checkPath: {},
    skipMethod: /^(GET|HEAD|OPTIONS|TRACE)$/i,
    skipStatus: /^(5|3|401|403|404|417)/,
    header: "bk-csrf",
    age: 3600000,

    errInvalidCsrf: "Authentication failed",
};
module.exports = mod;

// Return HTTP CSRF token, can be used in templates or forms, the cookie token will reuse the same token
mod.get = function(req)
{
    if (req && !req.csrfToken) {
        req._csrfToken = `,${lib.randomInt()},${Date.now() + this.age},${!req._csrfPub && req.user?.id || ""}`;
        req.csrfToken = lib.encrypt(this.secret || api.accessTokenSecret, "h" + req._csrfToken);
        logger.debug("get:", mod.name, "new", req.options, "T:", req._csrfToken, "E:", !!req.csrfToken);
    }
    return req?.csrfToken;
}

// Returns .ok == false if CSRF token verification fails, both header and cookie are checked and retuned as .h and .c
mod.verify = function(req)
{
    var secret = this.secret || api.accessTokenSecret;
    var ok, h = req.headers[this.header] || req.query[this.header] || req.body[this.header];
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

// For configured endpoints check for a token and fail if not present or invalid
mod.check = function(req, options)
{
    if (lib.testRegexpObj(req.options.path, this.checkPath)) {
        if (options?.force || !lib.testRegexp(req.method, this.skipMethod)) {
            var t = this.verify(req);
            if (!t.ok) {
                logger.debug("invalidCsrfToken:", req.options, "H:", t.h, "C:", t.c, "HDR:", req.headers, "Q:", req.query);
                return { status: 401, message: this.errInvalidCsrf, code: "NOCSRF" };
            }
            logger.debug("check:", mod.name, "ok", req.options, "H:", t.h, "C:", t.c);
        }
    } else {
        var set = lib.testRegexpObj(req.options.path, this.setPath);
        if (!set) {
            // Set public tokens if no valid tokens are present
            if (!lib.testRegexpObj(req.options.path, this.pubPath)) return;
            if (this.verify(req).ok) return;
            req._csrfPub = 1;
        }
    }

    // Set header/cookie at the time of sending HTTP headers so user id is included in the token if present.
    api.registerPreHeaders(req, (req, res, status) => {
        if (req.csrfToken === 0 || lib.testRegexp(status, this.skipStatus)) return;

        res.header(this.header, this.get(req));
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

// Do not return CSRF token in cooies or headers
mod.skip = function(req)
{
    req.csrfToken = 0;
}

// Reset CSRF tokens from cookies and headers
mod.clear = function(req)
{
    if (!req?.res) return;
    this.skip(req);

    var opts = api.session.makeCookie(req, {
        expires: new Date(1),
        httpOnly: true,
        sameSite: "strict",
        secure: true
    });
    req.res.cookie(this.header, "", opts);
    req.res.header(this.header, req.csrfToken);
}

