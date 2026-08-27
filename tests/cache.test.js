/**
 * To test different caches:
 *
 * BKJS_ROLES=redis node --test tests/cache.test.js
 *
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { cache, lib } = require("../");
const { ainit, astop } = require("./utils");

describe("Cache tests", async () => {

    const cacheName = lib.split(process.env.BKJS_ROLES)[0] || "local";
    var opts = {
        cacheName,
    };

    before(async () => {
        await ainit({ cache: 1, roles: process.env.BKJS_ROLES || "local" })
    });


    after(async () => {
        await astop()
    });

    await it("cache lock", async () => {

        await cache.aunlock("TEST", opts);

        let rc = await cache.alock("TEST", opts);
        assert.strictEqual(rc.locked, true);

        rc = await cache.alock("TEST", opts);
        assert.strictEqual(rc.locked, false);

        rc = await cache.alock("TEST", { set: 1, cacheName });
        assert.strictEqual(rc.locked, true);

        await cache.aunlock("TEST", opts);


        rc = await cache.alock("TEST", { ttl: 200, cacheName });
        assert.strictEqual(rc.locked, true);

        rc = await cache.alock("TEST", opts);
        assert.strictEqual(rc.locked, false);

        await lib.sleep(200);

        rc = await cache.alock("TEST", opts);
        assert.strictEqual(rc.locked, true);

    });

    await it("cache basic", async () => {

        for (const key of ["a","b","c"]) {
            await cache.aput(key, "1", opts);
        }

        let rc = await cache.aget("a", opts);
        assert.strictEqual(rc.data, "1")

        rc = await cache.aget(["a","b","c"], opts);
        assert.deepEqual(rc?.data, ["1", "1", "1"])

        await cache.aincr("a", 1, opts);

        rc = await cache.aget("a", opts)
        assert.strictEqual(lib.toNumber(rc?.data), 2)

        await cache.aput("a", "3", opts);

        await cache.aput("a", "1", Object.assign({ setmax: 1 }, opts));

        rc = await cache.aget("a", opts);
        assert.strictEqual(lib.toNumber(rc?.data), 3)

        await cache.aincr("a", 1, opts);

        await cache.aput("c", { a: 1 }, opts);

        rc = await cache.aget("c", opts);
        const val = lib.jsonParse(rc?.data)
        assert.deepEqual(val, { a: 1 })

        await cache.adel("b", opts);

        rc = await cache.aget("b", opts);
        assert.ifError(rc?.data)

        rc = await cache.aget("d", Object.assign({ set: 1 }, opts));
        assert.ifError(rc?.data)

        rc = await cache.aget("d", opts);
        assert.strictEqual(lib.toNumber(rc?.data), 1)

    });

    await it("cache advanced", async () => {
        if (cacheName == "local") return

        await cache.aput("*", { a: 1, b: 2, c: 3 }, Object.assign({ mapName: "m" }, opts));

        await cache.incr("c", 1, Object.assign({ mapName: "m" }, opts));

        await cache.aput("c", 2, Object.assign({ mapName: "m", setmax: 1 }, opts));

        await cache.adel("b", Object.assign({ mapName: "m" }, opts));

        let rc = await cache.aget("c", Object.assign({ mapName: "m" }, opts))
        assert.strictEqual(rc?.data, "4")

        rc = await cache.aget("*", Object.assign({ mapName: "m" }, opts))
        assert.deepEqual(rc.data, { a: "1", c: "4" })

        await cache.adel("m1", opts)
        await cache.aincr("m1", { count: 1, a: "a", mtime: Date.now().toString() }, opts)

        await cache.aincr("*", { count: 1, b: "b", mtime: Date.now().toString() }, Object.assign({ mapName: "m1" }, opts))

        rc = await cache.aget("*", Object.assign({ mapName: "m1" }, opts))
        assert.partialDeepStrictEqual(rc.data, { count: "2", a: "a", b: "b" })

        await cache.adel(["counter1","counter2"], opts);

        rc = await cache.aincr(["counter1","counter2"], 1, Object.assign({ returning: "*" }, opts));
        assert.partialDeepStrictEqual(rc, { data: [1, 1] });

        rc = await cache.aincr(["counter1","counter2"], 1, Object.assign({ ttl: [100], returning: "*" }, opts));
        assert.partialDeepStrictEqual(rc, { data: [2, 2] });

        await lib.sleep(200);

        rc = await cache.aincr("", { counter1: 1, counter2: 2 }, Object.assign({ returning: "*" }, opts));
        assert.partialDeepStrictEqual(rc, { data: [1, 4] });

        rc = await cache.aincr("", { counter1: 1, counter2: 2 }, Object.assign({ ttl: { counter1: 1000 }, returning: "*" }, opts));
        assert.partialDeepStrictEqual(rc, { data: [2, 6] });
    });

});

