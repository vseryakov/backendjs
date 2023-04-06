
tests.test_limiter = function(callback)
{
    var opts = {
        name: lib.getArg("-name", "test"),
        rate: lib.getArgInt("-rate", 1),
        max: lib.getArgInt("-max", 1),
        interval: lib.getArgInt("-interval", 1000),
        queueName: lib.getArg("-test-queue", "redis"),
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
                      ipc.limiter(opts, (delay) => {
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
            ipc.limiter(opts, (delay, info) => {
                ipc.checkLimiter(opts, (delay, info) => {
                    expect(!delay && opts._retries == 2, "should wait and continue", opts, info);
                    next();
                });
            });
        },
        function(next) {
            opts.retry = 1;
            delete opts._retries;
            ipc.limiter(opts, (delay, info) => {
                ipc.checkLimiter(opts, (delay, info) => {
                    expect(delay && opts._retries == 1, "should fail after first run", opts, info);
                    next();
                });
            });
        },
    ], callback);
}

tests.test_cache = function(callback)
{
    logger.info("testing cache:", ipc.getClient().name);

    lib.series([
      function(next) {
          lib.forEachSeries(["a","b","c"], function(key, next2) {
              ipc.put(key, "1", next2);
          }, next);
      },
      function(next) {
          ipc.get("a", function(e, val) {
              assert(val!="1", "value must be a=1, got", val)
              next();
          });
      },
      function(next) {
          ipc.get(["a","b","c"], function(e, val) {
              assert(!val||val.length!=3||val[0]!="1"||val[1]!="1"||val[2]!="1", "value must be [1,1,1] got", val)
              next();
          });
      },
      function(next) {
          ipc.incr("a", 1, next);
      },
      function(next) {
          ipc.get("a", function(e, val) {
              assert(val!="2", "value must be a=2, got", val)
              next();
          });
      },
      function(next) {
          ipc.put("a", "3", next);
      },
      function(next) {
          ipc.put("a", "1", { setmax: 1 }, next);
      },
      function(next) {
          ipc.get("a", function(e, val) {
              assert(val!="3", "value must be a=3, got", val)
              next();
          });
      },
      function(next) {
          ipc.incr("a", 1, next);
      },
      function(next) {
          ipc.put("c", { a: 1 }, next);
      },
      function(next) {
          ipc.get("c", function(e, val) {
              val = lib.jsonParse(val)
              assert(!val||val.a!=1, "value must be {a:1}, got", val)
              next();
          });
      },
      function(next) {
          ipc.del("b", next);
      },
      function(next) {
          ipc.get("b", function(e, val) {
              assert(val, "value must be null, got", val)
              next();
          });
      },
      function(next) {
          ipc.put("*", { a: 1, b: 2, c: 3 }, { mapName: "m" }, next);
      },
      function(next) {
          ipc.incr("c", 1, { mapName: "m" }, next);
      },
      function(next) {
          ipc.put("c", 2, { mapName: "m", setmax: 1 }, next);
      },
      function(next) {
          ipc.del("b", { mapName: "m" }, next);
      },
      function(next) {
          ipc.get("c", { mapName: "m" }, function(e, val) {
              assert(val!=4, "value must be 4, got", val)
              next();
          });
      },
      function(next) {
          ipc.get("*", { mapName: "m" }, function(e, val) {
              assert(!val || val.c!=4 || val.a!=1 || val.b, "value must be {a:1,c:4}, got", val)
              next();
          });
      },
      function(next) {
          ipc.incr("m1", { count: 1, a: "a", mtime: Date.now().toString() }, next)
      },
      function(next) {
          ipc.incr("*", { count: 1, b: "b", mtime: Date.now().toString() }, { mapName: "m1" }, next)
      },
      function(next) {
          ipc.get("*", { mapName: "m1" }, function(e, val) {
              assert(val?.count!=2 || val?.a != "a" || val?.b != "b", "value must be {count:2,a:a,b:b}, got", val)
              next();
          });
      },
    ], function(err) {
        if (!err) return callback();
        lib.forEachSeries(["a","b","c"], (key, next) => {
            ipc.get(key, (e, val) => { logger.info(key, val); next(); })
        }, () => {
            callback(err);
        });
    }, true);
}

