//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var path = require('path');
var util = require('util');
var fs = require('fs');
var http = require('http');
var url = require('url');
var core = require(__dirname + '/../core');
var corelib = require(__dirname + '/../corelib');
var db = require(__dirname + '/../db');
var msg = require(__dirname + '/../msg');
var api = require(__dirname + '/../api');
var logger = require(__dirname + '/../logger');
var utils = require(__dirname + '/../build/Release/backend');

// If specified in the options, prepare credentials to be stored in the db, returns null if no error or an error object
//  - scramble can be used to sign the secret with login so the db never stores cleartext credentials
api.prepareAccountSecret = function(query, options)
{
    if (!query.secret) delete query.secret;

    if (options.scramble && query.login && query.secret) {
        query.secret = corelib.sign(query.login, query.secret, "sha256");
    }
    // Ignore the supplied value, always set with new uuid
    if (query.token_secret) {
        query.token_secret = corelib.uuid();
    }
    return null;
}

// Verifies the given account secret against the password policy, return an error messsage if any of the checks fails or null if the secret is valid
api.checkAccountSecret = function(query, options)
{
    var secret = query.secret || "";
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

    db.get("bk_auth", { login: query.login }, function(err, row) {
        if (err) return callback(err);
        if (row) return callback(err, row);
        // We must be an admin to create full record, make a copy so we will not expose admin
        // privileges to other calls that may use the same options
        self.addAccount(req.query, corelib.mergeObj(options, "admin", 1), callback);
    });
}

// Register new account, return new account record in the callback, when options.admin is true then allow to set all properties
// otherwise admin properties will not be updated
api.addAccount = function(query, options, callback)
{
    var self = this;

    // Verify required fields
    if (!query.secret) return callback({ status: 400, message: "secret is required"});
    if (!query.login) return callback({ status: 400, message: "login is required"});
    if (!query.alias) return callback({ status: 400, message: "alias is required"});
    query.mtime = req.query.ctime = Date.now();
    query.id = corelib.uuid();
    query.token_secret = true;
    this.prepareAccountSecret(req.query, options);
    if (!options.admin) this.clearQuery(query, options, "bk_auth", "admin");
    // Set all default values because we return in-memory record, not from the database
    query = db.prepareRow(null, "add", "bk_auth", query, options);
    db.add("bk_auth", query, options, function(err) {
        if (err) return callback(err);
        self.metrics.Counter('auth_add_0').inc();
        db.runProcessRows("post", "get", "bk_auth", query, options);
        query._added = true;
        callback(err, query);
    });
}

// Update existing account, if `options.admin` is true then allow to update all properties
api.updateAccount = function(query, options, callback)
{
    // Cannot have account alias empty or null
    if (!query.alias) delete query.alias;
    this.prepareAccountSecret(query, options);
    if (!options.admin) api.clearQuery(query, options, "bk_auth", "admin");
    db.update("bk_auth", query, function(err, data, info) {
        if (!err) query._updated = true;
        callback(err, data, info);
    });
}

// Change account secret
api.setAccountSecret = function(query, options, callback)
{
    if (!query.secret && !query.token_secret) return callback({ status: 400, message: "secret or token_secret is required" });
    this.prepareAccountSecret(query, options);
    db.update("bk_auth", { login: query.login, secret: query.secret, token_secret: query.token_secret }, options, function(err, data, info) {
       if (!err) query._updated = true;
       callback(err, data, info);
    });
}

