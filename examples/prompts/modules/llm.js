//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2025
//
'use strict';

/**
 * LLM API access
 *
 * input is options:
 * - model - Model name
 * - prompt - prompt text
 *
 * output is the raw response from eich model with unified shape for convenience:
 * - model - model id
 * - text - text with whole response combined
 * - stats - token stats { in, out }
 * - error - error message or object
 */

const { lib } = require('backendjs');
 
module.exports = {
    name: "llm",

    args: [
        { name: "http-timeout", type: "int", descr: "HTTP timeout" },
    ],

    httpTimeout: 300000,

    async openai(options, callback) {

        const rc = await lib.afetch({
            method: "POST",
            url: "https://api.openai.com/v1/responses",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${options.token}`,
            },
            httpTimeout: this.httpTimeout,
            postdata: {
                model: options.model,
                input: options.prompt,
            }
        });
        rc.response = {
            model: options.model,
            error: rc.obj?.error || rc.err,
            stats: { in: rc.obj?.usage?.input_tokens || 0, out: rc.obj?.usage?.output_tokens || 0 },
            text: "",
        }
        for (const item of lib.isArray(rc.obj?.output, [])) {
            for (const part of lib.isArray(item?.content, [])) {
                const text = part.text || part.refusal;
                if (text) {
                    rc.response.text += text + "\n\n";
                }
            }
        }
        lib.call(callback, rc);
        return rc;
    },

    async ollama(options, callback) {

        const rc = await lib.afetch({
            method: "POST",
            url: "http://localhost:11434/api/generate",
            headers: {
                "Content-Type": "application/json",
            },
            httpTimeout: this.httpTimeout,
            postdata: {
                prompt: options.prompt,
                model: options.model,
                stream: false,
            }
        });
        rc.response = {
            model: options.model,
            error: rc.obj?.error || rc.err,
            stats: { in: rc.obj?.prompt_eval_count || 0, out: rc.obj?.eval_count || 0 },
            text: rc.obj?.response,
        }
        lib.call(callback, rc);
        return rc;
    },

    async gemeni(options, callback) {

        const rc = await lib.afetch({
            method: "POST",
            url: `https://generativelanguage.googleapis.com/v1beta/interactions`,
            headers: {
                "x-goog-api-key": options.token,
                "Content-Type": "application/json",
            },
            httpTimeout: this.httpTimeout,
            postdata: {
                store: false,
                model: options.model,
                input: [
                    {
                        type: "user_input",
                        content: options.prompt,
                    }
                ]
            },
        });

        rc.response = {
            model: options.model,
            error: rc.obj?.error || rc.err,
            stats: { in: rc.obj?.usage?.total_input_tokens || 0, out: rc.obj?.usage?.total_output_tokens || 0 },
            text: "",
        }
        for (const step of lib.isArray(rc.obj?.steps, [])) {
            for (const part of lib.isArray(step?.content, [])) {
                if (part.text) {
                    rc.response.text += part.text + "\n\n";
                }
            }
        }
        lib.call(callback, rc);
        return rc;
    },

    async anthropic(options, callback) {

        const rc = await lib.afetch({
            method: "POST",
            url: "https://api.anthropic.com/v1/messages",
            headers: {
                "Content-Type": "application/json",
                "anthropic-version": "2023-06-01",
                "x-api-key": options.token,
            },
            httpTimeout: this.httpTimeout,
            postdata: {
                model: options.model,
                messages: [{
                    role: "user",
                    content: options.prompt,
                }]
            }
        });

        rc.response = {
            model: options.model,
            error: rc.obj?.error || rc.err,
            stats: { in: rc.obj?.usage?.input_tokens || 0, out: rc.obj?.usage?.output_tokens || 0 },
            text: "",
        };
        for (const item of lib.isArray(rc.obj?.content, [])) {
            const text = item.text;
            if (text) {
                rc.response.text += text + "\n\n";
            }
        }
        lib.call(callback, rc);
        return rc;
    },

}


