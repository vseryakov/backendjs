//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2024
//

const core = require(__dirname + '/../core');
const api = require(__dirname + '/../api');
const lib = require(__dirname + '/../lib');
const ipc = require(__dirname + '/../ipc');
const logger = require(__dirname + '/../logger');
const mod = require(__dirname + '/../account');

// Passkey management

mod.configurePasskeyAPI = function(options)
{
    if (this.passkey.disabled) return;

    this.passkey.init();

    api.app.get(/^\/passkey\/challenge$/, (req, res, next) => {
        res.json(mod.passkey.createChallenge(req));
    });

    api.app.post(/^\/passkey\/([a-z]+)$/, (req, res, next) => {
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
                    mod.passkey.verifyChallenge(req, next);
                },
                function(next, challenge) {
                    mod.passkey.verifyRegistration(req, { query, challenge }, next);
                },
                function(next, passkey) {
                    mod.passkey.update(req.account, passkey, next);
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
                    mod.passkey.verifyChallenge(req, next);
                },
                function(next, challenge) {
                    mod.passkey.read(query.userHandle, query.credentialId, (err, user, passkey) => {
                        if (err || !passkey) return next(err || { status: 401, message: mod.errInvalidPasskey, code: "NOLOGIN" });

                        mod.passkey.verifyAuthentication(req, { query, challenge, passkey }, (err) => {
                            next(err, user);
                        });
                    });
                },
                function(next, user) {
                    api.setCurrentAccount(req, user);
                    api.handleSessionSignature(req, next);
                }
            ], (err) => {
                options.cleanup = mod.table;
                options.cleanup_strict = 1;
                api.sendJSON(req, err, req.account);
            }, true);
            break;

        default:
            api.sendReply(res, 400, "invalid command")
        }
    });
}

mod.passkey.init = async function()
{
    if (mod.passkey.server) return;
    try {
        var w = await import(__dirname + "/../../web/js/webauthn.min.mjs");
        mod.passkey.server = w.server;
    } catch (e) {
        logger.error("init:", "passkey", e);
    }
}

mod.passkey.createChallenge = function(req, callback)
{
    var uuid = lib.uuid();

    if (req.res) {
        var cookie = `${Date.now() + mod.passkey.ttl},${uuid}`;
        req.res.cookie("bk_passkey",
            lib.encrypt(mod.passkey.secret || api.accessTokenSecret, cookie), {
            path: mod.passkey.path || "/passkey/",
            httpOnly: true,
            sameSite: "strict",
            maxAge: mod.passkey.ttl,
        });
    }
    logger.debug("createChallenge:", "passkey", req.account?.id, cookie);
    return {
        challenge: uuid,
        domain: mod.passkey.domain && lib.domainName(req.options?.host) || undefined,
        id: req.account?.id,
    }
}

mod.passkey.getChallenge = function(req, callback)
{
    var cookie = req.cookies && req.cookies.bk_passkey;
    var rc = lib.decrypt(mod.passkey.secret || api.accessTokenSecret, cookie).split(",");
    logger.debug("getChallenge:", "passkey", req.account?.id, "H:", rc);
    return lib.toNumber(rc[0]) > Date.now() ? rc[1] : "";
}

mod.passkey.verifyChallenge = function(req, callback)
{
    var challenge = mod.passkey.getChallenge(req);
    if (!challenge) return callback({ status: 429, message: mod.errInvalidPasskey, code: "PSKC" });

    ipc.incr("PSK:" + challenge, 1, { ttl: mod.passkey.ttl, cacheName: mod.passkey.queue || api.limiterQueue }, (err, rc) => {
        logger.debug("verifyChallenge:", "passkey", req.account?.id, challenge, rc);
        callback(rc !== 1 ? { status: 429, message: mod.errInvalidPasskey, code: "PSKC" + rc } : null, challenge);
    });
}

mod.passkey.verifyRegistration = async function(req, options, callback)
{
    const expected = {
        challenge: options.challenge,
        origin: `http${req.options?.secure ? "s" : ""}://${req.headers?.host}`,
    }
    try {
        var passkey = await mod.passkey.server.verifyRegistration(options.query, expected);
    } catch (e) {
        logger.info("verifyRegistration:", "passkey", req.account?.id, options, "ERR:", e.stack);
        return callback({ status: 403, message: mod.errInvalidPasskey, code: "PSKR" })
    }
    // Keep device and date for each passkey
    passkey.credential.mtime = Date.now();
    passkey.credential.aname = passkey.authenticator.name;

    logger.debug("verifyRegistration:", "passkey", req.account?.id, passkey);
    callback(null, passkey);
}

mod.passkey.verifyAuthentication = async function(req, options, callback)
{
    const expected = {
        challenge: options.challenge,
        origin: `http${req.options?.secure ? "s" : ""}://${req.headers?.host}`,
        userVerified: true,
    }
    try {
       await mod.passkey.server.verifyAuthentication(options.query, options.passkey, expected);
    } catch (e) {
        logger.info("verifyAuthentication:", "passkey", req.account?.id, options, "ERR:", e.stack);
        return callback({ status: 403, message: mod.errInvalidPasskey, code: "PSKA" })
    }
    logger.debug("verifyAuthentication:", "passkey", options.passkey);
    callback();
}

// Return a list of all passkyes for the account
mod.passkey.keys = function(user)
{
    return lib.jsonParse(user?.passkey, { datatype: "list" });
}

// Read a user and passkey, user can be id/login or an user object
mod.passkey.read = function(user, passkeyId, callback)
{
    mod.get(user, (err, user) => {
        callback(err, user, mod.passkey.keys(user).filter((x) => (x.id == passkeyId)).pop());
    });
}

// Add/delete a passkey,
// - account - full user record
// - passkey - a registration credentials object to add or just { id: id } to remove
mod.passkey.update = function(account, passkey, callback)
{
    var allkeys = mod.passkey.keys(account);
    var passkeys = allkeys.filter((x) => (x.id != passkey?.id));

    if (passkey?.id && passkey?.publicKey) {
        passkeys.push(passkey);
    }

    if (passkeys.length > mod.passkey.max) {
        return lib.tryCall(callback, { status: 400, message: mod.errInvalidPasskeys });
    }

    if (allkeys.length == passkeys.length) {
        return lib.tryCall(callback);
    }

    var query = {
        login: account?.login,
        passkey: lib.stringify(passkeys),
    }
    core.runMethods("bkUpdatePasskey", { query, account, passkey, passkeys }, () => {
        logger.info("update:", "passkey", query);
        mod.update(query, { isInternal: 1 }, callback);
    });
}

