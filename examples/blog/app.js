//
// Blog app
// Created by vlad on Thu Sep 28 12:48:54 EDT 2014
//
var bkjs = require('backendjs');
var core = bkjs.core;
var db = bkjs.db;
var api = bkjs.api;
var app = bkjs.app;
var logger = bkjs.logger;
var server = bkjs.server;

api.describeTables({
        bk_message: {
            title: {},
            tags: {},
        },
});

app.configureWeb = function(options, callback)
{
    var self = this;

    this.initBlogAPI();
    callback();
}

app.initBlogAPI = function()
{
    var self = this;

    api.app.all(/^\/blog\/([a-z\/]+)$/, function(req, res) {
        var options = api.getOptions(req);

        // This is our global blog id
        req.query.id = "0";

        switch (req.params[0]) {
        case "select":
            options.ops = { mtime: "gt" };
            options.count = 5;
            options.desc = 1;

            db.select("bk_message", req.query, options, function(err, rows, info) {
                if (err) return api.sendReply(res, err);
                rows.forEach(function(x) {
                    x.avatar = '/image/account/' + x.sender + "/0";
                    if (x.icon) x.icon = '/image/blog/' + req.query.id + '/' + x.mtime + ':' + x.sender;
                });
                res.json(api.getResultPage(req, options, rows, info));
            });
            break;

        case "get":
            if (!req.query.mtime) return api.sendReply(res, 400, "no mtime provided");
            req.query.sender = req.account.id;
            req.query.mtime += ":" + req.query.sender;

            db.get("bk_message", { id: req.query.id, mtime: req.query.mtime }, options, function(err, row) {
                if (err) return api.sendReply(res, err);
                res.json(row);
            });
            break;

        case "put":
            if (!req.query.sender) req.query.sender = req.account.id;
            if (!req.query.mtime) req.query.mtime = Date.now();
            req.query.mtime += ":" + req.query.sender;
            req.query.alias = req.account.alias;

            api.putIcon(req, req.query.id, { prefix: 'blog', type: req.query.mtime }, function(err, icon) {
                if (err) return api.sendReply(res, err);

                req.query.icon = icon ? 1 : 0;
                db.put("bk_message", req.query, function(err) {
                    api.sendReply(res, err);
                });
            });
            break;

        case "del":
            if (!req.query.mtime) return api.sendReply(res, 400, "no mtime provided");
            if (!req.query.sender) return api.sendReply(res, 400, "no sender provided");
            req.query.mtime += ":" + req.query.sender;

            db.del("bk_message", { id: req.query.id, mtime: req.query.mtime }, options, function(err) {
                if (err) return api.sendReply(res, err);

                api.delIcon(req.query.id, { prefix: "blog", type: req.query.mtime }, function() {
                    api.sendReply(res, err);
                });
            });
            break;

        default:
            api.sendReply(res, 400, "invalid command");
        }
    });
}

// It is called before processing all requests, just after the account was verified
api.registerPreProcess('', /^\//, function(req, status, callback)
{
    var self = this;

    if (status && status.status != 200) {
        // Allow access to blog list without an account
        if (status.status == 404 && req.path.match(/^\/blog\/select/)) status = null;
        return callback(status);
    }

    callback();
});

server.start();
