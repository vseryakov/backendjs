//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const lib = require(__dirname + '/../lib');
const api = require(__dirname + '/../api');
const accounts = require(__dirname + '/../accounts');
const logger = require(__dirname + '/../logger');

// Perform authorization of the incoming request for access and permissions
api.handleAccess = function(req, res, callback)
{
    const trace = req.trace.start("handleAccess");

    lib.everySeries([
        function(next) {
            api.checkAccess(req, (status) => {
                if (!status) {
                    return next();
                }

                // Status is given, return an error or proceed to the next middleware
                if (status.status != 200) {
                    api.clearSessionSignature(req);
                    return api.sendReply(res, status);
                }

                var err = api.checkCsrfToken(req);
                if (err) return api.sendReply(res, err);

                trace.stop();
                callback();
            });
        },

        function(next) {
            api.checkAuthentication(req, (err) => {
                if (!err || err.status == 200) return next();

                if (err?.status == 417) {
                    if (api.checkAcl(req.options.path, api.allowAclAnonymous)) {
                        return next();
                    }
                }

                if (err?.status >= 401 && err.status < 500) {
                    var loc = this.checkRedirectRules(req, "loginRedirect");
                    if (loc) return api.sendReply(res, loc);
                }

                api.sendReply(res, err);
            });
        },

        function(next) {
            var err = api.checkCsrfToken(req);
            if (err) return api.sendReply(res, err);

            api.checkAuthorization(req, (err) => {
                if (err && err.status != 200) {
                    return api.sendReply(res, err);
                }

                api.checkRouting(req, "authRouting");

                trace.stop();
                callback();
            });
        },
    ], null, true);
}

// Perform authorization checks after the account been checked for valid signature.
//
// At least once acl must match to proceed.
//
// - req is Express request object
// - callback is a function(status) to be called with the final status
//
api.checkAuthorization = function(req, callback)
{
    logger.debug("checkAuthorization:", req.account.id, req.account.name, req.account.type, req.options.path);

    var rc = this.checkAclDeny(req);
    if (rc) {
        logger.debug("checkAuthorization:", "deny:", 403, req.account.id, req.account.name, req.account.type, req.options.path, rc);
        return this.checkPreHooks(req, rc, callback);
    }

    // Must satisfy at least one account type
    rc = api.checkAclAllow(req);
    if (rc.allow) {
        logger.debug("checkAuthorization:", "allow:", 200, req.account.id, req.account.name, req.account.type, req.options.path, rc);
        return this.checkPreHooks(req, callback);
    }

    // Authenticated as the last resort
    if (req.account.id && this.checkAcl(req.options.path, this.allowAclAuthenticated)) {
        logger.debug("checkAuthorization:", "authenticated:", 200, req.account.id, req.account.name, req.account.type, req.options.path, this.allowAclAuthenticated);
        return this.checkPreHooks(req, callback);
    }

    logger.debug("checkAuthorization:", "nomatch:", 403, req.account.id, req.account.name, req.account.type, req.options.path);
    this.checkPreHooks(req, { status: 403, message: api.errAclNoMatch }, callback);
}

// Verify request signature from the request object, uses properties: .host, .method, .url or .originalUrl, .headers
api.checkAuthentication = function(req, callback)
{
    var now = Date.now();
    // Make sure we will not crash on wrong object
    if (!req || !req.headers) req = { headers: {} };

    // Extract all signature components from the request
    var sig = this.getSignature(req);

    lib.everySeries([
        function(next) {
            // Sanity checks, required headers must be present and not empty
            if (!sig.method || !sig.host) {
                return next({ status: 415, message: api.errInvalidRequest, code: "NOLOGIN" });
            }

            // Bad or empty signature result in empty login
            if (!sig.login) {
                return next({ status: 417, message: api.errInvalidLogin, code: "NOLOGIN" });
            }

            // Make sure the request is not expired, it must be in milliseconds
            if (sig.expires && sig.expires < now - this.signatureAge) {
                var msg = req.__("Expired request, check your clock, the server time is %s, your clock is %s",
                          lib.strftime(now, "%m/%d/%Y %H:%M:%S GMT", { utc: 1 }),
                          lib.strftime(sig.expires, "%m/%d/%Y %H:%M:%S GMT", { utc: 1 }));
                return next({ status: 406, message: msg, code: "EXPIRED" });
            }

            // Check the signature version consistency, do not accept wrong signatures in the unexpected places
            if ((sig.version == 2 && sig.source != "s") ||
                (sig.version == 3 && sig.source != "t") ||
                (sig.version == 4 && sig.source) ||
                (!sig.version && sig.source) ||
                (sig.version < 0 && sig.source != "l")) {
                return next({ status: 416, message: api.errInvalidRequest, code: "NOLOGIN" });
            }

            api.checkSessionSignature(sig, (err, rc) => {
                if (rc < 0) return next({ status: 401, message: api.errInvalidSession, code: "INVALID" });

                // Pre-authenticated request (WS)
                if (req.account.login == sig.login && req.account.id) {
                    api.setCurrentAccount(req, req.account);
                    return next({ status: 200 });
                }
                next();
            });
        },

        function(next, err) {
            if (err) return next(err);

            // Verify if the access key is valid, they all are cached so a bad cache may result in rejects
            accounts.getUser({ login: sig.login }, (err, account, info) => {
                if (err) return next({ status: 500, message: String(err) });
                if (!account) return next({ status: 401, message: api.errInvalidAccount, code: "NOLOGIN" });

                // Keep the found account for error post processing
                req.__account = account;

                // Account expiration time
                if (account.expires && account.expires < Date.now()) {
                    return next({ status: 412, message: api.errInvalidAccount, code: "EXPIRED" });
                }
                next();
            });
        },

        function(next, err) {
            if (err) return next(err);

            // Now we can proceed with signature verification, all other conditions are met
            api.verifySignature(req, sig, req.__account, (sig) => {
                if (!sig) {
                    api.clearSessionSignature(req);
                    return next({ status: 401, message: api.errInvalidSecret, code: "NOLOGIN" });
                }
                // Save account and signature in the request, it will be used later
                req.signature = sig;
                api.saveSessionSignature(sig);
                api.setCurrentAccount(req, req.__account);
                next();
            });
        },

        function(next, err) {
            api.checkAuthHooks(req, err, (e) => {
                logger.debug('checkAuthentication:', e || err, req.signature, 'HDRS:', req.headers);
                next(e || err);
            });
        },
    ], callback, true);
}

// Clear the session and all cookies
api.handleLogout = function(req)
{
    api.getSignature(req);
    api.clearSessionSignature(req);
    api.clearCsrfToken(req);
}
