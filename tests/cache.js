/* global lib logger cache */

tests.test_cache = function(callback, test)
{
    var opts = {
        cacheName: test.cache || lib.getArg("-test-cache") || cache.getClient().cacheName
    };

    logger.info("testing cache:", opts, cache.getClient(opts.cacheName).name);

    lib.series([
        function(next) {
            lib.forEachSeries(["a","b","c"], (key, next2) => {
                cache.put(key, "1", opts, next2);
            }, next);
        },
        function(next) {
            cache.get("a", opts, (e, val) => {
                assert(val!="1", "value must be a=1, got", val)
                next();
            });
        },
        function(next) {
            cache.get(["a","b","c"], opts, (e, val) => {
                assert(!val||val.length!=3||val[0]!="1"||val[1]!="1"||val[2]!="1", "value must be [1,1,1] got", val)
                next();
            });
        },
        function(next) {
            cache.incr("a", 1, opts, next);
        },
        function(next) {
            cache.get("a", opts, (e, val) => {
                assert(val!="2", "value must be a=2, got", val)
                next();
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
                assert(val!="3", "value must be a=3, got", val)
                next();
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
                assert(!val||val.a!=1, "value must be {a:1}, got", val)
                next();
            });
        },
        function(next) {
            cache.del("b", opts, next);
        },
        function(next) {
            cache.get("b", opts, (e, val) => {
                assert(val, "value must be null, got", val)
                next();
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
                assert(val!=4, "value must be 4, got", val)
                next();
            });
        },
        function(next) {
            cache.get("*", Object.assign({ mapName: "m" }, opts), (e, val) => {
                assert(!val || val.c!=4 || val.a!=1 || val.b, "value must be {a:1,c:4}, got", val)
                next();
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
                assert(val?.count!=2 || val?.a != "a" || val?.b != "b", "value must be {count:2,a:a,b:b}, got", val)
                next();
            });
        },
        async function(next) {
            await cache.del(["counter1","counter2"]);
            var rc = await cache.aincr(["counter1","counter2"], 1, Object.assign({ returning: "*" }, opts));
            expect(rc?.length == 2 && rc[0] === 1 && rc[1] === 1, "expect rc[1,1], got", rc);
            next();
        },
        async function(next) {
          await cache.del(["counter1","counter2"]);
          var rc = await cache.aincr("", { counter1: 1, counter2: 2 }, Object.assign({ returning: "*" }, opts));
          expect(rc?.length == 2 && rc[0] === 1 && rc[1] === 2, "expect rc[1,2], got", rc);
          next();
      },
    ], (err) => {
        if (!err) return callback();
        lib.forEachSeries(["a","b","c"], (key, next) => {
            cache.get(key, opts, (e, val) => { logger.info(key, val); next(); })
        }, () => {
            callback(err);
        });
    }, true);
}

