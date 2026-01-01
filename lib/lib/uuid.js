/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const crypto = require('crypto');
const lib = require(__dirname + '/../lib');

/**
 * Unique Id (UUID v4) without any special characters and in lower case
 * @param {string} [prefix] - prepend with prefix
 * @return {string}
 * @memberof module:lib
 * @method uuid
 */
lib.uuid = function(prefix)
{
    return (prefix || "") + crypto.randomUUID().replace(/[-]/g, '').toLowerCase();
}

/**
 * Generate a 22 chars slug from an UUID
 * @param {object} [options]
 * @param {string} [options.alphabet] - chars allowed in hashids, default is lib.uriSafe
 * @param {string} [options.prefix] - repend with prefix
 * @return {string}
 * @memberof module:lib
 * @method slug
 */
lib.slug = function(options)
{
    var bits = "0000" + BigInt("0x" + lib.uuid()).toString(2);
    var bytes = [];
    for (let i = 0; i < bits.length; i += 6) bytes.push(bits.substr(i, 6));
    const alphabet = options?.alphabet || lib.uriSafe;
    return (options?.prefix || "") + bytes.map((x) => alphabet[parseInt(x, 2) % alphabet.length]).join("");
}

/**
 * Short unique id within a microsecond
 * @param {string} [prefix] - prepend with prefix
 * @param {object} [options] - same options as for {@link module:lib.getHashid}
 * @return {string} generated hash
 * @memberof module:lib
 * @method suuid
 */
lib.suuid = function(prefix, options)
{
    var hashid = this.getHashid(options);
    var s = hashid.encode(lib.clock(), hashid._counter);
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
 */
lib.sfuuid = function(options)
{
    var node = options?.node || lib.sfuuidNode;
    if (node === undefined) {
        var intf = lib.networkInterfaces()[0];
        if (intf) lib.sfuuidNode = node = lib.murmurHash3(intf.mac);
    }
    var now = options?.now || lib.localEpoch(options?.epoch);
    var n = BigInt(now) << 22n | (BigInt(node % 1024) << 12n) | BigInt(lib.sfuuidCounter++ % 4096);
    return n.toString(options?.radix || 10);
}

lib.sfuuidCounter = 0;

// Parse an id into original components: now, node, counter
lib.sfuuidParse = function(id)
{
    const _map = { now: [22n, 64n], node: [12n, 10n], counter: [0n, 12n] };
    const rc = {};
    try {
        id = rc.id = BigInt(id);
        for (const p in _map) {
            rc[p] = Number((id & (((1n << _map[p][1]) - 1n) << _map[p][0])) >> _map[p][0]);
        }
    } catch (e) {}
    return rc;
}


