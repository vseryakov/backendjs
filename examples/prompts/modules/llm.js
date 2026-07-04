//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2025
//
'use strict';


const { api, lib } = require('backendjs');
 
module.exports = {
    name: "llm",


    async ollama(options) {
        const { err, data } = lib.validate(options, {
            prompt: { required: { messages: null }, max: 64000 },
            messages: { required: { prompt: null }, type: "list" },
            system: { max: 64000 },
            model: { required: true },
            stream: { value: false },
            format: {},
            raw: { type: "bool" },
            options: { type: "obj" },
        });
        if (err) return { err };

        return lib.afetch({
            method: "POST",
            url: `http://localhost:11434/api/${data.prompt ? "generate" : "chat"}`,
            headers: {
                "Content-Type": "application/json",
            },
            postdata: data,
        });
    },

    async gemeni(options) {
        const parts = lib.isArray(options.parts, []);
        const config = options.config || {};
        const postdata = {
            contents: [ { parts } ],
            generationConfig: config,
        };

        const req = {
            url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
            method: "POST",
            headers: {
                "x-goog-api-key": mod.apikey,
            },
            postdata,
        };

        parts.push({ text: options.prompt });

        const rc = await lib.afetch(req);
        if (!rc.ok) {
            if (!rc.err && rc.obj?.error) {
                rc.err = rc.obj.error;
            }
        } else {
            rc.parts = [];
            for (const candidate of lib.isArray(rc.obj?.candidates, [])) {
                for (const part of lib.isArray(candidate?.content?.parts, [])) {
                    if (part.inlineData) {
                        rc.parts.push({
                            index: rc.parts.length,
                            mimeType: part.inlineData.mimeType,
                            data: Buffer.from(part.inlineData.data, "base64")
                        });
                        delete part.inlineData.data;
                        delete part.thoughtSignature;
                    } else

                    if (part.text) {
                        if (part.text.startsWith("```json")) {
                            rc.parts.push({
                                index: rc.parts.length,
                                obj: lib.jsonParse(part.text.replace(/```(json)?/g, "")),
                                text: part.text,
                            });
                        } else {
                            rc.parts.push({
                            index: rc.parts.length,
                            text: part.text,
                        });
                    }
                }
            }
        }
    }
    logger.debug("gemeni:", req, rc.data, "parts:", rc.parts);
    return rc;
}

}


