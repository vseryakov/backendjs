//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const crypto = require('node:crypto');
const logger = require(__dirname + '/../logger');
const lib = require(__dirname + '/../lib');

// Generates cryptographically strong pseudorandom data. The size argument is a number indicating the number of bytes to generate.
// By default encode is "hex", can be any encoding supported by Buffer, "binary" returns Buffer itself.
lib.randomBytes = function(size, encode)
{
    var b = crypto.randomBytes(this.toNumber(size, { min: 0, dflt: 8 }));
    return encode === "binary" ? b : b.toString(encode || "hex");
}

// Encrypt data with the given key, GCM mode is default
lib.encrypt = function(key, data, options)
{
    if (!key || !data) return '';
    try {
        options = options || this.empty;
        const encode = options.encode === "binary" ? undefined : options.encode || "base64";
        key = Buffer.isBuffer(key) ? key : typeof key == "string" ? key : String(key);
        data = Buffer.isBuffer(data) ? data : Buffer.from(typeof data == "string" ? data : String(data));
        const iv = crypto.randomBytes(options.iv_length || 16);
        const password = crypto.pbkdf2Sync(key, iv.toString(), options.key_iterations || 10000, options.key_length || 32, options.key_hash || 'sha256');
        const cipher = crypto.createCipheriv(options.algorithm || 'aes-256-gcm', password, iv, { authTagLength: options.tag_length || 16 });
        var msg = Buffer.concat([cipher.update(data), cipher.final()]);
        msg = Buffer.concat([iv, cipher.getAuthTag(), msg]);
        if (encode) msg = msg.toString(encode);
    } catch (e) {
        msg = '';
        logger.debug('encrypt:', options, e.stack);
    }
    return msg;
}

// Decrypt data with the given key, GCM mode is default
lib.decrypt = function(key, data, options)
{
    if (!key || !data) return '';
    try {
        options = options || this.empty;
        const encode = options.encode === "binary" ? undefined : options.encode || "base64";
        key = Buffer.isBuffer(key) ? key : typeof key == "string" ? key : String(key);
        data = Buffer.isBuffer(data) ? data : Buffer.from(typeof data == "string" ? data : String(data), encode);
        const iv = data.slice(0, options.iv_length || 16);
        const password = crypto.pbkdf2Sync(key, iv.toString(), options.key_iterations || 10000, options.key_length || 32, options.key_hash || 'sha256');
        const decipher = crypto.createDecipheriv(options.algorithm || 'aes-256-gcm', password, iv, { authTagLength: options.tag_length || 16 });
        const tag = data.slice(iv.length, iv.length + (options.tag_length || 16));
        decipher.setAuthTag(tag);
        var msg = Buffer.concat([decipher.update(data.slice(iv.length + tag.length)), decipher.final()]).toString("utf8");
    } catch (e) {
        msg = '';
        logger.debug('decrypt:', options, e.stack);
    }
    return msg;
}

// HMAC signing and base64 encoded, default algorithm is sha1
lib.sign = function (key, data, algorithm, encode)
{
    encode = encode === "binary" ? undefined : encode || "base64";
    try {
        return crypto.createHmac(algorithm || "sha1", key || "").update(data || "").digest(encode);
    } catch (e) {
        logger.error('sign:', algorithm, encode, e.stack);
        return "";
    }
}

// Generate random key, size if specified defines how many random bits to generate
lib.random = function(size)
{
    return this.sign(crypto.randomBytes(64), crypto.randomBytes(size || 256), 'sha256').replace(/[=+%]/g, '');
}

// Return random number between 0 and USHORT_MAX
lib.randomUShort = function()
{
    return crypto.randomBytes(2).readUInt16LE(0);
}

// Return random number between 0 and SHORT_MAX
lib.randomShort = function()
{
    return Math.abs(crypto.randomBytes(2).readInt16LE(0));
}

// Return random number between 0 and ULONG_MAX
lib.randomUInt = function()
{
    return crypto.randomBytes(6).readUIntLE(0, 6);
}

// Returns random number between 0 and 1, 32 bits
lib.randomFloat = function()
{
    return parseFloat("0." + crypto.randomBytes(4).readUInt32LE(0));
}

// Return random integer between min and max inclusive using crypto generator, based on
// https://github.com/joepie91/node-random-number-csprng
lib.randomInt = function(min, max)
{
    min = this.toClamp(min, 0, 429497294);
    max = this.toClamp(max, 0, 429497295);
    if (max <= min) max = 429497295;
    var bits = Math.ceil(Math.log2(max - min));
    var bytes = Math.ceil(bits / 8);
    var mask = Math.pow(2, bits) - 1, n;
    for (var t = 0; t < 3; t++) {
        var d = crypto.randomBytes(bytes);
        n = 0;
        for (var i = 0; i < bytes; i++) n |= d[i] << 8 * i;
        n = n & mask;
        if (n <= max - min) break;
    }
    return min + n;
}

// Generates a random number between given min and max (required)
// Optional third parameter indicates the number of decimal points to return:
//   - If it is not given or is NaN, random number is unmodified
//   - If >0, then that many decimal points are returned (e.g., "2" -> 12.52
lib.randomNum = function(min, max, decs)
{
    var num = min + (this.randomFloat() * (max - min));
    return (typeof decs !== 'number' || decs <= 0) ? num : parseFloat(num.toFixed(decs));
}

// Timing safe string compare using double HMAC, from suryagh/tsscmp
lib.timingSafeEqual = function(a, b)
{
    if (typeof a == "string" && typeof b == "string") {
        return a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
    } else
    if (Buffer.isBuffer(a) && Buffer.isBuffer(b)) {
        return a.length === b.length && crypto.timingSafeEqual(a, b);
    }
    return false;
}

