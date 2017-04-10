//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var path = require('path');
var util = require('util');
var fs = require('fs');
var http = require('http');
var url = require('url');
var core = require(__dirname + '/core');
var lib = require(__dirname + '/lib');
var db = require(__dirname + '/db');
var api = require(__dirname + '/api');
var logger = require(__dirname + '/logger');

// Perform authorization of the incoming request for access and permissions
api.handleSignature = function(req, res, next)
{
    this.checkAccess(req, function afterAccess(status) {
        // Status is given, return an error or proceed to the next module
        if (status && status.status) {
            if (status.status == 200) return next();
            if (status.status) api.sendReply(res, status);
            return;
        }

        // Verify account signature
        api.checkRequestSignature(req, function afterSig(status) {
            // Determine what to do with the request even if the status is not success, a hook may deal with it differently,
            // the most obvious case is for a Web app to perform redirection on authentication failure
            api.checkAuthorization(req, status, function afterAuth(status) {
                if (status && status.status != 200) return api.sendReply(res, status);
                next();
            });
        });
    });
}

// Setup session cookies or access token for automatic authentication without signing, req must be complete with all required
// properties after successful authorization.
api.handleSessionSignature = function(req, options)
{
    logger.debug("handleSessionSignature:", options);

    if (typeof options.accesstoken != "undefined") {
        if (options.accesstoken && req.account && req.account.login && req.account.secret && req.headers) {
            var sig = this.createSignature(req.account.login, req.account.secret + ":" + (req.account.token_secret || ""), "", req.headers.host, "", { version: 3, expires: options.sessionAge || this.accessTokenAge });
            req.account[this.accessTokenName] = lib.encrypt(this.accessTokenSecret, sig[this.signatureHeaderName], "", "hex");
            req.account[this.accessTokenName + '-age'] = options.sessionAge || this.accessTokenAge;
        } else {
            delete req.account[this.accessTokenName];
            delete req.account[this.accessTokenName + '-age'];
        }
    }
    if (typeof options.session != "undefined" && req.session) {
        if (options.session && req.account && req.account.login && req.account.secret && req.headers) {
            var sig = this.createSignature(req.account.login, req.account.secret, "", req.headers.host, "", { version: 2, expires: options.sessionAge || this.sessionAge });
            req.session[this.signatureHeaderName] = sig[this.signatureHeaderName];
        } else {
            delete req.session[this.signatureHeaderName];
        }
    }
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
    return rc;
}

// Parse incoming request for signature and return all pieces wrapped in an object, this object will be used by `verifySignature` function.
//
// If the signature successfully recognized it is saved in the request as `req.signature`
api.parseSignature = function(req)
{
    if (req.signature) return req.signature;
    var rc = this.newSignature(req);
    rc.signature = req.query[this.signatureHeaderName] || req.headers[this.signatureHeaderName] || "";
    if (!rc.signature) {
        rc.signature = req.query[this.accessTokenName] || req.headers[this.accessTokenName];
        if (rc.signature) {
            rc.signature = lib.decrypt(this.accessTokenSecret, rc.signature, "", "hex");
            rc.source = "t";
        }
    }
    if (!rc.signature) {
        rc.signature = req.session ? req.session[this.signatureHeaderName] : "";
        if (rc.signature) rc.source = "s";
    }
    if (!rc.signature) return rc;
    var d = String(rc.signature).match(/([^\|]+)\|([^\|]*)\|([^\|]+)\|([^\|]+)\|([^\|]+)\|([^\|]*)\|([^\|]*)/);
    if (!d) return rc;
    rc.version = lib.toNumber(d[1]);
    if (d[2]) rc.tag = d[2];
    if (d[3]) rc.login = d[3].trim();
    if (d[4]) rc.signature = d[4];
    rc.expires = lib.toNumber(d[5]);
    rc.checksum = d[6] || "";
    req.signature = rc;
    return rc;
}

