
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { lib } = require("../");

describe("toVersion", function () {
  it("converts semver to a comparable float", function () {
    assert.strictEqual(lib.toVersion("1.0.3"), 1.000003);
    assert.strictEqual(lib.toVersion("1.0.3.4"), 1.000003004);
  });
  it("strips non-digits and treats underscore as dot", function () {
    assert.strictEqual(lib.toVersion("1.2.3-beta"), 1.002003);
  });
  it("supports comparisons", function () {
    assert.ok(lib.toVersion("1.0.3.4") > lib.toVersion("1.0.3"));
    assert.ok(lib.toVersion("1.0.3.4") > lib.toVersion("1.0.0"));
    assert.ok(lib.toVersion("1.0.3.4") < lib.toVersion("1.1.0"));
  });
  it("returns 0 for empty/falsy input", function () {
    assert.strictEqual(lib.toVersion(""), 0);
    assert.strictEqual(lib.toVersion(null), 0);
  });
});

describe("toTitle", function () {
  it("capitalizes words", function () {
    assert.strictEqual(lib.toTitle("hello_world"), "Hello World");
  });
  it("leaves short strings as is when under minlen", function () {
    assert.strictEqual(lib.toTitle("id", 2), "id");
  });
  it("returns empty for non-string", function () {
    assert.strictEqual(lib.toTitle(123), "");
    assert.strictEqual(lib.toTitle(null), "");
  });
});

describe("toCamel", function () {
  it("camelizes with default separators", function () {
    assert.strictEqual(lib.toCamel("hello_world"), "helloWorld");
  });
  it("camelizes with custom separator", function () {
    assert.strictEqual(lib.toCamel("hello-world", "-"), "helloWorld");
  });
  it("returns empty for non-string", function () {
    assert.strictEqual(lib.toCamel(null), "");
  });
});

describe("toUncamel", function () {
  it("uncamelizes with default dash separator", function () {
    assert.strictEqual(lib.toUncamel("helloWorld"), "hello-world");
  });
  it("uncamelizes with custom separator", function () {
    assert.strictEqual(lib.toUncamel("helloWorld", "_"), "hello_world");
  });
  it("returns empty for non-string", function () {
    assert.strictEqual(lib.toUncamel(null), "");
  });
});

describe("toNumber", function () {
  it("parses integers and floats", function () {
    assert.strictEqual(lib.toNumber("123"), 123);
    assert.strictEqual(lib.toNumber("1.23", { float: 1 }), 1.23);
    assert.strictEqual(lib.toNumber("1.23", { float: false }), 1);
  });
  it("handles booleans", function () {
    assert.strictEqual(lib.toNumber(true), 1);
    assert.strictEqual(lib.toNumber(false), 0);
  });
  it("uses default for non-numeric", function () {
    assert.strictEqual(lib.toNumber("abc", { dflt: 5 }), 5);
    assert.strictEqual(lib.toNumber("abc"), 0);
  });
  it("applies min/max clipping", function () {
    assert.strictEqual(lib.toNumber("10", { max: 5 }), 5);
    assert.strictEqual(lib.toNumber("1", { min: 3 }), 3);
  });
  it("applies incr and mult", function () {
    assert.strictEqual(lib.toNumber("2", { incr: 3 }), 5);
    assert.strictEqual(lib.toNumber("2", { mult: 3 }), 6);
  });
  it("applies digits rounding", function () {
    assert.strictEqual(lib.toNumber("1.23456", { float: 1, digits: 2 }), 1.23);
  });
  it("applies zero replacement", function () {
    assert.strictEqual(lib.toNumber("0", { zero: 9 }), 9);
  });
});

describe("toDigits", function () {
  it("keeps only digits", function () {
    assert.strictEqual(lib.toDigits("+1 (555) 123-4567"), "15551234567");
    assert.strictEqual(lib.toDigits("abc123def"), "123");
  });
  it("handles non-string input", function () {
    assert.strictEqual(lib.toDigits(123), "123");
  });
});

