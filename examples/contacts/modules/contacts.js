'use strict';


const { db, api } = require('backendjs');

module.exports = {
    name: "contacts",

    tables: {
        contacts: {
            id: { type: "uuid", primary: 1 },
            first_name: { not_null: 1 },
            last_name: { not_null: 1 },
            email: { type: "email" },
            phone: { type: "phone" },
            logo: { type: "url" },
            descr: {},
            ctime: { type: "now", read_only: 1 },
            mtime: { type: "now" },
        }
    },

    incr: 1,

    configureMiddleware(options, callback)
    {
        api.app.
            get("/api/contacts", listContacts).
            post("/api/contacts", createContact).
            get("/api/contact/:id", getContact).
            put("/api/contact/:id", updateContact).
            delete("/api/contact/:id", delContact);

        callback();
    },

}

function listContacts(context)
{
    const { err, data } = api.validate(context, {
        q: { max: 128 },
        start: { type: "int" },
        count: { type: "int", dflt: 10 },
    });
    if (err) return context.reply(err);

    const q = {
        $or: {
            first_name: data.q,
            last_name: data.q,
            email: data.q,
            phone: data.q,
            descr: data.q
        }
    };
    const opts = {
        start: data.start,
        count: data.count,
        ops: {
            first_name: "begins_with",
            last_name: "begins_with",
            email: "contains",
            phone: "contains",
            descr: "contains",
        }
    };

    db.select("contacts", q, opts, (err, rows, info) => {
        context.reply(err, db.paginateResult(rows, info));
    });
}

function getContact(context)
{
    db.get("contacts", { id: context.params.id }, (err, row) => {
        context.reply(err, row);
    });
}

// Require full record on create or update and reuse the same schema
const schema = {
    first_name: { required: 1, max: 32 },
    last_name: { required: 1, max: 32 },
    email: { type: "email" },
    phone: { type: "phone" },
    descr: { max: 255 },
    logo: { type: "url" },
};

function createContact(context)
{
    const { err, data } = api.validate(context, schema);
    if (err) return context.reply(err);

    db.add("contacts", data, { result_query: 1 }, (err, row) => {
        context.reply(err, row);
    });
}

function updateContact(context)
{
    const { err, data } = api.validate(context, schema);
    if (err) return context.reply(err);

    data.id = context.params.id;
    db.update("contacts", data, { returing: "*", first: 1 }, (err, row) => {
        context.reply(err, row);
    });
}

function delContact(context)
{
    db.del("contacts", { id: context.params.id }, (err) => {
        context.reply(err);
    });
}
