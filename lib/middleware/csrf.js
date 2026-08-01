/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
'use strict';

/**
  * @module middleware/csrf
  */

const logger = require(__dirname + '/../logger');
const lib = require(__dirname + '/../lib');
const api = require(__dirname + '/../api');

const mod =

/**
 * ## CSRF Protection Middleware
 *
 * ## Global mode
 *
 * Enable via `middleware-csrf-enable = true` to dynamically check every request path, this allows to
 * add more or modify routes to the config without restarting
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
 * To enable just what is in the config on start and ignore new routes,
 * modifying existing routes is still supported
 *
 * ```
 * middleware-csrf-enable = fixed
 * ```
 *
 */

module.exports = {
    name: "middleware.csrf",

    /**
     * @var {ConfigOptions[]}
     * @default
     */
    args: [
        { name: "enable", descr: "Enable the middlware, 'true' means dynamicaly check all requests, 'fixed' means set routes from the config on start" },
        { name: "(origin)-(/.+)", type: "list", no_camel: 1, ephemeral: 1, onupdate, descr: "Paths to by allowed by origin", example: "middleware-csrf-origin-/account = http://host.com\nmiddleware-csrf-origin-/account/* = https://host.com,http://localhost" },
        { name: "(sec-fetch-site)-(/.+)", type: "list", no_camel: 1, ephemeral: 1, onupdate, descr: "Paths to use specific Sec-Fetch-Site header validation by: same-origin, same-site, cross-site, none", example: "middleware-csrf-sec-fetch-/webhook/* = cross-site\nmiddleware-csrf-sec-fetch-/* = same-origin,same-site" },
        { name: "reset", type: "callback", callback(v) { if (v) this.reset() }, descr: "Reset all rules" },
        { name: "priority", type: "int", descr: "Add routes with this priority sorting number, for config mode only" },
        { name: "err-(.+)", descr: "Error messages for various cases" },
    ],

    router: new api.Router(),

    errInvalidCsrf: "Authentication failed",
};

function onupdate(value, options)
{
    const [, name, path] = options.matches;

    const nodes = mod.router.find("", path);
    for (const node of nodes) {
        if (node.route.path === path) {
            node.route.handler[name] = value;
            return;
        }
    }
    mod.router.add("*", path, { [name]: value, handle: mod.handle });
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

        api.app.use(method, "*", mod);
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

    let configs;

    if (this === mod) {
        // Global config

        const routes = mod.router.find(context.method, context.path);
        if (!routes.length) return next();

        configs = routes.map(x => x.route.handler);

    } else {
        // Local config or fixed mode

        configs = [this];
    }

    for (const config of configs) {
        logger.debug("handle:", mod.name, context, origin, secFetchSite, "CONFIG:", config);

        if (config?.origin && !check(origin, config.origin)) return next(error());

        if (config?.["sec-fetch-site"] && !check(secFetchSite, config["sec-fetch-site"])) return next(error());
    }

    next();
}

function check(header, config)
{
    return header === config || lib.includes(config, header);
}

function error()
{
    return { status: 403, message: mod.errInvalidCsrf, code: "CSRF" };
}

