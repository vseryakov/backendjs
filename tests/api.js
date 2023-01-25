
tests.test_cleanup = function(callback)
{
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
    var row = { pub: "pub", priv: "priv", pub_admin: "pub_admin", pub_staff: "pub_staff",
                internal: "internal", billing: "billing",
                nobilling: "nobilling", billing_staff: "billing_staff",
                extra: "extra", extra2: "extra2" }

    db.describeTables(tables);
    var res, failed = 0;

    logger.log("internal:", res = api.cleanupResult("cleanup", lib.objClone(row), { isInternal: 1 }),
           "status=", res.internal && !res.priv ? "ok" : ++failed);

    logger.log("pub:", res = api.cleanupResult("cleanup", lib.objClone(row), {}),
           "status=", res.pub && !res.priv ? "ok" : ++failed);

    logger.log("pub_admin:", res = api.cleanupResult("cleanup", lib.objClone(row), { isAdmin: 1 }),
           "status=", res.pub_admin && !res.internal && !res.priv ? "ok" : ++failed);

    logger.log("pub_staff:", res = api.cleanupResult("cleanup", lib.objClone(row), { isStaff: 1 }),
           "status=", res.pub_staff && !res.pub_admin && !res.priv ? "ok" : ++failed);

    logger.log("pub_admin and pub_staff:", res = api.cleanupResult("cleanup", lib.objClone(row), { isAdmin: 1, isStaff: 1 }),
           "status=", res.pub_admin && res.pub_staff && !res.priv ? "ok" : ++failed);

    logger.log("billing:", res = api.cleanupResult("cleanup", lib.objClone(row), { isAdmin: 1, account: { type: ["billing"] } }),
           "status=", res.billing && !res.priv ? "ok" : ++failed);

    logger.log("nobilling:", res = api.cleanupResult("cleanup", lib.objClone(row), { isAdmin: 1, account: { type: ["billing"] } }),
           "status=", !res.nobilling && !res.priv ? "ok" : ++failed);

    logger.log("billing_staff:", res = api.cleanupResult("cleanup", lib.objClone(row), { isAdmin: 1, account: { type: ["staff"] } }),
           "status=", res.billing_staff && !res.priv ? "ok" : ++failed);

    api.cleanupStrict = 0;
    logger.log("extra nonstrict:", res = api.cleanupResult("cleanup", lib.objClone(row), {}),
           "status=", res.extra && res.extra2 ? "ok" : ++failed);

    api.cleanupStrict = 1;
    logger.log("no extras strict:", res = api.cleanupResult("cleanup", lib.objClone(row, "extra", 1), {}),
           "status=", !res.extra && !res.extra2? "ok" : ++failed);

    logger.log("no extra2 extra2 cleanup rule strict:", res = api.cleanupResult("cleanup", lib.objClone(row, "extra", 1), { cleanup_rules: { extra: 1 } }),
           "status=", res.extra && !res.extra2 ? "ok" : ++failed);

    api.cleanupRules = { '*': { extra2: 1 } };
    logger.log("no extra extra2 * rule strict:", res = api.cleanupResult("cleanup", lib.objClone(row, "extra", 1), {}),
           "status=", !res.extra && res.extra2 ? "ok" : ++failed);

    api.cleanupRules = { cleanup: { extra2: 1 } };
    logger.log("no extra extra2 table rule strict:", res = api.cleanupResult("cleanup", lib.objClone(row, "extra", 1), {}),
           "status=", !res.extra && res.extra2 ? "ok" : ++failed);

    callback(failed);
}

