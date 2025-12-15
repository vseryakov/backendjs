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
 * API hooks to modify or extend default functionality.
 *
 *
 * Hook: `access`
 *
 * A handler to check access for any given endpoint, it works the same way as the global accessCheck function and is called before
 * validating the signature or session cookies. No user information is available at this point yet.
 *
 * - To continue to next hook return nothing in the `cb`,
 * - any returned status will be final, an error status will be immediately returned in the response,
 * - status 200 will continue to the authentication step
 *
 * Parameters:
 *  - method can be '' in such case all methods will be matched
 *  - path is a string or regexp of the request URL similar to registering Express routes
 *  - callback is a function function(req, status, cb) {}, where status is { status: 200 } for public endpoints or null
 *
 * Example:
 *
 *          api.hooks.add("access", '', 'user', (req, status, cb) => { cb({ status: 500, message: "access disabled"}) }))
 *
 *          api.hooks.add("access", 'POST', '/user/add', (req, status, cb) => {
 *             if (!req.query.invitecode) return cb({ status: 400, message: "invitation code is required" });
 *             cb();
 *          });
 *
 * Hook: `auth`
 *
 * This callback will be called after the signature or session is verified but before
 * the ACL authorizaton is called. The `req.user` object will always exist at this point but may not contain the user in case of an error.
 *
 * The purpose of this hook is to perform alternative authentication like API access with keys. Because it is called before the authorization it is
 * also possible to customize user roles.
 *
 * - To continue to next hook return nothing in the `cb`
 * - any returned status will be final, an error status will be immediately returned in the response
 * - status 200 will continue to the authorization step
 *
 * Parameters:
 * - method can be '' in such case all methods will be matched
 * - path is a string or regexp of the request URL similr to registering Express routes
 * - callback is a function(req, status, cb) where status is empty or an error from the authentication or previous hook
 *
 * Example:
 *
 * Hook: `pre`
 *
 * Similar to `auth` hook, this callback will be called after the signature or session is verified and ACL authorization performed but before
 * the API route method is called. The `req.user` object will always exist at this point.
 *
 * The purpose of this hook is to perform some preparations or check permissions of a valid user to resources or in case of error perform alternative
 * authorization.
 *
 * - All hooks will be called regardless if they return an error or not, any error will be assumed as current and will be passed to the next hook
 * - The status parameter may be empty or status == 200 in case of successful authorization or an error if status != 200
 * - After all hooks called and the final status != 200 the request will stop processing and return that error immediately
 * - no error or status == 200 means authorization succeded and ready to proceed to the routing phase.
 *
 * Parameters:
 * - method can be '' in such case all methods will be matched
 * - path is a string or regexp of the request URL similr to registering Express routes
 * - callback is a function(req, status, cb)
 *
 * Example:
 *
 *           api.hooks.add("pre", 'GET', '/user/get', (req, status, cb) => {
 *                if (status.status != 200) status = { status: 302, url: '/error.html' };
 *                cb(status)
 *           });
 *
 * Example with admin access only:
 *
 *          api.hooks.add("pre", 'POST', '/data/', (req, status, cb) => {
 *              if (req.user.roles != "admin") return cb({ status: 401, message: "access denied, admins only" });
 *              cb();
 *          });
 *
 * Hook: `post`
 *
 * Register a callback to be called after successfull API action, status 200 only. To trigger this callback the primary response handler must return
 * results using `api.sendJSON` or `api.sendFormatted` methods.
 *
 * The purpose is to perform some additional actions after the standard API completed or to customize the result
 * - method can be '' in such case all methods will be matched
 * - path is a string or regexp of the request URL similar to registering Express routes
 * - callback is a function with the following parameters: function(req, res, rows) where rows is the result returned by the API handler,
 *   the callback may not return data back to the client, in this case next post-process hook will be called and eventually the result will be sent back to the client.
 *   **To indicate that this hook will send the result eventually it must return true, otherwise the rows will be sent afer all hooks are called**
 *
 * Note: the `req.user, req.options, req.query` objects may become empty if any callback decided to do some async action, they are explicitly emptied at the end of the request,
 * in such cases make a copy of the needed objects if it will needed
 *
 * Example, just update the rows, it will be sent at the end of processing all post hooks
 *
 *          api.hooks.add("post", '', '/data/', (req, res, rows) => {
 *              rows.forEach((row) => { ...});
 *          });
 *
 * Example, add data to the rows and return result after it
 *
 *          api.hooks.add("post", '', '/data/', (req, res, row) => {
 *              db.get("bk_user", { id: row.id }, (err, rec) => {
 *                  row.name = rec.name;
 *                  res.json(row);
 *              });
 *              return true;
 *          });
 *
 * Hook: `cleanup`
 *
 * Register a cleanup callback that will be called at the end of a request, all registered cleanup callbacks will be called in the order
 * of registration. At this time the result has been sent so connection is not valid anymore but the request and user objects are still available.
 *
 * Example, do custom logging of all requests
 *
 *          api.hooks.add("cleanup", '', '/data/', (req, next) => {
 *              db.add("log", req.query, next);
 *          });
 *
 * Hook: `status`
 *
 * Register a status callback that will be called when `api.sendReply` or `api.sendStatus` is called,
 * all registered callbacks will be called in the order of registration. At this time the result has NOT been sent yet so connection is
 * still valid and can be changed. The callback behavior is similar to the `api.registerPostProcess`.
 *   **To indicate that this hook will send the result eventually it must return true, otherwise the result will be sent afer all hooks are called**
 *
 * Example, do custom logging of all requests
 *
 *          api.hooks.add("status", '', '/data/', (req, res, data) => {
 *              logger.info("response", req.path, data);
 *          });
 *
 * Hook: `sig`
 *
 * The purpose of this hook is to manage custom signatures.
 * - method can be '' in such case all methods will be matched
 * - path is a string or regexp of the request URL similr to registering Express routes
 * - callback is a function(req, user, sig, cb) where
 *   - if sig is null it means to generate a new signature for the given user and return in the callback, if multiple hooks are registered the processing
 *     stops on first signature returned
 *   - if sig is provided that means to verify the signature against given user and return it if valid or return null if it is invalid or
 *     cannot be verified by current hook, multiple hooks can be supported and it stops on first signature returned in the callback
 *
 * Example:
 *
 *           api.hooks.add("sig", '', '/', (req, user, sig, cb) => {
 *                if (sig) {
 *                    if (invalid) sig = null;
 *                } else {
 *                    sig = api.createSignature(.....);
 *                }
 *                cb(sig)
 *           });
 */

