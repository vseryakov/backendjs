//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2025
//
'use strict';


const { db, api, lib, logger } = require('backendjs');

const llm = require(__dirname + "/llm");

module.exports = {
    name: "models",

    // Database tables
    tables: {

        models: {
            id: { primary: 1 },
            type: {},
            url: { type: "url" },
            token: {},
            mtime: { type: "now" },
        },

    },

    // Setup our routes
    configureMiddleware(options, callback)
    {
        api.app.
            get("/api/models", list).
            post("/api/model", save).
            delete("/api/model/:id", del);

        callback();
    },

    seed,

}

// Return all models without pagination
function list(context)
{
    var data = [];
    db.scan("models", {}, { sync: 1, select: ["id", "type", "url"] }, (rows) => {
        data.push(...rows);
    }, (err) => {
        context.reply(err, { count: data.length, data });
    });
}

// Validate model properties to be valid characters and existing llm type
const _saveSchema = {
    id: {
        required: true,
        noregexp: lib.rxSpecial
    },
    type: {
        required: true,
        regexp: lib.rxSymbol,
        errmsg: "invalid model type",
        values: Object.keys(llm).filter(x => lib.isFunc(llm[x])),
    },
    token: {
        regexp: lib.rxPrintable
    },
    url: { type: "url" },
}

// Add/replace a model by ID, guard against non-existing llms
function save(context)
{
    const { err, data } = api.validate(context, _saveSchema);
    if (err) return context.reply(err);

    db.put("models", data, (err) => {
        context.reply(err);
    });
}

// Delete a model by id
function del(context)
{
    const { id } = context.params;

    if (lib.rxSpecial.test(id)) {
        return context.reply({ status: 400, message: "invalid model id" })
    }

    // report an error if not deleted
    db.del("models", { id }, (err, _, info) => {
        if (!err && !info?.affected_rows) {
            err = { status: 404, message: "invalid model" };
        }
        context.reply(err);
    });
}

// Create some models without tokens
async function seed()
{
    logger.log("seed:", "models");

    const rows = [
        ['ornith:9b','ollama'],
        ['gemma4:e4b-mlx','ollama'],
        ['gemma4:12b-mlx','ollama'],
        ['gemma4:26b-mlx','ollama'],
        ['qwen3.6:27b-mlx','ollama'],
        ['gemma4:31b-cloud','ollama'],
        ['qwen3.5:9b','ollama'],
        ['minimax-m3:cloud','ollama'],
        ['granite4.1:30b','ollama'],
        ['mistral-small3.2:24b','ollama'],
        ['ministral-3:14b','ollama'],
        ['gpt-5.5','openaichat'],
        ['gpt-5.4','openai'],
        ['gemini-3.5-flash','gemeni'],
        ['claude-opus-4-8','anthropic'],
        ['claude-sonnet-5','anthropic'],
    ].map(x => ({ table: "models", op: "add", query: { id: x[0], type: x[1] } }));

    await db.abulk(rows);

    process.exit(0);
}

