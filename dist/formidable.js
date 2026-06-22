"use strict";
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};

// ../../.bkjs/lib/node_modules/formidable/node_modules/@noble/hashes/_u64.js
var require_u64 = __commonJS({
  "../../.bkjs/lib/node_modules/formidable/node_modules/@noble/hashes/_u64.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.toBig = exports2.shrSL = exports2.shrSH = exports2.rotrSL = exports2.rotrSH = exports2.rotrBL = exports2.rotrBH = exports2.rotr32L = exports2.rotr32H = exports2.rotlSL = exports2.rotlSH = exports2.rotlBL = exports2.rotlBH = exports2.add5L = exports2.add5H = exports2.add4L = exports2.add4H = exports2.add3L = exports2.add3H = void 0;
    exports2.add = add;
    exports2.fromBig = fromBig;
    exports2.split = split;
    var U32_MASK64 = /* @__PURE__ */ BigInt(2 ** 32 - 1);
    var _32n = /* @__PURE__ */ BigInt(32);
    function fromBig(n, le = false) {
      if (le)
        return { h: Number(n & U32_MASK64), l: Number(n >> _32n & U32_MASK64) };
      return { h: Number(n >> _32n & U32_MASK64) | 0, l: Number(n & U32_MASK64) | 0 };
    }
    function split(lst, le = false) {
      const len = lst.length;
      let Ah = new Uint32Array(len);
      let Al = new Uint32Array(len);
      for (let i = 0; i < len; i++) {
        const { h, l } = fromBig(lst[i], le);
        [Ah[i], Al[i]] = [h, l];
      }
      return [Ah, Al];
    }
    var toBig = (h, l) => BigInt(h >>> 0) << _32n | BigInt(l >>> 0);
    exports2.toBig = toBig;
    var shrSH = (h, _l, s2) => h >>> s2;
    exports2.shrSH = shrSH;
    var shrSL = (h, l, s2) => h << 32 - s2 | l >>> s2;
    exports2.shrSL = shrSL;
    var rotrSH = (h, l, s2) => h >>> s2 | l << 32 - s2;
    exports2.rotrSH = rotrSH;
    var rotrSL = (h, l, s2) => h << 32 - s2 | l >>> s2;
    exports2.rotrSL = rotrSL;
    var rotrBH = (h, l, s2) => h << 64 - s2 | l >>> s2 - 32;
    exports2.rotrBH = rotrBH;
    var rotrBL = (h, l, s2) => h >>> s2 - 32 | l << 64 - s2;
    exports2.rotrBL = rotrBL;
    var rotr32H = (_h, l) => l;
    exports2.rotr32H = rotr32H;
    var rotr32L = (h, _l) => h;
    exports2.rotr32L = rotr32L;
    var rotlSH = (h, l, s2) => h << s2 | l >>> 32 - s2;
    exports2.rotlSH = rotlSH;
    var rotlSL = (h, l, s2) => l << s2 | h >>> 32 - s2;
    exports2.rotlSL = rotlSL;
    var rotlBH = (h, l, s2) => l << s2 - 32 | h >>> 64 - s2;
    exports2.rotlBH = rotlBH;
    var rotlBL = (h, l, s2) => h << s2 - 32 | l >>> 64 - s2;
    exports2.rotlBL = rotlBL;
    function add(Ah, Al, Bh, Bl) {
      const l = (Al >>> 0) + (Bl >>> 0);
      return { h: Ah + Bh + (l / 2 ** 32 | 0) | 0, l: l | 0 };
    }
    var add3L = (Al, Bl, Cl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0);
    exports2.add3L = add3L;
    var add3H = (low, Ah, Bh, Ch) => Ah + Bh + Ch + (low / 2 ** 32 | 0) | 0;
    exports2.add3H = add3H;
    var add4L = (Al, Bl, Cl, Dl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0);
    exports2.add4L = add4L;
    var add4H = (low, Ah, Bh, Ch, Dh) => Ah + Bh + Ch + Dh + (low / 2 ** 32 | 0) | 0;
    exports2.add4H = add4H;
    var add5L = (Al, Bl, Cl, Dl, El) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0) + (El >>> 0);
    exports2.add5L = add5L;
    var add5H = (low, Ah, Bh, Ch, Dh, Eh) => Ah + Bh + Ch + Dh + Eh + (low / 2 ** 32 | 0) | 0;
    exports2.add5H = add5H;
    var u64 = {
      fromBig,
      split,
      toBig,
      shrSH,
      shrSL,
      rotrSH,
      rotrSL,
      rotrBH,
      rotrBL,
      rotr32H,
      rotr32L,
      rotlSH,
      rotlSL,
      rotlBH,
      rotlBL,
      add,
      add3L,
      add3H,
      add4L,
      add4H,
      add5H,
      add5L
    };
    exports2.default = u64;
  }
});

// ../../.bkjs/lib/node_modules/formidable/node_modules/@noble/hashes/cryptoNode.js
var require_cryptoNode = __commonJS({
  "../../.bkjs/lib/node_modules/formidable/node_modules/@noble/hashes/cryptoNode.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.crypto = void 0;
    var nc = require("node:crypto");
    exports2.crypto = nc && typeof nc === "object" && "webcrypto" in nc ? nc.webcrypto : nc && typeof nc === "object" && "randomBytes" in nc ? nc : void 0;
  }
});

