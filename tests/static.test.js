/* global  */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { describe, it, before, after } = require('node:test');
const { acheckAccess, ainit, astop } = require("./utils");
const { api, files, lib } = require("../");
const staticMiddleware = require("../lib/middleware/static");

describe('Static tests', async () => {

    before(async () => {
        await ainit({ api: 1, nodb: 1, noipc: 1, roles: "static" })

        await files.astore(Buffer.from("index.html"), "index.html");

        await files.astore(Buffer.from("index.js"), "index.js");
        await files.astore(Buffer.from("index.js.gz"), "index.js.gz");

        fs.mkdirSync(__dirname + "/../var/subdir", { recursive: true });
        await files.astore(Buffer.from("nc"), "nc/index.html");
        fs.mkdirSync(__dirname + "/../var/nc", { recursive: true });

        api.app.get("/nc/*", { root: "var", noCache: true, handle: staticMiddleware.handle });
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
            { get: "/index.js", regexp: /index.js/ },
            { get: "/index.js.gz", headers: { "accept-encoding": "gzip" }, regexp: /index.js.gz/ },
            { get: "/\0passwd", status: 403, headers: { connection: "close" } },
            { get: "/img/1.png", binary: 1, status: 200, resheaders: { "content-type": /^image\/png$/, "content-length": /.+/ },
                postprocess: (c, rc, next) => {
                    const png = lib.readFileSync(__dirname + "/../web/img/1.png");
                    assert.strictEqual(png, rc.data.toString());
                    assert.strictEqual(Number(rc.resheaders["content-length"]), rc.size);
                    next();
                }
            },
            { get: "/", status: 200, resheaders: { "content-type": /^text\/html$/, "cache-control": /max-age=0/, "content-length": /^10$/, etag: /^W\//, "last-modified": /.+/ } },
            { get: "/index.js", status: 200, resheaders: { "content-type": /^text\/javascript$/ } },
            { get: "/index.js", status: 200, headers: { "accept-encoding": "gzip" }, resheaders: { "content-type": /^text\/javascript$/, "content-encoding": /gzip/, vary: /Accept-Encoding/, "content-length": /^11$/ } },
            { get: "/", status: 412, headers: { "if-unmodified-since": "2000-01-01T00:00:00Z" } },
            { get: "/subdir/", status: 404 },
            { get: "/nc/index.html", status: 200, resheaders: { "cache-control": /no-cache/ } },
        ];

        await acheckAccess({ config });
    });

    after(async () => {
        await astop({ force: 1 })
    })
})

