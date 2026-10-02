/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
'use strict';

const crypto = require('node:crypto');
const lib = require(__dirname + '/../lib');

/**
 * Unique Id (UUID v4) without any special characters and in lower case
 * @param {string} [prefix] - prepend with prefix
 * @return {string}
 * @memberof module:lib
 * @method uuid
 * @example
 * // Generate a plain UUID v4 without dashes
 * const id = lib.uuid();
 * // "9f1c7a6f4d2b4a7b9e0a43e9f5a2c1b8"
 *
 * // Generate a UUID with a prefix
 * const userId = lib.uuid("usr_");
 * // "usr_9f1c7a6f4d2b4a7b9e0a43e9f5a2c1b8"
 *
 * // Use it as an object key
 * const session = {
 *     id: lib.uuid("sess_"),
 *     created: Date.now(),
 * };
 *
 * // Check the generated UUID length
 * lib.uuid().length;
 * // 32
 */
lib.uuid = function(prefix)
{
    return (prefix || "") + crypto.randomUUID().replace(/[-]/g, '').toLowerCase();
}

/**
 * Deterministic UUID v5, to be RFC4122 complient the namespace must be an UUID formatted
 * @param {string} text
 * @param {string} namespace
 * @return {string}
 * @memberof module:lib
 * @method uuid
 * @example
 * lib.uuidv5("example.com",'6ba7b810-9dac-11d1-80b4-00c04fd430c8')
 * '5d588cec-be53-5060-abee-b14e76ea90dd'
 */
