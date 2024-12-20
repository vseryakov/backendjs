//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

var bkjs = require('backendjs');
var db = bkjs.db;
var api = bkjs.api;
var core = bkjs.core;
var lib = bkjs.lib;
var logger = bkjs.logger;
const bkutils = require('bkjs-utils');

// Locations management
var mod = {
    name: "bk_location",
    tables: {
        bk_user: {
            geohash: {},
            latitude: { type: "real" },
            longitude: { type: "real" },
            location: {},
            ltime: { type: "mtime" },                   // Last location update time
        },
        bk_location: {
            geohash: { primary: 1 },                    // geohash, api.minDistance defines the size
            id: { primary: 2, pub: 1 },                 // my account id, part of the primary key for pagination
            latitude: { type: "real" },
            longitude: { type: "real" },
            name: { pub: 1 },
            mtime: { type: "now" }
        },
    },
    // Geo min distance for the hash key, km
    minDistance: 1,
    // Max searchable distance, km
    maxDistance: 50,
    geoHashRanges: [ [12, 0], [8, 0.019], [7, 0.076], [6, 0.61], [5, 2.4], [4, 20.0], [3, 78.0], [2, 630.0], [1, 2500.0], [1, 99999] ],
};
module.exports = mod;

// Initialize the module
mod.init = function(options)
{
    core.describeArgs("locations", [
         { name: "max-distance", type: "number", min: 0.1, max: 999, descr: "Max searchable distance(radius) in km, for location searches to limit the upper bound" },
         { name: "min-distance", type: "number", min: 0.1, max: 999, descr: "Radius for the smallest bounding box in km containing single location, radius searches will combine neighboring boxes of this size to cover the whole area with the given distance request, also this affects the length of geohash keys stored in the bk_location table" },
    ]);
}

// Create API endpoints and routes
mod.configureWeb = function(options, callback)
{
    this.configureLocationsAPI();
    callback()
}

// Geo locations management
mod.configureLocationsAPI = function()
{
    var self = this;

    api.app.all(/^\/location\/([a-z]+)$/, function(req, res) {
        var options = api.getOptions(req);

        switch (req.params[0]) {
        case "put":
            self.put(req, options, function(err, data) {
                api.sendJSON(req, err, data);
            });
            break;

        case "search":
            self.search(req, options, function(err, data) {
                api.sendJSON(req, err, data);
            });
            break;

        default:
            api.sendReply(res, 400, "Invalid command");
        }
    });
}

// Perform locations search, request comes from the Express server, callback will takes err and data to be returned back to the client, this function
// is used in `/location/search` request. It can be used in the applications with customized input and output if neccesary for the application specific logic.
//
// Example
//
//          # Request will look like: /recent/locations?latitude=34.1&longitude=-118.1&mtime=123456789
//          api.app.all(/^\/recent\/locations$/, function(req, res) {
//              var options = api.getOptions(req);
//              options.keys = ["geohash","mtime"];
//              options.ops = { mtime: 'gt' };
//              core.modules.bk_location.search(req, options, function(err, data) {
//                  api.sendJSON(req, err, data);
//              });
//          });
//
mod.search = function(req, options, callback)
{
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
    if (typeof options.round == "undefined") options.round = this.minDistance;
    if (typeof options.minDistance == "undefined") options.minDistance = this.minDistance;

    // Limit the distance within our configured range
    req.query.distance = lib.toNumber(req.query.distance, { float: 0, dflt: options.minDistance, min: options.minDistance, max: options.maxDistance || this.maxDistance });

    this.select(table, req.query, options, function(err, rows, info) {
        logger.debug("getLocations:", req.account.id, 'GEO:', req.query.latitude, req.query.longitude, req.query.distance, options.geohash || "", 'NEXT:', info || '', 'ROWS:', rows.length);
        callback(null, api.getResultPage(req, options, rows, info));
    });
}