module.exports = mod;

// Find registered hooks for given type and path
mod.find = function(type, method, path)
{
    var hooks = [];
    var bucket = type;
    var routes = this.hooks[bucket];
    if (!routes) return hooks;
    method = method && method.toLowerCase();
    for (var i = 0; i < routes.length; ++i) {
        if ((!routes[i].method || routes[i].method == method) && routes[i].path.test(path)) {
            hooks.push(routes[i]);
        }
    }
    logger.debug("find:", mod.name, type, method, path, hooks);
    return hooks;
}

// Register a hook callback for the type and method and request url, if already exists does nothing.
mod.add = function(type, method, path, callback)
{
    if (!type || !path || typeof callback != "function") return;
    var hooks = this.find(type, method, path);
    var rx = util.types.isRegExp(path) ? path : new RegExp("^" + path + "$");
    method = method ? method.toLowerCase() : "";
    if (hooks.some((x) => (x.method == method && String(x.path) === String(rx) && x.callback === callback))) return;
    var hook = { id: this.id++, type, method, path: rx, callback };
    if (!this.hooks[type]) this.hooks[type] = [];
    this.hooks[type].push(hook);
    logger.debug("add:", mod.name, hook);
    return hook;
}

// Run matching hooks of the given type, stop on first error
mod.run = function(type, req, status, callback)
{
    var hooks = this.find(type, req.method, req.options.path);
    if (!hooks.length) return callback(status);
    lib.forEachSeries(hooks, (hook, next) => {
        hook.callback(req, status, (err) => {
            logger.debug("run:", mod.name, req.method, req.options.path, req.user?.id, "H:", hook, "E:", err);
            next(err);
        });
    }, callback, true);
}

// Run all hooks reardless of the errors, the last error is passed to the next hook, returns the last error raised
mod.runAll = function(type, req, status, callback)
{
    var hooks = this.find(type, req.method, req.options.path);
    if (!hooks.length) return callback(status);
    lib.forEverySeries(hooks, (hook, next) => {
        hook.callback(req, status, (err) => {
            logger.debug("runAll:", mod.name, req.method, req.options.path, req.user?.id, "H:", hook, "E:", err);
            status = err || status;
            next(status);
        });
    }, callback, true);
}

