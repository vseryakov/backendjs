//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const bkjs = require('backendjs');
const db = bkjs.db;
const api = bkjs.api;
const auth = bkjs.auth;
const msg = bkjs.msg;
const core = bkjs.core;
const lib = bkjs.lib;
const logger = bkjs.logger;

// Account management
const mod = {
    priority: 99999,
};
module.exports = mod;

mod.configure = function(options, callback)
{
    this.tables = {
        [auth.table]: {
            id: { pub: 1 },
            name: { pub: 1, notempty: 1 },
            first_name: {},
            last_name: {},
            email: { type: "email" },
            phone: { type: "phone" },
            website: {},
            company: {},
            street: {},
            city: {},
            county: {},
            state: {},
            zipcode: {},
            country: {},
            device_id: { secure: 1 },                 // Device(s) for notifications the format is: [service://]token[@appname]
        }
    };
    callback();
}

mod.configureModule = function(options, callback)
{
    db.setProcessRow("post", auth.table, function(req, row) {
        if (row.name && !row.first_name) {
            var name = row.name.split(" ");
            if (name.length > 1) row.last_name = name.pop();
            row.first_name = name.join(" ");
        }
    });
    callback();
}

// Create API endpoints and routes
mod.configureWeb = function(options, callback)
{
    this.configureAccountsAPI();
    callback()
}

// Account management
mod.configureAccountsAPI = function()
{
    api.app.all(/^\/account\/([a-z/]+)$/, function(req, res, next) {
        var options = api.getOptions(req);
        options.cleanup = auth.table;

        switch (req.params[0]) {
        case "get":
            mod.getAccount(req, options, function(err, data, info) {
                api.sendJSON(req, err, data);
            });
            break;

        case "update":
            mod.updateAccount(req, options, function(err, data) {
                api.sendJSON(req, err, data);
            });
            break;

        case "del":
            mod.deleteAccount(req, function(err, data) {
                api.sendJSON(req, err);
            });
            break;

        default:
            api.sendReply(res, 400, "Invalid command");
        }
    });
}

// Returns current account, used in /account/get API call, req.account will be filled with the properties from the db
mod.getAccount = function(req, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!req.account || !req.account.id) return callback({ status: 400, message: "invalid account" });
    auth.get({ login: req.account.login, id: req.account.id }, options, function(err, row, info) {
        if (err || !row) return callback(err || { status: 404, message: "account not found" });
        for (const p in row) req.account[p] = row[p];
        callback(null, req.account, info);
    });
}

// Send Push notification to the account. The delivery is not guaranteed, if the message was queued for delivery, no errors will be returned.
//
// The options may contain the following:
//  - account - the whole account record where to send the notification
//  - account_id - the id of the account where to send, the record will be retrieved
//  - account_login - the login of the account where to send, the record will be retrieved
//  - device_id - the device to send the message directly
//  - msg - message text to send
//
// In addition the device_id can be saved in the format service://id where the service is one of the supported delivery services, this way the notification
// system will pick the right delivery service depending on the device id, the default service is apple.
//
//  Example:
//
//       bk_user.notifyAccount({ account_id: "123", msg: "test", badge: 1, sound: 1 } })
//
mod.notifyAccount = function(options, callback)
{
    var device_id = options.device_id || options.account && options.account.device_id;
    lib.series([
        function(next) {
            if (device_id || !(options.account_id || options.account_login)) return next();
            auth.get({ id: options.account_id, login: options.account_login }, function(err, row) {
                if (err || !row) return next(err || { status: 404, message: "account not found", id: options.account_id });
                device_id = row.device_id;
                next();
            });
        },
        function(next) {
            msg.send(device_id, options, function(err) {
                logger.logger(err ? "error" : "debug", "notifyAccount:", err, options, device_id);
                next(err);
            });
        },
    ], callback);
}

// Register new account, may be used an API call, but the req does not have to be an Express request, it just
// need to have query and options objects.
mod.addAccount = function(req, options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    lib.series([
        function(next) {
            auth.add(req.query, options, (err, row) => {
                if (!err) {
                    // Link account record for other middleware
                    api.setCurrentAccount(req, req.query);
                }
                next(err);
            });
        },
        function(next) {
            core.runMethods("bkAddAccount", { account: req.account, query: req.query, options: req.options }, next);
        },
    ], function(err) {
        lib.tryCall(callback, err, req.query);
    });
}

// Update existing account, used in /account/update API call
mod.updateAccount = function(req, options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    lib.series([
        function(next) {
            auth.update(req.query, options, next);
        },
        function(next) {
            core.runMethods("bkUpdateAccount", { account: req.account, query: req.query, options: req.options }, next);
        },
    ], function(err) {
        lib.tryCall(callback, err, req.query);
    });
}

// Delete account specified by the obj. Used in `/account/del` API call.
// The options may contain `keep` array with tables to be kept, for example
// delete an account but keep all messages and location: keep:["bk_user","bk_location"]
//
// This methods is suitable for background jobs
mod.deleteAccount = function(req, callback)
{
    if (!req.account || !req.account.id) return callback({ status: 400, message: "no id provided" });
    if (!req.options) req.options = {};
    if (!req.query) req.query = {};
    req.options.count = 0;
    var started = Date.now();

    auth.get(req.account, req.options, function(err, row) {
        if (err) return callback(err);
        if (!row && !req.options.force) return callback({ status: 404, message: "No account found" });
        for (const p in row) req.account[p] = row[p];
        req.account.type = lib.toFlags("add", req.account.type, "deleted");

        lib.series([
           function(next) {
               if (!lib.isFlag(req.options.keep, ["all", "account", auth.table])) return next();
               auth.update({ id: req.account.id, login: req.account.login, type: req.account.type }, req.options, next);
           },
           function(next) {
               core.runMethods("bkDeleteAccount", { account: req.account, query: req.query, options: req.options }, next);
           },
           function(next) {
               if (lib.isFlag(req.options.keep, ["all", "account", auth.table])) return next();
               auth.del(req.account, req.options, next);
           },
        ], function(err) {
            logger.info("deleteAccount:", req.account.id, req.options.keep, lib.toAge(started));
            callback(err);
        });
    });
}
