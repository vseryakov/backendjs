const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { lib } = require("../");
const DbPool = require('../lib/db/pool');

describe("Pool tests", async (t) => {

    var options = {
        min: 1, max: 5, idle: 50,
        create: function(cb) { cb(null,{ id: Date.now() }) }
    }
    var list = [], pool;

    await it("use 5 connections", async () => {
        pool = new DbPool(options);
        for (var i = 0; i < 5; i++) {
            pool.use((err, obj) => { list.push(obj) });
        }
        assert.strictEqual(list.length, 5);
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
        pool.shutdown();
    });

})

