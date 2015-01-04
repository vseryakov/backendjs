//
// Backend app
// Created by vlad on Fri Dec 26 13:32:29 EST 2014
//

var url = require('url');
var fs = require('fs');
var path = require('path');
var bkjs = require('backendjs');
var db = bkjs.db;
var api = bkjs.api;
var app = bkjs.app;
var core = bkjs.core;
var logger = bkjs.logger;

api.registerPreProcess('', /^\/pages/, function(req, status, callback)
{
    if (status && status.status != 200) {
        // Allow access to public pages
        if (status.status != 404 && req.path.match(/^\/pages\/(select|get|show)/)) status = null;
        return callback(status);
    }
    callback(status);
});

bkjs.server.start();
