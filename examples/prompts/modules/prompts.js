//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2025
//
'use strict';


const { db, api, jobs, lib, logger, modules } = require('backendjs');

module.exports = {
    name: "prompts",

    // Database tables
    tables: {

        prompts: {
            id: { type: "uuid", primary: 1 },
            status: {},
            prompt: {},
            results: { type: "object" },
            ctime: { type: "now", readonly: true },
            mtime: { type: "now" },
        }
    },

    // Setup routes
    configureMiddleware(options, callback)
    {
        api.app.
            get("/api/prompts", list).
            post("/api/prompt", submit).
            delete("/api/prompt/:id", del);

        callback();
    },

    job,
}

// Schema for pagination, make sure all are valid numbers
const _listSchema = {
    start: { type: "int", min: 0 },
    count: { type: "int", min: 10, dflt: 50 },
    desc: { type: "bool", dflt: true },
    sort: { value: "ctime" },
}

// List one page at a time
function list(context)
{
    const { err, data } = api.validate(context, _listSchema);
    if (err) return context.reply(err);

    db.select("prompts", {}, data, (err, rows, info) => {
        context.reply(err, db.paginateResult(rows, info));
    });
}

// Submit schema, restrict prompt size and against XSS
const _submitSchema = {
    prompt: {
        required: true,
        strip: lib.rxXss,
        max: 100000,
    },
    id: { type: "uuid" },
    models: { type: "list" },
    status: { value: "pending" },
    results: { value: null },
}

// Create/replace a prompt record and submit for execution
async function submit(context)
{
    const { err, data } = api.validate(context, _submitSchema);
    if (err) return context.reply(err);

    // Make sure existing record is valid
    if (data.id) {
        const { data: row } = await db.aget("prompts", { id: data.id });
        if (!row) data.id = undefined;
    }

    db.put("prompts", data, { result_query: 1, first: 1 }, async (err, prompt) => {
        if (err) {
            return context.reply(err);
        }

        // Not storing models so we check here, results will contain all models used anyway
        if (data.models?.length) {
            const { data: models } = await db.alist("models", data.models);
            if (models?.length != data.models.length) {
                return context.reply({ status: 400, message: "invalid model:" + data.models.filter(x => !models.includes(x)) })
            }
        }

        // Notify connected web clients about new prompt job
        api.ws.notify({}, { event: "prompts:status", prompt });

        // Send a job into a queue for processing
        const job = { id: prompt.id, models: data.models };

        jobs.submitJob({ job: { "prompts.job": job } }, { noWait: 1 }, (err) => {
            context.reply(err, prompt);
        });
    });
}

// for simplicity ignore if does not exist
async function del(context)
{
    const { id } = context.params;

    if (!lib.isUuid(id)) {
        return context.reply({ status: 400, message: "invalid id" });
    }

    db.del("prompts", { id }, (err) => {
        context.reply(err);
    });
}

/**
 * This is the primary job method that is run by a worker to send the prompt to all models at the same
 * time and wait for responses. Results are stored in one huge JSON blob as a list of results.
 */
async function job(options, callback)
{
    logger.info("job:", "prompts", "start", options);

    const { data: prompt } = await db.aget("prompts", { id: options.id });
    if (!prompt) {
        return callback({ status: 404, message: "no prompt" });
    }

    let models;

    if (options.models?.length) {
        const { data } = await db.alist("models", options.models);
        models = data;
    } else {
        // Select all existing models, assume we have less than 100 for now
        const { data } = await db.aselect("models", {}, { count: 100 });
        models = data;
    }

    models = models.filter(x => lib.isFunc(modules.llm[x.type]));

    // Notify about job running

    db.update("prompts", { id: prompt.id, status: prompt.status = "running" });
    api.ws.notify({}, { event: "prompts:status", prompt });


    // Collect all results here
    prompt.results = [];

    // Notify after each run
    const finish = (rc) => {
        logger.info("job:", "prompts", "finish", rc.model, rc.status, rc.error);
        prompt.results.push(rc.response);
        db.update("prompts", { id: prompt.id, results: prompt.results });
        api.ws.notify({}, { event: "prompts:status", prompt });
    };

    // Run a single task asynchroniously
    const run = (task) => {
        logger.info("job:", "prompts", "run", task.type, task.id, prompt.prompt.substr(0, 32));
        return modules.llm[task.type]({ model: task.id, prompt: prompt.prompt, token: task.token }, finish);
    }

    // Run all tasks one after another
    const series = async (tasks) => {
        for (const task of tasks) await run(task);
    }

    // Group by model type to avoid overloading or throttling so each model type runs in parallel but
    // within the same type all run sequentially
    const tasks = Object.values(Object.groupBy(models, model => model.type)).
                  map(group => (group.length == 1 ?
                                      run(group[0]) :
                                      new Promise(resolve => resolve(series(group)))));

    // Wait for all to finish
    await Promise.allSettled(tasks);

    // Create similarity scores against each other and store in the stats
    for (const res1 of prompt.results) {
        if (res1.error) continue;
        res1.similarity = {};
        for (const res2 of prompt.results) {
            if (res1 === res2 || res2.error) continue;
            res1.similarity[res2.model] = lib.isSimilar(res1.text, res2.text);
        }
    }
    logger.info("job:", "prompts", "stop", options);

    db.update("prompts", { id: prompt.id, status: prompt.status = "done", results: prompt.results }, callback);

    api.ws.notify({}, { event: "prompts:status", prompt });
}

