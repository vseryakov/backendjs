//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const lib = require(__dirname + '/../lib');
const api = require(__dirname + '/../api');
const logger = require(__dirname + '/../logger');

const mod = {
    name: "api.acl",
    args: [
        { name: "deny-path", type: "regexpobj", descr: "Add to the list of URL paths to be denied without authentication" },
        { name: "deny-acl-([a-z0-9_]+)", type: "list", obj: "deny-acl", descr: "Combine regexps from the specified acls for deny checks for the specified role" },
        { name: "acl-([a-z0-9_]+)", type: "regexpobj", obj: "acl", descr: "Add URLs to the named ACL which can be used in allow/deny rules per role" },
        { name: "allow-acl-anonymous", type: "list", descr: "Combine regexps from the specified acls to alllow access any kind of users, with or without authentication" },
        { name: "allow-acl-authenticated", type: "list", descr: "Combine regexps from the specified acls to allow access by any authenticated user, this is only checked if no other acls matched" },
        { name: "allow-acl-([a-z0-9_]+)", type: "rlist", obj: "allow-acl", descr: "Combine regexps from the specified acls for allow checks for the specified role" },
        { name: "allow-path", type: "regexpobj", descr: "Add to the list of allowed URL paths without authentication" },
        { name: "allow-ip", type: "regexpobj", descr: "Add to the list of regexps for IPs that only allowed access from. It is checked before endpoint access list" },
        { name: "deny-ip", type: "regexpobj", descr: "Add to the list of regexps for IPs that will be denied access. It is checked before endpoint access list." },
        { name: "reset", type: "callback", callback: function(v) { if (v) this.resetAcl() }, descr: "Reset all ACL, auth, routing and login properties in the api module" },
        { name: "ignore-allow-path", type: "regexpobj", key: "ignore-allow", descr: "Add to the list of URL paths which should be ignored by the allow rules, in order to keep allow/deny rules simple, for example to keep some js files from open to all: -allow-path \\.js -ignore-allow-path /secure/" },
        { name: "ignore-allow-acl", type: "list", descr: "Combine regexps from the specified acls for the check explained by `-ignore-allow-path` parameter" },
    ],

    // IP access lists
    allowIp: {},
    denyIp: {},

    // No authentication for these urls
    allowPath: {},
    ignoreAllow: {},

    // Allow/deny by user type
    allowAcl: {},
    denyAcl: {},
    acl: {},

    // Refuse access to these urls
    denyPath: {},

    rxResetAcl: /^(ignore|allow|deny|acl|only|routing|auth|login)/,

};
module.exports = mod;

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
    "^/ping",
];

const _ignoreRouting = [
    "^/(js|css|fonts|webfonts|img|public)/"
];

mod.reset = function()
{
    lib.objReset(this, { name: this.rxResetAcl });
    this.allowPath = lib.toRegexpObj(null, _allowPath);
    this.ignoreRouting = lib.toRegexpObj(null, _ignoreRouting);
}

mod.reset();

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
        if (lib.isFlag(req.user.type, this.allowAcl[p])) {
            rc.allow = p;
            break;
        }
    }
    logger.debug("checkAclAllow:", req.user.id, req.user.name, req.user.type, req.options.path, "RC:", rc);
    return rc;
}

api.checkAclDeny = function(req)
{
    for (const i in req.user.type) {
        var p = req.user.type[i];
        if (this.checkAcl(req.options.path, this.denyAcl[p])) {
            logger.debug("checkAclDeny:", "denyAcl:", 401, req.user.id, req.user.name, req.user.type, req.options.path, this.denyAcl[p]);
            return { status: 403, message: this.errDenyAcl, code: "DENY" };
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
            logger.debug('checkAuthHooks:', req.method, req.options.path, req.user.id, hook.path, status, "ERR:", err);
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
            logger.debug('checkPreHooks:', req.method, req.options.path, req.user.id, hook.path, status, "ERR:", err);
            status = err || status;
            next(status);
        });
    }, callback, true);
}
