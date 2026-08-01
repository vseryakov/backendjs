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

const mod = {
    name: "middleware.routing",

    /**
     * @var {ConfigOptions[]}
     * @default
     */
    args: [
        { name: "enable", descr: "Enable the middlware, 'true' means dynamicaly check all requests, 'fixed' means set routes from the config on start" },
        { name: "reset", type: "callback", callback(v) { if (v) this.reset() }, descr: "Reset all rules" },
        { name: "/.+", no_camel: 1, ephemeral: 1, descr: "Paths to be re-routed/redirected", onupdate, example: "middleware-routing-/user/get = /user/details\nmiddleware-routing-/old/path = 302/new/path?@SEARCH@" },
        { name: "priority", type: "int", descr: "Add routes with this priority sorting number, for config mode only" },
    ],
    router: new api.Router(),
};

/**
 * Config based rewriting and redirection middleware, for redirection 30X code must prefix the url
 *
* ## Global mode
 *
 * Enable via `middleware-routing-enable = true` to dynamically check every request path, this allows to
 * add more routes to the config without restarting
 *
 * ```
 * middleware-routing-enable = true
 *
 * middleware-routing-/app/* = /index.html
 *
 * middleware-routing-/old/endpoint/ = /new/@PATH2@
 *
 * middleware-routing-/login/* = 302/login.html?path=@PATH@
 * ```
 *
 * ## Fixed config mode
 *
 * To enable just what is in the config on start and ignore new routes,
 * modifying existing routes is still supported
 *
 * ```
 * middleware-csrf-enable = fixed
 * ```
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
    if (!/^(\/|(301|302|303|307|308)\/)/.test(value)) return;

    const nodes = mod.router.find("", options.name);
    for (const node of nodes) {
        if (node.route.path === options.name) {
            node.route.handler.location = value;
            return;
        }
    }
    mod.router.add("*", options.name, { handle: mod.handle, location: value });
}

/**
 * Start global middleware, makes it the first route via #0 routing method
 *
 * @memberof module:middleware/static
 * @method configureMiddleware
 */
mod.configureMiddleware = function(_options, callback)
{
    const method = `#${this.priority ?? ''}`;

    if (mod.enable === "fixed") {
        mod.router.walk(node => {
            for (const i in node.handlers) {
                api.app.use(method, node.handlers[i].path, node.handlers[i].handler);
            }
        });
    } else

    if (lib.toBool(mod.enable)) {
        api.app.use(method, "*", mod.handle);
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
    let configs;

    if (lib.isString(this.location)) {
        configs = [this];
    } else {
        if (!mod.router.children) return next();

        const routes = mod.router.find(context.method, context.path);
        if (!routes.length) return next();

        configs = routes.map(x => x.route.handler);
    }

    for (const config of configs) {
        logger.debug("handle:", mod.name, context, "CONFIG:", config);

        switch (config.location?.[0]) {
        case "3":
            context.redirect(config.location.substr(0, 3), config.location.substr(3));
            return;

        case "/":
            context.setUrl(context.format(config.location));
            return next("restart");
        }
    }

    next();
}
