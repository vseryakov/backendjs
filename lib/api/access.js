/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

 /**
  * @module api/access
  */

const lib = require(__dirname + '/../lib');
const api = require(__dirname + '/../api');
const logger = require(__dirname + '/../logger');

const mod =

/**
 * Default security implementation using {@link module:acl}, {@link module:signature},
 * {@link module:session}, {@link module:users} modules, no external dependencies.
 *
 * The Express middleware parses cookies with session signature, verifies it against the bk_user table, checks ACL
 * if access to requested endpoint is allowed, stores current user in the *req.user* property.
 */

module.exports = {
    name: "api.access",
    args: [
        { name: "err-(.+)", descr: "Error messages for various cases" },
        { name: "disabled", type: "bool", descr: "Disable default security middleware" },
    ],

    errDeny: "Access denied",
    errInvalidLogin: "Authentication is required",
    errInvalidUser: "Authentication failed",
    errInvalidSecret: "Authentication failed",
    errInvalidSession: "This session has expired",
    errInvalidRequest: "Invalid request",
    errNoMatch: "Access is not allowed",
};

/**
 * Install authentication/authorization middleware
 * @memberof module:api/access
 * @method configureMiddleware
 */
mod.configureMiddleware = function(options, callback)
{
    api.app.use(mod.middleware.bind(mod));

    callback();
}

/**
 * Implements full authentication and authorizarion of each request
 * Steps:
 *  1. check if access is allowed by path via "access" hooks, calls {@link module:api/access.allow}
 *  2. if status given and not 200 return the error
 *  3. if not matched continue othwewise check CSRF
 *  4. run {@link module:api/access.authenticate}, if status is not 200 return an error
 *  5. check CSRF token {@link module:api/csrf.check}
 *  5. run {@link module:api/access.authorize}, at least one ACL must match, on error return
 *  6. check for routing {@link module:api/routing.check}
 * @param {Request} req
 * @param {Response} res
 * @param {function} callback
 * @memberof module:api/access
 * @method middleware
 */
