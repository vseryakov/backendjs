//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var path = require('path');
var util = require('util');
var fs = require('fs');
var http = require('http');
var url = require('url');
var bkjs = require('backendjs');
var db = bkjs.db;
var api = bkjs.api;
var app = bkjs.app;
var ipc = bkjs.ipc;
var msg = bkjs.msg;
var core = bkjs.core;
var corelib = bkjs.corelib;
var logger = bkjs.logger;

// Account management
var data = {
    name: "data"
};
module.exports = data;

// Initialize the module
data.init = function(options)
{
}

// Create API endpoints and routes
data.configureWeb = function(options, callback)
{
    this.configureDataAPI();
    callback()
}

// API for full access to all tables
data.configureDataAPI = function()
{
    var self = this;

    // Return table columns
    api.app.all(/^\/data\/columns\/?([a-z_0-9]+)?$/, function(req, res) {
        var options = api.getOptions(req);
        if (req.params[0]) {
            return res.json(db.getColumns(req.params[0], options));
        }
        // Cache columns and return
        db.cacheColumns(options, function() {
            res.json(db.getPool().dbcolumns);
        });
    });

    // Return table keys
    api.app.all(/^\/data\/keys\/([a-z_0-9]+)$/, function(req, res) {
        var options = api.getOptions(req);
        res.json(db.getKeys(req.params[0], options));
    });

    // Basic operations on a table
    api.app.all(/^\/data\/(select|scan|search|list|get|add|put|update|del|incr|replace)\/([a-z_0-9]+)$/, function(req, res) {
        // Table must exist
        var dbcols = db.getColumns(req.params[1]);
        if (!dbcols) return api.sendReply(res, "Unknown table");

        var options = api.getOptions(req);

        switch (req.params[0]) {
        case "scan":
            var rows = [];
            db.scan(req.params[1], req.query, options, function(row, next) {
                rows.push(row);
                next();
            },function(err) {
                api.sendJSON(req, err, rows);
            });
            break;

        default:
            db[req.params[0]](req.params[1], req.query, options, function(err, rows, info) {
                switch (req.params[0]) {
                case "select":
                case "search":
                    api.sendJSON(req, err, api.getResultPage(req, options, rows, info));
                    break;
                default:
                    api.sendJSON(req, err, rows);
                }
            });
        }
    });

}

