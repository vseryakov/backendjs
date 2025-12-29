//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2025
//

const { db, api, lib } = require('../../../lib/index');

module.exports = {
    name: "config",

    args: [
        { name: "roles", type: "list", descr: "List of roles that can access this module, ex: -config-roles admin,user" },
    ],

    tables: {
        bk_config: {
            name: { primary: 1 },
            ctime: { type: "now", primary: 2 },
            type: {},
            value: {},
            mtime: { type: "now" },
        },
    },

    roles: ["admin"],

    configureWeb(options, callback)
    {
        api.app.use("/config",
            api.express.Router().
                use(perms).
                get("/list", select).
                post("/put", put).
                post("/update", update).
                post("/del", del));

        callback();
    }
};

function perms(req, res, next)
{
    if (!lib.isFlag(module.exports.roles, req.user?.roles)) {
        return api.sendReply(res, 403, "access denied");
    }
    next();
}

function select(req, res)
{
    var data = [];
    db.scan("bk_config", {}, { sync: 1 }, (rows) => {
        data.push(...rows);
    }, (err) => {
        api.sendJSON(req, err, { count: data.length, data });
    });
}

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
