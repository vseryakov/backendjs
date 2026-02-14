
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

    c = api.session.makeCookie({ options: { path: "/", hostname: "www.host.com", domain: "host.com" } })

    assert.strictEqual(c?.secure, false, "expect secure: false for www.host.com/ " + lib.objDescr(c));
    assert.ok(!c?.domain, "expect no domain for www.host.com/ " + lib.objDescr(c));

    c = api.session.makeCookie({ options: { path: "/", hostname: "api.host.com", domain: "host.com" } })

    assert.strictEqual(c?.domain, "host.com", "expect domain:host.com for api.host.com/ " + lib.objDescr(c));
    assert.strictEqual(c?.secure, true, "expect secure: true for api.host.com/ " + lib.objDescr(c));

});

describe("API cleanup tests", () => {

    var tables = {
        cleanup: {
            pub: { api: { pub: 1 } },
            priv: { api: { priv: 1 } },
            pub_admin: { api: { admin: 1 } },
            pub_staff: { api: { staff: 1 } },
            internal: { api: { internal: 1 } },
            billing: { api: { admin: 1, roles: ["billing"] } },
            nobilling: { api: { admin: 1, noroles: ["billing"] } },
            billing_staff: { api: { admin: 1, roles: ["billing", "staff"] } },
            notpub: {},
        },
    };
    var row = {
        pub: "pub", priv: "priv", pub_admin: "pub_admin", pub_staff: "pub_staff", notpub: "notpub",
        internal: "internal", billing: "billing",
        nobilling: "nobilling", billing_staff: "billing_staff",
        extra: "extra", extra2: "extra2"
    }

    db.describeTables(tables);

    api.cleanupStrict = 0;

    var res = api.cleanupResult({ options: { isInternal: 1 } }, "cleanup", Object.assign({}, row))
    assert.ok(res.internal && !res.priv && res.extra && !res.notpub, lib.newError({ message: "should keep internal", res }));

    res = api.cleanupResult({}, "cleanup", Object.assign({}, row))
    assert.ok(res.pub && !res.priv, lib.newError({ message: "should keep only public", res }));

    res = api.cleanupResult({ options: { isAdmin: 1 } }, "cleanup", Object.assign({}, row))
    assert.ok(res.pub_admin && !res.internal && !res.priv, lib.newError({ message: "should keep pub_admin", res }));

    res = api.cleanupResult({ options: { isStaff: 1 } }, "cleanup", Object.assign({}, row))
    assert.ok(res.pub_staff && !res.pub_admin && !res.priv, lib.newError({ message: "should keep pub_staff", res }));

    res = api.cleanupResult({ options: { isAdmin: 1, isStaff: 1 } }, "cleanup", Object.assign({}, row))
    assert.ok(res.pub_admin && res.pub_staff && !res.priv, lib.newError({ message: "should keep pub_admin and pub_staff", res }));

    res = api.cleanupResult({ user: { roles: ["billing"] }, options: { isAdmin: 1 } }, "cleanup", Object.assign({}, row))
    assert.ok(res.billing && !res.priv, lib.newError({ message: "should keep billing", res }));

    res = api.cleanupResult({ user: { roles: ["billing"] }, options: { isAdmin: 1 } }, "cleanup", Object.assign({}, row))
    assert.ok(!res.nobilling && !res.priv, lib.newError({ message: "should keep nobilling", res }));

    res = api.cleanupResult({ user: { roles: ["staff"] }, options: { isAdmin: 1 } }, "cleanup", Object.assign({}, row))
    assert.ok(res.billing_staff && !res.priv, lib.newError({ message: "should keep billing_staff", res }));

    res = api.cleanupResult({}, "cleanup", Object.assign({}, row))
    assert.deepEqual(res, { pub: "pub", extra: "extra", extra2: "extra2" }, "should keep extras");

    api.cleanupStrict = 1;
    res = api.cleanupResult({}, "cleanup", Object.assign({}, row))
    assert.deepEqual(res, { pub: "pub" }, "should not keep extras in strict mode:")

    res = api.cleanupResult({ options: { cleanup_rules: { extra: 1 } } }, "cleanup", Object.assign({}, row))
    assert.deepEqual(res, { pub: "pub", extra: "extra" }, "should keep extra but not extra2 in strict mode");

    api.cleanupRules = { '*': { extra2: 1 } };

    res = api.cleanupResult({}, "cleanup", Object.assign({}, row))
    assert.ok(!res.extra && res.extra2, lib.newError({ message: "should keep no extra but keep extra2 via * rule", res }));

    api.cleanupRules = { cleanup: { extra2: 1 } };

    res = api.cleanupResult({}, "cleanup", Object.assign({}, row))
    assert.ok(!res.extra && res.extra2, lib.newError({ message: "should keep extra2 but not extra via table rule", res }));

});