describe("toBool", function () {
  it("returns booleans as is", function () {
    assert.strictEqual(lib.toBool(true), true);
    assert.strictEqual(lib.toBool(false), false);
  });
  it("treats positive numbers as true", function () {
    assert.strictEqual(lib.toBool(1), true);
    assert.strictEqual(lib.toBool(0), false);
    assert.strictEqual(lib.toBool(-1), false);
  });
  it("recognizes truthy strings", function () {
    assert.strictEqual(lib.toBool("yes"), true);
    assert.strictEqual(lib.toBool("0"), false);
  });
  it("uses default for undefined", function () {
    assert.strictEqual(lib.toBool(undefined, "true"), true);
  });
});

describe("toDate", function () {
  it("returns the same Date object when given a Date", function () {
    const d = new Date("2024-01-02T03:04:05Z");
    assert.strictEqual(lib.toDate(d), d);
  });
  it("parses ISO date strings", function () {
    const d = lib.toDate("2024-01-02T03:04:05Z");
    assert.ok(lib.isDate(d));
    assert.strictEqual(d.getTime(), Date.parse("2024-01-02T03:04:05Z"));
  });
  it("parses numeric string as a number", function () {
    assert.strictEqual(lib.toDate("1704164645").getTime(), 1704164645 * 1000);
  });
  it("converts Unix seconds to milliseconds", function () {
    assert.strictEqual(lib.toDate(1704164645).getTime(), 1704164645000);
  });
  it("keeps millisecond values as-is", function () {
    assert.strictEqual(lib.toDate(1704164645000).getTime(), 1704164645000);
  });
  it("converts nanoseconds to milliseconds", function () {
    assert.strictEqual(lib.toDate(1704164645000 * 1000).getTime(), 1704164645000);
  });
  it("handles AM/PM without space", function () {
    const d = lib.toDate("2024-01-02 3:04PM");
    assert.ok(lib.isDate(d));
    assert.strictEqual(d.getHours(), 15);
  });
  describe("invalid values", function () {
    it("returns epoch by default for invalid date", function () {
      assert.strictEqual(lib.toDate("bad date").getTime(), 0);
    });
    it("returns null when invalid flag is set", function () {
      assert.strictEqual(lib.toDate("bad date", undefined, true), null);
    });
    it("returns null when dflt is null/0/NaN", function () {
      assert.strictEqual(lib.toDate("bad date", null), null);
      assert.strictEqual(lib.toDate("bad date", 0), null);
      assert.strictEqual(lib.toDate("bad date", NaN), null);
    });
    it("uses dflt date value for invalid date", function () {
      assert.strictEqual(lib.toDate("bad date", 1704164645000).getTime(), 1704164645000);
    });
  });
});

describe("toMtime", function () {
  it("returns milliseconds for a date", function () {
    assert.strictEqual(lib.toMtime("2024-01-02T03:04:05Z"), 1704164645000);
  });
  it("returns dflt number for invalid dates", function () {
    assert.strictEqual(lib.toMtime("bad date", 1000), 1000);
  });
  it("returns 0 for invalid dates without dflt", function () {
    assert.strictEqual(lib.toMtime("bad date"), 0);
  });
});

describe("toBase64url", function () {
  it("encodes url-safe base64", function () {
    assert.strictEqual(lib.toBase64url("hello?"), "aGVsbG8_");
    assert.strictEqual(lib.toBase64url(Buffer.from("test")), "dGVzdA==");
  });
});

describe("fromBase64url", function () {
  it("decodes url-safe base64 to string", function () {
    assert.strictEqual(lib.fromBase64url("aGVsbG8_"), "hello?");
  });
  it("decodes to a Buffer when binary is set", function () {
    const b = lib.fromBase64url("dGVzdA==", true);
    assert.ok(Buffer.isBuffer(b));
    assert.strictEqual(b.toString(), "test");
  });
  it("returns empty for non-string", function () {
    assert.strictEqual(lib.fromBase64url(null), "");
  });
  it("roundtrips with toBase64url", function () {
    assert.strictEqual(lib.fromBase64url(lib.toBase64url("Hello, World!")), "Hello, World!");
  });
});

