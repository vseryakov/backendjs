//
// Backend app
// Created by vlad on Mon Oct 23 13:35:55 EDT 2017
//
var bkjs = require('backendjs');
var api = bkjs.api;
var app = bkjs.app;
var logger = bkjs.logger;
var auth = bkjs.auth;
var lib = bkjs.lib;

// Create API endpoints and routes
app.configureWeb = function(options, callback)
{
    lib.toRegexpObj(api.allow, "^/srp");

    app.srp = {};
    api.app.all(/^\/srp\/register/, function(req, res) {
        if (!req.query.user || !req.query.salt || !req.query.verifier) return api.sendReply(res, { status: 400, message: "user, salt and verifier required" });
        app.srp[req.query.user] = { salt: req.query.salt, verifier: req.query.verifier };
        logger.log(req.path, req.query);
        api.sendReply(res);
    });
    api.app.all(/^\/srp\/login1/, function(req, res) {
        if (!req.query.A || !req.query.user) return api.sendRepy(res, { status: 400, message: "user and A required" });
        var user = app.srp[req.query.user];
        if (!user) return api.sendReply(res, 404, "invalid user");
        var s1 = auth.srp.server1(user.verifier);
        user.b = s1[0];
        user.A = req.query.A;
        logger.log(req.path, user);
        api.sendJSON(req, null, { salt: user.salt, B: s1[1] });
    });
    api.app.all(/^\/srp\/login2/, function(req, res) {
        if (!req.query.M1 || !req.query.user) return api.sendRepy(res, { status: 400, message: "user and M1 required" });
        var user = app.srp[req.query.user];
        if (!user) return api.sendReply(res, 404, "invalid user");
        var s2 = auth.srp.server2(req.query.user, user.verifier, user.b, user.A, req.query.M1);
        user.M1 = req.query.M1;
        user.M2 = s2[0];
        logger.log(req.path, user);
        api.sendJSON(req, null, { M2: user.M2 });
    });
    callback()
};

bkjs.server.start();
