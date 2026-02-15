
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { lib } = require("../");

describe("toBase32", function () {
  it("returns empty string for non-buffer input", function () {
    assert.strictEqual(lib.toBase32(null), "");
    assert.strictEqual(lib.toBase32(undefined), "");
    assert.strictEqual(lib.toBase32("abc"), "");
    assert.strictEqual(lib.toBase32(new Uint8Array([1, 2, 3])), ""); // not a Buffer
    assert.strictEqual(lib.toBase32(123), "");
  });

  it("encodes empty buffer as empty string (no padding unless requested)", function () {
    assert.strictEqual(lib.toBase32(Buffer.alloc(0)), "");
    assert.strictEqual(lib.toBase32(Buffer.alloc(0), { padding: true }), "");
  });

  it("encodes RFC4648 base32 known vectors (no padding)", function () {
    // These match RFC 4648 Base32 test vectors (without '=' padding)
    assert.strictEqual(lib.toBase32(Buffer.from("f")), "MY");
    assert.strictEqual(lib.toBase32(Buffer.from("fo")), "MZXQ");
    assert.strictEqual(lib.toBase32(Buffer.from("foo")), "MZXW6");
    assert.strictEqual(lib.toBase32(Buffer.from("foob")), "MZXW6YQ");
    assert.strictEqual(lib.toBase32(Buffer.from("fooba")), "MZXW6YTB");
    assert.strictEqual(lib.toBase32(Buffer.from("foobar")), "MZXW6YTBOI");
  });

  it("encodes RFC4648 base32 known vectors (with padding)", function () {
    assert.strictEqual(lib.toBase32(Buffer.from("f"), { padding: true }), "MY======");
    assert.strictEqual(lib.toBase32(Buffer.from("fo"), { padding: true }), "MZXQ====");
    assert.strictEqual(lib.toBase32(Buffer.from("foo"), { padding: true }), "MZXW6===");
    assert.strictEqual(lib.toBase32(Buffer.from("foob"), { padding: true }), "MZXW6YQ=");
    assert.strictEqual(lib.toBase32(Buffer.from("fooba"), { padding: true }), "MZXW6YTB");
    assert.strictEqual(lib.toBase32(Buffer.from("foobar"), { padding: true }), "MZXW6YTBOI======");
  });

  it("supports custom alphabet", function () {
    // Use a simple rotated alphabet to prove option is applied
    const std = lib.base32 || "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    const rotated = std.slice(1) + std[0];

    const a = lib.toBase32(Buffer.from("foo")); // "MZXW6" with std alphabet
    const b = lib.toBase32(Buffer.from("foo"), { alphabet: rotated });

    assert.notStrictEqual(a, b);

    // If we map each character from std -> rotated, we should match `b`
    const map = new Map([...std].map((ch, i) => [ch, rotated[i]]));
    const expected = [...a].map((ch) => (ch === "=" ? "=" : map.get(ch))).join("");
    assert.strictEqual(b, expected);
  });

  it("produces only alphabet chars (and '=' when padded)", function () {
    const std = lib.base32 || "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    const out1 = lib.toBase32(Buffer.from([0, 1, 2, 3, 254, 255]));
    assert.ok([...out1].every((c) => std.includes(c)));

    const out2 = lib.toBase32(Buffer.from([0, 1, 2, 3, 254, 255]), { padding: true });
    assert.ok([...out2].every((c) => std.includes(c) || c === "="));
    assert.strictEqual(out2.length % 8, 0);
  });
});

