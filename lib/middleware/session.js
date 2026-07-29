/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
'use strict';

const logger = require(__dirname + '/../logger');
const api = require(__dirname + '/../api');

/**
  * @module middleware/session
  */

const mod =

/**
 * ## User middleware for authenticated endpoints
 *
 * The middleware uses {@link module:api/users} and {@link module:api/session} to parse session cookies,
 * verify it against the bk_user table, checks ACLs with {@link module:api/acl} and if access to requested endpoint is allowed,
 * stores current user in the *context.user* property.
 *
 * ## Global mode
 *
 * Enabled via config, an example to restrict access to /app and /admin endpoints to authenticated users only,
 * if access denied redirect to the login page.
 *
 * - Only users with `admin` role can access /admin/* endpoints but only role `billing` can access `/admin/billing`.
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
 * api-acl-add-* = ^/app
 *
 * api-acl-add-admins = ^/admin/
 * api-acl-add-billing = ^/admin/billing
 *
 * api-acl-allow-admin = admins, -billing
 * api-acl-allow-billing = billing, admins
 * ```
 *
 * ## Token based authentication, for API access
 *
 * This middleware handles API access with bearer tokens, not sessions, each request must send a token in the
 * Authorization header, see {@link module:api/users} for details about tokens.
 *
 * - Only users with `api` role can use token bases access to the `/api/*` endpoints.
 *
 * ```
 * middleware-users-enable-token = /api/*
 *
 * api-acl-add-api = ^/api/
 * api-acl-allow-api = api
 * ```
 *
 * ## Routing programmatically
 *
 * For complete control how the middleware must handle requests all can be easily done in the code
 *
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
 * api.app.all("/api/*", body, { handle: users.handleToken });
 * ```
 *
 * ## Rate limiting
 *
 * For such endpoints it is always makes sense to use rate limiter, for example below allow only 1 login per second by IP or
 * 10 per second globally and a user cam logout only once per 10 seconds
 *
 * ```
 * middleware-limiter-enable = true
 * middleware-limiter-ip-post-/login = rate:1
 * middleware-limiter-path-post-/login = rate:10
 * middleware-limiter-user-post-/logout = rate:1,interval:10
 *
 */
module.exports = {
    name: "middleware.session",

    /**
     * @var {ConfigOptions[]}
     * @default
     */
    args: [
        { name: "enable", type: "list", descr: "Enable user session verification middlware globally for the given list of endpoints" },
        { name: "enable-token", type: "list", descr: "Enable user API token verification globally for the given list of endpoints" },
        { name: "login-redirect", descr: "Location where to redirect if authentication failed" },
        { name: "strict", type: "bool", descr: "If enabled return an error or redirect for failed authentication" },
        { name: "priority", type: "int", descr: "Add routes with this priority sorting number, for config mode only" },
        { name: "err-(.+)", descr: "Error messages for various cases" },
    ],
};

/**
 * Start users middleware
 *
 * @memberof module:middleware/session
 * @method configureMiddleware
 */
mod.configureMiddleware = function(_options, callback)
{
    const method = `#${this.priority ?? ""}`;

    if (mod.enableToken?.length) {
        for (const path of mod.enableToken) {
            api.app.use(method, path, { handle: mod.handleToken });
        }
    }

    if (mod.enable?.length) {
        for (const path of mod.enable) {
            api.app.use(method, path, mod);
        }
    }

    callback();
}

/**
 * Implements authentication and authorizarion middleware for user sessions
 * @param {RequestContext} context
 * @param {function} next
 * @memberof module:middleware/session
 * @method handle
 * @example
 * api.app.use("/portal", middleware.session);
 */
mod.handle = function(context, next)
{
    logger.debug("handle:", mod.name, context);

    api.users.verifySession(context, (err) => {
        if (err && mod.strict) {
            return mod.loginRedirect ?
                   context.redirect(302, mod.loginRedirect) :
                   context.reply(err);
        }

        next();
    });
}

/**
 * Implements authentication for user API tokens
 * @param {RequestContext} context
 * @param {function} next
 * @memberof module:middleware/session
 * @method handleToken
 * @example
 * api.app.use("/portal", { handle: middleware.session.handleToken });
 */
mod.handleToken = function(context, next)
{
    logger.debug("handleToken:", mod.name, context);

    api.users.verifyToken(context, (err) => {
        if (err && mod.strict) {
            return context.reply(err);
        }

        next();
    });
}
