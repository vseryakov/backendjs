//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const url = require('url');
const lib = require(__dirname + '/../lib');
const api = require(__dirname + '/../api');
const account = require(__dirname + '/../account');
const logger = require(__dirname + '/../logger');

// Clear the session and all cookies
api.handleLogout = function(req)
{
    api.getSignature(req);
    api.clearSessionSignature(req);
    api.clearCsrfToken(req);
}

// Perform authorization of the incoming request for access and permissions
api.handleSignature = function(req, res, callback)
{
    const trace = req.trace.start("handleSignature");

    lib.everySeries([
        function(next) {
            api.checkAccess(req, (status) => {
                if (!status?.status) {
                    return next(status);
                }

                // Status is given, return an error or proceed to the next middleware
                if (status.status != 200) {
                    api.clearSessionSignature(req);
                    return api.sendReply(res, status);
                }

                var err = api.checkCsrfToken(req);
                if (err) return api.sendReply(res, err);

                trace.stop();
                callback();
            });
        },
        function(next) {
            // Verify account signature
            api.checkRequestSignature(req, (status) => {
                if (status?.status != 200) logger.debug('handleSignature:', status, req.signature, 'HDRS:', req.headers);

                // Run authentication hooks for alternative credentials, to proceed it must return the same status or 200
                var hooks = api.findHook('auth', req.method, req.options.path);
                lib.forEachSeries(hooks, (hook, next2) => {
                    logger.debug('checkAuthHooks:', req.method, req.options.path, req.account.id, hook.path, status);
                    hook.callback.call(api, req, status, (err) => {
                        if (err) {
                            if (err.status != 200) return api.sendReply(res, err);
                            status = err;
                        }
                        next2(err);
                    });
                }, () => {
                    next(status);
                }, true);
            });
        },
        function(next, status) {
            // Ignore no login error if allowed
            if (status?.status == 417 && api.checkAcl(api.allowAnonymous, api.allowAclAnonymous, req.options)) status = null;

            if (!status?.status || status?.status == 200) {
                var err = api.checkCsrfToken(req);
                if (err) return api.sendReply(res, err);
            }

            // Determine what to do with the request even if the status is not success, a hook may deal with it differently,
            // the most obvious case is for a Web app to perform redirection on authentication failure
            api.checkAuthorization(req, status, (status) => {
                if (status?.status != 200) {
                    return api.sendReply(res, status);
                }
                api.checkRouting(req, "authRouting");

                trace.stop();
                callback();
            });
        },
    ], null, true);
}

// Returns a new signature object with all required properties filled form the request object
api.newSignature = function(req)
{
    var rc = { version: 1, expires: 0, now: Date.now() };
    var url = (req.signatureUrl || req.url || "/").split("?");
    rc.path = url[0];
    rc.query = url[1] || "";
    rc.method = req.method || "";
    rc.host = (req.headers.host || "").split(':').shift().toLowerCase();
    rc.type = (req.headers['content-type'] || "").toLowerCase();
    for (var i = 1; i < arguments.length; i += 2) rc[arguments[i]] = arguments[i + 1];
    return rc;
}

// Parse incoming request for signature and return all pieces wrapped in an object, this object will be used by `verifySignature` function.
//
// If the signature successfully recognized it is saved in the request as `req.signature`,
// it always returns a signature object, a new one or existing
api.getSignature = function(req)
{
    if (req.signature) return req.signature;
    var sig = this.newSignature(req);
    var signature = req.query[this.signatureHeaderName] || req.headers[this.signatureHeaderName] || "";
    if (!signature) {
        signature = this.getSessionCookie(req, this.signatureHeaderName);
        if (signature) sig.source = "s";
    }
    delete req.query[this.signatureHeaderName];
    if (signature) {
        var d = signature.match(this.rxSignature);
        if (d) {
            sig.version = lib.toNumber(d[1]);
            if (d[2]) sig.tag = d[2].trim().substr(0, account.maxLength * 2);
            if (d[3]) sig.login = d[3].trim().substr(0, account.maxLength);
            if (d[4]) sig.signature = d[4];
            sig.expires = lib.toNumber(d[5]);
            sig.checksum = d[6] || "";
            req.signature = sig;
        }
    }
    return sig;
}

