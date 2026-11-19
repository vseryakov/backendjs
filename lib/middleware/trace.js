/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
'use strict';

const app = require(__dirname + '/../app');
const lib = require(__dirname + '/../lib');
const api = require(__dirname + '/../api');
const OTelTrace = require(__dirname + '/../metrics/OTelTrace');

/**
 * @module middleware/trace
 */

/**
 * Tracing middleware that produces OpenTelemetry spans and exports them as OTLP/HTTP JSON.
 *
 * - `middleware-trace-enable` config only registers routing
 * - `middleware-trace-url` must be set to enable collecting
 * - `middleware-trace-interval` must be not empty/zero to start tracing
 *
 * If the interval is set to -1 then a trace is created for every request.
 *
 * If the interval is greater than 0 the span is sampled only every interval in ms.
 *
 * Incoming W3C `traceparent` header is used as the remote parent.
 *
 * The span instance is exposed as `context.trace` and implements {@link Trace}, child spans can be
 * created with `context.trace.start(...)`.
 *
 * ## Global usage
 *
 * Config:
 * ```
 * middleware-trace-enable = /api/*
 * middleware-trace-interval = 60000
 * middleware-trace-url = http://localhost:4318/v1/traces
 * ```
 *
 * ```js
 * api.app.get("/api/endpoint", middleware.trace)
 * ```
 *
 * ## Explicit routing
 *
 * Add explicit routes with different tracing options
 *
 * ```js
 * api.app.get("/api/endpoint", middleware.trace.handle.bind({ interval: -1, url: "http://localhost:4318/v1/traces" }))
 * ```
 *
 */

const mod = {
    name: "middleware.trace",

    /**
     * @var {ConfigOptions[]}
     * @default
     */
    args: [
        { name: "enable", type: "list", descr: "Enable trace middlware globally for the given list of endpoints" },
        { name: "interval", type: "number", descr: "Interval in ms how often to trace(sampling) requests, 0 - disable, > 0 to sample every ms, -1 to enable for all" },
        { name: "url", descr: "OTLP/HTTP endpoint to send spans, e.g. http://localhost:4318/v1/traces" },
        { name: "headers", type: "json", descr: "Extra headers sent to the OTLP endpoint" },
    ],
    _time: 0,
    retryCount: 3,
};

module.exports = mod;

/**
 * Start global middleware if enabled
 *
 * @memberof module:middleware/trace
 * @method configureMiddleware
 */
mod.configureMiddleware = function(_options, callback)
{
    const method = `#${this.priority ?? ""}`;

    if (mod.enable?.length) {
        for (const path of mod.enable) {
            api.app.use(method, path, mod);
        }
    }

    callback();
}

/**
 * Tracing middleware
 * @param {RequestContext} context
 * @param {function} next
 * @memberof module:middleware/trace
 * @method handle
 */

mod.handle = function(context, next)
{
    if (!this.url ||
        !this.interval ||
        (this.interval > 0 && context.time - (this._time ?? 0) < this.interval)) {
        return next();
    }
    this._time = context.time;

    // traceparent: version-traceid-parentid-flags
    const tp = /^[0-9a-f]{2}-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/.exec(context.req?.headers?.traceparent || "");

    context.trace = new OTelTrace({
        name: `${context.method} ${context.route?.path || "/"}`,
        kind: 2,
        traceId: tp?.[1],
        parentSpanId: tp?.[2],
        attributes: {
            "http.request_id": context.reqID,
            "http.request.method": context.method,
            "url.scheme": context.proto,
            "server.address": context.hostname,
            "client.address": context.ip,
            "user_agent.original": context.req?.headers?.["user-agent"],
        },
        resources: {
            "service.name": app.env.tag || app.env.app,
            "service.version": app.env.version,
            "service.instance.id": app.env.id,
            "process.pid": app.env.pid,
        },
        scope: {
            name: app.env.app,
            version: app.env.version,
        },
    });

    context.on("destroy", () => {
        const trace = context.trace;
        if (!trace?.stop) return;
        context.trace = undefined;
        trace.stop();

        if (!this.url) return;

        trace.addAttributes({
            "http.route": context.route?.path,
            "http.response.status_code": context.statusCode,
            "url.path": context.path,
            "url.query": context.search,
        });
        trace.setStatus(context.statusCode >= 500 ? 2 : 0, context.statusCode);

        lib.fetch(this.url, {
            method: "POST",
            postdata: trace.toJSON(),
            headers: this.headers,
            retryOnError: true,
            retryCount: this.retryCount,
        });
    });

    next();
}

