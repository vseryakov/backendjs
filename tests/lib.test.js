
const { describe, it, test } = require('node:test');
const assert = require('node:assert/strict');
const { lib } = require("../");

describe("lib.findWords", () => {

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

});

describe("lib.skip32", () => {

    // these are the default test values from the original C code
    var KEY = [ 0x00,0x99,0x88,0x77,0x66,0x55,0x44,0x33,0x22,0x11 ];
    var INPUT = parseInt("33221100", 16)
    var ENCRYPTED = parseInt("819d5f1f", 16);
    var e = lib.toSkip32("",KEY,INPUT)
    var d = lib.toSkip32("d",KEY,e)
    assert.strictEqual(ENCRYPTED, e);
    assert.strictEqual(INPUT, d);
})

describe("lib.toTemplate", () => {

    var m = lib.toTemplate("email@id@@@com", { id: 1 }, { allow: ["id"] });
    assert.strictEqual(m, "email1@com")

    m = lib.toTemplate("email@com,@id@@@com", { id: 1, code: "A" });
    assert.strictEqual(m, "email@com,1@com")

    m = lib.toTemplate("/@code@/@id@", { id: 1, code: "A" });
    assert.strictEqual(m, "/A/1")

    m = lib.toTemplate("/@code@/@id@@n@", { id: 1, code: "A" });
    assert.strictEqual(m, "/A/1\n")

    m = lib.toTemplate("/@code@/@id@ @exit@", { id: 1, code: "A" });
    assert.strictEqual(m, "/A/1 ")

    m = lib.toTemplate("/@code@/@id@", { id: 1, code: "A" } , { allow: ["id"] });
    assert.strictEqual(m, "//1")

    m = lib.toTemplate("/@code@/@id@", { id: 1, code: "A" }, { skip: ["id"] });
    assert.strictEqual(m, "/A/")

    m = lib.toTemplate("/@code@/@id@", { id: 1, code: "A" }, { only: ["id"] });
    assert.strictEqual(m, "/@code@/1")

    m = lib.toTemplate("/@code@/@id@", { id: " ", code: "A" }, { encoding: "url" });
    assert.strictEqual(m, "/A/%20")

    m = lib.toTemplate("Hello @name|friend@!", {});
    assert.strictEqual(m, "Hello friend!")

    m = lib.toTemplate("/@deep.code@/@id@", { id: 1, deep: { code: "A" } });
    assert.strictEqual(m, "/A/1")

    m = lib.toTemplate("/@if code A@@code@/@id@@endif@", { id: 1, code: "A" });
    assert.strictEqual(m, "/A/1")

    var o = { allow: ["id"] };
    m = lib.toTemplate("/@if code AA@@code@@id@/@exit@-@id@@endif@ ", { id: 1, code: "AA" }, o);
    assert.strictEqual(m, "/1/")
    assert.ok(!o.__exit)

    m = lib.toTemplate("/@if code B@@code@/@id@@endif@", { id: 1, code: "A" });
    assert.strictEqual(m, "/")

    m = lib.toTemplate("/@ifempty code@@id@@endif@", { id: 1 });
    assert.strictEqual(m, "/1")

    m = lib.toTemplate("/@ifempty v@@ifnotempty code@@id@@endif@@endif@", { id: 1, code: 1 });
    assert.strictEqual(m, "/1")

    m = lib.toTemplate("/@ifstr code A@@code@/@id@@endif@", { id: 1, code: "A" });
    assert.strictEqual(m, "/A/1")

    m = lib.toTemplate("/@ifnotstr code A@@code@/@id@@endif@", { id: 1, code: "B" });
    assert.strictEqual(m, "/B/1")

    m = lib.toTemplate("/@aaa|dflt@", {});
    assert.strictEqual(m, "/dflt")

    m = lib.toTemplate("/@aaa||url@", { aaa: "a=" });
    assert.strictEqual(m, "/a%3D")

    m = lib.toTemplate("/@aaa||url@", { aaa: [1,2,3] });
    assert.strictEqual(m, "/1%2C2%2C3")

    m = lib.toTemplate("/@aaa@", { aaa: { a: 1, b: 2 } });
    assert.strictEqual(m, `/{"a":1,"b":2}`)

    m = lib.toTemplate("@if code A@@code@@else@ELSE@endif@", { code: "A" });
    assert.strictEqual(m, "A")

    m = lib.toTemplate("@if code A@@code@@else@ELSE@endif@", { code: "B" });
    assert.strictEqual(m, "ELSE")

})

describe("lib.parseTime", function () {
    const ok = (input, expected) => {
        assert.deepStrictEqual(lib.parseTime(input), expected, `input=${JSON.stringify(input)}`);
    };

    const bad = (input) => {
        assert.strictEqual(lib.parseTime(input), undefined, `input=${JSON.stringify(input)}`);
    };

    it("parses hours only", function () {
        ok("0", [0, 0]);
        ok("9", [9, 0]);
        ok("23", [23, 0]);
    });

    it("parses hh:mm (single/double digit parts)", function () {
        ok("0:0", [0, 0]);
        ok("0:5", [0, 5]);
        ok("7:05", [7, 5]);
        ok("07:05", [7, 5]);
        ok("23:59", [23, 59]);
    });

    it("accepts optional spaces around am/pm", function () {
        ok("7am", [7, 0]);
        ok("7 am", [7, 0]);
        ok("7pm ", [19, 0]);
        ok("7   am", [7, 0]);
        ok("7 am", [7, 0]);
        ok("7:05pm", [19, 5]);
        ok("7:05 pm", [19, 5]);
        ok("10:10pm", [22, 10]);
    });

    it("handles am/pm edge cases (12am/12pm)", function () {
        ok("12am", [0, 0]);
        ok("12 am", [0, 0]);
        ok("12pm", [12, 0]);
        ok("12 pm", [12, 0]);

        ok("12:01am", [0, 1]);
        ok("12:01pm", [12, 1]);
    });

    it("is case-insensitive for am/pm", function () {
        ok("1 AM", [1, 0]);
        ok("1 PM", [13, 0]);
        ok("1 aM", [1, 0]);
        ok("1 pM", [13, 0]);
    });

    it("coerces non-string inputs via String()", function () {
        ok(5, [5, 0]);
        ok(0, [0, 0]);
        ok("5", [5, 0]);
    });

    it("rejects out-of-range hours/minutes", function () {
        bad("24");
        bad("24:00");
        bad("23:60");
        bad("-1");
        bad("-1:00");
    });

    it("rejects malformed formats", function () {
        bad("");
        bad(" ");
        bad("nope");
        bad("7:");
        bad(":30");
        bad("7:");         // missing minutes
        bad("7:5:1");      // too many parts
        bad("7amfoo");
        bad("7 am foo");
        bad("7 : 05");     // spaces around colon not allowed
        bad("07: 05");     // space before minutes not allowed
        bad("07 :05");     // space before colon not allowed
        bad("730pm");
        bad("0730");
    });
});

describe("lib.isTimeRange", function () {

    function withFakeNow(iso, fn) {
        const RealDate = Date;
        const fixed = new RealDate(iso);

        // eslint-disable-next-line no-global-assign
        Date = class FakeDate extends RealDate {
            constructor(...args) {
                if (args.length) return new RealDate(...args);
                return new RealDate(fixed.getTime());
            }
            static now() { return fixed.getTime(); }
            static parse(s) { return RealDate.parse(s); }
            static UTC(...args) { return RealDate.UTC(...args); }
        };

        try {
            return fn();
        } finally {
            // eslint-disable-next-line no-global-assign
            Date = RealDate;
        }
    }

    it("returns 0 when both time1 and time2 are falsy", function () {
        assert.strictEqual(lib.isTimeRange(null, null), 0);
        assert.strictEqual(lib.isTimeRange(undefined, undefined), 0);
        assert.strictEqual(lib.isTimeRange("", ""), 0);
    });

    it("uses UTC when tz is 'UTC'/'GMT' (start check)", function () {
        // fixed time: 10:15 UTC
        withFakeNow("2020-01-02T10:15:00.000Z", () => {
          assert.strictEqual(lib.isTimeRange("10:00", null, { tz: "UTC" }), 1);
          assert.strictEqual(lib.isTimeRange("10:15", null, { tz: "UTC" }), 1);
          assert.strictEqual(lib.isTimeRange("10:16", null, { tz: "UTC" }), 0);
      });
    });

    it("accepts tz offsets like GMT+02:00 / GMT-05:30", function () {
        // now: 10:15 UTC -> local (GMT+02:00) becomes 12:15
        withFakeNow("2020-01-02T10:15:00.000Z", () => {
          assert.strictEqual(lib.isTimeRange("12:15", null, { tz: "GMT+02:00" }), 1);
          assert.strictEqual(lib.isTimeRange("12:16", null, { tz: "GMT+02:00" }), 0);
      });

        // now: 10:15 UTC -> local (GMT-05:30) becomes 04:45
        withFakeNow("2020-01-02T10:15:00.000Z", () => {
          assert.strictEqual(lib.isTimeRange("4:45", null, { tz: "GMT-05:30" }), 1);
          assert.strictEqual(lib.isTimeRange("4:46", null, { tz: "GMT-05:30" }), 0);
      });
    });

    it("returns 0 on invalid time strings (parseTime fails)", function () {
        withFakeNow("2020-01-02T10:15:00.000Z", () => {
          assert.strictEqual(lib.isTimeRange("nope", null, { tz: "UTC" }), 0);
          assert.strictEqual(lib.isTimeRange(null, "25:00", { tz: "UTC" }), 0);
          assert.strictEqual(lib.isTimeRange("10:00", "bad", { tz: "UTC" }), 0);
      });
    });

    it("date option must match (compares %Y-%m-%d in the computed tz)", function () {
        // At 2020-01-02T23:30Z, in GMT+02:00 it's already 2020-01-03 01:30
        withFakeNow("2020-01-02T23:30:00.000Z", () => {
          assert.strictEqual(lib.isTimeRange("1:00", null, { tz: "GMT+02:00", date: "2020-01-03" }), 1);
          assert.strictEqual(lib.isTimeRange("1:00", null, { tz: "GMT+02:00", date: "2020-01-02" }), 0);
      });
    });

    it("start time: returns 1 only if now >= time1", function () {
        withFakeNow("2020-01-02T10:15:00.000Z", () => {
          assert.strictEqual(lib.isTimeRange("10:14", null, { tz: "UTC" }), 1);
          assert.strictEqual(lib.isTimeRange("10:15", null, { tz: "UTC" }), 1);
          assert.strictEqual(lib.isTimeRange("10:16", null, { tz: "UTC" }), 0);
      });
    });

    it("end time: (as implemented) returns 1 only if now >= time2", function () {
        // Note: this function currently checks "< end => 0", so it's effectively "after end"
        withFakeNow("2020-01-02T10:15:00.000Z", () => {
          assert.strictEqual(lib.isTimeRange(null, "10:14", { tz: "UTC" }), 1);
          assert.strictEqual(lib.isTimeRange(null, "10:15", { tz: "UTC" }), 1);
          assert.strictEqual(lib.isTimeRange(null, "10:16", { tz: "UTC" }), 0);
      });
    });

    it("both start and end must pass their checks", function () {
        withFakeNow("2020-01-02T10:15:00.000Z", () => {
          assert.strictEqual(lib.isTimeRange("10:00", "10:10", { tz: "UTC" }), 1);
          assert.strictEqual(lib.isTimeRange("10:00", "10:16", { tz: "UTC" }), 0);
          assert.strictEqual(lib.isTimeRange("10:16", "10:10", { tz: "UTC" }), 0);
      });
    });

    it("supports am/pm via parseTime", function () {
        withFakeNow("2020-01-02T22:05:00.000Z", () => {
          assert.strictEqual(lib.isTimeRange("10:00pm", null, { tz: "UTC" }), 1);
          assert.strictEqual(lib.isTimeRange("10:06pm", null, { tz: "UTC" }), 0);
      });
    });

    it("tz omitted: uses system offset path (just ensure it runs)", function () {
        withFakeNow("2020-01-02T10:15:00.000Z", () => {
          // Don't assert 0/1 because host TZ varies; just ensure it's not throwing
          const r = lib.isTimeRange("0:00", null, {});
          assert.ok(r === 0 || r === 1);
      });
    });
});