lib.uuidv5 = function(text, namespace)
{
    const buf = Buffer.concat([
        Buffer.from(lib.isString(namespace).replaceAll("-", "").toLowerCase(), "hex"),
        Buffer.from(lib.isString(text))
    ]);
    const hash = crypto.createHash("sha1").update(buf).digest().slice(0, 16);
    hash[6] = (hash[6] & 0x0f) | 0x50;
    hash[8] = (hash[8] & 0x3f) | 0x80;
    const hex = hash.toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

let _v7_now = 0, _v7_buf;

/**
 * Monotoic UUID v7, to be RFC 9562 complient
 * @param {long} [timestamp] - time in ms, default is Date.now()
 * @return {string}
 * @memberof module:lib
 * @method uuidv7
 * @example
 * lib.uuidv7()
 * '01a0ea83-d40c-7530-9a2b-7589ebb673d7'
 */
lib.uuidv7 = function(timestamp)
{
    const now = timestamp && lib.toNumber(timestamp) || Date.now();
    const bytes = now > _v7_now ? crypto.randomBytes(16) : (_v7_buf ??= crypto.randomBytes(16));

    // 48-bit timestamp, big-endian
    const hi = (now / 0x100000000) | 0;    // top 16 bits
    const lo = now >>> 0;                  // bottom 32 bits
    bytes[0] = hi >> 8;
    bytes[1] = hi & 0xFF;
    bytes[2] = lo >>> 24;
    bytes[3] = lo >>> 16;
    bytes[4] = lo >>> 8;
    bytes[5] = lo & 0xFF;

    // Set version to 7 (0111)
    bytes[6] = (bytes[6] & 0x0f) | 0x70;
    // Set variant to RFC 4122 (10xx)
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    if (now > _v7_now) {
        _v7_buf = null;
    } else {
        for (let i = 15; i > 8; i--) {
            if (++bytes[i] < 256) break;
            bytes[i] = 0;
        }
    }

    _v7_now = now;

    const hex = bytes.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Extract the timesyamp from UUIDv7
 * @param {string} id - UUIDv7
 * @return {number} - milliseconds
 * @memberof module:lib
 * @method parseUuidv7
 * @example
 * lib.parseUuidv7(lib.uuidv7(1790967836746))
 * 1790967836746
 */
lib.parseUuidv7 = function(id)
{
    var bytes = Buffer.from(lib.isString(id).replace(/[^0-9a-f]/g, ""), 'hex');
    if (bytes.length < 6) return 0;
    const hi = bytes.readUInt16BE(0);
    const lo = bytes.readUInt32BE(2);
    return hi * 0x100000000 + lo;
}

/**
 * Short unique id within a microsecond or local epoch, the use case for this is when ids are generated once in a while only.
 * @param {string} [prefix] - prepend with prefix
 * @param {object} [options] - same options as for {@link module:lib.getHashid}
 * @param {string} [options.epoch] - local epoch type via {@link module:lib.localEpoch}, default is milliseconds, `m` for microseconds, `s` for seconds
 * @return {string} generated hash
 * @memberof module:lib
 * @method suuid
 * @example
 * // Generate a short unique id
 * const id = lib.suuid();
 * // "k9z3x"
 *
 * // Generate a short unique id with a prefix
 * const orderId = lib.suuid("ord_");
 * // "ord_k9z3x"
 *
 * // Generate using microsecond local epoch
 * const microId = lib.suuid("evt_", { epoch: "m" });
 * // "evt_2n9m8p"
 *
 * // Generate using second local epoch
 * const secondId = lib.suuid("job_", { epoch: "s" });
 * // "job_x7q2"
 *
 * // Pass hashid options supported by lib.getHashid
 * const customId = lib.suuid("msg_", {
 *     epoch: "m",
 *     salt: "my-app",
 *     alphabet: "abcdefghijklmnopqrstuvwxyz1234567890",
 * });
 */
lib.suuid = function(prefix, options)
{
    var hashid = this.getHashid(options);
    var c = options?.epoch ? lib.localEpoch(options?.epoch) : lib.clock();
    var s = hashid.encode(c, hashid._counter);
    return prefix ? prefix + s : s;
}

/**
 * Generate a SnowFlake unique id as 64-bit number
 * Format: time - 41 bit, node - 10 bit, counter - 12 bit
 * @param {object} [options]
 * @param {int} [options.now] - time, if not given local epoch clock is used in microseconds
 * @param {int} [options.epoch] - local epoch type via {@link module:lib.localEpoch}, default is milliseconds, `m` for microseconds, `s` for seconds
 * @param {int} [options.node] - node id, limited to max 1024
 * @param {int} [options.radix] - default is 10, use any value between 2 - 36 for other numeric encoding
 * @memberof module:lib
 * @method sfuuid
 * @example
 * // Generate a SnowFlake-style id as a decimal string
 * const id = lib.sfuuid();
 * // "7138729462243536896"
 *
 * // Generate an id for a specific node
 * const nodeId = lib.sfuuid({ node: 42 });
 * // "7138729462243710976"
 *
 * // Generate an id with a fixed timestamp, useful for tests
 * const testId = lib.sfuuid({
 *     now: 1700000000000,
 *     node: 1,
 * });
 * // "7130316800000004096"
 *
 * // Generate an id using microsecond local epoch
 * const microId = lib.sfuuid({ epoch: "m", node: 7 });
 *
 * // Generate an id encoded in base36
 * const base36Id = lib.sfuuid({
 *     node: 12,
 *     radix: 36,
 * });
 * // "1i7m6g25x4ao"
 *
 * // Generate an id encoded in hexadecimal
 * const hexId = lib.sfuuid({
 *     node: 12,
 *     radix: 16,
 * });
 * // "631f8d28000c000"
 */
lib.sfuuid = function(options)
{
    var node = options?.node || lib.sfuuidNode;
    if (node === undefined) {
        const intf = lib.networkInterfaces()[0];
        if (intf) lib.sfuuidNode = node = lib.murmurHash3(intf.mac);
    }
    const now = options?.now || lib.localEpoch(options?.epoch);
    const n = BigInt(now) << 22n | (BigInt(node % 1024) << 12n) | BigInt(lib.sfuuidCounter++ % 4096);
    return n.toString(options?.radix || 10);
}

lib.sfuuidCounter = lib.randomShort();

/**
 * Parse an SFUUID numeric id into its original components.
 *
 * Splits the id into bit fields:
 * - `now`:     64 bits starting at bit 22
 * - `node`:    10 bits starting at bit 12
 * - `counter`: 12 bits starting at bit 0
 *
 * @function lib.sfuuidParse
 * @param {string|number|bigint} id
 *   SFUUID value to parse. Can be a BigInt, a decimal string, or a number
 *   (numbers may lose precision for large ids).
 *
 * @returns {Object} rc
 * @returns {bigint} rc.id Parsed id as a BigInt (only set if parsing succeeded).
 * @returns {number} rc.now Extracted `now` component (only set if parsing succeeded).
 * @returns {number} rc.node Extracted `node` component (only set if parsing succeeded).
 * @returns {number} rc.counter Extracted `counter` component (only set if parsing succeeded).
 * @example
 * // Generate and parse an SFUUID
 * const id = lib.sfuuid({ node: 42 });
 * const parsed = lib.sfuuidParse(id);
 * // {
 * //   id: 7138729462243710976n,
 * //   now: 1702008542238,
 * //   node: 42,
 * //   counter: 0
 * // }
 *
 * // Parse a decimal string
 * const rc1 = lib.sfuuidParse("7130316800000004096");
 * // {
 * //   id: 7130316800000004096n,
 * //   now: 1700000000000,
 * //   node: 1,
 * //   counter: 0
 * // }
 *
 * // Parse a BigInt
 * const rc2 = lib.sfuuidParse(7130316800000004096n);
 * // {
 * //   id: 7130316800000004096n,
 * //   now: 1700000000000,
 * //   node: 1,
 * //   counter: 0
 * // }
 *
 * // Parse an invalid value
 * const rc3 = lib.sfuuidParse("not-a-number");
 * // {}
 *
 * // Get only the node part
 * const node = lib.sfuuidParse(id).node;
 * // 42
 */
lib.sfuuidParse = function(id)
{
    const _map = { now: [22n, 64n], node: [12n, 10n], counter: [0n, 12n] };
    const rc = {};
    try {
        id = rc.id = BigInt(id);
        for (const p in _map) {
            rc[p] = Number((id & (((1n << _map[p][1]) - 1n) << _map[p][0])) >> _map[p][0]);
        }
    } catch (_e) {}
    return rc;
}
