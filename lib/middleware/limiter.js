/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

/**
  * @module middleware/limiter
  */

const logger = require(__dirname + '/../logger');
const lib = require(__dirname + '/../lib');
const api = require(__dirname + '/../api');
const Router = require(__dirname + "/../router");

const mod =

/**
 * ## Rate Limiter Middleware
 *
 * ## Global mode
 *
 * Enable via `middleware-limiter-enable = true` to dynamically check every request path, this allows to
 * add more routes to the config without restarting
 *
 * `middleware-limiter-ip`, `middleware-limiter-path`, `middleware-limiter-user` config parameters can be configured,
 * only matched paths are checked, so limiter protection is explicit by the config, no defaults.
 *
 * ```
 * # Rate every IP address for /api, allow 100 req/s from each IP
 * middleware-limiter-ip-*-/api/* = rate:100
 *
 * # Rate every request for /api endpoints, allow 1000 req/s globally
 * middleware-limiter-path-post-/api/* = rate:1000
 *
 * # Rate every user for /api endpoints, allow 1 req/s for each user
 * middleware-limiter-user-post,put-/api/* = rate:1
 * ```
 *
 * ## Fixed config mode
 *
 * To enable just what is in the config on start and ignore subsequent config changes
 *
 * ```
 * middleware-limiter-enable = fixed
 * ```
 *
 */

module.exports = {
    name: "middleware.limiter",
    args: [
        { name: "enable", descr: "Enable the middlware, 'true' means dynamicaly check all requests, 'fixed' means set routes from the config on start" },
        { name: "ip-([a-z,*]+)-(/.+)", type: "map", nocamel: 1, ephemeral: 1, onupdate, descr: "Endpoints/methods to limit by IP address for all users", example: "middleware-limiter-*-ip-/account = rate:10,interval:30000" },
        { name: "path-([a-z,*]+)-(/.+)", type: "map", nocamel: 1, ephemeral: 1, onupdate, descr: "Endpoints/methods to limit by path for all users", example: "middleware-limiter-path-post-/webhook/* = rate:100,interval:30000" },
        { name: "user-([a-z,*]+)-(/.+)", type: "map", nocamel: 1, ephemeral: 1, onupdate, descr: "Endpoints/methods to limit by path and authenticated user", example: "middleware-limiter-user-get,post,put-/admin/* = rate:10,interval:5000" },
        { name: "reset", type: "callback", callback: function(v) { if (v) this.reset() }, descr: "Reset all rules" },
    ],

    router: new Router(),
};

function onupdate(value, options)
{
    if (!value?.rate) return;
    const [name, methods] = options.name.split("-");
    const path = options.matches[1];

    for (const method of lib.split(methods)) {
        const routes = mod.router.find(method, path);
        if (routes.length) {
            // Merge all configs in the same route
            const config = routes[0].route.handler;
            config[name] = lib.extend(config[name], value);
        } else {
            mod.router.add(method, path, { [name]: value });
        }
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
    if (mod.enable === "fixed") {
        mod.router.walk(node => {
            logger.debug("configureMiddleware:", mod.name, node.handlers[0]);
            api.app.use("#0", node.handlers[0].path, {
                ip: node.handlers[0].handler.ip,
                path: node.handlers[0].handler.path,
                user: node.handlers[0].handler.user,
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
 * @memberof module:middleware/limiter
 * @method handle
 * @example
 *
 * const { api, middleware } = require("backendjs");
 * const { limiter } = middleware;
 *
 * api.app.post("*", limiter)
 *
 * api.app.post("/account/*", limiter)
 *
 * api.app.post("/account", { ip: { rate: 100 }, path: { rate: 200 }, user: { rate: 1 }, handle: limiter.handle })
 */
mod.handle = function(context, next)
{
    let config;

    if (this === mod) {
        // Global config

        const routes = mod.router.find(context.method, context.path);
        if (!routes.length) return next();

        config = routes[0].route.handler;

    } else {
        // Local config or fixed mode
        config = this;
    }

    logger.debug("handle:", mod.name, context, "CONFIG:", config);

    const rates = [];
    if (config.ip?.rate) {
        rates.push([context.ip, config.ip]);
    }
    if (config.path?.rate) {
        rates.push([context.path, config.path]);
    }
    if (config.user?.rate && context.userId) {
        rates.push([[context.userId, context.path], config.user]);
    }

    lib.forEach(rates, (arg, next2) => {
        api.limiter(arg[0], arg[1], next2);
    }, next, true);
}

