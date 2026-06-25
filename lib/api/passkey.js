/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2024
 */
'use strict';

const api = require(__dirname + '/../api');
const lib = require(__dirname + '/../lib');
const cache = require(__dirname + '/../cache');
const logger = require(__dirname + '/../logger');

/**
  * @module middleware/passkey
  */

const mod = {
    name: "api.passkey",
    args: [
        { name: "enable", type: "bool", descr: "Enable the middlware globally" },
        { name: "err-(.+)", descr: "Error messages for various cases" },
        { name: "cap-(.+)", type: "int", strip: "cap-", sametype: 1, descr: "Capability parameters" },
        { name: "secret", descr: "Cookies secret" },
        { name: "cache", descr: "Cache for challenges" },
        { name: "cookie", descr: "Cookie name" },
        { name: "domain", descr: "Explicit domain to use instead of host" },
    ],
    ttl: 30000,
    max: 5,
    cache: "local",

    /**
     * Cookie name
     * @var {string}
     * @default
     */
    cookie: "bk_passkey",

    errPasskeyMax: "No more passkeys can be added to your profile",
    errPasskeyChallenge: "Your passkey request has expired, please try again",
    errPasskeyRegistration: "Passkey provided cannot be registered, please try again",
    errPasskeyVerification: "Passkey provided cannot be verified, please try again",
};

/**
 * Passkey management
 *
 * To allow login via passkey below is an example how to use the methods for registration and login
 *
 * ```js
 *
 *  api.app.get("/passkey/challenge", (context) => { context.json(api.passkey.createChallenge(context)) }).
 *          post("/passkey/login", api.passkey.login).
 *          post("/account/passkey/register", api.passkey.register));
 *
 * ```
 */

module.exports = mod;

mod.register = function(context)
{
    const { err, data } = api.validate(context, {
        username: { required: 1 },
        credential: { type: "object", required: 1, max: 1024 },
        authenticatorData: { required: 1, max: 1024 },
        clientData: { required: 1, max: 1024 },
    });
    if (err) return context.reply(err);

    lib.series([
        function(next) {
            mod.verifyChallenge(context, next);
        },

        function(next, challenge) {
            mod.verifyRegistration(context, { query: data, challenge }, next);
        },

        function(next, passkey) {
            mod.update({ user: context.user, passkey: passkey.credential }, next);
        }
    ], (err) => {
        context.reply(err);
    }, true);
}

mod.login = function(context)
{
    const { err, data } = api.validate(context, {
        credentialId: { required: 1 },
        authenticatorData: { required: 1, max: 1024 },
        clientData: { required: 1, max: 1024 },
        signature: { required: 1, max: 1024 },
        userHandle: { required: 1, base64: 1 },
    });
    if (err) return context.reply(err);

    lib.series([
        function(next) {
            mod.verifyChallenge(context, next);
        },

        function(next, challenge) {
            mod.read(data.userHandle, data.credentialId, (err, user, passkey) => {
                if (err || !passkey) return next(err || { status: 401, message: mod.errInvalidPasskey, code: "NOLOGIN" });

                mod.verifyAuthentication(context, { query: data, challenge, passkey }, (err) => {
                    if (err) return next(err, user);

                    api.users.createSession(context, user, next);
                });
            });
        },
    ], (err) => {
        context.reply(err, api.users.cleanup(context.user));
    }, true);
}

mod.init = async function()
{
    if (mod.server) return;
    try {
        const w = await import(__dirname + "/../../web/js/webauthn.min.mjs");
        mod.server = w.server;
    } catch (e) {
        logger.error("init:", "passkey", e);
    }
}

mod.createChallenge = function(context)
{
    const uuid = lib.uuid();
    const ttl = Date.now() + mod.ttl;
    const uid = context.user?.id;

    var cookie = `${ttl},${uuid},${uid?1:0}`;

    context.setCookie(mod.cookie,
        lib.jsonToBase64(cookie, mod.secret), {
            path: mod.endpoint,
            httpOnly: true,
            sameSite: "strict",
            maxAge: mod.ttl,
        });

    logger.debug("createChallenge:", "passkey", uid, cookie);
    return {
        challenge: uuid,
        domain: mod.domain && context?.domain || undefined,
        id: uid,
        ttl: ttl,
    }
}

