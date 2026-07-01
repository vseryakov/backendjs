//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2025
//
'use strict';


const { db, api, jobs, lib, logger } = require('backendjs');

module.exports = {
    name: "compare_llm",

    tables: {

        /**
         * Database tables definitions
         */
        models: {
            id: { primary: 1, convert: { strip: lib.rxNoXss } },
            type: {},
            url: {},
            token: {},
            mtime: { type: "now" },
        },

        jobs: {
            id: { type: "uuid" },
            status: {},
            model: {},
            prompt: {},
            results: { type: "object" },
            ctime: { type: "now", readonly: true },
            mtime: { type: "now" },
        }
    },

    /**
     * Setup all routes
     */
    configureMiddleware(options, callback)
    {
        api.app.
            get("/api/models", listModels).
            post("/api/model", saveModel).
            delete("/api/model/:id", deleteModel).
            get("/api/jobs", listJobs).
            post("/api/job", submitJob).
            delete("/api/job/:id", deleteJob);

        callback();
    },

    job,
    submitJob,
}

/**
 * Return a list of all models
 */
function listModels(context)
{
    var data = [];
    db.scan("models", {}, { sync: 1 }, (rows) => {
        data.push(...rows);
    }, (err) => {
        context.reply(err, { count: data.length, data });
    });
}


function saveModel(context)
{
    const { err, data } = api.validate(context, {
        id: { required: true, regexp: lib.rxPrintable },
        type: { required: true },
        url: {},
        token: {},
    });
    if (err) return context.reply(err);

    db.put("bk_config", data, (err) => {
        context.reply(err);
    });
}

function deleteModel(context)
{
    db.del("models", { id: context.params.id }, (err) => {
        context.reply(err);
    });
}

/**
 * Return a list of all jobs submitted
 */
function listJobs(context)
{
    const { err, data } = api.validate(context, {
        start: { type: "int" },
        count: { type: "int", dflt: 10 },
    });
    if (err) return context.reply(err);

    const opts = {
        start: data.start,
        count: data.count,
        sort: "ctime",
        desc: true,
    };

    db.select("scraper", {}, opts, (err, rows, info) => {
        context.reply(err, db.paginateResult(rows, info));
    });
}

/**
 * Submit a new llm job
 */
function submitJob(context)
{
    const { err, data } = api.validate(context, {
        id: { required: true },
        prompt: { required: true, max: 1024 },
        status: { value: "running" },
    })
    if (err) return context.reply(err);

    db.put("jobs", data, { result_query: 1, first: 1 }, (err, row) => {
        if (err) return context.reply(err, row);

        api.ws.notify({}, { event: "jobs:status", data: row });

        jobs.submitJob({ job: { "compare_llm.job": { id: row.id } } }, { noWait: 1 }, (err) => {
            context.reply(err, row);
        });
    });
}

/**
 * Delete a job by id
 */
function deleteJob(context)
{
    db.del("jobs", { id: context.params.id }, (err) => {
        context.reply(err);
    });
}

/**
 * This is a job method that is run by a worker to do send prompt to all models at the same
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

