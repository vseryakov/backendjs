
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { lib } = require("../");

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
    assert.match(q, /email1 is required/);

    q = lib.toParams({ email: "a@a" }, schema, opts);
    assert.match(q, /email1 is required/);

    q = lib.toParams({ email1: "a@a" }, schema, opts);
    assert.match(q, /email1 is required/);

    q = lib.toParams({ email1: "a@a.com" }, schema, opts);
    assert.partialDeepStrictEqual(q, { page: 1, count: 1 });

    schema.email1.required = 0;
    q = lib.toParams({ page: 1000, count: 1000 }, schema, opts);
    assert.partialDeepStrictEqual(q, { page: 10, count: 100 });

    q = lib.toParams({ name: "1234567890" }, schema, opts);
    assert.strictEqual(q.name, "123456");

    q = lib.toParams({ descr: "1234567890" }, schema, opts);
    assert.match(q, /descr is too long/);

    q = lib.toParams({ descr: "<2345" }, schema, opts);
    assert.strictEqual(q.descr, "!2345");

    q = lib.toParams({ name: "test", descr: "test" }, schema, opts);
    assert.ok(!q.descr && q.name == "test");

    q = lib.toParams({ pair: "a:1,b:2" }, schema, opts);
    assert.partialDeepStrictEqual(q, { pair: { a: 1, b: 2 } });

    q = lib.toParams({ code: "12345" }, schema, opts);
    assert.match(q, /Valid code is required/);

    q = lib.toParams({ code: "q-123" }, schema, opts);
    assert.strictEqual(q.code, "q-123");

    q = lib.toParams({ code1: "q.123" }, schema, opts);
    assert.match(q, /Valid code1 is required/);

    q = lib.toParams({ start: "test" }, schema, opts);
    assert.ok(!q.start);

    q = lib.toParams({ start: lib.jsonToBase64("test", "test") }, schema, opts);
    assert.strictEqual(q.start,"test");

    q = lib.toParams({ tm: 1 }, schema, opts);
    assert.ok(q.ready == "ready" && q.tm == '1970-01-01T00:00:01.000Z');

    q = lib.toParams({ tm: Date.now() }, schema, opts);
    assert.match(q, /is too late/);

    q = lib.toParams({ mtime: '1970-01-01T00:00:01.000Z' }, schema, opts);
    assert.match(q, /is too soon/);

    schema.mtime.mindate = 0;
    q = lib.toParams({ mtime: '1970-01-01T00:00:01.000Z' }, schema, opts);
    assert.strictEqual(q.timestamp, 1000);

    q = lib.toParams({ state: "ok,done,error", flag: false }, schema, opts);
    assert.partialDeepStrictEqual(q.state, ["ok"]);
    assert.strictEqual(q.flag, undefined);

    q = lib.toParams({ obj: { id: "1", descr: "1", name: "1" } }, schema, opts);
    assert.deepStrictEqual(q.obj, { id: 1, name: "1" });

    q = lib.toParams({ object: { id: "1", descr: "1", name: "1" } }, schema, opts);
    assert.deepStrictEqual(q.object, { id: "1", descr: "1", name: "1" });

    q = lib.toParams({ json: lib.stringify({ id: "1", descr: "1", name: "1" }) }, schema, opts);
    assert.deepStrictEqual(q.json, { id: "1", descr: "1", name: "1" });

    q = lib.toParams({ json1: lib.stringify({ id: "1", descr: "1", name: "1" }) }, schema, opts);
    assert.deepStrictEqual(q.json1, { id: 1, name: "1" });

    q = lib.toParams({ empty: "." }, schema, opts);
    assert.strictEqual(q.empty, "");

    schema.empty.setempty = null;
    q = lib.toParams({ empty: "." }, schema, opts);
    assert.strictEqual(q.empty, null);

    q = lib.toParams({ nospecial: "a<b>c", special: "a<b>c" }, schema, opts);
    assert.strictEqual(q.special, "<>");
    assert.strictEqual(q.nospecial, "abc");

    q = lib.toParams({ minnum: 2 }, schema, opts);
    assert.match(q, /too small/);

    q = lib.toParams({ minnum: 20 }, schema, opts);
    assert.strictEqual(q.minnum, 20);

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
    assert.strictEqual(ENCRYPTED, e);
    assert.strictEqual(INPUT, d);

})

describe("toTemplate tests", () => {

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