// Save location coordinates for current account, this function is called by the `/location/put` API call
mod.put = function(req, options, callback)
{
    var now = Date.now();
    var table = options.table || "bk_location";

    var latitude = req.query.latitude, longitude = req.query.longitude;
    if (!latitude || !longitude) return callback({ status: 400, message: "latitude/longitude are required" });

    // Build new location record
    var geo = mod.geoHash(latitude, longitude, { minDistance: mod.minDistance });

    // Skip if within minimal distance
    if (req.account.latitude || req.account.longitude) {
        var distance = mod.geoDistance(req.account.latitude, req.account.longitude, latitude, longitude);
        if (distance == null || distance <= mod.minDistance) {
            return callback({ status: 305, message: "ignored, min distance: " + mod.minDistance });
        }
    }

    req.query.ltime = now;
    req.query.id = req.account.id;
    req.query.geohash = geo.geohash;
    // Return new and old coordinates
    req.query.old = { geohash: req.account.geohash, latitude: req.account.latitude, longitude: req.account.longtiude };

    var obj = { login: req.account.login, id: req.account.id, geohash: geo.geohash, latitude: latitude, longitude: longitude, ltime: now, location: req.query.location };
    db.update("bk_user", obj, function(err) {
        if (err) return callback(err);

        // Just keep accounts with locations or if we use accounts as the location storage
        if (options.nolocation || table == "bk_user") return callback(null, req.query);

        // Update all account columns in the location, they are very tightly connected and custom filters can
        // be used for filtering locations based on other account properties like gender.
        var cols = db.getColumns("bk_location", options);
        for (var p in cols) if (req.account[p] && !req.query[p]) req.query[p] = req.account[p];

        db.put("bk_location", req.query, function(err) {
            if (err) return callback(err);

            // Never been updated yet, nothing to delete
            if (!req.account.geohash || req.account.geohash == geo.geohash) return callback(null, req.query);

            // Delete the old location, ignore the error but still log it
            db.del("bk_location", req.account, function() {
                callback(null, req.query);
            });
        });
    });
}

// Geo locations search, paginate all results until the end.
// table must be defined with the following required columns:
//  - geohash - location as primary key hash column
//  - id or other column name to be used as a RANGE key for DynamoDB/Cassandra or part of the composite primary key
//     for SQL, the result will be sorted by this column for all databases
//  - latitude and longitude as floating numbers to store the actual location
//
//  When defining the table for location searches the begining of the table must be defined as the following:
//
//          db.describeTables({
//                  geo: { geohash: { primary: 1, minDistance: 5 },
//                         id: { primary: 2 },
//                         latitude: { type: "real", projections: 1 },
//                         longitude: { type: "real", projections: 1 },
//                  }
//          });
//  the rest of the columns can be defined as needed, no special requirements.
//
//  *`id` can be any property, it is used for sorting only. For DynamoDB if geohash is an index then lat/long properties must
//   use projections: 1 in order to be included in the index projection.*
//
// `query` must contain the following:
//  - latitude
//  - longitude
//
// other query parameters:
//  - distance - in km, the radius around the point, if not given the `options.minDistance` will be used
//  - count - if greater than 0 then return this amount with each iteration, if 0 then all matched
//    records within the specified distance will be returned, if no specified then defaults to 10
//
// all other properties will be used as additional conditions
//
// `options` optional properties:
//  - minDistance - minimum distance to define how long a geohash will be, if not given it will use the same property from the column definition
//  - top - number of first 'top'th records from each neighboring area, to be used with sorting by the range key to take
//     only highest/lowest matches, useful for trending/statistics, count still defines the total number of locations
//  - geokey - name of the geohash primary key column, by default it is `geohash`, it is possible to keep several different
//     geohash indexes within the same table with different geohash length which will allow to perform
//     searches more precisely depending on the distance given
//  - round - a number that defines the "precision" of  the distance, it rounds the distance to the nearest
//    round number and uses decimal point of the round number to limit decimals in the distance
//  - sort - sorting order, by default the RANGE key is used for DynamoDB, it is possible to specify any Index as well,
//    in case of SQL this is the second part of the primary key
//  - checkLocation - a function(table, query, options) than can be used to check if the current geohash is valid and can be
//    scanned, returns false if ican be skipped, this is to make geohash scanning optimized if it is known before the call
//    which geohashes contain no records at all.
//
// On first call, query must contain latitude and longitude of the center and optionally distance for the radius. On subsequent calls options must be the
// the next_token returned by the previous call and query will be ignored
//
// On return, the callback's third argument contains the object with next_token that must be provided for subsequent searches until rows array is empty.
//
//  Example
//
//          var query = { latitude: -118, longitude: 30, distance: 10 };
//          core.modules.bk_location.select("bk_location", query, { round: 5 }, function(err, rows, info) {
//              ...
//              // Get next page using previous info object
//              core.modules.bk_location.select("bk_location", query, info.next_token, function(err, rows, info) {
//                  ...
//              });
//          });
//
// Geohash grid in general looks like this (2 levels example):
//
//         left33 left31   top3   right32 right34
//         left13 left11   top1   right12 right14
//         left03 left01  center  right01 rigt04
//         left23 left21  bottom2 right21 right24
//         left43 left41  bottom4 right41 right44
//
//
// Geo grid for browsing is a list from the center all rows up, this means that records with
// smaller distances will appear again when geohash range is big:
//         center   left01 right01 left02 right02
//         top1     left11 right11 left12 right12
//         bottom2  left21 right21 left22 right22
//         top3     left31 right31 left32 right32
//         bottom4  left41 right41 left42 right42
//

