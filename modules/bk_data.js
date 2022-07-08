//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const bkjs = require('backendjs');
const db = bkjs.db;
const api = bkjs.api;
const lib = bkjs.lib;

// Account management
const mod = {
    name: "bk_data",
    args: [
        { name: "perms", type: "map", maptype: "list", descr: "Tables and allowed operations, ex: -bk_data-perms bk_config:select;put" },
    ],
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
    api.app.all(/^\/data\/(columns)\/?([a-z_0-9]+)?$/, function(req, res) {
        if (mod.perms && !lib.isFlag(mod.perms[req.params[1] || "*"], req.params[0])) return res.status(403).send("not allowed");
        var options = api.getOptions(req);
        if (req.params[1]) {
            return res.json(db.getColumns(req.params[1], options));
        }
        res.json(db.tables);
    });

    // Return table keys
    api.app.all(/^\/data\/(keys)\/([a-z_0-9]+)$/, function(req, res) {
        if (mod.perms && !lib.isFlag(mod.perms[req.params[1]], req.params[0])) return res.status(403).send("not allowed");
        var options = api.getOptions(req);
        res.json(db.getKeys(req.params[1], options));
    });

    // Basic operations on a table
    api.app.all(/^\/data\/(select|scan|search|list|get|add|put|update|del|incr|replace)\/([a-z_0-9]+)$/, function(req, res) {
        if (mod.perms && !lib.isFlag(mod.perms[req.params[1]], req.params[0])) return res.status(403).send("not allowed");

        var options = api.getOptions(req);
        options.noscan = 0;

        if (!db.getColumns(req.params[1], options)) return api.sendReply(res, 404, "Unknown table");

        switch (req.params[0]) {
        case "scan":
            var rows = [];
            db.scan(req.params[1], req.query, options, (row, next) => {
                rows.push(row);
                next();
            }, (err) => {
                api.sendJSON(req, err, rows);
            });
            break;

        default:
            db[req.params[0]](req.params[1], req.query, options, (err, rows, info) => {
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

