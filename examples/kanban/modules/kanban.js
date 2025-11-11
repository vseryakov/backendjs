//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2025
//

const { db, api, lib } = require('backendjs');

module.exports = {
    tables: {
        users: {
            id: { primary: 1 },
            name: { not_null: 1 },
        },
        boards: {
            id: { primary: 1 },
            title: { not_null: 1 },
            description: { not_null: 1 },
            created_at: { type: "bigint", not_null: 1 },
        },
        lists: {
            id: { primary: 1 },
            board_id: { not_null: 1, foreign_key: { table: "boards", name: "id", ondelete: "cascade" } },
            title: { not_null: 1 },
            position: { type: "int", not_null: 1 },
            created_at: { type: "bigint", not_null: 1 },
        },
        cards: {
            id: { primary: 1 },
            list_id: { not_null: 1, foreign_key: { table: "lists", name: "id", ondelete: "cascade" } },
            title: { not_null: 1 },
            description: {},
            assignee_id: { foreign_key: { table: "users", name: "id", ondelete: "cascade" } },
            position: { type: "int", not_null: 1 },
            completed: { type: "int", value: false },
            created_at: { type: "bigint", not_null: 1 },
        },
        card_tags: {
            card_id: { primary: 1, foreign_key: { table: "cards", name: "id", ondelete: "cascade" } },
            tag_id: { primary: 2, foreign_key: { table: "tags", name: "id", ondelete: "cascade" } },
        },
        comments: {
            id: { primary: 1 },
            card_id: { not_null: 1, foreign_key: { table: "cards", name: "id", ondelete: "cascade" } },
            user_id: { not_null: 1, foreign_key: { table: "users", name: "id", ondelete: "cascade" } },
            text: { not_null: 1 },
            created_at: { type: "bigint", not_null: 1 },
        },
        tags: {
            id: { primary: 1 },
            name: { not_null: 1 },
            color: { not_null: 1 },
            created_at: { type: "bigint", not_null: 1 },
        },
    },

    configureWeb(options, callback) {
        api.app.use("/api",
            api.express.Router().
            get("/boards", select).
            post("/boards", create).
            get("/board/:id", get).
            post("/board/:id", update).
            del("/board/:id", del));

        callback();
    }
};

function select(req, res)
{
    var data = [];
    db.scan("boards", {}, { sort: "created_at", sync: 1 }, (rows) => {
        data.push(...rows);
    }, (err) => {
        api.sendJSON(req, err, data);
    });
}

function get(req, res)
{
    db.get("boards", { id: req.params.id }, (err, row) => {
        if (!err && !row) err = { status: 404, message: "Board not found" };
        api.sendJSON(req, err, row);
    });
}

function create(req, res)
{
    var query = api.toParams(req, {
        title: { required: 1, max: 128 },
        description: { required: 1, max: 256 },
        id: { value: lib.uuid() },
        created_at: { value: Date.now() },
    });
    if (typeof query == "string") return api.sendReply(res, 400, query);

    db.put("boards", query, (err) => {
        api.sendJSON(req, err, query);
    });
}

function update(req, res)
{
    var query = api.toParams(req, {
        id: { required: 1, value: req.params.id },
        title: { required: 1, max: 128 },
        description: { required: 1, max: 256 },
    });
    if (typeof query == "string") return api.sendReply(res, 400, query);

    db.update("boards ", query, (err) => {
        api.sendJSON(req, err, query);
    });
}

function del(req, res)
{
    var query = api.toParams(req, {
        id: { required: 1, value: req.params.id },
    });
    if (typeof query == "string") return api.sendReply(res, 400, query);

    db.del("boards ", query, (err) => {
        api.sendJSON(req, err);
    });
}
