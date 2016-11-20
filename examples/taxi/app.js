//
// Backend app
// Created by vlad on Mon Apr 28 18:13:47 EDT 2014
//
var bkjs = require('backendjs');
var core = bkjs.core;
var lib = bkjs.lib;
var db = bkjs.db;
var api = bkjs.api;
var app = bkjs.app;
var logger = bkjs.logger;
var bkutils = require("bkjs-utils");

var center = [ 37.758565, -122.450523 ];

db.describeTables({
    taxi: { id: { primary: 1, pub: 1, notnull: 1 },
            status: { pub: 1 },
            latitude: { type: "real", pub: 1 },
            longitude: { type: "real", pub: 1 },
            mtime: { type: "now", pub: 1 },
    }
});

app.configureWeb = function(options, callback)
{
    api.app.all('/taxi/center', function(req, res) {
        res.json({ latitude: center[0], longitude: center[1] });
    });

    api.app.all('/taxi/get', function(req, res) {
        var options = api.getOptions(req);
        options.sort = "id";
        options.noscan = 0;
        db.select('taxi', req.query, options, function(err, rows) {
           res.json(rows);
        });
    });

    api.app.all('/taxi/set', function(req, res) {
        if (!req.query.id || !req.query.status) return api.sendRepy(res, { status: 400, message: "id and status is required" });
        var options = api.getOptions(req);
        db.update('taxi', req.query, options, function(err, rows) {
           res.json(rows);
        });
    });

    // Run simulation
    setInterval(updateTaxis, 5000);
    callback()
};

// Simulate taxi location changes
function updateTaxis()
{
    var ids = [ "11", "22", "33" ];
    var statuses = [ "avail", "busy", "scheduled" ];
    var bbox = bkutils.geoBoundingBox(center[0], center[1], 2); // within 2 km from the center
    var latitude = lib.randomNum(bbox[0], bbox[2], 5);
    var longitude = lib.randomNum(bbox[1], bbox[3], 5);
    var id = ids[lib.randomInt(0, ids.length - 1)];
    var status = statuses[lib.randomInt(0, statuses.length - 1)];

    db.put("taxi", { id: id, status: status, latitude: latitude, longitude: longitude });
}

bkjs.server.start();
