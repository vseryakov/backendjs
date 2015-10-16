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
var bkutils = require('bkjs-utils');
var db = bkjs.db;
var api = bkjs.api;
var app = bkjs.app;
var ipc = bkjs.ipc;
var msg = bkjs.msg;
var core = bkjs.core;
var lib = bkjs.lib;
var logger = bkjs.logger;

// Locations management
var locations = {
    name: "locations",

    // Geo min distance for the hash key, km
    minDistance: 5,
    // Max searchable distance, km
    maxDistance: 50,
};
module.exports = locations;

// Initialize the module
locations.init = function(options)
{
    core.describeArgs("locations", [
         { name: "max-distance", type: "number", min: 0.1, max: 999, descr: "Max searchable distance(radius) in km, for location searches to limit the upper bound" },
         { name: "min-distance", type: "number", min: 0.1, max: 999, descr: "Radius for the smallest bounding box in km containing single location, radius searches will combine neighboring boxes of this size to cover the whole area with the given distance request, also this affects the length of geohash keys stored in the bk_location table" },
    ]);

    // Locations for all accounts to support distance searches
    db.describeTables({
           bk_location: { geohash: { primary: 1 },                    // geohash, api.minDistance defines the size
                          id: { primary: 1, pub: 1 },                 // my account id, part of the primary key for pagination
                          latitude: { type: "real" },
                          longitude: { type: "real" },
                          alias: { pub: 1 },
                          mtime: { type: "bigint", now: 1 }},

           // Metrics
           bk_collect: {
                          url_location_get_rmean: { type: "real" },
                          url_location_get_hmean: { type: "real" },
                          url_location_get_0: { type: "real" },
                          url_location_get_err_0: { type: "real" },
                          url_location_get_bad_0: { type: "real" },
                          url_location_put_rmean: { type: "real" },
                          url_location_put_hmean: { type: "real" },
                          url_location_put_0: { type: "real" },
                          url_location_put_bad_0: { type: "real" },
                          url_location_put_err_0: { type: "real" },
                      },

    });
}

// Create API endpoints and routes
locations.configureWeb = function(options, callback)
{
    this.configureLocationsAPI();
    callback()
}

// Geo locations management
locations.configureLocationsAPI = function()
{
    var self = this;

    api.app.all(/^\/location\/([a-z]+)$/, function(req, res) {
        var options = api.getOptions(req);

        switch (req.params[0]) {
        case "put":
            self.putLocation(req, options, function(err, data) {
                api.sendJSON(req, err, data);
            });
            break;

        case "get":
            self.getLocation(req, options, function(err, data) {
                api.sendJSON(req, err, data);
            });
            break;

        default:
            api.sendReply(res, 400, "Invalid command");
        }
    });
}

// Perform locations search, request comes from the Express server, callback will takes err and data to be returned back to the client, this function
// is used in `/location/get` request. It can be used in the applications with customized input and output if neccesary for the application specific logic.
//
// Example
//
//          # Request will look like: /recent/locations?latitude=34.1&longitude=-118.1&mtime=123456789
//          api.app.all(/^\/recent\/locations$/, function(req, res) {
//              var options = api.getOptions(req);
//              options.keys = ["geohash","mtime"];
//              options.ops = { mtime: 'gt' };
//              options.accounts = true;
//              api.getLocations(req, options, function(err, data) {
//                  self.sendJSON(req, err, data);
//              });
//          });
//
locations.getLocation = function(req, options, callback)
{
    var self = this;
    var table = options.table || "bk_location";

    // Continue pagination using the search token, it carries all query and pagination info
    if (options.token && options.token.geohash && options.token.latitude && options.token.longitude) {
        var token = options.token;
        delete options.token;
        for (var p in token) options[p] = token[p];
        req.query.latitude = options.latitude;
        req.query.longitude = options.longitude;
        req.query.distance = options.distance;
    }

    // Perform location search based on hash key that covers the whole region for our configured max distance
    if (!req.query.latitude && !req.query.longitude) return callback({ status: 400, message: "latitude/longitude are required" });

    // Rounded distance, not precise to keep from pin-pointing locations
    if (typeof options.round == "undefined") options.round = self.minDistance;
    if (typeof options.minDistance == "undefined") options.minDistance = self.minDistance;

    // Limit the distance within our configured range
    req.query.distance = lib.toNumber(req.query.distance, { float: 0, dflt: options.minDistance, min: options.minDistance, max: options.maxDistance || self.maxDistance });

    db.getLocations(table, req.query, options, function(err, rows, info) {
        logger.debug("getLocations:", req.account.id, 'GEO:', req.query.latitude, req.query.longitude, req.query.distance, options.geohash || "", 'NEXT:', info || '', 'ROWS:', rows.length);
        // Return accounts with locations
        if (lib.toNumber(options.accounts) && rows.length && table != "bk_account" && core.modules.accounts) {
            core.modules.accounts.listAccount(rows, options, function(err, rows) {
                if (err) return callback(err);
                callback(null, api.getResultPage(req, options, rows, info));
            });
        } else {
            callback(null, api.getResultPage(req, options, rows, info));
        }
    });
}

// Save location coordinates for current account, this function is called by the `/location/put` API call
locations.putLocation = function(req, options, callback)
{
    var self = this;
    var now = Date.now();
    var table = options.table || "bk_location";

    var latitude = req.query.latitude, longitude = req.query.longitude;
    if (!latitude || !longitude) return callback({ status: 400, message: "latitude/longitude are required" });

    // Get current location
    db.get("bk_account", { id: req.account.id }, function(err, old) {
        if (err || !old) return callback(err ? err : { status: 404, mesage: "account not found"});

        // Build new location record
        var geo = lib.geoHash(latitude, longitude, { minDistance: self.minDistance });

        // Skip if within minimal distance
        if (old.latitude || old.longitude) {
            var distance = bkutils.geoDistance(old.latitude, old.longitude, latitude, longitude);
            if (distance == null || distance <= self.minDistance) {
                return callback({ status: 305, message: "ignored, min distance: " + self.minDistance});
            }
        }

        req.query.ltime = now;
        req.query.id = req.account.id;
        req.query.geohash = geo.geohash;
        // Return new and old coordinates
        req.query.old = { geohash: old.geohash, latitude: old.latitude, longitude: old.longtiude };

        var obj = { id: req.account.id, geohash: geo.geohash, latitude: latitude, longitude: longitude, ltime: now, location: req.query.location };
        db.update("bk_account", obj, function(err) {
            if (err) return callback(err);

            // Just keep accounts with locations or if we use accounts as the location storage
            if (options.nolocation || table == "bk_account") return callback(null, req.query);

            // Update all account columns in the location, they are very tightly connected and custom filters can
            // be used for filtering locations based on other account properties like gender.
            var cols = db.getColumns("bk_location", options);
            for (var p in cols) if (old[p] && !req.query[p]) req.query[p] = old[p];

            db.put("bk_location", req.query, function(err) {
                if (err) return callback(err);

                // Never been updated yet, nothing to delete
                if (!old.geohash || old.geohash == geo.geohash) return callback(null, req.query);

                // Delete the old location, ignore the error but still log it
                db.del("bk_location", old, function() {
                    callback(null, req.query);
                });
            });
        });
    });
}

