
const { describe } = require('node:test');
const assert = require('node:assert/strict');
const { db, lib } = require("../");

describe("DB cleanup tests", () => {

    var tables = {
        cleanup: {
            pub: { cleanup: false },
            priv: { cleanup: true },
            billing: { cleanup: { roles: ["billing"] } },
            nobilling: { cleanup: { noroles: ["billing"] } },
            billing_staff: { cleanup: { roles: ["billing", "staff"] } },
            notpub: {},
            extra: {},
            extra2: {},
        },
    };
    var row = {
        pub: "pub",
        priv: "priv",
        notpub: "notpub",
        billing: "billing",
        nobilling: "nobilling",
        billing_staff: "billing_staff",
        extra: "extra",
        extra2: "extra2"
    }

    db.describeTables(tables);

    let res = db.cleanupResult("cleanup", Object.assign({}, row))
    assert.ok(res.pub && !res.priv && !res.extra && !res.notpub, lib.newError({ message: "pub and no private", res }));

    res = db.cleanupResult("cleanup", Object.assign({}, row), { user: { roles: ["billing"] } })
    assert.ok(res.billing && !res.priv, lib.newError({ message: "should keep billing", res }));

    res = db.cleanupResult("cleanup", Object.assign({}, row), { user: { roles: ["billing"] } })
    assert.ok(!res.nobilling && !res.priv, lib.newError({ message: "should keep nobilling", res }));

    res = db.cleanupResult("cleanup", Object.assign({}, row), { user: { roles: ["staff"] } })
    assert.ok(res.billing_staff && !res.priv, lib.newError({ message: "should keep billing_staff", res }));

    res = db.cleanupResult("cleanup", Object.assign({}, row), { cleanup: { extra: false } })
    assert.ok(res.extra && !res.extra2, lib.newError({ message: "should keep extra but not extra2", res }));

    db.cleanup = { cleanup: { extra2: false } };

    res = db.cleanupResult("cleanup", Object.assign({}, row))
    assert.ok(!res.extra && res.extra2, lib.newError({ message: "should keep extra2 but not extra via table rule", res }));

});
