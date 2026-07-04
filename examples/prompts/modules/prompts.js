//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2025
//
'use strict';


const { db, api, jobs, lib, logger, modules } = require('backendjs');

module.exports = {
    name: "prompts",

    tables: {

        /**
         * Database tables
         */

        prompts: {
            id: { type: "uuid", primary: 1 },
            status: {},
            model: {},
            prompt: {},
            results: { type: "object" },
            ctime: { type: "now", readonly: true },
            mtime: { type: "now" },
        }
    },

    /**
     * Setup routes
     */

    configureMiddleware(options, callback)
    {
        api.app.
            get("/api/prompts", list).
            post("/api/prompt", submit).
            delete("/api/prompt/:id", del);

        callback();
    },

    // Expose methods to be used as jobs and in shell

    job,
    submit,
}

function list(context)
{
    const { err, data } = api.validate(context, {
        start: { type: "int" },
        count: { type: "int", dflt: 50 },
        desc: { type: "bool", dflt: true },
        sort: { value: "ctime" },
    });
    if (err) return context.reply(err);

    db.select("jobs", {}, data, (err, rows, info) => {
        context.reply(err, db.paginateResult(rows, info));
    });
}

function submit(context)
{
    const { err, data } = api.validate(context, {
        prompt: { required: true, max: 10000, strip: lib.rxNoXss },
        models: { type: "list" },
        status: { value: "running" },
    })
    if (err) return context.reply(err);

    db.put("jobs", data, { result_query: 1, first: 1 }, (err, row) => {
        if (err) return context.reply(err, row);

        // Notify connected web clients about new prompt job
        api.ws.notify({}, { event: "jobs:status", data: row });

        // Send a job into a queue for processing
        const job = { id: row.id, models: data.models };
        jobs.submitJob({ job: { "prompts.job": job } }, { noWait: 1 }, (err) => {
            context.reply(err, row);
        });
    });
}

function del(context)
{
    const { id } = context.params;

    if (!lib.isUuid(id)) {
        return context.reply({ status: 400, message: "invalid id" });
    }

    db.del("jobs", { id }, (err) => {
        context.reply(err);
    });
}

/**
 * This is a job method that is run by a worker to send prompt to all models at the same
 * time and waiting for responses. Results are stored in one huge JSON blob as:
 * {
 *     model1: { result: "..." },
 *     model1: { result: "..." },
 *     ...
 * }
 */
function job(options, callback)
{
    logger.info("scraper:", "job", options);

    lib.series([
        function(next) {
        },

        function(next) {
        },

    ], callback);
}