describe("toBase62 / fromBase62", function () {
  it("encodes numbers to base62", function () {
    assert.strictEqual(lib.toBase62(61), "z");
    assert.strictEqual(lib.toBase62(3844), "100");
  });
  it("decodes base62 to numbers", function () {
    assert.strictEqual(lib.fromBase62("z"), 61);
    assert.strictEqual(lib.fromBase62("100"), 3844);
  });
  it("returns 0 for non-string in fromBase62", function () {
    assert.strictEqual(lib.fromBase62(123), 0);
  });
  it("roundtrips", function () {
    assert.strictEqual(lib.fromBase62(lib.toBase62(123456)), 123456);
  });
});

describe("toUrl", function () {
  it("returns a normalized url string", function () {
    assert.strictEqual(lib.toUrl("https://example.com/a?b=1"), "https://example.com/a?b=1");
  });
  it("returns a URL object when requested", function () {
    assert.strictEqual(lib.toUrl("https://example.com", { url: true }).hostname, "example.com");
  });
  it("returns empty for invalid url", function () {
    assert.strictEqual(lib.toUrl("not a url"), "");
    assert.strictEqual(lib.toUrl(""), "");
  });
});

describe("toPrice", function () {
  it("formats default USD", function () {
    assert.strictEqual(lib.toPrice(12.5), "$12.50");
  });
  it("formats other currencies/locales", function () {
    const s = lib.toPrice(12.5, { currency: "EUR", locale: "de-DE" });
    assert.ok(s.includes("12,50"));
    assert.ok(s.includes("€"));
  });
});

describe("toEmail", function () {
  it("normalizes valid email", function () {
    assert.strictEqual(lib.toEmail("User@Example.COM"), "user@example.com");
  });
  it("parses name <email> format", function () {
    assert.strictEqual(lib.toEmail("User Name <user@example.com>", { parse: true }), "user@example.com");
  });
  it("rejects double dots", function () {
    assert.strictEqual(lib.toEmail("bad..email@example.com"), "");
  });
  it("returns empty for non-string", function () {
    assert.strictEqual(lib.toEmail(null), "");
  });
  it("respects max option", function () {
    assert.strictEqual(lib.toEmail("user@example.com", { max: 5 }), "");
  });
});