mod.select = function(table, query, options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    query = lib.objClone(query);
    options = lib.objClone(options);
    var cols = db.getColumns(table, options);
    var keys = db.getKeys(table, options);
    var lcols = ["geohash", "latitude", "longitude"];
    var gcols = ["count","sort","top","geohash","geokey","distance","minDistance","latitude","longitude","start","neighbors","gquery","gcount"];
    var rows = [];

    // New location search
    if (!options.geohash) {
        options.geokey = lcols[0] = options.geokey && cols[options.geokey] ? options.geokey : 'geohash';
        options.count = options.gcount = lib.toNumber(options.count, { float: 0, dflt: 10, min: 0 });
        options.minDistance = db.getColumn(table, options.geokey).minDistance || options.minDistance || 1;
        options.distance = lib.toNumber(query.distance || options.minDistance, { float: 0, min: 0, max: 999 });
        options.start = null;
        // Have to maintain sorting order for pagination
        if (!options.sort && keys.length > 1) options.sort = keys[1];
        var geo = lib.geoHash(query.latitude, query.longitude, { distance: options.distance, minDistance: options.minDistance });
        for (var p in geo) options[p] = geo[p];
        query[options.geokey] = geo.geohash;
        options.gquery = query;
        ['latitude', 'longitude', 'distance' ].forEach(function(x) { delete query[x]; });
    } else {
        // Original query
        query = options.gquery;
    }
    if (options.top) options.count = options.top;

    logger.debug('getLocations:', table, 'OBJ:', query, 'GEO:', options.geokey, options.geohash, options.distance, 'km', 'START:', options.start, 'COUNT:', options.gcount, 'NEIGHBORS:', options.neighbors);

    // Collect all matching records until specified count
    lib.doWhilst(
      function(next) {
          // Verify if we need to check this geohash at all
          if (typeof options.checkLocation == "function" && !options.checkLocation(table, query, options)) {
              logger.debug("getLocations:", table, query, "skipping");
              return next();
          }

          db.select(table, query, options, function(err, items, info) {
              if (err) return next(err);

              // Next page if any or go to the next neighbor
              options.start = info.next_token;

              items.forEach(function(row) {
                  row.distance = mod.geoDistance(options.latitude, options.longitude, row.latitude, row.longitude, options);
                  if (row.distance == null) return;
                  // Limit the distance within the allowed range
                  if (options.round > 0 && row.distance - options.distance > options.round) return;
                  // Limit by exact distance
                  if (row.distance > options.distance) return;
                  // If we have selected columns list then clear the columns we dont want
                  if (options.select) Object.keys(row).forEach(function(p) {
                      if (options.select.indexOf(p) == -1) delete row[p];
                  });
                  rows.push(row);
                  if (options.count > 0) options.count--;
              });
              next(err);
          });
      },
      function() {
          // We have all rows requested
          if (options.gcount > 0 && rows.length >= options.gcount) return false;
          // No more in the current geo box, try the next neighbor
          if (!options.start || (options.top && options.count <= 0)) {
              if (!options.neighbors.length) return false;
              query[options.geokey] = options.neighbors.shift();
              if (options.top) options.count = options.top;
              options.start = null;
          }
          return true;
      },
      function(err) {
          // Build next token if we have more rows to search
          var info = {};
          if (options.start || options.neighbors.length > 0) {
              // If we have no start it means this geo box is empty so we need to advance to the next geohash
              // for the next round in order to avoid endless loop
              if (!options.start) query[options.geokey] = options.neighbors.shift();
              // Restore the original count
              options.count = options.gcount;
              // Set the most recent query for the next round
              options.gquery = query;
              info.next_token = {};
              gcols.forEach(function(x) {
                  if (typeof options[x] != "undefined") info.next_token[x] = options[x];
              });
          }
          callback(err, rows, info);
    });
}

