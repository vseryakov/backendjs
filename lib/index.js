//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

exports.logger = require(__dirname + '/logger');
exports.lib = require(__dirname + '/lib');
exports.core = require(__dirname + '/core');
exports.pool = require(__dirname + '/pool');
exports.metrics = require(__dirname + '/metrics');
exports.cache = require(__dirname + '/cache');
exports.queue = require(__dirname + '/queue');
exports.ipc = require(__dirname + '/ipc');
exports.aws = require(__dirname + '/aws');
exports.db = require(__dirname + '/db');
exports.push = require(__dirname + '/push');
exports.server = require(__dirname + '/server');
exports.api = require(__dirname + '/api');
exports.users = require(__dirname + '/users');
exports.jobs = require(__dirname + '/jobs');
exports.events = require(__dirname + '/events');
exports.httpGet = require(__dirname + '/httpget');
exports.stats = require(__dirname + '/stats');
exports.logwatcher = require(__dirname + '/logwatcher');
exports.app = require(__dirname + '/app');
exports.shell = { name: "shell", help: [], cmdIndex: 1 };
for (const p in exports) if (p != "core") exports.core.addModule(exports[p]);

exports.core.addModule(require(__dirname + "/api/users"), require(__dirname + "/api/passkeys"), require(__dirname + "/api/ws"))

exports.modules = exports.core.modules;
