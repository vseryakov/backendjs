//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
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
var lib = bkjs.lib;
var logger = bkjs.logger;

// Account management
var files = {
    name: "bk_file",
};
module.exports = files;

// Create API endpoints and routes
files.configureWeb = function(options, callback)
{
    this.configureFilesAPI();
    callback()
}

// Generic file management
files.configureFilesAPI = function()
{
    var self = this;

    api.app.all(/^\/file\/([a-z]+)$/, function(req, res) {
        var options = api.getOptions(req);

        if (!req.query.name) return api.sendReply(res, 400, "name is required");
        if (!req.query.prefix) return api.sendReply(res, 400, "prefix is required");
        var file = req.query.prefix.replace("/", "") + "/" + req.query.name.replace("/", "");
        if (options.tm) file += options.tm;

        switch (req.params[0]) {
        case "get":
            api.getFile(req, file, options);
            break;

        case "add":
        case "put":
            options.name = req.query.name;
            options.prefix = req.query.prefix;
            api.putFile(req, req.query._name || "data", options, function(err) {
                api.sendReply(res, err);
            });
            break;

        case "del":
            api.delFile(file, options, function(err) {
                api.sendReply(res, err);
            });
            break;

        default:
            api.sendReply(res, 400, "Invalid command");
        }
    });
}
