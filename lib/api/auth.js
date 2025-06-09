//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const lib = require(__dirname + '/../lib');
const api = require(__dirname + '/../api');
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
                    api.session.clear(req);
                    return api.sendReply(res, status);
                }

                var err = api.csrf.check(req);
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
                    var loc = api.checkRedirectRules(req, "loginRedirect");
                    if (loc) return api.sendReply(res, loc);
                }

                api.sendReply(res, err);
            });
        },

        function(next) {
            var err = api.csrf.check(req);
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

// Perform authorization checks after the user been checked for valid signature.
//
// At least once acl must match to proceed.
//
// - req is Express request object
// - callback is a function(status) to be called with the final status
//
api.checkAuthorization = function(req, callback)
{
    logger.debug("checkAuthorization:", req.options);

    var rc = this.checkAclDeny(req);
    if (rc) {
        logger.debug("checkAuthorization:", "deny:", 403, req.options, rc);
        return this.checkPreHooks(req, rc, callback);
    }

    // Must satisfy at least one role
    rc = api.checkAclAllow(req);
    if (rc.allow) {
        logger.debug("checkAuthorization:", "allow:", 200, req.options, rc);
        return this.checkPreHooks(req, callback);
    }

    // Authenticated as the last resort
    if (req.user.id && this.checkAcl(req.options.path, this.allowAclAuthenticated)) {
        logger.debug("checkAuthorization:", "authenticated:", 200, req.options, this.allowAclAuthenticated);
        return this.checkPreHooks(req, callback);
    }

    logger.debug("checkAuthorization:", "nomatch:", 403, req.options);
    this.checkPreHooks(req, { status: 403, message: api.errAclNoMatch }, callback);
}

// Verify request signature from the request object, uses properties: .host, .method, .url or .originalUrl, .headers
api.checkAuthentication = function(req, callback)
{
    var now = Date.now();
    // Make sure we will not crash on wrong object
    if (!req || !req.headers) req = { headers: {} };

    // Extract all signature components from the request
    var sig = api.signature.get(req);

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

            api.session.check(sig, (err, rc) => {
                if (rc < 0) return next({ status: 401, message: api.errInvalidSession, code: "INVALID" });

                // Pre-authenticated request (WS)
                if (req.user?.login == sig.login && req.user.id) {
                    api.setCurrentUser(req, req.user);
                    return next({ status: 200 });
                }
                next();
            });
        },

        function(next, err) {
            if (err) return next(err);

            // Verify if the access key is valid, they all are cached so a bad cache may result in rejects
            api.users.get({ login: sig.login }, (err, user, info) => {
                if (err) return next({ status: 500, message: String(err) });
                if (!user) return next({ status: 401, message: api.errInvalidUser, code: "NOLOGIN" });

                // Keep the found record for error post processing
                req.__user = user;

                if (user.expires > 0 && user.expires < Date.now()) {
                    return next({ status: 412, message: api.errInvalidUser, code: "EXPIRED" });
                }
                next();
            });
        },

        function(next, err) {
            if (err) return next(err);

            // Now we can proceed with signature verification, all other conditions are met
            api.signature.verify(req, sig, req.__user, (sig) => {
                if (!sig) {
                    api.session.clear(req);
                    return next({ status: 401, message: api.errInvalidSecret, code: "NOLOGIN" });
                }
                // Save user and signature in the request, it will be used later
                req.signature = sig;
                api.session.save(sig);
                api.setCurrentUser(req, req.__user);
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
    api.signature.get(req);
    api.session.clear(req);
    api.csrf.clear(req);
}
