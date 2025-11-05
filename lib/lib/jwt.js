
/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const crypto = require('node:crypto');
const logger = require(__dirname + '/../logger');
const lib = require(__dirname + '/../lib');

var AlgorithmTypes = /* @__PURE__ */ ((AlgorithmTypes2) => {
AlgorithmTypes2["HS256"] = "HS256";
AlgorithmTypes2["HS384"] = "HS384";
AlgorithmTypes2["HS512"] = "HS512";
AlgorithmTypes2["RS256"] = "RS256";
AlgorithmTypes2["RS384"] = "RS384";
AlgorithmTypes2["RS512"] = "RS512";
AlgorithmTypes2["PS256"] = "PS256";
AlgorithmTypes2["PS384"] = "PS384";
AlgorithmTypes2["PS512"] = "PS512";
AlgorithmTypes2["ES256"] = "ES256";
AlgorithmTypes2["ES384"] = "ES384";
AlgorithmTypes2["ES512"] = "ES512";
AlgorithmTypes2["EdDSA"] = "EdDSA";
return AlgorithmTypes2;
})(AlgorithmTypes || {});
async function signing(privateKey, alg, data) {
  const algorithm = getKeyAlgorithm(alg);
  const cryptoKey = await importPrivateKey(privateKey, algorithm);
  return await crypto.subtle.sign(algorithm, cryptoKey, data);
}
async function verifying(publicKey, alg, signature, data) {
  const algorithm = getKeyAlgorithm(alg);
  const cryptoKey = await importPublicKey(publicKey, algorithm);
  return await crypto.subtle.verify(algorithm, cryptoKey, signature, data);
}
function pemToBinary(pem) {
  return decodeBase64(pem.replace(/-+(BEGIN|END).*/g, "").replace(/\s/g, ""));
}
async function importPrivateKey(key, alg) {
  if (!crypto.subtle || !crypto.subtle.importKey) {
    throw new Error("`crypto.subtle.importKey` is undefined. JWT auth middleware requires it.");
}
if (isCryptoKey(key)) {
    if (key.type !== "private" && key.type !== "secret") {
      throw new Error(
  `unexpected key type: CryptoKey.type is ${key.type}, expected private or secret`
  );
  }
  return key;
}
const usages = [CryptoKeyUsage.Sign];
if (typeof key === "object") {
    return await crypto.subtle.importKey("jwk", key, alg, false, usages);
}
if (key.includes("PRIVATE")) {
    return await crypto.subtle.importKey("pkcs8", pemToBinary(key), alg, false, usages);
}
return await crypto.subtle.importKey("raw", utf8Encoder.encode(key), alg, false, usages);
}
async function importPublicKey(key, alg) {
  if (!crypto.subtle || !crypto.subtle.importKey) {
    throw new Error("`crypto.subtle.importKey` is undefined. JWT auth middleware requires it.");
}
if (isCryptoKey(key)) {
    if (key.type === "public" || key.type === "secret") {
      return key;
  }
  key = await exportPublicJwkFrom(key);
}
if (typeof key === "string" && key.includes("PRIVATE")) {
    const privateKey = await crypto.subtle.importKey("pkcs8", pemToBinary(key), alg, true, [
      CryptoKeyUsage.Sign
  ]);
    key = await exportPublicJwkFrom(privateKey);
}
const usages = [CryptoKeyUsage.Verify];
if (typeof key === "object") {
    return await crypto.subtle.importKey("jwk", key, alg, false, usages);
}
if (key.includes("PUBLIC")) {
    return await crypto.subtle.importKey("spki", pemToBinary(key), alg, false, usages);
}
return await crypto.subtle.importKey("raw", utf8Encoder.encode(key), alg, false, usages);
}
async function exportPublicJwkFrom(privateKey) {
  if (privateKey.type !== "private") {
    throw new Error(`unexpected key type: ${privateKey.type}`);
}
if (!privateKey.extractable) {
    throw new Error("unexpected private key is unextractable");
}
const jwk = await crypto.subtle.exportKey("jwk", privateKey);
const { kty } = jwk;
const { alg, e, n } = jwk;
const { crv, x, y } = jwk;
return { kty, alg, e, n, crv, x, y, key_ops: [CryptoKeyUsage.Verify] };
}
function getKeyAlgorithm(name) {
  switch (name) {
  case "HS256":
      return {
        name: "HMAC",
        hash: {
          name: "SHA-256"
      }
  };
case "HS384":
  return {
    name: "HMAC",
    hash: {
      name: "SHA-384"
  }
};
case "HS512":
  return {
    name: "HMAC",
    hash: {
      name: "SHA-512"
  }
};
case "RS256":
  return {
    name: "RSASSA-PKCS1-v1_5",
    hash: {
      name: "SHA-256"
  }
};
case "RS384":
  return {
    name: "RSASSA-PKCS1-v1_5",
    hash: {
      name: "SHA-384"
  }
};
case "RS512":
  return {
    name: "RSASSA-PKCS1-v1_5",
    hash: {
      name: "SHA-512"
  }
};
case "PS256":
  return {
    name: "RSA-PSS",
    hash: {
      name: "SHA-256"
  },
  saltLength: 32
};
case "PS384":
  return {
    name: "RSA-PSS",
    hash: {
      name: "SHA-384"
  },
  saltLength: 48
};
case "PS512":
  return {
    name: "RSA-PSS",
    hash: {
      name: "SHA-512"
  },
  saltLength: 64
};
case "ES256":
  return {
    name: "ECDSA",
    hash: {
      name: "SHA-256"
  },
  namedCurve: "P-256"
};
case "ES384":
  return {
    name: "ECDSA",
    hash: {
      name: "SHA-384"
  },
  namedCurve: "P-384"
};
case "ES512":
  return {
    name: "ECDSA",
    hash: {
      name: "SHA-512"
  },
  namedCurve: "P-521"
};
case "EdDSA":
  return {
    name: "Ed25519",
    namedCurve: "Ed25519"
};
default:
  throw new JwtAlgorithmNotImplemented(name);
}
}
function isCryptoKey(key) {
  if (!!crypto.webcrypto) {
    return key instanceof crypto.webcrypto.CryptoKey;
}
return key instanceof CryptoKey;
}
var encodeJwtPart = (part) => encodeBase64Url(utf8Encoder.encode(JSON.stringify(part)).buffer).replace(/=/g, "");
var encodeSignaturePart = (buf) => encodeBase64Url(buf).replace(/=/g, "");
var decodeJwtPart = (part) => JSON.parse(utf8Decoder.decode(decodeBase64Url(part)));
function isTokenHeader(obj) {
  if (typeof obj === "object" && obj !== null) {
    const objWithAlg = obj;
    return "alg" in objWithAlg && Object.values(AlgorithmTypes).includes(objWithAlg.alg) && (!("typ" in objWithAlg) || objWithAlg.typ === "JWT");
}
return false;
}
var sign = async (payload, privateKey, alg = "HS256") => {
  const encodedPayload = encodeJwtPart(payload);
  let encodedHeader;
  if (typeof privateKey === "object" && "alg" in privateKey) {
    alg = privateKey.alg;
    encodedHeader = encodeJwtPart({ alg, typ: "JWT", kid: privateKey.kid });
} else {
    encodedHeader = encodeJwtPart({ alg, typ: "JWT" });
}
const partialToken = `${encodedHeader}.${encodedPayload}`;
const signaturePart = await signing(privateKey, alg, utf8Encoder.encode(partialToken));
const signature = encodeSignaturePart(signaturePart);
return `${partialToken}.${signature}`;
};
var verify = async (token, publicKey, algOrOptions) => {
  const {
    alg = "HS256",
    iss,
    nbf = true,
    exp = true,
    iat = true,
    aud
} = typeof algOrOptions === "string" ? { alg: algOrOptions } : algOrOptions || {};
const tokenParts = token.split(".");
if (tokenParts.length !== 3) {
    throw new JwtTokenInvalid(token);
}
const { header, payload } = decode(token);
if (!isTokenHeader(header)) {
    throw new JwtHeaderInvalid(header);
}
const now = Date.now() / 1e3 | 0;
if (nbf && payload.nbf && payload.nbf > now) {
    throw new JwtTokenNotBefore(token);
}
if (exp && payload.exp && payload.exp <= now) {
    throw new JwtTokenExpired(token);
}
if (iat && payload.iat && now < payload.iat) {
    throw new JwtTokenIssuedAt(now, payload.iat);
}
if (iss) {
    if (!payload.iss) {
      throw new JwtTokenIssuer(iss, null);
  }
  if (typeof iss === "string" && payload.iss !== iss) {
      throw new JwtTokenIssuer(iss, payload.iss);
  }
  if (iss instanceof RegExp && !iss.test(payload.iss)) {
      throw new JwtTokenIssuer(iss, payload.iss);
  }
}
if (aud) {
    if (!payload.aud) {
      throw new JwtPayloadRequiresAud(payload);
  }
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  const matched = audiences.some(
      (payloadAud) => aud instanceof RegExp ? aud.test(payloadAud) : typeof aud === "string" ? payloadAud === aud : Array.isArray(aud) && aud.includes(payloadAud)
      );
  if (!matched) {
      throw new JwtTokenAudience(aud, payload.aud);
  }
}
const headerPayload = token.substring(0, token.lastIndexOf("."));
const verified = await verifying(
    publicKey,
    alg,
    decodeBase64Url(tokenParts[2]),
    utf8Encoder.encode(headerPayload)
    );
if (!verified) {
    throw new JwtTokenSignatureMismatched(token);
}
return payload;
};
var verifyWithJwks = async (token, options, init) => {
  const verifyOpts = options.verification || {};
  const header = decodeHeader(token);
  if (!isTokenHeader(header)) {
    throw new JwtHeaderInvalid(header);
}
if (!header.kid) {
    throw new JwtHeaderRequiresKid(header);
}
if (options.jwks_uri) {
    const response = await fetch(options.jwks_uri, init);
    if (!response.ok) {
      throw new Error(`failed to fetch JWKS from ${options.jwks_uri}`);
  }
  const data = await response.json();
  if (!data.keys) {
      throw new Error('invalid JWKS response. "keys" field is missing');
  }
  if (!Array.isArray(data.keys)) {
      throw new Error('invalid JWKS response. "keys" field is not an array');
  }
  if (options.keys) {
      options.keys.push(...data.keys);
  } else {
      options.keys = data.keys;
  }
} else if (!options.keys) {
    throw new Error('verifyWithJwks requires options for either "keys" or "jwks_uri" or both');
}
const matchingKey = options.keys.find((key) => key.kid === header.kid);
if (!matchingKey) {
    throw new JwtTokenInvalid(token);
}
return await verify(token, matchingKey, {
    alg: matchingKey.alg || header.alg,
    ...verifyOpts
});
};
var decode = (token) => {
  try {
    const [h, p] = token.split(".");
    const header = decodeJwtPart(h);
    const payload = decodeJwtPart(p);
    return {
      header,
      payload
  };
} catch {
    throw new JwtTokenInvalid(token);
}
};
var decodeHeader = (token) => {
  try {
    const [h] = token.split(".");
    return decodeJwtPart(h);
} catch {
    throw new JwtTokenInvalid(token);
}
};
// src/utils/jwt/types.ts
var JwtAlgorithmNotImplemented = class extends Error {
  constructor(alg) {
    super(`${alg} is not an implemented algorithm`);
    this.name = "JwtAlgorithmNotImplemented";
}
};
var JwtTokenInvalid = class extends Error {
  constructor(token) {
    super(`invalid JWT token: ${token}`);
    this.name = "JwtTokenInvalid";
}
};
var JwtTokenNotBefore = class extends Error {
  constructor(token) {
    super(`token (${token}) is being used before it's valid`);
    this.name = "JwtTokenNotBefore";
}
};
var JwtTokenExpired = class extends Error {
  constructor(token) {
    super(`token (${token}) expired`);
    this.name = "JwtTokenExpired";
}
};
var JwtTokenIssuedAt = class extends Error {
  constructor(currentTimestamp, iat) {
    super(
`Invalid "iat" claim, must be a valid number lower than "${currentTimestamp}" (iat: "${iat}")`
);
    this.name = "JwtTokenIssuedAt";
}
};
var JwtTokenIssuer = class extends Error {
  constructor(expected, iss) {
    super(`expected issuer "${expected}", got ${iss ? `"${iss}"` : "none"} `);
    this.name = "JwtTokenIssuer";
}
};
var JwtHeaderInvalid = class extends Error {
  constructor(header) {
    super(`jwt header is invalid: ${JSON.stringify(header)}`);
    this.name = "JwtHeaderInvalid";
}
};
var JwtHeaderRequiresKid = class extends Error {
  constructor(header) {
    super(`required "kid" in jwt header: ${JSON.stringify(header)}`);
    this.name = "JwtHeaderRequiresKid";
}
};
var JwtTokenSignatureMismatched = class extends Error {
  constructor(token) {
    super(`token(${token}) signature mismatched`);
    this.name = "JwtTokenSignatureMismatched";
}
};
var JwtPayloadRequiresAud = class extends Error {
  constructor(payload) {
    super(`required "aud" in jwt payload: ${JSON.stringify(payload)}`);
    this.name = "JwtPayloadRequiresAud";
}
};
var JwtTokenAudience = class extends Error {
  constructor(expected, aud) {
    super(
`expected audience "${Array.isArray(expected) ? expected.join(", ") : expected}", got "${aud}"`
);
    this.name = "JwtTokenAudience";
}
};
var CryptoKeyUsage = /* @__PURE__ */ ((CryptoKeyUsage2) => {
CryptoKeyUsage2["Encrypt"] = "encrypt";
CryptoKeyUsage2["Decrypt"] = "decrypt";
CryptoKeyUsage2["Sign"] = "sign";
CryptoKeyUsage2["Verify"] = "verify";
CryptoKeyUsage2["DeriveKey"] = "deriveKey";
CryptoKeyUsage2["DeriveBits"] = "deriveBits";
CryptoKeyUsage2["WrapKey"] = "wrapKey";
CryptoKeyUsage2["UnwrapKey"] = "unwrapKey";
return CryptoKeyUsage2;
})(CryptoKeyUsage || {});
// src/utils/jwt/utf8.ts
var utf8Encoder = new TextEncoder();
var utf8Decoder = new TextDecoder();
