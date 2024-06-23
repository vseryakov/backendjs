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

api.resetAcl = function()
{
    lib.objReset(api, { name: this.rxResetAcl });
    this.allow = lib.toRegexpObj(null, _allowPath);
}

api.resetAcl();

api.checkAclAllow = function(req)
{
    var rc = { allow: "", matched: [] };
    for (const p in this.allowAccount) {
        if (!lib.testRegexpObj(req.options.path, this.allowAccount[p])) continue;
        rc.matched.push(p);
        if (lib.isFlag(req.account.type, p)) {
            rc.allow = p;
            break;
        }
    }
    if (!rc.allow) {
        for (const p in this.allowAcl) {
            if (!lib.testRegexpObj(req.options.path, this.acl[p])) continue;
            rc.matched.push(p);
            if (lib.isFlag(req.account.type, this.allowAcl[p])) {
                rc.allow = p;
                break;
            }
        }
    }
    logger.debug("checkAclAllow:", req.account.id, req.account.name, req.account.type, req.options.path, "RC:", rc);
    return rc;
}

api.checkAclDeny = function(req)
{
    if (req.account.id && this.checkAcl(this.denyAuthenticated, this.denyAclAuthenticated, req.options)) {
        logger.debug("checkAclDeny:", "denyAuthenticated:", 401, req.account.id, req.account.name, req.account.type, req.options.path, this.denyAuthenticated.list, this.denyAclAuthenticated);
        return { status: 401, message: this.errDenyAuthenticated, code: "DENY" };
    }
    for (const i in req.account.type) {
        var p = req.account.type[i];
        if (this.checkAcl(this.denyAccount[p], this.denyAcl[p], req.options)) {
            logger.debug("checkAclDeny:", "denyAccount:", 401, req.account.id, req.account.name, req.account.type, req.options.path, this.denyAccount[p] && this.denyAccount[p].list, this.denyAcl[p]);
            return { status: 401, message: this.errDenyAcccount, code: "DENY" };
        }
    }
}

api.checkAclOnly = function(req)
{
    var matched = [];
    for (const p in this.onlyAccount) {
        if (!lib.testRegexpObj(req.options.path, this.onlyAccount[p])) continue;
        if (lib.isFlag(req.account.type, p)) return { status: 200, message: "ok" };
        matched.push(p);
    }
    for (const p in this.onlyAcl) {
        if (!lib.testRegexpObj(req.options.path, this.acl[p])) continue;
        if (lib.isFlag(req.account.type, this.onlyAcl[p])) return { status: 200, message: "ok" };
        matched.push(p);
    }
    if (matched.length) {
        logger.debug("checkAclOnly:", "onlyAccount:", 401, req.account.id, req.account.name, req.account.type, req.options.path, "matched:", matched);
        return { status: 401, message: this.errAclOnly, code: "ONLY" };
    }
}

api.checkAcl = function(rx, acl, options)
{
    var path = typeof options == "string" ? options : options?.path;
    return lib.testRegexpObj(path, rx) || (Array.isArray(acl) && acl.some((x) => (lib.testRegexpObj(path, api.acl[x]))));
}

api.checkPreHooks = function(req, status, callback)
{
    if (status?.status >= 401 && status?.status < 500) {
        var loc = this.checkRedirectRules(req, "loginRedirect");
        if (loc) return callback(loc);
    }
    var hooks = this.findHook('pre', req.method, req.options.path);
    if (!hooks.length) return callback(status);

    lib.forEachSeries(hooks, (hook, next) => {
        logger.debug('checkPreHooks:', req.method, req.options.path, req.account.id, hook.path, status);
        hook.callback.call(api, req, status, (err) => {
            if (typeof err?.status == "number") status = err;
            next();
        });
    }, () => {
        logger.debug('checkPreHooks:', req.method, req.options.path, req.account.id, status);
        callback(status);
    }, true);
}

