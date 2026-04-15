//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2025
//

const { api, logger, lib } = require('backendjs');
 
const mod =

module.exports = {
    name: "ollama",
    args: [
        { name: "err-(.+)", descr: "Error messages for various cases" },
        { name: "cap-(.+)", type: "int", strip: "cap-", descr: "Capability parameters" },
        { name: "host", descr: "Server host" },
        { name: "model", descr: "Default model" },
    ],
    model: "gemma4",
    host: "localhost:11434",
    disabled: true,
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
 
mod.configureWeb = function(options, callback)
{
    if (this.disabled) return callback();


    api.app.use("/ollama",
            api.express.Router().
                post("/chat", chat));
 
    callback();
}

function chat(req, res)
{
    var query = api.toParams(req, {
        prompt: { required: { messages: null }, max: 64000 },
        messages: { required: { prompt: null }, type: "list" },
        system: { max: 64000 },
        model: { dflt: mod.model },
        stream: { value: false },
        format: {},
        raw: { type: "bool" },
        options: { type: "obj" },
    });
    if (typeof query == "string") return api.sendReply(res, 400, query);

    logger.debug("chat:", mod.name, query);

    mod.fetch({ path: `/api/${query.prompt ? "generate" : "chat"}`, postdata: query }, (err, data) => {
        api.sendJSON(req, err, data)
    });
}

