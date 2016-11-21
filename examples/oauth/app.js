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
app.linkedin = { state: true, scpe: "r_emailaddress,r_basicprofile"  };
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
        bk_auth: {
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

// This is optional to show how an account can be post or pre processed on success
app.fetchAccount = function(query, options, callback)
{
    api.fetchAccount(query, options, function(err, row) {
        if (err) return callback(err);
        // Save new access tokens in the account record
        req = lib.objNew('id', row.id, req.profile.provider + "_access_token", req.accessToken, req.profile.provider + "_refresh_token", req.refreshToken);
        db.update("bk_auth", req, function(err) {
            callback(err, row);
        });
    });
}

app.configureMiddleware = function(options, callback)
{
    api.registerOAuthStrategy(githubStrategy, lib.objExtend(app.github, { fetchAccount: app.fetchAccount }));
    api.registerOAuthStrategy(googleStrategy, lib.objExtend(app.google, { fetchAccount: app.fetchAccount }));
    api.registerOAuthStrategy(facebookStrategy, lib.objExtend(app.facebook, { fetchAccount: app.fetchAccount }));
    api.registerOAuthStrategy(linkedinStrategy, lib.objExtend(app.linkedin, { fetchAccount: app.fetchAccount }));
    api.registerOAuthStrategy(twitterStrategy, lib.objExtend(app.twitter, { fetchAccount: app.fetchAccount }));

    callback()
};

app.configureWeb = function(options, callback)
{
    callback();
}

bkjs.server.start();
