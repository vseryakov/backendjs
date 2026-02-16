
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { lib } = require("../");

describe("lib.encrypt", function () {
  it("returns empty string for missing key, data", function () {
    let out = lib.encrypt(null, "data");
    assert.strictEqual(out, "");
    out = lib.encrypt("key", null);
    assert.strictEqual(out, "");
  });

  it("defaults to base64 string output", function () {
    const out = lib.encrypt("secret", "hello");
    assert.strictEqual(typeof out, "string");
    // base64 sanity: only allowed chars and padding
    assert.match(out, /^[A-Za-z0-9+/]+={0,2}$/);
  });

  it("can output hex string when encode=hex", function () {
    const out = lib.encrypt("secret", "hello", { encode: "hex" });
    assert.strictEqual(typeof out, "string");
    assert.match(out, /^[0-9a-f]+$/i);
  });

  it('returns Buffer when encode="binary"', function () {
    const out = lib.encrypt("secret", "hello", { encode: "binary" });
    assert.ok(Buffer.isBuffer(out));
    assert.ok(out.length > 0);
  });

  it("buffer output layout is: iv + tag + ciphertext", function () {
    const opts = { encode: "binary", iv_length: 16, tag_length: 16 };
    const out = lib.encrypt("secret", "hello", opts);

    assert.ok(Buffer.isBuffer(out));
    assert.ok(out.length > opts.iv_length + opts.tag_length);

    const iv = out.subarray(0, opts.iv_length);
    const tag = out.subarray(opts.iv_length, opts.iv_length + opts.tag_length);
    const ct = out.subarray(opts.iv_length + opts.tag_length);

    assert.strictEqual(iv.length, 16);
    assert.strictEqual(tag.length, 16);
    assert.ok(ct.length > 0);
  });

  it("same input twice produces different output (random iv)", function () {
    const a = lib.encrypt("secret", "hello", { encode: "base64" });
    const b = lib.encrypt("secret", "hello", { encode: "base64" });
    assert.notStrictEqual(a, b);
  });

  it("supports Buffer key and Buffer data", function () {
    const out = lib.encrypt(Buffer.from("secret"), Buffer.from("hello"), { encode: "binary" });
    assert.ok(Buffer.isBuffer(out));
    assert.ok(out.length > 0);
  });

  it("uses custom iv_length/tag_length", function () {
    const opts = { encode: "binary", iv_length: 12, tag_length: 16 }; // common GCM IV size
    const enc = lib.encrypt("secret", "hello", opts);

    const iv = enc.subarray(0, opts.iv_length);
    const tag = enc.subarray(opts.iv_length, opts.iv_length + opts.tag_length);

    assert.strictEqual(iv.length, 12);
    assert.strictEqual(tag.length, 16);

    const dec = lib.decrypt("secret", enc, opts);

    assert.deepStrictEqual(dec, "hello");
  });

  it("can be decrypted using the same derivation parameters (aes-256-gcm)", function () {
    const opts = { encode: "binary", decode: "binary" };
    const plaintext = Buffer.from("hello world");
    const key = "secret";

    const enc = lib.encrypt(key, plaintext, opts);
    assert.ok(Buffer.isBuffer(enc));

    const dec = lib.decrypt(key, enc, opts);
    assert.deepStrictEqual(dec, plaintext);
  });

  it("returns empty string on invalid algorithm", function () {
    const out = lib.encrypt("secret", "hello", { algorithm: "nope-123" });
    assert.strictEqual(out, "");
  });

  it("returns empty string on invalid key length for algorithm", function () {
    // aes-256-gcm expects 32-byte key; force wrong length
    const out = lib.encrypt("secret", "hello", { key_length: 16 });
    assert.strictEqual(out, "");
  });
});
