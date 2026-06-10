/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

/**
  * @module middleware/csrf
  */

const logger = require(__dirname + '/../logger');
const lib = require(__dirname + '/../lib');
const api = require(__dirname + '/../api');
const Router = require(__dirname + "/../router");

const mod =

/**
 * ## CSRF Protection Middleware
 *
 * ## Global mode
 *
 * Enable via `middleware-csrf-enable = true` to dynamically check every request path, this allows to
 * add more routes to the config without restarting
 *
 * `middleware-csrf-origin` and/or `middleware-csrf-sec-fetch-site` config parameters can be configured,
 * only matched paths are checked, so CSRF protection is explicit by the config, no defaults except
 * if matched with any config it checks the presense of both headers Origin: and Sec-Fetch-Site:
 *
 * ```
 * # Only allow specific origins for /account
 * middleware-csrf-origin-/account/* = http://app.host.com
 * middleware-csrf-origin-/account = https://host.com,http://localhost
 *
 * # Only allow same-site or same-origin Sec-Fetch-Site for /api
 * middleware-csrf-sec-fetch-site-/api/* = same-site
 * middleware-csrf-sec-fetch-site-/api/* = same-origin,same-origin
 *
 * # Only allow same-origin Sec-Fetch-Site
 * middleware-csrf-sec-fetch-site-/* = same-origin
 * ```
 *
 * ## Fixed config mode
 *
 * To enable just what is in the config on start and ignore subsequent config changes
 *
 * ```
 * middleware-csrf-enable = fixed
 * ```
 *
 */

module.exports = {
    name: "middleware.csrf",
    args: [
        { name: "enable", descr: "Enable the middlware, 'true' means dynamicaly check all requests, 'fixed' means set routes from the config on start" },
        { name: "origin-(/.+)", type: "list", nocamel: 1, ephemeral: 1, onupdate, descr: "Paths to by allowed by origin", example: "middleware-csrf-origin-/account = http://host.com\nmiddleware-csrf-origin-/account/* = https://host.com,http://localhost" },
        { name: "sec-fetch-site-(/.+)", type: "list", nocamel: 1, ephemeral: 1, onupdate, descr: "Paths to use specific Sec-Fetch-Site header validation by: same-origin, same-site, cross-site, none", example: "middleware-csrf-sec-fetch-/webhook/* = cross-site\nmiddleware-csrf-sec-fetch-/* = same-origin,same-site" },
        { name: "reset", type: "callback", callback: function(v) { if (v) this.reset() }, descr: "Reset all rules" },
        { name: "err-(.+)", descr: "Error messages for various cases" },
    ],

    router: new Router(),

    errInvalidCsrf: "Authentication failed",
};

function onupdate(value, options)
{
    const name = options.name[0] == "o" ? "origin": "secFetchSite";
    const path = options.matches[1];
    const routes = mod.router.find("", path);
    if (routes.length) {
        // Merge all configs in the same route
        const config = routes[0].route.handler;
        config[name] = lib.toFlags("add", config[name], value);
    } else {
        mod.router.add("", path, { [name]: value });
    }
}

mod.reset = function()
{
    mod.router.reset();
}

/**
 * Start global middleware if enabled
 *
 * @memberof module:middleware/csrf
 * @method configureMiddleware
 */
mod.configureMiddleware = function(options, callback)
{
    if (mod.enable === "fixed") {
        mod.router.walk(node => {
            logger.debug("configureMiddleware:", mod.name, node.handlers[0]);
            api.app.use("#0", node.handlers[0].path, {
                origin: node.handlers[0].handler.origin,
                secFetchSite: node.handlers[0].handler.secFetchSite,
                handle: mod.handle
            });
        });
        mod.router.reset();
    } else

    if (lib.toBool(mod.enable)) {
        api.app.use('', "*", mod);
    }

    callback();
}

/**
 * @param {RequestContext} context
 * @param {function} next
 * @memberof module:middleware/csrf
 * @method handle
 * @example
 *
 * const { api, middleware } = require("backendjs");
 * const { csrf } = middleware;
 *
 * api.app.post("*", csrf)
 *
 * api.app.post("/account/*", csrf)
 *
 * api.app.post("/account", { origin: ["host1.com", "host2.com"], secFetchSite: "same-origin", handle: csrf.handle })
 */
mod.handle = function(context, next)
{
    if (context.method === "GET" || context.method === "HEAD") return next();

    // Even empty handler means we must have both headers anyway
    const origin = context.req.headers.origin;
    const secFetchSite = context.req.headers['sec-fetch-site'];

    if (!origin || !secFetchSite) return next(error());

    if (this === mod) {
        // Global config

        const routes = mod.router.find(context.method, context.path);
        if (routes.length) {
            const config = routes[0].route.handler;

            logger.debug("handle:", mod.name, context, "CONFIG:", config);

            if (config.origin && !check(origin, config.origin)) return next(error());

            if (config.secFetchSite && !check(secFetchSite, config.secFetchSite)) return next(error());
        }
    } else {
        // Local config or fixed mode

        logger.debug("handle:", mod.name, context, "OBJ:", this);

        if (this.origin && !check(origin, this.origin)) return next(error());

        if (this.secFetchSite && !check(secFetchSite, this.secFetchSite)) return next(error());
    }

    next();
}

function check(header, config)
{
    return header === config || lib.isFlag(config, header);
}

function error()
{
    return { status: 403, message: mod.errInvalidCsrf, code: "CSRF" };
}

