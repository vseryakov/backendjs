/* global  */

const assert = require('node:assert/strict');
const { describe, it, before, after } = require('node:test');
const { acheckAccess, ainit } = require("./utils");
const { app, files, lib } = require("../");

describe('Access tests', async () => {

    before(async () => {
        await ainit({ api: 1, nodb: 1, noipc: 1, roles: "static" })

        await files.astore(Buffer.from("index.html"), "index.html");

        await files.astore(Buffer.from("index.js"), "index.js");
        await files.astore(Buffer.from("index.js.gz"), "index.js.gz");

    });

    await it("checks static endpoints", async () => {
        var etag;
        const config = [
            { url: "/none", status: 404 },
            { get: "/", regexp: /index.html/, body: { t: 1 } },
            { get: "/", regexp: /index.html/, status: 200, headers: { "if-modified-since": "2000-01-01" } },
            { get: "/", status: 304, headers: { "if-modified-since": new Date().toUTCString() },
              resheaders: { etag: /.+/ },
              postprocess: (c, rc, next) => {
                etag = rc.resheaders.etag;
                next();
            } },
            { get: "/", status: 304, headers: {},
              preprocess: (conf, rc, next) => {
                conf.headers["if-none-match"] = etag;
                next();
            } },
            { get: "/render.html", regexp: /render.html/ },
            { get: "/old/render", regexp: /render.html/ },
            { get: "/redirect", noredirects: 1, resheaders: { location: /^\/render.html$/ }, status: 302 },
            { get: "/index.js", regexp: /index.js/ },
            { get: "/index.js.gz", headers: { "accept-encoding": "gzip" }, regexp: /index.js.gz/ },
            { get: "/\0passwd", status: 403, headers: { connection: "close" } },
            { get: "/img/1.png", binary: 1,
                postprocess: (c, rc, next) => {
                    const png = lib.readFileSync(__dirname + "/../web/img/1.png");
                    assert.strictEqual(png, rc.data.toString());
                    next();
                }
            },
        ];

        await acheckAccess({ config });
    });

    after(async () => {
        await app.astop({ force: 1 })
    })
})

