//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const lib = require(__dirname + '/../lib');
const api = require(__dirname + '/../api');
const logger = require(__dirname + '/../logger');

// Return existing or create a new token
api.getCsrfToken = function(req)
{
    if (req && !req.csrfToken) {
        var age = this.csrfAge, token = [lib.uuid(), Date.now() + age, req.options?.host];
        if (req.account?.id) token.push(req.account.id);
        req.csrfToken = lib.jsonToBase64(token, this.csrfTokenSecret || this.accessTokenSecret);
        if (req.res?.locals) req.res.locals.csrfToken = req.csrfToken;
        logger.debug("getCsrfToken:", req.options, "T:", token);
    }
    return req?.csrfToken;
}

// For configured endpoints check for a token and fail if not present or invalid
api.checkCsrfToken = function(req)
{
    if (lib.testRegexpObj(req.options.path, this.csrfCheckPath)) {
        if (!lib.testRegexp(req.method, this.csrfSkipMethod)) {
            var ok, h = req.headers[this.csrfHeaderName] || req.query[this.csrfHeaderName] || req.body[this.csrfHeaderName];
            h = h && lib.base64ToJson(h, this.csrfTokenSecret || this.accessTokenSecret);
            if (h && h[0] && lib.toNumber(h[1]) > Date.now() && req.options.host === h[2]) {
                var c = req.cookies[this.csrfHeaderName];
                c = c && lib.base64ToJson(c, this.csrfTokenSecret || this.accessTokenSecret);
                ok = c && lib.timingSafeEqual(c[0], h[0]);
                if (!ok) ok = req.account?.id && req.account.id === h[3];
            }
            if (!ok) {
                logger.debug("checkCsrfToken:", "invalid", req.account.id, req.options, "H:", h, "C:", c, "HDR:", req.headers);
                return { status: 401, message: this.errInvalidCsrf, code: "NOCSRF" };
            }
            logger.debug("checkCsrfToken:", req.account.id, req.options, "H:", h, "C:", c);
        }
    } else
    if (!lib.testRegexpObj(req.options.path, this.csrfSetPath)) {
        return;
    }

    logger.debug("checkCsrfToken:", req.account.id, req.options);
    // Set header/cookie at the tme of sending HTTP headers so account id is included in the token if present.
    this.registerPreHeaders(req, (req, res, status) => {
        if (lib.testRegexp(status, api.csrfSkipStatus)) return;
        res.cookie(api.csrfHeaderName, api.getCsrfToken(req), { maxAge: api.csrfAge, httpOnly: true, sameSite: this.sessionSameSite, secure: this.sessionSecure });
        res.header(api.csrfHeaderName, api.getCsrfToken(req));
    });
}

api.clearCsrfToken = function(req)
{
    if (!req?.res) return;
    req.res.cookie(api.csrfHeaderName, "", { expires: new Date(1), httpOnly: true, sameSite: "strict", secure: true });
    req.res.removeHeader(api.csrfHeaderName);
}

