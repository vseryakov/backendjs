/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
const util = require("util");
const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');

/**
  * @module api/redirect
  */

const mod = {
    name: "api.redirect",
    args: [
        { name: "err-(.+)", descr: "Error messages for various cases" },
        { name: "url", type: "regexpmap", descr: "Add to the list a JSON object with property name defining a location regexp to be matched early against in order to redirect using the value of the property, if the regexp starts with !, that means it must be removed from the list, variables can be used for substitution: @HOST@, @PATH@, @URL@, @BASE@, @DIR@, @QUERY@, status code can be prepended to the location", example: "{ '^[^/]+/path/$': '/path2/index.html', '.+/$': '301:@PATH@/index.html' }" },
        { name: "login-(.+)", type: "regexpobj", reverse: 1, nocamel: 1, obj: "login", descr: "Define a location where to redirect if no login is provided, same format and placeholders as in redirect-url", example: "api-redirect-login-^/admin/=/login.html" },
        { name: "reset", type: "callback", callback: function(v) { if (v) this.reset() }, descr: "Reset all rules" },
    ],

};

/**
 * configuration based request redirection
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
 * if no redirects or errors happend, otherwise an object with status that is expected by the `api.sendStatus` method.
 * The options is expected to contain the following cached request properties:
 * - path - from req.path or the request pathname only
 * - host - from req.hostname or the hostname part only
 * - port - port from the host: header if specified
 * - secure - if the protocol is https
 */
mod.check = function(req, name = "url")
{
    var url = req.url, location = req.options.host + url;
    var rules = this[name];
    for (var i in rules) {
        const rx = util.types.isRegExp(rules[i]?.rx) ? rules[i].rx : util.types.isRegExp(rules[i]) ? rules[i] : null;
        if (rx && (rx.test(url) || rx.test(location))) {
            let loc = !lib.isNumeric(i) ? i : rules[i].value || "";
            if (!loc) continue;
            var status = 302;
            if (loc[0]== "3" && loc[1] == "0" && loc[3] == ":") {
                status = lib.toNumber(loc.substr(0, 3), { dflt: 302 });
                loc = loc.substr(4);
            }
            loc = this.checkRedirectPlaceholders(req, loc);
            logger.debug("checkRedirectRules:", name, location, req.options.path, "=>", status, loc, "rule:", i, rules[i]);
            return { status: status, url: loc };
        }
    }
    return null;
}
