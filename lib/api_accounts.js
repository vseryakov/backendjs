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
var msg = require(__dirname + '/msg');
var api = require(__dirname + '/api');
var logger = require(__dirname + '/logger');

// Default API calls that endpoints for health check, authentication and public image access
api.configureDefaultAPI = function()
{
    var self = this;

    // For health checks
    this.app.all("/ping", function(req, res) {
        self.sendJSON(req, null, {});
    });

    // Authentication check without accounts module
    this.app.all("/auth", function(req, res) {
        self.handleSessionSignature(req, self.getOptions(req));
        if (!req.account || !req.account.id) return self.sendReply(res, 417, "No login provided");
        self.sendJSON(req, null, req.account);
    });

    // Login with the cleartext password
    this.app.all("/login", function(req, res) {
        self.checkLogin(req, function(err) {
            self.handleSessionSignature(req, self.getOptions(req));
            self.sendJSON(req, err, req.account);
        });
    });

    // Clear sessions and access tokens
    this.app.all("/logout", function(req, res) {
        self.handleSessionSignature(req, { session: 0, accesstoken: 0 });
        if (!req.account || !req.account.id) return self.sendReply(res, 417, "No login provided");
        self.sendJSON(req, null, {});
    });

    // Return images by prefix, id and possibly type
    this.app.all(/^\/image\/([a-zA-Z0-9_\.\:-]+)\/([^\/ ]+)\/?([^\/ ]+)?$/, function(req, res) {
        var options = self.getOptions(req);
        options.prefix = req.params[0];
        options.type = req.params[2] || "";
        var d = options.type.match(/^(.+)\.(png|jpg)$/);
        // Image extension in the type so it looks like an image path
        if (d) options.type = d[1], options.ext = d[2];
        self.sendIcon(req, req.params[1], options);
    });
}

// If specified in the options, prepare credentials to be stored in the db, if no error occured return null, otherwise an error object
//  - scramble can be used to encrypt the secret with login as HMAC_SHA256 so the db never stores cleartext credentials, this is an alternative to the
//    cleartext password login when the password is hashed with SHA256 salt
api.prepareAccountSecret = function(query, options)
{
    if (!query.secret) delete query.secret;
    if (!query.password) delete query.password;

    if (query.login && query.secret) {
        if (options.scramble) {
            query.secret = lib.sign(query.secret, query.login, "sha256");
        }
    }
    // From a cleatext password produce a hash and random secret
    if (query.password) {
        query.salt = lib.random();
        query.secret = lib.random();
        query.password = lib.sign(query.salt, query.password, "sha256");
    }
    // Ignore the supplied value, always set with new uuid
    if (query.token_secret) {
        query.token_secret = lib.random();
    }
    return null;
}

// Verifies the given account secret against the password policy, return an error messsage if any of the checks fails or null if the secret is valid
api.checkAccountSecret = function(query, options)
{
    var secret = query.password || query.secret || "";
    for (var i = 0; i < this.secretPolicy.length; i++) {
        if (!this.secretPolicy[i].rx.test(secret)) {
            return { status: 400, message: this.secretPolicy[i].value, policy: this.secretPolicy.map(function(x) { return x.value }).join(", ") };
        }
    }
    return null;
}

// Given a profile data from some other system, check if there is an account or create a new account for the given
// profile, returns account record in the callback. req.query contains profile fields converted to bk_auth names
// so the whole req.query can be saved as it is. `query.login` must exist.
//
// This method is supposed to be called after the user is authenticated and verified, it does not
// check secrets but only existence of a user by login. On success existing or new account is returned by the callback.
//
// If new account is created, the generated secret will be returned and must be saved by the client for subsequent
// API calls unless cookie session is established.
//
// if `query.icon' is set with the url of the profile image, it will be downloaded and saved as account icon type `0`. `options.width`
// if specified will be used to resize the image.
//
// In case when a new account was created the account record will have a property `_added` set to true.
// This is to explicitely distinguish existing and new accounts.
//
api.fetchAccount = function(query, options, callback)
{
    var self = this;

    logger.debug("fetchAccount:", query);
    db.get("bk_auth", { login: query.login }, function(err, row) {
        if (err) return callback(err);
        if (row) return callback(err, row);
        // We must be an admin to create full record, make a copy so we will not expose admin
        // privileges to other calls that may use the same options
        self.addAccount(req.query, lib.objMerge(options, "admin", 1), callback);
    });
}

// Register new account, return new account record in the callback, when options.admin is true then allow to set all properties
// otherwise admin properties will not be updated
api.addAccount = function(query, options, callback)
{
    var self = this;

    // Verify required fields
    if (!query.login) return callback({ status: 400, message: "login is required"});
    if (!query.name) return callback({ status: 400, message: "name is required"});
    if (!query.secret && !query.password) return callback({ status: 400, message: "secret is required"});
    // Must be autogenerated according to the columns definition
    delete query.id;
    query.token_secret = true;
    this.prepareAccountSecret(query, options);
    if (!options.admin) this.clearQuery("bk_auth", query, "admin");
    options.info_obj = 1;
    db.add("bk_auth", query, options, function(err, row, info) {
        if (err) return callback(err);
        self.metrics.Counter('auth_add_0').inc();
        query._added = true;
        query.id = info.obj.id;
        db.runProcessRows("post", "bk_auth", { op: "get", table: "bk_auth", obj: query, options: options }, query);
        callback(err, query);
    });
}

// Update existing account, if `options.admin` is true then allow to update all properties
api.updateAccount = function(query, options, callback)
{
    // Cannot have account name empty or null
    if (!query.name) delete query.name;
    this.prepareAccountSecret(query, options);
    if (!options.admin) this.clearQuery("bk_auth", query, "admin");
    db.update("bk_auth", query, function(err, data, info) {
        if (!err) query._updated = true;
        callback(err, data, info);
    });
}

// Change account secret
api.setAccountSecret = function(query, options, callback)
{
    if (!query.secret && !query.password && !query.token_secret) return callback({ status: 400, message: "secret or token_secret is required" });
    this.prepareAccountSecret(query, options);
    db.update("bk_auth", query, options, function(err, data, info) {
       if (!err) query._updated = true;
       callback(err, data, info);
    });
}

