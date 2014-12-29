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

// Initialize oauth objects
app.google = {}
app.github = {}
app.facebook = {}
app.linkedin = { initOptions: { state: true } };

core.describeArgs('app',
     [ { name: "google-id", obj: 'google', descr: "OAuth2 client id" },
       { name: "google-secret", obj: 'google', descr: "v client secret secret" },
       { name: "google-callback", obj: 'google', descr: "OAuth2 client calback url" },
       { name: "google-scope", type: "list", obj: 'google', value: "https://www.googleapis.com/auth/userinfo.email", descr: "OAuth2 client oauth scope" },
       { name: "google-init-options", obj: "google", type: "json", descr: "Strategy specific init options for the strategy" },
       { name: "google-auth-options", obj: "google", type: "json", descr: "OAuth2 specific auth options for the strategy" },
       { name: "linkedin-id", obj: 'linkedin', descr: "OAuth2 client id" },
       { name: "linkedin-secret", obj: 'linkedin', descr: "OAuth2 client secret secret" },
       { name: "linkedin-callback", obj: 'linkedin', descr: "OAuth2 client calback url" },
       { name: "linkedin-scope", type: "list", obj: 'linkedin', value: "r_emailaddress,r_basicprofile", descr: "OAuth2 client oauth scope" },
       { name: "linkedin-init-options", obj: "linkedin", type: "json", descr: "Strategy specific init options for the strategy" },
       { name: "linkedin-auth-options", obj: "linkedin", type: "json", descr: "OAuth2 specific auth options for the strategy" },
       { name: "github-id", obj: 'github', descr: "OAuth2 client id" },
       { name: "github-secret", obj: 'github', descr: "OAuth2 client secret secret" },
       { name: "github-callback", obj: 'github', descr: "OAuth2 client calback url" },
       { name: "github-scope", type: "list", obj: 'github', value: "user", descr: "OAuth2 client oauth scope" },
       { name: "github-init-options", obj: "github", type: "json", descr: "Strategy specific init options for the strategy" },
       { name: "github-auth-options", obj: "github", type: "json", descr: "OAuth2 specific auth options for the strategy" },
       { name: "facebook-id", obj: 'facebook', descr: "OAuth2 client id" },
       { name: "facebook-secret", obj: 'facebook', descr: "OAuth2 client secret secret" },
       { name: "facebook-callback", obj: 'facebook', descr: "OAuth2 client calback url" },
       { name: "facebook-scope", type: "list", obj: 'facebook', value: "email", descr: "OAuth2 client oauth scope" },
       { name: "facebook-init-options", obj: "facebook", type: "json", descr: "Strategy specific init options for the strategy" },
       { name: "facebook-auth-options", obj: "facebook", type: "json", descr: "OAuth2 specific auth options for the strategy" },
      ]);

api.describeTables({
        bk_account: {
            google_access_token: {},
            github_access_token: {},
            facebook_access_token: {},
            linkedin_access_token: {},
        },
});

app.register = function(strategy, name)
{
    var self = this;
    var config = self[name];
    if (!config || !config.id) return;

    var init = { clientID: config.id, clientSecret: config.secret, callbackURL: config.callback, scope: config.scope  };
    for (var p in config.initOptions) init[p] = config.initOptions;

    passport.use(new strategy(init,
             function(accessToken, refreshToken, profile, done) {
                 app.login(accessToken, refreshToken, profile, function(err, user) {
                     done(err, user);
                 });
             }));

    var auth = { scope: config.scope };
    for (var p in config.authOptions) auth[p] = config.authOptions;

    api.app.get('/login/' + name, passport.authenticate(name, auth));
    api.app.get('/login/callback/' + name, passport.authenticate(name, { failureRedirect: '/' }), function(req, res) {
        res.redirect('/');
    });
}

app.login = function(acessToken, refreshToken, profile, callback)
{
    logger.debug("login:", accessToken, profile);

}

app.configureWeb = function(options, callback)
{
    app.register(googleStrategy, "google");
    app.register(githubStrategy, "github");
    app.register(facebookStrategy, "facebook");
    app.register(linkedinStrategy, "linkedin");

    callback()
};

bkjs.server.start();
