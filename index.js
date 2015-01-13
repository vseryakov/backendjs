//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

exports.utils = require(__dirname + '/build/Release/backend');
exports.core = require(__dirname + '/core');
exports.corelib = require(__dirname + '/corelib');
exports.logger = require(__dirname + '/logger');
exports.ipc = require(__dirname + '/ipc');
exports.aws = require(__dirname + '/aws');
exports.db = require(__dirname + '/db');
exports.msg = require(__dirname + '/msg');
exports.server = require(__dirname + '/server');
exports.api = require(__dirname + '/api');
exports.metrics = require(__dirname + '/metrics');
exports.app = require(__dirname + '/app');
exports.run = function(callback) { this.core.run(callback); }

exports.core.addModule('logger', exports.logger,
                       'corelib', exports.corelib,
                       'ipc', exports.ipc,
                       'db', exports.db,
                       'aws', exports.aws,
                       'msg', exports.msg,
                       'api', exports.api,
                       'server', exports.server,
                       'utils', exports.utils,
                       'app', exports.app);

// Load all submodules after we have all singletons ready
exports.corelib.findFileSync(__dirname + "/lib", { include: new RegExp(/\.js$/) }).forEach(function(file) { require(file); });
