//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var path = require('path');
var util = require('util');
var fs = require('fs');
var http = require('http');
var url = require('url');
var bkjs = require('backendjs');
var db = bkjs.db;
var api = bkjs.api;
var app = bkjs.app;
var ipc = bkjs.ipc;
var msg = bkjs.msg;
var core = bkjs.core;
var corelib = bkjs.corelib;
var logger = bkjs.logger;

// Account management
var accounts = {
    name: "accounts",
    // Intervals between updating presence status table
    statusInterval: 1800000,
};
module.exports = accounts;

// Initialize the module
accounts.init = function(options)
{
    core.describeArgs("accounts", [
         { name: "status-interval", type: "number", descr: "Number of milliseconds between status record updates, presence is considered offline if last access was more than this interval ago" },
    ]);

    db.describeTables({
            // Basic account information
            bk_account: { id: { primary: 1, pub: 1 },
                          login: {},
                          name: {},
                          first_name: {},
                          last_name: {},
                          alias: { pub: 1 },
                          status: {},
                          type: { admin: 1 },
                          email: {},
                          phone: {},
                          website: {},
                          company: {},
                          birthday: {},
                          gender: {},
                          address: {},
                          city: {},
                          state: {},
                          zipcode: {},
                          country: {},
                          device_id: {},                                    // Device for notifications
                          geohash: { location: 1 },                         // To prevent regular account updates
                          latitude: { type: "real", location: 1 },          // overriding location columns
                          longitude: { type: "real", location: 1 },
                          location: { location: 1 },
                          ltime: { type: "bigint", location: 1 },           // Last location update time
                          ctime: { type: "bigint", readonly: 1, now: 1 },   // Create time
                          mtime: { type: "bigint", now: 1 } },              // Last update time

            bk_status: { id: { primary: 1 },                               // account id
                         status: {},                                       // status, online, offline, away
                         alias: {},
                         atime: { type: "bigint", now: 1 },                // last access time
                         mtime: { type: "bigint" }},                       // last status save to db time

            // Account metrics
            bk_collect: {
                          url_image_account_rmean: { type: "real" },
                          url_image_account_hmean: { type: "real" },
                          url_image_account_0: { type: "real" },
                          url_account_get_rmean: { type: "real" },
                          url_account_get_hmean: { type: "real" },
                          url_account_get_0: { type: "real" },
                          url_account_select_rmean: { type: "real" },
                          url_account_select_hmean: { type: "real" },
                          url_account_select_0: { type: "real" },
                          url_account_update_rmean: { type: "real" },
                          url_account_update_hmean: { type: "real" },
                          url_account_update_0: { type: "real" },
                      },

            });
}

// Create API endpoints and routes
accounts.configureWeb = function(options, callback)
{
    this.configureAccountsAPI();
    callback()
}

