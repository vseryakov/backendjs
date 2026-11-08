/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2025
 *
 *  Derived from Hono https://github.com/honojs
 */
'use strict';

/**
  * @module middleware/jwt
 */

const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');
const api = require(__dirname + '/../api');

const mod =

/**
 * ## JWT Authentication Middleware
 *
 * Verifies the JWT token from the `Authorization: Bearer <token>` header and sets the user in the context on success,
 * see {@link module:lib/JWT} for signing and verification details, a secret for symmetric algorithms
 * (HS256/HS384/HS512) or a public key / JWK for asymmetric algorithms (RS256/...) can be used.
 *
 * ## Global mode
 *
 * ## Endpoint list mode
 *
 * Enable via config, only listed endpoints will be checked, `'*'` means all
 *
 * ```
 * middleware-jwt-enable = /api/*
 * middleware-jwt-secret = backendjs-secret
 * ```
 *
 * ## JWKS
 *
 * For asymmetric algorithms the verification keys can be loaded from a local file or an HTTPS JWKS URL.
 * HTTP redirects are not followed.
 * When `kid` is set only the key with the matching `kid` is used.
 *
 * ```
 * middleware-jwt-enable = /api/*
 *
 * middleware-jwt-jwks = https://auth.host.com/.well-known/jwks.json
 * middleware-jwt-alg = HS256, HS384
 * middleware-jwt-kid = key-2025
 * ```
 *
 * ```
 * middleware-jwt-enable = /api/*
 * middleware-jwt-jwks = /etc/jwks/keys.json
 * middleware-jwt-kid = key-2025
 * ```
 *
 * ## Programmatic usage
 *
 * ```js
 * const { api, middleware } = require("backendjs");
 * const { jwt } = middleware;
 *
 * api.app.use("/api/*", jwt);
 * api.app.post("/api/login", jwt);
 * api.app.post("/api/secret", { secret: "backendjs-secret", handle: jwt.handle });
 * ```
 *
 */

module.exports = {
    name: "middleware.jwt",

    /**
     * @var {ConfigOptions[]}
     * @default
     */
    args: [
        { name: "enable", type: "list", descr: "Enable user session middlware globally for the given list of endpoints" },
        { name: "secret", descr: "Secret or public key used to verify JWT signature, default HS256" },
        { name: "public-key", descr: "Public key or PEM to verify JWT with asymmetric algorithms" },
        { name: "jwks", descr: "JWKS URL or local file path to public keys JSON, i.e. https://host/.well-known/jwks.json or /etc/jwks/keys.json" },
        { name: "kid", type: "list", descr: "Key(s) ID (kid) to select from the JWKS, optional, all keys will be checked if not set" },
        { name: "alg", type: "list", descr: "Supported algorithms, if no header.alg then verify the first one" },
        { name: "cache-age", type: "int", min: 0, descr: "Cache keys for this amount of time in ms" },
        { name: "reset", type: "callback", callback(v) { if (v) this.reset() }, descr: "Reset all rules" },
        { name: "priority", type: "int", descr: "Add routes with this priority sorting number, for config mode only" },
        { name: "err-(.+)", descr: "Error messages for various cases" },
    ],

    cacheAge: 3600000,

    errInvalidToken: "Authentication failed",

    router: new api.Router(),
};

mod.reset = function()
{
    mod.router.reset();
}

/**
 * Start JWT middleware, registers it for all matched endpoints from the config
 *
 * @memberof module:middleware/jwt
 * @method configureMiddleware
 */
mod.configureMiddleware = function(_options, callback)
{
    const method = `#${this.priority ?? ""}`;

    if (Array.isArray(mod.enable)) {
        for (const path of mod.enable) {
            api.app.use(method, path, mod);
        }
    }

    callback();
}

/**
 * Verifies the JWT token from the Authorization header and sets the user in the context on success,
 * replies with 401 if token is missing or invalid.
 *
 * @param {RequestContext} context
 * @param {function} next - next middleware or endpoint handler
 * @memberof module:middleware/jwt
 * @method handle
 * @example
 *
 * const { api, middleware } = require("backendjs");
 * const { jwt } = middleware;
 *
 * api.app.use("/api/*", jwt);
 * api.app.post("/api/secret", { secret: "backendjs-secret", handle: jwt.handle }, (context) => {
 *     context.json({ user: context.user });
 * });
 */
mod.handle = async function(context, next)
{
    logger.debug("handle:", mod.name, context);

    const token = context.auth?.type === "Bearer" ? context.auth.token : undefined;
    if (!token) return error(context, "no token")

    const keys = mod.jwks ? await lib.JWT.getKeys(mod.jwks, { kid: mod.kid, age: mod.cacheAge }) :
                                    { keys: mod.publicKey ?? mod.secret };
    if (keys?.err) return error(context, keys.err)

    const { err, payload } = await lib.JWT.verify(token, keys?.keys, { alg: mod.alg, jwks: !!mod.jwks });
    if (err) return error(context, err)

    context.user = { ...payload, id: payload?.id ?? payload?.sub };

    next();
}

function error(context, err)
{
    logger.error("handle:", mod.name, context, err);
    context.reply({ status: 401, message: mod.errInvalidToken });
}
