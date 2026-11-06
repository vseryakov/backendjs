
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { lib } = require("../");

const JWT = lib.JWT;

const secret = 'a-secret'

describe("JWT tests", async () => {

it('Issuer (correct - string)', async () => {
    const tok =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE2MzMwNDY0MDAsImlzcyI6ImNvcnJlY3QtaXNzdWVyIn0.gF8S6M2QcfTTscgxeyihNk28JAOa8mfL1bXPb3_E3rk'

    const rc = await JWT.verify(tok, secret, { alg: "HS256", iss: 'correct-issuer' })

    assert.partialDeepStrictEqual(rc, {
        payload: {
            iss: 'correct-issuer'
        }
    });
})

it('Token Expired', async () => {
    const tok =
      'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpYXQiOjE2MzMwNDYxMDAsImV4cCI6MTYzMzA0NjQwMH0.H-OI1TWAbmK8RonvcpPaQcNvOKS9sxinEOsgKwjoiVo'
    const { err } = await JWT.verify(tok, secret)
    assert.match(err?.message, /expired/);
})

it('HS512 sign & verify & decode', async () => {
    var payload = { message: 'hello world' }
    const alg = 'HS512'
    const tok = await JWT.sign(payload, secret, alg)
    const expected =
      'eyJhbGciOiJIUzUxMiIsInR5cCI6IkpXVCJ9.eyJtZXNzYWdlIjoiaGVsbG8gd29ybGQifQ.RqVLgExB_GXF1-9T-k4V4HjFmiuQKTEjVSiZd-YL0WERIlywZ7PfzAuTZSJU4gg8cscGamQa030cieEWrYcywg'

    assert.strictEqual(tok.token, expected)

    const rc = await JWT.verify(tok.token, secret, { alg })

    assert.partialDeepStrictEqual(rc, {
        header: {
            alg: 'HS512',
            typ: 'JWT',
        },
        payload: {
            message: 'hello world',
        },
    })
})

it('EdDSA sign & verify w/ CryptoKey', async () => {
    const alg = 'EdDSA'
    const payload = { message: 'hello world' }

    const keyPair = await crypto.subtle.generateKey({ name: 'Ed25519', namedCurve: 'Ed25519' }, true, ['sign', 'verify'])

    const tok = await JWT.sign(payload, keyPair.privateKey, alg)

    const rc1 = await JWT.verify(tok.token, keyPair.privateKey, { alg })
    assert.partialDeepStrictEqual(rc1, { payload })

    const rc2 = await JWT.verify(tok.token, keyPair.publicKey, { alg })
    assert.partialDeepStrictEqual(rc2, { payload })
})

it(`PS384 sign & verify`, async () => {
    const alg = "PS384"
    const payload = { message: 'hello world' }

    const keyPair = await crypto.subtle.generateKey({
        hash: JWT.algorithms[alg].hash.name,
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        name: 'RSA-PSS',
    }, true, ['sign', 'verify']);

    var exported = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey)
    const pemPrivateKey = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(exported).toString("base64")}\n-----END PRIVATE KEY-----`

    exported = await crypto.subtle.exportKey('spki', keyPair.publicKey)
    const pemPublicKey = `-----BEGIN PUBLIC KEY-----\n${Buffer.from(exported).toString("base64")}\n-----END PUBLIC KEY-----`

    const jwkPublicKey = await crypto.subtle.exportKey('jwk', keyPair.publicKey)

    const tok = await JWT.sign(payload, pemPrivateKey, alg)

    const rc1 = await JWT.verify(tok.token, pemPublicKey, { alg })
    assert.partialDeepStrictEqual(rc1, { payload })

    const rc2 = await JWT.verify(tok.token, pemPrivateKey, { alg })
    assert.partialDeepStrictEqual(rc2, { payload })

    const rc3 = await JWT.verify(tok.token, jwkPublicKey, { alg })
    assert.partialDeepStrictEqual(rc3, { payload })

})

it('getKey: returns undefined when url is not valid', async () => {
    assert.equal(await JWT.getKey(), undefined);
    assert.equal(await JWT.getKey(123), undefined);
})

it('getKey: loads keys from https jwks url', async t => {
    const keys = [{ kid: 'key-2025', kty: 'EC' }];
    const fetch = t.mock.method(lib, 'afetch', async options => {
        assert.equal(options.url, 'https://auth.example.com/jwks.json');
        assert.equal(options.noredirects, true);
        return { ok: true, obj: { keys } };
    });
    const { key } = await JWT.getKey('https://auth.example.com/jwks.json');
    assert.deepEqual(key, keys);
    assert.equal(fetch.mock.callCount(), 1);
})

it('getKey: loads keys from local jwks file', async t => {
    const keys = [{ kid: 'key-2025', kty: 'EC' }];
    const readFile = t.mock.method(lib, 'areadFile', async (path, options) => {
        assert.equal(path, '/tmp/backendjs-jwt-jwks-test.json');
        assert.equal(options.json, true);
        return { data: { keys } };
    });
    const { key } = await JWT.getKey('/tmp/backendjs-jwt-jwks-test.json');
    assert.deepEqual(key, keys);
    assert.equal(readFile.mock.callCount(), 1);
})

it('getKey: returns err when jwks fetch failed', async t => {
    const err = new Error('unavailable');
    t.mock.method(lib, 'afetch', async () => ({ ok: false, err }));
    const { err: e } = await JWT.getKey('https://auth.example.com/jwks.json');
    assert.equal(e, err);
})

it('getKey: returns err when local jwks file cannot be read', async t => {
    const err = new Error('ENOENT');
    t.mock.method(lib, 'areadFile', async () => ({ err }));
    const { err: e } = await JWT.getKey('/tmp/backendjs-jwt-jwks-test.json');
    assert.equal(e, err);
})

it('getKey: returns err when jwks has no keys', async t => {
    t.mock.method(lib, 'afetch', async () => ({ ok: true, obj: { keys: [] } }));
    const { err } = await JWT.getKey('https://auth.example.com/jwks.json');
    assert.ok(err);
    assert.match(err?.message, /JWKS must contain at least one key/);
})

it('getKey: selects key by kid', async t => {
    const keys = [{ kid: 'key-2025' }, { kid: 'key-2026' }];
    t.mock.method(lib, 'afetch', async () => ({ ok: true, obj: { keys } }));
    const { key } = await JWT.getKey('https://auth.example.com/jwks.json', { kid: 'key-2026' });
    assert.deepEqual(key, [{ kid: 'key-2026' }]);
})

it('getKey: caches keys for age', async t => {
    const url = 'https://auth.example.com/jwks.json';
    JWT.lru.del(url);
    const keys = [{ kid: 'key-2025' }];
    const fetch = t.mock.method(lib, 'afetch', async () => ({ ok: true, obj: { keys } }));
    const first = await JWT.getKey(url, { age: 60000 });
    const second = await JWT.getKey(url, { age: 60000 });
    assert.deepEqual(first.key, keys);
    assert.deepEqual(second.key, keys);
    assert.equal(fetch.mock.callCount(), 1);
    JWT.lru.del(url);
})

it('getKey: does not use cache when age is zero', async t => {
    const url = 'https://auth.example.com/jwks.json';
    JWT.lru.del(url);
    const keys = [{ kid: 'key-2025' }];
    const fetch = t.mock.method(lib, 'afetch', async () => ({ ok: true, obj: { keys } }));
    await JWT.getKey(url, { age: 0 });
    await JWT.getKey(url, { age: 0 });
    assert.equal(fetch.mock.callCount(), 2);
    JWT.lru.del(url);
})

})