//
// Create a Timed One-Time Password, RFC6328
//
lib.totp = function(key, options)
{
    if (typeof key != "string") return 0;
    const time = Buffer.from(Math.floor((options?.time || Date.now()) / 1000 / (options?.interval || 30)).toString(16).padStart(16, "0"), "hex");
    const hmac = lib.sign(this.fromBase32(key.toUpperCase()), time, options?.algorithm || "sha1", "binary");
    const offset = hmac[hmac.length - 1] & 0xf;
    const code = (hmac[offset] & 0x7f) << 24 | (hmac[offset + 1] & 0xff) << 16 | (hmac[offset + 2] & 0xff) << 8 | (hmac[offset + 3] & 0xff);
    return (code % Math.pow(10, options?.digits || 6)).toString().padStart(options?.digits || 6, '0');
}

// based on public domain javascript implementation of:
//
//   SKIP32 -- 32 bit block cipher based on SKIPJACK.
//   Written by Greg Rose, QUALCOMM Australia, 1999/04/27.
//   In common: F-table, G-permutation, key schedule.
//   Different: 24 round feistel structure.
//   Based on:  Unoptimized test implementation of SKIPJACK algorithm Panu Rissanen <bande@lut.fi>
//   SKIPJACK and KEA Algorithm Specifications
//   Version 2.0
//   29 May 1998
//

const _skip32table = [
    0xa3,0xd7,0x09,0x83,0xf8,0x48,0xf6,0xf4,0xb3,0x21,0x15,0x78,0x99,0xb1,0xaf,0xf9,
    0xe7,0x2d,0x4d,0x8a,0xce,0x4c,0xca,0x2e,0x52,0x95,0xd9,0x1e,0x4e,0x38,0x44,0x28,
    0x0a,0xdf,0x02,0xa0,0x17,0xf1,0x60,0x68,0x12,0xb7,0x7a,0xc3,0xe9,0xfa,0x3d,0x53,
    0x96,0x84,0x6b,0xba,0xf2,0x63,0x9a,0x19,0x7c,0xae,0xe5,0xf5,0xf7,0x16,0x6a,0xa2,
    0x39,0xb6,0x7b,0x0f,0xc1,0x93,0x81,0x1b,0xee,0xb4,0x1a,0xea,0xd0,0x91,0x2f,0xb8,
    0x55,0xb9,0xda,0x85,0x3f,0x41,0xbf,0xe0,0x5a,0x58,0x80,0x5f,0x66,0x0b,0xd8,0x90,
    0x35,0xd5,0xc0,0xa7,0x33,0x06,0x65,0x69,0x45,0x00,0x94,0x56,0x6d,0x98,0x9b,0x76,
    0x97,0xfc,0xb2,0xc2,0xb0,0xfe,0xdb,0x20,0xe1,0xeb,0xd6,0xe4,0xdd,0x47,0x4a,0x1d,
    0x42,0xed,0x9e,0x6e,0x49,0x3c,0xcd,0x43,0x27,0xd2,0x07,0xd4,0xde,0xc7,0x67,0x18,
    0x89,0xcb,0x30,0x1f,0x8d,0xc6,0x8f,0xaa,0xc8,0x74,0xdc,0xc9,0x5d,0x5c,0x31,0xa4,
    0x70,0x88,0x61,0x2c,0x9f,0x0d,0x2b,0x87,0x50,0x82,0x54,0x64,0x26,0x7d,0x03,0x40,
    0x34,0x4b,0x1c,0x73,0xd1,0xc4,0xfd,0x3b,0xcc,0xfb,0x7f,0xab,0xe6,0x3e,0x5b,0xa5,
    0xad,0x04,0x23,0x9c,0x14,0x51,0x22,0xf0,0x29,0x79,0x71,0x7e,0xff,0x8c,0x0e,0xe2,
    0x0c,0xef,0xbc,0x72,0x75,0x6f,0x37,0xa1,0xec,0xd3,0x8e,0x62,0x8b,0x86,0x10,0xe8,
    0x08,0x77,0x11,0xbe,0x92,0x4f,0x24,0xc5,0x32,0x36,0x9d,0xcf,0xf3,0xa6,0xbb,0xac,
    0x5e,0x6c,0xa9,0x13,0x57,0x25,0xb5,0xe3,0xbd,0xa8,0x3a,0x01,0x05,0x59,0x2a,0x46,
];

function _round16(key, k, n)
{
    var g1 = (n >> 8) & 0xff;
    var g2 = (n >> 0) & 0xff;
    var g3 = _skip32table[g2 ^ key[(4 * k + 0) % 10]] ^ g1;
    var g4 = _skip32table[g3 ^ key[(4 * k + 1) % 10]] ^ g2;
    var g5 = _skip32table[g4 ^ key[(4 * k + 2) % 10]] ^ g3;
    var g6 = _skip32table[g5 ^ key[(4 * k + 3) % 10]] ^ g4;
    return (g5 << 8) + g6;
}

// Encrypt/decrypt a number using a 10 byte `key` array, `op` == `d` for decrypt, other is encrypt
lib.toSkip32 = function(op, key, n)
{
    var k = 0, d = 1;
    if (op == "d") k = 23, d = -1;
    var wl = (((n >> 24) & 0xff) << 8) + (((n >> 16) & 0xff) << 0);
    var wr = (((n >> 8) & 0xff) << 8) + (((n >> 0) & 0xff) << 0);
    for (let i = 0; i < 24/2; i++) {
        wr ^= _round16(key, k, wl) ^ k;
        k += d;
        wl ^= _round16(key, k, wr) ^ k;
        k += d;
    }
    return ((wr << 16) | wl) >>> 0;
}
