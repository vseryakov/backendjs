
/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2025
 *
 *  Derived from Hono https://github.com/honojs
 */

const crypto = require('node:crypto');
const lib = require(__dirname + '/../lib');

const utf8Encoder = new TextEncoder();

const pemToBinary = (pem) => Buffer.from(pem.replace(/-+(BEGIN|END).*/g, "").replace(/\s/g, ""), "base64");
const encodeJwt = (str) => lib.toBase64url(JSON.stringify(str)).replaceAll("=", "");
const decodeJwt = (str) => JSON.parse(lib.fromBase64url(str));

const isTokenHeader = (obj) => (typeof obj == "object" && obj ?
                                (obj.alg && /^(HS|RS|PS|ES)[0-9]{3}$|^EdDSA$/.test(obj.alg)) &&
                                (!obj.typ || obj.typ === "JWT") :
                                false);

const exportJwk = async (key) => {
    const { kty, alg, e, n, crv, x, y } = await crypto.subtle.exportKey("jwk", key);
    return { kty, alg, e, n, crv, x, y, key_ops: ["verify"] };
}

const algorithms = {
    HS256: { name: "HMAC", hash: { name: "SHA-256" } },
    HS384: { name: "HMAC", hash: { name: "SHA-384" } },
    HS512: { name: "HMAC", hash: { name: "SHA-512" } },
    RS256: { name: "RSASSA-PKCS1-v1_5", hash: { name: "SHA-256" } },
    RS384: { name: "RSASSA-PKCS1-v1_5", hash: { name: "SHA-384" } },
    RS512: { name: "RSASSA-PKCS1-v1_5", hash: { name: "SHA-512" } },
    PS256: { name: "RSA-PSS", hash: { name: "SHA-256" }, saltLength: 32 },
    PS384: { name: "RSA-PSS", hash: { name: "SHA-384" }, saltLength: 48 },
    PS512: { name: "RSA-PSS", hash: { name: "SHA-512" }, saltLength: 64 },
    ES256: { name: "ECDSA", hash: { name: "SHA-256" }, namedCurve: "P-256" },
    ES384: { name: "ECDSA", hash: { name: "SHA-384" }, namedCurve: "P-384" },
    ES512: { name: "ECDSA", hash: { name: "SHA-512" }, namedCurve: "P-521" },
    EdDSA: { name: "Ed25519", namedCurve: "Ed25519" },
}

/**
 * @module lib/JWT
 */

/**
 * JSON Web Tokens support
 */

