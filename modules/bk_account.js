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

mod.configureMdule = function(options, callback)
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
            if (!req.query.id || req.query.id == req.account.id) {
                mod.getAccount(req, options, function(err, data, info) {
                    api.sendJSON(req, err, data);
                });

            } else {
                db.list("bk_account", req.query.id, options, function(err, data) {
                    api.sendJSON(req, err, data);
                });
            }
            break;

        case "add":
            options.cleanup = "";
            mod.addAccount(req, options, function(err, data) {
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

        case "subscribe":
            api.subscribe(req);
            break;

        case "put/secret":
            req.query.id = req.account.id;
            req.query.login = req.account.login;
            api.setAccountSecret(req.query, options, function(err, data) {
                api.sendJSON(req, err, data);
            });
            break;

        case "get/icon":
            if (!core.modules.bk_icon) return api.sendReply(res, 400, "invalid request");
            if (!req.query.id) req.query.id = req.account.id;
            req.query.prefix = 'account';
            if (!req.query.type) req.query.type = '0';
            options.cleanup = "bk_icon";
            core.modules.bk_icon.send(req, options);
            break;

        case "select/icon":
            if (!core.modules.bk_icon) return api.sendReply(res, 400, "invalid request");
            if (!req.query.id) req.query.id = req.account.id;
            req.query.prefix = "account";
            options.cleanup = "bk_icon";
            core.modules.bk_icon.select(req.query, function(err, rows) {
                api.sendJSON(req, err, rows);
            });
            break;

        case "put/icon":
            if (!core.modules.bk_icon) return api.sendReply(res, 400, "invalid request");
            req.query.prefix = 'account';
            req.query.id = req.account.id;
            if (!req.query.type) req.query.type = '0';
            core.modules.bk_icon.upload(req, options, function(err, data) {
                api.sendJSON(req, err, data);
            });
            break;

        case "del/icon":
            if (!core.modules.bk_icon) return api.sendReply(res, 400, "invalid request");
            req.query.prefix = 'account';
            req.query.id = req.account.id;
            if (!req.query.type) req.query.type = '0';
            core.modules.bk_icon.del(req.query, function(err, rows) {
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
    db.get("bk_account", { id: req.account.id }, options, function(err, row, info) {
        if (err || !row) return callback(err || { status: 404, message: "account not found" });
        for (var p in row) req.account[p] = row[p];
        callback(null, req.account, info);
    });
}

// Send Push notification to the account. The delivery is not guaranteed, if the message was queued for delivery, no errors will be returned.
//
// The options may contain the following:
//  - account_id - REQUIRED, the account to who to send the notification
//  - msg - message text to send
//  - badge - a badge number to be sent
//  - allow - the account properties to check if notifications are enabled, it must be an object with properties in the account record and values to
//    be a regexp, each value if starts with "!" means not equal, see `lib.isMatched`
//  - skip - Array or an object with account ids which should be skipped, this is for mass sending in order to reuse the same options
//  - enable - the account properties to check if a notification parameter must be set or removed, an account property must be a boolean and
//    if false then a notification parameter is removed and if true a notification parameter is set to 1
//  - logging - logging level about the notification send status, default is debug, can be any valid logger level, must be a string, not a number
//  - service_id - name of the standard delivery service supported by the backend, it is be used instead of custom handler, one of the following: apple, google
//  - app_id - the application specific device tokens should be used only or if none matched the default device tokens
//  - device_id - the device to send the message to instesd of the device_id property fro the account record
//
// In addition the device_id can be saved in the format service://id where the service is one of the supported delivery services, this way the notification
// system will pick the right delivery service depending on the device id, the default service is apple.
//
//  Example:
//
//       bk_account.notifyAccount({ account_id: "123", msg: "test", badge: 1, sound: 1, allow: { notifications0: 1, type: "user" }, enable: { sound: "sound0", badge: "badge0" } })
//
mod.notifyAccount = function(options, callback)
{
    if (!options || !options.account_id) {
        return lib.tryCall(callback, { status: 500, message: "invalid account" });
    }

    // Skip this account
    switch (lib.typeName(options.skip)) {
    case "array":
        if (options.skip.indexOf(options.account_id) > -1) return lib.tryCall(callback, { status: 400, message: "skipped", id: options.account_id });
        break;
    case "object":
        if (options.skip[options.account_id]) return lib.tryCall(callback, { status: 400, message: "skipped", id: options.account_id });
        break;
    }

    var account = options.account;
    lib.series([
      function(next) {
          if (account && account.id == options.account_id) return next();
          db.get("bk_account", { id: options.account_id }, function(err, row) {
              if (err || !row) return next(err || { status: 404, message: "account not found", id: options.account_id });
              if (!row.device_id && !row.device_id) return next({ status: 404, message: "device not found", id: options.account_id });
              account = row;
              next();
          });
      },
      function(next) {
          if (!lib.isMatched(account, options.allow)) {
              return next({ status: 401, message: "not allowed", id: options.account_id });
          }
          for (var p in options.enable) {
              var c = options.enable[p];
              if (typeof account[c] == "undefined") continue;
              if (lib.toBool(account[c])) options[p] = 1; else delete options[p];
          }
          msg.send(options.device_id || account.device_id, options, function(err) {
              logger.logger(err ? "error" : "debug", "notifyAccount:", err, options, account);
              next(err);
          });
      },
    ], callback);
}

// Return account details for the list of rows, `options.account_key` specified the column to use for the account id in the `rows`, or `id` will be used.
// The result accounts are cleaned for public columns, all original properties from the `rows` are kept as is.
// If options.existing is 1 then return only record with found accounts, all other records in the rows will be deleted
mod.listAccount = function(rows, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};
    if (!rows) return callback(null, []);
    var key = options.account_key || "id";
    var map = {};
    if (!Array.isArray(rows)) rows = [ rows ];
    rows.forEach(function(x) { if (!map[x[key]]) map[x[key]] = []; map[x[key]].push(x); });
    db.list("bk_account", Object.keys(map).map(function(x) { return { id: x } }), options, function(err, list, info) {
        if (err) return callback(err, []);

        api.checkResultColumns("bk_account", list, options);
        list.forEach(function(x) {
            map[x.id].forEach(function(row) {
                for (var p in x) if (!row[p]) row[p] = x[p];
                if (options.existing) row._id = 1;
            });
        });
        // Remove rows without account info
        if (options.existing) rows = rows.filter(function(x) { return x._id; }).map(function(x) { delete x._id; return x; });
        callback(null, rows, info);
    });
}

// Register new account, used in /account/add API call, but the req does not have to be an Express request, it just
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

// Rename account alias
mod.renameAccount = function(req, callback)
{
    if (!req.account || !req.account.id || !req.account.name) return callback({ status: 400, message: "no id and name provided" });
    if (!req.options) req.options = {};
    if (!req.query) req.query = {};

    db.get("bk_account", { id: req.account.id }, req.options, function(err, account) {
        if (err || !account) return callback(err || { status: 404, message: "No account found" });

        lib.series([
          function(next) {
              if (api.authTable == "bk_account") return next();
              if (req.account.name == account.name) return next();
              db.update(api.authTable, { login: account.login, name: req.account.name }, next);
          },
          function(next) {
              if (req.account.name == account.name) return next();
              db.update("bk_account", { id: req.account.id, name: req.account.name }, next);
          },
          function(next) {
              core.runMethods("bkRenameAccount", { account: req.account, query: req.query, options: req.options }, function() { next() });
          },
        ], callback);
    });
}

// Override OAuth account management
mod.fetchAccount = function(query, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};
    db.get(api.authTable, { login: query.login }, function(err, auth) {
        if (err) return callback(err);

        if (auth) {
            mod.getAccount({ query: {}, account: auth }, options, function(err, row) {
                if (!err) for (var p in row) auth[p] = row[p];
                callback(err, auth);
            });
            return;
        }

        lib.series([
            function(next) {
                // Pretend to be an admin
                mod.addAccount({ query: query, account: { type: "admin" } }, options, function(err, row) {
                    if (row) auth = row;
                    next(err);
                });
            },
            function(next) {
                if (!query.icon) return next();
                core.httpGet(query.icon, { binary: 1 }, function(err, params) {
                    if (err || !params.data.length) return next();
                    api.saveIcon(params.data, auth.id, { prefix: "account", type: "0", width: options.width }, function(err) {
                        if (err || !core.modules.bk_icon) return next();
                        db.put("bk_icon", { id: auth.id, prefix: "account", type: "0" }, options, function(err, rows) { next() });
                    });
                });
            },
        ], function(err) {
            callback(err, auth);
        });
    });
}
