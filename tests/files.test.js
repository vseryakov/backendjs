const { it, describe, before, after } = require('node:test');
const assert = require('node:assert');
const { api, app, files, lib } = require("../");
const { ainit, astop } = require("./utils");

describe('Files tests', async () => {

    before(async () => {
        api.access.disabled = 1;

        app.addModule({
            name: "files.test",

            configureWeb(options, callback) {
                api.app.all(/^\/upload$/, (req, res) => {
                    files.upload(req, "file", { namekeep: true, name: "files2.txt" }, (err) => {
                        api.sendReply(res, err);
                    });
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
        assert.strictEqual(result, '/image.png');

        result = lib.sanitizePath("/usr/www/root", "../%2e%2e//../etc/......./\r\necho/./pas\1swd\00.0\x00.exe")
        assert.strictEqual(result, '/usr/www/root/2e2e/etc/echo/passwd.0.exe');
    });

    await it('files tests', async () => {

        const buf = Buffer.from("files test");
        let rc = await files.astore(buf, "files.txt");
        assert.ok(!rc.err);

        rc = await files.aread('files.txt');
        assert.strictEqual(rc.data, "files test");

        rc = await lib.afetch("http://127.0.0.1:" + api.port + "/files.txt");
        assert.strictEqual(rc.data, "files test");

        rc = await files.alist({ filter: /files.txt/ });
        assert.deepStrictEqual(rc.data, [ "files.txt" ]);

        rc = await files.adel('files.txt');
        assert.ok(!rc.err);

        rc = await files.adel('files2.txt');
        assert.ok(!rc.err);

        if (lib.isFlag(app.env.roles, "multipart")) {
            rc = await lib.afetch("http://127.0.0.1:" + api.port + "/upload", {
                multipart: [ { name: "file", file: "files2.txt", data: buf } ]
            });
            assert.strictEqual(rc.status, 200);
        } else {
            rc = await lib.afetch("http://127.0.0.1:" + api.port + "/upload", {
                postdata: { file: buf }
            });
            assert.strictEqual(rc.status, 200);
        }

        rc = await files.aread('files2.txt');
        assert.strictEqual(rc.data, "files test");

    });

    await it('detect mime type', async () => {
        const { data, ext } = await files.adetect("web/img/logo.png");
        assert.strictEqual(data, "image/png");
        assert.strictEqual(ext, "png");
    });
});