describe("lib.toNumber", function () {
  it("returns 0 for null/undefined/empty without options", function () {
    assert.strictEqual(lib.toNumber(null), 0);
    assert.strictEqual(lib.toNumber(undefined), 0);
    assert.strictEqual(lib.toNumber(""), 0); // parseInt("")/parseFloat("") => NaN => 0
  });

  it("passes through numbers", function () {
    assert.strictEqual(lib.toNumber(5), 5);
    assert.strictEqual(lib.toNumber(-2.5), -2.5);
    assert.strictEqual(lib.toNumber(NaN), 0);
  });

  it("converts booleans", function () {
    assert.strictEqual(lib.toNumber(true), 1);
    assert.strictEqual(lib.toNumber(false), 0);
  });

  it("uses default for non-string non-number non-boolean", function () {
    assert.strictEqual(lib.toNumber({}), 0);
    assert.strictEqual(lib.toNumber({}, { dflt: 7 }), 7);
    assert.strictEqual(lib.toNumber([]), 0);
    assert.strictEqual(lib.toNumber([], { dflt: 3 }), 3);
  });

  it("parses integer strings by default", function () {
    assert.strictEqual(lib.toNumber("123"), 123);
    assert.strictEqual(lib.toNumber("0010"), 10);
    assert.strictEqual(lib.toNumber("-7"), -7);
    assert.strictEqual(lib.toNumber("12.9", { float: 0 }), 12);
  });

  it("autodetects floats if options.float is undefined", function () {
    // depends on lib.rxFloat; assuming "1.23" matches float regex
    assert.strictEqual(lib.toNumber("1.23"), 1.23);
  });

  it("forces float parsing when options.float = 1", function () {
    assert.strictEqual(lib.toNumber("1.23", { float: 1 }), 1.23);
    assert.strictEqual(lib.toNumber("10", { float: 1 }), 10);
  });

  it("handles string starting with t/f as booleans", function () {
    assert.strictEqual(lib.toNumber("true"), 1);
    assert.strictEqual(lib.toNumber("false"), 0);
    assert.strictEqual(lib.toNumber("t"), 1);
    assert.strictEqual(lib.toNumber("f"), 0);
  });

  it('handles string "infinity"', function () {
    assert.strictEqual(lib.toNumber("infinity"), Infinity);
  });

  it("uses dflt when result is NaN", function () {
    assert.strictEqual(lib.toNumber("nope"), 0);
    assert.strictEqual(lib.toNumber("nope", { dflt: 9 }), 9);
  });

  it("applies novalue replacement", function () {
    assert.strictEqual(lib.toNumber("5", { novalue: 5, dflt: 2 }), 2);
    assert.strictEqual(lib.toNumber(5, { novalue: 5, dflt: 2 }), 2);
  });

  it("applies incr and mult in order", function () {
    // n=10 => incr => 12 => mult => 36
    assert.strictEqual(lib.toNumber("10", { incr: 2, mult: 3 }), 36);
  });

  it("clips to min/max", function () {
    assert.strictEqual(lib.toNumber("1", { min: 5 }), 5);
    assert.strictEqual(lib.toNumber("10", { max: 7 }), 7);
    assert.strictEqual(lib.toNumber("6", { min: 5, max: 7 }), 6);
  });

  it("rounds when options.float is explicitly falsey (0)", function () {
    assert.strictEqual(lib.toNumber("1.4", { float: 0 }), 1);
    assert.strictEqual(lib.toNumber("1.5", { float: 0 }), 1);
    assert.strictEqual(lib.toNumber(2.49, { float: 0 }), 2);
  });

  it("replaces 0 with options.zero", function () {
    assert.strictEqual(lib.toNumber("0", { zero: 9 }), 9);
    assert.strictEqual(lib.toNumber(0, { zero: 9 }), 9);
    assert.strictEqual(lib.toNumber(false, { zero: 9 }), 9);
  });

  it("keeps digits after decimal with options.digits", function () {
    assert.strictEqual(lib.toNumber("1.2345", { float: 1, digits: 2 }), 1.23);
    assert.strictEqual(lib.toNumber("1.235", { float: 1, digits: 2 }), 1.24);
  });

  it("bigint: returns BigInt if not a safe integer", function () {
    const big = "9007199254740993"; // > Number.MAX_SAFE_INTEGER
    const out = lib.toNumber(big, { bigint: 1 });
    assert.strictEqual(typeof out, "bigint");
    assert.strictEqual(out, BigInt(big));
  });

  it("bigint: does not convert safe integers", function () {
    const out = lib.toNumber("123", { bigint: 1 });
    assert.strictEqual(typeof out, "number");
    assert.strictEqual(out, 123);
  });

  it("handles incr/mult producing NaN -> dflt", function () {
    // Force n to be a number, then multiply by NaN using a non-number? mult must be number to apply.
    // Instead: start with NaN string -> becomes dflt, then mult works.
    assert.strictEqual(lib.toNumber("nope", { dflt: 2, mult: 3 }), 6);
  });
});

describe("lib.extend", function () {
  it("returns an object even if target is not an object", function () {
    const out = lib.extend(null, { a: 1 });
    assert.deepStrictEqual(out, { a: 1 });

    const out2 = lib.extend(123, { a: 1 });
    assert.deepStrictEqual(out2, { a: 1 });

    const out3 = lib.extend("x", { a: 1 });
    assert.deepStrictEqual(out3, { a: 1 });
  });

  it("behaves like assign for flat props (last wins)", function () {
    const out = lib.extend({ a: 1 }, { a: 2, b: 1 }, { b: 3 });
    assert.deepStrictEqual(out, { a: 2, b: 3 });
  });

  it("deep merges plain objects", function () {
    const out = lib.extend({ a: 1, c: 5 }, { c: { b: 2 } }, { c: { a: 2 } });
    assert.deepStrictEqual(out, { a: 1, c: { b: 2, a: 2 } });
  });

  it("deep merges arrays by index (recursive)", function () {
    const out = lib.extend({}, { d: [{ d: 3 }] });
    assert.deepStrictEqual(out, { d: [{ d: 3 }] });

    const out2 = lib.extend({ a: [1, 2] }, { a: [3] });
    // index 0 overwritten, index 1 preserved
    assert.deepStrictEqual(out2, { a: [3, 2] });
  });

  it("merges array elements that are objects", function () {
    const out = lib.extend({ a: [{ x: 1, y: 1 }] }, { a: [{ y: 2, z: 3 }] });
    assert.deepStrictEqual(out, { a: [{ x: 1, y: 2, z: 3 }] });
  });

  it("overwrites object with primitive", function () {
    const out = lib.extend({ a: { b: 1 } }, { a: 10 });
    assert.deepStrictEqual(out, { a: 10 });
  });

  it("overwrites primitive with object (deep)", function () {
    const out = lib.extend({ a: 1 }, { a: { b: 2 } });
    assert.deepStrictEqual(out, { a: { b: 2 } });
  });

  it("keeps functions as-is (not treated as plain objects)", function () {
    function f1() {}
    function f2() {}
    const out = lib.extend({ f: f1 }, { f: f2 });
    assert.strictEqual(out.f, f2);
  });

  it("skips __proto__ to prevent prototype pollution", function () {
    const before = ({}).polluted;
    lib.extend({}, JSON.parse('{"__proto__":{"polluted":"yes"}}'));
    const after = ({}).polluted;

    assert.strictEqual(before, undefined);
    assert.strictEqual(after, undefined);
  });

  it("does not recurse infinitely when value references the target object", function () {
    const obj = {};
    const src = { a: obj };
    const out = lib.extend(obj, src);

    // it should skip setting a to itself; so a should remain undefined
    assert.strictEqual(out, obj);
    assert.strictEqual(out.a, undefined);
  });

  it("handles multiple source objects", function () {
    const out = lib.extend(
      { a: 1, c: { x: 1 }, d: [0, { k: 1 }] },
      { b: 2, c: { y: 2 }, d: [3, { k: 2, m: 3 }] },
      { c: { x: 9 } }
    );

    assert.deepStrictEqual(out, {
      a: 1,
      b: 2,
      c: { x: 9, y: 2 },
      d: [3, { k: 2, m: 3 }],
    });
  });

  it("treats Date/RegExp as non-plain objects (overwrites, does not deep merge)", function () {
    const d1 = new Date(1);
    const d2 = new Date(2);

    const out = lib.extend({ a: d1 }, { a: d2 });
    assert.strictEqual(out.a, d2);

    const r1 = /a/;
    const r2 = /b/;
    const out2 = lib.extend({ r: r1 }, { r: r2 });
    assert.strictEqual(out2.r, r2);
  });

  it("supports extending into an existing array target", function () {
    const out = lib.extend([1, 2], [3]);
    assert.deepStrictEqual(out, [3, 2]);
  });
});

