/* global  */

const { describe, it, before, after } = require('node:test');
const { acheckAccess, ainit } = require("./utils");
const { app, api } = require("../");

const roles = process.env.BKJS_ROLES || "users,sqlite";

describe('Users middleware tests', async () => {

    before(async () => {
        await ainit({ api: 1, noipc: 1, roles });

        api.app.all("/api/1", (context) => { context.send(200, "api") })
        api.app.all("/admin/1", (context) => { context.send(200, "admin") })
    });

    it("test access", async () => {

        const config = [
            { url: "/none", status: 404 },
            { get: "/", regexp: /index.html/ },
            { get: "/api/1", noredirects: 1, resheaders: { location: /^\/login.html$/ }, status: 302 },
            { get: "/profile", status: 401 },
            { url: "/logout", status: 401 },
            { url: "/login", status: 401, body: { login: "test", secret: "fake" } },
            { url: "/login", status: 200, body: { login: "test", secret: "test" } },
            { get: "/api/1", status: 200, noredirects: 1, },
            { get: "/admin/1", status: 403, noredirects: 1, },
            { get: "/staff/1", status: 403, noredirects: 1, },
        ];
        const tmp = {};

        await acheckAccess({ config, tmp });
    });

    it("admin access", async () => {

        const config = [
            { url: "/none", status: 404 },
            { get: "/", regexp: /index.html/ },
            { get: "/api/1", noredirects: 1, resheaders: { location: /^\/login.html$/ }, status: 302 },
            { get: "/profile", status: 401 },
            { url: "/logout", status: 401 },
            { url: "/login", status: 401, body: { login: "admin", secret: "fake" } },
            { url: "/login", status: 200, body: { login: "admin", secret: "admin" } },
            { get: "/api/1", status: 200, noredirects: 1, },
            { get: "/admin/1", status: 200, noredirects: 1, },
            { get: "/staff/1", status: 403, noredirects: 1, },
        ];
        const tmp = {};

        await acheckAccess({ config, tmp });
    });

    after(async () => {
        await app.astop()
    })
})

