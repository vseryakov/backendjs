/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
'use strict';

const app = require(__dirname + '/../app');
const lib = require(__dirname + '/../lib');
const api = require(__dirname + '/../api');

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

    context.trace = new Trace({
        name: `${context.method} ${context.route?.path || "/"}`,
        kind: 2,
        traceId: tp?.[1],
        parentSpanId: tp?.[2],
    });

    context.on("destroy", () => {
        const trace = context.trace;
        if (!trace?.stop) return;
        context.trace = undefined;
        trace.stop();

        if (!this.url) return;

        lib.fetch(this.url, {
            method: "POST",
            postdata: trace.toOTLP(context),
            headers: this.headers,
            retryOnError: true,
            retryCount: this.retryCount,
        });
    });

    next();
}

/**
 * Minimal OpenTelemetry span producer that exports OTLP/HTTP JSON spans.
 *
 * @example
 * const span = new Trace({ name: "GET /api", kind: 2 });
 * const child = span.start("db.query");
 * child.stop();
 * span.stop();
 * @class Trace
 */
class Trace {

    startTimeUnixNano = lib.clockn().toString();
    spanId = lib.randomBytes(8);
    attributes = [];
    children = [];

    /**
     * @param {string|object} [options] - span name or options
     * @param {string} [options.name]
     * @param {int} [options.kind] - SpanKind, 1 internal (default), 2 server, 3 client, 4 producer, 5 consumer
     * @param {string} [options.traceId] - remote trace id
     * @param {string} [options.parentSpanId] - remote parent span id
     * @param {object} [options.attributes]
     * @param {Trace} [parent]
     */
    constructor(options, parent)
    {
        if (typeof options === "string") options = { name: options };
        this.name = options?.name || "span";
        this.kind = options?.kind || 1;
        this.traceId = parent?.traceId || options?.traceId || lib.randomBytes(16);
        this.parentSpanId = parent?.spanId || options?.parentSpanId;
        this.setAttributes(options?.attributes);
    }

    /**
     * Starts a new child span
     * @param {string|object} [options]
     * @returns {Trace}
     */
    start(options)
    {
        var trace = new Trace(options, this);
        this.children.push(trace);
        return trace;
    }

    /**
     * Ends this span and all not ended children
     * @param {object} [options]
     */
    stop(options)
    {
        if (this.endTimeUnixNano) return;
        this.endTimeUnixNano = lib.clockn().toString();
        for (const child of this.children) child.stop();
    }

    /**
     * Adds typed attributes to the span
     * @param {object} attrs
     */
    setAttributes(attrs)
    {
        for (const key in attrs) {
            if (lib.isEmpty(attrs[key])) continue;
            this.attributes.push({ key, value: this.toValue(attrs[key]) });
        }
    }

    /**
     * Records an event on the span
     * @param {string} name
     * @param {object} [attrs]
     */
    addEvent(name, attrs)
    {
        this.events ??= [];
        this.events.push({
            name,
            timeUnixNano: lib.clockn().toString(),
            attributes: lib.objKeys(attrs).map(key => ({ key, value: this.toValue(attrs[key]) })),
        });
    }

    /**
     *  Returns this span and all descendants as OTLP span objects
     * @param {object[]} [list]
     * @returns {object[]}
     */
    toSpans(list = [])
    {
        list.push({
            traceId: this.traceId,
            spanId: this.spanId,
            parentSpanId: this.parentSpanId,
            name: this.name,
            kind: this.kind,
            startTimeUnixNano: this.startTimeUnixNano,
            endTimeUnixNano: this.endTimeUnixNano || lib.clockn().toString(),
            attributes: this.attributes,
            events: this.events,
            status: this.status,
        });
        for (const child of this.children) child.toSpans(list);
        return list;
    }

    /**
     * Builds the OTLP/HTTP JSON payload containing this span and its children
     * @param {RequestContext} [context]
     * @returns {object}
     */
    toOTLP(context)
    {
        if (context) {
            this.setAttributes({
                "http.response.status_code": context.statusCode,
                "http.route": context.route?.path,
                "http.request_id": context.reqID,
                "http.request.method": context.method,
                "url.path": context.path,
                "url.query": context.search,
                "url.scheme": context.proto,
                "server.address": context.hostname,
                "client.address": context.ip,
                "user_agent.original": context.req?.headers?.["user-agent"],
            });

            if (context.statusCode >= 500) {
                this.status = { code: 2, message: String(context.statusCode) };
                this.setAttributes({ "error.type": String(context.statusCode) });
            }
        }

        const resource = {
            attributes: [
                { key: "service.name", value: { stringValue: app.env.tag || app.env.app } },
                { key: "service.version", value: { stringValue: app.env.version } },
                { key: "service.instance.id", value: { stringValue: app.env.id } },
                { key: "process.pid", value: { intValue: app.env.pid } },
            ],
        };

        return {
            resourceSpans: [{
                resource,
                scopeSpans: [{
                    scope: {
                        name: app.env.app,
                        version: app.env.version
                    },
                    spans: this.toSpans(),
                }]
            }]
        };
    }

    /**
     * Converts a JS value to an OTLP AnyValue
     * @param {any} val
     * @returns {object}
     *
     */
    toValue(val)
    {
        switch (typeof val) {
        case "number": return Number.isInteger(val) ? { intValue: val } : { doubleValue: val };
        case "bigint": return { intValue: String(val) };
        case "boolean": return { boolValue: val };
        default:
            if (Array.isArray(val)) return { arrayValue: { values: val.map(this.toValue) } };
            return { stringValue: lib.toString(val) };
        }
    }
}

mod.Trace = Trace;


