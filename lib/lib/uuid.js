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
 * Short unique id within a microsecond or local epoch
 * @param {string} [prefix] - prepend with prefix
 * @param {object} [options] - same options as for {@link module:lib.getHashid}
 * @param {int} [options.epoch] - local epoch type via {@link module:lib.localEpoch}, default is milliseconds, `m` for microseconds, `s` for seconds
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
    var now = options?.now || lib.localEpoch(options?.epoch);
    var n = BigInt(now) << 22n | (BigInt(node % 1024) << 12n) | BigInt(lib.sfuuidCounter++ % 4096);
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