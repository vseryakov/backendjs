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
            get("/api/prompts", listRoute).
            post("/api/prompt", submitRoute).
            put("/api/prompt", resubmitRoute).
            delete("/api/prompt/:id", deleteRoute);

        callback();
    },

    job,
    similarity,
}

// Schema for pagination, make sure all are valid numbers
const _listSchema = {
    start: { type: "int", min: 0 },
    count: { type: "int", min: 10, dflt: 50 },
    desc: { type: "bool", dflt: true },
    sort: { value: "ctime" },
}

// List one page at a time
function listRoute(context)
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
    models: {
        type: "list",
        required: true,
    },
    status: { value: "pending" },
    results: { value: null },
}

// Create a new prompt
async function submitRoute(context)
{
    const { err, data } = api.validate(context, _submitSchema);
    if (err) return context.reply(err);

    // Not storing models so we check here, results will contain all models anyway
    const { data: models } = await db.alist("models", data.models);
    if (models?.length != data.models.length) {
        return context.reply({ status: 400, message: "invalid model:" + data.models.filter(x => !models.includes(x)) })
    }

    submitJob(context, data);
}

// Replace existing prompt, keep the results
async function resubmitRoute(context)
{
    const { err, data } = api.validate(context, Object.assign({ id: { type: "uuid", required: true } }, _submitSchema));
    if (err) return context.reply(err);

    const { data: prompt } = await db.aget("prompts", { id: data.id });
    if (!prompt) return context.reply({ status: 404, message: "invalid prompt" })

    data.results = prompt.results;

    submitJob(context, data);
}

async function deleteRoute(context)
{
    const { id } = context.params;

    if (!lib.isUuid(id)) {
        return context.reply({ status: 400, message: "invalid id" });
    }

    db.del("prompts", { id }, (err) => {
        context.reply(err);
    });
}

// Replace complete prompt record and start a job, used by submit and resubmit
function submitJob(context, data)
{
    db.put("prompts", data, { result_query: 1, first: 1 }, async (err, prompt) => {
        if (err) {
            return context.reply(err);
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

// Create similarity scores against each other and store in the stats
function similarity(results)
{
    for (const res1 of results) {
        res1.similarity = [];
        if (!res1.text) continue;
        for (const res2 of results) {
            if (res1 === res2 || !res2.text) continue;
            res1.similarity.push([res2.model, lib.toNumber(lib.isSimilar(res1.text, res2.text), { digits: 5 })]);
        }
        res1.similarity.sort((a, b) => (b[1] - a[1]));
    }
    results.sort((a, b) => ((b.similarity[0] || 0) - (a.similarity[0] || 0))).forEach(x => {
        x.similarity = x.similarity.reduce((a, b) => { a[b[0]] = b[1]; return a }, {});
    });
}

// Update existing prompt record with status and results and notify web via websocket
function update(prompt, status, callback)
{
    const row = {
        id: prompt.id,
        status: status ? prompt.status = status : prompt.status,
        results: prompt.results
    };

    db.update("prompts", row, callback);

    api.ws.notify({}, { event: "prompts:status", prompt });
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

    const { data: models } = await db.alist("models", options.models);
    if (!models?.length) {
        return callback({ status: 404, message: "no models" });
    }

    prompt.results ??= [];

    update(prompt, "running");

    const finish = (rc) => {
        logger.info("job:", "prompts", "finish", rc.response?.model, rc.status, rc.error);

        const i = prompt.results.findIndex(x => x.model == rc.response?.model);
        prompt.results.splice(i > -1 ? i : 0, i > -1 ? 1 : 0, rc.response);
        update(prompt);
    };

    const runTask = (task) => {
        logger.info("job:", "prompts", "run", task.type, task.id, prompt.prompt.substr(0, 32));

        return modules.llm[task.type]({ model: task.id, prompt: prompt.prompt, token: task.token }, finish);
    }

    // Group by model type to avoid overloading or throttling so different types runs in parallel but
    // within the same type all run sequentially

    const tasks = Object.values(Object.groupBy(models, model => model.type)).
                  map(group => (group.length == 1 ? runTask(group[0]) :
                                new Promise(resolve => resolve(async () => {
                                    for (const task of group) {
                                        await runTask(task);
                                    }
                                }))));

    await Promise.allSettled(tasks);

    logger.info("job:", "prompts", "stop", options);

    // Produce similarity score matrix for all results to see which result is closer to which
    similarity(prompt.results);

    update(prompt, "done", callback);
}

