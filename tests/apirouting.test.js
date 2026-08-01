/* global  */

const { describe, it, before, after } = require('node:test');
const { acheckAccess, ainit, astop } = require("./utils");

describe('Routing tests', async () => {

    before(async () => {
        await ainit({ api: 1, nodb: 1, noipc: 1, roles: "routing" })
    })

    await it("checks routing endpoints", async () => {
        const config = [
            { url: "/none", status: 404 },
            { get: "/old/render", regexp: /render.html/ },
            { get: "/redirect", noredirects: 1, resheaders: { location: /^\/render.html$/ }, status: 302 },
            { get: "/redirect/1", noredirects: 1, resheaders: { location: /^\/render.html$/ }, status: 301 },
        ];

        await acheckAccess({ config });
    });

    after(async () => {
        await astop()
    })
})


