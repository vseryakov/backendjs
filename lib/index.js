//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

exports.logger = require(__dirname + '/logger');
exports.lib = require(__dirname + '/lib');
require(__dirname + '/lib_file');
exports.lib.findFileSync(__dirname, { include: /lib_.+\.js$/ }).forEach((file) => { require(file) });

exports.core = require(__dirname + '/core');
exports.lib.findFileSync(__dirname, { include: /core_.+\.js$/ }).forEach((file) => { require(file) });

exports.pool = require(__dirname + '/pool');
exports.ipc = require(__dirname + '/ipc');
exports.aws = require(__dirname + '/aws');
exports.db = require(__dirname + '/db');
exports.msg = require(__dirname + '/msg');
exports.server = require(__dirname + '/server');
exports.api = require(__dirname + '/api');
exports.auth = require(__dirname + '/auth');
exports.jobs = require(__dirname + '/jobs');
exports.events = require(__dirname + '/events');
exports.metrics = require(__dirname + '/metrics');
exports.httpGet = require(__dirname + '/http_get');
exports.app = require(__dirname + '/app');

exports.shell = { name: "shell", help: [] };
exports.run = exports.core.run;

exports.core.addModule(exports.logger,
                       exports.lib,
                       exports.pool,
                       exports.aws,
                       exports.ipc,
                       exports.db,
                       exports.api,
                       exports.auth,
                       exports.msg,
                       exports.jobs,
                       exports.events,
                       exports.server,
                       exports.metrics,
                       exports.httpGet,
                       exports.app,
                       exports.shell);

// Load all submodules for the singletons, files must start with a singleton name, each submodule just add more singleton methods
exports.lib.findFileSync(__dirname, { include: /[a-z]+_.+\.js$/ }).forEach((file) => { require(file) });
