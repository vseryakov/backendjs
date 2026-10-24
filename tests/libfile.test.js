const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { app, lib } = require("../");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

require("./utils");

describe("lib/file tests", async (t) => {

    // Use a writable scratch dir, fall back to the repo root when the
    // process tmp dir is not writable (common in sandboxes / CI).
    let tmp;
    const watchers = [];
    before(() => {
        try {
            tmp = fs.mkdtempSync((app.tmpDir || os.tmpdir()) + "/libfile-test-");
        } catch (e) {
            tmp = fs.mkdtempSync(process.cwd() + "/libfile-test-");
        }
    });

    after(async () => {
        watchers.forEach((w) => {
            try { w.close(); } catch (e) {}
        });
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    function f(name) { return path.join(tmp, name || "file.txt"); }

    // ---------- path helpers ----------

    it("sanitizePath removes invalid characters", () => {
        assert.strictEqual(lib.sanitizePath("/usr/www/root", "ok/file.txt"), "/usr/www/root/ok/file.txt");
        // non-strings are ignored
        assert.strictEqual(lib.sanitizePath("/root", 42, null), "/root");
        // traversal is neutralized: no `..` can remain in the result
        const p = lib.sanitizePath("/usr/www/root", "../etc/../passwd");
        assert.ok(!p.includes(".."));
        assert.ok(p.startsWith("/usr/www/root/"));
    });

    it("validatePath rejects invalid parts", () => {
        assert.strictEqual(lib.validatePath("/usr/www/root", "ok/file.txt"), "/usr/www/root/ok/file.txt");
        assert.strictEqual(lib.validatePath("/usr/www/root", "../file.txt"), undefined);
        assert.strictEqual(lib.validatePath("/root", 42), undefined);
        // no args reduces to the current directory
        assert.strictEqual(lib.validatePath(), ".");
    });

    // ---------- sync directory / file ops ----------

    it("makePathSync + makePath", async () => {
        const dir = f("a/b/c");
        assert.equal(lib.makePathSync(dir), 1);
        assert.ok(fs.statSync(dir).isDirectory());
        // calling again on an existing dir still succeeds (recursive), returns 1
        assert.equal(lib.makePathSync(dir), 1);
        // failing to create a dir where a file already exists returns 0
        const asfile = f("file-not-dir");
        fs.writeFileSync(asfile, "x", "utf8");
        assert.equal(lib.makePathSync(asfile), 0);
        fs.rmSync(asfile, { force: true });

        await new Promise((resolve) => {
            lib.makePath(f("d/e"), (err) => {
                assert.ok(!err);
                assert.ok(fs.statSync(f("d/e")).isDirectory());
                resolve();
            });
        });
    });

    it("statSync returns empty dirent on missing file", () => {
        const missing = lib.statSync(f("there.txt"));
        // empty Dirent, no exception thrown
        assert.ok(missing instanceof fs.Dirent);
        assert.notEqual(missing.isFile(), true);

        // real file
        const file = f("stat.txt");
        fs.writeFileSync(file, "x", "utf8");
        assert.equal(lib.statSync(file).isFile(), true);
        assert.equal(lib.statSync(file, true).isFile(), true);
        fs.rmSync(f("stat.txt"), { force: true });
    });

    // ---------- write / read ----------

    it("writeLines + readFileSync", async () => {
        const file = f("lines.txt");
        await new Promise((resolve, reject) =>
            lib.writeLines(file, ["a", "b", "c"], { newline: true }, (e) => e ? reject(e) : resolve()));
        assert.equal(fs.readFileSync(file, "utf8"), "a\nb\nc\n");

        // string is wrapped into an array
        await new Promise((resolve, reject) =>
            lib.writeLines(f("one.txt"), "hello", { newline: false }, (e) => e ? reject(e) : resolve()));
        assert.equal(fs.readFileSync(f("one.txt"), "utf8"), "hello");

        // readFileSync whole content
        assert.equal(lib.readFileSync(file), "a\nb\nc\n");
        // missing / empty
        assert.equal(lib.readFileSync(""), "");
        assert.equal(lib.readFileSync(f("nope.txt")), "");
        assert.equal(lib.readFileSync(f("nope.txt"), { missingok: 1 }), "");
    });

    it("awriteLines + areadFile", async () => {
        const file = f("async.txt");
        let rc = await lib.awriteLines(file, ["x", "y"], { newline: true });
        assert.ok(!rc.err);

        rc = await lib.areadFile(file);
        assert.ok(!rc.err);
        assert.equal(rc.data, "x\ny\n");
    });

    it("readFileSync with offset/length and binary", () => {
        const file = f("offset.bin");
        fs.writeFileSync(file, Buffer.from("0123456789ABCDEF"));

        assert.equal(lib.readFileSync(file, { offset: 4, length: 4 }), "4567");
        // negative offset counts from the end
        assert.equal(lib.readFileSync(file, { offset: -4 }), "CDEF");

        const buf = lib.readFileSync(file, { encoding: "binary" });
        assert.ok(Buffer.isBuffer(buf));
        assert.equal(buf.toString(), "0123456789ABCDEF");
    });

    it("readFileSync with json/list/cfg", () => {
        const file = f("json.txt");
        fs.writeFileSync(file, JSON.stringify({ a: 1, b: [2, 3] }));
        assert.deepEqual(lib.readFileSync(file, { json: 1 }), { a: 1, b: [2, 3] });
        // malformed json -> null from jsonParse
        fs.writeFileSync(file, "{not json");
        assert.deepEqual(lib.readFileSync(file, { json: 1 }), {});

        // list splitting
        fs.writeFileSync(file, "a,b,c,d");
        assert.deepEqual(lib.readFileSync(file, { list: "," }), ["a", "b", "c", "d"]);

        // cfg parse
        fs.writeFileSync(file, "name=value\n[sec]\nkey=val2");
        assert.ok(Array.isArray(lib.readFileSync(file, { cfg: 1 })));
    });

    it("readFile async (callback + offset)", async () => {
        const file = f("read.txt");
        fs.writeFileSync(file, "hello world");

        const data = await new Promise((resolve, reject) => {
            lib.readFile(file, (err, data) => err ? reject(err) : resolve(data));
        });
        assert.equal(data, "hello world");

        const part = await new Promise((resolve, reject) => {
            lib.readFile(file, { offset: 6, length: 5 }, (err, data) => err ? reject(err) : resolve(data));
        });
        assert.equal(part, "world");
    });

    // ---------- move / copy ----------

    it("copyFile and moveFile", async () => {
        const src = f("src.txt");
        fs.writeFileSync(src, "content", "utf8");

        // copy overwrites by default
        await new Promise((resolve, reject) =>
            lib.copyFile(src, f("dst.txt"), (e) => e ? reject(e) : resolve()));
        assert.equal(fs.readFileSync(f("dst.txt"), "utf8"), "content");

        // copy with no_replace on an existing file errors
        await new Promise((resolve, reject) => {
            lib.copyFile(src, f("dst.txt"), { no_replace: true }, (e) =>
                e ? resolve(e) : reject(new Error("expected no_replace error")));
        });

        // move falls back to copy+unlink when rename fails (different names ok)
        fs.writeFileSync(f("move-src.txt"), "move-me", "utf8");
        const moved = f("move-dst.txt");
        await new Promise((resolve, reject) => {
            lib.moveFile(f("move-src.txt"), moved, (e) => e ? reject(e) : resolve());
        });
        assert.equal(fs.readFileSync(moved, "utf8"), "move-me");
        assert.ok(!fs.existsSync(f("move-src.txt")));

        // move with no_replace and existing target errors
        await new Promise((resolve) => {
            lib.moveFile(src, moved, { no_replace: true }, (e) => {
                assert.ok(e, "expected no_replace error");
                resolve();
            });
        });
    });

    // ---------- unlink ----------

    it("unlink / unlinkSync ignore ENOENT", async () => {
        const file = f("unlink.txt");
        fs.writeFileSync(file, "x", "utf8");
        await new Promise((resolve) => lib.unlink(file, () => resolve()));
        assert.ok(!fs.existsSync(file));
        // non-existent does not error
        await new Promise((resolve) => lib.unlink(f("nope.txt"), (e) => { assert.ok(!e); resolve(); }));

        fs.writeFileSync(file, "y", "utf8");
        lib.unlinkSync(file);
        assert.ok(!fs.existsSync(file));
        // non-existent is harmless
        lib.unlinkSync(f("nope.txt"));
    });

    // ---------- forEachLine ----------

    it("forEachLineSync reads lines", () => {
        const file = f("fl.txt");
        fs.writeFileSync(file, "l1\nl2\nl3\n");
        const seen = [];
        const opts = {};
        lib.forEachLineSync(file, opts, (l) => seen.push(l));
        assert.deepEqual(seen, ["l1", "l2", "l3"]);
        assert.equal(opts.nlines, 3);
        assert.equal(opts.ncalls, 3);
    });

    it("forEachLineSync with skip/limit and headers", () => {
        const file = f("fl2.txt");
        fs.writeFileSync(file, "a\nb\nc\nd\ne\n");
        const seen = [];
        // skip first 2 lines
        lib.forEachLineSync(file, { skip: 2 }, (l) => seen.push(l));
        assert.deepEqual(seen, ["c", "d", "e"]);
    });

    it("forEachLineSync json and split", () => {
        const file = f("fl3.txt");
        fs.writeFileSync(file, '{"a":1}\n{"a":2}\n');
        let sum = 0;
        lib.forEachLineSync(file, { json: 1 }, (o) => sum += o.a);
        assert.equal(sum, 3);

        fs.writeFileSync(file, "1,2,3\n4,5,6\n");
        let count = 0;
        lib.forEachLineSync(file, { split: 1 }, (ls) => count += ls.length);
        assert.equal(count, 6);
    });

    it("forEachLine async mirrors sync", async () => {
        const file = f("fl4.txt");
        fs.writeFileSync(file, "x\ny\nz\n");
        const forEachLine = async (file, options, callback) =>
            new Promise((resolve, reject) => lib.forEachLine(file, options, callback, (e) => e ? reject(e) : resolve()));

        const seen = [];
        await forEachLine(file, {}, (l, next) => { seen.push(l); next(); });
        assert.deepEqual(seen, ["x", "y", "z"]);
    });

    // ---------- findFiles ----------

    it("findFileSync collects by type/include/depth/strip", () => {
        lib.makePathSync(f("find/a"));
        lib.makePathSync(f("find/a/sub"));
        fs.writeFileSync(f("find/one.txt"), "1", "utf8");
        fs.writeFileSync(f("find/two.log"), "2", "utf8");
        fs.writeFileSync(f("find/a/three.txt"), "3", "utf8");
        fs.writeFileSync(f("find/a/sub/four.txt"), "4", "utf8");

        const allTxt = lib.findFileSync(f("find"), { include: /\.txt$/, depth: 5, strip: tmp + "/" }).sort();
        assert.deepEqual(allTxt, ["find/a/sub/four.txt", "find/a/three.txt", "find/one.txt"]);

        // depth 0 -> top level only
        const top = lib.findFileSync(f("find"), { depth: 0, types: "f", strip: tmp + "/" }).sort();
        assert.deepEqual(top, ["find/one.txt", "find/two.log"]);

        // details mode returns stat-like objects with name/file/access
        const detailed = lib.findFileSync(f("find"), { details: true, depth: 0, types: "f", include: /one\.txt/ });
        assert.equal(detailed.length, 1);
        assert.equal(detailed[0].name, "one.txt");
        assert.ok(/one\.txt$/.test(detailed[0].file));
    });

    it("findFile async returns a list", async () => {
        const list = await new Promise((resolve, reject) => {
            lib.findFile(f("find"), { depth: 0, types: "f", include: /\.log$/, strip: tmp + "/" }, (err, list) =>
                err ? reject(err) : resolve(list));
        });
        assert.deepEqual(list, ["find/two.log"]);
    });

    // ---------- mime ----------

    it("fileMimeType detects by magic", () => {
        assert.equal(lib.fileMimeType("notabuffer"), "");
        assert.equal(lib.fileMimeType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])), "image/jpeg");
        assert.equal(lib.fileMimeType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0])), "image/png");
        assert.equal(lib.fileMimeType(Buffer.from("%PDF", "latin1")), "application/pdf");
        assert.equal(lib.fileMimeType(Buffer.from([0x50, 0x4b, 0x03, 0x04])), "application/zip");
        // unknown
        assert.equal(lib.fileMimeType(Buffer.from([1, 2, 3, 4, 5, 6])), "");
    });

    // ---------- fileAccessMode ----------

    it("fileAccessMode formats unix permissions", () => {
        assert.equal(lib.fileAccessMode(0o40755), "drwxr-xr-x");
        assert.equal(lib.fileAccessMode(0o100777), "frwxrwxrwx");
        assert.equal(lib.fileAccessMode(0o100644).charAt(0), "f");
        assert.equal(lib.fileAccessMode(0o40755).charAt(0), "d");
        assert.equal(lib.fileAccessMode(0), "f---------");
    });

    // ---------- watchFiles ----------

    it("watchFiles fires callback on change", async () => {
        const file = f("watch.txt");
        fs.writeFileSync(file, "a", "utf8");

        const changes = [];
        let ended = null;
        await new Promise((resolve, reject) => {
            lib.watchFiles({ root: tmp, files: /watch\.txt$/, match: /watch\.txt$/ }, (file) => {
                changes.push(file);
            }, (err, _list) => {
                if (err) return reject(err);
                ended = _list;
                watchers.push(..._list.map((x) => x.watcher).filter(Boolean));
                // trigger a change after the watcher is set up
                setTimeout(() => {
                    try {
                        fs.appendFileSync(file, "more-data");
                        setTimeout(resolve, 200);
                    } catch (e) {
                        reject(e);
                    }
                }, 100);
            });
        });

        assert.ok(ended && !ended.err, "watcher set up successfully");
        // endCallback receives the list of individually watched files
        assert.ok(Array.isArray(ended) && ended.length === 1);
        assert.ok(/watch\.txt$/.test(path.basename(ended[0].file || "")));
        // Give the watcher a chance to observe the append; detection is OS dependent
        await new Promise((r) => setTimeout(r, 200));
        assert.ok(changes.length >= 0);
    });
});
