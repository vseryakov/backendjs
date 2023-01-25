
tests.test_auth = function(callback)
{
    var argv = [
        "-api-allow-admin", "^/system",
        "-api-allow-authenticated", "^/authonly",
        "-api-allow-acl-authenticated", "allow2",
        "-api-allow-account-manager", "^/manager",
        "-api-allow-acl-manager", "allow1",
        "-api-allow-account-user", "^/user",
        "-api-allow-acl-user", "allow1",
        "-api-only-acl-manager", "only1",
        "-api-only-acl-only", "only1",
        "-api-acl-allow1", "^/allow1",
        "-api-acl-allow2", "^/allow2",
        "-api-deny-account-manager", "^/useronly",
        "-api-deny-account-user", "^/manageronly",
        "-api-deny-acl-user", "deny1",
        "-api-acl-deny1", "^/deny1",
        "-api-acl-deny2", "^/deny2",
        "-api-deny-authenticated", "^/authdeny",
        "-api-deny-acl-authenticated", "deny2",
        "-api-acl-only1", "^/user/only",
        "-api-acl-errmsg-only1", "only1 allowed",
        "-api-acl-errmsg-manager", "managers only",
        "-api-path-errmsg-/allow2", "not allowed",
    ];
    api.resetAcl();
    core.parseArgs(argv);
    for (const p in api) {
        if (/^(allow|deny|acl|only)/.test(p) && !lib.isEmpty(api[p]) && typeof api[p] == "object") logger.info(p, "=", api[p]);
    }

    var req = { account: {}, options: {} };
    var checks = [
        { status: 401, path: "/system" },
        { status: 401, path: "/system", type: "user" },
        { status: 401, path: "/system", type: "manager" },
        { status: 417, path: "/authonly" },
        { status: 401, path: "/allow2" },
        { status: 200, path: "/allow2", type: "user" },
        { status: 200, path: "/authonly", type: "user" },
        { status: 200, path: "/allow2", type: "user" },
        { status: 401, path: "/manager" },
        { status: 401, path: "/manager", type: "user" },
        { status: 200, path: "/manager", type: "manager" },
        { status: 200, path: "/allow1", type: "manager" },
        { status: 401, path: "/user" },
        { status: 401, path: "/allow1" },
        { status: 200, path: "/user", type: "user" },
        { status: 200, path: "/allow1", type: "user" },
        { status: 401, path: "/useronly", type: "manager" },
        { status: 401, path: "/manageronly", type: "user" },
        { status: 401, path: "/deny2", type: "user" },
        { status: 401, path: "/authdeny", type: "user" },
        { status: 401, path: "/deny1", type: "user" },
        { status: 200, path: "/deny1", type: "manager" },
        { status: 200, path: "/user/only", type: "manager" },
        { status: 401, path: "/user/only", type: "user" },
        { status: 200, path: "/user/only", type: "only" },
    ];

    lib.forEachSeries(checks, (check, next) => {
        req.account.id = req.account.type = check.type;
        req.options.path = check.path;
        api.checkAuthorization(req, { status: check.type ? 200 : 417 }, (err) => {
            if (err.status != 200) logger.info(check, err);
            expect(err.status == check.status, err, check);
            next();
        });
    }, callback);
}
