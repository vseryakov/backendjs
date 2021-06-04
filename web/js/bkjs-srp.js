/*!
 *  backend.js SRP client
 *  Vlad Seryakov vseryakov@gmail.com 2021
 */

bkjs.srp = {
    hexN: 'AC6BDB41324A9A9BF166DE5E1389582FAF72B6651987EE07FC3192943DB56050A37329CBB4A099ED8193E0757767A13DD52312AB4B03310D' +
          'CD7F48A9DA04FD50E8083969EDB767B0CF6095179A163AB3661A05FBD5FAAAE82918A9962F0B93B855F97993EC975EEAA80D740ADBF4FF74' +
          '7359D041D5C33EA71D281E446B14773BCA97B43A23FB801676BD207A436C6481F1D2B9078717461A5B9D32E688F87748544523B524B0D57D' +
          '5EA77A2775D2ECFA032CFBDBF52FB3786160279004E57AE6AF874E7303CE53299CCC041C7BC308D82A5698F3A8D0C38271AE35F8E9DBFBB6' +
          '94B5C803D89F7AE435DE236D525F54759B65E372FCD68EF20FA7111F9E4AFF73',
    hexG: '02',
    BigInteger: window.BigInteger,

    init: function() {
        if (!this._) {
            this.N = this.toInt(this.hexN);
            this.g = this.toInt(this.hexG);
            this.k = this.hash(this.N, this.g);
            this._ = 1;
        }
    },

    toInt: function(n) {
        return n instanceof this.BigInteger ? n : typeof n == "string" ? new this.BigInteger(n, 16) : this.rand();
    },

    toBuffer: function(n, len) {
        return n instanceof this.BigInteger ? bkjs.crypto.hex2bin(n.toString(16).padStart(len*2, "0")) : Array.isArray(n) ? n : bkjs.crypto.hex2bin(n.padStart(len*2, "0"));
    },

    toBin: function(...args) {
        var h = [];
        for (const i in args) {
            if (args[i] instanceof this.BigInteger) {
                h = bkjs.crypto.bconcat(h, this.toBuffer(args[i], 256));
            } else {
                h = bkjs.crypto.bconcat(h, args[i]);
            }
        }
        return h;
    },

    hash: function(...args) {
        return new this.BigInteger(bkjs.crypto.sha256(this.toBin(Array.from(args)), "hex"), 16);
    },

    rand: function() {
        return new this.BigInteger(bkjs.random(32), 16);
    },

    x: function(user, secret, salt) {
        return this.hash(this.toBuffer(this.toInt(salt), 32), bkjs.crypto.sha256(this.toBin(user, ':', secret)));
    },

    verifier: function(user, secret, salt) {
        this.init();
        const s = this.toInt(salt);
        const x = this.x(user, secret, s);
        const v = this.g.modPow(x, this.N);
        return [s.toString(16), v.toString(16), x.toString(16)];
    },

    client1: function(salt) {
        this.init();
        const a = this.toInt(salt);
        const A = this.g.modPow(a, this.N);
        return [a.toString(16), A.toString(16)];
    },

    client2: function(user, secret, salt, a, B) {
        this.init();
        B = this.toInt(B);
        if (B.mod(this.N).toString() == "0") return null;
        a = this.toInt(a);
        const x = this.x(user, secret, salt);
        const A = this.g.modPow(a, this.N);
        const u = this.hash(A, B);
        const S = B.subtract(this.k.multiply(this.g.modPow(x, this.N))).modPow(a.add(u.multiply(x)), this.N).mod(this.N);
        const K = this.hash(S);
        const M = this.hash(A, B, S);
        return [K.toString(16), M.toString(16), S.toString(16), u.toString(16), x.toString(16), A.toString(16)];
    },

    client3: function(A, M1, K, M2) {
        const M = this.hash(this.toInt(A), this.toInt(M1), this.toInt(K));
        return [M.equals(this.toInt(M2)), M.toString(16)];
    },
}
