/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');
const api = require(__dirname + '/../api');

/**
  * @module api/redirect
  */

const mod = {
    name: "api.redirect",
    args: [
        { name: "err-(.+)", descr: "Error messages for various cases" },
        { name: "url-(.+)", obj: "url", type: "regexpobj", reverse: 1, nocamel: 1, descr: "Define a location regexp to be matched early in order to redirect, if the regexp starts with !, that means it must be removed from the list, variables can be used for substitution: @HOST@, @PATH@, @URL@, @BASE@, @DIR@, @QUERY@, status code can be prepended to the location", example: "api-redirect-url-^[^/]+/path/$ = /path2/index.html\napi-redirect-url-.+/$ = 301:@PATH@/index.html" },
        { name: "login-(.+)", obj: "login", type: "regexpobj", reverse: 1, nocamel: 1, descr: "Define a location where to redirect if no login is provided, same format and placeholders as in redirect-url", example: "api-redirect-login-^/admin/ = /login.html" },
        { name: "reset", type: "callback", callback: function(v) { if (v) this.reset() }, descr: "Reset all rules" },
    ],

};

/**
 * Configuration based request redirection
 * @example
 * api-redirect-login-^/app = /login.html?path=@PATH@
 *
 * api-redirect-url-^(app\.)?host\.io = https://app.host.com@PATH@
 * api-redirect-url-^/support = https://myapp.zendesk.com
 *
 */

module.exports = mod;

mod.reset = function()
{
    delete this.url;
    delete this.login;
}

/**
 * Check a request for possible redirection condition based on the configuration.
 * This is used by API servers for early redirections. It returns null
 * if no redirects or errors happend, otherwise an object with status that is expected by the {@link module:api.sendStatus} method.
 * uses {@link module:api.checkRedirectPlaceholders} for placeholders.
 * @param {Request} req
 * The req.options is expected to contain the following cached request properties:
 * - path - from req.path or the request pathname only
 * - host - from req.hostname or the hostname part only
 * - port - port from the host: header if specified
 * - secure - if the protocol is https
 * @param {string} [name=url]
 * @memberof module:api/redirect
 * @method check
 */
mod.check = function(req, name = "url")
{
    const rules = this[name];
    for (const p in rules) {
        const rule = rules[p];
        if (lib.testRegexpObj(req.options.path, rule) || lib.testRegexpObj(req.options.location, rule)) {
            let loc = p;
            if (!loc) continue;
            var status = 302;
            if (loc[0] == "3" && loc[1] == "0" && loc[3] == ":") {
                status = lib.toNumber(loc.substr(0, 3), { dflt: 302 });
                loc = loc.substr(4);
            }
            loc = api.checkRequestPlaceholders(req, loc);
            logger.debug("checkRedirectRules:", name, req.options.location, "=>", status, loc, "rule:", rule);
            return { status: status, url: loc };
        }
    }
    return null;
}