// Returns true if the signature `sig` matches given account secret. `account` object must be a `bk_user` record.
api.verifySignature = function(req, sig, account, callback)
{
    // Verify the signature
    var secret = account.secret;
    var query = (sig.query || "").split("&").sort().filter((x) => (x && x.indexOf(api.signatureHeaderName) != 0)).join("&");

    if (sig.version < 0) {
        account.checkSecret(account, sig.secret, (err) => {
            if (err) logger.debug("verifySignature:", 'failed', err, sig, account);
            callback(err ? null : sig);
        });
        return;
    }

    switch (sig.version) {
    case 2:
    case 3:
        sig.str = sig.version + "\n" + (sig.tag || "") + "\n" + sig.login + "\n*\n" + lib.domainName(sig.host) + "\n/\n*\n" + sig.expires + "\n*\n*\n";
        sig.hash = lib.sign(secret, sig.str, "sha256");
        break;

    case 4:
        sig.str = sig.version + "\n" + (sig.tag || "") + "\n" + sig.login + "\n" + sig.method + "\n" + sig.host + "\n" + sig.path + "\n" + query + "\n" + sig.expires + "\n" + sig.type + "\n" + sig.checksum + "\n";
        sig.hash = lib.sign(secret, sig.str, "sha256");
        break;

    default:
        sig.hash = NaN;
        var hooks = this.findHook('sig', sig.method, sig.path);
        if (hooks.length) {
            lib.forEachSeries(hooks, (hook, next) => {
                hook.callback.call(api, req, account, sig, next);
            }, (rc) => {
                if (!rc) logger.debug("verifySignature:", 'failed', sig, account);
                callback(rc);
            }, true);
            return;
        }
    }

    if (!lib.timingSafeEqual(sig.signature, sig.hash)) {
        logger.debug('verifySignature:', 'failed', sig, account);
        sig = null;
    }
    callback(sig);
}

// Create secure signature for an HTTP request. Returns an object with HTTP headers to be sent in the response.
//
// The options may contains the following:
//  - expires is absolute time in milliseconds when this request will expire, default is 30 seconds from now
//  - version a version number defining how the signature will be signed
//  - type - content-type header, may be omitted
//  - tag - a custom tag, vendor specific, opaque to the bkjs, can be used for passing additional account or session inforamtion
//  - checksum - SHA1 digest of the whole content body, may be omitted
//  - query - on object with query parameters to use instead of parameters in the uri
api.createSignature = function(login, secret, method, host, uri, options)
{
    if (!login || !secret) return {};
    if (!options) options = {};
    var ver = options.version || 4;
    // Internal use only
    if (ver < 0) return rc;
    var now = Date.now();
    var expires = lib.toNumber(options.expires, { dflt: 30000 }) + lib.randomInt(0, 1000);
    if (expires < now) expires += now;
    var tag = String(options.tag || "");
    var ctype = String(options.type || "").toLowerCase();
    var checksum = String(options.checksum || "");
    var hostname = String(host || "").split(":").shift().toLowerCase();
    var q = String(uri || "/").split("?");
    var path = q[0];
    var query = options.query || q[1] || "";
    if (typeof query == "object") query = url.format({ query: options.query });
    query = query.split("&").sort().filter((x) => (x)).join("&");
    var rc = {}, str, hmac;
    switch (ver) {
    case 2:
    case 3:
        path = "/";
        method = query = "*";
        rc['bk-domain'] = hostname = lib.domainName(hostname);
        rc['bk-max-age'] = Math.floor((expires - now)/1000);
        rc['bk-expires'] = expires;
        rc['bk-path'] = path;
        str = ver + '\n' + tag + '\n' + String(login) + "\n" + String(method) + "\n" + hostname + "\n" + path + "\n" + query + "\n" + String(expires) + "\n*\n*\n";
        hmac = lib.sign(secret, str, "sha256")
        break;

    case 4:
    default:
        str = ver + '\n' + tag + '\n' + String(login) + "\n" + String(method) + "\n" + hostname + "\n" + path + "\n" + query + "\n" + String(expires) + "\n" + ctype + "\n" + checksum + "\n";
        hmac = lib.sign(secret, str, "sha256")
    }
    rc[this.signatureHeaderName] = ver + '|' + tag + '|' + String(login) + '|' + hmac + '|' + expires + '|' + checksum + '|';
    logger.debug('createSignature:', rc);
    return rc;
}

