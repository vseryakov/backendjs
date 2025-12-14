
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { JWT } = require("../");

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
    const tok = await JWT.sign(payload, secret, "HS512")
    const expected =
      'eyJhbGciOiJIUzUxMiIsInR5cCI6IkpXVCJ9.eyJtZXNzYWdlIjoiaGVsbG8gd29ybGQifQ.RqVLgExB_GXF1-9T-k4V4HjFmiuQKTEjVSiZd-YL0WERIlywZ7PfzAuTZSJU4gg8cscGamQa030cieEWrYcywg'

    assert.strictEqual(tok.token, expected)

    const rc = await JWT.verify(tok.token, secret)

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
  
})
