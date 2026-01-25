/* global  */

const { describe, it, before, after } = require('node:test');
const { acheckAccess, ainit } = require("./utils");
const { app } = require("../");

const config = [
    { get: "/ping" },
    { url: "/auth", status: 417 },
    { url: "/login", data: { login: "test", secret: "test1" }, status: 401 },
    { url: "/login", data: { login: "test", secret: "test" } },
    { url: "/auth" },
];

describe('Access Tests', async () => {

    before(async () => {
        await ainit({ api: 1, nodb: 1, noipc: 1, roles: "users" })
    });

    it("checks basic endpoints", async () => {
        await acheckAccess({ config });
    });

    after(async () => {
        await app.astop()
    })
})