// Returns true if the signature `sig` matches given account secret or password. `account` object must be a `bk_auth` record.
api.verifySignature = function(sig, account)
{
    // Verify the signature
    var secret = account.secret;
    var query = (sig.query).split("&").sort().filter(function(x) { return x != "" && x.indexOf(api.signatureHeaderName) != 0 }).join("&");
    switch (sig.version) {
    case 1:
        sig.str = "";
        sig.str = sig.method + "\n" + sig.host + "\n" + sig.path + "\n" + query + "\n" + sig.expires + "\n" + sig.type + "\n" + sig.checksum + "\n";
        sig.hash = lib.sign(secret, sig.str, "sha1");
        break;

    case 3:
        secret += ":" + (account.token_secret || "");
    case 2:
        sig.str = sig.version + "\n" + (sig.tag || "") + "\n" + sig.login + "\n" + "*" + "\n" + lib.domainName(sig.host) + "\n" + "/" + "\n" + "*" + "\n" + sig.expires + "\n*\n*\n";
        sig.hash = lib.sign(secret, sig.str, "sha256");
        break;

    case 4:
        if (account.auth_secret) secret += ":" + account.auth_secret;
        sig.str = sig.version + "\n" + (sig.tag || "") + "\n" + sig.login + "\n" + sig.method + "\n" + sig.host + "\n" + sig.path + "\n" + query + "\n" + sig.expires + "\n" + sig.type + "\n" + sig.checksum + "\n";
        sig.hash = lib.sign(secret, sig.str, "sha256");
        break;

    case 5:
        sig.hash = lib.sign(account.salt, sig.signature, "sha256");
        sig.signature = account.password;
        break;

    default:
        sig.hash = NaN;
    }
    if (sig.signature != sig.hash) {
        logger.debug('verifySignature:', 'failed', sig, lib.objDescr(account, { ignore: /secret/ }));
        return false;
    }
    return true;
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
    var now = Date.now();
    var expires = options.expires || 0;
    if (!expires) expires = now + 30000;
    if (expires < now) expires += now;
    var ver = options.version || 4;
    var tag = String(options.tag || "");
    var ctype = String(options.type || "").toLowerCase();
    var checksum = String(options.checksum || "");
    var hostname = String(host || "").split(":").shift().toLowerCase();
    var q = String(uri || "/").split("?");
    var path = q[0];
    var query = options.query || q[1] || "";
    if (typeof query == "object") query = url.format({ query: options.query });
    query = query.split("&").sort().filter(function(x) { return x != ""; }).join("&");
    var rc = {}, str, hmac;
    switch (ver) {
    case 1:
        str = String(method) + "\n" + hostname + "\n" + path + "\n" + query + "\n" + String(expires) + "\n" + ctype + "\n" + checksum + "\n";
        hmac = lib.sign(String(secret), str, "sha1")
        break;

    case 2:
    case 3:
        path = "/";
        method = query = "*";
        rc['bk-domain'] = hostname = lib.domainName(hostname);
        rc['bk-max-age'] = Math.floor((expires - now)/1000);
        rc['bk-expires'] = expires;
        rc['bk-path'] = path;
        str = ver + '\n' + tag + '\n' + String(login) + "\n" + String(method) + "\n" + hostname + "\n" + path + "\n" + query + "\n" + String(expires) + "\n*\n*\n";
        hmac = lib.sign(String(secret), str, "sha256")
        break;

    case 5:
        hmac = secret;
        break;

    case 4:
    default:
        str = ver + '\n' + tag + '\n' + String(login) + "\n" + String(method) + "\n" + hostname + "\n" + path + "\n" + query + "\n" + String(expires) + "\n" + ctype + "\n" + checksum + "\n";
        hmac = lib.sign(String(secret), str, "sha256")
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
    var sig = this.parseSignature(req);
    if (logger.level >= logger.DEBUG) logger.debug('checkRequestSignature:', lib.objDescr(sig), 'hdrs:', req.headers, 'session:', lib.stringify(req.session));

    // Sanity checks, required headers must be present and not empty
    if (!sig.method || !sig.host) {
        return callback({ status: 415, message: "Invalid request" });
    }

    // Bad or empty signature result in empty login
    if (!sig.login) {
        return callback({ status: 417, message: "No login provided" });
    }

    // Make sure the request is not expired, it must be in milliseconds
    if (sig.expires < now - this.signatureAge) {
        var msg = req.__("Expired request, check your clock, the server time is %s, your clock is %s",
                         lib.strftime(now, "%m/%d/%Y %H:%M:%S GMT", { utc: 1 }) +
                         lib.strftime(sig.expires, "%m/%d/%Y %H:%M:%S GMT", { utc: 1 }));
        return callback({ status: 406, message: msg });
    }

    // Check the signature version consistency, do not accept wrong signatures in the unexpected places
    switch (sig.version) {
    case 2:
        if (sig.source != "s") return callback({ status: 416, message: "Invalid request" });
        break;
    case 3:
        if (sig.source != "t") return callback({ status: 416, message: "Invalid request" });
        break;
    default:
        if (sig.source == "t" || sig.source == "s") return callback({ status: 416, message: "Invalid request" });
    }

    // Verify if the access key is valid, they all are cached so a bad cache may result in rejects
    db.get("bk_auth", { login: sig.login }, function(err, account, info) {
        if (err) return callback({ status: 500, message: String(err) });
        if (!account) return callback({ status: 404, message: "No account record found" });

        api.checkAccountSignature(req, sig, account, function(err) {
            // Maintain last access time in the cache
            if (api.accessTimeInterval && info.cached && now - (account.atime || 0) > api.accessTimeInterval) {
                account.atime = now;
                db.putCache("bk_auth", account);
            }
            callback(err);
        });
    });
}

// Check account record against a incoming request signature
api.checkAccountSignature = function(req, sig, account, callback)
{
    // Account expiration time
    if (account.expires && account.expires < now) {
        return callback({ status: 412, message: "This account has expired" });
    }

    // Verify ACL regex if specified, test the whole query string as it appears in the request query line
    if (account.acl_deny && sig.url.match(account.acl_deny)) {
        return callback({ status: 403, message: "Access denied" });
    }
    if (account.acl_allow && !sig.url.match(account.acl_allow)) {
        logger.debug("checkAccountSignature:", account.id, account.name, sig.url, account.acl_allow);
        return callback({ status: 403, message: "Not permitted" });
    }

    // Deal with encrypted body, use our account secret to decrypt, this is for raw data requests
    // if it is JSON or query it needs to be reparsed in the application
    if (req.body && req.get("content-encoding") == "encrypted") {
        req.body = lib.decrypt(account.secret, req.body);
    }

    // Now we can proceed with signature verification, all other conditions are met
    var rc = this.verifySignature(sig, account);
    // We do not need the raw query string anymore, it can be quite big and it is already in req.query
    delete sig.query;

    if (!rc) return callback({ status: 401, message: "Not authenticated" });

    // Cleanup not allowed parameters
    if (account.query_deny) {
        var rx = new RegExp(account.opts_deny, "i");
        for (var p in req.query) {
            if (rx.test(p)) delete req.query[p];
        }
        if (req.query != req.body) {
            for (var p in req.body) {
                if (rx.test(p)) delete req.body[p];
            }
        }
    }

    // Save account and signature in the request, it will be used later
    req.signature = sig;
    this.setCurrentAccount(req, account);
    callback({ status: 200, message: "Ok" });
}

// Assign or clear the current account record for the given request, if account is null the account is cleared
api.setCurrentAccount = function(req, account)
{
    if (!req) return;
    if (!req.account) req.account = {};
    if (!req.options) req.options = {};
    if (account === null) {
        req.account = {};
        req.options.account = {};
    } else
    if (account && account.id) {
        for (var p in account) req.account[p] = account[p];
        req.options.account = lib.objNew("id", account.id, "login", account.login, "name", account.name, "type", account.type);
    }
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
    if (this.denyIp.rx && this.denyIp.rx.test(req.options.ip)) return callback({ status: 403, message: "Access denied" });
    if (this.deny.rx && this.deny.rx.test(req.options.path)) return callback({ status: 403, message: "Access denied" });

    // Save the status and check the hooks, if no returns anything use it
    if (this.allowIp.rx && this.allowIp.rx.test(req.options.ip)) rc = { status: 200, message: "" };
    if (this.allow.rx && this.allow.rx.test(req.options.path)) rc = { status: 200, message: "" };
    if (this.ignoreAllow.rx && rc && rc.status == 200 && this.ignoreAllow.rx.test(req.options.path)) rc = null;

    // Call custom access handler for the endpoint
    var hooks = this.findHook('access', req.method, req.options.path);
    if (hooks.length) {
        lib.forEachSeries(hooks, function(hook, next) {
            logger.debug('checkAccess:', req.method, req.options.path, hook.path);
            hook.callback.call(api, req, next);
        }, function(status) {
            logger.debug("checkAccess:", req.method, req.options.path, status, rc);
            callback(status || rc);
        });
        return;
    }
    logger.debug("checkAccess:", req.method, req.options.path, rc);
    callback(rc);
}

// Perform authorization checks after the account been checked for valid signature, this is called even if the signature verification failed,
// in case of a custom authentication middlware this must be called at the end and use the status object returned in the callback to
// return an error or proceed with the request. In any case the result of this function is the final.
//
// - req is Express request object
// - status contains the signature verification status, an object with status: and message: properties, can not be null.
//    The status property is passed to each hook in the chain, the result status will be returned to the client.
// - callback is a function(status) to be called with the resulted status where status must be an object with status and message properties as well
api.checkAuthorization = function(req, status, callback)
{
    // Ignore no login error if allowed
    if (status && status.status == 417 && this.allowAnonymous.rx && this.allowAnonymous.rx.test(req.options.path)) status = null;
    // Status for hooks is never null
    if (!status) status = { status: 200, message: "ok" };

    // Disable access to endpoints if session exists, meaning Web app
    if (this.disableSession.rx) {
        if (req.signature.source == "s" && this.disableSession.rx.test(req.options.path)) {
            logger.debug("checkAuthorization:", "disableSession:", req.account.id, req.account.name, req.account.type, req.options.path, this.disableSession.rx);
            return this.checkAuthHooks(req, { status: 401, message: "Not authorized" }, callback);
        }
    }
    // Verify access by account type
    if (!this.checkAccountType(req.account, "admin")) {
        // Admin only
        if (this.allowAdmin.rx) {
            if (this.allowAdmin.rx.test(req.options.path)) {
                logger.debug("checkAuthorization:", "allowAdmin:", req.account.id, req.account.name, req.account.type, req.options.path, this.allowAdmin.rx);
                return this.checkAuthHooks(req, { status: 401, message: "Restricted access" }, callback);
            }
        }
        for (var p in this.denyAccount) {
            if (this.checkAccountType(req.account, p)) {
                if (this.denyAccount[p].rx && this.denyAccount[p].rx.test(req.options.path)) {
                    logger.debug("checkAuthorization:", "denyAccount:", req.account.id, req.account.name, req.account.type, req.options.path, this.denyAccount[p].rx);
                    return this.checkAuthHooks(req, { status: 401, message: "Access denied" }, callback);
                }
            }
        }
        // Authenticated only
        if (!this.allowAuthenticated.rx || !req.account.id || !this.allowAuthenticated.rx.test(req.options.path)) {
            // Must satisfy at least one account type
            var allow = 0, match = 0;
            for (var p in this.allowAccount) {
                if (this.allowAccount[p].rx && this.allowAccount[p].rx.test(req.options.path)) {
                    if (this.checkAccountType(req.account, p)) allow++;
                    match++;
                }
            }
            if (match && !allow) {
                logger.debug("checkAuthorization:", "allowAccount:", req.account.id, req.account.name, req.account.type, req.options.path, "rc:", match, allow);
                return this.checkAuthHooks(req, { status: 401, message: "Access is not allowed" }, callback);
            }
        }
    }
    this.checkAuthHooks(req, status, callback);
}

api.checkAuthHooks = function(req, status, callback)
{
    var hooks = this.findHook('auth', req.method, req.options.path);
    if (!hooks.length) return callback(status);

    lib.forEachSeries(hooks, function(hook, next) {
        logger.debug('checkAuthHooks:', req.method, req.options.path, hook.path, req.account.id, status);
        hook.callback.call(api, req, status, function(err) {
            if (err && typeof err.status == "number") status = err;
            next();
        });
    }, function() {
        callback(status);
    });
}

// Check login and cleatext password from a client
api.checkLogin = function(req, callback)
{
    // Make sure we will not crash on wrong object
    if (!req || !req.query) req = { query: {} };

    // Required values must be present and not empty
    if (!req.query.login || !req.query.password) {
        return callback({ status: 417, message: "No login provided" });
    }
    // Create a signature from the login data
    req.signature = this.newSignature(req);
    req.signature.version = 5;
    req.signature.expires = Date.now() + this.signatureAge + 1000;
    req.signature.login = req.query.login;
    req.signature.signature = req.query.password;
    req.query.login = req.query.password = "";
    this.checkRequestSignature(req, callback);
}
