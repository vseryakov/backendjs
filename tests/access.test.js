/* global  */

const { describe, it, before, after } = require('node:test');
const { acheckAccess, ainit } = require("./utils");
const { app } = require("../");

describe('Access Static, Routing, Redirect', async () => {

    before(async () => {
        await ainit({ api: 1, nodb: 1, noipc: 1, roles: "users,csrf" })
    });

    it("checks basic endpoints", async () => {

        const config = [
            { url: "/none", status: 401 },
            { url: "/render.html", regexp: /Mock/ },
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

