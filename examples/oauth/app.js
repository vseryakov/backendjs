//
// Backend app
// Created by vlad on Fri Dec 26 13:32:29 EST 2014
//

var bkjs = require('backendjs');
var db = bkjs.db;
var api = bkjs.api;
var auth = bkjs.auth;
var app = bkjs.app;
var core = bkjs.core;
var lib = bkjs.lib;
var logger = bkjs.logger;
var googleStrategy = require('passport-google-oauth').OAuth2Strategy;
var githubStrategy = require('passport-github').Strategy;
var facebookStrategy = require('passport-facebook').Strategy;
var linkedinStrategy = require('passport-linkedin-oauth2').Strategy;
var twitterStrategy = require('passport-twitter').Strategy;

// Initialize oauth objects
app.google = { scope: "https://www.googleapis.com/auth/userinfo.email" }
app.github = { scope: "user" }
app.facebook = { scope: "email" }
app.linkedin = { state: true, scpe: "r_emailaddress,r_basicprofile" };
app.twitter = { _version: 1 }

core.describeArgs('app',
     [ { name: "google-client-id", obj: 'google', ucase: /Id$/, descr: "OAuth2 client id" },
       { name: "google-client-secret", obj: 'google', descr: "OAuth2 client secret secret" },
       { name: "google-callback-url", obj: 'google', ucase: /Url$/, descr: "OAuth2 client calback url" },
       { name: "google-scope", type: "list", obj: 'google', descr: "OAuth2 client oauth scope" },
       { name: "linkedin-client-id", obj: 'linkedin', ucase: /Id$/, descr: "OAuth2 client id" },
       { name: "linkedin-client-secret", obj: 'linkedin', descr: "OAuth2 client secret secret" },
       { name: "linkedin-callback-url", obj: 'linkedin', ucase: /Url$/, descr: "OAuth2 client calback url" },
       { name: "linkedin-scope", type: "list", obj: 'linkedin', descr: "OAuth2 client oauth scope" },
       { name: "linkedin-state", obj: "linkedin", type: "bool", descr: "Handle state property automatically" },
       { name: "github-client-id", obj: 'github', ucase: /Id$/, descr: "OAuth2 client id" },
       { name: "github-client-secret", obj: 'github', descr: "OAuth2 client secret secret" },
       { name: "github-callback-url", obj: 'github', ucase: /Url$/, descr: "OAuth2 client calback url" },
       { name: "github-scope", type: "list", obj: 'github', descr: "OAuth2 client oauth scope" },
       { name: "twitter-consumer-key", obj: 'twitter', descr: "OAuth1 consumer key" },
       { name: "twitter-consumer-client-secret", obj: 'twitter', descr: "OAuth1 consumer secret" },
       { name: "twitter-callback-url", obj: 'twitter', ucase: /Url$/, descr: "OAuth1 consumer calback url" },
       { name: "facebook-client-id", obj: 'facebook', ucase: /Id$/, descr: "OAuth2 client id" },
       { name: "facebook-client-secret", obj: 'facebook', descr: "OAuth2 client secret secret" },
       { name: "facebook-callback-url", obj: 'facebook', ucase: /Url$/, descr: "OAuth2 client calback url" },
       { name: "facebook-scope", type: "list", obj: 'facebook', descr: "OAuth2 client oauth scope" },
       { name: "facebook-profile-fields", type: "list", obj: 'facebook', descr: "List of profile fields to return" },
       { name: "facebook-display", obj: 'facebook', descr: "Mode of the content to render in dialogs" },
       { name: "facebook-enable-proof", obj: "facebook", type: "bool", descr: "Sign with client secret all API requests" },
      ]);

db.describeTables({
        bk_user: {
            google_access_token: {},
            google_refresh_token: {},
            github_access_token: {},
            github_refresh_token: {},
            facebook_access_token: {},
            facebook_refresh_token: {},
            linkedin_access_token: {},
            linkedin_refresh_token: {},
            twitter_access_token: {},
            twitter_refresh_token: {},
        },
});

// Given a profile data from some other system, check if there is an account or create a new account for the given
// profile, returns account record in the callback. req.query contains profile fields converted to bk_user names
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
app.fetchAccount = function(query, options, callback)
{
    db.get(auth.table, { login: query.login }, function(err, row) {
        if (err || row) return callback(err, row);

        // We must be an admin to create full record, make a copy so we will not expose admin
        // privileges to other calls that may use the same options
        options = lib.objMerge(options, "admin", 1);
        // Save new access tokens in the account record
        query[query._profile.provider + "_access_token"] = query._accessToken;
        query[query._profile.provider + "_refresh_token"] = query._refreshToken;
        auth.add(query, callback);
    });
}

