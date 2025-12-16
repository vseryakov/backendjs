//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const { db, api } = require('backendjs');

// Data management
const mod = {
    name: "bk_data",
    args: [
    ],
};
module.exports = mod;

// Create API endpoints and routes
mod.configureWeb = function(options, callback)
{
    // Return table columns
    api.app.get("/data/columns/{:table}", (req, res) => {
        if (req.params.table) {
            return res.json(db.getColumns(req.params.table));
        }
        res.json(db.tables);
    });

    // Return table keys
    api.app.get("/data/keys/:table", (req, res) => {
        res.json({ data: db.getKeys(req.params.table) });
    });

    // Basic operations on a table
    api.app.post("/data/:op/:table", (req, res) => {

        if (!["select", "search", "get", "add", "put", "update", "del", "incr"].includes(req.params.op)) {
            return api.sendReply(res, 400, "invalid op");
        }
        if (!db.getColumns(req.params.table)) {
            return api.sendReply(res, 404, "Unknown table");
        }

        db[req.params.op](req.params.table, req.body, (err, rows, info) => {
            api.sendJSON(req, err, api.getResultPage(req, rows, info));
        });
    });

    callback();
}

