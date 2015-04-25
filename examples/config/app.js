//
// Backend app
// Created by vlad on Fri Dec 26 13:32:29 EST 2014
//
var bkjs = require('backendjs');
var db = bkjs.db;
var api = bkjs.api;
var app = bkjs.app;
var core = bkjs.core;
var lib = bkjs.lib;
var logger = bkjs.logger;

// Create API endpoints and routes
app.configureWeb = function(options, callback)
{
    callback()
};

bkjs.server.start();
