
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

describe("lib.decrypt", function () {
  it("returns empty string for missing key/data", function () {
    assert.strictEqual(lib.decrypt(null, "data"), "");
    assert.strictEqual(lib.decrypt("key", null), "");
  });

  it("roundtrips base64 encoded data", function () {
    const enc = lib.encrypt("secret", "hello world");
    assert.strictEqual(lib.decrypt("secret", enc), "hello world");
  });

  it("roundtrips hex encoded data", function () {
    const enc = lib.encrypt("secret", "hello", { encode: "hex" });
    assert.strictEqual(lib.decrypt("secret", enc, { encode: "hex" }), "hello");
  });

  it("returns empty string with wrong key", function () {
    const enc = lib.encrypt("secret", "hello");
    assert.strictEqual(lib.decrypt("wrong", enc), "");
  });

  it("returns Buffer with decode=binary", function () {
    const enc = lib.encrypt("secret", "hello", { encode: "binary" });
    const dec = lib.decrypt("secret", enc, { encode: "binary", decode: "binary" });
    assert.ok(Buffer.isBuffer(dec));
    assert.strictEqual(dec.toString(), "hello");
  });

  it("returns empty string on corrupted data", function () {
    const enc = lib.encrypt("secret", "hello", { encode: "binary" });
    enc[enc.length - 1] ^= 0xff;
    assert.strictEqual(lib.decrypt("secret", enc, { encode: "binary" }), "");
  });
});

describe("lib.randomBytes", function () {
  it("defaults to 8 bytes as hex (16 chars)", function () {
    const out = lib.randomBytes();
    assert.strictEqual(typeof out, "string");
    assert.strictEqual(out.length, 16);
    assert.match(out, /^[0-9a-f]+$/);
  });

  it("honors requested size", function () {
    assert.strictEqual(lib.randomBytes(4).length, 8);
    assert.strictEqual(lib.randomBytes(16).length, 32);
  });

  it("returns a Buffer with encode=binary", function () {
    const out = lib.randomBytes(4, "binary");
    assert.ok(Buffer.isBuffer(out));
    assert.strictEqual(out.length, 4);
  });

  it("supports other encodings", function () {
    const out = lib.randomBytes(6, "base64");
    assert.strictEqual(typeof out, "string");
    assert.match(out, /^[A-Za-z0-9+/]+={0,2}$/);
  });

  it("produces different values each call", function () {
    assert.notStrictEqual(lib.randomBytes(16), lib.randomBytes(16));
  });
});

describe("lib.sign", function () {
  const crypto = require("node:crypto");

  it("defaults to sha256 base64 HMAC", function () {
    const out = lib.sign("key", "data");
    assert.strictEqual(out, crypto.createHmac("sha256", "key").update("data").digest("base64"));
  });

  it("supports hex encoding", function () {
    const out = lib.sign("key", "data", "sha256", "hex");
    assert.strictEqual(out, crypto.createHmac("sha256", "key").update("data").digest("hex"));
  });

  it("supports different algorithm", function () {
    const out = lib.sign("key", "data", "sha1", "hex");
    assert.strictEqual(out, crypto.createHmac("sha1", "key").update("data").digest("hex"));
  });

  it("returns a Buffer with binary encoding", function () {
    const out = lib.sign("key", "data", "sha256", "binary");
    assert.ok(Buffer.isBuffer(out));
  });

  it("handles empty key and data", function () {
    assert.strictEqual(typeof lib.sign(), "string");
  });

  it("returns empty string on invalid algorithm", function () {
    assert.strictEqual(lib.sign("key", "data", "nope-123"), "");
  });
});

describe("lib.random", function () {
  it("returns a non-empty string", function () {
    assert.ok(lib.random().length > 0);
  });

  it("strips =, + and % characters", function () {
    for (let i = 0; i < 20; i++) {
      assert.ok(!/[=+%]/.test(lib.random()));
    }
  });

  it("produces different values", function () {
    assert.notStrictEqual(lib.random(), lib.random());
  });
});

describe("random number generators", function () {
  it("randomUShort in [0, 65535]", function () {
    for (let i = 0; i < 1000; i++) {
      const n = lib.randomUShort();
      assert.ok(Number.isInteger(n) && n >= 0 && n <= 65535);
    }
  });

  it("randomShort is non-negative", function () {
    for (let i = 0; i < 1000; i++) {
      const n = lib.randomShort();
      assert.ok(Number.isInteger(n) && n >= 0 && n <= 32768);
    }
  });

  it("randomUInt is a non-negative integer", function () {
    for (let i = 0; i < 100; i++) {
      const n = lib.randomUInt();
      assert.ok(Number.isInteger(n) && n >= 0);
    }
  });

  it("randomFloat in [0, 1)", function () {
    for (let i = 0; i < 1000; i++) {
      const n = lib.randomFloat();
      assert.ok(n >= 0 && n < 1);
    }
  });

  it("randomInt in [min, max]", function () {
    for (let i = 0; i < 5000; i++) {
      const n = lib.randomInt(0, 7);
      assert.ok(Number.isInteger(n) && n >= 0 && n <= 7);
    }
  });

  it("randomNum in [min, max)", function () {
    for (let i = 0; i < 1000; i++) {
      const n = lib.randomNum(1, 2);
      assert.ok(n >= 1 && n < 2);
    }
  });

  it("randomNum respects decimals", function () {
    const n = lib.randomNum(1, 2, 2);
    assert.strictEqual(n, Number.parseFloat(n.toFixed(2)));
  });
});

