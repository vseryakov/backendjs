//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2025
//
'use strict';


const { db, api, lib } = require('backendjs');

module.exports = {
    name: "models",

    tables: {

        /**
         * Database tables
         */

        models: {
            id: { primary: 1 },
            type: {},
            url: {},
            token: {},
            mtime: { type: "now" },
        },

    },

    /**
     * Setup routes
     */
    configureMiddleware(options, callback)
    {
        api.app.
            get("/api/models", list).
            post("/api/model", save).
            delete("/api/model/:id", del).

        callback();
    }

}

function list(context)
{
    var data = [];
    db.scan("models", {}, { sync: 1 }, (rows) => {
        data.push(...rows);
    }, (err) => {
        context.reply(err, { count: data.length, data });
    });
}


function save(context)
{
    const { err, data } = api.validate(context, {
        id: { required: true, strip: lib.rxNoSpecial },
        type: { required: true, regexp: lib.rxSymbol },
        token: { regexp: lib.rxPrintable },
        url: { type: "url" },
    });
    if (err) return context.reply(err);

    db.put("models", data, (err) => {
        context.reply(err);
    });
}

function del(context)
{
    const { id } = context.params;

    if (!lib.rxSpecial.test(id)) {
        return context.reply({ status: 400, message: "invalid model" })
    }

    db.del("models", { id }, (err) => {
        context.reply(err);
    });
}