// ../../.bkjs/lib/node_modules/formidable/node_modules/@noble/hashes/utils.js
var require_utils = __commonJS({
  "../../.bkjs/lib/node_modules/formidable/node_modules/@noble/hashes/utils.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.wrapXOFConstructorWithOpts = exports2.wrapConstructorWithOpts = exports2.wrapConstructor = exports2.Hash = exports2.nextTick = exports2.swap32IfBE = exports2.byteSwapIfBE = exports2.swap8IfBE = exports2.isLE = void 0;
    exports2.isBytes = isBytes;
    exports2.anumber = anumber;
    exports2.abytes = abytes;
    exports2.ahash = ahash;
    exports2.aexists = aexists;
    exports2.aoutput = aoutput;
    exports2.u8 = u8;
    exports2.u32 = u32;
    exports2.clean = clean;
    exports2.createView = createView;
    exports2.rotr = rotr;
    exports2.rotl = rotl;
    exports2.byteSwap = byteSwap;
    exports2.byteSwap32 = byteSwap32;
    exports2.bytesToHex = bytesToHex;
    exports2.hexToBytes = hexToBytes;
    exports2.asyncLoop = asyncLoop;
    exports2.utf8ToBytes = utf8ToBytes;
    exports2.bytesToUtf8 = bytesToUtf8;
    exports2.toBytes = toBytes;
    exports2.kdfInputToBytes = kdfInputToBytes;
    exports2.concatBytes = concatBytes;
    exports2.checkOpts = checkOpts;
    exports2.createHasher = createHasher;
    exports2.createOptHasher = createOptHasher;
    exports2.createXOFer = createXOFer;
    exports2.randomBytes = randomBytes;
    var crypto_1 = require_cryptoNode();
    function isBytes(a) {
      return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array";
    }
    function anumber(n) {
      if (!Number.isSafeInteger(n) || n < 0)
        throw new Error("positive integer expected, got " + n);
    }
    function abytes(b, ...lengths) {
      if (!isBytes(b))
        throw new Error("Uint8Array expected");
      if (lengths.length > 0 && !lengths.includes(b.length))
        throw new Error("Uint8Array expected of length " + lengths + ", got length=" + b.length);
    }
    function ahash(h) {
      if (typeof h !== "function" || typeof h.create !== "function")
        throw new Error("Hash should be wrapped by utils.createHasher");
      anumber(h.outputLen);
      anumber(h.blockLen);
    }
    function aexists(instance, checkFinished = true) {
      if (instance.destroyed)
        throw new Error("Hash instance has been destroyed");
      if (checkFinished && instance.finished)
        throw new Error("Hash#digest() has already been called");
    }
    function aoutput(out, instance) {
      abytes(out);
      const min = instance.outputLen;
      if (out.length < min) {
        throw new Error("digestInto() expects output buffer of length at least " + min);
      }
    }
    function u8(arr) {
      return new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    }
    function u32(arr) {
      return new Uint32Array(arr.buffer, arr.byteOffset, Math.floor(arr.byteLength / 4));
    }
    function clean(...arrays) {
      for (let i = 0; i < arrays.length; i++) {
        arrays[i].fill(0);
      }
    }
    function createView(arr) {
      return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
    }
    function rotr(word, shift) {
      return word << 32 - shift | word >>> shift;
    }
    function rotl(word, shift) {
      return word << shift | word >>> 32 - shift >>> 0;
    }
    exports2.isLE = (() => new Uint8Array(new Uint32Array([287454020]).buffer)[0] === 68)();
    function byteSwap(word) {
      return word << 24 & 4278190080 | word << 8 & 16711680 | word >>> 8 & 65280 | word >>> 24 & 255;
    }
    exports2.swap8IfBE = exports2.isLE ? (n) => n : (n) => byteSwap(n);
    exports2.byteSwapIfBE = exports2.swap8IfBE;
    function byteSwap32(arr) {
      for (let i = 0; i < arr.length; i++) {
        arr[i] = byteSwap(arr[i]);
      }
      return arr;
    }
    exports2.swap32IfBE = exports2.isLE ? (u) => u : byteSwap32;
    var hasHexBuiltin = /* @__PURE__ */ (() => (
      // @ts-ignore
      typeof Uint8Array.from([]).toHex === "function" && typeof Uint8Array.fromHex === "function"
    ))();
    var hexes = /* @__PURE__ */ Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
    function bytesToHex(bytes) {
      abytes(bytes);
      if (hasHexBuiltin)
        return bytes.toHex();
      let hex = "";
      for (let i = 0; i < bytes.length; i++) {
        hex += hexes[bytes[i]];
      }
      return hex;
    }
    var asciis = { _0: 48, _9: 57, A: 65, F: 70, a: 97, f: 102 };
    function asciiToBase16(ch) {
      if (ch >= asciis._0 && ch <= asciis._9)
        return ch - asciis._0;
      if (ch >= asciis.A && ch <= asciis.F)
        return ch - (asciis.A - 10);
      if (ch >= asciis.a && ch <= asciis.f)
        return ch - (asciis.a - 10);
      return;
    }
    function hexToBytes(hex) {
      if (typeof hex !== "string")
        throw new Error("hex string expected, got " + typeof hex);
      if (hasHexBuiltin)
        return Uint8Array.fromHex(hex);
      const hl = hex.length;
      const al = hl / 2;
      if (hl % 2)
        throw new Error("hex string expected, got unpadded hex of length " + hl);
      const array = new Uint8Array(al);
      for (let ai = 0, hi = 0; ai < al; ai++, hi += 2) {
        const n1 = asciiToBase16(hex.charCodeAt(hi));
        const n2 = asciiToBase16(hex.charCodeAt(hi + 1));
        if (n1 === void 0 || n2 === void 0) {
          const char = hex[hi] + hex[hi + 1];
          throw new Error('hex string expected, got non-hex character "' + char + '" at index ' + hi);
        }
        array[ai] = n1 * 16 + n2;
      }
      return array;
    }
    var nextTick = async () => {
    };
    exports2.nextTick = nextTick;
    async function asyncLoop(iters, tick, cb) {
      let ts = Date.now();
      for (let i = 0; i < iters; i++) {
        cb(i);
        const diff = Date.now() - ts;
        if (diff >= 0 && diff < tick)
          continue;
        await (0, exports2.nextTick)();
        ts += diff;
      }
    }
    function utf8ToBytes(str) {
      if (typeof str !== "string")
        throw new Error("string expected");
      return new Uint8Array(new TextEncoder().encode(str));
    }
    function bytesToUtf8(bytes) {
      return new TextDecoder().decode(bytes);
    }
    function toBytes(data) {
      if (typeof data === "string")
        data = utf8ToBytes(data);
      abytes(data);
      return data;
    }
    function kdfInputToBytes(data) {
      if (typeof data === "string")
        data = utf8ToBytes(data);
      abytes(data);
      return data;
    }
    function concatBytes(...arrays) {
      let sum = 0;
      for (let i = 0; i < arrays.length; i++) {
        const a = arrays[i];
        abytes(a);
        sum += a.length;
      }
      const res = new Uint8Array(sum);
      for (let i = 0, pad = 0; i < arrays.length; i++) {
        const a = arrays[i];
        res.set(a, pad);
        pad += a.length;
      }
      return res;
    }
    function checkOpts(defaults, opts) {
      if (opts !== void 0 && {}.toString.call(opts) !== "[object Object]")
        throw new Error("options should be object or undefined");
      const merged = Object.assign(defaults, opts);
      return merged;
    }
    var Hash = class {
    };
    exports2.Hash = Hash;
    function createHasher(hashCons) {
      const hashC = (msg) => hashCons().update(toBytes(msg)).digest();
      const tmp = hashCons();
      hashC.outputLen = tmp.outputLen;
      hashC.blockLen = tmp.blockLen;
      hashC.create = () => hashCons();
      return hashC;
    }
    function createOptHasher(hashCons) {
      const hashC = (msg, opts) => hashCons(opts).update(toBytes(msg)).digest();
      const tmp = hashCons({});
      hashC.outputLen = tmp.outputLen;
      hashC.blockLen = tmp.blockLen;
      hashC.create = (opts) => hashCons(opts);
      return hashC;
    }
    function createXOFer(hashCons) {
      const hashC = (msg, opts) => hashCons(opts).update(toBytes(msg)).digest();
      const tmp = hashCons({});
      hashC.outputLen = tmp.outputLen;
      hashC.blockLen = tmp.blockLen;
      hashC.create = (opts) => hashCons(opts);
      return hashC;
    }
    exports2.wrapConstructor = createHasher;
    exports2.wrapConstructorWithOpts = createOptHasher;
    exports2.wrapXOFConstructorWithOpts = createXOFer;
    function randomBytes(bytesLength = 32) {
      if (crypto_1.crypto && typeof crypto_1.crypto.getRandomValues === "function") {
        return crypto_1.crypto.getRandomValues(new Uint8Array(bytesLength));
      }
      if (crypto_1.crypto && typeof crypto_1.crypto.randomBytes === "function") {
        return Uint8Array.from(crypto_1.crypto.randomBytes(bytesLength));
      }
      throw new Error("crypto.getRandomValues must be defined");
    }
  }
});