describe("lib.timingSafeEqual", function () {
  it("returns true for equal strings", function () {
    assert.strictEqual(lib.timingSafeEqual("abc", "abc"), true);
  });

  it("returns false for different strings of same length", function () {
    assert.strictEqual(lib.timingSafeEqual("abc", "abd"), false);
  });

  it("returns false for different length strings", function () {
    assert.strictEqual(lib.timingSafeEqual("abc", "ab"), false);
  });

  it("compares equal buffers", function () {
    assert.strictEqual(lib.timingSafeEqual(Buffer.from("xyz"), Buffer.from("xyz")), true);
    assert.strictEqual(lib.timingSafeEqual(Buffer.from("xyz"), Buffer.from("xya")), false);
  });

  it("returns false for mixed or invalid types", function () {
    assert.strictEqual(lib.timingSafeEqual("abc", Buffer.from("abc")), false);
    assert.strictEqual(lib.timingSafeEqual(123, 123), false);
    assert.strictEqual(lib.timingSafeEqual(null, null), false);
  });
});

describe("lib.totp", function () {
  // RFC6238 test vector: SHA1 secret "12345678901234567890"
  const key = lib.toBase32(Buffer.from("12345678901234567890"));

  it("returns 0 for non-string key", function () {
    assert.strictEqual(lib.totp(123), 0);
  });

  it("matches RFC6238 test vector at T=59", function () {
    assert.strictEqual(lib.totp(key, { time: 59000 }), "287082");
  });

  it("is stable for the same time window", function () {
    assert.strictEqual(lib.totp(key, { time: 1111111109000 }), lib.totp(key, { time: 1111111109000 }));
  });

  it("produces the requested number of digits", function () {
    assert.strictEqual(lib.totp(key, { time: 59000 }).length, 6);
    assert.strictEqual(lib.totp(key, { time: 59000, digits: 8 }).length, 8);
  });
});

describe("lib.toSkip32", function () {
  const key = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  it("roundtrips encrypt/decrypt", function () {
    for (const num of [0, 1, 123456, 4294967295]) {
      const enc = lib.toSkip32("e", key, num);
      assert.strictEqual(lib.toSkip32("d", key, enc), num);
    }
  });

  it("produces an unsigned 32-bit integer", function () {
    const enc = lib.toSkip32("e", key, 123456);
    assert.ok(Number.isInteger(enc) && enc >= 0 && enc <= 4294967295);
  });

  it("encryption differs from input", function () {
    assert.notStrictEqual(lib.toSkip32("e", key, 123456), 123456);
  });

  it("is deterministic for the same key", function () {
    assert.strictEqual(lib.toSkip32("e", key, 999), lib.toSkip32("e", key, 999));
  });
});

describe("lib.prepareSecret / lib.checkSecret", function () {
  it("prepares an encrypted:salt secret", function (t, done) {
    lib.prepareSecret("password123", (err, secret) => {
      assert.ifError(err);
      assert.match(secret, /^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
      done();
    });
  });

  it("calls back with nothing for empty text", function (t, done) {
    lib.prepareSecret("", (err, secret) => {
      assert.ifError(err);
      assert.strictEqual(secret, undefined);
      done();
    });
  });

  it("verifies a correct password", function (t, done) {
    lib.prepareSecret("password123", (err, secret) => {
      assert.ifError(err);
      lib.checkSecret(secret, "password123", (err2, ok) => {
        assert.ifError(err2);
        assert.strictEqual(ok, true);
        done();
      });
    });
  });

  it("rejects an incorrect password", function (t, done) {
    lib.prepareSecret("password123", (err, secret) => {
      assert.ifError(err);
      lib.checkSecret(secret, "wrong", (err2, ok) => {
        assert.ifError(err2);
        assert.strictEqual(ok, false);
        done();
      });
    });
  });

  it("calls back with nothing for missing args", function (t, done) {
    lib.checkSecret("", "password", (err, ok) => {
      assert.ifError(err);
      assert.strictEqual(ok, undefined);
      done();
    });
  });
});

describe("lib.aprepareSecret / lib.acheckSecret", function () {
  it("prepares and verifies a secret", async function () {
    const { err, secret } = await lib.aprepareSecret("secretpass");
    assert.ifError(err);
    assert.match(secret, /^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);

    const good = await lib.acheckSecret(secret, "secretpass");
    assert.ifError(good.err);
    assert.strictEqual(good.ok, true);

    const bad = await lib.acheckSecret(secret, "nope");
    assert.strictEqual(bad.ok, false);
  });

  it("resolves undefined secret for empty text", async function () {
    const { secret } = await lib.aprepareSecret("");
    assert.strictEqual(secret, undefined);
  });
});
