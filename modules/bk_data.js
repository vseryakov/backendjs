//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const bkjs = require('backendjs');
const db = bkjs.db;
const api = bkjs.api;

// Account management
var mod = {
    name: "bk_data",
    controls: {
        region: { type: "string" },
        pool: { type: "string" },
    },
};
module.exports = mod;

// Create API endpoints and routes
mod.configureWeb = function(options, callback)
{
    api.registerControlParams(mod.controls);
    this.configureDataAPI();
    callback()
}

// API for full access to all tables
mod.configureDataAPI = function()
{
    // Return table columns
    api.app.all(/^\/data\/columns\/?([a-z_0-9]+)?$/, function(req, res) {
        var options = api.getOptions(req);
        if (req.params[0]) {
            return res.json(db.getColumns(req.params[0], options));
        }
        // Cache columns and return, only the current region
        delete options.region;
        db.cacheColumns(options, function() {
            res.json(db.getPool().dbcolumns);
        });
    });

    // Return table keys
    api.app.all(/^\/data\/keys\/([a-z_0-9]+)$/, function(req, res) {
        var options = api.getOptions(req);
        res.json(db.getKeys(req.params[0], options));
    });

    // Basic operations on a table
    api.app.all(/^\/data\/(select|scan|search|list|get|add|put|update|del|incr|replace)\/([a-z_0-9]+)$/, function(req, res) {
        // Table must exist
        var dbcols = db.getColumns(req.params[1]);
        if (!dbcols) return api.sendReply(res, "Unknown table");

        var options = api.getOptions(req);
        options.noscan = 0;

        switch (req.params[0]) {
        case "scan":
            var rows = [];
            db.scan(req.params[1], req.query, options, function(row, next) {
                rows.push(row);
                next();
            },function(err) {
                api.sendJSON(req, err, rows);
            });
            break;

        default:
            db[req.params[0]](req.params[1], req.query, options, function(err, rows, info) {
                switch (req.params[0]) {
                case "select":
                case "search":
                    api.sendJSON(req, err, api.getResultPage(req, options, rows, info));
                    break;
                default:
                    api.sendJSON(req, err, rows);
                }
            });
        }
    });

}

