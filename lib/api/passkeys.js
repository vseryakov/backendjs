/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2024
 */

const api = require(__dirname + '/../api');
const lib = require(__dirname + '/../lib');
const cache = require(__dirname + '/../cache');
const logger = require(__dirname + '/../logger');

/**
 * Passkey management
 *
 * To allow login via passkey enable
 *
 *    -api-passkeys-cap-enabled 1
 */
const mod = {
    name: "api.passkeys",
    args: [
        { name: "err-(.+)", descr: "Error messages for various cases" },
        { name: "cap-(.+)", type: "int", strip: "cap-", descr: "Capability parameters" },
        { name: "path", descr: "Cookies path" },
        { name: "secret", descr: "Cookies secret" },
        { name: "cache", descr: "Cache for challenges" },
        { name: "domain", descr: "Explicit domain to use instead of host" },
    ],
    ttl: 30000,
    max: 5,
    path: "/passkey/",

    errPasskeyMax: "No more passkeys can be added to your profile",
    errPasskeyChallenge: "Your passkey request has expired, please try again",
    errPasskeyRegistration: "Passkey provided cannot be registered, please try again",
    errPasskeyVerification: "Passkey provided cannot be verified, please try again",
};
module.exports = mod;

mod.configureWeb = function(options, callback)
{
    if (!this.enabled) return callback();

    api.registerAccessCheck('', /^\/passkey\/login$/, (req, cb) => {
        cb({ status: 200 });
    });

    this.init();

    api.app.get(/^\/passkey\/(login|register)$/, (req, res, next) => {
        if (!this.enabled) return api.sendReply(res, 400, "disabled");
        api.sendJSON(req, null, mod.createChallenge(req));
    });

    api.app.post(/^\/passkey\/([a-z]+)$/, (req, res, next) => {
        if (!this.enabled) return api.sendReply(res, 400, "disabled");

        var options = api.getOptions(req), query;

        switch (req.params[0]) {
        case "register":
            query = api.getQuery(req, {
                username: { required: 1 },
                credential: { type: "object", required: 1, max: 1024 },
                authenticatorData: { required: 1, max: 1024 },
                clientData: { required: 1, max: 1024 },
            });
            if (typeof query == "string") return api.sendReply(res, 400, query);

            lib.series([
                function(next) {
                    mod.verifyChallenge(req, next);
                },
                function(next, challenge) {
                    mod.verifyRegistration(req, { query, challenge }, next);
                },
                function(next, passkey) {
                    mod.update({ user: req.user, passkey: passkey.credential }, next);
                }
            ], (err) => {
                api.sendJSON(req, err);
            }, true);
            break;

        case "login":
            query = api.getQuery(req, {
                credentialId: { required: 1 },
                authenticatorData: { required: 1, max: 1024 },
                clientData: { required: 1, max: 1024 },
                signature: { required: 1, max: 1024 },
                userHandle: { required: 1, base64: 1 },
            });
            if (typeof query == "string") return api.sendReply(res, 400, query);

            lib.series([
                function(next) {
                    mod.verifyChallenge(req, next);
                },
                function(next, challenge) {
                    mod.read(query.userHandle, query.credentialId, (err, user, passkey) => {
                        if (err || !passkey) return next(err || { status: 401, message: mod.errInvalidPasskey, code: "NOLOGIN" });

                        mod.verifyAuthentication(req, { query, challenge, passkey }, (err) => {
                            next(err, user);
                        });
                    });
                },
                function(next, user) {
                    api.access.setUser(req, user);
                    api.session.setup(req, next);
                }
            ], (err) => {
                options.cleanup = mod.table;
                options.cleanup_strict = 1;
                api.sendJSON(req, err, req.user);
            }, true);
            break;
        }
    });

    callback();
}

mod.init = async function()
{
    if (mod.server) return;
    try {
        var w = await import(__dirname + "/../../web/js/webauthn.min.mjs");
        mod.server = w.server;
    } catch (e) {
        logger.error("init:", "passkey", e);
    }
}

