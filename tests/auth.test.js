
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { api, core, logger, lib } = require("../");

describe("Auth tests", () => {

    var argv = [
        "-api-acl-allow-admin", "auth, admin, manager, -userallow, -manageronly",
        "-api-acl-allow-manager", "manager, user, -useronly",
        "-api-acl-allow-user", "user, userallow",
        "-api-acl-authenticated", "auth",

        "-api-acl-deny-manager", "useronly",
        "-api-acl-deny-user", "userdeny",

        "-api-acl-add-auth", "^/auth",
        "-api-acl-add-admin", "^/admin",
        "-api-acl-add-manager", "^/manager",
        "-api-acl-add-user", "^/user",
        "-api-acl-add-userallow", "^/allow",
        "-api-acl-add-userdeny", "^/userdeny",
        "-api-acl-add-useronly", "^/useronly",
        "-api-acl-add-manageronly", "^/manageronly",
    ];

    var checks = [
        { status: 403, path: "/system" },
        { status: 403, path: "/system", roles: "admin" },

        { status: 200, path: "/auth" },
        { status: 200, path: "/auth", roles: "admin" },
        { status: 200, path: "/auth", roles: "user" },

        { status: 403, path: "/admin" },
        { status: 403, path: "/admin", roles: "user" },
        { status: 403, path: "/admin", roles: "manager" },
        { status: 200, path: "/admin", roles: "admin" },

        { status: 403, path: "/allow" },
        { status: 200, path: "/allow", roles: "user" },
        { status: 403, path: "/allow", roles: "manager" },
        { status: 403, path: "/allow", roles: "admin" },

        { status: 200, path: "/user", roles: "user" },
        { status: 403, path: "/user", roles: "admin" },
        { status: 200, path: "/user", roles: "manager" },

        { status: 200, path: "/useronly", roles: "user", code: "DENY" },
        { status: 403, path: "/useronly", roles: "manager", code: "DENY" },

        { status: 200, path: "/userdeny", roles: "manager" },
        { status: 403, path: "/userdeny", roles: "user", code: "DENY" },

        { status: 403, path: "/manager" },
        { status: 403, path: "/manager", roles: "user" },
        { status: 200, path: "/manager", roles: "manager" },
        { status: 200, path: "/manager", roles: "admin" },

        { status: 200, path: "/manageronly", roles: "manager" },
        { status: 403, path: "/manageronly", roles: "user" },
        { status: 403, path: "/manageronly", roles: "admin" },

    ];

    api.acl.reset();
    app.parseArgs(argv);
    var req = { user: {}, options: {} };

    logger.setLevel(process.env.BKJS_TEST_LOG)

    it("checks all acls", (t, callback) => {

        lib.forEachSeries(checks, (check, next) => {
            req.user.id = check.roles || "anon";
            req.user.roles = lib.strSplit(check.roles);
            req.options.path = check.path;
            logger.debug("checking:", check);
            api.access.authorize(req, (err) => {
                logger.debug("checked:", err);
                assert.ok((err?.status || 200) === check.status, lib.objDescr({ check, err }));
                if (err && check.code !== undefined) {
                    assert.ok((err.code || "") === check.code, lib.objDescr({ check, err }));
                }
                next();
            });
        }, callback);
    });

});
