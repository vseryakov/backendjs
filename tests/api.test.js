
const { describe } = require('node:test');
const assert = require('node:assert/strict');
const { api, db, lib } = require("../");

describe('API session Tests', (t) => {

    api.session.cookie = {
        '/': { secure: true },
        '/pub': { maxAge: 123 },
        '/iframe/': { sameSite: 'None' },
        'host.com': { domain: 'host.com' },
        'www.host.com': { secure: false }
    }

    var c = api.session.makeCookie({ options: { path: "/" } })

    assert.strictEqual(c?.secure, true, "expect secure: true for / " + lib.objDescr(c));

    c = api.session.makeCookie({ options: { path: "/test" } })

    assert.strictEqual(c?.secure, true, "expect secure: true for /test " + lib.objDescr(c));

    c = api.session.makeCookie({ options: { path: "/pub/" } })

    assert.strictEqual(c?.maxAge, 123, "expect maxAge: 123 for /pub/ "+ lib.objDescr(c));

    c = api.session.makeCookie({ options: { path: "/iframe/" } })

    assert.strictEqual(c?.sameSite, "None", "expect sameSite: None for /iframe/ " + lib.objDescr(c));

    c = api.session.makeCookie({ options: { path: "/", domain: "host.com" } })

    assert.strictEqual(c?.secure, true, "expect secure: true for host.com/ " + lib.objDescr(c));
    assert.strictEqual(c?.domain, "host.com", "expect domain:host.com for host.com/ "+ lib.objDescr(c));

    c = api.session.makeCookie({ options: { path: "/", host: "www.host.com", domain: "host.com" } })

    assert.strictEqual(c?.secure, false, "expect secure: false for www.host.com/ " + lib.objDescr(c));
    assert.ok(!c?.domain, "expect no domain for www.host.com/ " + lib.objDescr(c));

    c = api.session.makeCookie({ options: { path: "/", host: "api.host.com", domain: "host.com" } })

    assert.strictEqual(c?.domain, "host.com", "expect domain:host.com for api.host.com/ " + lib.objDescr(c));
    assert.strictEqual(c?.secure, true, "expect secure: true for api.host.com/ " + lib.objDescr(c));

});

describe("API cleanup tests", () => {

    var tables = {
        cleanup: {
            pub: { pub: 1 },
            priv: { priv: 1 },
            pub_admin: { pub_admin: 1 },
            pub_staff: { pub_staff: 1 },
            internal: { internal: 1 },
            billing: { pub_admin: 1, pub_types: ["billing"] },
            nobilling: { pub_admin: 1, priv_types: ["billing"] },
            billing_staff: { pub_admin: 1, pub_types: ["billing", "staff"] },
        },
    };
    var row = {
        pub: "pub", priv: "priv", pub_admin: "pub_admin", pub_staff: "pub_staff",
        internal: "internal", billing: "billing",
        nobilling: "nobilling", billing_staff: "billing_staff",
        extra: "extra", extra2: "extra2"
    }

    db.describeTables(tables);

    api.cleanupStrict = 0;

    var res = api.cleanupResult({ options: { isInternal: 1 } }, "cleanup", Object.assign({}, row))
    assert.ok(res.internal && !res.priv && res.extra, "should keep internal");

    res = api.cleanupResult({}, "cleanup", Object.assign({}, row))
    assert.ok(res.pub && !res.priv, "should keep only public");

    res = api.cleanupResult({ options: { isAdmin: 1 } }, "cleanup", Object.assign({}, row))
    assert.ok(res.pub_admin && !res.internal && !res.priv, "should keep pub_admin");

    res = api.cleanupResult({ options: { isStaff: 1 } }, "cleanup", Object.assign({}, row))
    assert.ok(res.pub_staff && !res.pub_admin && !res.priv, "should keep pub_staff");

    res = api.cleanupResult({ options: { isAdmin: 1, isStaff: 1 } }, "cleanup", Object.assign({}, row))
    assert.ok(res.pub_admin && res.pub_staff && !res.priv, "should keep pub_admin and pub_staff");

    res = api.cleanupResult({ user: { roles: ["billing"] }, options: { isAdmin: 1 } }, "cleanup", Object.assign({}, row))
    assert.ok(res.billing && !res.priv, "should keep billing");

    res = api.cleanupResult({ user: { roles: ["billing"] }, options: { isAdmin: 1 } }, "cleanup", Object.assign({}, row))
    assert.ok(!res.nobilling && !res.priv, "should keep nobilling");

    res = api.cleanupResult({ user: { roles: ["staff"] }, options: { isAdmin: 1 } }, "cleanup", Object.assign({}, row))
    assert.ok(res.billing_staff && !res.priv, "should keep billing_staff");

    res = api.cleanupResult({}, "cleanup", Object.assign({}, row))
    assert.deepEqual(res, { pub: "pub", extra: "extra", extra2: "extra2" }, "should keep extras");

    api.cleanupStrict = 1;
    res = api.cleanupResult({}, "cleanup", Object.assign({}, row))
    assert.deepEqual(res, { pub: "pub" }, "should not keep extras in strict mode:")

    res = api.cleanupResult({ options: { cleanup_rules: { extra: 1 } } }, "cleanup", Object.assign({}, row))
    assert.deepEqual(res, { pub: "pub", extra: "extra" }, "should keep extra but not extra2 in strict mode");

    api.cleanupRules = { '*': { extra2: 1 } };

    res = api.cleanupResult({}, "cleanup", Object.assign({}, row))
    assert.ok(!res.extra && res.extra2, "should keep no extra but keep extra2 via * rule");

    api.cleanupRules = { cleanup: { extra2: 1 } };

    res = api.cleanupResult({}, "cleanup", Object.assign({}, row))
    assert.ok(!res.extra && res.extra2, "should keep extra2 but not extra via table rule");

});
