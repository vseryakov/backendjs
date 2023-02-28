//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//
const util = require('util');
const api = require(__dirname + '/../api');
const logger = require(__dirname + '/../logger');

// Find registered hooks for given type and path
api.findHook = function(type, method, path)
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
    logger.debug("findHook:", type, method, path, hooks);
    return hooks;
}

// Register a hook callback for the type and method and request url, if already exists does nothing.
api.addHook = function(type, method, path, callback)
{
    var bucket = type;
    var hooks = this.findHook(type, method, path);
    var rx = util.types.isRegExp(path) ? path : new RegExp("^" + path + "$");
    method = method ? method.toLowerCase() : "";
    if (hooks.some((x) => (x.method == method && String(x.path) === String(rx) && x.callback == callback))) return false;
    if (!this.hooks[bucket]) this.hooks[bucket] = [];
    this.hooks[bucket].push({ method: method, path: rx, callback: callback });
    logger.debug("addHook:", type, method, path);
    return true;
}

// Register access rate limit for a given name, all other rate limit properties will be applied as described in the `checkRateLimits`
api.registerRateLimits = function(name, rate, max, interval, queue)
{
    if (!name) return false;
    this.rlimitsMap[name] = { rate, max, interval, queue };
    return true;
}

// Add special control parameters that will be recognized in the query and placed in the `req.options` for every request.
//
// Control params start with underscore and will be converted into the configured type according to the spec.
// The `options` is an object in the format that is used by `lib.toParams`, no default type is allowed, even for string
// it needs to be defined as { type: "string" }.
//
// No existing control parameters will be overridden, also care must be taken when defining new control parameters so they do not
// conflict with the existing ones.
//
// These are default common parameters that can be used by any module:
//  - `_count, _page, _tm, _sort, _select, _ext, _start, _token, _session, _format, _total, _encoding, _ops`
//
// These are the reserved names that cannot be used for parameters, they are defined by the engine for every request:
//   - `path, apath, ip, host, mtime, cleanup, secure, noscan, appName, appVersion, appLocale, appTimezone, apiVersion`
//
// NOTE: `noscan` is set to 1 in every request to prevent accidental full scans, this means it cannot be enabled via the API but any module
// can do it in the code if needed.
//
// Example:
//
//      mod.configureMiddleware = function(options, callback) {
//          api.registerControlParams({ notify: { type: "bool" }, level: { type: "int", min: 1, max: 10 } });
//          callback();
//      }
//
//      Then if a request arrives for example as `_notify=true&_level=5`, it will be parsed and placed in the `req.options`:
//
//      mod.configureWeb = function(options, callback) {
//
//         api.app.all("/send", function(req, res) {
//             if (req.options.notify) { ... }
//             if (req.options.level > 5) { ... }
//         });
//         callback()
//      }
api.registerControlParams = function(options)
{
    for (const p in options) {
        if (options[p] && options[p].type && typeof this.controls[p] == "undefined") this.controls[p] = options[p];
    }
}

// Register a handler to check access for any given endpoint, it works the same way as the global accessCheck function and is called before
// validating the signature or session cookies. No account information is available at this point yet.
//
//  - method can be '' in such case all methods will be matched
//  - path is a string or regexp of the request URL similar to registering Express routes
//  - callback is a function with the following parameters: function(req, cb) {}, to indicate an error condition pass an object
//    with the callback with status: and message: properties, status != 200 means error,
//    status == 0 means continue processing, ignore this match
//
// Example:
//
//          api.registerAccessCheck('', 'account', function(req, cb) { cb({ status: 500, message: "access disabled"}) }))
//
//          api.registerAccessCheck('POST', '/account/add', function(req, cb) {
//             if (!req.query.invitecode) return cb({ status: 400, message: "invitation code is required" });
//             cb();
//          });
//
api.registerAccessCheck = function(method, path, callback)
{
    return this.addHook('access', method, path, callback);
}

// This callback will be called after the signature or session is verified but before
// the ACL authorizaton is called. The `req.account` object will always exist at this point but may not contain the user in case of an error.
//
// The purpose of this hook is to perform alternative authentication like API access with keys. Because it is called before the authorization it is
// also possible to customize user roles.
//
// To just continue to next hopok or step return nothing in the `cb`,
// any returned status will be final, an error status will be immediately returned in the response,
// status 200 will continue to the authorization step
//
// - method can be '' in such case all methods will be matched
// - path is a string or regexp of the request URL similr to registering Express routes
// - callback is a function(req, status, cb) where status is an object { status:..., message: ..} passed from the checkRequestSignature call
//
// Example:
//

api.registerAuthCheck = function(method, path, callback)
{
    return this.addHook('auth', method, path, callback);
}

