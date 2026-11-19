
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { ainit, astop } = require("./utils");
const { api, lib, middleware } = require("../");

describe('Trace middleware tests', async () => {

    const traces = [];
    let host, url;

    // Wait for the collector to receive the given number of payloads, export happens after the response
    async function waitTraces(count, timeout = 2000) {
        const started = Date.now();
        while (traces.length < count && Date.now() - started < timeout) await lib.sleep(20);
        return traces;
    }

    function attrs(list) {
        return Object.fromEntries((list || []).map(x => [x.key, Object.values(x.value)[0]]));
    }

    before(async () => {
        await ainit({ api: 1, nodb: 1, noipc: 1, roles: "trace" });
        host = "http://127.0.0.1:" + api.port;
        url = host + "/v1/traces";

        api.app.post("/v1/traces", (context) => {
            traces.push(context.body);
            context.send(200);
        });

        api.app.get("/global/:id", (context) => {
            const child = context.trace.start("child");
            child.addAttributes({ id: context.params.id });
            context.send(200, "ok");
        });

        api.app.get("/global/error/fail", (context) => { context.send(500, "fail") });

        api.app.get("/explicit", middleware.trace.handle.bind({ interval: -1, url }), (context) => {
            context.send(200, String(!!context.trace));
        });

        api.app.get("/sampled", middleware.trace.handle.bind({ interval: 60000, url }), (context) => {
            context.send(200, String(!!context.trace));
        });

        api.app.get("/disabled", middleware.trace.handle.bind({ interval: 0, url }), (context) => {
            context.send(200, String(!!context.trace));
        });

        api.app.get("/nourl", middleware.trace.handle.bind({ interval: -1 }), (context) => {
            context.send(200, String(!!context.trace));
        });
    });

    beforeEach(() => { traces.length = 0 });

    it("exports server span with child for global route", async () => {
        const rc = await lib.afetch(host + "/global/123?a=1", { headers: { "user-agent": "trace-test" } });
        assert.equal(rc.status, 200);

        await waitTraces(1);
        assert.equal(traces.length, 1);

        const rs = traces[0].resourceSpans[0];
        const spans = rs.scopeSpans[0].spans;
        assert.equal(spans.length, 2);

        const [root, child] = spans;
        // global middleware runs under its own route, not the final handler route
        assert.equal(root.name, "GET /global/*");
        assert.equal(root.kind, 2);
        assert.match(root.traceId, /^[0-9a-f]{32}$/);
        assert.match(root.spanId, /^[0-9a-f]{16}$/);
        assert.ok(!root.parentSpanId);
        assert.ok(BigInt(root.endTimeUnixNano) >= BigInt(root.startTimeUnixNano));
        assert.ok(!root.status);

        const a = attrs(root.attributes);
        assert.equal(a["http.route"], "/global/:id");
        assert.equal(a["http.request.method"], "GET");
        assert.equal(a["url.path"], "/global/123");
        assert.equal(a["user_agent.original"], "trace-test");
        assert.equal(a["http.response.status_code"], 200);

        assert.equal(child.name, "child");
        assert.equal(child.kind, 1);
        assert.equal(child.traceId, root.traceId);
        assert.equal(child.parentSpanId, root.spanId);
        assert.equal(attrs(child.attributes).id, "123");

        assert.ok(attrs(rs.resource.attributes)["process.pid"]);
    });

    it("sets error status for 5xx", async () => {
        const rc = await lib.afetch(host + "/global/error/fail");
        assert.equal(rc.status, 500);

        await waitTraces(1);
        const root = traces[0].resourceSpans[0].scopeSpans[0].spans[0];
        assert.deepEqual(root.status, { code: 2, message: "500" });
        assert.equal(attrs(root.attributes)["http.response.status_code"], 500);
        assert.equal(attrs(root.attributes)["error.type"], "500");
    });

    it("uses incoming traceparent as remote parent", async () => {
        const traceId = lib.randomBytes(16), parentId = lib.randomBytes(8);
        await lib.afetch(host + "/global/1", { headers: { traceparent: `00-${traceId}-${parentId}-01` } });

        await waitTraces(1);
        const root = traces[0].resourceSpans[0].scopeSpans[0].spans[0];
        assert.equal(root.traceId, traceId);
        assert.equal(root.parentSpanId, parentId);
    });

    it("ignores invalid traceparent", async () => {
        await lib.afetch(host + "/global/1", { headers: { traceparent: "00-bad-value-01" } });

        await waitTraces(1);
        const root = traces[0].resourceSpans[0].scopeSpans[0].spans[0];
        assert.match(root.traceId, /^[0-9a-f]{32}$/);
        assert.ok(!root.parentSpanId);
    });

    it("traces explicit routes", async () => {
        const rc = await lib.afetch(host + "/explicit");
        assert.equal(rc.data, "true");

        await waitTraces(1);
        assert.equal(traces.length, 1);
        assert.equal(traces[0].resourceSpans[0].scopeSpans[0].spans[0].name, "GET /explicit");
    });

    it("samples by interval", async () => {
        const rc1 = await lib.afetch(host + "/sampled");
        const rc2 = await lib.afetch(host + "/sampled");
        assert.equal(rc1.data, "true");
        assert.equal(rc2.data, "false");

        await waitTraces(2, 500);
        assert.equal(traces.length, 1);
    });

    it("does not trace when disabled or no url", async () => {
        assert.equal((await lib.afetch(host + "/disabled")).data, "false");
        assert.equal((await lib.afetch(host + "/nourl")).data, "false");

        await waitTraces(1, 500);
        assert.equal(traces.length, 0);
    });

    after(async () => {
        await astop();
    });
});
