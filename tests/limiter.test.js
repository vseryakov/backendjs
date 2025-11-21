
const { it } = require('node:test');
const assert = require('node:assert/strict');
const { app, lib, cache } = require("../");
const { init } = require("./utils");

var opts = {
    name: "test",
    rate: 1,
    max: 1,
    interval: 100,
    cacheName: process.env.TEST_CAHCE || "local",
    pace: 5,
    count: 5,
    delays: 4,
};

it("Limiter init env", async () => {
    await init({ noDb: 1, ipc: 1 });
});

it("Limiter should delay the pace", async () => (
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

it("Limiter should wait and continue", async () => {
    opts.retry = 2;
    await cache.alimiter(opts);
    const { delay, info } = await cache.acheckLimiter(opts);
    console.log(delay, info, opts)
    assert.ok(!delay && opts._retries == 3);
});

it("Limiter should fail after first run", async () => (
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

it("Limiter shutdown", async () => { app.stop })