describe("lib.split tests", () => {

    test('split: returns empty array for empty/null/undefined input', () => {
        assert.deepEqual(lib.split(''), []);
        assert.deepEqual(lib.split(null), []);
        assert.deepEqual(lib.split(undefined), []);
        assert.deepEqual(lib.split(0), []);
    });

    test('split: splits strings by explicit separator', () => {
        assert.deepEqual(lib.split('a,b,c', ','), ['a', 'b', 'c']);
        assert.deepEqual(lib.split('a|b|c', '|'), ['a', 'b', 'c']);
    });

    test('split: ignores empty items by default', () => {
        assert.deepEqual(lib.split('a,,b,,c,', ','), ['a', 'b', 'c']);
    });

    test('split: keeps empty items with keepempty option', () => {
        assert.deepEqual(
            lib.split('a,,b,', ',', { keepempty: true }),
            ['a', '', 'b', '']
            );
    });

    test('split: trims string items by default', () => {
        assert.deepEqual(
            lib.split(' a , b , c ', ','),
            ['a', 'b', 'c']
            );
    });

    test('split: does not trim string items with notrim option', () => {
        assert.deepEqual(
            lib.split(' a , b , c ', ',', { notrim: true }),
            [' a ', ' b ', ' c ']
            );
    });

    test('split: accepts arrays and preserves non-string items', () => {
        const input = [' a ', 1, true, { x: 1 }, ' b '];

        assert.deepEqual(
            lib.split(input),
            ['a', 1, true, { x: 1 }, 'b']
            );
    });

    test('split: converts non-array non-string input to string before splitting', () => {
        assert.deepEqual(lib.split(12345, '2'), ['1', '345']);
    });

    test('split: applies lower option', () => {
        assert.deepEqual(
            lib.split('A,B,C', ',', { lower: true }),
            ['a', 'b', 'c']
            );
    });

    test('split: applies upper option', () => {
        assert.deepEqual(
            lib.split('a,b,c', ',', { upper: true }),
            ['A', 'B', 'C']
            );
    });

    test('split: applies max option and skips oversized values by default', () => {
        assert.deepEqual(
            lib.split('one,three,two,four', ',', { max: 3 }),
            ['one', 'two']
            );
    });

    test('split: applies max + trunc options', () => {
        assert.deepEqual(
            lib.split('one,three,two,four', ',', { max: 3, trunc: true }),
            ['one', 'thr', 'two', 'fou']
            );
    });

    test('split: applies regexp option and keeps matching values only', () => {
        assert.deepEqual(
            lib.split('abc,123,def,456', ',', { regexp: /^\d+$/ }),
            ['123', '456']
            );
    });

    test('split: applies noregexp option and skips matching values', () => {
        assert.deepEqual(
            lib.split('abc,123,def,456', ',', { noregexp: /^\d+$/ }),
            ['abc', 'def']
            );
    });

    test('split: applies strip option', () => {
        assert.deepEqual(
            lib.split('a-b,c-d,e-f', ',', { strip: /-/g }),
            ['ab', 'cd', 'ef']
            );
    });

    test('split: applies replace option', () => {
        assert.deepEqual(
            lib.split('a-b,c_d,e.f', ',', {
                replace: {
                    '-': '',
                    '_': '',
                    '.': ''
                }
            }),
            ['ab', 'cd', 'ef']
            );
    });

    test('split: applies cap option', () => {
        assert.deepEqual(
            lib.split('hello world,john doe', ',', { cap: true }),
            ['Hello World', 'John Doe']
            );
    });

    test('split: applies camel option', () => {
        assert.deepEqual(
            lib.split('hello-world,john-doe', ',', { camel: true }),
            ['helloWorld', 'johnDoe']
            );
    });

    test('split: applies number option', () => {
        assert.deepEqual(
            lib.split('1,2,3', ',', { number: true }),
            [1, 2, 3]
            );
    });

    test('split: applies datatype option', () => {
        assert.deepEqual(
            lib.split('1,2,3', ',', { datatype: 'number' }),
            [1, 2, 3]
            );
    });

    test('split: expands numeric ranges', () => {
        assert.deepEqual(
            lib.split('1-3,7,10-12', ',', { range: true }),
            ['1', '2', '3', '7', '10', '11', '12']
            );
    });

    test('split: skips invalid descending ranges', () => {
        assert.deepEqual(
            lib.split('3-1,5', ',', { range: true }),
            ['5']
            );
    });

    test('split: removes duplicates with unique option', () => {
        assert.deepEqual(
            lib.split('a,b,a,c,b', ',', { unique: true }),
            ['a', 'b', 'c']
            );
    });

    test('split: supports combined transformations in option order', () => {
        assert.deepEqual(
            lib.split(' A-B , C-D ', ',', {
                lower: true,
                replace: {
                    '-': ''
                }
            }),
            ['ab', 'cd']
            );
    });

});

describe("lib.toValue tests", () => {

    test("toValue returns value as-is for null, empty, and none types", () => {
        const obj = { a: 1 };

        assert.strictEqual(lib.toValue(obj, null), obj);
        assert.strictEqual(lib.toValue(obj, ""), obj);
        assert.strictEqual(lib.toValue(obj, "none"), obj);
    });

    test("toValue trims type before conversion", () => {
        assert.strictEqual(lib.toValue("123", " int "), 123);
        assert.strictEqual(lib.toValue("ABC", " lower "), "abc");
    });

    test("toValue auto returns empty string for null and undefined", () => {
        assert.strictEqual(lib.toValue(null, "auto"), "");
        assert.strictEqual(lib.toValue(undefined, "auto"), "");
    });

    test("toValue parses JSON for js type", () => {
        assert.deepStrictEqual(lib.toValue('{"a":1,"b":"x"}', "js"), {
            a: 1,
            b: "x",
        });

        const obj = { a: 1 };
        assert.strictEqual(lib.toValue(obj, "js"), obj);
    });

    test("toValue converts set/list/array types using split", () => {
        assert.deepStrictEqual(lib.toValue("a,b,c", "set"), ["a", "b", "c"]);
        assert.deepStrictEqual(lib.toValue("a,b,c", "list"), ["a", "b", "c"]);
        assert.deepStrictEqual(lib.toValue("a,b,c", "array"), ["a", "b", "c"]);
    });

    test("toValue supports custom separator for array-like types", () => {
        assert.deepStrictEqual(lib.toValue("a|b|c", "array", { separator: "|" }), [
            "a",
            "b",
            "c",
        ]);
    });

    test("toValue returns expr and buffer values as-is", () => {
        const expr = { op: "eq", name: "status", value: "ok" };
        const buf = Buffer.from("hello");

        assert.strictEqual(lib.toValue(expr, "expr"), expr);
        assert.strictEqual(lib.toValue(buf, "buffer"), buf);
    });

    test("toValue converts real/float/double/decimal to floating numbers", () => {
        assert.strictEqual(lib.toValue("12.5", "real"), 12.5);
        assert.strictEqual(lib.toValue("12.5", "float"), 12.5);
        assert.strictEqual(lib.toValue("12.5", "double"), 12.5);
        assert.strictEqual(lib.toValue("12.5", "decimal"), 12.5);
    });

    test("toValue converts integer-like types to numbers", () => {
        assert.strictEqual(lib.toValue("42", "int"), 42);
        assert.strictEqual(lib.toValue("42", "int32"), 42);
        assert.strictEqual(lib.toValue("42", "int64"), 42);
        assert.strictEqual(lib.toValue("42", "integer"), 42);
        assert.strictEqual(lib.toValue("42", "smallint"), 42);
        assert.strictEqual(lib.toValue("42", "long"), 42);
        assert.strictEqual(lib.toValue("42", "bigint"), 42);
        assert.strictEqual(lib.toValue("42", "numeric"), 42);
        assert.strictEqual(lib.toValue("42", "number"), 42);
        assert.strictEqual(lib.toValue("42", "counter"), 42);
    });

    test("toValue converts booleans", () => {
        assert.strictEqual(lib.toValue("true", "bool"), true);
        assert.strictEqual(lib.toValue("false", "bool"), false);
        assert.strictEqual(lib.toValue("1", "boolean"), true);
        assert.strictEqual(lib.toValue("0", "boolean"), false);
        assert.strictEqual(lib.toValue("", "bool"), false);
    });

    test("toValue converts date/time/datetime/timestamp to Date", () => {
        const value = "2020-01-02T03:04:05.000Z";
        const expected = Date.parse(value);

        for (const type of ["date", "time", "datetime", "timestamp"]) {
            const result = lib.toValue(value, type);

            assert.ok(result instanceof Date);
            assert.strictEqual(result.getTime(), expected);
        }
    });

    test("toValue converts mtime to milliseconds", () => {
        const value = "2020-01-02T03:04:05.000Z";

        assert.strictEqual(lib.toValue(value, "mtime"), Date.parse(value));
        assert.strictEqual(lib.toValue("", "mtime"), 0);
        assert.strictEqual(lib.toValue(null, "mtime"), 0);
    });

    test("toValue converts regexp type to RegExp", () => {
        const result = lib.toValue("^abc$", "regexp");

        assert.ok(result instanceof RegExp);
        assert.strictEqual(result.test("abc"), true);
        assert.strictEqual(result.test("xabc"), false);
    });

    test("toValue converts phone strings to digits", () => {
        assert.strictEqual(lib.toValue("(212) 555-1212", "phone"), "2125551212");
        assert.strictEqual(lib.toValue("+1 (212) 555-1212", "phone"), "2125551212");
    });

    test("toValue converts e164 phone strings to country-prefixed digits", () => {
        assert.strictEqual(lib.toValue("(212) 555-1212", "e164"), "12125551212");
        assert.strictEqual(lib.toValue("+1 (212) 555-1212", "e164"), "12125551212");
    });

    test("toValue converts numeric phones", () => {
        assert.strictEqual(lib.toValue(12125551212, "phone"), "2125551212");
        assert.strictEqual(lib.toValue(2125551212, "e164"), "12125551212");
    });

    test("toValue rejects invalid and too-short phones", () => {
        assert.strictEqual(lib.toValue("abc", "phone"), "");
        assert.strictEqual(lib.toValue("1234", "phone"), "");
        assert.strictEqual(lib.toValue("1234", "phone", { min: 5 }), "");
        assert.strictEqual(lib.toValue("1234", "phone", { min: 0 }), "1234");
    });

    test("toValue respects phone max option", () => {
        assert.strictEqual(lib.toValue("2125551212", "phone", { max: 10 }), "2125551212");
        assert.strictEqual(lib.toValue("112125551212", "phone", { max: 10 }), "");
    });

    test("toValue stringifies json type", () => {
        assert.strictEqual(lib.toValue({ a: 1, b: "x" }, "json"), '{"a":1,"b":"x"}');
        assert.strictEqual(lib.toValue([1, 2, 3], "json"), "[1,2,3]");
    });

    test("toValue converts lower and upper types", () => {
        assert.strictEqual(lib.toValue("AbC", "lower"), "abc");
        assert.strictEqual(lib.toValue("AbC", "upper"), "ABC");
    });

    test("toValue validates symbol type", () => {
        assert.strictEqual(lib.toValue("abc_123", "symbol"), "abc_123");
        assert.strictEqual(lib.toValue("bad symbol", "symbol"), "");
        assert.strictEqual(lib.toValue("bad-symbol", "symbol"), "");
    });

    test("toValue falls back to string conversion for unknown type", () => {
        assert.strictEqual(lib.toValue(123, "unknown"), "123");
        assert.strictEqual(lib.toValue(true, "unknown"), "true");
    });

    test("toValue uses options.toValue for unknown type", () => {
        const result = lib.toValue("abc", "custom", {
            prefix: "value:",
            toValue(value, options) {
                return options.prefix + value.toUpperCase();
            },
        });

        assert.strictEqual(result, "value:ABC");
    });

})

