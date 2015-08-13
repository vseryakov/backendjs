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
var lib = bkjs.lib;
var logger = bkjs.logger;

// Connections management
var connections = {
    name: "connections",
    allow: {},
};
module.exports = connections;

// Initialize the module
connections.init = function(options)
{
    core.describeArgs("connections", [
         { name: "allow", type: "map", descr: "Map of connection type to operations to be allowed only, once a type is specified, all operations must be defined, the format is: type:op,type:op..." },
    ]);

    db.describeTables({
            // All connections between accounts: like,dislike,friend...
            bk_connection: { id: { primary: 1, pub: 1 },                    // my account_id
                             type: { primary: 1,                            // connection type:peer
                                     pub: 1,
                                     join: ["type","peer"],
                                     unjoin: ["type","peer"],
                                     ops: { select: "begins_with" } },
                             peer: { pub: 1 },                              // other id of the connection
                             alias: { pub: 1 },
                             status: {},
                             mtime: { type: "bigint", now: 1, pub: 1 }
                          },

            // References from other accounts, likes,dislikes...
            bk_reference: { id: { primary: 1, pub: 1 },                    // account_id
                            type: { primary: 1,                            // reference type:peer
                                    pub: 1,
                                    join: ["type","peer"],
                                    unjoin: ["type","peer"],
                                    ops: { select: "begins_with" } },
                            peer: { pub: 1 },                              // other id of the connection
                            alias: { pub: 1 },
                            status: {},
                            mtime: { type: "bigint", now: 1, pub: 1 }
                          },

            // Metrics
            bk_collect: { url_connection_get_rmean: { type: "real" },
                          url_connection_get_hmean: { type: "real" },
                          url_connection_get_0: { type: "real" },
                          url_connection_get_bad_0: { type: "real" },
                          url_connection_select_rmean: { type: "real" },
                          url_connection_select_hmean: { type: "real" },
                          url_connection_select_0: { type: "real" },
                          url_connection_select_bad_0: { type: "real" },
                          url_connection_add_rmean: { type: "real" },
                          url_connection_add_hmean: { type: "real" },
                          url_connection_add_0: { type: "real" },
                          url_connection_add_bad_0: { type: "real" },
                          url_connection_add_err_0: { type: "real" },
                          url_connection_incr_rmean: { type: "real" },
                          url_connection_incr_hmean: { type: "real" },
                          url_connection_incr_0: { type: "real" },
                          url_connection_incr_bad_0: { type: "real" },
                          url_connection_incr_err_0: { type: "real" },
                          url_connection_del_rmean: { type: "real" },
                          url_connection_del_hmean: { type: "real" },
                          url_connection_del_0: { type: "real" },
                          url_connection_del_bad_0: { type: "real" },
                          url_connection_del_err_0: { type: "real" },
                      },

    });
}

// Create API endpoints and routes
connections.configureWeb = function(options, callback)
{
    this.configureConnectionsAPI();
    callback()
};

// Connections management
connections.configureConnectionsAPI = function()
{
    var self = this;

    api.app.all(/^\/(connection|reference)\/([a-z]+)$/, function(req, res) {
        var options = api.getOptions(req);

        switch (req.params[1]) {
        case "add":
        case "put":
        case "incr":
        case "update":
            options.op = req.params[1];
            self.putConnection(req, options, function(err, data) {
                api.sendJSON(req, err, data);
            });
            break;

        case "del":
            self.delConnection(req, options, function(err, data) {
                api.sendJSON(req, err, data);
            });
            break;

        case "get":
            options.op = req.params[0];
            options.cleanup = "";
            self.getConnection(req, options, function(err, data) {
                api.sendJSON(req, err, data);
            });
            break;

        case "select":
            options.op = req.params[0];
            options.cleanup = "";
            self.selectConnection(req, options, function(err, data) {
                api.sendJSON(req, err, data);
            });
            break;

        default:
            api.sendReply(res, 400, "Invalid command");
        }
    });
}

// Return one connection for the current account, this function is called by the `/connection/get` API call.
connections.getConnection = function(req, options, callback)
{
    var self = this;
    if (!req.query.peer || !req.query.type) return callback({ status: 400, message: "peer and type are required"});
    this.readConnection(req.account.id, req.query, options, callback);
}

// Return all connections for the current account, this function is called by the `/connection/select` API call.
connections.selectConnection = function(req, options, callback)
{
    var self = this;
    this.queryConnection(req.account.id, req.query, options, function(err, rows, info) {
        callback(null, api.getResultPage(req, options, rows, info));
    });
}

// Create a connection between 2 accounts, this function is called by the `/connection/add` API call with query parameters coming from the Express request.
connections.putConnection = function(req, options, callback)
{
    var op = options.op || 'put';

    if (!req.query.peer || !req.query.type) return callback({ status: 400, message: "peer and type are required"});
    if (req.query.peer == req.account.id) return callback({ status: 400, message: "cannot connect to itself"});

    // Check for allowed connection types
    if (this.allow[req.query.type] && !this.allow[req.query.type][op]) return callback({ status: 400, message: "invalid connection type"});

    req.query.id = req.query.peer;
    this.makeConnection(req.account, req.query, options, callback)
}

// Delete a connection, this function is called by the `/connection/del` API call
connections.delConnection = function(req, options, callback)
{
    this.deleteConnection(req.account.id, req.query, options, callback);
}

// Return all connections for the account id with optional query properties
connections.queryConnection = function(id, obj, options, callback)
{
    obj = lib.cloneObj(obj, 'id', id);

    db.select("bk_" + (options.op || "connection"), obj, options, function(err, rows, info) {
        if (err) return callback(err, []);

        // Just return connections
        if (!lib.toNumber(options.accounts) || !core.modules.accounts) return callback(null, rows, info);

        // Get all account records for the id list
        core.modules.accounts.listAccount(rows, lib.extendObj(options, "account_key", "peer"), callback);
    });
}

