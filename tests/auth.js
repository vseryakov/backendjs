/* global lib api core logger */

tests.test_auth = function(callback, test)
{
    var argv = [
        "-api-allow-acl-admin", "admin, manager, allow1, auth",
        "-api-allow-acl-manager", "manager, user",
        "-api-allow-acl-user", "user, allow1",
        "-api-allow-acl-authenticated", "auth",

        "-api-deny-acl-manager", "useronly",
        "-api-deny-acl-user", "manageronly, userdeny",
        "-api-deny-acl-admin", "manageronly",

        "-api-acl-auth", "^/auth",
        "-api-acl-admin", "^/admin",
        "-api-acl-manager", "^/manager",
        "-api-acl-user", "^/user",
        "-api-acl-allow1", "^/allow1",
        "-api-acl-userdeny", "^/userdeny",
        "-api-acl-useronly", "^/useronly",
        "-api-acl-manageronly", "^/manageronly",
    ];

    var checks = [
        { status: 403, path: "/system" },
        { status: 403, path: "/system", type: "admin" },

        { status: 200, path: "/auth" },
        { status: 200, path: "/auth", type: "admin" },
        { status: 200, path: "/auth", type: "user" },

        { status: 403, path: "/admin" },
        { status: 403, path: "/admin", type: "user" },
        { status: 403, path: "/admin", type: "manager" },
        { status: 200, path: "/admin", type: "admin" },

        { status: 403, path: "/allow1" },
        { status: 200, path: "/allow1", type: "user" },
        { status: 403, path: "/allow1", type: "manager" },
        { status: 200, path: "/allow1", type: "admin" },

        { status: 200, path: "/user", type: "user" },
        { status: 403, path: "/user", type: "admin" },
        { status: 200, path: "/user", type: "manager" },

        { status: 200, path: "/useronly", type: "user" },
        { status: 403, path: "/useronly", type: "manager" },

        { status: 200, path: "/userdeny", type: "manager" },
        { status: 403, path: "/userdeny", type: "user", code: "DENY" },
        { status: 403, path: "/useronly", type: "manager", code: "DENY" },

        { status: 403, path: "/manager" },
        { status: 403, path: "/manager", type: "user" },
        { status: 200, path: "/manager", type: "manager" },
        { status: 200, path: "/manager", type: "admin" },

        { status: 200, path: "/manageronly", type: "manager" },
        { status: 403, path: "/manageronly", type: "admin", code: "DENY" },
        { status: 403, path: "/manageronly", type: "user", code: "DENY" },

    ];
    test.req = req;

    api.resetAcl();
    core.parseArgs(argv);
    for (const p in api) {
        if (/^(allow|deny|acl)/.test(p) && !lib.isEmpty(api[p]) && typeof api[p] == "object") logger.info(p, "=", api[p]);
    }
    var req = { account: {}, options: {} };

    lib.forEachSeries(checks, (check, next) => {
        req.account.id = check.type || "anon";
        req.account.type = lib.strSplit(check.type);
        req.options.path = check.path;
        api.checkAuthorization(req, (err) => {
            if (err && err?.status != 200) logger.info(check, err);
            expect((err?.status || 200) === check.status, err || "no error", check);
            if (err && check.code !== undefined) {
                expect((err.code || "") === check.code, err, check);
            }
            next();
        });
    }, callback);
}
