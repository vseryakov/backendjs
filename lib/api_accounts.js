//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var path = require('path');
var util = require('util');
var fs = require('fs');
var http = require('http');
var url = require('url');
var core = require(__dirname + '/../core');
var corelib = require(__dirname + '/../corelib');
var msg = require(__dirname + '/../msg');
var api = require(__dirname + '/../api');
var logger = require(__dirname + '/../logger');
var utils = require(__dirname + '/../build/Release/backend');

api.endpoints["account"] = "initAccountsAPI";

// Account management
api.initAccountsAPI = function()
{
    var self = this;
    var db = core.modules.db;

    this.app.all(/^\/account\/([a-z\/]+)$/, function(req, res, next) {
        var options = self.getOptions(req);

        switch (req.params[0]) {
        case "get":
            self.getAccount(req, options, function(err, data, info) {
                self.sendJSON(req, err, data);
            });
            break;

        case "add":
            self.addAccount(req, options, function(err, data) {
                self.sendJSON(req, err, data);
            });
            break;

        case "update":
            req.query.id = req.account.id;
            req.query.login = req.account.login;
            self.updateAccount(req, options, function(err, data) {
                self.sendJSON(req, err, data);
            });
            break;

        case "del":
            self.deleteAccount(req.account.id, options, function(err, data) {
                self.sendJSON(req, err, data);
            });
            break;

        case "subscribe":
            self.subscribe(req);
            break;

        case "select":
            self.selectAccount(req, options, function(err, data) {
                self.sendJSON(req, err, data);
            });
            break;

        case "put/secret":
            req.query.id = req.account.id;
            req.query.login = req.account.login;
            self.setAccountSecret(req, options, function(err) {
                self.sendJSON(req, err, {});
            });
            break;

        case "select/location":
            options.table = "bk_account";
            self.getLocation(req, options, function(err, data) {
                self.sendJSON(req, err, data);
            });
            break;

        case "get/icon":
            if (!req.query.id) req.query.id = req.account.id;
            if (!req.query.type) req.query.type = '0';
            req.query.prefix = 'account';
            options.cleanup = "bk_icon";
            self.getIcon(req, res, req.query.id, options);
            break;

        case "select/icon":
            if (!req.query.id) req.query.id = req.account.id;
            req.query.prefix = "account";
            options.cleanup = "bk_icon";
            self.selectIcon(req, options, function(err, rows) {
                self.sendJSON(req, err, rows);
            });
            break;

        case "put/icon":
        case "del/icon":
            options.op = req.params[0].substr(0, 3);
            req.query.prefix = 'account';
            req.query.id = req.account.id;
            if (!req.query.type) req.query.type = '0';
            self.handleIconRequest(req, res, options, function(err, rows) {
                self.sendJSON(req, err, rows);
            });
            break;

        default:
            self.sendReply(res, 400, "Invalid command");
        }
    });
}

