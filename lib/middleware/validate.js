/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2026
 */
'use strict';

/**
  * @module middleware/validate
  */

const logger = require(__dirname + '/../logger');
const lib = require(__dirname + '/../lib');
const api = require(__dirname + '/../api');
const Router = require(__dirname + "/../router");

const mod =

/**
 * ## Validation and Rate Limiter Middleware
 *
 * As oppose to the limiter by path this middleware validates first the params/query/body parameters and returns an error immediately,
 * then if configured can check rate limits for the matching method, path and parameter.
 *
 * For example this is useful and universally checked in case of multi-tenant environment when each tenant is distinguished by
 * query parameter or body property like accountId, clientId or else.
 *
 * Validating common global parameters upfront with rate limits allows the actual business handlers to avoid
 * boilerplate checks and focus only on specific logic instead.
 *
 * Because the router does not validate params parts in the path, only extracts, this is a way to enforce path parameters to a particular
 * type or format.
 *
 * ## Global mode
 *
 * Enable via `middleware-validate-enable = true` to dynamically check every request path, this allows to
 * add more routes to the config without restarting
 *
 * `middleware-validate-params`, `middleware-validate-query`, `middleware-validate-body` config parameters can be configured,
 * only matched methods and paths are checked, each parameter will be validated using {@link module:lib/validate}.
 *
 * Errors are returned immediately, otherwide the possibly converted values are placed back into params/query/body,
 * this allows subsequent middleware to reuse already validated and converted values immediately.
 *
 * If rate limiting is required set the `rate` and then other parameters must be placed with rate prefix,
 * like `rate_interval, rate_ttl, rate_max`, rate_queue...`,
 * all valid parameters for {@link module:api.limiter} can be placed in the config.
 *
 * To rate limit by session ID or authenticated user in addition to the path set
 * `rate_session` or `rate_user` property to true.
 *
 * NOTE: Named/wildcard parameters in the validate middleware paths must match the actual paths in the custom middleware to
 * reuse the same validated parameters.
 *
 * ```
 * # Validate accountId for all /account requests and allow 100 req/s only
 * middleware-validate-params-get,post-accountId-/account/:accountId/* = type:int,strict:true,min:100000,required:true,rate:100
 *
 * # Validate clientId to be a number in the query for all /api requests and allow 100 req/s only
 * middleware-validate-query-get,post-clientId-/api/* = type:int,max:32,required:true,rate:100,rate_interval:30000
 *
 * # Validate login email and limit to 2 req per minute, increase delay
 * middleware-validate-body-post-login-/login = type:email,max:128,required:true,rate:2,rate_interval:60000,rate_multiplier:1.5
 *
 * # Use JSON format for regexp validation or complex structures
 * middleware-validate-body-post-ssn-/register = { "required": true, "regexp": "^[0-9]{3}-[0-9]{2}-[0-9]{4}$", "errmsg": "Valid SSN is required in NNN-NN-NNNN format" }
 *
 * # Rate limit all /admin/ requests by session to allow only 10 per 30s
 * middleware-validate-params-*-0-/admin/* = rate:10,rate_interval:30000,rate_session=true
 *
 * # Rate limit all /admin/ requests by user to allow only 10 per 30s
 * middleware-validate-params-*-0-/admin/* = rate:10,rate_interval:30000,rate_user=true
 *
 * ```
 *
 * ## Fixed config mode
 *
 * To enable just what is in the config on start and ignore subsequent config changes
 *
 * ```
 * middleware-validate-enable = fixed
 * ```
 *
 */

module.exports = {
    name: "middleware.validate",

    /**
     * @var {ConfigOptions[]}
     * @default
     */
    args: [
        { name: "enable", descr: "Enable the middlware, 'true' means dynamicaly check all requests, 'fixed' means set routes from the config on start" },
        { name: "(query|body|params)-([a-z,*]+)-([a-zA-Z0-9_]+)-(/.+)", type: "map", no_camel: 1, ephemeral: 1, logger: "error", onupdate, descr: "Query parameters to validate/limit by path", example: "middleware-validate-query-*-accountId-/api/* = type:int,required:true,rate:10,rate_interval:30000" },
        { name: "reset", type: "callback", callback(v) { if (v) this.reset() }, descr: "Reset all rules" },
        { name: "priority", type: "int", descr: "Add routes with this priority sorting number, for config mode only" },
    ],

    router: new Router(),
};

function onupdate(value, options)
{
    const [, name, methods, param, path] = options.matches;

    for (const method of lib.split(methods)) {
        const routes = mod.router.find(method, path);
        if (routes.length) {
            // Merge all configs in the same route
            const config = routes[0].route.handler;
            if (!config[name]) config[name] = {};
            if (!config[name][param]) config[name][param] = Object.create(null);
            Object.assign(config[name][param], value);
        } else {
            const config = { [name]: Object.create(null) };
            config[name][param] = value;
            mod.router.add(method, path, config);
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
 * @memberof module:middleware/validate
 * @method configureMiddleware
 */
mod.configureMiddleware = function(_options, callback)
{
    const method = `#${this.priority ?? ''}`;

    if (mod.enable === "fixed") {

        mod.router.walk(node => {
            logger.debug("configureMiddleware:", mod.name, node.handlers[0]);

            api.app.use(node.handlers[0].method + method,
                        node.handlers[0].path,
                        {
                            params: node.handlers[0].handler.params,
                            query: node.handlers[0].handler.query,
                            body: node.handlers[0].handler.body,
                            handle: mod.handle
                        });
        });
        mod.router.reset();
    } else

    if (lib.toBool(mod.enable)) {

        api.app.use(method, "*", mod);
    }

    callback();
}

const _fields = {
    params: { params: true },
    query: { query: true },
    body: {},
};

/**
 * @param {RequestContext} context
 * @param {function} next
 * @memberof module:middleware/validate
 * @method handle
 * @example
 *
 * const { api, middleware } = require("backendjs");
 * const { validate } = middleware;
 *
 * api.app.post("*", validate)
 *
 * api.app.post("/account/*", validate)
 *
 * api.app.post("/account", {
 *     body: {
 *         accountId: { type: "int", required: true, rate: 100 },
 *         amount: { type: "number", max: 1000 }
 *     }
 * }, handle: validate.handle })
 *
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

    let rates;

    for (const name in config) {
        if (!_fields[name]) continue;

        const schema = config[name];
        const body = context[name];

        const { err, data } = api.validate(context, schema, _fields[name]);
        logger.dev("handle:", mod.name, context.path, name, "schema:", schema, "data:", data, "err:", err);

        if (err) {
            return context.reply(err);
        }

        if (body) {
            Object.assign(body, data);
        }

        for (const p in data) {
            if (!schema?.[p]?.rate) continue;
            const key = [config.method, context.path, name, p, data[p]];

            // No user is still different from public rate limiting
            if (schema[p].rate_user) {
                key.push(context.userId);
            }
            if (schema[p].rate_session) {
                api.session.parse(context) || api.token.parse(context);
                key.push(context.session?.id);
            }

            if (!rates) rates = [];
            rates.push([
                key,
                Object.keys(schema[p]).
                       filter(x => x.startsWith("rate_")).
                       reduce((obj, key) => {
                           obj[key.substr(5)] = schema[key];
                           return obj;
                       }, { rate: schema[p].rate })
            ]);
        }
    }

    if (!rates) {
        return next();
    }

    lib.forEach(rates, (arg, next2) => {
        api.limiter(arg[0], arg[1], next2);
    }, next, true);
}
