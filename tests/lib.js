
const fs = require("fs")
const util = require("util")

tests.test_flow = function(callback, test)
{
    var direct = lib.isArg("-direct");
    var t = 0;
    setInterval(() => { if (!t) callback() }, 500);

    t++;
    var c1 = 0;
    lib.forEach([ 1, 2, 3 ], (i, next) => {
        c1++; next()
    }, (err) => {
        t--;
        logger.info("forEach", err, c1, c1 == 3 && !err ? "success": "FAILED")
    }, direct)

    t++;
    var c2 = 0;
    lib.forEach([ 1, 2, 3 ], (i, next) => {
        c2++; next(i == 2 ? "error" : null)
    }, (err) => {
        t--;
        logger.info("forEach", err, c2, c2 == 2 && err ? "success": "FAILED")
    }, direct)

    t++;
    var c3 = 0;
    lib.forEvery([ 1, 2, 3 ], (i, next) => {
        c3++; next("ignore")
    }, (err) => {
        t--;
        logger.info("forEvery", err, c3, c3 == 3 && err == "ignore" ? "success": "FAILED")
    }, direct)

    t++;
    lib.forEachSeries([ 1, 2, 3 ], (i, next, n) => {
        next(null, lib.toNumber(n) + i);
    }, (err, n) => {
        t--;
        logger.info('forEachSeries', n, err, n == 6 ? "success" : "FAILED");
    }, direct);

    t++;
    lib.forEachSeries([ 1, 2, 3 ], (i, next, n) => {
        next(i == 2 ? "error" : null, lib.toNumber(n) + i);
    }, (err, n) => {
        t--;
        logger.info('forEachSeries', n, err, n == 3 && err == "error" ? "success" : "FAILED");
    }, direct);

    t++;
    lib.forEverySeries([ 1, 2, 3 ], (i, next, err, n) => {
        next("ignore", lib.toNumber(n) + i);
    }, (err, n) => {
        t--;
        logger.info('forEverySeries', n, err, n == 6 && err == "ignore" ? "success" : "FAILED");
    }, direct);

    t++;
    var c4 = 0;
    lib.forEachLimit([ 1, 2, 3 ], 2, (i, next) => {
        c4++; next();
    }, (err) => {
        t--;
        logger.info('forEachLimit', c4, err, c4 == 3 && !err ? "success" : "FAILED");
    }, direct);

    t++;
    var c5 = 0;
    lib.forEachLimit([ 1, 2, 3 ], 2, (i, next) => {
        c5++; next(i == 2 ? "error" : null);
    }, (err) => {
        t--;
        logger.info('forEachLimit', c5, err, c5 == 2 && err == "error" ? "success" : "FAILED");
    }, direct);

    t++;
    var c6 = 0;
    lib.forEveryLimit([ 1, 2, 3 ], 2, (i, next) => {
        c6++; next("ignore");
    }, (err) => {
        t--;
        logger.info('forEveryLimit', c6, err, c6 == 3 && String(err) == "ignore,ignore,ignore" ? "success" : "FAILED");
    }, direct);

    t++;
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
            t--;
            logger.info('whilst', c7, d, err, c7 == 5 && !err ? "success" : "FAILED");
        }, direct);

    t++;
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
            t--;
            logger.info('whilst', c8, d, err, c8 == 5 && !err ? "success" : "FAILED");
        }, direct);

    t++;
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
        t--;
        logger.info('series', c9, d, err, c9 == 2 && d === 2 && !err ? "success" : "FAILED");
    }, direct)

    t++;
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
        t--;
        logger.info('series', c10, d, err, c10 == 1 && d == 1 && err == "error" ? "success" : "FAILED");
    }, direct)

    t++;
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
        t--;
        logger.info('parallel', c11, err, c11 == 2 && !err ? "success" : "FAILED");
    }, direct)

    t++;
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
        t--;
        logger.info('parallel', c12, err, c12 >= 1 && err ? "success" : "FAILED");
    }, direct)

    t++;
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
        t--;
        logger.info('everySeries', c13, d, err, c13 == 2 && d === 2 && err == "ignore" ? "success" : "FAILED");
    }, direct)

    t++;
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
        t--;
        logger.info('everyParallel', c14, err, c14 == 2 && !err ? "success" : "FAILED");
    }, direct)

}

