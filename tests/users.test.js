/* global  */

const { describe, it, before, after } = require('node:test');
const { acheckAccess, ainit } = require("./utils");
const { app, api, lib } = require("../");

const roles = process.env.BKJS_ROLES || "users,sqlite";

const uuid = "00000000000000000000000000000000"
let authorization = lib.uuid();

describe('Users middleware tests', async () => {

    before(async () => {
        await ainit({ api: 1, noipc: 1, roles });

        api.app.all("/api/1", (context) => { context.send(200, "api") })
        api.app.all("/app/1", (context) => { context.send(200, "app") })
        api.app.all("/admin/1", (context) => { context.send(200, "admin") })

        const { data } = await api.users.aget(uuid);
        if (data) {
            await api.users.aupdate({ login: data.login, secret: lib.hash(authorization) })
            authorization = "Bearer " + data.login + authorization;
        }
    });

    await it("token access", async () => {

        const config = [
            { get: "/api/1", status: 401 },
            { get: "/api/1", status: 200, headers: { authorization } },
            { get: "/profile", status: 401, noredirects: 1, headers: { authorization } },
            { get: "/admin/1", status: 302, noredirects: 1, headers: { authorization } },
            { get: "/staff/1", status: 302, noredirects: 1, headers: { authorization } },
        ];
        const tmp = {};

        await acheckAccess({ config, tmp });
    });

    await it("user access", async () => {

        const config = [
            { url: "/none", status: 404 },
            { get: "/", regexp: /index.html/ },
            { get: "/app/1", noredirects: 1, resheaders: { location: /^\/login.html$/ }, status: 302 },
            { get: "/api/1", status: 401 },
            { get: "/profile", status: 401 },
            { url: "/logout", status: 401 },
            { url: "/login", status: 401, body: { login: "test", secret: "fake" } },
            { url: "/login", status: 200, body: { login: "test", secret: "test" } },
            { get: "/app/1", status: 200, noredirects: 1, },
            { get: "/admin/1", status: 403, noredirects: 1, },
            { get: "/staff/1", status: 403, noredirects: 1, },
            { get: "/api/1", status: 401, noredirects: 1, },
        ];
        const tmp = {};

        await acheckAccess({ config, tmp });
    });

    await it("admin access", async () => {

        await api.users.aupdate({ login: "admin", totp_secret: null, mfa_code: null });

        const config = [
            { url: "/none", status: 404 },
            { get: "/", regexp: /index.html/ },
            { get: "/app/1", noredirects: 1, resheaders: { location: /^\/login.html$/ }, status: 302 },
            { get: "/api/1", status: 401 },
            { get: "/profile", status: 401 },
            { url: "/logout", status: 401 },
            { url: "/login", status: 401, body: { login: "admin", secret: "fake" } },
            { url: "/login", status: 200, body: { login: "admin", secret: "admin" } },
            { get: "/app/1", status: 200, noredirects: 1, },
            { get: "/admin/1", status: 200, noredirects: 1, },
            { get: "/staff/1", status: 403, noredirects: 1, },
            { get: "/api/1", status: 401, noredirects: 1, },
        ];
        const tmp = {};

        await acheckAccess({ config, tmp });
    });

    await it("TOTP access", async () => {

       const user = api.users.prepareTOTP({ login: "admin" });
       await api.users.aupdate(user);

        const config = [
            { url: "/login", status: 401, match: { code: "MFA" }, body: { login: "admin", secret: "admin" } },
            { url: "/login", status: 200, body: { login: "admin", secret: "admin" },
              preprocess: (conf, query, next) => {
                query.body.code = lib.totp(user.totp_secret);
                next();
            } },
        ];
        const tmp = {};

        await acheckAccess({ config, tmp });
    });

    await it("MFA access", async () => {

       const user = { login: "admin", totp_secret: null, mfa_code: "1" };
       await api.users.aupdate(user);

        const config = [
            { url: "/login", status: 401, match: { code: "MFA" }, body: { login: "admin", secret: "admin" } },
            { url: "/login", status: 200, body: { login: "admin", secret: "admin" },
              preprocess: (conf, query, next) => {
                query.body.code = api.users.prepareMFA(user);
                api.users.update(user, next);
            } },
        ];
        const tmp = {};

        await acheckAccess({ config, tmp });
    });

    after(async () => {
        await app.astop()
    })
})