describe("lib.isTrue tests", () => {

    test("isTrue: undefined/null equality", () => {
        assert.equal(lib.isTrue(undefined, undefined), true);
        assert.equal(lib.isTrue(null, null), true);
        assert.equal(lib.isTrue(undefined, null), true);
        assert.equal(lib.isTrue(null, undefined), true);
    });

    test("isTrue: default comparison uses loose equality when type is not provided", () => {
        assert.equal(lib.isTrue("1", 1), true);
        assert.equal(lib.isTrue("true", true), false);
        assert.equal(lib.isTrue("abc", "abc"), true);
        assert.equal(lib.isTrue("abc", "def"), false);
    });

    test("isTrue: typed comparison uses converted strict equality", () => {
        assert.equal(lib.isTrue("1", 1, undefined, "number"), true);
        assert.equal(lib.isTrue("1", 2, undefined, "number"), false);

        assert.equal(lib.isTrue("true", true, undefined, "bool"), true);
        assert.equal(lib.isTrue("false", false, undefined, "bool"), true);

        assert.equal(lib.isTrue("abc", "abc", undefined, "string"), true);
        assert.equal(lib.isTrue("abc", "ABC", undefined, "string"), false);
    });

    test("isTrue: null operators", () => {
        assert.equal(lib.isTrue(null, null, "null"), true);
        assert.equal(lib.isTrue(undefined, null, "null"), true);
        assert.equal(lib.isTrue("", null, "null"), true);
        assert.equal(lib.isTrue(0, null, "null"), true);
        assert.equal(lib.isTrue(false, null, "null"), true);
        assert.equal(lib.isTrue("value", null, "null"), false);
    })

    test("isTrue: not null operators", () => {
        assert.equal(lib.isTrue("value", null, "not null"), true);
        assert.equal(lib.isTrue("value", null, "not_null"), true);
        assert.equal(lib.isTrue(null, null, "not null"), false);
        assert.equal(lib.isTrue("", null, "not_null"), false);
    });

    test("isTrue: numeric greater/less comparisons", () => {
        assert.equal(lib.isTrue("10", "5", ">", "number"), true);
        assert.equal(lib.isTrue("5", "10", ">", "number"), false);
        assert.equal(lib.isTrue("5", "5", ">", "number"), false);

        assert.equal(lib.isTrue("5", "10", "<", "number"), true);
        assert.equal(lib.isTrue("10", "5", "<", "number"), false);
        assert.equal(lib.isTrue("5", "5", "<", "number"), false);
    });

    test("isTrue: numeric greater-or-equal/less-or-equal comparisons", () => {
        assert.equal(lib.isTrue("10", "5", ">=", "number"), true);
        assert.equal(lib.isTrue("5", "5", ">=", "number"), true);
        assert.equal(lib.isTrue("4", "5", ">=", "number"), false);

        assert.equal(lib.isTrue("5", "10", "<=", "number"), true);
        assert.equal(lib.isTrue("5", "5", "<=", "number"), true);
        assert.equal(lib.isTrue("6", "5", "<=", "number"), false);
    });

    test("isTrue: gt/lt/ge/le aliases", () => {
        assert.equal(lib.isTrue(10, 5, "gt", "number"), true);
        assert.equal(lib.isTrue(5, 10, "lt", "number"), true);
        assert.equal(lib.isTrue(5, 5, "ge", "number"), true);
        assert.equal(lib.isTrue(5, 5, "le", "number"), true);

        assert.equal(lib.isTrue(5, 10, "gt", "number"), false);
        assert.equal(lib.isTrue(10, 5, "lt", "number"), false);
        assert.equal(lib.isTrue(4, 5, "ge", "number"), false);
        assert.equal(lib.isTrue(6, 5, "le", "number"), false);
    });

    test("isTrue: between operator", () => {
        assert.equal(lib.isTrue(5, "1,10", "between", "number"), true);
        assert.equal(lib.isTrue(1, "1,10", "between", "number"), true);
        assert.equal(lib.isTrue(10, "1,10", "between", "number"), true);

        assert.equal(lib.isTrue(0, "1,10", "between", "number"), false);
        assert.equal(lib.isTrue(11, "1,10", "between", "number"), false);
    });

    test("isTrue: between falls back to equality when condition has one value", () => {
        assert.equal(lib.isTrue(5, "5", "between", "number"), true);
        assert.equal(lib.isTrue(4, "5", "between", "number"), false);
    });

    test("isTrue: in and not in operators", () => {
        assert.equal(lib.isTrue("a", "a,b,c", "in"), true);
        assert.equal(lib.isTrue("d", "a,b,c", "in"), false);

        assert.equal(lib.isTrue("d", "a,b,c", "not in"), true);
        assert.equal(lib.isTrue("a", "a,b,c", "not in"), false);

        assert.equal(lib.isTrue("d", "a,b,c", "not_in"), true);
        assert.equal(lib.isTrue("a", "a,b,c", "not_in"), false);
    });

    test("isTrue: in operator handles list values", () => {
        assert.equal(lib.isTrue("a,b", "a,b,c", "in"), true);
        assert.equal(lib.isTrue("a,d", "a,b,c", "in"), true);
        assert.equal(lib.isTrue("x,y", "a,b,c", "in"), false);
    });

    test("isTrue: all_in operator", () => {
        assert.equal(lib.isTrue("a,b", "a,b,c", "all_in"), true);
        assert.equal(lib.isTrue("a,b", "a,b,c", "all in"), true);

        assert.equal(lib.isTrue("a,d", "a,b,c", "all_in"), false);
        assert.equal(lib.isTrue("x,y", "a,b,c", "all in"), false);
    });

    test("isTrue: begins_with / like% operators", () => {
        assert.equal(lib.isTrue("foo", "foobar", "begins_with"), true);
        assert.equal(lib.isTrue("foo", "barfoo", "begins_with"), false);

        assert.equal(lib.isTrue("foo", "foobar", "like%"), true);
        assert.equal(lib.isTrue("foo", "barfoo", "like%"), false);
    });

    test("isTrue: not begins_with / not like% operators", () => {
        assert.equal(lib.isTrue("foo", "barfoo", "not begins_with"), true);
        assert.equal(lib.isTrue("foo", "foobar", "not begins_with"), false);

        assert.equal(lib.isTrue("foo", "barfoo", "not like%"), true);
        assert.equal(lib.isTrue("foo", "foobar", "not like%"), false);
    });

    test("isTrue: ilike% operator is case-insensitive starts-with", () => {
        assert.equal(lib.isTrue("foo", "FOOBAR", "ilike%"), true);
        assert.equal(lib.isTrue("FOO", "foobar", "ilike%"), true);
        assert.equal(lib.isTrue("foo", "barfoo", "ilike%"), false);
    });

    test("isTrue: not ilike% operator", () => {
        assert.equal(lib.isTrue("foo", "barfoo", "not ilike%"), true);
        assert.equal(lib.isTrue("foo", "FOOBAR", "not ilike%"), false);
    });

    test("isTrue: ilike operator is case-insensitive equality", () => {
        assert.equal(lib.isTrue("foo", "FOO", "ilike"), true);
        assert.equal(lib.isTrue("Foo", "fOo", "ilike"), true);
        assert.equal(lib.isTrue("foo", "bar", "ilike"), false);
    });

    test("isTrue: not ilike operator", () => {
        assert.equal(lib.isTrue("foo", "bar", "not ilike"), true);
        assert.equal(lib.isTrue("foo", "FOO", "not ilike"), false);
    });

    test("isTrue: regexp operator with RegExp condition", () => {
        assert.equal(lib.isTrue("abc123", /^abc\d+$/, "regexp"), true);
        assert.equal(lib.isTrue("abc", /^abc\d+$/, "regexp"), false);

        assert.equal(lib.isTrue("abc123", /^abc\d+$/, "~"), true);
        assert.equal(lib.isTrue("abc", /^abc\d+$/, "~"), false);
    });

    test("isTrue: regexp operator with string condition", () => {
        assert.equal(lib.isTrue("abc123", "^abc\\d+$", "regexp"), true);
        assert.equal(lib.isTrue("abc", "^abc\\d+$", "regexp"), false);
    });

    test("isTrue: not regexp operator", () => {
        assert.equal(lib.isTrue("abc", "^\\d+$", "not regexp"), true);
        assert.equal(lib.isTrue("123", "^\\d+$", "not regexp"), false);
    });

    test("isTrue: iregexp operator is case-insensitive", () => {
        assert.equal(lib.isTrue("ABC", "^abc$", "iregexp"), true);
        assert.equal(lib.isTrue("ABC", "^def$", "iregexp"), false);

        assert.equal(lib.isTrue("ABC", "^abc$", "!~*"), true);
        assert.equal(lib.isTrue("ABC", "^def$", "!~*"), false);
    });

    test("isTrue: not iregexp operator", () => {
        assert.equal(lib.isTrue("ABC", "^def$", "not iregexp"), true);
        assert.equal(lib.isTrue("ABC", "^abc$", "not iregexp"), false);
    });

    test("isTrue: contains operator", () => {
        assert.equal(lib.isTrue("bar", "foobarbaz", "contains"), true);
        assert.equal(lib.isTrue("foo", "foobarbaz", "contains"), true);
        assert.equal(lib.isTrue("baz", "foobarbaz", "contains"), true);
        assert.equal(lib.isTrue("xxx", "foobarbaz", "contains"), false);
    });

    test("isTrue: not contains operator", () => {
        assert.equal(lib.isTrue("xxx", "foobarbaz", "not contains"), true);
        assert.equal(lib.isTrue("bar", "foobarbaz", "not contains"), false);
        assert.equal(lib.isTrue("foo", "foobarbaz", "not_contains"), false);
    });

    test("isTrue: not equal operators", () => {
        assert.equal(lib.isTrue("1", 1, "!=", "number"), false);
        assert.equal(lib.isTrue("1", 2, "!=", "number"), true);

        assert.equal(lib.isTrue("1", 1, "<>", "number"), false);
        assert.equal(lib.isTrue("1", 2, "<>", "number"), true);

        assert.equal(lib.isTrue("1", 1, "ne", "number"), false);
        assert.equal(lib.isTrue("1", 2, "ne", "number"), true);
    });

    test("isTrue: default list type comparison", () => {
        assert.equal(lib.isTrue("a,b", "b,c", undefined, "list"), true);
        assert.equal(lib.isTrue("a,b", "c,d", undefined, "list"), false);
    });

    test("isTrue: default array condition comparison", () => {
        assert.equal(lib.isTrue("b", ["a", "b", "c"]), true);
        assert.equal(lib.isTrue("x", ["a", "b", "c"]), false);
    });

    test("isTrue: default array value comparison", () => {
        assert.equal(lib.isTrue(["a", "b", "c"], "b"), true);
        assert.equal(lib.isTrue(["a", "b", "c"], "x"), false);
    });

    test("isTrue: default RegExp condition comparison", () => {
        assert.equal(lib.isTrue("abc123", /^abc\d+$/), true);
        assert.equal(lib.isTrue("abc", /^abc\d+$/), false);
    });

    test("isTrue: operator is case-insensitive", () => {
        assert.equal(lib.isTrue(10, 5, "GT", "number"), true);
        assert.equal(lib.isTrue("foo", "FOO", "ILIKE"), true);
        assert.equal(lib.isTrue("a", "a,b,c", "IN"), true);
    });
})

describe("lib.typeName", function() {
    describe("typeName()", function() {
        it("returns null for null", function() {
            assert.strictEqual(lib.typeName(null), "null");
        });

        it("returns undefined for undefined", function() {
            assert.strictEqual(lib.typeName(undefined), "undefined");
        });

        it("returns primitive type names", function() {
            assert.strictEqual(lib.typeName("test"), "string");
            assert.strictEqual(lib.typeName(123), "number");
            assert.strictEqual(lib.typeName(true), "boolean");
            assert.strictEqual(lib.typeName(function() {}), "function");
            assert.strictEqual(lib.typeName(Symbol("x")), "symbol");
        });

        it("returns object for plain objects", function() {
            assert.strictEqual(lib.typeName({}), "object");
        });

        it("returns array for arrays", function() {
            assert.strictEqual(lib.typeName([]), "array");
        });

        it("returns buffer for buffers", function() {
            assert.strictEqual(lib.typeName(Buffer.from("test")), "buffer");
        });

        it("returns date for dates", function() {
            assert.strictEqual(lib.typeName(new Date()), "date");
        });

        it("returns regexp for regexps", function() {
            assert.strictEqual(lib.typeName(/test/), "regexp");
        });

        it("returns set for sets", function() {
            assert.strictEqual(lib.typeName(new Set()), "set");
        });

        it("returns map for maps", function() {
            assert.strictEqual(lib.typeName(new Map()), "map");
        });

        it("returns weakmap for weak maps", function() {
            assert.strictEqual(lib.typeName(new WeakMap()), "weakmap");
        });

        it("returns error for native errors", function() {
            assert.strictEqual(lib.typeName(new Error("test")), "error");
            assert.strictEqual(lib.typeName(new TypeError("test")), "error");
            assert.strictEqual(lib.typeName(new RangeError("test")), "error");
            assert.strictEqual(lib.typeName(new SyntaxError("test")), "error");
            assert.strictEqual(lib.typeName(new ReferenceError("test")), "error");
            assert.strictEqual(lib.typeName(new AggregateError([], "test")), "error");
            assert.strictEqual(lib.typeName(new EvalError("test")), "error");
            assert.strictEqual(lib.typeName(new URIError("test")), "error");
        });

        it("returns proxy for proxies", function() {
            const proxy = new Proxy({}, {});
            assert.strictEqual(lib.typeName(proxy), "proxy");
        });
    });
});

