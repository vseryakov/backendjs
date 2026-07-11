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

    db.incr("models", data, (err) => {
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
        { id: 'gpt-5.5', type: 'openai' },
        { id: 'gpt-5.4', type: 'openaichat' },
        { id: 'gpt-5.6-terra', type: 'openai' },
        { id: 'gemini-3.5-flash', type: 'gemeni' },
        { id: 'claude-opus-4-8', type: 'anthropic' },
        { id: 'claude-sonnet-5', type: 'openaichat' },
        { id: 'grok-4.5', type: 'openai', url: 'https://api.x.ai/v1/responses' },
        { id: 'ornith:9b', type: 'ollama' },
        { id: 'gemma4:e4b-mlx', type: 'ollama' },
        { id: 'gemma4:12b-mlx', type: 'ollama' },
        { id: 'gemma4:26b-mlx', type: 'ollama' },
        { id: 'qwen3.6:27b-mlx', type: 'ollama' },
        { id: 'qwen3.5:397b-cloud', type: 'ollama', url: 'https://ollama.com/api/generate' },
        { id: 'gemma4:31b-cloud', type: 'ollama' },
        { id: 'qwen3.5:9b', type: 'ollama' },
        { id: 'minimax-m3:cloud', type: 'ollama' },
        { id: 'granite4.1:30b', type: 'ollama' },
        { id: 'mistral-small3.2:24b', type: 'ollama' },
        { id: 'ministral-3:14b', type: 'ollama' },
    ].map(x => ({ table: "models", op: "add", query: x }));

    await db.abulk(rows);

    process.exit(0);
}

