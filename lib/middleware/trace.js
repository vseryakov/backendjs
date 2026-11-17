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
 * middleware-trace-path = ^/api
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
 * api.app.get("/api/endpoint", middleware.trace.handle.bind({ path: /^\//, interval: 1000, url: "http://localhost:4318/v1/traces" }))
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
        { name: "interval", type: "number", descr: "Interval in ms how often to trace requests, 0 - disable, > 0 to sample every ms, -1 to enable for all" },
        { name: "url", descr: "OTLP/HTTP endpoint to send spans, e.g. http://localhost:4318/v1/traces" },
        { name: "headers", type: "json", descr: "Extra headers sent to the OTLP endpoint" },
        { name: "scope", descr: "Scope name" },
        { name: "version", descr: "Scope version" },
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
    if (!this.interval ||
        (this.interval > 0 && context.time - (this._time ?? 0) < this.interval)) {
        return next();
    }
    this._time = context.time;

    // traceparent: version-traceid-parentid-flags
    const tp = /^[0-9a-f]{2}-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/.exec(context.req?.headers?.traceparent || "");

    context.trace = new Trace({
        name: context.method,
        kind: 2,
        traceId: tp?.[1],
        parentSpanId: tp?.[2],
        attributes: {
            "http.request.method": context.method,
            "url.path": context.path,
            "url.query": context.search,
            "url.scheme": context.proto,
            "server.address": context.hostname,
            "client.address": context.ip,
            "user_agent.original": context.req?.headers?.["user-agent"],
            "http.request_id": context.reqID,
        }
    });

    const url = this.url, headers = this.headers, retryCount = this.retryCount;

    context.on("destroy", () => {
        const trace = context.trace;
        if (!trace?.stop) return;
        context.trace = undefined;

        const status = context.statusCode;
        const route = context.route?.path;
        if (route) trace.name = `${context.method} ${route}`;
        const error = status >= 500 && String(status);
        trace.setAttributes({
            "http.route": route,
            "http.response.status_code": status,
            "error.type": error || undefined
        });
        trace.stop({ error });

        if (url) {
            lib.fetch(url, {
                method: "POST",
                postdata: trace.toOTLP({
                    "service.name": app.env.tag || app.env.app,
                    "service.version": app.env.version,
                    "service.instance.id": `${app.env.id}:${app.env.pid}`,
                    "process.pid": process.pid,
                }, {
                    name: mod.scope || app.env.app,
                    version: mod.version || app.env.version
                }),
                headers,
                retryOnError: true,
                retryCount,
            }, () => trace.destroy());
        } else {
            trace.destroy();
        }
    });

    next();
}

// OTLP timestamps are uint64 nanoseconds which do not fit into a JS number, use strings as allowed by OTLP/JSON
function now()
{
    return String(BigInt(Math.round((performance.timeOrigin + performance.now()) * 1000)) * 1000n);
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

    startTimeUnixNano = now();
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
     * @memberOf Trace
     * @method start
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
     * @param {boolean|string} [options.error] - set status to error with optional message
     * @memberOf Trace
     * @method stop
     */
    stop(options)
    {
        if (this.endTimeUnixNano) return;
        if (options?.error) {
            this.status = {
                code: 2,
                message: typeof options.error === "string" ? options.error : undefined
            };
        }
        this.endTimeUnixNano = now();
        for (const child of this.children) child.stop();
    }

    /**
     * Destroy all spans
     * @method destroy
     * @memberOf Trace
     */
    destroy()
    {
        for (const child of this.children) child.destroy();
        this.children = this.attributes = this.events = undefined;
    }

    /**
     * Adds typed attributes to the span
     * @param {object} attrs
     * @memberOf Trace
     * @method setAttributes
     */
    setAttributes(attrs)
    {
        for (const key in attrs) {
            if (lib.isEmpty(attrs[key])) continue;
            this.attributes.push({ key, value: toValue(attrs[key]) });
        }
    }

    /**
     * Records an event on the span
     * @param {string} name
     * @param {object} [attrs]
     * @memberOf Trace
     * @method addEvent
     */
    addEvent(name, attrs)
    {
        this.events ??= [];
        this.events.push({
            name,
            timeUnixNano: now(),
            attributes: Object.keys(attrs || {}).map(key => ({ key, value: toValue(attrs[key]) })),
        });
    }

    // Returns this span and all descendants as OTLP span objects
    toSpans(list = [])
    {
        list.push({
            traceId: this.traceId,
            spanId: this.spanId,
            parentSpanId: this.parentSpanId,
            name: this.name,
            kind: this.kind,
            startTimeUnixNano: this.startTimeUnixNano,
            endTimeUnixNano: this.endTimeUnixNano || now(),
            attributes: this.attributes,
            events: this.events,
            status: this.status,
        });
        for (const child of this.children) child.toSpans(list);
        return list;
    }

    /**
     * Builds the OTLP/HTTP JSON payload containing this span and its children
     * @param {object} [resource] - resource attributes
     * @param {object} [scope] - instrumentation scope, { name, version }
     * @memberOf Trace
     * @method toOTLP
     */
    toOTLP(resource, scope)
    {
        return {
            resourceSpans: [{
                resource: {
                    attributes: Object.keys(resource || {}).
                                       filter(k => !lib.isEmpty(resource[k])).
                                       map(key => ({ key, value: toValue(resource[key]) }))
                },
                scopeSpans: [{
                    scope: scope || { name: "backendjs" },
                    spans: this.toSpans(),
                }]
            }]
        };
    }
}
mod.Trace = Trace;

// Converts a JS value to an OTLP AnyValue
function toValue(v)
{
    switch (typeof v) {
    case "number": return Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v };
    case "bigint": return { intValue: String(v) };
    case "boolean": return { boolValue: v };
    default:
        if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
        return { stringValue: String(v) };
    }
}
