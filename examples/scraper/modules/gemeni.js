//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2025
//

const { app, lib, logger } = require('backendjs');

const mod =

module.exports = {
    name: "gemeni",

    args: [
        { name: "apikey", descr: "API key" },
    ],
};

mod.fetch = async function(options)
{
    const model = options.image ? "gemini-3.1-flash-image-preview" : "gemini-3-flash-preview" ;

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

    if (options.image) {
        Object.assign(config, {
            responseModalities: ["IMAGE", "TEXT"],
            imageConfig: {
                aspectRatio: options?.aspect || "16:9",
                imageSize: options?.size || "1K"
            }
        });
    }

    if (options.thinking) {
        Object.assign(config, {
            thinkingConfig: {
                thinkingLevel: options.thinking,
            }
        });
    }

    if (options?.search) {
        req.postdata.tools = {
            google_search: { searchTypes: { webSearch: {}, imageSearch: {} } }
        }
    }

    if (options.prompt) {
        parts.push({ text: options.prompt });
    }

    if (options?.file) {
        const { data } = await lib.areadFile(options.file, { encoding: "base64" });
        if (data) {
            parts.push({
                inlineData: { mimeType: app.mime.lookup(options.file), data }
            });
        }
    }

    if (options?.data) {
        for (const { mimeType, data } of Array.isArray(options.data, [options.data])) {
            if (!mimeType || !data) continue;
            parts.push({
                inlineData: { mimeType, data }
            });
        }
    }

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
