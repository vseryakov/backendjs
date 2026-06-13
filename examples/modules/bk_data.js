//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const { db, api } = require('backendjs');

// Data management
const mod = {
    name: "bk_data",
};
module.exports = mod;

// Create API endpoints and routes
mod.configureMiddleware = function(options, callback)
{
    // Return table columns
    api.app.get("/data/columns/*", (context) => {
        if (context.params[0]) {
            return context.json(db.getColumns(context.params[0]));
        }
        context.json(db.tables);
    });

    // Return table keys
    api.app.get("/data/keys/:table", (context) => {
        context.json({ data: db.getKeys(context.params.table) });
    });

    // Basic operations on a table
    api.app.post("/data/:op/:table", (context) => {

        if (!["select", "search", "get", "add", "put", "update", "del", "incr"].includes(context.params.op)) {
            return context.reply({ status: 400, message: "invalid op" });
        }
        if (!db.getColumns(context.params.table)) {
            return context.reply({ status: 404, message: "Unknown table" });
        }

        db[context.params.op](context.params.table, context.context.body, (err, rows, info) => {
            context.reply(err, db.paginateResult(rows, info));
        });
    });

    callback();
}

