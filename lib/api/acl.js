//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const lib = require(__dirname + '/../lib');
const api = require(__dirname + '/../api');
const logger = require(__dirname + '/../logger');

const _allowPath = [
    "^/$",
    "\\.htm$", "\\.html$",
    "\\.ico$", "\\.gif$", "\\.png$", "\\.jpg$", "\\.jpeg$", "\\.svg$",
    "\\.ttf$", "\\.eot$", "\\.woff$", "\\.woff2$",
    "\\.js$", "\\.css$",
    "^/js/",
    "^/css/",
    "^/img",
    "^/webfonts/",
    "^/public/",
    "^/login$",
    "^/passkey/login$",
    "^/ping",
];

const _ignoreRouting = [
    "^/(js|css|fonts|webfonts|img|public)/"
];

api.resetAcl = function()
{
    lib.objReset(api, { name: this.rxResetAcl });
    this.allowPath = lib.toRegexpObj(null, _allowPath);
    this.ignoreRouting = lib.toRegexpObj(null, _ignoreRouting);
}

api.resetAcl();

api.checkAcl = function(path, acl)
{
    return path && Array.isArray(acl) && acl.some((x) => (lib.testRegexpObj(path, api.acl[x])));
}

api.checkAclAllow = function(req)
{
    var rc = { allow: "", matched: [] };
    for (const p in this.allowAcl) {
        if (!lib.testRegexpObj(req.options.path, this.acl[p])) continue;
        rc.matched.push(p);
        if (lib.isFlag(req.account.type, this.allowAcl[p])) {
            rc.allow = p;
            break;
        }
    }
    logger.debug("checkAclAllow:", req.account.id, req.account.name, req.account.type, req.options.path, "RC:", rc);
    return rc;
}

api.checkAclDeny = function(req)
{
    for (const i in req.account.type) {
        var p = req.account.type[i];
        if (this.checkAcl(req.options.path, this.denyAcl[p])) {
            logger.debug("checkAclDeny:", "denyAccount:", 401, req.account.id, req.account.name, req.account.type, req.options.path, this.denyAcl[p]);
            return { status: 403, message: this.errDenyAccount, code: "DENY" };
        }
    }
}

// Perform URL based access checks, this is called before the signature verification, very early in the request processing step.
//
// Checks access permissions, calls the callback with the following argument:
// - null or undefined to proceed with authentication
// - an object with status: 200 to skip authentication and proceed with other routes
// - an object with status other than 0 or 200 to return the status and stop request processing,
//    for statuses 301,302 there should be url property in the object returned
api.checkAccess = function(req, callback)
{
    var rc = null;
    var path = req.options.path;

    if (lib.testRegexpObj(req.options.ip, this.denyIp) ||
        (this.allowIp?.rx && !lib.testRegexpObj(req.options.ip, this.allowIp))) {
        return callback({ status: 403, message: this.errDenyIp, code: "DENY" });
    }

    if (this.checkAcl(path, this.denyAcl)) {
        return callback({ status: 403, message: this.errDenyAcl, code: "DENY" });
    }

    // Save the status and check the hooks, if no returns anything use it
    if (lib.testRegexpObj(path, this.allowPath) || this.checkAcl(path, this.allowAcl)) {
        rc = { status: 200 };
    }

    if (rc?.status == 200) {
        if (lib.testRegexpObj(path, this.ignoreAllow) || this.checkAcl(path, this.ignoreAllowAcl)) {
            rc = null;
        }
    }

    // Call custom access handler for the endpoint
    var hooks = this.findHook('access', req.method, req.options.path);
    if (hooks.length) {
        lib.forEachSeries(hooks, (hook, next) => {
            logger.debug('checkAccess:', req.method, req.options.path, hook.path);
            hook.callback(req, next);
        }, (status) => {
            logger.debug("checkAccess:", req.method, req.options.path, status, rc);
            callback(status || rc);
        }, true);
        return;
    }
    logger.debug("checkAccess:", req.method, req.options.path, rc);
    callback(rc);
}

// Run authentication hooks for alternative credentials, to proceed it must return nothing or status 200
api.checkAuthHooks = function(req, status, callback)
{
    var hooks = api.findHook('auth', req.method, req.options.path);
    lib.forEachSeries(hooks, (hook, next) => {
        hook.callback(req, status, (err) => {
            logger.debug('checkAuthHooks:', req.method, req.options.path, req.account.id, hook.path, status, "ERR:", err);
            next(err);
        });
    }, callback, true);
}

api.checkPreHooks = function(req, status, callback)
{
    if (typeof status == "function") callback = status, status = null;

    var hooks = this.findHook('pre', req.method, req.options.path);
    if (!hooks.length) return callback(status);

    lib.forEverySeries(hooks, (hook, next) => {
        hook.callback(req, status, (err) => {
            logger.debug('checkPreHooks:', req.method, req.options.path, req.account.id, hook.path, status, "ERR:", err);
            status = err || status;
            next(status);
        });
    }, callback, true);
}