// Return an account, used in /account/get API call
api.getAccount = function(req, options, callback)
{
    var self = this;
    var db = core.modules.db;
    if (!req.query.id) {
        db.get("bk_account", { id: req.account.id }, options, function(err, row, info) {
            if (err) return callback(err);
            if (!row) return callback({ status: 404, message: "account not found" });
            for (var p in row) req.account[p] = row[p];
            self.createSessionSignature(req, options);
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
api.notifyAccount = function(id, options, callback)
{
    var self = this;
    var db = core.modules.db;
    var ipc = core.modules.ipc;
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

    this.getStatus(id, {}, function(err, status) {
        if (err || (options.check && status.online)) return callback(err, status);

        db.get("bk_account", { id: id }, function(err, account) {
            if (err || !account) return callback(err || { status: 404, message: "account not found" }, status);
            if (!account.device_id && !options.device_id) return callback({ status: 404, message: "device not found" }, status);

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
            if (!options.device_id) options.device_id = account.device_id;
            if (options.prefix) options.msg = options.prefix + " " + (options.msg || "");
            msg.send(options, function(err) {
                status.device_id = account.device_id;
                status.sent = err ? false : true;
                logger.logger(err ? "error" : (options.logging || "debug"), "notifyAccount:", id, account.alias, account.device_id, status, err || "");
                callback(err, status);
            });
        });
    });
}

// Return account details for the list of rows, options.key specified the column to use for the account id in the `rows`, or `id` will be used.
// The result accounts are cleaned for public columns, all original properties from the `rows` are kept as is.
// If options.existing is 1 then return only record with found accounts, all other records in the rows will be deleted
api.listAccount = function(rows, options, callback)
{
    var self = this;
    var db = core.modules.db;
    var key = options.key || "id";
    var map = {};
    rows.forEach(function(x) { if (!map[x[key]]) map[x[key]] = []; map[x[key]].push(x); });
    db.list("bk_account", Object.keys(map).map(function(x) { return { id: x } }), { select: options.select }, function(err, list, info) {
        if (err) return callback(err, []);

        self.checkPublicColumns("bk_account", list, options);
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
api.selectAccount = function(req, options, callback)
{
    var self = this;
    var db = core.modules.db;
    db.select("bk_account", req.query, options, function(err, rows, info) {
        if (err) return callback(err, []);
        callback(err, self.getResultPage(req, options, rows, info));
    });
}

// Register new account, used in /account/add API call
api.addAccount = function(req, options, callback)
{
    var self = this;
    var db = core.modules.db;

    // Verify required fields
    if (!req.query.name && !req.query.alias) return callback({ status: 400, message: "name is required"});
    if (!req.query.alias && req.query.name) req.query.alias = req.query.name;
    if (!req.query.name && req.query.alias) req.query.name = req.query.alias;
    req.query.id = corelib.uuid();
    req.query.token_secret = corelib.uuid();
    req.query.mtime = req.query.ctime = Date.now();

    corelib.series([
       function(next) {
           if (options.noauth) return next();
           if (!req.query.secret) return next({ status: 400, message: "secret is required"});
           if (!req.query.login) return next({ status: 400, message: "login is required"});
           // Copy for the auth table in case we have different properties that needs to be cleared
           var query = corelib.cloneObj(req.query);
           if (!req.account || req.account.type != "admin") self.clearQuery(query, options, "bk_auth", "admin");
           self.clearQuery(query, options, "bk_auth", "priv");
           db.add("bk_auth", query, options, next);
       },
       function(next) {
           var query = corelib.cloneObj(req.query);
           // Only admin can add accounts with admin properties
           if (!req.account || req.account.type != "admin") self.clearQuery(query, options, "bk_account", "admin");
           self.clearQuery(query, options, "bk_account", "priv");
           self.clearQuery(query, options, "bk_account", "location");

           db.add("bk_account", query, function(err) {
               // Remove the record by login to make sure we can recreate it later
               if (err && !options.noauth) return db.del("bk_auth", { login: req.query.login }, function() { next(err); });
               next(err);
           });
       },
       function(next) {
           self.metrics.Counter('auth_add_0').inc();
           db.processRows(null, "bk_account", req.query, options);
           // Link account record for other middleware
           req.account = req.query;
           // Set all default values because we return in-memory record, not from the database
           var cols = db.getColumns("bk_account", options);
           for (var p in cols) if (typeof cols[p].value != "undefined") req.query[p] = cols[p].value;
           // Some dbs require the record to exist, just make one with default values
           db.put("bk_counter", req.query, function() { next(); });
       },
       ], function(err) {
            callback(err, req.query);
    });
}

// Given a profile data from some other system, check if there is an account or create a new account for the given
// profile, return bk_account record in the callback. req.query contains profile fields converted to bk_auth/bk_account names
// so the whole req.query can be saved as it is. `req.query.login` must exist.
//
// This method is supposed to be called after the user is authenticated and verified, it does not
// check secrets but only existence of a user by login. If  user with login exists, this works as `api.getAccount`
// with an extra call to bk_auth. On success the current account is active and set as `req.account`.
//
// If new account ws created, the generated secret will be returned and must be saved by the client for subsequent
// API calls unless cookie session is established.
//
// if `req.query.icon' is set with the url of the profile image, it will be downloaded and saved as account icon type `0`. `options.width`
// if specified will be used to resize the image.
api.fetchAccount = function(req, options, callback)
{
    var self = this;
    var db = core.modules.db;

    db.get("bk_auth", { login: req.query.login }, function(err, auth) {
        if (err) return callback(err);

        if (auth) {
            req.account = auth;
            self.getAccount(req, options, function(err, row) {
                if (err) return callback(err);
                for (var p in row) req.account[p] = row[p];
                callback(null, req.account);
            });
            return;
        }

        corelib.series([
            function(next) {
                self.addAccount(req, options, function(err, row) {
                    if (err) return next(err);
                    req.account = row;
                    next();
                });
            },
            function(next) {
                if (!req.query.icon) return next();
                core.httpGet(req.query.icon, { binary: 1 }, function(err, params) {
                    if (err || !params.data.length) return next();
                    self.storeIcon(params.data, req.account.id, { prefix: "account", type: "0", width: options.width }, function(err) {
                        if (err) return next();
                        db.put("bk_icon", { id: req.account.id, prefix: "account", type:"account:0" }, options, function(err, rows) { next() });
                    });
                });
            },
            function(next) {
                // Set session cookies if needed for new account
                self.createSessionSignature(req, options);
                next();
            },
            ], function(err) {
                callback(err, req.account);
            });
    });
}

// Update existing account, used in /account/update API call
api.updateAccount = function(req, options, callback)
{
    var self = this;
    var db = core.modules.db;
    req.query.mtime = Date.now();
    // Cannot reset account alias
    if (!req.query.alias) delete req.query.alias;

    corelib.series([
       function(next) {
           if (options.noauth) return next();
           // Copy for the auth table in case we have different properties that needs to be cleared
           var query = corelib.cloneObj(req.query);
           // Skip admin properties if any
           if (req.account.type != "admin") self.clearQuery(query, options, "bk_auth", "admin");
           self.clearQuery(query, options, "bk_auth", "priv");
           // Avoid updating bk_auth and flushing cache if nothing to update
           var obj = db.getQueryForKeys(Object.keys(db.getColumns("bk_auth", options)), query, { all_columns: 1, skip_columns: ["id","login","mtime"] });
           if (!Object.keys(obj).length) return callback(err, rows, info);
           db.update("bk_auth", query, next);
       },
       function(next) {
           self.clearQuery(req.query, options, "bk_account", "priv");
           self.clearQuery(req.query, options, "bk_account", "location");

           // Skip admin properties if any
           if (req.account.type != "admin") self.clearQuery(req.query, options, "bk_account", "admin");
           db.update("bk_account", req.query, next);
       },
       ], function(err) {
            callback(err, []);
    });
}

// Change account secret, used in /account/put/secret API call
api.setAccountSecret = function(req, options, callback)
{
    var db = core.modules.db;
    if (!req.query.secret && !req.query.token_secret) return callback({ status: 400, message: "secret or token_secret is required" });
    // Ignore the supplied vale, always set with new uuid
    if (req.query.token_secret) req.query.token_secret = corelib.uuid();
    db.update("bk_auth", { login: req.query.login, secret: req.query.secret, token_secret: req.query.token_secret }, options, callback);
}

// Delete account specified by the obj. Used in `/account/del` API call.
// The options may contain keep: {} object with table names to be kept without the bk_ prefix, for example
// delete an account but keep all messages and location: keep: { message: 1, location: 1 }
api.deleteAccount = function(id, options, callback)
{
    var self = this;

    if (!id) return callback({ status: 400, message: "id must be specified" });

    var db = core.modules.db;
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
               if (options.keep.counter) return next();
               db.del("bk_counter", { id: obj.id }, options, function() { next() });
           },
           function(next) {
               if (options.keep.connection) return next();
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
               if (options.keep.message) return next();
               db.delAll("bk_message", { id: obj.id }, options, function() { next() });
           },
           function(next) {
               if (options.keep.archive) return next();
               db.delAll("bk_archive", { id: obj.id }, options, function() { next() });
           },
           function(next) {
               if (options.keep.sent) return next();
               db.delAll("bk_sent", { id: obj.id }, options, function() { next() });
           },
           function(next) {
               if (options.keep.status) return next();
               db.del("bk_status", { id: obj.id }, options, function() { next() });
           },
           function(next) {
               if (options.keep.icon) return next();
               db.delAll("bk_icon", { id: obj.id }, options, function(err, rows) {
                   if (options.keep.images) return next();
                   // Delete all image files
                   corelib.forEachSeries(rows, function(row, next2) {
                       self.formatIcon(row);
                       self.delIcon(obj.id, row, next2);
                   }, function() { next() });
               });
           },
           function(next) {
               if (options.keep.location || !obj.geohash) return next();
               db.del("bk_location", obj, options, function() { next() });
           }],
           function(err) {
                if (!err) self.metrics.Counter('auth_del_0').inc();
                callback(err, obj);
        });
    });
}

