
const { describe } = require('node:test');
const assert = require('node:assert/strict');
const { api, lib } = require("../");

describe('Session tests', (t) => {

    api.session.cookie = {
        '/': { secure: true },
        '/pub': { maxAge: 123 },
        '/iframe/': { sameSite: 'None' },
        'host.com': { domain: 'host.com' },
        'www.host.com': { secure: false }
    }

    var c = api.session.getCookieOptions({ path: "/" })

    assert.strictEqual(c?.secure, true, "expect secure: true for / " + lib.inspect(c));

    c = api.session.getCookieOptions({ path: "/test" })

    assert.strictEqual(c?.secure, true, "expect secure: true for /test " + lib.inspect(c));

    c = api.session.getCookieOptions({ path: "/pub/" })

    assert.strictEqual(c?.maxAge, 123, "expect maxAge: 123 for /pub/ "+ lib.inspect(c));

    c = api.session.getCookieOptions({ path: "/iframe/" })

    assert.strictEqual(c?.sameSite, "None", "expect sameSite: None for /iframe/ " + lib.inspect(c));

    c = api.session.getCookieOptions({ path: "/", domain: "host.com" })

    assert.strictEqual(c?.secure, true, "expect secure: true for host.com/ " + lib.inspect(c));
    assert.strictEqual(c?.domain, "host.com", "expect domain:host.com for host.com/ "+ lib.inspect(c));

    c = api.session.getCookieOptions({ path: "/", host: "www.host.com", domain: "host.com" })

    assert.strictEqual(c?.secure, false, "expect secure: false for www.host.com/ " + lib.inspect(c));
    assert.ok(!c?.domain, "expect no domain for www.host.com/ " + lib.inspect(c));

    c = api.session.getCookieOptions({ path: "/", host: "api.host.com", domain: "host.com" })

    assert.strictEqual(c?.domain, "host.com", "expect domain:host.com for api.host.com/ " + lib.inspect(c));
    assert.strictEqual(c?.secure, true, "expect secure: true for api.host.com/ " + lib.inspect(c));

});