describe("toMap", function () {
  it("parses key:val pairs", function () {
    assert.deepStrictEqual(lib.toMap("a:1,b:2,c:4:5"), { __proto__: null, a: "1", b: "2", c: ["4", "5"] });
      });
  it("converts value types with map_type", function () {
    assert.deepStrictEqual(lib.toMap("a:1,b:2", { map_type: "int" }), { __proto__: null, a: 1, b: 2 });
    assert.deepStrictEqual(lib.toMap("x:3.14,y:2", { map_type: "float" }), { __proto__: null, x: 3.14, y: 2 });
      });
  it("camelizes keys with map_camel", function () {
    assert.deepStrictEqual(lib.toMap("first_name:bob", { map_camel: 1 }), { __proto__: null, firstName: "bob" });
    assert.deepStrictEqual(lib.toMap("my_key:val,another_one:2", { map_camel: 1 }), { __proto__: null, myKey: "val", anotherOne: "2" });
      });
  it("uses custom delimiter to split pairs", function () {
    assert.deepStrictEqual(lib.toMap("a:1;b:2", { delimiter: ";" }), { __proto__: null, a: "1", b: "2" });
    assert.deepStrictEqual(lib.toMap("a=1;b=2", { delimiter: ";", separator: "=" }), { __proto__: null, a: "1", b: "2" });
      });
  it("uses custom separator between key and value", function () {
    assert.deepStrictEqual(lib.toMap("a=1,b=2", { separator: "=" }), { __proto__: null, a: "1", b: "2" });
      });
  it("parses semicolon-separated key-value pairs by default", function () {
    assert.deepStrictEqual(lib.toMap("a;1,b;2"), { __proto__: null, a: "1", b: "2" });
      });
  it("keeps empty keys with empty option (bare keys get empty string value)", function () {
    assert.deepStrictEqual(lib.toMap("a,b:2", { empty: 1 }), { __proto__: null, a: "", b: "2" });
      });
  it("skips entries with empty values when no_empty is set", function () {
    assert.deepStrictEqual(lib.toMap("a:,b:2", { no_empty: 1 }), { __proto__: null, b: "2" });
      });
  it("handles empty string input", function () {
    assert.deepStrictEqual(lib.toMap(""), { __proto__: null, });
      });
  it("sets bare keys to undefined by default", function () {
    const result = lib.toMap("a,b:2");
    assert.strictEqual(result.a, undefined);
    assert.strictEqual(result.b, "2");
    assert.ok("a" in result);
      });
  it("drops bare keys when no_empty is set", function () {
    assert.deepStrictEqual(lib.toMap("a,b:2", { no_empty: 1 }), { __proto__: null, b: "2" });
      });
  it("combines map_camel and map_type options", function () {
    assert.deepStrictEqual(lib.toMap("first_name:30,last_city:nyc", { map_camel: 1, map_type: "string" }), { __proto__: null, firstName: "30", lastCity: "nyc" });
      });
});

describe("toValue", function () {
  it("returns value as is for null/empty type", function () {
    assert.strictEqual(lib.toValue("test", null), "test");
    assert.strictEqual(lib.toValue("test", ""), "test");
  });
  it("returns value as is for none", function () {
    assert.strictEqual(lib.toValue("x", "none"), "x");
  });
  it("converts numbers", function () {
    assert.strictEqual(lib.toValue("123", "int"), 123);
    assert.strictEqual(lib.toValue("1.5", "float"), 1.5);
  });
  it("converts booleans", function () {
    assert.strictEqual(lib.toValue("true", "bool"), true);
  });
  it("converts lists", function () {
    assert.deepStrictEqual(lib.toValue("a,b,c", "list"), ["a", "b", "c"]);
  });
  it("parses js/json", function () {
    assert.deepStrictEqual(lib.toValue('{"a":1}', "js"), { a: 1 });
    assert.strictEqual(lib.toValue({ a: 1 }, "json"), '{"a":1}');
  });
  it("converts date and mtime", function () {
    assert.ok(lib.toValue("2024-01-02", "date") instanceof Date);
    assert.strictEqual(lib.toValue("2024-01-02T03:04:05Z", "mtime"), 1704164645000);
  });
  it("converts email and url", function () {
    assert.strictEqual(lib.toValue("User@Example.com", "email"), "user@example.com");
    assert.strictEqual(lib.toValue("https://x.com", "url"), "https://x.com/");
  });
  it("converts phone/e164", function () {
    assert.strictEqual(lib.toValue("+1 (555) 123-4567", "phone"), "5551234567");
    assert.strictEqual(lib.toValue("5551234567", "e164"), "15551234567");
  });
  it("converts lower/upper case", function () {
    assert.strictEqual(lib.toValue("HeLLo", "lower"), "hello");
    assert.strictEqual(lib.toValue("HeLLo", "upper"), "HELLO");
  });
});

describe("toString", function () {
  it("converts values to strings", function () {
    assert.strictEqual(lib.toString(123), "123");
    assert.strictEqual(lib.toString("x"), "x");
  });
  it("returns empty for null/undefined", function () {
    assert.strictEqual(lib.toString(null), "");
    assert.strictEqual(lib.toString(undefined), "");
  });
});

