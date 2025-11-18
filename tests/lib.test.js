
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { app, logger, db, lib } = require("../");
const fs = require("fs")
const util = require("node:util")

describe("Flow tests", () => {

    var direct = lib.isArg("-direct");

    var c1 = 0;
    lib.forEach([ 1, 2, 3 ], (i, next) => {
        c1++; next()
    }, (err) => {
        logger.info("forEach", err, c1, c1 == 3 && !err ? "success": "FAILED")
    }, direct)


    var c2 = 0;
    lib.forEach([ 1, 2, 3 ], (i, next) => {
        c2++; next(i == 2 ? "error" : null)
    }, (err) => {
        logger.info("forEach", err, c2, c2 == 2 && err ? "success": "FAILED")
    }, direct)


    var c3 = 0;
    lib.forEvery([ 1, 2, 3 ], (i, next) => {
        c3++; next("ignore")
    }, (err) => {
        logger.info("forEvery", err, c3, c3 == 3 && err == "ignore" ? "success": "FAILED")
    }, direct)

    lib.forEachSeries([ 1, 2, 3 ], (i, next, n) => {
        next(null, lib.toNumber(n) + i);
    }, (err, n) => {
        logger.info('forEachSeries', n, err, n == 6 ? "success" : "FAILED");
    }, direct);

    lib.forEachSeries([ 1, 2, 3 ], (i, next, n) => {
        next(i == 2 ? "error" : null, lib.toNumber(n) + i);
    }, (err, n) => {
        logger.info('forEachSeries', n, err, n == 3 && err == "error" ? "success" : "FAILED");
    }, direct);

    lib.forEverySeries([ 1, 2, 3 ], (i, next, err, n) => {
        next("ignore", lib.toNumber(n) + i);
    }, (err, n) => {
        logger.info('forEverySeries', n, err, n == 6 && err == "ignore" ? "success" : "FAILED");
    }, direct);

    var c4 = 0;
    lib.forEachLimit([ 1, 2, 3 ], 2, (i, next) => {
        c4++; next();
    }, (err) => {
        logger.info('forEachLimit', c4, err, c4 == 3 && !err ? "success" : "FAILED");
    }, direct);

    var c5 = 0;
    lib.forEachLimit([ 1, 2, 3 ], 2, (i, next) => {
        c5++; next(i == 2 ? "error" : null);
    }, (err) => {
        logger.info('forEachLimit', c5, err, c5 == 2 && err == "error" ? "success" : "FAILED");
    }, direct);

    var c6 = 0;
    lib.forEveryLimit([ 1, 2, 3 ], 2, (i, next) => {
        c6++; next("ignore");
    }, (err) => {
        logger.info('forEveryLimit', c6, err, c6 == 3 && String(err) == "ignore,ignore,ignore" ? "success" : "FAILED");
    }, direct);

    var c7 = 0;
    lib.whilst(
        function() {
            return c7 < 5;
        },
        function (next) {
            c7++;
            next(null, c7);
        },
        function (err, d) {
            logger.info('whilst', c7, d, err, c7 == 5 && !err ? "success" : "FAILED");
        }, direct);

    var c8 = 0;
    lib.doWhilst(
        function (next) {
            c8++;
            next(null, c8);
        },
        function() {
            return c8 < 5;
        },
        function (err, d) {
            logger.info('whilst', c8, d, err, c8 == 5 && !err ? "success" : "FAILED");
        }, direct);

    var c9 = 0;
    lib.series([
        (next) => {
            c9++
            next(null, 1)
        },
        (next, data) => {
            c9++
            next(null, data + 1)
        }
    ], (err, d) => {
        logger.info('series', c9, d, err, c9 == 2 && d === 2 && !err ? "success" : "FAILED");
    }, direct)

    var c10 = 0;
    lib.series([
        (next) => {
            c10++
            next("error", 1);
        },
        (next, data) => {
            c10++
            next("error", data + 1)
        }
    ], (err, d) => {
        logger.info('series', c10, d, err, c10 == 1 && d == 1 && err == "error" ? "success" : "FAILED");
    }, direct)

    var c11 = 0;
    lib.parallel([
        (next) => {
            c11++;
            next()
        },
        (next) => {
            c11++;
            next()
        }
    ], (err) => {
        logger.info('parallel', c11, err, c11 == 2 && !err ? "success" : "FAILED");
    }, direct)

    var c12 = 0;
    lib.parallel([
        (next) => {
            c12++
            next("error");
        },
        (next) => {
            c12++;
            next();
        }
    ], (err) => {
        logger.info('parallel', c12, err, c12 >= 1 && err ? "success" : "FAILED");
    }, direct)

    var c13 = 0;
    lib.everySeries([
        (next) => {
            c13++;
            next("ignore", 1);
        },
        (next, err, data) => {
            c13++;
            next(err, data + 1)
        }
    ], (err, d) => {
        logger.info('everySeries', c13, d, err, c13 == 2 && d === 2 && err == "ignore" ? "success" : "FAILED");
    }, direct)

    var c14 = 0;
    lib.everyParallel([
        (next) => {
            c14++
            next("ignore")
        },
        (next) => {
            c14++
            next()
        }
    ], (err) => {
        logger.info('everyParallel', c14, err, c14 == 2 && !err ? "success" : "FAILED");
    }, direct)

})