// Account management
accounts.configureAccountsAPI = function()
{
    var self = this;

    api.app.all(/^\/account\/([a-z\/]+)$/, function(req, res, next) {
        var options = api.getOptions(req);

        switch (req.params[0]) {
        case "get":
            options.cleanup = "bk_auth,bk_account";
            self.getAccount(req, options, function(err, data, info) {
                api.sendJSON(req, err, data);
            });
            break;

        case "add":
            options.cleanup = "";
            self.addAccount(req, options, function(err, data) {
                api.sendJSON(req, err, data);
            });
            break;

        case "update":
            req.query.id = req.account.id;
            req.query.login = req.account.login;
            self.updateAccount(req, options, function(err, data) {
                api.sendJSON(req, err, data);
            });
            break;

        case "del":
            self.deleteAccount(req.account.id, options, function(err, data) {
                api.sendJSON(req, err, data);
            });
            break;

        case "subscribe":
            api.subscribe(req);
            break;

        case "select":
            self.selectAccount(req, options, function(err, data) {
                api.sendJSON(req, err, data);
            });
            break;

        case "put/secret":
            req.query.id = req.account.id;
            req.query.login = req.account.login;
            api.setAccountSecret(req.query, options, function(err) {
                api.sendJSON(req, err, {});
            });
            break;

        case "select/location":
            options.table = "bk_account";
            core.modules.locations.getLocation(req, options, function(err, data) {
                api.sendJSON(req, err, data);
            });
            break;

        case "get/icon":
            if (!req.query.id) req.query.id = req.account.id;
            if (!req.query.type) req.query.type = '0';
            req.query.prefix = 'account';
            options.cleanup = "bk_icon";
            core.modules.icons.getIcon(req, res, req.query.id, options);
            break;

        case "select/icon":
            if (!req.query.id) req.query.id = req.account.id;
            req.query.prefix = "account";
            options.cleanup = "bk_icon";
            core.modules.icons.selectIcon(req, options, function(err, rows) {
                api.sendJSON(req, err, rows);
            });
            break;

        case "put/icon":
        case "del/icon":
            options.op = req.params[0].substr(0, 3);
            req.query.prefix = 'account';
            req.query.id = req.account.id;
            if (!req.query.type) req.query.type = '0';
            core.modules.icons.handleIconRequest(req, res, options, function(err, rows) {
                api.sendJSON(req, err, rows);
            });
            break;

        case "get/status":
            self.getStatus(!req.query.id ? req.account.id : corelib.strSplit(req.query.id), options, function(err, rows) {
                api.sendJSON(req, err, rows);
            });
            break;

        case "put/status":
            req.query.id = req.account.id;
            req.query.alias = req.account.alias;
            self.putStatus(req.query, options, function(err, rows) {
                api.sendJSON(req, err, rows);
            });
            break;

        case "del/status":
            db.del("bk_status", { id: req.account.id }, options, function(err, rows) {
                api.sendJSON(req, err, rows);
            });
            break;

        default:
            api.sendReply(res, 400, "Invalid command");
        }
    });

    function onPostAccountRow(op, row, options, cols) {
        if (row.birthday) {
            row.age = Math.floor((Date.now() - corelib.toDate(row.birthday))/(86400000*365));
        }
    }
    db.setProcessRow("post", "bk_account", options, onPostAccountRow);

}

// Return an account, used in /account/get API call
accounts.getAccount = function(req, options, callback)
{
    var self = this;
    if (!req.query.id) {
        if (!req.account || !req.account.id) return callback({ status: 400, message: "invalid account" });
        db.get("bk_account", { id: req.account.id }, options, function(err, row, info) {
            if (err) return callback(err);
            if (!row) return callback({ status: 404, message: "account not found" });
            for (var p in row) req.account[p] = row[p];
            callback(null, req.account, info);
        });
    } else {
        db.list("bk_account", req.query.id, options, callback);
    }
}