// Return one connection for given id, obj must have .peer and .type properties defined,
// if options.accounts is 1 then combine with account record.
connections.readConnection = function(id, obj, options, callback)
{
    db.get("bk_" + (options.op || "connection"), { id: id, type: obj.type, peer: obj.peer }, options, function(err, row) {
        if (err) return callback(err, {});
        if (!row) return callback({ status: 404, message: "no connection" }, {});

        // Just return connections
        if (!lib.toNumber(options.accounts) || !core.modules.accounts) return callback(err, row);

        // Get account details for connection
        core.modules.accounts.listAccount(row, lib.extendObj(options, "account_key", "peer"), function(err, rows) {
            callback(null, row);
        });
    });
}

// Lower level connection creation with all counters support, can be used outside of the current account scope for
// any two accounts and arbitrary properties, `obj` is the primary account, `peer` contains id and type for other account
// with other properties to be added. Both objects are left untouched.
//
// Both objects must have at least the `id` properties.
//
// Connection `type` will be taken from the `peer` object only.
//
// To maintain aliases for both sides of the connection, set `alias` property in the both objects.
//
// Note: All other properties for both tables are treated separately, to make them appear in both they must be copied into the both objects.
//
// The following options properties can be used:
// - publish - send notification via pub/sub system if present
// - autocounter - if a number and not zero it will be used to update auto increment counters
// - noreference - do not create reference part of the connection
// - connected - return existing connection record for the same type from the peer account
connections.makeConnection = function(obj, peer, options, callback)
{
    var self = this;
    var now = Date.now();
    var op = options.op || 'put';
    var obj1 = lib.cloneObj(obj);
    var obj2 = lib.cloneObj(peer);
    var result = {};
    // Primary keys pointing to each other
    obj1.type = peer.type;
    obj1.peer = peer.id;
    obj1.alias = peer.alias;
    obj1.mtime = now;
    obj2.peer = obj.id;
    obj2.alias = obj.alias;
    obj2.mtime = now;

    lib.series([
        function(next) {
            // Primary connection
            if (options.noconnection) return next();
            db[op]("bk_connection", obj1, options, function(err) {
                if (err) return next(err);
                api.metrics.Counter(op + "_" + obj1.type + '_0').inc();
                next();
            });
        },
        function(next) {
            // Reverse connection, a reference
            if (options.noreference) return next();
            db[op]("bk_reference", obj2, options, function(err) {
                // Remove on error
                if (err && (op == "add" || op == "put")) return db.del("bk_connection", { id: obj1.id, type: obj1.type, peer: obj1.peer }, function() { next(err); });
                next(err);
            });
        },
        function(next) {
            // Keep track of all connection counters
            if (!options.autocounter || !core.modules.counters) return next();
            core.modules.counters.incrAutoCounter(obj1.id, obj1.type + '0', options.autocounter, options, function(err) { next() });
        },
        function(next) {
            if (!options.autocounter || !core.modules.counters) return next();
            core.modules.counters.incrAutoCounter(obj2.id, obj2.type + '1', options.autocounter, options, function(err) { next(); });
        },
        function(next) {
            // Notify about connection the other side
            if (!options.publish) return next();
            api.publish(obj2.id, { path: "/connection/" + op, mtime: now, alias: obj1.alias, type: obj1.type }, options);
            next();
        },
        function(next) {
            // We need to know if the other side is connected too, this will save one extra API call later
            if (!options.connected) return next();
            db.get("bk_connection", { id: obj2.id, type: obj2.type, peer: obj2.peer }, options, function(err, row) {
                if (row) result = row;
                next(err);
            });
        },
        ], function(err) {
            callback(err, result);
    });
}

// Lower level connection deletion, for given account `id`, the other id and type is in the `obj`, performs deletion of all
// connections. If any of obj.id or obj.type are not specified then perform a query for matching connections and delete only matched connection.
connections.deleteConnection = function(id, obj, options, callback)
{
    var self = this;
    var now = Date.now();

    function del(row, cb) {
        api.metrics.Counter('del_' + row.type + '_0').inc();

        lib.series([
           function(next) {
               db.del("bk_connection", { id: id, type: row.type, peer: row.peer }, options, next);
           },
           function(next) {
               if (!options.autocounter || !core.modules.counters) return next();
               core.modules.counters.incrAutoCounter(id, row.type + '0', -1, options, function() { next(); });
           },
           function(next) {
               if (options.noreference) return next();
               db.del("bk_reference", { id: row.peer, type: row.type, peer: id }, options, next);
           },
           function(next) {
               if (options.noreference) return next();
               if (!options.autocounter || !core.modules.counters) return next();
               core.modules.counters.incrAutoCounter(row.peer, row.type + '1', -1, options, function() { next() });
           }
           ], function(err) {
               cb(err, []);
        });
    }

    // Check for allowed connection types
    if (obj.type) {
        if (self.allow[obj.type] && !self.allow[obj.type]['del']) return callback({ status: 400, message: "cannot delete connection"});
    }

    // Single deletion
    if (obj.peer && obj.type) return del(obj, callback);

    // Delete by query, my records
    db.select("bk_connection", { id: id, type: obj.type, peer: obj.peer }, options, function(err, rows) {
        if (err) return callback(err, []);

        lib.forEachSeries(rows, function(row, next) {
            if (obj.peer && row.peer != obj.peer) return next();
            if (obj.type && row.type != obj.type) return next();
            // Silently skip connections we cannot delete
            if (self.allow[row.type] && !self.allow[row.type]['del']) return next();
            del(row, next);
        }, function(err) {
            callback(err, []);
        });
    });
}