// ../../.bkjs/lib/node_modules/formidable/node_modules/@noble/hashes/sha3.js
var require_sha3 = __commonJS({
  "../../.bkjs/lib/node_modules/formidable/node_modules/@noble/hashes/sha3.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.shake256 = exports2.shake128 = exports2.keccak_512 = exports2.keccak_384 = exports2.keccak_256 = exports2.keccak_224 = exports2.sha3_512 = exports2.sha3_384 = exports2.sha3_256 = exports2.sha3_224 = exports2.Keccak = void 0;
    exports2.keccakP = keccakP;
    var _u64_ts_1 = require_u64();
    var utils_ts_1 = require_utils();
    var _0n = BigInt(0);
    var _1n = BigInt(1);
    var _2n = BigInt(2);
    var _7n = BigInt(7);
    var _256n = BigInt(256);
    var _0x71n = BigInt(113);
    var SHA3_PI = [];
    var SHA3_ROTL = [];
    var _SHA3_IOTA = [];
    for (let round = 0, R = _1n, x = 1, y = 0; round < 24; round++) {
      [x, y] = [y, (2 * x + 3 * y) % 5];
      SHA3_PI.push(2 * (5 * y + x));
      SHA3_ROTL.push((round + 1) * (round + 2) / 2 % 64);
      let t = _0n;
      for (let j = 0; j < 7; j++) {
        R = (R << _1n ^ (R >> _7n) * _0x71n) % _256n;
        if (R & _2n)
          t ^= _1n << (_1n << /* @__PURE__ */ BigInt(j)) - _1n;
      }
      _SHA3_IOTA.push(t);
    }
    var IOTAS = (0, _u64_ts_1.split)(_SHA3_IOTA, true);
    var SHA3_IOTA_H = IOTAS[0];
    var SHA3_IOTA_L = IOTAS[1];
    var rotlH = (h, l, s2) => s2 > 32 ? (0, _u64_ts_1.rotlBH)(h, l, s2) : (0, _u64_ts_1.rotlSH)(h, l, s2);
    var rotlL = (h, l, s2) => s2 > 32 ? (0, _u64_ts_1.rotlBL)(h, l, s2) : (0, _u64_ts_1.rotlSL)(h, l, s2);
    function keccakP(s2, rounds = 24) {
      const B = new Uint32Array(5 * 2);
      for (let round = 24 - rounds; round < 24; round++) {
        for (let x = 0; x < 10; x++)
          B[x] = s2[x] ^ s2[x + 10] ^ s2[x + 20] ^ s2[x + 30] ^ s2[x + 40];
        for (let x = 0; x < 10; x += 2) {
          const idx1 = (x + 8) % 10;
          const idx0 = (x + 2) % 10;
          const B0 = B[idx0];
          const B1 = B[idx0 + 1];
          const Th = rotlH(B0, B1, 1) ^ B[idx1];
          const Tl = rotlL(B0, B1, 1) ^ B[idx1 + 1];
          for (let y = 0; y < 50; y += 10) {
            s2[x + y] ^= Th;
            s2[x + y + 1] ^= Tl;
          }
        }
        let curH = s2[2];
        let curL = s2[3];
        for (let t = 0; t < 24; t++) {
          const shift = SHA3_ROTL[t];
          const Th = rotlH(curH, curL, shift);
          const Tl = rotlL(curH, curL, shift);
          const PI = SHA3_PI[t];
          curH = s2[PI];
          curL = s2[PI + 1];
          s2[PI] = Th;
          s2[PI + 1] = Tl;
        }
        for (let y = 0; y < 50; y += 10) {
          for (let x = 0; x < 10; x++)
            B[x] = s2[y + x];
          for (let x = 0; x < 10; x++)
            s2[y + x] ^= ~B[(x + 2) % 10] & B[(x + 4) % 10];
        }
        s2[0] ^= SHA3_IOTA_H[round];
        s2[1] ^= SHA3_IOTA_L[round];
      }
      (0, utils_ts_1.clean)(B);
    }
    var Keccak = class _Keccak extends utils_ts_1.Hash {
      // NOTE: we accept arguments in bytes instead of bits here.
      constructor(blockLen, suffix, outputLen, enableXOF = false, rounds = 24) {
        super();
        this.pos = 0;
        this.posOut = 0;
        this.finished = false;
        this.destroyed = false;
        this.enableXOF = false;
        this.blockLen = blockLen;
        this.suffix = suffix;
        this.outputLen = outputLen;
        this.enableXOF = enableXOF;
        this.rounds = rounds;
        (0, utils_ts_1.anumber)(outputLen);
        if (!(0 < blockLen && blockLen < 200))
          throw new Error("only keccak-f1600 function is supported");
        this.state = new Uint8Array(200);
        this.state32 = (0, utils_ts_1.u32)(this.state);
      }
      clone() {
        return this._cloneInto();
      }
      keccak() {
        (0, utils_ts_1.swap32IfBE)(this.state32);
        keccakP(this.state32, this.rounds);
        (0, utils_ts_1.swap32IfBE)(this.state32);
        this.posOut = 0;
        this.pos = 0;
      }
      update(data) {
        (0, utils_ts_1.aexists)(this);
        data = (0, utils_ts_1.toBytes)(data);
        (0, utils_ts_1.abytes)(data);
        const { blockLen, state } = this;
        const len = data.length;
        for (let pos = 0; pos < len; ) {
          const take = Math.min(blockLen - this.pos, len - pos);
          for (let i = 0; i < take; i++)
            state[this.pos++] ^= data[pos++];
          if (this.pos === blockLen)
            this.keccak();
        }
        return this;
      }
      finish() {
        if (this.finished)
          return;
        this.finished = true;
        const { state, suffix, pos, blockLen } = this;
        state[pos] ^= suffix;
        if ((suffix & 128) !== 0 && pos === blockLen - 1)
          this.keccak();
        state[blockLen - 1] ^= 128;
        this.keccak();
      }
      writeInto(out) {
        (0, utils_ts_1.aexists)(this, false);
        (0, utils_ts_1.abytes)(out);
        this.finish();
        const bufferOut = this.state;
        const { blockLen } = this;
        for (let pos = 0, len = out.length; pos < len; ) {
          if (this.posOut >= blockLen)
            this.keccak();
          const take = Math.min(blockLen - this.posOut, len - pos);
          out.set(bufferOut.subarray(this.posOut, this.posOut + take), pos);
          this.posOut += take;
          pos += take;
        }
        return out;
      }
      xofInto(out) {
        if (!this.enableXOF)
          throw new Error("XOF is not possible for this instance");
        return this.writeInto(out);
      }
      xof(bytes) {
        (0, utils_ts_1.anumber)(bytes);
        return this.xofInto(new Uint8Array(bytes));
      }
      digestInto(out) {
        (0, utils_ts_1.aoutput)(out, this);
        if (this.finished)
          throw new Error("digest() was already called");
        this.writeInto(out);
        this.destroy();
        return out;
      }
      digest() {
        return this.digestInto(new Uint8Array(this.outputLen));
      }
      destroy() {
        this.destroyed = true;
        (0, utils_ts_1.clean)(this.state);
      }
      _cloneInto(to) {
        const { blockLen, suffix, outputLen, rounds, enableXOF } = this;
        to || (to = new _Keccak(blockLen, suffix, outputLen, enableXOF, rounds));
        to.state32.set(this.state32);
        to.pos = this.pos;
        to.posOut = this.posOut;
        to.finished = this.finished;
        to.rounds = rounds;
        to.suffix = suffix;
        to.outputLen = outputLen;
        to.enableXOF = enableXOF;
        to.destroyed = this.destroyed;
        return to;
      }
    };
    exports2.Keccak = Keccak;
    var gen = (suffix, blockLen, outputLen) => (0, utils_ts_1.createHasher)(() => new Keccak(blockLen, suffix, outputLen));
    exports2.sha3_224 = (() => gen(6, 144, 224 / 8))();
    exports2.sha3_256 = (() => gen(6, 136, 256 / 8))();
    exports2.sha3_384 = (() => gen(6, 104, 384 / 8))();
    exports2.sha3_512 = (() => gen(6, 72, 512 / 8))();
    exports2.keccak_224 = (() => gen(1, 144, 224 / 8))();
    exports2.keccak_256 = (() => gen(1, 136, 256 / 8))();
    exports2.keccak_384 = (() => gen(1, 104, 384 / 8))();
    exports2.keccak_512 = (() => gen(1, 72, 512 / 8))();
    var genShake = (suffix, blockLen, outputLen) => (0, utils_ts_1.createXOFer)((opts = {}) => new Keccak(blockLen, suffix, opts.dkLen === void 0 ? outputLen : opts.dkLen, true));
    exports2.shake128 = (() => genShake(31, 168, 128 / 8))();
    exports2.shake256 = (() => genShake(31, 136, 256 / 8))();
  }
});

// ../../.bkjs/lib/node_modules/formidable/node_modules/@paralleldrive/cuid2/src/index.js
var require_src = __commonJS({
  "../../.bkjs/lib/node_modules/formidable/node_modules/@paralleldrive/cuid2/src/index.js"(exports2, module2) {
    var { sha3_512: sha3 } = require_sha3();
    var defaultLength = 24;
    var bigLength = 32;
    var createEntropy = (length = 4, random = Math.random) => {
      let entropy = "";
      while (entropy.length < length) {
        entropy = entropy + Math.floor(random() * 36).toString(36);
      }
      return entropy;
    };
    function bufToBigInt(buf) {
      let bits = 8n;
      let value = 0n;
      for (const i of buf.values()) {
        const bi = BigInt(i);
        value = (value << bits) + bi;
      }
      return value;
    }
    var hash = (input = "") => {
      return bufToBigInt(sha3(input)).toString(36).slice(1);
    };
    var alphabet = Array.from(
      { length: 26 },
      (x, i) => String.fromCharCode(i + 97)
    );
    var randomLetter = (random) => alphabet[Math.floor(random() * alphabet.length)];
    var createFingerprint = ({
      globalObj = typeof global !== "undefined" ? global : typeof window !== "undefined" ? window : {},
      random = Math.random
    } = {}) => {
      const globals = Object.keys(globalObj).toString();
      const sourceString = globals.length ? globals + createEntropy(bigLength, random) : createEntropy(bigLength, random);
      return hash(sourceString).substring(0, bigLength);
    };
    var createCounter = (count) => () => {
      return count++;
    };
    var initialCountMax = 476782367;
    var init2 = ({
      // Fallback if the user does not pass in a CSPRNG. This should be OK
      // because we don't rely solely on the random number generator for entropy.
      // We also use the host fingerprint, current time, and a session counter.
      random = Math.random,
      counter = createCounter(Math.floor(random() * initialCountMax)),
      length = defaultLength,
      fingerprint = createFingerprint({ random })
    } = {}) => {
      return function cuid22() {
        const firstLetter = randomLetter(random);
        const time = Date.now().toString(36);
        const count = counter().toString(36);
        const salt = createEntropy(length, random);
        const hashInput = `${time + salt + count + fingerprint}`;
        return `${firstLetter + hash(hashInput).substring(1, length)}`;
      };
    };
    var createId2 = init2();
    var isCuid = (id, { minLength = 2, maxLength = bigLength } = {}) => {
      const length = id.length;
      const regex = /^[0-9a-z]+$/;
      try {
        if (typeof id === "string" && length >= minLength && length <= maxLength && regex.test(id))
          return true;
      } finally {
      }
      return false;
    };
    module2.exports.getConstants = () => ({ defaultLength, bigLength });
    module2.exports.init = init2;
    module2.exports.createId = createId2;
    module2.exports.bufToBigInt = bufToBigInt;
    module2.exports.createCounter = createCounter;
    module2.exports.createFingerprint = createFingerprint;
    module2.exports.isCuid = isCuid;
  }
});