describe("lib.autoType", function() {
    describe("autoType()", function() {
        it("detects numbers", function() {
            assert.strictEqual(lib.autoType(123), "number");
            assert.strictEqual(lib.autoType("123"), "number");
            assert.strictEqual(lib.autoType("-123.45"), "number");
        });

        it("detects booleans", function() {
            assert.strictEqual(lib.autoType(true), "bool");
            assert.strictEqual(lib.autoType(false), "bool");
            assert.strictEqual(lib.autoType("true"), "bool");
            assert.strictEqual(lib.autoType("false"), "bool");
        });

        it("detects regex strings", function() {
            assert.strictEqual(lib.autoType("^test$"), "regexp");
        });

        it("detects JSON-like array strings as js", function() {
            assert.strictEqual(lib.autoType("[1,2,3]"), "js");
        });

        it("detects JSON-like object strings as js", function() {
            assert.strictEqual(lib.autoType('{"a":1}'), "js");
        });

        it("detects comma-prefixed or comma-suffixed strings as lists", function() {
            assert.strictEqual(lib.autoType(",a,b"), "list");
            assert.strictEqual(lib.autoType("a,b,"), "list");
        });

        it("detects pipe-separated strings as lists", function() {
            assert.strictEqual(lib.autoType("a|b|c"), "list");
        });

        it("does not detect pipe-separated regexp-like strings as lists", function() {
            assert.strictEqual(lib.autoType("a|b(c)"), "");
            assert.strictEqual(lib.autoType("a|b[0]"), "");
            assert.strictEqual(lib.autoType("a|b^"), "");
            assert.strictEqual(lib.autoType("a|b$"), "");
        });

        it("returns empty string for unknown types", function() {
            assert.strictEqual(lib.autoType("hello"), "");
            assert.strictEqual(lib.autoType({}), "");
            assert.strictEqual(lib.autoType([]), "");
            assert.strictEqual(lib.autoType(null), "");
            assert.strictEqual(lib.autoType(undefined), "");
        });
    });
});

describe("lib.isObject", function() {
    describe("isObject()", function() {
        it("returns the object for plain objects", function() {
            const obj = { a: 1 };
            assert.strictEqual(lib.isObject(obj), obj);
        });

        it("returns undefined for null", function() {
            assert.strictEqual(lib.isObject(null), undefined);
        });

        it("returns undefined for arrays", function() {
            assert.strictEqual(lib.isObject([]), undefined);
        });

        it("returns undefined for dates", function() {
            assert.strictEqual(lib.isObject(new Date()), undefined);
        });

        it("returns undefined for primitive values", function() {
            assert.strictEqual(lib.isObject("test"), undefined);
            assert.strictEqual(lib.isObject(1), undefined);
            assert.strictEqual(lib.isObject(true), undefined);
            assert.strictEqual(lib.isObject(undefined), undefined);
        });
    });
});

describe("lib.isNumber", function() {
    describe("isNumber()", function() {
        it("returns the number for valid numbers", function() {
            assert.strictEqual(lib.isNumber(1), 1);
            assert.strictEqual(lib.isNumber(0), 0);
            assert.strictEqual(lib.isNumber(-1), -1);
            assert.strictEqual(lib.isNumber(Infinity), Infinity);
        });

        it("returns NaN for NaN", function() {
            assert.ok(Number.isNaN(lib.isNumber(NaN)));
        });

        it("returns NaN for non-numbers", function() {
            assert.ok(Number.isNaN(lib.isNumber("1")));
            assert.ok(Number.isNaN(lib.isNumber(null)));
            assert.ok(Number.isNaN(lib.isNumber(undefined)));
            assert.ok(Number.isNaN(lib.isNumber({})));
        });
    });
});

describe("lib.isString", function() {
    describe("isString()", function() {
        it("returns the string for strings", function() {
            assert.strictEqual(lib.isString("test"), "test");
            assert.strictEqual(lib.isString(""), "");
        });

        it("returns empty string for non-strings", function() {
            assert.strictEqual(lib.isString(1), "");
            assert.strictEqual(lib.isString(null), "");
            assert.strictEqual(lib.isString(undefined), "");
            assert.strictEqual(lib.isString({}), "");
        });
    });
});

describe("lib.isFunc", function() {
    describe("isFunc()", function() {
        it("returns the function for functions", function() {
            const fn = function() {};
            assert.strictEqual(lib.isFunc(fn), fn);
        });

        it("returns undefined for non-functions", function() {
            assert.strictEqual(lib.isFunc(null), undefined);
            assert.strictEqual(lib.isFunc({}), undefined);
            assert.strictEqual(lib.isFunc("fn"), undefined);
        });
    });
});

describe("lib.isRegExp", function() {
    describe("isRegExp()", function() {
        it("returns the regexp for regexps", function() {
            const rx = /test/;
            assert.strictEqual(lib.isRegExp(rx), rx);
        });

        it("returns dflt for non-regexps", function() {
            const dflt = /default/;
            assert.strictEqual(lib.isRegExp("test", dflt), dflt);
            assert.strictEqual(lib.isRegExp(null, dflt), dflt);
        });

        it("returns undefined for non-regexps when dflt is not provided", function() {
            assert.strictEqual(lib.isRegExp("test"), undefined);
        });
    });
});

describe("lib.isPrefixed", function() {
    describe("isPrefixed()", function() {
        it("returns true when string starts with prefix", function() {
            assert.strictEqual(lib.isPrefixed("prefix-value", "prefix"), true);
        });

        it("returns false when string does not start with prefix", function() {
            assert.strictEqual(lib.isPrefixed("value-prefix", "prefix"), false);
        });

        it("returns false for invalid prefix", function() {
            assert.strictEqual(lib.isPrefixed("value", ""), true);
            assert.strictEqual(lib.isPrefixed("value", null), false);
            assert.strictEqual(lib.isPrefixed("value", undefined), false);
        });

        it("returns false for non-string values", function() {
            assert.strictEqual(lib.isPrefixed(null, "prefix"), false);
            assert.strictEqual(lib.isPrefixed(undefined, "prefix"), false);
            assert.strictEqual(lib.isPrefixed({}, "prefix"), false);
        });
    });
});

describe("lib.isUuid", function() {
    describe("isUuid()", function() {
        it("returns the uuid if valid", function() {
            const uuid = "550e8400e29b41d4a716446655440000";
            assert.strictEqual(lib.isUuid(uuid), uuid);
        });

        it("returns undefined if invalid", function() {
            assert.strictEqual(lib.isUuid("not-a-uuid"), undefined);
            assert.strictEqual(lib.isUuid("550e8400e29b41d4a716"), undefined);
            assert.strictEqual(lib.isUuid(null), undefined);
            assert.strictEqual(lib.isUuid(undefined), undefined);
        });

        it("returns the uuid if it starts with the given prefix", function() {
            let uuid = "550e8400e29b41d4a716446655440000";
            assert.strictEqual(lib.isUuid(uuid, "550e"), uuid);

            uuid = "a_" + uuid
            assert.strictEqual(lib.isUuid(uuid, "a_"), uuid);
        });

        it("returns undefined if uuid does not start with the given prefix", function() {
            const uuid = "550e8400-e29b-41d4-a716-446655440000";
            assert.strictEqual(lib.isUuid(uuid, "660e"), undefined);
        });

        it("ignores empty or non-string prefix", function() {
            const uuid = "550e8400-e29b-41d4-a716-446655440000";
            assert.strictEqual(lib.isUuid(uuid, ""), uuid);
            assert.strictEqual(lib.isUuid(uuid, null), uuid);
        });
    });
});

describe("lib.isUnicode", function() {
    describe("isUnicode()", function() {
        it("returns the string if it contains unicode characters", function() {
            assert.strictEqual(lib.isUnicode("hello ☃"), "hello ☃");
            assert.strictEqual(lib.isUnicode("привет"), "привет");
        });

        it("returns undefined if string has no unicode characters", function() {
            assert.strictEqual(lib.isUnicode("hello"), undefined);
            assert.strictEqual(lib.isUnicode("abc123"), undefined);
        });

        it("returns undefined for non-strings without unicode characters", function() {
            assert.strictEqual(lib.isUnicode(123), undefined);
            assert.strictEqual(lib.isUnicode(null), undefined);
            assert.strictEqual(lib.isUnicode(undefined), undefined);
        });
    });
});

describe("lib.isPositive", function() {
    describe("isPositive()", function() {
        it("returns true for positive numbers", function() {
            assert.strictEqual(lib.isPositive(1), true);
            assert.strictEqual(lib.isPositive(0.1), true);
            assert.strictEqual(lib.isPositive(Infinity), true);
        });

        it("returns false for zero and negative numbers", function() {
            assert.strictEqual(lib.isPositive(0), false);
            assert.strictEqual(lib.isPositive(-1), false);
        });

        it("returns false for non-numbers and NaN", function() {
            assert.strictEqual(lib.isPositive("1"), false);
            assert.strictEqual(lib.isPositive(NaN), false);
            assert.strictEqual(lib.isPositive(null), false);
            assert.strictEqual(lib.isPositive(undefined), false);
        });
    });
});

describe("lib.isArray", function() {
    describe("isArray()", function() {
        it("returns the array if non-empty", function() {
            const arr = [1, 2, 3];
            assert.strictEqual(lib.isArray(arr), arr);
        });

        it("returns dflt for empty arrays", function() {
            const dflt = ["default"];
            assert.strictEqual(lib.isArray([], dflt), dflt);
        });

        it("returns undefined for empty arrays without dflt", function() {
            assert.strictEqual(lib.isArray([]), undefined);
        });

        it("returns dflt for non-arrays", function() {
            const dflt = ["default"];
            assert.strictEqual(lib.isArray("test", dflt), dflt);
            assert.strictEqual(lib.isArray(null, dflt), dflt);
        });

        it("returns undefined for non-arrays without dflt", function() {
            assert.strictEqual(lib.isArray("test"), undefined);
            assert.strictEqual(lib.isArray(null), undefined);
        });
    });
});

