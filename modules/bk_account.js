//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const bkjs = require('backendjs');
const db = bkjs.db;
const api = bkjs.api;
const msg = bkjs.msg;
const core = bkjs.core;
const lib = bkjs.lib;
const logger = bkjs.logger;

// Account management
const mod = {
    name: "bk_account",
    priority: 99999,
    tables: {
        // Basic account information
        bk_account: {
            id: { primary: 1, pub: 1 },
            login: {},
            status: { type: "text" },
            type: { type: "list", list: 1, lower: 1, admin: 1 },   // permission roles only
            flags: { type: "list", list: 1 },                      // other tags/flags
            name: { pub: 1, notempty: 1 },
            first_name: {},
            last_name: {},
            email: { type: "email" },
            phone: { type: "phone" },
            website: {},
            company: {},
            gender: {},
            street: {},
            city: {},
            county: {},
            state: {},
            zipcode: {},
            country: {},
            device_id: { secure: 1 },                 // Device(s) for notifications the format is: [service://]token[@appname]
            ctime: { type: "now", readonly: 1 },      // Create time
            mtime: { type: "now" },                   // Last update time
        },
    },
};
module.exports = mod;

mod.configureModule = function(options, callback)
{
    db.setProcessRow("post", "bk_account", function(req, row) {
        if (row.birthday) {
            row.age = Math.floor((Date.now() - lib.toDate(row.birthday))/(86400000*365));
        }
        // If only used as alias then split manually
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
        options.cleanup = api.authTable + ",bk_account";

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

        case "put/secret":
            req.query.id = req.account.id;
            req.query.login = req.account.login;
            api.setAccountSecret(req.query, options, function(err, data) {
                api.sendJSON(req, err, data);
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
    db.get("bk_account", { id: req.account.id }, options, function(err, row, info) {
        if (err || !row) return callback(err || { status: 404, message: "account not found" });
        for (var p in row) req.account[p] = row[p];
        callback(null, req.account, info);
    });
}

// Send Push notification to the account. The delivery is not guaranteed, if the message was queued for delivery, no errors will be returned.
//
// The options may contain the following:
//  - account - the account record where to send the notification
//  - account_id - the id of the account where to send, the record will be retrieved
//  - device_id - the device to send the message directly
//  - msg - message text to send
//
// In addition the device_id can be saved in the format service://id where the service is one of the supported delivery services, this way the notification
// system will pick the right delivery service depending on the device id, the default service is apple.
//
//  Example:
//
//       bk_account.notifyAccount({ account_id: "123", msg: "test", badge: 1, sound: 1 } })
//
mod.notifyAccount = function(options, callback)
{
    var device_id = options.device_id || options.account && options.account.device_id;
    lib.series([
        function(next) {
            if (device_id || !options.account_id) return next();
            db.get("bk_account", { id: options.account_id }, function(err, row) {
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
    options = lib.objClone(options);
    var login, account;

    lib.series([
        function(next) {
            delete req.query.id;
            if (lib.isEmpty(req.query.name)) return next({ status: 400, message: "name is required" });
            if (options.noauth || api.authTable == "bk_account") return next();
            if (!req.query.login) return next({ status: 400, message: "username is required" });
            if (!req.query.secret) return next({ status: 400, message: "secret is required" });
            // Copy for the auth table in case we have different properties that need to be cleared
            login = lib.objClone(req.query);
            login.token_secret = true;
            api.prepareAccountSecret(login, options, () => {
                // Put the secret back to return to the client, if generated or scrambled the client needs to know it for the API access
                if (!(options.admin || api.checkAccountType(req.account, "admin"))) {
                    api.clearQuery(api.authTable, login, { filter: "admin" });
                    for (var i in options.admin_values) login[options.admin_values[i]] = req.query[options.admin_values[i]];
                }
                options.result_obj = options.first = 1;
                db.add(api.authTable, login, options, (err, row) => {
                    if (err) return next(err);
                    for (const p in row) req.query[p] = row[p];
                    next();
                });
            });
        },
        function(next) {
            account = lib.objClone(req.query);
            // Only admin can add accounts with admin properties
            if (!(options.admin || api.checkAccountType(req.account, "admin"))) {
                api.clearQuery("bk_account", account, { filter: "admin" });
                for (var i in options.admin_values) account[options.admin_values[i]] = req.query[options.admin_values[i]];
            }
            options.result_obj = options.first = 1;
            db.add("bk_account", account, options, (err, row) => {
                if (err) return next(err);
                for (const p in row) req.query[p] = row[p];
                api.metrics.Counter('auth_add_0').inc();
                var cols = db.getColumns("bk_account", options);
                for (const p in cols) if (typeof cols[p].value != "undefined") req.query[p] = cols[p].value;
                req.query._added = true;
                // Link account record for other middleware
                api.setCurrentAccount(req, req.query);
                next();
            });
        },
        function(next) {
            core.runMethods("bkAddAccount", { account: req.account, query: req.query, options: req.options }, () => { next() });
        },
    ], function(err) {
        // Remove the record by login to make sure we can recreate it later
        if (err && login && login.id && api.authTable != "bk_account") {
            return db.del(api.authTable, { login: login.login }, () => {
                lib.tryCall(callback, err, req.query);
            });
        }
        lib.tryCall(callback, err, req.query);
    });
}

// Update existing account, used in /account/update API call
mod.updateAccount = function(req, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};
    // Cannot have account name empty
    if (!req.query.name) delete req.query.name;
    lib.series([
       function(next) {
           if (options.noauth || !req.account.login || api.authTable == "bk_account") return next();
           // Copy for the auth table in case we have different properties that needs to be cleared
           var query = lib.objClone(req.query, "login", req.account.login, "id", req.account.id);
           api.prepareAccountSecret(query, options, () => {
                // Skip admin properties if any
                if (!(options.admin || api.checkAccountType(req.account, "admin"))) {
                    api.clearQuery(api.authTable, query, { filter: "admin" });
                    for (var i in options.admin_values) query[options.admin_values[i]] = req.query[options.admin_values[i]];
                }
                // Avoid updating auth table and flushing cache if nothing to update
                var obj = db.getQueryForKeys(Object.keys(db.getColumns(api.authTable, options)), query, { skip_columns: ["id","login","mtime"] });
                if (!Object.keys(obj).length) return next();
                db.update(api.authTable, query, options, next);
            });
       },
       function(next) {
           // Skip admin properties if any
           var query = lib.objClone(req.query, "login", req.account.login, "id", req.account.id);
           if (!(options.admin || api.checkAccountType(req.account, "admin"))) {
               api.clearQuery("bk_account", query, { filter: "admin" });
               for (var i in options.admin_values) query[options.admin_values[i]] = req.query[options.admin_values[i]];
           }
           db.update("bk_account", query, options, next);
       },
       function(next) {
           core.runMethods("bkUpdateAccount", { account: req.account, query: req.query, options: req.options }, function() { next() });
       },
    ], function(err) {
        callback(err, req.query);
    });
}

// Delete account specified by the obj. Used in `/account/del` API call.
// The options may contain `keep` array with tables to be kept, for example
// delete an account but keep all messages and location: keep:["bk_message","bk_location"]
//
// This methods is suitable for background jobs
mod.deleteAccount = function(req, callback)
{
    if (!req.account || !req.account.id) return callback({ status: 400, message: "no id provided" });
    if (!req.options) req.options = {};
    if (!req.query) req.query = {};
    req.options.count = 0;
    var started = Date.now();

    db.get("bk_account", { id: req.account.id }, req.options, function(err, row) {
        if (err) return callback(err);
        if (!row && !req.options.force) return callback({ status: 404, message: "No account found" });
        for (var p in row) if (!req.account[p]) req.account[p] = row[p];
        req.account.type = lib.toFlags("add", req.account.type, "deleted");
        var rec = lib.objClone(req.obj, "login", req.account.login, "id", req.account.id, "type", req.account.type);

        lib.series([
           function(next) {
               if (!req.account.login || api.authTable == "bk_account") return next();
               if (lib.isFlag(req.options.keep, ["all","account","bk_auth"])) {
                   db.update(api.authTable, rec, req.options, next);
               } else {
                   db.del(api.authTable, { login: req.account.login }, req.options, next);
               }
           },
           function(next) {
               db.update("bk_account", rec, req.options, next);
           },
           function(next) {
               core.runMethods("bkDeleteAccount", { account: req.account, query: req.query, options: req.options }, function() { next() });
           },
           function(next) {
               if (lib.isFlag(req.options.keep, ["all","account","bk_account"])) return next();
               db.del("bk_account", { id: req.account.id }, req.options, next);
           },
        ], function(err) {
            if (!err) api.metrics.Counter('auth_del_0').inc();
            logger.info("deleteAccount:", req.account.id, req.options.keep, lib.toAge(started));
            callback(err);
        });
    });
}
