//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const lib = require(__dirname + '/../lib');
const api = require(__dirname + '/../api');
const logger = require(__dirname + '/../logger');

// Must return a valid token from both header/body and cookies
api.getCsrfToken = function(req, properties)
{
    var h = req.headers[this.csrfHeaderName] || req.query._csrf || req.body._csrf;
    h = h && lib.base64ToJson(h, this.csrfTokenSecret || this.accessTokenSecret);
    if (!h || !h[0] || lib.toNumber(h[1]) < Date.now()) return null;
    var c = req.cookies[this.csrfHeaderName];
    c = c && lib.base64ToJson(c, this.csrfTokenSecret || this.accessTokenSecret);
    logger.debug("getCsrfToken:", h, "C:", c);
    return lib.timingSafeEqual(c && c[0], h[0]) ? h : undefined;
}

// Implements double submit CSRF tokens, sets a httpOnly cookie and HTTP header
api.setCsrfToken = function(req)
{
    if (!req?.res || req.csrfToken) return;
    var opts = [lib.uuid(), Date.now() + this.sessionAge];
    if (req.account.id) opts.push(req.account.id);
    req.csrfToken = lib.jsonToBase64(opts, this.csrfTokenSecret || this.accessTokenSecret);
    req.res.cookie(this.csrfHeaderName, req.csrfToken, { httpOnly: true, sameSite: "strict", maxAge: this.sessionAge, secure: this.sessionSecure });
    req.res.header(this.csrfHeaderName, req.csrfToken);
    logger.debug("setCsrfToken:", opts);
}

// For configured endpoints check for a token and fail if not present or invalid
api.checkCsrfToken = function(req)
{
    if (lib.testRegexpObj(req.options.path, this.csrfCheckPath)) {
        if (!lib.isFlag(this.csrfSkipMethods, req.method)) {
            var token = this.getCsrfToken(req);
            if (!token || (req.account?.id && req.account.id != token[2])) {
                logger.debug("handleCsrfToken:", req.account.id, req.options, "T:", token, "H:", req.headers);
                return { status: 401, message: "Authentication failed" };
            }
        }
        this.setCsrfToken(req);
    } else
    if (lib.testRegexpObj(req.options.path, this.csrfSetPath)) {
        this.setCsrfToken(req);
    }
}

