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
    if (this.nopasskey) return;

    this.passkey.init();

    api.app.get(/^\/passkey\/(register|login)$/, (req, res, next) => {
        mod.passkey.createChallenge(req, (err, rc) => {
            res.json(rc);
        });
    });

    api.app.post("/passkey/register", (req, res, next) => {
        mod.passkey.register(req, (err) => {
            api.sendJSON(req, err);
        });
    });

    api.app.post("/passkey/login", (req, res, next) => {

        mod.passkey.verify(req, (err) => {
            if (err) return api.sendReply(res, err);

            api.handleSessionSignature(req, () => {
                req.options.cleanup = mod.table;
                req.options.cleanup_strict = 1;
                api.sendJSON(req, null, req.account);
            });
        });
    });
}

mod.passkey.init = async function()
{
    if (this.passkey.server) return;
    try {
        var w = await import(__dirname + "/../../web/js/webauthn.min.mjs");
        this.passkey.server = w.server;
    } catch (e) {
        logger.error("init:", mod.name, e);
    }
}

mod.passkey.createChallenge = function(req, callback)
{
    var uuid = lib.uuid();
    var key = req.account?.id || uuid;
    ipc.put("PSK:" + key, uuid, { ttl: mod.passkey.ttl }, (err) => {
        if (!req.account?.id) {
            req.res.cookie("bk_passkey", uuid, {
                path: mod.passkey.path || "/passkey/",
                httpOnly: true,
                sameSite: "strict",
                maxAge: mod.passkey.ttl,
            });
        }
        callback(err, {
            challenge: uuid,
            domain: mod.passkey.domain && lib.domainName(req.options?.host) || undefined,
            id: req.account?.id,
        });
    });
}

mod.passkey.getChallenge = function(req, callback)
{
    var key = req.account?.id || req.cookies && req.cookies.bk_passkey;
    ipc.get("PSK:" + key, { del: 1 }, (err, rc) => {
        req.query.challenge = rc;
        if (!rc) err = { status: 404, message: mod.errInvalidChallenge };
        callback(err, rc);
    });
}

mod.passkey.register = function(req, callback)
{
    lib.series([
        function(next) {
            req.query = api.getQuery(req, {
                username: { required: 1 },
                credential: { type: "object", required: 1, max: 1024 },
                authenticatorData: { required: 1, max: 1024 },
                clientData: { required: 1, max: 1024 },
            });
            if (typeof req.query == "string") return next({ status: 400, message: req.query });

            mod.passkey.getChallenge(req, next);
        },
        async function(next) {
            const expected = {
                challenge: req.query.challenge,
                origin: `http${req.options.secure ? "s" : ""}://${req.headers.host}`,
                verbose: mod.verbose,
            }
            try {
                var passkey = await mod.passkey.server.verifyRegistration(req.query, expected);
            } catch (e) {
                logger.debug("register:", mod.name, req.account.id, req.query, e.stack);
                return next({ status: 400, message: e.message })
            }

            // Keep device and date for each passkey
            passkey.credential.mtime = Date.now();
            passkey.credential.aname = passkey.authenticator.name;

            req.account.passkey = lib.jsonParse(req.account.passkey, { datatype: "list" }).filter((x) => (x.id != passkey.credential.id));
            req.account.passkey.push(passkey.credential);

            var user = {
                login: req.account.login,
                passkey: lib.stringify(req.account.passkey),
            }
            core.runMethods("bkRegisterPasskey", { req, user, passkey }, () => {
                mod.update(req.user, { isInternal: 1 }, next);
            });
        },
    ], callback);
}

mod.passkey.verify = function(req, callback)
{
    lib.series([
        function(next) {
            req.query = api.getQuery(req, {
                credentialId: { required: 1 },
                authenticatorData: { required: 1, max: 1024 },
                clientData: { required: 1, max: 1024 },
                signature: { required: 1, max: 1024 },
                userHandle: { required: 1, base64: 1 },
            });
            if (typeof req.query == "string") return next({ status: 400, message: req.query });

            mod.passkey.getChallenge(req, next);
        },
        function(next) {
            mod.get(req.query.userHandle, next);
        },
        async function(next, user) {
            var passkey = lib.jsonParse(user?.passkey, { datatype: "list" }).filter((x) => (x.id == req.query.credentialId)).pop();
            if (!passkey) {
                logger.info("verify:", mod.name, req.query, "USER:", user);
                return next({ status: 417, message: mod.errInvalidPasskey, code: "NOLOGIN" });
            }

            const expected = {
                challenge: req.query.challenge,
                origin: `http${req.options.secure ? "s" : ""}://${req.headers.host}`,
                userVerified: true,
                verbose: mod.verbose,
            }
            try {
                 await mod.passkey.server.verifyAuthentication(req.query, passkey, expected);
            } catch (e) {
                logger.info("verify:", mod.name, req.query, "USER:", user?.id, "PSK:", passkey, "ERR:", e.stack);
                return next({ status: 401, message: e.message, code: "NOLOGIN" })
            }

            api.setCurrentAccount(req, user);
            core.runMethods("bkVerifyPasskey", { req, passkey }, next);
        },
    ], callback);
}

