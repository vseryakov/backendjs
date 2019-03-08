//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const lib = require(__dirname + '/lib');
const db = require(__dirname + '/db');
const api = require(__dirname + '/api');
const logger = require(__dirname + '/logger');

// Default API calls that endpoints for health check, authentication and public image access
api.configureDefaultAPI = function()
{
    // For health checks
    this.app.all("/ping", function(req, res) {
        api.sendJSON(req, null, {});
    });

    // Authentication check without accounts module
    this.app.all("/auth", function(req, res) {
        if (!req.account || !req.account.id) return api.sendReply(res, { status: 417, message: "No username provided", code: "NOLOGIN" });
        api.handleSessionSignature(req, () => {
            req.options.cleanup = api.authTable;
            api.sendJSON(req, null, req.account);
        });
    });

    // Login with just the secret without signature
    this.app.all("/login", function(req, res) {
        api.checkLogin(req, function(err) {
            if (err) return api.sendJSON(req, err);
            api.handleSessionSignature(req, () => {
                req.options.cleanup = api.authTable;
                api.sendJSON(req, err, req.account);
            });
        });
    });

    // Clear sessions and access tokens
    this.app.all("/logout", function(req, res) {
        api.clearSessionSignature(req);
        api.sendJSON(req);
    });

    // Return images by prefix, id and possibly type
    this.app.all(/^\/image\/([a-zA-Z0-9_\.\:-]+)\/([^\/ ]+)\/?([^\/ ]+)?$/, function(req, res) {
        var options = api.getOptions(req);
        options.prefix = req.params[0];
        options.type = req.params[2];
        var id = req.params[1];
        // Image extension at the end so it looks like an image path
        if (options.type) {
            const d = options.type.match(/^(.+)\.(png|jpg|jpeg|gif)$/);
            if (d) options.type = d[1], options.ext = d[2];
        } else {
            const d = id.match(/^(.+)\.(png|jpg|jpeg|gif)$/);
            if (d) id = d[1], options.ext = d[2];
        }
        api.sendIcon(req, id, options);
    });
}

// If specified in the options, prepare credentials to be stored in the db, if no error occured return null, otherwise an error object
//  - scramble is used to encrypt the secret with login as HMAC_SHA256 so the db never stores cleartext credentials
api.prepareAccountSecret = function(query, options)
{
    if (!query.secret) delete query.secret;

    if (query.login && query.secret) {
        if (options && options.scramble) {
            query.secret = lib.sign(query.secret, query.login, "sha256");
        }
    }
    // Ignore the supplied value, always set with new uuid
    if (query.token_secret) {
        query.token_secret = lib.random();
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
    logger.debug("fetchAccount:", query);
    db.get(this.authTable, { login: query.login }, function(err, row) {
        if (err) return callback(err);
        if (row) return callback(err, row);
        // We must be an admin to create full record, make a copy so we will not expose admin
        // privileges to other calls that may use the same options
        api.addAccount(query, lib.objMerge(options, "admin", 1), callback);
    });
}

// Register new account, return new account record in the callback, when options.admin is true then allow to set all properties
// otherwise admin properties will not be updated
api.addAccount = function(query, options, callback)
{
    // Verify required fields
    if (!query.login) return lib.tryCall(callback, { status: 400, message: "The username is required" });
    if (!query.secret) return lib.tryCall(callback, { status: 400, message: "The password is required" });
    if (!query.name) return lib.tryCall(callback, { status: 400, message: "The name is required" });
    // Must be autogenerated according to the columns definition
    delete query.id;
    query.token_secret = true;
    this.prepareAccountSecret(query, options);
    if (!options.admin) this.clearQuery(this.authTable, query, "admin");
    options.info_obj = 1;
    db.add(this.authTable, query, options, function(err, row, info) {
        if (err) return callback(err);
        api.metrics.Counter('auth_add_0').inc();
        query._added = true;
        query.id = info.obj.id;
        db.runProcessRows("post", api.authTable, { op: "get", table: api.authTable, obj: query, options: options }, query);
        lib.tryCall(callback, err, query);
    });
}

// Update existing account, if `options.admin` is true then allow to update all properties
api.updateAccount = function(query, options, callback)
{
    // Cannot have account name empty or null
    if (!query.name) delete query.name;
    this.prepareAccountSecret(query, options);
    if (!options.admin) this.clearQuery(this.authTable, query, "admin");
    db.update(this.authTable, query, options, function(err, data, info) {
        if (!err) query._updated = true;
        lib.tryCall(callback, err, data, info);
    });
}

// Change account secret
api.setAccountSecret = function(query, options, callback)
{
    if (!query.secret && !query.token_secret) return lib.tryCall(callback);
    this.prepareAccountSecret(query, options);
    db.update(this.authTable, query, options, function(err, data, info) {
       if (!err) query._updated = true;
       lib.tryCall(callback, err, data, info);
    });
}