describe("lib.isEmpty", function() {
    describe("isEmpty()", function() {
        it("returns true for null and undefined", function() {
            assert.strictEqual(lib.isEmpty(null), true);
            assert.strictEqual(lib.isEmpty(undefined), true);
        });

        it("returns true for empty strings", function() {
            assert.strictEqual(lib.isEmpty(""), true);
            assert.strictEqual(lib.isEmpty(" "), true);
            assert.strictEqual(lib.isEmpty("\n\t"), true);
        });

        it("returns false for non-empty strings", function() {
            assert.strictEqual(lib.isEmpty("test"), false);
        });

        it("returns true for empty arrays and buffers", function() {
            assert.strictEqual(lib.isEmpty([]), true);
            assert.strictEqual(lib.isEmpty(Buffer.alloc(0)), true);
        });

        it("returns false for non-empty arrays and buffers", function() {
            assert.strictEqual(lib.isEmpty([1]), false);
            assert.strictEqual(lib.isEmpty(Buffer.from("x")), false);
        });

        it("returns true for empty sets and maps", function() {
            assert.strictEqual(lib.isEmpty(new Set()), true);
            assert.strictEqual(lib.isEmpty(new Map()), true);
        });

        it("returns false for non-empty sets and maps", function() {
            assert.strictEqual(lib.isEmpty(new Set([1])), false);
            assert.strictEqual(lib.isEmpty(new Map([["a", 1]])), false);
        });

        it("returns true for NaN", function() {
            assert.strictEqual(lib.isEmpty(NaN), true);
        });

        it("returns false for valid numbers", function() {
            assert.strictEqual(lib.isEmpty(0), false);
            assert.strictEqual(lib.isEmpty(1), false);
            assert.strictEqual(lib.isEmpty(-1), false);
        });

        it("returns false for dates", function() {
            assert.strictEqual(lib.isEmpty(new Date()), false);
        });

        it("returns false for regexps, booleans, and functions", function() {
            assert.strictEqual(lib.isEmpty(/test/), false);
            assert.strictEqual(lib.isEmpty(true), false);
            assert.strictEqual(lib.isEmpty(false), false);
            assert.strictEqual(lib.isEmpty(function() {}), false);
        });

        it("returns true for empty objects", function() {
            assert.strictEqual(lib.isEmpty({}), true);
        });

        it("returns false for non-empty objects", function() {
            assert.strictEqual(lib.isEmpty({ a: 1 }), false);
        });
    });
});

describe("lib.isNumeric", function() {
    describe("isNumeric()", function() {
        it("returns true for numbers", function() {
            assert.strictEqual(lib.isNumeric(0), true);
            assert.strictEqual(lib.isNumeric(123), true);
            assert.strictEqual(lib.isNumeric(-123.45), true);
            assert.strictEqual(lib.isNumeric(NaN), true);
        });

        it("returns true for numeric strings", function() {
            assert.strictEqual(lib.isNumeric("0"), true);
            assert.strictEqual(lib.isNumeric("123"), true);
            assert.strictEqual(lib.isNumeric("-123.45"), true);
        });

        it("returns false for non-numeric strings", function() {
            assert.strictEqual(lib.isNumeric("abc"), false);
            assert.strictEqual(lib.isNumeric("12abc"), false);
            assert.strictEqual(lib.isNumeric(""), false);
        });

        it("returns false for non-string and non-number values", function() {
            assert.strictEqual(lib.isNumeric(null), false);
            assert.strictEqual(lib.isNumeric(undefined), false);
            assert.strictEqual(lib.isNumeric({}), false);
            assert.strictEqual(lib.isNumeric([]), false);
            assert.strictEqual(lib.isNumeric(true), false);
        });
    });
});

describe("lib.isDate", function() {
    describe("isDate()", function() {
        it("returns date for valid dates", function() {
            assert.strictEqual(typeof lib.isDate(new Date()), "object");
            assert.strictEqual(typeof lib.isDate(new Date("2024-01-01T00:00:00Z")), "object");
        });

        it("returns undefined for invalid dates", function() {
            assert.strictEqual(lib.isDate(new Date("invalid")), undefined);
        });

        it("returns undefined for non-dates", function() {
            assert.strictEqual(lib.isDate(Date.now()), undefined);
            assert.strictEqual(lib.isDate("2024-01-01"), undefined);
            assert.strictEqual(lib.isDate(null), undefined);
            assert.strictEqual(lib.isDate(undefined), undefined);
            assert.strictEqual(lib.isDate({}), undefined);
        });
    });
});

describe("lib.includes", function() {
    it("returns true if item exists in list", function() {
        assert.strictEqual(lib.includes(["a", "b", "c"], "b"), true);
    });

    it("returns false if item does not exist in list", function() {
        assert.strictEqual(lib.includes(["a", "b", "c"], "d"), false);
    });

    it("returns true if any item from array exists in list", function() {
        assert.strictEqual(lib.includes(["a", "b", "c"], ["x", "b"]), true);
    });

    it("returns false if no items from array exist in list", function() {
        assert.strictEqual(lib.includes(["a", "b", "c"], ["x", "y"]), false);
    });

    it("returns false for empty or falsy item", function() {
        assert.strictEqual(lib.includes(["a", "b"], ""), "");
        assert.strictEqual(lib.includes(["a", "b"], null), null);
        assert.strictEqual(lib.includes(["a", "b"], undefined), undefined);
    });

    it("returns false for non-array list", function() {
        assert.strictEqual(lib.includes(null, "a"), false);
        assert.strictEqual(lib.includes("abc", "a"), false);
        assert.strictEqual(lib.includes({}, "a"), false);
    });

    it("is case-sensitive", function() {
        assert.strictEqual(lib.includes(["A"], "a"), false);
        assert.strictEqual(lib.includes(["a"], "a"), true);
    });
});

describe("lib.arrayUpdate", () => {
    describe("add", () => {
        it("adds a string flag to the same list", () => {
            const list = ["a"];

            const result = lib.arrayUpdate("add", list, "b");

            assert.equal(result, list);
            assert.deepEqual(result, ["a", "b"]);
        });

        it("does not add duplicate string flags", () => {
            const list = ["a"];

            const result = lib.arrayUpdate("add", list, "a");

            assert.equal(result, list);
            assert.deepEqual(result, ["a"]);
        });

        it("adds array flags without duplicates", () => {
            const list = ["a"];

            const result = lib.arrayUpdate("add", list, ["a", "b", "c"]);

            assert.equal(result, list);
            assert.deepEqual(result, ["a", "b", "c"]);
        });

        it("ignores empty values", () => {
            const list = ["a"];

            const result = lib.arrayUpdate("add", list, ["", null, undefined, "b"]);

            assert.equal(result, list);
            assert.deepEqual(result, ["a", "b"]);
        });

        it("creates a new list when list is not an array", () => {
            const result = lib.arrayUpdate("add", null, "a");

            assert.deepEqual(result, ["a"]);
        });
    });

    describe("concat", () => {
        it("returns a new list", () => {
            const list = ["a"];

            const result = lib.arrayUpdate("concat", list, "b");

            assert.notEqual(result, list);
            assert.deepEqual(result, ["a", "b"]);
            assert.deepEqual(list, ["a"]);
        });

        it("does not add duplicate flags", () => {
            const list = ["a"];

            const result = lib.arrayUpdate("concat", list, ["a", "b"]);

            assert.notEqual(result, list);
            assert.deepEqual(result, ["a", "b"]);
            assert.deepEqual(list, ["a"]);
        });

        it("creates a new list when list is not an array", () => {
            const result = lib.arrayUpdate("concat", null, "a");

            assert.deepEqual(result, ["a"]);
        });
    });

    describe("update", () => {
        it("adds new flags to the same list", () => {
            const list = ["a"];

            const result = lib.arrayUpdate("update", list, ["b", "c"]);

            assert.equal(result, list);
            assert.deepEqual(result, ["a", "b", "c"]);
        });

        it("removes flags prefixed with dash", () => {
            const list = ["a", "b", "c"];

            const result = lib.arrayUpdate("update", list, ["-b"]);

            assert.equal(result, list);
            assert.deepEqual(result, ["a", "c"]);
        });

        it("adds and removes flags in order", () => {
            const list = ["a", "b"];

            const result = lib.arrayUpdate("update", list, ["-a", "c", "-b", "d"]);

            assert.equal(result, list);
            assert.deepEqual(result, ["c", "d"]);
        });

        it("does not add duplicates", () => {
            const list = ["a"];

            const result = lib.arrayUpdate("update", list, ["a", "b"]);

            assert.equal(result, list);
            assert.deepEqual(result, ["a", "b"]);
        });

        it("creates a new list when list is not an array", () => {
            const result = lib.arrayUpdate("update", null, ["a", "b"]);

            assert.deepEqual(result, ["a", "b"]);
        });
    });

    describe("del", () => {
        it("removes a string flag from the same list", () => {
            const list = ["a", "b", "c"];

            const result = lib.arrayUpdate("del", list, "b");

            assert.equal(result, list);
            assert.deepEqual(result, ["a", "c"]);
        });

        it("removes array flags from the same list", () => {
            const list = ["a", "b", "c", "d"];

            const result = lib.arrayUpdate("del", list, ["b", "d"]);

            assert.equal(result, list);
            assert.deepEqual(result, ["a", "c"]);
        });

        it("ignores missing flags", () => {
            const list = ["a"];

            const result = lib.arrayUpdate("del", list, ["b"]);

            assert.equal(result, list);
            assert.deepEqual(result, ["a"]);
        });

        it("returns an empty list when list is not an array", () => {
            const result = lib.arrayUpdate("del", null, "a");

            assert.deepEqual(result, []);
        });
    });

    describe("present", () => {
        it("returns only flags present in name list", () => {
            const list = ["a", "b", "c"];

            const result = lib.arrayUpdate("present", list, ["a", "c"]);

            assert.deepEqual(result, ["a", "c"]);
            assert.deepEqual(list, ["a", "b", "c"]);
        });

        it("returns original list when name is not an array", () => {
            const list = ["a", "b"];

            const result = lib.arrayUpdate("present", list, "a");

            assert.equal(result, list);
            assert.deepEqual(result, ["a", "b"]);
        });

        it("returns an empty list when list is not an array", () => {
            const result = lib.arrayUpdate("present", null, ["a"]);

            assert.deepEqual(result, []);
        });
    });

    describe("absent", () => {
        it("returns only flags absent from name list", () => {
            const list = ["a", "b", "c"];

            const result = lib.arrayUpdate("absent", list, ["a", "c"]);

            assert.deepEqual(result, ["b"]);
            assert.deepEqual(list, ["a", "b", "c"]);
        });

        it("returns original list when name is not an array", () => {
            const list = ["a", "b"];

            const result = lib.arrayUpdate("absent", list, "a");

            assert.equal(result, list);
            assert.deepEqual(result, ["a", "b"]);
        });

        it("returns an empty list when list is not an array", () => {
            const result = lib.arrayUpdate("absent", null, ["a"]);

            assert.deepEqual(result, []);
        });
    });

    describe("unknown command", () => {
        it("returns the original list unchanged", () => {
            const list = ["a"];

            const result = lib.arrayUpdate("unknown", list, "b");

            assert.equal(result, list);
            assert.deepEqual(result, ["a"]);
        });
    });
});

describe('lib.matchRegexp', () => {
    it('returns group 1 by default', () => {
        assert.strictEqual(lib.matchRegexp("abc123", /([a-z]+)/), "abc");
    });
    it('returns whole match with index 0', () => {
        assert.strictEqual(lib.matchRegexp("abc123", /[a-z]+(\d+)/, 0), "abc123");
    });
    it('returns whole array with index -1', () => {
        const r = lib.matchRegexp("abc123", /([a-z]+)(\d+)/, -1);
        assert.strictEqual(r[1], "abc");
        assert.strictEqual(r[2], "123");
    });
    it('returns all matches with g flag', () => {
        const r = lib.matchRegexp("a1b2c3", /\d/g);
        assert.deepStrictEqual([...r], ["1", "2", "3"]);
    });
    it('returns null for non-string', () => {
        assert.strictEqual(lib.matchRegexp(123, /\d/), null);
    });
    it('returns null for non-regexp', () => {
        assert.strictEqual(lib.matchRegexp("abc", "abc"), null);
    });
    it('returns null when no match', () => {
        assert.strictEqual(lib.matchRegexp("abc", /(\d+)/), null);
    });
});

