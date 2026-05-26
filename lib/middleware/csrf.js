/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

/**
  * @module middleware/csrf
  */

const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');

const mod =

/**
 * ## Origin/Sec-Fetch-Site headers checks
 *
 * `middleware-csrf-origin` and/or `middleware-csrf-sec-fetch` config parameters must be configured,
 * only matched paths or locations are checked, so CSRF protection is explicit by the config.
 *
 * @example <caption>Only allow specific origins for /account</caption>
 * middleware-csrf-origin-^/account = http://app.host.com
 * middleware-csrf-origin-^/account = https://host.com,http://localhost
 *
 * @example <caption>Only allow same-site or same-origin Sec-Fetch-Site for /api</caption>
 * middleware-csrf-sec-fetch-^/api/ = same-site
 * middleware-csrf-sec-fetch-^/api/ = same-origin,same-origin
 *
 * @example <caption>Only allow same-origin Sec-Fetch-Site</caption>
 * middleware-csrf-sec-fetch-^/ = same-origin
 *
 */

module.exports = {
    name: "middleware.csrf",
    args: [
        { name: "err-(.+)", descr: "Error messages for various cases" },
        { name: "origin-(.+)", obj: "origin", make: "$1", type: "regexpobj", reverse: 1, nocamel: 1, onupdate: () => { for (const p in this.origin) delete this.origin[p].values }, descr: "Regexp for URLs to by allowed by origin", example: "middleware-csrf-origin-^/account = http://host.com\nmiddleware-csrf-origin-^/account = https://host.com,http://localhost" },
        { name: "sec-fetch-(.+)", obj: "secFetch", make: "$1", type: "regexpobj", reverse: 1, nocamel: 1, onupdate: () => { for (const p in this.secFetch) delete this.secFetch[p].values }, descr: "Regexp for URLs to use specific Sec-Fetch-Site header validation by: same-origin, same-site, cross-site, none", example: "middleware-csrf-sec-fetch-^/webhook = cross-site\nmiddleware-csrf-sec-fetch-^/ = same-origin,same-site" },
        { name: "skip-method", type: "list", descr: "Do not check for specified methods" },
    ],
    skipMethod: ["GET", "HEAD", "OPTIONS", "TRACE" ],

    errInvalidCsrf: "Authentication failed",
};

/**
 * Verify Origin and Sec-Fetch-Site headers for non-skipping methods
 * @param {IncomingRequest} req - Express request
 * @returns {undefinded|object} - an error object if not valid
 * @memberof module:api/csrf
 * @method check
 */
mod.check = function(req)
{
    if (mod.skipMethod.includes(req.method)) return;
    var err = mod.checkOrigin(req);
    if (!err) err = mod.checkFetchSite(req)
    return err;
}

/**
 * Verify Origin header
 * @param {IncomingRequest} req - Express request
 * @returns {undefinded|object} - an error object if not valid
 * @memberof module:api/csrf
 * @method checkOrigin
 */

mod.checkOrigin = function(req)
{
    const origin = req.header('origin');
    for (const p in mod.origin) {
        const rule = mod.origin[p];
        if (lib.testRegexpObj(req.context.path, rule) || lib.testRegexpObj(req.context.location, rule)) {
            if (!rule.values) rule.values = lib.split(p);
            if (!origin || !rule.values.includes(origin)) {
                logger.debug("checkOrigin:", mod.name, req.context, "HDR:", req.headers, "CONF:", p, rule);
                return { status: 403, message: mod.errInvalidCsrf, code: "NOORIGIN" };
            }
        }
    }
}

/**
 * Verify Sec-Fetch-Site headers
 * @param {IncomingRequest} req - Express request
 * @returns {undefinded|object} - an error object if not valid
 * @memberof module:api/csrf
 * @method checkFetchSite
 */
mod.checkFetchSite = function(req)
{
    const secFetchSite = req.header('sec-fetch-site');
    for (const p in mod.secFetch) {
        const rule = mod.secFetch[p];
        if (lib.testRegexpObj(req.context.path, rule) || lib.testRegexpObj(req.context.location, rule)) {
            if (!rule.values) rule.values = lib.split(p);
            if (!secFetchSite || !rule.values.includes(secFetchSite)) {
                logger.debug("checkSecFetchSite:", mod.name, req.context, "HDR:", req.headers, "CONF:", p, rule);
                return { status: 403, message: mod.errInvalidCsrf, code: "NOSECFETCHSITE" };
            }
        }
    }
}

