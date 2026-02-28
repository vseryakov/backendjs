/* global  */

const { describe, it, before, after } = require('node:test');
const { acheckAccess, ainit } = require("./utils");
const { app, api } = require("../");

describe('Check Static, Routing, Redirect', async () => {

    before(async () => {
        await ainit({ api: 1, nodb: 1, noipc: 1 })
    });

    it("checks basic endpoints", async () => {

        const config = [
            { url: "/render.html", regexp: /Mocked/ },
            { get: "/app/test", noredirects: 1, resheaders: { location: /^\/login.html\?path=\/app\/test$/ }, status: 302 },
            { get: "/redirect.html?a=1", noredirects: 1, resheaders: { location: /^http:\/\/127.0.0.1\/redirect\?a=1/ }, status: 302 },
            { get: "/old/endpoint", regexp: /Mocked/ },
        ];

        await acheckAccess({ config });
    });

    after(async () => {
        await app.astop()
    })
})

describe('Access Tests with CSRF', async () => {

    before(async () => {
        await ainit({ api: 1, nodb: 1, noipc: 1, roles: "users,csrf" })
    });

    it("checks basic endpoints", async () => {

        const origin = "http://127.0.0.1:" + api.port;
        const config = [
            { url: "/none", status: 417 },
            { url: "/test", status: 403, regexp: /NOORIGIN/ },
            { url: "/login", data: { login: "test", secret: "test" } },
            { get: "/ping" },
            { url: "/test", status: 403, regexp: /NOORIGIN/ },
            { url: "/test", headers: { origin: "http://127.0.0.1:8000" }, status: 403, regexp: /NOORIGIN/ },
            { url: "/test", headers: { origin }, status: 403, regexp: /NOMATCH/ },
            { url: "/auth", headers: { origin: "http://127.0.0.1:8000", "sec-fetch-site": "cross-origin" }, status: 403 },
            { url: "/auth", headers: { origin, "sec-fetch-site": "same-site" }, status: 403 },
            { url: "/auth", headers: { origin, "sec-fetch-site": "cross-site" } },
            { url: "/auth", headers: { origin, "sec-fetch-site": "same-origin" } },
            { url: "/render", headers: { origin, "sec-fetch-site": "same-origin" }, regexp: /Mock/ },
        ];

        await acheckAccess({ config });
    });

    after(async () => {
        await app.astop()
    })
})

