//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const crypto = require('crypto');
const logger = require(__dirname + '/../logger');
const lib = require(__dirname + '/../lib');
const Hashids = require("hashids/cjs");
const uuid = require('uuid');
const os = require('os');

// Encrypt data with the given key code
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
        const cipher = crypto.createCipheriv(options.algorithm || 'aes-256-cbc', password, iv);
        var msg = Buffer.concat([iv, cipher.update(data), cipher.final()]);
        if (encode) msg = msg.toString(encode);
    } catch (e) {
        msg = '';
        logger.debug('encrypt:', options, e.stack);
    }
    return msg;
}

// Decrypt data with the given key code
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
        const decipher = crypto.createDecipheriv(options.algorithm || 'aes-256-cbc', password, iv);
        var msg = Buffer.concat([decipher.update(data.slice(16)), decipher.final()]).toString("utf8");
    } catch (e) {
        msg = '';
        logger.debug('decrypt:', options, e.stack);
    }
    return msg;
}

// HMAC signing and base64 encoded, default algorithm is sha1
lib.sign = function (key, data, algorithm, encode)
{
    try {
        key = Buffer.isBuffer(key) ? key : String(key);
        data = Buffer.isBuffer(data) ? data : String(data);
        encode = encode === "binary" ? undefined : encode || "base64";
        return crypto.createHmac(algorithm || "sha1", key).update(data).digest(encode);
    } catch (e) {
        logger.error('sign:', algorithm, encode, e.stack);
        return "";
    }
}

// Hash and base64 encoded, default algorithm is sha1
lib.hash = function (data, algorithm, encode)
{
    try {
        data = Buffer.isBuffer(data) ? data : String(data);
        encode = encode === "binary" ? undefined : encode || "base64";
        return crypto.createHash(algorithm || "sha1").update(data).digest(encode);
    } catch (e) {
        logger.error('hash:', algorithm, encode, e.stack);
        return "";
    }
}

// Return cached Hashids object for the given configuration
lib.getHashid = function(salt, min, alphabet, separators)
{
    min = min || 0;
    salt = salt || this.salt;
    alphabet = alphabet || this.base62;
    separators = separators || "";
    var key = salt + min + alphabet + separators;
    if (!this.hashids[key]) {
        this.hashids[key] = new Hashids(salt, lib.toNumber(min), alphabet, separators);
        this.hashids[key]._counter = process.pid;
    }
    if (++this.hashids[key]._counter > 65535) this.hashids[key]._counter = 1;
    return this.hashids[key];
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

// Return unique Id without any special characters and in lower case
lib.uuid = function(prefix, options)
{
    var u = uuid.v4(options);
    return typeof u == "string" ? (prefix || "") + u.replace(/[-]/g, '').toLowerCase() : u;
}

// Returns a short unique id
lib.suuid = function(prefix, options)
{
    if (!options) options = this.empty;
    var hashid = this.getHashid(options.salt, options.min, options.alphabet);
    var tm = lib.getTimeOfDay();
    var s = hashid.encode(tm[0], tm[1], hashid._counter);
    return prefix ? prefix + s : s;
}

// Returns time sortable unique id, inspired by https://github.com/paixaop/node-time-uuid
lib.tuuid = function(prefix, encode)
{
    if (!this._hostHash) {
        var b = Buffer.from(crypto.createHash('sha512').update(os.hostname(), 'ascii').digest('binary'));
        this._hostHash = Buffer.from([b[1], b[3], b[5], (process.pid) & 0xFF, (process.pid >> 8) & 0xFF ]);
        this._hostCounter = 0;
    }
    // Must fit into 3 bytes only
    if (++this._hostCounter >= 8388607) this._hostCounter = 1;
    var tm = this.getTimeOfDay();
    var s = Buffer.from([tm[0] >> 24,
                         tm[0] >> 16,
                         tm[0] >> 8,
                         tm[0],
                         tm[1] >> 16,
                         tm[1] >> 8,
                         tm[1],
                         this._hostHash[0],
                         this._hostHash[1],
                         this._hostHash[2],
                         this._hostHash[3],
                         this._hostHash[4],
                         this._hostCounter >> 16,
                         this._hostCounter >> 8,
                         this._hostCounter ]);
    if (encode != "binary") s = s.toString(encode || "hex");
    return prefix ? prefix + s : s;
}

// Return time in milliseconds from the time uuid
lib.tuuidTime = function(str)
{
    if (typeof str != "string" || !str) return 0;
    var idx = str.indexOf("_");
    if (idx > 0) str = str.substr(idx + 1);
    var bytes = Buffer.from(str, 'hex');
    var secs = bytes.length > 4 ? bytes.readUInt32BE(0) : 0;
    var usecs = bytes.length > 7 ? bytes.readUInt32BE(3) & 0x00FFFFFF : 0;
    return secs*1000 + (usecs/1000);
}

// Timing safe string compare using double HMAC, from suryagh/tsscmp
lib.timingSafeEqual = function(a, b)
{
    var sa = String(a);
    var sb = String(b);
    var key = crypto.pseudoRandomBytes(32);
    var ah = crypto.createHmac('sha256', key).update(sa).digest();
    var bh = crypto.createHmac('sha256', key).update(sb).digest();
    return crypto.timingSafeEqual(ah, bh) && a === b;
}