mod.bkDeleteAccount = function(req, callback)
{
    if (!req.account.geohash || lib.isFlag(req.options.keep, ["all","account","bk_location"])) return callback();
    db.del("bk_location", { id: req.account.id, geohash: req.account.geohash }, callback);
}

// Return object with geohash for given coordinates to be used for location search
//
// The options may contain the following properties:
//   - distance - limit the range key with the closest range smaller than then distance, required for search but for updates may be omitted
//   - minDistance - radius for the smallest bounding box in km containing single location, radius searches will combine neighboring boxes of
//      this size to cover the whole area with the given distance request, also this affects the length of geohash keys stored in the bk_location table
//      if not specified default `min-distance` value will be used.
mod.geoHash = function(latitude, longitude, options)
{
    if (!options) options = {};
    var minDistance = options.minDistance || 0.01;
    var range = this.geoHashRanges.filter(function(x) { return x[1] > minDistance })[0];
    var geohash = bkutils.geoHashEncode(latitude, longitude);
    return { geohash: geohash.substr(0, range[0]),
             _geohash: geohash,
             neighbors: options.distance ? bkutils.geoHashGrid(geohash.substr(0, range[0]), Math.ceil(options.distance / range[1])).slice(1) : [],
             latitude: latitude,
             longitude: longitude,
             minRange: range[1],
             minDistance: minDistance,
             distance: options.distance || 0 };
}

// Return distance between two locations
//
// The options can specify the following properties:
// - round - a number how to round the distance
//
//  Example: round to the nearest full 5 km and use only 1 decimal point, if the distance is 13, it will be 15.0
//
//      lib.geoDistance(34, -188, 34.4, -119, { round: 5.1 })
//
mod.geoDistance = function(latitude1, longitude1, latitude2, longitude2, options)
{
    var distance = bkutils.geoDistance(latitude1, longitude1, latitude2, longitude2);
    if (isNaN(distance) || distance === null || typeof distance == "undefined") return null;

    // Round the distance to the closes edge and fixed number of decimals
    if (options && typeof options.round == "number" && options.round > 0) {
        var decs = String(options.round).split(".")[1];
        distance = parseFloat(Number(Math.floor(distance/options.round)*options.round).toFixed(decs ? decs.length : 0));
        if (isNaN(distance)) return null;
    }
    return distance;
}

