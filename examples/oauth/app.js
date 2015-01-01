//
// Backend app
// Created by vlad on Fri Dec 26 13:32:29 EST 2014
//

var url = require('url');
var bkjs = require('backendjs');
var db = bkjs.db;
var api = bkjs.api;
var app = bkjs.app;
var core = bkjs.core;
var logger = bkjs.logger;
var passport = require('passport');
var googleStrategy = require('passport-google-oauth').OAuth2Strategy;
var githubStrategy = require('passport-github').Strategy;
var facebookStrategy = require('passport-facebook').Strategy;
var linkedinStrategy = require('passport-linkedin-oauth2').Strategy;
var twitterStrategy = require('passport-twitter').Strategy;

// Initialize oauth objects
app.google = {}
app.github = {}
app.facebook = {}
app.linkedin = { state: true };
app.twitter = { _version: 1 }

core.describeArgs('app',
     [ { name: "google-client-id", obj: 'google', ucase: "Id$", descr: "OAuth2 client id" },
       { name: "google-client-secret", obj: 'google', descr: "v client secret secret" },
       { name: "google-callback-url", obj: 'google', ucase: "Url$", descr: "OAuth2 client calback url" },
       { name: "google-scope", type: "list", obj: 'google', value: "https://www.googleapis.com/auth/userinfo.email", descr: "OAuth2 client oauth scope" },
       { name: "linkedin-client-id", obj: 'linkedin', ucase: "Id$", descr: "OAuth2 client id" },
       { name: "linkedin-client-secret", obj: 'linkedin', descr: "OAuth2 client secret secret" },
       { name: "linkedin-callback-url", obj: 'linkedin', ucase: "Url$", descr: "OAuth2 client calback url" },
       { name: "linkedin-scope", type: "list", obj: 'linkedin', value: "r_emailaddress,r_basicprofile", descr: "OAuth2 client oauth scope" },
       { name: "linkedin-state", obj: "linkedin", type: "bool", descr: "Handle state property automatically" },
       { name: "github-client-id", obj: 'github', ucase: "Id$", descr: "OAuth2 client id" },
       { name: "github-client-secret", obj: 'github', descr: "OAuth2 client secret secret" },
       { name: "github-callback-url", obj: 'github', ucase: "Url$", descr: "OAuth2 client calback url" },
       { name: "github-scope", type: "list", obj: 'github', value: "user", descr: "OAuth2 client oauth scope" },
       { name: "twitter-consumer-key", obj: 'twitter', descr: "OAuth1 consumer key" },
       { name: "twitter-consumer-client-secret", obj: 'twitter', descr: "OAuth1 consumer secret" },
       { name: "twitter-callback-url", obj: 'twitter', ucase: "Url$", descr: "OAuth1 consumer calback url" },
       { name: "facebook-client-id", obj: 'facebook', ucase: "Id$", descr: "OAuth2 client id" },
       { name: "facebook-client-secret", obj: 'facebook', descr: "OAuth2 client secret secret" },
       { name: "facebook-callback-url", obj: 'facebook', ucase: "Url$", descr: "OAuth2 client calback url" },
       { name: "facebook-scope", type: "list", obj: 'facebook', value: "email", descr: "OAuth2 client oauth scope" },
       { name: "facebook-profile-fields", type: "list", obj: 'facebook', descr: "List of profile fields to return" },
       { name: "facebook-display", obj: 'facebook', descr: "Mode of the content to render in dialogs" },
       { name: "facebook-enable-proof", obj: "facebook", type: "bool", descr: "Sign with client secret all API requests" },
      ]);

api.describeTables({
        bk_account: {
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

passport.serializeUser(function(user, done) {
    done(null, user.id);
});

passport.deserializeUser(function(user, done) {
    done(err, user);
});

app.oauthRegister = function(strategy, name)
{
    var self = this;
    var config = self[name];
    if (!config || !config.clientID) return;

    if (!config.callbackURL) config.callbackURL = 'http://localhost:' + core.port;
    config.callbackURL += '/oauth/callback/' + name;
    config.passReqToCallback = true;

    passport.use(new strategy(config,
             function(req, accessToken, refreshToken, profile, done) {
                 app.oauthLogin(config, accessToken, refreshToken, profile, function(err, user) {
                     if (err) logger.errro('oauth:', name, err);
                     done(err, user);
                 });
             }));

    api.app.get('/oauth/' + name, passport.authenticate(name, config));
    api.app.get('/oauth/callback/' + name, passport.authenticate(name, { failureRedirect: '/' }), function(req, res) {
        api.setAccountSession(req, { session: true });
        res.redirect('/');
    });
    logger.debug("oauthRegister:", name, config.clientID, config.callbackURL);
}

app.oauthLogin = function(config, accessToken, refreshToken, profile, callback)
{
    logger.debug("oauthLogin:", profile);

    req = { query: {} };
    req.query.login = profile.provider + ":" + profile.id;
    req.query.secret = core.uuid();
    req.query.name = profile.displayName;
    req.query.gender = profile.gender;
    if (profile.emails && profile.emails.length) req.query.email = profile.emails[0].value;
    // Deal with broken or not complete implementations
    if (profile.photos && profile.photos.length) req.query.icon = profile.photos[0].value || profile.photos[0];
    if (!req.query.icon && profile._json && profile._json.picture) req.query.icon = profile._json.picture;

    // Login or create new account for the profile
    api.fetchAccount(req, {}, function(err, row) {
        if (err) return callback(err);

        // Save new access tokens in the account record
        req = core.newObj('id', row.id, profile.provider + "_access_token", accessToken, profile.provider + "_refresh_token", refreshToken);
        db.update("bk_account", req, function(err) {
            callback(err, row);
        });
    });
}

app.configureMiddleware = function(options, callback)
{
    api.app.use(passport.initialize({ userProperty: 'account' }));
    callback();
}

app.configureWeb = function(options, callback)
{
    this.oauthRegister(googleStrategy, "google");
    this.oauthRegister(githubStrategy, "github");
    this.oauthRegister(facebookStrategy, "facebook");
    this.oauthRegister(linkedinStrategy, "linkedin");
    this.oauthRegister(twitterStrategy, "twitter");

    callback()
};

bkjs.server.start();