describe("toRegexp", function () {
  it("creates a regexp with flags", function () {
    assert.ok(lib.toRegexp("hello", "i").test("HELLO"));
  });
  it("escapes special chars with escape option", function () {
    assert.ok(lib.toRegexp("a+b", { escape: true }).test("a+b"));
    assert.ok(!lib.toRegexp("a+b", { escape: true }).test("aaab"));
  });
  it("returns existing RegExp as is", function () {
    const rx = /x/;
    assert.strictEqual(lib.toRegexp(rx), rx);
  });
  it("returns undefined for invalid regexp", function () {
    assert.strictEqual(lib.toRegexp("["), undefined);
  });
});

describe("toRegexpObj", function () {
  it("adds a pattern to a new object", function () {
    const obj = lib.toRegexpObj(null, "admin");
    assert.deepStrictEqual(obj.list, ["admin"]);
    assert.ok(obj.rx.test("admin"));
  });
  it("removes a pattern with ! prefix", function () {
    let obj = lib.toRegexpObj(null, "admin");
    obj = lib.toRegexpObj(obj, "!admin");
    assert.deepStrictEqual(obj.list, []);
    assert.strictEqual(obj.rx, null);
  });
  it("sets the not flag", function () {
    const obj = lib.toRegexpObj(null, "x", { not: true });
    assert.strictEqual(obj.not, true);
  });
});

describe("toMilliseconds", function () {
  it("parses durations with units", function () {
    assert.strictEqual(lib.toMilliseconds("2.5 hrs"), 9000000);
    assert.strictEqual(lib.toMilliseconds("1m"), 60000);
    assert.strictEqual(lib.toMilliseconds("-3 day"), -259200000);
    assert.strictEqual(lib.toMilliseconds("2.5 mon"), 6480000000);
  });
  it("returns undefined for invalid input", function () {
    assert.strictEqual(lib.toMilliseconds("bad"), undefined);
  });
});

describe("toDuration", function () {
  it("formats milliseconds into words", function () {
    assert.strictEqual(lib.toDuration(65000), "1 minute 5 seconds");
  });
  it("uses short format", function () {
    assert.strictEqual(lib.toDuration(3600000, { short: true }), "1h");
  });
  it("returns empty for zero/negative", function () {
    assert.strictEqual(lib.toDuration(0), "");
    assert.strictEqual(lib.toDuration(-1), "");
  });
});

describe("toSize", function () {
  it("formats sizes", function () {
    assert.strictEqual(lib.toSize(1024), "1 KBytes");
    assert.strictEqual(lib.toSize(1536, 1), "1.5 KBytes");
  });
  it("handles zero", function () {
    assert.strictEqual(lib.toSize(0), "0 Bytes");
  });
});

describe("toFormat", function () {
  it("formats csv with header", function () {
    assert.strictEqual(lib.toFormat("csv", [{ id: 1, name: "Bob" }], { header: true }), "id,name\r\n1,Bob\r\n");
  });
  it("quotes csv values with separators", function () {
    assert.strictEqual(lib.toFormat("csv", [{ a: "x,y" }]), '"x,y"\r\n');
  });
  it("formats json lines", function () {
    assert.strictEqual(lib.toFormat("json", [{ id: 1 }]), '{"id":1}\n');
  });
  it("formats xml", function () {
    assert.strictEqual(lib.toFormat("xml", [{ id: 1 }]), "<row>\n<id>1</id>\n</row>\n");
  });
  it("returns empty for empty data", function () {
    assert.strictEqual(lib.toFormat("csv", []), "");
  });
});

describe("toTemplate", function () {
  it("replaces placeholders", function () {
    assert.strictEqual(lib.toTemplate("http://x/@code@/@id@", { id: 123, code: "YYY" }, { encoding: "url" }), "http://x/YYY/123");
  });
  it("uses defaults", function () {
    assert.strictEqual(lib.toTemplate("Hello @name|friend@!", {}), "Hello friend!");
  });
  it("returns empty for non-string", function () {
    assert.strictEqual(lib.toTemplate(null, {}), "");
  });
  it("supports if/endif blocks", function () {
    assert.strictEqual(lib.toTemplate("@if type admin@yes@endif@", { type: "admin" }), "yes");
    assert.strictEqual(lib.toTemplate("@if type admin@yes@endif@", { type: "user" }), "");
  });
});

