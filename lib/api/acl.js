/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

/**
  * @module api/acl
  */

const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');

const mod = {
    name: "api.acl",
    args: [
        { name: "err-(.+)", descr: "Error messages for various cases" },
        { name: "add-([a-z0-9_]+)", type: "regexpobj", obj: "acl", make: "$1", descr: "Add URLs to the named ACL which can be used in allow/deny rules per role, ex: -api-acl-add-admins ^/admin" },
        { name: "deny-([a-z0-9_]+)", type: "list", obj: "deny", array: 1, sort: 1, descr: "Match all regexps from the specified acls to deny access for the specified role, ex: -api-acl-deny-user admins,billing" },
        { name: "allow-([a-z0-9_]+)", type: "list", obj: "allow", array: 1, sort: 1, descr: "Match all regexps from the specified acls for allow access for the specified role, ex: -api-acl-allow-staff admins,support,-billing" },
        { name: "public", type: "list", array: 1, sort: 1, descr: "Match all regexps from the specified acls for public access, ex: -api-acl-public pub,docs,-intdocs" },
        { name: "anonymous", type: "list", array: 1, sort: 1, descr: "Match all regexps from the specified acls to allow access with or without authentication, ex: -api-acl-anonymous pub,docs" },
        { name: "authenticated", type: "list", array: 1, sort: 1, descr: "Match all regexps from the specified acls to allow access only with authentication any role, ex: -api-acl-authenticated stats,profile" },
        { name: "reset", type: "callback", callback: function(v) { if (v) this.reset() }, descr: "Reset all rules" },
    ],

    allow: {},
    deny: {},
    acl: {},

    errDeny: "Access denied",
};

/**
 * ACL for access permissions. Each ACL is a list of RegExps with a name.
 * ACLs are grouped by a role, at least one must match in order to succeed.
 *
 * The `public` ACL exists with default list of files and endpoints to allow access without authentication.
 */

module.exports = mod;

const _public = [
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

mod.reset = function()
{
    this.acl = {
        public: lib.toRegexpObj(null, _public)
    };
    this.allow = {};
    this.deny = {};
    this.public = ["public"];
    this.authenticated = this.anonymous = null;
}
mod.reset();

// Check the path agains given ACL list, if an ACL starts with `-` it means negative match, the check fails immediately
mod.isMatched = function(path, acls)
{
    if (!path || !Array.isArray(acls)) return;

    for (const acl of acls) {
        if (typeof acl != "string") continue;
        if (lib.testRegexpObj(path, mod.acl[acl[0] == "-" ? acl.substr(1) : acl])) {
            return acl[0] != "-";
        }
    }
}

/**
 * For the current user check allowed ACLs
 * return true if matched
 */
mod.isAllowed = function(req)
{
    for (const i in req.user?.roles) {
        var p = req.user.roles[i];
        if (this.isMatched(req.options.path, this.allow[p])) {
            logger.debug("isAllowed:", this.name, 403, req.options, p, this.allow[p]);
            return true;
        }
    }
    logger.debug("isAllowed:", this.name, 403, req.options, "nomatch", req.user?.roles);
}

/**
 * For the current user check not-allowed ACLs
 * return true if matched
 */
mod.isDenied = function(req)
{
    for (const i in req.user?.roles) {
        var p = req.user.roles[i];
        if (this.isMatched(req.options.path, this.deny[p])) {
            logger.debug("isDenied:", this.name, 403, req.options, p, this.deny[p]);
            return true;
        }
    }
}

// Returns true if the current request is allowed for public access
mod.isPublic = function(req, callback)
{
    if (this.isMatched(req.options.path, this.public)) return true;

    logger.debug("isPublic:", this.name, 403, req.options, this.public);
}

// Returns true if the current request is must be authenticated
mod.isAuthenticated = function(req)
{
    if (req.user?.id && this.isMatched(req.options.path, this.authenticated)) return true;

    logger.debug("isAuthenticated:", this.name, 403, req.options, this.authenticated);
}

// Returns true if the current request is allowed for public or authenticated access
mod.isAnonymous = function(req)
{
    if (this.isMatched(req.options.path, this.anonymous)) return true;

    logger.debug("isAnonymous:", this.name, 403, req.options, this.anonymous);
}

