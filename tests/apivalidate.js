
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
            context.send(200, "ok")
        })
        api.app.all("/login", (context) => {
            context.send(200, "ok")
        })
    });

    it("checks validate endpoints", async () => {

        const token = api.token.create({}).token;

        const config = [
            { get: "/" },
            { get: "/account/a", status: 400 },
            { get: "/account/1" },
            { get: "/account/1", status: 429, delay: 1000 },
            { get: "/account/1" },
            { get: "/client/1", status: 400 },
            { get: "/client/2?clientId=aaa", status: 400 },
            { get: "/client/3?clientId=123" },
            { get: "/client/3?clientId=123", status: 429 },
            { get: "/login" },
            { url: "/login", status: 400 },
        ];

        await acheckAccess({ config });
    });

    after(async () => {
        await astop()
    })
})

