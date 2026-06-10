/* global  */

const { describe, it, before, after } = require('node:test');
const { acheckAccess, ainit } = require("./utils");
const { app, api } = require("../");

const roles = process.env.BKJS_ROLES || "csrf";

describe('CSRF checks', async () => {

    before(async () => {
        await ainit({ api: 1, nodb: 1, noipc: 1, roles })
        api.app.all("/test", (context) => { context.send(200, "test") })
    });

    it("checks CSRF endpoints", async () => {

        const origin = "http://127.0.0.1:" + api.port;
        const config = [
            { get: "/" },
            { url: "/test", status: 403, regexp: /CSRF/ },
            { url: "/test", status: 403, data: { test: 1 }, regexp: /CSRF/ },
            { url: "/test", headers: { origin: "http://127.0.0.1:8000" }, status: 403, regexp: /CSRF/ },
            { url: "/test", headers: { origin: "http://127.0.0.1:8000", "sec-fetch-site": "cross-origin" }, status: 403 },
            { url: "/test", headers: { origin, "sec-fetch-site": "same-site" }, status: 403 },
            { url: "/test", headers: { origin, "sec-fetch-site": "cross-site" } },
            { url: "/test", headers: { origin, "sec-fetch-site": "same-origin" } },
        ];

        await acheckAccess({ config });
    });

    after(async () => {
        await app.astop()
    })
})

