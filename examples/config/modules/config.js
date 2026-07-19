//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2025
//
'use strict';


const { db, api, lib } = require('backendjs');

//
// A demo module that implements a CRUD app to manage config table
//

module.exports = {
    name: "config",

    //
    // module config parameters
    //
    args: [
        { name: "roles", type: "list", descr: "List of roles that can access this module, ex: config-roles = admin,user" },
    ],

    //
    // Tables we need for this module
    //
    tables: {
        bk_config: {
            name: { primary: 1 },
            ctime: { type: "now", primary: 2, read_only: 1 },
            type: {},
            value: {},
            mtime: { type: "now" },
        },
    },

    //
    // Default roles, can be set in bkjs.conf as config-roles=user
    //
    roles: ["admin"],


    //
    // Default hook to initialize our routes
    //
    configureMiddleware(options, callback)
    {
        api.app.
            use("/config/*", perms).
            get("/config/list", list).
            post("/config/put", put).
            put("/config/update", update).
            post("/config/del", del);

        callback();
    }
};

// Middleware for checking user roles
function perms(context, next)
{
    if (!lib.includes(module.exports.roles, context.user?.roles)) {
        return context.send(403, "access denied");
    }
    next();
}

// Return all rows fron the table,
// implements GET /config/list
function list(context)
{
    var data = [];
    db.scan("bk_config", {}, { sync: 1 }, (rows) => {
        data.push(...rows);
    }, (err) => {
        context.reply(err, { count: data.length, data });
    });
}

// Store a new record
// implements POST /config/put
function put(context)
{
    const { err, data } = api.validate(context, {
        name: { required: 1 },
        type: {},
        value: {},
    });
    if (err) return context.reply(err);

    db.put("bk_config", data, (err) => {
        context.reply(err);
    });
}

// Update existing record
// implements PUT /config/update
function update(context)
{
    const { err, data } = api.validate(context, {
        ctime: { type: "int", required: 1 },
        name: { required: 1 },
        type: {},
        value: {},
    });
    if (err) return context.reply(err);

    db.update("bk_config", data, (err) => {
        context.reply(err);
    });
}

// Delete a record
// implements POST /config/del
function del(context)
{
    const { err, data } = api.validate(context, {
        ctime: { type: "int", required: 1 },
        name: { required: 1 },
    });
    if (err) return context.reply(err);

    db.del("bk_config", data, (err) => {
        context.reply(err);
    });
}
