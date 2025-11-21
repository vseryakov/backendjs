/* global  */

const { describe, it } = require('node:test');
const { checkAccess } = require("./utils");

const config = [
    { get: "/ping" },
    { url: "/auth", status: 417 },
    { url: "/login", data: { login: "test", secret: "test1" }, status: 401 },
    { url: "/login", data: { login: "test", secret: "test" } },
    { url: "/auth" },
];

describe('Access Tests', (t) => {

    it("checks basic endpoints", (t, callback) => {
        checkAccess({ config }, callback);
    });
})

