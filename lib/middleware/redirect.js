/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');
const api = require(__dirname + '/../api');

/**
  * @module middleware/redirect
  */

const mod = {
    name: "middleware.redirect",
    args: [
        { name: "err-(.+)", descr: "Error messages for various cases" },
        { name: "path-(.+)", obj: "path", type: "regexpobj", reverse: 1, nocamel: 1, descr: "Define a path regexp to be matched early in order to redirect, if the regexp starts with !, that means it must be removed from the list, variables can be used for substitution: @HOST@, @PATH@, @URL@, @BASE@, @DIR@, @QUERY@, status code can be prepended to the location", example: "api-redirect-path-^[^/]+/path/$ = /path2/index.html\napi-redirect-path-.+/$ = 301:@PATH@/index.html" },
        { name: "location-(.+)", obj: "location", type: "regexpobj", reverse: 1, nocamel: 1, descr: "Define a location regexp to be matched early in order to redirect, if the regexp starts with !, that means it must be removed from the list, variables can be used for substitution: @HOST@, @PATH@, @URL@, @BASE@, @DIR@, @QUERY@, status code can be prepended to the location", example: "api-redirect-location-domain.com[^/]+/path/$ = /path2/index.html\napi-redirect-location-.+com/$ = 301:@PATH@/index.html" },
        { name: "login-path-(.+)", obj: "loginPath", type: "regexpobj", reverse: 1, nocamel: 1, descr: "Define a path where to redirect if no login is provided, same format and placeholders as in redirect-path", example: "api-redirect-login-path-^/admin/ = /login.html" },
        { name: "login-location-(.+)", obj: "loginLocation", type: "regexpobj", reverse: 1, nocamel: 1, descr: "Define a location where to redirect if no login is provided, same format and placeholders as in redirect-path", example: "api-redirect-location-domain.com/admin/ = /login.html" },
        { name: "reset", type: "callback", callback: function(v) { if (v) this.reset() }, descr: "Reset all rules" },
    ],

};

/**
 * Configuration based request redirection
 * @example
 * middleware-redirect-login-path-^/app = /login.html?path=@PATH@
 *
 * middleware-redirect-location-^(app\.)?host\.io = https://app.host.com@PATH@
 * middleware-redirect-path-^/support = https://myapp.zendesk.com
 *
 */

module.exports = mod;

mod.reset = function()
{
    delete this.path;
    delete this.location;
    delete this.loginPath;
    delete this.loginLocation;
}

/**
 * Check a request for possible redirection condition based on the configuration.
 * This is used by API servers for early redirections. It returns null
 * if no redirects or errors happend, otherwise an object with status that is expected by the {@link module:api.sendStatus} method.
 * uses {@link module:api.checkPlaceholders} for placeholders.
 * @param {RequestContext} context
 * @param {string[]} args - config properties with rules to use: path, location, loginPath, loginLocation
 * @returns {undefined|object} - { status, url }
 * @memberof module:middleware/redirect
 * @method check
 */
mod.check = function(context, ...args)
{
    for (const name of args) {
        const rules = this[name];
        if (!rules) continue;
        const key = name.at(-1) == "h" ? "path" : "location";

        for (const p in rules) {
            const rule = rules[p];
            if (lib.testRegexpObj(context[key], rule)) {
                let url = p;
                if (!url) continue;
                let status = 302;
                if (url[0] == "3" && url[1] == "0" && url[3] == ":") {
                    status = lib.toNumber(url.substr(0, 3), { dflt: 302 });
                    url = url.substr(4);
                }
                url = api.checkPlaceholders(context, url);
                logger.debug("checkRedirectRules:", name, context.location, "=>", status, url, "rule:", rule);
                return { status, url };
            }
        }
    }
    return null;
}


