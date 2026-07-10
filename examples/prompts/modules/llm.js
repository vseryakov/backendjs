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
        { name: "max-tokens", type: "int", descr: "Max tokens limit" },
        { name: "reasoning", type: "int", descr: "Reasoning level" },
        { name: "temperature", type: "int", descr: "Temperature" },
        { name: "system", type: "int", descr: "Ssystem prompt" },
    ],

    httpTimeout: 300000,
    maxTokens: 5000,

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
                max_output_tokens: options.max_tokens || this.maxTokens,
                temperature: options.temperature || this.temperature,
                input: options.prompt,
                instructions: options.system || this.system,
                reasoning: {
                    effort: options.reasoning || this.reasoning,
                }
            }
        });

        rc.response = {
            model: options.model,
            error: rc.obj?.error || rc.err || (!rc.ok && rc.data),
            stats: {
                duration: rc.request.elapsed,
                cached: rc.obj?.usage.input_tokens_details?.cached_tokens || 0,
                in: rc.obj?.usage?.input_tokens || 0,
                out: rc.obj?.usage?.output_tokens || 0
            },
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

    async openaichat(options, callback) {

        const rc = await lib.afetch({
            method: "POST",
            url: "https://api.openai.com/v1/chat/completions",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${options.token}`,
            },
            httpTimeout: this.httpTimeout,
            postdata: {
                model: options.model,
                max_completion_tokens: options.max_tokens || this.maxTokens,
                temperature: options.temperature || this.temperature,
                reasoning_effort: options.reasoning || this.reasoning,
                messages: [{
                    role: "user",
                    content: options.prompt,
                }]
            }
        });

        if (options.system || this.system) {
            rc.postdata.messages.unshift({ role: "system", content: options.system || this.system })
        }

        rc.response = {
            model: options.model,
            error: rc.obj?.error || rc.err || (!rc.ok && rc.data),
            stats: {
                duration: rc.request.elapsed,
                cached: rc.obj?.usage?.prompt_tokens_details?.cached_tokens || 0,
                in: rc.obj?.usage?.prompt_tokens || 0,
                out: rc.obj?.usage?.completion_tokens || 0
            },
            text: "",
        }
        for (const item of lib.isArray(rc.obj?.choices, [])) {
            const text = item?.message?.content || item?.message?.refusal;
            if (text) {
                rc.response.text += text + "\n\n";
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
                system: options.system || this.system,
                options: {
                    temperature: options.temperature || this.temperature,
                }
            }
        });
        rc.response = {
            model: options.model,
            error: rc.obj?.error || rc.err || (!rc.ok && rc.data),
            stats: {
                duration: rc.request.elapsed,
                load_duration: rc.obj?.load_duration,
                eval_duration: rc.obj?.eval_duration,
                in: rc.obj?.prompt_eval_count || 0,
                out: rc.obj?.eval_count || 0
            },
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
                system_instruction: options.system || this.system,
                input: [
                    {
                        type: "user_input",
                        content: options.prompt,
                    }
                ],
                generation_config: {
                    max_output_tokens: options.max_tokens || this.maxTokens,
                    temperature: options.temperature || this.temperature,
                }
            },
        });

        rc.response = {
            model: options.model,
            error: rc.obj?.error || rc.err || (!rc.ok && rc.data),
            stats: {
                duration: rc.request.elapsed,
                cached: lib.toNumber(rc.obj?.usageMetadata?.cachedContentTokenCount),
                in: lib.toNumber(rc.obj?.usageMetadata?.promptTokenCount),
                out: lib.toNumber(rc.obj?.usageMetadata?.totalTokenCount) - lib.toNumber(rc.obj?.usageMetadata?.promptTokenCount),
            },
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
                max_tokens: options.max_tokens || this.maxTokens,
                system: options.system || this.system,
                output_config: {
                    effort: options.reasoning || this.reasoning,
                },
                messages: [{
                    role: "user",
                    content: options.prompt,
                }]
            }
        });

        rc.response = {
            model: options.model,
            error: rc.obj?.error || rc.err || (!rc.ok && rc.data),
            stats: {
                duration: rc.request.elapsed,
                cached: rc.obj?.usage?.cache_read_input_tokens || 0,
                in: rc.obj?.usage?.input_tokens || 0,
                out: rc.obj?.usage?.output_tokens || 0
            },
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


