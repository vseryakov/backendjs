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
    configureWeb(options, callback)
    {
        api.app.use("/config",
            api.express.Router().
                use(perms).
                get("/list", list).
                post("/put", put).
                put("/update", update).
                post("/del", del));

        callback();
    }
};

// Express middleware for checking user roles
function perms(req, res, next)
{
    if (!lib.isFlag(module.exports.roles, req.user?.roles)) {
        return api.sendReply(res, 403, "access denied");
    }
    next();
}

// Return all rows fron the table,
// implements GET /config/list
function list(req, res)
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
function put(req, res)
{
    var query = api.toParams(req, {
        name: { required: 1 },
        type: {},
        value: {},
    });
    if (typeof query == "string") return api.sendReply(res, 400, query);

    db.put("bk_config", query, (err) => {
        api.sendJSON(req, err);
    });
}

// Update existing record
// implements PUT /config/update
function update(req, res)
{
    var query = api.toParams(req, {
        ctime: { type: "int", required: 1 },
        name: { required: 1 },
        type: {},
        value: {},
    });
    if (typeof query == "string") return api.sendReply(res, 400, query);

    db.update("bk_config", query, (err) => {
        api.sendJSON(req, err);
    });
}

// Delete a record
// implements POST /config/del
function del(req, res)
{
    var query = api.toParams(req, {
        ctime: { type: "int", required: 1 },
        name: { required: 1 },
    });
    if (typeof query == "string") return api.sendReply(res, 400, query);

    db.del("bk_config", query, (err) => {
        api.sendJSON(req, err);
    });
}