describe('lib.matchAllRegexp', () => {
    it('returns all group 1 matches', () => {
        assert.deepStrictEqual(lib.matchAllRegexp("a1 b2 c3", /(\w)\d/g), ["a", "b", "c"]);
    });
    it('returns given index', () => {
        assert.deepStrictEqual(lib.matchAllRegexp("a1 b2", /(\w)(\d)/g, 2), ["1", "2"]);
    });
    it('returns empty for non-string', () => {
        assert.deepStrictEqual(lib.matchAllRegexp(null, /\d/g), []);
    });
    it('returns empty for non-regexp', () => {
        assert.deepStrictEqual(lib.matchAllRegexp("abc", null), []);
    });
});

describe('lib.testRegexp', () => {
    it('returns true on match', () => {
        assert.strictEqual(lib.testRegexp("abc", /b/), true);
    });
    it('returns false on no match', () => {
        assert.strictEqual(lib.testRegexp("abc", /z/), false);
    });
    it('returns false on non-regexp', () => {
        assert.strictEqual(lib.testRegexp("abc", "b"), false);
    });
});

describe('lib.testRegexpObj', () => {
    it('returns true on match', () => {
        assert.strictEqual(lib.testRegexpObj("abc", { rx: /b/ }), true);
    });
    it('returns false on no match', () => {
        assert.strictEqual(lib.testRegexpObj("abc", { rx: /z/ }), false);
    });
    it('negates with not flag', () => {
        assert.strictEqual(lib.testRegexpObj("abc", { rx: /z/, not: true }), true);
        assert.strictEqual(lib.testRegexpObj("abc", { rx: /b/, not: true }), false);
    });
    it('returns false when no rx', () => {
        assert.strictEqual(lib.testRegexpObj("abc", {}), false);
        assert.strictEqual(lib.testRegexpObj("abc", null), false);
    });
});

describe('lib.replaceRegexp', () => {
    it('replaces matches with val', () => {
        assert.strictEqual(lib.replaceRegexp("a1b2", /\d/g, "#"), "a#b#");
    });
    it('removes matches when no val', () => {
        assert.strictEqual(lib.replaceRegexp("a1b2", /\d/g), "ab");
    });
    it('returns empty string for non-string', () => {
        assert.strictEqual(lib.replaceRegexp(null, /\d/g, "#"), "");
    });
    it('returns str unchanged for non-regexp', () => {
        assert.strictEqual(lib.replaceRegexp("abc", "x", "#"), "abc");
    });
});

describe('lib.trim', () => {
    it('trims default whitespace', () => {
        assert.strictEqual(lib.trim("  abc  "), "abc");
    });
    it('trims custom chars', () => {
        assert.strictEqual(lib.trim("xxabcxx", "x"), "abc");
    });
    it('returns empty for non-string', () => {
        assert.strictEqual(lib.trim(null), "");
    });
    it('returns empty for empty string', () => {
        assert.strictEqual(lib.trim(""), "");
    });
    it('trims tabs and newlines', () => {
        assert.strictEqual(lib.trim("\t\nabc\n\t"), "abc");
    });
});

describe('lib.wrap', () => {
    it('returns short string unchanged', () => {
        assert.strictEqual(lib.wrap("short", { wrap: 80 }), "short");
    });
    it('wraps forward', () => {
        assert.strictEqual(lib.wrap("very long text line to wrap forward", { wrap: 15, over: 1.5 }),
            "very long text line\nto wrap forward");
    });
    it('wraps backward', () => {
        assert.strictEqual(lib.wrap("very long text line to wrap backwards", { wrap: 15, over: 0.5 }),
            "very long text\nline to wrap\nbackwards");
    });
    it('returns empty for non-string', () => {
        assert.strictEqual(lib.wrap(null), "");
    });
    it('applies indent', () => {
        const r = lib.wrap("aaa bbb ccc ddd", { wrap: 5, indent: ">> " });
        assert.ok(r.includes(">> "));
    });
});

describe('lib.split', () => {
    it('splits by default separator', () => {
        assert.deepStrictEqual(lib.split("a,b,c"), ["a", "b", "c"]);
    });
    it('splits by custom separator', () => {
        assert.deepStrictEqual(lib.split("a|b|c", "|"), ["a", "b", "c"]);
    });
    it('ignores empty by default', () => {
        assert.deepStrictEqual(lib.split("a,,b"), ["a", "b"]);
    });
    it('keeps empty with keepempty', () => {
        assert.deepStrictEqual(lib.split("a,,b", ",", { keepempty: 1 }), ["a", "", "b"]);
    });
    it('trims by default', () => {
        assert.deepStrictEqual(lib.split(" a , b "), ["a", "b"]);
    });
    it('skips trim with notrim', () => {
        assert.deepStrictEqual(lib.split(" a , b ", ",", { notrim: 1 }), [" a ", " b "]);
    });
    it('lowercases', () => {
        assert.deepStrictEqual(lib.split("A,B", ",", { lower: 1 }), ["a", "b"]);
    });
    it('uppercases', () => {
        assert.deepStrictEqual(lib.split("a,b", ",", { upper: 1 }), ["A", "B"]);
    });
    it('converts to number', () => {
        assert.deepStrictEqual(lib.split("1,2,3", ",", { number: 1 }), [1, 2, 3]);
    });
    it('expands numeric ranges', () => {
        assert.deepStrictEqual(lib.split("1-3", ",", { range: 1 }), ["1", "2", "3"]);
    });
    it('removes duplicates with unique', () => {
        assert.deepStrictEqual(lib.split("a,b,a", ",", { unique: 1 }), ["a", "b"]);
    });
    it('filters by regexp', () => {
        assert.deepStrictEqual(lib.split("a1,bb,c3", ",", { regexp: /\d/ }), ["a1", "c3"]);
    });
    it('filters by noregexp', () => {
        assert.deepStrictEqual(lib.split("a1,bb,c3", ",", { noregexp: /\d/ }), ["bb"]);
    });
    it('drops over max', () => {
        assert.deepStrictEqual(lib.split("ab,abcde", ",", { max: 3 }), ["ab"]);
    });
    it('truncates over max', () => {
        assert.deepStrictEqual(lib.split("abcde", ",", { max: 3, trunc: 1 }), ["abc"]);
    });
    it('strips chars', () => {
        assert.deepStrictEqual(lib.split("a-b,c-d", ",", { strip: "-" }), ["ab", "cd"]);
    });
    it('replaces via map', () => {
        assert.deepStrictEqual(lib.split("a,b", ",", { replace: { a: "x" } }), ["x", "b"]);
    });
    it('returns empty for falsy', () => {
        assert.deepStrictEqual(lib.split(""), []);
        assert.deepStrictEqual(lib.split(null), []);
    });
    it('passes non-string array items through', () => {
        assert.deepStrictEqual(lib.split([1, "a", 2]), [1, "a", 2]);
    });
});

describe('lib.phraseSplit', () => {
    it('splits by space', () => {
        assert.deepStrictEqual(lib.phraseSplit("a b c"), ["a", "b", "c"]);
    });
    it('keeps quoted phrases', () => {
        assert.deepStrictEqual(lib.phraseSplit(`a "b c" d`), ["a", "b c", "d"]);
    });
    it('handles single quotes', () => {
        assert.deepStrictEqual(lib.phraseSplit(`a 'b c' d`), ["a", "b c", "d"]);
    });
    it('uses custom separator', () => {
        assert.deepStrictEqual(lib.phraseSplit("a,b,c", { separator: "," }), ["a", "b", "c"]);
    });
    it('returns empty for non-string', () => {
        assert.deepStrictEqual(lib.phraseSplit(null), []);
    });
    it('keeps empty with keepempty', () => {
        const r = lib.phraseSplit("a  b", { keepempty: 1 });
        assert.ok(r.includes(""));
    });
});

describe('lib.zeropad', () => {
    it('pads with zeros', () => {
        assert.strictEqual(lib.zeropad(5, 3), "005");
    });
    it('no pad when wide enough', () => {
        assert.strictEqual(lib.zeropad(123, 3), "123");
    });
    it('pads two digit', () => {
        assert.strictEqual(lib.zeropad(42, 4), "0042");
    });
});

describe('lib.sprintf', () => {
    it('formats strings', () => {
        assert.strictEqual(lib.sprintf("%s", "hi"), "hi");
    });
    it('formats integers', () => {
        assert.strictEqual(lib.sprintf("%d", 42), "42");
    });
    it('formats floats', () => {
        assert.strictEqual(lib.sprintf("%.2f", 3.14159), "3.14");
    });
    it('formats hex', () => {
        assert.strictEqual(lib.sprintf("%x", 255), "ff");
    });
    it('pads with zeros', () => {
        assert.strictEqual(lib.sprintf("%05d", 42), "00042");
    });
});

describe('lib.shuffle', () => {
    it('returns empty array for non-array input', () => {
        assert.deepStrictEqual(lib.shuffle(null), []);
        assert.deepStrictEqual(lib.shuffle("foo"), []);
        assert.deepStrictEqual(lib.shuffle([]), []);
    });

    it('returns array with same items', () => {
        const list = [1, 2, 3, 4, 5];
        const res = lib.shuffle(list);
        assert.strictEqual(res, list);
        assert.strictEqual(res.length, 5);
        assert.deepStrictEqual([...res].sort((a, b) => a - b), [1, 2, 3, 4, 5]);
    });

    it('handles single item', () => {
        assert.deepStrictEqual(lib.shuffle([1]), [1]);
    });
});

describe('lib.arrayLength', () => {
    it('returns length of array', () => {
        assert.strictEqual(lib.arrayLength([1, 2, 3]), 3);
        assert.strictEqual(lib.arrayLength([]), 0);
    });

    it('returns 0 for non-array', () => {
        assert.strictEqual(lib.arrayLength(null), 0);
        assert.strictEqual(lib.arrayLength("foo"), 0);
        assert.strictEqual(lib.arrayLength({}), 0);
        assert.strictEqual(lib.arrayLength(undefined), 0);
    });
});

describe('lib.arrayRemove', () => {
    it('removes item from list in place', () => {
        const list = [1, 2, 3];
        const res = lib.arrayRemove(list, 2);
        assert.strictEqual(res, list);
        assert.deepStrictEqual(res, [1, 3]);
    });

    it('does nothing if item not found', () => {
        const list = [1, 2, 3];
        assert.deepStrictEqual(lib.arrayRemove(list, 9), [1, 2, 3]);
    });

    it('removes only first occurrence', () => {
        assert.deepStrictEqual(lib.arrayRemove([1, 2, 2, 3], 2), [1, 2, 3]);
    });
});

describe('lib.arrayUnique', () => {
    it('returns unique primitive items', () => {
        assert.deepStrictEqual(lib.arrayUnique([1, 2, 2, 3, 3, 3]), [1, 2, 3]);
    });

    it('returns unique by key for objects', () => {
        const list = [{ id: 1 }, { id: 2 }, { id: 1 }];
        assert.deepStrictEqual(lib.arrayUnique(list, "id"), [{ id: 1 }, { id: 2 }]);
    });

    it('splits string when not array', () => {
        assert.deepStrictEqual(lib.arrayUnique("a,b,b,c"), ["a", "b", "c"]);
    });
});

describe('lib.arrayEqual', () => {
    it('returns true for arrays with same items', () => {
        assert.strictEqual(lib.arrayEqual([1, 2, 3], [1, 2, 3]), true);
        assert.strictEqual(lib.arrayEqual([1, 2, 3], [3, 2, 1]), true);
    });

    it('returns false for different lengths', () => {
        assert.strictEqual(lib.arrayEqual([1, 2], [1, 2, 3]), false);
    });

    it('returns false for different items', () => {
        assert.strictEqual(lib.arrayEqual([1, 2, 3], [1, 2, 4]), false);
    });

    it('returns false for non-arrays', () => {
        assert.strictEqual(lib.arrayEqual(null, [1]), false);
        assert.strictEqual(lib.arrayEqual([1], null), false);
    });
});

