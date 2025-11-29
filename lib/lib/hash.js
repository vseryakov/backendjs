/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const crypto = require('node:crypto');
const logger = require(__dirname + '/../logger');
const lib = require(__dirname + '/../lib');

/**
 * Hash wrapper without exceptions for node crypto createHash
 * @param {string|Buffer} data - data to hash
 * @param {string} [algorithm] - sha1 is default, any supported hash algorithm by node:crypto
 * @param {string} [encode] - encoding, base64 by default
 * @return {string} calculated hash or empty string on error
 * @memberof module:lib
 * @method hash
 */
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
 * 32-bit MurmurHash3 implemented by bryc (github.com/bryc)
 * @param {string} key input string
 * @return {number} hash number
 * @memberof module:lib
 * @method murmurHash3
 */
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
