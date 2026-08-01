/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
'use strict';

/**
  * @module middleware/limiter
  */

const logger = require(__dirname + '/../logger');
const lib = require(__dirname + '/../lib');
const api = require(__dirname + '/../api');

const mod =

/**
 * ## Rate Limiter Middleware
 *
 * The middleware can be configured to rate by IP, path, session or user,
 * only matched paths are checked, so limiter protection is explicit by the config, no defaults.
 *
 * When using Redis for limiter it is advisable to always set ttl: to expire cache and not keep every IP or path indefinitely.
 *
 * All valid parameters for {@link module:api.limiter} can be placed in the config but `rate` is required.
 *
 * ## Path config and rating logic
 *
 * The path part in the config behaves differently depending how wildcards are used:
 * - `*` is used as is, no substitution, this means rate limiting `/api/*` will rate all requests like `/api/1 or /api/2/3`
 * under the same token `/api/*`
 * - named params in the path are replaced with actual values, so for config `/api/:id/*` requests like `/api/1/item` and `/api/2/item`
 * will be rated separately as `/api/1/* and /api/2/*`, but `/api/1/item` and `/api/1/user` will be rated by the same bucket `/api/1/*`
 *
 * Configurations with the same path and method(s) are merged into a single object, i.e. changes are accumulated,
 * to clear values explicit values must be set like 0 or null.
 *
 * ## Users and sessions
 *
 * The difference between user and session is that sesion id is just parsed out from cookies or headers, no verification is done while
 * rate by user requires valid user to be verified and set in the context.
 *
 * By default the limiter middleware is executed before the users middleware so the `user` config is for programmatic use mostly,
 * see {@link module:api/validate} how to rate users with validation.
 *
 * If session id is missing rate limiter still uses undefined instead which puts all no session requests into single bucket.
 *
 * ## Examples:
 * ```
 * # Rate every IP address for all /api endpoints, allow 100 req/s from each IP
 * middleware-limiter-ip-*-/api/* = rate:100
 *
 * # Merge with previous entry, add ttl
 * middleware-limiter-ip-*-/api/* = rate:100,ttl:900000
 *
 * # Rate every post for all /api/account endpoints, allow 1000 req/s globally
 * middleware-limiter-path-post-/api/account/* = rate:1000,ttl:900000
 *
 * # Rate every session id for /api/XXX/ endpoints by XXX, allow 1 req/s for each session
 * middleware-limiter-session-post,put-/api/:type/* = rate:1
 *
 * # Rate every user for /api endpoints, allow 1 req/s for each user, reorder middlewares to handle users before this one
 * middleware-users-priority = 10
 * middleware-limiter-priority = 11
 * middleware-limiter-user-post,put-/api/* = rate:1
 * ```
 *
 * ## Global mode
 *
 * Enable via `middleware-limiter-enable = true` to dynamically check every request path, this allows to
 * add more or modify routes without restarting
 *
 * ## Fixed config mode
 *
 * To enable just what is in the config on start and ignore new routes,
 * modifying existing routes is still supported
 *
 * ```
 * middleware-limiter-enable = fixed
 * ```
 *
 */

module.exports = {
    name: "middleware.limiter",

    /**
     * @var {ConfigOptions[]}
     * @default
     */
    args: [
        { name: "enable", descr: "Enable the middlware, 'true' means dynamicaly check all requests, 'fixed' means set routes from the config on start" },
        { name: "(ip|path|user|session)-([a-z,*]+)-(/.+)", type: "map", no_camel: 1, ephemeral: 1, onupdate, descr: "Rate limit by method and path and IP/path/session/user", example: "middleware-limiter-ip-*-/account = rate:10,interval:30000\nmiddleware-limiter-path-post-/webhook/* = rate:100,interval:30000\nmiddleware-limiter-user-get,post,put-/admin/* = rate:10" },
        { name: "reset", type: "callback", callback(v) { if (v) this.reset() }, descr: "Reset all rules" },
        { name: "priority", type: "int", descr: "Add routes with this priority sorting number, for config mode only" },
    ],

    router: new api.Router(),
};

function onupdate(value, options)
{
    if (lib.toNumber(value?.rate) <= 0) return;

    const [, name, methods, path] = options.matches;

    for (const method of lib.split(methods)) {
        const nodes = mod.router.find(method, path);

        const node = nodes.find(x => (x.route.path === path && x.route.handler.method === methods));
        if (node) {
            Object.assign(node.route.handler[name], value);
            continue
        }

        mod.router.add(method, path, {
            [name]: value,
            method: methods,
            handle: mod.handle
        });
    }
}

mod.reset = function()
{
    mod.router.reset();
}

/**
 * Start global middleware if enabled
 *
 * @memberof module:middleware/limiter
 * @method configureMiddleware
 */
mod.configureMiddleware = function(_options, callback)
{
    const method = `#${this.priority ?? ''}`;

    if (mod.enable === "fixed") {

        mod.router.walk(node => {
            for (const i in node.handlers) {
                api.app.use(node.handlers[i].method + method, node.handlers[i].path, node.handlers[i].handler);
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
 * @memberof module:middleware/limiter
 * @method handle
 * @example
 *
 * const { api, middleware } = require("backendjs");
 * const { limiter, users } = middleware;
 *
 * api.app.post("*", limiter)
 *
 * api.app.post("/account/*", limiter)
 *
 * api.app.post("/account", { ip: { rate: 100 }, path: { rate: 200 }, handle: limiter.handle })
 *
 * api.app.post("/account", users, {  user: { rate: 1 }, handle: limiter.handle })
 *
 * api.app.post("/account", { session: { rate: 10 }, handle: limiter.handle })
 */
mod.handle = function(context, next)
{
    let configs;

    if (this === mod) {
        // Global config

        const routes = mod.router.find(context.method, context.path);
        if (!routes.length) return next();

        configs = routes.map(x => [x.route.handler, x.route]);

    } else {
        // Local config or fixed mode
        configs = [[this, context.route]];
    }

    const rates = [];

    for (const [config, route] of configs) {
        logger.debug("handle:", mod.name, context, "CONFIG:", config, "ROUTE:", route);

        const path = route.paths.map((x, i) => (x === "*" ? x : context.paths[i])).join("/");

        for (const p in config) {
            if (!config[p]?.rate) continue;

            const method = config.method || context.method;

            switch (p) {
            case "ip":
                rates.push([[method, path, context.ip], config[p]]);
                break;

            case "path":
                rates.push([[method, path], config[p]]);
                break;

            case "session":
                api.session.parse(context) || api.token.parse(context);
                // fall-through

            case "user":
                rates.push([[method, path, context[p]?.id], config[p]]);
                break;
            }
        }
    }

    lib.forEach(rates, (arg, next2) => {
        api.limiter(arg[0], arg[1], next2);
    }, next, true);
}

