//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const api = require(__dirname + '/../api');
const core = require(__dirname + '/../core');
const lib = require(__dirname + '/../lib');
const users = require(__dirname + '/../users');

// User management
//
// use -api.users-cap-noweb 1 to disable default endpoints

const mod = {
    name: "api.users",
    args: [
        { name: "err-(.+)", descr: "Error messages for various cases" },
        { name: "cap-(.+)", type: "int", strip: "cap-", descr: "Capability parameters" },
    ],
    noweb: 0,
    sigversion: -1,

    errInvalidLogin: "No username or password provided",
};
module.exports = mod;

mod.configureWeb = function(options, callback)
{
    if (this.noweb) return callback();

    // Authentication check with signature/session
    api.app.post(/^\/auth$/, (req, res) => {
        if (!req.user?.id) {
            return api.sendReply(res, { status: 417, message: mod.errInvalidLogin, code: "NOLOGIN" });
        }
        api.handleSessionSignature(req, () => {
            req.options.cleanup = users.table;
            req.options.cleanup_strict = 1;
            api.sendJSON(req, null, req.user);
        });
    });

    // Login with just the secret without signature
    api.app.post(/^\/login$/, (req, res) => {
        if (!req.query.login || !req.query.secret) {
            return api.sendReply(res, { status: 417, message: mod.errInvalidLogin, code: "NOLOGIN" });
        }
        // Create internal signature from the login data
        req.signature = api.newSignature(req, "version", mod.sigversion, "source", "l", "login", req.query.login, "secret", req.query.secret);
        delete req.query.login;
        delete req.query.secret;

        api.checkAuthentication(req, (err) => {
            if (!req.user?.id) {
                return api.sendJSON(req, err || { status: 417, message: mod.errInvalidLogin, code: "NOLOGIN" });
            }
            api.handleSessionSignature(req, () => {
                req.options.cleanup = users.table;
                req.options.cleanup_strict = 1;
                api.sendJSON(req, null, req.user);
            });
        });
    });

    // Clear sessions and access tokens
    api.app.post(/^\/logout$/, (req, res) => {
        api.handleLogout(req);
        api.sendJSON(req);
    });

    callback();
}

mod.command = function(op, query, options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    var req = { stopOnError: 1, query, options };

    lib.series([
        function(next) {
            core.runMethods(`bkPrepare${op}User`, req, next);
        },
        function(next) {
            users[op.toLowerCase()](query, options, (err, row) => {
                if (!err) req.user = row;
                next(err);
            });
        },
        function(next) {
            delete req.stopOnError;
            core.runMethods(`bk${op}User`, req, next);
        },
    ], callback, true);
}

mod.add = function(query, options, callback)
{
    return mod.command("Add", query, options, callback);
}

mod.update = function(query, options, callback)
{
    return mod.command("Update", query, options, callback);
}

mod.del = function(query, options, callback)
{
    return mod.command("Del", query, options, callback);
}
