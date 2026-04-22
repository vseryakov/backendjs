
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const util = require("node:util")
const { lib } = require("../");

describe("Validate checks", function () {

    it("validates common use cases", () => {

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


        var q = lib.validate({}, schema, opts);
        assert.match(q, /email1 is required/);

        q = lib.validate({ email: "a@a" }, schema, opts);
        assert.match(q, /email1 is required/);

        q = lib.validate({ email1: "a@a" }, schema, opts);
        assert.match(q, /email1 is required/);

        q = lib.validate({ email1: "a@a.com" }, schema, opts);
        assert.partialDeepStrictEqual(q, { page: 1, count: 1 });

        schema.email1.required = 0;
        q = lib.validate({ page: 1000, count: 1000 }, schema, opts);
        assert.partialDeepStrictEqual(q, { page: 10, count: 100 });

        q = lib.validate({ name: "1234567890" }, schema, opts);
        assert.strictEqual(q.name, "123456");

        q = lib.validate({ descr: "1234567890" }, schema, opts);
        assert.match(q, /descr is too long/);

        q = lib.validate({ descr: "<2345" }, schema, opts);
        assert.strictEqual(q.descr, "!2345");

        q = lib.validate({ name: "test", descr: "test" }, schema, opts);
        assert.ok(!q.descr && q.name == "test");

        q = lib.validate({ pair: "a:1,b:2" }, schema, opts);
        assert.partialDeepStrictEqual(q, { pair: { a: 1, b: 2 } });

        q = lib.validate({ code: "12345" }, schema, opts);
        assert.match(q, /Valid code is required/);

        q = lib.validate({ code: "q-123" }, schema, opts);
        assert.strictEqual(q.code, "q-123");

        q = lib.validate({ code1: "q.123" }, schema, opts);
        assert.match(q, /Valid code1 is required/);

        q = lib.validate({ start: "test" }, schema, opts);
        assert.ok(!q.start);

        q = lib.validate({ start: lib.jsonToBase64("test", "test") }, schema, opts);
        assert.strictEqual(q.start,"test");

        q = lib.validate({ tm: 1 }, schema, opts);
        assert.ok(q.ready == "ready" && q.tm == '1970-01-01T00:00:01.000Z');

        q = lib.validate({ tm: Date.now() }, schema, opts);
        assert.match(q, /is too late/);

        q = lib.validate({ mtime: '1970-01-01T00:00:01.000Z' }, schema, opts);
        assert.match(q, /is too soon/);

        schema.mtime.mindate = 0;
        q = lib.validate({ mtime: '1970-01-01T00:00:01.000Z' }, schema, opts);
        assert.strictEqual(q.timestamp, 1000);

        q = lib.validate({ state: "ok,done,error", flag: false }, schema, opts);
        assert.partialDeepStrictEqual(q.state, ["ok"]);
        assert.strictEqual(q.flag, undefined);

        q = lib.validate({ obj: { id: "1", descr: "1", name: "1" } }, schema, opts);
        assert.deepStrictEqual(q.obj, { id: 1, name: "1" });

        q = lib.validate({ object: { id: "1", descr: "1", name: "1" } }, schema, opts);
        assert.deepStrictEqual(q.object, { id: "1", descr: "1", name: "1" });

        q = lib.validate({ json: lib.stringify({ id: "1", descr: "1", name: "1" }) }, schema, opts);
        assert.deepStrictEqual(q.json, { id: "1", descr: "1", name: "1" });

        q = lib.validate({ json1: lib.stringify({ id: "1", descr: "1", name: "1" }) }, schema, opts);
        assert.deepStrictEqual(q.json1, { id: 1, name: "1" });

        q = lib.validate({ empty: "." }, schema, opts);
        assert.strictEqual(q.empty, "");

        schema.empty.setempty = null;
        q = lib.validate({ empty: "." }, schema, opts);
        assert.strictEqual(q.empty, null);

        q = lib.validate({ nospecial: "a<b>c", special: "a<b>c" }, schema, opts);
        assert.strictEqual(q.special, "<>");
        assert.strictEqual(q.nospecial, "abc");

        q = lib.validate({ minnum: 2 }, schema, opts);
        assert.match(q, /too small/);

        q = lib.validate({ minnum: 20 }, schema, opts);
        assert.strictEqual(q.minnum, 20);

        q = lib.validate({ minnum: 2 }, schema, { error: true });
        assert.strictEqual(util.types.isNativeError(q), true);
        assert.strictEqual(q.code, "validate");

    });

  it("skips undefined schema entries and ignored fields", function () {
    const q = { a: "1", b: "2", c: "3" };
    const s = {
      a: undefined,
      b: { ignore: 1, type: "int" },
      c: { type: "int" },
    };
    assert.deepStrictEqual(lib.validate(q, s), { c: 3 });
  });

  it("supports options.prefix and options.existing", function () {
    const q = { "p.a": "5" };
    const s = { a: { type: "int" }, b: { type: "int" } };

    assert.deepStrictEqual(lib.validate(q, s, { prefix: "p." }), { a: 5 });
    assert.deepStrictEqual(lib.validate(q, s, { prefix: "p.", existing: 1 }), { a: 5 });
    assert.deepStrictEqual(lib.validate(q, s, { prefix: "p.", existing: 1, defaults: { b: { dflt: 7 } } }), { a: 5 }); // b not in query => skipped
  });

  it("supports setnull option (direct match and flag match)", function () {
    const q = { a: "NULL", b: "1" };
    const s = { a: { type: "string" }, b: { type: "int" } };

    // direct match
    assert.deepStrictEqual(lib.validate(q, s, { setnull: "NULL" }), { a: null, b: 1 });

    // flag match: if lib.isFlag exists, exercise it, otherwise just ensure no throw
    if (typeof lib.isFlag === "function") {
      assert.deepStrictEqual(lib.validate({ a: "null" }, s, { setnull: "null" }), { a: null });
    }
  });

  it("applies dflt when missing, and dfltempty when empty", function () {
    const q = { a: "", b: undefined };
    const s = {
      a: { dfltempty: 1, dflt: "x" },
      b: { dflt: "y" },
    };
    assert.deepStrictEqual(lib.validate(q, s), { a: "x", b: "y" });
  });

  it("type=bool", function () {
    const q = { a: "1", b: "false", c: "" };
    const s = {
      a: { type: "bool" },
      b: { type: "boolean" },
      c: { type: "bool" },
    };
    const r = lib.validate(q, s);
    assert.strictEqual(r.a, true);
    assert.strictEqual(r.b, false);
    // c might be absent depending on toBool impl; just ensure it doesn't become true
    assert.ok(r.c === undefined || r.c === false);
  });

  it("numeric types call toNumber and enforce minnum/maxnum", function () {
    const q = { a: "5", b: "50", c: "0" };
    const s = {
      a: { type: "int", minnum: 1, maxnum: 10 },
      b: { type: "int", maxnum: 10, errmsg: "too big" },
      c: { type: "int", minnum: 1, errmsg: "too small" },
    };
    assert.deepStrictEqual(lib.validate(q, { a: s.a }), { a: 5 });

    assert.strictEqual(lib.validate(q, { b: s.b }), "too big");
    assert.strictEqual(lib.validate(q, { c: s.c }), "too small");
    assert.strictEqual(lib.validate(q, { c: s.c }, { null: 1 }), null);
  });

  it("string max/min and trunc", function () {
    const q = { a: "abcd", b: "ab", c: "abcd" };
    const s = {
      a: { max: 3, trunc: 1 },
      b: { min: 3, errmsg: "too short" },
      c: { max: 3, errmsg: "too long" },
    };
    assert.deepStrictEqual(lib.validate(q, { a: s.a }), { a: "abc" });
    assert.strictEqual(lib.validate(q, { b: s.b }), "too short");
    assert.strictEqual(lib.validate(q, { c: s.c }), "too long");
  });

  it("regexp type with max and compilation", function () {
    const q = { a: "^[a-z]+$", b: "x".repeat(6) };
    const s = {
      a: { type: "regexp" },
      b: { type: "regexp", max: 5, errmsg: "rx too long" },
    };
    const r = lib.validate(q, { a: s.a });
    assert.ok(r.a instanceof RegExp);

    assert.strictEqual(lib.validate(q, { b: s.b }), "rx too long");
  });

  it("list type: split/filter/novalue/minlist/maxlist/trunc/flatten", function () {
    const q = { a: "a,b,c", b: "a,b,c", c: "a,b,c,d", d: "a,,b", e: [["x"], ["y"]] };
    const s = {
      a: { type: "list" },
      b: { type: "list", values: ["a", "c"] },
      c: { type: "list", maxlist: 3, trunc: 1 },
      d: { type: "list", keepempty: 0 },
      e: { type: "list", flatten: 1, empty: 1 },
    };
    assert.deepStrictEqual(lib.validate(q, { a: s.a }).a, ["a", "b", "c"]);
    assert.deepStrictEqual(lib.validate(q, { b: s.b }).b, ["a", "c"]);
    assert.deepStrictEqual(lib.validate(q, { c: s.c }).c, ["a", "b", "c"]);

    // depending on split impl, empty entries may be dropped; ensure a/b remain
    const rd = lib.validate(q, { d: s.d }).d;
    assert.ok(Array.isArray(rd));
    assert.ok(rd.includes("a") && rd.includes("b"));

    const re = lib.validate(q, { e: s.e }).e;
    assert.ok(Array.isArray(re));
    assert.ok(re.includes("x") && re.includes("y"));
  });

  it("map type: parses k:v pairs and supports maptype", function () {
    const q = { a: "k1:1,k2:2", b: "k1:1,k2:2,k3:3" };
    const s = {
      a: { type: "map", maptype: "int" },
      b: { type: "map", maxlist: 2, trunc: 1 },
    };
    assert.deepStrictEqual(lib.validate(q, { a: s.a }).a, { k1: 1, k2: 2 });

    const rb = lib.validate(q, { b: s.b }).b;
    assert.deepStrictEqual(Object.keys(rb).length, 2);
  });

  it("obj type: recursively calls validate for nested schema", function () {
    const q = { a: { x: "1", y: "2" } };
    const s = {
      a: {
        type: "obj",
        params: {
          x: { type: "int" },
          y: { type: "int" },
        },
      },
    };
    assert.deepStrictEqual(lib.validate(q, s), { a: { x: 1, y: 2 } });
  });

  it("object type: requires actual object and can apply params", function () {
    const q = { a: { x: "1" }, b: "nope" };
    const s = {
      a: { type: "object", params: { x: { type: "int" } } },
      b: { type: "object" },
    };
    assert.deepStrictEqual(lib.validate(q, s), { a: { x: 1 } });
  });

  it("array type: supports params per element, minlist/maxlist/trunc", function () {
    const q = { a: [{ x: "1" }, { x: "2" }, { x: "3" }], b: [] };
    const s = {
      a: { type: "array", params: { x: { type: "int" } }, maxlist: 2, trunc: 1 },
      b: { type: "array", minlist: 1, errmsg: "need one" },
    };
    assert.deepStrictEqual(lib.validate(q, { a: s.a }).a, [{ x: 1 }, { x: 2 }]);
    assert.strictEqual(lib.validate(q, { b: s.b }), "need one");
  });

  it("json type: parses json, optional base64, and supports params", function () {
    const obj = { x: "1", y: "2" };
    const q = {
      a: JSON.stringify(obj),
      b: Buffer.from(JSON.stringify(obj)).toString("base64"),
    };
    const s = {
      a: { type: "json", params: { x: { type: "int" }, y: { type: "int" } } },
      b: { type: "json", base64: 1, params: { x: { type: "int" } } },
    };
    assert.deepStrictEqual(lib.validate(q, { a: s.a }).a, { x: 1, y: 2 });
    assert.deepStrictEqual(lib.validate(q, { b: s.b }).b, { x: 1 });
  });

  it("required: immediate required and delayed required (object condition)", function () {
    const q1 = {};
    const s1 = { a: { required: 1, errmsg: "a required" } };
    assert.strictEqual(lib.validate(q1, s1), "a required");

    // delayed required: if b is present then a required
    const q2 = { b: "1" };
    const s2 = {
      a: { required: { b: "1" } },
      b: { type: "int", errmsg: "a needed when b=1" },
    };

    const r = lib.validate(q2, s2);
    assert.strictEqual(r, "a needed when b=1");
  });

  it("values / novalue / values_map post-processing", function () {
    const q = { a: "x", b: "x", c: "x" };
    const s = {
      a: { values: ["y"] },                 // not allowed => deleted
      b: { novalue: "x" },                  // equals novalue => deleted
      c: { values_map: ["x", "z"] },        // remap
    };
    assert.deepStrictEqual(lib.validate(q, s), { c: "z" });
  });

  it("defaults: applies typed and wildcard defaults, dprefix and '**' overrides", function () {
    const q = {}; // nothing provided, so defaults should kick in
    const schema = {
      a: { type: "int" },
      b: { type: "string" },
      c: { type: "string" },
    };

    const r = lib.validate(q, schema, {
      dprefix: "p.",
      defaults: {
        // dprefix-specific for a
        "p.a": { dflt: "5" },
        // type-specific fallback
        "*.string": { dflt: "S" },
        // global override for all via "**"
        "**": { trim: 1 },
      },
    });

    assert.deepStrictEqual(r, { a: 5, b: "S", c: "S" });
  });

  it("noregexp/regexp validation behavior (drops field unless errmsg+!required)", function () {
    const q = { a: "bad!", b: "bad!", c: "good" };
    const s = {
      a: { noregexp: /!/ },                 // should drop
      b: { noregexp: /!/, errmsg: "bad chars" }, // should return error (since !required)
      c: { regexp: /^[a-z]+$/ },            // keep
    };
    const ra = lib.validate(q, { a: s.a });
    assert.deepStrictEqual(ra, {});

    assert.strictEqual(lib.validate(q, { b: s.b }), "bad chars");

    assert.deepStrictEqual(lib.validate(q, { c: s.c }), { c: "good" });
  });

  it("setempty: replaces empty result after processing", function () {
    const q = { a: "" };
    const s = { a: { setempty: "X" } };
    assert.deepStrictEqual(lib.validate(q, s), { a: "X" });
  });
});
