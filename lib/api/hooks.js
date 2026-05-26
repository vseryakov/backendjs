/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
const util = require('util');
const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');

/**
  * @module api/hooks
  */

const mod = {
    name: "api.hooks",

    id: 0,
    hooks: {},
};

/**
 * API hooks to modify or extend default functionality. All hooks use same callback arguments as `function(context, data, next)` and
 * run via @{link module.lib.forEachSeries}, in the order registered. Must call next at the ned to continue, any error will stop processing
 * next hooks and return immediately.
 *
 *
 * # Hook: access
 *
 * A handler to check access for any given endpoint, it is called before
 * validating the session cookies. No user information is available at this point yet.
 *
 * - To continue to next hook return nothing in the **next**,
 * - status 200 will skip authentication and proceed to next route
 * - any other status will be final, it will be immediately returned in the response,
 *
 * Example:
 * ```js
 * api.hooks.add("access", '/api', (context, data, next) => {
 *     next(context.req.headers.apikey ? { status: 200 } : null)
 * })
 *
 * api.hooks.add("access", '/optin', (context, data, next) => {
 *     if (!context.body?.invitecode) {
 *         return next({ status: 400, message: "invitation code is required" });
 *     }
 *     next({ status: 200 });
 * });
 * ```
 *
 * # Hook: pre
 *
 * This callback will be called after the session is verified and ACL authorization performed but before
 * the API route method is called. The **req.context.user* object will always exist at this point.
 *
 * The purpose of this hook is to perform some after authorization checks regarldless if it succeded or not.
 *
 * - The status parameter is result of authorization, null on success or an error
 * - Returned error stops processing and it is returned back
 * - The status object if not null can be modified to alter the authorization result
 *
 * Example:
 * ```js
 * api.hooks.add("pre", '/user/get', (context, status, next) => {
 *     if (!status && !context.user?.email) {
 *         return next({ status: 302, url: '/verify_email.html' });
 *     }
 *     next()
 * });
 * ```
 * Example with admin access only:
 * ```js
 * api.hooks.add("pre", '/data/', (context, status, next) => {
 *     if (!status && context.user.roles != "admin") {
 *         return next({ status: 401, message: "access denied, admins only" });
 *     }
 *     next();
 * });
 * ```
 *
 * # Hook: post
 *
 * Register a callback to be called when result is returned using any of
 * {@link module:api.sendJSON}, {@link module:api.sendStatus}, {@link module:api.sendReply} methods.
 *
 * The purpose is to perform some additional actions with the result before returning it.
 *
 * Example, just update the rows, it will be sent at the end of processing all post hooks
 * ```js
 * api.hooks.add("post", '/data/', (context, data, next) => {
 *     if (data?.length) {
 *         data.forEach((row) => { ...});
 *     }
 *     next();
 * });
 * ```
 *
 * # Hook: cleanup
 *
 * Register a cleanup callback that will be called at the end of a request, all registered cleanup callbacks will be called in the order
 * of registration. At this time the result has been sent so connection is not valid anymore but the request and user objects are still available.
 *
 * Example, do custom logging of all requests
 * ```js
 * api.hooks.add("cleanup", '/data/', (context, data, next) => {
 *     db.add("log", context.query, next);
 * });
 * ```
 *
 */

module.exports = mod;

/**
 * Find all registered hooks for given type and path
 * @param {string} type - hook type
 * @param {string} path - request path
 * @method find
 * @memberof module:api/hooks
 */
mod.find = function(type, path)
{
    var routes = this.hooks[type];
    if (!routes) return;
    var hooks;
    for (var i = 0; i < routes.length; ++i) {
        if (routes[i].path.test(path)) {
            hooks = hooks || [];
            hooks.push(routes[i]);
        }
    }
    logger.debug("find:", mod.name, type, path, hooks);
    return hooks;
}

/**
 * Register a hook callback for the type and method and request url, if already exists does nothing.
 * @param {string} type - hook type
 * @param {string|RegExp} path - a string or regexp of the request path, string will be wrapped into ^..$
 * @param {function} callback - to call if matched
 * @memberof module:api/hooks
 * @method add
 */
mod.add = function(type, path, callback)
{
    if (!type || !path || typeof callback != "function") return;
    var hooks = this.find(type, path);
    var rx = util.types.isRegExp(path) ? path : new RegExp("^" + path + "$");
    if (hooks.some(x => (String(x.path) === String(rx) && x.callback === callback))) return;
    var hook = { id: this.id++, type, path: rx, callback };
    if (!this.hooks[type]) this.hooks[type] = [];
    this.hooks[type].push(hook);
    logger.debug("add:", mod.name, hook);
    return hook;
}

/**
 * Run matching hooks of the given type, stop on first error
 * @param {string} type - hook type
 * @param {RequestContext} context - Request context
 * @param {any} data - passed to hooks
 * @param {function} callback - called after all hooks processed with first error raised
 * @method run
 * @memberof module:api/hooks
 */
mod.run = function(type, context, data, callback)
{
    var hooks = this.find(type, context?.path);
    if (!hooks) return callback();

    lib.forEachSeries(hooks, (hook, next) => {
        hook.callback(context, data, (err) => {
            logger.debug("run:", mod.name, context, "H:", hook, "E:", err);
            next(err);
        });
    }, callback, true);
}

