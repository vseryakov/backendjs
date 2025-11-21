const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { app, lib } = require("../");
const fs = require("fs")
const util = require("node:util")

describe("forEachLine tests", async (t) => {

    const file = app.tmpDir + "/test.txt";
    const line = "[1,2,3]";
    const nlines = 10000;
    const forEachLine = util.promisify(lib.forEachLine.bind(lib))

    fs.writeFileSync(file, "");
    for (let i = 0; i < nlines-2; i++) fs.appendFileSync(file, line + "\n");
    fs.appendFileSync(file, "[2,3,4]\n[1,2,3]\n");

    await it("must read all", async () => {
        var count = 0, opts = {};
        lib.forEachLineSync(file, opts, (l) => { count += l.length });
        assert.strictEqual(count, line.length*nlines)
        assert.strictEqual(opts.ncalls, nlines)
    });

    await it("expects 10 less batches", async () => {
        var count = 0;
        var opts = { count: 100, skip: 1000 }
        lib.forEachLineSync(file, opts, (ls) => { for (const l of ls) count += l.length });
        assert.strictEqual(count, line.length*(nlines-1000))
        assert.strictEqual(opts.ncalls, nlines/100 - 1000/100)
    });

    await it("100 lines must be read", async () => {
        var count = 0;
        var opts = { limit: 100 }
        lib.forEachLineSync(file, opts, (l) => { count += l.length });
        assert.strictEqual(count, line.length*(100))
    });

    await it("2 lines must be read in batch", async () => {
        var count = 0;
        var opts = { count: 10, batchsize: 10, limit: 10 }
        lib.forEachLineSync(file, opts, (ls) => { count = ls.length });
        assert.strictEqual(count, 2)
    });

    await it("10 lines must be read", async () => {
        var count = 0;
        var opts = { length: line.length*10 }
        lib.forEachLineSync(file, opts, (l) => { count += l.length });
        assert.strictEqual(count, line.length*(10))
    });

    await it("1 last lines must be read", async () => {
        var count = 0;
        var opts = { until: /^\[2/ }
        lib.forEachLineSync(file, opts, (l) => { count += l.length });
        assert.strictEqual(count, line.length)
    });

    await it("all sum of splitted lines must be read", async () => {
        var count = 0;
        var opts = { split: 1 }
        lib.forEachLineSync(file, opts, (ls) => { for (const l of ls) count += lib.toNumber(l.replace(/[[\]]/g,"")) });
        assert.strictEqual(count, nlines*6+3)
    });

    await it("all sum of json lines must be read", async () => {
        var count = 0;
        var opts = { json: 1 }
        lib.forEachLineSync(file, opts, (ls) => { for (const l of ls) count += lib.toNumber(l) });
        assert.strictEqual(count, nlines*6+3)
    });

    // Async version
    await it("async: must read all", async () => {
        var count = 0, opts = {}
        await forEachLine(file, opts, (l, next) => { count += l.length; next() });
        assert.strictEqual(count, line.length*nlines)
        assert.strictEqual(opts.ncalls, nlines)
    });

    await it("must read 10 less batches", async () => {
        var count = 0;
        var opts = { count: 100, skip: 1000 }
        await forEachLine(file, opts, (ls, next, ctx) => { for (const l of ls) count += l.length; next() });
        assert.strictEqual(count, line.length*(nlines-1000))
        assert.strictEqual(opts.ncalls, nlines/100 - 1000/100)
    });

    await it("2 lines must be read in batch", async () => {
        var count = 0;
        var opts = { count: 10, batchsize: 10, limit: 10 }
        await forEachLine(file, opts, (ls, next) => { count = ls.length; next() });
        assert.strictEqual(count, 2);
    });

    await it("async: 100 lines must be read", async () => {
        var count = 0;
        var opts = { limit: 100 }
        await forEachLine(file, opts, (l, next) => { count += l.length; next() });
        assert.strictEqual(count, line.length*(100));
    });

    await it("async: 10 lines must be read", async () => {
        var count = 0;
        var opts = { length: line.length*10 }
        await forEachLine(file, opts, (l, next) => { count += l.length; next() });
        assert.strictEqual(count, line.length*(10));
    });

    await it("async: all sum of splitted lines must be read", async () => {
        var count = 0;
        var opts = { until: /^\[2/ }
        await forEachLine(file, opts, (l, next) => { count += l.length; next() });
        assert.strictEqual(count, line.length);
    });

    await it("async: must read all lines", async () => {
        var count = 0;
        var opts = { split: 1 }
        await forEachLine(file, opts, (ls, next) => { for (const l of ls) count += lib.toNumber(l.replace(/[[\]]/g,"")); next() });
        assert.strictEqual(count, nlines*6+3);
    });

    await it("async: must read all sum of json lines", async () => {
        var count = 0;
        var opts = { json: 1, sync: 1 }
        await forEachLine(file, opts, (ls) => { for (const l of ls) count += lib.toNumber(l) });
        assert.strictEqual(count, nlines*6+3);
    });
})
