/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const fs = require("fs");
const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');
const db = require(__dirname + '/../db');
const api = require(__dirname + '/../api');

/**
 * User instance of {@link DbTableColumn}
 * @typedef {object} DbUser
 * @property {string} login - primary key, user email, name or other unique identifier
 * @property {string} id - unique auto-generated UUID
 * @property {string} name - full user name
 * @property {string[]} roles - list of roles for access
 * @property {string[]} flags - custom tags
 * @property {bigint} ctime - create time in milliseconds
 * @property {bigint} mtime - last modified time, auto saved
 * @property {string} secret - hashed user password
 * @property {gibint} [expires] - if set access will be defined if beyond this time
 * @property {string} [pushkey] - can be used for push notifications
 * @property {string} [passkey] - can be used for passkey verifications
 * @property {string[]} [sessions] - list of sessions
 *
 * @example <caption>Default schema</caption>
 * {
 * login: {
 *   primary: 1,
 *   keyword: 1,
 *   length: 140,
 *   check: { max: 140 }
 * },
 * id: {
 *   type: 'uuid',
 *   index: 1,
 *   keyword: 1,
 *   _$db: { index: "UNIQUE" },
 *   _$dynamodb: { projections: 'ALL' },
 *   api: { pub: 1 }
 * },
 * name: {
 *   type: 'text',
 *   notempty: 1,
 *   length: 140,
 *   check: { max: 140 },
 *   api: { pub: 1 }
 * },
 * roles: {
 *   type: 'set',
 *   convert: { list: 1, lower: 1 },
 *   api: { internal: 1 }
 * },
 * flags: {
 *   type: 'set',
 *   length: 140,
 *   check: { max: 140 },
 *   convert: { list: 1 }
 * },
 * ctime: { type: 'now', readonly: 1 },
 * mtime: { type: 'now' },
 * secret: { type: 'text', check: { max: 140 }, api: { priv: 1 } },
 * expires: { type: 'bigint', api: { internal: 1, priv: 1 } },
 * pushkey: { type: 'text', api: { priv: 1 }, check: { max: 4096 } },
 * passkey: { type: 'text', api: { internal: 1, priv: 1 }, check: { max: 4096 } }
 *}
 */

/**
  * @module api/users
  */

const mod =

/**
 * ## User management and authentication API
 *
 * The middleware parses cookies with session, verifies it against the bk_user table, checks ACL
 * if access to requested endpoint is allowed, stores current user in the *req.context.user* property.
 *
 * ## The are 3 predefned ACLS:
 *  - **public** - list of files and endpoints to allow access without authentication, default public endpoints are:
 * ```
 *   ^/$, .htm$, .html$, .ico$, .gif$, .png$, .jpg$, .jpeg$, .svg$, .ttf$, .eot$, .woff$, .woff2$, .js$, .css$,
 *   ^/js/, ^/css/, ^/img, ^/webfonts/, ^/public/, ^/ping
 * ```
 *  - **anonymous** - same as public but still goes thru authentication to get current user if provided
 *  - __*__ - only authenticated user can access such endpoints
 *
 * ## Enabling users middleware
 *
 * To enable middleware and default endpoints set in bkjs.conf:
 *
 * ```
 * api-users-enabled = 1
 * api-acl-add-public = ^/login
 * api-acl-add-* = ^/(auth|logout)
 *
 * ```
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
    name: "api.users",
    args: [
        { name: "err-(.+)", descr: "Error messages for various cases" },
        { name: "table", descr: "Table to use for users" },
        { name: "users", obj: "users", type: "json", merge: 1, logger: "error", descr: "An object with users" },
        { name: "file", descr: "A JSON file with users" },
        { name: "path", type: "list", array: 1, descr: "Paths to verify access" },
    ],

    /**
     * Table to use for users
     * @var {string}
     * @default
     */
    table: "bk_user",
    maxLength: 140,

    /** @var {object} - users loaded from a file */
    users: {},

    errInvalidUser: "The username is required",
    errInvalidPasswd: "The password is required",
    errInvalidName: "The name is required",
    errInvalidParams: "No username or id provided",
    errInvalidId: "Invalid id provided",
    errInvalidLogin: "No username or password provided",
    errInvalidSession: "Authentication is required",
};

