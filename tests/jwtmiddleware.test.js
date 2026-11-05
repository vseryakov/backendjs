const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const { lib, middleware } = require("../");

const JWT = lib.JWT;
const jwt = middleware.jwt;

jwt.secret = 'backendjs-secret';
const secret = 'backendjs-secret';

const createContext = (token, type) => {
    const context = {
        auth: token ? { type: type || "Bearer", token } : undefined,
        reply: (err) => { context.err = err; return Promise.resolve(); },
        user: undefined,
        err: undefined,
    };
    return context;
};

describe("JWT middleware tests", () => {

    it('should call next when token is valid', async () => {
        const { token } = await JWT.sign({ sub: "user-1", name: "Test" }, secret, "HS256");

        let nextCalled = false;
        const context = createContext(token, "Bearer");
        await jwt.handle(context, () => { nextCalled = true; });

        assert.equal(nextCalled, true);
        assert.equal(context.err, undefined);
        assert.equal(context.user?.id, "user-1");
    });

    it('should reply 401 when token is invalid', async () => {
        const context = createContext("invalid.token.value", "Bearer");
        let nextCalled = false;
        await jwt.handle(context, () => { nextCalled = true; });

        assert.equal(nextCalled, false);
        assert.equal(context.err?.status, 401);
        assert.equal(context.err?.message, jwt.errInvalidToken);
    });

    it('should reply 401 when token is missing', async () => {
        const context = createContext(undefined, "Bearer");
        let nextCalled = false;
        await jwt.handle(context, () => { nextCalled = true; });

        assert.equal(nextCalled, false);
        assert.equal(context.err?.status, 401);
    });

    it('should reply 401 when token type is not Bearer', async () => {
        const { token } = await JWT.sign({ sub: "user-1" }, secret, "HS256");
        const context = createContext(token, "Basic");
        let nextCalled = false;
        await jwt.handle(context, () => { nextCalled = true; });

        assert.equal(nextCalled, false);
        assert.equal(context.err?.status, 401);
    });

    it('should call next when token is valid with jwks from local file', async () => {
        const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
        const publicJwk = await crypto.subtle.exportKey("jwk", publicKey);
        const privateJwk = await crypto.subtle.exportKey("jwk", privateKey);
        privateJwk.alg = "ES256";
        privateJwk.kid = "test-key-2025";
        publicJwk.kid = "test-key-2025";
        const jwksPath = "/tmp/backendjs-jwt-jwks-test.json";
        await fs.writeFile(jwksPath, JSON.stringify({ keys: [publicJwk] }));

        jwt.jwks = jwksPath;
        jwt.kid = "test-key-2025";
        jwt.alg = "ES256";

        const { token } = await JWT.sign({ sub: "user-jwks-1" }, privateJwk, "ES256");
        const context = createContext(token, "Bearer");
        let nextCalled = false;
        await jwt.handle(context, () => { nextCalled = true; });

        assert.equal(nextCalled, true);
        assert.equal(context.err, undefined);

        jwt.jwks = undefined;
        jwt.kid = undefined;
        jwt.alg = undefined;
    });

});