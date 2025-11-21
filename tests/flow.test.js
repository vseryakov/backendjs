
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { lib } = require("../");

describe("Flow tests", () => {

    var direct = lib.isArg("-direct");

    var c1 = 0;
    lib.forEach([ 1, 2, 3 ], (i, next) => {
        c1++; next()
    }, (err) => {
        assert.strictEqual(c1, 3);
    }, direct)


    var c2 = 0;
    lib.forEach([ 1, 2, 3 ], (i, next) => {
        c2++; next(i == 2 ? "error" : null)
    }, (err) => {
        assert.ok(c2 == 2 && err);
    }, direct)


    var c3 = 0;
    lib.forEvery([ 1, 2, 3 ], (i, next) => {
        c3++; next("ignore")
    }, (err) => {
        assert.ok(c3 == 3 && err == "ignore")
    }, direct)

    lib.forEachSeries([ 1, 2, 3 ], (i, next, n) => {
        next(null, lib.toNumber(n) + i);
    }, (err, n) => {
        assert.strictEqual(n, 6);
    }, direct);

    lib.forEachSeries([ 1, 2, 3 ], (i, next, n) => {
        next(i == 2 ? "error" : null, lib.toNumber(n) + i);
    }, (err, n) => {
        assert.ok(n == 3 && err == "error");
    }, direct);

    lib.forEverySeries([ 1, 2, 3 ], (i, next, err, n) => {
        next("ignore", lib.toNumber(n) + i);
    }, (err, n) => {
        assert.ok(n == 6 && err == "ignore");
    }, direct);

    var c4 = 0;
    lib.forEachLimit([ 1, 2, 3 ], 2, (i, next) => {
        c4++; next();
    }, (err) => {
        assert.strictEqual(c4, 3);
    }, direct);

    var c5 = 0;
    lib.forEachLimit([ 1, 2, 3 ], 2, (i, next) => {
        c5++; next(i == 2 ? "error" : null);
    }, (err) => {
        assert.ok(c5 == 2 && err == "error");
    }, direct);

    var c6 = 0;
    lib.forEveryLimit([ 1, 2, 3 ], 2, (i, next) => {
        c6++; next("ignore");
    }, (err) => {
        assert.ok(c6 == 3 && String(err) == "ignore,ignore,ignore");
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
            assert.strictEqual(c7, 5);
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
            assert.strictEqual(c8, 5);
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
        assert.ok(c9 == 2 && d === 2);
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
        assert.ok(c10 == 1 && d == 1 && err == "error");
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
        assert.strictEqual(c11, 2);
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
        assert.ok(c12 >= 1 && err);
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
        assert.ok(c13 == 2 && d === 2 && err == "ignore");
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
        assert.strictEqual(c14, 2);
    }, direct)

})
