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
var msg = require(__dirname + '/../msg');
var api = require(__dirname + '/../api');
var logger = require(__dirname + '/../logger');
var utils = require(__dirname + '/../build/Release/backend');

api.endpoints["connection"] = "initConnectionsAPI";

// Connections management
api.initConnectionsAPI = function()
{
    var self = this;
    var db = core.modules.db;

    this.app.all(/^\/(connection|reference)\/([a-z]+)$/, function(req, res) {
        var options = self.getOptions(req);

        switch (req.params[1]) {
        case "add":
        case "put":
        case "incr":
        case "update":
            options.op = req.params[1];
            self.putConnection(req, options, function(err, data) {
                self.sendJSON(req, err, data);
            });
            break;

        case "del":
            self.delConnection(req, options, function(err, data) {
                self.sendJSON(req, err, data);
            });
            break;

        case "get":
            options.op = req.params[0];
            options.cleanup = "";
            self.getConnection(req, options, function(err, data) {
                self.sendJSON(req, err, data);
            });
            break;

        case "select":
            options.op = req.params[0];
            options.cleanup = "";
            self.selectConnection(req, options, function(err, data) {
                self.sendJSON(req, err, data);
            });
            break;

        default:
            self.sendReply(res, 400, "Invalid command");
        }
    });
}

// Return all connections for the current account, this function is called by the `/connection/get` API call.
api.getConnection = function(req, options, callback)
{
    var self = this;
    if (!req.query.id || !req.query.type) return callback({ status: 400, message: "id and type are required"});
    this.readConnection(req.account.id, req.query, options, callback);
}

// Return all connections for the current account, this function is called by the `/connection/select` API call.
api.selectConnection = function(req, options, callback)
{
    var self = this;
    this.queryConnection(req.account.id, req.query, options, function(err, rows, info) {
        callback(null, self.getResultPage(req, options, rows, info));
    });
}

// Create a connection between 2 accounts, this function is called by the `/connection/add` API call with query parameters coming from the Express request.
api.putConnection = function(req, options, callback)
{
    var self = this;
    var op = options.op || 'put';

    if (!req.query.id || !req.query.type) return callback({ status: 400, message: "id and type are required"});
    if (req.query.id == req.account.id) return callback({ status: 400, message: "cannot connect to itself"});

    // Check for allowed connection types
    if (self.allowConnection[req.query.type] && !self.allowConnection[req.query.type][op]) return callback({ status: 400, message: "invalid connection type"});

    this.makeConnection(req.account.id, req.query, options, callback)
}

// Delete a connection, this function is called by the `/connection/del` API call
api.delConnection = function(req, options, callback)
{
    var self = this;
    self.deleteConnection(req.account.id, req.query, options, callback);
}

// Return all connections for the account id with optional query properties, obj.type should not include :
api.queryConnection = function(id, obj, options, callback)
{
    var self = this;
    var db = core.modules.db;

    var query = { id: id, type: obj.type ? (obj.type + ":" + (obj.id || "")) : "" };
    for (var p in obj) if (p != "id" && p != "type") query[p] = obj[p];

    if (!options.ops) options.ops = {};
    if (!options.ops.type) options.ops.type = "begins_with";

    db.select("bk_" + (options.op || "connection"), query, options, function(err, rows, info) {
        if (err) return callback(err, []);

        // Just return connections
        if (!core.toNumber(options.details)) return callback(null, rows, info);

        // Get all account records for the id list
        self.listAccount(rows, options, callback);
    });
}

// Return one connection for given id, obj must have .id and .type properties defined,
// if options.details is 1 then combine with account record.
api.readConnection = function(id, obj, options, callback)
{
    var self = this;
    var db = core.modules.db;

    var query = { id: id, type: obj.type + ":" + obj.id };
    for (var p in obj) if (p != "id" && p != "type") query[p] = obj[p];

    db.get("bk_" + (options.op || "connection"), query, options, function(err, row) {
        if (err) return callback(err, {});
        if (!row) return callback({ status: 404, message: "no connection" }, {});

        // Just return connections
        if (!core.toNumber(options.details)) return callback(err, row);

        // Get account details for connection
        self.listAccount([ row ], options, function(err, rows) {
            callback(null, row);
        });
    });
}

