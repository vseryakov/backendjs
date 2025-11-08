//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2025
//

const { db, api } = require('../../../lib/index');

// Config module
const mod = {
    name: "board",
    tables: {
        boards: {
            name: { primary: 1 },
            ctime: { type: "now", primary: 2 },
            type: {},
            value: {},
            mtime: { type: "now" },
        },
    },
};
module.exports = mod;

// Create API endpoints
mod.configureWeb = function(options, callback)
{
    api.app.use("/board",
        api.express.Router().
            get("/list", select).
            post("/put", put).
            post("/update", update).
            post("/del", del));

    callback();
}

function select(req, res)
{
    var data = [];
    db.scan("board", {}, { sync: 1 }, (rows) => {
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

    db.put("boards ", query, (err) => {
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

    db.update("boards ", query, (err) => {
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

    db.del("boards ", query, (err) => {
        api.sendJSON(req, err);
    });
}
