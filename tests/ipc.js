/* global lib logger ipc cache */

tests.test_limiter = function(callback)
{
    var opts = {
        name: lib.getArg("-name", "test"),
        rate: lib.getArgInt("-rate", 1),
        max: lib.getArgInt("-max", 1),
        interval: lib.getArgInt("-interval", 1000),
        queueName: lib.getArg("-test-queue", "test"),
        pace: lib.getArgInt("-pace", 5),
        count: lib.getArgInt("-count", 5),
        delays: lib.getArgInt("-delays", 4),
    };

    ipc.initServer();

    lib.series([
        function(next) {
            setTimeout(next, 1000);
        },
        function(next) {
            var list = [], delays = 0;
            for (let i = 0; i < opts.count; i++) list.push(i);
            lib.forEachSeries(list, function(i, next2) {
                lib.doWhilst(
                  function(next3) {
                      cache.limiter(opts, (delay) => {
                          opts.delay = delay;
                          logger.log("limiter:", opts);
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
                expect(delays == opts.delays, `delays mismatch: ${delays} != ${opts.delays}`);
                next();
            });
        },
        function(next) {
            opts.retry = 2;
            cache.limiter(opts, (delay, info) => {
                cache.checkLimiter(opts, (delay, info) => {
                    expect(!delay && opts._retries == 2, "should wait and continue", opts, info);
                    next();
                });
            });
        },
        function(next) {
            opts.retry = 1;
            delete opts._retries;
            cache.limiter(opts, (delay, info) => {
                cache.checkLimiter(opts, (delay, info) => {
                    expect(delay && opts._retries == 1, "should fail after first run", opts, info);
                    next();
                });
            });
        },
    ], callback);
}