// ../../.bkjs/lib/node_modules/formidable/node_modules/@paralleldrive/cuid2/index.js
var require_cuid2 = __commonJS({
  "../../.bkjs/lib/node_modules/formidable/node_modules/@paralleldrive/cuid2/index.js"(exports2, module2) {
    var { createId: createId2, init: init2, getConstants, isCuid } = require_src();
    module2.exports.createId = createId2;
    module2.exports.init = init2;
    module2.exports.getConstants = getConstants;
    module2.exports.isCuid = isCuid;
  }
});

// ../../.bkjs/lib/node_modules/formidable/node_modules/wrappy/wrappy.js
var require_wrappy = __commonJS({
  "../../.bkjs/lib/node_modules/formidable/node_modules/wrappy/wrappy.js"(exports2, module2) {
    module2.exports = wrappy;
    function wrappy(fn, cb) {
      if (fn && cb) return wrappy(fn)(cb);
      if (typeof fn !== "function")
        throw new TypeError("need wrapper function");
      Object.keys(fn).forEach(function(k) {
        wrapper[k] = fn[k];
      });
      return wrapper;
      function wrapper() {
        var args = new Array(arguments.length);
        for (var i = 0; i < args.length; i++) {
          args[i] = arguments[i];
        }
        var ret = fn.apply(this, args);
        var cb2 = args[args.length - 1];
        if (typeof ret === "function" && ret !== cb2) {
          Object.keys(cb2).forEach(function(k) {
            ret[k] = cb2[k];
          });
        }
        return ret;
      }
    }
  }
});

// ../../.bkjs/lib/node_modules/formidable/node_modules/asap/raw.js
var require_raw = __commonJS({
  "../../.bkjs/lib/node_modules/formidable/node_modules/asap/raw.js"(exports2, module2) {
    "use strict";
    var domain;
    var hasSetImmediate = typeof setImmediate === "function";
    module2.exports = rawAsap;
    function rawAsap(task) {
      if (!queue.length) {
        requestFlush();
        flushing = true;
      }
      queue[queue.length] = task;
    }
    var queue = [];
    var flushing = false;
    var index = 0;
    var capacity = 1024;
    function flush() {
      while (index < queue.length) {
        var currentIndex = index;
        index = index + 1;
        queue[currentIndex].call();
        if (index > capacity) {
          for (var scan = 0, newLength = queue.length - index; scan < newLength; scan++) {
            queue[scan] = queue[scan + index];
          }
          queue.length -= index;
          index = 0;
        }
      }
      queue.length = 0;
      index = 0;
      flushing = false;
    }
    rawAsap.requestFlush = requestFlush;
    function requestFlush() {
      var parentDomain = process.domain;
      if (parentDomain) {
        if (!domain) {
          domain = require("domain");
        }
        domain.active = process.domain = null;
      }
      if (flushing && hasSetImmediate) {
        setImmediate(flush);
      } else {
        process.nextTick(flush);
      }
      if (parentDomain) {
        domain.active = process.domain = parentDomain;
      }
    }
  }
});

// ../../.bkjs/lib/node_modules/formidable/node_modules/asap/asap.js
var require_asap = __commonJS({
  "../../.bkjs/lib/node_modules/formidable/node_modules/asap/asap.js"(exports2, module2) {
    "use strict";
    var rawAsap = require_raw();
    var freeTasks = [];
    module2.exports = asap;
    function asap(task) {
      var rawTask;
      if (freeTasks.length) {
        rawTask = freeTasks.pop();
      } else {
        rawTask = new RawTask();
      }
      rawTask.task = task;
      rawTask.domain = process.domain;
      rawAsap(rawTask);
    }
    function RawTask() {
      this.task = null;
      this.domain = null;
    }
    RawTask.prototype.call = function() {
      if (this.domain) {
        this.domain.enter();
      }
      var threw = true;
      try {
        this.task.call();
        threw = false;
        if (this.domain) {
          this.domain.exit();
        }
      } finally {
        if (threw) {
          rawAsap.requestFlush();
        }
        this.task = null;
        this.domain = null;
        freeTasks.push(this);
      }
    };
  }
});

// ../../.bkjs/lib/node_modules/formidable/node_modules/dezalgo/dezalgo.js
var require_dezalgo = __commonJS({
  "../../.bkjs/lib/node_modules/formidable/node_modules/dezalgo/dezalgo.js"(exports2, module2) {
    var wrappy = require_wrappy();
    module2.exports = wrappy(dezalgo2);
    var asap = require_asap();
    function dezalgo2(cb) {
      var sync = true;
      asap(function() {
        sync = false;
      });
      return function zalgoSafe() {
        var args = arguments;
        var me = this;
        if (sync)
          asap(function() {
            cb.apply(me, args);
          });
        else
          cb.apply(me, args);
      };
    }
  }
});

// ../../.bkjs/lib/node_modules/formidable/node_modules/once/once.js
var require_once = __commonJS({
  "../../.bkjs/lib/node_modules/formidable/node_modules/once/once.js"(exports2, module2) {
    var wrappy = require_wrappy();
    module2.exports = wrappy(once2);
    module2.exports.strict = wrappy(onceStrict);
    once2.proto = once2(function() {
      Object.defineProperty(Function.prototype, "once", {
        value: function() {
          return once2(this);
        },
        configurable: true
      });
      Object.defineProperty(Function.prototype, "onceStrict", {
        value: function() {
          return onceStrict(this);
        },
        configurable: true
      });
    });
    function once2(fn) {
      var f2 = function() {
        if (f2.called) return f2.value;
        f2.called = true;
        return f2.value = fn.apply(this, arguments);
      };
      f2.called = false;
      return f2;
    }
    function onceStrict(fn) {
      var f2 = function() {
        if (f2.called)
          throw new Error(f2.onceError);
        f2.called = true;
        return f2.value = fn.apply(this, arguments);
      };
      var name = fn.name || "Function wrapped with `once`";
      f2.onceError = name + " shouldn't be called more than once";
      f2.called = false;
      return f2;
    }
  }
});

