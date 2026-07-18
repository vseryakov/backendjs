
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const cluster = require("node:cluster");
const { app, ipc, lib, cache } = require("../");
const { ainit } = require("./utils");

const roles = process.env.BKJS_ROLES || "worker-sys";

app.noRestart = app.exitOnEmpty = true;

describe("IPC tests", { skip: 1 }, () => {

    if (cluster.isPrimary) {
        return app.start({ server: 1, ipc: 1, roles, config: __dirname + "/bkjs.conf" }, () => {
            process.exit();
        });
    }

    before(async () => {
        await ainit({ nodb: 1, ipc: 1, cache: 1, roles });
    });

    after(async () => {
        await app.astop();

        if (cluster.isWorker) {
            process.exit();
        }
    });

    describe("newMsg", () => {

        it("returns the same object when it already has __op", () => {
            const orig = { __op: "op1", a: 1 };
            const msg = ipc.newMsg(orig);
            assert.strictEqual(msg, orig);
        });

        it("builds a message from op and object", () => {
            const msg = ipc.newMsg("op1", { a: 1 });
            assert.strictEqual(msg.__op, "op1");
            assert.strictEqual(msg.a, 1);
            assert.strictEqual(typeof msg.__msgid, "number");
        });

        it("assigns incrementing message ids", () => {
            const m1 = ipc.newMsg("op1", {});
            const m2 = ipc.newMsg("op1", {});
            assert.ok(m2.__msgid > m1.__msgid);
        });

        it("coerces the op to a string", () => {
            const msg = ipc.newMsg(123, {});
            assert.strictEqual(msg.__op, "123");
        });

        it("parses a JSON string op", () => {
            const msg = ipc.newMsg('{"__op":"op2","b":2}');
            assert.strictEqual(msg.__op, "op2");
            assert.strictEqual(msg.b, 2);
        });

        it("parses a JSON string message", () => {
            const msg = ipc.newMsg("op1", '{"c":3}');
            assert.strictEqual(msg.__op, "op1");
            assert.strictEqual(msg.c, 3);
        });
    });

    describe("emitMsg", () => {

        it("emits an event with a wrapped message", async () => {
            const p = waitFor("evt1", 1000);
            ipc.emitMsg("evt1", { a: 1 });
            const { msg } = await p;
            assert.strictEqual(msg.__op, "evt1");
            assert.strictEqual(msg.a, 1);
        });

        it("does nothing without an op", () => {
            let called = 0;
            const h = () => called++;
            ipc.on("", h);
            ipc.emitMsg("");
            ipc.removeListener("", h);
            assert.strictEqual(called, 0);
        });
    });

    describe("sendMsg (server role)", () => {

        it("processes the message directly and calls back", async () => {
            const p = waitFor("op3", 1000);
            let cbMsg;
            ipc.sendMsg("op3", { x: 1 }, (msg) => { cbMsg = msg; });
            const { msg } = await p;
            assert.strictEqual(msg.__op, "op3");
            assert.strictEqual(msg.x, 1);
            assert.strictEqual(cbMsg.__op, "op3");
        });

        it("supports options argument before callback", async () => {
            let cbMsg;
            ipc.sendMsg("op4", { y: 2 }, { timeout: 100 }, (msg) => { cbMsg = msg; });
            assert.strictEqual(cbMsg.__op, "op4");
            assert.strictEqual(cbMsg.y, 2);
        });
    });

    describe("handleServerMessages", () => {

        it("tracks listening ports on cluster:listen", () => {
            const worker = { process: { pid: 111 }, send: lib.noop };
            ipc.handleServerMessages(worker, ipc.newMsg("cluster:listen", { port: 5555 }));
            assert.strictEqual(ipc.ports[5555], 111);
        });

        it("clears the port for a worker on cluster:exit", () => {
            const worker = { process: { pid: 222 }, send: lib.noop };
            ipc.handleServerMessages(worker, ipc.newMsg("cluster:listen", { port: 5556 }));
            assert.strictEqual(ipc.ports[5556], 222);

            ipc.handleServerMessages(worker, ipc.newMsg("cluster:exit", { id: 1, pid: 222 }));
            assert.strictEqual(ipc.ports[5556], 0);
            assert.strictEqual(worker.pingTime, -1);
        });

        it("updates pingTime on worker:ping", () => {
            const worker = { process: { pid: 333 }, send: lib.noop };
            const before = Date.now() - 1;
            ipc.handleServerMessages(worker, ipc.newMsg("worker:ping", {}));
            assert.ok(worker.pingTime >= before);
        });

        it("handles ipc:lock and ipc:unlock", () => {
            const replies = [];
            const worker = { process: { pid: 444 }, send: (msg) => replies.push(msg) };

            ipc.handleServerMessages(worker, ipc.newMsg("ipc:lock", { name: "L1" }));
            assert.strictEqual(replies[0].locked, true);

            ipc.handleServerMessages(worker, ipc.newMsg("ipc:lock", { name: "L1" }));
            assert.strictEqual(replies[1].locked, false);

            ipc.handleServerMessages(worker, ipc.newMsg("ipc:unlock", { name: "L1" }));

            ipc.handleServerMessages(worker, ipc.newMsg("ipc:lock", { name: "L1" }));
            assert.strictEqual(replies[3].locked, true);

            ipc.handleServerMessages(worker, ipc.newMsg("ipc:unlock", { name: "L1" }));
        });

        it("emits the event for any op", async () => {
            const worker = { process: { pid: 555 }, send: lib.noop };
            const p = waitFor("custom:op", 1000);
            ipc.handleServerMessages(worker, ipc.newMsg("custom:op", { v: 9 }));
            const { msg, worker: w } = await p;
            assert.strictEqual(msg.v, 9);
            assert.strictEqual(w, worker);
        });

        it("returns false for an empty message", () => {
            assert.strictEqual(ipc.handleServerMessages({}, null), false);
        });
    });

    describe("handleWorkerMessages", () => {

        it("emits the event for the op", async () => {
            const p = waitFor("wop1", 1000);
            ipc.handleWorkerMessages(ipc.newMsg("wop1", { a: 1 }));
            const { msg } = await p;
            assert.strictEqual(msg.a, 1);
        });

        it("ignores empty messages", () => {
            assert.doesNotThrow(() => ipc.handleWorkerMessages(null));
        });

        it("handles ipc:lru:del", () => {
            cache.lru.put("k1", "v1");
            const msg = ipc.newMsg("ipc:lru:del", { name: "k1" });
            ipc.handleWorkerMessages(msg);
            assert.strictEqual(cache.lru.get("k1"), undefined);
        });
    });

    describe("sendReplPort", () => {

        it("does nothing without a worker process", () => {
            assert.doesNotThrow(() => ipc.sendReplPort("web", null));
            assert.doesNotThrow(() => ipc.sendReplPort("web", {}));
        });

        it("assigns and sends a repl port when configured", () => {
            const saved = app.repl.webPort;
            app.repl.webPort = 8123;
            ipc.ports = {};

            const sent = [];
            const worker = { id: 1, process: { pid: 777 }, send: (m) => sent.push(m) };
            ipc.sendReplPort("web", worker);

            assert.strictEqual(sent.length, 1);
            assert.strictEqual(sent[0].__op, "repl:init");
            assert.strictEqual(sent[0].port, 8123);
            assert.strictEqual(ipc.ports[8123], 777);

            app.repl.webPort = saved;
        });
    });

    describe("cluster messaging", () => {

        let worker, hello, lock;

        before(() => {
            // Register all listeners before forking so no early message is missed
            hello = waitFor("test:hello", 8000);
            lock = waitFor("test:lock", 8000);
            worker = cluster.fork();
        });

        it("receives messages from a real worker process", async () => {
            const { msg, worker: w } = await hello;
            assert.strictEqual(msg.pid, worker.process.pid);
            assert.ok(w);
        });

        it("updates pingTime from a real worker", async () => {
            // worker sends a ping right after hello; give it a moment
            await lib.sleep(300);
            assert.ok(worker.pingTime >= worker.startTime);
        });

        it("handles a round trip request with reply", async () => {
            const { msg } = await lock;
            assert.strictEqual(msg.locked, true);
        });
    });
});
