/* global  */

const { describe, it, before, after } = require('node:test');
const { acheckAccess, ainit } = require("./utils");
const { app, files } = require("../");

describe('Access tests', async () => {

    before(async () => {
        await ainit({ api: 1, nodb: 1, noipc: 1, roles: "static" })

        await files.astore(Buffer.from("index.html"), "index.html");
    });

    it("checks static endpoints", async () => {

        const config = [
            { url: "/none", status: 404 },
            { get: "/", regexp: /index.html/ },
            { get: "/", regexp: /index.html/, status: 200, headers: { "if-modified-since": "2000-01-01" } },
            { get: "/", status: 304, headers: { "if-modified-since": new Date().toUTCString() } },
            { get: "/render.html", regexp: /Render.html/ },
            { get: "/old/render", regexp: /Render.html/ },
            { get: "/redirect", noredirects: 1, resheaders: { location: /^\/render.html$/ }, status: 302 },
        ];

        await acheckAccess({ config });
    });

    after(async () => {
        await app.astop()
    })
})