mod.configure = function(options, callback)
{
    if (this.enabled) {

        this.tables = {
            [this.table]: {
                login: {                                                     // User login/username
                    primary: 1,
                    keyword: 1,
                    length: mod.maxLength,
                    check: {
                        max: mod.maxLength
                    },
                },
                id: {                                                        // Autogenerated ID
                    type: "uuid",
                    index: 1,
                    keyword: 1,
                    api: {
                        pub: 1,
                    },
                    _$db: { index: "UNIQUE" },
                    _$dynamodb: { projections: "ALL" },
                },
                name: {                                                      // User name
                    type: "str",
                    notempty: 1,
                    length: mod.maxLength,
                    check: {
                        max: mod.maxLength
                    },
                    api: {
                        pub: 1,
                    }
                },
                roles: {                                                      // Permission roles: admin, ....
                    type: "set",
                    convert: {
                        list: 1,
                        lower: 1,
                    },
                    api: {
                        internal: 1,
                    }
                },
                flags: {                                                      // Tags/flags
                    type: "set",
                    check: {
                        max: mod.maxLength
                    },
                    convert: {
                        list: 1,
                    }
                },
                ctime: { type: "now", readonly: 1 },                         // Create time
                mtime: { type: "now" },                                      // Modified time
                secret: {                                                    // Password or API key
                    type: "str",
                    check: {
                        max: mod.maxLength
                    },
                    api: {
                        priv: 1
                    },
                },
                expires: {                                                   // Deny access if this value is before current date, ms
                    type: "bigint",
                    api: {
                        internal: 1,
                        priv: 1
                    },
                },
                pushkey: {                                                  // Push notifications tokens: [service://]token[@appname]
                    type: "text",
                    api: {
                        priv: 1,
                    },
                    check: {
                        max: 4096
                    }
                },
                passkey: {                                                  // List of registered passkeys in json format
                    type: "text",
                    api: {
                        internal: 1,
                        priv: 1,
                    },
                    check: {
                        max: 4096
                    }
                },
                sessions: {                                                // List of current sessions
                    type: "set",
                    api: {
                        internal: 1,
                        priv: 1,
                    },
                }
            },
        };
    }

    if (this.file) {

        this.loadFile(this.file, (err) => {
            if (err) return;
            this._watcher = fs.watch(this.file, () => {
                clearTimeout(this._timer);
                this._timer = setTimeout(this.loadFile.bind(this, this.file), lib.randomInt(1000, 5000));
            });
        });
    }

    callback();
}

mod.shutdown = function(options, callback)
{
    clearTimeout(this._timer);
    delete this._timer;
    if (this._watcher?.close) {
        this._watcher.close();
        delete this._watcher;
    }
    lib.tryCall(callback);
}

/**
 * Returns a user record by login or id
 * @param {object|string} query - user id or login or { id, login }
 * @param {object} [options]
 * @param {function} callback as function(err, user)
 * @memberof module:api/users
 * @method get
 */
mod.get = function(query, options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    if (typeof query == "string") {
        query = { [lib.isUuid(query) ? "id" : "login"]: query };
    }

    if (query?.login) {
        var user = mod.users[query.login];
        if (user) {
            return callback(null, Object.assign({}, user));
        }

        db.get(mod.table, { login: query.login }, callback);
    } else

    if (query?.id) {
        for (const p in mod.users) {
            if (mod.users[p].id === query.id) {
                return callback(null, Object.assign({}, this.users[p]));
            }
        }
        var opts = {
            sort: "id",
            cacheKeyName: "id",
            count: 1,
            first: 1,
        };
        db.select(mod.table, { id: query.id }, opts, callback);
    } else {
        callback();
    }
}

/**
 * Async version of the {@link module:api/users.get} method
 * @param {object|string} query
 * @param {object} [options]
 * @returns {Promise}
 * @example
 * const { err, data } = await api.users.aget("john@mail.com");
 * @memberof module:api/users
 * @method aget
 * @async
 */
