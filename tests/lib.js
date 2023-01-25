
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

tests._test_toparams = function(callback, test)
{
    var q = lib.toParams({}, {
        id: { type: "int" },
        count: { type: "int", min: 1, max: 10, dflt: 5 },
        page: { type: "int", min: 1, max: 10, dflt: NaN, required: 1, errmsg: "Page number between 1 and 10 is required" },
        name: { type: "string", max: 32, trunc: 1 },
        pair: { type: "map", separator: "|" },
        code: { type: "string", regexp: /^[a-z]-[0-9]+$/, errmsg: "Valid code is required" },
        start: { type: "token", required: 1 },
        email1: { type: "email", required: { email: null } },
        data: { type: "json", datatype: "obj" },
        mtime: { type: "mtime", name: "timestamp" },
        flag: { type: "bool", novalue: false },
        descr: { novalue: { name: "name", value: "test" },
        email: { type: "list", datatype: "email", novalue: ["a@a"] } },
        internal: { ignore: 1 },
        tm: { type: "timestamp", optional: 1 },
        const: { value: "ready" },
        mode: "ok",
        state: { values: ["ok","bad","good"] },
        status: { value: [{ name: "state", value: "ok", set: "1" }, { name: "state", value: ["bad","good"], op: "in" }],
        obj: { type: "obj", params: { id: { type: "int" }, name: {} } },
        arr: { type: "array", params: { id: { type: "int" }, name: {} } },
        state: { type: "list", datatype: "string", values: [ "VA", "DC"] } },
        ssn: { type: "string", regexp: /^[0-9]{3}-[0-9]{3}-[0-9]{4}$/, errmsg: "Valid SSN is required" },
        phone: { type: "list", datatype: "number" } },
        {
            defaults: {
               name: { dflt: "test" },
               count: { max: 100 },
               '*': { empty: 1, null: 1 },
           }

       });
    callback();
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
