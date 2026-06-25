//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2025
//
'use strict';


const { api, logger, lib } = require('backendjs');
 
const mod =

module.exports = {
    name: "ollama",
    args: [
        { name: "enable", type: "bool", descr: "Enable api" },
        { name: "host", descr: "Server host" },
        { name: "model", descr: "Default model" },
    ],
    model: "gemma4",
    host: "localhost:11434",
    enable: true,
}

mod.fetch = async function(options)
{
    const opts = {
        url: "http://" + this.host + options.path,
        method: options.method || "POST",
        headers: {
            "Content-Type": "application/json",
        },
        query: options.query,
        postdata: options.postdata,
    }
    return lib.afetch(opts);
}
 
mod.configureMiddleware = function(options, callback)
{
    if (!this.enable) return callback();

    api.app.post("/ollama/chat", chat);
 
    callback();
}

function chat(context)
{
    const { err, data } = api.validate(context, {
        prompt: { required: { messages: null }, max: 64000 },
        messages: { required: { prompt: null }, type: "list" },
        system: { max: 64000 },
        model: { dflt: mod.model },
        stream: { value: false },
        format: {},
        raw: { type: "bool" },
        options: { type: "obj" },
    });
    if (err) return context.reply(err);

    logger.debug("chat:", mod.name, data);

    mod.fetch({ path: `/api/${data.prompt ? "generate" : "chat"}`, postdata: data }, (err, data) => {
        context.reply(err, data)
    });
}