lib.JWT = {

    algorithms,

    /**
    * @param {object} payload - data to sign including JWT reserved properties below
    * @param {number} [payload.exp] - The token is checked to ensure it has not expired.
    * @param {number} [payload.nbf] - The token is checked to ensure it is not being used before a specified time.
    * @param {number} [payload.iat] - The token is checked to ensure it is not issued in the future.
    * @param {string} [payload.iss] - The token is checked to ensure it has been issued by a trusted issuer.
    * @param {string|string[]} [payload.aud] - The token is checked to ensure it is intended for a specific audience.
    * @param {string|object|CryptoKey} privateKey
    * @param {string} [alg=HS256]
    * @return {Promise} with object result in format { header, token, err }
    * @example
    * const { token } = await lib.JWT.sign(payload, secret, "HS512")
    * const { err } = await lib.JWT.verify(token, secret)
    * @memberof module:lib/JWT
    * @method sign
    * @async
    */
    async sign(payload, privateKey, alg = "HS256")
    {
        const header = typeof privateKey === "object" && privateKey?.alg ?
            { alg: privateKey.alg, typ: "JWT", kid: privateKey.kid } :
            { alg, typ: "JWT" };


        const token = `${encodeJwt(header)}.${encodeJwt(payload)}`;

        const algorithm = algorithms[alg];

        try {
            const cryptoKey = await this.importPrivateKey(privateKey, algorithm);
            const signature = await crypto.subtle.sign(algorithm, cryptoKey, utf8Encoder.encode(token));
            return {
                header,
                token: `${token}.${lib.toBase64url(signature).replaceAll("=", "")}`
            };
        } catch (err) {
            return { err }
        }
    },

    /**
    * @param {string} token
    * @param {string|object|CryptoKey} publicKey
    * @param {object} [options]
    * @param {string | RegExp} [options.iss] - The expected issuer used for verifying the token
    * @param {boolean} [options.nbf] - Verify the `nbf` claim (default: `true`)
    * @param {boolean} [options.exp] - Verify the `exp` claim (default: `true`)
    * @param {boolean} [options.iat] - Verify the `iat` claim (default: `true`)
    * @param {string | string[] | RegExp} [options.aud] - Acceptable audience(s) for the token
    * @return {Promise} withh object result in format { header, payload, err }
    * @memberof module:lib/JWT
    * @method verify
    * @async
    */
    async verify(token, publicKey, options)
    {
        const { alg, iss, nbf = true, exp = true, iat = true, aud } = options || {};

        publicKey = Array.isArray(publicKey) ? publicKey.find((x) => x?.kid === header.kid) : publicKey;
        if (!publicKey) {
            return { err: new Error("invalid public key") };
        }

        const [h, p, s] = lib.strSplit(token, ".");
        const header = decodeJwt(h);
        const payload = decodeJwt(p);
        if (!isTokenHeader(header)) {
            return { err: new Error("JWT.verify: invalid header") };
        }
        const now = Math.round(Date.now() / 1000);
        if (nbf && payload.nbf && payload.nbf > now) {
            return { err: new Error("JWT.verify: not before") };
        }
        if (exp && payload.exp && payload.exp <= now) {
            return { err: new Error("JWT.verify: expired") };
        }
        if (iat && payload.iat && now < payload.iat) {
            return { err: new Error("JWT.verify: issued at") };
        }
        if (iss) {
            if (!payload.iss) {
                return { err: new Error("no issuer") };
            }
            if ((typeof iss === "string" && payload.iss !== iss) ||
                (iss instanceof RegExp && !iss.test(payload.iss))) {
                    return { err: new Error("invalid issuer") };
            }
        }
        if (aud) {
            const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
            if (!audiences.some((x) => (aud instanceof RegExp ? aud.test(x) :
                typeof aud === "string" ? x === aud :
                Array.isArray(aud) && aud.includes(x)))) {
                    return { err: new Error("invalid audience") };
            }
        }

        const algorithm = algorithms[alg || publicKey.alg || header.alg || "HS256"];

        try {
            const cryptoKey = await this.importPublicKey(publicKey, algorithm);
            const rc = await crypto.subtle.verify(algorithm, cryptoKey, lib.fromBase64url(s, true), utf8Encoder.encode(`${h}.${p}`));
            return rc ? { header, payload } : { err: new Error("invalid signature") };

        } catch (err) {
            return { err }
        }
    },


    /**
     * @param {string|object|CryptoKey} key - a private key to import, string can be a secret or PEM
     * @param {string} algorithm
     * @return {Promise} A Promise that fulfills with the imported key as a CryptoKey object.
     * @memberof module:lib/JWT
     * @method importPrivateKey
     * @async
     */
    async importPrivateKey(key, algorithm)
    {
        if (key instanceof CryptoKey) {
            if (key.type !== "private" && key.type !== "secret") {
                throw new Error(`unexpected key type: CryptoKey.type is ${key.type}, expected private or secret`);
            }
            return key;
        }
        if (typeof key === "object") {
            return crypto.subtle.importKey("jwk", key, algorithm, false, ["sign"]);
        }
        if (typeof key === "string" && key.includes("PRIVATE")) {
            return crypto.subtle.importKey("pkcs8", pemToBinary(key), algorithm, false, ["sign"]);
        }
        return crypto.subtle.importKey("raw", utf8Encoder.encode(key), algorithm, false, ["sign"]);
    },

    /**
     * @param {string|object|CryptoKey} key - a public key to import, string can be a secret or PEM
     * @param {string} algorithm
     * @return {Promise} A Promise that fulfills with the imported key as a CryptoKey object.
     * @memberof module:lib/JWT
     * @method importPublicKey
     * @async
     */
    async importPublicKey(key, algorithm)
    {
        if (key instanceof CryptoKey) {
            if (key.type === "public" || key.type === "secret") {
                return key;
            }
            if (key.type == "private") {
                key = await exportJwk(key);
            }
        }
        if (typeof key === "string" && key.includes("PRIVATE")) {
            const privateKey = await crypto.subtle.importKey("pkcs8", pemToBinary(key), algorithm, true, ["sign"]);
            key = await exportJwk(privateKey);
        }
        if (typeof key === "object") {
            return crypto.subtle.importKey("jwk", key, algorithm, false, ["verify"]);
        }
        if (typeof key === "string" && key.includes("PUBLIC")) {
            return crypto.subtle.importKey("spki", pemToBinary(key), algorithm, false, ["verify"]);
        }
        return crypto.subtle.importKey("raw", utf8Encoder.encode(key), algorithm, false, ["verify"]);
    }

}

