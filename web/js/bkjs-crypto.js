/*!
 * A JavaScript implementation of the Secure Hash Algorithm, SHA-256, as defined in FIPS 180-2
 * Version 2.2 Copyright Angel Marin, Paul Johnston 2000 - 2009.
 * Other contributors: Greg Holt, Andrew Kepert, Ydnar, Lostinet
 * Distributed under the BSD License
 * See http://pajhome.org.uk/crypt/md5 for details.
 * Also http://anmar.eu.org/projects/jssha2/
 *
 * A JavaScript implementation of the Secure Hash Algorithm, SHA-1, as defined
 * in FIPS PUB 180-1 Version 2.1a Copyright Paul Johnston 2000 - 2002. Other
 * contributors: Greg Holt, Andrew Kepert, Ydnar, Lostinet Distributed under the
 * BSD License See http://pajhome.org.uk/crypt/md5 for details.
 *
 * Word array handling influenced by Crypto-JS
 * Copyright (c) 2009-2013 Jeff Mott
 * Copyright (c) 2013-2016 Evan Vosberg
 * Distributed under the MIT License See http://github.com/brix/crypto-js for details
 */

bkjs.crypto = {
    hex: "0123456789abcdef",
    b64: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",
    K: [1116352408, 1899447441, -1245643825, -373957723, 961987163, 1508970993, -1841331548, -1424204075, -670586216, 310598401,
        607225278, 1426881987, 1925078388, -2132889090, -1680079193, -1046744716, -459576895, -272742522, 264347078, 604807628,
        770255983, 1249150122, 1555081692, 1996064986, -1740746414, -1473132947, -1341970488, -1084653625, -958395405, -710438585,
        113926993, 338241895, 666307205, 773529912, 1294757372, 1396182291, 1695183700, 1986661051, -2117940946, -1838011259, -1564481375,
        -1474664885, -1035236496, -949202525, -778901479, -694614492, -200395387, 275423344, 430227734, 506948616, 659060556, 883997877,
        958139571, 1322822218, 1537002063, 1747873779, 1955562222, 2024104815, -2067236844, -1933114872, -1866530822, -1538233109, -1090935817, -965641998
    ],

    sha256_S: function(X, n) {
        return (X >>> n) | (X << (32 - n));
    },

    sha256_R: function(X, n) {
        return (X >>> n);
    },

    sha256_Ch: function(x, y, z) {
        return ((x & y) ^ ((~x) & z));
    },

    sha256_Maj: function(x, y, z) {
        return ((x & y) ^ (x & z) ^ (y & z));
    },

    sha256_Sigma0256: function(x) {
        return (this.sha256_S(x, 2) ^ this.sha256_S(x, 13) ^ this.sha256_S(x, 22));
    },

    sha256_Sigma1256: function(x) {
        return (this.sha256_S(x, 6) ^ this.sha256_S(x, 11) ^ this.sha256_S(x, 25));
    },

    sha256_Gamma0256: function(x) {
        return (this.sha256_S(x, 7) ^ this.sha256_S(x, 18) ^ this.sha256_R(x, 3));
    },

    sha256_Gamma1256: function(x) {
        return (this.sha256_S(x, 17) ^ this.sha256_S(x, 19) ^ this.sha256_R(x, 10));
    },

    // Add integers, wrapping at 2^32. This uses 16-bit operations internally to work around bugs in some JS interpreters.
    add: function(x, y) {
        var lsw = (x & 0xFFFF) + (y & 0xFFFF);
        var msw = (x >> 16) + (y >> 16) + (lsw >> 16);
        return (msw << 16) | (lsw & 0xFFFF);
    },

    // Bitwise rotate a 32-bit number to the left.
    rol: function(num, cnt) {
        return (num << cnt) | (num >>> (32 - cnt));
    },

    sha1_ft: function(t, b, c, d) {
        if (t < 20) return (b & c) | ((~b) & d);
        if (t < 40) return b ^ c ^ d;
        if (t < 60) return (b & c) | (b & d) | (c & d);
        return b ^ c ^ d;
    },

    sha1_kt: function(t) {
        return (t < 20) ? 1518500249 : (t < 40) ? 1859775393 : (t < 60) ? -1894007588 : -899497514;
    },

    // Calculate the SHA-1 of an array of big-endian words, and a bit length
    coreSha1: function(data, len) {
        var HASH = [1732584193, -271733879, -1732584194, 271733878, -1009589776];
        var w = Array(80);

        data[len >> 5] |= 0x80 << (24 - len % 32);
        data[((len + 64 >> 9) << 4) + 15] = len;

        for (var i = 0; i < data.length; i += 16) {
            var olda = HASH[0];
            var oldb = HASH[1];
            var oldc = HASH[2];
            var oldd = HASH[3];
            var olde = HASH[4];

            for (var j = 0; j < 80; j++) {
                if (j < 16) w[j] = data[i + j];
                else w[j] = this.rol(w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16], 1);
                var t = this.add(this.add(this.rol(HASH[0], 5), this.sha1_ft(j, HASH[1], HASH[2], HASH[3])), this.add(this.add(HASH[4], w[j]), this.sha1_kt(j)));
                HASH[4] = HASH[3];
                HASH[3] = HASH[2];
                HASH[2] = this.rol(HASH[1], 30);
                HASH[1] = HASH[0];
                HASH[0] = t;
            }

            HASH[0] = this.add(HASH[0], olda);
            HASH[1] = this.add(HASH[1], oldb);
            HASH[2] = this.add(HASH[2], oldc);
            HASH[3] = this.add(HASH[3], oldd);
            HASH[4] = this.add(HASH[4], olde);
        }
        HASH._size = 20;
        return HASH;
    },

    sha1: function(data, enc) {
        if (typeof data == "string") data = this.str2bin(data);
        return this.bin2enc(this.coreSha1(data, data._size * 8), enc);
    },

    // Calculate the HMAC-SHA1 of a key and some data
    hmacSha1: function(key, data, enc) {
        var hmac = this.hmacInit(key);
        if (typeof data == "string") data = this.str2bin(data);
        var hash = this.coreSha1(hmac.i.concat(data), 512 + data._size * 8);
        var out = this.coreSha1(hmac.o.concat(hash), 512 + 160);
        return this.bin2enc(out, enc);
    },

    coreSha256: function(data, len) {
        var HASH = [1779033703, -1150833019, 1013904242, -1521486534, 1359893119, -1694144372, 528734635, 1541459225];
        var W = new Array(64);
        var a, b, c, d, e, f, g, h, i, j, T1, T2;

        data[len >> 5] |= 0x80 << (24 - len % 32);
        data[((len + 64 >> 9) << 4) + 15] = len;

        for (i = 0; i < data.length; i += 16) {
            a = HASH[0];
            b = HASH[1];
            c = HASH[2];
            d = HASH[3];
            e = HASH[4];
            f = HASH[5];
            g = HASH[6];
            h = HASH[7];

            for (j = 0; j < 64; j++) {
                if (j < 16) W[j] = data[j + i]; else W[j] = this.add(this.add(this.add(this.sha256_Gamma1256(W[j - 2]), W[j - 7]), this.sha256_Gamma0256(W[j - 15])), W[j - 16]);
                T1 = this.add(this.add(this.add(this.add(h, this.sha256_Sigma1256(e)), this.sha256_Ch(e, f, g)), this.K[j]), W[j]);
                T2 = this.add(this.sha256_Sigma0256(a), this.sha256_Maj(a, b, c));
                h = g;
                g = f;
                f = e;
                e = this.add(d, T1);
                d = c;
                c = b;
                b = a;
                a = this.add(T1, T2);
            }

            HASH[0] = this.add(a, HASH[0]);
            HASH[1] = this.add(b, HASH[1]);
            HASH[2] = this.add(c, HASH[2]);
            HASH[3] = this.add(d, HASH[3]);
            HASH[4] = this.add(e, HASH[4]);
            HASH[5] = this.add(f, HASH[5]);
            HASH[6] = this.add(g, HASH[6]);
            HASH[7] = this.add(h, HASH[7]);
        }
        HASH._size = 32;
        return HASH;
    },

    sha256: function(data, enc)
    {
        if (typeof data == "string") data = this.str2bin(data);
        return this.bin2enc(this.coreSha256(data, data._size * 8), enc);
    },

    hmacInit: function(key) {
        key = typeof key == "string" ? this.str2bin(key) : key;
        if (key.length > 16) key = this.coreSha256(key, key._size * 8);

        var i = Array(16), o = Array(16);
        for (let k = 0; k < 16; k++) {
            i[k] = key[k] ^ 0x36363636;
            o[k] = key[k] ^ 0x5C5C5C5C;
        }
        return { k: key, i: i, o: o };
    },

    // Calculate the HMAC-SHA256 of a key and some data
    hmacSha256: function(key, data, enc) {
        var hmac = this.hmacInit(key);
        if (typeof data == "string") data = this.str2bin(data);
        var hash = this.coreSha256(hmac.i.concat(data), 512 + data._size * 8);
        var out = this.coreSha256(hmac.o.concat(hash), 512 + 256);
        return this.bin2enc(out, enc);
    },

    // Convert regular Javascript utf-16 string into utf-8 string
    str2utf8: function(str) {
        var out = "", i = -1, x, y;

        while (++i < str.length) {
            x = str.charCodeAt(i);
            y = i + 1 < str.length ? str.charCodeAt(i + 1) : 0;
            if (x >= 0xD800 && x <= 0xDBFF && y>= 0xDC00 && y <= 0xDFFF) {
                x = 0x10000 + ((x & 0x03FF) << 10) + (y & 0x03FF);
                i++;
            }
            if (x <= 0x7F) {
                out += String.fromCharCode(x);
            } else
            if (x <= 0x7FF) {
                out += String.fromCharCode(0xC0 | ((x >>> 6) & 0x1F), 0x80 | (x & 0x3F));
            } else
            if (x <= 0xFFFF) {
                out += String.fromCharCode(0xE0 | ((x >>> 12) & 0x0F), 0x80 | ((x >>> 6) & 0x3F), 0x80 | (x & 0x3F));
            } else
            if (x <= 0x1FFFFF) {
                out += String.fromCharCode(0xF0 | ((x >>> 18) & 0x07), 0x80 | ((x >>> 12) & 0x3F), 0x80 | ((x >>> 6) & 0x3F), 0x80 | (x & 0x3F));
            }
        }
        return out;
    },

    // Convert UTF-8 string into an array of big-endian words
    utf82bin: function(str) {
        return this.str2bin(this.str2utf8(str));
    },

    // Convert an 8-bit or 16-bit string to an array of big-endian word, characters >255 have their hi-byte silently ignored.
    str2bin: function(str) {
        var bin = [];
        bin._size = str.length;
        for (var i = 0; i < str.length * 8; i += 8) bin[i >> 5] |= (str.charCodeAt(i / 8) & 0xFF) << (32 - 8 - i % 32);
        return bin;
     },

    // Convert an array of big-endian words to a string
    bin2str: function(bin) {
        var str = "";
        for (var i = 0; i < bin._size; i++) str += String.fromCharCode((bin[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xFF);
        return str;
    },

    // Convert an array of big-endian words to a hex string.
    bin2hex: function(bin) {
        var str = "";
        for (var i = 0; i < bin._size; i++) {
            var b = (bin[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xFF;
            str += this.hex.charAt(b >> 4) + this.hex.charAt(b & 0x0F);
        }
        return str;
    },

    // Convert a hex string into a string
    hex2str: function(hex) {
        var str = "";
        for (var i = 0; i < hex.length; i += 2) str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
        return str;
    },

    // Convert a hex string to an array of big-endian words
    hex2bin: function(hex) {
        var bin = [];
        bin._size = hex.length/2;
        for (var i = 0; i < hex.length; i += 2) bin[i >>> 3] |= parseInt(hex.substr(i, 2), 16) << (24 - (i % 8) * 4);
        return bin;
    },

    // Convert an array of big-endian words to a base-64 string
    bin2b64: function(bin) {
        var str = "";
        for (var i = 0; i < bin._size; i += 3) {
            var triplet = (((bin[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xF) << 16) | (((bin[(i + 1) >>> 2] >>> (24 - ((i + 1) % 4) * 8)) & 0xFF) << 8) | ((bin[(i + 2) >>> 2] >>> (24 - ((i + 2) % 4) * 8)) & 0xFF);
            for (var j = 0; j < 4 && i + j * 0.75 < bin._size; j++) {
                str += this.b64.charAt((triplet >> 6 * (3 - j)) & 0x3F);
            }
        }
        while (str.length % 4) str += "=";
        return str;
    },

    bin2enc: function(bin, enc) {
        return !enc ? bin : enc == "base64" ? this.bin2b64(bin) : enc == "hex" ? this.bin2hex(bin) : enc == "str" ? this.bin2str(bin) : bin;
    },

    bnew: function(list, size) {
        var bin = list.slice(0);
        bin._size = size || bin.length * 4;
        return bin;
    },

    bconcat: function(bin, str) {
        if (typeof str == "string") str = this.str2bin(str);
        if (typeof bin == "string") bin = this.str2bin(bin);
        bin = this.bnew(bin, bin._size);
        bin[bin._size >>> 2] &= 0XFFFFFFFF << (32 - (bin._size % 4) * 8);
        bin.length = Math.ceil(bin._size / 4);
        if (bin._size % 4) {
            for (let i = 0; i < str._size; i++) {
                bin[(bin._size + i) >>> 2] |= ((str[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff) << (24 - ((bin._size + i) % 4) * 8);
            }
        } else {
            for (let i = 0; i < str._size; i += 4) bin[(bin._size + i) >>> 2] = str[i >>> 2];
        }
        bin._size += str._size;
        return bin;
    },

    // Test: password,salt,4096,32 == c5e478d59288c841aa530db6845c4c8d962893a001ce4e11a4963873aa98134a
    pbkdf2: function(key, salt, iterations, length, enc) {
        var u, ui, o = this.bnew([]);
        var b = this.bnew([0x00000001]);
        length = Math.ceil(length / 32) || 1;
        iterations = iterations || 10000;

        for (let k = 1; k <= length; ++k) {
            u = ui = this.hmacSha256(key, this.bconcat(salt, b));

            for (let i = 1; i < iterations; ++i) {
                ui = this.hmacSha256(key, ui);
                for (let j = 0; j < ui.length; j++) u[j] ^= ui[j];
            }
            o = this.bconcat(o, u);
            b[0]++;
        }
        return this.bin2enc(o, enc);
    },

}
