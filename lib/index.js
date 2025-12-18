/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

exports.modules = require(__dirname + '/modules');
exports.logger = require(__dirname + '/logger');
exports.lib = require(__dirname + '/lib');
exports.metrics = require(__dirname + '/metrics');
exports.app = require(__dirname + '/app');
exports.cache = require(__dirname + '/cache');
exports.queue = require(__dirname + '/queue');
exports.ipc = require(__dirname + '/ipc');
exports.aws = require(__dirname + '/aws');
exports.db = require(__dirname + '/db');
exports.sql = require(__dirname + '/db/sql');
exports.push = require(__dirname + '/push');
exports.api = require(__dirname + '/api');
exports.jobs = require(__dirname + '/jobs');
exports.events = require(__dirname + '/events');
exports.stats = require(__dirname + '/stats');
exports.sendmail = require(__dirname + '/sendmail');
exports.logwatcher = require(__dirname + '/util/logwatcher');
exports.DbPool = require(__dirname + '/db/pool');
exports.DbRequest = exports.db.Request;
exports.shell = { name: "shell", help: [], commands: {} };

for (const p in exports) {
    if (p != "modules") exports.app.addModule(exports[p]);
}

const mods = [
    "/api/hooks", "/api/routing", "/api/redirect",
    "/api/access", "/api/acl", "/api/csrf", "/api/session", "/api/signature",
    "/api/users", "/api/passkeys", "/api/ws",
    "/api/images", "/api/files",
];

for (const p of mods) {
    exports.app.addModule(require(__dirname + p))
}

// Run the main server if we execute this as a standalone program
if (!module.parent) {
    exports.app.start();
}
