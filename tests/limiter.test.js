
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { app, lib, cache } = require("../");
const { ainit } = require("./utils");

var opts = {
    name: "test",
    rate: 1,
    max: 1,
    interval: 100,
    cacheName: process.env.BKJS_ROLES || "local",
    pace: 5,
    count: 5,
    delays: 4,
};

describe("Limiter tests", async () => {

before(async () => {
    await ainit({ nodb: 1, cache: 1, roles: process.env.BKJS_ROLES });
});

it("should delay the pace", async () => (
    new Promise((resolve, reject) => {
        var list = [], delays = 0;
        for (let i = 0; i < opts.count; i++) list.push(i);

        lib.forEachSeries(list, (i, next2) => {
            lib.doWhilst(
              function(next3) {
                  cache.limiter(opts, (delay) => {
                      opts.delay = delay;
                      setTimeout(next3, delay);
                  });
              },
              function() {
                  if (opts.delay) delays++;
                  return opts.delay;
              },
              function() {
                  setTimeout(next2, opts.pace);
              });
        }, () => {
            assert.strictEqual(delays, opts.delays);
            resolve();
        });
    })
));

it("should wait and continue", async () => {
    opts.retry = 2;
    await cache.alimiter(opts);
    const { delay } = await cache.acheckLimiter(opts);
    assert.ok(!delay && opts._retries == 2);
});

it("should fail after first run", async () => (
    new Promise((resolve, reject) => {
        opts.retry = 1;
        delete opts._retries;
        cache.limiter(opts, (delay, info) => {
            cache.checkLimiter(opts, (delay, info) => {
                assert.ok(delay && opts._retries == 1);
                resolve();
            });
        });
    })
));

after(async () => {
    await app.astop();
});

});
