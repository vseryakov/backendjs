//
// Backend app
// Created by vlad on Mon Oct 23 13:35:55 EDT 2017
//
var bkjs = require('backendjs');
var db = bkjs.db;
var api = bkjs.api;
var app = bkjs.app;
var core = bkjs.core;
var lib = bkjs.lib;
var logger = bkjs.logger;

db.describeTables({
    // New table
    test: {
        id: { primary: 1 },
        name: {},
        mtime: { type: "now" },
    },
    // Extend users table
    bk_user: {
        test0: { pub: 1 },
    },
});

// Create API endpoints and routes
app.configureWeb = function(options, callback)
{
    db.setProcessRow("post", 'test', this.processTestRow);

    // Add new record
    api.app.all(/^\/test\/add/, function(req, res) {
        db.add('test', { id: req.query.id, name: req.query.name }, function(err, rows) {
            api.sendReply(res, err);
        });
    });
    // Update record
    api.app.all(/^\/test\/update/, function(req, res) {
        if (!req.query.id || !req.query.name) return api.sendRepy(res, { status: 400, message: "id and name required" });

        db.update('test', req.query, function(err, rows) {
            api.sendReply(res, err);
        });
    });
    // Retrieve record by id
    api.app.all(/^\/test\/([0-9]+)/, function(req, res) {
        var options = api.getOptions(req);
        db.get('test', { id: req.params[0] }, options, function(err, rows) {
            api.sendJSON(req, err, rows);
        });
    });
    callback()
};

// A job method that can be called directly from the crontab or via shell
app.processTestJob = function(options, callback)
{
    db.select("test", {}, function(err, rows) {
        if (err) return callback(err);
        console.log("Test contains: ", rows.length, "records")
        callback()
    });
}

// Modify every row returned to the client, we can add/del properties
app.processTestRow = function(req, row, options)
{
    row.url = '/test/list';
    return row;
}

api.registerPostProcess('', /^\/account\/([a-z\/]+)$/, function(req, res, rows) {
    var self = this;
    switch (req.params[0]) {
    case 'add':
       // Perform our own additional work for new accounts, req.account contains new account record
       db.add('test', { id: req.account.id });
       break;
    case 'del':
       db.del('test', { id: req.account.id });
       break;
    }
});

// Redirect on unauthorized access to the files
api.registerPreProcess('', /^\/test\/list$/, function(req, status, callback) {
    if (status.status != 200) {
        status.status = 302;
        status.url = '/public/index.html';
    }
    callback(status);
});

bkjs.server.start();