mod.getChallenge = function(context, _callback)
{
    const cookie = context.cookie(mod.cookie);
    const rc = lib.base64ToJson(cookie, mod.secret).split(",");
    logger.debug("getChallenge:", "passkey", context.user?.id, "H:", rc);
    return lib.toNumber(rc[0]) > Date.now() ? rc[1] : "";
}

mod.verifyChallenge = function(context, callback)
{
    var challenge = mod.getChallenge(context);
    if (!challenge) {
        return callback({ status: 429, message: mod.errPasskeyChallenge, code: "PSKC" });
    }

    cache.incr("PSK:" + challenge, 1, { ttl: mod.ttl, cacheName: mod.cache }, (_err, rc) => {
        logger.debug("verifyChallenge:", "passkey", context.user?.id, challenge, rc);
        callback(rc !== 1 ? { status: 429, message: mod.errPasskeyChallenge, code: "PSKC" + rc } : null, challenge);
    });
}

mod.verifyRegistration = async function(context, options, callback)
{
    var passkey;
    const expected = {
        challenge: options.challenge,
        origin: `${context.proto}://${context.host}`,
    }
    try {
        passkey = await mod.server.verifyRegistration(options.query, expected);
    } catch (e) {
        logger.info("verifyRegistration:", "passkey", context.user?.id, options, "ERR:", e.stack);
        return callback({ status: 403, message: mod.errPasskeyRegistration, code: "PSKR" })
    }
    // Keep device and date for each passkey
    passkey.credential.mtime = Date.now();
    passkey.credential.aname = passkey.authenticator.name;

    logger.debug("verifyRegistration:", "passkey", context.user?.id, passkey);
    callback(null, passkey);
}

mod.verifyAuthentication = async function(context, options, callback)
{
    const expected = {
        challenge: options.challenge,
        origin: `${context.proto}://${context.host}`,
        domain: mod.domain && context.domain || undefined,
        userVerified: true,
    }
    try {
       await mod.server.verifyAuthentication(options.query, options.passkey, expected);
    } catch (e) {
        logger.info("verifyAuthentication:", "passkey", context.user?.id, options, "ERR:", e.stack);
        return callback({ status: 403, message: mod.errPasskeyVerification, code: "PSKA" })
    }
    logger.debug("verifyAuthentication:", "passkey", options.passkey);
    callback();
}

// Return a list of all passkyes for the user
mod.get = function(options)
{
    return lib.jsonParse(options?.passkey, { datatype: "list" });
}

// Read a user and passkey, user can be id/login or an user object
mod.read = function(options, passkeyId, callback)
{
    api.users.get(options, (err, row) => {
        callback(err, row, mod.get(row).filter((x) => (x.id === passkeyId)).pop());
    });
}

/**
 * Add/delete a passkey,
 * - user - full user record
 * - passkey - a registration credential object to add or just { id: id } to remove
 * - query - optional additional fields to update
 */
mod.update = function(options, callback)
{
    var allkeys = mod.get(options.user);
    var passkeys = allkeys.filter((x) => (x.id !== options.passkey?.id));

    if (options.passkey?.id && options.passkey?.publicKey && options.passkey?.algorithm) {
        passkeys.push(options.passkey);
    }

    if (passkeys.length > mod.passkey.max) {
        return lib.tryCall(callback, { status: 400, message: mod.errPasskeyMax });
    }

    if (allkeys.length === passkeys.length) {
        return lib.tryCall(callback);
    }

    var query = Object.create(null, {
        login: { value: options.user?.login },
        passkey: { value: lib.stringify(passkeys) }
    });
    if (options.query) Object.assign(query, options.query);

    logger.info("update:", "passkey", query);

    api.users.update(query, { isInternal: 1 }, callback);
}

