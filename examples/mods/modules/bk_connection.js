//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
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
var mod = {
    name: "bk_connection",
    tables: {
        // All connections between accounts: like,dislike,friend...
        bk_connection: {
            id: { primary: 1, pub: 1 },                    // my account_id
            type: { primary: 1,                            // connection type:peer
                pub: 1,
                join: ["type","peer"],
                unjoin: 1,
                ops: { select: "begins_with" } },
            peer: { pub: 1 },                              // peer id
            name: { pub: 1 },                             // peer name
            status: {},
            mtime: { type: "now", pub: 1 }
        },

        // References from other accounts, likes,dislikes...
        bk_reference: {
            id: { primary: 1, pub: 1 },                    // account_id
            type: { primary: 1,                            // reference type:peer
                pub: 1,
                join: ["type","peer"],
                unjoin: 1,
                ops: { select: "begins_with" } },
            peer: { pub: 1 },                              // peer id
            name: { pub: 1 },                             // peer name
            status: {},
            mtime: { type: "now", pub: 1 }
        },
    },
    allow: {},
    controls: {
        connected: { type: "bool" },
    }
};
module.exports = mod;

// Initialize the module
mod.init = function(options)
{
    core.describeArgs("connections", [
         { name: "allow", array: 1, type: "map", descr: "Map of connection type to operations to be allowed only, once a type is specified, all operations must be defined, the format is: type:op,type:op..." },
    ]);
}

mod.configureMiddleware = function(options, callback)
{
    api.registerControlParams(mod.controls);
    callback();
}

// Create API endpoints and routes
mod.configureWeb = function(options, callback)
{
    this.configureConnectionsAPI();
    callback()
};

// Connections management
mod.configureConnectionsAPI = function()
{
    var self = this;

    api.app.all(/^\/(connection|reference)\/([a-z]+)$/, function(req, res) {
        var options = api.getOptions(req, mod.controls);
        options.cleanup = "bk_" + req.params[0];

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
mod.getConnection = function(req, options, callback)
{
    if (!req.query.peer || !req.query.type) return callback({ status: 400, message: "peer and type are required"});
    this.readConnection(req.account.id, req.query, options, callback);
}

// Return all connections for the current account, this function is called by the `/connection/select` API call.
mod.selectConnection = function(req, options, callback)
{
    this.queryConnection(req.account.id, req.query, options, function(err, rows, info) {
        callback(null, api.getResultPage(req, options, rows, info));
    });
}

// Create a connection between 2 accounts, this function is called by the `/connection/add` API call with query parameters coming from the Express request.
mod.putConnection = function(req, options, callback)
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
mod.delConnection = function(req, options, callback)
{
    this.deleteConnection(req.account.id, req.query, options, callback);
}

// Return all connections for the account id with optional query properties
mod.queryConnection = function(id, obj, options, callback)
{
    obj = lib.objClone(obj, 'id', id);

    db.select("bk_" + (options.op || "connection"), obj, options, function(err, rows, info) {
        callback(null, rows, info);
    });
}

// Return one connection for given id, obj must have .peer and .type properties defined,
mod.readConnection = function(id, obj, options, callback)
{
    db.get("bk_" + (options.op || "connection"), { id: id, type: obj.type, peer: obj.peer }, options, function(err, row) {
        if (err) return callback(err, {});
        if (!row) return callback({ status: 404, message: "no connection" }, {});
        callback(err, row);
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
// To maintain names for both sides of the connection, set `name` property in the both objects.
//
// Note: All other properties for both tables are treated separately, to make them appear in both they must be copied into the both objects.
//
// The following options properties can be used:
// - connected - return existing connection record for the same type from the peer account
// - noreference - do not create reference record for reverse connection
mod.makeConnection = function(obj, peer, options, callback)
{
    var self = this;
    var now = Date.now();
    var op = options.op || 'put';
    var obj1 = lib.objClone(obj);
    var obj2 = lib.objClone(peer);
    var result = {};
    // Primary keys pointing to each other
    obj1.type = peer.type;
    obj1.peer = peer.id;
    obj1.name = peer.name;
    obj1.mtime = now;
    obj2.peer = obj.id;
    obj2.name = obj.name;
    obj2.mtime = now;

    lib.series([
        function(next) {
            // Primary connection
            db[op]("bk_connection", obj1, function(err) {
                if (err) return next(err);
                next();
            });
        },
        function(next) {
            // Reverse connection, a reference
            if (options.noreference) return next();
            db[op]("bk_reference", obj2, function(err) {
                // Remove on error
                if (err && (op == "add" || op == "put")) return db.del("bk_connection", { id: obj1.id, type: obj1.type, peer: obj1.peer }, function() { next(err); });
                next(err);
            });
        },
        function(next) {
            // We need to know if the other side is connected too, this will save one extra API call later
            if (!options.connected) return next();
            db.get("bk_connection", { id: obj2.id, type: obj2.type, peer: obj2.peer }, function(err, row) {
                if (row) result = row;
                next(err);
            });
        },
    ], function(err) {
        callback(err, result);
    });
}

// Lower level connection deletion, for given account `id`, the other id and type is in the `obj`, performs deletion of all connections.
// If any of obj.id or obj.type are not specified then perform a query for matching connections and delete only matched connection.
mod.deleteConnection = function(id, obj, options, callback)
{
    var self = this;
    var now = Date.now();

    function del(row, cb) {

        lib.series([
           function(next) {
               db.del("bk_connection", { id: id, type: row.type, peer: row.peer }, next);
           },
           function(next) {
               if (options.noreference) return next();
               db.del("bk_reference", { id: row.peer, type: row.type, peer: id }, next);
           },
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

mod.bkDeleteAccount = function(req, callback)
{
    if (lib.isFlag(req.options.keep, ["all","account","bk_connection"])) return callback();
    db.select("bk_connection", { id: req.account.id }, function(err, rows) {
        if (err) return callback();
        lib.forEachSeries(rows, function(row, next) {
            db.del("bk_reference", { id: row.peer, type: row.type, peer: row.id }, function(err) {
                db.del("bk_connection", { id: row.id, type: row.type, peer: row.peer }, next);
            });
        }, callback);
    });
}
