
const { describe, it, before, after } = require('node:test');
const { app, api } = require("../");
const { ainit, acheckAccess } = require("./utils");

describe('API limiter tests', async () => {

    before(async () => {
        await ainit({ api: 1, cache: 1, nodb: 1, noipc: 1, roles: process.env.BKJS_ROLES || "limiter" })

        api.app.all("/api/*", (context) => { context.send(200, "test") })

        api.app.use("GET#0", "/api/user", (context, next) => { context.user = { id: 1, name: "test" }; next() })
    });

    it("checks API endpoints", async () => {

        const config = [
            { get: "/" },
            { get: "/api/1" },
            { get: "/api/2" },
            { url: "/api/3" },
            { url: "/api/user" },
            { url: "/api/user" },
            { url: "/api/user", status: 429 },
            { url: "/api/4" },
            { url: "/api/5" },
            { url: "/api/6" },
            { url: "/api/7", status: 429, delay: 100 },
            { get: "/api/8" },
            { get: "/api/9", status: 429, delay: 100 },
            { url: "/api/10", status: 429, streaming: 1, postdata: { timeout: 1 } },
        ];

        await acheckAccess({ config });
    });

    after(async () => {
        await app.astop()
    })
})