mod.middleware = function(req, res, callback)
{
    if (mod.disabled) return callback();

    const trace = req.trace.start("access");

    lib.everySeries([
        function(next) {
            mod.allow(req, (status) => {
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
            mod.authenticate(req, (err) => {
                if (!err || err.status == 200) return next();

                if (err?.status == 417) {
                    if (api.acl.isAnonymous(req)) {
                        return next();
                    }
                }

                if (err?.status >= 401 && err.status < 500) {
                    var loc = api.redirect.check(req, "login");
                    if (loc) return api.sendReply(res, loc);
                }

                api.sendReply(res, err);
            });
        },

        function(next) {
            var err = api.csrf.check(req);
            if (err) return api.sendReply(res, err);

            mod.authorize(req, (err) => {
                if (err && err.status != 200) {
                    return api.sendReply(res, err);
                }

                api.routing.check(req, "auth");

                trace.stop();
                callback();
            });
        },
    ], null, true);
}

/**
 * Perform URL based access checks, this is called before the signature verification, very early in the request processing step.
 *
 * Checks access permissions, calls the callback with the following argument:
 * - null or undefined to proceed with authentication
 * - an object with status: 200 to skip authentication and proceed with other routes
 * - an object with status other than 0 or 200 to return the status and stop request processing,
 *    for statuses 301,302 there should be url property in the object returned
 * @param {Request} req
 * @param {function} callback
 * @memberof module:api/access
 * @method allow
 */
mod.allow = function(req, callback)
{
    var status = api.acl.isPublic(req) ? { status: 200 } : null;

    // Call custom access handler for the endpoint
    api.hooks.run("access", req, status, (err) => {
        logger.debug("checkPublic:", mod.name, req.method, req.options.path, status, "ERR:", err);
        callback(err || status);
    }, true);
}

/**
 * Assign or clear the current user record for the given request, if user is null the current is cleared.
 * @param {Request} req
 * @param {object} user
 * @memberof module:api/access
 * @method setUser
 */
mod.setUser = function(req, user)
{
    if (!req) return;
    if (user === null) {
        delete req.user;
    } else
    if (user?.id) {
        req.user = Object.assign({}, user);
    }
    logger.debug("setUser:", mod.name, req.user)
}

/**
 * Verify request signature from the request object, uses properties: .host, .method, .url or .originalUrl, .headers
 * @param {Request} req
 * @param {function} callback
 * @memberof module:api/access
 * @method authenticate
 */
mod.authenticate = function(req, callback)
{
    var now = Date.now();
    // Make sure we will not crash on wrong object
    if (!req || !req.headers) req = { headers: {} };

    // Extract all signature components from the request
    var sig = api.signature.get(req);

    logger.debug("authenticate:", mod.name, req.options);

    lib.everySeries([
        function(next) {
            // Sanity checks, required headers must be present and not empty
            if (!sig.method || !sig.host) {
                return next({ status: 415, message: api.errInvalidRequest, code: "NOLOGIN" });
            }

            // Bad or empty signature result in empty login
            if (!sig.login) {
                return next({ status: 417, message: mod.errInvalidLogin, code: "NOLOGIN" });
            }

            // Make sure the request is not expired, it must be in milliseconds
            if (sig.expires && sig.expires < now - api.signature.age) {
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
                return next({ status: 416, message: mod.errInvalidRequest, code: "NOLOGIN" });
            }

            api.session.check(sig, (err, rc) => {
                if (rc < 0) return next({ status: 401, message: mod.errInvalidSession, code: "INVALID" });

                // Pre-authenticated request (WS)
                if (req.user?.login == sig.login && req.user.id) {
                    mod.setUser(req, req.user);
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
                if (!user) return next({ status: 401, message: mod.errInvalidUser, code: "NOLOGIN" });

                if (user.expires > 0 && user.expires < Date.now()) {
                    return next({ status: 412, message: mod.errInvalidUser, code: "EXPIRED" });
                }
                next(null, user);
            });
        },

        function(next, err, user) {
            if (err) return next(err);

            // Now we can proceed with signature verification, all other conditions are met
            api.signature.verify(req, sig, user, (sig) => {
                if (!sig) {
                    api.session.clear(req);
                    return next({ status: 401, message: mod.errInvalidSecret, code: "NOLOGIN" });
                }
                // Save user and signature in the request, it will be used later
                req.signature = sig;
                api.session.save(sig);
                mod.setUser(req, user);
                next();
            });
        },

        function(next, err) {
            // Run authentication hooks for alternative credentials, to proceed it must return nothing or status 200
            api.hooks.run("auth", req, err, (e) => {
                logger.debug('authenticate:', mod.name, e || err, req.signature, 'HDRS:', req.headers);
                next(e || err);
            });
        },
    ], callback, true);
}

/**
 * Perform authorization checks after the user been checked for valid signature.
 *
 * At least one acl must match to proceed.
 *
 * @param {Request} req - is Express request object
 * @param {function} callback is a function(status) to be called with the final status
 * @memberof module:api/access
 * @method authorize
 */
mod.authorize = function(req, callback)
{
    logger.debug("authorize:", mod.name, req.options);

    if (api.acl.isDenied(req)) {
        logger.debug("authorize:", mod.name, "deny:", 403, req.options);
        return api.hooks.runAll("pre", req, { status: 403, message: this.errDeny, code: "DENY" }, callback);
    }

    // Must satisfy at least one role
    if (api.acl.isAllowed(req)) {
        logger.debug("authorize:", mod.name, "allow:", 200, req.options);
        return api.hooks.runAll("pre", req, null, callback);
    }

    // Authenticated as the last resort
    if (api.acl.isAuthenticated(req)) {
        logger.debug("authorize:", mod.name, "authenticated:", 200, req.options);
        return api.hooks.runAll("pre", req, null, callback);
    }

    logger.debug("authorize:", mod.name, "nomatch:", 403, req.options);
    api.hooks.runAll("pre", req, { status: 403, message: this.errNoMatch, code: "NOMATCH" }, callback);
}

