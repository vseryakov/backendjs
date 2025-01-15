//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const crypto = require('crypto');
const lib = require(__dirname + '/../lib');
const os = require('os');

// Return unique Id (UUID v4) without any special characters and in lower case
lib.uuid = function(prefix)
{
    return (prefix || "") + crypto.randomUUID().replace(/[-]/g, '').toLowerCase();
}

// Generate a 22 chars slug from an UUID, alphabet can be provided, default is `lib.uriSafe`
lib.slug = function(options)
{
    var bits = "0000" + BigInt("0x" + lib.uuid()).toString(2);
    var bytes = [];
    for (let i = 0; i < bits.length; i += 6) bytes.push(bits.substr(i, 6));
    const alphabet = options?.alphabet || lib.uriSafe;
    return (options?.prefix || "") + bytes.map((x) => alphabet[parseInt(x, 2) % alphabet.length]).join("");
}

// Returns a short unique id within a microsecond
lib.suuid = function(prefix, options)
{
    var hashid = this.getHashid(options);
    var tm = options?.epoch ? lib.localEpoch("tm") : lib.getTimeOfDay();
    var s = hashid.encode(tm[0], tm[1], hashid._counter);
    return prefix ? prefix + s : s;
}

// Generate a SnowFlake unique id as 64-bit number
// Format: time - 41 bit, node - 10 bit, counter - 12 bit
// Properties can be provided:
// - now - time, if not given local epoch clock is used in microseconds
// - epoch - local epoch type, default is milliseconds, `m` for microseconds, `s` for seconds
// - node - node id, limited to max 1024
// - radix - default is 10, use any value between 2 - 36 for other numeric encoding
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

