/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
'use strict';

/**
  * @module api/token
  */

const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');

const mod =

/**
 * API token based authentication, it reuses the users module to keep API token inside the same users table, as a special type of user,
 * the `login` and `secret` columns use properties from the generated session by {@link module:api/token.create}.
 *
 * Parsed token session is stored in the `context.session` as an object:
 *
 * ```js
 * { type: "token", login: string, secret: string }`
 * ```
 *
 * API tokens can be created via shell command:
 *
 * ```sh
 * # bksh -user-add-token name test flags api -prefix api_
 * 'api_7e717a99e4b642ce88010629d32921b7caf92f4d165c46f59f983f880aa25c78'
 * ```
 */


module.exports = {
    name: "api.token",

};


/**
 * Verify API token from Authorization header and sets user in the context on success, this can be used standalone or as middleware.
 *
 * It must be in format: `Authorization: Basic base64(token)` or `Authorization: Bearer token`,
 *
 * An API tokens are created by {@link module:api/token.create} and parsed by {@link module:api/token.parse}.
 *
 * If the context options contains `noHashSecret: true` then session secret will not be hashed when comparing with user secret, for cases when
 * storing raw secret is acceptable. Use {@link module:api.contextOptions}
 *
 * @param {RequestContext} context
 * @param {string} secret
 * @param {object} [options]
 * @param {boolean} [options.noHashSecret] - do not hash the secret
 * @memberof module:api/token
 * @method verify
 */
mod.verify = function(context, secret, options)
{
    const session = mod.parse(context);
    const hash = options?.noHashSecret || context.options?.noHashSecret ? session.secret : lib.hash(session.secret);
    return session && lib.timingSafeEqual(secret, hash);
}

/**
 * Parse API token and return as session object with id and secret if valid or undefined
 * @param {RequestContext} context
 * @returns {undefined|object} parsed token session if present, the3 format of the object is:
 * - `type`: `token`
 * - `login` - user login, public part of the token, UUIDv4, no prefix
 * - `secret` - second part of the token as UUIDv4, hidden property
 * - `prefix` - token prefix if existed
 * @memberof module:api/token
 * @method parse
 */
mod.parse = function(context)
{
    if (!context.session) {
        const auth = context.auth;
        if (!auth?.token) return;

        // Skip optional prefix plus UUIDv4 length is always 32 chars, HTTP max header size is checked early so
        // we know it is not very large
        const _ = auth.token.lastIndexOf("_");

        context.session = Object.create(null, {
            type: { value: "token", enumerable: true },
            login: { value: auth.token.substr(0, _ + 33), enumerable: true },
            prefix: { value: auth.token.substr(0, _ + 1), enumerable: _ > -1 },
            secret: { value: auth.token.substr(_ + 33) },
        });
        logger.debug("parse:", mod.name, context);
    }
    return context.session;
}

/**
 * Create an API token to be saved in the database, stores it in `context.session`. The format is similar
 * to {@link module:api/session}.
 *
 * Generated login and secret are random UUIDv4, so the secret hash without a salt is more about database exposure
 * of secrets and not weak encryption.
 *
 * Still if the context options contains `noHashSecret: true` then
 * session secret will not be hashed when comparing with user secret, for cases when
 * storing raw secret is acceptable. Use {@link module:api.contextOptions}
 *
 * The session object contains the following properties:
 * - `type`: `token`
 * - `login` - generated UUIVv4 user login, no prefix
 * - `secret`: generated UUIDv4 hashed with SHA256(optionally), to be saved in the users table as secret
 * - `token`: concatenated prefix, login and unhashed secret, to be used in API Authorization header
 * - `raw`: unhashed secret
 *
 * @param {RequestContext} context
 * @param {object} [options]
 * @param {string} [options.prefix] - prefix for the token
 * @param {boolean} [options.noHashSecret] - do not hash the secret
 * @return {object} a session object
 * @memberof module:api/token
 * @method prepare
 * @example
 * const session = api.token.create(context, { prefix: "test_" })
 * { type: "token", login: 'a2a3912ba6df4d1ebc87278be49f8aa0', token: 'test_a2a....' }
 * const user = {
 *     login: session.login,
 *     secret: session.secret,
 *     name: "Test user",
 *     ....
 * };
 * await db.aput("bk_user", user);
 */
mod.create = function(context, options)
{
    let prefix = lib.isString(options?.prefix);
    if (prefix && !prefix.endsWith("_")) prefix += "_";

    const login = lib.uuid();
    const secret = lib.uuid();
    const hash = options?.noHashSecret || context.options?.noHashSecret ? secret : lib.hash(secret);

    context.session = Object.create(null, {
        type: { value: "token", enumerable: true },
        login: { value: login, enumerable: true },
        secret: { value: hash },
        token: { value: `${prefix}${login}${secret}` },
        raw: { value: secret },
    });

    logger.debug("create:", mod.name, context);
    return context.session;
}
