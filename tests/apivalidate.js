
const { describe, it, before, after } = require('node:test');
const { api } = require("../");
const { ainit, astop, acheckAccess } = require("./utils");

describe('API validate tests', async () => {

    before(async () => {
        await ainit({ api: 1, cache: 1, nodb: 1, noipc: 1, roles: process.env.BKJS_ROLES || "validate" })

        api.app.all("/account/*", (context) => {
            context.send(200, "ok")
        })
        api.app.all("/client/*", (context) => {
            context.send(200, typeof context.query.clientId)
        })
        api.app.all("/login", (context) => {
            context.send(200, "ok")
        })
        api.app.all("/session/:id", (context) => {
            context.send(200, typeof context.params.id)
        })
        api.app.all("/user/*", (context) => {
            context.send(200, typeof context.params[0])
        })
        api.app.use("#0", "/user/1", (context, next) => {
            context.user = { id: 1, name: "test" };
            next()
        })
    });

    it("checks validate endpoints", async () => {

        const token = api.token.create({}).token;

        const config = [
            { get: "/" },
            { get: "/account/a", status: 400 },
            { get: "/account/1" },
            { get: "/account/1", status: 429, delay: 500 },
            { get: "/account/1" },
            { get: "/client/1", status: 400 },
            { get: "/client/2?clientId=aaa", status: 400 },
            { get: "/client/3?clientId=123", regexp: /number/ },
            { get: "/client/3?clientId=123", status: 429 },
            { get: "/login" },
            { url: "/login", status: 400 },
            { url: "/user/1", status: 400 },
            { url: "/user/1?id=1" },
            { url: "/user/1?id=1", status: 429 },
            { url: "/user/2?id=2" },
            { url: "/user/2?id=2", status: 429 },
            { url: "/session/1", user: token },
            { url: "/session/2" },
            { url: "/session/1", status: 429, user: token },
            { put: "/session/2" },
            { put: "/session/2" },
            { put: "/session/2" },
            { put: "/session/a" },
        ];

        await acheckAccess({ config });
    });

    after(async () => {
        await astop()
    })
})