// Similar to `registerAuthCheck`, this callback will be called after the signature or session is verified and ACL authorization performed but before
// the API route method is called. The `req.account` object will always exist at this point but may not contain the user in case of an error.
//
// The purpose of this hook is to perform some preparations or check permissions of a valid user to resources or in case of error perform any other action
// like redirection or returning something explaining what to do in case of failure.
//
// - method can be '' in such case all methods will be matched
// - path is a string or regexp of the request URL similr to registering Express routes
// - callback is a function(req, status, cb) where status is an object { status:..., message: ..} passed from the checkRequestSignature call, if status != 200 it means
//   an error condition, the callback must pass the same or modified status object in its own `cb` callback
//
// Example:
//
//           api.registerPreProcess('GET', '/account/get', function(req, status, cb) {
//                if (status.status != 200) status = { status: 302, url: '/error.html' };
//                cb(status)
//           });
//
// Example with admin access only:
//
//          api.registerPreProcess('POST', '/data/', function(req, status, cb) {
//              if (req.account.type != "admin") return cb({ status: 401, message: "access denied, admins only" });
//              cb();
//          });
//
api.registerPreProcess = function(method, path, callback)
{
    return this.addHook('pre', method, path, callback);
}

// Register a callback to be called after successfull API action, status 200 only. To trigger this callback the primary response handler must return
// results using `api.sendJSON` or `api.sendFormatted` methods.
//
// The purpose is to perform some additional actions after the standard API completed or to customize the result
// - method can be '' in such case all methods will be matched
// - path is a string or regexp of the request URL similar to registering Express routes
// - callback is a function with the following parameters: function(req, res, rows) where rows is the result returned by the API handler,
//   the callback may not return data back to the client, in this case next post-process hook will be called and eventually the result will be sent back to the client.
//   **To indicate that this hook will send the result eventually it must return true, otherwise the rows will be sent afer all hooks are called**
//
// Note: the `req.account,req.options,req.query` objects may become empty if any callback decided to do some async action, they are explicitly emptied at the end of the request,
// in such cases make a copy of the needed objects if it will needed
//
// Example, just update the rows, it will be sent at the end of processing all post hooks
//
//          api.registerPostProcess('', '/data/', function(req, res, rows) {
//              rows.forEach(function(row) { ...});
//          });
//
// Example, add data to the rows and return result after it
//
//          api.registerPostProcess('', '/data/', function(req, res, row) {
//              db.get("bk_user", { id: row.id }, function(err, rec) {
//                  row.name = rec.name;
//                  res.json(row);
//              });
//              return true;
//          });
//
api.registerPostProcess = function(method, path, callback)
{
    return this.addHook('post', method, path, callback);
}

// Register a cleanup callback that will be called at the end of a request, all registered cleanup callbacks will be called in the order
// of registration. At this time the result has been sent so connection is not valid anymore but the request and account objects are still available.
//
// Example, do custom logging of all requests
//
//          api.registerCleanup('', '/data/', function(req, next) {
//              db.add("log", req.query, next);
//          });
//
api.registerCleanup = function(method, path, callback)
{
    return this.addHook('cleanup', method, path, callback);
}

// Register a status callback that will be called when `api.sendReply` or `api.sendStatus` is called,
// all registered callbacks will be called in the order of registration. At this time the result has NOT been sent yet so connection is
// still valid and can be changed. The callback behavior is similar to the `api.registerPostProcess`.
//   **To indicate that this hook will send the result eventually it must return true, otherwise the result will be sent afer all hooks are called**
//
// Example, do custom logging of all requests
//
//          api.registerSendStatus('', '/data/', function(req, res, data) {
//              logger.info("response", req.path, data);
//          });
//
api.registerSendStatus = function(method, path, callback)
{
    return this.addHook('status', method, path, callback);
}

// The purpose of this hook is to manage custom signatures.
// - method can be '' in such case all methods will be matched
// - path is a string or regexp of the request URL similr to registering Express routes
// - callback is a function(req, account, sig, cb) where
//   - if sig is null it means to generate a new signature for the given account and return in the callback, if multiple hooks are registered the processing
//     stops on first signature returned
//   - if sig is provided that means to verify the signature against given account and return it if valid or return null if it is invalid or
//     cannot be verified by current hook, multiple hooks can be supported and it stops on first signature returned in the callback
//
// Example:
//
//           api.registerSignature('', '/', function(req, account, sig, cb) {
//                if (sig) {
//                    if (invalid) sig = null;
//                } else {
//                    sig = api.createSignature(.....);
//                }
//                cb(sig)
//           });
//
api.registerSignature = function(method, path, callback)
{
    return this.addHook('sig', method, path, callback);
}

// Register a secret generation method.
// - login is a regexp for logins to have a special secret encryption method
// - callback is a function(account, options, cb)
//
api.registerSecret = function(login, callback)
{
    return this.addHook('secret', '', login, callback);
}

// Register a callback to be called just before HTTP headers are flushed, the callback may update response headers
// - callback is a function(req, res, statusCode)
api.registerPreHeaders = function(req, callback)
{
    if (typeof callback != "function") return;
    if (typeof req?.res?.writeHead != "function") return;
    var old = req.res.writeHead;
    req.res.writeHead = function(statusCode, statusMessage, headers) {
        if (callback) {
            callback(req, req.res, statusCode);
            callback = null;
        }
        old.call(req.res, statusCode, statusMessage, headers);
    }
}