// Lower level connection creation with all counters support, can be used outside of the current account scope for
// any two accounts and arbitrary properties, `id` is the primary account id, `obj` contains id and type for other account
// with other properties to be added. `obj` is left untouched.
//
// To maintain aliases for both sides of the connection, set alias in the obj for the bk_connection and options.alias for bk_reference.
//
// The following properties can alter the actions:
// - publish - send notification via pub/sub system if present
// - nocounter - do not update auto increment counters
// - noreference - do not create reference part of the connection
// - connected - return existing connection record for the same type from the other account
// - alias - an alias for the reference record for cases wen connecting 2 different accounts, it has preference over options.account.
// - account - an object with account properties like id, alias to be used in the connection/reference records, specifically options.account.alias will
//   be used for the reference record to show the alias of the other account, for the primary connection obj.alias is used if defined.
api.makeConnection = function(id, obj, options, callback)
{
    var self = this;
    var db = core.modules.db;
    var now = Date.now();
    var op = options.op || 'put';
    var query = core.cloneObj(obj);
    var result = {};

    core.series([
        function(next) {
            // Primary connection
            if (options.noconnection) return next();
            query.id = id;
            query.type = obj.type + ":" + obj.id;
            query.mtime = now;
            db[op]("bk_connection", query, options, function(err) {
                if (err) return next(err);
                self.metrics.Counter(op + "_" + obj.type + '_0').inc();
                next();
            });
        },
        function(next) {
            // Reverse connection, a reference
            if (options.noreference) return next();
            query.id = obj.id;
            query.type = obj.type + ":"+ id;
            if (options.alias) query.alias = options.alias;
            db[op]("bk_reference", query, options, function(err) {
                // Remove on error
                if (err && (op == "add" || op == "put")) return db.del("bk_connection", { id: id, type: obj.type + ":" + obj.id }, function() { next(err); });
                next(err);
            });
        },
        function(next) {
            // Keep track of all connection counters
            if (options.nocounter || (op != "add" && op != "put")) return next();
            self.incrAutoCounter(id, obj.type + '0', 1, options, function(err) { next() });
        },
        function(next) {
            if (options.nocounter || (op != "add" && op != "put")) return next();
            self.incrAutoCounter(obj.id, obj.type + '1', 1, options, function(err) { next(); });
        },
        function(next) {
            // Notify about connection the other side
            if (!options.publish) return next();
            self.publish(obj.id, { path: "/connection/" + op, mtime: now, alias: options.alias || obj.alias, type: obj.type }, options);
            next();
        },
        function(next) {
            // We need to know if the other side is connected too, this will save one extra API call later
            if (!options.connected) return next();
            db.get("bk_connection", { id: obj.id, type: obj.type + ":" + id }, options, function(err, row) {
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
api.deleteConnection = function(id, obj, options, callback)
{
    var self = this;
    var db = core.modules.db;
    var now = Date.now();

    function del(row, cb) {
        self.metrics.Counter('del_' + row.type + '_0').inc();

        core.series([
           function(next) {
               db.del("bk_connection", { id: id, type: row.type + ":" + row.id }, options, next);
           },
           function(next) {
               if (options.nocounter) return next();
               self.incrAutoCounter(id, row.type + '0', -1, options, function() { next(); });
           },
           function(next) {
               if (options.noreference) return next();
               db.del("bk_reference", { id: row.id, type: row.type + ":" + id }, options, next);
           },
           function(next) {
               if (options.nocounter) return next();
               if (options.noreference) return next();
               self.incrAutoCounter(row.id, row.type + '1', -1, options, function() { next() });
           }
           ], function(err) {
               cb(err, []);
        });
    }

    // Check for allowed connection types
    if (obj.type) {
        if (self.allowConnection[obj.type] && !self.allowConnection[obj.type]['del']) return callback({ status: 400, message: "cannot delete connection"});
    }

    // Single deletion
    if (obj.id && obj.type) return del(obj, callback);

    // Delete by query, my records
    db.select("bk_connection", { id: id, type: obj.type ? (obj.type + ":" + (obj.id || "")) : "" }, options, function(err, rows) {
        if (err) return callback(err, []);

        core.forEachSeries(rows, function(row, next) {
            if (obj.id && row.id != obj.id) return next();
            if (obj.type && row.type != obj.type) return next();
            // Silently skip connections we cannot delete
            if (self.allowConnection[row.type] && !self.allowConnection[row.type]['del']) return next();
            del(row, next);
        }, function(err) {
            callback(err, []);
        });
    });
}
