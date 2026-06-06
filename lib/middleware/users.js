/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');
const api = require(__dirname + '/../api');

/**
  * @module middleware/users
  */

const mod =

/**
 * ## User middleare and authentication API
 *
 * The middleware parses cookies with session, verifies it against the bk_user table, checks ACL
 * if access to requested endpoint is allowed, stores current user in the *req.context.user* property.
 *
 * ## API endpoints
 *
 * ### POST __/auth__
 *
 *  This API request returns the current user record from the __bk_user__ table if the request is verified and the session provided
 *  is valid.
 *
 *  By default this endpoint is secured, i.e. requires a valid session, can be used as first call to get the user details and see if it needs login.
 *
 *  On successful login, the result contains full user record
 *
 * ### POST __/login__
 *
 *  Same as the /auth but it uses secret for user authentication, this request does not need a session, just simple
 *  login and secret body parameters to be sent to the backend. This must be sent over SSL.
 *
 *  Parameters:
 *
 *    - login - user login
 *    - secret - user secret
 *
 *  On successful login, the result contains full user record
 *
 *  Example:
 *
 *```javascript
 *   var res = await fetch("/login", { method: "POST", body: "login=test123&secret=X..X" });
 *   await res.json()
 *
 *   > { id: "XXXX...", name: "Test User", login: "test123", ...}
 *```
 *
 * ### POST __/logout__
 *
 *  Logout the current user, clear session cookies if exist.
 *
 */
module.exports = {
    name: "middleware.users",
    args: [
        { name: "err-(.+)", descr: "Error messages for various cases" },
    ],

    errInvalidLogin: "No username or password provided",
    errInvalidSession: "Authentication is required",
};

/**
 * Implements authentication and authorizarion middleware
 * @param {RequestContext} context
 * @param {function} next
 * @memberof module:middleware/users
 * @method handle
 */
mod.handle = function(context, next)
{
    logger.debug("handle:", mod.name, context);

    lib.everySeries([
        function(next) {
            // Pre-authenticated request (WS)
            if (context.user?.id) {
                return next();
            }

            mod.authenticate(context, async (err) => {
                if (!err) return next();

                await context.emit("unauthenticated", err);

                context.reply(err);
            });
        },

        async function(next) {
            await context.emit("authenticated");

            var err = mod.authorize(context);

            if (err) {
                await context.emit("unauthorized");
                return context.reply(err);
            }

            await context.emit("authorized");

            next();
        },
    ], null, true);
}

/**
 * Returns current user profile record
 * @param {RequestContext} context
 * @param {function} next
 * @memberof module:middleware/users
 * @method profile
 */
mod.profile = function(context, next)
{
    if (!context.user?.id || !context.session?.id) {
        return context.reply({ status: 401, message: mod.errInvalidSession });
    }
    context.json(api.users.cleanup(context.user));
}

/**
 * Login with just the secret, endpoint middleware for /login, creates a cookie session and
 * store .exp in the `sessions` column, cleanup expired sessions
 * @param {RequestContext} context
 * @param {function} next
 * @memberof module:middleware/users
 * @method login
 */
mod.login = function(context, next)
{
    const query = api.validate(context, {
        login: { required: 1, max: mod.maxLength },
        secret: { require: 1, max: mod.maxLength },
    });
    if (typeof query == "string") return context.reply({ status: 400, message: query });

    api.users.get(query.login, (err, user) => {
        if (!user) {
            return context.reply({ status: 401, message: mod.errInvalidLogin, code: "NOLOGIN" });
        }

        lib.checkSecret(user.secret, query.secret, (err, ok) => {
            if (!ok) {
                return context.reply({ status: 401, message: mod.errInvalidLogin, code: "NOLOGIN" });
            }

            context.user = user;

            // This is not atomic on purpose, not going to support simultaneous logins from multiple places at once
            const sessions = lib.split(user.sessions, { datatype: "int" }).
                                 filter(x => x > Date.now());

            const session = api.session.create(context, user.id, user.secret);
            sessions.push(session.exp);

            api.users.update({ login: user.login, sessions }, (err) => {
                context.json(api.users.cleanup(context.user));
            });
        });
    });
}

/**
 * Clear sessions and access tokens, logout endpoint middleware for /logout,
 * passing as /logout?force=1 will invalidate all sessions
 * @param {RequestContext} context
 * @param {function} next
 * @memberof module:middleware/users
 * @method logout
 */
mod.logout = function(context, next)
{
    if (!context.user?.id || !context.session?.id) {
        return context.reply({ status: 401, message: mod.errInvalidSession });
    }

    api.session.clear(context);

    // Delete all expired sessions including the current one
    const sessions = lib.isBool(context.query.force) ? null :
                     lib.split(context.user.sessions, { datatype: "int" }).
                         filter(x => x !== context.session.exp && x > Date.now());

    api.users.update({ login: context.user.login, sessions }, () => {
        context.json();
    });
}

/**
 * Verify session from the request object, `req.context.user` will be set on success,
 * session exp field must be present in the user `sessions` field, it is added on login
 * @param {RequestContext} context
 * @param {function} callback
 * @memberof module:middleware/users
 * @method authenticate
 */
mod.authenticate = function(context, callback)
{
    logger.debug("authenticate:", mod.name, context);

    const session = api.session.parse(context);
    if (!session) {
        logger.debug("authenticate:", mod.name, "nosession:", context);
        return callback({ status: 401, message: mod.errInvalidSession });
    }

    mod.get(session.id, (err, user, info) => {
        if (!err) {
            if (!user) {
                logger.debug("authenticate:", mod.name, "nouser:", context, session.id);
                err = { status: 401, message: mod.errInvalidSession };
            } else

            if (user.expires > 0 && user.expires < Date.now()) {
                logger.debug("authenticate:", mod.name, "expired:", context, user.id);
                err = { status: 401, message: mod.errInvalidSession };
            } else

            if (!lib.isFlag(user.sessions, session.exp) ||
                !api.session.verify(context, user.id, user.secret)) {
                logger.debug("authenticate:", mod.name, "nosession:", context, user.id, session);
                err = { status: 401, message: mod.errInvalidSession }
            }
            if (!err) {
                context.user = user;
            }
        }
        callback(err, user);
    });
}

/**
 * Perform authorization checks after the user been checked for valid signature.
 *
 * At least one acl must match to proceed.
 *
 * @param {RequestContext} context
 * @returns {undefined|object} - none if success or an error object to pass to the hooks or next check
 * @memberof module:middleware/users
 * @method authorize
 */
mod.authorize = function(context)
{
    logger.debug("authorize:", mod.name, context);

    if (api.acl.isDenied(context.path, context.user.roles)) {
        logger.debug("authorize:", mod.name, "deny:", 403, context);
        return { status: 403, message: this.errDeny, code: "DENY" };
    }

    // Must satisfy at least one role
    if (api.acl.isAllowed(context.path, context.user.roles)) {
        logger.debug("authorize:", mod.name, "allow:", 200, context);
        return;
    }

    // Authenticated as the last resort
    if (api.acl.isMatched(context.path, "*")) {
        logger.debug("authorize:", mod.name, "authenticated:", 200, context);
        return;
    }

    logger.debug("authorize:", mod.name, "nomatch:", 403, context);
    return { status: 403, message: this.errNoMatch, code: "NOMATCH" };
}