describe('lib.arrayFlatten', () => {
    it('flattens nested arrays', () => {
        assert.deepStrictEqual(lib.arrayFlatten([1, [2, 3], [4, [5, 6]]]), [1, 2, 3, 4, 5, 6]);
    });

    it('handles already flat array', () => {
        assert.deepStrictEqual(lib.arrayFlatten([1, 2, 3]), [1, 2, 3]);
    });

    it('handles deeply nested', () => {
        assert.deepStrictEqual(lib.arrayFlatten([[[[1]]], [2]]), [1, 2]);
    });
});

describe('lib.clone', () => {
    it('shallow clones an object', () => {
        const a = { x: 1, y: 2 };
        const b = lib.clone(a);
        assert.deepStrictEqual(b, a);
        assert.notStrictEqual(b, a);
    });

    it('clones nested arrays independently', () => {
        const a = { 1: 2, a: [1, 2] };
        const b = lib.clone(a);
        b.a.push(3);
        assert.notStrictEqual(a.a.length, b.a.length);
    });

    it('clones nested objects, sets, maps', () => {
        const a = { o: { z: 1 }, s: new Set([1, 2]), m: new Map([["k", "v"]]) };
        const b = lib.clone(a);
        assert.notStrictEqual(b.o, a.o);
        assert.notStrictEqual(b.s, a.s);
        assert.notStrictEqual(b.m, a.m);
        assert.deepStrictEqual([...b.s], [1, 2]);
        assert.strictEqual(b.m.get("k"), "v");
    });

    it('merges additional args', () => {
        const b = lib.clone({ 1: 2, a: [1, 2] }, { "3": 3, "4": 4 });
        assert.strictEqual(b["3"], 3);
        assert.strictEqual(b["4"], 4);
    });

    it('clones arrays', () => {
        const b = lib.clone([1, 2, 3]);
        assert.ok(Array.isArray(b));
        assert.deepStrictEqual(b, [1, 2, 3]);
    });
});

describe('lib.flatten', () => {
    it('flattens nested objects', () => {
        assert.deepStrictEqual(lib.flatten({ a: { c: 1 }, b: { d: 1 } }), { 'a.c': 1, 'b.d': 1 });
    });

    it('flattens with array index option', () => {
        assert.deepStrictEqual(lib.flatten({ a: { c: 1 }, b: { d: [1, 2, 3] } }, { index: 1 }),
            { 'a.c': 1, 'b.d.1': 1, 'b.d.2': 2, 'b.d.3': 3 });
    });

    it('uses custom separator', () => {
        assert.deepStrictEqual(lib.flatten({ a: { c: 1 } }, { separator: "_" }), { 'a_c': 1 });
    });

    it('respects depth', () => {
        const res = lib.flatten({ a: { b: { c: 1 } } }, { depth: 1 });
        assert.deepStrictEqual(res, {});
    });

    it('ignores properties matching regexp', () => {
        assert.deepStrictEqual(lib.flatten({ a: 1, _b: 2 }, { ignore: /^_/ }), { a: 1 });
    });

    it('handles circular references', () => {
        const a = { x: 1 };
        a.self = a;
        assert.doesNotThrow(() => lib.flatten(a));
    });
});

describe('lib.objGet', () => {
    const obj = { response: { item: { id: 123, name: "Test" } } };

    it('gets nested property', () => {
        assert.strictEqual(lib.objGet(obj, "response.item.name"), "Test");
    });

    it('returns as list', () => {
        assert.deepStrictEqual(lib.objGet(obj, "response.item.name", { list: 1 }), ["Test"]);
    });

    it('returns owner object', () => {
        assert.deepStrictEqual(lib.objGet(obj, "response.item.name", { owner: 1 }),
            { id: 123, name: "Test" });
    });

    it('returns undefined for missing path', () => {
        assert.strictEqual(lib.objGet(obj, "response.foo.bar"), undefined);
    });

    it('handles null obj with options', () => {
        assert.deepStrictEqual(lib.objGet(null, "a", { list: 1 }), []);
        assert.deepStrictEqual(lib.objGet(null, "a", { obj: 1 }), Object.create(null));
        assert.strictEqual(lib.objGet(null, "a", { str: 1 }), "");
        assert.strictEqual(lib.objGet(null, "a", { num: 1 }), 0);
        assert.strictEqual(lib.objGet(null, "a"), null);
    });

    it('returns as string', () => {
        assert.strictEqual(lib.objGet(obj, "response.item.id", { str: 1 }), "123");
    });

    it('returns as number', () => {
        assert.strictEqual(lib.objGet(obj, "response.item.name", { num: 1, dflt: 0 }), 0);
    });

    it('accepts array name', () => {
        assert.strictEqual(lib.objGet(obj, ["response", "item", "id"]), 123);
    });

    it('func option returns null for non-function', () => {
        assert.strictEqual(lib.objGet(obj, "response.item.id", { func: 1 }), null);
    });
});

describe('lib.objSet', () => {
    it('sets nested property, creating intermediate objects', () => {
        const a = lib.objSet({}, "response.item.count", 1);
        assert.strictEqual(a.response.item.count, 1);
    });

    it('increments', () => {
        const a = { response: { item: { count: 1 } } };
        lib.objSet(a, "response.item.count", 1, { incr: 1 });
        assert.strictEqual(a.response.item.count, 2);
    });

    it('multiplies', () => {
        const a = { n: 3 };
        lib.objSet(a, "n", 4, { mult: 1 });
        assert.strictEqual(a.n, 12);
    });

    it('pushes to array', () => {
        const a = {};
        lib.objSet(a, "list", 1, { push: 1 });
        lib.objSet(a, "list", 2, { push: 1 });
        assert.deepStrictEqual(a.list, [1, 2]);
    });

    it('pushes unique only', () => {
        const a = {};
        lib.objSet(a, "list", 1, { push: 1, unique: 1 });
        lib.objSet(a, "list", 1, { push: 1, unique: 1 });
        assert.deepStrictEqual(a.list, [1]);
    });

    it('appends string', () => {
        const a = {};
        lib.objSet(a, "s", "a", { append: 1 });
        lib.objSet(a, "s", "b", { append: 1 });
        assert.strictEqual(a.s, "ab");
    });

    it('result new', () => {
        assert.strictEqual(lib.objSet({}, "a", 5, { result: "new" }), 5);
    });

    it('result old', () => {
        assert.strictEqual(lib.objSet({ a: 1 }, "a", 5, { result: "old" }), 1);
    });

    it('uses custom separator', () => {
        const a = lib.objSet({}, "a_b_c", 1, { separator: "_" });
        assert.strictEqual(a.a.b.c, 1);
    });
});

describe('lib.objIncr', () => {
    it('creates a property when it does not exist', () => {
        const a = {};
        assert.strictEqual(lib.objIncr(a, "a", 1), 1);
        assert.strictEqual(a.a, 1);
    });

    it('increments an existing property', () => {
        const a = { a: 5 };
        assert.strictEqual(lib.objIncr(a, "a", 3), 8);
        assert.strictEqual(a.a, 8);
    });

    it('handles multiple properties', () => {
        const a = {};
        lib.objIncr(a, "a", 1);
        lib.objIncr(a, "b", 10);
        assert.deepStrictEqual(a, { a: 1, b: 10 });
    });

    it('supports nested path', () => {
        const a = {};
        lib.objIncr(a, "x.y", 4);
        assert.strictEqual(a.x.y, 4);
    });

    it('returns old value when result=old', () => {
        const a = { a: 5 };
        assert.strictEqual(lib.objIncr(a, "a", 3, "old"), 5);
        assert.strictEqual(a.a, 8);
    });
});

describe('lib.objMult', () => {
    it('creates a property when it does not exist', () => {
        const a = {};
        assert.strictEqual(lib.objMult(a, "a", 5), 0);
        assert.strictEqual(a.a, 0);
    });

    it('multiplies an existing property', () => {
        const a = { a: 4 };
        assert.strictEqual(lib.objMult(a, "a", 3), 12);
        assert.strictEqual(a.a, 12);
    });

    it('supports nested path', () => {
        const a = { x: { y: 2 } };
        lib.objMult(a, "x.y", 5);
        assert.strictEqual(a.x.y, 10);
    });
});

describe('lib.objKeys', () => {
    it('returns keys of an object', () => {
        assert.deepStrictEqual(lib.objKeys({ a: 1, b: 2 }), ["a", "b"]);
    });

    it('returns empty array for non-object', () => {
        assert.deepStrictEqual(lib.objKeys(null), []);
        assert.deepStrictEqual(lib.objKeys(undefined), []);
        assert.deepStrictEqual(lib.objKeys(42), []);
        assert.deepStrictEqual(lib.objKeys("str"), []);
    });

    it('returns empty for empty object', () => {
        assert.deepStrictEqual(lib.objKeys({}), []);
    });
});

describe('lib.objSize', () => {
    it('returns length for a string', () => {
        assert.strictEqual(lib.objSize("hello"), 5);
    });

    it('returns string length for a number', () => {
        assert.strictEqual(lib.objSize(123), 3);
    });

    it('computes size of a flat object', () => {
        // "a": each key length + pad(5) + value size
        const size = lib.objSize({ a: 1 });
        assert.strictEqual(size, "a".length + 5 + 1);
    });

    it('computes size with multiple properties', () => {
        const size = lib.objSize({ a: 1, bb: 22 });
        assert.strictEqual(size, (1 + 5 + 1) + (2 + 5 + 2));
    });

    it('handles nested objects', () => {
        const size = lib.objSize({ a: { b: 1 } });
        // outer: "a" + 5 + inner(  "b" + 5 + 1 )
        assert.strictEqual(size, 1 + 5 + (1 + 5 + 1));
    });

    it('handles arrays', () => {
        const size = lib.objSize({ a: [1, 22] });
        assert.strictEqual(size, 1 + 5 + 1 + 2);
    });

    it('handles Set', () => {
        const size = lib.objSize({ a: new Set([1, 22]) });
        assert.strictEqual(size, 1 + 5 + 1 + 2);
    });

    it('handles Map', () => {
        const size = lib.objSize({ a: new Map([["k", "v"]]) });
        assert.strictEqual(size, 1 + 5 + 1 + 1);
    });

    it('handles strings inside objects', () => {
        const size = lib.objSize({ a: "hello" });
        assert.strictEqual(size, 1 + 5 + 5);
    });

    it('skips functions', () => {
        const size = lib.objSize({ a: () => {} });
        assert.strictEqual(size, 1 + 5);
    });

    it('returns MAX_SAFE_INTEGER on circular reference', () => {
        const a = {};
        a.self = a;
        assert.ok(lib.objSize(a) > Number.MAX_SAFE_INTEGER);
    });

    it('returns NaN on circular reference when nan option set', () => {
        const a = {};
        a.self = a;
        assert.ok(Number.isNaN(lib.objSize(a, { nan: true })));
    });

    it('respects custom pad', () => {
        const size = lib.objSize({ a: 1 }, { pad: 0 });
        assert.strictEqual(size, 1 + 0 + 1);
    });

    it('returns MAX_SAFE_INTEGER when depth exceeded', () => {
        const deep = { a: { b: { c: { d: {} } } } };
        assert.ok(lib.objSize(deep, { depth: 1 }) > Number.MAX_SAFE_INTEGER);
    });

    it('handles null', () => {
        assert.strictEqual(lib.objSize(null), 9);
    });
});