// Verify request signature from the request object, uses properties: .host, .method, .url or .originalUrl, .headers
api.checkRequestSignature = function(req, callback)
{
    var now = Date.now();
    // Make sure we will not crash on wrong object
    if (!req || !req.headers) req = { headers: {} };

    // Extract all signature components from the request
    var sig = this.getSignature(req);

    // Sanity checks, required headers must be present and not empty
    if (!sig.method || !sig.host) {
        return callback({ status: 415, message: api.errInvalidRequest, code: "NOLOGIN" });
    }

    // Bad or empty signature result in empty login
    if (!sig.login) {
        return callback({ status: 417, message: api.errInvalidLogin, code: "NOLOGIN" });
    }

    // Make sure the request is not expired, it must be in milliseconds
    if (sig.expires && sig.expires < now - this.signatureAge) {
        var msg = req.__("Expired request, check your clock, the server time is %s, your clock is %s",
                         lib.strftime(now, "%m/%d/%Y %H:%M:%S GMT", { utc: 1 }),
                         lib.strftime(sig.expires, "%m/%d/%Y %H:%M:%S GMT", { utc: 1 }));
        return callback({ status: 406, message: msg, code: "EXPIRED" });
    }

    // Check the signature version consistency, do not accept wrong signatures in the unexpected places
    if ((sig.version == 2 && sig.source != "s") ||
        (sig.version == 3 && sig.source != "t") ||
        (sig.version == 4 && sig.source) ||
        (!sig.version && sig.source) ||
        (sig.version < 0 && sig.source != "l")) {
        return callback({ status: 416, message: api.errInvalidRequest, code: "NOLOGIN" });
    }

    lib.series([
        function(next) {
            api.checkSessionSignature(sig, (err, rc) => {
                if (rc < 0) return next({ status: 401, message: api.errInvalidSession, code: "INVALID" });

                // Pre-authenticated request (WS)
                if (req.account.login == sig.login && req.account.id) {
                    api.setCurrentAccount(req, req.account);
                    return next({ status: api.defaultAuthStatus, message: api.defaultAuthMessage });
                }
                next();
            });
        },
        function(next) {
            // Verify if the access key is valid, they all are cached so a bad cache may result in rejects
            account.get({ login: sig.login }, (err, account, info) => {
                if (err) return next({ status: 500, message: String(err) });
                if (!account) return next({ status: 401, message: api.errInvalidAccount, code: "NOLOGIN" });

                // Keep the found account for error post processing
                req.__account = account;

                // Account expiration time
                if (account.expires && account.expires < Date.now()) {
                    return next({ status: 412, message: api.errInvalidAccount, code: "EXPIRED" });
                }
                next();
            });
        },
        function(next) {
            // Now we can proceed with signature verification, all other conditions are met
            api.verifySignature(req, sig, req.__account, (sig) => {
                if (!sig) {
                    api.clearSessionSignature(req);
                    return next({ status: 401, message: api.errInvalidSecret, code: "NOLOGIN" });
                }
                // Save account and signature in the request, it will be used later
                req.signature = sig;
                api.saveSessionSignature(sig);
                api.setCurrentAccount(req, req.__account);
                next({ status: api.defaultAuthStatus, message: api.defaultAuthMessage });
            });
        },
    ], callback, true);
}