tests.test_foreachline = async function(callback)
{
    const file = core.path.tmp + "/test.txt";
    const line = "[1,2,3]";
    const nlines = 10000;
    const forEachLine = util.promisify(lib.forEachLine.bind(lib))

    fs.writeFileSync(file, "");
    for (let i = 0; i < nlines-2; i++) fs.appendFileSync(file, line + "\n");
    fs.appendFileSync(file, "[2,3,4]\n[1,2,3]\n");

    var count = 0, opts = {};
    lib.forEachLineSync(file, opts, (l) => { count += l.length });
    expect(count == line.length*nlines, "all lines must be read", count, "!=", nlines*line.length, opts);

    count = 0;
    opts = { count: 100, skip: 1000 }
    lib.forEachLineSync(file, opts, (ls) => { for (const l of ls) count += l.length });
    expect(count == line.length*(nlines-1000), "1000 less lines must be read", count, "!=", line.length*(nlines-1000), opts);

    count = 0;
    opts = { limit: 100 }
    lib.forEachLineSync(file, opts, (l) => { count += l.length });
    expect(count == line.length*(100), "100 lines must be read", count, "!=", line.length*(100), opts);

    count = 0;
    opts = { length: line.length*10 }
    lib.forEachLineSync(file, opts, (l) => { count += l.length });
    expect(count == line.length*(10), "10 lines must be read", count, "!=", line.length*(10), opts);

    count = 0;
    opts = { until: /^\[2/ }
    lib.forEachLineSync(file, opts, (l) => { count += l.length });
    expect(count == line.length, "1 last lines must be read", count, "!=", line.length, opts);

    count = 0;
    opts = { split: 1 }
    lib.forEachLineSync(file, opts, (ls) => { for (const l of ls) count += lib.toNumber(l.replace(/[[\]]/g,"")) });
    expect(count == nlines*6+3, "all sum of splitted lines must be read", count, "!=", nlines*6+3, opts);

    count = 0;
    opts = { json: 1 }
    lib.forEachLineSync(file, opts, (ls) => { for (const l of ls) count += lib.toNumber(l) });
    expect(count == nlines*6+3, "all sum of json lines must be read", count, "!=", nlines*6+3, opts);

    // Async version
    count = 0, opts = {}
    await forEachLine(file, opts, (l, next) => { count += l.length; next() });
    expect(count == line.length*nlines, "async: all lines must be read", count, "!=", nlines*line.length, opts);

    count = 0;
    opts = { count: 100, skip: 1000 }
    await forEachLine(file, opts, (ls, next) => { for (const l of ls) count += l.length; next() });
    expect(count == line.length*(nlines-1000), "async: 1000 less lines must be read", count, "!=", line.length*(nlines-1000), opts);

    count = 0;
    opts = { limit: 100 }
    await forEachLine(file, opts, (l, next) => { count += l.length; next() });
    expect(count == line.length*(100), "async: 100 lines must be read", count, "!=", line.length*(100), opts);

    count = 0;
    opts = { length: line.length*10 }
    await forEachLine(file, opts, (l, next) => { count += l.length; next() });
    expect(count == line.length*(10), "async: 10 lines must be read", count, "!=", line.length*(10), opts);

    count = 0;
    opts = { until: /^\[2/ }
    await forEachLine(file, opts, (l, next) => { count += l.length; next() });
    expect(count == line.length, "async: 1 last lines must be read", count, "!=", line.length, opts);

    count = 0;
    opts = { split: 1 }
    await forEachLine(file, opts, (ls, next) => { for (const l of ls) count += lib.toNumber(l.replace(/[[\]]/g,"")); next() });
    expect(count == nlines*6+3, "async: all sum of splitted lines must be read", count, "!=", nlines*6+3, opts);

    count = 0;
    opts = { json: 1 }
    await forEachLine(file, opts, (ls, next) => { for (const l of ls) count += lib.toNumber(l); next() });
    expect(count == nlines*6+3, "async: all sum of json lines must be read", count, "!=", nlines*6+3, opts);

    callback();
}

tests.test_pool = function(callback)
{
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
}

tests.test_toparams = function(callback, test)
{
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
        mtime: { type: "mtime", name: "timestamp" },
        flag: { type: "bool", novalue: false },
        descr: { novalue: { name: "name", value: "test" }, replace: { "<": "!" } },
        internal: { ignore: 1 },
        tm: { type: "timestamp", optional: 1 },
        ready: { value: "ready" },
        empty: { empty: 1, trim: 1, strip: /[.,!]/ },
        state: { type: "list", values: [ "ok","bad","good" ] },
        obj: { type: "obj", params: { id: { type: "int" }, name: {} } },
        arr: { type: "array", params: { id: { type: "int" }, name: {} } },
        json: { type: "json", datatype: "obj" },
        json1: { type: "json", params: { id: { type: "int" }, name: {} } },
    };
    var opts = {
        defaults: {
            '*.int': { max: 100 },
            "*.string": { max: 5 },
            '*': { maxlist: 5 },
        }
    };

    var q = lib.toParams({}, schema, opts);
    expect(/email1 is required/.test(q), "expected email1 required", q);

    q = lib.toParams({ email: "a@a" }, schema, opts);
    expect(/email1 is required/.test(q), "expected email1 required", q);

    q = lib.toParams({ email1: "a@a" }, schema, opts);
    expect(/email1 is required/.test(q), "expected email1 required", q);

    q = lib.toParams({ email1: "a@a.com" }, schema, opts);
    expect(q.page === 1 && q.count === 1, "expected page=1, count=1", q);

    schema.email1.required = 0;
    q = lib.toParams({ page: 1000, count: 1000 }, schema, opts);
    expect(q.page === 10 && q.count === 100, "expected page=10, count=100", q);

    q = lib.toParams({ name: "1234567890" }, schema, opts);
    expect(q.name == "123456", "expected name=123456", q);

    q = lib.toParams({ descr: "1234567890" }, schema, opts);
    expect(/descr is too long/.test(q), "expected descr is too long", q);

    q = lib.toParams({ descr: "<2345" }, schema, opts);
    expect(q.descr == "!2345", "expected descr=!2345", q);

    q = lib.toParams({ name: "test", descr: "test" }, schema, opts);
    expect(!q.descr && q.name == "test", "expected no descr", q);

    q = lib.toParams({ pair: "a:1,b:2" }, schema, opts);
    expect(q.pair?.a === 1 && q.pair?.b === 2, "expected a=1 and b=2", q);

    q = lib.toParams({ code: "12345" }, schema, opts);
    expect(/Valid code is required/.test(q), "expected valid code is required", q);

    q = lib.toParams({ code: "q-123" }, schema, opts);
    expect(q.code === "q-123", "expected code=q-123", q);

    q = lib.toParams({ code1: "q.123" }, schema, opts);
    expect(/Valid code1 is required/.test(q), "expected valid code1 is required", q);

    q = lib.toParams({ start: "test" }, schema, opts);
    expect(!q.start, "expected no start", q);

    q = lib.toParams({ start: lib.jsonToBase64("test", "test") }, schema, opts);
    expect(q.start == "test", "expected start=test", q);

    q = lib.toParams({ tm: 1 }, schema, opts);
    expect(q.ready == "ready" && q.tm == '1970-01-01T00:00:01.000Z', "expected ready and tm, count=1", q);

    q = lib.toParams({ mtime: '1970-01-01T00:00:01.000Z' }, schema, opts);
    expect(q.timestamp == 1000, "expected timestamp=1000", q);

    q = lib.toParams({ state: "ok,done,error", flag: false }, schema, opts);
    expect(q.state == "ok", "expected state=ok", q);
    expect(q.flag === undefined, "expected flag undefined", q);

    q = lib.toParams({ obj: { id: "1", descr: "1", name: "1" } }, schema, opts);
    expect(q.obj?.id === 1 && !q.obj?.descr && q.obj?.name == "1", "expected obj{id=1,name=1}", q);

    q = lib.toParams({ json: lib.stringify({ id: "1", descr: "1", name: "1" }) }, schema, opts);
    expect(q.json?.id == "1" && q.json?.descr == "1" && q.json?.name == "1", "expected json{id=1,descr=1,name=1}", q);

    q = lib.toParams({ json1: lib.stringify({ id: "1", descr: "1", name: "1" }) }, schema, opts);
    expect(q.json1?.id === 1 && !q.json1?.descr && q.json1?.name == "1", "expected json1{id=1,name=1}", q);

    q = lib.toParams({ empty: "." }, schema, opts);
    expect(q.empty === "", "expected empty", q);

    callback();
}

tests.test_search = function(callback, test)
{
    var words = ['keyword1', 'keyword2', 'etc'];
    var text = 'should find keyword1 at position 19 and keyword2 at position 47.';
    var ac = new lib.AhoCorasick(words);
    var rc = ac.search(text);

    expect(rc.length && rc[0][0] == 19 && rc[0][1] == "keyword1", "expected keyword1 in the result", rc);
    expect(rc.length == 2 && rc[1][0] == 47 && rc[1][1] == "keyword2", "expected keyword2 in the result", rc);

    rc = ac.search(text, { list: 1 });
    expect(rc.length == 2 && rc[0] == "keyword1" && rc[1] == "keyword2", "expected keyword1,keyword2 in the result", rc);

    rc = ac.search(text.replace("keyword2", "akeyword2"), { list: 1, delimiters: "" });
    expect(rc.length == 1 && rc[0] == "keyword1", "expected keyword1 only in the result", rc);

    rc = lib.findWords(words, text);
    expect(rc.length == 2 && rc[0] == "keyword1" && rc[1] == "keyword2", "expected words keyword1,keyword2 in the result", rc);

    rc = lib.findWords(words, text.replace("keyword2", "akeyword2"));
    expect(rc.length == 1 && rc[0] == "keyword1", "expected word keyword1 only in the result", rc);

    callback();
}

