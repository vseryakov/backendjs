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
// In addition the cookie token may contain the account id which must be the same as logged in user.
//

// Return HTTP CSRF token, can be used in templates or forms, the cookie token will reuse the same token
api.getCsrfToken = function(req)
{
    if (req && !req.csrfToken) {
        req._csrfToken = `,${lib.randomInt()},${Date.now() + this.csrfAge},`;
        req.csrfToken = lib.encrypt(this.csrfTokenSecret || this.accessTokenSecret, "h" + req._csrfToken);
        logger.debug("getCsrfToken:", "new", req.options, "T:", req._csrfToken);
    }
    return req?.csrfToken;
}

// For configured endpoints check for a token and fail if not present or invalid
api.checkCsrfToken = function(req, options)
{
    var secret = this.csrfTokenSecret || this.accessTokenSecret;

    if (lib.testRegexpObj(req.options.path, this.csrfCheckPath)) {
        if (options?.force || !lib.testRegexp(req.method, this.csrfSkipMethod)) {
            var ok, h = req.headers[this.csrfHeaderName] || req.query[this.csrfHeaderName] || req.body[this.csrfHeaderName];
            h = lib.decrypt(secret, h).split(",");
            if (h[0] === "h" && lib.toNumber(h[2]) > Date.now()) {
                var c = req.cookies[this.csrfHeaderName];
                c = lib.decrypt(secret, c).split(",")
                ok = c[0] === "c" && c[1] === h[1] && lib.toNumber(c[2]) > Date.now();
                if (ok && c[3]) ok = req.account?.id === c[3];
            }
            if (!ok) {
                logger.debug("checkCsrfToken:", "invalid", req.options, "H:", h, "C:", c, "HDR:", req.headers, "Q:", req.query);
                return { status: 401, message: this.errInvalidCsrf, code: "NOCSRF" };
            }
            logger.debug("checkCsrfToken:", "ok", req.options, "H:", h, "C:", c);
        }
    } else
    if (!lib.testRegexpObj(req.options.path, this.csrfSetPath)) {
        return;
    }

    logger.debug("checkCsrfToken:", "set", req.options);

    // Set header/cookie at the time of sending HTTP headers so account id is included in the token if present.
    this.registerPreHeaders(req, (req, res, status) => {
        if (lib.testRegexp(status, api.csrfSkipStatus)) return;

        res.header(api.csrfHeaderName, api.getCsrfToken(req));
        var csrfToken = lib.encrypt(secret, "c" + req._csrfToken + (req.account?.id || ""));
        res.cookie(api.csrfHeaderName, csrfToken, { maxAge: api.csrfAge, httpOnly: true, sameSite: this.sessionSameSite, secure: this.sessionSecure });
    });
}

api.clearCsrfToken = function(req)
{
    if (!req?.res) return;
    delete req.csrfToken;
    req.res.cookie(api.csrfHeaderName, "", { expires: new Date(1), httpOnly: true, sameSite: "strict", secure: true });
    req.res.removeHeader(api.csrfHeaderName);
}

