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

const mod =

/**
 * ## Validation and Rate Limiter Middleware
 *
 * As oppose to the limiter by path this middleware validates first the params/query/body parameters and returns an error immediately,
 * then if configured can check rate limits for the matching method, path and parameter behaving similar to the {@link module:api/limiter}.
 *
 * For example this is useful and universally checked in case of multi-tenant environment when each tenant is distinguished by
 * path/query/body property like accountId, clientId or else.
 *
 * Validating common global parameters upfront with rate limits allows the actual business handlers to avoid
 * boilerplate checks and focus only on specific logic instead and allows scaling and restrictions to be applied in real
 * time without code changes.
 *
 * Because the router does not validate params parts in the path, only extracts, this is a way to enforce path parameters to a particular
 * type or format.
 *
 * ## Validation config
 *
 * `middleware-validate-params`, `middleware-validate-query`, `middleware-validate-body` config parameters are configured,
 * only matched methods and paths are checked, each parameter will be validated using {@link module:lib/validate}.
 *
 * Errors are returned immediately.
 *
 * Validated and converted values are placed back into params/query/body,
 * this allows subsequent middleware to reuse already validated and converted values immediately.
 *
 * Path params are kept as strings.
 *
 * ## Rate limiting
 *
 * If rate limiting is required set the `rate` and other parameters must be placed with rate prefix,
 * like `rate_interval, rate_ttl, rate_max`, rate_queue...`,
 * all valid parameters for {@link module:api/limiter} can be placed in the config.
 *
 * The path rating logic is the same as in the limiter middleware.
 *
 * Configurations with the same path and method(s) are merged into a single object, i.e. changes are accumulated,
 * to clear values explicit values must be set like 0 or null.
 *
 * To rate limit by session ID or authenticated user is supported if validation succeded:
 *  - `rate_session` rates the session id from the header
 *  - `rate_user` rates verified user id
 *
 * By default this middleware is executed after the users middleware, i.e. user/session verification must succeed but still
 * in case of missing session or user id the rating will use undefined, i.e. it will rate all
 * requests without sessions globally.
 *
 * NOTE: Named/wildcard parameters in the validate middleware paths must match the actual paths in the custom middleware to
 * reuse the same validated parameters.
 *
 * ## Examples
 *
 * ```
 * # Validate accountId for all /account requests and allow 100 req/s only
 * middleware-validate-params-get,post-accountId-/account/:accountId/* = type:int,strict:true,min:100000,required:true,rate:100
 *
 * # Validate clientId to be a number in the query for all /api requests and allow 100 req/s only
 * middleware-validate-query-get,post-clientId-/api/* = type:int,max:32,required:true,rate:100,rate_interval:30000
 *
 *
 * # Validate login email and limit to 2 req per minute, increase delay
 * middleware-validate-body-post-login-/login = type:email,max:128,required:true
 *
 * # Nerge with previous entry, add rate limiting to validation
 * middleware-validate-body-post-login-/login = rate:2,rate_interval:60000,rate_multiplier:1.5
 *
 *
 * # Use JSON format for regexp validation or complex structures
 * middleware-validate-body-post-ssn-/register = { "required": true, "regexp": "^[0-9]{3}-[0-9]{2}-[0-9]{4}$", "errmsg": "Valid SSN is required in NNN-NN-NNNN format" }
 *
 *
 * # Rate limit all /admin/ requests by session id to allow only 10 per 30s
 * middleware-validate-params-*-0-/admin/* = rate:10,rate_interval:30000,rate_session=true
 *
 * # Rate limit all /admin/ requests by user to allow only 10 per 30s
 * middleware-validate-params-*-0-/admin/* = rate:10,rate_interval:30000,rate_user=true
 *
 * ```
 * ## Global mode
 *
 * Enable via `middleware-validate-enable = true` to dynamically check every request path, this allows to
 * add more or modify routes without restarting
 *
 *
 * ## Fixed config mode
 *
 * To enable just what is in the config on start and ignore new routes,
 * modifying existing routes is still supported
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
        { name: "(query|body|params)-([a-z,*]+)-([a-zA-Z0-9_]+)-(/.+)", type: "map", no_camel: 1, ephemeral: 1, logger: "error", onupdate, descr: "Validate and optionally rate limit by a parameter from query/body/params by method and path", example: "middleware-validate-query-*-accountId-/api/* = type:int,required:true,rate:10,rate_interval:30000" },
        { name: "reset", type: "callback", callback(v) { if (v) this.reset() }, descr: "Reset all rules" },
        { name: "priority", type: "int", descr: "Add routes with this priority sorting number, for config mode only" },
    ],

    router: new api.Router(),
};

function onupdate(value, options)
{
    const [, name, methods, param, path] = options.matches;

    for (const method of lib.split(methods)) {
        const nodes = mod.router.find(method, path);

        const node = nodes.find(x => (x.route.path === path && x.route.handler.method === methods));
        if (node) {
            if (!node.route.handler[name]) {
                node.route.handler[name] = Object.create(null);
            }
            if (!node.route.handler[name][param]) {
                node.route.handler[name][param] = Object.create(null);
            }
            Object.assign(node.route.handler[name][param], value);
            continue
        }

        const config = {
            [name]: Object.create(null, {
                [param]: { value, enumerable: true }
            }),
            method: methods,
            handle: mod.handle
        };
        mod.router.add(method, path, config);
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
    let configs;

    if (this === mod) {
        // Global config

        const routes = mod.router.find(context.method, context.path);
        if (!routes.length) return next();

        configs = routes.map(x => [x.route.handler, x.route, x.params]);

    } else {
        // Local config or fixed mode
        configs = [[this, context.route]];
    }

    let rates;

    for (const [config, route, params] of configs) {
        logger.debug("handle:", mod.name, context, "CONFIG:", config, "ROUTE:", route);

        for (const name in config) {
            switch (name) {
            case "params":
                context.params = params;

            case "query":
            case "body":
                break;

            default:
                continue;
            }

            const schema = config[name];
            const body = context[name];

            const { err, data } = api.validate(context, schema, { [name]: true });
            logger.dev("handle:", mod.name, context.path, name, "schema:", schema, "body:", body, "data:", data, "err:", err);

            if (err) {
                return context.reply(err);
            }

            if (body) {
                Object.assign(body, data);
            }

            const method = config.method || context.method;

            for (const p in data) {
                if (lib.toNumber(schema?.[p]?.rate) <= 0) continue;

                const path = route.paths.map((x, i) => (x === "*" ? x : context.paths[i])).join("/");
                const key = [method, path, name, p, data[p]];

                if (schema[p].rate_user) {
                    key.push(context.user?.id);
                }
                if (schema[p].rate_session) {
                    api.session.parse(context) || api.token.parse(context);
                    key.push(context.session?.id);
                }

                const rate = Object.keys(schema[p]).
                                filter(x => x.startsWith("rate_")).
                                reduce((obj, key) => {
                                   obj[key.substr(5)] = schema[p][key];
                                   return obj;
                                }, { rate: schema[p].rate })

                if (!rates) rates = [];
                rates.push([ key, rate ]);
            }
        }
    }

    if (!rates) {
        return next();
    }

    lib.forEach(rates, (arg, next2) => {
        api.limiter(arg[0], arg[1], next2);
    }, next, true);
}
