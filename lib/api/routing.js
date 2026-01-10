/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

/**
  * @module api/routing
  */

const lib = require(__dirname + '/../lib');
const api = require(__dirname + '/../api');
const logger = require(__dirname + '/../logger');

const mod = {
    name: "api.routing",
    args: [
        { name: "err-(.+)", descr: "Error messages for various cases" },
        { name: "path-(.+)", type: "regexpobj", reverse: 1, nocamel: 1, obj: 'path', descr: "Locations to be re-routed to other path, this is done inside the server at the beginning, only the path is replaced, same format and placeholders as in redirect-url, use ! in front of regexp to remove particular redirect from the list", example: "-api-routing-path-^/user/get /user/read" },
        { name: "auth-(.+)", type: "regexpobj", reverse: 1, nocamel: 1, obj: 'auth', descr: "URL path to be re-routed to other path after the authentication is successful, this is done inside the server, only the path is replaced, same format and placeholders as in redirect-url", example: "-api-routing-auth-^/user/get /user/read" },
        { name: "reset", type: "callback", callback: function(v) { if (v) this.reset() }, descr: "Reset all rules" },
    ],
};

/**
 * Config based routing rewriting, can match the whole location or just the path
 * @example
 * api-routing-auth-^/app=/rup/app
 *
 * api-routing-path-^/old/endpoint/=/new/@PATH1@
 *
 * api-routing-path-docs\.host\.com/[a-z.]+/=/doc/view/@FILE@
 *
 * api-routing-path-^/([a-z]+).html$=/viewer/@BASE@
 */
module.exports = mod;

mod.reset = function()
{
    delete this.path;
    delete this.auth;
}

/**
 * Check if the current request must be re-routed to another endpoint, uses {@link module:api.checkRedirectPlaceholders}
 * @param {Request} req
 * @param {string} name - config property with rules to use: path, auth
 * @returns {boolean} true if the url has been replaced
 * @memberof module:api/routing
 * @method check
 */
mod.check = function(req, name)
{
    var rules = this[name];
    if (!rules) return;

    const location = req.options.host + req.options.path;
    for (const p in rules) {
        if (lib.testRegexpObj(req.options.path, rules[p]) || lib.testRegexpObj(location, rules[p])) {
            req.signatureUrl = req.url;
            api.replacePath(req, api.checkRedirectPlaceholders(req, p));
            logger.debug("check:", this.name, name, location, "switch to:", p, req.url);
            return true;
        }
    }
}