mod.aget = function(query, options)
{
    return new Promise((resolve, reject) => {
        mod.get(query, options, (err, data, info) => {
            resolve({ err, data, info });
        });
    });
}

/**
 * Registers a new user, returns new record in the callback,
 * @param {object} query - user record
 * @param {object} [options]
 * @param {function} callback as function(err, user)
 * @memberof module:api/users
 * @method add
 */
mod.add = function(query, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!query?.login) {
        return lib.tryCall(callback, { status: 400, message: mod.errInvalidUser });
    }
    if (!query.name) {
        return lib.tryCall(callback, { status: 400, message: mod.errInvalidName });
    }

    var opts = { result_query: 1, first: 1 };
    delete query.id;

    db.add(mod.table, query, opts, (err, row, info) => {
        if (!err) {
            Object.assign(query, row);
        }
        lib.tryCall(callback, err, query, info);
    });
}

/**
 * Async version of the {@link module:api/users.add} method
 * @param {object|string} query
 * @param {object} [options]
 * @returns {Promise}
 * @example
 * const { err, data } = await api.users.aadd({ login: "john@mail.com", name: "John" });
 * @memberof module:api/users
 * @method aadd
 * @async
 */
mod.aadd = function(query, options)
{
    return new Promise((resolve, reject) => {
        mod.add(query, options, (err, data, info) => {
            resolve({ err, data, info });
        });
    });
}

/**
 * Updates an existing user by login
 * @param {object} query
 * @param {object} [options]
 * @param {function} callback as function(err, user)
 * @memberof module:api/users
 * @method update
 */
mod.update = function(query, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!query?.login) {
        return lib.tryCall(callback, { status: 400, message: mod.errInvalidUser });
    }

    var opts = { returning: "*", first: 1 };
    query = Object.assign({}, query);

    if (!query.name) delete query.name;
    if (!this.isUid(query.id)) delete query.id;

    db.update(this.table, query, opts, callback);
}

/**
 * Async version of the {@link module:api/users.update} method
 * @param {object} query
 * @param {object} [options]
 * @returns {Promise}
 * @example
 * const { err, data } = await api.users.aupdate({ login: "john@mail.com", name: "John" });
 * @memberof module:api/users
 * @method aupdate
 * @async
 */

mod.aupdate = function(query, options)
{
    return new Promise((resolve, reject) => {
        mod.update(query, options, (err, data, info) => {
            resolve({ err, data, info });
        });
    });
}

/**
 * Deletes an existing user by login or id, no admin checks, returns the old record in the callback
 * @param {object|string} query - user id or login or { id, login }
 * @param {object} [options]
 * @param {function} callback as function(err, user)
 * @memberof module:api/users
 * @method del
 */
mod.del = function(query, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (typeof query == "string") {
        query = { [this.isUid(query) ? "id" : "login"]: query };
    }
    var opts = { returning: "old", first: 1 };

    if (query?.login) {
        db.del(this.table, query, opts, callback);
    } else

    if (query?.id) {
        mod.get(query.id, (err, row) => {
            if (!row) return callback(err, { status: 404, message: this.errInvalidId });

            query.login = row.login;
            db.del(this.table, query, opts, callback);
        });
    } else {
        lib.tryCall(callback, { status: 400, message: this.errInvalidParams });
    }
}

/**
 * Async version of the {@link module:api/users.del} method
 * @param {object|string} query
 * @param {object} [options]
 * @returns {Promise}
 * @example
 * const { err, data } = await api.users.adel({ login: "john@mail.com" });
 * @memberof module:api/users
 * @method adel
 * @async
 */

mod.adel = function(query, options)
{
    return new Promise((resolve, reject) => {
        mod.del(query, options, (err, data, info) => {
            resolve({ err, data, info });
        });
    });
}

/**
 * Returns true of the given id is a valid user uuid
 * @param {string} id
 * @returns {boolean}
 */
