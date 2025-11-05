/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const Hashids = require("hashids/cjs");
const crypto = require('node:crypto');
const logger = require(__dirname + '/../logger');
const lib = require(__dirname + '/../lib');

// Hash and base64 encoded, default algorithm is sha1, uses node crypto module which is based on OLpenSSL
lib.hash = function (data, algorithm, encode)
{
    encode = encode === "binary" ? undefined : encode || "base64";
    try {
        return crypto.createHash(algorithm || "sha1").update(data || "").digest(encode);
    } catch (e) {
        logger.error('hash:', algorithm, encode, e.stack);
        return "";
    }
}

/**
 * Return cached Hashids object for the given configuration
 * Properties:
 * - salt - hashid salt, default is lib.salt
 * - min - minimum size of a hashid
 * - alphabet - chars allowed in hashids, default is lib.base32
 * - separators - hashid separator characters
 * - counter - max counter value to wrap back to 1, default is 65535
 */
lib.getHashid = function(options)
{
    var min = options?.min || 0;
    var salt = options?.salt || this.salt;
    var alphabet = options?.alphabet || this.base62;
    var separators = options?.separators || "";
    var key = salt + min + alphabet + separators;
    if (!this.hashids[key]) {
        this.hashids[key] = new Hashids(salt, lib.toNumber(min), alphabet, separators);
        this.hashids[key]._counter = lib.randomShort();
    }
    if (++this.hashids[key]._counter > (options?.counter || 65535)) {
        this.hashids[key]._counter = 1;
    }
    return this.hashids[key];
}

// 32-bit MurmurHash3 implemented by bryc (github.com/bryc)
lib.murmurHash3 = function(key, seed = 0)
{
    if (typeof key != "string") return 0;

    var k, p1 = 3432918353, p2 = 461845907, h = seed | 0;

    for (var i = 0, b = key.length & -4; i < b; i += 4) {
        k = key[i+3] << 24 | key[i+2] << 16 | key[i+1] << 8 | key[i];
        k = Math.imul(k, p1); k = k << 15 | k >>> 17;
        h ^= Math.imul(k, p2); h = h << 13 | h >>> 19;
        h = Math.imul(h, 5) + 3864292196 | 0;
    }

    k = 0;
    switch (key.length & 3) {
        case 3: k ^= key[i+2] << 16;
        case 2: k ^= key[i+1] << 8;
        case 1: k ^= key[i];
                k = Math.imul(k, p1); k = k << 15 | k >>> 17;
                h ^= Math.imul(k, p2);
    }

    h ^= key.length;
    h ^= h >>> 16; h = Math.imul(h, 2246822507);
    h ^= h >>> 13; h = Math.imul(h, 3266489909);
    h ^= h >>> 16;

    return h >>> 0;
}
