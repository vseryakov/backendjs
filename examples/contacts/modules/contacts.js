
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
            ctime: { type: "now", readonly: 1 },
            mtime: { type: "now" },
        }
    },

    incr: 1,

    configureWeb(options, callback)
    {
        api.app.use("/api",
            api.express.Router().
                get("/contacts", listContacts).
                post("/contacts", createContact).
                get("/contact/:id", getContact).
                put("/contact/:id", updateContact).
                delete("/contact/:id", delContact));

        callback();
    },

}

function listContacts(req, res)
{
    var query = api.toParams(req, {
        q: { max: 128 },
        start: { type: "int" },
        count: { type: "int", dflt: 10 },
    });
    if (typeof query == "string") return api.sendReply(res, 400, query);

    const q = {
        $or: {
            first_name: query.q,
            last_name: query.q,
            email: query.q,
            phone: query.q,
            descr: query.q
        }
    };
    const opts = {
        start: query.start,
        count: query.count,
        ops: {
            first_name: "begins_with",
            last_name: "begins_with",
            email: "contains",
            phone: "contains",
            descr: "contains",
        }
    };

    db.select("contacts", q, opts, (err, rows, info) => {
        api.sendJSON(req, err, api.getResultPage(req, rows, info));
    });
}

function getContact(req, res)
{
    db.get("contacts", { id: req.params.id }, (err, row) => {
        api.sendJSON(req, err, row);
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

function createContact(req, res)
{
    var query = api.toParams(req, schema);
    if (typeof query == "string") return api.sendReply(res, 400, query);

    db.add("contacts", query, { result_query: 1 }, (err, row) => {
        api.sendJSON(req, err, row);
    });
}

function updateContact(req, res)
{
    var query = api.toParams(req, schema);
    if (typeof query == "string") return api.sendReply(res, 400, query);

    query.id = req.params.id;
    db.update("contacts", query, (err) => {
        api.sendJSON(req, err, query);
    });
}

function delContact(req, res)
{
    db.del("contacts", { id: req.params.id }, (err) => {
        api.sendJSON(req, err);
    });
}
