const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const { lib } = require("../");
const DbPool = require('../lib/db/pool');

describe("Pool tests", async (t) => {

    var options = {
        min: 1, max: 5, idle: 50, timeout: 100,
        create: function(pool, cb) { cb(null,{ id: Date.now() }) }
    }
    var list = [], pool;

    await it("use 5 connections", async () => {
        pool = new DbPool(options);
        for (let i = 0; i < 5; i++) {
            pool.use((err, obj) => { list.push(obj) });
        }
        assert.strictEqual(list.length, 5);
    });

    await it("try one more to timeout", async () => {
        const { err } = await pool.ause();
        assert.ok(err);
    });

    await it("release all", async () => {
        while (list.length) {
           pool.release(list.shift());
        }
        assert.strictEqual(list.length, 0);
    });

    await it("take 1 connection", async () => {
        pool.use((err, obj) => { list.push(obj) });
        assert.strictEqual(list.length, 1);
        pool.release(list.shift());
    });

    await it("destroy idle connections", async () => {
        await lib.sleep(options.idle*2);
        assert.strictEqual(pool.stats().avail, 1);
    });

    after(async () => {
        pool.shutdown();
    });
})

