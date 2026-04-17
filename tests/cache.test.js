
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { app, cache, lib } = require("../");
const { init } = require("./utils");

describe("Cache tests", () => {

    const cacheName = lib.split(process.env.BKJS_ROLES)[0] || "redis";
    var opts = {
        cacheName,
    };

    before((t, done) => {
        init({ cache: 1, roles: process.env.BKJKS_ROLES || "redis" }, done)
    });


    after((t, done) => {
        app.stop(done)
    });

    it("runs lock tests", async () => {

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

    it("runs cache tests", (t, done) => {
        if (cacheName == "local") return done()

        lib.series([
            function(next) {
                lib.forEachSeries(["a","b","c"], (key, next2) => {
                    cache.put(key, "1", opts, next2);
                }, next);
            },

            function(next) {
                cache.get("a", opts, (e, val) => {
                    try {
                        assert.strictEqual(val, "1")
                        next();
                    } catch (err) {
                        next(err);
                    }
                });
            },

            function(next) {
                cache.get(["a","b","c"], opts, (e, val) => {
                    try {
                        assert.deepEqual(val, ["1", "1", "1"])
                        next();
                    } catch (err) {
                        next(err);
                    }

                });
            },

            function(next) {
                cache.incr("a", 1, opts, next);
            },

            function(next) {
                cache.get("a", opts, (e, val) => {
                    try {
                        assert.strictEqual(val, "2")
                        next();
                    } catch (err) {
                        next(err);
                    }
                });
            },

            function(next) {
                cache.put("a", "3", opts, next);
            },

            function(next) {
                cache.put("a", "1", Object.assign({ setmax: 1 }, opts), next);
            },

            function(next) {
                cache.get("a", opts, (e, val) => {
                    try {
                        assert.strictEqual(val, "3")
                        next();
                    } catch (err) {
                        next(err);
                    }
                });
            },

            function(next) {
                cache.incr("a", 1, opts, next);
            },

            function(next) {
                cache.put("c", { a: 1 }, opts, next);
            },

            function(next) {
                cache.get("c", opts, (e, val) => {
                    val = lib.jsonParse(val)
                    try {
                        assert.deepEqual(val, { a: 1 })
                        next();
                    } catch (err) {
                        next(err);
                    }
                });
            },

            function(next) {
                cache.del("b", opts, next);
            },

            function(next) {
                cache.get("b", opts, (e, val) => {
                    try {
                        assert.ifError(val)
                        next();
                    } catch (err) {
                        next(err);
                    }
                });
            },

            function(next) {
                cache.put("*", { a: 1, b: 2, c: 3 }, Object.assign({ mapName: "m" }, opts), next);
            },

            function(next) {
                cache.incr("c", 1, Object.assign({ mapName: "m" }, opts), next);
            },

            function(next) {
                cache.put("c", 2, Object.assign({ mapName: "m", setmax: 1 }, opts), next);
            },

            function(next) {
                cache.del("b", Object.assign({ mapName: "m" }, opts), next);
            },

            function(next) {
                cache.get("c", Object.assign({ mapName: "m" }, opts), (e, val) => {
                    try {
                        assert.strictEqual(val, "4")
                        next();
                    } catch (err) {
                        next(err);
                    }
                });
            },

            function(next) {
                cache.get("*", Object.assign({ mapName: "m" }, opts), (e, val) => {
                    try {
                        assert.deepEqual(val, { a: "1", c: "4" })
                        next();
                    } catch (err) {
                        next(err);
                    }
                });
            },

            async function(next) {
                await cache.adel("m1", opts)
                cache.incr("m1", { count: 1, a: "a", mtime: Date.now().toString() }, opts, next)
            },

            function(next) {
                cache.incr("*", { count: 1, b: "b", mtime: Date.now().toString() }, Object.assign({ mapName: "m1" }, opts), next)
            },

            function(next) {
                cache.get("*", Object.assign({ mapName: "m1" }, opts), (e, val) => {
                    try {
                        assert.partialDeepStrictEqual(val, { count: "2", a: "a", b: "b" })
                        next();
                    } catch (err) {
                        next(err);
                    }
                });
            },

            async function(next) {
                await cache.adel(["counter1","counter2"], opts);
                var rc = await cache.aincr(["counter1","counter2"], 1, Object.assign({ returning: "*" }, opts));
                try {
                    assert.partialDeepStrictEqual(rc, { data: [1, 1] });
                } catch (err) {
                    return next(err);
                }

                rc = await cache.aincr(["counter1","counter2"], 1, Object.assign({ ttl: [100], returning: "*" }, opts));
                try {
                    assert.partialDeepStrictEqual(rc, { data: [2, 2] });
                } catch (err) {
                    return next(err);
                }

                await lib.sleep(200);

                rc = await cache.aincr("", { counter1: 1, counter2: 2 }, Object.assign({ returning: "*" }, opts));
                try {
                    assert.partialDeepStrictEqual(rc, { data: [1, 4] });
                } catch (err) {
                    return next(err);
                }

                rc = await cache.aincr("", { counter1: 1, counter2: 2 }, Object.assign({ ttl: { counter1: 1000 }, returning: "*" }, opts));
                try {
                    assert.partialDeepStrictEqual(rc, { data: [2, 6] });
                } catch (err) {
                    return next(err);
                }

                next();
            },
        ], done, true);
    });

});

