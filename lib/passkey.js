//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2024
//

const api = require(__dirname + '/api');
const lib = require(__dirname + '/lib');
const ipc = require(__dirname + '/ipc');
const logger = require(__dirname + '/logger');
const auth = require(__dirname + '/auth');

// Passkey management
const mod = {
    name: "passkey",
    args: [
        { name: "err-(.+)", descr: "Error messages for various cases" },
        { name: "cap-(.+)", type: "int", strip: "cap-", descr: "Capability parameters" },
        { name: "domain", type: "bool", descr: "Use domain for passkeys" },
        { name: "pool", descr: "DB pool for search, i.e. Elasticserch pool" },
    ],
    ttl: 60000,
    pool: "elasticsearch",
    errInvalidPasskey: "Invalid credentials",
    errInvalidChallenge: "Invalid challenge",
};
module.exports = mod;

mod.configure = async function(options, callback)
{
    if (this.disabled) return callback();

    this.tables = {
        [auth.table]: {
            passkey: { type: "text", internal: 1, priv: 1, max: 7000 },  // List of registsred passkeys
            pskrtime: { type: "bigint", internal: 1 },                   // Passkey register time
            pskvtime: { type: "bigint", internal: 1 },                   // Passkey verify time
        }
    };

    try {
        var w = await import(__dirname + "/../web/js/webauthn.min.mjs");
        this.server = w.server;
        this.parsers = w.parsers;
    } catch (e) {
        logger.error("configure:", mod.name, e);
    }

    callback();
}

// Create API endpoints and routes
mod.configureWeb = function(options, callback)
{
    if (this.noweb || !this.server) return callback();

    api.app.get(/^\/passkey\/(register|login)$/, (req, res, next) => {
        mod.createChallenge(req, (err, rc) => {
            res.json(rc);
        });
    });

    api.app.post("/passkey/register", (req, res, next) => {
        mod.register(req, (err) => {
            api.sendJSON(req, err);
        });
    });

    api.app.post("/passkey/login", (req, res, next) => {
        var options = api.getOptions(req);
        options.cleanup = auth.table;
        options.cleanup_strict = 1;

        mod.verify(req, (err, user) => {
            if (err) return api.sendReply(res, err);

            api.setCurrentAccount(req, user);
            api.handleSessionSignature(req, () => {
                api.sendJSON(req, null, req.account);
            });
        });
    });

    callback();
}

mod.createChallenge = function(req, callback)
{
    var uuid = lib.uuid();
    var key = req.account?.id || uuid;
    ipc.put("PSK:" + key, uuid, { ttl: mod.ttl }, (err) => {
        if (!req.account?.id) {
            req.res.cookie("bk_" + mod.name, uuid, {
                path: "/passkey/",
                httpOnly: true,
                sameSite: "strict",
                maxAge: mod.ttl,
            });
        }
        callback(err, {
            challenge: uuid,
            domain: mod.domain && lib.domainName(req.options?.host) || undefined,
            id: req.account?.id,
        });
    });
}

mod.getChallenge = function(req, callback)
{
    var key = req.account?.id || req.cookies && req.cookies["bk_" + mod.name];
    ipc.get("PSK:" + key, { del: 1 }, (err, rc) => {
        req.query.challenge = rc;
        if (!rc) err = { status: 404, message: mod.errInvalidChallenge };
        callback(err, rc);
    });
}

mod.register = function(req, callback)
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

            mod.getChallenge(req, next);
        },
        async function(next) {
            const expected = {
                challenge: req.query.challenge,
                origin: `http${req.options.secure ? "s" : ""}://${req.headers.host}`,
                verbose: mod.verbose,
            }
            try {
                var data = await mod.server.verifyRegistration(req.query, expected);
            } catch (e) {
                logger.debug("register:", mod.name, req.account.id, req.query, e.stack);
                return next({ status: 400, message: e.message })
            }

            req.account.passkey = lib.jsonParse(req.account.passkey, { datatype: "list" }).filter((x) => (x.id != data.credential.id));
            req.account.passkey.push(data.credential);
            var q = {
                login: req.account.login,
                passkey: lib.stringify(req.account.passkey),
                pskrtime: Date.now()
            }
            auth.update(q, { isInternal: 1 }, next);
        },
    ], callback);
}

mod.verify = function(req, callback)
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

            mod.getChallenge(req, next);
        },
        function(next) {
            auth.get(req.query.userHandle, next);
        },
        async function(next, user) {
            var passkey = lib.jsonParse(user?.passkey, { datatype: "list" }).filter((x) => (x.id == req.query.credentialId)).pop();
            if (!passkey) {
                logger.info("verify:", mod.name, req.query, "USER:", user);
                return next({ status: 403, message: mod.errInvalidPasskey });
            }

            const expected = {
                challenge: req.query.challenge,
                origin: `http${req.options.secure ? "s" : ""}://${req.headers.host}`,
                userVerified: true,
                verbose: mod.verbose,
            }
            try {
                 await mod.server.verifyAuthentication(req.query, passkey, expected);
            } catch (e) {
                logger.info("verify:", mod.name, req.query, "USER:", user?.id, "PSK:", passkey, "ERR:", e.stack);
                return next({ status: 400, message: e.message })
            }

            next(null, user);
        },
    ], callback);
}

