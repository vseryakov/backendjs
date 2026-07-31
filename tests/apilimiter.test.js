
const { describe, it, before, after } = require('node:test');
const {  api } = require("../");
const { ainit, astop, acheckAccess } = require("./utils");

describe('API limiter tests', async () => {

    before(async () => {
        await ainit({ api: 1, cache: 1, nodb: 1, noipc: 1, roles: process.env.BKJS_ROLES || "limiter" })

        api.app.all("/api/*", (context) => { context.send(200, "ok") })

        api.app.all("/session/*", (context) => { context.send(200, "ok") })

        api.app.use("#0", "/api/user/1", (context, next) => { context.user = { id: 1, name: "test" }; next() })
    });

    it("checks limiter endpoints", async () => {

        const token = api.token.create({}).token;

        const config = [
            { get: "/" },
            { get: "/api/1" },
            { get: "/api/2" },
            { url: "/api/3" },
            { url: "/api/user/1" },
            { url: "/api/user/2" },
            { url: "/api/user/1", status: 429 },
            { url: "/api/4" },
            { url: "/api/5" },
            { url: "/api/6" },
            { url: "/api/7" },
            { get: "/api/8", status: 429 },
            { url: "/api/9", status: 429, streaming: 1, postdata: { timeout: 1 }, delay: 500 },
            { get: "/api/user/1", delay: 500 },
            { url: "/api/user/1" },
            { url: "/api/user/2" },
            { url: "/api/user/1", status: 429 },
            { url: "/session/1", user: token },
            { url: "/session/2" },
            { url: "/session/1", status: 429, user: token },
        ];

        await acheckAccess({ config });
    });

    after(async () => {
        await astop()
    })
})