// ../../.bkjs/lib/node_modules/formidable/dist/index.cjs
Object.defineProperty(exports, "__esModule", { value: true });
var fs = require("node:fs");
var crypto = require("node:crypto");
var node_events = require("node:events");
var cuid2 = require_cuid2();
var dezalgo = require_dezalgo();
var fsPromises = require("node:fs/promises");
var os = require("node:os");
var path = require("node:path");
var node_string_decoder = require("node:string_decoder");
var once = require_once();
var node_stream = require("node:stream");
var PersistentFile = class extends node_events.EventEmitter {
  constructor({ filepath, newFilename, originalFilename, mimetype, hashAlgorithm }) {
    super();
    this.lastModifiedDate = null;
    Object.assign(this, { filepath, newFilename, originalFilename, mimetype, hashAlgorithm });
    this.size = 0;
    this._writeStream = null;
    if (typeof this.hashAlgorithm === "string") {
      this.hash = crypto.createHash(this.hashAlgorithm);
    } else {
      this.hash = null;
    }
  }
  open() {
    this._writeStream = fs.createWriteStream(this.filepath);
    this._writeStream.on("error", (err) => {
      this.emit("error", err);
    });
  }
  toJSON() {
    const json = {
      size: this.size,
      filepath: this.filepath,
      newFilename: this.newFilename,
      mimetype: this.mimetype,
      mtime: this.lastModifiedDate,
      length: this.length,
      originalFilename: this.originalFilename
    };
    if (this.hash && this.hash !== "") {
      json.hash = this.hash;
    }
    return json;
  }
  toString() {
    return `PersistentFile: ${this.newFilename}, Original: ${this.originalFilename}, Path: ${this.filepath}`;
  }
  write(buffer, cb) {
    if (this.hash) {
      this.hash.update(buffer);
    }
    if (this._writeStream.closed) {
      cb();
      return;
    }
    this._writeStream.write(buffer, () => {
      this.lastModifiedDate = /* @__PURE__ */ new Date();
      this.size += buffer.length;
      this.emit("progress", this.size);
      cb();
    });
  }
  end(cb) {
    if (this.hash) {
      this.hash = this.hash.digest("hex");
    }
    this._writeStream.end(() => {
      this.emit("end");
      cb();
    });
  }
  destroy() {
    this._writeStream.destroy();
    const filepath = this.filepath;
    setTimeout(function() {
      fs.unlink(filepath, () => {
      });
    }, 1);
  }
};
var VolatileFile = class extends node_events.EventEmitter {
  constructor({ filepath, newFilename, originalFilename, mimetype, hashAlgorithm, createFileWriteStream }) {
    super();
    this.lastModifiedDate = null;
    Object.assign(this, { filepath, newFilename, originalFilename, mimetype, hashAlgorithm, createFileWriteStream });
    this.size = 0;
    this._writeStream = null;
    if (typeof this.hashAlgorithm === "string") {
      this.hash = crypto.createHash(this.hashAlgorithm);
    } else {
      this.hash = null;
    }
  }
  open() {
    this._writeStream = this.createFileWriteStream(this);
    this._writeStream.on("error", (err) => {
      this.emit("error", err);
    });
  }
  destroy() {
    this._writeStream.destroy();
  }
  toJSON() {
    const json = {
      size: this.size,
      newFilename: this.newFilename,
      length: this.length,
      originalFilename: this.originalFilename,
      mimetype: this.mimetype
    };
    if (this.hash && this.hash !== "") {
      json.hash = this.hash;
    }
    return json;
  }
  toString() {
    return `VolatileFile: ${this.originalFilename}`;
  }
  write(buffer, cb) {
    if (this.hash) {
      this.hash.update(buffer);
    }
    if (this._writeStream.closed || this._writeStream.destroyed) {
      cb();
      return;
    }
    this._writeStream.write(buffer, () => {
      this.size += buffer.length;
      this.emit("progress", this.size);
      cb();
    });
  }
  end(cb) {
    if (this.hash) {
      this.hash = this.hash.digest("hex");
    }
    this._writeStream.end(() => {
      this.emit("end");
      cb();
    });
  }
};
var missingPlugin = 1e3;
var pluginFunction = 1001;
var aborted = 1002;
var noParser = 1003;
var uninitializedParser = 1004;
var filenameNotString = 1005;
var maxFieldsSizeExceeded = 1006;
var maxFieldsExceeded = 1007;
var smallerThanMinFileSize = 1008;
var biggerThanTotalMaxFileSize = 1009;
var noEmptyFiles = 1010;
var missingContentType = 1011;
var malformedMultipart = 1012;
var missingMultipartBoundary = 1013;
var unknownTransferEncoding = 1014;
var maxFilesExceeded = 1015;
var biggerThanMaxFileSize = 1016;
var pluginFailed = 1017;
var cannotCreateDir = 1018;
var FormidableError = class extends Error {
  constructor(message, internalCode, httpCode = 500) {
    super(message);
    this.code = internalCode;
    this.httpCode = httpCode;
  }
};
var FormidableError$1 = /* @__PURE__ */ Object.freeze({
  __proto__: null,
  aborted,
  biggerThanMaxFileSize,
  biggerThanTotalMaxFileSize,
  cannotCreateDir,
  default: FormidableError,
  filenameNotString,
  malformedMultipart,
  maxFieldsExceeded,
  maxFieldsSizeExceeded,
  maxFilesExceeded,
  missingContentType,
  missingMultipartBoundary,
  missingPlugin,
  noEmptyFiles,
  noParser,
  pluginFailed,
  pluginFunction,
  smallerThanMinFileSize,
  uninitializedParser,
  unknownTransferEncoding
});
var DummyParser = class extends node_stream.Transform {
  constructor(incomingForm, options = {}) {
    super();
    this.globalOptions = { ...options };
    this.incomingForm = incomingForm;
  }
  _flush(callback) {
    this.incomingForm.ended = true;
    this.incomingForm._maybeEnd();
    callback();
  }
};
var s = 0;
var STATE = {
  PARSER_UNINITIALIZED: s++,
  START: s++,
  START_BOUNDARY: s++,
  HEADER_FIELD_START: s++,
  HEADER_FIELD: s++,
  HEADER_VALUE_START: s++,
  HEADER_VALUE: s++,
  HEADER_VALUE_ALMOST_DONE: s++,
  HEADERS_ALMOST_DONE: s++,
  PART_DATA_START: s++,
  PART_DATA: s++,
  PART_END: s++,
  END: s++
};
var f = 1;
var FBOUNDARY = { PART_BOUNDARY: f, LAST_BOUNDARY: f *= 2 };
var LF = 10;
var CR = 13;
var SPACE = 32;
var HYPHEN = 45;
var COLON = 58;
var A = 97;
var Z = 122;
function lower(c) {
  return c | 32;
}
var STATES = {};
Object.keys(STATE).forEach((stateName) => {
  STATES[stateName] = STATE[stateName];
});
var MultipartParser = class _MultipartParser extends node_stream.Transform {
  constructor(options = {}) {
    super({ readableObjectMode: true });
    this.boundary = null;
    this.boundaryChars = null;
    this.lookbehind = null;
    this.bufferLength = 0;
    this.state = STATE.PARSER_UNINITIALIZED;
    this.globalOptions = { ...options };
    this.index = null;
    this.flags = 0;
  }
  _endUnexpected() {
    return new FormidableError(
      `MultipartParser.end(): stream ended unexpectedly: ${this.explain()}`,
      malformedMultipart,
      400
    );
  }
  _flush(done) {
    if (this.state === STATE.HEADER_FIELD_START && this.index === 0 || this.state === STATE.PART_DATA && this.index === this.boundary.length) {
      this._handleCallback("partEnd");
      this._handleCallback("end");
      done();
    } else if (this.state !== STATE.END) {
      done(this._endUnexpected());
    } else {
      done();
    }
  }
  initWithBoundary(str) {
    this.boundary = Buffer.from(`\r
--${str}`);
    this.lookbehind = Buffer.alloc(this.boundary.length + 8);
    this.state = STATE.START;
    this.boundaryChars = {};
    for (let i = 0; i < this.boundary.length; i++) {
      this.boundaryChars[this.boundary[i]] = true;
    }
  }
  // eslint-disable-next-line max-params
  _handleCallback(name, buf, start, end) {
    if (start !== void 0 && start === end) {
      return;
    }
    this.push({ name, buffer: buf, start, end });
  }
  // eslint-disable-next-line max-statements
  _transform(buffer, _, done) {
    let i = 0;
    let prevIndex = this.index;
    let { index, state, flags } = this;
    const { lookbehind, boundary, boundaryChars } = this;
    const boundaryLength = boundary.length;
    const boundaryEnd = boundaryLength - 1;
    this.bufferLength = buffer.length;
    let c = null;
    let cl = null;
    const setMark = (name, idx) => {
      this[`${name}Mark`] = typeof idx === "number" ? idx : i;
    };
    const clearMarkSymbol = (name) => {
      delete this[`${name}Mark`];
    };
    const dataCallback = (name, shouldClear) => {
      const markSymbol = `${name}Mark`;
      if (!(markSymbol in this)) {
        return;
      }
      if (!shouldClear) {
        this._handleCallback(name, buffer, this[markSymbol], buffer.length);
        setMark(name, 0);
      } else {
        this._handleCallback(name, buffer, this[markSymbol], i);
        clearMarkSymbol(name);
      }
    };
    for (i = 0; i < this.bufferLength; i++) {
      c = buffer[i];
      switch (state) {
        case STATE.PARSER_UNINITIALIZED:
          done(this._endUnexpected());
          return;
        case STATE.START:
          index = 0;
          state = STATE.START_BOUNDARY;
        case STATE.START_BOUNDARY:
          if (index === boundary.length - 2) {
            if (c === HYPHEN) {
              flags |= FBOUNDARY.LAST_BOUNDARY;
            } else if (c !== CR) {
              done(this._endUnexpected());
              return;
            }
            index++;
            break;
          } else if (index - 1 === boundary.length - 2) {
            if (flags & FBOUNDARY.LAST_BOUNDARY && c === HYPHEN) {
              this._handleCallback("end");
              state = STATE.END;
              flags = 0;
            } else if (!(flags & FBOUNDARY.LAST_BOUNDARY) && c === LF) {
              index = 0;
              this._handleCallback("partBegin");
              state = STATE.HEADER_FIELD_START;
            } else {
              done(this._endUnexpected());
              return;
            }
            break;
          }
          if (c !== boundary[index + 2]) {
            index = -2;
          }
          if (c === boundary[index + 2]) {
            index++;
          }
          break;
        case STATE.HEADER_FIELD_START:
          state = STATE.HEADER_FIELD;
          setMark("headerField");
          index = 0;
        case STATE.HEADER_FIELD:
          if (c === CR) {
            clearMarkSymbol("headerField");
            state = STATE.HEADERS_ALMOST_DONE;
            break;
          }
          index++;
          if (c === HYPHEN) {
            break;
          }
          if (c === COLON) {
            if (index === 1) {
              done(this._endUnexpected());
              return;
            }
            dataCallback("headerField", true);
            state = STATE.HEADER_VALUE_START;
            break;
          }
          cl = lower(c);
          if (cl < A || cl > Z) {
            done(this._endUnexpected());
            return;
          }
          break;
        case STATE.HEADER_VALUE_START:
          if (c === SPACE) {
            break;
          }
          setMark("headerValue");
          state = STATE.HEADER_VALUE;
        case STATE.HEADER_VALUE:
          if (c === CR) {
            dataCallback("headerValue", true);
            this._handleCallback("headerEnd");
            state = STATE.HEADER_VALUE_ALMOST_DONE;
          }
          break;
        case STATE.HEADER_VALUE_ALMOST_DONE:
          if (c !== LF) {
            done(this._endUnexpected());
            return;
          }
          state = STATE.HEADER_FIELD_START;
          break;
        case STATE.HEADERS_ALMOST_DONE:
          if (c !== LF) {
            done(this._endUnexpected());
            return;
          }
          this._handleCallback("headersEnd");
          state = STATE.PART_DATA_START;
          break;
        case STATE.PART_DATA_START:
          state = STATE.PART_DATA;
          setMark("partData");
        case STATE.PART_DATA:
          prevIndex = index;
          if (index === 0) {
            i += boundaryEnd;
            while (i < this.bufferLength && !(buffer[i] in boundaryChars)) {
              i += boundaryLength;
            }
            i -= boundaryEnd;
            c = buffer[i];
          }
          if (index < boundary.length) {
            if (boundary[index] === c) {
              if (index === 0) {
                dataCallback("partData", true);
              }
              index++;
            } else {
              index = 0;
            }
          } else if (index === boundary.length) {
            index++;
            if (c === CR) {
              flags |= FBOUNDARY.PART_BOUNDARY;
            } else if (c === HYPHEN) {
              flags |= FBOUNDARY.LAST_BOUNDARY;
            } else {
              index = 0;
            }
          } else if (index - 1 === boundary.length) {
            if (flags & FBOUNDARY.PART_BOUNDARY) {
              index = 0;
              if (c === LF) {
                flags &= ~FBOUNDARY.PART_BOUNDARY;
                this._handleCallback("partEnd");
                this._handleCallback("partBegin");
                state = STATE.HEADER_FIELD_START;
                break;
              }
            } else if (flags & FBOUNDARY.LAST_BOUNDARY) {
              if (c === HYPHEN) {
                this._handleCallback("partEnd");
                this._handleCallback("end");
                state = STATE.END;
                flags = 0;
              } else {
                index = 0;
              }
            } else {
              index = 0;
            }
          }
          if (index > 0) {
            lookbehind[index - 1] = c;
          } else if (prevIndex > 0) {
            this._handleCallback("partData", lookbehind, 0, prevIndex);
            prevIndex = 0;
            setMark("partData");
            i--;
          }
          break;
        case STATE.END:
          break;
        default:
          done(this._endUnexpected());
          return;
      }
    }
    dataCallback("headerField");
    dataCallback("headerValue");
    dataCallback("partData");
    this.index = index;
    this.state = state;
    this.flags = flags;
    done();
    return this.bufferLength;
  }
  explain() {
    return `state = ${_MultipartParser.stateToString(this.state)}`;
  }
};
MultipartParser.stateToString = (stateNumber) => {
  for (const stateName in STATE) {
    const number = STATE[stateName];
    if (number === stateNumber) return stateName;
  }
};
var MultipartParser$1 = Object.assign(MultipartParser, { STATES });
var OctetStreamParser = class extends node_stream.PassThrough {
  constructor(options = {}) {
    super();
    this.globalOptions = { ...options };
  }
};
var octetStreamType = "octet-stream";
async function plugin$3(formidable2, options) {
  const self = this || formidable2;
  if (/octet-stream/i.test(self.headers["content-type"])) {
    await init$2.call(self, self, options);
  }
  return self;
}
async function init$2(_self, _opts) {
  this.type = octetStreamType;
  const originalFilename = this.headers["x-file-name"];
  const mimetype = this.headers["content-type"];
  const thisPart = {
    originalFilename,
    mimetype
  };
  const newFilename = this._getNewName(thisPart);
  const filepath = this._joinDirectoryName(newFilename);
  const file = await this._newFile({
    newFilename,
    filepath,
    originalFilename,
    mimetype
  });
  this.emit("fileBegin", originalFilename, file);
  file.open();
  this.openedFiles.push(file);
  this._flushing += 1;
  this._parser = new OctetStreamParser(this.options);
  let outstandingWrites = 0;
  this._parser.on("data", (buffer) => {
    this.pause();
    outstandingWrites += 1;
    file.write(buffer, () => {
      outstandingWrites -= 1;
      this.resume();
      if (this.ended) {
        this._parser.emit("doneWritingFile");
      }
    });
  });
  this._parser.on("end", () => {
    this._flushing -= 1;
    this.ended = true;
    const done = () => {
      file.end(() => {
        this.emit("file", "file", file);
        this._maybeEnd();
      });
    };
    if (outstandingWrites === 0) {
      done();
    } else {
      this._parser.once("doneWritingFile", done);
    }
  });
  return this;
}
var QuerystringParser = class extends node_stream.Transform {
  constructor(options = {}) {
    super({ readableObjectMode: true });
    this.globalOptions = { ...options };
    this.buffer = "";
    this.bufferLength = 0;
  }
  _transform(buffer, encoding, callback) {
    this.buffer += buffer.toString("ascii");
    this.bufferLength = this.buffer.length;
    callback();
  }
  _flush(callback) {
    const fields = new URLSearchParams(this.buffer);
    for (const [key, value] of fields) {
      this.push({
        key,
        value
      });
    }
    this.buffer = "";
    callback();
  }
};
var querystringType = "urlencoded";
function plugin$2(formidable2, options) {
  const self = this || formidable2;
  if (/urlencoded/i.test(self.headers["content-type"])) {
    init$1.call(self, self, options);
  }
  return self;
}
function init$1(_self, _opts) {
  this.type = querystringType;
  const parser = new QuerystringParser(this.options);
  parser.on("data", ({ key, value }) => {
    this.emit("field", key, value);
  });
  parser.once("end", () => {
    this.ended = true;
    this._maybeEnd();
  });
  this._parser = parser;
  return this;
}
var multipartType = "multipart";
function plugin$1(formidable2, options) {
  const self = this || formidable2;
  const multipart = /multipart/i.test(self.headers["content-type"]);
  if (multipart) {
    const m = self.headers["content-type"].match(
      /boundary=(?:"([^"]+)"|([^;]+))/i
    );
    if (m) {
      const initMultipart = createInitMultipart(m[1] || m[2]);
      initMultipart.call(self, self, options);
    } else {
      const err = new FormidableError(
        "bad content-type header, no multipart boundary",
        missingMultipartBoundary,
        400
      );
      self._error(err);
    }
  }
  return self;
}
function createInitMultipart(boundary) {
  return function initMultipart() {
    this.type = multipartType;
    const parser = new MultipartParser$1(this.options);
    let headerField;
    let headerValue;
    let part;
    parser.initWithBoundary(boundary);
    parser.on("data", async ({ name, buffer, start, end }) => {
      if (name === "partBegin") {
        part = new node_stream.Stream();
        part.readable = true;
        part.headers = {};
        part.name = null;
        part.originalFilename = null;
        part.mimetype = null;
        part.transferEncoding = this.options.encoding;
        part.transferBuffer = "";
        headerField = "";
        headerValue = "";
      } else if (name === "headerField") {
        headerField += buffer.toString(this.options.encoding, start, end);
      } else if (name === "headerValue") {
        headerValue += buffer.toString(this.options.encoding, start, end);
      } else if (name === "headerEnd") {
        headerField = headerField.toLowerCase();
        part.headers[headerField] = headerValue;
        const m = headerValue.match(
          // eslint-disable-next-line no-useless-escape
          /\bname=("([^"]*)"|([^\(\)<>@,;:\\"\/\[\]\?=\{\}\s\t/]+))/i
        );
        if (headerField === "content-disposition") {
          if (m) {
            part.name = m[2] || m[3] || "";
          }
          part.originalFilename = this._getFileName(headerValue);
        } else if (headerField === "content-type") {
          part.mimetype = headerValue;
        } else if (headerField === "content-transfer-encoding") {
          part.transferEncoding = headerValue.toLowerCase();
        }
        headerField = "";
        headerValue = "";
      } else if (name === "headersEnd") {
        switch (part.transferEncoding) {
          case "binary":
          case "7bit":
          case "8bit":
          case "utf-8": {
            const dataPropagation = (ctx) => {
              if (ctx.name === "partData") {
                part.emit("data", ctx.buffer.slice(ctx.start, ctx.end));
              }
            };
            const dataStopPropagation = (ctx) => {
              if (ctx.name === "partEnd") {
                part.emit("end");
                parser.off("data", dataPropagation);
                parser.off("data", dataStopPropagation);
              }
            };
            parser.on("data", dataPropagation);
            parser.on("data", dataStopPropagation);
            break;
          }
          case "base64": {
            const dataPropagation = (ctx) => {
              if (ctx.name === "partData") {
                part.transferBuffer += ctx.buffer.slice(ctx.start, ctx.end).toString("ascii");
                const offset = parseInt(part.transferBuffer.length / 4, 10) * 4;
                part.emit(
                  "data",
                  Buffer.from(
                    part.transferBuffer.substring(0, offset),
                    "base64"
                  )
                );
                part.transferBuffer = part.transferBuffer.substring(offset);
              }
            };
            const dataStopPropagation = (ctx) => {
              if (ctx.name === "partEnd") {
                part.emit("data", Buffer.from(part.transferBuffer, "base64"));
                part.emit("end");
                parser.off("data", dataPropagation);
                parser.off("data", dataStopPropagation);
              }
            };
            parser.on("data", dataPropagation);
            parser.on("data", dataStopPropagation);
            break;
          }
          default:
            return this._error(
              new FormidableError(
                "unknown transfer-encoding",
                unknownTransferEncoding,
                501
              )
            );
        }
        this._parser.pause();
        await this.onPart(part);
        this._parser.resume();
      } else if (name === "end") {
        this.ended = true;
        this._maybeEnd();
      }
    });
    this._parser = parser;
  };
}
var JSONParser = class extends node_stream.Transform {
  constructor(options = {}) {
    super({ readableObjectMode: true });
    this.chunks = [];
    this.globalOptions = { ...options };
  }
  _transform(chunk, encoding, callback) {
    this.chunks.push(String(chunk));
    callback();
  }
  _flush(callback) {
    try {
      const fields = JSON.parse(this.chunks.join(""));
      this.push(fields);
    } catch (e) {
      callback(e);
      return;
    }
    this.chunks = null;
    callback();
  }
};
var jsonType = "json";
function plugin(formidable2, options) {
  const self = this || formidable2;
  if (/json/i.test(self.headers["content-type"])) {
    init.call(self, self, options);
  }
  return self;
}
function init(_self, _opts) {
  this.type = jsonType;
  const parser = new JSONParser(this.options);
  parser.on("data", (fields) => {
    this.fields = fields;
  });
  parser.once("end", () => {
    this.ended = true;
    this._maybeEnd();
  });
  this._parser = parser;
}
var CUID2_FINGERPRINT = `${process.env.NODE_ENV}-${os.platform()}-${os.hostname()}`;
var createId = cuid2.init({ length: 25, fingerprint: CUID2_FINGERPRINT.toLowerCase() });
var DEFAULT_OPTIONS = {
  maxFields: 1e3,
  maxFieldsSize: 20 * 1024 * 1024,
  maxFiles: Infinity,
  maxFileSize: 200 * 1024 * 1024,
  maxTotalFileSize: void 0,
  minFileSize: 1,
  allowEmptyFiles: false,
  createDirsFromUploads: false,
  keepExtensions: false,
  encoding: "utf-8",
  hashAlgorithm: false,
  uploadDir: os.tmpdir(),
  enabledPlugins: [plugin$3, plugin$2, plugin$1, plugin],
  fileWriteStreamHandler: null,
  defaultInvalidName: "invalid-name",
  filter(_part) {
    return true;
  },
  filename: void 0
};
function hasOwnProp(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}
var decorateForceSequential = function(promiseCreator) {
  let lastPromise = Promise.resolve();
  return async function(...x) {
    const promiseWeAreWaitingFor = lastPromise;
    let currentPromise;
    let callback;
    lastPromise = new Promise(function(resolve) {
      callback = resolve;
    });
    await promiseWeAreWaitingFor;
    currentPromise = promiseCreator(...x);
    currentPromise.then(callback).catch(callback);
    return currentPromise;
  };
};
var createNecessaryDirectoriesAsync = decorateForceSequential(function(filePath) {
  const directoryname = path.dirname(filePath);
  return fsPromises.mkdir(directoryname, { recursive: true });
});
var invalidExtensionChar = (c) => {
  const code = c.charCodeAt(0);
  return !(code === 46 || // .
  code >= 48 && code <= 57 || code >= 65 && code <= 90 || code >= 97 && code <= 122);
};
var IncomingForm = class extends node_events.EventEmitter {
  constructor(options = {}) {
    super();
    this.options = { ...DEFAULT_OPTIONS, ...options };
    if (!this.options.maxTotalFileSize) {
      this.options.maxTotalFileSize = this.options.maxFileSize;
    }
    const dir = path.resolve(
      this.options.uploadDir || this.options.uploaddir || os.tmpdir()
    );
    this.uploaddir = dir;
    this.uploadDir = dir;
    [
      "error",
      "headers",
      "type",
      "bytesExpected",
      "bytesReceived",
      "_parser",
      "req"
    ].forEach((key) => {
      this[key] = null;
    });
    this._setUpRename();
    this._flushing = 0;
    this._fieldsSize = 0;
    this._totalFileSize = 0;
    this._plugins = [];
    this.openedFiles = [];
    this.options.enabledPlugins = [].concat(this.options.enabledPlugins).filter(Boolean);
    if (this.options.enabledPlugins.length === 0) {
      throw new FormidableError(
        "expect at least 1 enabled builtin plugin, see options.enabledPlugins",
        missingPlugin
      );
    }
    this.options.enabledPlugins.forEach((plugin2) => {
      this.use(plugin2);
    });
    this._setUpMaxFields();
    this._setUpMaxFiles();
    this.ended = void 0;
    this.type = void 0;
  }
  use(plugin2) {
    if (typeof plugin2 !== "function") {
      throw new FormidableError(
        ".use: expect `plugin` to be a function",
        pluginFunction
      );
    }
    this._plugins.push(plugin2.bind(this));
    return this;
  }
  pause() {
    try {
      this.req.pause();
    } catch (err) {
      if (!this.ended) {
        this._error(err);
      }
      return false;
    }
    return true;
  }
  resume() {
    try {
      this.req.resume();
    } catch (err) {
      if (!this.ended) {
        this._error(err);
      }
      return false;
    }
    return true;
  }
  // returns a promise if no callback is provided
  async parse(req, cb) {
    this.req = req;
    let promise;
    if (!cb) {
      let resolveRef;
      let rejectRef;
      promise = new Promise((resolve, reject) => {
        resolveRef = resolve;
        rejectRef = reject;
      });
      cb = (err, fields, files2) => {
        if (err) {
          rejectRef(err);
        } else {
          resolveRef([fields, files2]);
        }
      };
    }
    const callback = once(dezalgo(cb));
    this.fields = {};
    const files = {};
    this.on("field", (name, value) => {
      if (this.type === "multipart" || this.type === "urlencoded") {
        if (!hasOwnProp(this.fields, name)) {
          this.fields[name] = [value];
        } else {
          this.fields[name].push(value);
        }
      } else {
        this.fields[name] = value;
      }
    });
    this.on("file", (name, file) => {
      if (!hasOwnProp(files, name)) {
        files[name] = [file];
      } else {
        files[name].push(file);
      }
    });
    this.on("error", (err) => {
      callback(err, this.fields, files);
    });
    this.on("end", () => {
      callback(null, this.fields, files);
    });
    await this.writeHeaders(req.headers);
    req.on("error", (err) => {
      this._error(err);
    }).on("aborted", () => {
      this.emit("aborted");
      this._error(new FormidableError("Request aborted", aborted));
    }).on("data", (buffer) => {
      try {
        this.write(buffer);
      } catch (err) {
        this._error(err);
      }
    }).on("end", () => {
      if (this.error) {
        return;
      }
      if (this._parser) {
        this._parser.end();
      }
    });
    if (promise) {
      return promise;
    }
    return this;
  }
  async writeHeaders(headers) {
    this.headers = headers;
    this._parseContentLength();
    await this._parseContentType();
    if (!this._parser) {
      this._error(
        new FormidableError(
          "no parser found",
          noParser,
          415
          // Unsupported Media Type
        )
      );
      return;
    }
    this._parser.once("error", (error) => {
      this._error(error);
    });
  }
  write(buffer) {
    if (this.error) {
      return null;
    }
    if (!this._parser) {
      this._error(
        new FormidableError("uninitialized parser", uninitializedParser)
      );
      return null;
    }
    this.bytesReceived += buffer.length;
    this.emit("progress", this.bytesReceived, this.bytesExpected);
    this._parser.write(buffer);
    return this.bytesReceived;
  }
  onPart(part) {
    return this._handlePart(part);
  }
  async _handlePart(part) {
    if (part.originalFilename && typeof part.originalFilename !== "string") {
      this._error(
        new FormidableError(
          `the part.originalFilename should be string when it exists`,
          filenameNotString
        )
      );
      return;
    }
    if (!part.mimetype) {
      let value = "";
      const decoder = new node_string_decoder.StringDecoder(
        part.transferEncoding || this.options.encoding
      );
      part.on("data", (buffer) => {
        this._fieldsSize += buffer.length;
        if (this._fieldsSize > this.options.maxFieldsSize) {
          this._error(
            new FormidableError(
              `options.maxFieldsSize (${this.options.maxFieldsSize} bytes) exceeded, received ${this._fieldsSize} bytes of field data`,
              maxFieldsSizeExceeded,
              413
              // Payload Too Large
            )
          );
          return;
        }
        value += decoder.write(buffer);
      });
      part.on("end", () => {
        this.emit("field", part.name, value);
      });
      return;
    }
    if (!this.options.filter(part)) {
      return;
    }
    this._flushing += 1;
    let fileSize = 0;
    const newFilename = this._getNewName(part);
    const filepath = this._joinDirectoryName(newFilename);
    const file = await this._newFile({
      newFilename,
      filepath,
      originalFilename: part.originalFilename,
      mimetype: part.mimetype
    });
    file.on("error", (err) => {
      this._error(err);
    });
    this.emit("fileBegin", part.name, file);
    file.open();
    this.openedFiles.push(file);
    part.on("data", (buffer) => {
      this._totalFileSize += buffer.length;
      fileSize += buffer.length;
      if (this._totalFileSize > this.options.maxTotalFileSize) {
        this._error(
          new FormidableError(
            `options.maxTotalFileSize (${this.options.maxTotalFileSize} bytes) exceeded, received ${this._totalFileSize} bytes of file data`,
            biggerThanTotalMaxFileSize,
            413
          )
        );
        return;
      }
      if (buffer.length === 0) {
        return;
      }
      this.pause();
      file.write(buffer, () => {
        this.resume();
      });
    });
    part.on("end", () => {
      if (!this.options.allowEmptyFiles && fileSize === 0) {
        this._error(
          new FormidableError(
            `options.allowEmptyFiles is false, file size should be greater than 0`,
            noEmptyFiles,
            400
          )
        );
        return;
      }
      if (fileSize < this.options.minFileSize) {
        this._error(
          new FormidableError(
            `options.minFileSize (${this.options.minFileSize} bytes) inferior, received ${fileSize} bytes of file data`,
            smallerThanMinFileSize,
            400
          )
        );
        return;
      }
      if (fileSize > this.options.maxFileSize) {
        this._error(
          new FormidableError(
            `options.maxFileSize (${this.options.maxFileSize} bytes), received ${fileSize} bytes of file data`,
            biggerThanMaxFileSize,
            413
          )
        );
        return;
      }
      file.end(() => {
        this._flushing -= 1;
        this.emit("file", part.name, file);
        this._maybeEnd();
      });
    });
  }
  // eslint-disable-next-line max-statements
  async _parseContentType() {
    if (this.bytesExpected === 0) {
      this._parser = new DummyParser(this, this.options);
      return;
    }
    if (!this.headers["content-type"]) {
      this._error(
        new FormidableError(
          "bad content-type header, no content-type",
          missingContentType,
          400
        )
      );
      return;
    }
    new DummyParser(this, this.options);
    const results = [];
    await Promise.all(this._plugins.map(async (plugin2, idx) => {
      let pluginReturn = null;
      try {
        pluginReturn = await plugin2(this, this.options) || this;
      } catch (err) {
        const error = new FormidableError(
          `plugin on index ${idx} failed with: ${err.message}`,
          pluginFailed,
          500
        );
        error.idx = idx;
        throw error;
      }
      Object.assign(this, pluginReturn);
      this.emit("plugin", idx, pluginReturn);
    }));
    this.emit("pluginsResults", results);
  }
  _error(err, eventName = "error") {
    if (this.error || this.ended) {
      return;
    }
    this.req = null;
    this.error = err;
    this.emit(eventName, err);
    this.openedFiles.forEach((file) => {
      file.destroy();
    });
  }
  _parseContentLength() {
    this.bytesReceived = 0;
    if (this.headers["content-length"]) {
      this.bytesExpected = parseInt(this.headers["content-length"], 10);
    } else if (this.headers["transfer-encoding"] === void 0) {
      this.bytesExpected = 0;
    }
    if (this.bytesExpected !== null) {
      this.emit("progress", this.bytesReceived, this.bytesExpected);
    }
  }
  _newParser() {
    return new MultipartParser$1(this.options);
  }
  async _newFile({ filepath, originalFilename, mimetype, newFilename }) {
    if (this.options.fileWriteStreamHandler) {
      return new VolatileFile({
        newFilename,
        filepath,
        originalFilename,
        mimetype,
        createFileWriteStream: this.options.fileWriteStreamHandler,
        hashAlgorithm: this.options.hashAlgorithm
      });
    }
    if (this.options.createDirsFromUploads) {
      try {
        await createNecessaryDirectoriesAsync(filepath);
      } catch (errorCreatingDir) {
        this._error(new FormidableError(
          `cannot create directory`,
          cannotCreateDir,
          409
        ));
      }
    }
    return new PersistentFile({
      newFilename,
      filepath,
      originalFilename,
      mimetype,
      hashAlgorithm: this.options.hashAlgorithm
    });
  }
  _getFileName(headerValue) {
    const m = headerValue.match(
      /\bfilename=("(.*?)"|([^()<>{}[\]@,;:"?=\s/\t]+))($|;\s)/i
    );
    if (!m) return null;
    const match = m[2] || m[3] || "";
    let originalFilename = match.substr(match.lastIndexOf("\\") + 1);
    originalFilename = originalFilename.replace(/%22/g, '"');
    originalFilename = originalFilename.replace(
      /&#([\d]{4});/g,
      (_, code) => String.fromCharCode(code)
    );
    return originalFilename;
  }
  // able to get composed extension with multiple dots
  // "a.b.c" -> ".b.c"
  // as opposed to path.extname -> ".c"
  _getExtension(str) {
    if (!str) {
      return "";
    }
    const basename = path.basename(str);
    const firstDot = basename.indexOf(".");
    const lastDot = basename.lastIndexOf(".");
    let rawExtname = path.extname(basename);
    if (firstDot !== lastDot) {
      rawExtname = basename.slice(firstDot);
    }
    let filtered;
    const firstInvalidIndex = Array.from(rawExtname).findIndex(invalidExtensionChar);
    if (firstInvalidIndex === -1) {
      filtered = rawExtname;
    } else {
      filtered = rawExtname.substring(0, firstInvalidIndex);
    }
    if (filtered === ".") {
      return "";
    }
    return filtered;
  }
  _joinDirectoryName(name) {
    const newPath = path.join(this.uploadDir, name);
    if (!newPath.startsWith(this.uploadDir)) {
      return path.join(this.uploadDir, this.options.defaultInvalidName);
    }
    return newPath;
  }
  _setUpRename() {
    const hasRename = typeof this.options.filename === "function";
    if (hasRename) {
      this._getNewName = (part) => {
        let ext = "";
        let name = this.options.defaultInvalidName;
        if (part.originalFilename) {
          ({ ext, name } = path.parse(part.originalFilename));
          if (this.options.keepExtensions !== true) {
            ext = "";
          }
        }
        return this.options.filename.call(this, name, ext, part, this);
      };
    } else {
      this._getNewName = (part) => {
        const name = createId();
        if (part && this.options.keepExtensions) {
          const originalFilename = typeof part === "string" ? part : part.originalFilename;
          return `${name}${this._getExtension(originalFilename)}`;
        }
        return name;
      };
    }
  }
  _setUpMaxFields() {
    if (this.options.maxFields !== Infinity) {
      let fieldsCount = 0;
      this.on("field", () => {
        fieldsCount += 1;
        if (fieldsCount > this.options.maxFields) {
          this._error(
            new FormidableError(
              `options.maxFields (${this.options.maxFields}) exceeded`,
              maxFieldsExceeded,
              413
            )
          );
        }
      });
    }
  }
  _setUpMaxFiles() {
    if (this.options.maxFiles !== Infinity) {
      let fileCount = 0;
      this.on("fileBegin", () => {
        fileCount += 1;
        if (fileCount > this.options.maxFiles) {
          this._error(
            new FormidableError(
              `options.maxFiles (${this.options.maxFiles}) exceeded`,
              maxFilesExceeded,
              413
            )
          );
        }
      });
    }
  }
  _maybeEnd() {
    if (!this.ended || this._flushing || this.error) {
      return;
    }
    this.req = null;
    this.emit("end");
  }
};
var formidable = (...args) => new IncomingForm(...args);
var { enabledPlugins } = DEFAULT_OPTIONS;
exports.DummyParser = DummyParser;
exports.File = PersistentFile;
exports.Formidable = IncomingForm;
exports.IncomingForm = IncomingForm;
exports.JSONParser = JSONParser;
exports.MultipartParser = MultipartParser$1;
exports.OctetStreamParser = OctetStreamParser;
exports.OctetstreamParser = OctetStreamParser;
exports.PersistentFile = PersistentFile;
exports.QueryStringParser = QuerystringParser;
exports.QuerystringParser = QuerystringParser;
exports.VolatileFile = VolatileFile;
exports.default = formidable;
exports.defaultOptions = DEFAULT_OPTIONS;
exports.enabledPlugins = enabledPlugins;
exports.errors = FormidableError$1;
exports.formidable = formidable;
exports.json = plugin;
exports.multipart = plugin$1;
exports.octetstream = plugin$3;
exports.querystring = plugin$2;
/*! Bundled license information:

@noble/hashes/utils.js:
  (*! noble-hashes - MIT License (c) 2022 Paul Miller (paulmillr.com) *)
*/