// Send Push notification to the account, the actual transport delivery must be setup before calling this and passed in the options
// as handler: property which accepts the same arguments as this function. The delivery is not guaranteed, only will be sent if the account is considered
// "offline" according to the status and/or idle time. If the messages was queued for delivery, the row returned will contain the property sent:.
// The options may contain the following:
//  - msg - message text to send
//  - badge - a badge number to be sent
//  - prefix - prepend the message with this prefix
//  - check - check the account status, if not specified the message will be sent unconditionally otherwise only if idle
//  - allow - the account property to check if notifications are enabled, must be a boolean true or number > 0 to flag it is enabled, if it is an Array then
//      all properties in the array are checked against the account properties and all must allow notifications. If it is an object then only the object properties and values are checked.
//  - skip - Array or an object with account ids which should be skipped, this is for mass sending in order to reuse the same options
//  - logging - logging level about the notification send status, default is debug, can be any valid logger level, must be a string, not a number
//  - service - name of the standard delivery service supported by the backend, it is be used instead of custom handler, one of the following: apple, google
//  - device_id - the device to send the message to instesd of the device_id property fro the account record
//
// In addition the device_id can be saved in the format service://id where the service is one of the supported delivery services, this way the notification
// system will pick the right delivery service depending on the device id, the default service is apple.
accounts.notifyAccount = function(id, options, callback)
{
    var self = this;
    if (!id || !options) return callback({ status: 500, message: "invalid arguments, id, and options.handler must be provided" }, {});

    options = corelib.cloneObj(options);
    // Skip this account
    switch (corelib.typeName(options.skip)) {
    case "array":
        if (options.skip.indexOf(id) > -1) return callback({ status: 400, message: "skipped" }, {});
        break;
    case "object":
        if (options.skip[id]) return callback({ status: 400, message: "skipped" }, {});
        break;
    }

    core.modules.statuses.getStatus(id, {}, function(err, status) {
        if (err || (options.check && status.online)) return callback(err, status);

        db.get("bk_account", { id: id }, function(err, account) {
            if (err || !account) return callback(err || { status: 404, message: "account not found" }, status);
            if (!accounts.device_id && !options.device_id) return callback({ status: 404, message: "device not found" }, status);

            switch (corelib.typeName(options.allow)) {
            case "array":
                if (options.allow.some(function(x) { return !account[x] })) return callback({ status: 401, message: "not allowed" }, status);
                break;

            case "object":
                for (var p in options.allow) if (!options.allow[x]) return callback({ status: 401, message: "not allowed" }, status);
                break;

            case "string":
                if (!account[options.allow]) return callback({ status: 401, message: "not allowed" }, status);
                break;
            }

            // Ready to send now, set additional properties, if if the options will be reused we overwrite the same properties for each account
            options.status = status;
            options.account = account;
            if (!options.device_id) options.device_id = accounts.device_id;
            if (options.prefix) options.msg = options.prefix + " " + (options.msg || "");
            msg.send(options, function(err) {
                status.device_id = accounts.device_id;
                status.sent = err ? false : true;
                logger.logger(err ? "error" : (options.logging || "debug"), "notifyAccount:", id, accounts.alias, accounts.device_id, status, err || "");
                callback(err, status);
            });
        });
    });
}

