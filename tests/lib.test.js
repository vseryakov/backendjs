
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { lib } = require("../");

describe("lib tests", () => {

    it("runs search" ,() => {

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

    it("lib.skip32", () => {

        // these are the default test values from the original C code
        var KEY = [ 0x00,0x99,0x88,0x77,0x66,0x55,0x44,0x33,0x22,0x11 ];
        var INPUT = parseInt("33221100", 16)
        var ENCRYPTED = parseInt("819d5f1f", 16);
        var e = lib.toSkip32("",KEY,INPUT)
        var d = lib.toSkip32("d",KEY,e)
        assert.strictEqual(ENCRYPTED, e);
        assert.strictEqual(INPUT, d);

    })

    it("lib.toTemplate", () => {

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
        assert.ok(o.__exit === undefined)

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

});

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
