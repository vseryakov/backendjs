//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Nov 2014
//

var util = require('util');
var fs = require('fs');
var repl = require('repl');
var path = require('path');
var backend = require(__dirname + '/build/Release/backend');
var logger = require(__dirname + '/logger');
var core = require(__dirname + '/core');
var cluster = require('cluster');

// This is a skeleton module to be extended by the specific application logic. It provides all callback and hooks that are called by the core backend modules
// during different phases, like initialization, shutting down, etc...
//
// It should be used for custom functions and methods to be defined, the `app` module is always available.
//
var app = {
    args: [],
};

module.exports = app;

// Called after all config files are loaded and command line args are parsed, home directory is set but before the db is initialized,
// the primary purpose of this early call is to setup environment before connecting to the database
app.configure = function(options, callback) { callback(); }

// Called after the core.init has been initialized successfully, this can be redefined in the applications to add additional
// init steps that all processes require to have. All database pool and other confugration is ready at this point.
app.configureModule = function(options, callback) { callback(); }

// This handler is called during the Express server initialization just after the security middleware.
//
// NOTE: `options.app` refers to the Express instance.
app.configureMiddleware = function(options, callback) { callback(); };

// This handler is called after the Express server has been setup and all default API endpoints initialized but the Web server
// is not ready for incoming requests yet. This handler can setup additional API endpoints, add/modify table descriptions.
//
// NOTE: `options.app` refers to the Express instance
app.configureWeb = function(options, callback) { callback(); };

// Perform shutdown sequence when a Web process is about to exit
//
// NOTE: `options.app` refers to the Express instance
app.shutdownWeb = function(options, callback) { callback(); }

// This handler is called during the master server startup, this is the process that monitors the worker jobs and performs jobs scheduling
app.configureMaster = function(options, callback) { callback(); }

// This handler is called during the Web server startup, this is the master process that creates Web workers for handling Web requests, this process
// interacts with the Web workers via IPC sockets between processes and relaunches them if any Web worker dies.
app.configureServer = function(options, callback) { callback(); }

// This handler is called on job worker instance startup after the tables are intialized and it is ready to process the job
app.configureWorker = function(options, callback) { callback(); }

// Perform last minute operations inside a worker process before exit, the callback must be called eventually which will exit the process.
// This method can be overrided to implement custom worker shutdown procedure in order to finish pending tasks like network calls.
app.shutdownWorker = function(options, callback) { callback(); }


