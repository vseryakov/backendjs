/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
'use strict';

const crypto = require('node:crypto');
const logger = require(__dirname + '/../logger');
const lib = require(__dirname + '/../lib');

/**
 * Hash wrapper without exceptions for node crypto createHash
 * @param {string|Buffer} data - data to hash
 * @param {string} [algorithm=sha256] - any supported hash algorithm by node:crypto
 * @param {string} [encode=base64] - output encoding, use "binary" to return Buffer
 * @return {string|Buffer} calculated hash or empty string on error
 * @memberof module:lib
 * @method hash
 *
 * @example
 * // Create SHA-256 hash encoded as base64
 * const value = lib.hash("hello");
 * // => "LPJNul+wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ="
 *
 * @example
 * // Create SHA-256 hash encoded as hex
 * const value = lib.hash("hello", "sha256", "hex");
 * // => "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
 *
 * @example
 * // Create MD5 hash encoded as hex
 * const value = lib.hash("hello", "md5", "hex");
 * // => "5d41402abc4b2a76b9719d911017c592"
 *
 * @example
 * // Hash a Buffer
 * const value = lib.hash(Buffer.from("hello"), "sha256", "base64");
 * // => "LPJNul+wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ="
 *
 * @example
 * // Return raw Buffer by using "binary"
 * const value = lib.hash("hello", "sha256", "binary");
 * // => <Buffer 2c f2 4d ba 5f b0 a3 0e ...>
 *
 * @example
 * // Invalid algorithm returns an empty string
 * const value = lib.hash("hello", "invalid-algorithm", "hex");
 * // => ""
 */
lib.hash = function (data, algorithm, encode)
{
    encode = encode === "binary" ? undefined : encode || "base64";
    try {
        return crypto.createHash(algorithm || "sha256").update(data || "").digest(encode);
    } catch (e) {
        logger.error('hash:', algorithm, encode, e.stack);
        return "";
    }
}

/**
 * 32-bit MurmurHash3 implemented by bryc (github.com/bryc)
 * @param {string} key input string
 * @return {number} hash number
 * @memberof module:lib
 * @method murmurHash3
 */
lib.murmurHash3 = function(key, seed = 0)
{
    var i = 0, k, p1 = 3432918353, p2 = 461845907, h = seed | 0;

    if (typeof key !== "string") return 0;

    for (let b = key.length & -4; i < b; i += 4) {
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
