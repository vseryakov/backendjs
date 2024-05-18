//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const lib = require(__dirname + '/../lib');
const api = require(__dirname + '/../api');
const logger = require(__dirname + '/../logger');

// CSRF token format: TYPE,RANDOM_INT,EXPIRE_MS,[UID]
//
// `type`` is `h` for header or `c`` for cookie
//
// Implements double cookie protection using HTTP and cookie tokens, both must be present.
//
// In addition a token may contain the account id which must be the same as logged in user.
//

// Return HTTP CSRF token, can be used in templates or forms, the cookie token will reuse the same token
api.getCsrfToken = function(req)
{
    if (req && !req.csrfToken) {
        req._csrfToken = `,${lib.randomInt()},${Date.now() + this.csrfAge},${!req._csrfPub && req.account?.id || ""}`;
        req.csrfToken = lib.encrypt(this.csrfTokenSecret || this.accessTokenSecret, "h" + req._csrfToken);
        logger.debug("getCsrfToken:", "new", req.options, "T:", req._csrfToken);
    }
    return req?.csrfToken;
}

// Returns .ok == false if CSRF token verification fails, both header and cookie are checked and retuned as .h and .c
api.verifyCsrfToken = function(req)
{
    var secret = this.csrfTokenSecret || this.accessTokenSecret;
    var ok, h = req.headers[this.csrfHeaderName] || req.query[this.csrfHeaderName] || req.body[this.csrfHeaderName];
    h = lib.decrypt(secret, h).split(",");
    if (h[0] === "h" && lib.toNumber(h[2]) > Date.now() && (!h[3] || h[3] === req.account?.id)) {
        var c = lib.decrypt(secret, req.cookies[this.csrfHeaderName]).split(",");
        if (c[0] === "c" && lib.toNumber(c[2]) > Date.now() && (!c[3] || c[3] === req.account?.id)) {
            // When using many tabs tokens may get out of sync but both must be valid account tokens
            ok = h[1] === c[1] || (req.account?.id && req.account?.id === h[3] && h[3] === c[3]);
        }
    }
    return { ok, h, c };
}

// For configured endpoints check for a token and fail if not present or invalid
api.checkCsrfToken = function(req, options)
{
    if (lib.testRegexpObj(req.options.path, this.csrfCheckPath)) {
        if (options?.force || !lib.testRegexp(req.method, this.csrfSkipMethod)) {
            var t = this.verifyCsrfToken(req);
            if (!t.ok) {
                logger.debug("invalidCsrfToken:", req.options, "H:", t.h, "C:", t.c, "HDR:", req.headers, "Q:", req.query);
                return { status: 401, message: this.errInvalidCsrf, code: "NOCSRF" };
            }
            logger.debug("checkCsrfToken:", "ok", req.options, "H:", t.h, "C:", t.c);
        }
    } else {
        var set = lib.testRegexpObj(req.options.path, this.csrfSetPath);
        if (!set) {
            // Set public tokens if no valid tokens are present
            if (!lib.testRegexpObj(req.options.path, this.csrfPubPath)) return;
            if (this.verifyCsrfToken(req).ok) return;
            req._csrfPub = 1;
        }
    }

    // Set header/cookie at the time of sending HTTP headers so account id is included in the token if present.
    this.registerPreHeaders(req, (req, res, status) => {
        if (req.csrfToken == 0 || lib.testRegexp(status, api.csrfSkipStatus)) return;

        res.header(api.csrfHeaderName, api.getCsrfToken(req));
        var csrfToken = lib.encrypt(api.csrfTokenSecret || api.accessTokenSecret, "c" + req._csrfToken);
        var opts = api.makeSessionCookie(req, {
            httpOnly: true,
            maxAge: api.csrfAge,
            secure: api.sessionSecure,
            sameSite: api.sessionSameSite,
        });
        res.cookie(api.csrfHeaderName, csrfToken, opts);
    });
}

// Do not return CSRF token in cooies or headers
api.skipCsrfToken = function(req)
{
    req.csrfToken = 0;
}

// Reset CSRF tokens from cookies and headers
api.clearCsrfToken = function(req)
{
    if (!req?.res) return;
    api.skipCsrfToken(req);
    req.res.cookie(api.csrfHeaderName, "", { expires: new Date(1), httpOnly: true, sameSite: "strict", secure: true });
    req.res.header(api.csrfHeaderName, req.csrfToken);
}

