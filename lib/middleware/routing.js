/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

/**
  * @module middleware/routing
  */

const lib = require(__dirname + '/../lib');
const api = require(__dirname + '/../api');
const logger = require(__dirname + '/../logger');

const mod = {
    name: "middleware.routing",
    args: [
        { name: "err-(.+)", descr: "Error messages for various cases" },
        { name: "([a-z0-9]+)-(.+)", type: "regexpobj", reverse: 1, nocamel: 1, obj: 'rules.$1', make: "$2", descr: "Paths or locations to be re-routed to other path, this is done inside the server, only the path is replaced, use ! in front of regexp to remove particular redirect from the list", example: "middleware-routing-path-^/user/get = /user/read" },
        { name: "reset", type: "callback", callback: function(v) { if (v) this.reset() }, descr: "Reset all rules" },
    ],
};

/**
 * Config based routing rewriting, can match the whole location or just the path
 *
 * @example
 * middleware-routing-path-^/app = /index.html
 *
 * middleware-routing-path-^/old/endpoint/ = /new/@PATH1@
 *
 * middleware-routing-location-docs\.host\.com/[a-z.]+/ = /viewer/@FILE@
 *
 * middleware-routing-path-/([a-z]+).html$ = /viewer/@BASE@
 */
module.exports = mod;

mod.reset = function()
{
    delete this.path;
    delete this.location;
}

/**
 * Check if the current request must be re-routed to another endpoint, uses {@link module:api.checkPlaceholders}
 * @param {RequestContext} context
 * @param {string[]} args - config properties with rules to use: path, location, authPath, authLocation
 * @returns {boolean} true if the url has been replaced
 * @memberof module:middleware/routing
 * @method check
 */
mod.check = function(context, path, key)
{
    if (!this.rules) return;

    const rules = this.rules[key];
    if (!rules) return;

    for (const p in rules) {
        if (lib.testRegexpObj(path, rules[p])) {
            context.setUrl(api.checkPlaceholders(context, p));
            logger.debug("check:", this.name, context, "switch to:", p, context.url);
            return true;
        }
    }
}