// Perform URL based access checks, this is called before the signature verification, very early in the request processing step.
//
// Checks access permissions, calls the callback with the following argument:
// - nothing if checkRequestSignature needs to be called
// - an object with status: 200 to skip authorization and proceed with other routes
// - an object with status: 0 means response has been sent, just stop
// - an object with status other than 0 or 200 to return the status and stop request processing,
//    for statuses 301,302 there should be url property in the object returned
api.checkAccess = function(req, callback)
{
    var rc = null;
    if (lib.testRegexpObj(req.options.ip, this.denyIp) ||
        (this.allowIp?.rx && !lib.testRegexpObj(req.options.ip, this.allowIp))) {
        return callback({ status: 403, message: this.errDenyIp, code: "DENY" });
    }
    if (this.checkAcl(this.deny, this.denyAcl, req.options)) {
        return callback({ status: 403, message: this.errDenyAcl, code: "DENY" });
    }

    // Save the status and check the hooks, if no returns anything use it
    if (this.checkAcl(this.allow, this.allowAcl, req.options)) rc = { status: 200, message: "" };
    if (rc && rc.status == 200 && this.checkAcl(this.ignoreAllow, this.ignoreAllowAcl, req.options)) rc = null;

    // Call custom access handler for the endpoint
    var hooks = this.findHook('access', req.method, req.options.path);
    if (hooks.length) {
        lib.forEachSeries(hooks, (hook, next) => {
            logger.debug('checkAccess:', req.method, req.options.path, hook.path);
            hook.callback.call(api, req, next);
        }, (status) => {
            logger.debug("checkAccess:", req.method, req.options.path, status, rc);
            callback(status || rc);
        }, true);
        return;
    }
    logger.debug("checkAccess:", req.method, req.options.path, rc);
    callback(rc);
}

// Perform authorization checks after the account been checked for valid signature, this is called even if the signature verification failed,
// in case of a custom authentication middlware this must be called at the end and use the status object returned in the callback to
// return an error or proceed with the request. In any case the result of this function is final.
//
// If a user has valid login by default access to all API endpoints is granted, to restrict access to specific APIs use any combinations of
// `api-allow` or `api-deny` config parameters.
//
// - req is Express request object
// - status contains the signature verification status, an object with status: and message: properties, can not be null.
//    The status property is passed to each hook in the chain, the result status will be returned to the client.
// - callback is a function(status) to be called with the resulted status where status must be an object with status and message properties as well
api.checkAuthorization = function(req, status, callback)
{
    logger.debug("checkAuthorization:", status, req.account.id, req.account.name, req.account.type, req.options.path);

    // Status for hooks is never null
    if (!status?.status) status = { status: this.defaultAuthStatus, message: this.defaultAuthMessage };

    // Verify access by account type
    if (!this.checkAccountType(req.account, account.adminRoles)) {
        // Admin only
        if (this.checkAcl(this.allowAdmin, this.alowAclAdmin, req.options)) {
            logger.debug("checkAuthorization:", "allowAdmin:", 401, req.account.id, req.account.name, req.account.type, req.options.path, this.allowAdmin.list, this.alowAclAdmin);
            return this.checkPreHooks(req, { status: 401, message: this.errAclAdmin, code: "ADMIN" }, callback);
        }
        var rc = this.checkAclDeny(req);
        if (rc) return this.checkPreHooks(req, rc, callback);

        // Authenticated only below
        if (req.account.id && this.checkAcl(this.allowAuthenticated, this.allowAclAuthenticated, req.options)) {
            logger.debug("checkAuthorization:", "allowAuthenticated:", 200, req.account.id, req.account.name, req.account.type, req.options.path, this.allowAuthenticated.list, this.allowAclAuthenticated);
            status = { status: 200, message: "ok" };
        } else {
            // Check for exclusive urls first
            rc = this.checkAclOnly(req);
            if (rc) return this.checkPreHooks(req, rc, callback);

            // Must satisfy at least one account type
            rc = api.checkAclAllow(req);

            // If the default is allow we only reject if matched but allowed
            if (this.defaultAuthStatus < 400 && rc.matched.length && !rc.allow) {
                logger.debug("checkAuthorization:", "allowAccount:", 401, req.account.id, req.account.name, req.account.type, req.options.path, this.defaultAuthStatus, rc);
                return this.checkPreHooks(req, { status: 401, message: this.errAclNoMatch, code: "ALLOW" }, callback);
            }
            // If the default is reject we need explicit allow
            if (this.defaultAuthStatus >= 400 && rc.allow) {
                logger.debug("checkAuthorization:", "allowAccount:", 200, req.account.id, req.account.name, req.account.type, req.options.path, this.defaultAuthStatus, rc);
                status = { status: 200, message: "ok" };
            } else {
                logger.debug("checkAuthorization:", "allowAccount:", this.defaultAuthStatus, req.account.id, req.account.name, req.account.type, req.options.path, this.defaultAuthStatus, rc);
            }
        }
    }
    this.checkPreHooks(req, status, callback);
}

