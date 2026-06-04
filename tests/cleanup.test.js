
const { describe } = require('node:test');
const assert = require('node:assert/strict');
const { db, lib } = require("../");

describe("DB cleanup tests", () => {

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

    db.cleanup.strict = 0;

    var res = db.cleanupResult("cleanup", Object.assign({}, row), { isInternal: 1 })
    assert.ok(res.internal && !res.priv && res.extra && !res.notpub, lib.newError({ message: "should keep internal", res }));

    res = db.cleanupResult("cleanup", Object.assign({}, row))
    assert.ok(res.pub && !res.priv, lib.newError({ message: "should keep only public", res }));

    res = db.cleanupResult("cleanup", Object.assign({}, row), { isAdmin: 1 })
    assert.ok(res.pub_admin && !res.internal && !res.priv, lib.newError({ message: "should keep pub_admin", res }));

    res = db.cleanupResult("cleanup", Object.assign({}, row), { isStaff: 1 })
    assert.ok(res.pub_staff && !res.pub_admin && !res.priv, lib.newError({ message: "should keep pub_staff", res }));

    res = db.cleanupResult("cleanup", Object.assign({}, row), { isAdmin: 1, isStaff: 1 })
    assert.ok(res.pub_admin && res.pub_staff && !res.priv, lib.newError({ message: "should keep pub_admin and pub_staff", res }));

    res = db.cleanupResult("cleanup", Object.assign({}, row), { user: { roles: ["billing"] } , isAdmin: 1 })
    assert.ok(res.billing && !res.priv, lib.newError({ message: "should keep billing", res }));

    res = db.cleanupResult("cleanup", Object.assign({}, row), { user: { roles: ["billing"] }, isAdmin: 1 })
    assert.ok(!res.nobilling && !res.priv, lib.newError({ message: "should keep nobilling", res }));

    res = db.cleanupResult("cleanup", Object.assign({}, row), { user: { roles: ["staff"] }, isAdmin: 1 })
    assert.ok(res.billing_staff && !res.priv, lib.newError({ message: "should keep billing_staff", res }));

    res = db.cleanupResult("cleanup", Object.assign({}, row))
    assert.deepEqual(res, { pub: "pub", extra: "extra", extra2: "extra2" }, "should keep extras");

    db.cleanup.strict = 1;
    res = db.cleanupResult("cleanup", Object.assign({}, row))
    assert.deepEqual(res, { pub: "pub" }, "should not keep extras in strict mode:")

    res = db.cleanupResult("cleanup", Object.assign({}, row), { rules: { extra: 1 } })
    assert.deepEqual(res, { pub: "pub", extra: "extra" }, "should keep extra but not extra2 in strict mode");

    db.cleanup.rules = { '*': { extra2: 1 } };

    res = db.cleanupResult("cleanup", Object.assign({}, row))
    assert.ok(!res.extra && res.extra2, lib.newError({ message: "should keep no extra but keep extra2 via * rule", res }));

    db.cleanup.rules = { cleanup: { extra2: 1 } };

    res = db.cleanupResult("cleanup", Object.assign({}, row))
    assert.ok(!res.extra && res.extra2, lib.newError({ message: "should keep extra2 but not extra via table rule", res }));

});