mod.createChallenge = function(req)
{
    var uuid = lib.uuid();
    var ttl = Date.now() + mod.ttl;

    if (req.res) {
        var cookie = `${ttl},${uuid},${req.user?.id?1:0}`;
        req.res.cookie("bk_passkey",
            lib.encrypt(mod.secret || api.accessTokenSecret, cookie), {
            path: mod.path,
            httpOnly: true,
            sameSite: "strict",
            maxAge: mod.ttl,
        });
    }
    logger.debug("createChallenge:", "passkey", req.user?.id, cookie);
    return {
        challenge: uuid,
        domain: mod.domain && lib.domainName(req.options?.host) || undefined,
        id: req.user?.id,
        ttl: ttl,
    }
}

mod.getChallenge = function(req, callback)
{
    var cookie = req.cookies?.bk_passkey;
    var rc = lib.decrypt(mod.secret || api.accessTokenSecret, cookie).split(",");
    logger.debug("getChallenge:", "passkey", req.user?.id, "H:", rc);
    return lib.toNumber(rc[0]) > Date.now() ? rc[1] : "";
}

mod.verifyChallenge = function(req, callback)
{
    var challenge = mod.getChallenge(req);
    if (!challenge) return callback({ status: 429, message: mod.errPasskeyChallenge, code: "PSKC" });

    cache.incr("PSK:" + challenge, 1, { ttl: mod.ttl, cacheName: mod.cache || api.limiterCache }, (err, rc) => {
        logger.debug("verifyChallenge:", "passkey", req.user?.id, challenge, rc);
        callback(rc !== 1 ? { status: 429, message: mod.errPasskeyChallenge, code: "PSKC" + rc } : null, challenge);
    });
}

mod.verifyRegistration = async function(req, options, callback)
{
    const expected = {
        challenge: options.challenge,
        origin: `http${req.options?.secure ? "s" : ""}://${req.headers?.host}`,
    }
    try {
        var passkey = await mod.server.verifyRegistration(options.query, expected);
    } catch (e) {
        logger.info("verifyRegistration:", "passkey", req.user?.id, options, "ERR:", e.stack);
        return callback({ status: 403, message: mod.errPasskeyRegistration, code: "PSKR" })
    }
    // Keep device and date for each passkey
    passkey.credential.mtime = Date.now();
    passkey.credential.aname = passkey.authenticator.name;

    logger.debug("verifyRegistration:", "passkey", req.user?.id, passkey);
    callback(null, passkey);
}

mod.verifyAuthentication = async function(req, options, callback)
{
    const expected = {
        challenge: options.challenge,
        origin: `http${req.options?.secure ? "s" : ""}://${req.headers?.host}`,
        domain: mod.domain && lib.domainName(req.options?.host) || undefined,
        userVerified: true,
    }
    try {
       await mod.server.verifyAuthentication(options.query, options.passkey, expected);
    } catch (e) {
        logger.info("verifyAuthentication:", "passkey", req.user?.id, options, "ERR:", e.stack);
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
        callback(err, row, mod.get(row).filter((x) => (x.id == passkeyId)).pop());
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
    var passkeys = allkeys.filter((x) => (x.id != options.passkey?.id));

    if (options.passkey?.id && options.passkey?.publicKey && options.passkey?.algorithm) {
        passkeys.push(options.passkey);
    }

    if (passkeys.length > mod.passkey.max) {
        return lib.tryCall(callback, { status: 400, message: mod.errPasskeyMax });
    }

    if (allkeys.length == passkeys.length) {
        return lib.tryCall(callback);
    }

    var query = Object.assign({ login: options.user?.login, passkey: lib.stringify(passkeys) }, options.query);

    logger.info("update:", "passkey", query);

    api.users.update(query, { isInternal: 1 }, callback);
}

