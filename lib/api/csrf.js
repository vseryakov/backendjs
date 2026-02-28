/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

/**
  * @module api/csrf
  */

const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');

const mod =

/**
 * ## Origin/Sec-Fetch-Site headers checks
 *
 * `api-csrf-origin` and/or `api-csrf-sec-fetch` config parameters must be configured,
 * only matched paths or locations are checked, so CSRF protection is explicit by the config.
 *
 * @example <caption>Only allow specific origins for /account</caption>
 * api-csrf-origin-^/account = http://app.host.com
 * api-csrf-origin-^/account = https://host.com,http://localhost
 *
 * @example <caption>Only allow same-site or same-origin Sec-Fetch-Site for /api</caption>
 * api-csrf-sec-fetch-^/api/ = same-site
 * api-csrf-sec-fetch-^/api/ = same-origin,same-origin
 *
 * @example <caption>Only allow same-origin Sec-Fetch-Site</caption>
 * api-csrf-sec-fetch-^/ = same-origin
 *
 */

module.exports = {
    name: "api.csrf",
    args: [
        { name: "err-(.+)", descr: "Error messages for various cases" },
        { name: "origin-(.+)", obj: "origin", make: "$1", type: "regexpobj", reverse: 1, nocamel: 1, descr: "Regexp for URLs to by allowed by origin", example: "api-csrf-origin-^/account = http://host.com\napi-csrf-origin-^/account = https://host.com,http://localhost" },
        { name: "sec-fetch-(.+)", obj: "secFetch", make: "$1", type: "regexpobj", reverse: 1, nocamel: 1, descr: "Regexp for URLs to use specific Sec-Fetch-Site header validation by: same-origin, same-site, cross-site, none", example: "api-csrf-sec-fetch-^/webhook = cross-site\napi-csrf-sec-fetch-^/ = same-origin,same-site" },
        { name: "skip-method", type: "list", descr: "Do not check for specified methods" },
    ],
    skipMethod: ["GET", "HEAD", "OPTIONS", "TRACE" ],

    errInvalidCsrf: "Authentication failed",
};

/**
 * Verify Origin and Sec-Fetch-Site headers
 * @param {IncomingRequest} req
 * @returns {undefinded|object} - an error object if not valid
 * @memberof module:aws/csrf
 * @method check
 */
mod.check = function(req, options)
{
    if (mod.skipMethod.includes(req.method)) return;

    const location = req.options.hostname + req.options.path;

    const origin = req.header('origin');
    for (const p in mod.origin) {
        const rule = mod.origin[p];
        if (lib.testRegexpObj(location, rule) || lib.testRegexpObj(req.options.path, rule)) {
            if (!rule.values) rule.values = lib.split(p);
            if (!origin || !rule.values.includes(origin)) {
                logger.debug("checkOrigin:", mod.name, req.options, "HDR:", req.headers, "CONF:", p, rule);
                return { status: 403, message: mod.errInvalidCsrf, code: "NOORIGIN" };
            }
        }
    }

    const secFetchSite = req.header('sec-fetch-site');
    for (const p in mod.secFetch) {
        const rule = mod.secFetch[p];
        if (lib.testRegexpObj(location, rule) || lib.testRegexpObj(req.options.path, rule)) {
            if (!rule.values) rule.values = lib.split(p);
            if (!secFetchSite || !rule.values.includes(secFetchSite)) {
                logger.debug("checkSecFetchSite:", mod.name, req.options, "HDR:", req.headers, "CONF:", p, rule);
                return { status: 403, message: mod.errInvalidCsrf, code: "NOSECFETCHSITE" };
            }
        }
    }
}
