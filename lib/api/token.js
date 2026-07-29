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
 * API tokens can belong to real users by savong tokens with id of an existing user, multiple tokens can belong to the same user, the
 * `id` column is not unique.
 *
 * Parsed token session is stored in the `context.session` as an object:
 *
 * ```js
 * { type: "token", id: string, secret: string }`
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
 * @param {RequestContext} context
 * @param {string} secret
 * @memberof module:api/token
 * @method verify
 */
mod.verify = function(context, secret)
{
    const session = mod.parse(context);
    return session && lib.timingSafeEqual(secret, lib.hash(session.secret));
}

/**
 * Parse API token and return as session object with id and secret if valid or undefined
 * @param {RequestContext} context
 * @returns {undefined|object} parsed token session if present, the3 format of the object is:
 * - `type`: `token`
 * - `id` - user login, public part of the token, prefix + UUIDv4
 * - `secret`: second part of the token as UUIDv4, hidden property
 * @memberof module:api/token
 * @method parse
 */
mod.parse = function(context)
{
    if (!context.session) {
        const auth = context.auth;
        if (!auth?.token) return;

        // Skip optional prefix plus UUIDv4 length is always 32 chars, HTTP max header size is checked early so
        // we know it is very large
        const pos = auth.token.lastIndexOf("_") + 33;

        context.session = Object.create(null, {
            type: { value: "token", enumerable: true },
            id: { value: auth.token.substr(0, pos), enumerable: true },
            secret: { value: auth.token.substr(pos) },
        });
        logger.debug("parse:", mod.name, context);
    }
    return context.session;
}

/**
 * Create an API token to be saved in the database, stores it in `context.session`. The format is compatible
 * with {@link module:api/session}.
 *
 * Generated login and secret are random UUIDv4, so secret hash without a salt is more about database exposure
 * of the secret and not weak encryption.
 *
 * The session object contains the following properties:
 * - `type`: `token`
 * - `id` - generated UUIVv4 session id, public part, this is user login
 * - `secret`: generated UUIDv4 hashed with SHA256, to be saved in the users table as secret
 * - `token`: concatenated id and unhashed secret, to be used in API Authorization header
 *
 * @param {RequestContext} context
 * @param {object} [options]
 * @param {string} [options.prefix] - prefix for the login part
 * @return {object} a session object
 * @memberof module:api/token
 * @method prepare
 * @example
 * const session = api.token.create(context, { prefix:"test_" })
 * { type: "token", id: 'test_a2a3912ba6df4d1ebc87278be49f8aa0' }
 * const user = {
 *     login: session.id,
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

    const id = lib.uuid(prefix);
    const secret = lib.uuid();

    context.session = Object.create(null, {
        type: { value: "token", enumerable: true },
        id: { value: id, enumerable: true },
        secret: { value: lib.hash(secret) },
        token: { value: `${id}${secret}` },
    });

    logger.debug("create:", mod.name, context);
    return context.session;
}
