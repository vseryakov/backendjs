//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2025
//

const { db, api, lib } = require('../../../lib/index');

//
// A demo module that implements a CRUD app to manage config table
//

module.exports = {
    name: "config",

    //
    // Supported config parameters
    //
    args: [
        { name: "roles", type: "list", descr: "List of roles that can access this module, ex: -config-roles admin,user" },
    ],

    //
    // Tables we need for this module
    //
    tables: {
        bk_config: {
            name: { primary: 1 },
            ctime: { type: "now", primary: 2, readonly: 1 },
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
    // Default hook to initialize our Express routes
    //
    configureMiddleware(options, callback)
    {
        api.app.
            use(perms).
            get("/config/list", list).
            post("/config/put", put).
            put("/config/update", update).
            post("/config/del", del);

        callback();
    }
};

// Express middleware for checking user roles
function perms(context, next)
{
    if (!lib.isFlag(module.exports.roles, context.user?.roles)) {
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
        api.sendJSON(req, err, { count: data.length, data });
    });
}

// Store a new record
// implements POST /config/put
function put(context)
{
    var query = api.validate(req, {
        name: { required: 1 },
        type: {},
        value: {},
    });
    if (typeof query == "string") return api.sendReply(req, 400, query);

    db.put("bk_config", query, (err) => {
        api.sendJSON(req, err);
    });
}

// Update existing record
// implements PUT /config/update
function update(context)
{
    var query = api.validate(req, {
        ctime: { type: "int", required: 1 },
        name: { required: 1 },
        type: {},
        value: {},
    });
    if (typeof query == "string") return api.sendReply(req, 400, query);

    db.update("bk_config", query, (err) => {
        api.sendJSON(req, err);
    });
}

// Delete a record
// implements POST /config/del
function del(context)
{
    var query = api.validate(req, {
        ctime: { type: "int", required: 1 },
        name: { required: 1 },
    });
    if (typeof query == "string") return api.sendReply(req, 400, query);

    db.del("bk_config", query, (err) => {
        api.sendJSON(req, err);
    });
}
