
const lib = require("../lib");

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
module.exports = class Trace {

    startTimeUnixNano = lib.clockn().toString();
    spanId = lib.randomBytes(8);
    children = [];
    attributes = [];
    resources = [];

    /**
     * @param {string|object} [options] - span name or options
     * @param {string} [options.name]
     * @param {int} [options.kind] - span kind
     * - 1 internal (default),
     * - 2 server,
     * - 3 client,
     * - 4 producer,
     * - 5 consumer
     * @param {string} [options.traceId] - remote trace id
     * @param {string} [options.parentSpanId] - remote parent span id
     * @param {object} [options.attributes] - key/value pairs for span attributes
     * @param {object} [options.resources] - key/value pairs for resources attributes
     * @param {object} [options.scope] - scope as { name, version }
     * @param {Trace} [parent]
     */
    constructor(options, parent)
    {
        if (typeof options === "string") options = { name: options };
        this.name = options?.name || "span";
        this.kind = options?.kind || 1;
        this.traceId = parent?.traceId || options?.traceId || lib.randomBytes(16);
        this.parentSpanId = parent?.spanId || options?.parentSpanId;
        this.addAttributes(options?.attributes);
        this.addResources(options?.resources);
        this.scope = options?.scope?.name ? options.scope : undefined;
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
     * Adds key/value pairs to the span attributes
     * @param {object} attrs
     * @returns {object[]} full list
     */
    addAttributes(attrs)
    {
        return this.#toAttributes(attrs, this.attributes);
    }

    /**
     * Adds key/value pairs to the resource attributes
     * @param {object} attrs
     * @returns {object[]} full list
     */
    addResources(attrs)
    {
        return this.#toAttributes(attrs, this.resources);
    }

    #toAttributes(attrs, list)
    {
        for (const key in attrs) {
            if (!key || lib.isEmpty(attrs[key])) continue;
            list.push({ key, value: this.toValue(attrs[key]) });
        }
        return list;
    }

    /**
     * Set error status
     * @param {int} [code] - OTLP status code:
     *  - 1 - ok
     *  - 2 - error
     *  - 0 - ignored
     * @param {string} [message=error]
     */
    setStatus(code, message)
    {
        switch (code) {
        case 2:
            this.addAttributes({ "error.type": lib.toString(message) || "error" });

        case 1:
            this.status = {
                code,
                message: lib.toString(message) || "error"
            };
            break;
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
    #toSpans(list = [])
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
        for (const child of this.children) child.#toSpans(list);
        return list;
    }

    /**
     * Builds the OTLP/HTTP JSON payload containing this span and its children
     * @param {Object} [env]
     * @returns {object}
     */
    toJSON()
    {
        return {
            resourceSpans: [{
                resource: {
                    attributes: this.resources,
                },
                scopeSpans: [{
                    scope: this.scope,
                    spans: this.#toSpans(),
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
