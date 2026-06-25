/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
'use strict';

/**
  * @module api/acl
  */

const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');

const mod =

/**
 * ACL for access authorization.
 *
 * Each ACL is a list of RegExps with a name.
 *
 * ACLs are grouped by a role, at least one must match in order to succeed.
 *
 * ### To define an ACL named **test** with endpoints and allow it for user but not intern roles:
 * ```
 * api-acl-add-test = /url1|/url2...
 *
 * api-acl-allow-user = test
 * api-acl-deny-intern = test
 * ```
 * The user and intern roles are defined in the {@link DbUser} table, see {@link module:api/users}
 *
 * @example <caption>public endpoints by convention to use * as fallback, used in {@link module:middleware/users}</caption>
 * api-acl-add-* = ^/
 * api-acl-add-* = ^/auth
 *
 * @example <caption>only admins can access /admin endpoint</caption>
 * api-acl-allow-admin = admins
 * api-acl-add-admins = ^/admin
 *
 * @Example <caption>users can access /users but not /users/billing</caption>
 * api-acl-allow-user = auth, users, -users_deny
 * api-acl-add-users = ^/user
 *
 * api-acl-add-users_deny = ^/user/billing
 *
 */

module.exports = {
    name: "api.acl",
    args: [
        { name: "add-([a-z0-9_*]+)", type: "regexpobj", obj: "acl", make: "$1", descr: "Add URLs to the named ACL which can be used in allow/deny rules per role", example: "api-acl-add-admins = ^/admin" },
        { name: "deny-([a-z0-9_]+)", type: "list", obj: "deny", array: 1, sort: 1, descr: "Match all regexps from the specified acls to deny access for the specified role", example: "api-acl-deny-user = admins,billing" },
        { name: "allow-([a-z0-9_]+)", type: "list", obj: "allow", array: 1, sort: 1, descr: "Match all regexps from the specified acls for allow access for the specified role", example: "api-acl-allow-staff = admins,support,-billing" },
        { name: "reset", type: "callback", callback(v) { if (v) this.reset() }, descr: "Reset all acls" },
    ],
};

/**
 * Reset all acls
 * @memberof module:api/acl
 * @method reset
 */
mod.reset = function()
{
    this.acl = this.allow = this.deny = null;
}


/**
 * Check the path agains given list of ACL names, if a name starts with `-` it means negative match,
 * the check fails immediately and returns null
 * @param {string} path
 * @param {string|string[]} acls
 * @returns {undefined|null|string} - matched positive acl
 * @memberof module:api/acl
 * @method isMatched
 * @example
 * api.acl.isMatched(context.path, "*");
 * api.acl.isMatched(context.path, ["user", "-intern"]);
 * api.acl.isMatched(context.path, "admin");
 */
mod.isMatched = function(path, acls)
{
    if (!path) return;
    if (typeof acls === "string") acls = [acls];
    if (!Array.isArray(acls)) return;

    for (const acl of acls) {
        if (typeof acl !== "string") continue;
        if (lib.testRegexpObj(path, this.acl?.[acl[0] === "-" ? acl.substr(1) : acl])) {
            return acl[0] === "-" ? null : acl;
        }
    }
}

/**
 * Check the path and roles against allowed ACLs
 * @param {string} path
 * @param {string[]} roles
 * @returns {undefined|string} - matched role
 * @memberof module:api/acl
 * @method isAllowed
 * @example
 * api.acl.isAllowed(context.path, ["admin", "billing"])
 */
mod.isAllowed = function(path, roles)
{
    if (!this.allow || !Array.isArray(roles)) return;
    for (const role of roles) {
        if (this.isMatched(path, this.allow?.[role])) {
            logger.debug("isAllowed:", this.name, path, roles, "match", role, this.allow[role]);
            return role;
        }
    }
}

/**
 * Check the path and roles against denied ACLs
 * @param {string} path
 * @param {string[]} roles
 * @returns {undefinded|string} - matched role
 * @memberof module:api/acl
 * @method isDenied
 * @example
 * api.acl.isDenied(context.path, ["admin", "billing"])
 */
mod.isDenied = function(path, roles)
{
    if (!this.deny || !Array.isArray(roles)) return;
    for (const role of roles) {
        if (this.isMatched(path, this.deny?.[role])) {
            logger.debug("isDenied:", this.name, path, roles, "match", role, this.deny[role]);
            return role;
        }
    }
}