describe("ForeachLine tests", async (t) => {

    const file = app.tmpDir + "/test.txt";
    const line = "[1,2,3]";
    const nlines = 10000;
    const forEachLine = util.promisify(lib.forEachLine.bind(lib))

    fs.writeFileSync(file, "");
    for (let i = 0; i < nlines-2; i++) fs.appendFileSync(file, line + "\n");
    fs.appendFileSync(file, "[2,3,4]\n[1,2,3]\n");

    await it("must read all", async () => {
        var count = 0, opts = {};
        lib.forEachLineSync(file, opts, (l) => { count += l.length });
        assert.strictEqual(count, line.length*nlines)
        assert.strictEqual(opts.ncalls, nlines)
    });

    await it("expects 10 less batches", async () => {
        var count = 0;
        var opts = { count: 100, skip: 1000 }
        lib.forEachLineSync(file, opts, (ls) => { for (const l of ls) count += l.length });
        assert.strictEqual(count, line.length*(nlines-1000))
        assert.strictEqual(opts.ncalls, nlines/100 - 1000/100)
    });

    await it("100 lines must be read", async () => {
        var count = 0;
        var opts = { limit: 100 }
        lib.forEachLineSync(file, opts, (l) => { count += l.length });
        assert.strictEqual(count, line.length*(100))
    });

    await it("2 lines must be read in batch", async () => {
        var count = 0;
        var opts = { count: 10, batchsize: 10, limit: 10 }
        lib.forEachLineSync(file, opts, (ls) => { count = ls.length });
        assert.strictEqual(count, 2)
    });

    await it("10 lines must be read", async () => {
        var count = 0;
        var opts = { length: line.length*10 }
        lib.forEachLineSync(file, opts, (l) => { count += l.length });
        assert.strictEqual(count, line.length*(10))
    });

    await it("1 last lines must be read", async () => {
        var count = 0;
        var opts = { until: /^\[2/ }
        lib.forEachLineSync(file, opts, (l) => { count += l.length });
        assert.strictEqual(count, line.length)
    });

    await it("all sum of splitted lines must be read", async () => {
        var count = 0;
        var opts = { split: 1 }
        lib.forEachLineSync(file, opts, (ls) => { for (const l of ls) count += lib.toNumber(l.replace(/[[\]]/g,"")) });
        assert.strictEqual(count, nlines*6+3)
    });

    await it("all sum of json lines must be read", async () => {
        var count = 0;
        var opts = { json: 1 }
        lib.forEachLineSync(file, opts, (ls) => { for (const l of ls) count += lib.toNumber(l) });
        assert.strictEqual(count, nlines*6+3)
    });

    // Async version
    await it("async: must read all", async () => {
        var count = 0, opts = {}
        await forEachLine(file, opts, (l, next) => { count += l.length; next() });
        assert.strictEqual(count, line.length*nlines)
        assert.strictEqual(opts.ncalls, nlines)
    });

    await it("must read 10 less batches", async () => {
        var count = 0;
        var opts = { count: 100, skip: 1000 }
        await forEachLine(file, opts, (ls, next, ctx) => { for (const l of ls) count += l.length; next() });
        assert.strictEqual(count, line.length*(nlines-1000))
        assert.strictEqual(opts.ncalls, nlines/100 - 1000/100)
    });

    await it("2 lines must be read in batch", async () => {
        var count = 0;
        var opts = { count: 10, batchsize: 10, limit: 10 }
        await forEachLine(file, opts, (ls, next) => { count = ls.length; next() });
        assert.strictEqual(count, 2);
    });

    await it("async: 100 lines must be read", async () => {
        var count = 0;
        var opts = { limit: 100 }
        await forEachLine(file, opts, (l, next) => { count += l.length; next() });
        assert.strictEqual(count, line.length*(100));
    });

    await it("async: 10 lines must be read", async () => {
        var count = 0;
        var opts = { length: line.length*10 }
        await forEachLine(file, opts, (l, next) => { count += l.length; next() });
        assert.strictEqual(count, line.length*(10));
    });

    await it("async: all sum of splitted lines must be read", async () => {
        var count = 0;
        var opts = { until: /^\[2/ }
        await forEachLine(file, opts, (l, next) => { count += l.length; next() });
        assert.strictEqual(count, line.length);
    });

    await it("async: must read all lines", async () => {
        var count = 0;
        var opts = { split: 1 }
        await forEachLine(file, opts, (ls, next) => { for (const l of ls) count += lib.toNumber(l.replace(/[[\]]/g,"")); next() });
        assert.strictEqual(count, nlines*6+3);
    });

    await it("async: must read all sum of json lines", async () => {
        var count = 0;
        var opts = { json: 1 }
        await forEachLine(file, opts, (ls, next) => { for (const l of ls) count += lib.toNumber(l); next() });
        assert.strictEqual(count, nlines*6+3);
    });
})

describe("Pool tests", (t, callback) => {

    var options = { min: lib.getArgInt("-min", 1),
                    max: lib.getArgInt("-max", 5),
                    idle: lib.getArgInt("-idle", 0),
                    create: function(cb) { cb(null,{ id: Date.now() }) }
    }
    var list = [];
    var pool = new db.Pool(options)
    lib.series([
       function(next) {
           logger.info('pool0:', pool.stats(), 'list:', list.length);
           for (var i = 0; i < 5; i++) {
               pool.acquire(function(err, obj) { list.push(obj); logger.info('added:', list.length); });
           }
           logger.info('pool1:', pool.stats(), 'list:', list.length);
           next();
       },
       function(next) {
           while (list.length) {
               pool.release(list.shift());
           }
           next();
       },
       function(next) {
           logger.info('pool2:', pool.stats(), 'list:', list.length);
           pool.acquire(function(err, obj) { list.push(obj); logger.info('added:', list.length); });
           next();
       },
       function(next) {
           logger.info('pool3:', pool.stats(), 'list:', list.length);
           pool.release(list.shift());
           next();
       },
       function(next) {
           setTimeout(function() {
               logger.info('pool4:', pool.stats(), 'list:', list.length);
               next();
           }, options.idle*2);
       }], callback);
})

describe("toParams tests", () => {

    var schema = {
        id: { type: "int" },
        count: { type: "int", min: 1, dflt: 1 },
        page: { type: "int", min: 1, max: 10, dflt: NaN, required: 1, errmsg: "Page number between 1 and 10 is required" },
        name: { type: "string", max: 6, trunc: 1 },
        pair: { type: "map", maptype: "int" },
        code: { type: "string", regexp: /^[a-z]-[0-9]+$/, errmsg: "Valid code is required" },
        code1: { type: "string", noregexp: /[.,!]/, errmsg: "Valid code1 is required" },
        start: { type: "token", secret: "test" },
        email: { type: "list", datatype: "email", novalue: ["a@a"] },
        email1: { type: "email", required: { email: null } },
        phone: { type: "phone" },
        mtime: { type: "mtime", name: "timestamp", mindate: Date.now() - 86400000 },
        flag: { type: "bool", novalue: false },
        descr: { novalue: { name: "name", value: "test" }, replace: { "<": "!" } },
        internal: { ignore: 1 },
        tm: { type: "timestamp", optional: 1, maxdate: new Date(1970, 1, 1) },
        ready: { value: "ready" },
        empty: { empty: 1, trim: 1, strip: /[.,!]/ },
        nospecial: { strip: lib.rxSpecial },
        special: { strip: lib.rxNoSpecial },
        state: { type: "list", values: [ "ok","bad","good" ] },
        obj: { type: "obj", params: { id: { type: "int" }, name: {} } },
        object: { type: "object" },
        arr: { type: "array", params: { id: { type: "int" }, name: {} } },
        json: { type: "json", datatype: "obj" },
        json1: { type: "json", params: { id: { type: "int" }, name: {} } },
        minnum: { type: "int", minnum: 10 },
    };
    var opts = {
        defaults: {
            '*.int': { max: 100 },
            "*.string": { max: 5 },
            '*': { maxlist: 5 },
        }
    };

    var q = lib.toParams({}, schema, opts);
    assert.ok(/email1 is required/.test(q));

    q = lib.toParams({ email: "a@a" }, schema, opts);
    assert.ok(/email1 is required/.test(q));

    q = lib.toParams({ email1: "a@a" }, schema, opts);
    assert.ok(/email1 is required/.test(q));

    q = lib.toParams({ email1: "a@a.com" }, schema, opts);
    assert.ok(q.page === 1 && q.count === 1);

    schema.email1.required = 0;
    q = lib.toParams({ page: 1000, count: 1000 }, schema, opts);
    assert.ok(q.page === 10 && q.count === 100);

    q = lib.toParams({ name: "1234567890" }, schema, opts);
    assert.ok(q.name == "123456");

    q = lib.toParams({ descr: "1234567890" }, schema, opts);
    assert.ok(/descr is too long/.test(q));

    q = lib.toParams({ descr: "<2345" }, schema, opts);
    assert.ok(q.descr == "!2345");

    q = lib.toParams({ name: "test", descr: "test" }, schema, opts);
    assert.ok(!q.descr && q.name == "test");

    q = lib.toParams({ pair: "a:1,b:2" }, schema, opts);
    assert.ok(q.pair?.a === 1 && q.pair?.b === 2);

    q = lib.toParams({ code: "12345" }, schema, opts);
    assert.ok(/Valid code is required/.test(q));

    q = lib.toParams({ code: "q-123" }, schema, opts);
    assert.ok(q.code === "q-123");

    q = lib.toParams({ code1: "q.123" }, schema, opts);
    assert.ok(/Valid code1 is required/.test(q));

    q = lib.toParams({ start: "test" }, schema, opts);
    assert.ok(!q.start);

    q = lib.toParams({ start: lib.jsonToBase64("test", "test") }, schema, opts);
    assert.ok(q.start == "test");

    q = lib.toParams({ tm: 1 }, schema, opts);
    assert.ok(q.ready == "ready" && q.tm == '1970-01-01T00:00:01.000Z');

    q = lib.toParams({ tm: Date.now() }, schema, opts);
    assert.ok(/is too late/.test(q));

    q = lib.toParams({ mtime: '1970-01-01T00:00:01.000Z' }, schema, opts);
    assert.ok(/is too soon/.test(q));

    schema.mtime.mindate = 0;
    q = lib.toParams({ mtime: '1970-01-01T00:00:01.000Z' }, schema, opts);
    assert.ok(q.timestamp == 1000);

    q = lib.toParams({ state: "ok,done,error", flag: false }, schema, opts);
    assert.ok(q.state == "ok", "expected state=ok", q);
    assert.ok(q.flag === undefined);

    q = lib.toParams({ obj: { id: "1", descr: "1", name: "1" } }, schema, opts);
    assert.ok(q.obj?.id === 1 && !q.obj?.descr && q.obj?.name == "1");

    q = lib.toParams({ object: { id: "1", descr: "1", name: "1" } }, schema, opts);
    assert.ok(q.object?.id == "1" && q.object?.descr == "1" && q.object?.name == "1");

    q = lib.toParams({ json: lib.stringify({ id: "1", descr: "1", name: "1" }) }, schema, opts);
    assert.ok(q.json?.id == "1" && q.json?.descr == "1" && q.json?.name == "1");

    q = lib.toParams({ json1: lib.stringify({ id: "1", descr: "1", name: "1" }) }, schema, opts);
    assert.ok(q.json1?.id === 1 && !q.json1?.descr && q.json1?.name == "1");

    q = lib.toParams({ empty: "." }, schema, opts);
    assert.ok(q.empty === "");

    schema.empty.setempty = null;
    q = lib.toParams({ empty: "." }, schema, opts);
    assert.ok(q.empty === null);

    q = lib.toParams({ nospecial: "a<b>c", special: "a<b>c" }, schema, opts);
    assert.ok(q.special === "<>");
    assert.ok(q.nospecial === "abc");

    q = lib.toParams({ minnum: 2 }, schema, opts);
    assert.ok(/too small/.test(q));

    q = lib.toParams({ minnum: 20 }, schema, opts);
    assert.ok(q.minnum === 20);

})

describe("search tests", () => {

    var words = ['keyword1', 'keyword2', 'etc'];
    var text = 'should find keyword1 at position 19 and keyword2 at position 47.';
    var ac = new lib.AhoCorasick(words);
    var rc = ac.search(text);

    assert.ok(rc.length && rc[0][0] == 19 && rc[0][1] == "keyword1");
    assert.ok(rc.length == 2 && rc[1][0] == 47 && rc[1][1] == "keyword2");

    rc = ac.search(text, { list: 1 });
    assert.ok(rc.length == 2 && rc[0] == "keyword1" && rc[1] == "keyword2");

    rc = ac.search(text.replace("keyword2", "akeyword2"), { list: 1, delimiters: "" });
    assert.ok(rc.length == 1 && rc[0] == "keyword1");

    rc = lib.findWords(words, text);
    assert.ok(rc.length == 2 && rc[0] == "keyword1" && rc[1] == "keyword2");

    rc = lib.findWords(words, text.replace("keyword2", "akeyword2"));
    assert.ok(rc.length == 1 && rc[0] == "keyword1");

    rc = lib.findWords(words, "keyword2");
    assert.ok(rc.length == 1 && rc[0] == "keyword2");

})

describe("skip32 test", () => {

    // these are the default test values from the original C code
    var KEY = [ 0x00,0x99,0x88,0x77,0x66,0x55,0x44,0x33,0x22,0x11 ];
    var INPUT = parseInt("33221100", 16)
    var ENCRYPTED = parseInt("819d5f1f", 16);
    var e = lib.toSkip32("",KEY,INPUT)
    var d = lib.toSkip32("d",KEY,e)
    assert.ok(ENCRYPTED === e);
    assert.ok(INPUT === d);

})

describe("toTemplate tests", () => {

    var m = lib.toTemplate("email@id@@@com", { id: 1 }, { allow: ["id"] });
    assert.ok(m == "email1@com")

    m = lib.toTemplate("email@com,@id@@@com", { id: 1, code: "A" });
    assert.ok(m == "email@com,1@com")

    m = lib.toTemplate("/@code@/@id@", { id: 1, code: "A" });
    assert.ok(m == "/A/1")

    m = lib.toTemplate("/@code@/@id@@n@", { id: 1, code: "A" });
    assert.ok(m == "/A/1\n")

    m = lib.toTemplate("/@code@/@id@ @exit@", { id: 1, code: "A" });
    assert.ok(m == "/A/1 ")

    m = lib.toTemplate("/@code@/@id@", { id: 1, code: "A" } , { allow: ["id"] });
    assert.ok(m == "//1")

    m = lib.toTemplate("/@code@/@id@", { id: 1, code: "A" }, { skip: ["id"] });
    assert.ok(m == "/A/")

    m = lib.toTemplate("/@code@/@id@", { id: 1, code: "A" }, { only: ["id"] });
    assert.ok(m == "/@code@/1")

    m = lib.toTemplate("/@code@/@id@", { id: " ", code: "A" }, { encoding: "url" });
    assert.ok(m == "/A/%20")

    m = lib.toTemplate("Hello @name|friend@!", {});
    assert.ok(m == "Hello friend!")

    m = lib.toTemplate("/@deep.code@/@id@", { id: 1, deep: { code: "A" } });
    assert.ok(m == "/A/1")

    m = lib.toTemplate("/@if code A@@code@/@id@@endif@", { id: 1, code: "A" });
    assert.ok(m == "/A/1")

    var o = { allow: ["id"] };
    m = lib.toTemplate("/@if code AA@@code@@id@/@exit@-@id@@endif@ ", { id: 1, code: "AA" }, o);
    assert.ok(m == "/1/")
    assert.ok(o.__exit === undefined)

    m = lib.toTemplate("/@if code B@@code@/@id@@endif@", { id: 1, code: "A" });
    assert.ok(m == "/")

    m = lib.toTemplate("/@ifempty code@@id@@endif@", { id: 1 });
    assert.ok(m == "/1")

    m = lib.toTemplate("/@ifempty v@@ifnotempty code@@id@@endif@@endif@", { id: 1, code: 1 });
    assert.ok(m == "/1")

    m = lib.toTemplate("/@ifstr code A@@code@/@id@@endif@", { id: 1, code: "A" });
    assert.ok(m == "/A/1")

    m = lib.toTemplate("/@ifnotstr code A@@code@/@id@@endif@", { id: 1, code: "B" });
    assert.ok(m == "/B/1")

    m = lib.toTemplate("/@aaa|dflt@", {});
    assert.ok(m == "/dflt")

    m = lib.toTemplate("/@aaa||url@", { aaa: "a=" });
    assert.ok(m == "/a%3D")

    m = lib.toTemplate("/@aaa||url@", { aaa: [1,2,3] });
    assert.ok(m == "/1%2C2%2C3")

    m = lib.toTemplate("/@aaa@", { aaa: { a: 1, b: 2 } });
    assert.ok(m == `/{"a":1,"b":2}`)

    m = lib.toTemplate("@if code A@@code@@else@ELSE@endif@", { code: "A" });
    assert.ok(m == "A")

    m = lib.toTemplate("@if code A@@code@@else@ELSE@endif@", { code: "B" });
    assert.ok(m == "ELSE")

})