describe("toRFC3339", function () {
  it("formats a date with offset", function () {
    const s = lib.toRFC3339(new Date("2024-01-02T03:04:05.006Z"));
    assert.match(s, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.006[+-]\d{2}:\d{2}$/);
  });
  it("uses current time by default", function () {
    assert.match(lib.toRFC3339(), /^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("toCookie", function () {
  it("encodes name/value", function () {
    assert.strictEqual(lib.toCookie("sid", "abc 123"), "sid=abc%20123");
  });
  it("adds attributes", function () {
    assert.strictEqual(lib.toCookie("sid", "abc", { httpOnly: true, secure: true, sameSite: "Strict" }),
                       "sid=abc; HttpOnly; Secure; SameSite=Strict");
  });
  it("adds Max-Age and Path", function () {
    assert.strictEqual(lib.toCookie("sid", "", { maxAge: 3600, path: "/" }), "sid=; Max-Age=3600; Path=/");
  });
  it("returns empty without name", function () {
    assert.strictEqual(lib.toCookie(""), "");
  });
});

describe("jsonToBase64 / base64ToJson", function () {
  it("encodes json to base64", function () {
    assert.strictEqual(lib.jsonToBase64({ a: 1 }), "eyJhIjoxfQ==");
  });
  it("decodes base64 to json", function () {
    assert.deepStrictEqual(lib.base64ToJson("eyJhIjoxfQ=="), { a: 1 });
  });
  it("decodes a bare number", function () {
    assert.strictEqual(lib.base64ToJson("123"), 123);
  });
  it("returns empty string for empty input", function () {
    assert.strictEqual(lib.base64ToJson(""), "");
    assert.strictEqual(lib.base64ToJson(null), "");
  });
  it("roundtrips", function () {
    assert.deepStrictEqual(lib.base64ToJson(lib.jsonToBase64({ x: [1, 2, 3] })), { x: [1, 2, 3] });
  });
});

describe("jsonFormat", function () {
  it("formats an object", function () {
    assert.strictEqual(lib.jsonFormat({ a: 1 }), '{    "a": 1\n}');
  });
  it("supports registering presets", function () {
    lib.jsonFormatPreset("plaintest", { quote1: "", quote2: "", squote1: "", squote2: "" });
    assert.ok(lib.jsonFormat({ a: "test" }, { preset: "plaintest" }).includes("a: test"));
  });
});

describe("stringify", function () {
  it("stringifies objects", function () {
    assert.strictEqual(lib.stringify({ a: 1 }), '{"a":1}');
  });
  it("supports indentation", function () {
    assert.strictEqual(lib.stringify({ a: 1 }, null, 2), '{\n  "a": 1\n}');
  });
  it("returns empty string on circular error", function () {
    const o = {}; o.self = o;
    assert.strictEqual(lib.stringify(o), "");
  });
  it("escapes unicode when requested", function () {
    assert.strictEqual(lib.stringify({ t: "и" }, null, 0, true), '{"t":"\\u0438"}');
  });
});

describe("inspect", function () {
  it("inspects an object into readable text", function () {
    assert.strictEqual(lib.inspect({ a: 1, b: { c: 2 }, s: "test" }), "a: 1, b: {c: 2}, s: test");
  });
  it("handles primitive strings and numbers", function () {
    assert.strictEqual(lib.inspect("hello"), "hello");
    assert.strictEqual(lib.inspect(123), "123");
  });
});

describe("encodeURIComponent", function () {
  it("encodes special characters", function () {
    assert.strictEqual(lib.encodeURIComponent("a b!"), "a%20b%21");
  });
  it("supports custom charset", function () {
    assert.strictEqual(lib.encodeURIComponent("a*b", /[*]/g), "a%2Ab");
  });
  it("returns empty for undefined", function () {
    assert.strictEqual(lib.encodeURIComponent(undefined), "");
  });
  it("has escape alias", function () {
    assert.strictEqual(lib.escape, lib.encodeURIComponent);
  });
});

describe("toPercentEncoded", function () {
  it("percent-encodes all chars by default", function () {
    assert.strictEqual(lib.toPercentEncoded("abc"), "%61%62%63");
  });
  it("percent-encodes matched chars", function () {
    assert.strictEqual(lib.toPercentEncoded("a b", / /g), "a%20b");
  });
});

describe("decodeURIComponent", function () {
  it("decodes percent-encoded strings", function () {
    assert.strictEqual(lib.decodeURIComponent("a%20b%21"), "a b!");
  });
  it("returns empty for invalid/undefined", function () {
    assert.strictEqual(lib.decodeURIComponent("%"), "");
    assert.strictEqual(lib.decodeURIComponent(undefined), "");
  });
});

describe("escapeUnicode", function () {
  it("escapes unicode symbols", function () {
    assert.strictEqual(lib.escapeUnicode("привет"), "\\u043f\\u0440\\u0438\\u0432\\u0435\\u0442");
  });
  it("leaves ascii intact", function () {
    assert.strictEqual(lib.escapeUnicode("hello"), "hello");
  });
});

describe("unicode2Ascii", function () {
  it("converts unicode quotes", function () {
    assert.strictEqual(lib.unicode2Ascii("\u201chello\u201d"), '"hello"');
  });
  it("returns empty for non-string", function () {
    assert.strictEqual(lib.unicode2Ascii(null), "");
  });
});

describe("unescape", function () {
  it("converts escape sequences", function () {
    assert.strictEqual(lib.unescape("hello\\nworld"), "hello\nworld");
    assert.strictEqual(lib.unescape("\\tx"), "\tx");
  });
});

describe("textToXml", function () {
  it("escapes xml special chars", function () {
    assert.strictEqual(lib.textToXml("<a>Tom & Jerry</a>"), "&lt;a&gt;Tom &amp; Jerry&lt;/a&gt;");
    assert.strictEqual(lib.textToXml("Bob's"), "Bob&apos;s");
  });
});

describe("textToEntity / entityToText", function () {
  it("encodes to html entities", function () {
    assert.strictEqual(lib.textToEntity("<b>x & y</b>"), "&lt;b&gt;x &amp; y&lt;/b&gt;");
  });
  it("decodes html entities", function () {
    assert.strictEqual(lib.entityToText("&lt;b&gt;x &amp; y&lt;/b&gt;"), "<b>x & y</b>");
  });
  it("decodes numeric entities", function () {
    assert.strictEqual(lib.entityToText("&#65;&#x42;"), "AB");
  });
  it("returns empty for non-string", function () {
    assert.strictEqual(lib.textToEntity(null), "");
    assert.strictEqual(lib.entityToText(null), "");
  });
});

describe("toBase32 / fromBase32", function () {
  it("encodes a buffer", function () {
    assert.strictEqual(lib.toBase32(Buffer.from("hello")), "NBSWY3DP");
  });
  it("adds padding when requested", function () {
    assert.strictEqual(lib.toBase32(Buffer.from("hi"), { padding: true }), "NBUQ====");
  });
  it("returns empty for non-buffer", function () {
    assert.strictEqual(lib.toBase32("hello"), "");
  });
  it("decodes a base32 string", function () {
    assert.strictEqual(lib.fromBase32("NBSWY3DP").toString(), "hello");
  });
  it("returns empty for non-string in fromBase32", function () {
    assert.strictEqual(lib.fromBase32(null), "");
  });
  it("roundtrips", function () {
    assert.strictEqual(lib.fromBase32(lib.toBase32(Buffer.from("backendjs"))).toString(), "backendjs");
  });
});
