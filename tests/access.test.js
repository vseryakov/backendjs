/* global  */

const { describe, it, before, after } = require('node:test');
const { checkAccess, init } = require("./utils");
const { app } = require("../");

const config = [
    { get: "/ping" },
    { url: "/auth", status: 417 },
    { url: "/login", data: { login: "test", secret: "test1" }, status: 401 },
    { url: "/login", data: { login: "test", secret: "test" } },
    { url: "/auth" },
];

describe('Access Tests', (t) => {

    before((t, done) => {
        init({ api: 1, nodb: 1, noipc: 1, roles: "users" }, done)
    });

    it("checks basic endpoints", (t, done) => {
        checkAccess({ config }, done);
    });

    after((t, done) => {
        app.stop(() => {
            console.log("done")
            done()
        })
    })
})

