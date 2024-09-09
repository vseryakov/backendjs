/* global lib logger cache */

tests.test_cache = function(callback)
{
    logger.info("testing cache:", cache.getClient().name);

    lib.series([
      function(next) {
          lib.forEachSeries(["a","b","c"], function(key, next2) {
              cache.put(key, "1", next2);
          }, next);
      },
      function(next) {
          cache.get("a", function(e, val) {
              assert(val!="1", "value must be a=1, got", val)
              next();
          });
      },
      function(next) {
          cache.get(["a","b","c"], function(e, val) {
              assert(!val||val.length!=3||val[0]!="1"||val[1]!="1"||val[2]!="1", "value must be [1,1,1] got", val)
              next();
          });
      },
      function(next) {
          cache.incr("a", 1, next);
      },
      function(next) {
          cache.get("a", function(e, val) {
              assert(val!="2", "value must be a=2, got", val)
              next();
          });
      },
      function(next) {
          cache.put("a", "3", next);
      },
      function(next) {
          cache.put("a", "1", { setmax: 1 }, next);
      },
      function(next) {
          cache.get("a", function(e, val) {
              assert(val!="3", "value must be a=3, got", val)
              next();
          });
      },
      function(next) {
          cache.incr("a", 1, next);
      },
      function(next) {
          cache.put("c", { a: 1 }, next);
      },
      function(next) {
          cache.get("c", function(e, val) {
              val = lib.jsonParse(val)
              assert(!val||val.a!=1, "value must be {a:1}, got", val)
              next();
          });
      },
      function(next) {
          cache.del("b", next);
      },
      function(next) {
          cache.get("b", function(e, val) {
              assert(val, "value must be null, got", val)
              next();
          });
      },
      function(next) {
          cache.put("*", { a: 1, b: 2, c: 3 }, { mapName: "m" }, next);
      },
      function(next) {
          cache.incr("c", 1, { mapName: "m" }, next);
      },
      function(next) {
          cache.put("c", 2, { mapName: "m", setmax: 1 }, next);
      },
      function(next) {
          cache.del("b", { mapName: "m" }, next);
      },
      function(next) {
          cache.get("c", { mapName: "m" }, function(e, val) {
              assert(val!=4, "value must be 4, got", val)
              next();
          });
      },
      function(next) {
          cache.get("*", { mapName: "m" }, function(e, val) {
              assert(!val || val.c!=4 || val.a!=1 || val.b, "value must be {a:1,c:4}, got", val)
              next();
          });
      },
      function(next) {
          cache.del("m1", next)
      },
      function(next) {
          cache.incr("m1", { count: 1, a: "a", mtime: Date.now().toString() }, next)
      },
      function(next) {
          cache.incr("*", { count: 1, b: "b", mtime: Date.now().toString() }, { mapName: "m1" }, next)
      },
      function(next) {
          cache.get("*", { mapName: "m1" }, function(e, val) {
              assert(val?.count!=2 || val?.a != "a" || val?.b != "b", "value must be {count:2,a:a,b:b}, got", val)
              next();
          });
      },
    ], function(err) {
        if (!err) return callback();
        lib.forEachSeries(["a","b","c"], (key, next) => {
            cache.get(key, (e, val) => { logger.info(key, val); next(); })
        }, () => {
            callback(err);
        });
    }, true);
}

