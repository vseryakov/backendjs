//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2025
//

const { db, api, lib } = require('backendjs');

module.exports = {
    name: "kanban",

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
            board_id: { not_null: 1, foreign: { table: "boards", name: "id", ondelete: "cascade" } },
            title: { not_null: 1 },
            position: { type: "int", not_null: 1 },
            created_at: { type: "bigint", not_null: 1 },
        },

        cards: {
            id: { primary: 1 },
            list_id: { not_null: 1, foreign: { table: "lists", name: "id", ondelete: "cascade" } },
            title: { not_null: 1 },
            description: {},
            assignee_id: { foreign: { table: "users", name: "id", ondelete: "cascade" } },
            position: { type: "int", not_null: 1 },
            completed: { type: "int", value: false },
            created_at: { type: "bigint", not_null: 1 },
        },

        card_tags: {
            card_id: { primary: 1, foreign: { table: "cards", name: "id", ondelete: "cascade" } },
            tag_id: { primary: 2, foreign: { table: "tags", name: "id", ondelete: "cascade" } },
        },

        comments: {
            id: { primary: 1 },
            card_id: { not_null: 1, foreign: { table: "cards", name: "id", ondelete: "cascade" } },
            user_id: { not_null: 1, foreign: { table: "users", name: "id", ondelete: "cascade" } },
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

    configureMiddleware(options, callback) {

        api.app.get("/api/boards", listBoards).
                post("/api/boards", createBoard).
                get("/api/board/:id", getBoard).
                post("/api/board/:id", updateBoard).
                delete("/api/board/:id", delBoard);

        callback();
    }
};

function listBoards(context)
{
    var data = [];
    db.scan("boards", {}, { sync: 1 }, (rows) => {
        data.push(...rows);
    }, (err) => {
        context.reply(err, data);
    });
}

function getBoard(context)
{
    db.get("boards", { id: context.params.id }, (err, row) => {
        if (!err && !row) err = { status: 404, message: "Board not found" };
        context.reply(err, row);
    });
}

function createBoard(context)
{
    const { err, data } = api.validate(context, {
        title: { required: 1, max: 128 },
        description: { required: 1, max: 256 },
        id: { value: lib.uuid() },
        created_at: { value: Date.now() },
    });
    if (err) return context.reply(err);

    db.put("boards", data, (err) => {
        context.reply(err, data);
    });
}

function updateBoard(context)
{
    const { err, data } = api.validate(context, {
        id: { required: 1, value: context.params.id },
        title: { required: 1, max: 128 },
        description: { required: 1, max: 256 },
    });
    if (err) return context.reply(err);

    db.update("boards", data, (err) => {
        context.reply(err, data);
    });
}

function delBoard(context)
{
    const { err, data } = api.validate(context, {
        id: { required: 1, value: context.params.id },
    });
    if (err) return context.reply(err);

    db.del("boards", data, (err) => {
        context.reply(err);
    });
}
