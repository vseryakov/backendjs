//
// Backend app
// Created by vlad on Fri Dec 26 13:32:29 EST 2014
//
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
     [ { name: "google-id", obj: 'google', descr: "OAuth2 client id" },
       { name: "google-secret", obj: 'google', descr: "v client secret secret" },
       { name: "google-callback", obj: 'google', descr: "OAuth2 client calback url" },
       { name: "google-scope", type: "list", obj: 'google', value: "https://www.googleapis.com/auth/userinfo.email", descr: "OAuth2 client oauth scope" },
       { name: "linkedin-id", obj: 'linkedin', descr: "OAuth2 client id" },
       { name: "linkedin-secret", obj: 'linkedin', descr: "OAuth2 client secret secret" },
       { name: "linkedin-callback", obj: 'linkedin', descr: "OAuth2 client calback url" },
       { name: "linkedin-scope", type: "list", obj: 'linkedin', value: "r_emailaddress,r_basicprofile", descr: "OAuth2 client oauth scope" },
       { name: "linkedin-state", obj: "linkedin", type: "bool", descr: "Handle state property automatically" },
       { name: "github-id", obj: 'github', descr: "OAuth2 client id" },
       { name: "github-secret", obj: 'github', descr: "OAuth2 client secret secret" },
       { name: "github-callback", obj: 'github', descr: "OAuth2 client calback url" },
       { name: "github-scope", type: "list", obj: 'github', value: "user", descr: "OAuth2 client oauth scope" },
       { name: "twitter-consumer-key", obj: 'twitter', descr: "OAuth1 consumer key" },
       { name: "twitter-consumer-secret", obj: 'twitter', descr: "OAuth1 consumer secret" },
       { name: "twitter-callback", obj: 'twitter', descr: "OAuth1 consumer calback url" },
       { name: "facebook-id", obj: 'facebook', descr: "OAuth2 client id" },
       { name: "facebook-secret", obj: 'facebook', descr: "OAuth2 client secret secret" },
       { name: "facebook-callback", obj: 'facebook', descr: "OAuth2 client calback url" },
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

app.register = function(strategy, name)
{
    var self = this;
    var config = self[name];
    if (!config || !config.id) return;

    passport.use(new strategy(config,
             function(accessToken, refreshToken, profile, done) {
                 app.login(config, accessToken, refreshToken, profile, function(err, user) {
                     done(err, user);
                 });
             }));

    api.app.get('/login/' + name, passport.authenticate(name, config));
    api.app.get('/login/callback/' + name, passport.authenticate(name, { failureRedirect: '/' }), function(req, res) {
        res.redirect('/');
    });
}

app.login = function(config, accessToken, refreshToken, profile, callback)
{
    logger.debug("login:", accessToken, profile);

    req = { query: {} };
    req.query.login = profile.provider + ":" + profile.id;
    req.query.secret = core.uuid();
    req.query.name = profile.displayName;
    req.query.gender = profile.gender;
    if (profile.emails && profile.emails.length) req.query.email = profile.emails[0].value;
    if (profile.photos && profile.photos.length) req.query.icon = profile.photos[0].value;

    // Login or create new account for the profile
    api.fetchAccount(req, {}, function(err, row) {
        if (err) return callback(err);

        // Save new access tokens in the account record
        req = core.newObj(id, row.id, profile.provider + "_access_token", accessToken, profile.provider + "_refresh_token", refreshToken);
        db.update("bk_account", req, function() {
            callback(err, row);
        });
    });
}

app.configureWeb = function(options, callback)
{
    app.register(googleStrategy, "google");
    app.register(githubStrategy, "github");
    app.register(facebookStrategy, "facebook");
    app.register(linkedinStrategy, "linkedin");
    app.register(twitterStrategy, "twitter");

    callback()
};

bkjs.server.start();
