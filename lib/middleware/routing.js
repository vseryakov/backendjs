/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
'use strict';

/**
  * @module middleware/routing
  */

const lib = require(__dirname + '/../lib');
const api = require(__dirname + '/../api');
const logger = require(__dirname + '/../logger');
const Router = require(__dirname + "/../router");

const mod = {
    name: "middleware.routing",
    args: [
        { name: "enable", descr: "Enable the middlware, 'true' means dynamicaly check all requests, 'fixed' means set routes from the config on start" },
        { name: "reset", type: "callback", callback(v) { if (v) this.reset() }, descr: "Reset all rules" },
        { name: "/.+", no_camel: 1, ephemeral: 1, descr: "Paths to be re-routed/redirected", onupdate, example: "middleware-routing-/user/get = /user/details\nmiddleware-routing-/old/path = 302/new/path?@SEARCH@" },
    ],
    router: new Router(),
};

/**
 * Config based rewriting and redirection middleware, for redirection 30X code must prefix the url
 *
 * @example
 * // Enable dynamic routing, every request will be checked against current config
 * middleware-routing-enable = true
 *
 * middleware-routing-/app/* = /index.html
 *
 * middleware-routing-/old/endpoint/ = /new/@PATH2@
 *
 * middleware-routing-/login/* = 302/login.html?path=@PATH@
 *
 * // Enable fixed routing, only the above configured routes are checked
 * middleware-routing-enable = fixed
 *
 * @example <caption>For manual routing here is an example how to do it in the code</caption>
 *
 * api.app.get("/path/", (context, next) => {
 *     context.setUrl("/new/path");
 *     next("restart");
 * });
 */
module.exports = mod;

function onupdate(value, options)
{
    if (/^(\/|(301|302|303|307|308)\/)/.test(value)) {
        mod.router.add("*", options.name, value);
    }
}

/**
 * Start global middleware, makes it the first route via #0 routing method
 *
 * @memberof module:middleware/static
 * @method configureMiddleware
 */
mod.configureMiddleware = function(_options, callback)
{
    if (mod.enable === "fixed") {
        mod.router.walk(node => {
            api.app.use("#0", node.methods[0].path, { location: node.methods[0].handler, handle: mod.handle });
        });
    } else

    if (lib.toBool(mod.enable)) {
        api.app.use("#0", "*", mod.handle);
    }

    callback();
}

mod.reset = function()
{
    mod.router.reset();
}

/**
 * Check if the current request must be re-routed or redirected to another endpoint, uses the global config, formatting using {@link RequestContext#format}
 * @param {RequestContext} context
 * @param {function} next
 * @memberof module:middleware/routing
 * @method handle
 * @example
 * const { api, middleware } = require("backendjs");
 * const { routing } = middleware;
 *
 * api.app.post("*", routing)
 *
 * api.app.post("/acct/*", { location: "/account/@PATH2@", handle: routing.handle })
 *
 */
mod.handle = function(context, next)
{
    let location = this.location;

    if (!location) {
        if (!mod.router.children) return next();

        const routes = mod.router.find(context.method, context.path);
        if (!routes.length) return next();

        location = routes[0].route.handler;
    }

    logger.debug("handle:", mod.name, context, "switch to:", location);

    if (location[0] === "3") {
        context.redirect(location.substr(0, 3), location.substr(3));
    } else {
        context.setUrl(context.format(location));
        next("restart");
    }
}