// Given passport strategy setup OAuth callbacks and handle the login process by creating a mapping account for each
// OAUTH authenticated account.
// The callback if specified will be called as function(req, options, info) with `req.user` signifies the successful
// login and hold the account properties. If given it is up to the callback to perform any redirects reqauired for
// completion of the login process.
//
// Note: to use this the "passport" package must be installed, it will be loaded on the first call
//
// The following options properties are accepted:
//  - cliendID,
//  - clientSecret,
//  - callbackURL - passport OAUTH properties
//  - session - setup cookie session on success
//  - successUrl - redirect url on success if no callback is specified
//  - failureUrl - redirect url on failure if no callback is specified
//  - fetchAccount - a new function to be used instead of api.fetchAccount for new account creation or mapping
//     for the given authenticated profile. This is for processing or customizing new account properties and doing
//     some post processing work after the account has been created.
//     For any function, `query._profile`, `query._accessToken`, `query._refreshToken` will be set for the authenticated profile object from the provider.
app.registerOAuthStrategy = function(strategy, options, callback)
{
    if (!options || !options.clientID || !options.clientSecret) return;

    var passport = require("passport");
    // Initialize passport on first call
    if (!this._passport) {
        this._passport = 1;
        // Keep only user id in the passport session
        passport.serializeUser(function(user, done) {
            done(null, user.id);
        });
        passport.deserializeUser(function(user, done) {
            done(null, user);
        });
        this.app.use(passport.initialize());
    }

    strategy = new strategy(options, function(accessToken, refreshToken, profile, done) {
        var query = {};
        query.login = profile.provider + ":" + profile.id;
        query.secret = lib.uuid();
        query.name = profile.displayName;
        query.gender = profile.gender;
        query.email = profile.email;
        if (!query.email && profile.emails && profile.emails.length) query.email = profile.emails[0].value;
        // Deal with broken or not complete implementations
        if (profile.photos && profile.photos.length) query.icon = profile.photos[0].value || profile.photos[0];
        if (!query.icon && profile._json && profile._json.picture) query.icon = profile._json.picture;
        query._accessToken = accessToken;
        query._refreshToken = refreshToken;
        query._profile = profile;
        // Login or create new account for the profile
        app.fetchAccount(query, options, function(err, user) {
            logger[err ? "error" : "debug"]('registerOAuthStrategy: user:', strategy.name, err || "", user, profile)
            done(err, user);
        });
    });
    // Accessing internal properties is not good but this will save us an extra name to be passed arround
    if (!strategy._callbackURL) strategy._callbackURL = 'http://localhost:' + core.port + '/oauth/callback/' + strategy.name;
    passport.use(strategy);

    this.app.get('/oauth/' + strategy.name, passport.authenticate(strategy.name, options));
    this.app.get('/oauth/callback/' + strategy.name, function(req, res, next) {
        passport.authenticate(strategy.name, function(err, user, info) {
            logger.debug("registerOAuthStrategy: authenticate:", err, user, info)
            if (err) return next(err);
            if (!user) {
                if (options.failureRedirect) return res.redirect(options.failureRedirect);
                if (typeof callback == "function") return callback(req, options, info);
                next();
            }
            req.logIn(user, function(err) {
                if (err) return next(err);
                if (user.id) req.account = user;
                req.options.session = options.session;
                api.handleSessionSignature(req, () => {
                    if (options.successRedirect) return res.redirect(options.successRedirect);
                    if (typeof callback == "function") return callback(req, options, info);
                    next();
                });
            });
        })(req, res, next);
    });
    logger.debug("registerOAuthStrategy:", strategy.name, options.clientID, strategy._callbackURL);
}

app.configureMiddleware = function(options, callback)
{
    api.registerOAuthStrategy(githubStrategy, app.github);
    api.registerOAuthStrategy(googleStrategy, app.google);
    api.registerOAuthStrategy(facebookStrategy, app.facebook);
    api.registerOAuthStrategy(linkedinStrategy, app.linkedin);
    api.registerOAuthStrategy(twitterStrategy, app.twitter);

    callback()
};

app.configureWeb = function(options, callback)
{
    callback();
}

bkjs.server.start();
