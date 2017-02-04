//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

exports.core = require(__dirname + '/lib/core');
exports.lib = require(__dirname + '/lib/lib');
exports.logger = require(__dirname + '/lib/logger');
exports.ipc = require(__dirname + '/lib/ipc');
exports.aws = require(__dirname + '/lib/aws');
exports.db = require(__dirname + '/lib/db');
exports.msg = require(__dirname + '/lib/msg');
exports.server = require(__dirname + '/lib/server');
exports.api = require(__dirname + '/lib/api');
exports.jobs = require(__dirname + '/lib/jobs');
exports.metrics = require(__dirname + '/lib/metrics');
exports.httpGet = require(__dirname + '/lib/http_get');
exports.app = require(__dirname + '/lib/app');
exports.run = function(callback) { this.core.run(callback); }

exports.core.addModule('logger', exports.logger,
                       'lib', exports.lib,
                       'aws', exports.aws,
                       'ipc', exports.ipc,
                       'db', exports.db,
                       'api', exports.api,
                       'msg', exports.msg,
                       'jobs', exports.jobs,
                       'server', exports.server,
                       'metrics', exports.metrics,
                       'httpGet', exports.httpGet,
                       'app', exports.app);

var path = require("path");
// Load all submodules for the singletons, files must start with a singleton name, each submodule just add more singleton methods
exports.lib.findFileSync(__dirname + "/lib", { include: /[a-z]+_.+\.js$/ }).forEach(function(file) {
    var mod = path.basename(file).split("_");
    if (mod[0] == "core" || exports.core.modules[mod[0]]) require(file);
});
