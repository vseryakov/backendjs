'use strict';

const { describe, it, before, after } = require('node:test');
const { ainit, astop } = require("./utils");
const { api, lib, logger } = require("../");
const assert = require('node:assert/strict');
const WS = require(__dirname + "/../dist/ws");

describe('Websocket tests', async () => {

    let ws, message, session;

    before(async () => {
        await ainit({ api: 1, noipc: 1, roles: "users,sqlite" })

        api.app.all("/ws/*", (context) => {
            if (context.method == "GET") {
                context.send(200, context.params[0]);
            } else {
                context.json(context.body);
            }

            switch (context.params[0]) {
            case "time":
                setTimeout(() => { api.ws.notify({}, "wstime") }, 200);
                break;
            case "noq":
                setTimeout(() => { api.ws.notify({ query: { q: "noq" } }, "wsnoq") }, 200);
                break;
            case "q":
                setTimeout(() => { api.ws.notify({ query: { q: "q" } }, "wsq") }, 200);
                break;
            case "test":
                setTimeout(() => { api.ws.notify({ user: { roles: "test" } }, "wstest") }, 200);
                break;
            case "admin":
                setTimeout(() => { api.ws.notify({ user: { roles: "admin" } }, "wsadmin") }, 200);
                break;
            }
        })

        ws = await connect();
    });

    const connect = async () => {
        const opts = { headers: {} }
        if (session) opts.headers.cookie = `${api.session.header}=${session}`;
        const w = new WS.WebSocket(`ws://127.0.0.1:${api.port}/ws/1?q=q`, opts);
        w.on("error", (err) => {
            logger.error("ws.test", err);
        });
        w.on('message', (msg) => {
            message = msg.toString();
            logger.debug("ws.test", message);
        });
        w.on("close", () => {
            logger.log("ws.test", "closed")
            ws = null;
        });
        await lib.sleep(100);
        return w;
    }

    const send = async (msg) => {
        ws.send(msg);
        await lib.sleep(100);
    };

    await it('public endpoints', async () => {
        await send("/ws/hello")
        assert.strictEqual(message, "hello")

        await send("/none")
        assert.strictEqual(message, "not found")

        await send('{ "json": 1 }')
        assert.strictEqual(message, '{"json":1}')

        await send("/ws/time")
        assert.strictEqual(message, "time")

        await lib.sleep(200);
        assert.strictEqual(message, "wstime")

        await send("/ws/noq")
        assert.strictEqual(message, "noq")

        await lib.sleep(200);
        assert.strictEqual(message, "noq")

        await send("/ws/q")
        assert.strictEqual(message, "q")

        await lib.sleep(200);
        assert.strictEqual(message, "wsq")

        await send("/ws/test")
        assert.strictEqual(message, "test")

        await lib.sleep(200);
        assert.strictEqual(message, "test")

        await send("/ws/admin")
        assert.strictEqual(message, "admin")

        await lib.sleep(200);
        assert.strictEqual(message, "admin")

    });

    await it('profile endpoint fails', async () => {
        await send("/profile")
        assert.match(message, /"status":401/)
        assert.ok(!ws)
    });

    await it("profile session login", async () => {
        const { ok, request } = await lib.afetch({ url: `http://127.0.0.1:${api.port}/login`, cookies: {}, postdata: { login: "test", secret: "test" } });
        assert.strictEqual(ok, true);
        session = request?.rescookies?.[api.session.header].value;
        assert.ok(session)
    })

    await it('profile session succeed', async () => {
        ws = await connect();

        await send("/profile")
        assert.match(message, /"name":"test"/)

        await send("/ws/admin")
        assert.strictEqual(message, "admin")

        await lib.sleep(200);
        assert.strictEqual(message, "admin")

        await send("/ws/test")
        assert.strictEqual(message, "test")

        await lib.sleep(200);
        assert.strictEqual(message, "wstest")

    });

    after(async () => {
        ws?.close();
        await astop()
    })

});