// Return account details for the list of rows, options.key specified the column to use for the account id in the `rows`, or `id` will be used.
// The result accounts are cleaned for public columns, all original properties from the `rows` are kept as is.
// If options.existing is 1 then return only record with found accounts, all other records in the rows will be deleted
accounts.listAccount = function(rows, options, callback)
{
    var self = this;
    var key = options.key || "id";
    var map = {};
    rows.forEach(function(x) { if (!map[x[key]]) map[x[key]] = []; map[x[key]].push(x); });
    db.list("bk_account", Object.keys(map).map(function(x) { return { id: x } }), { select: options.select }, function(err, list, info) {
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

// Query accounts, used in /accout/select API call, simple wrapper around db.select but can be replaced in the apps while using the same API endpoint
accounts.selectAccount = function(req, options, callback)
{
    var self = this;
    db.select("bk_account", req.query, options, function(err, rows, info) {
        if (err) return callback(err, []);
        callback(err, api.getResultPage(req, options, rows, info));
    });
}

// Register new account, used in /account/add API call
accounts.addAccount = function(req, options, callback)
{
    var self = this;

    // Verify required fields
    if (!req.query.name && !req.query.alias) return callback({ status: 400, message: "name is required"});
    if (!req.query.alias && req.query.name) req.query.alias = req.query.name;
    if (!req.query.name && req.query.alias) req.query.name = req.query.alias;
    req.query.id = corelib.uuid();
    req.query.mtime = req.query.ctime = Date.now();

    corelib.series([
       function(next) {
           if (options.noauth) return next();
           if (!req.query.secret) return next({ status: 400, message: "secret is required"});
           if (!req.query.login) return next({ status: 400, message: "login is required"});
           // Copy for the auth table in case we have different properties that needs to be cleared
           var query = corelib.cloneObj(req.query);
           query.token_secret = true;
           api.prepareAccountSecret(query, options);
           // Put the secret back to return to the client, if generated or scrambled the client needs to know it for the API access
           req.query.secret = query.secret;
           if (!req.account || !api.checkAccountType(req.account, "admin")) api.clearQuery(query, options, "bk_auth", "admin");
           db.add("bk_auth", query, options, next);
       },
       function(next) {
           var query = corelib.cloneObj(req.query);
           // Only admin can add accounts with admin properties
           if (!req.account || !api.checkAccountType(req.account, "admin")) api.clearQuery(query, options, "bk_account", "admin");

           db.add("bk_account", query, function(err) {
               // Remove the record by login to make sure we can recreate it later
               if (err && !options.noauth) return db.del("bk_auth", { login: req.query.login }, function() { next(err); });
               next(err);
           });
       },
       function(next) {
           api.metrics.Counter('auth_add_0').inc();
           db.runProcessRows("post", "get", "bk_account", req.query, options);
           // Set all default values because we return in-memory record, not from the database
           var cols = db.getColumns("bk_account", options);
           for (var p in cols) if (typeof cols[p].value != "undefined") req.query[p] = cols[p].value;
           // Link account record for other middleware
           req.account = req.query;
           // Some dbs require the record to exist, just make one with default values
           db.put("bk_counter", req.query, function() { next(); });
       },
       ], function(err) {
           if (!err) req.query._added = true;
           callback(err, req.query);
    });
}

// Update existing account, used in /account/update API call
accounts.updateAccount = function(req, options, callback)
{
    var self = this;
    req.query.mtime = Date.now();
    // Cannot have account alias empty
    if (!req.query.alias) delete req.query.alias;

    corelib.series([
       function(next) {
           if (options.noauth) return next();
           // Copy for the auth table in case we have different properties that needs to be cleared
           var query = corelib.cloneObj(req.query);
           api.prepareAccountSecret(query, options);
           // Skip admin properties if any
           if (!api.checkAccountType(req.account, "admin")) api.clearQuery(query, options, "bk_auth", "admin");
           // Avoid updating bk_auth and flushing cache if nothing to update
           var obj = db.getQueryForKeys(Object.keys(db.getColumns("bk_auth", options)), query, { all_columns: 1, skip_columns: ["id","login","mtime"] });
           if (!Object.keys(obj).length) return callback(err, rows, info);
           db.update("bk_auth", query, next);
       },
       function(next) {
           // Skip admin properties if any
           if (!api.checkAccountType(req.account, "admin")) api.clearQuery(req.query, options, "bk_account", "admin");
           db.update("bk_account", req.query, next);
       },
       ], function(err) {
           if (!err) req.query._updated = true;
           callback(err, []);
    });
}

// Delete account specified by the obj. Used in `/account/del` API call.
// The options may contain keep: {} object with table names to be kept without the bk_ prefix, for example
// delete an account but keep all messages and location: keep: { message: 1, location: 1 }
accounts.deleteAccount = function(id, options, callback)
{
    var self = this;

    if (!id) return callback({ status: 400, message: "id must be specified" });

    if (!options.keep) options.keep = {};
    options.count = 1000000;

    db.get("bk_account", { id: id }, options, function(err, obj) {
        if (err) return callback(err);
        if (!obj) return callback({ status: 404, message: "No account found" });

        corelib.series([
           function(next) {
               if (options.keep.auth || !obj.login) return next();
               db.del("bk_auth", { login: obj.login }, options, next);
           },
           function(next) {
               if (options.keep.account) return next();
               db.del("bk_account", { id: obj.id }, options, function() { next() });
           },
           function(next) {
               if (options.keep.counter || !core.modules.counters) return next();
               db.del("bk_counter", { id: obj.id }, options, function() { next() });
           },
           function(next) {
               if (options.keep.connection || !core.modules.connections) return next();
               db.select("bk_connection", { id: obj.id }, options, function(err, rows) {
                   if (err) return next(err)
                   corelib.forEachSeries(rows, function(row, next2) {
                       db.del("bk_reference", { id: row.id, type: row.type + ":" + obj.id }, options, function(err) {
                           db.del("bk_connection", { id: obj.id, type: row.type + ":" + row.id }, options, next2);
                       });
                   }, function() { next() });
               });
           },
           function(next) {
               if (options.keep.message || !core.modules.messages) return next();
               db.delAll("bk_message", { id: obj.id }, options, function() { next() });
           },
           function(next) {
               if (options.keep.archive || !core.modules.messages) return next();
               db.delAll("bk_archive", { id: obj.id }, options, function() { next() });
           },
           function(next) {
               if (options.keep.sent || !core.modules.messages) return next();
               db.delAll("bk_sent", { id: obj.id }, options, function() { next() });
           },
           function(next) {
               if (options.keep.status) return next();
               db.del("bk_status", { id: obj.id }, options, function() { next() });
           },
           function(next) {
               if (options.keep.icon || !core.modules.icons) return next();
               db.delAll("bk_icon", { id: obj.id }, options, function(err, rows) {
                   if (options.keep.images) return next();
                   // Delete all image files
                   corelib.forEachSeries(rows, function(row, next2) {
                       api.formatIcon(row);
                       api.delIcon(obj.id, row, next2);
                   }, function() { next() });
               });
           },
           function(next) {
               if (options.keep.location || !obj.geohash || !core.modules.locations) return next();
               db.del("bk_location", obj, options, function() { next() });
           }],
           function(err) {
                if (!err) api.metrics.Counter('auth_del_0').inc();
                callback(err, obj);
        });
    });
}

// Returns status record for given account, used in /status/get API call.
// It always returns status object even if it was never set before, on return the record contains
// a property `online` set to true of false according to the idle period and actual status.
//
// If id is an array, then return all status records for specified list of account ids.
//
// If status was explicitely set to `offline` then it is considered offline until changed to to other value,
// for other cases `status` property is not used, it is supposed for the application extention.
//
accounts.getStatus = function(id, options, callback)
{
    var self = this;
    var now = Date.now();

    if (Array.isArray(id)) {
        db.list("bk_status", id, options, function(err, rows) {
            if (err) return callback(err);
            rows = rows.filter(function(x) {
                row.online = now - row.atime < self.statusInterval && row.status != "offline" ? true : false;
            });
            callback(err, rows);
        });
    } else {
        db.get("bk_status", { id: id }, options, function(err, row) {
            if (err) return callback(err);
            if (!row) row = { id: id, status: "", online: false, mtime: 0 };
            row.online = now - row.atime < self.statusInterval && row.status != "offline" ? true : false;
            callback(err, row);
        });
    }
}

// Maintain online status, update to db every status-interval seconds, if options.check is given only update db if last update happened
// longer than status-interval seconds ago, keep atime up-to-date in the cache on every status update.
// On return the row will have a property `saved` if it was flushed to db.
accounts.putStatus = function(obj, options, callback)
{
    var self = this;
    var now = Date.now();

    // Read the current record, check is handled differently in put
    self.getStatus(obj.id, options, function(err, row) {
        if (err) return callback(err);
        // Force db flush if last update was long time ago, otherwise just update the cache with the latest access time
        if (options.check && row.online && now - row.mtime < self.statusInterval * 1.5) {
            row.atime = now;
            db.putCache("bk_status", row, options);
            return callback(err, row);
        }
        for (var p in obj) row[p] = obj[p];
        row.atime = row.mtime = now;
        row.saved = true;
        db.put("bk_status", row, function(err) {
            callback(err, row);
        });
    });
}

// Override OAuth account management
accounts.fetchAccount = function(query, options, callback)
{
    var self = this;

    db.get("bk_auth", { login: query.login }, function(err, auth) {
        if (err) return callback(err);

        if (auth) {
            self.getAccount({ query: query }, options, function(err, row) {
                if (!err) for (var p in row) auth[p] = row[p];
                callback(err, auth);
            });
            return;
        }

        corelib.series([
            function(next) {
                // Pretend to be an admin
                self.addAccount({ query: query, account: { type: "admin" } }, options, function(err, row) {
                    if (row) query = row;
                    next(err);
                });
            },
            function(next) {
                if (!query.icon) return next();
                core.httpGet(query.icon, { binary: 1 }, function(err, params) {
                    if (err || !params.data.length) return next();
                    api.storeIcon(params.data, query.id, { prefix: "account", type: "0", width: options.width }, function(err) {
                        if (err) return next();
                        db.put("bk_icon", { id: query.id, prefix: "account", type:"account:0" }, options, function(err, rows) { next() });
                    });
                });
            },
            ], function(err) {
                callback(err, query);
            });
    });
}
