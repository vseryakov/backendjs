/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const logger = require(__dirname + '/../logger');
const api = require(__dirname + '/../api');

/**
  * @module middleware/users
  */

const mod =

/**
 * ## User middleware for authenticated endpoints
 *
 * The middleware uses {@link module:api/users} and {@link module:api/session} to parse session cookies,
 * verify it against the bk_user table, checks ACL if access to requested endpoint is allowed,
 * stores current user in the *context.user* property.
 *
 * ## Global mode
 *
 * Enabled via config, an example to restrict access to /app and /admin endpoints to authenticated users only,
 * if access denied redirect to the login page
 *
 * ```
 * api-users-table = bk_user
 *
 * middleware-body-enable = true
 *
 * middleware-users-enable = /app/*, /admin/*
 *
 * middleware-users-login-path = /login
 * middleware-users-logout-path = /logout
 * middleware-users-profile-path = /profile
 *
 * middleware-users-login-redirect = /login.html
 *
 * api.acl-add-* = ^/
 * ```
 *
 * ## Routing programmatically
 *
 * Separate middleware by route
 * ```js
 * const { api, middleware } = require("backendjs");
 * const { body, users } = middleware;
 *
 * api.app.post("/login", body, users.login);
 *
 * api.app.post("/logout", users.logout).
 *         get("/profile", users.profile);
 *
 * api.app.use("/api/*", users).
 *         use("/admin/*", users);
 *
 * ```
 *
 */
module.exports = {
    name: "middleware.users",
    args: [
        { name: "enable", type: "list", descr: "Enable users middlware globally for the given list of endpoints" },
        { name: "login-path", descr: "Endpoint path for the login middleware, method POST" },
        { name: "login-redirect", descr: "Location where to redirect if authentication failed" },
        { name: "profile-path", descr: "Endpoint path for the profile middleware, method GET" },
        { name: "logout-path", descr: "Endpoint path for the logout middleware., method POST" },
        { name: "err-(.+)", descr: "Error messages for various cases" },
    ],

    errInvalidSession: "Authentication is required",
};

/**
 * Start users middleware
 *
 * @memberof module:middleware/users
 * @method configureMiddleware
 */
mod.configureMiddleware = function(options, callback)
{
    if (mod.enable?.length) {
        if (mod.loginPath) {
            api.app.post(mod.loginPath, mod.login);
        }
        if (mod.profilePath) {
            api.app.get(mod.profilePath, mod.profile);
        }
        if (mod.logoutPath) {
            api.app.post(mod.logoutPath, mod.logout);
        }
        for (const path of mod.enable) {
            api.app.use(path, mod);
        }
    }

    callback();
}

/**
 * Implements authentication and authorizarion middleware
 * @param {RequestContext} context
 * @param {function} next
 * @memberof module:middleware/users
 * @method handle
 * @example
 * api.app.use("/portal", middleware.users);
 */
mod.handle = function(context, next)
{
    logger.debug("handle:", mod.name, context);

    mod.authenticate(context, async (err) => {
        if (err) {
            return mod.loginRedirect ?
                   context.redirect(302, mod.loginRedirect) :
                   context.reply(err);
        }

        err = mod.authorize(context);
        if (err) {
            return context.reply(err);
        }

        next();
    });
}

/**
 * Login with the secret, set the user in the context, creates a cookie session and
 * store .exp in the `sessions` column, cleanup expired sessions.
 * The body must have { login, secret } properties.
 *
 * The endpoint must be public.
 *
 * @param {RequestContext} context
 * @param {function} next
 * @memberof module:middleware/users
 * @method login
 * @example
 * api.app.post("/login", middleware.users.login);
 *
 * api.app.post("/login", middleware.body, middleware.users.login);
 */
mod.login = function(context, next)
{
    api.users.login(context, (err, user) => {
        context.reply(err, api.users.cleanup(user));
    })
}

/**
 * Middleware to return current user profile record, can be used for checking if current session is still active,
 * it handles authentication so this can be used with any path
 * @param {RequestContext} context
 * @param {function} next
 * @memberof module:middleware/users
 * @method profile
 * @example
 * api.app.get("/profile", middleware.users.profile);
 *
 */
mod.profile = function(context, next)
{
    mod.authenticate(context, (err) => {
        if (err) return context.reply(err);

        context.json(api.users.cleanup(context.user));
    });
}

/**
 * Clear session, delete expired sessions,
 * it handles authentication so this can be used with any path
 * @param {RequestContext} context
 * @param {function} next
 * @memberof module:middleware/users
 * @method logout
 * @example
 * api.app.post("/logout", middleware.users.logout);
 */
mod.logout = function(context, next)
{
    mod.authenticate(context, (err) => {
        if (err) return context.reply(err);

        api.users.logout(context, (err) => {
            context.reply(err);
        })
    });
}

/**
 * Middleware to authenticate user's session, `context.user` will be set on success
 * @param {RequestContext} context
 * @param {function(err, user)} next
 * @memberof module:middleware/users
 * @method authenticate
 */
mod.authenticate = function(context, next)
{
    logger.debug("authenticate:", mod.name, context);

    api.users.verifySession(context, next);
}

/**
 * Perform authorization checks after the user been checked for valid session.
 *
 * At least one acl must match to proceed.
 *
 * @param {RequestContext} context
 * @returns {undefined|{ status:number, message:string}} - undefined if success or an error object to pass to the next
 * @memberof module:middleware/users
 * @method authorize
 */
mod.authorize = function(context)
{
    logger.debug("authorize:", mod.name, context);

    if (api.acl.isDenied(context.path, context.user.roles)) {
        logger.debug("authorize:", mod.name, "deny:", 403, context, context.user);
        return { status: 403, message: this.errDeny, code: "DENY" };
    }

    // Must satisfy at least one role
    if (api.acl.isAllowed(context.path, context.user.roles)) {
        logger.debug("authorize:", mod.name, "allow:", 200, context, context.user);
        return;
    }

    // Authenticated as the last resort
    if (api.acl.isMatched(context.path, "*")) {
        logger.debug("authorize:", mod.name, "authenticated:", 200, context, context.user);
        return;
    }

    logger.debug("authorize:", mod.name, "nomatch:", 403, context, context.user);
    return { status: 403, message: this.errNoMatch, code: "NOMATCH" };
}


