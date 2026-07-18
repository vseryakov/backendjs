
const { before, after, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const cluster = require('node:cluster');
const { app, ipc, queue, cache } = require("../");
const { ainit } = require("./utils");

const roles = process.env.BKJS_ROLES;

if (roles != "worker") process.exit();

app.noRestart = app.exitOnEmpty = true;

if (cluster.isPrimary) {
    return app.start({ server: 1, roles, config: __dirname + "/bkjs.conf" }, () => {
        process.exit();
    });
}

describe("ipc checks", () => {

    before(async () => {
        await ainit({ nodb: 1, ipc: 1, cache: 1, roles: process.env.BKJS_ROLES });
    });

    after(async () => {
        await app.astop();

        if (cluster.isWorker) {
            process.exit();
        }
    });

    describe("newMsg", () => {
        it("creates a message with __op and __msgid", () => {
            const msg = ipc.newMsg("test-op", { data: 1 });
            assert.strictEqual(msg.__op, "test-op");
            assert.ok(typeof msg.__msgid === 'number');
            assert.strictEqual(msg.data, 1);
        });

        it("returns object as is if it has __op", () => {
            const obj = { __op: "existing", a: 1 };
            const msg = ipc.newMsg(obj);
            assert.strictEqual(msg, obj);
        });

        it("parses JSON string starting and ending with curly braces", () => {
            const jsonString = '{"__op": "json-op", "a": 1}';
            const msg = ipc.newMsg(jsonString);
            assert.strictEqual(msg.__op, "json-op");
            assert.strictEqual(msg.a, 1);
        });

        it("handles string op and object msg", () => {
            const msg = ipc.newMsg("string-op", { a: 2 });
            assert.strictEqual(msg.__op, "string-op");
            assert.strictEqual(msg.a, 2);
        });

        it("parses JSON if the second argument is a string", () => {
            const msg = ipc.newMsg("op", '{"a":3}');
            assert.strictEqual(msg.__op, "op");
            assert.strictEqual(msg.a, 3);
        });
    });

    describe("emitMsg", () => {
        it("emits the message to listeners", (t, done) => {
            const op = "test-event";
            const data = { val: 42 };
            ipc.once(op, (msg) => {
                assert.strictEqual(msg.__op, op);
                assert.strictEqual(msg.val, 42);
                done();
            });
            ipc.emitMsg(op, data);
        });
    });

    describe("handleWorkerMessages", () => {
        it("calls deferred callback if __msgid matches", (t, done) => {
            cluster.isWorker = true;
            ipc.role = "worker";
            
            const originalSend = process.send;
            let sentMsg = null;
            process.send = (msg) => { sentMsg = msg; };

            ipc.sendMsg("test-op", { data: 1 }, (reply) => {
                assert.strictEqual(reply.__msgid, sentMsg.__msgid);
                done();
            });

            // Now simulate receiving the response from server
            const replyMsg = { ...sentMsg, __op: "test-reply" };
            ipc.handleWorkerMessages(replyMsg);

            process.send = originalSend;
        });

        it("handles repl:init", () => {
            const msg = { __op: "repl:init", port: 8080 };
            ipc.handleWorkerMessages(msg);
        });

        it("handles ipc:lru:del", () => {
            const msg = { __op: "ipc:lru:del", name: "my-key" };
            ipc.handleWorkerMessages(msg);
            assert.strictEqual(msg.data, "deleted my-key");
        });

        it("emits the operation event", (t, done) => {
            const op = "custom-event";
            const msg = { __op: op };
            ipc.once(op, () => {
                done();
            });
            ipc.handleWorkerMessages(msg);
        });
    });

    describe("handleServerMessages", () => {
        it("handles worker:ping by updating pingTime", () => {
            const worker = { id: 1, process: { pid: 123 } };
            const msg = { __op: "worker:ping" };
            ipc.handleServerMessages(worker, msg);
            assert.ok(worker.pingTime > 0);
        });

        it("handles cluster:listen by updating ports", () => {
            const worker = { id: 1, process: { pid: 456 } };
            const msg = { __op: "cluster:listen", port: 3000 };
            ipc.handleServerMessages(worker, msg);
            assert.strictEqual(ipc.ports[3000], 456);
        });

        it("handles ipc:lru:del", () => {
            const worker = { id: 1, process: { pid: 789 } };
            const msg = { __op: "ipc:lru:del", name: "test-key" };
            ipc.handleServerMessages(worker, msg);
            assert.strictEqual(msg.data, "deleted test-key");
        });

        it("emits the operation event", (t, done) => {
            const op = "server-event";
            const msg = { __op: op };
            const worker = { id: 1, process: { pid: 123 } };
            ipc.once(op, () => {
                done();
            });
            ipc.handleServerMessages(worker, msg);
        });
    });

    describe("sendMsg", () => {
        it("handles server role immediately calling handleServerMessages", (t, done) => {
            cluster.isWorker = false;
            ipc.role = "server";
            const op = "test-op";
            const data = { a: 1 };
            ipc.sendMsg(op, data, (reply) => {
                assert.strictEqual(reply.__op, op);
                done();
            });
        });

        it("handles worker role by calling process.send", () => {
            cluster.isWorker = true;
            ipc.role = "worker";
            const originalSend = process.send;
            let sentMsg = null;
            process.send = (msg) => { sentMsg = msg; };

            ipc.sendMsg("test-op", { a: 1 });
            assert.ok(sentMsg);
            assert.strictEqual(sentMsg.__op, "test-op");

            process.send = originalSend;
        });
    });

    describe("broadcast", () => {
        it("calls queue.publish with correct channel", () => {
            let publishedChannel = null;
            queue.publish = (channel) => { publishedChannel = channel; };
            
            ipc.broadcast(":test-channel", "hello");
            assert.strictEqual(publishedChannel, app.id + ":test-channel");
        });

        it("supports custom queue name in options", () => {
            let usedQueue = null;
            queue.publish = (chan, msg, options) => { usedQueue = options?.queueName; };
            
            ipc.broadcast("chan", "msg", { queueName: "custom-q" });
            assert.strictEqual(usedQueue, "custom-q");
        });
    });

    describe("shutdown", () => {
        it("clears timers and calls callback", (t, done) => {
            ipc.shutdown({}, () => {
                done();
            });
        });
    });

});
