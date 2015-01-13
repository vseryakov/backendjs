//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var path = require('path');
var util = require('util');
var fs = require('fs');
var http = require('http');
var url = require('url');
var core = require(__dirname + '/../core');
var corelib = require(__dirname + '/../corelib');
var msg = require(__dirname + '/../msg');
var api = require(__dirname + '/../api');
var logger = require(__dirname + '/../logger');
var utils = require(__dirname + '/../build/Release/backend');

api.endpoints["data"] = "initDataAPI";

// API for full access to all tables
api.initDataAPI = function()
{
    var self = this;
    var db = core.modules.db;

    // Return table columns
    this.app.all(/^\/data\/columns\/?([a-z_0-9]+)?$/, function(req, res) {
        var options = self.getOptions(req);
        if (req.params[0]) {
            return res.json(db.getColumns(req.params[0], options));
        }
        // Cache columns and return
        db.cacheColumns(options, function() {
            res.json(db.getPool().dbcolumns);
        });
    });

    // Return table keys
    this.app.all(/^\/data\/keys\/([a-z_0-9]+)$/, function(req, res) {
        var options = self.getOptions(req);
        res.json(db.getKeys(req.params[0], options));
    });

    // Basic operations on a table
    this.app.all(/^\/data\/(select|scan|search|list|get|add|put|update|del|incr|replace)\/([a-z_0-9]+)$/, function(req, res) {
        // Table must exist
        var dbcols = db.getColumns(req.params[1]);
        if (!dbcols) return self.sendReply(res, "Unknown table");

        var options = self.getOptions(req);

        switch (req.params[0]) {
        case "scan":
            var rows = [];
            db.scan(req.params[1], req.query, options, function(row, next) {
                rows.push(row);
                next();
            },function(err) {
                self.sendJSON(req, err, rows);
            });
            break;

        default:
            db[req.params[0]](req.params[1], req.query, options, function(err, rows, info) {
                switch (req.params[0]) {
                case "select":
                case "search":
                    self.sendJSON(req, err, self.getResultPage(req, options, rows, info));
                    break;
                default:
                    self.sendJSON(req, err, rows);
                }
            });
        }
    });

}

