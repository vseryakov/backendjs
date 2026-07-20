const { it, describe, before, after } = require('node:test');
const assert = require('node:assert');
const { api, app, files, lib } = require("../");
const { ainit, astop } = require("./utils");
const fs = require("node:fs");

describe('Files tests', async () => {

    before(async () => {

        app.addModule({
            name: "files.test",

            configureMiddleware(options, callback) {
                api.app.post("/upload/", (context) => {
                    files.upload(context, "file", { namekeep: true, name: "files2.txt" }, (err) => {
                        context.reply(err);
                    });
                });
                api.app.post("/putfile/", async (context) => {
                    const { err } = await files.astore(Buffer.from(context.body), "putfile.html");
                    context.reply(err)
                });
                api.app.get("/retry/", async (context) => {
                    await lib.sleep(100);
                    context.send(["3", "4", "5"].includes(context.query.t) ? 500 : 200);
                });
                callback();
            }
        });

        await ainit({ api: 1, nodb: 1, noipc: 1 })
    });

    after(async () => {
        await astop();
    });

    it('normalize tests', async () => {
        let result = lib.sanitizePath('/image.png');
        assert.strictEqual(result, '/image.png');

        result = lib.sanitizePath('/.././image.png');
        assert.strictEqual(result, 'image.png');

        result = lib.sanitizePath("/usr/www/root", "../%2e%2e//../etc/......./\r\necho/./pas\1swd\00.0\x00.exe")
        assert.strictEqual(result, '/usr/www/root/2e2e/etc/......./echo/passwd.0.exe');


        result = lib.validatePath('/image.png');
        assert.strictEqual(result, '/image.png');

        result = lib.validatePath('/.././image.png');
        assert.strictEqual(result, undefined);

        result = lib.validatePath("/usr/www/root", "../%2e%2e//../etc/......./\r\necho/./pas\1swd\00.0\x00.exe")
        assert.strictEqual(result, undefined);

    });

    await it('files tests', async () => {

        const buf = Buffer.from("files test");
        let rc = await files.astore(buf, "files.txt");
        assert.ok(!rc.err, rc.err?.message);

        rc = await files.aread('files.txt');
        assert.strictEqual(rc.data, "files test");

        rc = await lib.afetch("http://127.0.0.1:" + api.port + "/files.txt");
        assert.ok(!rc.err, rc?.err?.message);
        assert.strictEqual(rc.data, "files test");

        rc = await files.alist({ filter: /files.txt/ });
        assert.deepStrictEqual(rc.data, [ "files.txt" ]);

        rc = await files.adel('files.txt');
        assert.ok(!rc.err);

        rc = await files.adel('files2.txt');
        assert.ok(!rc.err);

        if (lib.includes(app.env.roles, "multipart")) {
            rc = await lib.afetch("http://127.0.0.1:" + api.port + "/upload", {
                method: "POST",
                multipart: [ { name: "file", file: "files2.txt", data: buf } ]
            });
            assert.strictEqual(rc.status, 200);
        } else {
            rc = await lib.afetch("http://127.0.0.1:" + api.port + "/upload", {
                method: "POST",
                postdata: { file: buf }
            });
            assert.strictEqual(rc.status, 200);
        }

        rc = await files.aread('files2.txt');
        assert.strictEqual(rc.data, "files test");

        rc = await lib.afetch("http://127.0.0.1:" + api.port + "/putfile", {
            postfile: __dirname + "/render.html"
        });
        assert.strictEqual(rc.status, 200);

        rc = await files.aread('putfile.html');
        assert.strictEqual(rc.data, "render.html");

        rc = await lib.afetch("http://127.0.0.1:" + api.port + "/lib.test.js", {
            stream: fs.createWriteStream(files.root + "/lib.test.js", { highWaterMark: 100 })
        });
        assert.strictEqual(rc.status, 200);

    });

    await it('fetch retry logic', async () => {
        let rc = await lib.afetch("http://127.0.0.1:" + api.port + "/retry?t=1");
        assert.strictEqual(rc.status, 200);

        rc = await lib.afetch("http://127.0.0.1:" + api.port + "/retry?t=2", { httpTimeout: 50 });
        assert.strictEqual(rc.status, 529);

        rc = await lib.afetch("http://127.0.0.1:" + api.port + "/retry?t=3", {
            retryCount: 1,
            retryTimeut: 100,
            retryOnError: true
        });
        assert.strictEqual(rc.status, 500);
        assert.strictEqual(rc.request.retryTotal, 1);

        rc = await lib.afetch("http://127.0.0.1:" + api.port + "/retry?t=4", {
            retryCount: 2,
            retryTimeut: 100,
            retryOnError: function() {
                var t = parseInt(this.origUrl.at(-1)) + 1;
                this.origUrl = this.origUrl.slice(0, -1) + t;
                return true;
            }
        });
        assert.strictEqual(rc.status, 200);
        assert.strictEqual(rc.request.retryTotal, 2);
    });

    await it('detect mime type', async () => {
        const { data, ext } = await files.adetect("web/img/logo.png");
        assert.strictEqual(data, "image/png");
        assert.strictEqual(ext, "png");
    });
});