mod.isUid = function(id)
{
    return lib.isUuid(id, this.tables?.[this.table].id.prefix);
}

/**
 * Load users from a JSON file, only add or update records
 */
mod.loadFile = function(file, callback)
{
    lib.readFile(file, { json: 1, logger: "error" }, (err, users) => {
        if (!err) {
            for (const p in users) {
                if (users[p].login && users[p].id && users[p].secret && users[p].name) {
                    this.users[users[p].login] = users[p];
                    logger.debug("loadFile:", mod.name, users[p]);
                }
            }
        }
        lib.tryCall(callback, err);
    });
}

/**
 * Default method to register authentication middleware and Express routes for user auth/login/logout endpoints
 * @param {object} options
 * @param {function} callback
 * @memberof module:api/users
 * @method configureMiddleware
 */
mod.configureMiddleware = function(options, callback)
{
    if (!mod.path) return callback();

    for (const path of mod.path) {
        api.app.use(path, mod.access.bind(mod));
    }

    api.app.post("/login", mod.login);

    api.app.post("/auth", mod.auth).
            post("/logout", mod.logout);

    callback();
}

/**
 * Authentication check with signature/session, endpoint middleware for /auth, returns full user record as JSON
 * with cleanup, i.e. no priv properties
 * @param {RequestContext} context
 * @memberof module:api/users
 * @method auth
 */
mod.auth = function(context)
{
    const user = db.cleanupResult(mod.table, context.user);
    context.json(user);
}

/**
 * Login with just the secret, endpoint middleware for /login, creates a cookie session and
 * store .exp in the `sessions` column, cleanup expired sessions
 * @param {RequestContext} context
 * @memberof module:api/users
 * @method login
 */
mod.login = function(context)
{
    const query = api.validate(context, {
        login: { required: 1, max: mod.maxLength },
        secret: { require: 1, max: mod.maxLength },
    });
    if (typeof query == "string") return context.reply({ status: 400, message: query });

    mod.get(query.login, (err, user) => {
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

            db.update(mod.table, { login: user.login, sessions }, (err) => {
                user = db.cleanupResult(mod.table, context.user);
                context.json(user);
            });
        });
    });
}

/**
 * Clear sessions and access tokens, logout endpoint middleware for /logout,
 * passing as /logout?force=1 will invalidate all sessions
 * @param {RequestContext} context
 * @memberof module:api/users
 * @method logout
 */
mod.logout = function(context)
{
    api.session.clear(context);

    if (!context.user?.id || !context.session?.id) {
        return context.json();
    }

    // Delete all expired sessions including the current one
    const sessions = lib.isBool(context.query.force) ? null :
                     lib.split(context.user.sessions, { datatype: "int" }).
                         filter(x => x !== context.session.exp && x > Date.now());

    db.update(mod.table, { login: context.user.login, sessions }, () => {
        context.json();
    });
}

/**
 * Implements full authentication and authorizarion middleware
 * Steps:
 *  1. run {@link module:api/users.authenticate}, if status is not 200 return an error
 *  2. run {@link module:api/users.authorize}, at least one ACL must match, on error return
 * @param {RequestContext} context
 * @param {function} callback
 * @memberof module:api/users
 * @method access
 */
mod.access = function(context, callback)
{
    if (!this.enabled) return callback();

    const trace = context.trace?.start("users");

    logger.debug("handle:", mod.name, context);

    lib.everySeries([
        function(next) {
            // Pre-authenticated request (WS)
            if (context.user?.id) {
                return next();
            }

            mod.authenticate(context, async (err) => {
                if (!err) return next();

                if (api.acl.isMatched(context.path, "anonymous")) {
                    return next();
                }

                await context.emit("notauthenticated", err);

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

            trace?.stop();
            callback();
        },
    ], null, true);
}

/**
 * Verify session from the request object, `req.context.user` will be set on success,
 * session exp field must be present in the user `sessions` field, it is added on login
 * @param {RequestContext} context
 * @param {function} callback
 * @memberof module:api/users
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
 * @memberof module:api/users
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


